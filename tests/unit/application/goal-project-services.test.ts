import {
  archiveGoal,
  archiveProject,
  cancelTask,
  completeTask,
  createGoal,
  createProject,
  createTask,
  parseGoalId,
  parseInstant,
  parseLocalDate,
  parseProjectId,
  parseTaskId,
} from '@workspace/domain';
import {
  GoalService,
  ProjectService,
  type GoalProjectServiceDependencies,
  type WriteContext,
} from '@workspace/application';
import { describe, expect, it } from 'vitest';

import { MemoryUnitOfWork, QueueIdGenerator, SequenceClock } from './fakes';

const FIRST_INSTANT = parseInstant('2026-09-12T02:00:00.000Z');
const SECOND_INSTANT = parseInstant('2026-09-12T03:00:00.000Z');

function context(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

function dependencies(
  unitOfWork: MemoryUnitOfWork,
  ids: string[],
): GoalProjectServiceDependencies {
  return {
    unitOfWork,
    clock: new SequenceClock(FIRST_INSTANT, SECOND_INSTANT),
    idGenerator: new QueueIdGenerator(...ids),
  };
}

describe('GoalService and ProjectService', () => {
  it('lists active Goals and Projects with bounded cursors and filters', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const goalOne = createGoal({
      id: parseGoalId('goal-1'),
      title: 'Goal one',
      status: 'active',
      createdAt: FIRST_INSTANT,
    });
    const goalTwo = createGoal({
      id: parseGoalId('goal-2'),
      title: 'Goal two',
      status: 'active',
      createdAt: SECOND_INSTANT,
    });
    const archivedGoal = archiveGoal(
      createGoal({
        id: parseGoalId('goal-3'),
        title: 'Archived goal',
        status: 'active',
        createdAt: SECOND_INSTANT,
      }),
      SECOND_INSTANT,
    );
    unitOfWork.state.goals.set(goalOne.id, goalOne);
    unitOfWork.state.goals.set(goalTwo.id, goalTwo);
    unitOfWork.state.goals.set(archivedGoal.id, archivedGoal);

    const projectOne = createProject({
      id: parseProjectId('project-1'),
      goalId: goalOne.id,
      title: 'Project one',
      status: 'active',
      createdAt: FIRST_INSTANT,
    });
    const archivedProject = archiveProject(
      createProject({
        id: parseProjectId('project-2'),
        goalId: goalOne.id,
        title: 'Archived project',
        status: 'active',
        createdAt: SECOND_INSTANT,
      }),
      SECOND_INSTANT,
    );
    unitOfWork.state.projects.set(projectOne.id, projectOne);
    unitOfWork.state.projects.set(archivedProject.id, archivedProject);

    const goalService = new GoalService(dependencies(unitOfWork, []));
    const projectService = new ProjectService(dependencies(unitOfWork, []));
    const firstPage = await goalService.list({ limit: 1 });
    const secondPage = await goalService.list({
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.items.map((goal) => goal.id)).toEqual(['goal-1']);
    expect(firstPage.nextCursor).toBe('goal-1');
    expect(secondPage.items.map((goal) => goal.id)).toEqual(['goal-2']);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      (await goalService.list({ includeArchived: true })).items.map(
        (goal) => goal.id,
      ),
    ).toEqual(['goal-1', 'goal-2', 'goal-3']);
    expect(
      (
        await projectService.list({
          goalId: goalOne.id,
          includeArchived: false,
        })
      ).items.map((project) => project.id),
    ).toEqual(['project-1']);
    await expect(
      goalService.list({ cursor: 'missing-goal' }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('replays original Goal and Project snapshots after later updates', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const goalService = new GoalService(dependencies(unitOfWork, ['goal-1']));
    const projectService = new ProjectService(
      dependencies(unitOfWork, ['project-1']),
    );

    const originalGoal = await goalService.create(
      { title: 'Original goal', status: 'active' },
      context('goal-create'),
    );
    await goalService.update(
      { goalId: originalGoal.goal.id, patch: { title: 'Updated goal' } },
      context('goal-update'),
    );
    const replayedGoal = await goalService.create(
      { title: 'Original goal', status: 'active' },
      context('goal-create'),
    );

    const originalProject = await projectService.create(
      {
        goalId: originalGoal.goal.id,
        title: 'Original project',
        status: 'active',
      },
      context('project-create'),
    );
    await projectService.update(
      {
        projectId: originalProject.project.id,
        patch: { title: 'Updated project' },
      },
      context('project-update'),
    );
    const replayedProject = await projectService.create(
      {
        goalId: originalGoal.goal.id,
        title: 'Original project',
        status: 'active',
      },
      context('project-create'),
    );

    expect(replayedGoal).toEqual(originalGoal);
    expect(replayedGoal.goal.title).toBe('Original goal');
    expect(unitOfWork.state.goals.get('goal-1')?.title).toBe('Updated goal');
    expect(replayedProject).toEqual(originalProject);
    expect(replayedProject.project.title).toBe('Original project');
    expect(unitOfWork.state.projects.get('project-1')?.title).toBe(
      'Updated project',
    );
  });

  it('rejects a Project relation to a missing Goal without partial writes', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const projectService = new ProjectService(
      dependencies(unitOfWork, ['project-1']),
    );

    await expect(
      projectService.create(
        {
          goalId: 'missing-goal',
          title: 'Orphan',
          status: 'active',
        },
        context('project-create'),
      ),
    ).rejects.toMatchObject({
      code: 'validation_error',
      operationId: 'project-create',
    });
    expect(unitOfWork.state.projects.size).toBe(0);
    expect(unitOfWork.state.operationRecords.size).toBe(0);
  });

  it('aggregates real linked facts, de-duplicates, excludes canceled/grouping parents, and keeps archive history', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const goalId = parseGoalId('goal-1');
    const projectId = parseProjectId('project-1');
    unitOfWork.state.goals.set(
      goalId,
      createGoal({
        id: goalId,
        title: 'Ship product',
        status: 'active',
        createdAt: FIRST_INSTANT,
      }),
    );
    unitOfWork.state.projects.set(
      projectId,
      createProject({
        id: projectId,
        goalId,
        title: 'Beta',
        status: 'active',
        createdAt: FIRST_INSTANT,
      }),
    );

    const task = (
      id: string,
      links: {
        goalId?: typeof goalId;
        projectId?: typeof projectId;
        parentTaskId?: ReturnType<typeof parseTaskId>;
      },
    ) =>
      createTask({
        id: parseTaskId(id),
        ...links,
        title: id,
        priority: 'normal',
        splittable: false,
        schedulingPolicy: 'flexible',
        source: 'user',
        createdAt: FIRST_INSTANT,
      });

    const directCompleted = completeTask(task('direct-completed', { goalId }), {
      completedAt: SECOND_INSTANT,
    });
    const groupingParent = task('grouping-parent', { projectId });
    const child = task('child', {
      projectId,
      parentTaskId: groupingParent.id,
    });
    const canceled = cancelTask(task('canceled', { goalId }), {
      canceledAt: SECOND_INSTANT,
    });
    const linkedTwice = task('linked-twice', { goalId, projectId });
    for (const item of [
      directCompleted,
      groupingParent,
      child,
      canceled,
      linkedTwice,
    ]) {
      unitOfWork.state.tasks.set(item.id, item);
    }

    const goalService = new GoalService(dependencies(unitOfWork, []));
    const projectService = new ProjectService(dependencies(unitOfWork, []));
    const beforeArchive = await goalService.progress(goalId);
    await projectService.archive({ projectId }, context('project-archive'));
    await goalService.archive({ goalId }, context('goal-archive'));
    const afterArchive = await goalService.progress(goalId);

    expect(beforeArchive).toEqual({
      goalId,
      completedTaskCount: 1,
      effectiveTaskCount: 3,
      completionRatio: 1 / 3,
    });
    expect(afterArchive).toEqual(beforeArchive);
    expect(unitOfWork.state.tasks.size).toBe(5);
    expect(unitOfWork.state.projects.get(projectId)?.archivedAt).toBe(
      FIRST_INSTANT,
    );
    expect(unitOfWork.state.goals.get(goalId)?.archivedAt).toBe(FIRST_INSTANT);
  });

  it('returns no synthetic percentage when a Goal has no effective Tasks', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const goalId = parseGoalId('goal-empty');
    unitOfWork.state.goals.set(
      goalId,
      createGoal({
        id: goalId,
        title: 'Empty goal',
        status: 'active',
        targetDate: parseLocalDate('2026-12-31'),
        createdAt: FIRST_INSTANT,
      }),
    );
    const service = new GoalService(dependencies(unitOfWork, []));

    await expect(service.progress(goalId)).resolves.toEqual({
      goalId,
      completedTaskCount: 0,
      effectiveTaskCount: 0,
      completionRatio: null,
    });
  });
});
