import { DomainError } from './errors';
import {
  type CalendarRefreshCoverageId,
  type ExternalCalendarEventSnapshotId,
  type Instant,
  compareInstants,
  parseCalendarRefreshCoverageId,
  parseExternalCalendarEventSnapshotId,
  parseInstant,
  requireNonEmptyString,
  requireNonNegativeInteger,
} from './value-objects';

export interface ExternalCalendarEventSnapshot {
  readonly id: ExternalCalendarEventSnapshotId;
  readonly provider: string;
  readonly calendarId: string;
  readonly externalEventId: string;
  readonly occurrenceKey: string | null;
  readonly startAt: Instant;
  readonly endAt: Instant;
  readonly busy: boolean;
  readonly lastSeenAt: Instant;
  readonly contentHash: string;
}

export interface CreateExternalCalendarEventSnapshotFields {
  readonly id: ExternalCalendarEventSnapshotId;
  readonly provider: string;
  readonly calendarId: string;
  readonly externalEventId: string;
  readonly occurrenceKey?: string | null;
  readonly startAt: Instant;
  readonly endAt: Instant;
  readonly busy: boolean;
  readonly lastSeenAt: Instant;
  readonly contentHash: string;
}

export interface CalendarRefreshCoverage {
  readonly id: CalendarRefreshCoverageId;
  readonly provider: string;
  readonly calendarId: string;
  readonly rangeStart: Instant;
  readonly rangeEnd: Instant;
  readonly fetchedAt: Instant;
  /** Partial attempts never create or replace a coverage record. */
  readonly completeness: 'complete';
  readonly observedEventCount: number;
}

export interface CreateCalendarRefreshCoverageFields {
  readonly id: CalendarRefreshCoverageId;
  readonly provider: string;
  readonly calendarId: string;
  readonly rangeStart: Instant;
  readonly rangeEnd: Instant;
  readonly fetchedAt: Instant;
  readonly completeness: 'complete';
  readonly observedEventCount: number;
}

function optionalNonEmpty(value: string | null | undefined, field: string) {
  return value === null || value === undefined
    ? null
    : requireNonEmptyString(value, field);
}

function assertRange(start: Instant, end: Instant, field: string): void {
  if (compareInstants(end, start) <= 0) {
    throw new DomainError(
      'invalid_value',
      `${field} end must be after start.`,
      { field },
    );
  }
}

export function externalCalendarEventIdentity(
  event: Pick<
    ExternalCalendarEventSnapshot,
    'provider' | 'calendarId' | 'externalEventId' | 'occurrenceKey'
  >,
): string {
  return JSON.stringify([
    requireNonEmptyString(event.provider, 'provider'),
    requireNonEmptyString(event.calendarId, 'calendarId'),
    requireNonEmptyString(event.externalEventId, 'externalEventId'),
    optionalNonEmpty(event.occurrenceKey, 'occurrenceKey'),
  ]);
}

export function assertValidExternalCalendarEventSnapshot(
  snapshot: ExternalCalendarEventSnapshot,
): void {
  parseExternalCalendarEventSnapshotId(snapshot.id);
  requireNonEmptyString(snapshot.provider, 'provider');
  requireNonEmptyString(snapshot.calendarId, 'calendarId');
  requireNonEmptyString(snapshot.externalEventId, 'externalEventId');
  optionalNonEmpty(snapshot.occurrenceKey, 'occurrenceKey');
  parseInstant(snapshot.startAt);
  parseInstant(snapshot.endAt);
  assertRange(snapshot.startAt, snapshot.endAt, 'calendarEventRange');
  if (typeof snapshot.busy !== 'boolean') {
    throw new DomainError(
      'invalid_value',
      'External calendar event busy must be boolean.',
      { field: 'busy' },
    );
  }
  parseInstant(snapshot.lastSeenAt);
  requireNonEmptyString(snapshot.contentHash, 'contentHash');
}

export function createExternalCalendarEventSnapshot(
  input: CreateExternalCalendarEventSnapshotFields,
): ExternalCalendarEventSnapshot {
  const snapshot: ExternalCalendarEventSnapshot = {
    id: parseExternalCalendarEventSnapshotId(input.id),
    provider: requireNonEmptyString(input.provider, 'provider'),
    calendarId: requireNonEmptyString(input.calendarId, 'calendarId'),
    externalEventId: requireNonEmptyString(
      input.externalEventId,
      'externalEventId',
    ),
    occurrenceKey: optionalNonEmpty(input.occurrenceKey, 'occurrenceKey'),
    startAt: parseInstant(input.startAt),
    endAt: parseInstant(input.endAt),
    busy: input.busy,
    lastSeenAt: parseInstant(input.lastSeenAt),
    contentHash: requireNonEmptyString(input.contentHash, 'contentHash'),
  };
  assertValidExternalCalendarEventSnapshot(snapshot);
  return snapshot;
}

export function assertValidCalendarRefreshCoverage(
  coverage: CalendarRefreshCoverage,
): void {
  parseCalendarRefreshCoverageId(coverage.id);
  requireNonEmptyString(coverage.provider, 'provider');
  requireNonEmptyString(coverage.calendarId, 'calendarId');
  parseInstant(coverage.rangeStart);
  parseInstant(coverage.rangeEnd);
  assertRange(coverage.rangeStart, coverage.rangeEnd, 'coverageRange');
  parseInstant(coverage.fetchedAt);
  if (coverage.completeness !== 'complete') {
    throw new DomainError(
      'invalid_value',
      'Calendar refresh coverage must represent a complete refresh.',
      { field: 'completeness' },
    );
  }
  requireNonNegativeInteger(coverage.observedEventCount, 'observedEventCount');
}

export function createCalendarRefreshCoverage(
  input: CreateCalendarRefreshCoverageFields,
): CalendarRefreshCoverage {
  const coverage: CalendarRefreshCoverage = {
    id: parseCalendarRefreshCoverageId(input.id),
    provider: requireNonEmptyString(input.provider, 'provider'),
    calendarId: requireNonEmptyString(input.calendarId, 'calendarId'),
    rangeStart: parseInstant(input.rangeStart),
    rangeEnd: parseInstant(input.rangeEnd),
    fetchedAt: parseInstant(input.fetchedAt),
    completeness: input.completeness,
    observedEventCount: requireNonNegativeInteger(
      input.observedEventCount,
      'observedEventCount',
    ),
  };
  assertValidCalendarRefreshCoverage(coverage);
  return coverage;
}
