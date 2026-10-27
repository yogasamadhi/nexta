import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const taskStatusValues = [
  'inbox',
  'planned',
  'in_progress',
  'completed',
  'canceled',
] as const;

export const durationCoverageValues = [
  'complete',
  'partial',
  'unknown',
] as const;

export const achievementDispositionValues = ['record', 'skip'] as const;

export const completionSourceValues = ['user', 'agent_authorized'] as const;

export const executionSessionStatusValues = [
  'running',
  'paused',
  'completed',
  'abandoned',
] as const;

export const executionCompletionTypeValues = [
  'finish_session',
  'complete_task',
] as const;

export const executionIntervalKindValues = ['work', 'pause'] as const;
export const executionTimingQualityValues = [
  'trusted',
  'needs_review',
] as const;

export const agentRunStatusValues = [
  'running',
  'completed',
  'max_turns',
  'max_tool_calls',
  'aborted',
  'failed',
] as const;

export const agentRunTriggerValues = [
  'user_input',
  'foreground_resume',
  'task_completed',
  'calendar_changed',
  'notification_opened',
  'background_window',
  'manual_replan',
] as const;

export const reflectionGeneratedByValues = [
  'local_facts',
  'model_validated',
] as const;

export const relaxTypeValues = [
  'breathing',
  'pause',
  'stretch',
  'ambient',
] as const;
export const relaxSourceValues = ['relax_tab', 'today', 'focus'] as const;
export const relaxStatusValues = ['active', 'completed', 'abandoned'] as const;
export const relaxTimingQualityValues = ['trusted', 'needs_review'] as const;

export const timeBlockTypeValues = [
  'task',
  'break',
  'relax',
  'buffer',
] as const;

export const timeBlockStatusValues = [
  'planned',
  'started',
  'completed',
  'skipped',
  'canceled',
] as const;

export const integrationTargetChannelValues = [
  'calendar',
  'notification',
] as const;

export const integrationJobStatusValues = [
  'pending',
  'processing',
  'succeeded',
  'permission_required',
  'failed',
  'disabled',
  'reconciliation_required',
  'superseded',
] as const;

export const integrationBindingStatusValues = [
  'synced',
  'pending',
  'permission_required',
  'failed',
  'disabled',
  'reconciliation_required',
  'conflict',
] as const;

export const externalMutationIntentActionValues = [
  'calendar_provision',
  'calendar_event_create',
  'calendar_event_update',
  'calendar_event_delete',
  'notification_schedule',
  'notification_cancel',
] as const;

export const goals = sqliteTable(
  'goals',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull(),
    targetDate: text('target_date'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (table) => [
    check('goals_title_nonempty', sql`length(trim(${table.title})) > 0`),
    check('goals_status_nonempty', sql`length(trim(${table.status})) > 0`),
    index('goals_status_idx').on(table.status),
    index('goals_archived_at_idx').on(table.archivedAt),
  ],
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id').references(() => goals.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull(),
    deadline: text('deadline'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (table) => [
    check('projects_title_nonempty', sql`length(trim(${table.title})) > 0`),
    check('projects_status_nonempty', sql`length(trim(${table.status})) > 0`),
    index('projects_goal_id_idx').on(table.goalId),
    index('projects_status_idx').on(table.status),
    index('projects_archived_at_idx').on(table.archivedAt),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    goalId: text('goal_id').references(() => goals.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    parentTaskId: text('parent_task_id').references(
      (): AnySQLiteColumn => tasks.id,
      {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      },
    ),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: taskStatusValues }).notNull(),
    priority: text('priority').notNull(),
    estimatedDurationMinutes: real('estimated_duration_minutes'),
    baselineEstimatedDurationMinutes: real(
      'baseline_estimated_duration_minutes',
    ),
    actualDurationMinutes: real('actual_duration_minutes'),
    remainingDurationMinutes: real('remaining_duration_minutes'),
    categoryKey: text('category_key'),
    earliestStartAt: text('earliest_start_at'),
    deadlineAt: text('deadline_at'),
    deadlineLocalDate: text('deadline_local_date'),
    deadlineTimeZone: text('deadline_time_zone'),
    splittable: integer('splittable', { mode: 'boolean' }).notNull(),
    minBlockMinutes: real('min_block_minutes'),
    maxBlockMinutes: real('max_block_minutes'),
    energyDemand: text('energy_demand'),
    schedulingPolicy: text('scheduling_policy').notNull(),
    source: text('source').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    canceledAt: text('canceled_at'),
  },
  (table) => [
    check('tasks_title_nonempty', sql`length(trim(${table.title})) > 0`),
    check(
      'tasks_status_valid',
      sql`${table.status} in ('inbox', 'planned', 'in_progress', 'completed', 'canceled')`,
    ),
    check('tasks_priority_nonempty', sql`length(trim(${table.priority})) > 0`),
    check(
      'tasks_estimated_duration_positive',
      sql`${table.estimatedDurationMinutes} is null or ${table.estimatedDurationMinutes} > 0`,
    ),
    check(
      'tasks_baseline_duration_positive',
      sql`${table.baselineEstimatedDurationMinutes} is null or ${table.baselineEstimatedDurationMinutes} > 0`,
    ),
    check(
      'tasks_actual_duration_nonnegative',
      sql`${table.actualDurationMinutes} is null or ${table.actualDurationMinutes} >= 0`,
    ),
    check(
      'tasks_remaining_duration_positive',
      sql`${table.remainingDurationMinutes} is null or ${table.remainingDurationMinutes} > 0`,
    ),
    check(
      'tasks_deadline_after_earliest_start',
      sql`${table.deadlineAt} is null or ${table.earliestStartAt} is null or ${table.deadlineAt} >= ${table.earliestStartAt}`,
    ),
    check(
      'tasks_local_deadline_complete',
      sql`(${table.deadlineLocalDate} is null and ${table.deadlineTimeZone} is null) or (${table.deadlineLocalDate} is not null and ${table.deadlineTimeZone} is not null)`,
    ),
    check('tasks_splittable_boolean', sql`${table.splittable} in (0, 1)`),
    check(
      'tasks_min_block_positive',
      sql`${table.minBlockMinutes} is null or ${table.minBlockMinutes} > 0`,
    ),
    check(
      'tasks_max_block_positive',
      sql`${table.maxBlockMinutes} is null or ${table.maxBlockMinutes} > 0`,
    ),
    check(
      'tasks_block_range_valid',
      sql`${table.minBlockMinutes} is null or ${table.maxBlockMinutes} is null or ${table.minBlockMinutes} <= ${table.maxBlockMinutes}`,
    ),
    check(
      'tasks_scheduling_policy_nonempty',
      sql`length(trim(${table.schedulingPolicy})) > 0`,
    ),
    check('tasks_source_nonempty', sql`length(trim(${table.source})) > 0`),
    check(
      'tasks_parent_not_self',
      sql`${table.parentTaskId} is null or ${table.parentTaskId} <> ${table.id}`,
    ),
    check(
      'tasks_terminal_timestamps_consistent',
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null and ${table.canceledAt} is null)
          or (${table.status} = 'canceled' and ${table.canceledAt} is not null and ${table.completedAt} is null)
          or (${table.status} in ('inbox', 'planned', 'in_progress') and ${table.completedAt} is null and ${table.canceledAt} is null)`,
    ),
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_goal_id_idx').on(table.goalId),
    index('tasks_parent_task_id_idx').on(table.parentTaskId),
    index('tasks_status_idx').on(table.status),
    index('tasks_deadline_at_idx').on(table.deadlineAt),
  ],
);

export const executionSessions = sqliteTable(
  'execution_sessions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    timeBlockId: text('time_block_id').references(
      (): AnySQLiteColumn => timeBlocks.id,
      {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      },
    ),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    pausedDurationSeconds: integer('paused_duration_seconds').notNull(),
    activeIntervalStartedAt: text('active_interval_started_at'),
    pausedAt: text('paused_at'),
    status: text('status', { enum: executionSessionStatusValues }).notNull(),
    completionType: text('completion_type', {
      enum: executionCompletionTypeValues,
    }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'execution_sessions_status_valid',
      sql`${table.status} in ('running', 'paused', 'completed', 'abandoned')`,
    ),
    check(
      'execution_sessions_completion_type_valid',
      sql`${table.completionType} is null or ${table.completionType} in ('finish_session', 'complete_task')`,
    ),
    check(
      'execution_sessions_paused_duration_nonnegative',
      sql`${table.pausedDurationSeconds} >= 0`,
    ),
    check(
      'execution_sessions_end_order_valid',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    check(
      'execution_sessions_lifecycle_valid',
      sql`(${table.status} = 'running' and ${table.endedAt} is null and ${table.activeIntervalStartedAt} is not null and ${table.pausedAt} is null and ${table.completionType} is null)
          or (${table.status} = 'paused' and ${table.endedAt} is null and ${table.activeIntervalStartedAt} is null and ${table.pausedAt} is not null and ${table.completionType} is null)
          or (${table.status} = 'completed' and ${table.endedAt} is not null and ${table.activeIntervalStartedAt} is null and ${table.pausedAt} is null and ${table.completionType} is not null)
          or (${table.status} = 'abandoned' and ${table.endedAt} is not null and ${table.activeIntervalStartedAt} is null and ${table.pausedAt} is null and ${table.completionType} is null)`,
    ),
    uniqueIndex('execution_sessions_active_unique')
      .on(sql`1`)
      .where(sql`${table.status} in ('running', 'paused')`),
    index('execution_sessions_task_started_idx').on(
      table.taskId,
      table.startedAt,
    ),
    index('execution_sessions_time_block_idx').on(table.timeBlockId),
  ],
);

export const executionIntervals = sqliteTable(
  'execution_intervals',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => executionSessions.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    kind: text('kind', { enum: executionIntervalKindValues }).notNull(),
    startAt: text('start_at').notNull(),
    endAt: text('end_at'),
    timingQuality: text('timing_quality', {
      enum: executionTimingQualityValues,
    }).notNull(),
  },
  (table) => [
    check(
      'execution_intervals_kind_valid',
      sql`${table.kind} in ('work', 'pause')`,
    ),
    check(
      'execution_intervals_timing_quality_valid',
      sql`${table.timingQuality} in ('trusted', 'needs_review')`,
    ),
    check(
      'execution_intervals_end_order_valid',
      sql`${table.endAt} is null or ${table.endAt} >= ${table.startAt}`,
    ),
    uniqueIndex('execution_intervals_open_session_unique')
      .on(table.sessionId)
      .where(sql`${table.endAt} is null`),
    index('execution_intervals_session_start_idx').on(
      table.sessionId,
      table.startAt,
    ),
  ],
);

export const operationRecords = sqliteTable(
  'operation_records',
  {
    operationId: text('operation_id').primaryKey(),
    command: text('command_name').notNull(),
    parameterHash: text('parameter_hash').notNull(),
    resultJson: text('result_json').notNull(),
    baseStateVersion: integer('base_state_version'),
    currentStateVersion: integer('current_state_version').notNull(),
    occurredAt: text('occurred_at').notNull(),
    diffJson: text('diff_json'),
  },
  (table) => [
    check(
      'operation_records_command_nonempty',
      sql`length(trim(${table.command})) > 0`,
    ),
    check(
      'operation_records_parameter_hash_nonempty',
      sql`length(trim(${table.parameterHash})) > 0`,
    ),
    check(
      'operation_records_base_version_nonnegative',
      sql`${table.baseStateVersion} is null or ${table.baseStateVersion} >= 0`,
    ),
    check(
      'operation_records_current_version_nonnegative',
      sql`${table.currentStateVersion} >= 0`,
    ),
    check(
      'operation_records_version_order_valid',
      sql`${table.baseStateVersion} is null or ${table.currentStateVersion} >= ${table.baseStateVersion}`,
    ),
    index('operation_records_occurred_at_idx').on(table.occurredAt),
  ],
);

/** Historical 0000 shape, retained so migration/schema parity tests do not
 * retroactively claim that Phase 1 referenced a table introduced in 0005. */
export const phase1CompletionRecords = sqliteTable(
  'completion_records',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    sourceSessionId: text('source_session_id'),
    operationId: text('operation_id')
      .notNull()
      .references(() => operationRecords.operationId, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    completedAt: text('completed_at').notNull(),
    taskTitleSnapshot: text('task_title_snapshot').notNull(),
    actualDurationSeconds: real('actual_duration_seconds'),
    durationCoverage: text('duration_coverage', {
      enum: durationCoverageValues,
    }).notNull(),
    achievementDisposition: text('achievement_disposition', {
      enum: achievementDispositionValues,
    }).notNull(),
    source: text('source', { enum: completionSourceValues }).notNull(),
  },
  (table) => [
    uniqueIndex('completion_records_task_id_unique').on(table.taskId),
    uniqueIndex('completion_records_operation_id_unique').on(table.operationId),
    check(
      'completion_records_title_nonempty',
      sql`length(trim(${table.taskTitleSnapshot})) > 0`,
    ),
    check(
      'completion_records_duration_nonnegative',
      sql`${table.actualDurationSeconds} is null or ${table.actualDurationSeconds} >= 0`,
    ),
    check(
      'completion_records_coverage_has_duration',
      sql`${table.durationCoverage} = 'unknown' or ${table.actualDurationSeconds} is not null`,
    ),
    check(
      'completion_records_coverage_valid',
      sql`${table.durationCoverage} in ('complete', 'partial', 'unknown')`,
    ),
    check(
      'completion_records_disposition_valid',
      sql`${table.achievementDisposition} in ('record', 'skip')`,
    ),
    check(
      'completion_records_source_valid',
      sql`${table.source} in ('user', 'agent_authorized')`,
    ),
  ],
);

export const cloudPlanOrigins = sqliteTable('cloud_plan_origins', {
  id: text('id').primaryKey(),
  originDeviceId: text('origin_device_id').notNull(),
  sourceRevision: integer('source_revision').notNull(),
  committedAt: text('committed_at').notNull(),
  schedulerVersion: text('scheduler_version').notNull(),
  policyVersion: text('policy_version').notNull(),
  timeZone: text('time_zone').notNull(),
  reason: text('reason').notNull(),
  affectedBlockIds: text('affected_block_ids', { mode: 'json' }).notNull(),
});

export const cloudProfileClaim = sqliteTable('cloud_profile_claim', {
  sourceName: text('source_name').primaryKey(),
  userId: text('user_id').notNull(),
});

export const operationProvenance = sqliteTable('operation_provenance', {
  id: text('id').primaryKey(),
  command: text('command').notNull(),
  occurredAt: text('occurred_at').notNull(),
  deviceId: text('device_id').notNull().default('legacy'),
});

export const cloudSyncState = sqliteTable('cloud_sync_state', {
  id: integer('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  userId: text('user_id'),
  cursor: text('cursor').notNull().default('0'),
  projectionEnabled: integer('projection_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
});
export const cloudSyncBootstrap = sqliteTable('cloud_sync_bootstrap', {
  id: integer('id').primaryKey(),
  remoteId: text('remote_id').notNull().default(''),
  revision: text('revision').notNull().default('0'),
  nextPage: integer('next_page').notNull().default(0),
  entitiesJson: text('entities_json').notNull().default('[]'),
  complete: integer('complete').notNull().default(0),
});
export const cloudSyncVersions = sqliteTable('cloud_sync_versions', {
  entityKey: text('entity_key').primaryKey(),
  version: text('version').notNull(),
  ownerDeviceId: text('owner_device_id').notNull(),
  valueJson: text('value_json').notNull(),
});
export const cloudSyncOutbox = sqliteTable('cloud_sync_outbox', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  batchId: text('batch_id').notNull().unique(),
  payloadJson: text('payload_json').notNull(),
  status: text('status').notNull().default('pending'),
  conflictId: text('conflict_id'),
});
export const cloudSyncConflicts = sqliteTable('cloud_sync_conflicts', {
  id: text('id').primaryKey(),
  localJson: text('local_json').notNull(),
  remoteJson: text('remote_json').notNull(),
  status: text('status').notNull().default('open'),
});

export const phase5CompletionRecords = sqliteTable(
  'completion_records',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    sourceSessionId: text('source_session_id').references(
      () => executionSessions.id,
      {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      },
    ),
    operationId: text('operation_id')
      .notNull()
      .references(() => operationRecords.operationId, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    completedAt: text('completed_at').notNull(),
    taskTitleSnapshot: text('task_title_snapshot').notNull(),
    actualDurationSeconds: real('actual_duration_seconds'),
    durationCoverage: text('duration_coverage', {
      enum: durationCoverageValues,
    }).notNull(),
    achievementDisposition: text('achievement_disposition', {
      enum: achievementDispositionValues,
    }).notNull(),
    source: text('source', { enum: completionSourceValues }).notNull(),
  },
  (table) => [
    uniqueIndex('completion_records_task_id_unique').on(table.taskId),
    uniqueIndex('completion_records_operation_id_unique').on(table.operationId),
    check(
      'completion_records_title_nonempty',
      sql`length(trim(${table.taskTitleSnapshot})) > 0`,
    ),
    check(
      'completion_records_duration_nonnegative',
      sql`${table.actualDurationSeconds} is null or ${table.actualDurationSeconds} >= 0`,
    ),
    check(
      'completion_records_coverage_has_duration',
      sql`${table.durationCoverage} = 'unknown' or ${table.actualDurationSeconds} is not null`,
    ),
    check(
      'completion_records_coverage_valid',
      sql`${table.durationCoverage} in ('complete', 'partial', 'unknown')`,
    ),
    check(
      'completion_records_disposition_valid',
      sql`${table.achievementDisposition} in ('record', 'skip')`,
    ),
    check(
      'completion_records_source_valid',
      sql`${table.source} in ('user', 'agent_authorized')`,
    ),
  ],
);

export const completionRecords = sqliteTable(
  'completion_records',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    sourceSessionId: text('source_session_id').references(
      () => executionSessions.id,
      {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      },
    ),
    operationId: text('operation_id')
      .notNull()
      .references(() => operationProvenance.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    completedAt: text('completed_at').notNull(),
    taskTitleSnapshot: text('task_title_snapshot').notNull(),
    actualDurationSeconds: real('actual_duration_seconds'),
    durationCoverage: text('duration_coverage', {
      enum: durationCoverageValues,
    }).notNull(),
    achievementDisposition: text('achievement_disposition', {
      enum: achievementDispositionValues,
    }).notNull(),
    source: text('source', { enum: completionSourceValues }).notNull(),
  },
  (table) => [
    uniqueIndex('completion_records_task_id_unique').on(table.taskId),
    uniqueIndex('completion_records_operation_id_unique').on(table.operationId),
    check(
      'completion_records_title_nonempty',
      sql`length(trim(${table.taskTitleSnapshot})) > 0`,
    ),
    check(
      'completion_records_duration_nonnegative',
      sql`${table.actualDurationSeconds} is null or ${table.actualDurationSeconds} >= 0`,
    ),
    check(
      'completion_records_coverage_has_duration',
      sql`${table.durationCoverage} = 'unknown' or ${table.actualDurationSeconds} is not null`,
    ),
    check(
      'completion_records_coverage_valid',
      sql`${table.durationCoverage} in ('complete', 'partial', 'unknown')`,
    ),
    check(
      'completion_records_disposition_valid',
      sql`${table.achievementDisposition} in ('record', 'skip')`,
    ),
    check(
      'completion_records_source_valid',
      sql`${table.source} in ('user', 'agent_authorized')`,
    ),
  ],
);

export const achievements = sqliteTable(
  'achievements',
  {
    id: text('id').primaryKey(),
    sourceCompletionRecordId: text('source_completion_record_id')
      .notNull()
      .references(() => completionRecords.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    sourceTaskId: text('source_task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    sourceExecutionSessionId: text('source_execution_session_id').references(
      () => executionSessions.id,
      {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      },
    ),
    title: text('title').notNull(),
    summary: text('summary'),
    evidenceType: text('evidence_type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    userEdited: integer('user_edited', { mode: 'boolean' }).notNull(),
    hidden: integer('hidden', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('achievements_completion_unique').on(
      table.sourceCompletionRecordId,
    ),
    check('achievements_title_nonempty', sql`length(trim(${table.title})) > 0`),
    check(
      'achievements_evidence_type_nonempty',
      sql`length(trim(${table.evidenceType})) > 0`,
    ),
    check(
      'achievements_user_edited_boolean',
      sql`${table.userEdited} in (0, 1)`,
    ),
    check('achievements_hidden_boolean', sql`${table.hidden} in (0, 1)`),
    index('achievements_occurred_at_idx').on(table.occurredAt),
    index('achievements_task_idx').on(table.sourceTaskId),
  ],
);

export const phase1TaskActivityEvents = sqliteTable(
  'task_activity_events',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    timeBlockId: text('time_block_id'),
    eventType: text('event_type').notNull(),
    actor: text('actor').notNull(),
    occurredAt: text('occurred_at').notNull(),
    localDate: text('local_date').notNull(),
    timeZone: text('time_zone').notNull(),
    operationId: text('operation_id')
      .notNull()
      .references(() => operationRecords.operationId, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    beforeSummary: text('before_summary', { mode: 'json' }),
    afterSummary: text('after_summary', { mode: 'json' }),
  },
  (table) => [
    check(
      'task_activity_events_type_nonempty',
      sql`length(trim(${table.eventType})) > 0`,
    ),
    check(
      'task_activity_events_actor_nonempty',
      sql`length(trim(${table.actor})) > 0`,
    ),
    check(
      'task_activity_events_local_date_nonempty',
      sql`length(trim(${table.localDate})) > 0`,
    ),
    check(
      'task_activity_events_time_zone_nonempty',
      sql`length(trim(${table.timeZone})) > 0`,
    ),
    index('task_activity_events_task_occurred_idx').on(
      table.taskId,
      table.occurredAt,
    ),
    index('task_activity_events_operation_id_idx').on(table.operationId),
  ],
);

export const taskActivityEvents = sqliteTable(
  'task_activity_events',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    timeBlockId: text('time_block_id'),
    eventType: text('event_type').notNull(),
    actor: text('actor').notNull(),
    occurredAt: text('occurred_at').notNull(),
    localDate: text('local_date').notNull(),
    timeZone: text('time_zone').notNull(),
    operationId: text('operation_id')
      .notNull()
      .references(() => operationProvenance.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    beforeSummary: text('before_summary', { mode: 'json' }),
    afterSummary: text('after_summary', { mode: 'json' }),
  },
  (table) => [
    check(
      'task_activity_events_type_nonempty',
      sql`length(trim(${table.eventType})) > 0`,
    ),
    check(
      'task_activity_events_actor_nonempty',
      sql`length(trim(${table.actor})) > 0`,
    ),
    check(
      'task_activity_events_local_date_nonempty',
      sql`length(trim(${table.localDate})) > 0`,
    ),
    check(
      'task_activity_events_time_zone_nonempty',
      sql`length(trim(${table.timeZone})) > 0`,
    ),
    index('task_activity_events_task_occurred_idx').on(
      table.taskId,
      table.occurredAt,
    ),
    index('task_activity_events_operation_id_idx').on(table.operationId),
  ],
);

export const scheduleState = sqliteTable(
  'schedule_state',
  {
    id: integer('id').primaryKey(),
    stateVersion: integer('state_version').notNull(),
    planRevision: integer('plan_revision').notNull(),
  },
  (table) => [
    check('schedule_state_singleton', sql`${table.id} = 1`),
    check(
      'schedule_state_version_nonnegative',
      sql`${table.stateVersion} >= 0`,
    ),
    check(
      'schedule_state_revision_nonnegative',
      sql`${table.planRevision} >= 0`,
    ),
  ],
);

export const schedulePlans = sqliteTable(
  'schedule_plans',
  {
    id: text('id').primaryKey(),
    planRevision: integer('plan_revision').notNull(),
    basedOnStateVersion: integer('based_on_state_version').notNull(),
    status: text('status', { enum: ['committed'] }).notNull(),
    createdAt: text('created_at').notNull(),
    committedAt: text('committed_at').notNull(),
    inputHash: text('input_hash').notNull(),
    schedulerVersion: text('scheduler_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    timeZone: text('time_zone').notNull(),
    horizonStart: text('horizon_start').notNull(),
    horizonEnd: text('horizon_end').notNull(),
    reason: text('reason').notNull(),
  },
  (table) => [
    uniqueIndex('schedule_plans_plan_revision_unique').on(table.planRevision),
    check('schedule_plans_revision_positive', sql`${table.planRevision} > 0`),
    check(
      'schedule_plans_base_version_nonnegative',
      sql`${table.basedOnStateVersion} >= 0`,
    ),
    check('schedule_plans_status_valid', sql`${table.status} = 'committed'`),
    check(
      'schedule_plans_input_hash_nonempty',
      sql`length(trim(${table.inputHash})) > 0`,
    ),
    check(
      'schedule_plans_scheduler_version_nonempty',
      sql`length(trim(${table.schedulerVersion})) > 0`,
    ),
    check(
      'schedule_plans_policy_version_nonempty',
      sql`length(trim(${table.policyVersion})) > 0`,
    ),
    check(
      'schedule_plans_time_zone_nonempty',
      sql`length(trim(${table.timeZone})) > 0`,
    ),
    check(
      'schedule_plans_horizon_valid',
      sql`${table.horizonEnd} > ${table.horizonStart}`,
    ),
    check(
      'schedule_plans_reason_nonempty',
      sql`length(trim(${table.reason})) > 0`,
    ),
    index('schedule_plans_committed_at_idx').on(table.committedAt),
  ],
);

export const timeBlocks = sqliteTable(
  'time_blocks',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => tasks.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    type: text('type', { enum: timeBlockTypeValues }).notNull(),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    status: text('status', { enum: timeBlockStatusValues }).notNull(),
    source: text('source').notNull(),
    locked: integer('locked', { mode: 'boolean' }).notNull(),
    planRevision: integer('plan_revision').notNull(),
    externalCalendarEventId: text('external_calendar_event_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'time_blocks_type_valid',
      sql`${table.type} in ('task', 'break', 'relax', 'buffer')`,
    ),
    check(
      'time_blocks_status_valid',
      sql`${table.status} in ('planned', 'started', 'completed', 'skipped', 'canceled')`,
    ),
    check('time_blocks_interval_valid', sql`${table.endAt} > ${table.startAt}`),
    check(
      'time_blocks_task_reference_required',
      sql`${table.type} <> 'task' or ${table.taskId} is not null`,
    ),
    check(
      'time_blocks_source_nonempty',
      sql`length(trim(${table.source})) > 0`,
    ),
    check(
      'time_blocks_external_event_nonempty',
      sql`${table.externalCalendarEventId} is null or length(trim(${table.externalCalendarEventId})) > 0`,
    ),
    check('time_blocks_locked_boolean', sql`${table.locked} in (0, 1)`),
    check('time_blocks_revision_nonnegative', sql`${table.planRevision} >= 0`),
    index('time_blocks_start_end_idx').on(table.startAt, table.endAt),
    index('time_blocks_task_id_idx').on(table.taskId),
    index('time_blocks_plan_revision_idx').on(table.planRevision),
    index('time_blocks_status_idx').on(table.status),
  ],
);

export const integrationJobs = sqliteTable(
  'integration_jobs',
  {
    id: text('id').primaryKey(),
    operationId: text('operation_id')
      .notNull()
      .references(() => operationRecords.operationId, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    targetChannel: text('target_channel', {
      enum: integrationTargetChannelValues,
    }).notNull(),
    targetEntityType: text('target_entity_type', {
      enum: ['schedule_plan'],
    }).notNull(),
    targetEntityId: text('target_entity_id')
      .notNull()
      .references(() => schedulePlans.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    desiredRevision: integer('desired_revision').notNull(),
    desiredAction: text('desired_action').notNull(),
    status: text('status', { enum: integrationJobStatusValues }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    automaticRetryEligible: integer('automatic_retry_eligible', {
      mode: 'boolean',
    }).notNull(),
    claimToken: text('claim_token'),
    leaseExpiresAt: text('lease_expires_at'),
    notBefore: text('not_before').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('integration_jobs_desired_target_unique').on(
      table.targetChannel,
      table.targetEntityType,
      table.targetEntityId,
      table.desiredRevision,
      table.desiredAction,
    ),
    check(
      'integration_jobs_target_channel_valid',
      sql`${table.targetChannel} in ('calendar', 'notification')`,
    ),
    check(
      'integration_jobs_target_entity_type_valid',
      sql`${table.targetEntityType} = 'schedule_plan'`,
    ),
    check(
      'integration_jobs_target_entity_id_nonempty',
      sql`length(trim(${table.targetEntityId})) > 0`,
    ),
    check(
      'integration_jobs_revision_nonnegative',
      sql`${table.desiredRevision} >= 0`,
    ),
    check(
      'integration_jobs_action_valid',
      sql`${table.desiredAction} = 'reconcile'`,
    ),
    check(
      'integration_jobs_status_valid',
      sql`${table.status} in ('pending', 'processing', 'succeeded', 'permission_required', 'failed', 'disabled', 'reconciliation_required', 'superseded')`,
    ),
    check(
      'integration_jobs_attempt_count_nonnegative',
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      'integration_jobs_last_error_nonempty',
      sql`${table.lastErrorCode} is null or length(trim(${table.lastErrorCode})) > 0`,
    ),
    check(
      'integration_jobs_auto_retry_boolean',
      sql`${table.automaticRetryEligible} in (0, 1)`,
    ),
    check(
      'integration_jobs_auto_retry_status_valid',
      sql`(${table.status} in ('pending', 'processing') and ${table.automaticRetryEligible} = 1)
          or (${table.status} in ('succeeded', 'permission_required', 'disabled', 'superseded') and ${table.automaticRetryEligible} = 0)
          or ${table.status} in ('failed', 'reconciliation_required')`,
    ),
    check(
      'integration_jobs_claim_token_nonempty',
      sql`${table.claimToken} is null or length(trim(${table.claimToken})) > 0`,
    ),
    check(
      'integration_jobs_claim_lease_consistent',
      sql`(${table.status} = 'processing' and ${table.claimToken} is not null and ${table.leaseExpiresAt} is not null)
          or (${table.status} <> 'processing' and ${table.claimToken} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      'integration_jobs_processing_lease_future',
      sql`${table.status} <> 'processing' or ${table.leaseExpiresAt} > ${table.updatedAt}`,
    ),
    index('integration_jobs_operation_id_idx').on(table.operationId),
    index('integration_jobs_status_updated_idx').on(
      table.status,
      table.updatedAt,
    ),
    index('integration_jobs_channel_runnable_idx').on(
      table.targetChannel,
      table.status,
      table.automaticRetryEligible,
      table.notBefore,
      table.desiredRevision,
    ),
    index('integration_jobs_channel_lease_idx').on(
      table.targetChannel,
      table.status,
      table.leaseExpiresAt,
    ),
    index('integration_jobs_target_revision_idx').on(
      table.targetChannel,
      table.targetEntityType,
      table.targetEntityId,
      table.desiredRevision,
    ),
  ],
);

export const externalMutationIntents = sqliteTable(
  'external_mutation_intents',
  {
    id: text('id').primaryKey(),
    integrationJobId: text('integration_job_id')
      .notNull()
      .references(() => integrationJobs.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    desiredRevision: integer('desired_revision').notNull(),
    scopeKey: text('scope_key').notNull(),
    action: text('action', {
      enum: externalMutationIntentActionValues,
    }).notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('external_mutation_intents_job_unique').on(
      table.integrationJobId,
    ),
    uniqueIndex('external_mutation_intents_scope_unique').on(table.scopeKey),
    check(
      'external_mutation_intents_revision_nonnegative',
      sql`${table.desiredRevision} >= 0`,
    ),
    check(
      'external_mutation_intents_scope_nonempty',
      sql`length(trim(${table.scopeKey})) > 0`,
    ),
    check(
      'external_mutation_intents_action_valid',
      sql`${table.action} in ('calendar_provision', 'calendar_event_create', 'calendar_event_update', 'calendar_event_delete', 'notification_schedule', 'notification_cancel')`,
    ),
    check(
      'external_mutation_intents_payload_valid',
      sql`json_valid(${table.payloadJson}) and json_type(${table.payloadJson}) = 'object'`,
    ),
    index('external_mutation_intents_revision_action_idx').on(
      table.desiredRevision,
      table.action,
    ),
  ],
);

export const externalCalendarEventSnapshots = sqliteTable(
  'external_calendar_event_snapshots',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    calendarId: text('calendar_id').notNull(),
    externalEventId: text('external_event_id').notNull(),
    occurrenceKey: text('occurrence_key'),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    busy: integer('busy', { mode: 'boolean' }).notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    contentHash: text('content_hash').notNull(),
  },
  (table) => [
    check(
      'external_calendar_snapshots_provider_nonempty',
      sql`length(trim(${table.provider})) > 0`,
    ),
    check(
      'external_calendar_snapshots_calendar_nonempty',
      sql`length(trim(${table.calendarId})) > 0`,
    ),
    check(
      'external_calendar_snapshots_event_nonempty',
      sql`length(trim(${table.externalEventId})) > 0`,
    ),
    check(
      'external_calendar_snapshots_occurrence_nonempty',
      sql`${table.occurrenceKey} is null or length(trim(${table.occurrenceKey})) > 0`,
    ),
    check(
      'external_calendar_snapshots_interval_valid',
      sql`${table.endAt} > ${table.startAt}`,
    ),
    check(
      'external_calendar_snapshots_busy_boolean',
      sql`${table.busy} in (0, 1)`,
    ),
    check(
      'external_calendar_snapshots_content_hash_nonempty',
      sql`length(trim(${table.contentHash})) > 0`,
    ),
    uniqueIndex('external_calendar_snapshots_singleton_unique')
      .on(table.provider, table.calendarId, table.externalEventId)
      .where(sql`${table.occurrenceKey} is null`),
    uniqueIndex('external_calendar_snapshots_occurrence_unique')
      .on(
        table.provider,
        table.calendarId,
        table.externalEventId,
        table.occurrenceKey,
      )
      .where(sql`${table.occurrenceKey} is not null`),
    index('external_calendar_snapshots_scope_interval_idx').on(
      table.provider,
      table.calendarId,
      table.startAt,
      table.endAt,
    ),
    index('external_calendar_snapshots_scope_seen_idx').on(
      table.provider,
      table.calendarId,
      table.lastSeenAt,
    ),
  ],
);

export const calendarRefreshCoverages = sqliteTable(
  'calendar_refresh_coverages',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    calendarId: text('calendar_id').notNull(),
    rangeStart: text('range_start').notNull(),
    rangeEnd: text('range_end').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    completeness: text('completeness', { enum: ['complete'] }).notNull(),
    observedEventCount: integer('observed_event_count').notNull(),
  },
  (table) => [
    check(
      'calendar_refresh_coverages_provider_nonempty',
      sql`length(trim(${table.provider})) > 0`,
    ),
    check(
      'calendar_refresh_coverages_calendar_nonempty',
      sql`length(trim(${table.calendarId})) > 0`,
    ),
    check(
      'calendar_refresh_coverages_range_valid',
      sql`${table.rangeEnd} > ${table.rangeStart}`,
    ),
    check(
      'calendar_refresh_coverages_complete_only',
      sql`${table.completeness} = 'complete'`,
    ),
    check(
      'calendar_refresh_coverages_count_nonnegative',
      sql`${table.observedEventCount} >= 0`,
    ),
    index('calendar_refresh_coverages_scope_fetched_idx').on(
      table.provider,
      table.calendarId,
      table.fetchedAt,
    ),
    index('calendar_refresh_coverages_scope_range_idx').on(
      table.provider,
      table.calendarId,
      table.rangeStart,
      table.rangeEnd,
    ),
  ],
);

export const calendarContainerBindings = sqliteTable(
  'calendar_container_bindings',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    calendarId: text('calendar_id').notNull(),
    ownershipKey: text('ownership_key').notNull(),
    ownershipVerified: integer('ownership_verified', {
      mode: 'boolean',
    }).notNull(),
    status: text('status', { enum: integrationBindingStatusValues }).notNull(),
    verifiedAt: text('verified_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('calendar_container_bindings_ownership_unique').on(
      table.provider,
      table.ownershipKey,
    ),
    uniqueIndex('calendar_container_bindings_calendar_unique').on(
      table.provider,
      table.calendarId,
    ),
    uniqueIndex('calendar_container_bindings_authority_unique').on(
      table.provider,
      table.calendarId,
      table.ownershipKey,
    ),
    check(
      'calendar_container_bindings_provider_nonempty',
      sql`length(trim(${table.provider})) > 0`,
    ),
    check(
      'calendar_container_bindings_calendar_nonempty',
      sql`length(trim(${table.calendarId})) > 0`,
    ),
    check(
      'calendar_container_bindings_ownership_nonempty',
      sql`length(trim(${table.ownershipKey})) > 0`,
    ),
    check(
      'calendar_container_bindings_verified_true',
      sql`${table.ownershipVerified} = 1`,
    ),
    check(
      'calendar_container_bindings_status_valid',
      sql`${table.status} in ('synced', 'pending', 'permission_required', 'failed', 'disabled', 'reconciliation_required', 'conflict')`,
    ),
    index('calendar_container_bindings_calendar_idx').on(
      table.provider,
      table.calendarId,
    ),
  ],
);

export const calendarBindings = sqliteTable(
  'calendar_bindings',
  {
    id: text('id').primaryKey(),
    timeBlockId: text('time_block_id')
      .notNull()
      .references(() => timeBlocks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    provider: text('provider').notNull(),
    calendarId: text('calendar_id').notNull(),
    externalEventId: text('external_event_id').notNull(),
    occurrenceKey: text('occurrence_key'),
    ownershipKey: text('ownership_key').notNull(),
    ownershipVerified: integer('ownership_verified', {
      mode: 'boolean',
    }).notNull(),
    appliedContentHash: text('applied_content_hash').notNull(),
    appliedStartAt: text('applied_start_at').notNull(),
    appliedEndAt: text('applied_end_at').notNull(),
    lastAppliedRevision: integer('last_applied_revision').notNull(),
    status: text('status', { enum: integrationBindingStatusValues }).notNull(),
    verifiedAt: text('verified_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('calendar_bindings_time_block_unique').on(table.timeBlockId),
    uniqueIndex('calendar_bindings_singleton_unique')
      .on(table.provider, table.calendarId, table.externalEventId)
      .where(sql`${table.occurrenceKey} is null`),
    uniqueIndex('calendar_bindings_occurrence_unique')
      .on(
        table.provider,
        table.calendarId,
        table.externalEventId,
        table.occurrenceKey,
      )
      .where(sql`${table.occurrenceKey} is not null`),
    check(
      'calendar_bindings_provider_nonempty',
      sql`length(trim(${table.provider})) > 0`,
    ),
    check(
      'calendar_bindings_calendar_nonempty',
      sql`length(trim(${table.calendarId})) > 0`,
    ),
    check(
      'calendar_bindings_event_nonempty',
      sql`length(trim(${table.externalEventId})) > 0`,
    ),
    check(
      'calendar_bindings_occurrence_nonempty',
      sql`${table.occurrenceKey} is null or length(trim(${table.occurrenceKey})) > 0`,
    ),
    check(
      'calendar_bindings_ownership_nonempty',
      sql`length(trim(${table.ownershipKey})) > 0`,
    ),
    check(
      'calendar_bindings_verified_true',
      sql`${table.ownershipVerified} = 1`,
    ),
    check(
      'calendar_bindings_content_hash_nonempty',
      sql`length(trim(${table.appliedContentHash})) > 0`,
    ),
    check(
      'calendar_bindings_interval_valid',
      sql`${table.appliedEndAt} > ${table.appliedStartAt}`,
    ),
    check(
      'calendar_bindings_revision_nonnegative',
      sql`${table.lastAppliedRevision} >= 0`,
    ),
    check(
      'calendar_bindings_status_valid',
      sql`${table.status} in ('synced', 'pending', 'permission_required', 'failed', 'disabled', 'reconciliation_required', 'conflict')`,
    ),
    foreignKey({
      columns: [table.provider, table.calendarId, table.ownershipKey],
      foreignColumns: [
        calendarContainerBindings.provider,
        calendarContainerBindings.calendarId,
        calendarContainerBindings.ownershipKey,
      ],
      name: 'calendar_bindings_container_authority_fk',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    index('calendar_bindings_status_idx').on(table.status),
  ],
);

export const notificationBindings = sqliteTable(
  'notification_bindings',
  {
    id: text('id').primaryKey(),
    timeBlockId: text('time_block_id')
      .notNull()
      .references(() => timeBlocks.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    taskId: text('task_id').references(() => tasks.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    osNotificationId: text('os_notification_id').notNull(),
    type: text('type').notNull(),
    appliedContentHash: text('applied_content_hash').notNull(),
    scheduledAt: text('scheduled_at').notNull(),
    desiredRevision: integer('desired_revision').notNull(),
    lastAppliedRevision: integer('last_applied_revision').notNull(),
    status: text('status', { enum: integrationBindingStatusValues }).notNull(),
    identityVerified: integer('identity_verified', {
      mode: 'boolean',
    }).notNull(),
    verifiedAt: text('verified_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('notification_bindings_identity_unique').on(
      table.timeBlockId,
      table.type,
    ),
    uniqueIndex('notification_bindings_os_id_unique').on(
      table.osNotificationId,
    ),
    check(
      'notification_bindings_os_id_nonempty',
      sql`length(trim(${table.osNotificationId})) > 0`,
    ),
    check(
      'notification_bindings_type_nonempty',
      sql`length(trim(${table.type})) > 0`,
    ),
    check(
      'notification_bindings_content_hash_nonempty',
      sql`length(trim(${table.appliedContentHash})) > 0`,
    ),
    check(
      'notification_bindings_revision_nonnegative',
      sql`${table.desiredRevision} >= 0 and ${table.lastAppliedRevision} >= 0`,
    ),
    check(
      'notification_bindings_revision_order_valid',
      sql`${table.desiredRevision} >= ${table.lastAppliedRevision}`,
    ),
    check(
      'notification_bindings_synced_revision_valid',
      sql`${table.status} <> 'synced' or ${table.desiredRevision} = ${table.lastAppliedRevision}`,
    ),
    check(
      'notification_bindings_status_valid',
      sql`${table.status} in ('synced', 'pending', 'permission_required', 'failed', 'disabled', 'reconciliation_required', 'conflict')`,
    ),
    check(
      'notification_bindings_identity_verified_true',
      sql`${table.identityVerified} = 1`,
    ),
    index('notification_bindings_task_idx').on(table.taskId),
    index('notification_bindings_status_scheduled_idx').on(
      table.status,
      table.scheduledAt,
    ),
  ],
);

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('user_preferences_key_unique').on(table.key),
    check('user_preferences_key_nonempty', sql`length(trim(${table.key})) > 0`),
    check(
      'user_preferences_value_json_valid',
      sql`json_valid(${table.valueJson})`,
    ),
    index('user_preferences_updated_at_idx').on(table.updatedAt),
  ],
);

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    status: text('status', { enum: agentRunStatusValues }).notNull(),
    trigger: text('trigger', { enum: agentRunTriggerValues }).notNull(),
    modelProvider: text('model_provider'),
    turnCount: integer('turn_count').notNull(),
    errorCode: text('error_code'),
  },
  (table) => [
    check(
      'agent_runs_status_valid',
      sql`${table.status} in ('running', 'completed', 'max_turns', 'max_tool_calls', 'aborted', 'failed')`,
    ),
    check(
      'agent_runs_trigger_valid',
      sql`${table.trigger} in ('user_input', 'foreground_resume', 'task_completed', 'calendar_changed', 'notification_opened', 'background_window', 'manual_replan')`,
    ),
    check('agent_runs_turn_count_nonnegative', sql`${table.turnCount} >= 0`),
    check(
      'agent_runs_model_provider_nonempty',
      sql`${table.modelProvider} is null or length(trim(${table.modelProvider})) > 0`,
    ),
    check(
      'agent_runs_error_code_nonempty',
      sql`${table.errorCode} is null or length(trim(${table.errorCode})) > 0`,
    ),
    check(
      'agent_runs_lifecycle_valid',
      sql`(${table.status} = 'running' and ${table.endedAt} is null and ${table.errorCode} is null)
        or (${table.status} in ('completed', 'max_turns', 'max_tool_calls') and ${table.endedAt} is not null and ${table.errorCode} is null)
        or (${table.status} in ('aborted', 'failed') and ${table.endedAt} is not null and ${table.errorCode} is not null)`,
    ),
    check(
      'agent_runs_end_order_valid',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    index('agent_runs_status_started_idx').on(table.status, table.startedAt),
  ],
);

export const userModelFeatures = sqliteTable(
  'user_model_features',
  {
    id: text('id').primaryKey(),
    featureKey: text('feature_key').notNull(),
    scopeKey: text('scope_key').notNull().default(''),
    numericValue: real('numeric_value').notNull(),
    windowStart: text('window_start').notNull(),
    windowEnd: text('window_end').notNull(),
    sourceStateVersion: integer('source_state_version').notNull(),
    sampleCount: integer('sample_count').notNull(),
    confidence: real('confidence').notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    lastUpdatedAt: text('last_updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('user_model_features_identity_unique').on(
      table.algorithmVersion,
      table.featureKey,
      table.scopeKey,
    ),
    check(
      'user_model_features_feature_key_nonempty',
      sql`length(trim(${table.featureKey})) > 0`,
    ),
    check(
      'user_model_features_scope_key_trimmed',
      sql`${table.scopeKey} = trim(${table.scopeKey})`,
    ),
    check(
      'user_model_features_numeric_finite',
      sql`${table.numericValue} = ${table.numericValue} and abs(${table.numericValue}) <= ${Number.MAX_SAFE_INTEGER}`,
    ),
    check(
      'user_model_features_window_valid',
      sql`${table.windowEnd} > ${table.windowStart}`,
    ),
    check(
      'user_model_features_source_version_nonnegative',
      sql`${table.sourceStateVersion} >= 0`,
    ),
    check(
      'user_model_features_sample_count_nonnegative',
      sql`${table.sampleCount} >= 0`,
    ),
    check(
      'user_model_features_confidence_valid',
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
    check(
      'user_model_features_algorithm_nonempty',
      sql`length(trim(${table.algorithmVersion})) > 0`,
    ),
    index('user_model_features_algorithm_updated_idx').on(
      table.algorithmVersion,
      table.lastUpdatedAt,
    ),
    index('user_model_features_source_version_idx').on(
      table.sourceStateVersion,
    ),
  ],
);

export const dailyReflections = sqliteTable(
  'daily_reflections',
  {
    id: text('id').primaryKey(),
    localDate: text('local_date').notNull(),
    timeZone: text('time_zone').notNull(),
    summary: text('summary').notNull(),
    winsJson: text('wins_json').notNull(),
    adjustmentSuggestion: text('adjustment_suggestion'),
    userNote: text('user_note'),
    generatedBy: text('generated_by', {
      enum: reflectionGeneratedByValues,
    }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('daily_reflections_local_day_unique').on(
      table.localDate,
      table.timeZone,
    ),
    check(
      'daily_reflections_summary_nonempty',
      sql`length(trim(${table.summary})) > 0`,
    ),
    check(
      'daily_reflections_local_date_nonempty',
      sql`length(trim(${table.localDate})) > 0`,
    ),
    check(
      'daily_reflections_time_zone_nonempty',
      sql`length(trim(${table.timeZone})) > 0`,
    ),
    check(
      'daily_reflections_wins_json_valid',
      sql`json_valid(${table.winsJson}) and json_type(${table.winsJson}) = 'array' and json_array_length(${table.winsJson}) <= 3`,
    ),
    check(
      'daily_reflections_adjustment_nonempty',
      sql`${table.adjustmentSuggestion} is null or length(trim(${table.adjustmentSuggestion})) > 0`,
    ),
    check(
      'daily_reflections_user_note_valid',
      sql`${table.userNote} is null or (length(trim(${table.userNote})) > 0 and length(${table.userNote}) <= 4000)`,
    ),
    check(
      'daily_reflections_generated_by_valid',
      sql`${table.generatedBy} in ('local_facts', 'model_validated')`,
    ),
    check(
      'daily_reflections_updated_order_valid',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    index('daily_reflections_updated_at_idx').on(table.updatedAt),
  ],
);

export const energyCheckIns = sqliteTable(
  'energy_check_ins',
  {
    id: text('id').primaryKey(),
    localDate: text('local_date').notNull(),
    timeZone: text('time_zone').notNull(),
    level: integer('level').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check(
      'energy_check_ins_local_date_nonempty',
      sql`length(trim(${table.localDate})) > 0`,
    ),
    check(
      'energy_check_ins_time_zone_nonempty',
      sql`length(trim(${table.timeZone})) > 0`,
    ),
    check('energy_check_ins_level_valid', sql`${table.level} between 1 and 5`),
    check(
      'energy_check_ins_note_valid',
      sql`${table.note} is null or (length(trim(${table.note})) > 0 and length(${table.note}) <= 4000)`,
    ),
    index('energy_check_ins_local_day_created_idx').on(
      table.localDate,
      table.timeZone,
      table.createdAt,
    ),
    index('energy_check_ins_created_at_idx').on(table.createdAt),
  ],
);

export const relaxSessions = sqliteTable(
  'relax_sessions',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: relaxTypeValues }).notNull(),
    plannedMinutes: integer('planned_minutes').notNull(),
    actualSeconds: integer('actual_seconds'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    source: text('source', { enum: relaxSourceValues }).notNull(),
    status: text('status', { enum: relaxStatusValues }).notNull(),
    timingQuality: text('timing_quality', {
      enum: relaxTimingQualityValues,
    }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('relax_sessions_single_active_unique')
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
    check(
      'relax_sessions_type_valid',
      sql`${table.type} in ('breathing', 'pause', 'stretch', 'ambient')`,
    ),
    check(
      'relax_sessions_planned_minutes_positive',
      sql`${table.plannedMinutes} between 1 and 60`,
    ),
    check(
      'relax_sessions_actual_seconds_nonnegative',
      sql`${table.actualSeconds} is null or ${table.actualSeconds} >= 0`,
    ),
    check(
      'relax_sessions_source_valid',
      sql`${table.source} in ('relax_tab', 'today', 'focus')`,
    ),
    check(
      'relax_sessions_status_valid',
      sql`${table.status} in ('active', 'completed', 'abandoned')`,
    ),
    check(
      'relax_sessions_timing_quality_valid',
      sql`${table.timingQuality} in ('trusted', 'needs_review')`,
    ),
    check(
      'relax_sessions_lifecycle_valid',
      sql`(${table.status} = 'active' and ${table.endedAt} is null and ${table.actualSeconds} is null)
        or (${table.status} in ('completed', 'abandoned') and ${table.endedAt} is not null and ${table.actualSeconds} is not null)`,
    ),
    check(
      'relax_sessions_end_order_valid',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    index('relax_sessions_started_at_idx').on(table.startedAt),
  ],
);

export const phase1Schema = {
  goals,
  projects,
  tasks,
  operationRecords,
  completionRecords: phase1CompletionRecords,
  taskActivityEvents: phase1TaskActivityEvents,
  scheduleState,
} as const;

export const phase2Schema = {
  schedulePlans,
  timeBlocks,
  integrationJobs,
} as const;

export const phase3Schema = {
  externalMutationIntents,
  externalCalendarEventSnapshots,
  calendarRefreshCoverages,
  calendarContainerBindings,
  calendarBindings,
  notificationBindings,
} as const;

export const phase4Schema = {
  userPreferences,
} as const;

export const phase5Schema = {
  completionRecords,
  executionSessions,
  executionIntervals,
  achievements,
} as const;

export const phase6Schema = {
  agentRuns,
} as const;

export const phase7Schema = {
  userModelFeatures,
} as const;

export const phase8Schema = {
  dailyReflections,
  energyCheckIns,
  relaxSessions,
} as const;

export const phaseCloudSchema = {
  cloudPlanOrigins,
  cloudProfileClaim,
  operationProvenance,
  cloudSyncState,
  cloudSyncBootstrap,
  cloudSyncVersions,
  cloudSyncOutbox,
  cloudSyncConflicts,
};

export const databaseSchema = {
  ...phaseCloudSchema,
  ...phase1Schema,
  ...phase2Schema,
  ...phase3Schema,
  ...phase4Schema,
  ...phase5Schema,
  ...phase6Schema,
  ...phase7Schema,
  ...phase8Schema,
  taskActivityEvents,
  completionRecords,
} as const;
