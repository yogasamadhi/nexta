import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { AgentRunMetadataService } from '@workspace/application';
import {
  DatabaseMigrationError,
  databaseMigrations,
  initializeSqliteApplicationUnitOfWork,
  migrateDatabase,
  phase6AgentRunsMigration,
  phase6AgentRunsSql,
  splitMigrationStatements,
  type SqliteDatabase,
} from '@workspace/database';
import { parseInstant } from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const T0 = parseInstant('2026-09-12T08:00:00.000Z');
const T1 = parseInstant('2026-09-12T08:01:00.000Z');
const legacyPlaceholderChecksum = `sha256:${'0'.repeat(64)}`;

async function installLegacyPhase6(
  database: SqliteDatabase,
  checksum = legacyPlaceholderChecksum,
): Promise<void> {
  for (const statement of splitMigrationStatements(phase6AgentRunsSql)) {
    await database.run(statement);
  }
  await database.run(
    `INSERT INTO __nexta_migrations (id, checksum, applied_at)
     VALUES (?, ?, ?)`,
    [phase6AgentRunsMigration.id, checksum, T0],
  );
}

describe('Phase 6 AgentRun SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('binds append-only 0006 SQL and upgrades an existing 0005 database once', async () => {
    const sqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0006_phase6_agent_runs.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const normalizedSql = sqlFile.trim();
    expect(phase6AgentRunsSql).toBe(normalizedSql);
    expect(phase6AgentRunsMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedSql).digest('hex')}`,
    );
    expect(databaseMigrations[6]?.id).toBe('0006_phase6_agent_runs');

    const through0005 = databaseMigrations.slice(0, 6);
    const through0006 = databaseMigrations.slice(0, 7);
    await migrateDatabase(database, { migrations: through0005, now: () => T0 });
    await expect(
      migrateDatabase(database, {
        migrations: through0006,
        now: () => T1,
      }),
    ).resolves.toEqual({
      applied: ['0006_phase6_agent_runs'],
      alreadyApplied: through0005.map(({ id }) => id),
    });
    await expect(
      migrateDatabase(database, {
        migrations: through0006,
        now: () => T1,
      }),
    ).resolves.toEqual({
      applied: [],
      alreadyApplied: through0006.map(({ id }) => id),
    });
  });

  it('repairs only the verified legacy 0006 placeholder and continues later migrations', async () => {
    const through0005 = databaseMigrations.slice(0, 6);
    await migrateDatabase(database, { migrations: through0005, now: () => T0 });
    await installLegacyPhase6(database);
    await database.run(
      `INSERT INTO agent_runs (
        id, started_at, ended_at, status, trigger, model_provider,
        turn_count, error_code
      ) VALUES (?, ?, NULL, 'running', 'user_input', NULL, 2, NULL)`,
      ['legacy-run', T0],
    );

    await expect(migrateDatabase(database, { now: () => T1 })).resolves.toEqual(
      {
        applied: [
          '0007_phase7_user_model_features',
          '0008_phase8_wellbeing',
          '0009_cloud_sync',
          '0010_cloud_bootstrap',
        ],
        alreadyApplied: databaseMigrations.slice(0, 7).map(({ id }) => id),
      },
    );
    await expect(
      database.get<{ readonly checksum: string }>(
        'SELECT checksum FROM __nexta_migrations WHERE id = ?',
        [phase6AgentRunsMigration.id],
      ),
    ).resolves.toEqual({ checksum: phase6AgentRunsMigration.checksum });
    await expect(
      database.get<{ readonly turn_count: number }>(
        'SELECT turn_count FROM agent_runs WHERE id = ?',
        ['legacy-run'],
      ),
    ).resolves.toEqual({ turn_count: 2 });
  });

  it('keeps the legacy placeholder unchanged when the 0006 schema is incomplete', async () => {
    const through0005 = databaseMigrations.slice(0, 6);
    await migrateDatabase(database, { migrations: through0005, now: () => T0 });
    await database.run(splitMigrationStatements(phase6AgentRunsSql)[0] ?? '');
    await database.run(
      `INSERT INTO __nexta_migrations (id, checksum, applied_at)
       VALUES (?, ?, ?)`,
      [phase6AgentRunsMigration.id, legacyPlaceholderChecksum, T0],
    );

    await expect(migrateDatabase(database)).rejects.toMatchObject({
      code: 'migration_checksum_mismatch',
      migrationId: phase6AgentRunsMigration.id,
    } satisfies Partial<DatabaseMigrationError>);
    await expect(
      database.get<{ readonly checksum: string }>(
        'SELECT checksum FROM __nexta_migrations WHERE id = ?',
        [phase6AgentRunsMigration.id],
      ),
    ).resolves.toEqual({ checksum: legacyPlaceholderChecksum });
  });

  it('does not repair an arbitrary wrong 0006 checksum', async () => {
    const through0005 = databaseMigrations.slice(0, 6);
    const wrongChecksum = `sha256:${'1'.repeat(64)}`;
    await migrateDatabase(database, { migrations: through0005, now: () => T0 });
    await installLegacyPhase6(database, wrongChecksum);

    await expect(migrateDatabase(database)).rejects.toMatchObject({
      code: 'migration_checksum_mismatch',
      migrationId: phase6AgentRunsMigration.id,
    } satisfies Partial<DatabaseMigrationError>);
    await expect(
      database.get<{ readonly checksum: string }>(
        'SELECT checksum FROM __nexta_migrations WHERE id = ?',
        [phase6AgentRunsMigration.id],
      ),
    ).resolves.toEqual({ checksum: wrongChecksum });
  });

  it('does not mutate the placeholder when another history row is invalid', async () => {
    const through0005 = databaseMigrations.slice(0, 6);
    await migrateDatabase(database, { migrations: through0005, now: () => T0 });
    await installLegacyPhase6(database);
    await database.run(
      'UPDATE __nexta_migrations SET checksum = ? WHERE id = ?',
      [`sha256:${'2'.repeat(64)}`, databaseMigrations[0]?.id ?? ''],
    );

    await expect(migrateDatabase(database)).rejects.toMatchObject({
      code: 'migration_checksum_mismatch',
      migrationId: databaseMigrations[0]?.id,
    } satisfies Partial<DatabaseMigrationError>);
    await expect(
      database.get<{ readonly checksum: string }>(
        'SELECT checksum FROM __nexta_migrations WHERE id = ?',
        [phase6AgentRunsMigration.id],
      ),
    ).resolves.toEqual({ checksum: legacyPlaceholderChecksum });
  });

  it('persists minimal running metadata and restores it before terminal settlement', async () => {
    const firstUnitOfWork = await initializeSqliteApplicationUnitOfWork(
      database,
      { now: () => T0 },
    );
    const first = new AgentRunMetadataService({
      unitOfWork: firstUnitOfWork,
      clock: { now: () => T0 },
    });
    await first.start({
      runId: 'run-restart',
      trigger: 'background_window',
      modelProvider: 'fake',
    });
    await first.checkpoint({ runId: 'run-restart', turnCount: 2 });

    const restartedUnitOfWork = await initializeSqliteApplicationUnitOfWork(
      database,
      { now: () => T1 },
    );
    const restarted = new AgentRunMetadataService({
      unitOfWork: restartedUnitOfWork,
      clock: { now: () => T1 },
    });
    await expect(restarted.listRunning()).resolves.toEqual([
      {
        id: 'run-restart',
        startedAt: T0,
        endedAt: null,
        status: 'running',
        trigger: 'background_window',
        modelProvider: 'fake',
        turnCount: 2,
        errorCode: null,
      },
    ]);
    await restarted.finish({
      runId: 'run-restart',
      status: 'aborted',
      turnCount: 2,
      errorCode: 'background_window_ended',
    });
    await expect(restarted.listRunning()).resolves.toEqual([]);
  });

  it('enforces lifecycle, trigger, and turn constraints in SQLite', async () => {
    await migrateDatabase(database, { now: () => T0 });
    await expect(
      database.run(
        `INSERT INTO agent_runs (
          id, started_at, ended_at, status, trigger, model_provider,
          turn_count, error_code
        ) VALUES ('invalid-run', ?, NULL, 'failed', 'daemon_tick', NULL, -1, NULL)`,
        [T0],
      ),
    ).rejects.toThrow();
  });
});
