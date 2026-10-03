import type {
  Instant,
  EnergyCheckIn,
  OperationId,
  ScheduleState,
  Task,
  TaskId,
  TimeBlock,
  TimeZoneId,
  UserModelFeature,
} from '@workspace/domain';
import type {
  BusyEvent,
  ScoredWindow,
  SchedulingPolicy,
  SchedulingUserFeatures,
  TimeRange,
  WorkingWindow,
} from '@workspace/scheduler-core';

export type ScheduleTimeRange = Readonly<{
  start: Instant;
  end: Instant;
}>;

export type ScheduleSnapshotRequest = Readonly<{
  reason: string;
  taskIds: readonly TaskId[] | null;
  requestedTimeRange: ScheduleTimeRange | null;
  now: Instant;
}>;

export type BusySnapshot = Readonly<{
  /** When the locally cached busy facts were last refreshed. */
  capturedAt: Instant | null;
  completeness: 'complete' | 'partial' | 'missing' | 'not_configured';
  scopes: readonly BusySnapshotScope[];
  events: readonly BusyEvent[];
}>;

export type BusySnapshotScope = Readonly<{
  provider: string;
  calendarId: string;
  capturedAt: Instant | null;
  completeness: 'complete' | 'partial' | 'missing';
}>;

export type SchedulingWorkingHoursRule = Readonly<{
  id: string;
  weekdays: readonly (1 | 2 | 3 | 4 | 5 | 6 | 7)[];
  startLocalTime: string;
  endLocalTime: string;
  energyLevel?: string | null;
  startDisambiguation?: 'earlier' | 'later';
  endDisambiguation?: 'earlier' | 'later';
}>;

/**
 * One consistent, finite scheduling input snapshot.
 *
 * `tasks` may honor the requested focus IDs, but busy facts and protected
 * blocks must never be filtered by those IDs. Every requested Task ID must be
 * represented (including a terminal Task); omission is treated as not-found,
 * not as a successful empty schedule. Working windows are already expanded
 * into UTC instants by a time-zone capable adapter.
 */
export type SchedulingSnapshot = Readonly<{
  scheduleState: ScheduleState;
  horizon: TimeRange;
  timeZone: TimeZoneId;
  tasks: readonly Task[];
  timeBlocks: readonly TimeBlock[];
  busy: BusySnapshot;
  workingWindows: readonly WorkingWindow[];
  preferredWindows: readonly ScoredWindow[];
  userModel: SchedulingUserFeatures;
  /** Explicit, versioned policy. Application code supplies no hidden tuning. */
  policy: SchedulingPolicy;
}>;

export interface SchedulingSnapshotPort {
  capture(request: ScheduleSnapshotRequest): Promise<SchedulingSnapshot>;
}

/** Lower-level port useful when composing a SchedulingSnapshotPort. */
export interface BusySnapshotPort {
  readBusy(range: ScheduleTimeRange): Promise<BusySnapshot>;
}

/** Lower-level port that performs local-time/DST expansion outside pure core. */
export interface UtcWorkingWindowPort {
  listUtcWorkingWindows(
    range: ScheduleTimeRange,
    timeZone: TimeZoneId,
    rules: readonly SchedulingWorkingHoursRule[],
  ): Promise<readonly WorkingWindow[]>;
}

export interface ScheduleHorizonPolicy {
  defaultHorizon(
    input: Readonly<{
      now: Instant;
      timeZone: TimeZoneId;
    }>,
  ): Promise<ScheduleTimeRange>;
}

export type SchedulingPolicyInput = Readonly<{
  now: Instant;
  horizon: ScheduleTimeRange;
  timeZone: TimeZoneId;
  tasks: readonly Task[];
  personalizationEnabled: boolean;
  userModelFeatures: readonly UserModelFeature[];
  latestEnergyCheckIn: EnergyCheckIn | null;
}>;

export type SchedulingPolicySnapshot = Readonly<{
  preferredWindows: readonly ScoredWindow[];
  userModel: SchedulingUserFeatures;
  policy: SchedulingPolicy;
}>;

/** Explicit product policy boundary; no scheduler tuning is hidden in storage. */
export interface SchedulingInputPolicyPort {
  snapshot(input: SchedulingPolicyInput): Promise<SchedulingPolicySnapshot>;
}

export type PreviewExpirationContext = Readonly<{
  createdAt: Instant;
  horizon: ScheduleTimeRange;
  earliestChangedBlockStart: Instant | null;
}>;

/** Product TTL is explicit/injected; the service still applies canonical caps. */
export interface PreviewExpirationPolicy {
  expirationFor(context: PreviewExpirationContext): Instant;
}

/**
 * Best-effort signal sent only after a local commit. It must not perform local
 * business writes; durable IntegrationJobs remain the recovery source.
 */
export interface IntegrationJobWakeupPort {
  wake(operationId: OperationId): Promise<void>;
}
