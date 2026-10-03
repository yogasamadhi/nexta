import {
  createTask,
  createUserModelFeature,
  parseInstant,
  parseTaskId,
  parseUserModelFeatureId,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

import {
  MobileNeutralSchedulingInputPolicy,
  MobilePreviewExpirationPolicy,
  MobileScheduleHorizonPolicy,
  type MobileSchedulingPolicyOptions,
} from '../../../apps/mobile/src/runtime/mobile-scheduling-policy';
import { IntlTemporalAdapter } from '../../../apps/mobile/src/runtime/intl-temporal-adapter';
import { IntlUtcWorkingWindowPort } from '../../../apps/mobile/src/runtime/working-window-port';

const options: MobileSchedulingPolicyOptions = {
  policyVersion: 'predecision-neutral-v1',
  gridAnchor: '1970-01-01T00:00:00.000Z',
  defaultHorizonMs: 7 * 24 * 60 * 60_000,
  previewTtlMs: 15 * 60_000,
  granularityMinutes: 15,
  defaultMinBlockMinutes: 15,
  defaultMaxBlockMinutes: 120,
};

describe('mobile scheduling composition policies', () => {
  it('creates a finite explicit default horizon and preview TTL', async () => {
    const now = parseInstant('2026-09-12T08:00:00.000Z');
    await expect(
      new MobileScheduleHorizonPolicy(options).defaultHorizon({
        now,
        timeZone: 'Asia/Shanghai' as never,
      }),
    ).resolves.toEqual({
      start: now,
      end: '2026-09-19T08:00:00.000Z',
    });
    expect(
      new MobilePreviewExpirationPolicy(options).expirationFor({
        createdAt: now,
        horizon: {
          start: now,
          end: '2026-09-19T08:00:00.000Z' as never,
        },
        earliestChangedBlockStart: null,
      }),
    ).toBe('2026-09-12T08:15:00.000Z');
  });

  it('assigns equal priority ranks and disables every undecided soft weight', async () => {
    const now = parseInstant('2026-09-12T08:00:00.000Z');
    const makeTask = (id: string, priority: string) =>
      createTask({
        id: parseTaskId(id),
        title: id,
        priority,
        estimatedDurationMinutes: 30,
        splittable: false,
        schedulingPolicy: 'flexible',
        source: 'manual',
        createdAt: now,
      });
    const result = await new MobileNeutralSchedulingInputPolicy(
      options,
    ).snapshot({
      now,
      horizon: {
        start: now,
        end: '2026-09-13T08:00:00.000Z' as never,
      },
      timeZone: 'Asia/Shanghai' as never,
      tasks: [makeTask('task-high', 'high'), makeTask('task-low', 'low')],
      personalizationEnabled: true,
      userModelFeatures: [],
      latestEnergyCheckIn: null,
    });

    expect(result.policy.priorityRanks).toEqual({ high: 1, low: 1 });
    expect(new Set(Object.values(result.policy.scoreWeights))).toEqual(
      new Set([0]),
    );
    expect(result.userModel).toEqual({
      completionRateWindows: [],
      recoveryPenaltyWindows: [],
    });
    expect(result.policy.scoreWeights.completionRate).toBe(0);
  });

  it('does not enable personalization before DEC-007 even when cached evidence exists', async () => {
    const now = parseInstant('2026-09-12T08:00:00.000Z');
    const input = {
      now,
      horizon: {
        start: now,
        end: parseInstant('2026-09-13T08:00:00.000Z'),
      },
      timeZone: 'Asia/Shanghai' as never,
      tasks: [],
      personalizationEnabled: true,
      userModelFeatures: [
        createUserModelFeature({
          id: parseUserModelFeatureId('feature-hour-09'),
          featureKey: 'completion_rate_hour',
          scopeKey: 'hour_09',
          numericValue: 0.9,
          windowStart: parseInstant('2026-08-01T00:00:00.000Z'),
          windowEnd: now,
          sourceStateVersion: 1,
          sampleCount: 20,
          confidence: 1,
          algorithmVersion: 'undecided-v1',
          lastUpdatedAt: now,
        }),
      ],
      latestEnergyCheckIn: null,
    } as const;

    const result = await new MobileNeutralSchedulingInputPolicy(
      options,
    ).snapshot(input);
    expect(result.userModel.completionRateWindows).toEqual([]);
    expect(result.policy.scoreWeights.completionRate).toBe(0);
  });

  it('adapts stored local working rules through explicit DST resolution', async () => {
    const port = new IntlUtcWorkingWindowPort(
      new IntlTemporalAdapter({
        currentTimeZone: () => 'America/New_York',
      }),
    );

    await expect(
      port.listUtcWorkingWindows(
        {
          start: parseInstant('2026-11-01T00:00:00.000Z'),
          end: parseInstant('2026-11-02T12:00:00.000Z'),
        },
        'America/New_York' as never,
        [
          {
            id: 'fold-window',
            weekdays: [7],
            startLocalTime: '01:15',
            endLocalTime: '01:45',
            startDisambiguation: 'earlier',
            endDisambiguation: 'later',
          },
        ],
      ),
    ).resolves.toEqual([
      {
        id: 'fold-window@2026-11-01',
        start: '2026-11-01T05:15:00.000Z',
        end: '2026-11-01T06:45:00.000Z',
        energyLevel: null,
      },
    ]);
  });

  it('rejects contradictory block bounds at composition startup', () => {
    expect(
      () =>
        new MobileNeutralSchedulingInputPolicy({
          ...options,
          defaultMinBlockMinutes: 90,
          defaultMaxBlockMinutes: 60,
        }),
    ).toThrow('ordered multiples');
  });
});
