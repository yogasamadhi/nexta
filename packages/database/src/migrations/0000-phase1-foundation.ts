export const phase1FoundationSql = `
CREATE TABLE \`goals\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`title\` text NOT NULL,
  \`description\` text DEFAULT '' NOT NULL,
  \`status\` text NOT NULL,
  \`target_date\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  \`archived_at\` text,
  CONSTRAINT \`goals_title_nonempty\` CHECK (length(trim(\`title\`)) > 0),
  CONSTRAINT \`goals_status_nonempty\` CHECK (length(trim(\`status\`)) > 0)
);
--> statement-breakpoint
CREATE INDEX \`goals_status_idx\` ON \`goals\` (\`status\`);
--> statement-breakpoint
CREATE INDEX \`goals_archived_at_idx\` ON \`goals\` (\`archived_at\`);
--> statement-breakpoint
CREATE TABLE \`projects\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`goal_id\` text,
  \`title\` text NOT NULL,
  \`description\` text DEFAULT '' NOT NULL,
  \`status\` text NOT NULL,
  \`deadline\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  \`archived_at\` text,
  CONSTRAINT \`projects_title_nonempty\` CHECK (length(trim(\`title\`)) > 0),
  CONSTRAINT \`projects_status_nonempty\` CHECK (length(trim(\`status\`)) > 0),
  FOREIGN KEY (\`goal_id\`) REFERENCES \`goals\` (\`id\`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX \`projects_goal_id_idx\` ON \`projects\` (\`goal_id\`);
--> statement-breakpoint
CREATE INDEX \`projects_status_idx\` ON \`projects\` (\`status\`);
--> statement-breakpoint
CREATE INDEX \`projects_archived_at_idx\` ON \`projects\` (\`archived_at\`);
--> statement-breakpoint
CREATE TABLE \`tasks\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`project_id\` text,
  \`goal_id\` text,
  \`parent_task_id\` text,
  \`title\` text NOT NULL,
  \`description\` text,
  \`status\` text NOT NULL,
  \`priority\` text NOT NULL,
  \`estimated_duration_minutes\` real,
  \`baseline_estimated_duration_minutes\` real,
  \`actual_duration_minutes\` real,
  \`remaining_duration_minutes\` real,
  \`category_key\` text,
  \`earliest_start_at\` text,
  \`deadline_at\` text,
  \`deadline_local_date\` text,
  \`deadline_time_zone\` text,
  \`splittable\` integer NOT NULL,
  \`min_block_minutes\` real,
  \`max_block_minutes\` real,
  \`energy_demand\` text,
  \`scheduling_policy\` text NOT NULL,
  \`source\` text NOT NULL,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  \`completed_at\` text,
  \`canceled_at\` text,
  CONSTRAINT \`tasks_title_nonempty\` CHECK (length(trim(\`title\`)) > 0),
  CONSTRAINT \`tasks_status_valid\` CHECK (\`status\` IN ('inbox', 'planned', 'in_progress', 'completed', 'canceled')),
  CONSTRAINT \`tasks_priority_nonempty\` CHECK (length(trim(\`priority\`)) > 0),
  CONSTRAINT \`tasks_estimated_duration_positive\` CHECK (\`estimated_duration_minutes\` IS NULL OR \`estimated_duration_minutes\` > 0),
  CONSTRAINT \`tasks_baseline_duration_positive\` CHECK (\`baseline_estimated_duration_minutes\` IS NULL OR \`baseline_estimated_duration_minutes\` > 0),
  CONSTRAINT \`tasks_actual_duration_nonnegative\` CHECK (\`actual_duration_minutes\` IS NULL OR \`actual_duration_minutes\` >= 0),
  CONSTRAINT \`tasks_remaining_duration_positive\` CHECK (\`remaining_duration_minutes\` IS NULL OR \`remaining_duration_minutes\` > 0),
  CONSTRAINT \`tasks_deadline_after_earliest_start\` CHECK (\`deadline_at\` IS NULL OR \`earliest_start_at\` IS NULL OR \`deadline_at\` >= \`earliest_start_at\`),
  CONSTRAINT \`tasks_local_deadline_complete\` CHECK ((\`deadline_local_date\` IS NULL AND \`deadline_time_zone\` IS NULL) OR (\`deadline_local_date\` IS NOT NULL AND \`deadline_time_zone\` IS NOT NULL)),
  CONSTRAINT \`tasks_splittable_boolean\` CHECK (\`splittable\` IN (0, 1)),
  CONSTRAINT \`tasks_min_block_positive\` CHECK (\`min_block_minutes\` IS NULL OR \`min_block_minutes\` > 0),
  CONSTRAINT \`tasks_max_block_positive\` CHECK (\`max_block_minutes\` IS NULL OR \`max_block_minutes\` > 0),
  CONSTRAINT \`tasks_block_range_valid\` CHECK (\`min_block_minutes\` IS NULL OR \`max_block_minutes\` IS NULL OR \`min_block_minutes\` <= \`max_block_minutes\`),
  CONSTRAINT \`tasks_scheduling_policy_nonempty\` CHECK (length(trim(\`scheduling_policy\`)) > 0),
  CONSTRAINT \`tasks_source_nonempty\` CHECK (length(trim(\`source\`)) > 0),
  CONSTRAINT \`tasks_parent_not_self\` CHECK (\`parent_task_id\` IS NULL OR \`parent_task_id\` <> \`id\`),
  CONSTRAINT \`tasks_terminal_timestamps_consistent\` CHECK (
    (\`status\` = 'completed' AND \`completed_at\` IS NOT NULL AND \`canceled_at\` IS NULL)
    OR (\`status\` = 'canceled' AND \`canceled_at\` IS NOT NULL AND \`completed_at\` IS NULL)
    OR (\`status\` IN ('inbox', 'planned', 'in_progress') AND \`completed_at\` IS NULL AND \`canceled_at\` IS NULL)
  ),
  FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (\`goal_id\`) REFERENCES \`goals\` (\`id\`) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (\`parent_task_id\`) REFERENCES \`tasks\` (\`id\`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX \`tasks_project_id_idx\` ON \`tasks\` (\`project_id\`);
--> statement-breakpoint
CREATE INDEX \`tasks_goal_id_idx\` ON \`tasks\` (\`goal_id\`);
--> statement-breakpoint
CREATE INDEX \`tasks_parent_task_id_idx\` ON \`tasks\` (\`parent_task_id\`);
--> statement-breakpoint
CREATE INDEX \`tasks_status_idx\` ON \`tasks\` (\`status\`);
--> statement-breakpoint
CREATE INDEX \`tasks_deadline_at_idx\` ON \`tasks\` (\`deadline_at\`);
--> statement-breakpoint
CREATE TABLE \`operation_records\` (
  \`operation_id\` text PRIMARY KEY NOT NULL,
  \`command_name\` text NOT NULL,
  \`parameter_hash\` text NOT NULL,
  \`result_json\` text NOT NULL,
  \`base_state_version\` integer,
  \`current_state_version\` integer NOT NULL,
  \`occurred_at\` text NOT NULL,
  \`diff_json\` text,
  CONSTRAINT \`operation_records_command_nonempty\` CHECK (length(trim(\`command_name\`)) > 0),
  CONSTRAINT \`operation_records_parameter_hash_nonempty\` CHECK (length(trim(\`parameter_hash\`)) > 0),
  CONSTRAINT \`operation_records_base_version_nonnegative\` CHECK (\`base_state_version\` IS NULL OR \`base_state_version\` >= 0),
  CONSTRAINT \`operation_records_current_version_nonnegative\` CHECK (\`current_state_version\` >= 0),
  CONSTRAINT \`operation_records_version_order_valid\` CHECK (\`base_state_version\` IS NULL OR \`current_state_version\` >= \`base_state_version\`)
);
--> statement-breakpoint
CREATE INDEX \`operation_records_occurred_at_idx\` ON \`operation_records\` (\`occurred_at\`);
--> statement-breakpoint
CREATE TABLE \`completion_records\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`task_id\` text NOT NULL,
  \`source_session_id\` text,
  \`operation_id\` text NOT NULL,
  \`completed_at\` text NOT NULL,
  \`task_title_snapshot\` text NOT NULL,
  \`actual_duration_seconds\` real,
  \`duration_coverage\` text NOT NULL,
  \`achievement_disposition\` text NOT NULL,
  \`source\` text NOT NULL,
  CONSTRAINT \`completion_records_title_nonempty\` CHECK (length(trim(\`task_title_snapshot\`)) > 0),
  CONSTRAINT \`completion_records_duration_nonnegative\` CHECK (\`actual_duration_seconds\` IS NULL OR \`actual_duration_seconds\` >= 0),
  CONSTRAINT \`completion_records_coverage_has_duration\` CHECK (\`duration_coverage\` = 'unknown' OR \`actual_duration_seconds\` IS NOT NULL),
  CONSTRAINT \`completion_records_coverage_valid\` CHECK (\`duration_coverage\` IN ('complete', 'partial', 'unknown')),
  CONSTRAINT \`completion_records_disposition_valid\` CHECK (\`achievement_disposition\` IN ('record', 'skip')),
  CONSTRAINT \`completion_records_source_valid\` CHECK (\`source\` IN ('user', 'agent_authorized')),
  FOREIGN KEY (\`task_id\`) REFERENCES \`tasks\` (\`id\`) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (\`operation_id\`) REFERENCES \`operation_records\` (\`operation_id\`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`completion_records_task_id_unique\` ON \`completion_records\` (\`task_id\`);
--> statement-breakpoint
CREATE UNIQUE INDEX \`completion_records_operation_id_unique\` ON \`completion_records\` (\`operation_id\`);
--> statement-breakpoint
CREATE TABLE \`task_activity_events\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`task_id\` text NOT NULL,
  \`time_block_id\` text,
  \`event_type\` text NOT NULL,
  \`actor\` text NOT NULL,
  \`occurred_at\` text NOT NULL,
  \`local_date\` text NOT NULL,
  \`time_zone\` text NOT NULL,
  \`operation_id\` text NOT NULL,
  \`before_summary\` text,
  \`after_summary\` text,
  CONSTRAINT \`task_activity_events_type_nonempty\` CHECK (length(trim(\`event_type\`)) > 0),
  CONSTRAINT \`task_activity_events_actor_nonempty\` CHECK (length(trim(\`actor\`)) > 0),
  CONSTRAINT \`task_activity_events_local_date_nonempty\` CHECK (length(trim(\`local_date\`)) > 0),
  CONSTRAINT \`task_activity_events_time_zone_nonempty\` CHECK (length(trim(\`time_zone\`)) > 0),
  FOREIGN KEY (\`task_id\`) REFERENCES \`tasks\` (\`id\`) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (\`operation_id\`) REFERENCES \`operation_records\` (\`operation_id\`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX \`task_activity_events_task_occurred_idx\` ON \`task_activity_events\` (\`task_id\`, \`occurred_at\`);
--> statement-breakpoint
CREATE INDEX \`task_activity_events_operation_id_idx\` ON \`task_activity_events\` (\`operation_id\`);
--> statement-breakpoint
CREATE TABLE \`schedule_state\` (
  \`id\` integer PRIMARY KEY NOT NULL,
  \`state_version\` integer NOT NULL,
  \`plan_revision\` integer NOT NULL,
  CONSTRAINT \`schedule_state_singleton\` CHECK (\`id\` = 1),
  CONSTRAINT \`schedule_state_version_nonnegative\` CHECK (\`state_version\` >= 0),
  CONSTRAINT \`schedule_state_revision_nonnegative\` CHECK (\`plan_revision\` >= 0)
);
--> statement-breakpoint
INSERT INTO \`schedule_state\` (\`id\`, \`state_version\`, \`plan_revision\`) VALUES (1, 0, 0);
`.trim();
