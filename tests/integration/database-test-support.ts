import { type SQLInputValue, DatabaseSync } from 'node:sqlite';

import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteParameters,
  SqliteRunResult,
} from '@workspace/database';

function asNodeParameters(parameters: SqliteParameters): SQLInputValue[] {
  return [...parameters];
}

export function createNodeSqliteDatabase(
  nativeDatabase: DatabaseSync,
): SqliteDatabase {
  const executor: SqliteExecutor = {
    async run(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<SqliteRunResult> {
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
    ...executor,
    async transaction<TResult>(
      work: (transaction: SqliteExecutor) => Promise<TResult>,
    ): Promise<TResult> {
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
  };
}

export async function insertPhase1Task(
  database: SqliteExecutor,
  id: string,
  instant: string,
): Promise<void> {
  await database.run(
    `INSERT INTO tasks (
      id, title, status, priority, splittable, scheduling_policy, source,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      `Task ${id}`,
      'inbox',
      'normal',
      0,
      'flexible',
      'manual',
      instant,
      instant,
    ],
  );
}

export async function insertOperationRecord(
  database: SqliteExecutor,
  operationId: string,
  instant: string,
  currentStateVersion = 0,
): Promise<void> {
  await database.run(
    `INSERT INTO operation_records (
      operation_id, command_name, parameter_hash, result_json,
      base_state_version, current_state_version, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      operationId,
      'scheduler.commit',
      `sha256:${'a'.repeat(64)}`,
      '{}',
      currentStateVersion,
      currentStateVersion,
      instant,
    ],
  );
}
