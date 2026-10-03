/**
 * A validated UTC instant. Scheduler inputs use canonical ISO-8601 strings and
 * never consult an ambient clock.
 */
export type Instant = string;

/** Audit identity of the algorithm implemented by this package build. */
export const SCHEDULER_VERSION = 'scheduler-core/1' as const;

export type TimeRange = Readonly<{
  start: Instant;
  end: Instant;
}>;

export type DurationState =
  | Readonly<{ state: 'known'; remainingMinutes: number }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'exhausted' }>;

export type DependencyState = 'none' | 'unsupported';

export type SchedulableTask = Readonly<{
  id: string;
  priority: string;
  duration: DurationState;
  earliestStart: Instant | null;
  deadline: Instant | null;
  splittable: boolean;
  minBlockMinutes: number | null;
  maxBlockMinutes: number | null;
  energyDemand: string | null;
  /** Opaque, versioned product policy key; the core assigns no hidden meaning. */
  schedulingPolicy: string;
  dependencyState: DependencyState;
}>;

export type BusyEvent = Readonly<{
  id: string;
  start: Instant;
  end: Instant;
}>;

export type TimeBlockType = 'task' | 'break' | 'relax' | 'buffer';
export type ExistingTimeBlockStatus =
  'planned' | 'started' | 'completed' | 'skipped' | 'canceled';

export type ExistingTimeBlock = Readonly<{
  id: string;
  taskId: string | null;
  type: TimeBlockType;
  start: Instant;
  end: Instant;
  status: ExistingTimeBlockStatus;
  locked: boolean;
}>;

/**
 * Working windows are expanded to validated UTC instants by the application
 * boundary. This makes DST gaps/folds explicit and keeps the core independent
 * from platform time-zone databases.
 */
export type WorkingWindow = Readonly<{
  id: string;
  start: Instant;
  end: Instant;
  energyLevel: string | null;
}>;

export type ScoredWindow = Readonly<{
  id: string;
  start: Instant;
  end: Instant;
  score: number;
}>;

export type SchedulingPreferences = Readonly<{
  workingWindows: readonly WorkingWindow[];
  preferredWindows: readonly ScoredWindow[];
}>;

export type SchedulingUserFeatures = Readonly<{
  completionRateWindows: readonly ScoredWindow[];
  recoveryPenaltyWindows: readonly ScoredWindow[];
}>;

export type EnergyMatchScore = Readonly<{
  demand: string;
  supply: string;
  score: number;
}>;

export type SchedulingScoreWeights = Readonly<{
  planStability: number;
  fragmentation: number;
  preferredHours: number;
  completionRate: number;
  energyMatch: number;
  recoveryPenalty: number;
}>;

/**
 * Every tunable strategy value is part of the versioned policy. Higher
 * priority rank means higher priority. Scores and weights are deliberately
 * unitless; product tuning belongs to the caller, not hidden core defaults.
 */
export type SchedulingPolicy = Readonly<{
  policyVersion: string;
  schedulerVersion: string;
  gridAnchor: Instant;
  granularityMinutes: number;
  defaultMinBlockMinutes: number;
  defaultMaxBlockMinutes: number;
  priorityRanks: Readonly<Record<string, number>>;
  energyMatchScores: readonly EnergyMatchScore[];
  defaultEnergyMatchScore: number;
  scoreWeights: SchedulingScoreWeights;
}>;

export type ScheduleInput = Readonly<{
  now: Instant;
  horizon: TimeRange;
  timeZone: string;
  tasks: readonly SchedulableTask[];
  busyEvents: readonly BusyEvent[];
  existingBlocks: readonly ExistingTimeBlock[];
  preferences: SchedulingPreferences;
  userModel: SchedulingUserFeatures;
  policy: SchedulingPolicy;
  reason: string;
}>;

export type ProposedBlockChangeReason =
  | 'protected_existing'
  | 'preserved_existing'
  | 'moved_existing'
  | 'resized_existing'
  | 'moved_and_resized_existing'
  | 'new_allocation';

export type ProposedTimeBlock = Readonly<{
  stableKey: string;
  existingBlockId: string | null;
  taskId: string | null;
  type: TimeBlockType;
  start: Instant;
  end: Instant;
  status: ExistingTimeBlockStatus;
  locked: boolean;
  changeReason: ProposedBlockChangeReason;
}>;

export type UnscheduledReasonCode =
  | 'missing_duration'
  | 'remaining_estimate_required'
  | 'insufficient_time'
  | 'deadline_infeasible'
  | 'unsupported_dependency';

export type UnscheduledTask = Readonly<{
  taskId: string;
  remainingMinutes?: number;
  reasonCode: UnscheduledReasonCode;
  message: string;
}>;

export type ScheduleWarningSeverity = 'info' | 'warning' | 'error';

export type ScheduleWarningCode =
  | 'protected_busy_conflict'
  | 'protected_block_conflict'
  | 'protected_outside_working_window'
  | 'protected_task_constraint_conflict'
  | 'protected_commitment_exceeds_remaining'
  | 'orphan_existing_block_preserved'
  | 'existing_block_omitted'
  | 'partial_schedule'
  | 'deadline_risk';

export type ScheduleWarning = Readonly<{
  entityType: 'schedule' | 'task' | 'block';
  entityId: string | null;
  code: ScheduleWarningCode;
  severity: ScheduleWarningSeverity;
  message: string;
}>;

export type ScheduleMetrics = Readonly<{
  taskCount: number;
  fullyScheduledTaskCount: number;
  partiallyScheduledTaskCount: number;
  generatedBlockCount: number;
  preservedBlockCount: number;
  generatedMinutes: number;
  protectedCommittedMinutes: number;
  knownUnscheduledMinutes: number;
  unknownUnscheduledTaskCount: number;
  conflictedTaskCount: number;
  warningCount: number;
}>;

export type ExplanationMetadata = Readonly<
  Record<string, string | number | boolean | null>
>;

export type ScheduleExplanationCode =
  | 'block_scheduled'
  | 'protected_block_preserved'
  | 'existing_block_not_proposed'
  | 'remaining_covered_by_protected_blocks'
  | 'task_effort_covered_with_conflicts'
  | 'task_fully_scheduled'
  | 'task_partially_scheduled'
  | 'task_unscheduled';

export type ScheduleExplanation = Readonly<{
  entityType: 'task' | 'block';
  entityId: string;
  code: ScheduleExplanationCode;
  message: string;
  metadata: ExplanationMetadata;
}>;

export type ScheduleResult = Readonly<{
  schedulerVersion: string;
  blocks: readonly ProposedTimeBlock[];
  unscheduled: readonly UnscheduledTask[];
  warnings: readonly ScheduleWarning[];
  metrics: ScheduleMetrics;
  explanations: readonly ScheduleExplanation[];
}>;
