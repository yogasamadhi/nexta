import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  AchievementService,
  ExecutionService,
  TaskService,
  type Clock,
  type IdGenerator,
  type LocalTimeProvider,
  type WriteContext,
} from '@workspace/application';
import {
  databaseMigrations,
  initializeSqliteApplicationUnitOfWork,
  migrateDatabase,
  phase5ExecutionAchievementsMigration,
  phase5ExecutionAchievementsSql,
  type SqliteDatabase,
} from '@workspace/database';
import {
  createCommittedSchedulePlan,
  createTimeBlock,
  markTaskPlanned,
  parseInstant,
  parseLocalDate,
  parseSchedulePlanId,
  parseTimeBlockId,
  parseTimeZoneId,
  type Instant,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const T0 = parseInstant('2026-09-12T01:00:00.000Z');
const T1 = parseInstant('2026-09-12T02:00:00.000Z');
const T2 = parseInstant('2026-09-12T03:00:00.000Z');
const T3 = parseInstant('2026-09-12T04:00:00.000Z');
const T4 = parseInstant('2026-09-12T05:00:00.000Z');

class SequenceClock implements Clock {
  #index = 0;

  constructor(private readonly values: readonly Instant[]) {}

  now(): Instant {
    const value = this.values[this.#index] ?? this.values.at(-1);
    if (value === undefined) throw new Error('Test clock exhausted.');
    this.#index += 1;
    return value;
  }
}

class SequenceIds implements IdGenerator {
  #index = 0;

  constructor(private readonly values: readonly string[]) {}

  generate(): string {
    const value = this.values[this.#index];
    if (value === undefined) throw new Error('Test IDs exhausted.');
    this.#index += 1;
    return value;
  }
}

const localTime: LocalTimeProvider = {
  resolve: () => ({
    localDate: parseLocalDate('2026-09-12'),
    timeZone: parseTimeZoneId('Asia/Shanghai'),
  }),
};

function context(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

describe('Phase 5 Execution and Achievement SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('binds 0005 to checked-in SQL and upgrades completion evidence without rewriting history', async () => {
    const sqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0005_phase5_execution_achievements.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const normalizedSql = sqlFile.trim();
    expect(phase5ExecutionAchievementsSql).toBe(normalizedSql);
    expect(phase5ExecutionAchievementsMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedSql).digest('hex')}`,
    );
    expect(databaseMigrations[5]?.id).toBe(
      '0005_phase5_execution_achievements',
    );

    const through0004 = databaseMigrations.slice(0, 5);
    await migrateDatabase(database, { migrations: through0004, now: () => T0 });
    await database.run(
      `INSERT INTO tasks (
        id, title, status, priority, splittable, scheduling_policy, source,
        created_at, updated_at, completed_at
      ) VALUES ('legacy-task', 'Legacy completion', 'completed', 'normal', 0,
        'flexible', 'manual', ?, ?, ?)`,
      [T0, T1, T1],
    );
    await database.run(
      `INSERT INTO operation_records (
        operation_id, command_name, parameter_hash, result_json,
        base_state_version, current_state_version, occurred_at, diff_json
      ) VALUES ('legacy-operation', 'task.complete', 'hash', '{}', 0, 0, ?, NULL)`,
      [T1],
    );
    await database.run(
      `INSERT INTO completion_records (
        id, task_id, source_session_id, operation_id, completed_at,
        task_title_snapshot, actual_duration_seconds, duration_coverage,
        achievement_disposition, source
      ) VALUES ('legacy-completion', 'legacy-task', NULL, 'legacy-operation', ?,
        'Legacy completion', NULL, 'unknown', 'skip', 'user')`,
      [T1],
    );

    await expect(
      migrateDatabase(database, {
        migrations: databaseMigrations.slice(0, 6),
        now: () => T2,
      }),
    ).resolves.toEqual({
      applied: ['0005_phase5_execution_achievements'],
      alreadyApplied: through0004.map(({ id }) => id),
    });
    await expect(
      database.get<{ task_id: string; source_session_id: string | null }>(
        `SELECT task_id, source_session_id FROM completion_records
         WHERE id = 'legacy-completion'`,
      ),
    ).resolves.toEqual({ task_id: 'legacy-task', source_session_id: null });

    await database.run(
      `INSERT INTO execution_sessions (
        id, task_id, time_block_id, started_at, ended_at,
        paused_duration_seconds, active_interval_started_at, paused_at,
        status, completion_type, created_at, updated_at
      ) VALUES ('session-1', 'legacy-task', NULL, ?, NULL, 0, ?, NULL,
        'running', NULL, ?, ?)`,
      [T2, T2, T2, T2],
    );
    await expect(
      database.run(
        `INSERT INTO execution_sessions (
          id, task_id, started_at, paused_duration_seconds,
          active_interval_started_at, status, created_at, updated_at
        ) VALUES ('session-2', 'legacy-task', ?, 0, ?, 'running', ?, ?)`,
        [T2, T2, T2, T2],
      ),
    ).rejects.toThrow();
    await database.run(
      `INSERT INTO execution_intervals (
        id, session_id, kind, start_at, end_at, timing_quality
      ) VALUES ('interval-1', 'session-1', 'work', ?, NULL, 'trusted')`,
      [T2],
    );
    await expect(
      database.run(
        `INSERT INTO execution_intervals (
          id, session_id, kind, start_at, end_at, timing_quality
        ) VALUES ('interval-2', 'session-1', 'pause', ?, NULL, 'trusted')`,
        [T2],
      ),
    ).rejects.toThrow();
    await database.run(
      `INSERT INTO achievements (
        id, source_completion_record_id, source_task_id,
        source_execution_session_id, title, summary, evidence_type,
        occurred_at, user_edited, hidden, created_at, updated_at
      ) VALUES ('achievement-1', 'legacy-completion', 'legacy-task', NULL,
        'Legacy completion', NULL, 'task_completion', ?, 0, 0, ?, ?)`,
      [T1, T2, T2],
    );
    await expect(
      database.run(
        `INSERT INTO achievements (
          id, source_completion_record_id, source_task_id, title,
          evidence_type, occurred_at, user_edited, hidden, created_at,
          updated_at
        ) VALUES ('achievement-2', 'legacy-completion', 'legacy-task',
          'Duplicate', 'task_completion', ?, 0, 0, ?, ?)`,
        [T1, T2, T2],
      ),
    ).rejects.toThrow();
  });

  it('persists and restores the complete focus lifecycle through production repositories', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => T0,
    });
    const tasks = new TaskService({
      unitOfWork,
      clock: new SequenceClock([T0]),
      localTimeProvider: localTime,
      idGenerator: new SequenceIds(['task-1', 'activity-create']),
    });
    const created = await tasks.create(
      { title: 'Persist focus', estimatedDurationMinutes: 180 },
      context('operation-create'),
    );
    const execution = new ExecutionService({
      unitOfWork,
      clock: new SequenceClock([T1, T2, T3, T4]),
      localTimeProvider: localTime,
      ids: {
        session: new SequenceIds(['session-1']),
        interval: new SequenceIds([
          'interval-work-1',
          'interval-pause',
          'interval-work-2',
        ]),
        activity: new SequenceIds([
          'activity-start',
          'activity-pause',
          'activity-resume',
          'activity-complete',
        ]),
        completionRecord: new SequenceIds(['completion-1']),
        achievement: new SequenceIds(['achievement-1']),
        schedulePlan: new SequenceIds(['unused-plan']),
        integrationJob: new SequenceIds(['unused-job']),
      },
    });

    const started = await execution.start(
      { taskId: created.task.id },
      context('operation-start'),
    );
    await execution.pause(
      { sessionId: started.session.id },
      context('operation-pause'),
    );
    await execution.resume(
      { sessionId: started.session.id },
      context('operation-resume'),
    );
    const finished = await execution.finish(
      {
        sessionId: started.session.id,
        outcome: 'complete_task',
        recordAchievement: true,
      },
      context('operation-complete'),
    );

    expect(finished).toMatchObject({
      task: { status: 'completed', actualDurationMinutes: 120 },
      session: {
        status: 'completed',
        completionType: 'complete_task',
        pausedDurationSeconds: 3_600,
      },
      recordedWorkSeconds: 7_200,
      completionRecord: {
        actualDurationSeconds: 7_200,
        durationCoverage: 'partial',
      },
      achievement: { id: 'achievement-1' },
    });

    const restored = await execution.get(started.session.id);
    expect(restored).toMatchObject({
      session: { status: 'completed' },
      task: { status: 'completed' },
      recordedWorkSeconds: 7_200,
    });
    const diary = new AchievementService({
      unitOfWork,
      clock: new SequenceClock([T4]),
      idGenerator: new SequenceIds(['unused-achievement']),
    });
    expect(await diary.listAll()).toMatchObject([
      { id: 'achievement-1', sourceCompletionRecordId: 'completion-1' },
    ]);
    await expect(
      database.get<{ count: number }>(
        'SELECT count(*) AS count FROM operation_records',
      ),
    ).resolves.toEqual({ count: 5 });
  });

  it('cancels a planned Task and persists projection cleanup as one SQLite transaction', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => T0,
    });
    const creator = new TaskService({
      unitOfWork,
      clock: new SequenceClock([T0]),
      localTimeProvider: localTime,
      idGenerator: new SequenceIds(['task-cancel', 'activity-create']),
    });
    const created = await creator.create(
      { title: 'Cancel persisted plan', estimatedDurationMinutes: 120 },
      context('operation-create-cancel'),
    );
    await unitOfWork.transaction(async (transaction) => {
      await transaction.tasks.update(markTaskPlanned(created.task, T1));
      await transaction.schedulePlans.insert(
        createCommittedSchedulePlan({
          id: parseSchedulePlanId('plan-cancel-1'),
          planRevision: 1,
          basedOnStateVersion: 1,
          createdAt: T1,
          committedAt: T1,
          inputHash: 'seed-cancel',
          schedulerVersion: 'test',
          policyVersion: 'test',
          timeZone: parseTimeZoneId('Asia/Shanghai'),
          horizonStart: T2,
          horizonEnd: T4,
          reason: 'test_seed',
        }),
      );
      for (const [id, startAt, endAt] of [
        ['block-cancel-1', T2, T3],
        ['block-cancel-2', T3, T4],
      ] as const) {
        await transaction.timeBlocks.insert(
          createTimeBlock({
            id: parseTimeBlockId(id),
            taskId: created.task.id,
            type: 'task',
            startAt,
            endAt,
            status: 'planned',
            source: 'scheduler',
            locked: false,
            planRevision: 1,
            createdAt: T1,
          }),
        );
      }
      await transaction.scheduleState.update({
        stateVersion: 2,
        planRevision: 1,
      });
    });
    const tasks = new TaskService({
      unitOfWork,
      clock: new SequenceClock([T2]),
      localTimeProvider: localTime,
      idGenerator: new SequenceIds([
        'plan-cancel-2',
        'job-cancel-calendar',
        'job-cancel-notification',
        'activity-cancel',
      ]),
    });

    const canceled = await tasks.cancel(
      { taskId: created.task.id },
      context('operation-cancel'),
    );
    const persisted = await unitOfWork.transaction(async (transaction) => ({
      task: await transaction.tasks.findById(created.task.id),
      blocks: await transaction.timeBlocks.listAll(),
      plan: await transaction.schedulePlans.findByRevision(2),
      jobs: await transaction.integrationJobs.listByOperationId(
        canceled.operationId,
      ),
      state: await transaction.scheduleState.get(),
      completion: await transaction.completionRecords.findByTaskId(
        created.task.id,
      ),
    }));

    expect(canceled).toMatchObject({
      task: { status: 'canceled', canceledAt: T2 },
      stateVersion: 3,
      planRevision: 2,
      calendar: 'pending',
      notifications: 'pending',
    });
    expect(persisted.task).toMatchObject({ status: 'canceled' });
    expect(
      persisted.blocks.map((block) => ({
        id: block.id,
        status: block.status,
        planRevision: block.planRevision,
      })),
    ).toEqual([
      { id: 'block-cancel-1', status: 'canceled', planRevision: 2 },
      { id: 'block-cancel-2', status: 'canceled', planRevision: 2 },
    ]);
    expect(persisted.plan).toMatchObject({
      id: 'plan-cancel-2',
      reason: 'task_cancel',
    });
    expect(persisted.jobs).toHaveLength(2);
    expect(persisted.jobs.map((job) => job.targetChannel).sort()).toEqual([
      'calendar',
      'notification',
    ]);
    expect(persisted.state).toEqual({ stateVersion: 3, planRevision: 2 });
    expect(persisted.completion).toBeNull();
  });
});
