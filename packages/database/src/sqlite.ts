export type SqliteBindableValue = string | number | null | Uint8Array;

export type SqliteParameters = readonly SqliteBindableValue[];

export interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowId?: number;
}

/**
 * Small common denominator shared by Expo SQLite and test adapters.
 *
 * Business values must be serialized before reaching this boundary. In
 * particular, booleans are stored as 0/1 and instants as normalized UTC text.
 */
export interface SqliteExecutor {
  run(sql: string, parameters?: SqliteParameters): Promise<SqliteRunResult>;
  get<TRow extends object>(
    sql: string,
    parameters?: SqliteParameters,
  ): Promise<TRow | undefined>;
  all<TRow extends object>(
    sql: string,
    parameters?: SqliteParameters,
  ): Promise<TRow[]>;
}

/**
 * A connection that can run an exclusive, rollback-on-error transaction.
 * Implementations must pass a transaction-scoped executor to the callback.
 */
export interface SqliteDatabase extends SqliteExecutor {
  transaction<TResult>(
    work: (transaction: SqliteExecutor) => Promise<TResult>,
  ): Promise<TResult>;
}
