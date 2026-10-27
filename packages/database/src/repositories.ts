import { captureCloudTransaction } from './cloud-sync-store';
import {
  ApplicationError,
  type AgentRunRepository,
  type ApplicationTransaction,
  type ApplicationUnitOfWork,
  type AchievementRepository,
  type CalendarBindingRepository,
  type CalendarContainerBindingRepository,
  type CalendarRefreshCoverageRepository,
  type CalendarSnapshotScope,
  type ClaimNextIntegrationJobInput,
  type CompletionRecordRepository,
  type DailyReflectionRepository,
  type EnergyCheckInRepository,
  type ExecutionIntervalRepository,
  type ExecutionSessionRepository,
  type ExternalCalendarEventSnapshotRepository,
  type ExternalMutationIntentRepository,
  type GoalRepository,
  type IntegrationJobRepository,
  type IntegrationJobClaim,
  type IntegrationJobClaimFence,
  type NotificationBindingRepository,
  type RequeueBlockedIntegrationJobInput,
  type RequeueBlockedIntegrationJobsInput,
  type RequeueLatestProjectionInput,
  type OperationRecordRepository,
  type ProjectRepository,
  type RelaxSessionRepository,
  type SchedulePlanRepository,
  type ScheduleStateRepository,
  type TaskActivityEventRepository,
  type TaskRepository,
  type TimeBlockRepository,
  type UserModelFeatureRepository,
  type UserPreferenceRepository,
} from '@workspace/application';
import {
  assertValidAgentRun,
  assertValidCompletionRecord,
  assertValidDailyReflection,
  assertValidEnergyCheckIn,
  assertValidAchievement,
  assertValidCalendarBinding,
  assertValidCalendarContainerBinding,
  assertValidCalendarRefreshCoverage,
  assertValidExternalCalendarEventSnapshot,
  assertValidExternalMutationIntent,
  assertValidExecutionInterval,
  assertValidExecutionSession,
  assertValidGoal,
  assertValidIntegrationJob,
  assertValidNotificationBinding,
  assertValidOperationRecord,
  assertValidProject,
  assertValidRelaxSession,
  assertValidSchedulePlan,
  assertValidTask,
  assertValidTaskActivityEvent,
  assertValidTimeBlock,
  assertValidUserPreference,
  assertValidUserModelFeature,
  claimIntegrationJob,
  createScheduleState,
  createTaskActivityEvent,
  isDomainError,
  parseCompletionRecordId,
  parseDailyReflectionId,
  parseEnergyCheckInId,
  parseAchievementId,
  parseAgentRunId,
  parseCalendarBindingId,
  parseCalendarContainerBindingId,
  parseCalendarRefreshCoverageId,
  parseExecutionSessionId,
  parseExecutionIntervalId,
  parseGoalId,
  parseInstant,
  parseExternalCalendarEventSnapshotId,
  parseExternalMutationIntentId,
  parseIntegrationJobId,
  parseLocalDate,
  parseOperationId,
  parseProjectId,
  parseRelaxSessionId,
  parseNotificationBindingId,
  parseSchedulePlanId,
  parseTaskId,
  parseTaskActivityEventId,
  parseTimeBlockId,
  parseTimeZoneId,
  parseUserPreferenceId,
  parseUserModelFeatureId,
  normalizePreferenceJson,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type CalendarBinding,
  type AgentRun,
  type CalendarBindingId,
  type CalendarContainerBinding,
  type CalendarRefreshCoverage,
  type CompletionRecord,
  type Achievement,
  type AchievementId,
  type CompletionRecordId,
  type DailyReflection,
  type DailyReflectionId,
  type EnergyCheckIn,
  type EnergyCheckInId,
  type ExecutionInterval,
  type ExecutionSession,
  type ExecutionSessionId,
  type ExternalCalendarEventSnapshot,
  type ExternalCalendarEventSnapshotId,
  type ExternalMutationIntent,
  type ExternalMutationIntentId,
  type Goal,
  type GoalId,
  type IntegrationJob,
  type IntegrationJobChannel,
  type IntegrationJobId,
  type Instant,
  type LocalDate,
  type NotificationBinding,
  type NotificationBindingId,
  type OperationId,
  type OperationRecord,
  type Project,
  type ProjectId,
  type RelaxSession,
  type RelaxSessionId,
  type SchedulePlan,
  type ScheduleState,
  type Task,
  type TaskActivityEvent,
  type TaskId,
  type TimeBlock,
  type TimeBlockId,
  type TimeZoneId,
  type UserPreference,
  type UserModelFeature,
} from '@workspace/domain';

import { migrateDatabase, type MigrationOptions } from './migrator';
import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteParameters,
  SqliteRunResult,
} from './sqlite';

const taskColumns = `
  id, project_id, goal_id, parent_task_id, title, description, status,
  priority, estimated_duration_minutes, baseline_estimated_duration_minutes,
  actual_duration_minutes, remaining_duration_minutes, category_key,
  earliest_start_at, deadline_at, deadline_local_date, deadline_time_zone,
  splittable, min_block_minutes, max_block_minutes, energy_demand,
  scheduling_policy, source, created_at, updated_at, completed_at, canceled_at
`;

const goalColumns = `
  id, title, description, status, target_date, created_at, updated_at,
  archived_at
`;

const projectColumns = `
  id, goal_id, title, description, status, deadline, created_at, updated_at,
  archived_at
`;

const completionRecordColumns = `
  id, task_id, source_session_id, operation_id, completed_at,
  task_title_snapshot, actual_duration_seconds, duration_coverage,
  achievement_disposition, source
`;

const executionSessionColumns = `
  id, task_id, time_block_id, started_at, ended_at,
  paused_duration_seconds, active_interval_started_at, paused_at, status,
  completion_type, created_at, updated_at
`;

const executionIntervalColumns = `
  id, session_id, kind, start_at, end_at, timing_quality
`;

const achievementColumns = `
  id, source_completion_record_id, source_task_id,
  source_execution_session_id, title, summary, evidence_type, occurred_at,
  user_edited, hidden, created_at, updated_at
`;

const operationRecordColumns = `
  operation_id, command_name, parameter_hash, result_json,
  base_state_version, current_state_version, occurred_at, diff_json
`;

const timeBlockColumns = `
  id, task_id, type, start_at, end_at, status, source, locked,
  plan_revision, external_calendar_event_id, created_at, updated_at
`;

const schedulePlanColumns = `
  id, plan_revision, based_on_state_version, status, created_at, committed_at,
  input_hash, scheduler_version, policy_version, time_zone, horizon_start,
  horizon_end, reason
`;

const integrationJobColumns = `
  id, operation_id, target_channel, target_entity_type, target_entity_id,
  desired_revision, desired_action, status, attempt_count, last_error_code,
  automatic_retry_eligible, claim_token, lease_expires_at, not_before,
  created_at, updated_at
`;

const externalCalendarEventSnapshotColumns = `
  id, provider, calendar_id, external_event_id, occurrence_key, start_at,
  end_at, busy, last_seen_at, content_hash
`;

const calendarRefreshCoverageColumns = `
  id, provider, calendar_id, range_start, range_end, fetched_at,
  completeness, observed_event_count
`;

const calendarContainerBindingColumns = `
  id, provider, calendar_id, ownership_key, ownership_verified, status,
  verified_at, created_at, updated_at
`;

const calendarBindingColumns = `
  id, time_block_id, provider, calendar_id, external_event_id, occurrence_key,
  ownership_key, ownership_verified, applied_content_hash, applied_start_at,
  applied_end_at, last_applied_revision, status, verified_at, created_at,
  updated_at
`;

const notificationBindingColumns = `
  id, time_block_id, task_id, os_notification_id, type, applied_content_hash,
  scheduled_at, desired_revision, last_applied_revision, status,
  identity_verified, verified_at, created_at, updated_at
`;

const externalMutationIntentColumns = `
  external_mutation_intents.id,
  external_mutation_intents.integration_job_id,
  external_mutation_intents.desired_revision,
  external_mutation_intents.scope_key,
  external_mutation_intents.action,
  external_mutation_intents.payload_json,
  external_mutation_intents.created_at,
  external_mutation_intents.updated_at
`;

const userPreferenceColumns = `id, key, value_json, updated_at`;

const userModelFeatureColumns = `
  id, feature_key, scope_key, numeric_value, window_start, window_end,
  source_state_version, sample_count, confidence, algorithm_version,
  last_updated_at
`;

const dailyReflectionColumns = `
  id, local_date, time_zone, summary, wins_json, adjustment_suggestion,
  user_note, generated_by, created_at, updated_at
`;

const energyCheckInColumns = `
  id, local_date, time_zone, level, note, created_at
`;

const relaxSessionColumns = `
  id, type, planned_minutes, actual_seconds, started_at, ended_at, source,
  status, timing_quality, created_at
`;

const taskActivityEventColumns = `
  id, task_id, time_block_id, event_type, actor, occurred_at, local_date,
  time_zone, operation_id, before_summary, after_summary
`;

const sqliteQueryChunkSize = 400;

export type DatabaseRepositoryErrorCode = 'corrupt_row' | 'row_not_found';

export class DatabaseRepositoryError extends Error {
  readonly code: DatabaseRepositoryErrorCode;
  readonly entity: string;

  constructor(
    code: DatabaseRepositoryErrorCode,
    entity: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'DatabaseRepositoryError';
    this.code = code;
    this.entity = entity;
  }
}

interface GoalRow {
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly description: string;
  readonly id: string;
  readonly status: string;
  readonly target_date: string | null;
  readonly title: string;
  readonly updated_at: string;
}

interface AgentRunRow {
  readonly ended_at: string | null;
  readonly error_code: string | null;
  readonly id: string;
  readonly model_provider: string | null;
  readonly started_at: string;
  readonly status: string;
  readonly trigger: string;
  readonly turn_count: number;
}

interface ProjectRow {
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly deadline: string | null;
  readonly description: string;
  readonly goal_id: string | null;
  readonly id: string;
  readonly status: string;
  readonly title: string;
  readonly updated_at: string;
}

interface TaskRow {
  readonly actual_duration_minutes: number | null;
  readonly baseline_estimated_duration_minutes: number | null;
  readonly canceled_at: string | null;
  readonly category_key: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly deadline_at: string | null;
  readonly deadline_local_date: string | null;
  readonly deadline_time_zone: string | null;
  readonly description: string | null;
  readonly earliest_start_at: string | null;
  readonly energy_demand: string | null;
  readonly estimated_duration_minutes: number | null;
  readonly goal_id: string | null;
  readonly id: string;
  readonly max_block_minutes: number | null;
  readonly min_block_minutes: number | null;
  readonly parent_task_id: string | null;
  readonly priority: string;
  readonly project_id: string | null;
  readonly remaining_duration_minutes: number | null;
  readonly scheduling_policy: string;
  readonly source: string;
  readonly splittable: number;
  readonly status: string;
  readonly title: string;
  readonly updated_at: string;
}

interface CompletionRecordRow {
  readonly achievement_disposition: string;
  readonly actual_duration_seconds: number | null;
  readonly completed_at: string;
  readonly duration_coverage: string;
  readonly id: string;
  readonly operation_id: string;
  readonly source: string;
  readonly source_session_id: string | null;
  readonly task_id: string;
  readonly task_title_snapshot: string;
}

interface ExecutionSessionRow {
  readonly active_interval_started_at: string | null;
  readonly completion_type: string | null;
  readonly created_at: string;
  readonly ended_at: string | null;
  readonly id: string;
  readonly paused_at: string | null;
  readonly paused_duration_seconds: number;
  readonly started_at: string;
  readonly status: string;
  readonly task_id: string;
  readonly time_block_id: string | null;
  readonly updated_at: string;
}

interface ExecutionIntervalRow {
  readonly end_at: string | null;
  readonly id: string;
  readonly kind: string;
  readonly session_id: string;
  readonly start_at: string;
  readonly timing_quality: string;
}

interface AchievementRow {
  readonly created_at: string;
  readonly evidence_type: string;
  readonly hidden: number;
  readonly id: string;
  readonly occurred_at: string;
  readonly source_completion_record_id: string;
  readonly source_execution_session_id: string | null;
  readonly source_task_id: string;
  readonly summary: string | null;
  readonly title: string;
  readonly updated_at: string;
  readonly user_edited: number;
}

interface OperationRecordRow {
  readonly base_state_version: number | null;
  readonly command_name: string;
  readonly current_state_version: number;
  readonly diff_json: string | null;
  readonly occurred_at: string;
  readonly operation_id: string;
  readonly parameter_hash: string;
  readonly result_json: string;
}

interface ScheduleStateRow {
  readonly plan_revision: number;
  readonly state_version: number;
}

interface TimeBlockRow {
  readonly created_at: string;
  readonly end_at: string;
  readonly external_calendar_event_id: string | null;
  readonly id: string;
  readonly locked: number;
  readonly plan_revision: number;
  readonly source: string;
  readonly start_at: string;
  readonly status: string;
  readonly task_id: string | null;
  readonly type: string;
  readonly updated_at: string;
}

interface SchedulePlanRow {
  readonly based_on_state_version: number;
  readonly committed_at: string;
  readonly created_at: string;
  readonly horizon_end: string;
  readonly horizon_start: string;
  readonly id: string;
  readonly input_hash: string;
  readonly plan_revision: number;
  readonly policy_version: string;
  readonly reason: string;
  readonly scheduler_version: string;
  readonly status: string;
  readonly time_zone: string;
}

interface IntegrationJobRow {
  readonly automatic_retry_eligible: number;
  readonly attempt_count: number;
  readonly created_at: string;
  readonly desired_action: string;
  readonly desired_revision: number;
  readonly id: string;
  readonly last_error_code: string | null;
  readonly claim_token: string | null;
  readonly lease_expires_at: string | null;
  readonly not_before: string;
  readonly operation_id: string;
  readonly status: string;
  readonly target_channel: string;
  readonly target_entity_id: string;
  readonly target_entity_type: string;
  readonly updated_at: string;
}

interface ExternalCalendarEventSnapshotRow {
  readonly busy: number;
  readonly calendar_id: string;
  readonly content_hash: string;
  readonly end_at: string;
  readonly external_event_id: string;
  readonly id: string;
  readonly last_seen_at: string;
  readonly occurrence_key: string | null;
  readonly provider: string;
  readonly start_at: string;
}

interface CalendarRefreshCoverageRow {
  readonly calendar_id: string;
  readonly completeness: string;
  readonly fetched_at: string;
  readonly id: string;
  readonly observed_event_count: number;
  readonly provider: string;
  readonly range_end: string;
  readonly range_start: string;
}

interface CalendarContainerBindingRow {
  readonly calendar_id: string;
  readonly created_at: string;
  readonly id: string;
  readonly ownership_key: string;
  readonly ownership_verified: number;
  readonly provider: string;
  readonly status: string;
  readonly updated_at: string;
  readonly verified_at: string;
}

interface CalendarBindingRow {
  readonly applied_content_hash: string;
  readonly applied_end_at: string;
  readonly applied_start_at: string;
  readonly calendar_id: string;
  readonly created_at: string;
  readonly external_event_id: string;
  readonly id: string;
  readonly last_applied_revision: number;
  readonly occurrence_key: string | null;
  readonly ownership_key: string;
  readonly ownership_verified: number;
  readonly provider: string;
  readonly status: string;
  readonly time_block_id: string;
  readonly updated_at: string;
  readonly verified_at: string;
}

interface NotificationBindingRow {
  readonly applied_content_hash: string;
  readonly created_at: string;
  readonly desired_revision: number;
  readonly id: string;
  readonly identity_verified: number;
  readonly last_applied_revision: number;
  readonly os_notification_id: string;
  readonly scheduled_at: string;
  readonly status: string;
  readonly task_id: string | null;
  readonly time_block_id: string;
  readonly type: string;
  readonly updated_at: string;
  readonly verified_at: string;
}

interface ExternalMutationIntentRow {
  readonly action: string;
  readonly created_at: string;
  readonly desired_revision: number;
  readonly id: string;
  readonly integration_job_id: string;
  readonly payload_json: string;
  readonly scope_key: string;
  readonly updated_at: string;
}

interface UserPreferenceRow {
  readonly id: string;
  readonly key: string;
  readonly value_json: string;
  readonly updated_at: string;
}

interface UserModelFeatureRow {
  readonly algorithm_version: string;
  readonly confidence: number;
  readonly feature_key: string;
  readonly id: string;
  readonly last_updated_at: string;
  readonly numeric_value: number;
  readonly sample_count: number;
  readonly scope_key: string;
  readonly source_state_version: number;
  readonly window_end: string;
  readonly window_start: string;
}

interface DailyReflectionRow {
  readonly adjustment_suggestion: string | null;
  readonly created_at: string;
  readonly generated_by: string;
  readonly id: string;
  readonly local_date: string;
  readonly summary: string;
  readonly time_zone: string;
  readonly updated_at: string;
  readonly user_note: string | null;
  readonly wins_json: string;
}

interface EnergyCheckInRow {
  readonly created_at: string;
  readonly id: string;
  readonly level: number;
  readonly local_date: string;
  readonly note: string | null;
  readonly time_zone: string;
}

interface RelaxSessionRow {
  readonly actual_seconds: number | null;
  readonly created_at: string;
  readonly ended_at: string | null;
  readonly id: string;
  readonly planned_minutes: number;
  readonly source: string;
  readonly started_at: string;
  readonly status: string;
  readonly timing_quality: string;
  readonly type: string;
}

interface TaskActivityEventRow {
  readonly actor: string;
  readonly after_summary: string | null;
  readonly before_summary: string | null;
  readonly event_type: string;
  readonly id: string;
  readonly local_date: string;
  readonly occurred_at: string;
  readonly operation_id: string;
  readonly task_id: string;
  readonly time_block_id: string | null;
  readonly time_zone: string;
}

function nullable<Value, MappedValue>(
  value: Value | null,
  map: (present: Value) => MappedValue,
): MappedValue | null {
  return value === null ? null : map(value);
}

function rehydrateStored<TEntity>(entity: string, map: () => TEntity): TEntity {
  try {
    return map();
  } catch (cause) {
    if (!isDomainError(cause) && !(cause instanceof DatabaseRepositoryError)) {
      throw cause;
    }

    throw new ApplicationError(
      'adapter_error',
      `Stored ${entity} data failed integrity validation.`,
      {
        retryable: false,
        causeCategory: 'data_integrity',
      },
    );
  }
}

function mapGoal(row: GoalRow): Goal {
  return rehydrateStored('Goal', () => {
    const goal: Goal = {
      id: parseGoalId(row.id),
      title: row.title,
      description: row.description,
      status: row.status,
      targetDate: nullable(row.target_date, parseLocalDate),
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
      archivedAt: nullable(row.archived_at, parseInstant),
    };
    assertValidGoal(goal);
    return goal;
  });
}

function mapAgentRun(row: AgentRunRow): AgentRun {
  return rehydrateStored('AgentRun', () => {
    const run: AgentRun = {
      id: parseAgentRunId(row.id),
      startedAt: parseInstant(row.started_at),
      endedAt: nullable(row.ended_at, parseInstant),
      status: row.status as AgentRun['status'],
      trigger: row.trigger as AgentRun['trigger'],
      modelProvider: row.model_provider,
      turnCount: requireNonNegativeInteger(row.turn_count, 'turnCount'),
      errorCode: row.error_code,
    };
    assertValidAgentRun(run);
    return run;
  });
}

function mapProject(row: ProjectRow): Project {
  return rehydrateStored('Project', () => {
    const project: Project = {
      id: parseProjectId(row.id),
      goalId: nullable(row.goal_id, parseGoalId),
      title: row.title,
      description: row.description,
      status: row.status,
      deadline: nullable(row.deadline, parseInstant),
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
      archivedAt: nullable(row.archived_at, parseInstant),
    };
    assertValidProject(project);
    return project;
  });
}

function mapSqliteBoolean(
  value: number,
  field: string,
  entity = 'Task',
): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new DatabaseRepositoryError(
    'corrupt_row',
    entity,
    `Stored ${field} is not a SQLite boolean.`,
  );
}

function mapTask(row: TaskRow): Task {
  return rehydrateStored('Task', () => {
    const task: Task = {
      id: parseTaskId(row.id),
      projectId: nullable(row.project_id, parseProjectId),
      goalId: nullable(row.goal_id, parseGoalId),
      parentTaskId: nullable(row.parent_task_id, parseTaskId),
      title: row.title,
      description: row.description,
      status: row.status as Task['status'],
      priority: row.priority,
      estimatedDurationMinutes: row.estimated_duration_minutes,
      baselineEstimatedDurationMinutes: row.baseline_estimated_duration_minutes,
      actualDurationMinutes: row.actual_duration_minutes,
      remainingDurationMinutes: row.remaining_duration_minutes,
      categoryKey: row.category_key,
      earliestStartAt: nullable(row.earliest_start_at, parseInstant),
      deadlineAt: nullable(row.deadline_at, parseInstant),
      deadlineLocalDate: nullable(row.deadline_local_date, parseLocalDate),
      deadlineTimeZone: nullable(row.deadline_time_zone, parseTimeZoneId),
      splittable: mapSqliteBoolean(row.splittable, 'splittable'),
      minBlockMinutes: row.min_block_minutes,
      maxBlockMinutes: row.max_block_minutes,
      energyDemand: row.energy_demand,
      schedulingPolicy: row.scheduling_policy,
      source: row.source,
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
      completedAt: nullable(row.completed_at, parseInstant),
      canceledAt: nullable(row.canceled_at, parseInstant),
    };
    assertValidTask(task);
    return task;
  });
}

function mapCompletionRecord(row: CompletionRecordRow): CompletionRecord {
  return rehydrateStored('CompletionRecord', () => {
    const record: CompletionRecord = {
      id: parseCompletionRecordId(row.id),
      taskId: parseTaskId(row.task_id),
      sourceSessionId: nullable(row.source_session_id, parseExecutionSessionId),
      operationId: parseOperationId(row.operation_id),
      completedAt: parseInstant(row.completed_at),
      taskTitleSnapshot: row.task_title_snapshot,
      actualDurationSeconds: row.actual_duration_seconds,
      durationCoverage:
        row.duration_coverage as CompletionRecord['durationCoverage'],
      achievementDisposition:
        row.achievement_disposition as CompletionRecord['achievementDisposition'],
      source: row.source as CompletionRecord['source'],
    };
    assertValidCompletionRecord(record);
    return record;
  });
}

function mapExecutionSession(row: ExecutionSessionRow): ExecutionSession {
  return rehydrateStored('ExecutionSession', () => {
    const session: ExecutionSession = {
      id: parseExecutionSessionId(row.id),
      taskId: parseTaskId(row.task_id),
      timeBlockId: nullable(row.time_block_id, parseTimeBlockId),
      startedAt: parseInstant(row.started_at),
      endedAt: nullable(row.ended_at, parseInstant),
      pausedDurationSeconds: row.paused_duration_seconds,
      activeIntervalStartedAt: nullable(
        row.active_interval_started_at,
        parseInstant,
      ),
      pausedAt: nullable(row.paused_at, parseInstant),
      status: row.status as ExecutionSession['status'],
      completionType: row.completion_type as ExecutionSession['completionType'],
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidExecutionSession(session);
    return session;
  });
}

function mapExecutionInterval(row: ExecutionIntervalRow): ExecutionInterval {
  return rehydrateStored('ExecutionInterval', () => {
    const interval: ExecutionInterval = {
      id: parseExecutionIntervalId(row.id),
      sessionId: parseExecutionSessionId(row.session_id),
      kind: row.kind as ExecutionInterval['kind'],
      startAt: parseInstant(row.start_at),
      endAt: nullable(row.end_at, parseInstant),
      timingQuality: row.timing_quality as ExecutionInterval['timingQuality'],
    };
    assertValidExecutionInterval(interval);
    return interval;
  });
}

function mapAchievement(row: AchievementRow): Achievement {
  return rehydrateStored('Achievement', () => {
    const achievement: Achievement = {
      id: parseAchievementId(row.id),
      sourceCompletionRecordId: parseCompletionRecordId(
        row.source_completion_record_id,
      ),
      sourceTaskId: parseTaskId(row.source_task_id),
      sourceExecutionSessionId: nullable(
        row.source_execution_session_id,
        parseExecutionSessionId,
      ),
      title: row.title,
      summary: row.summary,
      evidenceType: row.evidence_type,
      occurredAt: parseInstant(row.occurred_at),
      userEdited: mapSqliteBoolean(
        row.user_edited,
        'userEdited',
        'Achievement',
      ),
      hidden: mapSqliteBoolean(row.hidden, 'hidden', 'Achievement'),
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidAchievement(achievement);
    return achievement;
  });
}

function mapOperationRecord(row: OperationRecordRow): OperationRecord {
  return rehydrateStored('OperationRecord', () => {
    const record: OperationRecord = {
      operationId: parseOperationId(row.operation_id),
      command: row.command_name,
      parameterHash: row.parameter_hash,
      resultJson: row.result_json,
      baseStateVersion: row.base_state_version,
      currentStateVersion: row.current_state_version,
      occurredAt: parseInstant(row.occurred_at),
      diffJson: row.diff_json,
    };
    assertValidOperationRecord(record);
    return record;
  });
}

function mapTimeBlock(row: TimeBlockRow): TimeBlock {
  return rehydrateStored('TimeBlock', () => {
    const block: TimeBlock = {
      id: parseTimeBlockId(row.id),
      taskId: nullable(row.task_id, parseTaskId),
      type: row.type as TimeBlock['type'],
      startAt: parseInstant(row.start_at),
      endAt: parseInstant(row.end_at),
      status: row.status as TimeBlock['status'],
      source: row.source,
      locked: mapSqliteBoolean(row.locked, 'locked', 'TimeBlock'),
      planRevision: row.plan_revision,
      externalCalendarEventId: row.external_calendar_event_id,
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidTimeBlock(block);
    return block;
  });
}

function mapSchedulePlan(row: SchedulePlanRow): SchedulePlan {
  return rehydrateStored('SchedulePlan', () => {
    const plan: SchedulePlan = {
      id: parseSchedulePlanId(row.id),
      planRevision: row.plan_revision,
      basedOnStateVersion: row.based_on_state_version,
      status: row.status as SchedulePlan['status'],
      createdAt: parseInstant(row.created_at),
      committedAt: parseInstant(row.committed_at),
      inputHash: row.input_hash,
      schedulerVersion: row.scheduler_version,
      policyVersion: row.policy_version,
      timeZone: parseTimeZoneId(row.time_zone),
      horizonStart: parseInstant(row.horizon_start),
      horizonEnd: parseInstant(row.horizon_end),
      reason: row.reason,
    };
    assertValidSchedulePlan(plan);
    return plan;
  });
}

function mapIntegrationJob(row: IntegrationJobRow): IntegrationJob {
  return rehydrateStored('IntegrationJob', () => {
    const job: IntegrationJob = {
      id: parseIntegrationJobId(row.id),
      operationId: parseOperationId(row.operation_id),
      targetChannel: row.target_channel as IntegrationJob['targetChannel'],
      targetEntityType:
        row.target_entity_type as IntegrationJob['targetEntityType'],
      targetEntityId: parseSchedulePlanId(row.target_entity_id),
      desiredRevision: row.desired_revision,
      desiredAction: row.desired_action as IntegrationJob['desiredAction'],
      status: row.status as IntegrationJob['status'],
      attemptCount: row.attempt_count,
      lastErrorCode: row.last_error_code,
      automaticRetryEligible: mapSqliteBoolean(
        row.automatic_retry_eligible,
        'automaticRetryEligible',
        'IntegrationJob',
      ),
      claimToken: row.claim_token,
      leaseExpiresAt: nullable(row.lease_expires_at, parseInstant),
      notBefore: parseInstant(row.not_before),
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidIntegrationJob(job);
    return job;
  });
}

function mapExternalCalendarEventSnapshot(
  row: ExternalCalendarEventSnapshotRow,
): ExternalCalendarEventSnapshot {
  return rehydrateStored('ExternalCalendarEventSnapshot', () => {
    const snapshot: ExternalCalendarEventSnapshot = {
      id: parseExternalCalendarEventSnapshotId(row.id),
      provider: row.provider,
      calendarId: row.calendar_id,
      externalEventId: row.external_event_id,
      occurrenceKey: row.occurrence_key,
      startAt: parseInstant(row.start_at),
      endAt: parseInstant(row.end_at),
      busy: mapSqliteBoolean(row.busy, 'busy', 'ExternalCalendarEventSnapshot'),
      lastSeenAt: parseInstant(row.last_seen_at),
      contentHash: row.content_hash,
    };
    assertValidExternalCalendarEventSnapshot(snapshot);
    return snapshot;
  });
}

function mapCalendarRefreshCoverage(
  row: CalendarRefreshCoverageRow,
): CalendarRefreshCoverage {
  return rehydrateStored('CalendarRefreshCoverage', () => {
    const coverage: CalendarRefreshCoverage = {
      id: parseCalendarRefreshCoverageId(row.id),
      provider: row.provider,
      calendarId: row.calendar_id,
      rangeStart: parseInstant(row.range_start),
      rangeEnd: parseInstant(row.range_end),
      fetchedAt: parseInstant(row.fetched_at),
      completeness: row.completeness as CalendarRefreshCoverage['completeness'],
      observedEventCount: row.observed_event_count,
    };
    assertValidCalendarRefreshCoverage(coverage);
    return coverage;
  });
}

function mapCalendarContainerBinding(
  row: CalendarContainerBindingRow,
): CalendarContainerBinding {
  return rehydrateStored('CalendarContainerBinding', () => {
    const binding: CalendarContainerBinding = {
      id: parseCalendarContainerBindingId(row.id),
      provider: row.provider,
      calendarId: row.calendar_id,
      ownershipKey: row.ownership_key,
      ownershipVerified: mapSqliteBoolean(
        row.ownership_verified,
        'ownershipVerified',
        'CalendarContainerBinding',
      ) as true,
      status: row.status as CalendarContainerBinding['status'],
      verifiedAt: parseInstant(row.verified_at),
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidCalendarContainerBinding(binding);
    return binding;
  });
}

function mapCalendarBinding(row: CalendarBindingRow): CalendarBinding {
  return rehydrateStored('CalendarBinding', () => {
    const binding: CalendarBinding = {
      id: parseCalendarBindingId(row.id),
      timeBlockId: parseTimeBlockId(row.time_block_id),
      provider: row.provider,
      calendarId: row.calendar_id,
      externalEventId: row.external_event_id,
      occurrenceKey: row.occurrence_key,
      ownershipKey: row.ownership_key,
      ownershipVerified: mapSqliteBoolean(
        row.ownership_verified,
        'ownershipVerified',
        'CalendarBinding',
      ) as true,
      appliedContentHash: row.applied_content_hash,
      appliedStartAt: parseInstant(row.applied_start_at),
      appliedEndAt: parseInstant(row.applied_end_at),
      lastAppliedRevision: row.last_applied_revision,
      status: row.status as CalendarBinding['status'],
      verifiedAt: parseInstant(row.verified_at),
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidCalendarBinding(binding);
    return binding;
  });
}

function mapNotificationBinding(
  row: NotificationBindingRow,
): NotificationBinding {
  return rehydrateStored('NotificationBinding', () => {
    const binding: NotificationBinding = {
      id: parseNotificationBindingId(row.id),
      timeBlockId: parseTimeBlockId(row.time_block_id),
      taskId: nullable(row.task_id, parseTaskId),
      osNotificationId: row.os_notification_id,
      type: row.type,
      appliedContentHash: row.applied_content_hash,
      scheduledAt: parseInstant(row.scheduled_at),
      desiredRevision: row.desired_revision,
      lastAppliedRevision: row.last_applied_revision,
      status: row.status as NotificationBinding['status'],
      identityVerified: mapSqliteBoolean(
        row.identity_verified,
        'identityVerified',
        'NotificationBinding',
      ) as true,
      verifiedAt: parseInstant(row.verified_at),
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidNotificationBinding(binding);
    return binding;
  });
}

const externalMutationPayloadKeys = {
  calendar_provision: ['existingCalendarId', 'ownershipKey', 'provider'],
  calendar_event_create: [
    'calendarId',
    'desiredContentHash',
    'desiredEndAt',
    'desiredStartAt',
    'expectedContentHash',
    'externalEventId',
    'occurrenceKey',
    'ownershipKey',
    'provider',
    'searchEndAt',
    'searchStartAt',
    'timeBlockId',
  ],
  calendar_event_update: [
    'calendarId',
    'desiredContentHash',
    'desiredEndAt',
    'desiredStartAt',
    'expectedContentHash',
    'externalEventId',
    'occurrenceKey',
    'ownershipKey',
    'provider',
    'searchEndAt',
    'searchStartAt',
    'timeBlockId',
  ],
  calendar_event_delete: [
    'calendarId',
    'desiredContentHash',
    'desiredEndAt',
    'desiredStartAt',
    'expectedContentHash',
    'externalEventId',
    'occurrenceKey',
    'ownershipKey',
    'provider',
    'searchEndAt',
    'searchStartAt',
    'timeBlockId',
  ],
  notification_schedule: [
    'desiredContentHash',
    'desiredScheduledAt',
    'expectedContentHash',
    'osNotificationId',
    'timeBlockId',
    'type',
  ],
  notification_cancel: [
    'desiredContentHash',
    'desiredScheduledAt',
    'expectedContentHash',
    'osNotificationId',
    'timeBlockId',
    'type',
  ],
} as const satisfies Readonly<
  Record<ExternalMutationIntent['action'], readonly string[]>
>;

function assertExternalMutationPayloadShape(
  action: ExternalMutationIntent['action'],
  payload: ExternalMutationIntent['payload'],
): void {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new DatabaseRepositoryError(
      'corrupt_row',
      'ExternalMutationIntent',
      'External mutation payload must be an object.',
    );
  }
  const actualKeys = Object.keys(payload).sort();
  const expectedKeys = [...externalMutationPayloadKeys[action]].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new DatabaseRepositoryError(
      'corrupt_row',
      'ExternalMutationIntent',
      'External mutation payload fields do not match its action.',
    );
  }
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  throw new DatabaseRepositoryError(
    'corrupt_row',
    'ExternalMutationIntent',
    'External mutation payload is not JSON serializable.',
  );
}

function mapExternalMutationIntent(
  row: ExternalMutationIntentRow,
): ExternalMutationIntent {
  return rehydrateStored('ExternalMutationIntent', () => {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(row.payload_json);
    } catch {
      throw new DatabaseRepositoryError(
        'corrupt_row',
        'ExternalMutationIntent',
        'External mutation payload is not valid JSON.',
      );
    }
    const intent: ExternalMutationIntent = {
      id: parseExternalMutationIntentId(row.id),
      integrationJobId: parseIntegrationJobId(row.integration_job_id),
      desiredRevision: row.desired_revision,
      scopeKey: row.scope_key,
      action: row.action as ExternalMutationIntent['action'],
      payload: parsedPayload as ExternalMutationIntent['payload'],
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidExternalMutationIntent(intent);
    assertExternalMutationPayloadShape(intent.action, intent.payload);
    return intent;
  });
}

function mapUserPreference(row: UserPreferenceRow): UserPreference {
  return rehydrateStored('UserPreference', () => {
    let valueJson: unknown;
    try {
      valueJson = JSON.parse(row.value_json);
    } catch {
      throw new DatabaseRepositoryError(
        'corrupt_row',
        'UserPreference',
        'UserPreference value_json is not valid JSON.',
      );
    }
    const preference: UserPreference = {
      id: parseUserPreferenceId(row.id),
      key: requireNonEmptyString(row.key, 'key'),
      valueJson: normalizePreferenceJson(valueJson),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidUserPreference(preference);
    return preference;
  });
}

function mapUserModelFeature(row: UserModelFeatureRow): UserModelFeature {
  return rehydrateStored('UserModelFeature', () => {
    const feature: UserModelFeature = {
      id: parseUserModelFeatureId(row.id),
      featureKey: row.feature_key,
      scopeKey: row.scope_key === '' ? null : row.scope_key,
      numericValue: row.numeric_value,
      windowStart: parseInstant(row.window_start),
      windowEnd: parseInstant(row.window_end),
      sourceStateVersion: row.source_state_version,
      sampleCount: row.sample_count,
      confidence: row.confidence,
      algorithmVersion: row.algorithm_version,
      lastUpdatedAt: parseInstant(row.last_updated_at),
    };
    assertValidUserModelFeature(feature);
    return feature;
  });
}

function mapDailyReflection(row: DailyReflectionRow): DailyReflection {
  return rehydrateStored('DailyReflection', () => {
    let wins: DailyReflection['wins'];
    try {
      wins = JSON.parse(row.wins_json) as DailyReflection['wins'];
    } catch {
      throw new DatabaseRepositoryError(
        'corrupt_row',
        'DailyReflection',
        'DailyReflection wins_json is not valid JSON.',
      );
    }
    const reflection: DailyReflection = {
      id: parseDailyReflectionId(row.id),
      localDate: parseLocalDate(row.local_date),
      timeZone: parseTimeZoneId(row.time_zone),
      summary: row.summary,
      wins,
      adjustmentSuggestion: row.adjustment_suggestion,
      userNote: row.user_note,
      generatedBy: row.generated_by as DailyReflection['generatedBy'],
      createdAt: parseInstant(row.created_at),
      updatedAt: parseInstant(row.updated_at),
    };
    assertValidDailyReflection(reflection);
    return reflection;
  });
}

function mapEnergyCheckIn(row: EnergyCheckInRow): EnergyCheckIn {
  return rehydrateStored('EnergyCheckIn', () => {
    const checkIn: EnergyCheckIn = {
      id: parseEnergyCheckInId(row.id),
      localDate: parseLocalDate(row.local_date),
      timeZone: parseTimeZoneId(row.time_zone),
      level: row.level as EnergyCheckIn['level'],
      note: row.note,
      createdAt: parseInstant(row.created_at),
    };
    assertValidEnergyCheckIn(checkIn);
    return checkIn;
  });
}

function mapRelaxSession(row: RelaxSessionRow): RelaxSession {
  return rehydrateStored('RelaxSession', () => {
    const session: RelaxSession = {
      id: parseRelaxSessionId(row.id),
      type: row.type as RelaxSession['type'],
      plannedMinutes: row.planned_minutes,
      actualSeconds: row.actual_seconds,
      startedAt: parseInstant(row.started_at),
      endedAt: nullable(row.ended_at, parseInstant),
      source: row.source as RelaxSession['source'],
      status: row.status as RelaxSession['status'],
      timingQuality: row.timing_quality as RelaxSession['timingQuality'],
      createdAt: parseInstant(row.created_at),
    };
    assertValidRelaxSession(session);
    return session;
  });
}

function parseActivitySummary(
  json: string | null,
  field: string,
): TaskActivityEvent['beforeSummary'] {
  if (json === null) return null;
  try {
    return JSON.parse(json) as TaskActivityEvent['beforeSummary'];
  } catch {
    throw new DatabaseRepositoryError(
      'corrupt_row',
      'TaskActivityEvent',
      `TaskActivityEvent ${field} is not valid JSON.`,
    );
  }
}

function mapTaskActivityEvent(row: TaskActivityEventRow): TaskActivityEvent {
  return rehydrateStored('TaskActivityEvent', () =>
    createTaskActivityEvent({
      id: parseTaskActivityEventId(row.id),
      taskId: parseTaskId(row.task_id),
      timeBlockId: nullable(row.time_block_id, parseTimeBlockId),
      eventType: row.event_type,
      actor: row.actor,
      occurredAt: parseInstant(row.occurred_at),
      localDate: parseLocalDate(row.local_date),
      timeZone: parseTimeZoneId(row.time_zone),
      operationId: parseOperationId(row.operation_id),
      beforeSummary: parseActivitySummary(row.before_summary, 'before_summary'),
      afterSummary: parseActivitySummary(row.after_summary, 'after_summary'),
    }),
  );
}

function ensureOneRow(result: SqliteRunResult, entity: string): void {
  if (result.changes !== 1) {
    throw new DatabaseRepositoryError(
      'row_not_found',
      entity,
      `The ${entity} row to update does not exist.`,
    );
  }
}

const agentRunColumns = `
  id, started_at, ended_at, status, trigger, model_provider, turn_count,
  error_code
`;

class SqliteAgentRunRepository implements AgentRunRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: AgentRun['id']): Promise<AgentRun | null> {
    const row = await this.database.get<AgentRunRow>(
      `SELECT ${agentRunColumns} FROM agent_runs WHERE id = ?`,
      [id],
    );
    return row ? mapAgentRun(row) : null;
  }

  async listRunning(): Promise<readonly AgentRun[]> {
    const rows = await this.database.all<AgentRunRow>(
      `SELECT ${agentRunColumns}
       FROM agent_runs
       WHERE status = 'running'
       ORDER BY started_at, id`,
    );
    return rows.map(mapAgentRun);
  }

  async insert(run: AgentRun): Promise<void> {
    assertValidAgentRun(run);
    await this.database.run(
      `INSERT INTO agent_runs (
        id, started_at, ended_at, status, trigger, model_provider, turn_count,
        error_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.startedAt,
        run.endedAt,
        run.status,
        run.trigger,
        run.modelProvider,
        run.turnCount,
        run.errorCode,
      ],
    );
  }

  async update(run: AgentRun): Promise<void> {
    assertValidAgentRun(run);
    const result = await this.database.run(
      `UPDATE agent_runs SET
        started_at = ?, ended_at = ?, status = ?, trigger = ?,
        model_provider = ?, turn_count = ?, error_code = ?
       WHERE id = ?`,
      [
        run.startedAt,
        run.endedAt,
        run.status,
        run.trigger,
        run.modelProvider,
        run.turnCount,
        run.errorCode,
        run.id,
      ],
    );
    ensureOneRow(result, 'AgentRun');
  }
}

class SqliteUserModelFeatureRepository implements UserModelFeatureRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: UserModelFeature['id']): Promise<UserModelFeature | null> {
    const row = await this.database.get<UserModelFeatureRow>(
      `SELECT ${userModelFeatureColumns}
       FROM user_model_features WHERE id = ?`,
      [id],
    );
    return row ? mapUserModelFeature(row) : null;
  }

  async listAll(): Promise<readonly UserModelFeature[]> {
    const rows = await this.database.all<UserModelFeatureRow>(
      `SELECT ${userModelFeatureColumns}
       FROM user_model_features
       ORDER BY algorithm_version, feature_key, scope_key, id`,
    );
    return rows.map(mapUserModelFeature);
  }

  async listByAlgorithmVersion(
    algorithmVersion: string,
  ): Promise<readonly UserModelFeature[]> {
    const version = requireNonEmptyString(algorithmVersion, 'algorithmVersion');
    const rows = await this.database.all<UserModelFeatureRow>(
      `SELECT ${userModelFeatureColumns}
       FROM user_model_features
       WHERE algorithm_version = ?
       ORDER BY feature_key, scope_key, id`,
      [version],
    );
    return rows.map(mapUserModelFeature);
  }

  async replaceForAlgorithmVersion(
    algorithmVersion: string,
    features: readonly UserModelFeature[],
  ): Promise<void> {
    const version = requireNonEmptyString(algorithmVersion, 'algorithmVersion');
    const identities = new Set<string>();
    for (const feature of features) {
      assertValidUserModelFeature(feature);
      if (feature.algorithmVersion !== version) {
        throw new DatabaseRepositoryError(
          'corrupt_row',
          'UserModelFeature',
          'Replacement features must use the requested algorithm version.',
        );
      }
      const identity = JSON.stringify([feature.featureKey, feature.scopeKey]);
      if (identities.has(identity)) {
        throw new DatabaseRepositoryError(
          'corrupt_row',
          'UserModelFeature',
          'Replacement features contain a duplicate identity.',
        );
      }
      identities.add(identity);
    }
    await this.database.run(
      `DELETE FROM user_model_features WHERE algorithm_version = ?`,
      [version],
    );
    for (const feature of features) {
      await this.database.run(
        `INSERT INTO user_model_features (
          id, feature_key, scope_key, numeric_value, window_start, window_end,
          source_state_version, sample_count, confidence, algorithm_version,
          last_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          feature.id,
          feature.featureKey,
          feature.scopeKey ?? '',
          feature.numericValue,
          feature.windowStart,
          feature.windowEnd,
          feature.sourceStateVersion,
          feature.sampleCount,
          feature.confidence,
          feature.algorithmVersion,
          feature.lastUpdatedAt,
        ],
      );
    }
  }
}

class SqliteDailyReflectionRepository implements DailyReflectionRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: DailyReflectionId): Promise<DailyReflection | null> {
    const row = await this.database.get<DailyReflectionRow>(
      `SELECT ${dailyReflectionColumns}
       FROM daily_reflections WHERE id = ?`,
      [parseDailyReflectionId(id)],
    );
    return row ? mapDailyReflection(row) : null;
  }

  async findByLocalDay(
    localDate: LocalDate,
    timeZone: TimeZoneId,
  ): Promise<DailyReflection | null> {
    const row = await this.database.get<DailyReflectionRow>(
      `SELECT ${dailyReflectionColumns}
       FROM daily_reflections
       WHERE local_date = ? AND time_zone = ?`,
      [parseLocalDate(localDate), parseTimeZoneId(timeZone)],
    );
    return row ? mapDailyReflection(row) : null;
  }

  async insert(reflection: DailyReflection): Promise<void> {
    assertValidDailyReflection(reflection);
    await this.database.run(
      `INSERT INTO daily_reflections (
        id, local_date, time_zone, summary, wins_json,
        adjustment_suggestion, user_note, generated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      dailyReflectionParameters(reflection),
    );
  }

  async update(reflection: DailyReflection): Promise<void> {
    assertValidDailyReflection(reflection);
    const result = await this.database.run(
      `UPDATE daily_reflections SET
        local_date = ?, time_zone = ?, summary = ?, wins_json = ?,
        adjustment_suggestion = ?, user_note = ?, generated_by = ?,
        created_at = ?, updated_at = ?
       WHERE id = ?`,
      [...dailyReflectionParameters(reflection).slice(1), reflection.id],
    );
    ensureOneRow(result, 'DailyReflection');
  }
}

function dailyReflectionParameters(
  reflection: DailyReflection,
): SqliteParameters {
  return [
    reflection.id,
    reflection.localDate,
    reflection.timeZone,
    reflection.summary,
    canonicalJson(reflection.wins),
    reflection.adjustmentSuggestion,
    reflection.userNote,
    reflection.generatedBy,
    reflection.createdAt,
    reflection.updatedAt,
  ];
}

class SqliteEnergyCheckInRepository implements EnergyCheckInRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: EnergyCheckInId): Promise<EnergyCheckIn | null> {
    const row = await this.database.get<EnergyCheckInRow>(
      `SELECT ${energyCheckInColumns}
       FROM energy_check_ins WHERE id = ?`,
      [parseEnergyCheckInId(id)],
    );
    return row ? mapEnergyCheckIn(row) : null;
  }

  async findLatestByLocalDay(
    localDate: LocalDate,
    timeZone: TimeZoneId,
  ): Promise<EnergyCheckIn | null> {
    const row = await this.database.get<EnergyCheckInRow>(
      `SELECT ${energyCheckInColumns}
       FROM energy_check_ins
       WHERE local_date = ? AND time_zone = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [parseLocalDate(localDate), parseTimeZoneId(timeZone)],
    );
    return row ? mapEnergyCheckIn(row) : null;
  }

  async findLatestAtOrBefore(instant: Instant): Promise<EnergyCheckIn | null> {
    const row = await this.database.get<EnergyCheckInRow>(
      `SELECT ${energyCheckInColumns}
       FROM energy_check_ins
       WHERE created_at <= ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [parseInstant(instant)],
    );
    return row ? mapEnergyCheckIn(row) : null;
  }

  async listByLocalDay(
    localDate: LocalDate,
    timeZone: TimeZoneId,
  ): Promise<readonly EnergyCheckIn[]> {
    const rows = await this.database.all<EnergyCheckInRow>(
      `SELECT ${energyCheckInColumns}
       FROM energy_check_ins
       WHERE local_date = ? AND time_zone = ?
       ORDER BY created_at DESC, id DESC`,
      [parseLocalDate(localDate), parseTimeZoneId(timeZone)],
    );
    return rows.map(mapEnergyCheckIn);
  }

  async insert(checkIn: EnergyCheckIn): Promise<void> {
    assertValidEnergyCheckIn(checkIn);
    await this.database.run(
      `INSERT INTO energy_check_ins (
        id, local_date, time_zone, level, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        checkIn.id,
        checkIn.localDate,
        checkIn.timeZone,
        checkIn.level,
        checkIn.note,
        checkIn.createdAt,
      ],
    );
  }
}

class SqliteRelaxSessionRepository implements RelaxSessionRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: RelaxSessionId): Promise<RelaxSession | null> {
    const row = await this.database.get<RelaxSessionRow>(
      `SELECT ${relaxSessionColumns}
       FROM relax_sessions WHERE id = ?`,
      [parseRelaxSessionId(id)],
    );
    return row ? mapRelaxSession(row) : null;
  }

  async findActive(): Promise<RelaxSession | null> {
    const row = await this.database.get<RelaxSessionRow>(
      `SELECT ${relaxSessionColumns}
       FROM relax_sessions
       WHERE status = 'active'
       ORDER BY started_at, id
       LIMIT 1`,
    );
    return row ? mapRelaxSession(row) : null;
  }

  async listStartedBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly RelaxSession[]> {
    const rangeStart = parseInstant(start);
    const rangeEnd = parseInstant(end);
    const rows = await this.database.all<RelaxSessionRow>(
      `SELECT ${relaxSessionColumns}
       FROM relax_sessions
       WHERE started_at >= ? AND started_at < ?
       ORDER BY started_at DESC, id`,
      [rangeStart, rangeEnd],
    );
    return rows.map(mapRelaxSession);
  }

  async insert(session: RelaxSession): Promise<void> {
    assertValidRelaxSession(session);
    await this.database.run(
      `INSERT INTO relax_sessions (
        id, type, planned_minutes, actual_seconds, started_at, ended_at,
        source, status, timing_quality, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      relaxSessionParameters(session),
    );
  }

  async update(session: RelaxSession): Promise<void> {
    assertValidRelaxSession(session);
    const result = await this.database.run(
      `UPDATE relax_sessions SET
        type = ?, planned_minutes = ?, actual_seconds = ?, started_at = ?,
        ended_at = ?, source = ?, status = ?, timing_quality = ?, created_at = ?
       WHERE id = ?`,
      [...relaxSessionParameters(session).slice(1), session.id],
    );
    ensureOneRow(result, 'RelaxSession');
  }
}

function relaxSessionParameters(session: RelaxSession): SqliteParameters {
  return [
    session.id,
    session.type,
    session.plannedMinutes,
    session.actualSeconds,
    session.startedAt,
    session.endedAt,
    session.source,
    session.status,
    session.timingQuality,
    session.createdAt,
  ];
}

class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: TaskId): Promise<Task | null> {
    const row = await this.database.get<TaskRow>(
      `SELECT ${taskColumns} FROM tasks WHERE id = ?`,
      [id],
    );
    return row ? mapTask(row) : null;
  }

  async listAll(): Promise<readonly Task[]> {
    const rows = await this.database.all<TaskRow>(
      `SELECT ${taskColumns}
       FROM tasks
       ORDER BY deadline_at IS NULL, deadline_at, created_at, id`,
    );
    return rows.map(mapTask);
  }

  async listActive(): Promise<readonly Task[]> {
    const rows = await this.database.all<TaskRow>(
      `SELECT ${taskColumns}
       FROM tasks
       WHERE status NOT IN ('completed', 'canceled')
       ORDER BY deadline_at IS NULL, deadline_at, created_at, id`,
    );
    return rows.map(mapTask);
  }

  async insert(task: Task): Promise<void> {
    assertValidTask(task);
    await this.database.run(
      `INSERT INTO tasks (
        id, project_id, goal_id, parent_task_id, title, description, status,
        priority, estimated_duration_minutes,
        baseline_estimated_duration_minutes, actual_duration_minutes,
        remaining_duration_minutes, category_key, earliest_start_at,
        deadline_at, deadline_local_date, deadline_time_zone, splittable,
        min_block_minutes, max_block_minutes, energy_demand,
        scheduling_policy, source, created_at, updated_at, completed_at,
        canceled_at
      ) VALUES (${Array.from({ length: 27 }, () => '?').join(', ')})`,
      taskParameters(task),
    );
  }

  async update(task: Task): Promise<void> {
    assertValidTask(task);
    const parameters = taskParameters(task);
    const result = await this.database.run(
      `UPDATE tasks SET
        project_id = ?, goal_id = ?, parent_task_id = ?, title = ?,
        description = ?, status = ?, priority = ?,
        estimated_duration_minutes = ?, baseline_estimated_duration_minutes = ?,
        actual_duration_minutes = ?, remaining_duration_minutes = ?,
        category_key = ?, earliest_start_at = ?, deadline_at = ?,
        deadline_local_date = ?, deadline_time_zone = ?, splittable = ?,
        min_block_minutes = ?, max_block_minutes = ?, energy_demand = ?,
        scheduling_policy = ?, source = ?, created_at = ?, updated_at = ?,
        completed_at = ?, canceled_at = ?
       WHERE id = ?`,
      [...parameters.slice(1), task.id],
    );
    ensureOneRow(result, 'Task');
  }

  async listByGoalId(goalId: GoalId): Promise<readonly Task[]> {
    const rows = await this.database.all<TaskRow>(
      `SELECT ${taskColumns} FROM tasks
       WHERE goal_id = ? ORDER BY created_at, id`,
      [goalId],
    );
    return rows.map(mapTask);
  }

  async listByProjectIds(
    projectIds: readonly ProjectId[],
  ): Promise<readonly Task[]> {
    return this.listByIds('project_id', projectIds);
  }

  async listByParentIds(
    parentIds: readonly TaskId[],
  ): Promise<readonly Task[]> {
    return this.listByIds('parent_task_id', parentIds);
  }

  private async listByIds(
    column: 'parent_task_id' | 'project_id',
    ids: readonly string[],
  ): Promise<readonly Task[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];

    const tasks: Task[] = [];
    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += sqliteQueryChunkSize
    ) {
      const chunk = uniqueIds.slice(offset, offset + sqliteQueryChunkSize);
      const rows = await this.database.all<TaskRow>(
        `SELECT ${taskColumns} FROM tasks
         WHERE ${column} IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      );
      tasks.push(...rows.map(mapTask));
    }

    return tasks.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  }
}

function taskParameters(task: Task): SqliteParameters {
  return [
    task.id,
    task.projectId,
    task.goalId,
    task.parentTaskId,
    task.title,
    task.description,
    task.status,
    task.priority,
    task.estimatedDurationMinutes,
    task.baselineEstimatedDurationMinutes,
    task.actualDurationMinutes,
    task.remainingDurationMinutes,
    task.categoryKey,
    task.earliestStartAt,
    task.deadlineAt,
    task.deadlineLocalDate,
    task.deadlineTimeZone,
    task.splittable ? 1 : 0,
    task.minBlockMinutes,
    task.maxBlockMinutes,
    task.energyDemand,
    task.schedulingPolicy,
    task.source,
    task.createdAt,
    task.updatedAt,
    task.completedAt,
    task.canceledAt,
  ];
}

class SqliteGoalRepository implements GoalRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: GoalId): Promise<Goal | null> {
    const row = await this.database.get<GoalRow>(
      `SELECT ${goalColumns} FROM goals WHERE id = ?`,
      [id],
    );
    return row ? mapGoal(row) : null;
  }

  async listAll(): Promise<readonly Goal[]> {
    const rows = await this.database.all<GoalRow>(
      `SELECT ${goalColumns} FROM goals ORDER BY created_at, id`,
    );
    return rows.map(mapGoal);
  }

  async insert(goal: Goal): Promise<void> {
    assertValidGoal(goal);
    await this.database.run(
      `INSERT INTO goals (
        id, title, description, status, target_date, created_at, updated_at,
        archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      goalParameters(goal),
    );
  }

  async update(goal: Goal): Promise<void> {
    assertValidGoal(goal);
    const result = await this.database.run(
      `UPDATE goals SET title = ?, description = ?, status = ?,
        target_date = ?, created_at = ?, updated_at = ?, archived_at = ?
       WHERE id = ?`,
      [...goalParameters(goal).slice(1), goal.id],
    );
    ensureOneRow(result, 'Goal');
  }
}

function goalParameters(goal: Goal): SqliteParameters {
  return [
    goal.id,
    goal.title,
    goal.description,
    goal.status,
    goal.targetDate,
    goal.createdAt,
    goal.updatedAt,
    goal.archivedAt,
  ];
}

class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: ProjectId): Promise<Project | null> {
    const row = await this.database.get<ProjectRow>(
      `SELECT ${projectColumns} FROM projects WHERE id = ?`,
      [id],
    );
    return row ? mapProject(row) : null;
  }

  async listAll(): Promise<readonly Project[]> {
    const rows = await this.database.all<ProjectRow>(
      `SELECT ${projectColumns} FROM projects ORDER BY created_at, id`,
    );
    return rows.map(mapProject);
  }

  async insert(project: Project): Promise<void> {
    assertValidProject(project);
    await this.database.run(
      `INSERT INTO projects (
        id, goal_id, title, description, status, deadline, created_at,
        updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectParameters(project),
    );
  }

  async update(project: Project): Promise<void> {
    assertValidProject(project);
    const result = await this.database.run(
      `UPDATE projects SET goal_id = ?, title = ?, description = ?,
        status = ?, deadline = ?, created_at = ?, updated_at = ?,
        archived_at = ? WHERE id = ?`,
      [...projectParameters(project).slice(1), project.id],
    );
    ensureOneRow(result, 'Project');
  }

  async listByGoalId(goalId: GoalId): Promise<readonly Project[]> {
    const rows = await this.database.all<ProjectRow>(
      `SELECT ${projectColumns} FROM projects
       WHERE goal_id = ? ORDER BY created_at, id`,
      [goalId],
    );
    return rows.map(mapProject);
  }
}

function projectParameters(project: Project): SqliteParameters {
  return [
    project.id,
    project.goalId,
    project.title,
    project.description,
    project.status,
    project.deadline,
    project.createdAt,
    project.updatedAt,
    project.archivedAt,
  ];
}

class SqliteCompletionRecordRepository implements CompletionRecordRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: CompletionRecordId): Promise<CompletionRecord | null> {
    const row = await this.database.get<CompletionRecordRow>(
      `SELECT ${completionRecordColumns}
       FROM completion_records WHERE id = ?`,
      [id],
    );
    return row ? mapCompletionRecord(row) : null;
  }

  async findByTaskId(taskId: TaskId): Promise<CompletionRecord | null> {
    const row = await this.database.get<CompletionRecordRow>(
      `SELECT ${completionRecordColumns}
       FROM completion_records WHERE task_id = ?`,
      [taskId],
    );
    return row ? mapCompletionRecord(row) : null;
  }

  async listCompletedBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly CompletionRecord[]> {
    const rangeStart = parseInstant(start);
    const rangeEnd = parseInstant(end);
    if (Date.parse(rangeEnd) <= Date.parse(rangeStart)) {
      throw new ApplicationError(
        'validation_error',
        'Completion query range must be non-empty.',
        { retryable: false },
      );
    }
    const rows = await this.database.all<CompletionRecordRow>(
      `SELECT ${completionRecordColumns}
       FROM completion_records
       WHERE completed_at >= ? AND completed_at < ?
       ORDER BY completed_at, id`,
      [rangeStart, rangeEnd],
    );
    return rows.map(mapCompletionRecord);
  }

  async insert(record: CompletionRecord): Promise<void> {
    assertValidCompletionRecord(record);
    await this.database.run(
      `INSERT INTO completion_records (
        id, task_id, source_session_id, operation_id, completed_at,
        task_title_snapshot, actual_duration_seconds, duration_coverage,
        achievement_disposition, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.taskId,
        record.sourceSessionId,
        record.operationId,
        record.completedAt,
        record.taskTitleSnapshot,
        record.actualDurationSeconds,
        record.durationCoverage,
        record.achievementDisposition,
        record.source,
      ],
    );
  }

  async update(record: CompletionRecord): Promise<void> {
    assertValidCompletionRecord(record);
    const result = await this.database.run(
      `UPDATE completion_records SET
        task_id = ?, source_session_id = ?, operation_id = ?,
        completed_at = ?, task_title_snapshot = ?,
        actual_duration_seconds = ?, duration_coverage = ?,
        achievement_disposition = ?, source = ?
       WHERE id = ?`,
      [
        record.taskId,
        record.sourceSessionId,
        record.operationId,
        record.completedAt,
        record.taskTitleSnapshot,
        record.actualDurationSeconds,
        record.durationCoverage,
        record.achievementDisposition,
        record.source,
        record.id,
      ],
    );
    ensureOneRow(result, 'CompletionRecord');
  }
}

class SqliteExecutionSessionRepository implements ExecutionSessionRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: ExecutionSessionId): Promise<ExecutionSession | null> {
    const row = await this.database.get<ExecutionSessionRow>(
      `SELECT ${executionSessionColumns}
       FROM execution_sessions WHERE id = ?`,
      [id],
    );
    return row ? mapExecutionSession(row) : null;
  }

  async findActive(): Promise<ExecutionSession | null> {
    const rows = await this.database.all<ExecutionSessionRow>(
      `SELECT ${executionSessionColumns}
       FROM execution_sessions
       WHERE status IN ('running', 'paused')
       ORDER BY started_at, id
       LIMIT 2`,
    );
    if (rows.length > 1) {
      throw new ApplicationError(
        'adapter_error',
        'Stored ExecutionSession data has more than one active session.',
        { retryable: false, causeCategory: 'data_integrity' },
      );
    }
    return rows[0] ? mapExecutionSession(rows[0]) : null;
  }

  async listByTaskId(taskId: TaskId): Promise<readonly ExecutionSession[]> {
    const rows = await this.database.all<ExecutionSessionRow>(
      `SELECT ${executionSessionColumns}
       FROM execution_sessions
       WHERE task_id = ?
       ORDER BY started_at, id`,
      [taskId],
    );
    return rows.map(mapExecutionSession);
  }

  async listEndedBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly ExecutionSession[]> {
    const rangeStart = parseInstant(start);
    const rangeEnd = parseInstant(end);
    if (Date.parse(rangeEnd) <= Date.parse(rangeStart)) {
      throw new ApplicationError(
        'validation_error',
        'ExecutionSession query range must be non-empty.',
        { retryable: false },
      );
    }
    const rows = await this.database.all<ExecutionSessionRow>(
      `SELECT ${executionSessionColumns}
       FROM execution_sessions
       WHERE ended_at >= ? AND ended_at < ?
       ORDER BY ended_at, id`,
      [rangeStart, rangeEnd],
    );
    return rows.map(mapExecutionSession);
  }

  async insert(session: ExecutionSession): Promise<void> {
    assertValidExecutionSession(session);
    await this.database.run(
      `INSERT INTO execution_sessions (
        id, task_id, time_block_id, started_at, ended_at,
        paused_duration_seconds, active_interval_started_at, paused_at,
        status, completion_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      executionSessionParameters(session),
    );
  }

  async update(session: ExecutionSession): Promise<void> {
    assertValidExecutionSession(session);
    const result = await this.database.run(
      `UPDATE execution_sessions SET
        task_id = ?, time_block_id = ?, started_at = ?, ended_at = ?,
        paused_duration_seconds = ?, active_interval_started_at = ?,
        paused_at = ?, status = ?, completion_type = ?, created_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [...executionSessionParameters(session).slice(1), session.id],
    );
    ensureOneRow(result, 'ExecutionSession');
  }
}

function executionSessionParameters(
  session: ExecutionSession,
): SqliteParameters {
  return [
    session.id,
    session.taskId,
    session.timeBlockId,
    session.startedAt,
    session.endedAt,
    session.pausedDurationSeconds,
    session.activeIntervalStartedAt,
    session.pausedAt,
    session.status,
    session.completionType,
    session.createdAt,
    session.updatedAt,
  ];
}

class SqliteExecutionIntervalRepository implements ExecutionIntervalRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(
    id: ExecutionInterval['id'],
  ): Promise<ExecutionInterval | null> {
    const row = await this.database.get<ExecutionIntervalRow>(
      `SELECT ${executionIntervalColumns}
       FROM execution_intervals WHERE id = ?`,
      [id],
    );
    return row ? mapExecutionInterval(row) : null;
  }

  async findOpenBySessionId(
    sessionId: ExecutionSessionId,
  ): Promise<ExecutionInterval | null> {
    const row = await this.database.get<ExecutionIntervalRow>(
      `SELECT ${executionIntervalColumns}
       FROM execution_intervals
       WHERE session_id = ? AND end_at IS NULL`,
      [sessionId],
    );
    return row ? mapExecutionInterval(row) : null;
  }

  async listBySessionId(
    sessionId: ExecutionSessionId,
  ): Promise<readonly ExecutionInterval[]> {
    const rows = await this.database.all<ExecutionIntervalRow>(
      `SELECT ${executionIntervalColumns}
       FROM execution_intervals
       WHERE session_id = ?
       ORDER BY start_at, id`,
      [sessionId],
    );
    return rows.map(mapExecutionInterval);
  }

  async insert(interval: ExecutionInterval): Promise<void> {
    assertValidExecutionInterval(interval);
    await this.database.run(
      `INSERT INTO execution_intervals (
        id, session_id, kind, start_at, end_at, timing_quality
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      executionIntervalParameters(interval),
    );
  }

  async update(interval: ExecutionInterval): Promise<void> {
    assertValidExecutionInterval(interval);
    const result = await this.database.run(
      `UPDATE execution_intervals SET
        session_id = ?, kind = ?, start_at = ?, end_at = ?, timing_quality = ?
       WHERE id = ?`,
      [...executionIntervalParameters(interval).slice(1), interval.id],
    );
    ensureOneRow(result, 'ExecutionInterval');
  }
}

function executionIntervalParameters(
  interval: ExecutionInterval,
): SqliteParameters {
  return [
    interval.id,
    interval.sessionId,
    interval.kind,
    interval.startAt,
    interval.endAt,
    interval.timingQuality,
  ];
}

class SqliteAchievementRepository implements AchievementRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: AchievementId): Promise<Achievement | null> {
    const row = await this.database.get<AchievementRow>(
      `SELECT ${achievementColumns} FROM achievements WHERE id = ?`,
      [id],
    );
    return row ? mapAchievement(row) : null;
  }

  async findByCompletionRecordId(
    id: CompletionRecordId,
  ): Promise<Achievement | null> {
    const row = await this.database.get<AchievementRow>(
      `SELECT ${achievementColumns}
       FROM achievements WHERE source_completion_record_id = ?`,
      [id],
    );
    return row ? mapAchievement(row) : null;
  }

  async listOccurredBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly Achievement[]> {
    const rangeStart = parseInstant(start);
    const rangeEnd = parseInstant(end);
    const rows = await this.database.all<AchievementRow>(
      `SELECT ${achievementColumns}
       FROM achievements
       WHERE occurred_at >= ? AND occurred_at < ?
       ORDER BY occurred_at DESC, id`,
      [rangeStart, rangeEnd],
    );
    return rows.map(mapAchievement);
  }

  async listAll(): Promise<readonly Achievement[]> {
    const rows = await this.database.all<AchievementRow>(
      `SELECT ${achievementColumns}
       FROM achievements
       ORDER BY occurred_at DESC, id`,
    );
    return rows.map(mapAchievement);
  }

  async insert(achievement: Achievement): Promise<void> {
    assertValidAchievement(achievement);
    await this.database.run(
      `INSERT INTO achievements (
        id, source_completion_record_id, source_task_id,
        source_execution_session_id, title, summary, evidence_type,
        occurred_at, user_edited, hidden, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      achievementParameters(achievement),
    );
  }

  async update(achievement: Achievement): Promise<void> {
    assertValidAchievement(achievement);
    const result = await this.database.run(
      `UPDATE achievements SET
        source_completion_record_id = ?, source_task_id = ?,
        source_execution_session_id = ?, title = ?, summary = ?,
        evidence_type = ?, occurred_at = ?, user_edited = ?, hidden = ?,
        created_at = ?, updated_at = ?
       WHERE id = ?`,
      [...achievementParameters(achievement).slice(1), achievement.id],
    );
    ensureOneRow(result, 'Achievement');
  }
}

function achievementParameters(achievement: Achievement): SqliteParameters {
  return [
    achievement.id,
    achievement.sourceCompletionRecordId,
    achievement.sourceTaskId,
    achievement.sourceExecutionSessionId,
    achievement.title,
    achievement.summary,
    achievement.evidenceType,
    achievement.occurredAt,
    achievement.userEdited ? 1 : 0,
    achievement.hidden ? 1 : 0,
    achievement.createdAt,
    achievement.updatedAt,
  ];
}

class SqliteTaskActivityEventRepository implements TaskActivityEventRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async listOccurredBetween(
    start: Instant,
    end: Instant,
  ): Promise<readonly TaskActivityEvent[]> {
    const rangeStart = parseInstant(start);
    const rangeEnd = parseInstant(end);
    if (Date.parse(rangeEnd) <= Date.parse(rangeStart)) {
      throw new ApplicationError(
        'validation_error',
        'Task activity query range must be non-empty.',
        { retryable: false },
      );
    }
    const rows = await this.database.all<TaskActivityEventRow>(
      `SELECT ${taskActivityEventColumns}
       FROM task_activity_events
       WHERE occurred_at >= ? AND occurred_at < ?
       ORDER BY occurred_at, id`,
      [rangeStart, rangeEnd],
    );
    return rows.map(mapTaskActivityEvent);
  }

  async insert(event: TaskActivityEvent): Promise<void> {
    assertValidTaskActivityEvent(event);
    await this.database.run(
      `INSERT INTO task_activity_events (
        id, task_id, time_block_id, event_type, actor, occurred_at,
        local_date, time_zone, operation_id, before_summary, after_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.taskId,
        event.timeBlockId,
        event.eventType,
        event.actor,
        event.occurredAt,
        event.localDate,
        event.timeZone,
        event.operationId,
        event.beforeSummary === null
          ? null
          : JSON.stringify(event.beforeSummary),
        event.afterSummary === null ? null : JSON.stringify(event.afterSummary),
      ],
    );
  }
}

class SqliteOperationRecordRepository implements OperationRecordRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(operationId: OperationId): Promise<OperationRecord | null> {
    const row = await this.database.get<OperationRecordRow>(
      `SELECT ${operationRecordColumns}
       FROM operation_records WHERE operation_id = ?`,
      [operationId],
    );
    return row ? mapOperationRecord(row) : null;
  }

  async insert(record: OperationRecord): Promise<void> {
    assertValidOperationRecord(record);
    if (
      await this.database.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='operation_provenance'",
      )
    ) {
      await this.database.run(
        'INSERT OR IGNORE INTO operation_provenance(id,command,occurred_at) VALUES(?,?,?)',
        [record.operationId, record.command, record.occurredAt],
      );
    }
    await this.database.run(
      `INSERT INTO operation_records (
        operation_id, command_name, parameter_hash, result_json,
        base_state_version, current_state_version, occurred_at, diff_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.operationId,
        record.command,
        record.parameterHash,
        record.resultJson,
        record.baseStateVersion,
        record.currentStateVersion,
        record.occurredAt,
        record.diffJson,
      ],
    );
  }
}

class SqliteScheduleStateRepository implements ScheduleStateRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async get(): Promise<ScheduleState | null> {
    const row = await this.database.get<ScheduleStateRow>(
      `SELECT state_version, plan_revision FROM schedule_state WHERE id = 1`,
    );
    return row
      ? rehydrateStored('ScheduleState', () =>
          createScheduleState({
            stateVersion: row.state_version,
            planRevision: row.plan_revision,
          }),
        )
      : null;
  }

  async update(state: ScheduleState): Promise<void> {
    const normalized = createScheduleState(state);
    const result = await this.database.run(
      `UPDATE schedule_state
       SET state_version = ?, plan_revision = ?
       WHERE id = 1`,
      [normalized.stateVersion, normalized.planRevision],
    );
    ensureOneRow(result, 'ScheduleState');
  }
}

class SqliteTimeBlockRepository implements TimeBlockRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findById(id: TimeBlockId): Promise<TimeBlock | null> {
    const row = await this.database.get<TimeBlockRow>(
      `SELECT ${timeBlockColumns} FROM time_blocks WHERE id = ?`,
      [id],
    );
    return row ? mapTimeBlock(row) : null;
  }

  async listAll(): Promise<readonly TimeBlock[]> {
    const rows = await this.database.all<TimeBlockRow>(
      `SELECT ${timeBlockColumns} FROM time_blocks ORDER BY start_at, id`,
    );
    return rows.map(mapTimeBlock);
  }

  async listOverlapping(
    start: Instant,
    end: Instant,
  ): Promise<readonly TimeBlock[]> {
    const rangeStart = parseInstant(start);
    const rangeEnd = parseInstant(end);
    if (Date.parse(rangeEnd) <= Date.parse(rangeStart)) {
      throw new ApplicationError(
        'validation_error',
        'TimeBlock query range must be non-empty.',
        { retryable: false },
      );
    }
    const rows = await this.database.all<TimeBlockRow>(
      `SELECT ${timeBlockColumns}
       FROM time_blocks
       WHERE start_at < ? AND end_at > ?
       ORDER BY start_at, end_at, id`,
      [rangeEnd, rangeStart],
    );
    return rows.map(mapTimeBlock);
  }

  async insert(block: TimeBlock): Promise<void> {
    assertValidTimeBlock(block);
    await this.database.run(
      `INSERT INTO time_blocks (
        id, task_id, type, start_at, end_at, status, source, locked,
        plan_revision, external_calendar_event_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      timeBlockParameters(block),
    );
  }

  async update(block: TimeBlock): Promise<void> {
    assertValidTimeBlock(block);
    const result = await this.database.run(
      `UPDATE time_blocks SET
        task_id = ?, type = ?, start_at = ?, end_at = ?, status = ?,
        source = ?, locked = ?, plan_revision = ?,
        external_calendar_event_id = ?, created_at = ?, updated_at = ?
       WHERE id = ?`,
      [...timeBlockParameters(block).slice(1), block.id],
    );
    ensureOneRow(result, 'TimeBlock');
  }
}

function timeBlockParameters(block: TimeBlock): SqliteParameters {
  return [
    block.id,
    block.taskId,
    block.type,
    block.startAt,
    block.endAt,
    block.status,
    block.source,
    block.locked ? 1 : 0,
    block.planRevision,
    block.externalCalendarEventId,
    block.createdAt,
    block.updatedAt,
  ];
}

class SqliteSchedulePlanRepository implements SchedulePlanRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findByRevision(planRevision: number): Promise<SchedulePlan | null> {
    const row = await this.database.get<SchedulePlanRow>(
      `SELECT ${schedulePlanColumns}
       FROM schedule_plans WHERE plan_revision = ?`,
      [planRevision],
    );
    return row ? mapSchedulePlan(row) : null;
  }

  async insert(plan: SchedulePlan): Promise<void> {
    assertValidSchedulePlan(plan);
    await this.database.run(
      `INSERT INTO schedule_plans (
        id, plan_revision, based_on_state_version, status, created_at,
        committed_at, input_hash, scheduler_version, policy_version,
        time_zone, horizon_start, horizon_end, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plan.id,
        plan.planRevision,
        plan.basedOnStateVersion,
        plan.status,
        plan.createdAt,
        plan.committedAt,
        plan.inputHash,
        plan.schedulerVersion,
        plan.policyVersion,
        plan.timeZone,
        plan.horizonStart,
        plan.horizonEnd,
        plan.reason,
      ],
    );
  }
}

class SqliteIntegrationJobRepository implements IntegrationJobRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async insert(job: IntegrationJob): Promise<void> {
    assertValidIntegrationJob(job);
    await this.database.run(
      `INSERT INTO integration_jobs (
        id, operation_id, target_channel, target_entity_type,
        target_entity_id, desired_revision, desired_action, status,
        attempt_count, last_error_code, automatic_retry_eligible, claim_token,
        lease_expires_at, not_before, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      integrationJobParameters(job),
    );
  }

  async findById(id: IntegrationJobId): Promise<IntegrationJob | null> {
    const row = await this.database.get<IntegrationJobRow>(
      `SELECT ${integrationJobColumns}
       FROM integration_jobs WHERE id = ?`,
      [id],
    );
    return row ? mapIntegrationJob(row) : null;
  }

  async findLatestByChannel(
    channel: IntegrationJobChannel,
  ): Promise<IntegrationJob | null> {
    const row = await this.database.get<IntegrationJobRow>(
      `SELECT ${integrationJobColumns}
       FROM integration_jobs
       WHERE target_channel = ?
       ORDER BY desired_revision DESC, created_at DESC, id DESC
       LIMIT 1`,
      [channel],
    );
    return row ? mapIntegrationJob(row) : null;
  }

  async listByOperationId(
    operationId: OperationId,
  ): Promise<readonly IntegrationJob[]> {
    const rows = await this.database.all<IntegrationJobRow>(
      `SELECT ${integrationJobColumns}
       FROM integration_jobs
       WHERE operation_id = ?
       ORDER BY created_at, id`,
      [operationId],
    );
    return rows.map(mapIntegrationJob);
  }

  async claimNext(
    input: ClaimNextIntegrationJobInput,
  ): Promise<IntegrationJobClaim | null> {
    const claimToken = requireNonEmptyString(input.claimToken, 'claimToken');
    const claimedAt = parseInstant(input.claimedAt);
    const leaseExpiresAt = parseInstant(input.leaseExpiresAt);

    const activeClaim = await this.database.get<{ readonly id: string }>(
      `SELECT id FROM integration_jobs
       WHERE target_channel = ?
         AND status = 'processing'
         AND lease_expires_at > ?
       LIMIT 1`,
      [input.channel, claimedAt],
    );
    if (activeClaim) return null;

    const candidateRow = await this.database.get<IntegrationJobRow>(
      `SELECT ${integrationJobColumns}
       FROM integration_jobs
       WHERE target_channel = ?
         AND not_before <= ?
         AND (
           status = 'pending'
           OR (
             status IN ('failed', 'reconciliation_required')
             AND automatic_retry_eligible = 1
           )
           OR (status = 'processing' AND lease_expires_at <= ?)
         )
       ORDER BY
         CASE WHEN EXISTS (
           SELECT 1 FROM external_mutation_intents
           WHERE integration_job_id = integration_jobs.id
         ) THEN 0 ELSE 1 END,
         CASE WHEN status = 'processing' THEN 0 ELSE 1 END,
         desired_revision DESC,
         created_at,
         id
       LIMIT 1`,
      [input.channel, claimedAt, claimedAt],
    );
    if (!candidateRow) return null;

    const candidate = mapIntegrationJob(candidateRow);
    const recoveredExpiredLease = candidate.status === 'processing';
    const claimed = claimIntegrationJob(candidate, {
      claimToken,
      claimedAt,
      leaseExpiresAt,
    });
    const result = await this.database.run(
      `UPDATE integration_jobs SET
         status = 'processing', attempt_count = ?, last_error_code = NULL,
         automatic_retry_eligible = 1, claim_token = ?, lease_expires_at = ?,
         updated_at = ?
       WHERE id = ?
         AND status = ?
         AND attempt_count = ?
         AND not_before <= ?
         AND (
           (? = 'processing' AND claim_token = ? AND lease_expires_at <= ?)
           OR (? <> 'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
         )`,
      [
        claimed.attemptCount,
        claimed.claimToken,
        claimed.leaseExpiresAt,
        claimed.updatedAt,
        candidate.id,
        candidate.status,
        candidate.attemptCount,
        claimedAt,
        candidate.status,
        candidate.claimToken,
        claimedAt,
        candidate.status,
      ],
    );

    return result.changes === 1
      ? { job: claimed, recoveredExpiredLease }
      : null;
  }

  async updateClaimed(
    job: IntegrationJob,
    fence: IntegrationJobClaimFence,
  ): Promise<boolean> {
    assertValidIntegrationJob(job);
    const expectedClaimToken = requireNonEmptyString(
      fence.expectedClaimToken,
      'expectedClaimToken',
    );
    const expectedAttemptCount = requireNonNegativeInteger(
      fence.expectedAttemptCount,
      'expectedAttemptCount',
    );
    if (job.attemptCount !== expectedAttemptCount) return false;

    const result = await this.database.run(
      `UPDATE integration_jobs SET
         status = ?, attempt_count = ?, last_error_code = ?,
         automatic_retry_eligible = ?, claim_token = ?, lease_expires_at = ?,
         not_before = ?, updated_at = ?
       WHERE id = ?
         AND status = 'processing'
         AND claim_token = ?
         AND attempt_count = ?`,
      [
        job.status,
        job.attemptCount,
        job.lastErrorCode,
        job.automaticRetryEligible ? 1 : 0,
        job.claimToken,
        job.leaseExpiresAt,
        job.notBefore,
        job.updatedAt,
        job.id,
        expectedClaimToken,
        expectedAttemptCount,
      ],
    );
    return result.changes === 1;
  }

  async requeueBlockedChannel(
    input: RequeueBlockedIntegrationJobsInput,
  ): Promise<number> {
    const requeuedAt = parseInstant(input.requeuedAt);
    const notBefore = parseInstant(input.notBefore);
    const result = await this.database.run(
      `UPDATE integration_jobs SET
         status = 'pending', last_error_code = NULL,
         automatic_retry_eligible = 1, claim_token = NULL,
         lease_expires_at = NULL, not_before = ?, updated_at = ?
       WHERE target_channel = ? AND status = 'permission_required'`,
      [notBefore, requeuedAt, input.channel],
    );
    return result.changes;
  }

  async requeueBlockedJob(
    input: RequeueBlockedIntegrationJobInput,
  ): Promise<boolean> {
    const jobId = parseIntegrationJobId(input.jobId);
    const requeuedAt = parseInstant(input.requeuedAt);
    const notBefore = parseInstant(input.notBefore);
    const result = await this.database.run(
      `UPDATE integration_jobs SET
         status = 'pending', last_error_code = NULL,
         automatic_retry_eligible = 1, claim_token = NULL,
         lease_expires_at = NULL, not_before = ?, updated_at = ?
       WHERE id = ? AND target_channel = ?
         AND status = 'reconciliation_required'`,
      [notBefore, requeuedAt, jobId, input.channel],
    );
    return result.changes === 1;
  }

  async requeueLatestProjection(
    input: RequeueLatestProjectionInput,
  ): Promise<boolean> {
    const desiredRevision = requireNonNegativeInteger(
      input.desiredRevision,
      'desiredRevision',
    );
    const requeuedAt = parseInstant(input.requeuedAt);
    const notBefore = parseInstant(input.notBefore);
    const result = await this.database.run(
      `UPDATE integration_jobs SET
         status = 'pending', last_error_code = NULL,
         automatic_retry_eligible = 1, claim_token = NULL,
         lease_expires_at = NULL, not_before = ?, updated_at = ?
       WHERE id = (
         SELECT id FROM integration_jobs
         WHERE target_channel = ? AND desired_revision = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )
         AND status IN ('succeeded', 'permission_required', 'failed', 'disabled')
         AND NOT EXISTS (
           SELECT 1 FROM external_mutation_intents
           WHERE integration_job_id = integration_jobs.id
         )`,
      [notBefore, requeuedAt, input.channel, desiredRevision],
    );
    return result.changes === 1;
  }
}

function integrationJobParameters(job: IntegrationJob): SqliteParameters {
  return [
    job.id,
    job.operationId,
    job.targetChannel,
    job.targetEntityType,
    job.targetEntityId,
    job.desiredRevision,
    job.desiredAction,
    job.status,
    job.attemptCount,
    job.lastErrorCode,
    job.automaticRetryEligible ? 1 : 0,
    job.claimToken,
    job.leaseExpiresAt,
    job.notBefore,
    job.createdAt,
    job.updatedAt,
  ];
}

class SqliteExternalCalendarEventSnapshotRepository implements ExternalCalendarEventSnapshotRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async listOverlapping(
    scope: CalendarSnapshotScope,
  ): Promise<readonly ExternalCalendarEventSnapshot[]> {
    const rows = await this.database.all<ExternalCalendarEventSnapshotRow>(
      `SELECT ${externalCalendarEventSnapshotColumns}
       FROM external_calendar_event_snapshots
       WHERE provider = ? AND calendar_id = ?
         AND start_at < ? AND end_at > ?
       ORDER BY start_at, end_at, external_event_id, occurrence_key, id`,
      [scope.provider, scope.calendarId, scope.rangeEnd, scope.rangeStart],
    );
    return rows.map(mapExternalCalendarEventSnapshot);
  }

  async upsert(snapshot: ExternalCalendarEventSnapshot): Promise<void> {
    assertValidExternalCalendarEventSnapshot(snapshot);
    const conflictTarget =
      snapshot.occurrenceKey === null
        ? `(provider, calendar_id, external_event_id)
           WHERE occurrence_key IS NULL`
        : `(provider, calendar_id, external_event_id, occurrence_key)
           WHERE occurrence_key IS NOT NULL`;
    await this.database.run(
      `INSERT INTO external_calendar_event_snapshots (
        id, provider, calendar_id, external_event_id, occurrence_key,
        start_at, end_at, busy, last_seen_at, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT ${conflictTarget} DO UPDATE SET
        id = excluded.id,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        busy = excluded.busy,
        last_seen_at = excluded.last_seen_at,
        content_hash = excluded.content_hash`,
      externalCalendarEventSnapshotParameters(snapshot),
    );
  }

  async deleteByIds(
    ids: readonly ExternalCalendarEventSnapshotId[],
  ): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += sqliteQueryChunkSize
    ) {
      const chunk = uniqueIds.slice(offset, offset + sqliteQueryChunkSize);
      await this.database.run(
        `DELETE FROM external_calendar_event_snapshots
         WHERE id IN (${chunk.map(() => '?').join(', ')})`,
        chunk,
      );
    }
  }
}

function externalCalendarEventSnapshotParameters(
  snapshot: ExternalCalendarEventSnapshot,
): SqliteParameters {
  return [
    snapshot.id,
    snapshot.provider,
    snapshot.calendarId,
    snapshot.externalEventId,
    snapshot.occurrenceKey,
    snapshot.startAt,
    snapshot.endAt,
    snapshot.busy ? 1 : 0,
    snapshot.lastSeenAt,
    snapshot.contentHash,
  ];
}

class SqliteCalendarRefreshCoverageRepository implements CalendarRefreshCoverageRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async insert(coverage: CalendarRefreshCoverage): Promise<void> {
    assertValidCalendarRefreshCoverage(coverage);
    await this.database.run(
      `INSERT INTO calendar_refresh_coverages (
        id, provider, calendar_id, range_start, range_end, fetched_at,
        completeness, observed_event_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        coverage.id,
        coverage.provider,
        coverage.calendarId,
        coverage.rangeStart,
        coverage.rangeEnd,
        coverage.fetchedAt,
        coverage.completeness,
        coverage.observedEventCount,
      ],
    );
  }

  async findLatestCovering(
    scope: CalendarSnapshotScope,
  ): Promise<CalendarRefreshCoverage | null> {
    const row = await this.database.get<CalendarRefreshCoverageRow>(
      `SELECT ${calendarRefreshCoverageColumns}
       FROM calendar_refresh_coverages
       WHERE provider = ? AND calendar_id = ?
         AND range_start <= ? AND range_end >= ?
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1`,
      [scope.provider, scope.calendarId, scope.rangeStart, scope.rangeEnd],
    );
    return row ? mapCalendarRefreshCoverage(row) : null;
  }
}

class SqliteCalendarContainerBindingRepository implements CalendarContainerBindingRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findByOwnership(
    provider: string,
    ownershipKey: string,
  ): Promise<CalendarContainerBinding | null> {
    const row = await this.database.get<CalendarContainerBindingRow>(
      `SELECT ${calendarContainerBindingColumns}
       FROM calendar_container_bindings
       WHERE provider = ? AND ownership_key = ?`,
      [provider, ownershipKey],
    );
    return row ? mapCalendarContainerBinding(row) : null;
  }

  async upsert(binding: CalendarContainerBinding): Promise<void> {
    assertValidCalendarContainerBinding(binding);
    await this.database.run(
      `INSERT INTO calendar_container_bindings (
        id, provider, calendar_id, ownership_key, ownership_verified, status,
        verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, ownership_key) DO UPDATE SET
        id = excluded.id,
        calendar_id = excluded.calendar_id,
        ownership_verified = excluded.ownership_verified,
        status = excluded.status,
        verified_at = excluded.verified_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`,
      calendarContainerBindingParameters(binding),
    );
  }
}

function calendarContainerBindingParameters(
  binding: CalendarContainerBinding,
): SqliteParameters {
  return [
    binding.id,
    binding.provider,
    binding.calendarId,
    binding.ownershipKey,
    binding.ownershipVerified ? 1 : 0,
    binding.status,
    binding.verifiedAt,
    binding.createdAt,
    binding.updatedAt,
  ];
}

class SqliteCalendarBindingRepository implements CalendarBindingRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findByTimeBlockId(
    timeBlockId: TimeBlockId,
  ): Promise<CalendarBinding | null> {
    const row = await this.database.get<CalendarBindingRow>(
      `SELECT ${calendarBindingColumns}
       FROM calendar_bindings WHERE time_block_id = ?`,
      [timeBlockId],
    );
    return row ? mapCalendarBinding(row) : null;
  }

  async listAll(): Promise<readonly CalendarBinding[]> {
    const rows = await this.database.all<CalendarBindingRow>(
      `SELECT ${calendarBindingColumns}
       FROM calendar_bindings
       ORDER BY time_block_id, id`,
    );
    return rows.map(mapCalendarBinding);
  }

  async upsertIfNotNewer(binding: CalendarBinding): Promise<boolean> {
    assertValidCalendarBinding(binding);
    const result = await this.database.run(
      `INSERT INTO calendar_bindings (
        id, time_block_id, provider, calendar_id, external_event_id,
        occurrence_key, ownership_key, ownership_verified,
        applied_content_hash, applied_start_at, applied_end_at,
        last_applied_revision, status, verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(time_block_id) DO UPDATE SET
        id = excluded.id,
        provider = excluded.provider,
        calendar_id = excluded.calendar_id,
        external_event_id = excluded.external_event_id,
        occurrence_key = excluded.occurrence_key,
        ownership_key = excluded.ownership_key,
        ownership_verified = excluded.ownership_verified,
        applied_content_hash = excluded.applied_content_hash,
        applied_start_at = excluded.applied_start_at,
        applied_end_at = excluded.applied_end_at,
        last_applied_revision = excluded.last_applied_revision,
        status = excluded.status,
        verified_at = excluded.verified_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      WHERE calendar_bindings.last_applied_revision <= excluded.last_applied_revision`,
      calendarBindingParameters(binding),
    );
    return result.changes === 1;
  }

  async deleteIfNotNewer(
    id: CalendarBindingId,
    expectedLastAppliedRevision: number,
  ): Promise<boolean> {
    const revision = requireNonNegativeInteger(
      expectedLastAppliedRevision,
      'expectedLastAppliedRevision',
    );
    const result = await this.database.run(
      `DELETE FROM calendar_bindings
       WHERE id = ? AND last_applied_revision <= ?`,
      [id, revision],
    );
    return result.changes === 1;
  }
}

function calendarBindingParameters(binding: CalendarBinding): SqliteParameters {
  return [
    binding.id,
    binding.timeBlockId,
    binding.provider,
    binding.calendarId,
    binding.externalEventId,
    binding.occurrenceKey,
    binding.ownershipKey,
    binding.ownershipVerified ? 1 : 0,
    binding.appliedContentHash,
    binding.appliedStartAt,
    binding.appliedEndAt,
    binding.lastAppliedRevision,
    binding.status,
    binding.verifiedAt,
    binding.createdAt,
    binding.updatedAt,
  ];
}

class SqliteNotificationBindingRepository implements NotificationBindingRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findByIdentity(
    timeBlockId: TimeBlockId,
    type: string,
  ): Promise<NotificationBinding | null> {
    const row = await this.database.get<NotificationBindingRow>(
      `SELECT ${notificationBindingColumns}
       FROM notification_bindings
       WHERE time_block_id = ? AND type = ?`,
      [timeBlockId, type],
    );
    return row ? mapNotificationBinding(row) : null;
  }

  async listAll(): Promise<readonly NotificationBinding[]> {
    const rows = await this.database.all<NotificationBindingRow>(
      `SELECT ${notificationBindingColumns}
       FROM notification_bindings
       ORDER BY time_block_id, type, id`,
    );
    return rows.map(mapNotificationBinding);
  }

  async upsertIfNotNewer(binding: NotificationBinding): Promise<boolean> {
    assertValidNotificationBinding(binding);
    const result = await this.database.run(
      `INSERT INTO notification_bindings (
        id, time_block_id, task_id, os_notification_id, type,
        applied_content_hash, scheduled_at, desired_revision,
        last_applied_revision, status, identity_verified, verified_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(time_block_id, type) DO UPDATE SET
        id = excluded.id,
        task_id = excluded.task_id,
        os_notification_id = excluded.os_notification_id,
        applied_content_hash = excluded.applied_content_hash,
        scheduled_at = excluded.scheduled_at,
        desired_revision = excluded.desired_revision,
        last_applied_revision = excluded.last_applied_revision,
        status = excluded.status,
        identity_verified = excluded.identity_verified,
        verified_at = excluded.verified_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      WHERE notification_bindings.last_applied_revision <= excluded.last_applied_revision`,
      notificationBindingParameters(binding),
    );
    return result.changes === 1;
  }

  async deleteIfNotNewer(
    id: NotificationBindingId,
    expectedLastAppliedRevision: number,
  ): Promise<boolean> {
    const revision = requireNonNegativeInteger(
      expectedLastAppliedRevision,
      'expectedLastAppliedRevision',
    );
    const result = await this.database.run(
      `DELETE FROM notification_bindings
       WHERE id = ? AND last_applied_revision <= ?`,
      [id, revision],
    );
    return result.changes === 1;
  }
}

function notificationBindingParameters(
  binding: NotificationBinding,
): SqliteParameters {
  return [
    binding.id,
    binding.timeBlockId,
    binding.taskId,
    binding.osNotificationId,
    binding.type,
    binding.appliedContentHash,
    binding.scheduledAt,
    binding.desiredRevision,
    binding.lastAppliedRevision,
    binding.status,
    binding.identityVerified ? 1 : 0,
    binding.verifiedAt,
    binding.createdAt,
    binding.updatedAt,
  ];
}

class SqliteExternalMutationIntentRepository implements ExternalMutationIntentRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findByJobId(
    jobId: IntegrationJobId,
  ): Promise<ExternalMutationIntent | null> {
    const row = await this.database.get<ExternalMutationIntentRow>(
      `SELECT ${externalMutationIntentColumns}
       FROM external_mutation_intents
       WHERE integration_job_id = ?`,
      [jobId],
    );
    return row ? mapExternalMutationIntent(row) : null;
  }

  async findByScopeKey(
    scopeKey: string,
  ): Promise<ExternalMutationIntent | null> {
    const normalizedScopeKey = requireNonEmptyString(scopeKey, 'scopeKey');
    const row = await this.database.get<ExternalMutationIntentRow>(
      `SELECT ${externalMutationIntentColumns}
       FROM external_mutation_intents
       WHERE scope_key = ?`,
      [normalizedScopeKey],
    );
    return row ? mapExternalMutationIntent(row) : null;
  }

  async listByChannel(
    channel: IntegrationJobChannel,
  ): Promise<readonly ExternalMutationIntent[]> {
    const rows = await this.database.all<ExternalMutationIntentRow>(
      `SELECT ${externalMutationIntentColumns}
       FROM external_mutation_intents
       INNER JOIN integration_jobs
         ON integration_jobs.id = external_mutation_intents.integration_job_id
       WHERE integration_jobs.target_channel = ?
       ORDER BY external_mutation_intents.created_at,
         external_mutation_intents.id`,
      [channel],
    );
    return rows.map(mapExternalMutationIntent);
  }

  async insert(intent: ExternalMutationIntent): Promise<void> {
    assertValidExternalMutationIntent(intent);
    assertExternalMutationPayloadShape(intent.action, intent.payload);
    await this.database.run(
      `INSERT INTO external_mutation_intents (
        id, integration_job_id, desired_revision, scope_key, action,
        payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        intent.id,
        intent.integrationJobId,
        intent.desiredRevision,
        intent.scopeKey,
        intent.action,
        canonicalJson(intent.payload),
        intent.createdAt,
        intent.updatedAt,
      ],
    );
  }

  async deleteById(id: ExternalMutationIntentId): Promise<void> {
    const normalizedId = parseExternalMutationIntentId(id);
    const result = await this.database.run(
      `DELETE FROM external_mutation_intents WHERE id = ?`,
      [normalizedId],
    );
    ensureOneRow(result, 'ExternalMutationIntent');
  }
}

class SqliteUserPreferenceRepository implements UserPreferenceRepository {
  constructor(private readonly database: SqliteExecutor) {}

  async findByKey(key: string): Promise<UserPreference | null> {
    const normalizedKey = requireNonEmptyString(key, 'key');
    const row = await this.database.get<UserPreferenceRow>(
      `SELECT ${userPreferenceColumns}
       FROM user_preferences
       WHERE key = ?`,
      [normalizedKey],
    );
    return row ? mapUserPreference(row) : null;
  }

  async listByKeys(
    keys: readonly string[],
  ): Promise<readonly UserPreference[]> {
    const normalizedKeys = [
      ...new Set(keys.map((key) => requireNonEmptyString(key, 'key'))),
    ].sort();
    if (normalizedKeys.length === 0) return [];
    const rows: UserPreferenceRow[] = [];
    for (
      let index = 0;
      index < normalizedKeys.length;
      index += sqliteQueryChunkSize
    ) {
      const chunk = normalizedKeys.slice(index, index + sqliteQueryChunkSize);
      rows.push(
        ...(await this.database.all<UserPreferenceRow>(
          `SELECT ${userPreferenceColumns}
           FROM user_preferences
           WHERE key IN (${chunk.map(() => '?').join(', ')})
           ORDER BY key`,
          chunk,
        )),
      );
    }
    return rows
      .map(mapUserPreference)
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async upsert(preference: UserPreference): Promise<void> {
    assertValidUserPreference(preference);
    const result = await this.database.run(
      `INSERT INTO user_preferences (id, key, value_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at
       WHERE user_preferences.id = excluded.id`,
      [
        preference.id,
        preference.key,
        canonicalJson(preference.valueJson),
        preference.updatedAt,
      ],
    );
    if (result.changes !== 1) {
      throw new DatabaseRepositoryError(
        'corrupt_row',
        'UserPreference',
        'UserPreference key is already bound to another identity.',
      );
    }
  }
}

/** Creates repositories bound to one executor or transaction connection. */
export function createSqliteApplicationTransaction(
  database: SqliteExecutor,
): ApplicationTransaction {
  return {
    agentRuns: new SqliteAgentRunRepository(database),
    userModelFeatures: new SqliteUserModelFeatureRepository(database),
    dailyReflections: new SqliteDailyReflectionRepository(database),
    energyCheckIns: new SqliteEnergyCheckInRepository(database),
    relaxSessions: new SqliteRelaxSessionRepository(database),
    tasks: new SqliteTaskRepository(database),
    goals: new SqliteGoalRepository(database),
    projects: new SqliteProjectRepository(database),
    completionRecords: new SqliteCompletionRecordRepository(database),
    executionSessions: new SqliteExecutionSessionRepository(database),
    executionIntervals: new SqliteExecutionIntervalRepository(database),
    achievements: new SqliteAchievementRepository(database),
    taskActivityEvents: new SqliteTaskActivityEventRepository(database),
    operationRecords: new SqliteOperationRecordRepository(database),
    scheduleState: new SqliteScheduleStateRepository(database),
    timeBlocks: new SqliteTimeBlockRepository(database),
    schedulePlans: new SqliteSchedulePlanRepository(database),
    integrationJobs: new SqliteIntegrationJobRepository(database),
    externalCalendarEventSnapshots:
      new SqliteExternalCalendarEventSnapshotRepository(database),
    calendarRefreshCoverages: new SqliteCalendarRefreshCoverageRepository(
      database,
    ),
    calendarContainerBindings: new SqliteCalendarContainerBindingRepository(
      database,
    ),
    calendarBindings: new SqliteCalendarBindingRepository(database),
    notificationBindings: new SqliteNotificationBindingRepository(database),
    externalMutationIntents: new SqliteExternalMutationIntentRepository(
      database,
    ),
    userPreferences: new SqliteUserPreferenceRepository(database),
  };
}

/**
 * Creates the Application UnitOfWork over exclusive SQLite transactions.
 * Repository instances are newly scoped to every transaction callback.
 */
export function createSqliteApplicationUnitOfWork(
  database: SqliteDatabase,
  onWrite?: () => void,
): ApplicationUnitOfWork {
  return {
    transaction: async <TResult>(
      work: (transaction: ApplicationTransaction) => Promise<TResult>,
    ): Promise<TResult> => {
      let changed = false;
      const result = await database.transaction(async (transaction) => {
        const cloud = await transaction.get<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='cloud_sync_state'",
        );
        return cloud
          ? captureCloudTransaction(transaction, work, () => {
              changed = true;
            })
          : work(createSqliteApplicationTransaction(transaction));
      });
      if (changed) onWrite?.();
      return result;
    },
  };
}

/** Migrates first, then returns a UnitOfWork safe for application startup. */
export async function initializeSqliteApplicationUnitOfWork(
  database: SqliteDatabase,
  migrationOptions: MigrationOptions = {},
): Promise<ApplicationUnitOfWork> {
  await migrateDatabase(database, migrationOptions);
  return createSqliteApplicationUnitOfWork(database);
}
