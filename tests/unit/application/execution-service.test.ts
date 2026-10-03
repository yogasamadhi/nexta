import {
  createCommittedSchedulePlan,
  createTask,
  createTimeBlock,
  parseInstant,
  parseLocalDate,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
} from '@workspace/domain';
import {
  ExecutionService,
  type ExecutionServiceDependencies,
  type WriteContext,
} from '@workspace/application';
import { describe, expect, it } from 'vitest';

import {
  FixedLocalTimeProvider,
  MemoryUnitOfWork,
  QueueIdGenerator,
  SequenceClock,
} from './fakes';

const ZONE = parseTimeZoneId('Asia/Shanghai');
const DATE = parseLocalDate('2026-09-12');
const T0 = parseInstant('2026-09-12T01:00:00.000Z');
const T1 = parseInstant('2026-09-12T02:00:00.000Z');
const T2 = parseInstant('2026-09-12T03:00:00.000Z');
const T3 = parseInstant('2026-09-12T03:30:00.000Z');
const T4 = parseInstant('2026-09-12T05:00:00.000Z');

function context(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

function task(id = 'task-1') {
  return createTask({
    id: parseTaskId(id),
    title: 'Write the long report',
    priority: 'normal',
    estimatedDurationMinutes: 240,
    remainingDurationMinutes: 240,
    splittable: true,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: parseInstant('2026-09-11T01:00:00.000Z'),
  });
}

function service(
  unitOfWork: MemoryUnitOfWork,
  instants: readonly ReturnType<typeof parseInstant>[],
  overrides: Partial<ExecutionServiceDependencies['ids']> = {},
): ExecutionService {
  return new ExecutionService({
    unitOfWork,
    clock: new SequenceClock(...instants),
    localTimeProvider: new FixedLocalTimeProvider(DATE, ZONE),
    ids: {
      session: new QueueIdGenerator('session-1', 'session-2', 'session-3'),
      interval: new QueueIdGenerator(
        'interval-1',
        'interval-2',
        'interval-3',
        'interval-4',
        'interval-5',
      ),
      activity: new QueueIdGenerator(
        'activity-1',
        'activity-2',
        'activity-3',
        'activity-4',
        'activity-5',
      ),
      completionRecord: new QueueIdGenerator('completion-1'),
      achievement: new QueueIdGenerator('achievement-1'),
      schedulePlan: new QueueIdGenerator(
        'plan-2',
        'plan-3',
        'plan-4',
        'plan-5',
      ),
      integrationJob: new QueueIdGenerator(
        'job-1',
        'job-2',
        'job-3',
        'job-4',
        'job-5',
        'job-6',
        'job-7',
        'job-8',
      ),
      ...overrides,
    },
  });
}

function seedPlannedTask(unitOfWork: MemoryUnitOfWork): void {
  const source = task();
  unitOfWork.state.tasks.set(source.id, source);
  unitOfWork.state.scheduleState = { stateVersion: 0, planRevision: 1 };
  unitOfWork.state.schedulePlans.set(
    1,
    createCommittedSchedulePlan({
      id: parseSchedulePlanId('plan-1'),
      planRevision: 1,
      basedOnStateVersion: 0,
      createdAt: T0,
      committedAt: T0,
      inputHash: 'seed',
      schedulerVersion: 'test',
      policyVersion: 'test',
      timeZone: ZONE,
      horizonStart: T0,
      horizonEnd: T4,
      reason: 'test_seed',
    }),
  );
  const ranges = [
    [T0, T1],
    [T2, parseInstant('2026-09-12T04:00:00.000Z')],
    [
      parseInstant('2026-09-12T04:00:00.000Z'),
      parseInstant('2026-09-12T04:30:00.000Z'),
    ],
    [parseInstant('2026-09-12T04:30:00.000Z'), T4],
  ] as const;
  ranges.forEach(([startAt, endAt], index) => {
    const block = createTimeBlock({
      id: parseTimeBlockId(`block-${index + 1}`),
      taskId: source.id,
      type: 'task',
      startAt,
      endAt,
      status: 'planned',
      source: 'scheduler',
      locked: false,
      planRevision: 1,
      createdAt: T0,
    });
    unitOfWork.state.timeBlocks.set(block.id, block);
  });
}

describe('ExecutionService', () => {
  it('finishes one block without completing the Task, then explicitly completes once with Achievement', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    seedPlannedTask(unitOfWork);
    const execution = service(unitOfWork, [T0, T1, T2, T3]);

    const first = await execution.start(
      { taskId: 'task-1', timeBlockId: 'block-1' },
      context('op-start-1'),
    );
    const firstFinish = await execution.finish(
      { sessionId: first.session.id, outcome: 'finish_session' },
      context('op-finish-1'),
    );

    expect(firstFinish).toMatchObject({
      session: { status: 'completed', completionType: 'finish_session' },
      task: { status: 'in_progress', actualDurationMinutes: 60 },
      timeBlock: { id: 'block-1', status: 'completed' },
      completionRecord: null,
      achievement: null,
    });
    expect(unitOfWork.state.timeBlocks.get('block-2')?.status).toBe('planned');

    const second = await execution.start(
      { taskId: 'task-1', timeBlockId: 'block-2' },
      context('op-start-2'),
    );
    const completed = await execution.finish(
      {
        sessionId: second.session.id,
        outcome: 'complete_task',
        recordAchievement: true,
        allEffortRecorded: true,
      },
      context('op-complete'),
    );

    expect(completed).toMatchObject({
      task: { status: 'completed', actualDurationMinutes: 90 },
      session: { status: 'completed', completionType: 'complete_task' },
      completionRecord: {
        id: 'completion-1',
        actualDurationSeconds: 5_400,
        durationCoverage: 'complete',
        achievementDisposition: 'record',
      },
      achievement: {
        id: 'achievement-1',
        sourceCompletionRecordId: 'completion-1',
      },
      planRevision: 5,
    });
    expect(unitOfWork.state.completionRecords.size).toBe(1);
    expect(unitOfWork.state.achievements.size).toBe(1);
    expect(unitOfWork.state.timeBlocks.get('block-2')?.status).toBe(
      'completed',
    );
    expect(unitOfWork.state.timeBlocks.get('block-3')?.status).toBe('canceled');
    expect(unitOfWork.state.timeBlocks.get('block-4')?.status).toBe('canceled');

    const replay = await execution.finish(
      {
        sessionId: second.session.id,
        outcome: 'complete_task',
        recordAchievement: true,
        allEffortRecorded: true,
      },
      context('op-complete'),
    );
    expect(replay).toEqual(completed);
    expect(unitOfWork.state.completionRecords.size).toBe(1);
    expect(unitOfWork.state.achievements.size).toBe(1);
  });

  it('persists paused state across service reconstruction and resumes without counting pause time', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const source = task();
    unitOfWork.state.tasks.set(source.id, source);
    const firstProcess = service(unitOfWork, [T0, T1]);

    const started = await firstProcess.start(
      { taskId: source.id },
      context('op-start'),
    );
    await firstProcess.pause(
      { sessionId: started.session.id },
      context('op-pause'),
    );

    const afterRestart = service(unitOfWork, [T2, T3], {
      interval: new QueueIdGenerator('interval-after-resume'),
      activity: new QueueIdGenerator('activity-resume', 'activity-finish'),
    });
    const restored = await afterRestart.getActive();
    expect(restored).toMatchObject({ session: { status: 'paused' } });

    await afterRestart.resume(
      { sessionId: started.session.id },
      context('op-resume'),
    );
    const finished = await afterRestart.finish(
      { sessionId: started.session.id, outcome: 'finish_session' },
      context('op-finish'),
    );

    expect(finished.session.pausedDurationSeconds).toBe(3_600);
    expect(finished.recordedWorkSeconds).toBe(5_400);
    expect(finished.task.actualDurationMinutes).toBe(90);
    expect(await afterRestart.getActive()).toBeNull();
  });

  it('rejects a second active start and safely marks clock-regressed intervals for review', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const firstTask = task('task-1');
    const secondTask = task('task-2');
    unitOfWork.state.tasks.set(firstTask.id, firstTask);
    unitOfWork.state.tasks.set(secondTask.id, secondTask);
    const ten = parseInstant('2026-09-12T10:00:00.000Z');
    const nine = parseInstant('2026-09-12T09:00:00.000Z');
    const execution = service(unitOfWork, [ten, nine, nine]);

    const started = await execution.start(
      { taskId: firstTask.id },
      context('op-start'),
    );
    await expect(
      execution.start({ taskId: secondTask.id }, context('op-conflict')),
    ).rejects.toMatchObject({ code: 'active_session_conflict' });
    await execution.pause(
      { sessionId: started.session.id },
      context('op-pause'),
    );
    const completed = await execution.finish(
      { sessionId: started.session.id, outcome: 'complete_task' },
      context('op-complete'),
    );

    expect(completed.intervals).toHaveLength(2);
    expect(
      completed.intervals.every((item) => item.endAt === item.startAt),
    ).toBe(true);
    expect(
      completed.intervals.every(
        (item) => item.timingQuality === 'needs_review',
      ),
    ).toBe(true);
    expect(completed.recordedWorkSeconds).toBe(0);
    expect(completed.completionRecord).toMatchObject({
      actualDurationSeconds: null,
      durationCoverage: 'unknown',
    });
    expect(completed.task.actualDurationMinutes).toBeNull();
  });

  it('rolls back Session, completion evidence, Achievement, blocks, jobs, and versions when a late write fails', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    seedPlannedTask(unitOfWork);
    const execution = service(unitOfWork, [T0, T1]);
    const started = await execution.start(
      { taskId: 'task-1', timeBlockId: 'block-1' },
      context('op-start'),
    );
    const stateAfterStart = unitOfWork.state.scheduleState;
    const planCountAfterStart = unitOfWork.state.schedulePlans.size;
    const jobCountAfterStart = unitOfWork.state.integrationJobs.size;
    unitOfWork.failOn = 'achievements.insert';

    await expect(
      execution.finish(
        {
          sessionId: started.session.id,
          outcome: 'complete_task',
          recordAchievement: true,
        },
        context('op-complete'),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      causeCategory: 'local_storage',
    });

    expect(
      unitOfWork.state.executionSessions.get(started.session.id)?.status,
    ).toBe('running');
    expect(
      [...unitOfWork.state.executionIntervals.values()].filter(
        (interval) => interval.sessionId === started.session.id,
      ),
    ).toMatchObject([{ endAt: null, kind: 'work' }]);
    expect(unitOfWork.state.tasks.get('task-1')?.status).toBe('in_progress');
    expect(unitOfWork.state.timeBlocks.get('block-1')?.status).toBe('started');
    expect(unitOfWork.state.timeBlocks.get('block-2')?.status).toBe('planned');
    expect(unitOfWork.state.completionRecords.size).toBe(0);
    expect(unitOfWork.state.achievements.size).toBe(0);
    expect(unitOfWork.state.operationRecords.has('op-complete')).toBe(false);
    expect(unitOfWork.state.scheduleState).toEqual(stateAfterStart);
    expect(unitOfWork.state.schedulePlans.size).toBe(planCountAfterStart);
    expect(unitOfWork.state.integrationJobs.size).toBe(jobCountAfterStart);
  });
});
