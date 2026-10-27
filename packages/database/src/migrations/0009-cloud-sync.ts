export const cloudSyncSql = `
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE operation_provenance (id text PRIMARY KEY NOT NULL, command text NOT NULL, occurred_at text NOT NULL, device_id text NOT NULL DEFAULT 'legacy');
--> statement-breakpoint
INSERT INTO operation_provenance(id,command,occurred_at) SELECT operation_id,command_name,occurred_at FROM operation_records;
--> statement-breakpoint
CREATE TABLE "completion_records_cloud" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "source_session_id" text,
  "operation_id" text NOT NULL,
  "completed_at" text NOT NULL,
  "task_title_snapshot" text NOT NULL,
  "actual_duration_seconds" real,
  "duration_coverage" text NOT NULL,
  "achievement_disposition" text NOT NULL,
  "source" text NOT NULL,
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON UPDATE cascade ON DELETE restrict,
  FOREIGN KEY ("source_session_id") REFERENCES "execution_sessions"("id") ON UPDATE cascade ON DELETE restrict,
  FOREIGN KEY ("operation_id") REFERENCES "operation_provenance"("id") ON UPDATE cascade ON DELETE restrict,
  CONSTRAINT "completion_records_title_nonempty" CHECK (length(trim("task_title_snapshot")) > 0),
  CONSTRAINT "completion_records_duration_nonnegative" CHECK ("actual_duration_seconds" is null or "actual_duration_seconds" >= 0),
  CONSTRAINT "completion_records_coverage_has_duration" CHECK ("duration_coverage" = 'unknown' or "actual_duration_seconds" is not null),
  CONSTRAINT "completion_records_coverage_valid" CHECK ("duration_coverage" in ('complete', 'partial', 'unknown')),
  CONSTRAINT "completion_records_disposition_valid" CHECK ("achievement_disposition" in ('record', 'skip')),
  CONSTRAINT "completion_records_source_valid" CHECK ("source" in ('user', 'agent_authorized'))
);
--> statement-breakpoint
INSERT INTO "completion_records_cloud" SELECT * FROM "completion_records";
--> statement-breakpoint
CREATE TABLE "achievements_cloud" (
  "id" text PRIMARY KEY NOT NULL,
  "source_completion_record_id" text NOT NULL,
  "source_task_id" text NOT NULL,
  "source_execution_session_id" text,
  "title" text NOT NULL,
  "summary" text,
  "evidence_type" text NOT NULL,
  "occurred_at" text NOT NULL,
  "user_edited" integer NOT NULL,
  "hidden" integer NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  FOREIGN KEY ("source_completion_record_id") REFERENCES "completion_records_cloud"("id") ON UPDATE cascade ON DELETE restrict,
  FOREIGN KEY ("source_task_id") REFERENCES "tasks"("id") ON UPDATE cascade ON DELETE restrict,
  FOREIGN KEY ("source_execution_session_id") REFERENCES "execution_sessions"("id") ON UPDATE cascade ON DELETE restrict,
  CONSTRAINT "achievements_title_nonempty" CHECK (length(trim("title")) > 0),
  CONSTRAINT "achievements_evidence_type_nonempty" CHECK (length(trim("evidence_type")) > 0),
  CONSTRAINT "achievements_user_edited_boolean" CHECK ("user_edited" in (0, 1)),
  CONSTRAINT "achievements_hidden_boolean" CHECK ("hidden" in (0, 1))
);
--> statement-breakpoint
INSERT INTO "achievements_cloud" SELECT * FROM "achievements";
--> statement-breakpoint
DROP TABLE "achievements";
--> statement-breakpoint
DROP TABLE "completion_records";
--> statement-breakpoint
ALTER TABLE "completion_records_cloud" RENAME TO "completion_records";
--> statement-breakpoint
ALTER TABLE "achievements_cloud" RENAME TO "achievements";
--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_completion_unique" ON "achievements" ("source_completion_record_id");
--> statement-breakpoint
CREATE INDEX "achievements_occurred_at_idx" ON "achievements" ("occurred_at");
--> statement-breakpoint
CREATE INDEX "achievements_task_idx" ON "achievements" ("source_task_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "completion_records_task_id_unique" ON "completion_records" ("task_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "completion_records_operation_id_unique" ON "completion_records" ("operation_id");
--> statement-breakpoint
CREATE TABLE "task_activity_events_cloud" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "time_block_id" text,
  "event_type" text NOT NULL,
  "actor" text NOT NULL,
  "occurred_at" text NOT NULL,
  "local_date" text NOT NULL,
  "time_zone" text NOT NULL,
  "operation_id" text NOT NULL,
  "before_summary" text,
  "after_summary" text,
  CONSTRAINT "task_activity_events_type_nonempty" CHECK (length(trim("event_type")) > 0),
  CONSTRAINT "task_activity_events_actor_nonempty" CHECK (length(trim("actor")) > 0),
  CONSTRAINT "task_activity_events_local_date_nonempty" CHECK (length(trim("local_date")) > 0),
  CONSTRAINT "task_activity_events_time_zone_nonempty" CHECK (length(trim("time_zone")) > 0),
  FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY ("operation_id") REFERENCES "operation_provenance" ("id") ON UPDATE CASCADE ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO "task_activity_events_cloud" SELECT * FROM "task_activity_events";
--> statement-breakpoint
DROP TABLE "task_activity_events";
--> statement-breakpoint
ALTER TABLE "task_activity_events_cloud" RENAME TO "task_activity_events";
--> statement-breakpoint
CREATE INDEX "task_activity_events_task_occurred_idx" ON "task_activity_events" ("task_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "task_activity_events_operation_id_idx" ON "task_activity_events" ("operation_id");
--> statement-breakpoint
CREATE TABLE cloud_sync_state (id integer PRIMARY KEY CHECK(id=1), device_id text NOT NULL, user_id text, cursor text NOT NULL DEFAULT '0', projection_enabled integer NOT NULL DEFAULT 0 CHECK(projection_enabled IN(0,1)));
--> statement-breakpoint
CREATE TABLE cloud_sync_versions (entity_key text PRIMARY KEY NOT NULL, version text NOT NULL, owner_device_id text NOT NULL, value_json text NOT NULL);
--> statement-breakpoint
CREATE TABLE cloud_sync_outbox (sequence integer PRIMARY KEY AUTOINCREMENT, batch_id text NOT NULL UNIQUE, payload_json text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','conflict','archived')), conflict_id text);
--> statement-breakpoint
CREATE TABLE cloud_sync_conflicts (id text PRIMARY KEY NOT NULL, local_json text NOT NULL, remote_json text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN('open','cloud','local')));

--> statement-breakpoint
CREATE TABLE cloud_profile_claim(source_name text PRIMARY KEY NOT NULL,user_id text NOT NULL);

--> statement-breakpoint
CREATE TABLE cloud_plan_origins(id text PRIMARY KEY NOT NULL,origin_device_id text NOT NULL,source_revision integer NOT NULL,committed_at text NOT NULL,scheduler_version text NOT NULL,policy_version text NOT NULL,time_zone text NOT NULL,reason text NOT NULL,affected_block_ids text NOT NULL CHECK(json_valid(affected_block_ids)));
--> statement-breakpoint
INSERT INTO cloud_plan_origins SELECT id,'legacy',plan_revision,committed_at,scheduler_version,policy_version,time_zone,reason,(SELECT json_group_array(id) FROM time_blocks WHERE time_blocks.plan_revision=schedule_plans.plan_revision) FROM schedule_plans;
`.trim();
