import { DomainError } from './errors';
import {
  compareInstants,
  type ExternalMutationIntentId,
  type Instant,
  type IntegrationJobId,
  type TimeBlockId,
  parseExternalMutationIntentId,
  parseInstant,
  parseIntegrationJobId,
  parseTimeBlockId,
  requireNonEmptyString,
  requireNonNegativeInteger,
} from './value-objects';

export type CalendarProvisionMutationPayload = Readonly<{
  provider: string;
  ownershipKey: string;
  existingCalendarId: string | null;
}>;

export type CalendarEventMutationPayload = Readonly<{
  provider: string;
  calendarId: string;
  ownershipKey: string;
  timeBlockId: TimeBlockId;
  searchStartAt: Instant;
  searchEndAt: Instant;
  externalEventId: string | null;
  occurrenceKey: string | null;
  expectedContentHash: string | null;
  desiredContentHash: string | null;
  desiredStartAt: Instant | null;
  desiredEndAt: Instant | null;
}>;

export type NotificationMutationPayload = Readonly<{
  timeBlockId: TimeBlockId;
  type: string;
  osNotificationId: string | null;
  expectedContentHash: string | null;
  desiredContentHash: string | null;
  desiredScheduledAt: Instant | null;
}>;

export type ExternalMutationIntent = Readonly<{
  id: ExternalMutationIntentId;
  integrationJobId: IntegrationJobId;
  desiredRevision: number;
  scopeKey: string;
  action:
    | 'calendar_provision'
    | 'calendar_event_create'
    | 'calendar_event_update'
    | 'calendar_event_delete'
    | 'notification_schedule'
    | 'notification_cancel';
  payload:
    | CalendarProvisionMutationPayload
    | CalendarEventMutationPayload
    | NotificationMutationPayload;
  createdAt: Instant;
  updatedAt: Instant;
}>;

export type CreateExternalMutationIntentFields = Omit<
  ExternalMutationIntent,
  | 'id'
  | 'integrationJobId'
  | 'desiredRevision'
  | 'scopeKey'
  | 'createdAt'
  | 'updatedAt'
> &
  Readonly<{
    id: ExternalMutationIntentId;
    integrationJobId: IntegrationJobId;
    desiredRevision: number;
    createdAt: Instant;
    updatedAt?: Instant;
  }>;

function optionalString(value: string | null, field: string): string | null {
  return value === null ? null : requireNonEmptyString(value, field);
}

function assertRange(startAt: Instant, endAt: Instant, field: string): void {
  parseInstant(startAt);
  parseInstant(endAt);
  if (compareInstants(endAt, startAt) <= 0) {
    throw new DomainError(
      'invariant_violation',
      `${field} must be non-empty.`,
      {
        field,
      },
    );
  }
}

function assertCalendarPayload(
  intent: ExternalMutationIntent,
  payload: CalendarEventMutationPayload,
): void {
  requireNonEmptyString(payload.provider, 'provider');
  requireNonEmptyString(payload.calendarId, 'calendarId');
  requireNonEmptyString(payload.ownershipKey, 'ownershipKey');
  parseTimeBlockId(payload.timeBlockId);
  assertRange(payload.searchStartAt, payload.searchEndAt, 'searchRange');
  optionalString(payload.externalEventId, 'externalEventId');
  optionalString(payload.occurrenceKey, 'occurrenceKey');
  optionalString(payload.expectedContentHash, 'expectedContentHash');
  optionalString(payload.desiredContentHash, 'desiredContentHash');
  if (intent.action === 'calendar_event_create') {
    if (
      payload.externalEventId !== null ||
      payload.occurrenceKey !== null ||
      payload.desiredContentHash === null ||
      payload.desiredStartAt === null ||
      payload.desiredEndAt === null
    ) {
      throw new DomainError(
        'invariant_violation',
        'Calendar create intent has inconsistent identity or desired state.',
        { field: 'payload' },
      );
    }
  } else if (payload.externalEventId === null) {
    throw new DomainError(
      'invariant_violation',
      'Calendar update/delete intent requires an external event identity.',
      { field: 'externalEventId' },
    );
  }
  if (intent.action === 'calendar_event_delete') {
    if (
      payload.expectedContentHash === null ||
      payload.desiredContentHash !== null ||
      payload.desiredStartAt !== null ||
      payload.desiredEndAt !== null
    ) {
      throw new DomainError(
        'invariant_violation',
        'Calendar delete intent must describe only the previously applied state.',
        { field: 'payload' },
      );
    }
  } else {
    if (
      payload.desiredContentHash === null ||
      payload.desiredStartAt === null ||
      payload.desiredEndAt === null
    ) {
      throw new DomainError(
        'invariant_violation',
        'Calendar create/update intent requires a desired event state.',
        { field: 'payload' },
      );
    }
    assertRange(payload.desiredStartAt, payload.desiredEndAt, 'desiredRange');
  }
}

function assertNotificationPayload(
  intent: ExternalMutationIntent,
  payload: NotificationMutationPayload,
): void {
  parseTimeBlockId(payload.timeBlockId);
  requireNonEmptyString(payload.type, 'type');
  optionalString(payload.osNotificationId, 'osNotificationId');
  optionalString(payload.expectedContentHash, 'expectedContentHash');
  optionalString(payload.desiredContentHash, 'desiredContentHash');
  if (intent.action === 'notification_cancel') {
    if (
      payload.osNotificationId === null ||
      payload.expectedContentHash === null ||
      payload.desiredContentHash !== null ||
      payload.desiredScheduledAt !== null
    ) {
      throw new DomainError(
        'invariant_violation',
        'Notification cancel intent must describe only the applied notification.',
        { field: 'payload' },
      );
    }
  } else if (
    payload.desiredContentHash === null ||
    payload.desiredScheduledAt === null
  ) {
    throw new DomainError(
      'invariant_violation',
      'Notification schedule intent requires a desired notification state.',
      { field: 'payload' },
    );
  }
  if (payload.desiredScheduledAt !== null) {
    parseInstant(payload.desiredScheduledAt);
  }
}

export function externalMutationIntentChannel(
  intent: Pick<ExternalMutationIntent, 'action'>,
): 'calendar' | 'notification' {
  return intent.action.startsWith('calendar_') ? 'calendar' : 'notification';
}

export function externalMutationIntentScopeKey(
  action: ExternalMutationIntent['action'],
  payload: ExternalMutationIntent['payload'],
): string {
  if (action === 'calendar_provision') {
    const value = payload as CalendarProvisionMutationPayload;
    return JSON.stringify([
      'calendar_provision',
      value.provider,
      value.ownershipKey,
    ]);
  }
  if (action.startsWith('calendar_event_')) {
    const value = payload as CalendarEventMutationPayload;
    return JSON.stringify([
      'calendar_event',
      value.provider,
      value.calendarId,
      value.timeBlockId,
    ]);
  }
  const value = payload as NotificationMutationPayload;
  return JSON.stringify(['notification', value.timeBlockId, value.type]);
}

export function assertValidExternalMutationIntent(
  intent: ExternalMutationIntent,
): void {
  parseExternalMutationIntentId(intent.id);
  parseIntegrationJobId(intent.integrationJobId);
  requireNonNegativeInteger(intent.desiredRevision, 'desiredRevision');
  requireNonEmptyString(intent.scopeKey, 'scopeKey');
  if (intent.action === 'calendar_provision') {
    const payload = intent.payload as CalendarProvisionMutationPayload;
    requireNonEmptyString(payload.provider, 'provider');
    requireNonEmptyString(payload.ownershipKey, 'ownershipKey');
    optionalString(payload.existingCalendarId, 'existingCalendarId');
  } else if (intent.action.startsWith('calendar_event_')) {
    assertCalendarPayload(
      intent,
      intent.payload as CalendarEventMutationPayload,
    );
  } else if (
    intent.action === 'notification_schedule' ||
    intent.action === 'notification_cancel'
  ) {
    assertNotificationPayload(
      intent,
      intent.payload as NotificationMutationPayload,
    );
  } else {
    throw new DomainError(
      'invalid_value',
      'External mutation intent action is unsupported.',
      { field: 'action' },
    );
  }
  parseInstant(intent.createdAt);
  parseInstant(intent.updatedAt);
  if (
    intent.scopeKey !==
    externalMutationIntentScopeKey(intent.action, intent.payload)
  ) {
    throw new DomainError(
      'invariant_violation',
      'External mutation intent scopeKey does not match its stable identity.',
      { field: 'scopeKey' },
    );
  }
}

export function createExternalMutationIntent(
  input: CreateExternalMutationIntentFields,
): ExternalMutationIntent {
  const createdAt = parseInstant(input.createdAt);
  const intent: ExternalMutationIntent = {
    id: parseExternalMutationIntentId(input.id),
    integrationJobId: parseIntegrationJobId(input.integrationJobId),
    desiredRevision: requireNonNegativeInteger(
      input.desiredRevision,
      'desiredRevision',
    ),
    scopeKey: externalMutationIntentScopeKey(input.action, input.payload),
    action: input.action,
    payload: input.payload,
    createdAt,
    updatedAt: parseInstant(input.updatedAt ?? createdAt),
  };
  assertValidExternalMutationIntent(intent);
  return intent;
}
