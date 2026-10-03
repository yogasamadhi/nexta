import {
  assertValidAchievement,
  assertValidCompletionRecord,
  assertValidGoal,
  assertValidProject,
  assertValidTask,
  parseCompletionRecordId,
  parseAchievementId,
  parseExecutionSessionId,
  parseGoalId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseProjectId,
  parseTaskId,
  parseTimeZoneId,
  type CompletionRecord,
  type Achievement,
  type Goal,
  type Project,
  type Task,
} from '@workspace/domain';
import { z } from 'zod';

const nonEmptyStringSchema = z.string().trim().min(1);
const optionalNullableStringSchema = z.string().nullable().optional();
const optionalNullableNonEmptyStringSchema = nonEmptyStringSchema
  .nullable()
  .optional();
const optionalNullablePositiveNumberSchema = z
  .number()
  .finite()
  .positive()
  .nullable()
  .optional();

export const DEFAULT_TASK_PRIORITY = 'normal';
export const DEFAULT_TASK_SPLITTABLE = false;
export const DEFAULT_TASK_SCHEDULING_POLICY = 'flexible';

export const applicationAuthoritySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z
    .object({
      kind: z.literal('agent_authorized'),
      authorizationId: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('system'),
      reason: nonEmptyStringSchema,
    })
    .strict(),
]);

export const writeContextSchema = z
  .object({
    operationId: nonEmptyStringSchema,
    authority: applicationAuthoritySchema,
  })
  .strict();

export const createTaskInputSchema = z
  .object({
    projectId: optionalNullableNonEmptyStringSchema,
    goalId: optionalNullableNonEmptyStringSchema,
    parentTaskId: optionalNullableNonEmptyStringSchema,
    title: nonEmptyStringSchema,
    description: optionalNullableStringSchema,
    priority: nonEmptyStringSchema.default(DEFAULT_TASK_PRIORITY),
    estimatedDurationMinutes: optionalNullablePositiveNumberSchema,
    remainingDurationMinutes: optionalNullablePositiveNumberSchema,
    categoryKey: optionalNullableNonEmptyStringSchema,
    earliestStartAt: optionalNullableNonEmptyStringSchema,
    deadlineAt: optionalNullableNonEmptyStringSchema,
    deadlineLocalDate: optionalNullableNonEmptyStringSchema,
    deadlineTimeZone: optionalNullableNonEmptyStringSchema,
    splittable: z.boolean().default(DEFAULT_TASK_SPLITTABLE),
    minBlockMinutes: optionalNullablePositiveNumberSchema,
    maxBlockMinutes: optionalNullablePositiveNumberSchema,
    energyDemand: optionalNullableNonEmptyStringSchema,
    schedulingPolicy: nonEmptyStringSchema.default(
      DEFAULT_TASK_SCHEDULING_POLICY,
    ),
  })
  .strict();

export type CreateTaskInput = z.input<typeof createTaskInputSchema>;

export const updateTaskPatchSchema = z
  .object({
    projectId: optionalNullableNonEmptyStringSchema,
    goalId: optionalNullableNonEmptyStringSchema,
    parentTaskId: optionalNullableNonEmptyStringSchema,
    title: nonEmptyStringSchema.optional(),
    description: optionalNullableStringSchema,
    priority: nonEmptyStringSchema.optional(),
    estimatedDurationMinutes: optionalNullablePositiveNumberSchema,
    remainingDurationMinutes: optionalNullablePositiveNumberSchema,
    categoryKey: optionalNullableNonEmptyStringSchema,
    earliestStartAt: optionalNullableNonEmptyStringSchema,
    deadlineAt: optionalNullableNonEmptyStringSchema,
    deadlineLocalDate: optionalNullableNonEmptyStringSchema,
    deadlineTimeZone: optionalNullableNonEmptyStringSchema,
    splittable: z.boolean().optional(),
    minBlockMinutes: optionalNullablePositiveNumberSchema,
    maxBlockMinutes: optionalNullablePositiveNumberSchema,
    energyDemand: optionalNullableNonEmptyStringSchema,
    schedulingPolicy: nonEmptyStringSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Task update patch must not be empty.',
  });

export const updateTaskInputSchema = z
  .object({
    taskId: nonEmptyStringSchema,
    patch: updateTaskPatchSchema,
  })
  .strict();

export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

export const completeTaskInputSchema = z
  .object({
    taskId: nonEmptyStringSchema,
    recordAchievement: z.boolean().optional(),
    allEffortRecorded: z.boolean().optional(),
  })
  .strict();

export type CompleteTaskInput = z.infer<typeof completeTaskInputSchema>;

export const cancelTaskInputSchema = z
  .object({ taskId: nonEmptyStringSchema })
  .strict();

export type CancelTaskInput = z.infer<typeof cancelTaskInputSchema>;

export const taskListInputSchema = z
  .object({
    status: z
      .enum(['inbox', 'planned', 'in_progress', 'completed', 'canceled'])
      .optional(),
    projectId: nonEmptyStringSchema.optional(),
    timeRange: z
      .object({ start: nonEmptyStringSchema, end: nonEmptyStringSchema })
      .strict()
      .optional(),
    cursor: nonEmptyStringSchema.optional(),
    limit: z.number().int().positive().max(50).default(20),
  })
  .strict();

export type TaskListInput = z.input<typeof taskListInputSchema>;

export const goalListInputSchema = z
  .object({
    includeArchived: z.boolean().default(false),
    cursor: nonEmptyStringSchema.optional(),
    limit: z.number().int().positive().max(50).default(20),
  })
  .strict();

export type GoalListInput = z.input<typeof goalListInputSchema>;

export const projectListInputSchema = z
  .object({
    goalId: nonEmptyStringSchema.optional(),
    includeArchived: z.boolean().default(false),
    cursor: nonEmptyStringSchema.optional(),
    limit: z.number().int().positive().max(50).default(20),
  })
  .strict();

export type ProjectListInput = z.input<typeof projectListInputSchema>;

export const createGoalInputSchema = z
  .object({
    title: nonEmptyStringSchema,
    description: z.string().optional(),
    status: nonEmptyStringSchema,
    targetDate: optionalNullableNonEmptyStringSchema,
  })
  .strict();

export type CreateGoalInput = z.infer<typeof createGoalInputSchema>;

export const updateGoalPatchSchema = z
  .object({
    title: nonEmptyStringSchema.optional(),
    description: z.string().optional(),
    status: nonEmptyStringSchema.optional(),
    targetDate: optionalNullableNonEmptyStringSchema,
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Goal update patch must not be empty.',
  });

export const updateGoalInputSchema = z
  .object({
    goalId: nonEmptyStringSchema,
    patch: updateGoalPatchSchema,
  })
  .strict();

export type UpdateGoalInput = z.infer<typeof updateGoalInputSchema>;

export const archiveGoalInputSchema = z
  .object({ goalId: nonEmptyStringSchema })
  .strict();

export type ArchiveGoalInput = z.infer<typeof archiveGoalInputSchema>;

export const createProjectInputSchema = z
  .object({
    goalId: optionalNullableNonEmptyStringSchema,
    title: nonEmptyStringSchema,
    description: z.string().optional(),
    status: nonEmptyStringSchema,
    deadline: optionalNullableNonEmptyStringSchema,
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateProjectPatchSchema = z
  .object({
    goalId: optionalNullableNonEmptyStringSchema,
    title: nonEmptyStringSchema.optional(),
    description: z.string().optional(),
    status: nonEmptyStringSchema.optional(),
    deadline: optionalNullableNonEmptyStringSchema,
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Project update patch must not be empty.',
  });

export const updateProjectInputSchema = z
  .object({
    projectId: nonEmptyStringSchema,
    patch: updateProjectPatchSchema,
  })
  .strict();

export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const archiveProjectInputSchema = z
  .object({ projectId: nonEmptyStringSchema })
  .strict();

export type ArchiveProjectInput = z.infer<typeof archiveProjectInputSchema>;

const storedInstantSchema = nonEmptyStringSchema;
const storedIdSchema = nonEmptyStringSchema;
const storedVersionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const taskSnapshotSchema = z
  .object({
    id: storedIdSchema,
    projectId: storedIdSchema.nullable(),
    goalId: storedIdSchema.nullable(),
    parentTaskId: storedIdSchema.nullable(),
    title: nonEmptyStringSchema,
    description: z.string().nullable(),
    status: z.enum([
      'inbox',
      'planned',
      'in_progress',
      'completed',
      'canceled',
    ]),
    priority: nonEmptyStringSchema,
    estimatedDurationMinutes: z.number().finite().positive().nullable(),
    baselineEstimatedDurationMinutes: z.number().finite().positive().nullable(),
    actualDurationMinutes: z.number().finite().nonnegative().nullable(),
    remainingDurationMinutes: z.number().finite().positive().nullable(),
    categoryKey: nonEmptyStringSchema.nullable(),
    earliestStartAt: storedInstantSchema.nullable(),
    deadlineAt: storedInstantSchema.nullable(),
    deadlineLocalDate: storedInstantSchema.nullable(),
    deadlineTimeZone: storedInstantSchema.nullable(),
    splittable: z.boolean(),
    minBlockMinutes: z.number().finite().positive().nullable(),
    maxBlockMinutes: z.number().finite().positive().nullable(),
    energyDemand: nonEmptyStringSchema.nullable(),
    schedulingPolicy: nonEmptyStringSchema,
    source: nonEmptyStringSchema,
    createdAt: storedInstantSchema,
    updatedAt: storedInstantSchema,
    completedAt: storedInstantSchema.nullable(),
    canceledAt: storedInstantSchema.nullable(),
  })
  .strict()
  .transform((value): Task => {
    const task: Task = {
      ...value,
      id: parseTaskId(value.id),
      projectId:
        value.projectId === null ? null : parseProjectId(value.projectId),
      goalId: value.goalId === null ? null : parseGoalId(value.goalId),
      parentTaskId:
        value.parentTaskId === null ? null : parseTaskId(value.parentTaskId),
      earliestStartAt:
        value.earliestStartAt === null
          ? null
          : parseInstant(value.earliestStartAt),
      deadlineAt:
        value.deadlineAt === null ? null : parseInstant(value.deadlineAt),
      deadlineLocalDate:
        value.deadlineLocalDate === null
          ? null
          : parseLocalDate(value.deadlineLocalDate),
      deadlineTimeZone:
        value.deadlineTimeZone === null
          ? null
          : parseTimeZoneId(value.deadlineTimeZone),
      createdAt: parseInstant(value.createdAt),
      updatedAt: parseInstant(value.updatedAt),
      completedAt:
        value.completedAt === null ? null : parseInstant(value.completedAt),
      canceledAt:
        value.canceledAt === null ? null : parseInstant(value.canceledAt),
    };
    assertValidTask(task);
    return task;
  });

export const taskPageSchema = z
  .object({
    items: z.array(taskSnapshotSchema).max(50),
    nextCursor: nonEmptyStringSchema.nullable(),
  })
  .strict();

export type TaskPage = z.output<typeof taskPageSchema>;

export const completionRecordSnapshotSchema = z
  .object({
    id: storedIdSchema,
    taskId: storedIdSchema,
    sourceSessionId: storedIdSchema.nullable(),
    operationId: storedIdSchema,
    completedAt: storedInstantSchema,
    taskTitleSnapshot: nonEmptyStringSchema,
    actualDurationSeconds: z.number().finite().nonnegative().nullable(),
    durationCoverage: z.enum(['complete', 'partial', 'unknown']),
    achievementDisposition: z.enum(['record', 'skip']),
    source: z.enum(['user', 'agent_authorized']),
  })
  .strict()
  .transform((value): CompletionRecord => {
    const record: CompletionRecord = {
      ...value,
      id: parseCompletionRecordId(value.id),
      taskId: parseTaskId(value.taskId),
      sourceSessionId:
        value.sourceSessionId === null
          ? null
          : parseExecutionSessionId(value.sourceSessionId),
      operationId: parseOperationId(value.operationId),
      completedAt: parseInstant(value.completedAt),
    };
    assertValidCompletionRecord(record);
    return record;
  });

export const achievementSnapshotSchema = z
  .object({
    id: storedIdSchema,
    sourceCompletionRecordId: storedIdSchema,
    sourceTaskId: storedIdSchema,
    sourceExecutionSessionId: storedIdSchema.nullable(),
    title: nonEmptyStringSchema,
    summary: z.string().nullable(),
    evidenceType: nonEmptyStringSchema,
    occurredAt: storedInstantSchema,
    userEdited: z.boolean(),
    hidden: z.boolean(),
    createdAt: storedInstantSchema,
    updatedAt: storedInstantSchema,
  })
  .strict()
  .transform((value): Achievement => {
    const achievement: Achievement = {
      ...value,
      id: parseAchievementId(value.id),
      sourceCompletionRecordId: parseCompletionRecordId(
        value.sourceCompletionRecordId,
      ),
      sourceTaskId: parseTaskId(value.sourceTaskId),
      sourceExecutionSessionId:
        value.sourceExecutionSessionId === null
          ? null
          : parseExecutionSessionId(value.sourceExecutionSessionId),
      occurredAt: parseInstant(value.occurredAt),
      createdAt: parseInstant(value.createdAt),
      updatedAt: parseInstant(value.updatedAt),
    };
    assertValidAchievement(achievement);
    return achievement;
  });

export const goalSnapshotSchema = z
  .object({
    id: storedIdSchema,
    title: nonEmptyStringSchema,
    description: z.string(),
    status: nonEmptyStringSchema,
    targetDate: storedInstantSchema.nullable(),
    createdAt: storedInstantSchema,
    updatedAt: storedInstantSchema,
    archivedAt: storedInstantSchema.nullable(),
  })
  .strict()
  .transform((value): Goal => {
    const goal: Goal = {
      ...value,
      id: parseGoalId(value.id),
      targetDate:
        value.targetDate === null ? null : parseLocalDate(value.targetDate),
      createdAt: parseInstant(value.createdAt),
      updatedAt: parseInstant(value.updatedAt),
      archivedAt:
        value.archivedAt === null ? null : parseInstant(value.archivedAt),
    };
    assertValidGoal(goal);
    return goal;
  });

export const projectSnapshotSchema = z
  .object({
    id: storedIdSchema,
    goalId: storedIdSchema.nullable(),
    title: nonEmptyStringSchema,
    description: z.string(),
    status: nonEmptyStringSchema,
    deadline: storedInstantSchema.nullable(),
    createdAt: storedInstantSchema,
    updatedAt: storedInstantSchema,
    archivedAt: storedInstantSchema.nullable(),
  })
  .strict()
  .transform((value): Project => {
    const project: Project = {
      ...value,
      id: parseProjectId(value.id),
      goalId: value.goalId === null ? null : parseGoalId(value.goalId),
      deadline: value.deadline === null ? null : parseInstant(value.deadline),
      createdAt: parseInstant(value.createdAt),
      updatedAt: parseInstant(value.updatedAt),
      archivedAt:
        value.archivedAt === null ? null : parseInstant(value.archivedAt),
    };
    assertValidProject(project);
    return project;
  });

export const goalPageSchema = z
  .object({
    items: z.array(goalSnapshotSchema).max(50),
    nextCursor: nonEmptyStringSchema.nullable(),
  })
  .strict();

export type GoalPage = z.output<typeof goalPageSchema>;

export const projectPageSchema = z
  .object({
    items: z.array(projectSnapshotSchema).max(50),
    nextCursor: nonEmptyStringSchema.nullable(),
  })
  .strict();

export type ProjectPage = z.output<typeof projectPageSchema>;

const operationResultFields = {
  operationId: storedIdSchema.transform((value) => parseOperationId(value)),
  stateVersion: storedVersionSchema,
  planRevision: storedVersionSchema,
} as const;

export const taskMutationResultSchema = z
  .object({
    task: taskSnapshotSchema,
    ...operationResultFields,
  })
  .strict();

export type TaskMutationResult = z.output<typeof taskMutationResultSchema>;

const terminalTaskIntegrationStatusSchema = z.enum([
  'synced',
  'pending',
  'permission_required',
  'failed',
  'disabled',
  'reconciliation_required',
  'superseded',
]);

export const taskCancellationResultSchema = z
  .object({
    task: taskSnapshotSchema,
    calendar: terminalTaskIntegrationStatusSchema,
    notifications: terminalTaskIntegrationStatusSchema,
    ...operationResultFields,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.task.status !== 'canceled') {
      context.addIssue({
        code: 'custom',
        message: 'Cancellation result Task must be canceled.',
        path: ['task', 'status'],
      });
    }
  });

export type TaskCancellationResult = z.output<
  typeof taskCancellationResultSchema
>;

export const taskCompletionResultSchema = z
  .object({
    task: taskSnapshotSchema,
    completionRecord: completionRecordSnapshotSchema,
    achievement: achievementSnapshotSchema.nullable().optional(),
    calendar: z
      .enum([
        'synced',
        'pending',
        'permission_required',
        'failed',
        'disabled',
        'reconciliation_required',
        'superseded',
      ])
      .optional(),
    notifications: z
      .enum([
        'synced',
        'pending',
        'permission_required',
        'failed',
        'disabled',
        'reconciliation_required',
        'superseded',
      ])
      .optional(),
    ...operationResultFields,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.task.status !== 'completed') {
      context.addIssue({
        code: 'custom',
        message: 'Completion result Task must be completed.',
        path: ['task', 'status'],
      });
    }
    if (result.task.id !== result.completionRecord.taskId) {
      context.addIssue({
        code: 'custom',
        message: 'Completion result entities must reference the same Task.',
        path: ['completionRecord', 'taskId'],
      });
    }
    if (result.task.completedAt !== result.completionRecord.completedAt) {
      context.addIssue({
        code: 'custom',
        message: 'Completion result timestamps must agree.',
        path: ['completionRecord', 'completedAt'],
      });
    }
  });

export type TaskCompletionResult = z.output<typeof taskCompletionResultSchema>;

export const goalMutationResultSchema = z
  .object({
    goal: goalSnapshotSchema,
    ...operationResultFields,
  })
  .strict();

export type GoalMutationResult = z.output<typeof goalMutationResultSchema>;

export const projectMutationResultSchema = z
  .object({
    project: projectSnapshotSchema,
    ...operationResultFields,
  })
  .strict();

export type ProjectMutationResult = z.output<
  typeof projectMutationResultSchema
>;
