import type {
  AgentRun,
  AgentRunId,
  Achievement,
  AchievementId,
  CalendarBinding,
  CalendarBindingId,
  CalendarContainerBinding,
  CalendarRefreshCoverage,
  CompletionRecord,
  CompletionRecordId,
  DailyReflection,
  DailyReflectionId,
  EnergyCheckIn,
  EnergyCheckInId,
  ExecutionInterval,
  ExecutionIntervalId,
  ExecutionSession,
  ExecutionSessionId,
  ExternalCalendarEventSnapshot,
  ExternalCalendarEventSnapshotId,
  ExternalMutationIntent,
  ExternalMutationIntentId,
  Goal,
  GoalId,
  Instant,
  IntegrationJob,
  IntegrationJobChannel,
  IntegrationJobId,
  LocalDate,
  NotificationBinding,
  NotificationBindingId,
  OperationId,
  OperationRecord,
  Project,
  ProjectId,
  RelaxSession,
  RelaxSessionId,
  ScheduleState,
  SchedulePlan,
  Task,
  TaskActivityEvent,
  TaskId,
  TimeBlock,
  TimeBlockId,
  TimeZoneId,
  UserPreference,
  UserModelFeature,
  UserModelFeatureId,
} from '@workspace/domain';

export interface Clock {
  /** Returns a canonical UTC Instant. Platform Date conversion stays adapter-side. */
  now(): Instant;
}

export type LocalTime = Readonly<{
  localDate: LocalDate;
  timeZone: TimeZoneId;
}>;

export interface LocalTimeProvider {
  /** Resolves the device-local date and IANA zone for one fixed instant. */
  resolve(instant: Instant): LocalTime;
}

export interface IdGenerator {
  /** Returns an opaque, locally unique identifier. */
  generate(): string;
}

/**
 * Runs application work against repositories bound to one local transaction.
 *
 * Implementations must commit only after `work` resolves and must roll back all
 * writes when it rejects. Repository objects passed to `work` must not escape
 * the callback.
 */
export interface UnitOfWork<TTransaction> {
  transaction<TResult>(
    work: (transaction: TTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface TaskRepository {
  findById(id: TaskId): Promise<Task | null>;
  /** All Task facts in deterministic pagination order. */
  listAll(): Promise<readonly Task[]>;
  /** Active scheduling candidates only; terminal facts remain queryable by ID. */
  listActive(): Promise<readonly Task[]>;
  insert(task: Task): Promise<void>;
  update(task: Task): Promise<void>;
  listByGoalId(goalId: GoalId): Promise<readonly Task[]>;
  listByProjectIds(projectIds: readonly ProjectId[]): Promise<readonly Task[]>;
  listByParentIds(parentIds: readonly TaskId[]): Promise<readonly Task[]>;
}

export interface AgentRunRepository {
  findById(id: AgentRunId): Promise<AgentRun | null>;
  listRunning(): Promise<readonly AgentRun[]>;
  insert(run: AgentRun): Promise<void>;
  update(run: AgentRun): Promise<void>;
}

export interface UserModelFeatureRepository {
  listAll(): Promise<readonly UserModelFeature[]>;
  listByAlgorithmVersion(
    algorithmVersion: string,
  ): Promise<readonly UserModelFeature[]>;
  replaceForAlgorithmVersion(
    algorithmVersion: string,
    features: readonly UserModelFeature[],
  ): Promise<void>;
  findById(id: UserModelFeatureId): Promise<UserModelFeature | null>;
}

export interface DailyReflectionRepository {
  findById(id: DailyReflectionId): Promise<DailyReflection | null>;
  findByLocalDay(
    localDate: LocalDate,
    timeZone: TimeZoneId,
  ): Promise<DailyReflection | null>;
  insert(reflection: DailyReflection): Promise<void>;
  update(reflection: DailyReflection): Promise<void>;
}

export interface EnergyCheckInRepository {
  findById(id: EnergyCheckInId): Promise<EnergyCheckIn | null>;
  findLatestByLocalDay(
    localDate: LocalDate,
    timeZone: TimeZoneId,
  ): Promise<EnergyCheckIn | null>;
  findLatestAtOrBefore(instant: Instant): Promise<EnergyCheckIn | null>;
  listByLocalDay(
    localDate: LocalDate,
    timeZone: TimeZoneId,
  ): Promise<readonly EnergyCheckIn[]>;
  insert(checkIn: EnergyCheckIn): Promise<void>;
}

export interface RelaxSessionRepository {
  findById(id: RelaxSessionId): Promise<RelaxSession | null>;
  findActive(): Promise<RelaxSession | null>;
  listStartedBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly RelaxSession[]>;
  insert(session: RelaxSession): Promise<void>;
  update(session: RelaxSession): Promise<void>;
}

export interface GoalRepository {
  findById(id: GoalId): Promise<Goal | null>;
  listAll(): Promise<readonly Goal[]>;
  insert(goal: Goal): Promise<void>;
  update(goal: Goal): Promise<void>;
}

export interface ProjectRepository {
  findById(id: ProjectId): Promise<Project | null>;
  listAll(): Promise<readonly Project[]>;
  insert(project: Project): Promise<void>;
  update(project: Project): Promise<void>;
  listByGoalId(goalId: GoalId): Promise<readonly Project[]>;
}

export interface CompletionRecordRepository {
  findById(id: CompletionRecordId): Promise<CompletionRecord | null>;
  findByTaskId(taskId: TaskId): Promise<CompletionRecord | null>;
  listCompletedBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly CompletionRecord[]>;
  insert(record: CompletionRecord): Promise<void>;
  update(record: CompletionRecord): Promise<void>;
}

export interface ExecutionSessionRepository {
  findById(id: ExecutionSessionId): Promise<ExecutionSession | null>;
  findActive(): Promise<ExecutionSession | null>;
  listByTaskId(taskId: TaskId): Promise<readonly ExecutionSession[]>;
  listEndedBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly ExecutionSession[]>;
  insert(session: ExecutionSession): Promise<void>;
  update(session: ExecutionSession): Promise<void>;
}

export interface ExecutionIntervalRepository {
  findById(id: ExecutionIntervalId): Promise<ExecutionInterval | null>;
  findOpenBySessionId(
    sessionId: ExecutionSessionId,
  ): Promise<ExecutionInterval | null>;
  listBySessionId(
    sessionId: ExecutionSessionId,
  ): Promise<readonly ExecutionInterval[]>;
  insert(interval: ExecutionInterval): Promise<void>;
  update(interval: ExecutionInterval): Promise<void>;
}

export interface AchievementRepository {
  findById(id: AchievementId): Promise<Achievement | null>;
  findByCompletionRecordId(id: CompletionRecordId): Promise<Achievement | null>;
  listOccurredBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly Achievement[]>;
  listAll(): Promise<readonly Achievement[]>;
  insert(achievement: Achievement): Promise<void>;
  update(achievement: Achievement): Promise<void>;
}

export interface TaskActivityEventRepository {
  listOccurredBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly TaskActivityEvent[]>;
  insert(event: TaskActivityEvent): Promise<void>;
}

export interface OperationRecordRepository {
  findById(operationId: OperationId): Promise<OperationRecord | null>;
  insert(record: OperationRecord): Promise<void>;
}

export interface ScheduleStateRepository {
  get(): Promise<ScheduleState | null>;
  update(state: ScheduleState): Promise<void>;
}

export interface TimeBlockRepository {
  findById(id: TimeBlockId): Promise<TimeBlock | null>;
  listAll(): Promise<readonly TimeBlock[]>;
  listOverlapping(start: Instant, end: Instant): Promise<readonly TimeBlock[]>;
  insert(block: TimeBlock): Promise<void>;
  update(block: TimeBlock): Promise<void>;
}

export interface SchedulePlanRepository {
  findByRevision(planRevision: number): Promise<SchedulePlan | null>;
  insert(plan: SchedulePlan): Promise<void>;
}

export interface IntegrationJobRepository {
  insert(job: IntegrationJob): Promise<void>;
  findById(id: IntegrationJobId): Promise<IntegrationJob | null>;
  findLatestByChannel(
    channel: IntegrationJobChannel,
  ): Promise<IntegrationJob | null>;
  listByOperationId(
    operationId: OperationId,
  ): Promise<readonly IntegrationJob[]>;
  /**
   * Atomically claims the next eligible job while fencing the whole channel.
   * A non-expired processing job blocks another claim for the same channel.
   */
  claimNext(
    input: ClaimNextIntegrationJobInput,
  ): Promise<IntegrationJobClaim | null>;
  /** Updates a claimed row only when token and attempt generation still match. */
  updateClaimed(
    job: IntegrationJob,
    fence: IntegrationJobClaimFence,
  ): Promise<boolean>;
  /** Foreground permission recovery; background workers never call this. */
  requeueBlockedChannel(
    input: RequeueBlockedIntegrationJobsInput,
  ): Promise<number>;
  /** Explicit foreground recovery for one non-processing blocked job. */
  requeueBlockedJob(input: RequeueBlockedIntegrationJobInput): Promise<boolean>;
  /**
   * Re-runs the latest safe terminal projection for the current plan after a
   * directly controlled user preference changes. Processing or uncertain jobs
   * are never stolen or reset by this operation.
   */
  requeueLatestProjection(
    input: RequeueLatestProjectionInput,
  ): Promise<boolean>;
}

export type ClaimNextIntegrationJobInput = Readonly<{
  channel: IntegrationJobChannel;
  claimToken: string;
  claimedAt: Instant;
  leaseExpiresAt: Instant;
}>;

export type IntegrationJobClaim = Readonly<{
  job: IntegrationJob;
  recoveredExpiredLease: boolean;
}>;

export type IntegrationJobClaimFence = Readonly<{
  expectedClaimToken: string;
  expectedAttemptCount: number;
}>;

export type RequeueBlockedIntegrationJobsInput = Readonly<{
  channel: IntegrationJobChannel;
  requeuedAt: Instant;
  notBefore: Instant;
}>;

export type RequeueBlockedIntegrationJobInput =
  RequeueBlockedIntegrationJobsInput & Readonly<{ jobId: IntegrationJobId }>;

export type RequeueLatestProjectionInput = Readonly<{
  channel: IntegrationJobChannel;
  desiredRevision: number;
  requeuedAt: Instant;
  notBefore: Instant;
}>;

export type CalendarSnapshotScope = Readonly<{
  provider: string;
  calendarId: string;
  rangeStart: Instant;
  rangeEnd: Instant;
}>;

export interface ExternalCalendarEventSnapshotRepository {
  listOverlapping(
    scope: CalendarSnapshotScope,
  ): Promise<readonly ExternalCalendarEventSnapshot[]>;
  upsert(snapshot: ExternalCalendarEventSnapshot): Promise<void>;
  deleteByIds(ids: readonly ExternalCalendarEventSnapshotId[]): Promise<void>;
}

export interface CalendarRefreshCoverageRepository {
  insert(coverage: CalendarRefreshCoverage): Promise<void>;
  findLatestCovering(
    scope: CalendarSnapshotScope,
  ): Promise<CalendarRefreshCoverage | null>;
}

export interface CalendarContainerBindingRepository {
  findByOwnership(
    provider: string,
    ownershipKey: string,
  ): Promise<CalendarContainerBinding | null>;
  upsert(binding: CalendarContainerBinding): Promise<void>;
}

export interface CalendarBindingRepository {
  findByTimeBlockId(timeBlockId: TimeBlockId): Promise<CalendarBinding | null>;
  listAll(): Promise<readonly CalendarBinding[]>;
  upsertIfNotNewer(binding: CalendarBinding): Promise<boolean>;
  deleteIfNotNewer(
    id: CalendarBindingId,
    expectedLastAppliedRevision: number,
  ): Promise<boolean>;
}

export interface NotificationBindingRepository {
  findByIdentity(
    timeBlockId: TimeBlockId,
    type: string,
  ): Promise<NotificationBinding | null>;
  listAll(): Promise<readonly NotificationBinding[]>;
  upsertIfNotNewer(binding: NotificationBinding): Promise<boolean>;
  deleteIfNotNewer(
    id: NotificationBindingId,
    expectedLastAppliedRevision: number,
  ): Promise<boolean>;
}

export interface ExternalMutationIntentRepository {
  /** At most one unresolved side effect may exist for one IntegrationJob. */
  findByJobId(jobId: IntegrationJobId): Promise<ExternalMutationIntent | null>;
  findByScopeKey(scopeKey: string): Promise<ExternalMutationIntent | null>;
  /** Ordered oldest-first so an earlier side effect cannot be starved by replans. */
  listByChannel(
    channel: IntegrationJobChannel,
  ): Promise<readonly ExternalMutationIntent[]>;
  /** Inserted and committed before the corresponding OS mutation is invoked. */
  insert(intent: ExternalMutationIntent): Promise<void>;
  /** Removed only with the verified Binding/checkpoint that resolves it. */
  deleteById(id: ExternalMutationIntentId): Promise<void>;
}

export interface UserPreferenceRepository {
  findByKey(key: string): Promise<UserPreference | null>;
  listByKeys(keys: readonly string[]): Promise<readonly UserPreference[]>;
  upsert(preference: UserPreference): Promise<void>;
}

/** Repositories sharing the same underlying SQLite transaction. */
export interface ApplicationTransaction {
  readonly agentRuns: AgentRunRepository;
  readonly userModelFeatures: UserModelFeatureRepository;
  readonly dailyReflections: DailyReflectionRepository;
  readonly energyCheckIns: EnergyCheckInRepository;
  readonly relaxSessions: RelaxSessionRepository;
  readonly tasks: TaskRepository;
  readonly goals: GoalRepository;
  readonly projects: ProjectRepository;
  readonly completionRecords: CompletionRecordRepository;
  readonly executionSessions: ExecutionSessionRepository;
  readonly executionIntervals: ExecutionIntervalRepository;
  readonly achievements: AchievementRepository;
  readonly taskActivityEvents: TaskActivityEventRepository;
  readonly operationRecords: OperationRecordRepository;
  readonly scheduleState: ScheduleStateRepository;
  readonly timeBlocks: TimeBlockRepository;
  readonly schedulePlans: SchedulePlanRepository;
  readonly integrationJobs: IntegrationJobRepository;
  readonly externalCalendarEventSnapshots: ExternalCalendarEventSnapshotRepository;
  readonly calendarRefreshCoverages: CalendarRefreshCoverageRepository;
  readonly calendarContainerBindings: CalendarContainerBindingRepository;
  readonly calendarBindings: CalendarBindingRepository;
  readonly notificationBindings: NotificationBindingRepository;
  readonly externalMutationIntents: ExternalMutationIntentRepository;
  readonly userPreferences: UserPreferenceRepository;
}

export type ApplicationUnitOfWork = UnitOfWork<ApplicationTransaction>;

export type ApplicationAuthority =
  | Readonly<{ kind: 'user' }>
  | Readonly<{ kind: 'agent_authorized'; authorizationId: string }>
  | Readonly<{ kind: 'system'; reason: string }>;

/** This context is created by the host; tool/model input must not construct it. */
export type WriteContext = Readonly<{
  operationId: string;
  authority: ApplicationAuthority;
}>;
