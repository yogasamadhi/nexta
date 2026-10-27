import { writeFileSync } from 'node:fs';
import {
  cloudEntitySchema,
  syncEntityFields,
  type SyncKind,
  type SyncDocument,
} from '@workspace/application';
const at = '2026-10-25T10:00:00.000Z',
  end = '2026-10-25T10:20:00.000Z';
const data: Record<SyncKind, SyncDocument> = {
  operation_provenance: {
    id: 'op_complete',
    command: 'execution.complete',
    occurredAt: end,
  },
  goal: { id: 'goal_1', status: 'active' },
  project: { id: 'project_1', goalId: 'goal_1', status: 'active' },
  task: {
    id: 'task_1',
    projectId: 'project_1',
    goalId: 'goal_1',
    status: 'completed',
    priority: 'normal',
    estimatedDurationMinutes: 30,
    actualDurationMinutes: 20,
    completedAt: end,
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'manual',
  },
  time_block: {
    id: 'block_1',
    taskId: 'task_1',
    type: 'task',
    status: 'completed',
    startAt: at,
    endAt: end,
    source: 'scheduler',
    locked: false,
  },
  execution_session: {
    id: 'session_1',
    taskId: 'task_1',
    timeBlockId: 'block_1',
    startedAt: at,
    endedAt: end,
    status: 'completed',
    completionType: 'complete_task',
    pausedDurationSeconds: 0,
  },
  execution_interval: {
    id: 'interval_1',
    sessionId: 'session_1',
    kind: 'work',
    startAt: at,
    endAt: end,
    timingQuality: 'trusted',
  },
  completion_record: {
    id: 'completion_1',
    taskId: 'task_1',
    sourceSessionId: 'session_1',
    operationId: 'op_complete',
    completedAt: end,
    taskTitleSnapshot: 'Recorded task',
    actualDurationSeconds: 1200,
    durationCoverage: 'complete',
    achievementDisposition: 'record',
    source: 'user',
  },
  achievement: {
    id: 'achievement_1',
    sourceCompletionRecordId: 'completion_1',
    sourceTaskId: 'task_1',
    sourceExecutionSessionId: 'session_1',
    evidenceType: 'completion_record',
    occurredAt: end,
    userEdited: false,
    hidden: false,
  },
  task_activity: {
    id: 'activity_1',
    taskId: 'task_1',
    timeBlockId: 'block_1',
    eventType: 'complete_task',
    actor: 'user',
    occurredAt: end,
    operationId: 'op_complete',
    beforeSummary: { status: 'in_progress' },
    afterSummary: { status: 'completed' },
  },
  reflection: {
    id: 'reflection_1',
    summary: 'One task completed.',
    wins: [
      {
        completionRecordId: 'completion_1',
        taskId: 'task_1',
        title: 'Recorded task',
        completedAt: end,
      },
    ],
    generatedBy: 'local_facts',
  },
  energy_check_in: { id: 'energy_1', level: 3 },
  relax_session: {
    id: 'relax_1',
    type: 'breathing',
    plannedMinutes: 1,
    actualSeconds: 60,
    startedAt: at,
    endedAt: end,
    source: 'relax_tab',
    status: 'completed',
    timingQuality: 'trusted',
  },
  preference: {
    id: 'preference_1',
    key: 'notification.leadMinutes.v1',
    valueJson: { leadMinutes: 15 },
  },
  plan_origin: {
    id: 'plan_1',
    originDeviceId: 'fixture_device',
    sourceRevision: 1,
    committedAt: at,
    schedulerVersion: 'fixture-v1',
    policyVersion: 'neutral-v1',
    reason: 'manual_replan',
    affectedBlockIds: ['block_1'],
  },
};
const entities = Object.entries(data).map(([kind, overrides]) => {
  const fields = syncEntityFields[kind as SyncKind].fields;
  const value: SyncDocument = {};
  for (const [name, field] of Object.entries(fields)) {
    value[name] = field.nullable
      ? null
      : field.type === 'instant'
        ? at
        : field.type === 'date'
          ? '2026-10-25'
          : field.type === 'zone'
            ? 'Asia/Singapore'
            : field.type === 'number'
              ? 0
              : field.type === 'boolean'
                ? false
                : field.type === 'json'
                  ? {}
                  : name === 'description'
                    ? ''
                    : 'Recorded task';
  }
  Object.assign(value, overrides);
  const key =
    kind === 'preference'
      ? String(value.key)
      : kind === 'reflection'
        ? `${String(value.localDate)}@${String(value.timeZone)}`
        : String(value.id);
  return cloudEntitySchema.parse({
    kind,
    key,
    version: '0',
    ownerDeviceId: '',
    value,
  });
});
writeFileSync(
  'server/contracts/fixtures.json',
  JSON.stringify(
    {
      schemaVersion: 1,
      batchId: 'fixture_complete_graph_v1',
      changes: entities,
    },
    null,
    2,
  ) + '\n',
);
