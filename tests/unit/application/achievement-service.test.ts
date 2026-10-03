import {
  completeTask,
  createCompletionRecord,
  createTask,
  parseCompletionRecordId,
  parseInstant,
  parseOperationId,
  parseTaskId,
} from '@workspace/domain';
import { AchievementService, type WriteContext } from '@workspace/application';
import { describe, expect, it } from 'vitest';

import { MemoryUnitOfWork, QueueIdGenerator, SequenceClock } from './fakes';

const T0 = parseInstant('2026-09-12T01:00:00.000Z');
const T1 = parseInstant('2026-09-12T02:00:00.000Z');
const T2 = parseInstant('2026-09-12T03:00:00.000Z');
const T3 = parseInstant('2026-09-12T04:00:00.000Z');
const T4 = parseInstant('2026-09-12T05:00:00.000Z');

function user(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

function agent(operationId: string): WriteContext {
  return {
    operationId,
    authority: { kind: 'agent_authorized', authorizationId: 'approval-1' },
  };
}

function seedCompletion(unitOfWork: MemoryUnitOfWork): void {
  const created = createTask({
    id: parseTaskId('task-1'),
    title: 'Ship a real improvement',
    priority: 'normal',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: T0,
  });
  const task = completeTask(created, { completedAt: T1 });
  const completion = createCompletionRecord({
    id: parseCompletionRecordId('completion-1'),
    taskId: task.id,
    operationId: parseOperationId('completion-operation'),
    completedAt: T1,
    taskTitleSnapshot: task.title,
    durationCoverage: 'unknown',
    achievementDisposition: 'skip',
    source: 'user',
  });
  unitOfWork.state.tasks.set(task.id, task);
  unitOfWork.state.completionRecords.set(task.id, completion);
}

describe('AchievementService', () => {
  it('respects opt-out, permits explicit user reversal, keeps one source, and hides without deleting evidence', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    seedCompletion(unitOfWork);
    const service = new AchievementService({
      unitOfWork,
      clock: new SequenceClock(T2, T3, T3, T4),
      idGenerator: new QueueIdGenerator('achievement-1'),
    });

    await expect(
      service.create(
        { completionRecordId: 'completion-1' },
        agent('op-agent-create'),
      ),
    ).rejects.toMatchObject({ code: 'permission_required' });

    const created = await service.create(
      {
        completionRecordId: 'completion-1',
        title: 'Improvement shipped',
        summary: 'Kept the source evidence intact.',
      },
      user('op-create'),
    );
    expect(created.achievement).toMatchObject({
      id: 'achievement-1',
      sourceCompletionRecordId: 'completion-1',
      sourceTaskId: 'task-1',
      title: 'Improvement shipped',
      userEdited: true,
      hidden: false,
    });
    expect(
      unitOfWork.state.completionRecords.get('task-1')?.achievementDisposition,
    ).toBe('record');

    const details = await service.getDetails(created.achievement.id);
    expect(details).toMatchObject({
      achievement: { id: 'achievement-1' },
      completionRecord: { id: 'completion-1', durationCoverage: 'unknown' },
      task: { id: 'task-1', status: 'completed' },
      project: null,
      goal: null,
    });
    await expect(service.listAllDetails()).resolves.toHaveLength(1);

    const duplicate = await service.create(
      { completionRecordId: 'completion-1' },
      user('op-create-again'),
    );
    expect(duplicate.achievement.id).toBe(created.achievement.id);
    expect(unitOfWork.state.achievements.size).toBe(1);

    const edited = await service.update(
      {
        achievementId: created.achievement.id,
        patch: { summary: 'A concise user-authored note.' },
      },
      user('op-edit'),
    );
    expect(edited.achievement.summary).toBe('A concise user-authored note.');

    const hidden = await service.setHidden(
      { achievementId: created.achievement.id, hidden: true },
      user('op-hide'),
    );
    expect(hidden.achievement.hidden).toBe(true);
    expect(await service.listAll()).toEqual([]);
    expect(await service.listAllDetails()).toEqual([]);
    expect(await service.listAllDetails({ includeHidden: true })).toHaveLength(
      1,
    );
    expect(await service.listAll({ includeHidden: true })).toHaveLength(1);
    expect(unitOfWork.state.completionRecords.size).toBe(1);
  });

  it('validates range bounds and filters hidden records from diary views', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    seedCompletion(unitOfWork);
    const service = new AchievementService({
      unitOfWork,
      clock: new SequenceClock(T2),
      idGenerator: new QueueIdGenerator('achievement-1'),
    });
    await service.create(
      { completionRecordId: 'completion-1' },
      user('op-create'),
    );

    expect(
      await service.listRange({
        start: '2026-09-12T00:00:00.000Z',
        end: '2026-09-13T00:00:00.000Z',
      }),
    ).toHaveLength(1);
    await expect(service.list({ limit: 1 })).resolves.toMatchObject({
      items: [{ id: 'achievement-1' }],
      nextCursor: null,
    });
    await expect(
      service.list({ cursor: 'missing-achievement' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      service.listRange({ start: T2, end: T1 }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });
});
