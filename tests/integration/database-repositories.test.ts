import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  createSqliteApplicationUnitOfWork,
  initializeSqliteApplicationUnitOfWork,
  migrateDatabase,
  type SqliteDatabase,
  type SqliteExecutor,
  type SqliteParameters,
  type SqliteRunResult,
} from '@workspace/database';
import {
  archiveGoal,
  archiveProject,
  completeTask,
  createCompletionRecord,
  createGoal,
  createOperationRecord,
  createProject,
  createTask,
  createTaskActivityEvent,
  parseCompletionRecordId,
  parseGoalId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseProjectId,
  parseTaskActivityEventId,
  parseTaskId,
  parseTimeZoneId,
  updateGoal,
  updateProject,
  updateTask,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function asNodeParameters(parameters: SqliteParameters): SQLInputValue[] {
  return [...parameters];
}

function createNodeSqliteAdapter(database: DatabaseSync): SqliteDatabase {
  const executor: SqliteExecutor = {
    async run(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<SqliteRunResult> {
      const result = database.prepare(sql).run(...asNodeParameters(parameters));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },

    async get<TRow extends object>(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<TRow | undefined> {
      return database.prepare(sql).get(...asNodeParameters(parameters)) as
        TRow | undefined;
    },

    async all<TRow extends object>(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<TRow[]> {
      return database
        .prepare(sql)
        .all(...asNodeParameters(parameters)) as TRow[];
    },
  };

  return {
    ...executor,
    async transaction<TResult>(
      work: (transaction: SqliteExecutor) => Promise<TResult>,
    ): Promise<TResult> {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(executor);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const firstInstant = parseInstant('2026-09-12T08:00:00.000Z');
const secondInstant = parseInstant('2026-09-12T09:30:00.000Z');
const localDate = parseLocalDate('2026-09-12');
const timeZone = parseTimeZoneId('Asia/Shanghai');

describe('SQLite application repositories', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteAdapter(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('commits and maps Goal, Project, Task, Operation, Activity, and ScheduleState facts', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => firstInstant,
    });
    const goal = createGoal({
      id: parseGoalId('goal-1'),
      title: 'Ship the first useful version',
      description: 'A concrete outcome',
      status: 'active',
      targetDate: parseLocalDate('2026-10-01'),
      createdAt: firstInstant,
    });
    const project = createProject({
      id: parseProjectId('project-1'),
      goalId: goal.id,
      title: 'Phase 1',
      description: 'Offline foundation',
      status: 'active',
      deadline: parseInstant('2026-09-30T16:00:00.000Z'),
      createdAt: firstInstant,
    });
    const parent = createTask({
      id: parseTaskId('task-parent'),
      projectId: project.id,
      goalId: goal.id,
      title: 'Foundation',
      description: 'Grouping task',
      priority: 'high',
      estimatedDurationMinutes: 45.5,
      remainingDurationMinutes: 30.25,
      earliestStartAt: parseInstant('2026-09-13T01:00:00.000Z'),
      deadlineAt: parseInstant('2026-09-13T04:00:00.000Z'),
      deadlineLocalDate: parseLocalDate('2026-09-13'),
      deadlineTimeZone: timeZone,
      splittable: true,
      minBlockMinutes: 12.5,
      maxBlockMinutes: 30.25,
      categoryKey: 'engineering',
      energyDemand: 'high',
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: firstInstant,
    });
    const child = createTask({
      id: parseTaskId('task-child'),
      projectId: project.id,
      goalId: goal.id,
      parentTaskId: parent.id,
      title: 'Create schema',
      priority: 'normal',
      estimatedDurationMinutes: 12.5,
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: secondInstant,
    });
    const operation = createOperationRecord({
      operationId: parseOperationId('operation-create'),
      command: 'task.create',
      parameterHash: `sha256:${'a'.repeat(64)}`,
      resultJson: JSON.stringify({ taskId: child.id }),
      baseStateVersion: 0,
      currentStateVersion: 1,
      occurredAt: secondInstant,
      diffJson: JSON.stringify({ insertedTaskId: child.id }),
    });
    const activity = createTaskActivityEvent({
      id: parseTaskActivityEventId('activity-create'),
      taskId: child.id,
      eventType: 'create',
      actor: 'user',
      occurredAt: secondInstant,
      localDate,
      timeZone,
      operationId: operation.operationId,
      beforeSummary: null,
      afterSummary: { status: 'inbox', estimatedMinutes: 12.5 },
    });

    await unitOfWork.transaction(async (transaction) => {
      await transaction.goals.insert(goal);
      await transaction.projects.insert(project);
      // Dependent Completion/Activity facts intentionally follow the operation.
      await transaction.operationRecords.insert(operation);
      await transaction.tasks.insert(parent);
      await transaction.tasks.insert(child);
      await transaction.taskActivityEvents.insert(activity);
      await transaction.scheduleState.update({
        stateVersion: 1,
        planRevision: 0,
      });
    });

    await unitOfWork.transaction(async (transaction) => {
      await expect(transaction.goals.findById(goal.id)).resolves.toEqual(goal);
      await expect(transaction.goals.listAll()).resolves.toEqual([goal]);
      await expect(transaction.projects.findById(project.id)).resolves.toEqual(
        project,
      );
      await expect(transaction.projects.listAll()).resolves.toEqual([project]);
      await expect(transaction.tasks.findById(parent.id)).resolves.toEqual(
        parent,
      );
      await expect(transaction.tasks.findById(child.id)).resolves.toEqual(
        child,
      );
      await expect(
        transaction.operationRecords.findById(operation.operationId),
      ).resolves.toEqual(operation);
      await expect(transaction.projects.listByGoalId(goal.id)).resolves.toEqual(
        [project],
      );
      await expect(transaction.tasks.listByGoalId(goal.id)).resolves.toEqual([
        parent,
        child,
      ]);
      await expect(
        transaction.tasks.listByProjectIds([project.id, project.id]),
      ).resolves.toEqual([parent, child]);
      await expect(
        transaction.tasks.listByParentIds([parent.id]),
      ).resolves.toEqual([child]);
      await expect(transaction.tasks.listByProjectIds([])).resolves.toEqual([]);
      await expect(transaction.scheduleState.get()).resolves.toEqual({
        stateVersion: 1,
        planRevision: 0,
      });
    });

    const storedActivity = await database.get<{
      readonly after_summary: string;
      readonly before_summary: string | null;
      readonly splittable: number;
    }>(
      `SELECT a.after_summary, a.before_summary, t.splittable
       FROM task_activity_events a
       JOIN tasks t ON t.id = a.task_id
       WHERE a.id = ?`,
      [activity.id],
    );
    expect(storedActivity).toEqual({
      after_summary: JSON.stringify(activity.afterSummary),
      before_summary: null,
      splittable: 0,
    });
  });

  it('rolls back repository and version writes when application work rejects', async () => {
    await migrateDatabase(database, { now: () => firstInstant });
    const unitOfWork = createSqliteApplicationUnitOfWork(database);
    const goal = createGoal({
      id: parseGoalId('goal-rollback'),
      title: 'Must roll back',
      status: 'active',
      createdAt: firstInstant,
    });

    await expect(
      unitOfWork.transaction(async (transaction) => {
        await transaction.goals.insert(goal);
        await transaction.scheduleState.update({
          stateVersion: 1,
          planRevision: 0,
        });
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');

    await unitOfWork.transaction(async (transaction) => {
      await expect(transaction.goals.findById(goal.id)).resolves.toBeNull();
      await expect(transaction.scheduleState.get()).resolves.toEqual({
        stateVersion: 0,
        planRevision: 0,
      });
    });
  });

  it('persists full entity updates and preserves archived relation facts', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => firstInstant,
    });
    const originalGoal = createGoal({
      id: parseGoalId('goal-update'),
      title: 'Original goal',
      status: 'active',
      createdAt: firstInstant,
    });
    const originalProject = createProject({
      id: parseProjectId('project-update'),
      goalId: originalGoal.id,
      title: 'Original project',
      status: 'active',
      createdAt: firstInstant,
    });
    const originalTask = createTask({
      id: parseTaskId('task-update'),
      projectId: originalProject.id,
      goalId: originalGoal.id,
      title: 'Original task',
      priority: 'normal',
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: firstInstant,
    });

    await unitOfWork.transaction(async (transaction) => {
      await transaction.goals.insert(originalGoal);
      await transaction.projects.insert(originalProject);
      await transaction.tasks.insert(originalTask);
    });

    const updatedGoal = archiveGoal(
      updateGoal(
        originalGoal,
        { title: 'Updated goal', status: 'paused' },
        secondInstant,
      ),
      secondInstant,
    );
    const updatedProject = archiveProject(
      updateProject(
        originalProject,
        { title: 'Updated project', deadline: secondInstant },
        secondInstant,
      ),
      secondInstant,
    );
    const updatedTask = updateTask(
      originalTask,
      {
        title: 'Updated task',
        estimatedDurationMinutes: 22.75,
        splittable: true,
        minBlockMinutes: 10.5,
        maxBlockMinutes: 20.5,
      },
      secondInstant,
    );

    await unitOfWork.transaction(async (transaction) => {
      await transaction.goals.update(updatedGoal);
      await transaction.projects.update(updatedProject);
      await transaction.tasks.update(updatedTask);
    });

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.goals.findById(originalGoal.id),
      ).resolves.toEqual(updatedGoal);
      await expect(
        transaction.projects.findById(originalProject.id),
      ).resolves.toEqual(updatedProject);
      await expect(
        transaction.tasks.findById(originalTask.id),
      ).resolves.toEqual(updatedTask);
      await expect(
        transaction.projects.listByGoalId(originalGoal.id),
      ).resolves.toEqual([updatedProject]);
      await expect(
        transaction.tasks.listByProjectIds([originalProject.id]),
      ).resolves.toEqual([updatedTask]);
    });
  });

  it('stores one completion per Task and rolls back a duplicate operation with it', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => firstInstant,
    });
    const initialTask = createTask({
      id: parseTaskId('task-complete'),
      title: 'Complete once',
      priority: 'normal',
      estimatedDurationMinutes: 20,
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: firstInstant,
    });
    await unitOfWork.transaction((transaction) =>
      transaction.tasks.insert(initialTask),
    );

    const completedTask = completeTask(initialTask, {
      completedAt: secondInstant,
    });
    const operation = createOperationRecord({
      operationId: parseOperationId('operation-complete'),
      command: 'task.complete',
      parameterHash: `sha256:${'b'.repeat(64)}`,
      resultJson: JSON.stringify({ taskId: initialTask.id }),
      baseStateVersion: 0,
      currentStateVersion: 1,
      occurredAt: secondInstant,
    });
    const completion = createCompletionRecord({
      id: parseCompletionRecordId('completion-1'),
      taskId: initialTask.id,
      operationId: operation.operationId,
      completedAt: secondInstant,
      taskTitleSnapshot: initialTask.title,
      actualDurationSeconds: 95.25,
      durationCoverage: 'partial',
      achievementDisposition: 'record',
      source: 'user',
    });

    await unitOfWork.transaction(async (transaction) => {
      await transaction.operationRecords.insert(operation);
      await transaction.tasks.update(completedTask);
      await transaction.completionRecords.insert(completion);
    });

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.completionRecords.findByTaskId(initialTask.id),
      ).resolves.toEqual(completion);
      await expect(transaction.tasks.findById(initialTask.id)).resolves.toEqual(
        completedTask,
      );
    });

    const duplicateOperation = createOperationRecord({
      operationId: parseOperationId('operation-duplicate'),
      command: 'task.complete',
      parameterHash: `sha256:${'c'.repeat(64)}`,
      resultJson: JSON.stringify({ taskId: initialTask.id }),
      baseStateVersion: 1,
      currentStateVersion: 1,
      occurredAt: secondInstant,
    });
    const duplicateCompletion = createCompletionRecord({
      id: parseCompletionRecordId('completion-duplicate'),
      taskId: initialTask.id,
      operationId: duplicateOperation.operationId,
      completedAt: secondInstant,
      taskTitleSnapshot: initialTask.title,
      durationCoverage: 'unknown',
      achievementDisposition: 'skip',
      source: 'user',
    });

    await expect(
      unitOfWork.transaction(async (transaction) => {
        await transaction.operationRecords.insert(duplicateOperation);
        await transaction.completionRecords.insert(duplicateCompletion);
      }),
    ).rejects.toThrow();

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.operationRecords.findById(duplicateOperation.operationId),
      ).resolves.toBeNull();
      await expect(
        transaction.completionRecords.findByTaskId(initialTask.id),
      ).resolves.toEqual(completion);
    });
  });

  it('requires an OperationRecord before inserting dependent activity facts', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => firstInstant,
    });
    const task = createTask({
      id: parseTaskId('task-operation-order'),
      title: 'Ordering',
      priority: 'normal',
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: firstInstant,
    });
    const event = createTaskActivityEvent({
      id: parseTaskActivityEventId('activity-operation-order'),
      taskId: task.id,
      eventType: 'create',
      actor: 'user',
      occurredAt: firstInstant,
      localDate,
      timeZone,
      operationId: parseOperationId('missing-operation'),
    });

    await unitOfWork.transaction((transaction) =>
      transaction.tasks.insert(task),
    );
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.taskActivityEvents.insert(event),
      ),
    ).rejects.toThrow();
  });

  it('reports corrupted stored rows as non-retryable adapter integrity errors', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => firstInstant,
    });
    const task = createTask({
      id: parseTaskId('task-corrupt'),
      title: 'Initially valid',
      priority: 'normal',
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: firstInstant,
    });
    await unitOfWork.transaction((transaction) =>
      transaction.tasks.insert(task),
    );

    await database.run('PRAGMA ignore_check_constraints = ON');
    await database.run(`UPDATE tasks SET priority = '' WHERE id = ?`, [
      task.id,
    ]);
    await database.run('PRAGMA ignore_check_constraints = OFF');

    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.tasks.findById(task.id),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      retryable: false,
      causeCategory: 'data_integrity',
    });
  });
});
