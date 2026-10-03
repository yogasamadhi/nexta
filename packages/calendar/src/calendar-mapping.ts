import { hashOperationParameters } from '@workspace/application';

import type { NativeCalendarEvent } from './native-calendar';

export type CanonicalTimeRange = Readonly<{
  start: string;
  end: string;
}>;

export type MappedBusyEvent = Readonly<{
  externalEventId: string;
  occurrenceKey: string | null;
  startAt: string;
  endAt: string;
  busy: boolean;
  contentHash: string;
}>;

export type BusyEventMappingResult = Readonly<{
  completeness: 'complete' | 'partial';
  events: readonly MappedBusyEvent[];
}>;

function canonicalInstant(value: Date | string | number): string | null {
  const millis =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  try {
    return new Date(millis).toISOString();
  } catch {
    return null;
  }
}

export function requireCanonicalRange(range: CanonicalTimeRange): {
  start: Date;
  end: Date;
} {
  const start = canonicalInstant(range.start);
  const end = canonicalInstant(range.end);
  if (
    start === null ||
    end === null ||
    start !== range.start ||
    end !== range.end ||
    Date.parse(end) <= Date.parse(start)
  ) {
    throw new Error('Calendar range must be a non-empty canonical UTC range.');
  }
  return { start: new Date(start), end: new Date(end) };
}

export function nativeEventFingerprint(input: {
  title: string;
  startAt: string;
  endAt: string;
}): string {
  return hashOperationParameters({
    title: input.title,
    startAt: input.startAt,
    endAt: input.endAt,
  });
}

function eventIdentity(event: MappedBusyEvent): string {
  return `${event.externalEventId}\u0000${event.occurrenceKey ?? ''}`;
}

function conflictingObservationKey(event: MappedBusyEvent): string {
  return JSON.stringify([
    event.startAt,
    event.endAt,
    event.busy,
    event.contentHash,
  ]);
}

export function mapBusyEvents(input: {
  nativeCompleteness: 'complete' | 'partial';
  nativeEvents: readonly NativeCalendarEvent[];
  calendarId: string;
  range: CanonicalTimeRange;
}): BusyEventMappingResult {
  const { start, end } = requireCanonicalRange(input.range);
  let completeness = input.nativeCompleteness;
  const mapped = new Map<string, MappedBusyEvent>();

  for (const native of input.nativeEvents) {
    const startAt = canonicalInstant(native.startDate);
    const endAt = canonicalInstant(native.endDate);
    if (
      native.id.trim().length === 0 ||
      native.calendarId !== input.calendarId ||
      startAt === null ||
      endAt === null ||
      Date.parse(endAt) <= Date.parse(startAt)
    ) {
      completeness = 'partial';
      continue;
    }

    if (
      Date.parse(endAt) <= start.getTime() ||
      Date.parse(startAt) >= end.getTime()
    ) {
      continue;
    }

    const externalEventId =
      native.originalId === undefined ||
      native.originalId === null ||
      native.originalId.trim().length === 0
        ? native.id
        : native.originalId;
    const recurring =
      native.originalId !== undefined && native.originalId !== null
        ? true
        : native.instanceId !== undefined && native.instanceId !== null
          ? true
          : native.originalStartDate !== undefined &&
            native.originalStartDate !== null;
    // Android's instanceId is explicitly volatile. The occurrence start is
    // stable for an unchanged instance and complete refresh handles moves as
    // delete+create.
    const occurrenceKey = recurring ? startAt : null;
    const busy = native.status !== 'canceled' && native.availability !== 'free';
    const event: MappedBusyEvent = {
      externalEventId,
      occurrenceKey,
      startAt,
      endAt,
      busy,
      contentHash: hashOperationParameters({
        calendarId: input.calendarId,
        externalEventId,
        occurrenceKey,
        startAt,
        endAt,
        busy,
      }),
    };
    const identity = eventIdentity(event);
    const prior = mapped.get(identity);
    if (prior !== undefined) {
      if (
        prior.startAt !== event.startAt ||
        prior.endAt !== event.endAt ||
        prior.busy !== event.busy ||
        prior.contentHash !== event.contentHash
      ) {
        completeness = 'partial';
        if (
          conflictingObservationKey(event) < conflictingObservationKey(prior)
        ) {
          mapped.set(identity, event);
        }
      }
      continue;
    }
    mapped.set(identity, event);
  }

  return {
    completeness,
    events: [...mapped.values()].sort((left, right) => {
      const leftKey = eventIdentity(left);
      const rightKey = eventIdentity(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  };
}
