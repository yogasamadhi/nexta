import {
  appEventReconciliationSchema,
  busySnapshotResultSchema,
  calendarMutationResultSchema,
  calendarPermissionStateSchema,
  externalDeletionResultSchema,
  externalEventMutationResultSchema,
  ownedCalendarEventInventorySchema,
  type AppCalendarEventInput,
  type AppEventIdentity,
  type OwnedAppEventRef,
} from '@workspace/application';
import { describe, expect, it } from 'vitest';

import { ExpoCalendarAdapter } from './calendar-adapter';
import { nativeEventFingerprint } from './calendar-mapping';
import type {
  NativeCalendarEvent,
  NativeCalendarFacade,
} from './native-calendar';
import { createOwnedEventMarker } from './ownership-marker';

function instant(value: string): AppCalendarEventInput['startAt'] {
  return value as AppCalendarEventInput['startAt'];
}

function timeBlockId(value: string): AppEventIdentity['timeBlockId'] {
  return value as AppEventIdentity['timeBlockId'];
}

const START = instant('2026-09-12T10:00:00.000Z');
const END = instant('2026-09-12T11:00:00.000Z');
const RANGE = {
  start: instant('2026-09-12T00:00:00.000Z'),
  end: instant('2026-09-13T00:00:00.000Z'),
};

function nativeFacade(
  overrides: Partial<NativeCalendarFacade> = {},
): NativeCalendarFacade {
  return {
    async getPermissionState() {
      return { status: 'granted', granted: true, canAskAgain: true };
    },
    async requestPermission() {
      return { status: 'granted', granted: true, canAskAgain: true };
    },
    async listCalendars() {
      return [];
    },
    async createCalendar(input) {
      return {
        id: 'created-calendar',
        title: input.title,
        allowsModifications: true,
      };
    },
    async listEvents() {
      return { completeness: 'complete', events: [] };
    },
    async createEvent(calendarId, input) {
      return {
        id: 'created-event',
        calendarId,
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        notes: input.notes,
      };
    },
    async updateEvent() {},
    async deleteEvent() {},
    ...overrides,
  };
}

function adapter(
  native: NativeCalendarFacade,
  requiresExplicitAndroidSource = false,
): ExpoCalendarAdapter {
  return new ExpoCalendarAdapter({
    provider: 'device',
    ownershipMarkerNamespace: 'test.namespace',
    maximumQuerySpanMs: 2 * 24 * 60 * 60 * 1_000,
    requiresExplicitAndroidSource,
    clock: { now: () => '2026-09-12T09:00:00.000Z' },
    native,
  });
}

function identity(overrides: Partial<AppEventIdentity> = {}): AppEventIdentity {
  return {
    provider: 'device',
    calendarId: 'owned-calendar',
    ownershipKey: 'calendar-owner-1',
    timeBlockId: timeBlockId('block-1'),
    searchRange: RANGE,
    expectedExternalEventId: null,
    expectedOccurrenceKey: null,
    expectedContentHash: null,
    ...overrides,
  };
}

function eventInput(
  overrides: Partial<AppCalendarEventInput> = {},
): AppCalendarEventInput {
  return {
    calendar: {
      provider: 'device',
      calendarId: 'owned-calendar',
      ownershipKey: 'calendar-owner-1',
      ownershipVerified: true,
    },
    identity: identity(),
    title: 'Focus block',
    startAt: START,
    endAt: END,
    contentHash: 'sha256:desired',
    planRevision: 4,
    ...overrides,
  };
}

function ownedRef(overrides: Partial<OwnedAppEventRef> = {}): OwnedAppEventRef {
  return {
    provider: 'device',
    calendarId: 'owned-calendar',
    externalEventId: 'event-1',
    occurrenceKey: null,
    timeBlockId: timeBlockId('block-1'),
    ownershipKey: 'calendar-owner-1',
    ownershipVerified: true,
    verifiedAt: instant('2026-09-12T09:00:00.000Z'),
    ...overrides,
  };
}

describe('ExpoCalendarAdapter', () => {
  it('maps full-access permission without prompting during a state read', async () => {
    let reads = 0;
    let requests = 0;
    const provider = adapter(
      nativeFacade({
        async getPermissionState() {
          reads += 1;
          return { status: 'denied', granted: false, canAskAgain: false };
        },
        async requestPermission() {
          requests += 1;
          return { status: 'granted', granted: true, canAskAgain: false };
        },
      }),
    );

    expect(
      calendarPermissionStateSchema.parse(await provider.getPermissionState()),
    ).toEqual({
      read: {
        status: 'denied',
        canAskAgain: false,
        settingsRequired: true,
      },
      write: {
        status: 'denied',
        canAskAgain: false,
        settingsRequired: true,
      },
    });
    expect(reads).toBe(1);
    expect(requests).toBe(0);

    expect(
      calendarPermissionStateSchema.parse(
        await provider.requestPermission('write'),
      ),
    ).toEqual({
      read: {
        status: 'granted',
        canAskAgain: false,
        settingsRequired: false,
      },
      write: {
        status: 'granted',
        canAskAgain: false,
        settingsRequired: false,
      },
    });
    expect(requests).toBe(1);
  });

  it('returns unavailable capabilities when the native permission API fails', async () => {
    const provider = adapter(
      nativeFacade({
        async getPermissionState() {
          throw new Error('native unavailable');
        },
      }),
    );
    expect(
      calendarPermissionStateSchema.parse(await provider.getPermissionState()),
    ).toEqual({
      read: {
        status: 'unavailable',
        canAskAgain: false,
        settingsRequired: false,
      },
      write: {
        status: 'unavailable',
        canAskAgain: false,
        settingsRequired: false,
      },
    });
  });

  it('maps an exact bounded busy snapshot and rejects excessive ranges pre-I/O', async () => {
    let calls = 0;
    const provider = adapter(
      nativeFacade({
        async listEvents(calendarIds, start, end) {
          calls += 1;
          expect(calendarIds).toEqual(['external-calendar']);
          expect(start.toISOString()).toBe(RANGE.start);
          expect(end.toISOString()).toBe(RANGE.end);
          return {
            completeness: 'complete',
            events: [
              {
                id: 'external-1',
                calendarId: 'external-calendar',
                title: 'External meeting',
                startDate: START,
                endDate: END,
              },
            ],
          };
        },
      }),
    );

    const result = busySnapshotResultSchema.parse(
      await provider.listBusyEvents({
        provider: 'device',
        calendarId: 'external-calendar',
        range: RANGE,
      }),
    );
    expect(result).toMatchObject({
      provider: 'device',
      calendarId: 'external-calendar',
      range: RANGE,
      fetchedAt: '2026-09-12T09:00:00.000Z',
      completeness: 'complete',
      events: [{ externalEventId: 'external-1', busy: true }],
    });

    await expect(
      provider.listBusyEvents({
        provider: 'device',
        calendarId: 'external-calendar',
        range: {
          start: RANGE.start,
          end: instant('2026-09-15T00:00:00.000Z'),
        },
      }),
    ).rejects.toThrow(/bounded scope/);
    expect(calls).toBe(1);
  });

  it('reuses only an existing verified calendar id, never a matching title', async () => {
    let creates = 0;
    const provider = adapter(
      nativeFacade({
        async listCalendars() {
          return [
            {
              id: 'same-title-but-not-owned',
              title: 'My plan',
              allowsModifications: true,
            },
            {
              id: 'verified-calendar',
              title: 'OS-renamed title',
              allowsModifications: true,
            },
          ];
        },
        async createCalendar(input) {
          creates += 1;
          return {
            id: 'unexpected-calendar',
            title: input.title,
            allowsModifications: true,
          };
        },
      }),
    );
    expect(
      calendarMutationResultSchema.parse(
        await provider.ensureAppCalendar({
          provider: 'device',
          ownershipKey: 'stable-owner',
          title: 'My plan',
          color: null,
          androidSource: null,
          existingRef: {
            provider: 'device',
            calendarId: 'verified-calendar',
            ownershipKey: 'stable-owner',
            ownershipVerified: true,
          },
        }),
      ),
    ).toEqual({
      outcome: 'succeeded',
      ref: {
        provider: 'device',
        calendarId: 'verified-calendar',
        ownershipKey: 'stable-owner',
        ownershipVerified: true,
      },
    });
    expect(creates).toBe(0);
  });

  it('does not recreate an authoritative calendar binding that disappeared', async () => {
    let creates = 0;
    const provider = adapter(
      nativeFacade({
        async listCalendars() {
          return [
            {
              id: 'same-title-but-not-owned',
              title: 'My plan',
              allowsModifications: true,
            },
          ];
        },
        async createCalendar(input) {
          creates += 1;
          return {
            id: 'duplicate-calendar',
            title: input.title,
            allowsModifications: true,
          };
        },
      }),
    );
    expect(
      calendarMutationResultSchema.parse(
        await provider.ensureAppCalendar({
          provider: 'device',
          ownershipKey: 'stable-owner',
          title: 'My plan',
          color: null,
          androidSource: null,
          existingRef: {
            provider: 'device',
            calendarId: 'deleted-calendar',
            ownershipKey: 'stable-owner',
            ownershipVerified: true,
          },
        }),
      ),
    ).toEqual({ outcome: 'unknown' });
    expect(creates).toBe(0);
  });

  it('maps an explicit Android LOCAL source only for first provisioning', async () => {
    const creates: unknown[] = [];
    const provider = adapter(
      nativeFacade({
        async createCalendar(input) {
          creates.push(input);
          return {
            id: 'new-owned-calendar',
            title: input.title,
            allowsModifications: true,
          };
        },
      }),
      true,
    );

    const result = calendarMutationResultSchema.parse(
      await provider.ensureAppCalendar({
        provider: 'device',
        ownershipKey: 'stable-owner',
        title: 'My plan',
        color: '#123456',
        androidSource: 'local-account',
        existingRef: null,
      }),
    );
    expect(result).toEqual({
      outcome: 'succeeded',
      ref: {
        provider: 'device',
        calendarId: 'new-owned-calendar',
        ownershipKey: 'stable-owner',
        ownershipVerified: true,
      },
    });
    expect(creates).toEqual([
      {
        title: 'My plan',
        color: '#123456',
        name: 'stable-owner',
        ownerAccount: 'local-account',
        source: {
          name: 'local-account',
          type: 'LOCAL',
          isLocalAccount: true,
        },
        isVisible: true,
        isSynced: true,
      },
    ]);
  });

  it('does not create on Android without an explicitly selected source', async () => {
    let creates = 0;
    const provider = new ExpoCalendarAdapter({
      provider: 'device',
      ownershipMarkerNamespace: 'test.namespace',
      maximumQuerySpanMs: 2 * 24 * 60 * 60 * 1_000,
      requiresExplicitAndroidSource: true,
      clock: { now: () => '2026-09-12T09:00:00.000Z' },
      native: nativeFacade({
        async createCalendar(input) {
          creates += 1;
          return {
            id: 'must-not-be-created',
            title: input.title,
            allowsModifications: true,
          };
        },
      }),
    });

    expect(
      calendarMutationResultSchema.parse(
        await provider.ensureAppCalendar({
          provider: 'device',
          ownershipKey: 'stable-owner',
          title: 'My plan',
          color: null,
          androidSource: null,
          existingRef: null,
        }),
      ),
    ).toEqual({ outcome: 'unknown' });
    expect(creates).toBe(0);
  });

  it('allows iOS provisioning without an Android source', async () => {
    let creates = 0;
    const provider = adapter(
      nativeFacade({
        async createCalendar(input) {
          creates += 1;
          expect(input.source).toBeUndefined();
          expect(input.ownerAccount).toBeUndefined();
          return {
            id: 'ios-owned-calendar',
            title: input.title,
            allowsModifications: true,
          };
        },
      }),
    );

    expect(
      calendarMutationResultSchema.parse(
        await provider.ensureAppCalendar({
          provider: 'device',
          ownershipKey: 'stable-owner',
          title: 'My plan',
          color: null,
          androidSource: null,
          existingRef: null,
        }),
      ),
    ).toEqual({
      outcome: 'succeeded',
      ref: {
        provider: 'device',
        calendarId: 'ios-owned-calendar',
        ownershipKey: 'stable-owner',
        ownershipVerified: true,
      },
    });
    expect(creates).toBe(1);
  });

  it('does not guess calendar ownership by title after an unknown create', async () => {
    const provider = adapter(
      nativeFacade({
        async createCalendar() {
          throw new Error('response lost');
        },
        async listCalendars() {
          return [
            {
              id: 'unverified-same-title',
              title: 'My plan',
              allowsModifications: true,
            },
          ];
        },
      }),
    );
    expect(
      calendarMutationResultSchema.parse(
        await provider.ensureAppCalendar({
          provider: 'device',
          ownershipKey: 'stable-owner',
          title: 'My plan',
          color: null,
          androidSource: null,
          existingRef: null,
        }),
      ),
    ).toEqual({ outcome: 'unknown' });
  });

  it('recovers a lost event-create response by bounded marker readback', async () => {
    const created: NativeCalendarEvent[] = [];
    const provider = adapter(
      nativeFacade({
        async createEvent(calendarId, input) {
          created.push({
            id: 'event-after-lost-response',
            calendarId,
            title: input.title,
            startDate: input.startDate,
            endDate: input.endDate,
            notes: input.notes,
          });
          throw new Error('response lost after native commit');
        },
        async listEvents() {
          return { completeness: 'complete', events: created };
        },
      }),
    );

    expect(
      externalEventMutationResultSchema.parse(
        await provider.createAppEvent(eventInput()),
      ),
    ).toEqual({
      outcome: 'succeeded',
      ref: {
        provider: 'device',
        calendarId: 'owned-calendar',
        externalEventId: 'event-after-lost-response',
        occurrenceKey: null,
      },
    });
  });

  it('keeps partial and malformed ownership readback unknown, never missing', async () => {
    const marker = createOwnedEventMarker('test.namespace', {
      calendarOwnershipKey: 'calendar-owner-1',
      timeBlockId: 'block-1',
      contentHash: 'sha256:desired',
      nativeFingerprint: 'sha256:original-native',
      planRevision: 4,
    });
    const partial = adapter(
      nativeFacade({
        async listEvents() {
          return { completeness: 'partial', events: [] };
        },
      }),
    );
    expect(
      appEventReconciliationSchema.parse(
        await partial.reconcileAppEvent(identity()),
      ),
    ).toEqual({ status: 'unknown' });

    const malformed = adapter(
      nativeFacade({
        async listEvents() {
          return {
            completeness: 'complete',
            events: [
              {
                id: 'maybe-ours',
                calendarId: 'owned-calendar',
                title: 'Maybe ours',
                startDate: START,
                endDate: END,
                notes: marker.slice(0, -2),
              },
            ],
          };
        },
      }),
    );
    expect(
      appEventReconciliationSchema.parse(
        await malformed.reconcileAppEvent(identity()),
      ),
    ).toEqual({ status: 'unknown' });
  });

  it('reports a user-edited owned event and duplicate identity as conflict', async () => {
    const original = eventInput();
    let notes = '';
    const setup = adapter(
      nativeFacade({
        async createEvent(calendarId, input) {
          notes = input.notes;
          return {
            id: 'event-1',
            calendarId,
            title: input.title,
            startDate: input.startDate,
            endDate: input.endDate,
            notes,
          };
        },
      }),
    );
    await setup.createAppEvent(original);

    const provider = adapter(
      nativeFacade({
        async listEvents() {
          return {
            completeness: 'complete',
            events: ['a', 'b'].map((id) => ({
              id,
              calendarId: 'owned-calendar',
              title: 'User-edited title',
              startDate: START,
              endDate: END,
              notes,
            })),
          };
        },
      }),
    );
    const result = appEventReconciliationSchema.parse(
      await provider.reconcileAppEvent(
        identity({ expectedContentHash: 'sha256:desired' }),
      ),
    );
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.ref.externalEventId).toBe('a');
      expect(result.contentHash).not.toBe('sha256:desired');
      expect(result.ownershipVerified).toBe(true);
    }
  });

  it('allows a sole stale expected hash to converge but never hides duplicates', async () => {
    const notes = createOwnedEventMarker('test.namespace', {
      calendarOwnershipKey: 'calendar-owner-1',
      timeBlockId: 'block-1',
      contentHash: 'sha256:desired',
      nativeFingerprint: nativeEventFingerprint({
        title: 'Focus block',
        startAt: START,
        endAt: END,
      }),
      planRevision: 4,
    });
    const event = (id: string): NativeCalendarEvent => ({
      id,
      calendarId: 'owned-calendar',
      title: 'Focus block',
      startDate: START,
      endDate: END,
      notes,
    });
    let events: readonly NativeCalendarEvent[] = [event('event-1')];
    const provider = adapter(
      nativeFacade({
        async listEvents() {
          return { completeness: 'complete', events };
        },
      }),
    );

    const stale = appEventReconciliationSchema.parse(
      await provider.reconcileAppEvent(
        identity({
          expectedExternalEventId: 'event-1',
          expectedOccurrenceKey: null,
          expectedContentHash: 'sha256:old',
        }),
      ),
    );
    expect(stale).toMatchObject({
      status: 'conflict',
      contentHash: 'sha256:desired',
    });
    expect(
      appEventReconciliationSchema.parse(
        await provider.reconcileAppEvent(
          identity({
            expectedExternalEventId: 'event-1',
            expectedOccurrenceKey: null,
            expectedContentHash: 'sha256:desired',
          }),
        ),
      ),
    ).toMatchObject({ status: 'found', contentHash: 'sha256:desired' });

    events = [event('event-1'), event('event-2')];
    const duplicate = appEventReconciliationSchema.parse(
      await provider.reconcileAppEvent(
        identity({
          expectedExternalEventId: 'event-1',
          expectedOccurrenceKey: null,
          expectedContentHash: 'sha256:desired',
        }),
      ),
    );
    expect(duplicate.status).toBe('conflict');
    if (duplicate.status === 'conflict') {
      expect(duplicate.contentHash).not.toBe('sha256:desired');
    }
  });

  it('treats a bound non-recurring event becoming recurring as conflict', async () => {
    const original = eventInput();
    let notes = '';
    const setup = adapter(
      nativeFacade({
        async createEvent(calendarId, input) {
          notes = input.notes;
          return {
            id: 'event-1',
            calendarId,
            title: input.title,
            startDate: input.startDate,
            endDate: input.endDate,
            notes,
          };
        },
      }),
    );
    await setup.createAppEvent(original);
    const provider = adapter(
      nativeFacade({
        async listEvents() {
          return {
            completeness: 'complete',
            events: [
              {
                id: 'event-1',
                originalId: 'event-1',
                instanceId: 'volatile-instance',
                calendarId: 'owned-calendar',
                title: original.title,
                startDate: START,
                endDate: END,
                notes,
              },
            ],
          };
        },
      }),
    );

    const result = appEventReconciliationSchema.parse(
      await provider.reconcileAppEvent(
        identity({
          expectedExternalEventId: 'event-1',
          expectedOccurrenceKey: null,
          expectedContentHash: 'sha256:desired',
        }),
      ),
    );
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.ref.occurrenceKey).toBe(START);
    }
  });

  it('treats user text around the ownership marker as a visible conflict', async () => {
    const original = eventInput();
    let notes = '';
    const setup = adapter(
      nativeFacade({
        async createEvent(calendarId, value) {
          notes = value.notes;
          return {
            id: 'event-1',
            calendarId,
            title: value.title,
            startDate: value.startDate,
            endDate: value.endDate,
            notes,
          };
        },
      }),
    );
    await setup.createAppEvent(original);
    const provider = adapter(
      nativeFacade({
        async listEvents() {
          return {
            completeness: 'complete',
            events: [
              {
                id: 'event-1',
                calendarId: 'owned-calendar',
                title: original.title,
                startDate: START,
                endDate: END,
                notes: `${notes}\nUser-added note`,
              },
            ],
          };
        },
      }),
    );
    const result = appEventReconciliationSchema.parse(
      await provider.reconcileAppEvent(
        identity({
          expectedExternalEventId: 'event-1',
          expectedOccurrenceKey: null,
          expectedContentHash: 'sha256:desired',
        }),
      ),
    );
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.contentHash).not.toBe('sha256:desired');
      expect(result.ref.externalEventId).toBe('event-1');
    }
  });

  it('inventories every matching marker in a verified bounded container', async () => {
    const ownedNotes = createOwnedEventMarker('test.namespace', {
      calendarOwnershipKey: 'calendar-owner-1',
      timeBlockId: 'block-1',
      contentHash: 'sha256:desired',
      nativeFingerprint: nativeEventFingerprint({
        title: 'Focus block',
        startAt: START,
        endAt: END,
      }),
      planRevision: 3,
    });
    const otherContainerNotes = createOwnedEventMarker('test.namespace', {
      calendarOwnershipKey: 'another-calendar-owner',
      timeBlockId: 'block-foreign',
      contentHash: 'sha256:foreign',
      nativeFingerprint: 'sha256:foreign-native',
      planRevision: 2,
    });
    const provider = adapter(
      nativeFacade({
        async listEvents(calendarIds, start, end) {
          expect(calendarIds).toEqual(['owned-calendar']);
          expect(start.toISOString()).toBe(RANGE.start);
          expect(end.toISOString()).toBe(RANGE.end);
          return {
            completeness: 'complete',
            events: [
              {
                id: 'event-b',
                calendarId: 'owned-calendar',
                title: 'Focus block',
                startDate: START,
                endDate: END,
                notes: ownedNotes,
              },
              {
                id: 'event-a',
                calendarId: 'owned-calendar',
                title: 'Focus block',
                startDate: START,
                endDate: END,
                notes: ownedNotes,
              },
              {
                id: 'foreign-owner',
                calendarId: 'owned-calendar',
                title: 'Not this container',
                startDate: START,
                endDate: END,
                notes: otherContainerNotes,
              },
              {
                id: 'ordinary-event',
                calendarId: 'owned-calendar',
                title: 'Ordinary calendar item',
                startDate: START,
                endDate: END,
              },
            ],
          };
        },
      }),
    );

    const result = ownedCalendarEventInventorySchema.parse(
      await provider.listOwnedAppEvents({
        calendar: {
          provider: 'device',
          calendarId: 'owned-calendar',
          ownershipKey: 'calendar-owner-1',
          ownershipVerified: true,
        },
        range: RANGE,
      }),
    );
    expect(result).toEqual({
      status: 'complete',
      provider: 'device',
      calendarId: 'owned-calendar',
      range: RANGE,
      events: [
        {
          timeBlockId: 'block-1',
          planRevision: 3,
          ref: {
            provider: 'device',
            calendarId: 'owned-calendar',
            externalEventId: 'event-a',
            occurrenceKey: null,
          },
          contentHash: 'sha256:desired',
          startAt: START,
          endAt: END,
          ownershipVerified: true,
        },
        {
          timeBlockId: 'block-1',
          planRevision: 3,
          ref: {
            provider: 'device',
            calendarId: 'owned-calendar',
            externalEventId: 'event-b',
            occurrenceKey: null,
          },
          contentHash: 'sha256:desired',
          startAt: START,
          endAt: END,
          ownershipVerified: true,
        },
      ],
    });
  });

  it('keeps discovered inventory candidates on partial reads and rejects unverified scope', async () => {
    let calls = 0;
    const notes = createOwnedEventMarker('test.namespace', {
      calendarOwnershipKey: 'calendar-owner-1',
      timeBlockId: 'block-1',
      contentHash: 'sha256:desired',
      nativeFingerprint: nativeEventFingerprint({
        title: 'Focus block',
        startAt: START,
        endAt: END,
      }),
      planRevision: 3,
    });
    const provider = adapter(
      nativeFacade({
        async listEvents() {
          calls += 1;
          return {
            completeness: 'partial',
            events: [
              {
                id: 'discovered',
                calendarId: 'owned-calendar',
                title: 'Focus block',
                startDate: START,
                endDate: END,
                notes,
              },
              {
                id: 'corrupted-marker',
                calendarId: 'owned-calendar',
                title: 'Unknown',
                startDate: START,
                endDate: END,
                notes: notes.slice(0, -2),
              },
            ],
          };
        },
      }),
    );

    expect(
      ownedCalendarEventInventorySchema.parse(
        await provider.listOwnedAppEvents({
          calendar: {
            provider: 'device',
            calendarId: 'owned-calendar',
            ownershipKey: 'calendar-owner-1',
            ownershipVerified: true,
          },
          range: RANGE,
        }),
      ),
    ).toMatchObject({
      status: 'partial',
      events: [{ timeBlockId: 'block-1', ownershipVerified: true }],
    });

    await expect(
      provider.listOwnedAppEvents({
        calendar: {
          provider: 'device',
          calendarId: 'owned-calendar',
          ownershipKey: 'calendar-owner-1',
          ownershipVerified: false,
        },
        range: RANGE,
      } as never),
    ).rejects.toThrow(/not ownership verified/);
    expect(calls).toBe(1);
  });

  it('keeps an inventory I/O failure explicitly unknown', async () => {
    const provider = adapter(
      nativeFacade({
        async listEvents() {
          throw new Error('native inventory unavailable');
        },
      }),
    );
    expect(
      ownedCalendarEventInventorySchema.parse(
        await provider.listOwnedAppEvents({
          calendar: {
            provider: 'device',
            calendarId: 'owned-calendar',
            ownershipKey: 'calendar-owner-1',
            ownershipVerified: true,
          },
          range: RANGE,
        }),
      ),
    ).toEqual({ status: 'unknown' });
  });

  it('requires a verified binding before update/delete and preserves unknown', async () => {
    let updates = 0;
    const provider = adapter(
      nativeFacade({
        async updateEvent() {
          updates += 1;
          throw new Error('unknown update outcome');
        },
        async deleteEvent() {
          throw new Error('unknown delete outcome');
        },
      }),
    );
    const unverified = {
      ...ownedRef(),
      ownershipVerified: false,
    } as unknown as OwnedAppEventRef;
    await expect(
      provider.updateAppEvent(unverified, {
        title: 'Moved',
        startAt: START,
        endAt: END,
        contentHash: 'sha256:moved',
        planRevision: 5,
      }),
    ).rejects.toThrow(/not ownership verified/);
    expect(updates).toBe(0);

    expect(
      externalEventMutationResultSchema.parse(
        await provider.updateAppEvent(ownedRef(), {
          title: 'Moved',
          startAt: START,
          endAt: END,
          contentHash: 'sha256:moved',
          planRevision: 5,
        }),
      ),
    ).toEqual({ outcome: 'unknown' });
    expect(
      externalDeletionResultSchema.parse(
        await provider.deleteAppEvent(ownedRef()),
      ),
    ).toEqual({ outcome: 'unknown' });
  });
});
