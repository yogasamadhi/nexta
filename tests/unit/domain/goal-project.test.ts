import { describe, expect, it } from 'vitest';

import {
  archiveGoal,
  archiveProject,
  calculateGoalProgress,
  cancelTask,
  completeTask,
  createGoal,
  createProject,
  createTask,
  parseGoalId,
  parseInstant,
  parseProjectId,
  parseTaskId,
  type Task,
} from '../../../packages/domain/src';

const T0 = parseInstant('2026-09-12T01:00:00.000Z');
const T1 = parseInstant('2026-09-12T02:00:00.000Z');
const goalId = parseGoalId('goal-1');
const projectId = parseProjectId('project-1');

function task(
  id: string,
  relations: Partial<Parameters<typeof createTask>[0]> = {},
): Task {
  return createTask({
    id: parseTaskId(id),
    title: id,
    priority: 'normal',
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: T0,
    ...relations,
  });
}

describe('Goal and Project facts', () => {
  it('creates and archives them without removing their relationships', () => {
    const goal = createGoal({
      id: goalId,
      title: 'Publish a book',
      status: 'active',
      createdAt: T0,
    });
    const project = createProject({
      id: projectId,
      goalId,
      title: 'First manuscript',
      status: 'active',
      createdAt: T0,
    });

    const archivedGoal = archiveGoal(goal, T1);
    const archivedProject = archiveProject(project, T1);

    expect(archivedGoal.archivedAt).toBe(T1);
    expect(archivedProject.archivedAt).toBe(T1);
    expect(archivedProject.goalId).toBe(goalId);
    expect(archiveGoal(archivedGoal, T1)).toBe(archivedGoal);
  });
});

describe('Goal progress aggregation', () => {
  const goal = createGoal({
    id: goalId,
    title: 'Publish a book',
    status: 'active',
    createdAt: T0,
  });
  const project = createProject({
    id: projectId,
    goalId,
    title: 'First manuscript',
    status: 'active',
    createdAt: T0,
  });

  it('deduplicates direct/project links and excludes canceled/group parents', () => {
    const directAndProject = completeTask(task('done', { goalId, projectId }), {
      completedAt: T1,
    });
    const openViaProject = task('open', { projectId });
    const canceled = cancelTask(task('canceled', { goalId }), {
      canceledAt: T1,
    });
    const groupingParent = task('parent', { goalId });
    const child = task('child', {
      goalId,
      parentTaskId: groupingParent.id,
    });

    const progress = calculateGoalProgress(
      goal.id,
      [
        directAndProject,
        directAndProject,
        openViaProject,
        canceled,
        groupingParent,
        child,
      ],
      [archiveProject(project, T1)],
    );

    expect(progress).toEqual({
      goalId,
      completedTaskCount: 1,
      effectiveTaskCount: 3,
      completionRatio: 1 / 3,
    });
  });

  it('returns no ratio rather than a fabricated percentage for an empty goal', () => {
    const progress = calculateGoalProgress(
      archiveGoal(goal, T1).id,
      [cancelTask(task('canceled', { goalId }), { canceledAt: T1 })],
      [project],
    );

    expect(progress.effectiveTaskCount).toBe(0);
    expect(progress.completedTaskCount).toBe(0);
    expect(progress.completionRatio).toBeNull();
  });
});
