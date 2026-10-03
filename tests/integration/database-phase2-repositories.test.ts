import { DatabaseSync } from 'node:sqlite';

import {
  initializeSqliteApplicationUnitOfWork,
  type SqliteDatabase,
} from '@workspace/database';
import {
  createCommittedSchedulePlan,
  createIntegrationJob,
  createOperationRecord,
  createTask,
  createTimeBlock,
  parseIntegrationJobId,
  parseInstant,
  parseOperationId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const firstInstant = parseInstant('2026-09-12T08:00:00.000Z');
const secondInstant = parseInstant('2026-09-12T09:00:00.000Z');
const thirdInstant = parseInstant('2026-09-12T10:00:00.000Z');

function makeCommitFacts(suffix: string) {
  const task = createTask({
    id: parseTaskId(`task-${suffix}`),
    title: `Task ${suffix}`,
    priority: 'normal',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: firstInstant,
  });
  const operation = createOperationRecord({
    operationId: parseOperationId(`operation-${suffix}`),
    command: 'scheduler.commit',
    parameterHash: `sha256:${'c'.repeat(64)}`,
    resultJson: JSON.stringify({ local: 'committed', planRevision: 1 }),
    baseStateVersion: 0,
    currentStateVersion: 1,
    occurredAt: secondInstant,
    diffJson: JSON.stringify({ inserted: [`block-${suffix}`] }),
  });
  const plan = createCommittedSchedulePlan({
    id: parseSchedulePlanId(`plan-${suffix}`),
    planRevision: 1,
    basedOnStateVersion: 0,
    createdAt: secondInstant,
    committedAt: secondInstant,
    inputHash: `sha256:${'d'.repeat(64)}`,
    schedulerVersion: 'scheduler-v1',
    policyVersion: 'policy-v1',
    timeZone: parseTimeZoneId('Asia/Shanghai'),
    horizonStart: secondInstant,
    horizonEnd: parseInstant('2026-09-13T09:00:00.000Z'),
    reason: 'user_request',
  });
  const block = createTimeBlock({
    id: parseTimeBlockId(`block-${suffix}`),
    taskId: task.id,
    type: 'task',
    startAt: secondInstant,
    endAt: thirdInstant,
    status: 'planned',
    source: 'scheduler',
    locked: false,
    planRevision: plan.planRevision,
    createdAt: secondInstant,
  });
  const calendarJob = createIntegrationJob({
    id: parseIntegrationJobId(`job-calendar-${suffix}`),
    operationId: operation.operationId,
    targetChannel: 'calendar',
    targetEntityType: 'schedule_plan',
    targetEntityId: plan.id,
    desiredRevision: plan.planRevision,
    desiredAction: 'reconcile',
    createdAt: secondInstant,
  });
  const notificationJob = createIntegrationJob({
    id: parseIntegrationJobId(`job-notification-${suffix}`),
    operationId: operation.operationId,
    targetChannel: 'notification',
    targetEntityType: 'schedule_plan',
    targetEntityId: plan.id,
    desiredRevision: plan.planRevision,
    desiredAction: 'reconcile',
    createdAt: secondInstant,
  });

  return { block, calendarJob, notificationJob, operation, plan, task };
}

describe('Phase 2 SQLite repositories', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('persists and rehydrates a committed plan, blocks, jobs, and versions', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => firstInstant,
    });
    const facts = makeCommitFacts('roundtrip');

    await unitOfWork.transaction(async (transaction) => {
      await transaction.tasks.insert(facts.task);
      await transaction.operationRecords.insert(facts.operation);
      await transaction.schedulePlans.insert(facts.plan);
      await transaction.timeBlocks.insert(facts.block);
      await transaction.integrationJobs.insert(facts.calendarJob);
      await transaction.integrationJobs.insert(facts.notificationJob);
      await transaction.scheduleState.update({
        stateVersion: 1,
        planRevision: 1,
      });
    });

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.schedulePlans.findByRevision(1),
      ).resolves.toEqual(facts.plan);
      await expect(
        transaction.schedulePlans.findByRevision(2),
      ).resolves.toBeNull();
      await expect(
        transaction.timeBlocks.findById(facts.block.id),
      ).resolves.toEqual(facts.block);
      await expect(transaction.timeBlocks.listAll()).resolves.toEqual([
        facts.block,
      ]);
      await expect(
        transaction.integrationJobs.listByOperationId(
          facts.operation.operationId,
        ),
      ).resolves.toEqual([facts.calendarJob, facts.notificationJob]);
      await expect(transaction.scheduleState.get()).resolves.toEqual({
        stateVersion: 1,
        planRevision: 1,
      });
    });

    const canceledBlock = createTimeBlock({
      ...facts.block,
      status: 'canceled',
      updatedAt: thirdInstant,
    });
    await unitOfWork.transaction((transaction) =>
      transaction.timeBlocks.update(canceledBlock),
    );
    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.timeBlocks.findById(canceledBlock.id),
      ).resolves.toEqual(canceledBlock);
    });
  });

  it('rolls back all commit facts and both versions after a late failure', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => firstInstant,
    });
    const facts = makeCommitFacts('rollback');
    await unitOfWork.transaction((transaction) =>
      transaction.tasks.insert(facts.task),
    );

    await expect(
      unitOfWork.transaction(async (transaction) => {
        await transaction.operationRecords.insert(facts.operation);
        await transaction.schedulePlans.insert(facts.plan);
        await transaction.timeBlocks.insert(facts.block);
        await transaction.integrationJobs.insert(facts.calendarJob);
        await transaction.integrationJobs.insert(facts.notificationJob);
        await transaction.scheduleState.update({
          stateVersion: 1,
          planRevision: 1,
        });
        throw new Error('injected failure after all commit writes');
      }),
    ).rejects.toThrow('injected failure after all commit writes');

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.operationRecords.findById(facts.operation.operationId),
      ).resolves.toBeNull();
      await expect(
        transaction.schedulePlans.findByRevision(1),
      ).resolves.toBeNull();
      await expect(
        transaction.timeBlocks.findById(facts.block.id),
      ).resolves.toBeNull();
      await expect(
        transaction.integrationJobs.listByOperationId(
          facts.operation.operationId,
        ),
      ).resolves.toEqual([]);
      await expect(transaction.scheduleState.get()).resolves.toEqual({
        stateVersion: 0,
        planRevision: 0,
      });
      await expect(transaction.tasks.findById(facts.task.id)).resolves.toEqual(
        facts.task,
      );
    });
  });

  it('turns corrupted Phase 2 rows into sanitized adapter integrity errors', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => firstInstant,
    });
    const facts = makeCommitFacts('corrupt');

    await unitOfWork.transaction(async (transaction) => {
      await transaction.tasks.insert(facts.task);
      await transaction.operationRecords.insert(facts.operation);
      await transaction.schedulePlans.insert(facts.plan);
      await transaction.timeBlocks.insert(facts.block);
    });
    await database.run('PRAGMA ignore_check_constraints = ON');
    await database.run('UPDATE time_blocks SET locked = 4 WHERE id = ?', [
      facts.block.id,
    ]);
    await database.run('PRAGMA ignore_check_constraints = OFF');

    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.timeBlocks.findById(facts.block.id),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      retryable: false,
      causeCategory: 'data_integrity',
    });
  });
});
