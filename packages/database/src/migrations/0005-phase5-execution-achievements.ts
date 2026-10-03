export const phase5ExecutionAchievementsSql = `
CREATE TABLE "execution_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "time_block_id" text,
  "started_at" text NOT NULL,
  "ended_at" text,
  "paused_duration_seconds" integer NOT NULL,
  "active_interval_started_at" text,
  "paused_at" text,
  "status" text NOT NULL,
  "completion_type" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON UPDATE cascade ON DELETE restrict,
  FOREIGN KEY ("time_block_id") REFERENCES "time_blocks"("id") ON UPDATE cascade ON DELETE restrict,
  CONSTRAINT "execution_sessions_status_valid" CHECK ("status" in ('running', 'paused', 'completed', 'abandoned')),
  CONSTRAINT "execution_sessions_completion_type_valid" CHECK ("completion_type" is null or "completion_type" in ('finish_session', 'complete_task')),
  CONSTRAINT "execution_sessions_paused_duration_nonnegative" CHECK ("paused_duration_seconds" >= 0),
  CONSTRAINT "execution_sessions_end_order_valid" CHECK ("ended_at" is null or "ended_at" >= "started_at"),
  CONSTRAINT "execution_sessions_lifecycle_valid" CHECK (("status" = 'running' and "ended_at" is null and "active_interval_started_at" is not null and "paused_at" is null and "completion_type" is null)
    or ("status" = 'paused' and "ended_at" is null and "active_interval_started_at" is null and "paused_at" is not null and "completion_type" is null)
    or ("status" = 'completed' and "ended_at" is not null and "active_interval_started_at" is null and "paused_at" is null and "completion_type" is not null)
    or ("status" = 'abandoned' and "ended_at" is not null and "active_interval_started_at" is null and "paused_at" is null and "completion_type" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "execution_sessions_active_unique" ON "execution_sessions" ((1)) WHERE "status" in ('running', 'paused');
--> statement-breakpoint
CREATE INDEX "execution_sessions_task_started_idx" ON "execution_sessions" ("task_id", "started_at");
--> statement-breakpoint
CREATE INDEX "execution_sessions_time_block_idx" ON "execution_sessions" ("time_block_id");
--> statement-breakpoint
CREATE TABLE "execution_intervals" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "kind" text NOT NULL,
  "start_at" text NOT NULL,
  "end_at" text,
  "timing_quality" text NOT NULL,
  FOREIGN KEY ("session_id") REFERENCES "execution_sessions"("id") ON UPDATE cascade ON DELETE restrict,
  CONSTRAINT "execution_intervals_kind_valid" CHECK ("kind" in ('work', 'pause')),
  CONSTRAINT "execution_intervals_timing_quality_valid" CHECK ("timing_quality" in ('trusted', 'needs_review')),
  CONSTRAINT "execution_intervals_end_order_valid" CHECK ("end_at" is null or "end_at" >= "start_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "execution_intervals_open_session_unique" ON "execution_intervals" ("session_id") WHERE "end_at" is null;
--> statement-breakpoint
CREATE INDEX "execution_intervals_session_start_idx" ON "execution_intervals" ("session_id", "start_at");
--> statement-breakpoint
ALTER TABLE "completion_records" RENAME TO "__old_completion_records";
--> statement-breakpoint
CREATE TABLE "completion_records" (
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
  FOREIGN KEY ("operation_id") REFERENCES "operation_records"("operation_id") ON UPDATE cascade ON DELETE restrict,
  CONSTRAINT "completion_records_title_nonempty" CHECK (length(trim("task_title_snapshot")) > 0),
  CONSTRAINT "completion_records_duration_nonnegative" CHECK ("actual_duration_seconds" is null or "actual_duration_seconds" >= 0),
  CONSTRAINT "completion_records_coverage_has_duration" CHECK ("duration_coverage" = 'unknown' or "actual_duration_seconds" is not null),
  CONSTRAINT "completion_records_coverage_valid" CHECK ("duration_coverage" in ('complete', 'partial', 'unknown')),
  CONSTRAINT "completion_records_disposition_valid" CHECK ("achievement_disposition" in ('record', 'skip')),
  CONSTRAINT "completion_records_source_valid" CHECK ("source" in ('user', 'agent_authorized'))
);
--> statement-breakpoint
INSERT INTO "completion_records" (
  "id", "task_id", "source_session_id", "operation_id", "completed_at",
  "task_title_snapshot", "actual_duration_seconds", "duration_coverage",
  "achievement_disposition", "source"
)
SELECT
  "id", "task_id", "source_session_id", "operation_id", "completed_at",
  "task_title_snapshot", "actual_duration_seconds", "duration_coverage",
  "achievement_disposition", "source"
FROM "__old_completion_records";
--> statement-breakpoint
DROP TABLE "__old_completion_records";
--> statement-breakpoint
CREATE UNIQUE INDEX "completion_records_task_id_unique" ON "completion_records" ("task_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "completion_records_operation_id_unique" ON "completion_records" ("operation_id");
--> statement-breakpoint
CREATE TABLE "achievements" (
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
  FOREIGN KEY ("source_completion_record_id") REFERENCES "completion_records"("id") ON UPDATE cascade ON DELETE restrict,
  FOREIGN KEY ("source_task_id") REFERENCES "tasks"("id") ON UPDATE cascade ON DELETE restrict,
  FOREIGN KEY ("source_execution_session_id") REFERENCES "execution_sessions"("id") ON UPDATE cascade ON DELETE restrict,
  CONSTRAINT "achievements_title_nonempty" CHECK (length(trim("title")) > 0),
  CONSTRAINT "achievements_evidence_type_nonempty" CHECK (length(trim("evidence_type")) > 0),
  CONSTRAINT "achievements_user_edited_boolean" CHECK ("user_edited" in (0, 1)),
  CONSTRAINT "achievements_hidden_boolean" CHECK ("hidden" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_completion_unique" ON "achievements" ("source_completion_record_id");
--> statement-breakpoint
CREATE INDEX "achievements_occurred_at_idx" ON "achievements" ("occurred_at");
--> statement-breakpoint
CREATE INDEX "achievements_task_idx" ON "achievements" ("source_task_id");
`.trim();
