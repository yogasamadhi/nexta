import {
  hashOperationParameters,
  type AppCalendarEventInput,
  type AppCalendarEventPatch,
  type AppEventIdentity,
  type CalendarBusyRequest,
  type CalendarProvider,
  type EnsureAppCalendarInput,
  type OwnedCalendarEventInventoryInput,
  type OwnedAppEventRef,
} from '@workspace/application';

import {
  mapBusyEvents,
  nativeEventFingerprint,
  requireCanonicalRange,
} from './calendar-mapping';
import { loadExpoCalendarNativeFacade } from './expo-calendar-native';
import type {
  NativeCalendar,
  NativeCalendarEvent,
  NativeCalendarFacade,
} from './native-calendar';
import {
  createOwnedEventMarker,
  parseOwnedEventMarker,
} from './ownership-marker';

export interface CalendarAdapterClock {
  /** Returns a canonical UTC instant. */
  now(): string;
}

export type CalendarAdapterOptions = Readonly<{
  provider: string;
  ownershipMarkerNamespace: string;
  maximumQuerySpanMs: number;
  /** True on hosts where creating a calendar requires a chosen local account. */
  requiresExplicitAndroidSource: boolean;
  clock: CalendarAdapterClock;
  native: NativeCalendarFacade;
}>;

export type ExpoCalendarAdapterOptions = Omit<CalendarAdapterOptions, 'native'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value, label);
}

function requireSafeRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('planRevision must be a non-negative safe integer.');
  }
  return value as number;
}

function canonicalInstant(value: unknown, label: string): string {
  const text = requireNonEmptyString(value, label);
  const millis = Date.parse(text);
  if (!Number.isFinite(millis)) {
    throw new Error(`${label} must be a canonical UTC instant.`);
  }
  const canonical = new Date(millis).toISOString();
  if (canonical !== text) {
    throw new Error(`${label} must be a canonical UTC instant.`);
  }
  return canonical;
}

function permissionState(response: {
  status: string;
  granted: boolean;
}): 'not_determined' | 'granted' | 'denied' | 'unavailable' {
  if (response.granted || response.status === 'granted') return 'granted';
  if (
    response.status === 'undetermined' ||
    response.status === 'not_determined'
  ) {
    return 'not_determined';
  }
  if (response.status === 'denied') return 'denied';
  return 'unavailable';
}

function requireNativeCalendar(calendar: NativeCalendar): NativeCalendar {
  requireNonEmptyString(calendar.id, 'native calendar id');
  requireNonEmptyString(calendar.title, 'native calendar title');
  if (typeof calendar.allowsModifications !== 'boolean') {
    throw new Error('Native calendar write capability is invalid.');
  }
  return calendar;
}

type ValidIdentity = Readonly<{
  provider: string;
  calendarId: string;
  ownershipKey: string;
  timeBlockId: string;
  range: Readonly<{ start: string; end: string }>;
  expectedExternalEventId: string | null;
  expectedOccurrenceKey: string | null;
  expectedContentHash: string | null;
}>;

type ValidOwnedRef = Readonly<{
  provider: string;
  calendarId: string;
  externalEventId: string;
  occurrenceKey: string | null;
  timeBlockId: string;
  ownershipKey: string;
}>;

type ReconciliationCandidate = Readonly<{
  ref: Readonly<{
    provider: string;
    calendarId: string;
    externalEventId: string;
    occurrenceKey: string | null;
  }>;
  startAt: string;
  endAt: string;
  markerContentHash: string;
  markerFingerprint: string;
  observedFingerprint: string;
  notesExact: boolean;
}>;

type ValidCalendarInventoryInput = Readonly<{
  provider: string;
  calendarId: string;
  ownershipKey: string;
  range: Readonly<{ start: string; end: string }>;
  start: Date;
  end: Date;
}>;

/**
 * Expo Calendar provider with all native behavior behind an injected façade.
 * The Application service is responsible for supplying identities derived
 * from verified CalendarContainerBinding / CalendarBinding records. A marker
 * narrows bounded recovery lookup; by itself it is never ownership authority.
 */
export class ExpoCalendarAdapter implements CalendarProvider {
  readonly provider: string;
  readonly #namespace: string;
  readonly #maximumQuerySpanMs: number;
  readonly #requiresExplicitAndroidSource: boolean;
  readonly #clock: CalendarAdapterClock;
  readonly #native: NativeCalendarFacade;

  constructor(options: CalendarAdapterOptions) {
    this.provider = requireNonEmptyString(options.provider, 'provider');
    this.#namespace = requireNonEmptyString(
      options.ownershipMarkerNamespace,
      'ownershipMarkerNamespace',
    );
    if (
      !Number.isSafeInteger(options.maximumQuerySpanMs) ||
      options.maximumQuerySpanMs <= 0
    ) {
      throw new Error('maximumQuerySpanMs must be a positive safe integer.');
    }
    this.#maximumQuerySpanMs = options.maximumQuerySpanMs;
    if (typeof options.requiresExplicitAndroidSource !== 'boolean') {
      throw new Error('requiresExplicitAndroidSource must be a boolean.');
    }
    this.#requiresExplicitAndroidSource = options.requiresExplicitAndroidSource;
    this.#clock = options.clock;
    this.#native = options.native;
  }

  async getPermissionState(): Promise<unknown> {
    try {
      return this.#permissionResult(await this.#native.getPermissionState());
    } catch {
      return this.#unavailablePermissionResult();
    }
  }

  async requestPermission(_access: 'read' | 'write'): Promise<unknown> {
    if (_access !== 'read' && _access !== 'write') {
      throw new Error('Calendar permission access is unsupported.');
    }
    try {
      // App-owned calendar creation needs full calendar access on iOS. Expo's
      // full-access permission is one system grant for both read and write.
      return this.#permissionResult(await this.#native.requestPermission());
    } catch {
      return this.#unavailablePermissionResult();
    }
  }

  async listCalendars(): Promise<unknown> {
    const calendars = await this.#native.listCalendars();
    return calendars.map((calendar) => {
      requireNativeCalendar(calendar);
      return {
        provider: this.provider,
        calendarId: calendar.id,
        title: calendar.title,
        allowsRead: true,
        allowsWrite: calendar.allowsModifications,
      };
    });
  }

  async listBusyEvents(input: CalendarBusyRequest): Promise<unknown> {
    const request = this.#busyRequest(input);
    const native = await this.#native.listEvents(
      [request.calendarId],
      request.start,
      request.end,
    );
    if (
      native.completeness !== 'complete' &&
      native.completeness !== 'partial'
    ) {
      throw new Error('Native calendar completeness is invalid.');
    }
    const mapped = mapBusyEvents({
      nativeCompleteness: native.completeness,
      nativeEvents: native.events,
      calendarId: request.calendarId,
      range: request.range,
    });
    return {
      provider: this.provider,
      calendarId: request.calendarId,
      range: request.range,
      fetchedAt: canonicalInstant(this.#clock.now(), 'clock.now()'),
      completeness: mapped.completeness,
      events: mapped.events,
    };
  }

  async ensureAppCalendar(input: EnsureAppCalendarInput): Promise<unknown> {
    const provisioning = this.#provisioningInput(input);

    if (
      provisioning.existingRef === null &&
      this.#requiresExplicitAndroidSource &&
      provisioning.androidSource === null
    ) {
      // Android has no universal default calendar/account. Composition must
      // supply an explicitly chosen local source instead of letting Expo/OS
      // guess where this app-owned calendar belongs.
      return { outcome: 'unknown' };
    }

    try {
      if (provisioning.existingRef !== null) {
        const calendars = await this.#native.listCalendars();
        for (const calendar of calendars) requireNativeCalendar(calendar);
        const existing = calendars.find(
          (calendar) => calendar.id === provisioning.existingRef?.calendarId,
        );
        if (existing !== undefined) {
          if (!existing.allowsModifications) return { outcome: 'unknown' };
          return {
            outcome: 'succeeded',
            ref: provisioning.existingRef,
          };
        }
        // A persisted binding is authoritative. Its disappearance needs a
        // visible recovery decision; silently provisioning another calendar
        // would create one duplicate on every blocked worker attempt.
        return { outcome: 'unknown' };
      }

      const created = requireNativeCalendar(
        await this.#native.createCalendar({
          title: provisioning.title,
          ...(provisioning.color === null ? {} : { color: provisioning.color }),
          // Android `name` is internal rather than visible, so it can carry
          // the stable provisioning marker without treating the title as ID.
          name: provisioning.ownershipKey,
          ...(provisioning.androidSource === null
            ? {}
            : {
                ownerAccount: provisioning.androidSource,
                source: {
                  name: provisioning.androidSource,
                  type: 'LOCAL',
                  isLocalAccount: true,
                },
              }),
          isVisible: true,
          isSynced: true,
        }),
      );
      if (!created.allowsModifications) return { outcome: 'unknown' };
      return {
        outcome: 'succeeded',
        ref: {
          provider: this.provider,
          calendarId: created.id,
          ownershipKey: provisioning.ownershipKey,
          ownershipVerified: true,
        },
      };
    } catch {
      // iOS does not expose an independent, private calendar metadata field
      // that can safely recover a lost create response. Never guess by title.
      return { outcome: 'unknown' };
    }
  }

  async createAppEvent(input: AppCalendarEventInput): Promise<unknown> {
    const value = this.#eventInput(input);
    const marker = createOwnedEventMarker(this.#namespace, {
      calendarOwnershipKey: value.identity.ownershipKey,
      timeBlockId: value.identity.timeBlockId,
      contentHash: value.contentHash,
      nativeFingerprint: nativeEventFingerprint(value),
      planRevision: value.planRevision,
    });

    try {
      const created = await this.#native.createEvent(value.calendarId, {
        title: value.title,
        startDate: new Date(value.startAt),
        endDate: new Date(value.endAt),
        notes: marker,
      });
      if (
        requireNonEmptyString(created.id, 'created event id') !== created.id ||
        created.calendarId !== value.calendarId
      ) {
        return this.#recoverCreatedEvent(value.identity, value.contentHash);
      }
      return {
        outcome: 'succeeded',
        ref: {
          provider: this.provider,
          calendarId: value.calendarId,
          externalEventId: created.id,
          occurrenceKey: null,
        },
      };
    } catch {
      return this.#recoverCreatedEvent(value.identity, value.contentHash);
    }
  }

  async updateAppEvent(
    ref: OwnedAppEventRef,
    patch: AppCalendarEventPatch,
  ): Promise<unknown> {
    const owned = this.#ownedRef(ref);
    const value = this.#eventPatch(patch);
    const marker = createOwnedEventMarker(this.#namespace, {
      calendarOwnershipKey: owned.ownershipKey,
      timeBlockId: owned.timeBlockId,
      contentHash: value.contentHash,
      nativeFingerprint: nativeEventFingerprint(value),
      planRevision: value.planRevision,
    });
    try {
      await this.#native.updateEvent(owned.externalEventId, {
        title: value.title,
        startDate: new Date(value.startAt),
        endDate: new Date(value.endAt),
        notes: marker,
      });
      return {
        outcome: 'succeeded',
        ref: {
          provider: owned.provider,
          calendarId: owned.calendarId,
          externalEventId: owned.externalEventId,
          occurrenceKey: owned.occurrenceKey,
        },
      };
    } catch {
      // A reference alone has no safe bounded readback range. The worker keeps
      // this explicit unknown and reconciles with its desired projection.
      return { outcome: 'unknown' };
    }
  }

  async deleteAppEvent(ref: OwnedAppEventRef): Promise<unknown> {
    const owned = this.#ownedRef(ref);
    try {
      await this.#native.deleteEvent(owned.externalEventId);
      return { outcome: 'succeeded' };
    } catch {
      return { outcome: 'unknown' };
    }
  }

  async reconcileAppEvent(identity: AppEventIdentity): Promise<unknown> {
    const expected = this.#identity(identity);
    return this.#reconcile(expected);
  }

  async listOwnedAppEvents(
    input: OwnedCalendarEventInventoryInput,
  ): Promise<unknown> {
    const inventory = this.#calendarInventoryInput(input);
    let listed: Awaited<ReturnType<NativeCalendarFacade['listEvents']>>;
    try {
      listed = await this.#native.listEvents(
        [inventory.calendarId],
        inventory.start,
        inventory.end,
      );
    } catch {
      return { status: 'unknown' };
    }
    if (
      !isRecord(listed) ||
      !Array.isArray(listed.events) ||
      (listed.completeness !== 'complete' && listed.completeness !== 'partial')
    ) {
      return { status: 'unknown' };
    }

    let status: 'complete' | 'partial' = listed.completeness;
    const events: {
      timeBlockId: string;
      planRevision: number;
      ref: ReconciliationCandidate['ref'];
      contentHash: string;
      startAt: string;
      endAt: string;
      ownershipVerified: true;
    }[] = [];
    for (const event of listed.events) {
      if (!isRecord(event)) {
        status = 'partial';
        continue;
      }
      const nativeEvent = event as unknown as NativeCalendarEvent;
      if (nativeEvent.calendarId !== inventory.calendarId) {
        status = 'partial';
        continue;
      }
      if (
        nativeEvent.notes !== undefined &&
        nativeEvent.notes !== null &&
        typeof nativeEvent.notes !== 'string'
      ) {
        status = 'partial';
        continue;
      }
      const parsedMarker = parseOwnedEventMarker(
        this.#namespace,
        nativeEvent.notes,
      );
      if (parsedMarker.kind === 'none') continue;
      if (parsedMarker.kind === 'invalid') {
        status = 'partial';
        continue;
      }
      if (parsedMarker.marker.calendarOwnershipKey !== inventory.ownershipKey) {
        // A namespace marker for another container is not ownership evidence
        // for this verified CalendarRef.
        continue;
      }
      const candidate = this.#reconciliationCandidate(
        nativeEvent,
        {
          provider: inventory.provider,
          calendarId: inventory.calendarId,
          ownershipKey: inventory.ownershipKey,
          timeBlockId: parsedMarker.marker.timeBlockId,
          range: inventory.range,
          expectedExternalEventId: null,
          expectedOccurrenceKey: null,
          expectedContentHash: null,
        },
        {
          ...parsedMarker.marker,
          notesExact: parsedMarker.notesExact,
        },
      );
      if (candidate === null) {
        status = 'partial';
        continue;
      }
      events.push({
        timeBlockId: parsedMarker.marker.timeBlockId,
        planRevision: parsedMarker.marker.planRevision,
        ref: candidate.ref,
        contentHash: this.#observedCalendarContentHash(candidate),
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        ownershipVerified: true,
      });
    }
    events.sort((left, right) => {
      const leftKey = `${left.timeBlockId}\u0000${left.ref.externalEventId}\u0000${left.ref.occurrenceKey ?? ''}`;
      const rightKey = `${right.timeBlockId}\u0000${right.ref.externalEventId}\u0000${right.ref.occurrenceKey ?? ''}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    return {
      status,
      provider: inventory.provider,
      calendarId: inventory.calendarId,
      range: inventory.range,
      events,
    };
  }

  #permissionResult(response: unknown): unknown {
    if (
      !isRecord(response) ||
      typeof response.status !== 'string' ||
      typeof response.granted !== 'boolean' ||
      typeof response.canAskAgain !== 'boolean'
    ) {
      throw new Error('Native calendar permission result is invalid.');
    }
    const state = permissionState({
      status: response.status,
      granted: response.granted,
    });
    const capability = {
      status: state,
      canAskAgain: response.canAskAgain,
      settingsRequired: state === 'denied' && !response.canAskAgain,
    };
    return { read: capability, write: capability };
  }

  #unavailablePermissionResult(): unknown {
    const capability = {
      status: 'unavailable',
      canAskAgain: false,
      settingsRequired: false,
    };
    return { read: capability, write: capability };
  }

  #assertProvider(value: unknown): string {
    const provider = requireNonEmptyString(value, 'provider');
    if (provider !== this.provider) {
      throw new Error('Calendar input provider does not match this adapter.');
    }
    return provider;
  }

  #range(value: unknown): {
    range: Readonly<{ start: string; end: string }>;
    start: Date;
    end: Date;
  } {
    if (!isRecord(value)) throw new Error('Calendar range is invalid.');
    const range = {
      start: canonicalInstant(value.start, 'range.start'),
      end: canonicalInstant(value.end, 'range.end'),
    };
    const parsed = requireCanonicalRange(range);
    if (
      parsed.end.getTime() - parsed.start.getTime() >
      this.#maximumQuerySpanMs
    ) {
      throw new Error('Calendar range exceeds the configured bounded scope.');
    }
    return { range, ...parsed };
  }

  #busyRequest(input: unknown) {
    if (!isRecord(input)) throw new Error('Calendar busy request is invalid.');
    this.#assertProvider(input.provider);
    const calendarId = requireNonEmptyString(input.calendarId, 'calendarId');
    return { calendarId, ...this.#range(input.range) };
  }

  #calendarInventoryInput(input: unknown): ValidCalendarInventoryInput {
    if (!isRecord(input) || !isRecord(input.calendar)) {
      throw new Error('Owned calendar event inventory input is invalid.');
    }
    const provider = this.#assertProvider(input.calendar.provider);
    const calendarId = requireNonEmptyString(
      input.calendar.calendarId,
      'calendar.calendarId',
    );
    const ownershipKey = requireNonEmptyString(
      input.calendar.ownershipKey,
      'calendar.ownershipKey',
    );
    if (input.calendar.ownershipVerified !== true) {
      throw new Error('Calendar reference is not ownership verified.');
    }
    return {
      provider,
      calendarId,
      ownershipKey,
      ...this.#range(input.range),
    };
  }

  #provisioningInput(input: unknown) {
    if (!isRecord(input)) throw new Error('Calendar provisioning is invalid.');
    this.#assertProvider(input.provider);
    const ownershipKey = requireNonEmptyString(
      input.ownershipKey,
      'ownershipKey',
    );
    const title = requireNonEmptyString(input.title, 'title');
    const color = requireNullableString(input.color, 'color');
    const androidSource = requireNullableString(
      input.androidSource,
      'androidSource',
    );
    let existingRef: {
      provider: string;
      calendarId: string;
      ownershipKey: string;
      ownershipVerified: true;
    } | null = null;
    if (input.existingRef !== null) {
      if (!isRecord(input.existingRef)) {
        throw new Error('existingRef is invalid.');
      }
      const provider = this.#assertProvider(input.existingRef.provider);
      const calendarId = requireNonEmptyString(
        input.existingRef.calendarId,
        'existingRef.calendarId',
      );
      const existingOwnershipKey = requireNonEmptyString(
        input.existingRef.ownershipKey,
        'existingRef.ownershipKey',
      );
      if (
        input.existingRef.ownershipVerified !== true ||
        existingOwnershipKey !== ownershipKey
      ) {
        throw new Error('existingRef is not verified for this ownership key.');
      }
      existingRef = {
        provider,
        calendarId,
        ownershipKey: existingOwnershipKey,
        ownershipVerified: true,
      };
    }
    return {
      ownershipKey,
      title,
      color,
      androidSource,
      existingRef,
    };
  }

  #identity(input: unknown): ValidIdentity {
    if (!isRecord(input))
      throw new Error('Calendar event identity is invalid.');
    const provider = this.#assertProvider(input.provider);
    const calendarId = requireNonEmptyString(input.calendarId, 'calendarId');
    const ownershipKey = requireNonEmptyString(
      input.ownershipKey,
      'ownershipKey',
    );
    const timeBlockId = requireNonEmptyString(input.timeBlockId, 'timeBlockId');
    const { range } = this.#range(input.searchRange);
    return {
      provider,
      calendarId,
      ownershipKey,
      timeBlockId,
      range,
      expectedExternalEventId: requireNullableString(
        input.expectedExternalEventId,
        'expectedExternalEventId',
      ),
      expectedOccurrenceKey: requireNullableString(
        input.expectedOccurrenceKey,
        'expectedOccurrenceKey',
      ),
      expectedContentHash: requireNullableString(
        input.expectedContentHash,
        'expectedContentHash',
      ),
    };
  }

  #eventInput(input: unknown) {
    if (!isRecord(input) || !isRecord(input.calendar)) {
      throw new Error('Calendar event input is invalid.');
    }
    const provider = this.#assertProvider(input.calendar.provider);
    const calendarId = requireNonEmptyString(
      input.calendar.calendarId,
      'calendar.calendarId',
    );
    const ownershipKey = requireNonEmptyString(
      input.calendar.ownershipKey,
      'calendar.ownershipKey',
    );
    if (input.calendar.ownershipVerified !== true) {
      throw new Error('Calendar reference is not ownership verified.');
    }
    const identity = this.#identity(input.identity);
    if (
      identity.provider !== provider ||
      identity.calendarId !== calendarId ||
      identity.ownershipKey !== ownershipKey
    ) {
      throw new Error('Calendar event identity does not match its calendar.');
    }
    const startAt = canonicalInstant(input.startAt, 'startAt');
    const endAt = canonicalInstant(input.endAt, 'endAt');
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      throw new Error('Calendar event end must be after start.');
    }
    if (
      Date.parse(startAt) < Date.parse(identity.range.start) ||
      Date.parse(endAt) > Date.parse(identity.range.end)
    ) {
      throw new Error(
        'Calendar event must be contained in its recovery range.',
      );
    }
    return {
      calendarId,
      identity,
      title: requireNonEmptyString(input.title, 'title'),
      startAt,
      endAt,
      contentHash: requireNonEmptyString(input.contentHash, 'contentHash'),
      planRevision: requireSafeRevision(input.planRevision),
    };
  }

  #eventPatch(input: unknown) {
    if (!isRecord(input)) throw new Error('Calendar event patch is invalid.');
    const startAt = canonicalInstant(input.startAt, 'startAt');
    const endAt = canonicalInstant(input.endAt, 'endAt');
    if (Date.parse(endAt) <= Date.parse(startAt)) {
      throw new Error('Calendar event end must be after start.');
    }
    return {
      title: requireNonEmptyString(input.title, 'title'),
      startAt,
      endAt,
      contentHash: requireNonEmptyString(input.contentHash, 'contentHash'),
      planRevision: requireSafeRevision(input.planRevision),
    };
  }

  #ownedRef(input: unknown): ValidOwnedRef {
    if (!isRecord(input)) throw new Error('Owned event reference is invalid.');
    if (input.ownershipVerified !== true) {
      throw new Error('Owned event reference is not ownership verified.');
    }
    canonicalInstant(input.verifiedAt, 'verifiedAt');
    return {
      provider: this.#assertProvider(input.provider),
      calendarId: requireNonEmptyString(input.calendarId, 'calendarId'),
      externalEventId: requireNonEmptyString(
        input.externalEventId,
        'externalEventId',
      ),
      occurrenceKey: requireNullableString(
        input.occurrenceKey,
        'occurrenceKey',
      ),
      timeBlockId: requireNonEmptyString(input.timeBlockId, 'timeBlockId'),
      ownershipKey: requireNonEmptyString(input.ownershipKey, 'ownershipKey'),
    };
  }

  async #recoverCreatedEvent(
    identity: ValidIdentity,
    expectedContentHash: string,
  ): Promise<unknown> {
    const result = await this.#reconcile({
      ...identity,
      expectedExternalEventId: null,
      expectedOccurrenceKey: null,
      expectedContentHash,
    });
    if (isRecord(result) && result.status === 'found' && isRecord(result.ref)) {
      return { outcome: 'succeeded', ref: result.ref };
    }
    return { outcome: 'unknown' };
  }

  async #reconcile(identity: ValidIdentity): Promise<unknown> {
    let listed: Awaited<ReturnType<NativeCalendarFacade['listEvents']>>;
    try {
      const parsed = requireCanonicalRange(identity.range);
      listed = await this.#native.listEvents(
        [identity.calendarId],
        parsed.start,
        parsed.end,
      );
    } catch {
      return { status: 'unknown' };
    }
    if (
      !isRecord(listed) ||
      !Array.isArray(listed.events) ||
      listed.completeness !== 'complete'
    ) {
      return { status: 'unknown' };
    }

    let ambiguousMarker = false;
    const candidates: ReconciliationCandidate[] = [];
    for (const event of listed.events) {
      if (!isRecord(event)) {
        ambiguousMarker = true;
        continue;
      }
      const nativeEvent = event as unknown as NativeCalendarEvent;
      if (nativeEvent.calendarId !== identity.calendarId) continue;
      if (
        nativeEvent.notes !== undefined &&
        nativeEvent.notes !== null &&
        typeof nativeEvent.notes !== 'string'
      ) {
        if (
          identity.expectedExternalEventId === null ||
          nativeEvent.id === identity.expectedExternalEventId
        ) {
          ambiguousMarker = true;
        }
        continue;
      }
      const marker = parseOwnedEventMarker(this.#namespace, nativeEvent.notes);
      if (marker.kind === 'invalid') {
        if (
          identity.expectedExternalEventId === null ||
          nativeEvent.id === identity.expectedExternalEventId
        ) {
          ambiguousMarker = true;
        }
        continue;
      }
      if (marker.kind !== 'valid') {
        if (nativeEvent.id === identity.expectedExternalEventId) {
          ambiguousMarker = true;
        }
        continue;
      }
      if (
        marker.marker.calendarOwnershipKey !== identity.ownershipKey ||
        marker.marker.timeBlockId !== identity.timeBlockId
      ) {
        continue;
      }
      const candidate = this.#reconciliationCandidate(nativeEvent, identity, {
        ...marker.marker,
        notesExact: marker.notesExact,
      });
      if (candidate === null) {
        ambiguousMarker = true;
      } else {
        candidates.push(candidate);
      }
    }

    candidates.sort((left, right) => {
      const leftKey = `${left.ref.externalEventId}\u0000${left.ref.occurrenceKey ?? ''}`;
      const rightKey = `${right.ref.externalEventId}\u0000${right.ref.occurrenceKey ?? ''}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

    const first = candidates[0];
    if (first === undefined) {
      return ambiguousMarker ? { status: 'unknown' } : { status: 'missing' };
    }
    const observedContentHash = this.#observedCalendarContentHash(first);
    const externalIdConflict =
      identity.expectedExternalEventId !== null &&
      identity.expectedExternalEventId !== first.ref.externalEventId;
    const occurrenceConflict =
      (identity.expectedExternalEventId !== null ||
        identity.expectedOccurrenceKey !== null) &&
      identity.expectedOccurrenceKey !== first.ref.occurrenceKey;
    const identityConflict =
      candidates.length > 1 || externalIdConflict || occurrenceConflict;
    // Keep the actual content hash for a sole stale expected-hash mismatch so
    // Application can verify it in a second read. Identity ambiguity gets a
    // distinct stable digest and can never be mistaken for desired content.
    const contentHash = identityConflict
      ? hashOperationParameters({
          kind: 'calendar_identity_conflict',
          candidates: candidates.map((candidate) => ({
            externalEventId: candidate.ref.externalEventId,
            occurrenceKey: candidate.ref.occurrenceKey,
            startAt: candidate.startAt,
            endAt: candidate.endAt,
            markerContentHash: candidate.markerContentHash,
            markerFingerprint: candidate.markerFingerprint,
            observedFingerprint: candidate.observedFingerprint,
            notesExact: candidate.notesExact,
          })),
        })
      : observedContentHash;
    const conflict =
      identityConflict ||
      first.observedFingerprint !== first.markerFingerprint ||
      !first.notesExact ||
      (identity.expectedContentHash !== null &&
        identity.expectedContentHash !== observedContentHash);
    return {
      status: conflict ? 'conflict' : 'found',
      ref: first.ref,
      contentHash,
      startAt: first.startAt,
      endAt: first.endAt,
      ownershipVerified: true,
    };
  }

  #reconciliationCandidate(
    event: NativeCalendarEvent,
    identity: ValidIdentity,
    marker: Readonly<{
      contentHash: string;
      nativeFingerprint: string;
      notesExact: boolean;
    }>,
  ): ReconciliationCandidate | null {
    try {
      const id = requireNonEmptyString(event.id, 'event.id');
      const title = requireNonEmptyString(event.title, 'event.title');
      const startAt = canonicalInstant(
        event.startDate instanceof Date
          ? event.startDate.toISOString()
          : typeof event.startDate === 'number'
            ? new Date(event.startDate).toISOString()
            : event.startDate,
        'event.startDate',
      );
      const endAt = canonicalInstant(
        event.endDate instanceof Date
          ? event.endDate.toISOString()
          : typeof event.endDate === 'number'
            ? new Date(event.endDate).toISOString()
            : event.endDate,
        'event.endDate',
      );
      if (Date.parse(endAt) <= Date.parse(startAt)) return null;
      if (
        Date.parse(endAt) <= Date.parse(identity.range.start) ||
        Date.parse(startAt) >= Date.parse(identity.range.end)
      ) {
        return null;
      }
      const occurrenceKey =
        event.originalId !== undefined && event.originalId !== null
          ? startAt
          : event.instanceId !== undefined && event.instanceId !== null
            ? startAt
            : event.originalStartDate !== undefined &&
                event.originalStartDate !== null
              ? startAt
              : null;
      return {
        ref: {
          provider: identity.provider,
          calendarId: identity.calendarId,
          externalEventId: id,
          occurrenceKey,
        },
        startAt,
        endAt,
        markerContentHash: marker.contentHash,
        markerFingerprint: marker.nativeFingerprint,
        observedFingerprint: nativeEventFingerprint({ title, startAt, endAt }),
        notesExact: marker.notesExact,
      };
    } catch {
      return null;
    }
  }

  #observedCalendarContentHash(candidate: ReconciliationCandidate): string {
    return candidate.observedFingerprint === candidate.markerFingerprint &&
      candidate.notesExact
      ? candidate.markerContentHash
      : candidate.notesExact
        ? candidate.observedFingerprint
        : hashOperationParameters({
            nativeFingerprint: candidate.observedFingerprint,
            markerNotesExact: false,
          });
  }
}

/** Creates the production adapter without loading Expo until explicitly called. */
export async function createExpoCalendarAdapter(
  options: ExpoCalendarAdapterOptions,
): Promise<ExpoCalendarAdapter> {
  return new ExpoCalendarAdapter({
    ...options,
    native: await loadExpoCalendarNativeFacade(),
  });
}
