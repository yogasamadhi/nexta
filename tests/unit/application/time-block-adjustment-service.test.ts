import {
  ApplicationError,
  InMemoryTimeBlockAdjustmentPreviewStore,
  TimeBlockAdjustmentService,
  type SchedulingSnapshot,
} from '@workspace/application';
import {
  createTask,
  createTimeBlock,
  parseInstant,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
} from '@workspace/domain';
import { SCHEDULER_VERSION } from '@workspace/scheduler-core';
import { describe, expect, it } from 'vitest';

import {
  FixedPreviewExpirationPolicy,
  MemoryUnitOfWork,
  MutableSchedulingSnapshotPort,
  QueueIdGenerator,
  RecordingIntegrationWakeup,
  SequenceClock,
  createMemoryState,
} from './fakes';

const CREATED = parseInstant('2026-09-12T08:00:00.000Z');
const NOW = parseInstant('2026-09-12T09:00:00.000Z');
const COMMIT = parseInstant('2026-09-12T09:01:00.000Z');
const UNLOCK = parseInstant('2026-09-12T09:02:00.000Z');
const EXPIRES = parseInstant('2026-09-12T09:15:00.000Z');

function fixture(overrides: Partial<SchedulingSnapshot> = {}) {
  const task = createTask({
    id: parseTaskId('task-1'),
    title: 'Deep work',
    priority: 'normal',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: CREATED,
  });
  const block = createTimeBlock({
    id: parseTimeBlockId('block-1'),
    taskId: task.id,
    type: 'task',
    startAt: parseInstant('2026-09-12T10:00:00.000Z'),
    endAt: parseInstant('2026-09-12T11:00:00.000Z'),
    status: 'planned',
    source: 'scheduler',
    locked: false,
    planRevision: 0,
    createdAt: CREATED,
  });
  const snapshot: SchedulingSnapshot = {
    scheduleState: { stateVersion: 0, planRevision: 0 },
    horizon: { start: NOW, end: '2026-09-12T17:00:00.000Z' },
    timeZone: parseTimeZoneId('Asia/Shanghai'),
    tasks: [task],
    timeBlocks: [block],
    busy: {
      capturedAt: CREATED,
      completeness: 'complete',
      scopes: [],
      events: [],
    },
    workingWindows: [
      {
        id: 'workday',
        start: '2026-09-12T09:00:00.000Z',
        end: '2026-09-12T17:00:00.000Z',
        energyLevel: null,
      },
    ],
    preferredWindows: [],
    userModel: { completionRateWindows: [], recoveryPenaltyWindows: [] },
    policy: {
      schedulerVersion: SCHEDULER_VERSION,
      policyVersion: 'test-policy',
      gridAnchor: '1970-01-01T00:00:00.000Z',
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
    ...overrides,
  };
  const state = createMemoryState();
  state.tasks.set(task.id, task);
  state.timeBlocks.set(block.id, block);
  const unitOfWork = new MemoryUnitOfWork(state);
  const wakeup = new RecordingIntegrationWakeup();
  const service = new TimeBlockAdjustmentService({
    unitOfWork,
    snapshots: new MutableSchedulingSnapshotPort(snapshot),
    previews: new InMemoryTimeBlockAdjustmentPreviewStore(),
    expirationPolicy: new FixedPreviewExpirationPolicy(EXPIRES),
    clock: new SequenceClock(NOW, COMMIT, UNLOCK),
    ids: {
      preview: new QueueIdGenerator('adjustment-preview-1'),
      schedulePlan: new QueueIdGenerator('adjustment-plan-1', 'unlock-plan-1'),
      integrationJob: new QueueIdGenerator(
        'adjustment-calendar-1',
        'adjustment-notification-1',
        'unlock-calendar-1',
        'unlock-notification-1',
      ),
    },
    integrationWakeup: wakeup,
  });
  return { service, unitOfWork, wakeup, block };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('TimeBlockAdjustmentService', () => {
  it('previews without writes, commits atomically, locks, and explicitly unlocks', async () => {
    const test = fixture();
    const preview = await test.service.preview({
      timeBlockId: test.block.id,
      startAt: '2026-09-12T12:00:00.000Z',
      endAt: '2026-09-12T13:00:00.000Z',
    });

    expect(preview).toMatchObject({
      basedOnStateVersion: 0,
      before: { locked: false },
      after: { locked: true },
    });
    expect(test.unitOfWork.calls).toEqual([]);

    const committed = await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      { operationId: 'adjust-operation', authority: { kind: 'user' } },
    );
    expect(committed).toMatchObject({ stateVersion: 1, planRevision: 1 });
    expect(test.unitOfWork.state.timeBlocks.get(test.block.id)).toMatchObject({
      startAt: '2026-09-12T12:00:00.000Z',
      endAt: '2026-09-12T13:00:00.000Z',
      locked: true,
      planRevision: 1,
    });
    expect(test.unitOfWork.state.schedulePlans).toHaveLength(1);
    expect(test.unitOfWork.state.integrationJobs).toHaveLength(2);

    const unlocked = await test.service.unlock(
      { timeBlockId: test.block.id, expectedStateVersion: 1 },
      { operationId: 'unlock-operation', authority: { kind: 'user' } },
    );
    expect(unlocked).toMatchObject({ stateVersion: 2, planRevision: 2 });
    expect(test.unitOfWork.state.timeBlocks.get(test.block.id)).toMatchObject({
      locked: false,
      planRevision: 2,
    });
    expect(test.unitOfWork.state.integrationJobs).toHaveLength(4);
    expect(test.wakeup.operationIds).toEqual([
      'adjust-operation',
      'unlock-operation',
    ]);
  });

  it('rejects busy overlap, locked input, stale state, and non-user commit', async () => {
    const busy = fixture({
      busy: {
        capturedAt: CREATED,
        completeness: 'complete',
        scopes: [],
        events: [
          {
            id: 'busy-1',
            start: '2026-09-12T12:30:00.000Z',
            end: '2026-09-12T13:30:00.000Z',
          },
        ],
      },
    });
    await expectCode(
      busy.service.preview({
        timeBlockId: busy.block.id,
        startAt: '2026-09-12T12:00:00.000Z',
        endAt: '2026-09-12T13:00:00.000Z',
      }),
      'validation_error',
    );

    const test = fixture();
    const preview = await test.service.preview({
      timeBlockId: test.block.id,
      startAt: '2026-09-12T12:00:00.000Z',
      endAt: '2026-09-12T13:00:00.000Z',
    });
    await expectCode(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 0 },
        {
          operationId: 'agent-op',
          authority: { kind: 'system', reason: 'auto' },
        },
      ),
      'permission_required',
    );
    test.unitOfWork.state.scheduleState = { stateVersion: 1, planRevision: 0 };
    await expectCode(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 0 },
        { operationId: 'stale-op', authority: { kind: 'user' } },
      ),
      'plan_conflict',
    );
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
  });

  it('rolls back the whole plan when a late integration write fails', async () => {
    const test = fixture();
    const preview = await test.service.preview({
      timeBlockId: test.block.id,
      startAt: '2026-09-12T12:00:00.000Z',
      endAt: '2026-09-12T13:00:00.000Z',
    });
    test.unitOfWork.failOn = 'integrationJobs.insert';

    await expect(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 0 },
        { operationId: 'failure-op', authority: { kind: 'user' } },
      ),
    ).rejects.toBeInstanceOf(ApplicationError);
    expect(test.unitOfWork.state.timeBlocks.get(test.block.id)).toEqual(
      test.block,
    );
    expect(test.unitOfWork.state.schedulePlans).toHaveLength(0);
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
  });
});
