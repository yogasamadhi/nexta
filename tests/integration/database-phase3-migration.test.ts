import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  DatabaseMigrationError,
  databaseMigrations,
  integrationJobs,
  migrateDatabase,
  phase1FoundationMigration,
  phase2ScheduleCommitMigration,
  phase3CalendarNotificationsMigration,
  phase3CalendarNotificationsSql,
  phase3ExternalMutationIntentsMigration,
  phase3ExternalMutationIntentsSql,
  phase3Schema,
  type SqliteDatabase,
  type SqliteMigration,
} from '@workspace/database';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNodeSqliteDatabase,
  insertOperationRecord,
} from './database-test-support';

interface ColumnRow {
  readonly dflt_value: string | null;
  readonly name: string;
  readonly notnull: number;
  readonly pk: number;
  readonly type: string;
}

interface ForeignKeyRow {
  readonly from: string;
  readonly on_delete: string;
  readonly on_update: string;
  readonly table: string;
  readonly to: string;
}

interface IndexInfoRow {
  readonly name: string;
  readonly seqno: number;
}

interface IndexRow {
  readonly name: string;
  readonly partial: number;
  readonly unique: number;
}

interface MigrationRow {
  readonly checksum: string;
  readonly id: string;
}

interface NameRow {
  readonly name: string;
}

interface SqlRow {
  readonly sql: string;
}

const firstInstant = '2026-09-12T08:00:00.000Z';
const secondInstant = '2026-09-12T09:00:00.000Z';

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

async function insertPlan(database: SqliteDatabase): Promise<void> {
  await database.run(
    `INSERT INTO schedule_plans (
      id, plan_revision, based_on_state_version, status, created_at,
      committed_at, input_hash, scheduler_version, policy_version,
      time_zone, horizon_start, horizon_end, reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'plan-phase3',
      1,
      0,
      'committed',
      firstInstant,
      firstInstant,
      `sha256:${'a'.repeat(64)}`,
      'scheduler-v1',
      'policy-v1',
      'Asia/Shanghai',
      firstInstant,
      secondInstant,
      'phase3-test',
    ],
  );
}

async function insertLegacyJob(
  database: SqliteDatabase,
  id: string,
  channel: 'calendar' | 'notification',
  status: 'pending' | 'processing',
  attemptCount: number,
): Promise<void> {
  await database.run(
    `INSERT INTO integration_jobs (
      id, operation_id, target_channel, target_entity_type,
      target_entity_id, desired_revision, desired_action, status,
      attempt_count, created_at, updated_at
    ) VALUES (?, ?, ?, 'schedule_plan', 'plan-phase3', 1, 'reconcile', ?, ?, ?, ?)`,
    [
      id,
      `operation-${channel}`,
      channel,
      status,
      attemptCount,
      firstInstant,
      secondInstant,
    ],
  );
}

describe('Phase 3 SQLite migration', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('preserves historical checksums and binds Phase 3 SQL files', async () => {
    const calendarSqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0002_phase3_calendar_notifications.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const intentsSqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0003_phase3_external_mutation_intents.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const normalizedCalendarSql = calendarSqlFile.trim();
    const normalizedIntentsSql = intentsSqlFile.trim();

    expect(phase1FoundationMigration.checksum).toBe(
      'sha256:6c202fff658b485ac387b186934cc7521d17abcb4762215e521ea9260d1f7636',
    );
    expect(phase2ScheduleCommitMigration.checksum).toBe(
      'sha256:4dba830baec5c753deab9f397ae1b88c3849d666d73364b431e294558eb4a1ff',
    );
    expect(phase3CalendarNotificationsSql).toBe(normalizedCalendarSql);
    expect(phase3CalendarNotificationsMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedCalendarSql).digest('hex')}`,
    );
    expect(phase3ExternalMutationIntentsSql).toBe(normalizedIntentsSql);
    expect(phase3ExternalMutationIntentsMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedIntentsSql).digest('hex')}`,
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
    ]);
  });

  it('upgrades 0001 data, backfills scheduling, and converts unsafe legacy claims', async () => {
    await migrateDatabase(database, {
      migrations: [phase1FoundationMigration, phase2ScheduleCommitMigration],
      now: () => firstInstant,
    });
    await insertOperationRecord(database, 'operation-calendar', firstInstant);
    await insertOperationRecord(
      database,
      'operation-notification',
      firstInstant,
    );
    await insertPlan(database);
    await insertLegacyJob(database, 'legacy-pending', 'calendar', 'pending', 0);
    await insertLegacyJob(
      database,
      'legacy-processing',
      'notification',
      'processing',
      3,
    );

    const upgrade = await migrateDatabase(database, {
      now: () => secondInstant,
    });
    const rerun = await migrateDatabase(database, {
      now: () => secondInstant,
    });

    expect(upgrade).toEqual({
      applied: [
        '0002_phase3_calendar_notifications',
        '0003_phase3_external_mutation_intents',
        '0004_phase4_user_preferences',
        '0005_phase5_execution_achievements',
        '0006_phase6_agent_runs',
        '0007_phase7_user_model_features',
        '0008_phase8_wellbeing',
      ],
      alreadyApplied: ['0000_phase1_foundation', '0001_phase2_schedule_commit'],
    });
    expect(rerun).toEqual({
      applied: [],
      alreadyApplied: databaseMigrations.map((migration) => migration.id),
    });
    await expect(
      database.all<{
        readonly attempt_count: number;
        readonly automatic_retry_eligible: number;
        readonly claim_token: string | null;
        readonly id: string;
        readonly lease_expires_at: string | null;
        readonly not_before: string;
        readonly status: string;
      }>(
        `SELECT id, status, attempt_count, automatic_retry_eligible,
          claim_token, lease_expires_at, not_before
         FROM integration_jobs ORDER BY id`,
      ),
    ).resolves.toEqual([
      {
        attempt_count: 0,
        automatic_retry_eligible: 1,
        claim_token: null,
        id: 'legacy-pending',
        lease_expires_at: null,
        not_before: firstInstant,
        status: 'pending',
      },
      {
        attempt_count: 3,
        automatic_retry_eligible: 0,
        claim_token: null,
        id: 'legacy-processing',
        lease_expires_at: null,
        not_before: firstInstant,
        status: 'reconciliation_required',
      },
    ]);
    await expect(
      database.all<MigrationRow>(
        'SELECT id, checksum FROM __nexta_migrations ORDER BY sequence',
      ),
    ).resolves.toEqual(
      databaseMigrations.map(({ id, checksum }) => ({ id, checksum })),
    );
  });

  it('reproduces the Phase 3 Drizzle columns, checks, indexes, and foreign keys', async () => {
    await migrateDatabase(database, { now: () => firstInstant });
    const currentTables = [integrationJobs, ...Object.values(phase3Schema)];

    for (const drizzleTable of currentTables.map((table) =>
      getTableConfig(table),
    )) {
      const columns = await database.all<ColumnRow>(
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

      const tableDefinition = await database.get<SqlRow>(
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

    const partialIndexes = await database.all<IndexRow>(
      `PRAGMA index_list('external_calendar_event_snapshots')`,
    );
    expect(
      partialIndexes
        .filter((index) => index.partial === 1)
        .map((index) => index.name)
        .sort(),
    ).toEqual([
      'external_calendar_snapshots_occurrence_unique',
      'external_calendar_snapshots_singleton_unique',
    ]);
  });

  it('enforces retry eligibility, lease, and verified-ownership checks', async () => {
    await migrateDatabase(database, { now: () => firstInstant });
    await insertOperationRecord(database, 'operation-calendar', firstInstant);
    await insertPlan(database);
    const insertJob = (
      id: string,
      status: string,
      automaticRetryEligible: number,
      claimToken: string | null,
      leaseExpiresAt: string | null,
    ) =>
      database.run(
        `INSERT INTO integration_jobs (
          id, operation_id, target_channel, target_entity_type,
          target_entity_id, desired_revision, desired_action, status,
          attempt_count, automatic_retry_eligible, claim_token,
          lease_expires_at, not_before, created_at, updated_at
        ) VALUES (?, 'operation-calendar', 'calendar', 'schedule_plan',
          'plan-phase3', ?, 'reconcile', ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          id.length,
          status,
          automaticRetryEligible,
          claimToken,
          leaseExpiresAt,
          firstInstant,
          firstInstant,
          secondInstant,
        ],
      );

    await expect(
      insertJob('pending-disabled', 'pending', 0, null, null),
    ).rejects.toThrow();
    await expect(
      insertJob('terminal-retry', 'succeeded', 1, null, null),
    ).rejects.toThrow();
    await expect(
      insertJob(
        'expired-on-claim',
        'processing',
        1,
        'claim-token',
        secondInstant,
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO calendar_container_bindings (
          id, provider, calendar_id, ownership_key, ownership_verified,
          status, verified_at, created_at, updated_at
        ) VALUES ('unverified', 'expo-calendar', 'calendar', 'owner', 0,
          'synced', ?, ?, ?)`,
        [secondInstant, firstInstant, secondInstant],
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO external_calendar_event_snapshots (
          id, provider, calendar_id, external_event_id, occurrence_key,
          start_at, end_at, busy, last_seen_at, content_hash
        ) VALUES ('blank-occurrence', 'expo-calendar', 'calendar', 'event',
          '   ', ?, ?, 1, ?, 'hash')`,
        [firstInstant, secondInstant, secondInstant],
      ),
    ).rejects.toThrow();
  });

  it('rolls all rebuilt and new tables back when a late 0002 statement fails', async () => {
    await migrateDatabase(database, {
      migrations: [phase1FoundationMigration, phase2ScheduleCommitMigration],
      now: () => firstInstant,
    });
    await insertOperationRecord(database, 'operation-calendar', firstInstant);
    await insertPlan(database);
    await insertLegacyJob(database, 'surviving-job', 'calendar', 'pending', 0);
    const failingMigration = {
      id: '0002_phase3_intentional_failure',
      checksum: `sha256:${'f'.repeat(64)}`,
      sql: `${phase3CalendarNotificationsSql}
        --> statement-breakpoint
        INSERT INTO missing_phase3_table (id) VALUES ('boom');`,
    } as const satisfies SqliteMigration;

    await expect(
      migrateDatabase(database, {
        migrations: [
          phase1FoundationMigration,
          phase2ScheduleCommitMigration,
          failingMigration,
        ],
        now: () => secondInstant,
      }),
    ).rejects.toMatchObject({
      code: 'migration_failed',
      migrationId: failingMigration.id,
    } satisfies Partial<DatabaseMigrationError>);

    const columns = await database.all<ColumnRow>(
      `PRAGMA table_info('integration_jobs')`,
    );
    expect(columns.map((column) => column.name)).not.toContain('not_before');
    await expect(
      database.get<{ readonly status: string }>(
        'SELECT status FROM integration_jobs WHERE id = ?',
        ['surviving-job'],
      ),
    ).resolves.toEqual({ status: 'pending' });
    await expect(
      database.get<NameRow>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'calendar_bindings'`,
      ),
    ).resolves.toBeUndefined();
    await expect(
      database.all<{ readonly id: string }>(
        'SELECT id FROM __nexta_migrations ORDER BY sequence',
      ),
    ).resolves.toEqual([
      { id: phase1FoundationMigration.id },
      { id: phase2ScheduleCommitMigration.id },
    ]);
  });
});
