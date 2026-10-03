import {
  ApplicationError,
  CalendarService,
  type AppCalendarEventInput,
  type AppCalendarEventPatch,
  type AppEventIdentity,
  type CalendarBusyRequest,
  type CalendarPermissionState,
  type CalendarProvider,
  type EnsureAppCalendarInput,
  type OwnedAppEventRef,
} from '@workspace/application';
import {
  createCalendarBinding,
  createCalendarRefreshCoverage,
  createExternalCalendarEventSnapshot,
  createIntegrationJob,
  parseCalendarBindingId,
  parseCalendarRefreshCoverageId,
  parseExternalCalendarEventSnapshotId,
  parseInstant,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
  parseTimeBlockId,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

import {
  MemoryUnitOfWork,
  QueueIdGenerator,
  SequenceClock,
  createMemoryState,
} from './fakes';

const T0 = parseInstant('2026-09-12T08:00:00.000Z');
const T1 = parseInstant('2026-09-12T09:00:00.000Z');
const T2 = parseInstant('2026-09-12T10:00:00.000Z');
const T3 = parseInstant('2026-09-12T11:00:00.000Z');
const RANGE = { start: T0, end: T3 };

function capability(
  status: 'not_determined' | 'granted' | 'denied' | 'unavailable',
) {
  return {
    status,
    canAskAgain: status === 'not_determined',
    settingsRequired: status === 'denied',
  } as const;
}

const granted: CalendarPermissionState = {
  read: capability('granted'),
  write: capability('granted'),
};

class FakeCalendarProvider implements CalendarProvider {
  readonly provider = 'system';
  permission: CalendarPermissionState = granted;
  requestedPermission: CalendarPermissionState = granted;
  busyResult: unknown = {
    provider: this.provider,
    calendarId: 'calendar-1',
    range: RANGE,
    fetchedAt: T1,
    completeness: 'complete',
    events: [],
  };
  busyCalls: CalendarBusyRequest[] = [];
  permissionRequests: ('read' | 'write')[] = [];

  getPermissionState(): Promise<unknown> {
    return Promise.resolve(this.permission);
  }

  requestPermission(access: 'read' | 'write'): Promise<unknown> {
    this.permissionRequests.push(access);
    return Promise.resolve(this.requestedPermission);
  }

  listCalendars(): Promise<unknown> {
    return Promise.resolve([]);
  }

  listBusyEvents(input: CalendarBusyRequest): Promise<unknown> {
    this.busyCalls.push(input);
    return Promise.resolve(this.busyResult);
  }

  ensureAppCalendar(_input: EnsureAppCalendarInput): Promise<unknown> {
    throw new Error('not used');
  }

  createAppEvent(_input: AppCalendarEventInput): Promise<unknown> {
    throw new Error('not used');
  }

  updateAppEvent(
    _ref: OwnedAppEventRef,
    _patch: AppCalendarEventPatch,
  ): Promise<unknown> {
    throw new Error('not used');
  }

  deleteAppEvent(_ref: OwnedAppEventRef): Promise<unknown> {
    throw new Error('not used');
  }

  reconcileAppEvent(_identity: AppEventIdentity): Promise<unknown> {
    throw new Error('not used');
  }

  listOwnedAppEvents(): Promise<unknown> {
    throw new Error('not used');
  }
}

function cachedEvent(id: string, externalEventId: string, lastSeenAt = T1) {
  return createExternalCalendarEventSnapshot({
    id: parseExternalCalendarEventSnapshotId(id),
    provider: 'system',
    calendarId: 'calendar-1',
    externalEventId,
    occurrenceKey: null,
    startAt: T1,
    endAt: T2,
    busy: true,
    lastSeenAt,
    contentHash: `hash-${externalEventId}`,
  });
}

function fixture() {
  const state = createMemoryState();
  const unitOfWork = new MemoryUnitOfWork(state);
  const provider = new FakeCalendarProvider();
  const service = new CalendarService({
    unitOfWork,
    provider,
    rangePolicy: { allows: () => true },
    snapshotIds: new QueueIdGenerator(
      'snapshot-new-1',
      'snapshot-new-2',
      'snapshot-new-3',
    ),
    coverageIds: new QueueIdGenerator(
      'coverage-new-1',
      'coverage-new-2',
      'coverage-new-3',
    ),
    clock: new SequenceClock(T2, T3),
  });
  return { service, provider, unitOfWork };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApplicationError);
    expect((error as ApplicationError).code).toBe(code);
  }
}

function busyResult(
  fetchedAt: string,
  completeness: 'complete' | 'partial',
  externalEventIds: readonly string[],
) {
  return {
    provider: 'system',
    calendarId: 'calendar-1',
    range: RANGE,
    fetchedAt,
    completeness,
    events: externalEventIds.map((externalEventId) => ({
      externalEventId,
      occurrenceKey: null,
      startAt: T1,
      endAt: T2,
      busy: true,
      contentHash: `hash-${externalEventId}`,
    })),
  };
}

describe('CalendarService bounded busy refresh', () => {
  it('reads only bounded cached busy intervals and excludes verified App-owned events', async () => {
    const test = fixture();
    const owned = cachedEvent('snapshot-owned', 'event-owned');
    const external = cachedEvent('snapshot-external', 'event-external');
    test.unitOfWork.state.externalCalendarEventSnapshots.set(owned.id, owned);
    test.unitOfWork.state.externalCalendarEventSnapshots.set(
      external.id,
      external,
    );
    const coverage = createCalendarRefreshCoverage({
      id: parseCalendarRefreshCoverageId('coverage-1'),
      provider: 'system',
      calendarId: 'calendar-1',
      rangeStart: T0,
      rangeEnd: T3,
      fetchedAt: T2,
      completeness: 'complete',
      observedEventCount: 2,
    });
    test.unitOfWork.state.calendarRefreshCoverages.set(coverage.id, coverage);
    const binding = createCalendarBinding({
      id: parseCalendarBindingId('calendar-binding-1'),
      timeBlockId: parseTimeBlockId('block-1'),
      provider: 'system',
      calendarId: 'calendar-1',
      externalEventId: 'event-owned',
      occurrenceKey: null,
      ownershipKey: 'app-calendar',
      ownershipVerified: true,
      appliedContentHash: 'app-hash',
      appliedStartAt: T1,
      appliedEndAt: T2,
      lastAppliedRevision: 1,
      status: 'synced',
      verifiedAt: T1,
      createdAt: T0,
    });
    test.unitOfWork.state.calendarBindings.set(binding.id, binding);

    const result = await test.service.listBusy({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
      limit: 1,
    });

    expect(result).toEqual({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
      capturedAt: T2,
      completeness: 'complete',
      events: [{ startAt: T1, endAt: T2, busy: true }],
      truncated: false,
    });
    expect(test.provider.busyCalls).toEqual([]);
  });

  it('returns actionable denied permission without fetching or changing local facts', async () => {
    const test = fixture();
    test.provider.permission = {
      read: capability('denied'),
      write: capability('denied'),
    };

    const result = await test.service.refreshBusy({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
    });

    expect(result).toMatchObject({
      status: 'permission_required',
      permission: {
        read: { settingsRequired: true, canAskAgain: false },
      },
      fetchedAt: null,
      stateVersion: 0,
    });
    expect(test.provider.busyCalls).toEqual([]);
    expect(test.unitOfWork.state.externalCalendarEventSnapshots).toHaveLength(
      0,
    );
  });

  it('rejects an excessive range before asking the provider for any data', async () => {
    const test = fixture();
    const service = new CalendarService({
      unitOfWork: test.unitOfWork,
      provider: test.provider,
      rangePolicy: { allows: () => false },
      snapshotIds: new QueueIdGenerator('unused-snapshot'),
      coverageIds: new QueueIdGenerator('unused-coverage'),
      clock: new SequenceClock(T1),
    });

    await expectCode(
      service.refreshBusy({
        provider: 'system',
        calendarId: 'calendar-1',
        range: RANGE,
      }),
      'validation_error',
    );
    expect(test.provider.busyCalls).toEqual([]);
  });

  it('upserts partial observations without deleting unseen events or marking coverage', async () => {
    const test = fixture();
    const old = cachedEvent('snapshot-old', 'event-old');
    test.unitOfWork.state.externalCalendarEventSnapshots.set(old.id, old);
    test.provider.busyResult = busyResult(T2, 'partial', ['event-new']);

    const result = await test.service.refreshBusy({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
    });

    expect(result).toMatchObject({
      status: 'partial',
      upsertedCount: 1,
      deletedCount: 0,
      busyChanged: true,
      stateVersion: 1,
    });
    expect(
      [...test.unitOfWork.state.externalCalendarEventSnapshots.values()].map(
        (event) => event.externalEventId,
      ),
    ).toEqual(expect.arrayContaining(['event-old', 'event-new']));
    expect(test.unitOfWork.state.calendarRefreshCoverages).toHaveLength(0);
  });

  it('deletes unseen only after a complete refresh and does not version fetchedAt alone', async () => {
    const test = fixture();
    const old = cachedEvent('snapshot-old', 'event-old');
    test.unitOfWork.state.externalCalendarEventSnapshots.set(old.id, old);
    test.provider.busyResult = busyResult(T2, 'complete', ['event-new']);

    const first = await test.service.refreshBusy({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
    });
    expect(first).toMatchObject({
      deletedCount: 1,
      busyChanged: true,
      stateVersion: 1,
    });
    test.provider.busyResult = busyResult(T3, 'complete', ['event-new']);
    const second = await test.service.refreshBusy({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
    });

    expect(second).toMatchObject({
      deletedCount: 0,
      busyChanged: false,
      stateVersion: 1,
    });
    expect(test.unitOfWork.state.calendarRefreshCoverages).toHaveLength(2);
    expect([
      ...test.unitOfWork.state.externalCalendarEventSnapshots.values(),
    ]).toEqual([
      expect.objectContaining({
        externalEventId: 'event-new',
        lastSeenAt: T3,
      }),
    ]);
  });

  it('ignores an out-of-order refresh behind complete coverage', async () => {
    const test = fixture();
    const newest = cachedEvent('snapshot-newest', 'event-newest', T3);
    test.unitOfWork.state.externalCalendarEventSnapshots.set(newest.id, newest);
    const coverage = createCalendarRefreshCoverage({
      id: parseCalendarRefreshCoverageId('coverage-newest'),
      provider: 'system',
      calendarId: 'calendar-1',
      rangeStart: T0,
      rangeEnd: T3,
      fetchedAt: T3,
      completeness: 'complete',
      observedEventCount: 1,
    });
    test.unitOfWork.state.calendarRefreshCoverages.set(coverage.id, coverage);
    test.provider.busyResult = busyResult(T2, 'partial', ['event-stale']);

    const result = await test.service.refreshBusy({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
    });

    expect(result).toMatchObject({
      upsertedCount: 0,
      deletedCount: 0,
      busyChanged: false,
      stateVersion: 0,
    });
    expect([
      ...test.unitOfWork.state.externalCalendarEventSnapshots.values(),
    ]).toEqual([newest]);
  });

  it('does not let an older complete result delete a newer partial observation', async () => {
    const test = fixture();
    const newerPartial = cachedEvent('snapshot-newer', 'event-newer', T3);
    test.unitOfWork.state.externalCalendarEventSnapshots.set(
      newerPartial.id,
      newerPartial,
    );
    test.provider.busyResult = busyResult(T2, 'complete', []);

    const result = await test.service.refreshBusy({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
    });

    expect(result.deletedCount).toBe(0);
    expect(
      test.unitOfWork.state.externalCalendarEventSnapshots.get(newerPartial.id),
    ).toEqual(newerPartial);
    expect(test.unitOfWork.state.calendarRefreshCoverages).toHaveLength(1);
  });

  it('excludes only verified owned bindings from the effective Busy version', async () => {
    const test = fixture();
    const owned = cachedEvent('snapshot-owned', 'event-owned');
    test.unitOfWork.state.externalCalendarEventSnapshots.set(owned.id, owned);
    const binding = createCalendarBinding({
      id: parseCalendarBindingId('calendar-binding-1'),
      timeBlockId: parseTimeBlockId('block-1'),
      provider: 'system',
      calendarId: 'calendar-1',
      externalEventId: 'event-owned',
      occurrenceKey: null,
      ownershipKey: 'app-calendar',
      ownershipVerified: true,
      appliedContentHash: 'app-hash',
      appliedStartAt: T1,
      appliedEndAt: T2,
      lastAppliedRevision: 1,
      status: 'synced',
      verifiedAt: T1,
      createdAt: T0,
    });
    test.unitOfWork.state.calendarBindings.set(binding.id, binding);
    test.provider.busyResult = {
      ...busyResult(T2, 'complete', ['event-owned']),
      events: [
        {
          externalEventId: 'event-owned',
          occurrenceKey: null,
          startAt: T2,
          endAt: T3,
          busy: true,
          contentHash: 'changed-owned-event',
        },
      ],
    };

    const result = await test.service.refreshBusy({
      provider: 'system',
      calendarId: 'calendar-1',
      range: RANGE,
    });

    expect(result.busyChanged).toBe(false);
    expect(result.stateVersion).toBe(0);
    expect(
      test.unitOfWork.state.externalCalendarEventSnapshots.get(owned.id),
    ).toMatchObject({ startAt: T2, endAt: T3 });
  });

  it('rolls back snapshot changes when complete coverage persistence fails late', async () => {
    const test = fixture();
    test.provider.busyResult = busyResult(T2, 'complete', ['event-new']);
    test.unitOfWork.failOn = 'calendarRefreshCoverages.insert';

    await expectCode(
      test.service.refreshBusy({
        provider: 'system',
        calendarId: 'calendar-1',
        range: RANGE,
      }),
      'adapter_error',
    );
    expect(test.unitOfWork.state.externalCalendarEventSnapshots).toHaveLength(
      0,
    );
    expect(test.unitOfWork.state.calendarRefreshCoverages).toHaveLength(0);
    expect(test.unitOfWork.state.scheduleState).toEqual({
      stateVersion: 0,
      planRevision: 0,
    });
  });

  it('requeues permission-blocked calendar work only after an explicit grant', async () => {
    const test = fixture();
    const blocked = createIntegrationJob({
      id: parseIntegrationJobId('job-calendar-blocked'),
      operationId: parseOperationId('operation-1'),
      targetChannel: 'calendar',
      targetEntityType: 'schedule_plan',
      targetEntityId: parseSchedulePlanId('plan-1'),
      desiredRevision: 1,
      desiredAction: 'reconcile',
      status: 'permission_required',
      createdAt: T0,
    });
    test.unitOfWork.state.integrationJobs.set(blocked.id, blocked);
    test.provider.requestedPermission = granted;

    const result = await test.service.requestPermission('write');

    expect(result.write.status).toBe('granted');
    expect(test.provider.permissionRequests).toEqual(['write']);
    expect(test.unitOfWork.state.integrationJobs.get(blocked.id)).toMatchObject(
      {
        status: 'pending',
        automaticRetryEligible: true,
        notBefore: T2,
      },
    );
  });
});
