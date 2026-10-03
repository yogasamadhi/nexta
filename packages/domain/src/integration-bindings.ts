import { DomainError } from './errors';
import {
  type CalendarBindingId,
  type CalendarContainerBindingId,
  type Instant,
  type NotificationBindingId,
  type TaskId,
  type TimeBlockId,
  compareInstants,
  parseCalendarBindingId,
  parseCalendarContainerBindingId,
  parseInstant,
  parseNotificationBindingId,
  parseTaskId,
  parseTimeBlockId,
  requireNonEmptyString,
  requireNonNegativeInteger,
} from './value-objects';

export const integrationBindingStatuses = [
  'synced',
  'pending',
  'permission_required',
  'failed',
  'disabled',
  'reconciliation_required',
  'conflict',
] as const;
export type IntegrationBindingStatus =
  (typeof integrationBindingStatuses)[number];

export interface CalendarContainerBinding {
  readonly id: CalendarContainerBindingId;
  readonly provider: string;
  readonly calendarId: string;
  readonly ownershipKey: string;
  readonly ownershipVerified: true;
  readonly status: IntegrationBindingStatus;
  readonly verifiedAt: Instant;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateCalendarContainerBindingFields extends Omit<
  CalendarContainerBinding,
  | 'id'
  | 'provider'
  | 'calendarId'
  | 'ownershipKey'
  | 'verifiedAt'
  | 'createdAt'
  | 'updatedAt'
> {
  readonly id: CalendarContainerBindingId;
  readonly provider: string;
  readonly calendarId: string;
  readonly ownershipKey: string;
  readonly verifiedAt: Instant;
  readonly createdAt: Instant;
  readonly updatedAt?: Instant;
}

export interface CalendarBinding {
  readonly id: CalendarBindingId;
  readonly timeBlockId: TimeBlockId;
  readonly provider: string;
  readonly calendarId: string;
  readonly externalEventId: string;
  readonly occurrenceKey: string | null;
  readonly ownershipKey: string;
  readonly ownershipVerified: true;
  readonly appliedContentHash: string;
  readonly appliedStartAt: Instant;
  readonly appliedEndAt: Instant;
  readonly lastAppliedRevision: number;
  readonly status: IntegrationBindingStatus;
  readonly verifiedAt: Instant;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateCalendarBindingFields extends Omit<
  CalendarBinding,
  | 'id'
  | 'timeBlockId'
  | 'provider'
  | 'calendarId'
  | 'externalEventId'
  | 'occurrenceKey'
  | 'ownershipKey'
  | 'appliedContentHash'
  | 'appliedStartAt'
  | 'appliedEndAt'
  | 'lastAppliedRevision'
  | 'verifiedAt'
  | 'createdAt'
  | 'updatedAt'
> {
  readonly id: CalendarBindingId;
  readonly timeBlockId: TimeBlockId;
  readonly provider: string;
  readonly calendarId: string;
  readonly externalEventId: string;
  readonly occurrenceKey?: string | null;
  readonly ownershipKey: string;
  readonly appliedContentHash: string;
  readonly appliedStartAt: Instant;
  readonly appliedEndAt: Instant;
  readonly lastAppliedRevision: number;
  readonly verifiedAt: Instant;
  readonly createdAt: Instant;
  readonly updatedAt?: Instant;
}

export interface NotificationBinding {
  readonly id: NotificationBindingId;
  readonly timeBlockId: TimeBlockId;
  readonly taskId: TaskId | null;
  readonly osNotificationId: string;
  readonly type: string;
  readonly appliedContentHash: string;
  readonly scheduledAt: Instant;
  readonly desiredRevision: number;
  readonly lastAppliedRevision: number;
  readonly status: IntegrationBindingStatus;
  readonly identityVerified: true;
  readonly verifiedAt: Instant;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateNotificationBindingFields extends Omit<
  NotificationBinding,
  | 'id'
  | 'timeBlockId'
  | 'taskId'
  | 'osNotificationId'
  | 'type'
  | 'appliedContentHash'
  | 'scheduledAt'
  | 'desiredRevision'
  | 'lastAppliedRevision'
  | 'verifiedAt'
  | 'createdAt'
  | 'updatedAt'
> {
  readonly id: NotificationBindingId;
  readonly timeBlockId: TimeBlockId;
  readonly taskId?: TaskId | null;
  readonly osNotificationId: string;
  readonly type: string;
  readonly appliedContentHash: string;
  readonly scheduledAt: Instant;
  readonly desiredRevision: number;
  readonly lastAppliedRevision: number;
  readonly verifiedAt: Instant;
  readonly createdAt: Instant;
  readonly updatedAt?: Instant;
}

function assertStatus(
  status: string,
): asserts status is IntegrationBindingStatus {
  if (
    !integrationBindingStatuses.includes(status as IntegrationBindingStatus)
  ) {
    throw new DomainError(
      'invalid_value',
      'Integration binding status is unsupported.',
      { field: 'status' },
    );
  }
}

function optionalString(value: string | null | undefined, field: string) {
  return value === null || value === undefined
    ? null
    : requireNonEmptyString(value, field);
}

function assertVerified(value: boolean, field: string): asserts value is true {
  if (value !== true) {
    throw new DomainError(
      'invariant_violation',
      'Integration bindings require verified platform ownership.',
      { field },
    );
  }
}

function assertRange(start: Instant, end: Instant): void {
  if (compareInstants(end, start) <= 0) {
    throw new DomainError(
      'invalid_value',
      'Calendar binding end must be after start.',
      { field: 'appliedEndAt' },
    );
  }
}

export function assertValidCalendarContainerBinding(
  binding: CalendarContainerBinding,
): void {
  parseCalendarContainerBindingId(binding.id);
  requireNonEmptyString(binding.provider, 'provider');
  requireNonEmptyString(binding.calendarId, 'calendarId');
  requireNonEmptyString(binding.ownershipKey, 'ownershipKey');
  assertVerified(binding.ownershipVerified, 'ownershipVerified');
  assertStatus(binding.status);
  parseInstant(binding.verifiedAt);
  parseInstant(binding.createdAt);
  parseInstant(binding.updatedAt);
}

export function createCalendarContainerBinding(
  input: CreateCalendarContainerBindingFields,
): CalendarContainerBinding {
  const createdAt = parseInstant(input.createdAt);
  const binding: CalendarContainerBinding = {
    id: parseCalendarContainerBindingId(input.id),
    provider: requireNonEmptyString(input.provider, 'provider'),
    calendarId: requireNonEmptyString(input.calendarId, 'calendarId'),
    ownershipKey: requireNonEmptyString(input.ownershipKey, 'ownershipKey'),
    ownershipVerified: input.ownershipVerified,
    status: input.status,
    verifiedAt: parseInstant(input.verifiedAt),
    createdAt,
    updatedAt: parseInstant(input.updatedAt ?? createdAt),
  };
  assertValidCalendarContainerBinding(binding);
  return binding;
}

export function assertValidCalendarBinding(binding: CalendarBinding): void {
  parseCalendarBindingId(binding.id);
  parseTimeBlockId(binding.timeBlockId);
  requireNonEmptyString(binding.provider, 'provider');
  requireNonEmptyString(binding.calendarId, 'calendarId');
  requireNonEmptyString(binding.externalEventId, 'externalEventId');
  optionalString(binding.occurrenceKey, 'occurrenceKey');
  requireNonEmptyString(binding.ownershipKey, 'ownershipKey');
  assertVerified(binding.ownershipVerified, 'ownershipVerified');
  requireNonEmptyString(binding.appliedContentHash, 'appliedContentHash');
  parseInstant(binding.appliedStartAt);
  parseInstant(binding.appliedEndAt);
  assertRange(binding.appliedStartAt, binding.appliedEndAt);
  requireNonNegativeInteger(binding.lastAppliedRevision, 'lastAppliedRevision');
  assertStatus(binding.status);
  parseInstant(binding.verifiedAt);
  parseInstant(binding.createdAt);
  parseInstant(binding.updatedAt);
}

export function createCalendarBinding(
  input: CreateCalendarBindingFields,
): CalendarBinding {
  const createdAt = parseInstant(input.createdAt);
  const binding: CalendarBinding = {
    id: parseCalendarBindingId(input.id),
    timeBlockId: parseTimeBlockId(input.timeBlockId),
    provider: requireNonEmptyString(input.provider, 'provider'),
    calendarId: requireNonEmptyString(input.calendarId, 'calendarId'),
    externalEventId: requireNonEmptyString(
      input.externalEventId,
      'externalEventId',
    ),
    occurrenceKey: optionalString(input.occurrenceKey, 'occurrenceKey'),
    ownershipKey: requireNonEmptyString(input.ownershipKey, 'ownershipKey'),
    ownershipVerified: input.ownershipVerified,
    appliedContentHash: requireNonEmptyString(
      input.appliedContentHash,
      'appliedContentHash',
    ),
    appliedStartAt: parseInstant(input.appliedStartAt),
    appliedEndAt: parseInstant(input.appliedEndAt),
    lastAppliedRevision: requireNonNegativeInteger(
      input.lastAppliedRevision,
      'lastAppliedRevision',
    ),
    status: input.status,
    verifiedAt: parseInstant(input.verifiedAt),
    createdAt,
    updatedAt: parseInstant(input.updatedAt ?? createdAt),
  };
  assertValidCalendarBinding(binding);
  return binding;
}

export function assertValidNotificationBinding(
  binding: NotificationBinding,
): void {
  parseNotificationBindingId(binding.id);
  parseTimeBlockId(binding.timeBlockId);
  if (binding.taskId !== null) parseTaskId(binding.taskId);
  requireNonEmptyString(binding.osNotificationId, 'osNotificationId');
  requireNonEmptyString(binding.type, 'notificationType');
  requireNonEmptyString(binding.appliedContentHash, 'appliedContentHash');
  parseInstant(binding.scheduledAt);
  requireNonNegativeInteger(binding.desiredRevision, 'desiredRevision');
  requireNonNegativeInteger(binding.lastAppliedRevision, 'lastAppliedRevision');
  if (binding.desiredRevision < binding.lastAppliedRevision) {
    throw new DomainError(
      'invariant_violation',
      'Notification desiredRevision cannot precede lastAppliedRevision.',
      { field: 'desiredRevision' },
    );
  }
  if (
    binding.status === 'synced' &&
    binding.desiredRevision !== binding.lastAppliedRevision
  ) {
    throw new DomainError(
      'invariant_violation',
      'A synced notification binding must have matching revisions.',
      { field: 'status' },
    );
  }
  assertStatus(binding.status);
  assertVerified(binding.identityVerified, 'identityVerified');
  parseInstant(binding.verifiedAt);
  parseInstant(binding.createdAt);
  parseInstant(binding.updatedAt);
}

export function createNotificationBinding(
  input: CreateNotificationBindingFields,
): NotificationBinding {
  const createdAt = parseInstant(input.createdAt);
  const binding: NotificationBinding = {
    id: parseNotificationBindingId(input.id),
    timeBlockId: parseTimeBlockId(input.timeBlockId),
    taskId:
      input.taskId === null || input.taskId === undefined
        ? null
        : parseTaskId(input.taskId),
    osNotificationId: requireNonEmptyString(
      input.osNotificationId,
      'osNotificationId',
    ),
    type: requireNonEmptyString(input.type, 'notificationType'),
    appliedContentHash: requireNonEmptyString(
      input.appliedContentHash,
      'appliedContentHash',
    ),
    scheduledAt: parseInstant(input.scheduledAt),
    desiredRevision: requireNonNegativeInteger(
      input.desiredRevision,
      'desiredRevision',
    ),
    lastAppliedRevision: requireNonNegativeInteger(
      input.lastAppliedRevision,
      'lastAppliedRevision',
    ),
    status: input.status,
    identityVerified: input.identityVerified,
    verifiedAt: parseInstant(input.verifiedAt),
    createdAt,
    updatedAt: parseInstant(input.updatedAt ?? createdAt),
  };
  assertValidNotificationBinding(binding);
  return binding;
}
