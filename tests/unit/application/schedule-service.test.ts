import {
  ApplicationError,
  InMemorySchedulePreviewStore,
  ScheduleService,
  type SchedulingSnapshot,
} from '@workspace/application';
import {
  createTask,
  createTimeBlock,
  freezeTaskBaselineEstimate,
  parseInstant,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  updateTask,
  type IntegrationJob,
  type Task,
  type TimeBlock,
} from '@workspace/domain';
import {
  SCHEDULER_VERSION,
  type SchedulingPolicy,
} from '@workspace/scheduler-core';
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

const CREATED = parseInstant('2026-04-06T08:00:00.000Z');
const NOW = parseInstant('2026-04-06T09:00:00.000Z');
const COMMIT_AT = parseInstant('2026-04-06T09:05:00.000Z');
const EXPIRES_AT = parseInstant('2026-04-06T09:30:00.000Z');
const HORIZON_END = parseInstant('2026-04-06T17:00:00.000Z');

const policy: SchedulingPolicy = {
  policyVersion: 'policy-test-v1',
  schedulerVersion: SCHEDULER_VERSION,
  gridAnchor: '2026-01-01T00:00:00.000Z',
  granularityMinutes: 15,
  defaultMinBlockMinutes: 30,
  defaultMaxBlockMinutes: 60,
  priorityRanks: { low: 1, normal: 2, high: 3 },
  energyMatchScores: [],
  defaultEnergyMatchScore: 0,
  scoreWeights: {
    planStability: 10,
    fragmentation: 1,
    preferredHours: 1,
    completionRate: 1,
    energyMatch: 1,
    recoveryPenalty: 1,
  },
};

function task(
  id = 'task-1',
  overrides: Partial<Parameters<typeof createTask>[0]> = {},
): Task {
  return createTask({
    id: parseTaskId(id),
    title: id,
    priority: 'normal',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'opaque-policy-key',
    source: 'manual',
    createdAt: CREATED,
    ...overrides,
  });
}

function timeBlock(
  id: string,
  taskId: string,
  overrides: Partial<Parameters<typeof createTimeBlock>[0]> = {},
): TimeBlock {
  return createTimeBlock({
    id: parseTimeBlockId(id),
    taskId: parseTaskId(taskId),
    type: 'task',
    startAt: parseInstant('2026-04-06T14:00:00.000Z'),
    endAt: parseInstant('2026-04-06T15:00:00.000Z'),
    status: 'planned',
    source: 'scheduler',
    locked: false,
    planRevision: 0,
    createdAt: CREATED,
    ...overrides,
  });
}

function snapshot(
  overrides: Partial<SchedulingSnapshot> = {},
): SchedulingSnapshot {
  return {
    scheduleState: { stateVersion: 0, planRevision: 0 },
    horizon: { start: NOW, end: HORIZON_END },
    timeZone: parseTimeZoneId('Asia/Shanghai'),
    tasks: [task()],
    timeBlocks: [],
    busy: {
      capturedAt: CREATED,
      completeness: 'complete',
      scopes: [],
      events: [],
    },
    workingWindows: [
      {
        id: 'workday',
        start: '2026-04-06T10:00:00.000Z',
        end: HORIZON_END,
        energyLevel: null,
      },
    ],
    preferredWindows: [],
    userModel: {
      completionRateWindows: [],
      recoveryPenaltyWindows: [],
    },
    policy,
    ...overrides,
  };
}

type FixtureOptions = Readonly<{
  initialSnapshot?: SchedulingSnapshot;
  clock?: SequenceClock;
  expiration?: FixedPreviewExpirationPolicy;
  previewIds?: readonly string[];
}>;

function fixture(options: FixtureOptions = {}) {
  const state = createMemoryState();
  const initialSnapshot = options.initialSnapshot ?? snapshot();
  state.scheduleState = { ...initialSnapshot.scheduleState };
  for (const block of initialSnapshot.timeBlocks) {
    state.timeBlocks.set(block.id, block);
  }
  for (const currentTask of initialSnapshot.tasks) {
    state.tasks.set(currentTask.id, currentTask);
  }
  const unitOfWork = new MemoryUnitOfWork(state);
  const snapshots = new MutableSchedulingSnapshotPort(initialSnapshot);
  const previews = new InMemorySchedulePreviewStore();
  const expiration =
    options.expiration ?? new FixedPreviewExpirationPolicy(EXPIRES_AT);
  const wakeup = new RecordingIntegrationWakeup();
  const previewIds = options.previewIds ?? [
    'preview-1',
    'preview-2',
    'preview-3',
  ];
  const service = new ScheduleService({
    unitOfWork,
    snapshots,
    previews,
    expirationPolicy: expiration,
    clock: options.clock ?? new SequenceClock(NOW, COMMIT_AT),
    ids: {
      preview: new QueueIdGenerator(...previewIds),
      schedulePlan: new QueueIdGenerator('plan-1', 'plan-2'),
      timeBlock: new QueueIdGenerator('block-1', 'block-2', 'block-3'),
      integrationJob: new QueueIdGenerator(
        'calendar-job-1',
        'notification-job-1',
        'calendar-job-2',
        'notification-job-2',
      ),
    },
    integrationWakeup: wakeup,
  });
  return { service, unitOfWork, snapshots, previews, expiration, wakeup };
}

function userContext(operationId = 'operation-1') {
  return { operationId, authority: { kind: 'user' as const } };
}

async function expectApplicationCode(
  promise: Promise<unknown>,
  code: ApplicationError['code'],
): Promise<ApplicationError> {
  try {
    await promise;
    throw new Error(`Expected ApplicationError ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApplicationError);
    expect((error as ApplicationError).code).toBe(code);
    return error as ApplicationError;
  }
}

function committedJobs(
  fixtureValue: ReturnType<typeof fixture>,
): IntegrationJob[] {
  return [...fixtureValue.unitOfWork.state.integrationJobs.values()];
}

describe('ScheduleService preview boundary', () => {
  it('creates an isolated in-memory preview without any local or external write', async () => {
    const test = fixture();
    const preview = await test.service.preview({
      reason: 'initial_plan',
      taskIds: ['task-1'],
    });

    expect(preview).toMatchObject({
      previewId: 'preview-1',
      basedOnStateVersion: 0,
      basedOnPlanRevision: 0,
      schedulerVersion: SCHEDULER_VERSION,
      policyVersion: 'policy-test-v1',
      expiresAt: EXPIRES_AT,
      riskAssessment: {
        autoCommitEligible: false,
        requiresExplicitConfirmation: true,
        changedBlockCount: 1,
      },
    });
    expect(preview.changedBlocks).toEqual([
      expect.objectContaining({
        kind: 'create',
        after: expect.objectContaining({ taskTitle: 'task-1' }),
      }),
    ]);
    expect(test.unitOfWork.calls).toEqual([]);
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
    expect(test.wakeup.operationIds).toEqual([]);
    expect(test.snapshots.requests[0]).toMatchObject({
      reason: 'initial_plan',
      taskIds: ['task-1'],
      now: NOW,
    });
  });

  it('returns only a trusted in-memory preview and rejects an unknown id', async () => {
    const test = fixture();
    const preview = await test.service.preview({ reason: 'review' });

    await expect(test.service.getPreview(preview.previewId)).resolves.toEqual(
      preview,
    );
    await expectApplicationCode(
      test.service.getPreview('missing-preview'),
      'preview_not_found',
    );
  });

  it('keeps all busy and protected block input when taskIds narrows only task focus', async () => {
    const selected = task('selected');
    const other = task('other');
    const protectedBlock = timeBlock('locked-other', 'other', {
      startAt: parseInstant('2026-04-06T12:00:00.000Z'),
      endAt: parseInstant('2026-04-06T13:00:00.000Z'),
      locked: true,
    });
    const test = fixture({
      initialSnapshot: snapshot({
        tasks: [selected, other],
        timeBlocks: [protectedBlock],
        busy: {
          capturedAt: CREATED,
          completeness: 'complete',
          scopes: [],
          events: [
            {
              id: 'busy-morning',
              start: '2026-04-06T10:00:00.000Z',
              end: '2026-04-06T11:00:00.000Z',
            },
          ],
        },
      }),
    });

    const preview = await test.service.preview({
      reason: 'focus',
      taskIds: ['selected'],
    });

    expect(preview.changedBlocks).toContainEqual(
      expect.objectContaining({
        kind: 'create',
        after: expect.objectContaining({
          taskId: 'selected',
          startAt: '2026-04-06T11:00:00.000Z',
        }),
      }),
    );
    expect(preview.changedBlocks).not.toContainEqual(
      expect.objectContaining({ timeBlockId: protectedBlock.id }),
    );
  });

  it('caps an injected TTL at the earliest changed block start', async () => {
    const expiration = new FixedPreviewExpirationPolicy(
      parseInstant('2026-04-06T16:00:00.000Z'),
    );
    const test = fixture({ expiration });

    const preview = await test.service.preview({ reason: 'ttl_cap' });

    expect(preview.expiresAt).toBe('2026-04-06T10:00:00.000Z');
    expect(expiration.contexts[0]).toMatchObject({
      createdAt: NOW,
      earliestChangedBlockStart: '2026-04-06T10:00:00.000Z',
    });
  });

  it('returns a reviewable no-op preview but refuses to commit an empty plan', async () => {
    const noDuration = task('task-1', {
      estimatedDurationMinutes: null,
      remainingDurationMinutes: null,
    });
    const test = fixture({
      initialSnapshot: snapshot({ tasks: [noDuration] }),
    });
    const preview = await test.service.replan({
      reason: 'nothing_schedulable',
    });

    expect(preview.changedBlocks).toEqual([]);
    expect(preview.unscheduled).toContainEqual(
      expect.objectContaining({
        taskId: 'task-1',
        taskTitle: 'task-1',
        reasonCode: 'missing_duration',
      }),
    );
    await expectApplicationCode(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 0 },
        userContext(),
      ),
      'validation_error',
    );
    expect(test.unitOfWork.state.scheduleState).toEqual({
      stateVersion: 0,
      planRevision: 0,
    });
    expect(test.unitOfWork.state.schedulePlans).toHaveLength(0);
    expect(test.unitOfWork.state.integrationJobs).toHaveLength(0);
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
  });

  it('deducts observed actual work and marks exhausted estimates instead of scheduling them twice', async () => {
    const partial: Task = {
      ...task('partial', { estimatedDurationMinutes: 60 }),
      actualDurationMinutes: 20,
    };
    const exact: Task = {
      ...task('exact', { estimatedDurationMinutes: 60 }),
      actualDurationMinutes: 60,
    };
    const over: Task = {
      ...task('over', { estimatedDurationMinutes: 60 }),
      actualDurationMinutes: 75,
    };
    const test = fixture({
      initialSnapshot: snapshot({ tasks: [partial, exact, over] }),
    });

    const preview = await test.service.preview({ reason: 'observed_work' });

    const partialChange = preview.changedBlocks.find(
      (change) => change.after.taskId === 'partial',
    );
    expect(partialChange).toBeDefined();
    expect(
      (Date.parse(partialChange!.after.endAt) -
        Date.parse(partialChange!.after.startAt)) /
        60_000,
    ).toBe(40);
    expect(preview.unscheduled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: 'exact',
          reasonCode: 'remaining_estimate_required',
        }),
        expect.objectContaining({
          taskId: 'over',
          reasonCode: 'remaining_estimate_required',
        }),
      ]),
    );
  });

  it('lets explicit remaining work override an otherwise exhausted estimate', async () => {
    const source: Task = {
      ...task('task-1', {
        estimatedDurationMinutes: 60,
        remainingDurationMinutes: 45,
      }),
      actualDurationMinutes: 75,
    };
    const test = fixture({ initialSnapshot: snapshot({ tasks: [source] }) });

    const preview = await test.service.preview({
      reason: 'explicit_remaining',
    });

    const change = preview.changedBlocks[0];
    expect(change?.after.taskId).toBe('task-1');
    expect(
      (Date.parse(change!.after.endAt) - Date.parse(change!.after.startAt)) /
        60_000,
    ).toBe(45);
  });

  it('normalizes floating subtraction and second-level durations to nearest milliseconds', async () => {
    const floating: Task = {
      ...task('floating', { estimatedDurationMinutes: 0.3 }),
      actualDurationMinutes: 0.1,
    };
    const oneSecond = task('one-second', {
      estimatedDurationMinutes: null,
      remainingDurationMinutes: 1 / 60,
    });
    const subMillisecond = task('sub-millisecond', {
      estimatedDurationMinutes: null,
      remainingDurationMinutes: 0.000_001,
    });
    const test = fixture({
      initialSnapshot: snapshot({
        tasks: [floating, oneSecond, subMillisecond],
        policy: {
          ...policy,
          defaultMinBlockMinutes: 1 / 60_000,
        },
      }),
    });

    const preview = await test.service.preview({
      reason: 'fractional_minutes',
    });
    const durations = new Map(
      preview.changedBlocks.map((change) => [
        change.after.taskId,
        Date.parse(change.after.endAt) - Date.parse(change.after.startAt),
      ]),
    );
    expect(durations.get(parseTaskId('floating'))).toBe(12_000);
    expect(durations.get(parseTaskId('one-second'))).toBe(1_000);
    expect(preview.unscheduled).toContainEqual(
      expect.objectContaining({
        taskId: 'sub-millisecond',
        reasonCode: 'remaining_estimate_required',
      }),
    );
  });

  it('fails safely when a candidate starting exactly now leaves zero commit lifetime', async () => {
    const test = fixture({
      initialSnapshot: snapshot({
        workingWindows: [
          {
            id: 'starts-now',
            start: NOW,
            end: HORIZON_END,
            energyLevel: null,
          },
        ],
      }),
    });

    await expectApplicationCode(
      test.service.preview({ reason: 'zero_lifetime' }),
      'preview_expired',
    );
    expect(test.previews.get('preview-1')).toBeNull();
  });

  it('rejects duplicate generated preview IDs without replacing the first candidate', async () => {
    const test = fixture({
      previewIds: ['same-preview', 'same-preview'],
      clock: new SequenceClock(
        NOW,
        parseInstant('2026-04-06T09:01:00.000Z'),
        COMMIT_AT,
      ),
    });
    const first = await test.service.preview({ reason: 'first' });

    const error = await expectApplicationCode(
      test.service.preview({ reason: 'second' }),
      'adapter_error',
    );
    expect(error.causeCategory).toBe('data_integrity');
    expect(test.previews.get('same-preview')?.request.reason).toBe('first');

    const result = await test.service.commit(
      { previewId: first.previewId, expectedStateVersion: 0 },
      userContext(),
    );
    expect(result.local).toBe('committed');
    expect(test.unitOfWork.state.schedulePlans.get(1)?.reason).toBe('first');
  });

  it('reports a requested Task omitted by the snapshot instead of returning a false no-op', async () => {
    const test = fixture();

    await expectApplicationCode(
      test.service.preview({
        reason: 'missing_focus',
        taskIds: ['does-not-exist'],
      }),
      'not_found',
    );
    expect(test.previews.get('preview-1')).toBeNull();
  });

  it('keeps an unlocked future block outside the adjustment horizon unchanged', async () => {
    const source = task('task-1', { estimatedDurationMinutes: 120 });
    const tomorrow = timeBlock('tomorrow', 'task-1', {
      startAt: parseInstant('2026-04-07T10:00:00.000Z'),
      endAt: parseInstant('2026-04-07T11:00:00.000Z'),
    });
    const test = fixture({
      initialSnapshot: snapshot({ tasks: [source], timeBlocks: [tomorrow] }),
    });

    const preview = await test.service.replan({ reason: 'today_only' });
    expect(preview.changedBlocks).toEqual([
      expect.objectContaining({
        kind: 'create',
        after: expect.objectContaining({ taskId: 'task-1' }),
      }),
    ]);
    expect(preview.changedBlocks).not.toContainEqual(
      expect.objectContaining({ timeBlockId: 'tomorrow' }),
    );
    await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext(),
    );
    expect(test.unitOfWork.state.timeBlocks.get('tomorrow')).toEqual(tomorrow);
  });
});

describe('ScheduleService explicit commit and recovery', () => {
  it('atomically commits blocks, plan, operation, jobs and both versions before wakeup', async () => {
    const test = fixture();
    let durableBeforeWakeup = false;
    test.wakeup.onWake = () => {
      durableBeforeWakeup =
        test.unitOfWork.state.schedulePlans.size === 1 &&
        test.unitOfWork.state.integrationJobs.size === 2;
    };
    const preview = await test.service.preview({ reason: 'initial_plan' });
    const result = await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext(),
    );

    expect(result).toEqual({
      operationId: 'operation-1',
      local: 'committed',
      planRevision: 1,
      stateVersion: 1,
      calendar: 'pending',
      notifications: 'pending',
    });
    expect(test.unitOfWork.state.scheduleState).toEqual({
      stateVersion: 1,
      planRevision: 1,
    });
    expect(test.unitOfWork.state.timeBlocks.get('block-1')).toMatchObject({
      taskId: 'task-1',
      planRevision: 1,
      startAt: '2026-04-06T10:00:00.000Z',
    });
    expect(test.unitOfWork.state.tasks.get('task-1')).toMatchObject({
      status: 'planned',
      baselineEstimatedDurationMinutes: 60,
      updatedAt: COMMIT_AT,
    });
    expect(test.unitOfWork.state.schedulePlans.get(1)).toMatchObject({
      id: 'plan-1',
      basedOnStateVersion: 0,
      status: 'committed',
      schedulerVersion: SCHEDULER_VERSION,
      policyVersion: 'policy-test-v1',
    });
    expect(committedJobs(test)).toEqual([
      expect.objectContaining({
        targetChannel: 'calendar',
        desiredRevision: 1,
        status: 'pending',
      }),
      expect.objectContaining({
        targetChannel: 'notification',
        desiredRevision: 1,
        status: 'pending',
      }),
    ]);
    expect(test.unitOfWork.calls).toEqual([
      'operationRecords.insert',
      'schedulePlans.insert',
      'timeBlocks.insert',
      'tasks.update',
      'integrationJobs.insert',
      'integrationJobs.insert',
      'scheduleState.update',
    ]);
    const operation = test.unitOfWork.state.operationRecords.get('operation-1');
    expect(JSON.parse(operation?.diffJson ?? '{}')).toMatchObject({
      taskTransitions: [
        {
          before: {
            status: 'inbox',
            baselineEstimatedDurationMinutes: null,
          },
          after: {
            status: 'planned',
            baselineEstimatedDurationMinutes: 60,
          },
        },
      ],
    });
    expect(durableBeforeWakeup).toBe(true);
    expect(test.wakeup.operationIds).toEqual(['operation-1']);
  });

  it('preserves a previously frozen estimate when the first plan is committed', async () => {
    const frozen = freezeTaskBaselineEstimate(
      task('task-1', { estimatedDurationMinutes: 45 }),
      CREATED,
    );
    const reestimated = updateTask(
      frozen,
      { estimatedDurationMinutes: 60 },
      CREATED,
    );
    const test = fixture({
      initialSnapshot: snapshot({ tasks: [reestimated] }),
    });

    const preview = await test.service.preview({ reason: 'frozen_baseline' });
    await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext(),
    );

    expect(test.unitOfWork.state.tasks.get('task-1')).toMatchObject({
      status: 'planned',
      estimatedDurationMinutes: 60,
      baselineEstimatedDurationMinutes: 45,
    });
  });

  it('replays the original local result after preview loss and aggregates current job status', async () => {
    const test = fixture();
    const preview = await test.service.preview({ reason: 'recover' });
    const input = { previewId: preview.previewId, expectedStateVersion: 0 };
    await test.service.commit(input, userContext('recover-op'));
    test.previews.clear();
    for (const [id, job] of test.unitOfWork.state.integrationJobs) {
      const status =
        job.targetChannel === 'calendar'
          ? ('succeeded' as const)
          : ('permission_required' as const);
      test.unitOfWork.state.integrationJobs.set(id, { ...job, status });
    }

    const replay = await test.service.commit(input, userContext('recover-op'));

    expect(replay).toEqual({
      operationId: 'recover-op',
      local: 'committed',
      planRevision: 1,
      stateVersion: 1,
      calendar: 'synced',
      notifications: 'permission_required',
    });
    expect(
      test.unitOfWork.calls.filter((call) => call === 'timeBlocks.insert'),
    ).toHaveLength(1);
    expect(
      test.unitOfWork.calls.filter((call) => call === 'tasks.update'),
    ).toHaveLength(1);
    expect(test.wakeup.operationIds).toEqual(['recover-op']);

    for (const [id, job] of test.unitOfWork.state.integrationJobs) {
      test.unitOfWork.state.integrationJobs.set(id, {
        ...job,
        status:
          job.targetChannel === 'calendar'
            ? 'superseded'
            : 'reconciliation_required',
        lastErrorCode:
          job.targetChannel === 'calendar' ? null : 'external_unknown',
        automaticRetryEligible: false,
      });
    }
    await expect(
      test.service.commit(input, userContext('recover-op')),
    ).resolves.toMatchObject({
      calendar: 'superseded',
      notifications: 'reconciliation_required',
    });
    expect(test.wakeup.operationIds).toEqual(['recover-op']);
  });

  it('rejects reuse of a committed operation ID with different input', async () => {
    const test = fixture();
    const preview = await test.service.preview({ reason: 'idempotency' });
    await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext('same-op'),
    );

    await expectApplicationCode(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 1 },
        userContext('same-op'),
      ),
      'idempotency_conflict',
    );
  });

  it('does not trust mutations made to the returned JavaScript preview object', async () => {
    const test = fixture();
    const preview = await test.service.preview({ reason: 'untrusted_ui' });
    const externallyMutable = preview as unknown as {
      changedBlocks: {
        after: { startAt: string; endAt: string };
      }[];
    };
    externallyMutable.changedBlocks[0]!.after.startAt =
      '2026-04-06T16:00:00.000Z';
    externallyMutable.changedBlocks[0]!.after.endAt =
      '2026-04-06T17:00:00.000Z';

    await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext(),
    );

    expect(test.unitOfWork.state.timeBlocks.get('block-1')).toMatchObject({
      startAt: '2026-04-06T10:00:00.000Z',
      endAt: '2026-04-06T11:00:00.000Z',
    });
  });

  it('keeps the local commit successful when best-effort wakeup fails', async () => {
    const test = fixture();
    test.wakeup.fail = true;
    const preview = await test.service.preview({ reason: 'offline' });

    const result = await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext(),
    );

    expect(result.local).toBe('committed');
    expect(result.calendar).toBe('pending');
    expect(test.unitOfWork.state.integrationJobs).toHaveLength(2);
  });
});

describe('ScheduleService stale, authority and atomicity guards', () => {
  it('requires direct user confirmation and keeps previews non-auto-committable', async () => {
    const test = fixture();
    const preview = await test.service.preview({ reason: 'confirm' });

    await expectApplicationCode(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 0 },
        {
          operationId: 'agent-op',
          authority: {
            kind: 'agent_authorized',
            authorizationId: 'generic-grant',
          },
        },
      ),
      'permission_required',
    );
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
  });

  it('rejects an expired preview and a missing preview without local writes', async () => {
    const test = fixture({
      clock: new SequenceClock(NOW, parseInstant('2026-04-06T09:30:00.000Z')),
    });
    const preview = await test.service.preview({ reason: 'expiry' });
    await expectApplicationCode(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 0 },
        userContext('expired-op'),
      ),
      'preview_expired',
    );
    await expectApplicationCode(
      test.service.commit(
        { previewId: 'lost-after-restart', expectedStateVersion: 0 },
        userContext('missing-op'),
      ),
      'preview_not_found',
    );
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
    expect(test.unitOfWork.state.timeBlocks).toHaveLength(0);
  });

  it('does not report a conflict when semantically unordered snapshot sets are merely reordered', async () => {
    const first = task('task-a', { estimatedDurationMinutes: 30 });
    const second = task('task-b', { estimatedDurationMinutes: 30 });
    const initial = snapshot({
      tasks: [second, first],
      busy: {
        capturedAt: CREATED,
        completeness: 'complete',
        scopes: [],
        events: [
          {
            id: 'busy-b',
            start: '2026-04-06T15:00:00.000Z',
            end: '2026-04-06T15:15:00.000Z',
          },
          {
            id: 'busy-a',
            start: '2026-04-06T16:00:00.000Z',
            end: '2026-04-06T16:15:00.000Z',
          },
        ],
      },
      workingWindows: [
        {
          id: 'afternoon',
          start: '2026-04-06T13:00:00.000Z',
          end: HORIZON_END,
          energyLevel: null,
        },
        {
          id: 'morning',
          start: '2026-04-06T10:00:00.000Z',
          end: '2026-04-06T13:00:00.000Z',
          energyLevel: null,
        },
      ],
      preferredWindows: [
        {
          id: 'preferred-b',
          start: '2026-04-06T14:00:00.000Z',
          end: '2026-04-06T15:00:00.000Z',
          score: 1,
        },
        {
          id: 'preferred-a',
          start: '2026-04-06T10:00:00.000Z',
          end: '2026-04-06T11:00:00.000Z',
          score: 1,
        },
      ],
      userModel: {
        completionRateWindows: [
          {
            id: 'completion-b',
            start: '2026-04-06T14:00:00.000Z',
            end: '2026-04-06T15:00:00.000Z',
            score: 1,
          },
          {
            id: 'completion-a',
            start: '2026-04-06T10:00:00.000Z',
            end: '2026-04-06T11:00:00.000Z',
            score: 1,
          },
        ],
        recoveryPenaltyWindows: [
          {
            id: 'recovery-b',
            start: '2026-04-06T16:00:00.000Z',
            end: '2026-04-06T17:00:00.000Z',
            score: 1,
          },
          {
            id: 'recovery-a',
            start: '2026-04-06T12:00:00.000Z',
            end: '2026-04-06T13:00:00.000Z',
            score: 1,
          },
        ],
      },
      policy: {
        ...policy,
        energyMatchScores: [
          { demand: 'high', supply: 'low', score: -1 },
          { demand: 'high', supply: 'high', score: 1 },
        ],
      },
    });
    const test = fixture({ initialSnapshot: initial });
    const preview = await test.service.preview({ reason: 'reordered_sets' });
    test.snapshots.snapshot = {
      ...initial,
      tasks: [...initial.tasks].reverse(),
      busy: { ...initial.busy, events: [...initial.busy.events].reverse() },
      workingWindows: [...initial.workingWindows].reverse(),
      preferredWindows: [...initial.preferredWindows].reverse(),
      userModel: {
        completionRateWindows: [
          ...initial.userModel.completionRateWindows,
        ].reverse(),
        recoveryPenaltyWindows: [
          ...initial.userModel.recoveryPenaltyWindows,
        ].reverse(),
      },
      policy: {
        ...initial.policy,
        energyMatchScores: [...initial.policy.energyMatchScores].reverse(),
      },
    };

    const result = await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext(),
    );

    expect(result.local).toBe('committed');
    expect(result.planRevision).toBe(1);
  });

  it.each([
    [
      'stateVersion',
      (source: SchedulingSnapshot) => ({
        ...source,
        scheduleState: { stateVersion: 1, planRevision: 0 },
      }),
    ],
    [
      'planRevision',
      (source: SchedulingSnapshot) => ({
        ...source,
        scheduleState: { stateVersion: 0, planRevision: 1 },
      }),
    ],
    [
      'policyVersion',
      (source: SchedulingSnapshot) => ({
        ...source,
        policy: { ...source.policy, policyVersion: 'policy-test-v2' },
      }),
    ],
    [
      'timeZone',
      (source: SchedulingSnapshot) => ({
        ...source,
        timeZone: parseTimeZoneId('UTC'),
      }),
    ],
    [
      'material input hash',
      (source: SchedulingSnapshot) => ({
        ...source,
        busy: {
          ...source.busy,
          events: [
            {
              id: 'new-input',
              start: '2026-04-06T15:00:00.000Z',
              end: '2026-04-06T15:30:00.000Z',
            },
          ],
        },
      }),
    ],
  ] as const)(
    'rejects commit after %s changes',
    async (_label, mutateSnapshot) => {
      const test = fixture();
      const preview = await test.service.preview({ reason: 'stale' });
      test.snapshots.snapshot = mutateSnapshot(test.snapshots.snapshot);

      await expectApplicationCode(
        test.service.commit(
          { previewId: preview.previewId, expectedStateVersion: 0 },
          userContext(),
        ),
        'plan_conflict',
      );
      expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
    },
  );

  it('rejects commit when the trusted Task row changes without a schedule-version advance', async () => {
    const test = fixture();
    const preview = await test.service.preview({ reason: 'task_row_conflict' });
    const current = test.unitOfWork.state.tasks.get('task-1');
    expect(current).toBeDefined();
    test.unitOfWork.state.tasks.set(
      'task-1',
      updateTask(
        current!,
        { title: 'changed outside the scheduling snapshot' },
        parseInstant('2026-04-06T09:02:00.000Z'),
      ),
    );

    await expectApplicationCode(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 0 },
        userContext(),
      ),
      'plan_conflict',
    );
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
    expect(test.unitOfWork.state.schedulePlans).toHaveLength(0);
    expect(test.unitOfWork.state.timeBlocks).toHaveLength(0);
    expect(test.unitOfWork.state.tasks.get('task-1')).toMatchObject({
      status: 'inbox',
      baselineEstimatedDurationMinutes: null,
      title: 'changed outside the scheduling snapshot',
    });
  });

  it('rolls back OperationRecord, Plan, Block, Jobs and versions after a late failure', async () => {
    const test = fixture();
    const preview = await test.service.preview({ reason: 'rollback' });
    test.unitOfWork.failOn = 'integrationJobs.insert';

    await expectApplicationCode(
      test.service.commit(
        { previewId: preview.previewId, expectedStateVersion: 0 },
        userContext(),
      ),
      'adapter_error',
    );
    expect(test.unitOfWork.state.operationRecords).toHaveLength(0);
    expect(test.unitOfWork.state.schedulePlans).toHaveLength(0);
    expect(test.unitOfWork.state.timeBlocks).toHaveLength(0);
    expect(test.unitOfWork.state.integrationJobs).toHaveLength(0);
    expect(test.unitOfWork.state.tasks.get('task-1')).toMatchObject({
      status: 'inbox',
      baselineEstimatedDurationMinutes: null,
    });
    expect(test.unitOfWork.state.scheduleState).toEqual({
      stateVersion: 0,
      planRevision: 0,
    });
    expect(test.wakeup.operationIds).toEqual([]);
  });
});

describe('ScheduleService create/update/cancel diff semantics', () => {
  it('moves only a future unlocked planned block when constraints require it', async () => {
    const constrainedTask = task('task-1', {
      deadlineAt: parseInstant('2026-04-06T12:00:00.000Z'),
    });
    const old = timeBlock('existing', 'task-1');
    const test = fixture({
      initialSnapshot: snapshot({
        tasks: [constrainedTask],
        timeBlocks: [old],
      }),
    });

    const preview = await test.service.replan({ reason: 'deadline' });
    expect(preview.changedBlocks).toEqual([
      expect.objectContaining({
        kind: 'update',
        timeBlockId: 'existing',
        before: expect.objectContaining({
          startAt: '2026-04-06T14:00:00.000Z',
        }),
        after: expect.objectContaining({
          startAt: '2026-04-06T10:00:00.000Z',
        }),
      }),
    ]);
    await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext(),
    );
    expect(test.unitOfWork.state.timeBlocks.get('existing')).toMatchObject({
      startAt: '2026-04-06T10:00:00.000Z',
      planRevision: 1,
    });
  });

  it('cancels only omitted future unlocked planned blocks and preserves facts/history', async () => {
    const unknown = task('task-1', {
      estimatedDurationMinutes: null,
      remainingDurationMinutes: null,
    });
    const removable = timeBlock('removable', 'task-1');
    const locked = timeBlock('locked', 'task-1', { locked: true });
    const started = timeBlock('started', 'task-1', {
      startAt: parseInstant('2026-04-06T08:30:00.000Z'),
      endAt: parseInstant('2026-04-06T09:30:00.000Z'),
      status: 'started',
    });
    const completed = timeBlock('completed', 'task-1', {
      startAt: parseInstant('2026-04-06T07:00:00.000Z'),
      endAt: parseInstant('2026-04-06T08:00:00.000Z'),
      status: 'completed',
    });
    const skipped = timeBlock('skipped', 'task-1', { status: 'skipped' });
    const test = fixture({
      initialSnapshot: snapshot({
        tasks: [unknown],
        timeBlocks: [removable, locked, started, completed, skipped],
      }),
    });

    const preview = await test.service.replan({ reason: 'unknown_duration' });
    expect(preview.changedBlocks).toEqual([
      expect.objectContaining({
        kind: 'cancel',
        timeBlockId: 'removable',
      }),
    ]);
    await test.service.commit(
      { previewId: preview.previewId, expectedStateVersion: 0 },
      userContext(),
    );

    expect(test.unitOfWork.state.timeBlocks.get('removable')?.status).toBe(
      'canceled',
    );
    expect(test.unitOfWork.state.timeBlocks.get('locked')).toEqual(locked);
    expect(test.unitOfWork.state.timeBlocks.get('started')).toEqual(started);
    expect(test.unitOfWork.state.timeBlocks.get('completed')).toEqual(
      completed,
    );
    expect(test.unitOfWork.state.timeBlocks.get('skipped')).toEqual(skipped);
  });
});
