import { DatabaseSync } from 'node:sqlite';

import {
  CalendarService,
  type ApplicationTransaction,
  type ApplicationUnitOfWork,
  type BusySnapshotResult,
  type CalendarProvider,
  type IdGenerator,
} from '@workspace/application';
import {
  initializeSqliteApplicationUnitOfWork,
  type SqliteDatabase,
} from '@workspace/database';
import { parseInstant } from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const t0 = parseInstant('2026-09-12T08:00:00.000Z');
const t1 = parseInstant('2026-09-12T09:00:00.000Z');
const t2 = parseInstant('2026-09-12T10:00:00.000Z');
const t3 = parseInstant('2026-09-12T11:00:00.000Z');
const t4 = parseInstant('2026-09-12T12:00:00.000Z');

const grantedPermission = {
  read: { status: 'granted', canAskAgain: false, settingsRequired: false },
  write: { status: 'granted', canAskAgain: false, settingsRequired: false },
} as const;

function sequenceIds(prefix: string): IdGenerator {
  let next = 0;
  return { generate: () => `${prefix}-${++next}` };
}

function busyResult(
  completeness: 'complete' | 'partial',
  fetchedAt: typeof t0,
  eventIds: readonly string[],
): BusySnapshotResult {
  return {
    provider: 'expo-calendar',
    calendarId: 'personal',
    range: { start: t0, end: t4 },
    fetchedAt,
    completeness,
    events: eventIds.map((externalEventId, index) => ({
      externalEventId,
      occurrenceKey: null,
      startAt: index === 0 ? t1 : t2,
      endAt: index === 0 ? t2 : t3,
      busy: true,
      contentHash: `content-${externalEventId}`,
    })),
  };
}

function fakeProvider(read: () => BusySnapshotResult): CalendarProvider {
  return {
    provider: 'expo-calendar',
    getPermissionState: async () => grantedPermission,
    requestPermission: async () => grantedPermission,
    listCalendars: async () => [],
    listBusyEvents: async () => read(),
    ensureAppCalendar: async () => ({ outcome: 'unknown' }),
    createAppEvent: async () => ({ outcome: 'unknown' }),
    updateAppEvent: async () => ({ outcome: 'unknown' }),
    deleteAppEvent: async () => ({ outcome: 'unknown' }),
    reconcileAppEvent: async () => ({ status: 'unknown' }),
    listOwnedAppEvents: async () => ({ status: 'unknown' }),
  };
}

function createService(
  unitOfWork: ApplicationUnitOfWork,
  provider: CalendarProvider,
  idPrefix = 'refresh',
): CalendarService {
  return new CalendarService({
    unitOfWork,
    provider,
    clock: { now: () => t0 },
    rangePolicy: { allows: () => true },
    snapshotIds: sequenceIds(`${idPrefix}-snapshot`),
    coverageIds: sequenceIds(`${idPrefix}-coverage`),
  });
}

const refreshInput = {
  provider: 'expo-calendar',
  calendarId: 'personal',
  range: { start: t0, end: t4 },
} as const;

describe('Phase 3 calendar refresh over SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;
  let unitOfWork: ApplicationUnitOfWork;

  beforeEach(async () => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
    unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => t0,
    });
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('keeps unseen events on partial refresh and deletes them only with complete coverage', async () => {
    let providerResult = busyResult('partial', t1, ['event-a', 'event-b']);
    const service = createService(
      unitOfWork,
      fakeProvider(() => providerResult),
    );

    await expect(service.refreshBusy(refreshInput)).resolves.toMatchObject({
      status: 'partial',
      upsertedCount: 2,
      deletedCount: 0,
      busyChanged: true,
      stateVersion: 1,
    });
    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.calendarRefreshCoverages.findLatestCovering({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t0,
          rangeEnd: t4,
        }),
      ).resolves.toBeNull();
    });

    providerResult = busyResult('partial', t2, ['event-a']);
    await expect(service.refreshBusy(refreshInput)).resolves.toMatchObject({
      status: 'partial',
      upsertedCount: 1,
      deletedCount: 0,
      busyChanged: false,
      stateVersion: 1,
    });
    await unitOfWork.transaction(async (transaction) => {
      const snapshots =
        await transaction.externalCalendarEventSnapshots.listOverlapping({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t0,
          rangeEnd: t4,
        });
      expect(snapshots.map((snapshot) => snapshot.externalEventId)).toEqual([
        'event-a',
        'event-b',
      ]);
      await expect(
        transaction.calendarRefreshCoverages.findLatestCovering({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t0,
          rangeEnd: t4,
        }),
      ).resolves.toBeNull();
    });

    providerResult = busyResult('complete', t3, ['event-a']);
    await expect(service.refreshBusy(refreshInput)).resolves.toMatchObject({
      status: 'complete',
      upsertedCount: 1,
      deletedCount: 1,
      busyChanged: true,
      stateVersion: 2,
    });
    await unitOfWork.transaction(async (transaction) => {
      const snapshots =
        await transaction.externalCalendarEventSnapshots.listOverlapping({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t0,
          rangeEnd: t4,
        });
      expect(snapshots.map((snapshot) => snapshot.externalEventId)).toEqual([
        'event-a',
      ]);
      await expect(
        transaction.calendarRefreshCoverages.findLatestCovering({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t0,
          rangeEnd: t4,
        }),
      ).resolves.toMatchObject({
        completeness: 'complete',
        fetchedAt: t3,
        observedEventCount: 1,
      });
    });
  });

  it('rolls snapshots, deletion, coverage, and state back after a late refresh failure', async () => {
    let providerResult = busyResult('partial', t1, ['event-a', 'event-b']);
    const provider = fakeProvider(() => providerResult);
    await createService(unitOfWork, provider).refreshBusy(refreshInput);

    let coverageWriteReached = false;
    const failingUnitOfWork: ApplicationUnitOfWork = {
      transaction: <TResult>(
        work: (transaction: ApplicationTransaction) => Promise<TResult>,
      ): Promise<TResult> =>
        unitOfWork.transaction((transaction) =>
          work({
            ...transaction,
            calendarRefreshCoverages: {
              findLatestCovering: (scope) =>
                transaction.calendarRefreshCoverages.findLatestCovering(scope),
              insert: async (coverage) => {
                await transaction.calendarRefreshCoverages.insert(coverage);
                coverageWriteReached = true;
                throw new Error('injected failure after coverage write');
              },
            },
          }),
        ),
    };
    providerResult = busyResult('complete', t2, ['event-c']);

    await expect(
      createService(failingUnitOfWork, provider, 'failing-refresh').refreshBusy(
        refreshInput,
      ),
    ).rejects.toMatchObject({ code: 'adapter_error' });
    expect(coverageWriteReached).toBe(true);

    await unitOfWork.transaction(async (transaction) => {
      const snapshots =
        await transaction.externalCalendarEventSnapshots.listOverlapping({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t0,
          rangeEnd: t4,
        });
      expect(
        snapshots.map((snapshot) => snapshot.externalEventId).sort(),
      ).toEqual(['event-a', 'event-b']);
      expect(snapshots.every((snapshot) => snapshot.lastSeenAt === t1)).toBe(
        true,
      );
      await expect(
        transaction.calendarRefreshCoverages.findLatestCovering({
          provider: 'expo-calendar',
          calendarId: 'personal',
          rangeStart: t0,
          rangeEnd: t4,
        }),
      ).resolves.toBeNull();
      await expect(transaction.scheduleState.get()).resolves.toEqual({
        stateVersion: 1,
        planRevision: 0,
      });
    });
  });
});
