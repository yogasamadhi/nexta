import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  PreferenceService,
  type UpdatePreferenceInput,
} from '@workspace/application';
import {
  databaseMigrations,
  initializeSqliteApplicationUnitOfWork,
  migrateDatabase,
  phase4UserPreferencesMigration,
  phase4UserPreferencesSql,
  type SqliteDatabase,
} from '@workspace/database';
import {
  createUserPreference,
  parseInstant,
  parseUserPreferenceId,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const t0 = parseInstant('2026-09-12T08:00:00.000Z');
const t1 = parseInstant('2026-09-12T09:00:00.000Z');

class FixedClock {
  now() {
    return t0;
  }
}

class SequenceIds {
  #next = 1;

  generate() {
    const value = `preference-${this.#next}`;
    this.#next += 1;
    return value;
  }
}

describe('Phase 4 UserPreference SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('binds the append-only migration to checked-in SQL and preserves its prefix', async () => {
    const sqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0004_phase4_user_preferences.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const normalizedSql = sqlFile.trim();

    expect(phase4UserPreferencesSql).toBe(normalizedSql);
    expect(phase4UserPreferencesMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedSql).digest('hex')}`,
    );
    expect(databaseMigrations[4]?.id).toBe('0004_phase4_user_preferences');
    expect(databaseMigrations.slice(0, 4).map(({ id }) => id)).toEqual([
      '0000_phase1_foundation',
      '0001_phase2_schedule_commit',
      '0002_phase3_calendar_notifications',
      '0003_phase3_external_mutation_intents',
    ]);
  });

  it('upgrades an existing 0003 database exactly once', async () => {
    const through0003 = databaseMigrations.slice(0, 4);
    await migrateDatabase(database, { migrations: through0003, now: () => t0 });
    await database.run(
      `INSERT INTO tasks (
        id, title, status, priority, splittable, scheduling_policy, source,
        created_at, updated_at
      ) VALUES ('task-before-preferences', 'Existing task', 'inbox', 'normal',
        0, 'flexible', 'manual', ?, ?)`,
      [t0, t0],
    );

    await expect(
      migrateDatabase(database, {
        migrations: databaseMigrations.slice(0, 5),
        now: () => t1,
      }),
    ).resolves.toEqual({
      applied: ['0004_phase4_user_preferences'],
      alreadyApplied: through0003.map(({ id }) => id),
    });
    await expect(
      migrateDatabase(database, {
        migrations: databaseMigrations.slice(0, 5),
        now: () => t1,
      }),
    ).resolves.toEqual({
      applied: [],
      alreadyApplied: databaseMigrations.slice(0, 5).map(({ id }) => id),
    });
    await expect(
      database.get<{ title: string }>(
        `SELECT title FROM tasks WHERE id = 'task-before-preferences'`,
      ),
    ).resolves.toEqual({ title: 'Existing task' });
  });

  it('persists, rehydrates, and idempotently replays a preference after restart', async () => {
    const firstUnitOfWork = await initializeSqliteApplicationUnitOfWork(
      database,
      {
        now: () => t0,
      },
    );
    const firstService = new PreferenceService({
      unitOfWork: firstUnitOfWork,
      clock: new FixedClock(),
      idGenerator: new SequenceIds(),
    });
    const input: UpdatePreferenceInput = {
      key: 'scheduling.workingHours.v1' as const,
      value: {
        timeZone: 'Asia/Shanghai',
        rules: [
          {
            id: 'weekday-work',
            weekdays: [1, 2, 3, 4, 5],
            startLocalTime: '09:00',
            endLocalTime: '18:00',
            startDisambiguation: 'earlier' as const,
            endDisambiguation: 'later' as const,
          },
        ],
      },
    };
    const context = {
      operationId: 'preference-operation-1',
      authority: { kind: 'user' as const },
    };
    const first = await firstService.update(input, context);

    const restartedUnitOfWork = await initializeSqliteApplicationUnitOfWork(
      database,
      { now: () => t1 },
    );
    const restartedService = new PreferenceService({
      unitOfWork: restartedUnitOfWork,
      clock: new FixedClock(),
      idGenerator: { generate: () => 'must-not-be-used' },
    });
    await expect(restartedService.update(input, context)).resolves.toEqual(
      first,
    );
    await expect(
      restartedService.get('scheduling.workingHours.v1'),
    ).resolves.toEqual(first.preference);
    await expect(
      database.get<{ state_version: number }>(
        'SELECT state_version FROM schedule_state WHERE id = 1',
      ),
    ).resolves.toEqual({ state_version: 1 });
  });

  it('rolls back the preference and receipt when a late state write fails', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => t0,
    });
    nativeDatabase.exec(`
      CREATE TRIGGER fail_preference_state_update
      BEFORE UPDATE ON schedule_state
      BEGIN
        SELECT RAISE(ABORT, 'injected state failure');
      END;
    `);
    const service = new PreferenceService({
      unitOfWork,
      clock: new FixedClock(),
      idGenerator: new SequenceIds(),
    });

    await expect(
      service.update(
        {
          key: 'scheduling.timeZone.v1',
          value: { timeZone: 'Asia/Shanghai' },
        },
        {
          operationId: 'preference-operation-fail',
          authority: { kind: 'user' },
        },
      ),
    ).rejects.toMatchObject({ code: 'adapter_error' });
    await expect(
      database.get('SELECT id FROM user_preferences LIMIT 1'),
    ).resolves.toBeUndefined();
    await expect(
      database.get(
        `SELECT operation_id FROM operation_records
         WHERE operation_id = 'preference-operation-fail'`,
      ),
    ).resolves.toBeUndefined();
  });

  it('enforces JSON/key constraints and stable key identity', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => t0,
    });
    await expect(
      database.run(
        `INSERT INTO user_preferences (id, key, value_json, updated_at)
         VALUES ('invalid-json', 'scheduling.invalid', '{', ?)`,
        [t0],
      ),
    ).rejects.toThrow();

    const first = createUserPreference({
      id: parseUserPreferenceId('preference-stable'),
      key: 'scheduling.timeZone.v1',
      valueJson: { timeZone: 'Asia/Shanghai' },
      updatedAt: t0,
    });
    const conflicting = createUserPreference({
      id: parseUserPreferenceId('preference-conflict'),
      key: first.key,
      valueJson: { timeZone: 'UTC' },
      updatedAt: t1,
    });
    await unitOfWork.transaction((transaction) =>
      transaction.userPreferences.upsert(first),
    );
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.userPreferences.upsert(conflicting),
      ),
    ).rejects.toThrow('another identity');
  });
});
