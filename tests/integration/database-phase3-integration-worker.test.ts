import { DatabaseSync } from 'node:sqlite';

import {
  IntegrationService,
  type AppCalendarEventInput,
  type CalendarProvider,
  type NotificationProvider,
} from '@workspace/application';
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
  parseInstant,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const t0 = parseInstant('2026-09-12T08:00:00.000Z');
const t1 = parseInstant('2026-09-12T09:00:00.000Z');
const t2 = parseInstant('2026-09-12T10:00:00.000Z');
const t3 = parseInstant('2026-09-12T11:00:00.000Z');
const horizonEnd = parseInstant('2026-09-13T08:00:00.000Z');

const grantedCapability = {
  status: 'granted',
  canAskAgain: false,
  settingsRequired: false,
} as const;

function sequenceIds(prefix: string) {
  let next = 0;
  return { generate: () => `${prefix}-${++next}` };
}

describe('Phase 3 integration worker over SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('reconciles an unknown create on retry without duplicating the external event', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => t0,
    });
    const task = createTask({
      id: parseTaskId('worker-task'),
      title: 'Worker task',
      priority: 'normal',
      estimatedDurationMinutes: 60,
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'manual',
      createdAt: t0,
    });
    const operation = createOperationRecord({
      operationId: parseOperationId('worker-operation'),
      command: 'scheduler.commit',
      parameterHash: `sha256:${'a'.repeat(64)}`,
      resultJson: '{}',
      baseStateVersion: 0,
      currentStateVersion: 1,
      occurredAt: t0,
    });
    const plan = createCommittedSchedulePlan({
      id: parseSchedulePlanId('worker-plan'),
      planRevision: 1,
      basedOnStateVersion: 0,
      createdAt: t0,
      committedAt: t0,
      inputHash: `sha256:${'b'.repeat(64)}`,
      schedulerVersion: 'scheduler-v1',
      policyVersion: 'policy-v1',
      timeZone: parseTimeZoneId('Asia/Shanghai'),
      horizonStart: t0,
      horizonEnd,
      reason: 'worker-test',
    });
    const block = createTimeBlock({
      id: parseTimeBlockId('worker-block'),
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
      id: parseIntegrationJobId('worker-calendar-job'),
      operationId: operation.operationId,
      targetChannel: 'calendar',
      targetEntityType: 'schedule_plan',
      targetEntityId: plan.id,
      desiredRevision: 1,
      desiredAction: 'reconcile',
      createdAt: t0,
    });
    await unitOfWork.transaction(async (transaction) => {
      await transaction.tasks.insert(task);
      await transaction.operationRecords.insert(operation);
      await transaction.schedulePlans.insert(plan);
      await transaction.timeBlocks.insert(block);
      await transaction.integrationJobs.insert(job);
      await transaction.scheduleState.update({
        stateVersion: 1,
        planRevision: 1,
      });
    });

    let currentTime = t1;
    let createdEvent: AppCalendarEventInput | null = null;
    let createCount = 0;
    const calendar: CalendarProvider = {
      provider: 'expo-calendar',
      getPermissionState: async () => ({
        read: grantedCapability,
        write: grantedCapability,
      }),
      requestPermission: async () => ({
        read: grantedCapability,
        write: grantedCapability,
      }),
      listCalendars: async () => [],
      listBusyEvents: async () => ({
        provider: 'expo-calendar',
        calendarId: 'nexta-owned',
        range: { start: t0, end: horizonEnd },
        fetchedAt: currentTime,
        completeness: 'complete',
        events: [],
      }),
      ensureAppCalendar: async () => ({
        outcome: 'succeeded',
        ref: {
          provider: 'expo-calendar',
          calendarId: 'nexta-owned',
          ownershipKey: 'nexta-owner-v1',
          ownershipVerified: true,
        },
      }),
      createAppEvent: async (input) => {
        createCount += 1;
        createdEvent = input;
        // The platform applied the write, but the adapter lost the response.
        return { outcome: 'unknown' };
      },
      updateAppEvent: async () => ({ outcome: 'unknown' }),
      deleteAppEvent: async () => ({ outcome: 'unknown' }),
      reconcileAppEvent: async () => {
        const event = createdEvent as AppCalendarEventInput | null;
        return event === null
          ? { status: 'missing' }
          : {
              status: 'found',
              ref: {
                provider: 'expo-calendar',
                calendarId: 'nexta-owned',
                externalEventId: 'external-worker-event',
                occurrenceKey: null,
              },
              contentHash: event.contentHash,
              startAt: event.startAt,
              endAt: event.endAt,
              ownershipVerified: true,
            };
      },
      listOwnedAppEvents: async ({ calendar: ownedCalendar, range }) => ({
        status: 'complete',
        provider: ownedCalendar.provider,
        calendarId: ownedCalendar.calendarId,
        range,
        events: [],
      }),
    };
    const notifications: NotificationProvider = {
      getPermissionState: async () => grantedCapability,
      requestPermission: async () => grantedCapability,
      schedule: async () => ({ outcome: 'unknown' }),
      cancel: async () => ({ outcome: 'unknown' }),
      cancelMany: async () => ({ outcome: 'unknown' }),
      reconcile: async () => ({ status: 'unknown' }),
      listOwnedScheduledNotifications: async () => ({
        status: 'complete',
        notifications: [],
      }),
    };
    const service = new IntegrationService({
      unitOfWork,
      calendar,
      notifications,
      projectionPolicy: {
        calendarProvisioning: () => ({
          provider: 'expo-calendar',
          ownershipKey: 'nexta-owner-v1',
          title: 'Nexta',
          color: null,
          androidSource: null,
        }),
        calendarEvent: ({ block: projectedBlock, task: projectedTask }) => ({
          title: projectedTask?.title ?? 'Focus',
          startAt: projectedBlock.startAt,
          endAt: projectedBlock.endAt,
        }),
        notification: () => null,
      },
      inventoryPolicy: {
        calendarRange: () => ({ start: t0, end: horizonEnd }),
      },
      leasePolicy: {
        leaseExpiresAt: ({ claimedAt }) => (claimedAt === t1 ? t2 : t3),
      },
      retryPolicy: { nextAttemptAt: () => t2 },
      clock: { now: () => currentTime },
      ids: {
        claim: sequenceIds('claim'),
        calendarContainerBinding: sequenceIds('container'),
        calendarBinding: sequenceIds('calendar-binding'),
        notificationBinding: sequenceIds('notification-binding'),
        externalMutationIntent: sequenceIds('external-intent'),
      },
    });

    await expect(service.processNext('calendar')).resolves.toMatchObject({
      jobId: job.id,
      status: 'reconciliation_required',
      recoveredExpiredLease: false,
    });
    expect(createCount).toBe(1);
    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.integrationJobs.findById(job.id),
      ).resolves.toMatchObject({
        status: 'reconciliation_required',
        attemptCount: 1,
        automaticRetryEligible: true,
        lastErrorCode: 'external_mutation_intent_pending',
        notBefore: t2,
      });
      await expect(
        transaction.externalMutationIntents.findByJobId(job.id),
      ).resolves.toMatchObject({
        integrationJobId: job.id,
        desiredRevision: 1,
        action: 'calendar_event_create',
      });
      await expect(
        transaction.calendarContainerBindings.findByOwnership(
          'expo-calendar',
          'nexta-owner-v1',
        ),
      ).resolves.toMatchObject({ calendarId: 'nexta-owned' });
      await expect(
        transaction.calendarBindings.findByTimeBlockId(block.id),
      ).resolves.toBeNull();
    });

    await expect(service.processNext('calendar')).resolves.toMatchObject({
      status: 'idle',
      jobId: null,
    });
    currentTime = t2;
    await expect(service.processNext('calendar')).resolves.toMatchObject({
      jobId: job.id,
      status: 'succeeded',
      recoveredExpiredLease: false,
    });
    expect(createCount).toBe(1);

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.integrationJobs.findById(job.id),
      ).resolves.toMatchObject({
        status: 'succeeded',
        attemptCount: 2,
        automaticRetryEligible: false,
        claimToken: null,
        leaseExpiresAt: null,
      });
      await expect(
        transaction.calendarBindings.findByTimeBlockId(block.id),
      ).resolves.toMatchObject({
        externalEventId: 'external-worker-event',
        lastAppliedRevision: 1,
        status: 'synced',
        ownershipVerified: true,
      });
      await expect(transaction.timeBlocks.findById(block.id)).resolves.toEqual(
        block,
      );
      await expect(
        transaction.externalMutationIntents.findByJobId(job.id),
      ).resolves.toBeNull();
    });
  });
});
