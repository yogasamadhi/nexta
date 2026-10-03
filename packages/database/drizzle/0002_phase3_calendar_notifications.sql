ALTER TABLE `integration_jobs` RENAME TO `integration_jobs_0001`;
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
  `automatic_retry_eligible` integer NOT NULL,
  `claim_token` text,
  `lease_expires_at` text,
  `not_before` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `integration_jobs_target_channel_valid` CHECK (`target_channel` IN ('calendar', 'notification')),
  CONSTRAINT `integration_jobs_target_entity_type_valid` CHECK (`target_entity_type` = 'schedule_plan'),
  CONSTRAINT `integration_jobs_target_entity_id_nonempty` CHECK (length(trim(`target_entity_id`)) > 0),
  CONSTRAINT `integration_jobs_revision_nonnegative` CHECK (`desired_revision` >= 0),
  CONSTRAINT `integration_jobs_action_valid` CHECK (`desired_action` = 'reconcile'),
  CONSTRAINT `integration_jobs_status_valid` CHECK (`status` IN ('pending', 'processing', 'succeeded', 'permission_required', 'failed', 'disabled', 'reconciliation_required', 'superseded')),
  CONSTRAINT `integration_jobs_attempt_count_nonnegative` CHECK (`attempt_count` >= 0),
  CONSTRAINT `integration_jobs_last_error_nonempty` CHECK (`last_error_code` IS NULL OR length(trim(`last_error_code`)) > 0),
  CONSTRAINT `integration_jobs_auto_retry_boolean` CHECK (`automatic_retry_eligible` IN (0, 1)),
  CONSTRAINT `integration_jobs_auto_retry_status_valid` CHECK ((`status` IN ('pending', 'processing') AND `automatic_retry_eligible` = 1)
    OR (`status` IN ('succeeded', 'permission_required', 'disabled', 'superseded') AND `automatic_retry_eligible` = 0)
    OR `status` IN ('failed', 'reconciliation_required')),
  CONSTRAINT `integration_jobs_claim_token_nonempty` CHECK (`claim_token` IS NULL OR length(trim(`claim_token`)) > 0),
  CONSTRAINT `integration_jobs_claim_lease_consistent` CHECK ((`status` = 'processing' AND `claim_token` IS NOT NULL AND `lease_expires_at` IS NOT NULL)
    OR (`status` <> 'processing' AND `claim_token` IS NULL AND `lease_expires_at` IS NULL)),
  CONSTRAINT `integration_jobs_processing_lease_future` CHECK (`status` <> 'processing' OR `lease_expires_at` > `updated_at`),
  FOREIGN KEY (`operation_id`) REFERENCES `operation_records` (`operation_id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (`target_entity_id`) REFERENCES `schedule_plans` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO `integration_jobs` (
  `id`, `operation_id`, `target_channel`, `target_entity_type`,
  `target_entity_id`, `desired_revision`, `desired_action`, `status`,
  `attempt_count`, `last_error_code`, `automatic_retry_eligible`,
  `claim_token`, `lease_expires_at`, `not_before`, `created_at`, `updated_at`
)
SELECT
  `id`, `operation_id`, `target_channel`, `target_entity_type`,
  `target_entity_id`, `desired_revision`, `desired_action`,
  CASE WHEN `status` = 'processing' THEN 'reconciliation_required' ELSE `status` END,
  `attempt_count`, `last_error_code`, CASE WHEN `status` = 'pending' THEN 1 ELSE 0 END,
  NULL, NULL, `created_at`, `created_at`, `updated_at`
FROM `integration_jobs_0001`;
--> statement-breakpoint
DROP TABLE `integration_jobs_0001`;
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_jobs_desired_target_unique` ON `integration_jobs` (`target_channel`,`target_entity_type`,`target_entity_id`,`desired_revision`,`desired_action`);
--> statement-breakpoint
CREATE INDEX `integration_jobs_operation_id_idx` ON `integration_jobs` (`operation_id`);
--> statement-breakpoint
CREATE INDEX `integration_jobs_status_updated_idx` ON `integration_jobs` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `integration_jobs_channel_runnable_idx` ON `integration_jobs` (`target_channel`,`status`,`automatic_retry_eligible`,`not_before`,`desired_revision`);
--> statement-breakpoint
CREATE INDEX `integration_jobs_channel_lease_idx` ON `integration_jobs` (`target_channel`,`status`,`lease_expires_at`);
--> statement-breakpoint
CREATE INDEX `integration_jobs_target_revision_idx` ON `integration_jobs` (`target_channel`,`target_entity_type`,`target_entity_id`,`desired_revision`);
--> statement-breakpoint
CREATE TABLE `external_calendar_event_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `calendar_id` text NOT NULL,
  `external_event_id` text NOT NULL,
  `occurrence_key` text,
  `start_at` text NOT NULL,
  `end_at` text NOT NULL,
  `busy` integer NOT NULL,
  `last_seen_at` text NOT NULL,
  `content_hash` text NOT NULL,
  CONSTRAINT `external_calendar_snapshots_provider_nonempty` CHECK (length(trim(`provider`)) > 0),
  CONSTRAINT `external_calendar_snapshots_calendar_nonempty` CHECK (length(trim(`calendar_id`)) > 0),
  CONSTRAINT `external_calendar_snapshots_event_nonempty` CHECK (length(trim(`external_event_id`)) > 0),
  CONSTRAINT `external_calendar_snapshots_occurrence_nonempty` CHECK (`occurrence_key` IS NULL OR length(trim(`occurrence_key`)) > 0),
  CONSTRAINT `external_calendar_snapshots_interval_valid` CHECK (`end_at` > `start_at`),
  CONSTRAINT `external_calendar_snapshots_busy_boolean` CHECK (`busy` IN (0, 1)),
  CONSTRAINT `external_calendar_snapshots_content_hash_nonempty` CHECK (length(trim(`content_hash`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_calendar_snapshots_singleton_unique` ON `external_calendar_event_snapshots` (`provider`,`calendar_id`,`external_event_id`) WHERE `occurrence_key` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `external_calendar_snapshots_occurrence_unique` ON `external_calendar_event_snapshots` (`provider`,`calendar_id`,`external_event_id`,`occurrence_key`) WHERE `occurrence_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `external_calendar_snapshots_scope_interval_idx` ON `external_calendar_event_snapshots` (`provider`,`calendar_id`,`start_at`,`end_at`);
--> statement-breakpoint
CREATE INDEX `external_calendar_snapshots_scope_seen_idx` ON `external_calendar_event_snapshots` (`provider`,`calendar_id`,`last_seen_at`);
--> statement-breakpoint
CREATE TABLE `calendar_refresh_coverages` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `calendar_id` text NOT NULL,
  `range_start` text NOT NULL,
  `range_end` text NOT NULL,
  `fetched_at` text NOT NULL,
  `completeness` text NOT NULL,
  `observed_event_count` integer NOT NULL,
  CONSTRAINT `calendar_refresh_coverages_provider_nonempty` CHECK (length(trim(`provider`)) > 0),
  CONSTRAINT `calendar_refresh_coverages_calendar_nonempty` CHECK (length(trim(`calendar_id`)) > 0),
  CONSTRAINT `calendar_refresh_coverages_range_valid` CHECK (`range_end` > `range_start`),
  CONSTRAINT `calendar_refresh_coverages_complete_only` CHECK (`completeness` = 'complete'),
  CONSTRAINT `calendar_refresh_coverages_count_nonnegative` CHECK (`observed_event_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX `calendar_refresh_coverages_scope_fetched_idx` ON `calendar_refresh_coverages` (`provider`,`calendar_id`,`fetched_at`);
--> statement-breakpoint
CREATE INDEX `calendar_refresh_coverages_scope_range_idx` ON `calendar_refresh_coverages` (`provider`,`calendar_id`,`range_start`,`range_end`);
--> statement-breakpoint
CREATE TABLE `calendar_container_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `provider` text NOT NULL,
  `calendar_id` text NOT NULL,
  `ownership_key` text NOT NULL,
  `ownership_verified` integer NOT NULL,
  `status` text NOT NULL,
  `verified_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `calendar_container_bindings_provider_nonempty` CHECK (length(trim(`provider`)) > 0),
  CONSTRAINT `calendar_container_bindings_calendar_nonempty` CHECK (length(trim(`calendar_id`)) > 0),
  CONSTRAINT `calendar_container_bindings_ownership_nonempty` CHECK (length(trim(`ownership_key`)) > 0),
  CONSTRAINT `calendar_container_bindings_verified_true` CHECK (`ownership_verified` = 1),
  CONSTRAINT `calendar_container_bindings_status_valid` CHECK (`status` IN ('synced', 'pending', 'permission_required', 'failed', 'disabled', 'reconciliation_required', 'conflict'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_container_bindings_ownership_unique` ON `calendar_container_bindings` (`provider`,`ownership_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_container_bindings_calendar_unique` ON `calendar_container_bindings` (`provider`,`calendar_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_container_bindings_authority_unique` ON `calendar_container_bindings` (`provider`,`calendar_id`,`ownership_key`);
--> statement-breakpoint
CREATE INDEX `calendar_container_bindings_calendar_idx` ON `calendar_container_bindings` (`provider`,`calendar_id`);
--> statement-breakpoint
CREATE TABLE `calendar_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `time_block_id` text NOT NULL,
  `provider` text NOT NULL,
  `calendar_id` text NOT NULL,
  `external_event_id` text NOT NULL,
  `occurrence_key` text,
  `ownership_key` text NOT NULL,
  `ownership_verified` integer NOT NULL,
  `applied_content_hash` text NOT NULL,
  `applied_start_at` text NOT NULL,
  `applied_end_at` text NOT NULL,
  `last_applied_revision` integer NOT NULL,
  `status` text NOT NULL,
  `verified_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `calendar_bindings_provider_nonempty` CHECK (length(trim(`provider`)) > 0),
  CONSTRAINT `calendar_bindings_calendar_nonempty` CHECK (length(trim(`calendar_id`)) > 0),
  CONSTRAINT `calendar_bindings_event_nonempty` CHECK (length(trim(`external_event_id`)) > 0),
  CONSTRAINT `calendar_bindings_occurrence_nonempty` CHECK (`occurrence_key` IS NULL OR length(trim(`occurrence_key`)) > 0),
  CONSTRAINT `calendar_bindings_ownership_nonempty` CHECK (length(trim(`ownership_key`)) > 0),
  CONSTRAINT `calendar_bindings_verified_true` CHECK (`ownership_verified` = 1),
  CONSTRAINT `calendar_bindings_content_hash_nonempty` CHECK (length(trim(`applied_content_hash`)) > 0),
  CONSTRAINT `calendar_bindings_interval_valid` CHECK (`applied_end_at` > `applied_start_at`),
  CONSTRAINT `calendar_bindings_revision_nonnegative` CHECK (`last_applied_revision` >= 0),
  CONSTRAINT `calendar_bindings_status_valid` CHECK (`status` IN ('synced', 'pending', 'permission_required', 'failed', 'disabled', 'reconciliation_required', 'conflict')),
  FOREIGN KEY (`time_block_id`) REFERENCES `time_blocks` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `calendar_bindings_container_authority_fk` FOREIGN KEY (`provider`,`calendar_id`,`ownership_key`) REFERENCES `calendar_container_bindings` (`provider`,`calendar_id`,`ownership_key`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_bindings_time_block_unique` ON `calendar_bindings` (`time_block_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_bindings_singleton_unique` ON `calendar_bindings` (`provider`,`calendar_id`,`external_event_id`) WHERE `occurrence_key` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_bindings_occurrence_unique` ON `calendar_bindings` (`provider`,`calendar_id`,`external_event_id`,`occurrence_key`) WHERE `occurrence_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `calendar_bindings_status_idx` ON `calendar_bindings` (`status`);
--> statement-breakpoint
CREATE TABLE `notification_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `time_block_id` text NOT NULL,
  `task_id` text,
  `os_notification_id` text NOT NULL,
  `type` text NOT NULL,
  `applied_content_hash` text NOT NULL,
  `scheduled_at` text NOT NULL,
  `desired_revision` integer NOT NULL,
  `last_applied_revision` integer NOT NULL,
  `status` text NOT NULL,
  `identity_verified` integer NOT NULL,
  `verified_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `notification_bindings_os_id_nonempty` CHECK (length(trim(`os_notification_id`)) > 0),
  CONSTRAINT `notification_bindings_type_nonempty` CHECK (length(trim(`type`)) > 0),
  CONSTRAINT `notification_bindings_content_hash_nonempty` CHECK (length(trim(`applied_content_hash`)) > 0),
  CONSTRAINT `notification_bindings_revision_nonnegative` CHECK (`desired_revision` >= 0 AND `last_applied_revision` >= 0),
  CONSTRAINT `notification_bindings_revision_order_valid` CHECK (`desired_revision` >= `last_applied_revision`),
  CONSTRAINT `notification_bindings_synced_revision_valid` CHECK (`status` <> 'synced' OR `desired_revision` = `last_applied_revision`),
  CONSTRAINT `notification_bindings_status_valid` CHECK (`status` IN ('synced', 'pending', 'permission_required', 'failed', 'disabled', 'reconciliation_required', 'conflict')),
  CONSTRAINT `notification_bindings_identity_verified_true` CHECK (`identity_verified` = 1),
  FOREIGN KEY (`time_block_id`) REFERENCES `time_blocks` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_bindings_identity_unique` ON `notification_bindings` (`time_block_id`,`type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_bindings_os_id_unique` ON `notification_bindings` (`os_notification_id`);
--> statement-breakpoint
CREATE INDEX `notification_bindings_task_idx` ON `notification_bindings` (`task_id`);
--> statement-breakpoint
CREATE INDEX `notification_bindings_status_scheduled_idx` ON `notification_bindings` (`status`,`scheduled_at`);
