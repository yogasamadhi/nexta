-- +goose Up
CREATE TABLE users (id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE devices (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), installation_id text NOT NULL, name text NOT NULL, revoked_at timestamptz, UNIQUE(user_id,installation_id), UNIQUE(user_id,id));
CREATE TABLE sessions (id text PRIMARY KEY, user_id text NOT NULL, device_id text NOT NULL, refresh_hash bytea NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz, FOREIGN KEY(user_id,device_id) REFERENCES devices(user_id,id));
CREATE TABLE sync_heads (user_id text PRIMARY KEY REFERENCES users(id), revision bigint NOT NULL DEFAULT 0);
CREATE TABLE sync_batches (user_id text NOT NULL REFERENCES users(id), batch_id text NOT NULL, device_id text NOT NULL, request_hash text NOT NULL, revision bigint NOT NULL, result jsonb NOT NULL, PRIMARY KEY(user_id,batch_id), UNIQUE(user_id,revision));
CREATE TABLE sync_changes (user_id text NOT NULL, revision bigint NOT NULL, batch_id text NOT NULL, document jsonb NOT NULL, PRIMARY KEY(user_id,revision), FOREIGN KEY(user_id,batch_id) REFERENCES sync_batches(user_id,batch_id));
CREATE TABLE sync_conflicts (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), device_id text NOT NULL, batch_id text NOT NULL, request_hash text NOT NULL, local_batch jsonb NOT NULL, remote_entities jsonb NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','cloud','local')), resolution jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,batch_id));
CREATE TABLE sync_bootstraps (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), device_id text NOT NULL, direction text NOT NULL CHECK(direction IN ('upload','download')), revision bigint NOT NULL, status text NOT NULL DEFAULT 'staging', chunks jsonb NOT NULL DEFAULT '{}', snapshot jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE facts_operation_provenance (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "command" text NOT NULL, "occurredAt" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_goal (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "title" text NOT NULL, "description" text NOT NULL, "status" text NOT NULL, "targetDate" text, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, "archivedAt" text, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_project (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "goalId" text, "title" text NOT NULL, "description" text NOT NULL, "status" text NOT NULL, "deadline" text, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, "archivedAt" text, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_task (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "projectId" text, "goalId" text, "parentTaskId" text, "title" text NOT NULL, "description" text, "status" text NOT NULL, "priority" text NOT NULL, "estimatedDurationMinutes" double precision, "baselineEstimatedDurationMinutes" double precision, "actualDurationMinutes" double precision, "remainingDurationMinutes" double precision, "categoryKey" text, "earliestStartAt" text, "deadlineAt" text, "deadlineLocalDate" text, "deadlineTimeZone" text, "splittable" boolean NOT NULL, "minBlockMinutes" double precision, "maxBlockMinutes" double precision, "energyDemand" text, "schedulingPolicy" text NOT NULL, "source" text NOT NULL, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, "completedAt" text, "canceledAt" text, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_time_block (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "taskId" text, "type" text NOT NULL, "startAt" text NOT NULL, "endAt" text NOT NULL, "status" text NOT NULL, "source" text NOT NULL, "locked" boolean NOT NULL, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_execution_session (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "taskId" text NOT NULL, "timeBlockId" text, "startedAt" text NOT NULL, "endedAt" text, "pausedDurationSeconds" double precision NOT NULL, "activeIntervalStartedAt" text, "pausedAt" text, "status" text NOT NULL, "completionType" text, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_execution_interval (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "sessionId" text NOT NULL, "kind" text NOT NULL, "startAt" text NOT NULL, "endAt" text, "timingQuality" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_completion_record (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "taskId" text NOT NULL, "sourceSessionId" text, "operationId" text NOT NULL, "completedAt" text NOT NULL, "taskTitleSnapshot" text NOT NULL, "actualDurationSeconds" double precision, "durationCoverage" text NOT NULL, "achievementDisposition" text NOT NULL, "source" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_achievement (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "sourceCompletionRecordId" text NOT NULL, "sourceTaskId" text NOT NULL, "sourceExecutionSessionId" text, "title" text NOT NULL, "summary" text, "evidenceType" text NOT NULL, "occurredAt" text NOT NULL, "userEdited" boolean NOT NULL, "hidden" boolean NOT NULL, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_task_activity (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "taskId" text NOT NULL, "timeBlockId" text, "eventType" text NOT NULL, "actor" text NOT NULL, "occurredAt" text NOT NULL, "localDate" text NOT NULL, "timeZone" text NOT NULL, "operationId" text NOT NULL, "beforeSummary" jsonb, "afterSummary" jsonb, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_reflection (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "localDate" text NOT NULL, "timeZone" text NOT NULL, "summary" text NOT NULL, "wins" jsonb NOT NULL, "adjustmentSuggestion" text, "userNote" text, "generatedBy" text NOT NULL, "createdAt" text NOT NULL, "updatedAt" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_energy_check_in (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "localDate" text NOT NULL, "timeZone" text NOT NULL, "level" double precision NOT NULL, "note" text, "createdAt" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_relax_session (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "type" text NOT NULL, "plannedMinutes" double precision NOT NULL, "actualSeconds" double precision, "startedAt" text NOT NULL, "endedAt" text, "source" text NOT NULL, "status" text NOT NULL, "timingQuality" text NOT NULL, "createdAt" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE TABLE facts_preference (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "key" text NOT NULL, "valueJson" jsonb NOT NULL, "updatedAt" text NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
ALTER TABLE facts_project ADD FOREIGN KEY(user_id,"goalId") REFERENCES facts_goal(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_task ADD FOREIGN KEY(user_id,"projectId") REFERENCES facts_project(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_task ADD FOREIGN KEY(user_id,"goalId") REFERENCES facts_goal(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_task ADD FOREIGN KEY(user_id,"parentTaskId") REFERENCES facts_task(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_time_block ADD FOREIGN KEY(user_id,"taskId") REFERENCES facts_task(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_execution_session ADD FOREIGN KEY(user_id,"taskId") REFERENCES facts_task(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_execution_session ADD FOREIGN KEY(user_id,"timeBlockId") REFERENCES facts_time_block(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_execution_interval ADD FOREIGN KEY(user_id,"sessionId") REFERENCES facts_execution_session(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_completion_record ADD FOREIGN KEY(user_id,"taskId") REFERENCES facts_task(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_completion_record ADD FOREIGN KEY(user_id,"sourceSessionId") REFERENCES facts_execution_session(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_completion_record ADD FOREIGN KEY(user_id,"operationId") REFERENCES facts_operation_provenance(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_achievement ADD FOREIGN KEY(user_id,"sourceCompletionRecordId") REFERENCES facts_completion_record(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_achievement ADD FOREIGN KEY(user_id,"sourceTaskId") REFERENCES facts_task(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_achievement ADD FOREIGN KEY(user_id,"sourceExecutionSessionId") REFERENCES facts_execution_session(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_task_activity ADD FOREIGN KEY(user_id,"taskId") REFERENCES facts_task(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_task_activity ADD FOREIGN KEY(user_id,"timeBlockId") REFERENCES facts_time_block(user_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE facts_task_activity ADD FOREIGN KEY(user_id,"operationId") REFERENCES facts_operation_provenance(user_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX facts_completion_task_unique ON facts_completion_record(user_id,"taskId");
CREATE UNIQUE INDEX facts_achievement_completion_unique ON facts_achievement(user_id,"sourceCompletionRecordId");
CREATE UNIQUE INDEX facts_session_active_unique ON facts_execution_session(user_id) WHERE status IN ('running','paused');
CREATE UNIQUE INDEX facts_relax_active_unique ON facts_relax_session(user_id) WHERE status='active';
CREATE UNIQUE INDEX facts_preference_key_unique ON facts_preference(user_id,"key");
CREATE UNIQUE INDEX facts_reflection_day_unique ON facts_reflection(user_id,"localDate","timeZone");
CREATE VIEW sync_entities AS SELECT user_id, 'operation_provenance'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_operation_provenance f
UNION ALL
SELECT user_id, 'goal'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_goal f
UNION ALL
SELECT user_id, 'project'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_project f
UNION ALL
SELECT user_id, 'task'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_task f
UNION ALL
SELECT user_id, 'time_block'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_time_block f
UNION ALL
SELECT user_id, 'execution_session'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_execution_session f
UNION ALL
SELECT user_id, 'execution_interval'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_execution_interval f
UNION ALL
SELECT user_id, 'completion_record'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_completion_record f
UNION ALL
SELECT user_id, 'achievement'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_achievement f
UNION ALL
SELECT user_id, 'task_activity'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_task_activity f
UNION ALL
SELECT user_id, 'reflection'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_reflection f
UNION ALL
SELECT user_id, 'energy_check_in'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_energy_check_in f
UNION ALL
SELECT user_id, 'relax_session'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_relax_session f
UNION ALL
SELECT user_id, 'preference'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_preference f;
-- +goose Down
DROP VIEW sync_entities;
DROP TABLE facts_preference, facts_relax_session, facts_energy_check_in, facts_reflection, facts_task_activity, facts_achievement, facts_completion_record, facts_execution_interval, facts_execution_session, facts_time_block, facts_task, facts_project, facts_goal, facts_operation_provenance, sync_bootstraps, sync_conflicts, sync_changes, sync_batches, sync_heads, sessions, devices, users CASCADE;
