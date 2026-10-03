import {
  completeTask,
  createCommittedSchedulePlan,
  createExecutionInterval,
  createExecutionSession,
  createTask,
  createTimeBlock,
  markTaskPlanned,
  parseExecutionIntervalId,
  parseExecutionSessionId,
  parseInstant,
  parseLocalDate,
  parseProjectId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  startTask,
} from '@workspace/domain';
import {
  ExecutionService,
  TaskService,
  type TaskServiceDependencies,
  type WriteContext,
} from '@workspace/application';
import { describe, expect, it } from 'vitest';

import {
  FixedLocalTimeProvider,
  MemoryUnitOfWork,
  QueueIdGenerator,
  SequenceClock,
} from './fakes';

const FIRST_INSTANT = parseInstant('2026-09-12T02:00:00.000Z');
const SECOND_INSTANT = parseInstant('2026-09-12T03:00:00.000Z');
const THIRD_INSTANT = parseInstant('2026-09-12T04:00:00.000Z');
const FOURTH_INSTANT = parseInstant('2026-09-12T05:00:00.000Z');
const FIFTH_INSTANT = parseInstant('2026-09-12T06:00:00.000Z');
const LOCAL_DATE = parseLocalDate('2026-09-12');
const TIME_ZONE = parseTimeZoneId('Asia/Shanghai');

function context(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

function createService(
  unitOfWork: MemoryUnitOfWork,
  ids: string[],
  instants = [FIRST_INSTANT, SECOND_INSTANT, THIRD_INSTANT],
): TaskService {
  const dependencies: TaskServiceDependencies = {
    unitOfWork,
    clock: new SequenceClock(...instants),
    localTimeProvider: new FixedLocalTimeProvider(LOCAL_DATE, TIME_ZONE),
    idGenerator: new QueueIdGenerator(...ids),
  };
  return new TaskService(dependencies);
}

function seedCancelableExecution(unitOfWork: MemoryUnitOfWork): void {
  const task = startTask(
    markTaskPlanned(
      createTask({
        id: parseTaskId('task-cancel'),
        title: 'Cancel the whole task',
        priority: 'normal',
        estimatedDurationMinutes: 180,
        remainingDurationMinutes: 180,
        splittable: true,
        schedulingPolicy: 'flexible',
        source: 'manual',
        createdAt: FIRST_INSTANT,
      }),
      FIRST_INSTANT,
    ),
    SECOND_INSTANT,
  );
  const startedBlock = createTimeBlock({
    id: parseTimeBlockId('block-started'),
    taskId: task.id,
    type: 'task',
    startAt: SECOND_INSTANT,
    endAt: FOURTH_INSTANT,
    status: 'started',
    source: 'scheduler',
    locked: false,
    planRevision: 1,
    createdAt: FIRST_INSTANT,
    updatedAt: SECOND_INSTANT,
  });
  const plannedBlock = createTimeBlock({
    id: parseTimeBlockId('block-planned'),
    taskId: task.id,
    type: 'task',
    startAt: FOURTH_INSTANT,
    endAt: FIFTH_INSTANT,
    status: 'planned',
    source: 'scheduler',
    locked: false,
    planRevision: 1,
    createdAt: FIRST_INSTANT,
  });
  const session = createExecutionSession({
    id: parseExecutionSessionId('session-cancel'),
    taskId: task.id,
    timeBlockId: startedBlock.id,
    startedAt: SECOND_INSTANT,
  });
  const interval = createExecutionInterval({
    id: parseExecutionIntervalId('interval-cancel'),
    sessionId: session.id,
    kind: 'work',
    startAt: SECOND_INSTANT,
  });
  unitOfWork.state.tasks.set(task.id, task);
  unitOfWork.state.timeBlocks.set(startedBlock.id, startedBlock);
  unitOfWork.state.timeBlocks.set(plannedBlock.id, plannedBlock);
  unitOfWork.state.executionSessions.set(session.id, session);
  unitOfWork.state.executionIntervals.set(interval.id, interval);
  unitOfWork.state.schedulePlans.set(
    1,
    createCommittedSchedulePlan({
      id: parseSchedulePlanId('plan-1'),
      planRevision: 1,
      basedOnStateVersion: 6,
      createdAt: FIRST_INSTANT,
      committedAt: FIRST_INSTANT,
      inputHash: 'seed-cancel',
      schedulerVersion: 'test',
      policyVersion: 'test',
      timeZone: TIME_ZONE,
      horizonStart: FIRST_INSTANT,
      horizonEnd: FIFTH_INSTANT,
      reason: 'test_seed',
    }),
  );
  unitOfWork.state.scheduleState = { stateVersion: 7, planRevision: 1 };
}

describe('TaskService', () => {
  it('cancels an inbox Task without inventing completion evidence or integration work', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(
      unitOfWork,
      ['task-1', 'activity-create', 'activity-cancel'],
      [FIRST_INSTANT, SECOND_INSTANT],
    );
    const created = await service.create(
      { title: 'Discard this inbox item' },
      context('operation-create'),
    );

    const canceled = await service.cancel(
      { taskId: created.task.id },
      context('operation-cancel'),
    );
    const replayed = await service.cancel(
      { taskId: created.task.id },
      context('operation-cancel'),
    );

    expect(canceled).toMatchObject({
      task: {
        id: 'task-1',
        status: 'canceled',
        canceledAt: SECOND_INSTANT,
        completedAt: null,
      },
      stateVersion: 2,
      planRevision: 0,
      calendar: 'synced',
      notifications: 'synced',
    });
    expect(replayed).toEqual(canceled);
    expect(unitOfWork.state.completionRecords.size).toBe(0);
    expect(unitOfWork.state.achievements.size).toBe(0);
    expect(unitOfWork.state.integrationJobs.size).toBe(0);
    expect(unitOfWork.state.taskActivityEvents.at(-1)).toMatchObject({
      taskId: 'task-1',
      eventType: 'cancel',
      beforeSummary: { status: 'inbox' },
      afterSummary: { status: 'canceled' },
    });
  });

  it('atomically abandons active execution, cancels unfinished blocks, and queues projection cleanup', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    seedCancelableExecution(unitOfWork);
    const wakes: string[] = [];
    const service = new TaskService({
      unitOfWork,
      clock: new SequenceClock(THIRD_INSTANT),
      localTimeProvider: new FixedLocalTimeProvider(LOCAL_DATE, TIME_ZONE),
      idGenerator: new QueueIdGenerator(
        'plan-2',
        'job-calendar',
        'job-notification',
        'activity-cancel',
      ),
      integrationWakeup: {
        wake: (operationId) => {
          wakes.push(operationId);
          return Promise.resolve();
        },
      },
    });

    const result = await service.cancel(
      { taskId: 'task-cancel' },
      context('operation-cancel'),
    );

    expect(result).toMatchObject({
      task: { status: 'canceled', canceledAt: THIRD_INSTANT },
      stateVersion: 8,
      planRevision: 2,
      calendar: 'pending',
      notifications: 'pending',
    });
    expect(
      unitOfWork.state.executionSessions.get('session-cancel'),
    ).toMatchObject({
      status: 'abandoned',
      endedAt: THIRD_INSTANT,
      completionType: null,
    });
    expect(
      unitOfWork.state.executionIntervals.get('interval-cancel'),
    ).toMatchObject({ endAt: THIRD_INSTANT, timingQuality: 'trusted' });
    expect(
      [...unitOfWork.state.timeBlocks.values()].map((block) => ({
        id: block.id,
        status: block.status,
        planRevision: block.planRevision,
      })),
    ).toEqual([
      { id: 'block-started', status: 'canceled', planRevision: 2 },
      { id: 'block-planned', status: 'canceled', planRevision: 2 },
    ]);
    expect(unitOfWork.state.schedulePlans.get(2)).toMatchObject({
      id: 'plan-2',
      reason: 'task_cancel',
      basedOnStateVersion: 7,
    });
    expect(
      [...unitOfWork.state.integrationJobs.values()].map((job) => ({
        channel: job.targetChannel,
        desiredRevision: job.desiredRevision,
        status: job.status,
      })),
    ).toEqual([
      { channel: 'calendar', desiredRevision: 2, status: 'pending' },
      { channel: 'notification', desiredRevision: 2, status: 'pending' },
    ]);
    expect(unitOfWork.state.completionRecords.size).toBe(0);
    expect(unitOfWork.state.achievements.size).toBe(0);
    expect(wakes).toEqual(['operation-cancel']);
  });

  it('rolls back the complete cancellation transaction when projection cleanup cannot be queued', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    seedCancelableExecution(unitOfWork);
    unitOfWork.failOn = 'integrationJobs.insert';
    const service = new TaskService({
      unitOfWork,
      clock: new SequenceClock(THIRD_INSTANT),
      localTimeProvider: new FixedLocalTimeProvider(LOCAL_DATE, TIME_ZONE),
      idGenerator: new QueueIdGenerator(
        'plan-2',
        'job-calendar',
        'job-notification',
        'activity-cancel',
      ),
    });

    await expect(
      service.cancel({ taskId: 'task-cancel' }, context('operation-cancel')),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      causeCategory: 'local_storage',
    });

    expect(unitOfWork.state.tasks.get('task-cancel')).toMatchObject({
      status: 'in_progress',
      canceledAt: null,
    });
    expect(
      unitOfWork.state.executionSessions.get('session-cancel'),
    ).toMatchObject({ status: 'running', endedAt: null });
    expect(
      unitOfWork.state.executionIntervals.get('interval-cancel'),
    ).toMatchObject({ endAt: null });
    expect(unitOfWork.state.timeBlocks.get('block-started')).toMatchObject({
      status: 'started',
      planRevision: 1,
    });
    expect(unitOfWork.state.timeBlocks.get('block-planned')).toMatchObject({
      status: 'planned',
      planRevision: 1,
    });
    expect(unitOfWork.state.scheduleState).toEqual({
      stateVersion: 7,
      planRevision: 1,
    });
    expect(unitOfWork.state.schedulePlans.has(2)).toBe(false);
    expect(unitOfWork.state.integrationJobs.size).toBe(0);
    expect(unitOfWork.state.operationRecords.has('operation-cancel')).toBe(
      false,
    );
  });

  it('lists Task facts with bounded stable pagination and scheduling-window filters', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const first = createTask({
      id: parseTaskId('task-1'),
      projectId: parseProjectId('project-1'),
      title: 'First',
      priority: 'normal',
      earliestStartAt: FIRST_INSTANT,
      deadlineAt: THIRD_INSTANT,
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: FIRST_INSTANT,
    });
    const second = createTask({
      id: parseTaskId('task-2'),
      projectId: parseProjectId('project-1'),
      title: 'Second',
      priority: 'normal',
      earliestStartAt: THIRD_INSTANT,
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: SECOND_INSTANT,
    });
    const completed = completeTask(
      createTask({
        id: parseTaskId('task-3'),
        title: 'Completed',
        priority: 'normal',
        splittable: false,
        schedulingPolicy: 'flexible',
        source: 'manual',
        createdAt: THIRD_INSTANT,
      }),
      { completedAt: THIRD_INSTANT },
    );
    for (const task of [first, second, completed]) {
      unitOfWork.state.tasks.set(task.id, task);
    }
    const service = createService(unitOfWork, []);

    const page1 = await service.list({ projectId: 'project-1', limit: 1 });
    const page2 = await service.list({
      projectId: 'project-1',
      cursor: page1.nextCursor!,
      limit: 1,
    });
    expect(page1.items.map((task) => task.id)).toEqual(['task-1']);
    expect(page1.nextCursor).toBe('task-1');
    expect(page2.items.map((task) => task.id)).toEqual(['task-2']);
    expect(page2.nextCursor).toBeNull();
    await expect(
      service.list({ projectId: 'project-1', cursor: 'task-3' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(service.list({ status: 'completed' })).resolves.toMatchObject({
      items: [{ id: 'task-3' }],
    });
    await expect(
      service.list({
        projectId: 'project-1',
        timeRange: {
          start: SECOND_INSTANT,
          end: THIRD_INSTANT,
        },
      }),
    ).resolves.toMatchObject({ items: [{ id: 'task-1' }] });
  });

  it('creates an inbox Task with neutral defaults and atomic activity/version facts', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, ['task-1', 'activity-1']);

    const result = await service.create(
      { title: 'Write proposal' },
      context('operation-create'),
    );

    expect(result).toMatchObject({
      task: {
        id: 'task-1',
        title: 'Write proposal',
        status: 'inbox',
        priority: 'normal',
        splittable: false,
        schedulingPolicy: 'flexible',
        estimatedDurationMinutes: null,
        actualDurationMinutes: null,
      },
      stateVersion: 1,
      planRevision: 0,
    });
    expect(unitOfWork.state.taskActivityEvents).toHaveLength(1);
    expect(unitOfWork.state.taskActivityEvents[0]).toMatchObject({
      taskId: 'task-1',
      eventType: 'create',
      actor: 'user',
      localDate: LOCAL_DATE,
      timeZone: TIME_ZONE,
      operationId: 'operation-create',
    });
    expect(unitOfWork.calls).toEqual([
      'operationRecords.insert',
      'tasks.insert',
      'taskActivityEvents.insert',
      'scheduleState.update',
    ]);
  });

  it('replays the exact original create result after a later update', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'task-1',
      'activity-create',
      'activity-update',
    ]);
    const createInput = { title: 'Original title' } as const;

    const created = await service.create(
      createInput,
      context('operation-create'),
    );
    const updated = await service.update(
      { taskId: created.task.id, patch: { title: 'Later title' } },
      context('operation-update'),
    );
    const replayed = await service.create(
      createInput,
      context('operation-create'),
    );

    expect(updated.task.title).toBe('Later title');
    expect(unitOfWork.state.tasks.get('task-1')?.title).toBe('Later title');
    expect(replayed).toEqual(created);
    expect(replayed.task.title).toBe('Original title');
    expect(replayed.stateVersion).toBe(1);
    expect(unitOfWork.state.tasks.get('task-1')?.title).toBe('Later title');
    expect(unitOfWork.state.operationRecords.size).toBe(2);
  });

  it('rejects operation ID reuse with changed input', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, ['task-1', 'activity-1']);
    await service.create({ title: 'First' }, context('same-operation'));

    await expect(
      service.create({ title: 'Different' }, context('same-operation')),
    ).rejects.toMatchObject({
      code: 'idempotency_conflict',
      retryable: false,
      operationId: 'same-operation',
    });
    expect(unitOfWork.state.tasks.size).toBe(1);
  });

  it('rejects protected status patches and preserves the transaction', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, ['task-1', 'activity-1']);
    const created = await service.create(
      { title: 'Protected' },
      context('operation-create'),
    );

    await expect(
      service.update(
        {
          taskId: created.task.id,
          patch: { status: 'completed' },
        } as never,
        context('operation-illegal-update'),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
    expect(unitOfWork.state.tasks.get('task-1')?.status).toBe('inbox');
    expect(
      unitOfWork.state.operationRecords.has('operation-illegal-update'),
    ).toBe(false);
    expect(unitOfWork.state.operationRecords.size).toBe(1);
  });

  it('rejects invalid duration/deadline constraints without a partial create', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, ['unused-task']);

    await expect(
      service.create(
        { title: 'Bad duration', estimatedDurationMinutes: 0 },
        context('operation-duration'),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      service.create(
        {
          title: 'Bad deadline',
          earliestStartAt: '2026-09-13T02:00:00.000Z',
          deadlineAt: '2026-09-12T02:00:00.000Z',
        },
        context('operation-deadline'),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });

    expect(unitOfWork.state.tasks.size).toBe(0);
    expect(unitOfWork.state.operationRecords.size).toBe(0);
    expect(unitOfWork.state.scheduleState?.stateVersion).toBe(0);
  });

  it('increments stateVersion only when scheduling facts actually change', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'task-1',
      'activity-create',
      'activity-noop',
      'activity-change',
    ]);
    const created = await service.create(
      { title: 'Versioned' },
      context('operation-create'),
    );

    const noOp = await service.update(
      { taskId: created.task.id, patch: { priority: 'normal' } },
      context('operation-noop'),
    );
    const changed = await service.update(
      { taskId: created.task.id, patch: { priority: 'high' } },
      context('operation-change'),
    );

    expect(noOp.stateVersion).toBe(1);
    expect(changed.stateVersion).toBe(2);
    expect(unitOfWork.state.scheduleState?.stateVersion).toBe(2);
  });

  it('rejects a parent cycle without committing a partial update', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'parent',
      'activity-parent',
      'child',
      'activity-child',
    ]);
    const parent = await service.create(
      { title: 'Parent' },
      context('operation-parent'),
    );
    const child = await service.create(
      { title: 'Child', parentTaskId: parent.task.id },
      context('operation-child'),
    );

    await expect(
      service.update(
        {
          taskId: parent.task.id,
          patch: { parentTaskId: child.task.id },
        },
        context('operation-cycle'),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
    expect(unitOfWork.state.tasks.get('parent')?.parentTaskId).toBeNull();
    expect(unitOfWork.state.operationRecords.has('operation-cycle')).toBe(
      false,
    );
    expect(unitOfWork.state.scheduleState?.stateVersion).toBe(2);
  });

  it('completes once with unknown duration and writes FK parents first', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'task-1',
      'activity-create',
      'completion-1',
      'activity-complete',
    ]);
    const created = await service.create(
      { title: 'Finish me' },
      context('operation-create'),
    );
    unitOfWork.calls.length = 0;

    const completed = await service.complete(
      { taskId: created.task.id },
      context('operation-complete'),
    );
    const replayed = await service.complete(
      { taskId: created.task.id },
      context('operation-complete'),
    );

    expect(completed).toMatchObject({
      task: { status: 'completed', completedAt: SECOND_INSTANT },
      completionRecord: {
        id: 'completion-1',
        taskId: 'task-1',
        actualDurationSeconds: null,
        durationCoverage: 'unknown',
        achievementDisposition: 'skip',
        source: 'user',
      },
      stateVersion: 2,
      planRevision: 0,
    });
    expect(replayed).toEqual(completed);
    expect(unitOfWork.state.completionRecords.size).toBe(1);
    expect(unitOfWork.calls).toEqual([
      'operationRecords.insert',
      'tasks.update',
      'completionRecords.insert',
      'taskActivityEvents.insert',
      'scheduleState.update',
    ]);

    const repeatedWithNewOperation = await service.complete(
      { taskId: created.task.id },
      context('operation-complete-again'),
    );
    const replayedNewOperation = await service.complete(
      { taskId: created.task.id },
      context('operation-complete-again'),
    );
    expect(repeatedWithNewOperation).toMatchObject({
      operationId: 'operation-complete-again',
      completionRecord: {
        id: 'completion-1',
        operationId: 'operation-complete',
      },
      stateVersion: 2,
    });
    expect(replayedNewOperation).toEqual(repeatedWithNewOperation);
    expect(unitOfWork.state.completionRecords.size).toBe(1);
  });

  it('rolls back Task and OperationRecord when completion evidence fails', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'task-1',
      'activity-create',
      'completion-1',
      'activity-complete',
    ]);
    const created = await service.create(
      { title: 'Atomic completion' },
      context('operation-create'),
    );
    unitOfWork.failOn = 'completionRecords.insert';

    await expect(
      service.complete(
        { taskId: created.task.id },
        context('operation-complete'),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      retryable: true,
      causeCategory: 'local_storage',
    });
    expect(unitOfWork.state.tasks.get('task-1')?.status).toBe('inbox');
    expect(unitOfWork.state.completionRecords.size).toBe(0);
    expect(unitOfWork.state.operationRecords.has('operation-complete')).toBe(
      false,
    );
    expect(unitOfWork.state.scheduleState?.stateVersion).toBe(1);
  });

  it('records complete duration coverage only from an explicit user confirmation', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'task-user',
      'activity-create-user',
      'completion-user',
      'activity-complete-user',
    ]);
    const created = await service.create(
      { title: 'Fully recorded' },
      context('operation-create-user'),
    );
    const result = await service.complete(
      { taskId: created.task.id, allEffortRecorded: true },
      context('operation-complete-user'),
    );
    expect(result.completionRecord).toMatchObject({
      actualDurationSeconds: 0,
      durationCoverage: 'complete',
    });
    expect(result.task.actualDurationMinutes).toBe(0);

    const blockedUnitOfWork = new MemoryUnitOfWork();
    const blockedService = createService(blockedUnitOfWork, [
      'task-agent',
      'activity-create-agent',
    ]);
    const blocked = await blockedService.create(
      { title: 'Agent cannot attest' },
      context('operation-create-agent'),
    );
    await expect(
      blockedService.complete(
        { taskId: blocked.task.id, allEffortRecorded: true },
        {
          operationId: 'operation-agent-complete',
          authority: {
            kind: 'agent_authorized',
            authorizationId: 'approval-1',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'permission_required' });
    expect(blockedUnitOfWork.state.completionRecords.size).toBe(0);
  });

  it('creates one evidence-backed Achievement when the user opts in', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'task-1',
      'activity-create',
      'completion-1',
      'achievement-1',
      'activity-complete',
    ]);
    const created = await service.create(
      { title: 'No phantom win' },
      context('operation-create'),
    );

    const result = await service.complete(
      { taskId: created.task.id, recordAchievement: true },
      context('operation-complete'),
    );
    expect(result).toMatchObject({
      task: { status: 'completed' },
      completionRecord: {
        id: 'completion-1',
        achievementDisposition: 'record',
      },
      achievement: {
        id: 'achievement-1',
        sourceCompletionRecordId: 'completion-1',
      },
    });
    expect(unitOfWork.state.tasks.get('task-1')?.status).toBe('completed');
    expect(unitOfWork.state.achievements.size).toBe(1);

    await expect(
      service.complete(
        { taskId: created.task.id, recordAchievement: true },
        context('operation-create'),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('uses the same completion transaction when manual completion closes an active Session', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const tasks = createService(
      unitOfWork,
      [
        'task-1',
        'activity-create',
        'completion-1',
        'achievement-1',
        'activity-complete',
      ],
      [FIRST_INSTANT, THIRD_INSTANT],
    );
    const created = await tasks.create(
      { title: 'Finish from the Task screen', estimatedDurationMinutes: 60 },
      context('operation-create'),
    );
    const execution = new ExecutionService({
      unitOfWork,
      clock: new SequenceClock(SECOND_INSTANT),
      localTimeProvider: new FixedLocalTimeProvider(LOCAL_DATE, TIME_ZONE),
      ids: {
        session: new QueueIdGenerator('session-1'),
        interval: new QueueIdGenerator('interval-1'),
        activity: new QueueIdGenerator('activity-start'),
        completionRecord: new QueueIdGenerator('unused-completion'),
        achievement: new QueueIdGenerator('unused-achievement'),
        schedulePlan: new QueueIdGenerator('unused-plan'),
        integrationJob: new QueueIdGenerator('unused-job'),
      },
    });
    const started = await execution.start(
      { taskId: created.task.id },
      context('operation-start'),
    );

    const completed = await tasks.complete(
      { taskId: created.task.id, recordAchievement: true },
      context('operation-complete'),
    );

    expect(completed).toMatchObject({
      task: { status: 'completed', actualDurationMinutes: 60 },
      completionRecord: {
        sourceSessionId: started.session.id,
        actualDurationSeconds: 3_600,
        durationCoverage: 'partial',
      },
      achievement: { sourceExecutionSessionId: started.session.id },
    });
    expect(await execution.getActive()).toBeNull();
    expect(
      unitOfWork.state.executionSessions.get(started.session.id),
    ).toMatchObject({ status: 'completed', completionType: 'complete_task' });
    expect(
      [...unitOfWork.state.executionIntervals.values()].find(
        (interval) => interval.sessionId === started.session.id,
      ),
    ).toMatchObject({ endAt: THIRD_INSTANT, timingQuality: 'trusted' });
  });

  it('requires explicit authority to complete or cancel a Task', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, ['task-1', 'activity-create']);
    const created = await service.create(
      { title: 'Explicit terminal action' },
      context('operation-create'),
    );
    const systemAuthority = {
      authority: { kind: 'system', reason: 'background maintenance' },
    } as const;

    await expect(
      service.complete(
        { taskId: created.task.id },
        { operationId: 'operation-complete', ...systemAuthority },
      ),
    ).rejects.toMatchObject({ code: 'permission_required' });
    await expect(
      service.cancel(
        { taskId: created.task.id },
        { operationId: 'operation-cancel', ...systemAuthority },
      ),
    ).rejects.toMatchObject({ code: 'permission_required' });
    expect(unitOfWork.state.tasks.get('task-1')?.status).toBe('inbox');
  });

  it('fails safely when a stored result is malformed or cross-field inconsistent', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'task-1',
      'activity-create',
      'completion-1',
      'activity-complete',
    ]);
    const created = await service.create(
      { title: 'Integrity' },
      context('operation-create'),
    );
    await service.complete(
      { taskId: created.task.id },
      context('operation-complete'),
    );

    const createRecord =
      unitOfWork.state.operationRecords.get('operation-create');
    if (createRecord === undefined) throw new Error('missing test operation');
    unitOfWork.state.operationRecords.set('operation-create', {
      ...createRecord,
      resultJson: '{invalid',
    });
    await expect(
      service.create({ title: 'Integrity' }, context('operation-create')),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      causeCategory: 'data_integrity',
      retryable: false,
    });

    const completionRecord =
      unitOfWork.state.operationRecords.get('operation-complete');
    if (completionRecord === undefined) {
      throw new Error('missing completion test operation');
    }
    const inconsistent = JSON.parse(completionRecord.resultJson) as {
      task: { id: string };
    };
    inconsistent.task.id = 'another-task';
    unitOfWork.state.operationRecords.set('operation-complete', {
      ...completionRecord,
      resultJson: JSON.stringify(inconsistent),
    });
    await expect(
      service.complete(
        { taskId: created.task.id },
        context('operation-complete'),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      causeCategory: 'data_integrity',
      retryable: false,
    });
  });

  it('rejects a well-shaped replay snapshot whose version disagrees with its operation record', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, ['task-1', 'activity-create']);
    await service.create(
      { title: 'Version integrity' },
      context('operation-create'),
    );
    const record = unitOfWork.state.operationRecords.get('operation-create');
    if (record === undefined) throw new Error('missing test operation');
    const result = JSON.parse(record.resultJson) as { stateVersion: number };
    result.stateVersion += 1;
    unitOfWork.state.operationRecords.set('operation-create', {
      ...record,
      resultJson: JSON.stringify(result),
    });

    await expect(
      service.create(
        { title: 'Version integrity' },
        context('operation-create'),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      causeCategory: 'data_integrity',
      retryable: false,
    });
  });

  it('rejects a well-shaped update replay snapshot for another Task', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = createService(unitOfWork, [
      'task-1',
      'activity-create',
      'activity-update',
    ]);
    const created = await service.create(
      { title: 'Expected Task' },
      context('operation-create'),
    );
    const updateInput = {
      taskId: created.task.id,
      patch: { title: 'Updated title' },
    } as const;
    await service.update(updateInput, context('operation-update'));
    const record = unitOfWork.state.operationRecords.get('operation-update');
    if (record === undefined) throw new Error('missing test operation');
    const result = JSON.parse(record.resultJson) as { task: { id: string } };
    result.task.id = 'another-task';
    unitOfWork.state.operationRecords.set('operation-update', {
      ...record,
      resultJson: JSON.stringify(result),
    });

    await expect(
      service.update(updateInput, context('operation-update')),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      causeCategory: 'data_integrity',
      retryable: false,
    });
  });
});
