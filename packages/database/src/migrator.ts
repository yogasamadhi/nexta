import type { SqliteDatabase, SqliteExecutor } from './sqlite';
import {
  databaseMigrations,
  phase6AgentRunsMigration,
  type SqliteMigration,
} from './migrations';

const migrationTableName = '__nexta_migrations';
const statementBreakpoint = '--> statement-breakpoint';

const createMigrationTableSql = `
  CREATE TABLE IF NOT EXISTS ${migrationTableName} (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )
`;

interface AppliedMigrationRow {
  readonly id: string;
  readonly checksum: string;
}

interface SqliteSchemaRow {
  readonly name: string;
  readonly sql: string | null;
  readonly type: string;
}

const phase6LegacyPlaceholderChecksum = `sha256:${'0'.repeat(64)}`;
const phase6ExpectedSchemaObjects = [
  {
    name: 'agent_runs',
    statementIndex: 0,
    type: 'table',
  },
  {
    name: 'agent_runs_status_started_idx',
    statementIndex: 1,
    type: 'index',
  },
] as const;

export type MigrationErrorCode =
  | 'migration_checksum_mismatch'
  | 'migration_failed'
  | 'migration_history_invalid';

export class DatabaseMigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly migrationId?: string;

  constructor(
    code: MigrationErrorCode,
    message: string,
    options: { readonly cause?: unknown; readonly migrationId?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DatabaseMigrationError';
    this.code = code;
    this.migrationId = options.migrationId;
  }
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export interface MigrationOptions {
  readonly migrations?: readonly SqliteMigration[];
  readonly now?: () => string;
}

export function splitMigrationStatements(sql: string): string[] {
  return sql
    .split(statementBreakpoint)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function assertManifest(migrations: readonly SqliteMigration[]): void {
  const ids = new Set<string>();

  for (const migration of migrations) {
    if (
      migration.id.trim().length === 0 ||
      ids.has(migration.id) ||
      !/^sha256:[0-9a-f]{64}$/.test(migration.checksum)
    ) {
      throw new DatabaseMigrationError(
        'migration_history_invalid',
        'The bundled database migration manifest is invalid.',
        { migrationId: migration.id || undefined },
      );
    }

    if (splitMigrationStatements(migration.sql).length === 0) {
      throw new DatabaseMigrationError(
        'migration_history_invalid',
        'A bundled database migration contains no statements.',
        { migrationId: migration.id },
      );
    }

    ids.add(migration.id);
  }
}

function assertAppliedHistory(
  appliedRows: readonly AppliedMigrationRow[],
  migrations: readonly SqliteMigration[],
): void {
  for (const [index, row] of appliedRows.entries()) {
    const expected = migrations[index];

    if (!expected || expected.id !== row.id) {
      throw new DatabaseMigrationError(
        'migration_history_invalid',
        'The database migration history is not a prefix of this app build.',
        { migrationId: row.id },
      );
    }

    if (expected.checksum !== row.checksum) {
      throw new DatabaseMigrationError(
        'migration_checksum_mismatch',
        'An applied database migration differs from this app build.',
        { migrationId: row.id },
      );
    }
  }
}

function normalizeSchemaSql(sql: string): string {
  return sql.toLowerCase().replaceAll(/[`"\s;]/g, '');
}

function assertAppliedHistoryIds(
  appliedRows: readonly AppliedMigrationRow[],
  migrations: readonly SqliteMigration[],
): void {
  for (const [index, row] of appliedRows.entries()) {
    if (migrations[index]?.id !== row.id) {
      throw new DatabaseMigrationError(
        'migration_history_invalid',
        'The database migration history is not a prefix of this app build.',
        { migrationId: row.id },
      );
    }
  }
}

function isKnownPhase6LegacyPlaceholder(
  appliedRows: readonly AppliedMigrationRow[],
  migrations: readonly SqliteMigration[],
): boolean {
  const phase6Index = migrations.findIndex(
    ({ id }) => id === phase6AgentRunsMigration.id,
  );
  const expected = migrations[phase6Index];
  const applied = appliedRows[phase6Index];

  return (
    phase6Index >= 0 &&
    expected?.checksum === phase6AgentRunsMigration.checksum &&
    applied?.id === phase6AgentRunsMigration.id &&
    applied.checksum === phase6LegacyPlaceholderChecksum &&
    appliedRows.every(
      (row, index) =>
        index === phase6Index || row.checksum === migrations[index]?.checksum,
    )
  );
}

async function repairKnownLegacyMigrationHistory(
  database: SqliteDatabase,
  appliedRows: readonly AppliedMigrationRow[],
  migrations: readonly SqliteMigration[],
): Promise<void> {
  // Compatibility bridge for one pre-release development build. This must stay
  // narrower than normal checksum validation: exact marker, exact manifest,
  // exact SQLite schema, and a conditional history update in one transaction.
  if (!isKnownPhase6LegacyPlaceholder(appliedRows, migrations)) return;

  try {
    await database.transaction(async (transaction) => {
      const currentHistory = await transaction.get<AppliedMigrationRow>(
        `SELECT id, checksum FROM ${migrationTableName} WHERE id = ?`,
        [phase6AgentRunsMigration.id],
      );

      if (currentHistory?.checksum !== phase6LegacyPlaceholderChecksum) {
        throw new DatabaseMigrationError(
          'migration_checksum_mismatch',
          'The known legacy migration marker changed before it could be verified.',
          { migrationId: phase6AgentRunsMigration.id },
        );
      }

      const statements = splitMigrationStatements(phase6AgentRunsMigration.sql);
      const schemaRows = await transaction.all<SqliteSchemaRow>(
        `SELECT type, name, sql FROM sqlite_master
         WHERE name IN (?, ?)
         ORDER BY name`,
        phase6ExpectedSchemaObjects.map(({ name }) => name),
      );

      const schemaMatches = phase6ExpectedSchemaObjects.every(
        ({ name, statementIndex, type }) => {
          const actual = schemaRows.find(
            (row) => row.name === name && row.type === type,
          );
          const expectedSql = statements[statementIndex];

          return (
            actual?.sql !== null &&
            actual?.sql !== undefined &&
            expectedSql !== undefined &&
            normalizeSchemaSql(actual.sql) === normalizeSchemaSql(expectedSql)
          );
        },
      );

      if (
        schemaRows.length !== phase6ExpectedSchemaObjects.length ||
        !schemaMatches
      ) {
        throw new DatabaseMigrationError(
          'migration_checksum_mismatch',
          'The legacy migration marker cannot be repaired because its schema differs from this app build.',
          { migrationId: phase6AgentRunsMigration.id },
        );
      }

      const update = await transaction.run(
        `UPDATE ${migrationTableName}
         SET checksum = ?
         WHERE id = ? AND checksum = ?`,
        [
          phase6AgentRunsMigration.checksum,
          phase6AgentRunsMigration.id,
          phase6LegacyPlaceholderChecksum,
        ],
      );

      if (update.changes !== 1) {
        throw new DatabaseMigrationError(
          'migration_checksum_mismatch',
          'The known legacy migration marker could not be repaired safely.',
          { migrationId: phase6AgentRunsMigration.id },
        );
      }
    });
  } catch (error) {
    if (error instanceof DatabaseMigrationError) throw error;

    throw new DatabaseMigrationError(
      'migration_failed',
      'The known legacy migration marker could not be verified.',
      { cause: error, migrationId: phase6AgentRunsMigration.id },
    );
  }
}

async function applyOneMigration(
  database: SqliteDatabase,
  migration: SqliteMigration,
  appliedAt: string,
): Promise<boolean> {
  try {
    return await database.transaction(async (transaction) => {
      const existing = await transaction.get<AppliedMigrationRow>(
        `SELECT id, checksum FROM ${migrationTableName} WHERE id = ?`,
        [migration.id],
      );

      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new DatabaseMigrationError(
            'migration_checksum_mismatch',
            'An applied database migration differs from this app build.',
            { migrationId: migration.id },
          );
        }

        return false;
      }

      for (const statement of splitMigrationStatements(migration.sql)) {
        await transaction.run(statement);
      }

      await transaction.run(
        `INSERT INTO ${migrationTableName} (id, checksum, applied_at) VALUES (?, ?, ?)`,
        [migration.id, migration.checksum, appliedAt],
      );

      return true;
    });
  } catch (error) {
    if (error instanceof DatabaseMigrationError) throw error;

    throw new DatabaseMigrationError(
      'migration_failed',
      'The database upgrade failed and the current migration was rolled back.',
      { cause: error, migrationId: migration.id },
    );
  }
}

async function readAppliedMigrations(
  database: SqliteExecutor,
): Promise<AppliedMigrationRow[]> {
  return database.all<AppliedMigrationRow>(
    `SELECT id, checksum FROM ${migrationTableName} ORDER BY sequence`,
  );
}

/**
 * Applies each pending migration atomically. A failed migration never writes
 * its history row and relies on SqliteDatabase.transaction to roll back all of
 * that migration's DDL/DML before the error reaches app startup.
 */
export async function migrateDatabase(
  database: SqliteDatabase,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const migrations = options.migrations ?? databaseMigrations;
  const now = options.now ?? (() => new Date().toISOString());
  assertManifest(migrations);

  // SQLite ignores foreign-key enforcement unless each connection enables it.
  // This must happen outside a transaction.
  await database.run('PRAGMA foreign_keys = ON');
  await database.run(createMigrationTableSql);

  let previouslyApplied = await readAppliedMigrations(database);
  assertAppliedHistoryIds(previouslyApplied, migrations);
  await repairKnownLegacyMigrationHistory(
    database,
    previouslyApplied,
    migrations,
  );
  previouslyApplied = await readAppliedMigrations(database);
  assertAppliedHistory(previouslyApplied, migrations);

  const applied: string[] = [];
  const alreadyApplied = previouslyApplied.map((migration) => migration.id);

  for (const migration of migrations.slice(previouslyApplied.length)) {
    const didApply = await applyOneMigration(database, migration, now());

    if (didApply) applied.push(migration.id);
    else alreadyApplied.push(migration.id);
  }

  return { applied, alreadyApplied };
}
