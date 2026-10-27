import { DatabaseSync } from 'node:sqlite';

import {
  DatabaseMigrationError,
  DatabaseRepositoryError,
  databaseMigrations,
  initializeSqliteApplicationUnitOfWork,
  migrateDatabase,
  phase3ExternalMutationIntentsSql,
  type SqliteDatabase,
  type SqliteMigration,
} from '@workspace/database';
import {
  createCalendarBinding,
  createCalendarContainerBinding,
  createCommittedSchedulePlan,
  createExternalMutationIntent,
  createIntegrationJob,
  createOperationRecord,
  createTask,
  createTimeBlock,
  parseCalendarBindingId,
  parseCalendarContainerBindingId,
  parseExternalMutationIntentId,
  parseInstant,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  type ExternalMutationIntent,
  type IntegrationJob,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNodeSqliteDatabase,
  insertOperationRecord,
} from './database-test-support';

const t0 = parseInstant('2026-09-12T08:00:00.000Z');
const t1 = parseInstant('2026-09-12T09:00:00.000Z');
const t2 = parseInstant('2026-09-12T10:00:00.000Z');
const t3 = parseInstant('2026-09-12T11:00:00.000Z');

type UnitOfWork = Awaited<
  ReturnType<typeof initializeSqliteApplicationUnitOfWork>
>;

async function insertPlan(database: SqliteDatabase): Promise<void> {
  await database.run(
    `INSERT INTO schedule_plans (
      id, plan_revision, based_on_state_version, status, created_at,
      committed_at, input_hash, scheduler_version, policy_version,
      time_zone, horizon_start, horizon_end, reason
    ) VALUES (?, 1, 0, 'committed', ?, ?, ?, 'scheduler-v1', 'policy-v1',
      'Asia/Shanghai', ?, ?, 'external-intent-test')`,
    ['plan-intent', t0, t0, `sha256:${'a'.repeat(64)}`, t0, t3],
  );
}

async function insertJob(database: SqliteDatabase): Promise<void> {
  await database.run(
    `INSERT INTO integration_jobs (
      id, operation_id, target_channel, target_entity_type, target_entity_id,
      desired_revision, desired_action, status, attempt_count, last_error_code,
      automatic_retry_eligible, claim_token, lease_expires_at, not_before,
      created_at, updated_at
    ) VALUES ('job-intent', 'operation-intent', 'calendar', 'schedule_plan',
      'plan-intent', 1, 'reconcile', 'pending', 0, NULL, 1, NULL, NULL, ?, ?, ?)`,
    [t0, t0, t0],
  );
}

function createIntent(job: IntegrationJob): ExternalMutationIntent {
  return createExternalMutationIntent({
    id: parseExternalMutationIntentId('intent-calendar-create'),
    integrationJobId: job.id,
    desiredRevision: 1,
    action: 'calendar_event_create',
    payload: {
      provider: 'expo-calendar',
      calendarId: 'app-calendar',
      ownershipKey: 'app-calendar-owner',
      timeBlockId: parseTimeBlockId('block-intent'),
      searchStartAt: t1,
      searchEndAt: t2,
      externalEventId: null,
      occurrenceKey: null,
      expectedContentHash: null,
      desiredContentHash: 'sha256:desired-calendar-event',
      desiredStartAt: t1,
      desiredEndAt: t2,
    },
    createdAt: t0,
  });
}

async function seedRepositoryFacts(unitOfWork: UnitOfWork) {
  const operation = createOperationRecord({
    operationId: parseOperationId('operation-intent'),
    command: 'scheduler.commit',
    parameterHash: `sha256:${'b'.repeat(64)}`,
    resultJson: '{}',
    baseStateVersion: 0,
    currentStateVersion: 1,
    occurredAt: t0,
  });
  const secondOperation = createOperationRecord({
    operationId: parseOperationId('operation-intent-2'),
    command: 'scheduler.commit',
    parameterHash: `sha256:${'d'.repeat(64)}`,
    resultJson: '{}',
    baseStateVersion: 1,
    currentStateVersion: 2,
    occurredAt: t1,
  });
  const task = createTask({
    id: parseTaskId('task-intent'),
    title: 'Intent test task',
    priority: 'normal',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'test',
    createdAt: t0,
  });
  const plan = createCommittedSchedulePlan({
    id: parseSchedulePlanId('plan-intent'),
    planRevision: 1,
    basedOnStateVersion: 0,
    createdAt: t0,
    committedAt: t0,
    inputHash: `sha256:${'c'.repeat(64)}`,
    schedulerVersion: 'scheduler-v1',
    policyVersion: 'policy-v1',
    timeZone: parseTimeZoneId('Asia/Shanghai'),
    horizonStart: t0,
    horizonEnd: t3,
    reason: 'external-intent-test',
  });
  const secondPlan = createCommittedSchedulePlan({
    id: parseSchedulePlanId('plan-intent-2'),
    planRevision: 2,
    basedOnStateVersion: 1,
    createdAt: t1,
    committedAt: t1,
    inputHash: `sha256:${'e'.repeat(64)}`,
    schedulerVersion: 'scheduler-v1',
    policyVersion: 'policy-v1',
    timeZone: parseTimeZoneId('Asia/Shanghai'),
    horizonStart: t0,
    horizonEnd: t3,
    reason: 'external-intent-test-2',
  });
  const block = createTimeBlock({
    id: parseTimeBlockId('block-intent'),
    taskId: task.id,
    type: 'task',
    startAt: t1,
    endAt: t2,
    status: 'planned',
    source: 'scheduler',
    locked: false,
    planRevision: 1,
    createdAt: t0,
  });
  const job = createIntegrationJob({
    id: parseIntegrationJobId('job-intent'),
    operationId: operation.operationId,
    targetChannel: 'calendar',
    targetEntityType: 'schedule_plan',
    targetEntityId: plan.id,
    desiredRevision: 1,
    desiredAction: 'reconcile',
    status: 'reconciliation_required',
    automaticRetryEligible: true,
    createdAt: t0,
  });
  const secondJob = createIntegrationJob({
    id: parseIntegrationJobId('job-intent-2'),
    operationId: secondOperation.operationId,
    targetChannel: 'calendar',
    targetEntityType: 'schedule_plan',
    targetEntityId: secondPlan.id,
    desiredRevision: 2,
    desiredAction: 'reconcile',
    createdAt: t1,
  });
  const container = createCalendarContainerBinding({
    id: parseCalendarContainerBindingId('container-intent'),
    provider: 'expo-calendar',
    calendarId: 'app-calendar',
    ownershipKey: 'app-calendar-owner',
    ownershipVerified: true,
    status: 'synced',
    verifiedAt: t0,
    createdAt: t0,
  });
  await unitOfWork.transaction(async (transaction) => {
    await transaction.operationRecords.insert(operation);
    await transaction.operationRecords.insert(secondOperation);
    await transaction.tasks.insert(task);
    await transaction.schedulePlans.insert(plan);
    await transaction.schedulePlans.insert(secondPlan);
    await transaction.timeBlocks.insert(block);
    await transaction.integrationJobs.insert(job);
    await transaction.integrationJobs.insert(secondJob);
    await transaction.calendarContainerBindings.upsert(container);
  });
  return { block, job, secondJob };
}

describe('Phase 3 durable external mutation intents', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('upgrades 0002 without rewriting history and reruns 0003 exactly once', async () => {
    const through0002 = databaseMigrations.slice(0, 3);
    await migrateDatabase(database, { migrations: through0002, now: () => t0 });
    await insertOperationRecord(database, 'operation-intent', t0);
    await insertPlan(database);
    await insertJob(database);

    await expect(migrateDatabase(database, { now: () => t1 })).resolves.toEqual(
      {
        applied: [
          '0003_phase3_external_mutation_intents',
          '0004_phase4_user_preferences',
          '0005_phase5_execution_achievements',
          '0006_phase6_agent_runs',
          '0007_phase7_user_model_features',
          '0008_phase8_wellbeing',
          '0009_cloud_sync',
          '0010_cloud_bootstrap',
        ],
        alreadyApplied: through0002.map((migration) => migration.id),
      },
    );
    await expect(migrateDatabase(database, { now: () => t2 })).resolves.toEqual(
      {
        applied: [],
        alreadyApplied: databaseMigrations.map((migration) => migration.id),
      },
    );
    await expect(
      database.get<{ readonly status: string }>(
        'SELECT status FROM integration_jobs WHERE id = ?',
        ['job-intent'],
      ),
    ).resolves.toEqual({ status: 'pending' });
  });

  it('rolls the entire intent migration back after a late statement fails', async () => {
    const through0002 = databaseMigrations.slice(0, 3);
    await migrateDatabase(database, { migrations: through0002, now: () => t0 });
    const failingMigration = {
      id: '0003_phase3_external_intent_failure',
      checksum: `sha256:${'f'.repeat(64)}`,
      sql: `${phase3ExternalMutationIntentsSql}
        --> statement-breakpoint
        INSERT INTO missing_external_intent_table (id) VALUES ('boom');`,
    } as const satisfies SqliteMigration;

    await expect(
      migrateDatabase(database, {
        migrations: [...through0002, failingMigration],
        now: () => t1,
      }),
    ).rejects.toMatchObject({
      code: 'migration_failed',
      migrationId: failingMigration.id,
    } satisfies Partial<DatabaseMigrationError>);
    await expect(
      database.get<{ readonly name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'external_mutation_intents'`,
      ),
    ).resolves.toBeUndefined();
    await expect(
      database.all<{ readonly id: string }>(
        'SELECT id FROM __nexta_migrations ORDER BY sequence',
      ),
    ).resolves.toEqual(through0002.map((migration) => ({ id: migration.id })));
  });

  it('enforces one unresolved canonical intent per job and restricts parent deletion', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => t0,
    });
    const { job, secondJob } = await seedRepositoryFacts(unitOfWork);
    const intent = createIntent(job);

    await unitOfWork.transaction((transaction) =>
      transaction.externalMutationIntents.insert(intent),
    );
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.externalMutationIntents.insert({
          ...intent,
          id: parseExternalMutationIntentId('intent-duplicate'),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.externalMutationIntents.insert({
          ...intent,
          id: parseExternalMutationIntentId('intent-duplicate-scope'),
          integrationJobId: secondJob.id,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.integrationJobs.claimNext({
          channel: 'calendar',
          claimToken: 'claim-old-intent-first',
          claimedAt: t2,
          leaseExpiresAt: t3,
        }),
      ),
    ).resolves.toMatchObject({
      job: {
        id: job.id,
        desiredRevision: 1,
        status: 'processing',
      },
      recoveredExpiredLease: false,
    });
    const provisionIntent = createExternalMutationIntent({
      id: parseExternalMutationIntentId('intent-provision'),
      integrationJobId: secondJob.id,
      desiredRevision: 2,
      action: 'calendar_provision',
      payload: {
        provider: 'expo-calendar',
        ownershipKey: 'app-calendar-owner-2',
        existingCalendarId: null,
      },
      createdAt: t1,
    });
    await unitOfWork.transaction((transaction) =>
      transaction.externalMutationIntents.insert(provisionIntent),
    );
    await expect(
      unitOfWork.transaction(async (transaction) => ({
        byScope: await transaction.externalMutationIntents.findByScopeKey(
          intent.scopeKey,
        ),
        calendar:
          await transaction.externalMutationIntents.listByChannel('calendar'),
        notification:
          await transaction.externalMutationIntents.listByChannel(
            'notification',
          ),
      })),
    ).resolves.toEqual({
      byScope: intent,
      calendar: [intent, provisionIntent],
      notification: [],
    });
    const stored = await database.get<{ readonly payload_json: string }>(
      'SELECT payload_json FROM external_mutation_intents WHERE id = ?',
      [intent.id],
    );
    expect(stored).toBeDefined();
    expect(stored?.payload_json).toBe(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(intent.payload).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    );
    expect(stored?.payload_json).not.toContain('Intent test task');
    await expect(
      database.run('DELETE FROM integration_jobs WHERE id = ?', [job.id]),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO external_mutation_intents (
          id, integration_job_id, desired_revision, scope_key, action,
          payload_json, created_at, updated_at
        ) VALUES ('invalid-intent', ?, -1, 'invalid-scope',
          'calendar_event_create', '[]', ?, ?)`,
        [job.id, t0, t0],
      ),
    ).rejects.toThrow();
  });

  it('survives the OS-before-binding crash window and deletes only with a committed checkpoint', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => t0,
    });
    const { block, job } = await seedRepositoryFacts(unitOfWork);
    const intent = createIntent(job);
    await unitOfWork.transaction((transaction) =>
      transaction.externalMutationIntents.insert(intent),
    );

    // The external create may have succeeded before the process disappeared.
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.externalMutationIntents.findByJobId(job.id),
      ),
    ).resolves.toEqual(intent);

    const binding = createCalendarBinding({
      id: parseCalendarBindingId('binding-intent'),
      timeBlockId: block.id,
      provider: 'expo-calendar',
      calendarId: 'app-calendar',
      externalEventId: 'readback-event',
      occurrenceKey: null,
      ownershipKey: 'app-calendar-owner',
      ownershipVerified: true,
      appliedContentHash: 'sha256:desired-calendar-event',
      appliedStartAt: t1,
      appliedEndAt: t2,
      lastAppliedRevision: 1,
      status: 'synced',
      verifiedAt: t2,
      createdAt: t0,
      updatedAt: t2,
    });
    await expect(
      unitOfWork.transaction(async (transaction) => {
        await transaction.calendarBindings.upsertIfNotNewer(binding);
        await transaction.externalMutationIntents.deleteById(intent.id);
        throw new Error('late checkpoint failure');
      }),
    ).rejects.toThrow('late checkpoint failure');
    await expect(
      unitOfWork.transaction(async (transaction) => ({
        binding: await transaction.calendarBindings.findByTimeBlockId(block.id),
        intent: await transaction.externalMutationIntents.findByJobId(job.id),
      })),
    ).resolves.toEqual({ binding: null, intent });

    await unitOfWork.transaction(async (transaction) => {
      expect(await transaction.calendarBindings.upsertIfNotNewer(binding)).toBe(
        true,
      );
      await transaction.externalMutationIntents.deleteById(intent.id);
    });
    await expect(
      unitOfWork.transaction(async (transaction) => ({
        binding: await transaction.calendarBindings.findByTimeBlockId(block.id),
        intent: await transaction.externalMutationIntents.findByJobId(job.id),
      })),
    ).resolves.toEqual({ binding, intent: null });
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.externalMutationIntents.deleteById(intent.id),
      ),
    ).rejects.toMatchObject({
      code: 'row_not_found',
      entity: 'ExternalMutationIntent',
    } satisfies Partial<DatabaseRepositoryError>);
  });
});
