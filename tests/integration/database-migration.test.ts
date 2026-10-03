import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  DatabaseMigrationError,
  migrateDatabase,
  phase1FoundationMigration,
  phase1FoundationSql,
  phase1Schema,
  type SqliteDatabase,
  type SqliteExecutor,
  type SqliteMigration,
  type SqliteParameters,
  type SqliteRunResult,
} from '@workspace/database';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
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

interface SqliteNameRow {
  readonly name: string;
}

interface ScheduleStateRow {
  readonly id: number;
  readonly plan_revision: number;
  readonly state_version: number;
}

interface CountRow {
  readonly count: number;
}

interface IndexRow {
  readonly name: string;
  readonly unique: number;
}

interface TableInfoRow {
  readonly dflt_value: string | null;
  readonly name: string;
  readonly notnull: number;
  readonly pk: number;
  readonly type: string;
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

const now = '2026-09-12T08:00:00.000Z';

const criticalCheckSqlByTable: Readonly<Record<string, readonly string[]>> = {
  tasks: [
    "statusin('inbox','planned','in_progress','completed','canceled')",
    'estimated_duration_minutesisnullorestimated_duration_minutes>0',
    'actual_duration_minutesisnulloractual_duration_minutes>=0',
    'deadline_atisnullorearliest_start_atisnullordeadline_at>=earliest_start_at',
    "status='completed'andcompleted_atisnotnullandcanceled_atisnull",
  ],
  operation_records: [
    'base_state_versionisnullorcurrent_state_version>=base_state_version',
  ],
  completion_records: [
    "duration_coverage='unknown'oractual_duration_secondsisnotnull",
    "duration_coveragein('complete','partial','unknown')",
  ],
  schedule_state: ['id=1', 'state_version>=0', 'plan_revision>=0'],
};

function normalizeSchemaSql(sql: string): string {
  return sql.toLowerCase().replaceAll(/[`"\s]/g, '');
}

async function insertTask(
  database: SqliteExecutor,
  values: {
    readonly completedAt?: string | null;
    readonly id: string;
    readonly status?: string;
  },
): Promise<void> {
  await database.run(
    `INSERT INTO tasks (
      id, title, status, priority, estimated_duration_minutes,
      splittable, scheduling_policy, source, created_at, updated_at,
      completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.id,
      `Task ${values.id}`,
      values.status ?? 'inbox',
      'normal',
      12.5,
      0,
      'flexible',
      'manual',
      now,
      now,
      values.completedAt ?? null,
    ],
  );
}

async function insertOperation(
  database: SqliteExecutor,
  operationId: string,
): Promise<void> {
  await database.run(
    `INSERT INTO operation_records (
      operation_id, command_name, parameter_hash, result_json,
      base_state_version, current_state_version, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [operationId, 'task.complete', `sha256:${operationId}`, '{}', 0, 1, now],
  );
}

describe('Phase 1 SQLite migrations', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteAdapter(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('keeps the checked-in Drizzle SQL and bundled migration manifest in sync', async () => {
    const sqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0000_phase1_foundation.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const normalizedSql = sqlFile.trim();

    expect(phase1FoundationSql).toBe(normalizedSql);
    expect(phase1FoundationMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedSql).digest('hex')}`,
    );
  });

  it('applies the foundation exactly once and initializes version state', async () => {
    const first = await migrateDatabase(database, {
      migrations: [phase1FoundationMigration],
      now: () => now,
    });
    const second = await migrateDatabase(database, {
      migrations: [phase1FoundationMigration],
      now: () => '2026-09-12T09:00:00.000Z',
    });

    expect(first).toEqual({
      applied: ['0000_phase1_foundation'],
      alreadyApplied: [],
    });
    expect(second).toEqual({
      applied: [],
      alreadyApplied: ['0000_phase1_foundation'],
    });

    const tables = await database.all<SqliteNameRow>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    );

    expect(tables.map((row) => row.name)).toEqual([
      '__nexta_migrations',
      'completion_records',
      'goals',
      'operation_records',
      'projects',
      'schedule_state',
      'task_activity_events',
      'tasks',
    ]);
    expect(tables.some((row) => row.name.includes('task_depend'))).toBe(false);
    await expect(
      database.get<ScheduleStateRow>(
        'SELECT id, state_version, plan_revision FROM schedule_state',
      ),
    ).resolves.toEqual({ id: 1, state_version: 0, plan_revision: 0 });
    await expect(
      database.get<CountRow>(
        'SELECT count(*) AS count FROM __nexta_migrations',
      ),
    ).resolves.toEqual({ count: 1 });
  });

  it('keeps migrated tables, columns, checks, indexes, and foreign keys aligned with Drizzle', async () => {
    await migrateDatabase(database, {
      migrations: [phase1FoundationMigration],
      now: () => now,
    });

    const actualApplicationTables = await database.all<SqliteNameRow>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND substr(name, 1, 2) <> '__'
       ORDER BY name`,
    );
    const drizzleTables = Object.values(phase1Schema)
      .map((table) => getTableConfig(table))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(actualApplicationTables.map((row) => row.name)).toEqual(
      drizzleTables.map((table) => table.name),
    );

    for (const table of drizzleTables) {
      const columns = await database.all<TableInfoRow>(
        `PRAGMA table_info('${table.name}')`,
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
        table.columns.map((column) => ({
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
        [table.name],
      );
      const migratedConstraintNames = [
        ...(tableDefinition?.sql.matchAll(
          /CONSTRAINT\s+[`"]([^`"]+)[`"]\s+CHECK/giu,
        ) ?? []),
      ]
        .map((match) => match[1])
        .sort();
      expect(migratedConstraintNames).toEqual(
        table.checks.map((constraint) => constraint.name).sort(),
      );
      const normalizedTableSql = normalizeSchemaSql(tableDefinition?.sql ?? '');
      for (const expectedCheck of criticalCheckSqlByTable[table.name] ?? []) {
        expect(normalizedTableSql).toContain(expectedCheck);
      }

      const migratedIndexes = await database.all<IndexRow>(
        `PRAGMA index_list('${table.name}')`,
      );
      for (const expectedIndex of table.indexes) {
        const actualIndex = migratedIndexes.find(
          (index) => index.name === expectedIndex.config.name,
        );
        expect(actualIndex).toMatchObject({
          name: expectedIndex.config.name,
          unique: expectedIndex.config.unique ? 1 : 0,
        });

        const actualIndexColumns = await database.all<IndexInfoRow>(
          `PRAGMA index_info('${expectedIndex.config.name}')`,
        );
        expect(
          actualIndexColumns
            .sort((left, right) => left.seqno - right.seqno)
            .map((column) => column.name),
        ).toEqual(
          expectedIndex.config.columns.map(
            (column) => (column as { readonly name: string }).name,
          ),
        );
      }

      const migratedForeignKeys = await database.all<ForeignKeyRow>(
        `PRAGMA foreign_key_list('${table.name}')`,
      );
      const expectedForeignKeys = table.foreignKeys.flatMap((foreignKey) => {
        const reference = foreignKey.reference();
        const foreignTable = getTableConfig(reference.foreignTable).name;

        return reference.columns.map((column, index) => ({
          from: column.name,
          on_delete: (foreignKey.onDelete ?? 'no action').toUpperCase(),
          on_update: (foreignKey.onUpdate ?? 'no action').toUpperCase(),
          table: foreignTable,
          to: reference.foreignColumns[index]?.name,
        }));
      });
      const sortForeignKeys = (rows: readonly ForeignKeyRow[]) =>
        rows
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

      expect(sortForeignKeys(migratedForeignKeys)).toEqual(
        sortForeignKeys(expectedForeignKeys as ForeignKeyRow[]),
      );
    }
  });

  it('rolls back every statement and history write from a failed migration', async () => {
    const failingMigration = {
      id: '0001_intentional_failure',
      checksum: `sha256:${'f'.repeat(64)}`,
      sql: `
        CREATE TABLE migration_failure_probe (id TEXT PRIMARY KEY);
        --> statement-breakpoint
        INSERT INTO table_that_does_not_exist (id) VALUES ('boom');
      `,
    } as const satisfies SqliteMigration;

    await expect(
      migrateDatabase(database, {
        migrations: [phase1FoundationMigration, failingMigration],
        now: () => now,
      }),
    ).rejects.toMatchObject({
      code: 'migration_failed',
      migrationId: '0001_intentional_failure',
    } satisfies Partial<DatabaseMigrationError>);

    await expect(
      database.get<SqliteNameRow>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'migration_failure_probe'`,
      ),
    ).resolves.toBeUndefined();
    await expect(
      database.all<{ readonly id: string }>(
        'SELECT id FROM __nexta_migrations ORDER BY sequence',
      ),
    ).resolves.toEqual([{ id: '0000_phase1_foundation' }]);
  });

  it('rejects edited or non-prefix migration history before applying new SQL', async () => {
    await migrateDatabase(database, {
      migrations: [phase1FoundationMigration],
      now: () => now,
    });

    const editedFoundation = {
      ...phase1FoundationMigration,
      checksum: `sha256:${'0'.repeat(64)}`,
    } satisfies SqliteMigration;

    await expect(
      migrateDatabase(database, { migrations: [editedFoundation] }),
    ).rejects.toMatchObject({
      code: 'migration_checksum_mismatch',
      migrationId: '0000_phase1_foundation',
    });

    await database.run(
      `INSERT INTO __nexta_migrations (id, checksum, applied_at)
       VALUES (?, ?, ?)`,
      ['9999_unknown', `sha256:${'9'.repeat(64)}`, now],
    );

    await expect(
      migrateDatabase(database, { migrations: [phase1FoundationMigration] }),
    ).rejects.toMatchObject({
      code: 'migration_history_invalid',
      migrationId: '9999_unknown',
    });
  });

  it('enforces task durations, time ordering, terminal timestamps, and parent integrity', async () => {
    await migrateDatabase(database, {
      migrations: [phase1FoundationMigration],
      now: () => now,
    });
    await insertTask(database, { id: 'valid' });

    await expect(
      database.get<{ readonly estimated_duration_minutes: number }>(
        'SELECT estimated_duration_minutes FROM tasks WHERE id = ?',
        ['valid'],
      ),
    ).resolves.toEqual({ estimated_duration_minutes: 12.5 });

    await expect(
      database.run(
        `INSERT INTO tasks (
          id, title, status, priority, estimated_duration_minutes,
          splittable, scheduling_policy, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'zero-duration',
          'Invalid',
          'inbox',
          'normal',
          0,
          0,
          'flexible',
          'manual',
          now,
          now,
        ],
      ),
    ).rejects.toThrow();

    await expect(
      database.run(
        `INSERT INTO tasks (
          id, title, status, priority, earliest_start_at, deadline_at,
          splittable, scheduling_policy, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'reversed-window',
          'Invalid',
          'inbox',
          'normal',
          '2026-09-13T10:00:00.000Z',
          '2026-09-13T09:00:00.000Z',
          0,
          'flexible',
          'manual',
          now,
          now,
        ],
      ),
    ).rejects.toThrow();

    await expect(
      database.run(
        `UPDATE tasks
         SET status = 'completed', completed_at = NULL
         WHERE id = 'valid'`,
      ),
    ).rejects.toThrow();

    await expect(
      database.run(
        `INSERT INTO tasks (
          id, parent_task_id, title, status, priority, splittable,
          scheduling_policy, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'self-parent',
          'self-parent',
          'Invalid',
          'inbox',
          'normal',
          0,
          'flexible',
          'manual',
          now,
          now,
        ],
      ),
    ).rejects.toThrow();
  });

  it('enforces foreign keys, unique completion evidence, and lookup indexes', async () => {
    await migrateDatabase(database, {
      migrations: [phase1FoundationMigration],
      now: () => now,
    });
    await insertTask(database, {
      completedAt: now,
      id: 'completed-1',
      status: 'completed',
    });
    await insertTask(database, {
      completedAt: now,
      id: 'completed-2',
      status: 'completed',
    });
    await insertOperation(database, 'op-1');
    await insertOperation(database, 'op-2');

    await expect(
      database.run(
        `INSERT INTO operation_records (
          operation_id, command_name, parameter_hash, result_json,
          base_state_version, current_state_version, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          'op-regressed-version',
          'task.complete',
          'sha256:regressed',
          '{}',
          2,
          1,
          now,
        ],
      ),
    ).rejects.toThrow();

    await database.run(
      `INSERT INTO completion_records (
        id, task_id, operation_id, completed_at, task_title_snapshot,
        actual_duration_seconds, duration_coverage,
        achievement_disposition, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'completion-1',
        'completed-1',
        'op-1',
        now,
        'Completed task',
        75.25,
        'complete',
        'record',
        'user',
      ],
    );

    await expect(
      database.run(
        `INSERT INTO completion_records (
          id, task_id, operation_id, completed_at, task_title_snapshot,
          actual_duration_seconds, duration_coverage,
          achievement_disposition, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'completion-missing-covered-duration',
          'completed-2',
          'op-2',
          now,
          'Missing covered duration',
          null,
          'complete',
          'skip',
          'user',
        ],
      ),
    ).rejects.toThrow();

    await expect(
      database.run(
        `INSERT INTO completion_records (
          id, task_id, operation_id, completed_at, task_title_snapshot,
          duration_coverage, achievement_disposition, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'completion-duplicate-task',
          'completed-1',
          'op-2',
          now,
          'Duplicate',
          'unknown',
          'skip',
          'user',
        ],
      ),
    ).rejects.toThrow();

    await expect(
      database.run(
        `INSERT INTO completion_records (
          id, task_id, operation_id, completed_at, task_title_snapshot,
          duration_coverage, achievement_disposition, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'completion-duplicate-operation',
          'completed-2',
          'op-1',
          now,
          'Duplicate operation',
          'unknown',
          'skip',
          'user',
        ],
      ),
    ).rejects.toThrow();

    await expect(
      database.run(
        `INSERT INTO task_activity_events (
          id, task_id, event_type, actor, occurred_at, local_date,
          time_zone, operation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'activity-invalid-operation',
          'completed-1',
          'complete_task',
          'user',
          now,
          '2026-09-12',
          'Asia/Shanghai',
          'operation-that-does-not-exist',
        ],
      ),
    ).rejects.toThrow();

    const taskIndexes = await database.all<IndexRow>(
      `PRAGMA index_list('tasks')`,
    );
    const completionIndexes = await database.all<IndexRow>(
      `PRAGMA index_list('completion_records')`,
    );

    expect(taskIndexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'tasks_project_id_idx',
        'tasks_goal_id_idx',
        'tasks_parent_task_id_idx',
        'tasks_status_idx',
        'tasks_deadline_at_idx',
      ]),
    );
    expect(completionIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'completion_records_task_id_unique',
          unique: 1,
        }),
        expect.objectContaining({
          name: 'completion_records_operation_id_unique',
          unique: 1,
        }),
      ]),
    );
  });
});
