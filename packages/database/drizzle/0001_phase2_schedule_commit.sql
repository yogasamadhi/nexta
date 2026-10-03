CREATE TABLE `schedule_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_revision` integer NOT NULL,
  `based_on_state_version` integer NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL,
  `committed_at` text NOT NULL,
  `input_hash` text NOT NULL,
  `scheduler_version` text NOT NULL,
  `policy_version` text NOT NULL,
  `time_zone` text NOT NULL,
  `horizon_start` text NOT NULL,
  `horizon_end` text NOT NULL,
  `reason` text NOT NULL,
  CONSTRAINT `schedule_plans_revision_positive` CHECK (`plan_revision` > 0),
  CONSTRAINT `schedule_plans_base_version_nonnegative` CHECK (`based_on_state_version` >= 0),
  CONSTRAINT `schedule_plans_status_valid` CHECK (`status` = 'committed'),
  CONSTRAINT `schedule_plans_input_hash_nonempty` CHECK (length(trim(`input_hash`)) > 0),
  CONSTRAINT `schedule_plans_scheduler_version_nonempty` CHECK (length(trim(`scheduler_version`)) > 0),
  CONSTRAINT `schedule_plans_policy_version_nonempty` CHECK (length(trim(`policy_version`)) > 0),
  CONSTRAINT `schedule_plans_time_zone_nonempty` CHECK (length(trim(`time_zone`)) > 0),
  CONSTRAINT `schedule_plans_horizon_valid` CHECK (`horizon_end` > `horizon_start`),
  CONSTRAINT `schedule_plans_reason_nonempty` CHECK (length(trim(`reason`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_plans_plan_revision_unique` ON `schedule_plans` (`plan_revision`);
--> statement-breakpoint
CREATE INDEX `schedule_plans_committed_at_idx` ON `schedule_plans` (`committed_at`);
--> statement-breakpoint
CREATE TABLE `time_blocks` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text,
  `type` text NOT NULL,
  `start_at` text NOT NULL,
  `end_at` text NOT NULL,
  `status` text NOT NULL,
  `source` text NOT NULL,
  `locked` integer NOT NULL,
  `plan_revision` integer NOT NULL,
  `external_calendar_event_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `time_blocks_type_valid` CHECK (`type` IN ('task', 'break', 'relax', 'buffer')),
  CONSTRAINT `time_blocks_status_valid` CHECK (`status` IN ('planned', 'started', 'completed', 'skipped', 'canceled')),
  CONSTRAINT `time_blocks_interval_valid` CHECK (`end_at` > `start_at`),
  CONSTRAINT `time_blocks_task_reference_required` CHECK (`type` <> 'task' OR `task_id` IS NOT NULL),
  CONSTRAINT `time_blocks_source_nonempty` CHECK (length(trim(`source`)) > 0),
  CONSTRAINT `time_blocks_external_event_nonempty` CHECK (`external_calendar_event_id` IS NULL OR length(trim(`external_calendar_event_id`)) > 0),
  CONSTRAINT `time_blocks_locked_boolean` CHECK (`locked` IN (0, 1)),
  CONSTRAINT `time_blocks_revision_nonnegative` CHECK (`plan_revision` >= 0),
  FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `time_blocks_start_end_idx` ON `time_blocks` (`start_at`,`end_at`);
--> statement-breakpoint
CREATE INDEX `time_blocks_task_id_idx` ON `time_blocks` (`task_id`);
--> statement-breakpoint
CREATE INDEX `time_blocks_plan_revision_idx` ON `time_blocks` (`plan_revision`);
--> statement-breakpoint
CREATE INDEX `time_blocks_status_idx` ON `time_blocks` (`status`);
--> statement-breakpoint
CREATE TABLE `integration_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_id` text NOT NULL,
  `target_channel` text NOT NULL,
  `target_entity_type` text NOT NULL,
  `target_entity_id` text NOT NULL,
  `desired_revision` integer NOT NULL,
  `desired_action` text NOT NULL,
  `status` text NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `last_error_code` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `integration_jobs_target_channel_valid` CHECK (`target_channel` IN ('calendar', 'notification')),
  CONSTRAINT `integration_jobs_target_entity_type_valid` CHECK (`target_entity_type` = 'schedule_plan'),
  CONSTRAINT `integration_jobs_target_entity_id_nonempty` CHECK (length(trim(`target_entity_id`)) > 0),
  CONSTRAINT `integration_jobs_revision_nonnegative` CHECK (`desired_revision` >= 0),
  CONSTRAINT `integration_jobs_action_valid` CHECK (`desired_action` = 'reconcile'),
  CONSTRAINT `integration_jobs_status_valid` CHECK (`status` IN ('pending', 'processing', 'succeeded', 'permission_required', 'failed', 'disabled', 'reconciliation_required')),
  CONSTRAINT `integration_jobs_attempt_count_nonnegative` CHECK (`attempt_count` >= 0),
  CONSTRAINT `integration_jobs_last_error_nonempty` CHECK (`last_error_code` IS NULL OR length(trim(`last_error_code`)) > 0),
  FOREIGN KEY (`operation_id`) REFERENCES `operation_records` (`operation_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (`target_entity_id`) REFERENCES `schedule_plans` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_jobs_desired_target_unique` ON `integration_jobs` (`target_channel`,`target_entity_type`,`target_entity_id`,`desired_revision`,`desired_action`);
--> statement-breakpoint
CREATE INDEX `integration_jobs_operation_id_idx` ON `integration_jobs` (`operation_id`);
--> statement-breakpoint
CREATE INDEX `integration_jobs_status_updated_idx` ON `integration_jobs` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `integration_jobs_target_revision_idx` ON `integration_jobs` (`target_channel`,`target_entity_type`,`target_entity_id`,`desired_revision`);
