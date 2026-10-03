export const phase8WellbeingSql = `
CREATE TABLE "daily_reflections" (
  "id" text PRIMARY KEY NOT NULL,
  "local_date" text NOT NULL,
  "time_zone" text NOT NULL,
  "summary" text NOT NULL,
  "wins_json" text NOT NULL,
  "adjustment_suggestion" text,
  "user_note" text,
  "generated_by" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "daily_reflections_summary_nonempty" CHECK (length(trim("summary")) > 0),
  CONSTRAINT "daily_reflections_local_date_nonempty" CHECK (length(trim("local_date")) > 0),
  CONSTRAINT "daily_reflections_time_zone_nonempty" CHECK (length(trim("time_zone")) > 0),
  CONSTRAINT "daily_reflections_wins_json_valid" CHECK (json_valid("wins_json") and json_type("wins_json") = 'array' and json_array_length("wins_json") <= 3),
  CONSTRAINT "daily_reflections_adjustment_nonempty" CHECK ("adjustment_suggestion" is null or length(trim("adjustment_suggestion")) > 0),
  CONSTRAINT "daily_reflections_user_note_valid" CHECK ("user_note" is null or (length(trim("user_note")) > 0 and length("user_note") <= 4000)),
  CONSTRAINT "daily_reflections_generated_by_valid" CHECK ("generated_by" in ('local_facts', 'model_validated')),
  CONSTRAINT "daily_reflections_updated_order_valid" CHECK ("updated_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reflections_local_day_unique" ON "daily_reflections" ("local_date", "time_zone");
--> statement-breakpoint
CREATE INDEX "daily_reflections_updated_at_idx" ON "daily_reflections" ("updated_at");
--> statement-breakpoint
CREATE TABLE "energy_check_ins" (
  "id" text PRIMARY KEY NOT NULL,
  "local_date" text NOT NULL,
  "time_zone" text NOT NULL,
  "level" integer NOT NULL,
  "note" text,
  "created_at" text NOT NULL,
  CONSTRAINT "energy_check_ins_local_date_nonempty" CHECK (length(trim("local_date")) > 0),
  CONSTRAINT "energy_check_ins_time_zone_nonempty" CHECK (length(trim("time_zone")) > 0),
  CONSTRAINT "energy_check_ins_level_valid" CHECK ("level" between 1 and 5),
  CONSTRAINT "energy_check_ins_note_valid" CHECK ("note" is null or (length(trim("note")) > 0 and length("note") <= 4000))
);
--> statement-breakpoint
CREATE INDEX "energy_check_ins_local_day_created_idx" ON "energy_check_ins" ("local_date", "time_zone", "created_at");
--> statement-breakpoint
CREATE INDEX "energy_check_ins_created_at_idx" ON "energy_check_ins" ("created_at");
--> statement-breakpoint
CREATE TABLE "relax_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "planned_minutes" integer NOT NULL,
  "actual_seconds" integer,
  "started_at" text NOT NULL,
  "ended_at" text,
  "source" text NOT NULL,
  "status" text NOT NULL,
  "timing_quality" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "relax_sessions_type_valid" CHECK ("type" in ('breathing', 'pause', 'stretch', 'ambient')),
  CONSTRAINT "relax_sessions_planned_minutes_positive" CHECK ("planned_minutes" between 1 and 60),
  CONSTRAINT "relax_sessions_actual_seconds_nonnegative" CHECK ("actual_seconds" is null or "actual_seconds" >= 0),
  CONSTRAINT "relax_sessions_source_valid" CHECK ("source" in ('relax_tab', 'today', 'focus')),
  CONSTRAINT "relax_sessions_status_valid" CHECK ("status" in ('active', 'completed', 'abandoned')),
  CONSTRAINT "relax_sessions_timing_quality_valid" CHECK ("timing_quality" in ('trusted', 'needs_review')),
  CONSTRAINT "relax_sessions_lifecycle_valid" CHECK (("status" = 'active' and "ended_at" is null and "actual_seconds" is null)
        or ("status" in ('completed', 'abandoned') and "ended_at" is not null and "actual_seconds" is not null)),
  CONSTRAINT "relax_sessions_end_order_valid" CHECK ("ended_at" is null or "ended_at" >= "started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "relax_sessions_single_active_unique" ON "relax_sessions" ("status") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "relax_sessions_started_at_idx" ON "relax_sessions" ("started_at");
`.trim();
