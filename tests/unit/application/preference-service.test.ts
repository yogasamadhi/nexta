import {
  createIntegrationJob,
  parseInstant,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
} from '@workspace/domain';
import { describe, expect, it, vi } from 'vitest';

import { PreferenceService } from '../../../packages/application/src/preference-service';
import { MemoryUnitOfWork, QueueIdGenerator, SequenceClock } from './fakes';

const NOW = parseInstant('2026-09-12T08:00:00.000Z');

function fixture(
  integrationWakeup?: Readonly<{ wake(operationId: string): Promise<void> }>,
) {
  const unitOfWork = new MemoryUnitOfWork();
  return {
    unitOfWork,
    service: new PreferenceService({
      unitOfWork,
      clock: new SequenceClock(NOW, NOW, NOW),
      idGenerator: new QueueIdGenerator('preference-1', 'preference-2'),
      integrationWakeup,
    }),
  };
}

describe('PreferenceService', () => {
  it('writes a validated scheduling preference and advances stateVersion', async () => {
    const test = fixture();
    const result = await test.service.update(
      {
        key: 'scheduling.timeZone.v1',
        value: { timeZone: 'Asia/Shanghai' },
      },
      { operationId: 'preference-op-1', authority: { kind: 'user' } },
    );

    expect(result).toMatchObject({
      operationId: 'preference-op-1',
      stateVersion: 1,
      planRevision: 0,
      preference: {
        id: 'preference-1',
        key: 'scheduling.timeZone.v1',
        valueJson: { timeZone: 'Asia/Shanghai' },
      },
    });
    await expect(test.service.get('scheduling.timeZone.v1')).resolves.toEqual(
      result.preference,
    );
  });

  it('records an unchanged write without inventing a new state version', async () => {
    const test = fixture();
    const input = {
      key: 'calendar.busySources.v1' as const,
      value: {
        sources: [
          { provider: 'expo-calendar', calendarId: 'work', enabled: true },
        ],
      },
    };
    await test.service.update(input, {
      operationId: 'preference-op-1',
      authority: { kind: 'user' },
    });
    const second = await test.service.update(input, {
      operationId: 'preference-op-2',
      authority: { kind: 'user' },
    });

    expect(second.stateVersion).toBe(1);
    expect(test.unitOfWork.state.userPreferences).toHaveLength(1);
    expect(test.unitOfWork.state.operationRecords).toHaveLength(2);
  });

  it('persists the explicit personalization off switch as a direct-user setting', async () => {
    const test = fixture();
    const result = await test.service.update(
      {
        key: 'personalization.enabled.v1',
        value: { enabled: false },
      },
      {
        operationId: 'preference-personalization',
        authority: { kind: 'user' },
      },
    );

    expect(result.preference).toMatchObject({
      key: 'personalization.enabled.v1',
      valueJson: { enabled: false },
    });
    expect(result.stateVersion).toBe(1);
  });

  it('persists the directly controlled mindful transition setting', async () => {
    const test = fixture();
    const result = await test.service.update(
      {
        key: 'focus.mindfulTransition.enabled.v1',
        value: { enabled: false },
      },
      {
        operationId: 'preference-focus-transition',
        authority: { kind: 'user' },
      },
    );

    expect(result.preference).toMatchObject({
      key: 'focus.mindfulTransition.enabled.v1',
      valueJson: { enabled: false },
    });
    expect(result.stateVersion).toBe(1);
  });

  it('requeues the current safe notification projection after the user changes lead time', async () => {
    const wake = vi.fn(async () => undefined);
    const test = fixture({ wake });
    test.unitOfWork.state.scheduleState = {
      stateVersion: 4,
      planRevision: 2,
    };
    const job = createIntegrationJob({
      id: parseIntegrationJobId('notification-job'),
      operationId: parseOperationId('schedule-operation'),
      targetChannel: 'notification',
      targetEntityType: 'schedule_plan',
      targetEntityId: parseSchedulePlanId('plan-2'),
      desiredRevision: 2,
      desiredAction: 'reconcile',
      status: 'succeeded',
      automaticRetryEligible: false,
      createdAt: NOW,
    });
    test.unitOfWork.state.integrationJobs.set(job.id, job);

    await expect(
      test.service.update(
        {
          key: 'notification.leadMinutes.v1',
          value: { leadMinutes: 15 },
        },
        { operationId: 'preference-lead', authority: { kind: 'user' } },
      ),
    ).resolves.toMatchObject({
      stateVersion: 5,
      planRevision: 2,
      preference: {
        key: 'notification.leadMinutes.v1',
        valueJson: { leadMinutes: 15 },
      },
    });
    expect(test.unitOfWork.state.integrationJobs.get(job.id)).toMatchObject({
      status: 'pending',
      automaticRetryEligible: true,
      notBefore: NOW,
    });
    expect(wake).toHaveBeenCalledWith('preference-lead');
  });

  it('replays the same operation exactly and rejects parameter reuse', async () => {
    const test = fixture();
    const context = {
      operationId: 'preference-op-1',
      authority: { kind: 'user' as const },
    };
    const first = await test.service.update(
      {
        key: 'scheduling.timeZone.v1',
        value: { timeZone: 'Asia/Shanghai' },
      },
      context,
    );

    await expect(
      test.service.update(
        {
          key: 'scheduling.timeZone.v1',
          value: { timeZone: 'Asia/Shanghai' },
        },
        context,
      ),
    ).resolves.toEqual(first);
    await expect(
      test.service.update(
        {
          key: 'scheduling.timeZone.v1',
          value: { timeZone: 'UTC' },
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('requires direct user authority and rejects malformed or unknown values', async () => {
    const test = fixture();
    await expect(
      test.service.update(
        {
          key: 'scheduling.timeZone.v1',
          value: { timeZone: 'Asia/Shanghai' },
        },
        {
          operationId: 'preference-op-1',
          authority: { kind: 'agent_authorized', authorizationId: 'grant-1' },
        },
      ),
    ).rejects.toMatchObject({ code: 'permission_required' });
    await expect(
      test.service.update(
        {
          key: 'scheduling.workingHours.v1',
          value: {
            timeZone: 'Asia/Shanghai',
            rules: [
              {
                id: 'work',
                weekdays: [1],
                startLocalTime: '09:00',
                endLocalTime: '09:00',
              },
            ],
          },
        },
        { operationId: 'preference-op-2', authority: { kind: 'user' } },
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      test.service.update(
        {
          key: 'notification.leadMinutes.v1',
          value: { leadMinutes: 1_441 },
        },
        { operationId: 'preference-op-3', authority: { kind: 'user' } },
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rolls back preference, state, and receipt together', async () => {
    const test = fixture();
    test.unitOfWork.failOn = 'scheduleState.update';

    await expect(
      test.service.update(
        {
          key: 'scheduling.timeZone.v1',
          value: { timeZone: 'Asia/Shanghai' },
        },
        { operationId: 'preference-op-1', authority: { kind: 'user' } },
      ),
    ).rejects.toMatchObject({ code: 'adapter_error' });
    expect(test.unitOfWork.state.userPreferences).toHaveLength(0);
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
    expect(test.unitOfWork.state.scheduleState?.stateVersion).toBe(0);
  });
});
