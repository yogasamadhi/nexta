import {
  EnergyCheckInService,
  ReflectionService,
  RelaxService,
  type WriteContext,
} from '@workspace/application';
import {
  completeTask,
  createCompletionRecord,
  createTask,
  createTimeBlock,
  parseCompletionRecordId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

import {
  FixedLocalTimeProvider,
  MemoryUnitOfWork,
  QueueIdGenerator,
  SequenceClock,
  createMemoryState,
} from './fakes';

const T0 = parseInstant('2026-09-12T00:00:00.000Z');
const T1 = parseInstant('2026-09-12T08:00:00.000Z');
const T2 = parseInstant('2026-09-12T09:00:00.000Z');
const DATE = parseLocalDate('2026-09-12');
const ZONE = parseTimeZoneId('Asia/Shanghai');

function context(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

describe('Phase 8 wellbeing application services', () => {
  it('builds an offline reflection only from CompletionRecord evidence and preserves notes', async () => {
    const state = createMemoryState();
    const task = completeTask(
      createTask({
        id: parseTaskId('task-completed'),
        title: '提交方案',
        priority: 'normal',
        splittable: false,
        schedulingPolicy: 'flexible',
        source: 'manual',
        createdAt: T0,
      }),
      { completedAt: T1 },
    );
    const next = createTask({
      id: parseTaskId('task-next'),
      title: '整理下一步',
      priority: 'normal',
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: T0,
    });
    state.tasks.set(task.id, task);
    state.tasks.set(next.id, next);
    const completedBlock = createTimeBlock({
      id: parseTimeBlockId('block-completed'),
      taskId: task.id,
      type: 'task',
      startAt: T0,
      endAt: T1,
      status: 'completed',
      source: 'scheduler',
      locked: false,
      planRevision: 1,
      createdAt: T0,
    });
    state.timeBlocks.set(completedBlock.id, completedBlock);
    const record = createCompletionRecord({
      id: parseCompletionRecordId('completion-1'),
      taskId: task.id,
      operationId: parseOperationId('complete-operation'),
      completedAt: T1,
      taskTitleSnapshot: task.title,
      durationCoverage: 'unknown',
      achievementDisposition: 'record',
      source: 'user',
    });
    state.completionRecords.set(record.id, record);
    const unitOfWork = new MemoryUnitOfWork(state);
    const service = new ReflectionService({
      unitOfWork,
      clock: new SequenceClock(T2, T2),
      idGenerator: new QueueIdGenerator('reflection-1'),
    });
    const input = {
      localDate: DATE,
      timeZone: ZONE,
      range: { start: T0, end: parseInstant('2026-09-13T00:00:00.000Z') },
      userNote: '我想记住这个进展。',
    };

    const result = await service.refresh(input, context('reflection-create'));
    expect(result).toMatchObject({
      sourceCompletionRecordCount: 1,
      reflection: {
        summary:
          '今天完成了 1 项：「提交方案」。 今日任务时间块共 1 个：完成 1 个，跳过 0 个，取消 0 个，仍在计划中 0 个。',
        userNote: '我想记住这个进展。',
        generatedBy: 'local_facts',
        wins: [
          {
            completionRecordId: 'completion-1',
            taskId: 'task-completed',
          },
        ],
      },
    });
    await expect(
      service.getForDay({
        localDate: input.localDate,
        timeZone: input.timeZone,
        range: input.range,
      }),
    ).resolves.toMatchObject({ id: 'reflection-1' });
    expect(unitOfWork.state.scheduleState?.stateVersion).toBe(0);
  });

  it('records optional energy in the observed local date and invalidates old previews', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = new EnergyCheckInService({
      unitOfWork,
      clock: { now: () => T1 },
      localTimeProvider: new FixedLocalTimeProvider(DATE, ZONE),
      idGenerator: new QueueIdGenerator('check-in-1'),
    });
    const result = await service.record(
      { level: 1, note: '主观精力很低' },
      context('check-in-record'),
    );

    expect(result).toMatchObject({
      stateVersion: 1,
      checkIn: {
        id: 'check-in-1',
        level: 1,
        localDate: DATE,
        timeZone: ZONE,
      },
    });
    await expect(service.getLatestCurrentDay()).resolves.toMatchObject({
      id: 'check-in-1',
    });
    await expect(
      service.record(
        { level: 2 },
        {
          operationId: 'agent-check-in',
          authority: { kind: 'agent_authorized', authorizationId: 'approval' },
        },
      ),
    ).rejects.toMatchObject({ code: 'permission_required' });
  });

  it('records real relax intervals, resumes by explicit UI flow, and rolls back late failures', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = new RelaxService({
      unitOfWork,
      clock: new SequenceClock(T1, T2),
      idGenerator: new QueueIdGenerator('relax-1'),
    });

    const started = await service.start(
      { type: 'breathing', plannedMinutes: 1, source: 'today' },
      context('relax-start'),
    );
    const ended = await service.end(
      { sessionId: started.session.id, outcome: 'completed' },
      context('relax-end'),
    );
    expect(ended).toMatchObject({
      stateVersion: 2,
      session: {
        status: 'completed',
        actualSeconds: 3_600,
        timingQuality: 'trusted',
      },
    });
    await expect(
      service.end(
        { sessionId: started.session.id, outcome: 'completed' },
        context('relax-end'),
      ),
    ).resolves.toEqual(ended);

    const failingUnitOfWork = new MemoryUnitOfWork();
    failingUnitOfWork.failOn = 'scheduleState.update';
    const failing = new RelaxService({
      unitOfWork: failingUnitOfWork,
      clock: { now: () => T1 },
      idGenerator: new QueueIdGenerator('relax-failed'),
    });
    await expect(
      failing.start(
        { type: 'pause', plannedMinutes: 3, source: 'relax_tab' },
        context('relax-failed-operation'),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      retryable: true,
      causeCategory: 'local_storage',
    });
    expect(failingUnitOfWork.state.relaxSessions.size).toBe(0);
  });
});
