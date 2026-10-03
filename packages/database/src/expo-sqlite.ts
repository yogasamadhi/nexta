import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteParameters,
  SqliteRunResult,
} from './sqlite';

type ExpoExecutor = Pick<
  SQLiteDatabase,
  'getAllAsync' | 'getFirstAsync' | 'runAsync'
>;

function adaptExecutor(database: ExpoExecutor): SqliteExecutor {
  return {
    async run(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<SqliteRunResult> {
      const result = await database.runAsync(sql, [...parameters]);

      return {
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowId,
      };
    },

    async get<TRow extends object>(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<TRow | undefined> {
      const row = await database.getFirstAsync<TRow>(sql, [...parameters]);
      return row ?? undefined;
    },

    async all<TRow extends object>(
      sql: string,
      parameters: SqliteParameters = [],
    ): Promise<TRow[]> {
      return database.getAllAsync<TRow>(sql, [...parameters]);
    },
  };
}

/**
 * Adapts Expo's database without exposing Expo types to repositories or the
 * migration runner. The import above is type-only, so Node migration tests do
 * not load the Expo runtime.
 */
export function createExpoSqliteDatabase(
  database: SQLiteDatabase,
): SqliteDatabase {
  const executor = adaptExecutor(database);
  let transactionQueue: Promise<void> = Promise.resolve();

  return {
    ...executor,
    async transaction<TResult>(
      work: (transaction: SqliteExecutor) => Promise<TResult>,
    ): Promise<TResult> {
      let release: (() => void) | undefined;
      const previous = transactionQueue;
      transactionQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      let outcome: { readonly value: TResult } | undefined;
      try {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          outcome = { value: await work(adaptExecutor(transaction)) };
        });

        if (!outcome) {
          throw new Error('SQLite transaction finished without a result.');
        }

        return outcome.value;
      } finally {
        release?.();
      }
    },
  };
}
