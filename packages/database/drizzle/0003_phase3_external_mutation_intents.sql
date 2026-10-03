CREATE TABLE `external_mutation_intents` (
  `id` text PRIMARY KEY NOT NULL,
  `integration_job_id` text NOT NULL,
  `desired_revision` integer NOT NULL,
  `scope_key` text NOT NULL,
  `action` text NOT NULL,
  `payload_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `external_mutation_intents_revision_nonnegative` CHECK (`desired_revision` >= 0),
  CONSTRAINT `external_mutation_intents_scope_nonempty` CHECK (length(trim(`scope_key`)) > 0),
  CONSTRAINT `external_mutation_intents_action_valid` CHECK (`action` IN ('calendar_provision', 'calendar_event_create', 'calendar_event_update', 'calendar_event_delete', 'notification_schedule', 'notification_cancel')),
  CONSTRAINT `external_mutation_intents_payload_valid` CHECK (json_valid(`payload_json`) AND json_type(`payload_json`) = 'object'),
  FOREIGN KEY (`integration_job_id`) REFERENCES `integration_jobs` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_mutation_intents_job_unique` ON `external_mutation_intents` (`integration_job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_mutation_intents_scope_unique` ON `external_mutation_intents` (`scope_key`);
--> statement-breakpoint
CREATE INDEX `external_mutation_intents_revision_action_idx` ON `external_mutation_intents` (`desired_revision`,`action`);
