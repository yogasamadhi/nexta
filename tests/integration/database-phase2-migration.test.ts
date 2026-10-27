import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  DatabaseMigrationError,
  databaseMigrations,
  migrateDatabase,
  phase1FoundationMigration,
  phase2ScheduleCommitMigration,
  phase2ScheduleCommitSql,
  phase2Schema,
  type SqliteDatabase,
  type SqliteMigration,
} from '@workspace/database';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNodeSqliteDatabase,
  insertOperationRecord,
  insertPhase1Task,
} from './database-test-support';

interface NameRow {
  readonly name: string;
}

interface CountRow {
  readonly count: number;
}

interface MigrationRow {
  readonly checksum: string;
  readonly id: string;
}

interface TableInfoRow {
  readonly dflt_value: string | null;
  readonly name: string;
  readonly notnull: number;
  readonly pk: number;
  readonly type: string;
}

interface IndexRow {
  readonly name: string;
  readonly unique: number;
}

interface IndexInfoRow {
  readonly name: string;
  readonly seqno: number;
}

interface ForeignKeyRow {
  readonly from: string;
  readonly on_delete: string;
  readonly on_update: string;
  readonly table: string;
  readonly to: string;
}

interface TableSqlRow {
  readonly sql: string;
}

const firstInstant = '2026-09-12T08:00:00.000Z';
const secondInstant = '2026-09-12T09:00:00.000Z';
const horizonEnd = '2026-09-13T08:00:00.000Z';

const criticalCheckSqlByTable: Readonly<Record<string, readonly string[]>> = {
  schedule_plans: [
    'plan_revision>0',
    'based_on_state_version>=0',
    "status='committed'",
    'horizon_end>horizon_start',
  ],
  time_blocks: [
    "typein('task','break','relax','buffer')",
    "statusin('planned','started','completed','skipped','canceled')",
    'end_at>start_at',
    "type<>'task'ortask_idisnotnull",
    'lockedin(0,1)',
    'plan_revision>=0',
  ],
  integration_jobs: [
    "target_channelin('calendar','notification')",
    "target_entity_type='schedule_plan'",
    "desired_action='reconcile'",
    "statusin('pending','processing','succeeded','permission_required','failed','disabled','reconciliation_required','superseded')",
    'attempt_count>=0',
  ],
};

function normalizeSchemaSql(sql: string): string {
  return sql.toLowerCase().replaceAll(/[`"\s]/g, '');
}

function sortForeignKeys(rows: readonly ForeignKeyRow[]): ForeignKeyRow[] {
  return [...rows]
    .map((row) => ({
      from: row.from,
      on_delete: row.on_delete,
      on_update: row.on_update,
      table: row.table,
      to: row.to,
    }))
    .sort((left, right) =>
      `${left.from}:${left.table}:${left.to}`.localeCompare(
        `${right.from}:${right.table}:${right.to}`,
      ),
    );
}

async function insertCommittedPlan(
  database: SqliteDatabase,
  values: {
    readonly id?: string;
    readonly planRevision?: number;
    readonly status?: string;
    readonly horizonStart?: string;
    readonly horizonEnd?: string;
  } = {},
): Promise<void> {
  await database.run(
    `INSERT INTO schedule_plans (
      id, plan_revision, based_on_state_version, status, created_at,
      committed_at, input_hash, scheduler_version, policy_version,
      time_zone, horizon_start, horizon_end, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.id ?? 'plan-1',
      values.planRevision ?? 1,
      0,
      values.status ?? 'committed',
      firstInstant,
      firstInstant,
      `sha256:${'b'.repeat(64)}`,
      'scheduler-v1',
      'policy-v1',
      'Asia/Shanghai',
      values.horizonStart ?? firstInstant,
      values.horizonEnd ?? horizonEnd,
      'user_request',
    ],
  );
}

describe('Phase 2 SQLite migration', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('keeps 0000 immutable and binds 0001 to the checked-in SQL digest', async () => {
    const sqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0001_phase2_schedule_commit.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const normalizedSql = sqlFile.trim();

    expect(phase1FoundationMigration.checksum).toBe(
      'sha256:6c202fff658b485ac387b186934cc7521d17abcb4762215e521ea9260d1f7636',
    );
    expect(phase2ScheduleCommitSql).toBe(normalizedSql);
    expect(phase2ScheduleCommitMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedSql).digest('hex')}`,
    );
    expect(databaseMigrations.map((migration) => migration.id)).toEqual([
      '0000_phase1_foundation',
      '0001_phase2_schedule_commit',
      '0002_phase3_calendar_notifications',
      '0003_phase3_external_mutation_intents',
      '0004_phase4_user_preferences',
      '0005_phase5_execution_achievements',
      '0006_phase6_agent_runs',
      '0007_phase7_user_model_features',
      '0008_phase8_wellbeing',
      '0009_cloud_sync',
      '0010_cloud_bootstrap',
    ]);
  });

  it('upgrades an existing 0000 database, preserves facts, and reruns exactly once', async () => {
    await migrateDatabase(database, {
      migrations: [phase1FoundationMigration],
      now: () => firstInstant,
    });
    await insertPhase1Task(database, 'existing-task', firstInstant);
    await database.run(
      'UPDATE schedule_state SET state_version = 7, plan_revision = 0 WHERE id = 1',
    );

    const upgrade = await migrateDatabase(database, {
      now: () => secondInstant,
    });
    const rerun = await migrateDatabase(database, {
      now: () => horizonEnd,
    });

    expect(upgrade).toEqual({
      applied: [
        '0001_phase2_schedule_commit',
        '0002_phase3_calendar_notifications',
        '0003_phase3_external_mutation_intents',
        '0004_phase4_user_preferences',
        '0005_phase5_execution_achievements',
        '0006_phase6_agent_runs',
        '0007_phase7_user_model_features',
        '0008_phase8_wellbeing',
        '0009_cloud_sync',
        '0010_cloud_bootstrap',
      ],
      alreadyApplied: ['0000_phase1_foundation'],
    });
    expect(rerun).toEqual({
      applied: [],
      alreadyApplied: databaseMigrations.map((migration) => migration.id),
    });
    await expect(
      database.get<{ readonly title: string }>(
        'SELECT title FROM tasks WHERE id = ?',
        ['existing-task'],
      ),
    ).resolves.toEqual({ title: 'Task existing-task' });
    await expect(
      database.get<{
        readonly plan_revision: number;
        readonly state_version: number;
      }>(
        'SELECT state_version, plan_revision FROM schedule_state WHERE id = 1',
      ),
    ).resolves.toEqual({ state_version: 7, plan_revision: 0 });
    await expect(
      database.all<MigrationRow>(
        'SELECT id, checksum FROM __nexta_migrations ORDER BY sequence',
      ),
    ).resolves.toEqual(
      databaseMigrations.map(({ id, checksum }) => ({ id, checksum })),
    );

    const tables = await database.all<NameRow>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    );
    expect(tables.map((row) => row.name)).toContain('schedule_plans');
    expect(tables.map((row) => row.name)).toContain('time_blocks');
    expect(tables.map((row) => row.name)).toContain('integration_jobs');
    expect(tables.some((row) => row.name.includes('task_depend'))).toBe(false);
  });

  it('reproduces every Phase 2 Drizzle column, check, index, and foreign key', async () => {
    await migrateDatabase(database, { now: () => firstInstant });

    for (const drizzleTable of Object.values(phase2Schema).map((table) =>
      getTableConfig(table),
    )) {
      const columns = await database.all<TableInfoRow>(
        `PRAGMA table_info('${drizzleTable.name}')`,
      );
      expect(
        columns.map((column) => ({
          defaultValue: column.dflt_value,
          name: column.name,
          notNull: column.notnull === 1,
          primary: column.pk > 0,
          type: column.type.toLowerCase(),
        })),
      ).toEqual(
        drizzleTable.columns.map((column) => ({
          defaultValue:
            column.default === undefined
              ? null
              : typeof column.default === 'string'
                ? `'${column.default.replaceAll("'", "''")}'`
                : String(column.default),
          name: column.name,
          notNull: column.notNull,
          primary: column.primary,
          type: column.getSQLType().toLowerCase(),
        })),
      );

      const tableDefinition = await database.get<TableSqlRow>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [drizzleTable.name],
      );
      const migratedConstraintNames = [
        ...(tableDefinition?.sql.matchAll(
          /CONSTRAINT\s+[`"]([^`"]+)[`"]\s+CHECK/giu,
        ) ?? []),
      ]
        .map((match) => match[1])
        .sort();
      expect(migratedConstraintNames).toEqual(
        drizzleTable.checks.map((constraint) => constraint.name).sort(),
      );
      const normalizedTableSql = normalizeSchemaSql(tableDefinition?.sql ?? '');
      for (const expectedCheck of criticalCheckSqlByTable[drizzleTable.name] ??
        []) {
        expect(normalizedTableSql).toContain(expectedCheck);
      }

      const indexes = await database.all<IndexRow>(
        `PRAGMA index_list('${drizzleTable.name}')`,
      );
      for (const expectedIndex of drizzleTable.indexes) {
        expect(
          indexes.find((index) => index.name === expectedIndex.config.name),
        ).toMatchObject({
          name: expectedIndex.config.name,
          unique: expectedIndex.config.unique ? 1 : 0,
        });
        const indexColumns = await database.all<IndexInfoRow>(
          `PRAGMA index_info('${expectedIndex.config.name}')`,
        );
        expect(
          indexColumns
            .sort((left, right) => left.seqno - right.seqno)
            .map((column) => column.name),
        ).toEqual(
          expectedIndex.config.columns.map(
            (column) => (column as { readonly name: string }).name,
          ),
        );
      }

      const actualForeignKeys = await database.all<ForeignKeyRow>(
        `PRAGMA foreign_key_list('${drizzleTable.name}')`,
      );
      const expectedForeignKeys = drizzleTable.foreignKeys.flatMap(
        (foreignKey) => {
          const reference = foreignKey.reference();
          const foreignTable = getTableConfig(reference.foreignTable).name;
          return reference.columns.map((column, index) => ({
            from: column.name,
            on_delete: (foreignKey.onDelete ?? 'no action').toUpperCase(),
            on_update: (foreignKey.onUpdate ?? 'no action').toUpperCase(),
            table: foreignTable,
            to: reference.foreignColumns[index]?.name ?? '',
          }));
        },
      );
      expect(sortForeignKeys(actualForeignKeys)).toEqual(
        sortForeignKeys(expectedForeignKeys),
      );
    }
  });

  it('rolls back a failed 0001 without changing Phase 1 data or history', async () => {
    const failingMigration = {
      id: '0001_phase2_intentional_failure',
      checksum: `sha256:${'f'.repeat(64)}`,
      sql: `${phase2ScheduleCommitSql}
        --> statement-breakpoint
        INSERT INTO missing_phase2_table (id) VALUES ('boom');`,
    } as const satisfies SqliteMigration;

    await migrateDatabase(database, {
      migrations: [phase1FoundationMigration],
      now: () => firstInstant,
    });
    await insertPhase1Task(database, 'survives-failed-upgrade', firstInstant);

    await expect(
      migrateDatabase(database, {
        migrations: [phase1FoundationMigration, failingMigration],
        now: () => firstInstant,
      }),
    ).rejects.toMatchObject({
      code: 'migration_failed',
      migrationId: '0001_phase2_intentional_failure',
    } satisfies Partial<DatabaseMigrationError>);

    await expect(
      database.get<NameRow>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'schedule_plans'`,
      ),
    ).resolves.toBeUndefined();
    await expect(
      database.all<{ readonly id: string }>(
        'SELECT id FROM __nexta_migrations ORDER BY sequence',
      ),
    ).resolves.toEqual([{ id: phase1FoundationMigration.id }]);
    await expect(
      database.get<CountRow>('SELECT count(*) AS count FROM schedule_state'),
    ).resolves.toEqual({ count: 1 });
    await expect(
      database.get<{ readonly title: string }>(
        'SELECT title FROM tasks WHERE id = ?',
        ['survives-failed-upgrade'],
      ),
    ).resolves.toEqual({ title: 'Task survives-failed-upgrade' });
  });

  it('enforces schedule, block, job, revision, uniqueness, and FK invariants', async () => {
    await migrateDatabase(database, { now: () => firstInstant });
    await insertPhase1Task(database, 'task-1', firstInstant);
    await insertOperationRecord(database, 'operation-1', firstInstant);
    await insertCommittedPlan(database);

    await expect(
      insertCommittedPlan(database, { id: 'zero-plan', planRevision: 0 }),
    ).rejects.toThrow();
    await expect(
      insertCommittedPlan(database, { id: 'draft-plan', status: 'draft' }),
    ).rejects.toThrow();
    await expect(
      insertCommittedPlan(database, {
        id: 'reversed-plan',
        planRevision: 2,
        horizonStart: horizonEnd,
        horizonEnd: firstInstant,
      }),
    ).rejects.toThrow();
    await expect(
      insertCommittedPlan(database, { id: 'duplicate-revision' }),
    ).rejects.toThrow();

    await database.run(
      `INSERT INTO time_blocks (
        id, task_id, type, start_at, end_at, status, source, locked,
        plan_revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'block-1',
        'task-1',
        'task',
        firstInstant,
        secondInstant,
        'planned',
        'scheduler',
        0,
        1,
        firstInstant,
        firstInstant,
      ],
    );
    await expect(
      database.run(
        `INSERT INTO time_blocks (
          id, task_id, type, start_at, end_at, status, source, locked,
          plan_revision, created_at, updated_at
        ) VALUES ('orphan-task-block', NULL, 'task', ?, ?, 'planned',
          'scheduler', 0, 1, ?, ?)`,
        [firstInstant, secondInstant, firstInstant, firstInstant],
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO time_blocks (
          id, task_id, type, start_at, end_at, status, source, locked,
          plan_revision, created_at, updated_at
        ) VALUES ('missing-task-block', 'missing', 'task', ?, ?, 'planned',
          'scheduler', 0, 1, ?, ?)`,
        [firstInstant, secondInstant, firstInstant, firstInstant],
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `UPDATE time_blocks SET end_at = start_at WHERE id = 'block-1'`,
      ),
    ).rejects.toThrow();

    await database.run(
      `INSERT INTO integration_jobs (
        id, operation_id, target_channel, target_entity_type,
        target_entity_id, desired_revision, desired_action, status,
        attempt_count, automatic_retry_eligible, not_before, created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'job-1',
        'operation-1',
        'calendar',
        'schedule_plan',
        'plan-1',
        1,
        'reconcile',
        'pending',
        0,
        1,
        firstInstant,
        firstInstant,
        firstInstant,
      ],
    );
    await expect(
      database.run(
        `INSERT INTO integration_jobs (
          id, operation_id, target_channel, target_entity_type,
          target_entity_id, desired_revision, desired_action, status,
          attempt_count, automatic_retry_eligible, not_before, created_at,
          updated_at
        ) VALUES ('bad-action', 'operation-1', 'notification',
          'schedule_plan', 'plan-1', 1, 'create', 'pending', 0, 1, ?, ?, ?)`,
        [firstInstant, firstInstant, firstInstant],
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO integration_jobs (
          id, operation_id, target_channel, target_entity_type,
          target_entity_id, desired_revision, desired_action, status,
          attempt_count, automatic_retry_eligible, not_before, created_at,
          updated_at
        ) VALUES ('missing-operation', 'missing', 'notification',
          'schedule_plan', 'plan-1', 1, 'reconcile', 'pending', 0, 1, ?, ?, ?)`,
        [firstInstant, firstInstant, firstInstant],
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO integration_jobs (
          id, operation_id, target_channel, target_entity_type,
          target_entity_id, desired_revision, desired_action, status,
          attempt_count, automatic_retry_eligible, not_before, created_at,
          updated_at
        ) VALUES ('missing-plan', 'operation-1', 'notification',
          'schedule_plan', 'missing', 1, 'reconcile', 'pending', 0, 1, ?, ?, ?)`,
        [firstInstant, firstInstant, firstInstant],
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO integration_jobs (
          id, operation_id, target_channel, target_entity_type,
          target_entity_id, desired_revision, desired_action, status,
          attempt_count, automatic_retry_eligible, not_before, created_at,
          updated_at
        ) VALUES ('duplicate-job', 'operation-1', 'calendar',
          'schedule_plan', 'plan-1', 1, 'reconcile', 'pending', 0, 1, ?, ?, ?)`,
        [firstInstant, firstInstant, firstInstant],
      ),
    ).rejects.toThrow();
  });
});
