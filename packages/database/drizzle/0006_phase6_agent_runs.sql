CREATE TABLE "agent_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "started_at" text NOT NULL,
  "ended_at" text,
  "status" text NOT NULL,
  "trigger" text NOT NULL,
  "model_provider" text,
  "turn_count" integer NOT NULL,
  "error_code" text,
  CONSTRAINT "agent_runs_status_valid" CHECK ("status" in ('running', 'completed', 'max_turns', 'max_tool_calls', 'aborted', 'failed')),
  CONSTRAINT "agent_runs_trigger_valid" CHECK ("trigger" in ('user_input', 'foreground_resume', 'task_completed', 'calendar_changed', 'notification_opened', 'background_window', 'manual_replan')),
  CONSTRAINT "agent_runs_turn_count_nonnegative" CHECK ("turn_count" >= 0),
  CONSTRAINT "agent_runs_model_provider_nonempty" CHECK ("model_provider" is null or length(trim("model_provider")) > 0),
  CONSTRAINT "agent_runs_error_code_nonempty" CHECK ("error_code" is null or length(trim("error_code")) > 0),
  CONSTRAINT "agent_runs_lifecycle_valid" CHECK (("status" = 'running' and "ended_at" is null and "error_code" is null)
    or ("status" in ('completed', 'max_turns', 'max_tool_calls') and "ended_at" is not null and "error_code" is null)
    or ("status" in ('aborted', 'failed') and "ended_at" is not null and "error_code" is not null)),
  CONSTRAINT "agent_runs_end_order_valid" CHECK ("ended_at" is null or "ended_at" >= "started_at")
);
--> statement-breakpoint
CREATE INDEX "agent_runs_status_started_idx" ON "agent_runs" ("status", "started_at");
