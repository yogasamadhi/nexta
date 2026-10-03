import {
  assertValidExecutionInterval,
  assertValidExecutionSession,
  assertValidTimeBlock,
  parseExecutionIntervalId,
  parseExecutionSessionId,
  parseInstant,
  parseOperationId,
  parseTaskId,
  parseTimeBlockId,
  type ExecutionInterval,
  type ExecutionSession,
  type Task,
  type TimeBlock,
} from '@workspace/domain';
import { z } from 'zod';

import { integrationStatusSchema } from './schedule-schemas';
import {
  achievementSnapshotSchema,
  completionRecordSnapshotSchema,
  taskSnapshotSchema,
} from './schemas';

const nonEmptyString = z.string().trim().min(1);
const safeVersion = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const startExecutionInputSchema = z
  .object({
    taskId: nonEmptyString,
    timeBlockId: nonEmptyString.nullable().optional(),
  })
  .strict();

export const executionSessionInputSchema = z
  .object({ sessionId: nonEmptyString })
  .strict();

export const finishExecutionInputSchema = z
  .object({
    sessionId: nonEmptyString,
    outcome: z.enum(['finish_session', 'complete_task']),
    recordAchievement: z.boolean().optional(),
    allEffortRecorded: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.outcome === 'finish_session' &&
      (input.recordAchievement !== undefined ||
        input.allEffortRecorded !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Completion evidence options only apply to complete_task.',
        path: ['outcome'],
      });
    }
  });

export type StartExecutionInput = z.input<typeof startExecutionInputSchema>;
export type ExecutionSessionInput = z.input<typeof executionSessionInputSchema>;
export type FinishExecutionInput = z.input<typeof finishExecutionInputSchema>;

export const executionSessionSnapshotSchema = z
  .object({
    id: nonEmptyString,
    taskId: nonEmptyString,
    timeBlockId: nonEmptyString.nullable(),
    startedAt: nonEmptyString,
    endedAt: nonEmptyString.nullable(),
    pausedDurationSeconds: z.number().int().nonnegative(),
    activeIntervalStartedAt: nonEmptyString.nullable(),
    pausedAt: nonEmptyString.nullable(),
    status: z.enum(['running', 'paused', 'completed', 'abandoned']),
    completionType: z.enum(['finish_session', 'complete_task']).nullable(),
    createdAt: nonEmptyString,
    updatedAt: nonEmptyString,
  })
  .strict()
  .transform((value): ExecutionSession => {
    const session: ExecutionSession = {
      ...value,
      id: parseExecutionSessionId(value.id),
      taskId: parseTaskId(value.taskId),
      timeBlockId:
        value.timeBlockId === null ? null : parseTimeBlockId(value.timeBlockId),
      startedAt: parseInstant(value.startedAt),
      endedAt: value.endedAt === null ? null : parseInstant(value.endedAt),
      activeIntervalStartedAt:
        value.activeIntervalStartedAt === null
          ? null
          : parseInstant(value.activeIntervalStartedAt),
      pausedAt: value.pausedAt === null ? null : parseInstant(value.pausedAt),
      createdAt: parseInstant(value.createdAt),
      updatedAt: parseInstant(value.updatedAt),
    };
    assertValidExecutionSession(session);
    return session;
  });

export const executionIntervalSnapshotSchema = z
  .object({
    id: nonEmptyString,
    sessionId: nonEmptyString,
    kind: z.enum(['work', 'pause']),
    startAt: nonEmptyString,
    endAt: nonEmptyString.nullable(),
    timingQuality: z.enum(['trusted', 'needs_review']),
  })
  .strict()
  .transform((value): ExecutionInterval => {
    const interval: ExecutionInterval = {
      ...value,
      id: parseExecutionIntervalId(value.id),
      sessionId: parseExecutionSessionId(value.sessionId),
      startAt: parseInstant(value.startAt),
      endAt: value.endAt === null ? null : parseInstant(value.endAt),
    };
    assertValidExecutionInterval(interval);
    return interval;
  });

export const timeBlockSnapshotSchema = z
  .object({
    id: nonEmptyString,
    taskId: nonEmptyString.nullable(),
    type: z.enum(['task', 'break', 'relax', 'buffer']),
    startAt: nonEmptyString,
    endAt: nonEmptyString,
    status: z.enum(['planned', 'started', 'completed', 'skipped', 'canceled']),
    source: nonEmptyString,
    locked: z.boolean(),
    planRevision: safeVersion,
    externalCalendarEventId: nonEmptyString.nullable(),
    createdAt: nonEmptyString,
    updatedAt: nonEmptyString,
  })
  .strict()
  .transform((value): TimeBlock => {
    const block: TimeBlock = {
      ...value,
      id: parseTimeBlockId(value.id),
      taskId: value.taskId === null ? null : parseTaskId(value.taskId),
      startAt: parseInstant(value.startAt),
      endAt: parseInstant(value.endAt),
      createdAt: parseInstant(value.createdAt),
      updatedAt: parseInstant(value.updatedAt),
    };
    assertValidTimeBlock(block);
    return block;
  });

const mutationFields = {
  operationId: nonEmptyString.transform(parseOperationId),
  stateVersion: safeVersion,
  planRevision: safeVersion,
  calendar: integrationStatusSchema,
  notifications: integrationStatusSchema,
} as const;

export const executionMutationResultSchema = z
  .object({
    session: executionSessionSnapshotSchema,
    intervals: z.array(executionIntervalSnapshotSchema),
    task: taskSnapshotSchema,
    timeBlock: timeBlockSnapshotSchema.nullable(),
    recordedWorkSeconds: z.number().int().nonnegative(),
    ...mutationFields,
  })
  .strict();

export const executionFinishResultSchema = z
  .object({
    session: executionSessionSnapshotSchema,
    intervals: z.array(executionIntervalSnapshotSchema),
    task: taskSnapshotSchema,
    timeBlock: timeBlockSnapshotSchema.nullable(),
    recordedWorkSeconds: z.number().int().nonnegative(),
    completionRecord: completionRecordSnapshotSchema.nullable(),
    achievement: achievementSnapshotSchema.nullable(),
    ...mutationFields,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.session.taskId !== result.task.id) {
      context.addIssue({
        code: 'custom',
        message: 'Execution result Session and Task must agree.',
        path: ['task', 'id'],
      });
    }
    if (
      result.completionRecord !== null &&
      result.completionRecord.taskId !== result.task.id
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Execution completion evidence must reference the Task.',
        path: ['completionRecord', 'taskId'],
      });
    }
    if (
      result.achievement !== null &&
      result.completionRecord?.id !==
        result.achievement.sourceCompletionRecordId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Achievement must reference the returned completion evidence.',
        path: ['achievement', 'sourceCompletionRecordId'],
      });
    }
  });

export type ExecutionMutationResult = z.output<
  typeof executionMutationResultSchema
>;
export type ExecutionFinishResult = z.output<
  typeof executionFinishResultSchema
>;

export type ExecutionDetails = Readonly<{
  session: ExecutionSession;
  intervals: readonly ExecutionInterval[];
  task: Task;
  timeBlock: TimeBlock | null;
  recordedWorkSeconds: number;
}>;
