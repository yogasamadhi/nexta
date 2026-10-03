import { DatabaseSync } from 'node:sqlite';

import {
  ApplicationError,
  type ScheduleHorizonPolicy,
  type SchedulingInputPolicyPort,
  type UtcWorkingWindowPort,
} from '@workspace/application';
import {
  initializeSqliteApplicationUnitOfWork,
  SqliteSchedulingSnapshotPort,
  type SqliteDatabase,
} from '@workspace/database';
import {
  createCalendarBinding,
  createCalendarContainerBinding,
  createCalendarRefreshCoverage,
  createEnergyCheckIn,
  createExternalCalendarEventSnapshot,
  createTask,
  createTimeBlock,
  createUserPreference,
  createUserModelFeature,
  parseCalendarBindingId,
  parseCalendarContainerBindingId,
  parseCalendarRefreshCoverageId,
  parseExternalCalendarEventSnapshotId,
  parseEnergyCheckInId,
  parseInstant,
  parseLocalDate,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  parseUserPreferenceId,
  parseUserModelFeatureId,
} from '@workspace/domain';
import { SCHEDULER_VERSION } from '@workspace/scheduler-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const now = parseInstant('2026-09-12T08:00:00.000Z');
const start = parseInstant('2026-09-12T08:00:00.000Z');
const workStart = parseInstant('2026-09-12T09:00:00.000Z');
const workEnd = parseInstant('2026-09-12T17:00:00.000Z');
const end = parseInstant('2026-09-12T20:00:00.000Z');
const timeZone = parseTimeZoneId('Asia/Shanghai');

class FixedHorizon implements ScheduleHorizonPolicy {
  defaultHorizon() {
    return Promise.resolve({ start, end });
  }
}

class CapturingWorkingWindows implements UtcWorkingWindowPort {
  calls: unknown[][] = [];

  listUtcWorkingWindows(
    ...args: Parameters<UtcWorkingWindowPort['listUtcWorkingWindows']>
  ) {
    this.calls.push(args);
    return Promise.resolve([
      { id: 'work', start: workStart, end: workEnd, energyLevel: null },
    ]);
  }
}

class NeutralPolicy implements SchedulingInputPolicyPort {
  readonly calls: Parameters<SchedulingInputPolicyPort['snapshot']>[0][] = [];

  snapshot(input: Parameters<SchedulingInputPolicyPort['snapshot']>[0]) {
    this.calls.push(input);
    return Promise.resolve({
      preferredWindows: [],
      userModel: {
        completionRateWindows: [],
        recoveryPenaltyWindows: [],
      },
      policy: {
        policyVersion: 'snapshot-test-v1',
        schedulerVersion: SCHEDULER_VERSION,
        gridAnchor: parseInstant('1970-01-01T00:00:00.000Z'),
        granularityMinutes: 15,
        defaultMinBlockMinutes: 15,
        defaultMaxBlockMinutes: 120,
        priorityRanks: { normal: 1 },
        energyMatchScores: [],
        defaultEnergyMatchScore: 0,
        scoreWeights: {
          planStability: 0,
          fragmentation: 0,
          preferredHours: 0,
          completionRate: 0,
          energyMatch: 0,
          recoveryPenalty: 0,
        },
      },
    });
  }
}

describe('production SQLite SchedulingSnapshot', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  async function fixture(options: { busySources?: boolean } = {}) {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => now,
    });
    const workingWindows = new CapturingWorkingWindows();
    const inputPolicy = new NeutralPolicy();
    const snapshots = new SqliteSchedulingSnapshotPort({
      unitOfWork,
      workingWindows,
      horizonPolicy: new FixedHorizon(),
      inputPolicy,
      maximumHorizonMs: 32 * 24 * 60 * 60_000,
    });
    const task = createTask({
      id: parseTaskId('task-snapshot'),
      title: 'Snapshot task',
      priority: 'normal',
      estimatedDurationMinutes: 60,
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: now,
    });
    const block = createTimeBlock({
      id: parseTimeBlockId('block-snapshot'),
      taskId: task.id,
      type: 'task',
      startAt: workStart,
      endAt: parseInstant('2026-09-12T10:00:00.000Z'),
      status: 'planned',
      source: 'scheduler',
      locked: false,
      planRevision: 1,
      createdAt: now,
    });
    await unitOfWork.transaction(async (transaction) => {
      await transaction.tasks.insert(task);
      await transaction.timeBlocks.insert(block);
      for (const preference of [
        createUserPreference({
          id: parseUserPreferenceId('preference-zone'),
          key: 'scheduling.timeZone.v1',
          valueJson: { timeZone },
          updatedAt: now,
        }),
        createUserPreference({
          id: parseUserPreferenceId('preference-hours'),
          key: 'scheduling.workingHours.v1',
          valueJson: {
            timeZone,
            rules: [
              {
                id: 'weekday-hours',
                weekdays: [1, 2, 3, 4, 5],
                startLocalTime: '09:00',
                endLocalTime: '17:00',
              },
            ],
          },
          updatedAt: now,
        }),
        createUserPreference({
          id: parseUserPreferenceId('preference-calendars'),
          key: 'calendar.busySources.v1',
          valueJson: {
            sources:
              options.busySources === false
                ? []
                : [
                    {
                      provider: 'expo-calendar',
                      calendarId: 'work-calendar',
                      enabled: true,
                    },
                  ],
          },
          updatedAt: now,
        }),
      ]) {
        await transaction.userPreferences.upsert(preference);
      }
    });
    return {
      unitOfWork,
      snapshots,
      workingWindows,
      inputPolicy,
      task,
      block,
    };
  }

  it('captures one consistent task/block/working-hours/busy snapshot and excludes owned events', async () => {
    const test = await fixture();
    await test.unitOfWork.transaction(async (transaction) => {
      const container = createCalendarContainerBinding({
        id: parseCalendarContainerBindingId('container-snapshot'),
        provider: 'expo-calendar',
        calendarId: 'work-calendar',
        ownershipKey: 'app-owned',
        ownershipVerified: true,
        status: 'synced',
        verifiedAt: now,
        createdAt: now,
      });
      await transaction.calendarContainerBindings.upsert(container);
      await transaction.calendarBindings.upsertIfNotNewer(
        createCalendarBinding({
          id: parseCalendarBindingId('binding-snapshot'),
          timeBlockId: test.block.id,
          provider: container.provider,
          calendarId: container.calendarId,
          externalEventId: 'owned-event',
          occurrenceKey: null,
          ownershipKey: container.ownershipKey,
          ownershipVerified: true,
          appliedContentHash: 'owned-hash',
          appliedStartAt: test.block.startAt,
          appliedEndAt: test.block.endAt,
          lastAppliedRevision: 1,
          status: 'synced',
          verifiedAt: now,
          createdAt: now,
        }),
      );
      for (const snapshot of [
        createExternalCalendarEventSnapshot({
          id: parseExternalCalendarEventSnapshotId('snapshot-external'),
          provider: 'expo-calendar',
          calendarId: 'work-calendar',
          externalEventId: 'meeting',
          occurrenceKey: null,
          startAt: parseInstant('2026-09-12T11:00:00.000Z'),
          endAt: parseInstant('2026-09-12T12:00:00.000Z'),
          busy: true,
          lastSeenAt: now,
          contentHash: 'meeting-hash',
        }),
        createExternalCalendarEventSnapshot({
          id: parseExternalCalendarEventSnapshotId('snapshot-owned'),
          provider: 'expo-calendar',
          calendarId: 'work-calendar',
          externalEventId: 'owned-event',
          occurrenceKey: null,
          startAt: test.block.startAt,
          endAt: test.block.endAt,
          busy: true,
          lastSeenAt: now,
          contentHash: 'owned-hash',
        }),
      ]) {
        await transaction.externalCalendarEventSnapshots.upsert(snapshot);
      }
      await transaction.calendarRefreshCoverages.insert(
        createCalendarRefreshCoverage({
          id: parseCalendarRefreshCoverageId('coverage-snapshot'),
          provider: 'expo-calendar',
          calendarId: 'work-calendar',
          rangeStart: start,
          rangeEnd: end,
          fetchedAt: now,
          completeness: 'complete',
          observedEventCount: 2,
        }),
      );
    });

    const result = await test.snapshots.capture({
      reason: 'initial schedule',
      taskIds: null,
      requestedTimeRange: null,
      now,
    });

    expect(result).toMatchObject({
      horizon: { start, end },
      timeZone,
      tasks: [{ id: test.task.id }],
      timeBlocks: [{ id: test.block.id }],
      busy: {
        capturedAt: now,
        completeness: 'complete',
        events: [
          {
            id: 'snapshot-external',
            start: '2026-09-12T11:00:00.000Z',
            end: '2026-09-12T12:00:00.000Z',
          },
        ],
      },
      workingWindows: [{ id: 'work' }],
    });
    expect(result.busy.scopes).toEqual([
      {
        provider: 'expo-calendar',
        calendarId: 'work-calendar',
        capturedAt: now,
        completeness: 'complete',
      },
    ]);
    expect(test.workingWindows.calls[0]).toEqual([
      { start, end },
      timeZone,
      [
        {
          id: 'weekday-hours',
          weekdays: [1, 2, 3, 4, 5],
          startLocalTime: '09:00',
          endLocalTime: '17:00',
        },
      ],
    ]);
    expect(test.inputPolicy.calls[0]).toMatchObject({
      latestEnergyCheckIn: null,
      personalizationEnabled: false,
      userModelFeatures: [],
    });
  });

  it('distinguishes explicit no-calendar scope from incomplete setup', async () => {
    const configured = await fixture({ busySources: false });
    await expect(
      configured.snapshots.capture({
        reason: 'local-only schedule',
        taskIds: null,
        requestedTimeRange: null,
        now,
      }),
    ).resolves.toMatchObject({
      busy: {
        capturedAt: null,
        completeness: 'not_configured',
        scopes: [],
        events: [],
      },
    });

    const emptyNative = new DatabaseSync(':memory:');
    const emptyDatabase = createNodeSqliteDatabase(emptyNative);
    try {
      const unitOfWork = await initializeSqliteApplicationUnitOfWork(
        emptyDatabase,
        { now: () => now },
      );
      const snapshots = new SqliteSchedulingSnapshotPort({
        unitOfWork,
        workingWindows: new CapturingWorkingWindows(),
        horizonPolicy: new FixedHorizon(),
        inputPolicy: new NeutralPolicy(),
        maximumHorizonMs: 32 * 24 * 60 * 60_000,
      });
      await expect(
        snapshots.capture({
          reason: 'missing setup',
          taskIds: null,
          requestedTimeRange: null,
          now,
        }),
      ).rejects.toMatchObject({
        code: 'scheduling_setup_required',
      } satisfies Partial<ApplicationError>);
    } finally {
      emptyNative.close();
    }
  });

  it('passes the explicit personalization switch and cached features only to policy', async () => {
    const test = await fixture({ busySources: false });
    const modelFeature = createUserModelFeature({
      id: parseUserModelFeatureId('feature-hour-09'),
      featureKey: 'completion_rate_hour',
      scopeKey: 'hour_09',
      numericValue: 0.8,
      windowStart: parseInstant('2026-08-01T00:00:00.000Z'),
      windowEnd: now,
      sourceStateVersion: 0,
      sampleCount: 12,
      confidence: 0.8,
      algorithmVersion: 'candidate-model-v1',
      lastUpdatedAt: now,
    });
    await test.unitOfWork.transaction(async (transaction) => {
      await transaction.userPreferences.upsert(
        createUserPreference({
          id: parseUserPreferenceId('preference-personalization'),
          key: 'personalization.enabled.v1',
          valueJson: { enabled: true },
          updatedAt: now,
        }),
      );
      await transaction.userModelFeatures.replaceForAlgorithmVersion(
        'candidate-model-v1',
        [modelFeature],
      );
    });

    await test.snapshots.capture({
      reason: 'candidate personalization boundary',
      taskIds: null,
      requestedTimeRange: null,
      now,
    });
    expect(test.inputPolicy.calls.at(-1)).toMatchObject({
      personalizationEnabled: true,
      userModelFeatures: [
        {
          id: 'feature-hour-09',
          featureKey: 'completion_rate_hour',
          scopeKey: 'hour_09',
        },
      ],
    });
  });

  it('passes only the latest observed energy check-in at or before capture time to policy', async () => {
    const test = await fixture({ busySources: false });
    await test.unitOfWork.transaction(async (transaction) => {
      await transaction.energyCheckIns.insert(
        createEnergyCheckIn({
          id: parseEnergyCheckInId('check-in-current'),
          localDate: parseLocalDate('2026-09-12'),
          timeZone,
          level: 2,
          note: '当前主观精力偏低',
          createdAt: parseInstant('2026-09-12T07:55:00.000Z'),
        }),
      );
      await transaction.energyCheckIns.insert(
        createEnergyCheckIn({
          id: parseEnergyCheckInId('check-in-future'),
          localDate: parseLocalDate('2026-09-12'),
          timeZone,
          level: 5,
          createdAt: parseInstant('2026-09-12T08:05:00.000Z'),
        }),
      );
    });

    await test.snapshots.capture({
      reason: 'energy-aware policy boundary',
      taskIds: null,
      requestedTimeRange: null,
      now,
    });
    expect(test.inputPolicy.calls.at(-1)).toMatchObject({
      latestEnergyCheckIn: {
        id: 'check-in-current',
        level: 2,
        note: '当前主观精力偏低',
        createdAt: '2026-09-12T07:55:00.000Z',
      },
    });
  });

  it('marks cache-without-complete-coverage as partial and rejects an oversized requested horizon', async () => {
    const test = await fixture();
    await test.unitOfWork.transaction((transaction) =>
      transaction.externalCalendarEventSnapshots.upsert(
        createExternalCalendarEventSnapshot({
          id: parseExternalCalendarEventSnapshotId('snapshot-partial'),
          provider: 'expo-calendar',
          calendarId: 'work-calendar',
          externalEventId: 'partial-meeting',
          occurrenceKey: null,
          startAt: workStart,
          endAt: parseInstant('2026-09-12T10:00:00.000Z'),
          busy: true,
          lastSeenAt: now,
          contentHash: 'partial-hash',
        }),
      ),
    );
    await expect(
      test.snapshots.capture({
        reason: 'partial cache',
        taskIds: null,
        requestedTimeRange: null,
        now,
      }),
    ).resolves.toMatchObject({
      busy: { capturedAt: now, completeness: 'partial' },
    });
    await expect(
      test.snapshots.capture({
        reason: 'too broad',
        taskIds: null,
        requestedTimeRange: {
          start,
          end: parseInstant('2026-12-01T00:00:00.000Z'),
        },
        now,
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });
});
