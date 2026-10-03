import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  GoalService,
  ProjectService,
  TaskService,
  type ApplicationUnitOfWork,
  type Clock,
  type IdGenerator,
  type LocalTime,
  type LocalTimeProvider,
  type WriteContext,
} from '@workspace/application';
import {
  initializeSqliteApplicationUnitOfWork,
  type SqliteDatabase,
  type SqliteExecutor,
  type SqliteParameters,
  type SqliteRunResult,
} from '@workspace/database';
import {
  parseInstant,
  parseLocalDate,
  parseTimeZoneId,
  type Instant,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function asNodeParameters(parameters: SqliteParameters): SQLInputValue[] {
  return [...parameters];
}

interface ControlledSqliteDatabase {
  readonly database: SqliteDatabase;
  readonly executedWrites: string[];
  failNextWriteMatching(pattern: RegExp): void;
}

function createControlledNodeSqliteAdapter(
  nativeDatabase: DatabaseSync,
): ControlledSqliteDatabase {
  let failurePattern: RegExp | null = null;
  const executedWrites: string[] = [];
  const executor: SqliteExecutor = {
    async run(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<SqliteRunResult> {
      executedWrites.push(sql);
      if (failurePattern?.test(sql) === true) {
        failurePattern = null;
        throw new Error('Injected SQLite write failure.');
      }
      const result = nativeDatabase
        .prepare(sql)
        .run(...asNodeParameters(parameters));
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },

    async get<TRow extends object>(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<TRow | undefined> {
      return nativeDatabase
        .prepare(sql)
        .get(...asNodeParameters(parameters)) as TRow | undefined;
    },

    async all<TRow extends object>(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<TRow[]> {
      return nativeDatabase
        .prepare(sql)
        .all(...asNodeParameters(parameters)) as TRow[];
    },
  };

  return {
    executedWrites,
    failNextWriteMatching(pattern: RegExp): void {
      failurePattern = pattern;
    },
    database: {
      ...executor,
      async transaction<Result>(
        work: (transaction: SqliteExecutor) => Promise<Result>,
      ): Promise<Result> {
        nativeDatabase.exec('BEGIN IMMEDIATE');
        try {
          const result = await work(executor);
          nativeDatabase.exec('COMMIT');
          return result;
        } catch (error) {
          nativeDatabase.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
}

class SequenceClock implements Clock {
  readonly #values: Instant[];
  #index = 0;

  constructor(...values: Instant[]) {
    this.#values = values;
  }

  now(): Instant {
    const value = this.#values[this.#index] ?? this.#values.at(-1);
    if (value === undefined) throw new Error('Missing test Clock value.');
    this.#index += 1;
    return value;
  }
}

class QueueIdGenerator implements IdGenerator {
  readonly #ids: string[];
  #index = 0;

  constructor(...ids: string[]) {
    this.#ids = ids;
  }

  generate(): string {
    const value = this.#ids[this.#index];
    if (value === undefined) throw new Error('Missing test identifier.');
    this.#index += 1;
    return value;
  }
}

class FixedLocalTimeProvider implements LocalTimeProvider {
  resolve(_instant: Instant): LocalTime {
    return {
      localDate: parseLocalDate('2026-09-12'),
      timeZone: parseTimeZoneId('Asia/Shanghai'),
    };
  }
}

const INSTANTS = [
  parseInstant('2026-09-12T01:00:00.000Z'),
  parseInstant('2026-09-12T02:00:00.000Z'),
  parseInstant('2026-09-12T03:00:00.000Z'),
  parseInstant('2026-09-12T04:00:00.000Z'),
  parseInstant('2026-09-12T05:00:00.000Z'),
] as const;

function context(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

function createTaskService(
  unitOfWork: ApplicationUnitOfWork,
  ids: string[],
): TaskService {
  return new TaskService({
    unitOfWork,
    clock: new SequenceClock(...INSTANTS),
    localTimeProvider: new FixedLocalTimeProvider(),
    idGenerator: new QueueIdGenerator(...ids),
  });
}

interface CountRow {
  readonly count: number;
}

interface ScheduleStateRow {
  readonly plan_revision: number;
  readonly state_version: number;
}

describe('Phase 1 application services over SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let controlled: ControlledSqliteDatabase;
  let unitOfWork: ApplicationUnitOfWork;

  beforeEach(async () => {
    nativeDatabase = new DatabaseSync(':memory:');
    controlled = createControlledNodeSqliteAdapter(nativeDatabase);
    unitOfWork = await initializeSqliteApplicationUnitOfWork(
      controlled.database,
      { now: () => INSTANTS[0] },
    );
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  async function count(table: string): Promise<number> {
    const row = await controlled.database.get<CountRow>(
      `SELECT COUNT(*) AS count FROM ${table}`,
    );
    if (row === undefined) throw new Error(`Missing ${table} count.`);
    return row.count;
  }

  async function scheduleState(): Promise<ScheduleStateRow> {
    const row = await controlled.database.get<ScheduleStateRow>(
      'SELECT state_version, plan_revision FROM schedule_state WHERE id = 1',
    );
    if (row === undefined) throw new Error('Missing schedule state.');
    return row;
  }

  it('persists a Goal/Project/Task flow, exact replays, and one completion fact', async () => {
    const goalService = new GoalService({
      unitOfWork,
      clock: new SequenceClock(...INSTANTS),
      idGenerator: new QueueIdGenerator('goal-1'),
    });
    const projectService = new ProjectService({
      unitOfWork,
      clock: new SequenceClock(...INSTANTS),
      idGenerator: new QueueIdGenerator('project-1'),
    });
    const taskService = createTaskService(unitOfWork, [
      'task-1',
      'activity-create',
      'activity-update',
      'completion-1',
      'activity-complete',
    ]);

    const goal = await goalService.create(
      { title: 'Ship Beta', status: 'active' },
      context('goal-create'),
    );
    const project = await projectService.create(
      {
        goalId: goal.goal.id,
        title: 'Phase 1',
        status: 'active',
      },
      context('project-create'),
    );
    const createInput = {
      goalId: goal.goal.id,
      projectId: project.project.id,
      title: 'Original Task title',
      estimatedDurationMinutes: 30,
    } as const;
    const created = await taskService.create(
      createInput,
      context('task-create'),
    );
    const updated = await taskService.update(
      {
        taskId: created.task.id,
        patch: { title: 'Updated Task title', priority: 'high' },
      },
      context('task-update'),
    );
    const completed = await taskService.complete(
      { taskId: created.task.id },
      context('task-complete'),
    );
    const replayedCreate = await taskService.create(
      createInput,
      context('task-create'),
    );
    const replayedCompletion = await taskService.complete(
      { taskId: created.task.id },
      context('task-complete'),
    );

    expect(created).toMatchObject({
      operationId: 'task-create',
      task: {
        status: 'inbox',
        goalId: 'goal-1',
        projectId: 'project-1',
        title: 'Original Task title',
      },
      stateVersion: 1,
      planRevision: 0,
    });
    expect(updated).toMatchObject({
      task: { title: 'Updated Task title', priority: 'high' },
      stateVersion: 2,
    });
    expect(completed).toMatchObject({
      task: { status: 'completed' },
      completionRecord: {
        id: 'completion-1',
        actualDurationSeconds: null,
        durationCoverage: 'unknown',
      },
      stateVersion: 3,
    });
    expect(replayedCreate).toEqual(created);
    expect(replayedCreate.task.status).toBe('inbox');
    expect(replayedCompletion).toEqual(completed);
    expect((await taskService.get(created.task.id)).status).toBe('completed');
    await expect(
      taskService.create(
        { ...createInput, title: 'Conflicting retry' },
        context('task-create'),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });

    const archivedProject = await projectService.archive(
      { projectId: project.project.id },
      context('project-archive'),
    );
    const archivedGoal = await goalService.archive(
      { goalId: goal.goal.id },
      context('goal-archive'),
    );
    expect(archivedProject.project.archivedAt).not.toBeNull();
    expect(archivedGoal.goal.archivedAt).not.toBeNull();

    await expect(goalService.list()).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(goalService.list({ includeArchived: true })).resolves.toEqual({
      items: [archivedGoal.goal],
      nextCursor: null,
    });
    await expect(
      projectService.list({ goalId: goal.goal.id }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      projectService.list({ goalId: goal.goal.id, includeArchived: true }),
    ).resolves.toEqual({ items: [archivedProject.project], nextCursor: null });

    await expect(goalService.progress(goal.goal.id)).resolves.toEqual({
      goalId: goal.goal.id,
      completedTaskCount: 1,
      effectiveTaskCount: 1,
      completionRatio: 1,
    });
    expect(await count('goals')).toBe(1);
    expect(await count('projects')).toBe(1);
    expect(await count('tasks')).toBe(1);
    expect(await count('completion_records')).toBe(1);
    expect(await count('operation_records')).toBe(7);
    expect(await count('task_activity_events')).toBe(3);
    expect(await scheduleState()).toEqual({
      state_version: 3,
      plan_revision: 0,
    });

    const storedCreate = await controlled.database.get<{
      readonly result_json: string;
    }>('SELECT result_json FROM operation_records WHERE operation_id = ?', [
      'task-create',
    ]);
    expect(JSON.parse(storedCreate?.result_json ?? '{}')).toMatchObject({
      operationId: 'task-create',
      task: { title: 'Original Task title', status: 'inbox' },
      stateVersion: 1,
      planRevision: 0,
    });
  });

  it('rejects status patching and parent cycles without partial facts', async () => {
    const taskService = createTaskService(unitOfWork, [
      'parent',
      'activity-parent',
      'child',
      'activity-child',
    ]);
    const parent = await taskService.create(
      { title: 'Parent' },
      context('parent-create'),
    );
    const child = await taskService.create(
      { title: 'Child', parentTaskId: parent.task.id },
      context('child-create'),
    );

    await expect(
      taskService.update(
        {
          taskId: child.task.id,
          patch: { status: 'completed' },
        } as never,
        context('status-patch'),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
    await expect(
      taskService.update(
        {
          taskId: parent.task.id,
          patch: { parentTaskId: child.task.id },
        },
        context('parent-cycle'),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });

    expect((await taskService.get(parent.task.id)).parentTaskId).toBeNull();
    expect(await count('tasks')).toBe(2);
    expect(await count('operation_records')).toBe(2);
    expect(await count('task_activity_events')).toBe(2);
    expect(await scheduleState()).toEqual({
      state_version: 2,
      plan_revision: 0,
    });
  });

  it('rolls back Task, Operation, Activity, completion, and version after an injected post-Operation failure', async () => {
    const taskService = createTaskService(unitOfWork, [
      'task-rollback',
      'activity-create',
      'completion-failed',
      'activity-failed',
      'completion-retry',
      'activity-retry',
    ]);
    const created = await taskService.create(
      { title: 'Atomic Task' },
      context('task-create'),
    );
    controlled.executedWrites.length = 0;
    controlled.failNextWriteMatching(/INSERT INTO completion_records/i);

    await expect(
      taskService.complete(
        { taskId: created.task.id },
        context('task-complete'),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      causeCategory: 'local_storage',
      retryable: true,
    });

    const attemptedSql = controlled.executedWrites.join('\n');
    expect(attemptedSql).toContain('INSERT INTO operation_records');
    expect(attemptedSql).toContain('INSERT INTO completion_records');
    expect(attemptedSql).toContain('UPDATE tasks');
    expect(attemptedSql.indexOf('INSERT INTO operation_records')).toBeLessThan(
      attemptedSql.indexOf('INSERT INTO completion_records'),
    );
    expect((await taskService.get(created.task.id)).status).toBe('inbox');
    expect(await count('completion_records')).toBe(0);
    expect(await count('operation_records')).toBe(1);
    expect(await count('task_activity_events')).toBe(1);
    expect(await scheduleState()).toEqual({
      state_version: 1,
      plan_revision: 0,
    });

    const retried = await taskService.complete(
      { taskId: created.task.id },
      context('task-complete'),
    );
    expect(retried).toMatchObject({
      task: { status: 'completed' },
      completionRecord: { id: 'completion-retry' },
      stateVersion: 2,
    });
    expect(await count('completion_records')).toBe(1);
    expect(await count('operation_records')).toBe(2);
    expect(await count('task_activity_events')).toBe(2);
    expect(await scheduleState()).toEqual({
      state_version: 2,
      plan_revision: 0,
    });
  });
});
