-- +goose Up
CREATE TABLE facts_plan_origin (user_id text NOT NULL REFERENCES users(id), entity_key text NOT NULL, version bigint NOT NULL CHECK(version>0), owner_device_id text NOT NULL, "id" text NOT NULL, "originDeviceId" text NOT NULL, "sourceRevision" double precision NOT NULL, "committedAt" text NOT NULL, "schedulerVersion" text NOT NULL, "policyVersion" text NOT NULL, "timeZone" text NOT NULL, "reason" text NOT NULL, "affectedBlockIds" jsonb NOT NULL, PRIMARY KEY(user_id,entity_key), UNIQUE(user_id,id));
CREATE OR REPLACE VIEW sync_entities AS SELECT user_id, 'operation_provenance'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_operation_provenance f
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
SELECT user_id, 'preference'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_preference f
UNION ALL
SELECT user_id, 'plan_origin'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_plan_origin f;
-- +goose Down
CREATE OR REPLACE VIEW sync_entities AS SELECT user_id, 'operation_provenance'::text AS kind, entity_key, version, owner_device_id, to_jsonb(f)-'user_id'-'entity_key'-'version'-'owner_device_id' AS document FROM facts_operation_provenance f
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
DROP TABLE facts_plan_origin;
