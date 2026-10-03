import { DatabaseSync } from 'node:sqlite';

import {
  initializeSqliteApplicationUnitOfWork,
  type SqliteDatabase,
} from '@workspace/database';
import {
  createCalendarBinding,
  createCalendarContainerBinding,
  createCalendarRefreshCoverage,
  createCommittedSchedulePlan,
  createExternalCalendarEventSnapshot,
  createIntegrationJob,
  createNotificationBinding,
  createOperationRecord,
  createTask,
  createTimeBlock,
  parseCalendarBindingId,
  parseCalendarContainerBindingId,
  parseCalendarRefreshCoverageId,
  parseExternalCalendarEventSnapshotId,
  parseInstant,
  parseIntegrationJobId,
  parseNotificationBindingId,
  parseOperationId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  settleIntegrationJob,
  type CalendarBinding,
  type IntegrationJob,
  type NotificationBinding,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const t0 = parseInstant('2026-09-12T08:00:00.000Z');
const t1 = parseInstant('2026-09-12T09:00:00.000Z');
const t2 = parseInstant('2026-09-12T10:00:00.000Z');
const t3 = parseInstant('2026-09-12T11:00:00.000Z');
const t4 = parseInstant('2026-09-12T12:00:00.000Z');
const horizonEnd = parseInstant('2026-09-13T08:00:00.000Z');

type UnitOfWork = Awaited<
  ReturnType<typeof initializeSqliteApplicationUnitOfWork>
>;

function makeOperation(suffix: string, stateVersion = 0) {
  return createOperationRecord({
    operationId: parseOperationId(`operation-${suffix}`),
    command: 'scheduler.commit',
    parameterHash: `sha256:${suffix.padEnd(64, 'a').slice(0, 64)}`,
    resultJson: '{}',
    baseStateVersion: stateVersion,
    currentStateVersion: stateVersion,
    occurredAt: t0,
  });
}

function makePlan(revision: number) {
  return createCommittedSchedulePlan({
    id: parseSchedulePlanId(`plan-${revision}`),
    planRevision: revision,
    basedOnStateVersion: 0,
    createdAt: t0,
    committedAt: t0,
    inputHash: `sha256:${String(revision).padEnd(64, 'b')}`,
    schedulerVersion: 'scheduler-v1',
    policyVersion: 'policy-v1',
    timeZone: parseTimeZoneId('Asia/Shanghai'),
    horizonStart: t0,
    horizonEnd,
    reason: 'integration-test',
  });
}

async function seedSchedule(unitOfWork: UnitOfWork): Promise<void> {
  const task = createTask({
    id: parseTaskId('task-phase3'),
    title: 'Phase 3 task',
    priority: 'normal',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: t0,
  });
  await unitOfWork.transaction(async (transaction) => {
    await transaction.tasks.insert(task);
    for (const revision of [1, 2, 3, 4]) {
      await transaction.schedulePlans.insert(makePlan(revision));
    }
    for (const [index, range] of [
      [1, [t0, t1]],
      [2, [t1, t2]],
      [3, [t2, t3]],
      [4, [t3, t4]],
    ] as const) {
      await transaction.timeBlocks.insert(
        createTimeBlock({
          id: parseTimeBlockId(`block-${index}`),
          taskId: task.id,
          type: 'task',
          startAt: range[0],
          endAt: range[1],
          status: 'planned',
          source: 'scheduler',
          locked: false,
          planRevision: index,
          createdAt: t0,
        }),
      );
    }
    for (const suffix of ['calendar', 'notification']) {
      await transaction.operationRecords.insert(makeOperation(suffix));
    }
  });
}

function makeSnapshot(
  id: string,
  values: Partial<{
    busy: boolean;
    calendarId: string;
    contentHash: string;
    endAt: typeof t0;
    externalEventId: string;
    lastSeenAt: typeof t0;
    occurrenceKey: string | null;
    provider: string;
    startAt: typeof t0;
  }> = {},
) {
  return createExternalCalendarEventSnapshot({
    id: parseExternalCalendarEventSnapshotId(id),
    provider: values.provider ?? 'expo-calendar',
    calendarId: values.calendarId ?? 'personal',
    externalEventId: values.externalEventId ?? id,
    occurrenceKey: values.occurrenceKey ?? null,
    startAt: values.startAt ?? t1,
    endAt: values.endAt ?? t2,
    busy: values.busy ?? true,
    lastSeenAt: values.lastSeenAt ?? t2,
    contentHash: values.contentHash ?? `hash-${id}`,
  });
}

function makeContainer(
  values: Partial<{
    calendarId: string;
    id: string;
    ownershipKey: string;
    provider: string;
  }> = {},
) {
  return createCalendarContainerBinding({
    id: parseCalendarContainerBindingId(values.id ?? 'container-1'),
    provider: values.provider ?? 'expo-calendar',
    calendarId: values.calendarId ?? 'nexta-owned',
    ownershipKey: values.ownershipKey ?? 'nexta-owner-v1',
    ownershipVerified: true,
    status: 'synced',
    verifiedAt: t1,
    createdAt: t0,
    updatedAt: t1,
  });
}

function makeCalendarBinding(
  values: Partial<{
    calendarId: string;
    externalEventId: string;
    id: string;
    lastAppliedRevision: number;
    occurrenceKey: string | null;
    ownershipKey: string;
    timeBlockId: string;
    updatedAt: typeof t0;
  }> = {},
): CalendarBinding {
  return createCalendarBinding({
    id: parseCalendarBindingId(values.id ?? 'calendar-binding-1'),
    timeBlockId: parseTimeBlockId(values.timeBlockId ?? 'block-1'),
    provider: 'expo-calendar',
    calendarId: values.calendarId ?? 'nexta-owned',
    externalEventId: values.externalEventId ?? 'owned-event-1',
    occurrenceKey: values.occurrenceKey ?? null,
    ownershipKey: values.ownershipKey ?? 'nexta-owner-v1',
    ownershipVerified: true,
    appliedContentHash: 'calendar-content-v1',
    appliedStartAt: t0,
    appliedEndAt: t1,
    lastAppliedRevision: values.lastAppliedRevision ?? 1,
    status: 'synced',
    verifiedAt: t1,
    createdAt: t0,
    updatedAt: values.updatedAt ?? t1,
  });
}

function makeNotificationBinding(
  values: Partial<{
    desiredRevision: number;
    id: string;
    lastAppliedRevision: number;
    osNotificationId: string;
    taskId: string | null;
    timeBlockId: string;
    type: string;
  }> = {},
): NotificationBinding {
  const desiredRevision = values.desiredRevision ?? 1;
  const lastAppliedRevision = values.lastAppliedRevision ?? desiredRevision;
  return createNotificationBinding({
    id: parseNotificationBindingId(values.id ?? 'notification-binding-1'),
    timeBlockId: parseTimeBlockId(values.timeBlockId ?? 'block-1'),
    taskId:
      values.taskId === null
        ? null
        : parseTaskId(values.taskId ?? 'task-phase3'),
    osNotificationId: values.osNotificationId ?? 'os-notification-1',
    type: values.type ?? 'start-reminder',
    appliedContentHash: `notification-content-${lastAppliedRevision}`,
    scheduledAt: t1,
    desiredRevision,
    lastAppliedRevision,
    status: desiredRevision === lastAppliedRevision ? 'synced' : 'pending',
    identityVerified: true,
    verifiedAt: t1,
    createdAt: t0,
    updatedAt: t1,
  });
}

function makeJob(
  id: string,
  values: Partial<{
    channel: 'calendar' | 'notification';
    notBefore: typeof t0;
    planRevision: number;
    status: IntegrationJob['status'];
  }> = {},
): IntegrationJob {
  const channel = values.channel ?? 'calendar';
  const planRevision = values.planRevision ?? 1;
  return createIntegrationJob({
    id: parseIntegrationJobId(id),
    operationId: parseOperationId(`operation-${channel}`),
    targetChannel: channel,
    targetEntityType: 'schedule_plan',
    targetEntityId: parseSchedulePlanId(`plan-${planRevision}`),
    desiredRevision: planRevision,
    desiredAction: 'reconcile',
    status: values.status,
    notBefore: values.notBefore ?? t0,
    createdAt: t0,
  });
}

describe('Phase 3 SQLite repositories', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;
  let unitOfWork: UnitOfWork;

  beforeEach(async () => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
    unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => t0,
    });
    await seedSchedule(unitOfWork);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('upserts calendar snapshots by nullable occurrence identity and queries half-open overlap', async () => {
    const singleton = makeSnapshot('snapshot-singleton', {
      externalEventId: 'shared-event',
    });
    const updatedSingleton = makeSnapshot('snapshot-singleton-replaced', {
      busy: false,
      contentHash: 'hash-updated',
      externalEventId: 'shared-event',
      lastSeenAt: t3,
    });
    const firstOccurrence = makeSnapshot('snapshot-occurrence-1', {
      externalEventId: 'recurring-event',
      occurrenceKey: '2026-09-12T09:00:00.000Z',
    });
    const secondOccurrence = makeSnapshot('snapshot-occurrence-2', {
      externalEventId: 'recurring-event',
      occurrenceKey: '2026-09-13T09:00:00.000Z',
      startAt: t2,
      endAt: t3,
    });
    const endsAtBoundary = makeSnapshot('snapshot-before', {
      startAt: t0,
      endAt: t1,
    });
    const startsAtBoundary = makeSnapshot('snapshot-after', {
      startAt: t2,
      endAt: t3,
    });

    await unitOfWork.transaction(async (transaction) => {
      for (const snapshot of [
        singleton,
        firstOccurrence,
        secondOccurrence,
        endsAtBoundary,
        startsAtBoundary,
      ]) {
        await transaction.externalCalendarEventSnapshots.upsert(snapshot);
      }
      await transaction.externalCalendarEventSnapshots.upsert(updatedSingleton);
    });

    await unitOfWork.transaction(async (transaction) => {
      const overlap =
        await transaction.externalCalendarEventSnapshots.listOverlapping({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t1,
          rangeEnd: t2,
        });
      expect(overlap.map((snapshot) => snapshot.id)).toEqual([
        firstOccurrence.id,
        updatedSingleton.id,
      ]);
      expect(overlap[1]).toEqual(updatedSingleton);
      await transaction.externalCalendarEventSnapshots.deleteByIds([
        firstOccurrence.id,
      ]);
    });

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.externalCalendarEventSnapshots.listOverlapping({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t1,
          rangeEnd: t2,
        }),
      ).resolves.toEqual([updatedSingleton]);
    });

    await expect(
      database.run(
        `INSERT INTO external_calendar_event_snapshots (
          id, provider, calendar_id, external_event_id, occurrence_key,
          start_at, end_at, busy, last_seen_at, content_hash
        ) VALUES ('duplicate-null', 'expo-calendar', 'personal',
          'shared-event', NULL, ?, ?, 1, ?, 'hash')`,
        [t1, t2, t2],
      ),
    ).rejects.toThrow();
  });

  it('persists only complete refresh coverage and returns the newest covering range', async () => {
    const broad = createCalendarRefreshCoverage({
      id: parseCalendarRefreshCoverageId('coverage-broad'),
      provider: 'expo-calendar',
      calendarId: 'personal',
      rangeStart: t0,
      rangeEnd: t4,
      fetchedAt: t1,
      completeness: 'complete',
      observedEventCount: 0,
    });
    const latest = createCalendarRefreshCoverage({
      ...broad,
      id: parseCalendarRefreshCoverageId('coverage-latest'),
      fetchedAt: t2,
      observedEventCount: 2,
    });
    const narrow = createCalendarRefreshCoverage({
      ...broad,
      id: parseCalendarRefreshCoverageId('coverage-narrow'),
      rangeStart: t1,
      rangeEnd: t2,
      fetchedAt: t3,
      observedEventCount: 1,
    });
    await unitOfWork.transaction(async (transaction) => {
      await transaction.calendarRefreshCoverages.insert(broad);
      await transaction.calendarRefreshCoverages.insert(latest);
      await transaction.calendarRefreshCoverages.insert(narrow);
    });

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.calendarRefreshCoverages.findLatestCovering({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t1,
          rangeEnd: t3,
        }),
      ).resolves.toEqual(latest);
    });
    await expect(
      database.run(
        `INSERT INTO calendar_refresh_coverages (
          id, provider, calendar_id, range_start, range_end, fetched_at,
          completeness, observed_event_count
        ) VALUES ('partial', 'expo-calendar', 'personal', ?, ?, ?, 'partial', 0)`,
        [t0, t1, t1],
      ),
    ).rejects.toThrow();
  });

  it('enforces verified calendar authority and revision-fenced event bindings', async () => {
    const container = makeContainer();
    const binding = makeCalendarBinding();
    const stale = makeCalendarBinding({
      id: 'calendar-binding-stale',
      lastAppliedRevision: 0,
      updatedAt: t2,
    });
    const current = makeCalendarBinding({
      id: 'calendar-binding-current',
      lastAppliedRevision: 2,
      updatedAt: t2,
    });
    await unitOfWork.transaction(async (transaction) => {
      await transaction.calendarContainerBindings.upsert(container);
      await expect(
        transaction.calendarBindings.upsertIfNotNewer(binding),
      ).resolves.toBe(true);
      await expect(
        transaction.calendarBindings.upsertIfNotNewer(stale),
      ).resolves.toBe(false);
      await expect(
        transaction.calendarBindings.findByTimeBlockId(binding.timeBlockId),
      ).resolves.toEqual(binding);
      await expect(
        transaction.calendarBindings.upsertIfNotNewer(current),
      ).resolves.toBe(true);
      await expect(
        transaction.calendarBindings.deleteIfNotNewer(current.id, 1),
      ).resolves.toBe(false);
      await expect(
        transaction.calendarBindings.deleteIfNotNewer(current.id, 2),
      ).resolves.toBe(true);
    });

    await unitOfWork.transaction(async (transaction) => {
      await transaction.calendarBindings.upsertIfNotNewer(binding);
      await expect(
        transaction.calendarBindings.upsertIfNotNewer(
          makeCalendarBinding({
            id: 'calendar-binding-duplicate-singleton',
            timeBlockId: 'block-2',
          }),
        ),
      ).rejects.toThrow();
      await expect(
        transaction.calendarBindings.upsertIfNotNewer(
          makeCalendarBinding({
            externalEventId: 'recurring-owned-event',
            id: 'calendar-binding-occurrence-1',
            occurrenceKey: '2026-09-12T09:00:00.000Z',
            timeBlockId: 'block-2',
          }),
        ),
      ).resolves.toBe(true);
      await expect(
        transaction.calendarBindings.upsertIfNotNewer(
          makeCalendarBinding({
            externalEventId: 'recurring-owned-event',
            id: 'calendar-binding-occurrence-2',
            occurrenceKey: '2026-09-13T09:00:00.000Z',
            timeBlockId: 'block-3',
          }),
        ),
      ).resolves.toBe(true);
      await expect(
        transaction.calendarBindings.upsertIfNotNewer(
          makeCalendarBinding({
            externalEventId: 'recurring-owned-event',
            id: 'calendar-binding-occurrence-duplicate',
            occurrenceKey: '2026-09-13T09:00:00.000Z',
            timeBlockId: 'block-4',
          }),
        ),
      ).rejects.toThrow();
      await expect(
        transaction.calendarBindings.upsertIfNotNewer(
          makeCalendarBinding({
            calendarId: 'unverified-calendar',
            externalEventId: 'different-event',
            id: 'calendar-binding-wrong-authority',
            timeBlockId: 'block-3',
          }),
        ),
      ).rejects.toThrow();
      await expect(
        transaction.calendarContainerBindings.upsert(
          makeContainer({
            id: 'duplicate-calendar-container',
            ownershipKey: 'different-owner',
          }),
        ),
      ).rejects.toThrow();
    });
  });

  it('keeps notification identity stable and rejects stale or colliding bindings', async () => {
    const original = makeNotificationBinding();
    const stale = makeNotificationBinding({
      desiredRevision: 0,
      id: 'notification-binding-stale',
      lastAppliedRevision: 0,
      osNotificationId: 'os-stale',
    });
    const current = makeNotificationBinding({
      desiredRevision: 2,
      id: 'notification-binding-current',
      lastAppliedRevision: 2,
      osNotificationId: 'os-current',
    });
    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.notificationBindings.upsertIfNotNewer(original),
      ).resolves.toBe(true);
      await expect(
        transaction.notificationBindings.upsertIfNotNewer(stale),
      ).resolves.toBe(false);
      await expect(
        transaction.notificationBindings.upsertIfNotNewer(current),
      ).resolves.toBe(true);
      await expect(
        transaction.notificationBindings.findByIdentity(
          current.timeBlockId,
          current.type,
        ),
      ).resolves.toEqual(current);
      await expect(
        transaction.notificationBindings.upsertIfNotNewer(
          makeNotificationBinding({
            id: 'notification-binding-os-collision',
            osNotificationId: current.osNotificationId,
            timeBlockId: 'block-2',
          }),
        ),
      ).rejects.toThrow();
      const taskless = makeNotificationBinding({
        id: 'notification-binding-taskless',
        osNotificationId: 'os-taskless',
        taskId: null,
        timeBlockId: 'block-3',
        type: 'recovery-reminder',
      });
      await expect(
        transaction.notificationBindings.upsertIfNotNewer(taskless),
      ).resolves.toBe(true);
      await expect(
        transaction.notificationBindings.findByIdentity(
          taskless.timeBlockId,
          taskless.type,
        ),
      ).resolves.toEqual(taskless);
      await expect(
        transaction.notificationBindings.deleteIfNotNewer(current.id, 1),
      ).resolves.toBe(false);
      await expect(
        transaction.notificationBindings.deleteIfNotNewer(current.id, 2),
      ).resolves.toBe(true);
    });
  });

  it('serializes each job channel, recovers expired leases, and fences stale workers', async () => {
    const first = makeJob('job-calendar-1');
    const next = makeJob('job-calendar-2', { planRevision: 2 });
    const notification = makeJob('job-notification-1', {
      channel: 'notification',
    });
    await unitOfWork.transaction(async (transaction) => {
      await transaction.integrationJobs.insert(first);
      await transaction.integrationJobs.insert(next);
      await transaction.integrationJobs.insert(notification);
    });

    const firstClaim = await unitOfWork.transaction((transaction) =>
      transaction.integrationJobs.claimNext({
        channel: 'calendar',
        claimToken: 'calendar-claim-1',
        claimedAt: t1,
        leaseExpiresAt: t2,
      }),
    );
    expect(firstClaim).toMatchObject({
      job: { attemptCount: 1, id: next.id, status: 'processing' },
      recoveredExpiredLease: false,
    });
    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.integrationJobs.claimNext({
          channel: 'calendar',
          claimToken: 'blocked-claim',
          claimedAt: t1,
          leaseExpiresAt: t2,
        }),
      ).resolves.toBeNull();
      await expect(
        transaction.integrationJobs.claimNext({
          channel: 'notification',
          claimToken: 'notification-claim',
          claimedAt: t1,
          leaseExpiresAt: t2,
        }),
      ).resolves.toMatchObject({
        job: { id: notification.id },
        recoveredExpiredLease: false,
      });
    });

    const recovered = await unitOfWork.transaction((transaction) =>
      transaction.integrationJobs.claimNext({
        channel: 'calendar',
        claimToken: 'calendar-claim-2',
        claimedAt: t2,
        leaseExpiresAt: t3,
      }),
    );
    expect(recovered).toMatchObject({
      job: { attemptCount: 2, id: next.id, status: 'processing' },
      recoveredExpiredLease: true,
    });
    if (!firstClaim || !recovered) throw new Error('Expected claimed jobs.');

    const staleSettlement = settleIntegrationJob(firstClaim.job, {
      claimToken: 'calendar-claim-1',
      attemptCount: 1,
      status: 'succeeded',
      updatedAt: t2,
    });
    const currentSettlement = settleIntegrationJob(recovered.job, {
      claimToken: 'calendar-claim-2',
      attemptCount: 2,
      status: 'succeeded',
      updatedAt: t3,
    });
    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.integrationJobs.updateClaimed(staleSettlement, {
          expectedClaimToken: 'calendar-claim-1',
          expectedAttemptCount: 1,
        }),
      ).resolves.toBe(false);
      await expect(
        transaction.integrationJobs.updateClaimed(currentSettlement, {
          expectedClaimToken: 'calendar-claim-2',
          expectedAttemptCount: 2,
        }),
      ).resolves.toBe(true);
      await expect(
        transaction.integrationJobs.findById(next.id),
      ).resolves.toEqual(currentSettlement);
      await expect(
        transaction.integrationJobs.findLatestByChannel('calendar'),
      ).resolves.toEqual(currentSettlement);
    });
  });

  it('gates notBefore and rolls a claim generation back with its transaction', async () => {
    const future = makeJob('job-calendar-future', {
      notBefore: t2,
      planRevision: 3,
    });
    await unitOfWork.transaction((transaction) =>
      transaction.integrationJobs.insert(future),
    );

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.integrationJobs.claimNext({
          channel: 'calendar',
          claimToken: 'too-early',
          claimedAt: t1,
          leaseExpiresAt: t2,
        }),
      ).resolves.toBeNull();
    });
    await expect(
      unitOfWork.transaction(async (transaction) => {
        const claimed = await transaction.integrationJobs.claimNext({
          channel: 'calendar',
          claimToken: 'rolled-back',
          claimedAt: t2,
          leaseExpiresAt: t3,
        });
        expect(claimed?.job.attemptCount).toBe(1);
        throw new Error('late worker transaction failure');
      }),
    ).rejects.toThrow('late worker transaction failure');

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.integrationJobs.findById(future.id),
      ).resolves.toEqual(future);
      await expect(
        transaction.integrationJobs.claimNext({
          channel: 'calendar',
          claimToken: 'after-rollback',
          claimedAt: t2,
          leaseExpiresAt: t3,
        }),
      ).resolves.toMatchObject({
        job: { attemptCount: 1, id: future.id },
        recoveredExpiredLease: false,
      });
    });
  });

  it('requeues only foreground permission blocks and skips non-retryable recovery jobs', async () => {
    const permissionBlocked = makeJob('job-notification-permission', {
      channel: 'notification',
      planRevision: 1,
      status: 'permission_required',
    });
    const disabled = makeJob('job-notification-disabled', {
      channel: 'notification',
      planRevision: 2,
      status: 'disabled',
    });
    const unsafeRecovery = createIntegrationJob({
      ...makeJob('job-calendar-unsafe-recovery', { planRevision: 4 }),
      status: 'reconciliation_required',
      automaticRetryEligible: false,
    });
    await unitOfWork.transaction(async (transaction) => {
      await transaction.integrationJobs.insert(permissionBlocked);
      await transaction.integrationJobs.insert(disabled);
      await transaction.integrationJobs.insert(unsafeRecovery);
      await expect(
        transaction.integrationJobs.claimNext({
          channel: 'calendar',
          claimToken: 'must-not-auto-retry',
          claimedAt: t1,
          leaseExpiresAt: t2,
        }),
      ).resolves.toBeNull();
      await expect(
        transaction.integrationJobs.requeueBlockedJob({
          jobId: unsafeRecovery.id,
          channel: 'calendar',
          requeuedAt: t1,
          notBefore: t2,
        }),
      ).resolves.toBe(true);
      await expect(
        transaction.integrationJobs.findById(unsafeRecovery.id),
      ).resolves.toEqual({
        ...unsafeRecovery,
        status: 'pending',
        automaticRetryEligible: true,
        lastErrorCode: null,
        notBefore: t2,
        updatedAt: t1,
      });
      await expect(
        transaction.integrationJobs.requeueBlockedJob({
          jobId: disabled.id,
          channel: 'notification',
          requeuedAt: t1,
          notBefore: t2,
        }),
      ).resolves.toBe(false);
      await expect(
        transaction.integrationJobs.requeueBlockedChannel({
          channel: 'notification',
          requeuedAt: t1,
          notBefore: t2,
        }),
      ).resolves.toBe(1);
      await expect(
        transaction.integrationJobs.findById(permissionBlocked.id),
      ).resolves.toEqual({
        ...permissionBlocked,
        status: 'pending',
        automaticRetryEligible: true,
        lastErrorCode: null,
        notBefore: t2,
        updatedAt: t1,
      });
      await expect(
        transaction.integrationJobs.findById(disabled.id),
      ).resolves.toEqual(disabled);
      await expect(
        transaction.integrationJobs.claimNext({
          channel: 'notification',
          claimToken: 'still-not-before',
          claimedAt: t1,
          leaseExpiresAt: t2,
        }),
      ).resolves.toBeNull();
    });
  });

  it('requeues only a safe terminal projection for the requested current revision', async () => {
    const completed = makeJob('job-notification-projected', {
      channel: 'notification',
      planRevision: 3,
      status: 'succeeded',
    });
    await unitOfWork.transaction((transaction) =>
      transaction.integrationJobs.insert(completed),
    );

    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.integrationJobs.requeueLatestProjection({
          channel: 'notification',
          desiredRevision: 2,
          requeuedAt: t1,
          notBefore: t1,
        }),
      ).resolves.toBe(false);
      await expect(
        transaction.integrationJobs.requeueLatestProjection({
          channel: 'notification',
          desiredRevision: 3,
          requeuedAt: t1,
          notBefore: t2,
        }),
      ).resolves.toBe(true);
      await expect(
        transaction.integrationJobs.findById(completed.id),
      ).resolves.toEqual({
        ...completed,
        status: 'pending',
        automaticRetryEligible: true,
        notBefore: t2,
        updatedAt: t1,
      });
    });

    const claimed = await unitOfWork.transaction((transaction) =>
      transaction.integrationJobs.claimNext({
        channel: 'notification',
        claimToken: 'projection-claim',
        claimedAt: t2,
        leaseExpiresAt: t3,
      }),
    );
    expect(claimed?.job.id).toBe(completed.id);
    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.integrationJobs.requeueLatestProjection({
          channel: 'notification',
          desiredRevision: 3,
          requeuedAt: t2,
          notBefore: t2,
        }),
      ).resolves.toBe(false);
      await expect(
        transaction.integrationJobs.findById(completed.id),
      ).resolves.toMatchObject({
        status: 'processing',
        claimToken: 'projection-claim',
      });
    });
  });

  it('sanitizes corrupted Phase 3 rows as adapter integrity errors', async () => {
    const snapshot = makeSnapshot('snapshot-corrupt');
    await unitOfWork.transaction((transaction) =>
      transaction.externalCalendarEventSnapshots.upsert(snapshot),
    );
    await database.run('PRAGMA ignore_check_constraints = ON');
    await database.run(
      'UPDATE external_calendar_event_snapshots SET busy = 7 WHERE id = ?',
      [snapshot.id],
    );
    await database.run('PRAGMA ignore_check_constraints = OFF');

    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.externalCalendarEventSnapshots.listOverlapping({
          provider: snapshot.provider,
          calendarId: snapshot.calendarId,
          rangeStart: t0,
          rangeEnd: t4,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      retryable: false,
      causeCategory: 'data_integrity',
    });
  });
});
