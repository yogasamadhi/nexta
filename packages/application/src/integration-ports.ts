import type {
  Instant,
  IntegrationJob,
  IntegrationJobChannel,
  Task,
  TaskId,
  TimeBlock,
  TimeBlockId,
} from '@workspace/domain';

import type { ScheduleTimeRange } from './schedule-ports';

export const permissionStates = [
  'not_determined',
  'granted',
  'denied',
  'unavailable',
] as const;
export type PermissionState = (typeof permissionStates)[number];

export type PermissionCapability = Readonly<{
  status: PermissionState;
  canAskAgain: boolean;
  /** True when the host should route the user to system settings. */
  settingsRequired: boolean;
}>;

export type CalendarPermissionState = Readonly<{
  read: PermissionCapability;
  write: PermissionCapability;
}>;

export type NotificationPermissionState = PermissionCapability;

export type CalendarInfo = Readonly<{
  provider: string;
  calendarId: string;
  title: string;
  allowsRead: boolean;
  allowsWrite: boolean;
}>;

export type CalendarBusyRequest = Readonly<{
  provider: string;
  calendarId: string;
  range: ScheduleTimeRange;
}>;

export type CalendarBusyEvent = Readonly<{
  externalEventId: string;
  occurrenceKey: string | null;
  startAt: Instant;
  endAt: Instant;
  busy: boolean;
  contentHash: string;
}>;

export type BusySnapshotResult = Readonly<{
  provider: string;
  calendarId: string;
  range: ScheduleTimeRange;
  fetchedAt: Instant;
  completeness: 'complete' | 'partial';
  events: readonly CalendarBusyEvent[];
}>;

export type CalendarRef = Readonly<{
  provider: string;
  calendarId: string;
  ownershipKey: string;
  ownershipVerified: true;
}>;

export type CalendarProvisioningInput = Readonly<{
  provider: string;
  ownershipKey: string;
  title: string;
  color: string | null;
  androidSource: string | null;
}>;

export type EnsureAppCalendarInput = CalendarProvisioningInput &
  Readonly<{ existingRef: CalendarRef | null }>;

export type ExternalEventRef = Readonly<{
  provider: string;
  calendarId: string;
  externalEventId: string;
  occurrenceKey: string | null;
}>;

export type OwnedAppEventRef = ExternalEventRef &
  Readonly<{
    timeBlockId: TimeBlockId;
    ownershipKey: string;
    ownershipVerified: true;
    verifiedAt: Instant;
  }>;

export type AppEventIdentity = Readonly<{
  provider: string;
  calendarId: string;
  ownershipKey: string;
  timeBlockId: TimeBlockId;
  searchRange: ScheduleTimeRange;
  expectedExternalEventId: string | null;
  expectedOccurrenceKey: string | null;
  expectedContentHash: string | null;
}>;

export type AppCalendarEventInput = Readonly<{
  calendar: CalendarRef;
  identity: AppEventIdentity;
  title: string;
  startAt: Instant;
  endAt: Instant;
  contentHash: string;
  planRevision: number;
}>;

export type AppCalendarEventPatch = Readonly<{
  title: string;
  startAt: Instant;
  endAt: Instant;
  contentHash: string;
  planRevision: number;
}>;

export type CalendarEventProjection = Readonly<{
  title: string;
  startAt: Instant;
  endAt: Instant;
}>;

export type ExternalMutationResult<Reference> =
  | Readonly<{ outcome: 'succeeded'; ref: Reference }>
  | Readonly<{ outcome: 'unknown' }>;

export type ExternalDeletionResult =
  Readonly<{ outcome: 'succeeded' }> | Readonly<{ outcome: 'unknown' }>;

export type AppEventReconciliation =
  | Readonly<{
      status: 'found';
      ref: ExternalEventRef;
      contentHash: string;
      startAt: Instant;
      endAt: Instant;
      ownershipVerified: true;
    }>
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'unknown' }>
  | Readonly<{
      status: 'conflict';
      ref: ExternalEventRef;
      contentHash: string;
      startAt: Instant;
      endAt: Instant;
      ownershipVerified: true;
    }>;

export type OwnedCalendarEventInventoryInput = Readonly<{
  calendar: CalendarRef;
  range: ScheduleTimeRange;
}>;

export type OwnedCalendarEventCandidate = Readonly<{
  timeBlockId: TimeBlockId;
  planRevision: number;
  ref: ExternalEventRef;
  contentHash: string;
  startAt: Instant;
  endAt: Instant;
  ownershipVerified: true;
}>;

export type OwnedCalendarEventInventoryResult =
  | Readonly<{
      status: 'complete' | 'partial';
      provider: string;
      calendarId: string;
      range: ScheduleTimeRange;
      events: readonly OwnedCalendarEventCandidate[];
    }>
  | Readonly<{ status: 'unknown' }>;

export interface CalendarProvider {
  readonly provider: string;
  /** Read-only. Background work must never trigger a permission prompt. */
  getPermissionState(): Promise<unknown>;
  /** Called only from an explicit foreground permission action. */
  requestPermission(access: 'read' | 'write'): Promise<unknown>;
  listCalendars(): Promise<unknown>;
  listBusyEvents(input: CalendarBusyRequest): Promise<unknown>;
  ensureAppCalendar(input: EnsureAppCalendarInput): Promise<unknown>;
  createAppEvent(input: AppCalendarEventInput): Promise<unknown>;
  updateAppEvent(
    ref: OwnedAppEventRef,
    patch: AppCalendarEventPatch,
  ): Promise<unknown>;
  deleteAppEvent(ref: OwnedAppEventRef): Promise<unknown>;
  reconcileAppEvent(identity: AppEventIdentity): Promise<unknown>;
  /** Bounded marker inventory. Partial results may discover but never infer absence. */
  listOwnedAppEvents(input: OwnedCalendarEventInventoryInput): Promise<unknown>;
}

export type NotificationIdentity = Readonly<{
  timeBlockId: TimeBlockId;
  type: string;
  expectedOsNotificationId: string | null;
  expectedContentHash: string | null;
}>;

export type NotificationRef = Readonly<{
  osNotificationId: string;
  identity: Readonly<{ timeBlockId: TimeBlockId; type: string }>;
}>;

export type OwnedNotificationRef = NotificationRef &
  Readonly<{ identityVerified: true; verifiedAt: Instant }>;

export type NotificationProjection = Readonly<{
  title: string;
  body: string | null;
  scheduledAt: Instant;
  type: string;
}>;

export type LocalNotificationInput = NotificationProjection &
  Readonly<{
    identity: NotificationIdentity;
    taskId: TaskId | null;
    contentHash: string;
    planRevision: number;
  }>;

export type NotificationReconciliation =
  | Readonly<{
      status: 'found';
      ref: NotificationRef;
      contentHash: string;
      scheduledAt: Instant;
      identityVerified: true;
    }>
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'unknown' }>
  | Readonly<{
      status: 'conflict';
      ref: NotificationRef;
      contentHash: string;
      scheduledAt: Instant;
      identityVerified: true;
    }>;

export type OwnedNotificationCandidate = Readonly<{
  planRevision: number;
  ref: NotificationRef;
  contentHash: string;
  scheduledAt: Instant;
  identityVerified: true;
}>;

export type OwnedNotificationInventoryResult =
  | Readonly<{
      status: 'complete' | 'partial';
      notifications: readonly OwnedNotificationCandidate[];
    }>
  | Readonly<{ status: 'unknown' }>;

export interface NotificationProvider {
  /** Read-only. Background work must never trigger a permission prompt. */
  getPermissionState(): Promise<unknown>;
  /** Called only from an explicit foreground permission action. */
  requestPermission(): Promise<unknown>;
  schedule(input: LocalNotificationInput): Promise<unknown>;
  cancel(ref: OwnedNotificationRef): Promise<unknown>;
  cancelMany(refs: readonly OwnedNotificationRef[]): Promise<unknown>;
  reconcile(identity: NotificationIdentity): Promise<unknown>;
  /** App-namespace marker inventory; partial results never imply cancellation. */
  listOwnedScheduledNotifications(): Promise<unknown>;
}

export type IntegrationProjectionContext = Readonly<{
  channel: IntegrationJobChannel;
  block: TimeBlock;
  task: Task | null;
  planRevision: number;
  /** Null means the user has not stored an override; host policy supplies its explicit default. */
  notificationLeadMinutes: number | null;
  now: Instant;
}>;

/**
 * All product choices about which block kinds/states are projected and when a
 * reminder fires are explicit here. The worker supplies no hidden defaults.
 */
export interface IntegrationProjectionPolicy {
  calendarProvisioning(provider: string): unknown;
  calendarEvent(context: IntegrationProjectionContext): unknown;
  notification(context: IntegrationProjectionContext): unknown;
}

export interface IntegrationInventoryPolicy {
  /** Must return a finite, bounded search range chosen by the host. */
  calendarRange(
    input: Readonly<{
      now: Instant;
      currentPlanRevision: number;
    }>,
  ): unknown;
}

export interface CalendarRefreshRangePolicy {
  /** The implementation must reject an unbounded or excessive query range. */
  allows(range: ScheduleTimeRange): boolean;
}

export interface IntegrationJobLeasePolicy {
  leaseExpiresAt(
    input: Readonly<{ claimedAt: Instant; channel: IntegrationJobChannel }>,
  ): Instant;
}

export interface IntegrationJobRetryPolicy {
  /** Must return a future Instant for failed/reconciliation-required work. */
  nextAttemptAt(
    input: Readonly<{
      job: IntegrationJob;
      status: 'failed' | 'reconciliation_required';
      finishedAt: Instant;
    }>,
  ): Instant;
}
