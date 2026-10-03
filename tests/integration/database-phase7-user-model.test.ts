import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  databaseMigrations,
  initializeSqliteApplicationUnitOfWork,
  migrateDatabase,
  phase7UserModelFeaturesMigration,
  phase7UserModelFeaturesSql,
  type SqliteDatabase,
} from '@workspace/database';
import {
  createUserModelFeature,
  parseInstant,
  parseUserModelFeatureId,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const T0 = parseInstant('2026-09-12T08:00:00.000Z');
const T1 = parseInstant('2026-09-12T09:00:00.000Z');

function feature(id: string, scopeKey: string | null, value: number) {
  return createUserModelFeature({
    id: parseUserModelFeatureId(id),
    featureKey: 'estimate_bias',
    scopeKey,
    numericValue: value,
    windowStart: parseInstant('2026-08-01T00:00:00.000Z'),
    windowEnd: parseInstant('2026-09-01T00:00:00.000Z'),
    sourceStateVersion: 4,
    sampleCount: 3,
    confidence: 0.6,
    algorithmVersion: 'phase7-test-v1',
    lastUpdatedAt: T1,
  });
}

describe('Phase 7 UserModelFeature SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('binds append-only 0007 SQL and upgrades an existing 0006 database once', async () => {
    const sqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0007_phase7_user_model_features.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const normalizedSql = sqlFile.trim();
    expect(phase7UserModelFeaturesSql).toBe(normalizedSql);
    expect(phase7UserModelFeaturesMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedSql).digest('hex')}`,
    );
    expect(databaseMigrations[7]?.id).toBe('0007_phase7_user_model_features');

    const through0006 = databaseMigrations.slice(0, 7);
    await migrateDatabase(database, { migrations: through0006, now: () => T0 });
    const through0007 = databaseMigrations.slice(0, 8);
    await expect(
      migrateDatabase(database, {
        migrations: through0007,
        now: () => T1,
      }),
    ).resolves.toEqual({
      applied: ['0007_phase7_user_model_features'],
      alreadyApplied: through0006.map(({ id }) => id),
    });
  });

  it('replaces one algorithm cache atomically and restores null scopes', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => T0,
    });
    await unitOfWork.transaction((transaction) =>
      transaction.userModelFeatures.replaceForAlgorithmVersion(
        'phase7-test-v1',
        [
          feature('feature-global', null, 0.25),
          feature('feature-doc', 'document', 0.5),
        ],
      ),
    );
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.userModelFeatures.listByAlgorithmVersion('phase7-test-v1'),
      ),
    ).resolves.toMatchObject([
      { id: 'feature-global', scopeKey: null, numericValue: 0.25 },
      { id: 'feature-doc', scopeKey: 'document', numericValue: 0.5 },
    ]);

    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.userModelFeatures.replaceForAlgorithmVersion(
          'phase7-test-v1',
          [feature('duplicate-a', null, 1), feature('duplicate-b', null, 2)],
        ),
      ),
    ).rejects.toThrow('duplicate identity');
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.userModelFeatures.listByAlgorithmVersion('phase7-test-v1'),
      ),
    ).resolves.toHaveLength(2);
  });

  it('enforces confidence, window, sample, and identity constraints', async () => {
    await migrateDatabase(database, { now: () => T0 });
    await expect(
      database.run(
        `INSERT INTO user_model_features (
          id, feature_key, scope_key, numeric_value, window_start, window_end,
          source_state_version, sample_count, confidence, algorithm_version,
          last_updated_at
        ) VALUES ('invalid', 'estimate_bias', '', 1, ?, ?, 0, -1, 2, 'v1', ?)`,
        [T1, T0, T1],
      ),
    ).rejects.toThrow();
  });
});
