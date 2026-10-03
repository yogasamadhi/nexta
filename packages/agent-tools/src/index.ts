import {
  AgentToolRegistry,
  type AgentAbortSignal,
  type AgentRunResult,
  type AgentRuntime,
  type StartAgentRunInput,
  type AgentTool,
  type AgentToolExecutionContext,
  type ToolRisk,
  type ModelProvider,
  type ModelUsage,
} from '@workspace/agent-core';
import {
  ApplicationError,
  achievementMutationResultSchema,
  achievementPageSchema,
  calendarBusySourcesPreferenceValueSchema,
  checkInEnabledPreferenceValueSchema,
  calendarCachedBusyRequestSchema,
  calendarCachedBusyResultSchema,
  completeTaskInputSchema,
  createAchievementInputSchema,
  createTaskInputSchema,
  executionFinishResultSchema,
  executionMutationResultSchema,
  finishExecutionInputSchema,
  notificationLeadMinutesPreferenceValueSchema,
  preferenceMutationResultSchema,
  personalizationEnabledPreferenceValueSchema,
  readPreferenceKeySchema,
  relaxSuggestionsEnabledPreferenceValueSchema,
  scheduleCommitInputSchema,
  scheduleCommitResultSchema,
  schedulePreviewRequestSchema,
  schedulePreviewSchema,
  schedulingTimeZonePreferenceValueSchema,
  schedulingWorkingHoursPreferenceValueSchema,
  startExecutionInputSchema,
  taskCompletionResultSchema,
  taskListInputSchema,
  taskMutationResultSchema,
  taskPageSchema,
  updatePreferenceInputSchema,
  updateTaskInputSchema,
  type AchievementService,
  type AgentRunMetadataService,
  type CalendarService,
  type ExecutionService,
  type IntegrationService,
  type PreferenceService,
  type ScheduleService,
  type TaskService,
  type WriteContext,
} from '@workspace/application';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const achievementListToolInputSchema = z
  .object({
    localDateRange: z
      .object({
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict()
      .optional(),
    timeZone: nonEmptyString.optional(),
    cursor: nonEmptyString.optional(),
    limit: z.number().int().positive().max(50).default(20),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.localDateRange === undefined) !==
      (input.timeZone === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'localDateRange and timeZone must be supplied together.',
      });
    }
    if (
      input.localDateRange !== undefined &&
      input.localDateRange.end < input.localDateRange.start
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Local date range end must not precede start.',
        path: ['localDateRange', 'end'],
      });
    }
  });

const calendarListBusyToolInputSchema = calendarCachedBusyRequestSchema;
const notificationRescheduleInputSchema = z
  .object({
    planRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const preferenceReadInputSchema = z
  .object({
    keys: z.array(readPreferenceKeySchema).min(1).max(4),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.keys).size !== input.keys.length) {
      context.addIssue({
        code: 'custom',
        message: 'Preference keys must be unique.',
      });
    }
  });

const preferenceValueSchema = z.union([
  schedulingTimeZonePreferenceValueSchema,
  schedulingWorkingHoursPreferenceValueSchema,
  calendarBusySourcesPreferenceValueSchema,
  notificationLeadMinutesPreferenceValueSchema,
  personalizationEnabledPreferenceValueSchema,
  checkInEnabledPreferenceValueSchema,
  relaxSuggestionsEnabledPreferenceValueSchema,
]);
const preferenceReadOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            key: readPreferenceKeySchema,
            value: preferenceValueSchema.nullable(),
            updatedAt: nonEmptyString.nullable(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

const integrationChannelStateSchema = z
  .object({
    channel: z.literal('notification'),
    status: z.enum([
      'synced',
      'pending',
      'permission_required',
      'failed',
      'disabled',
      'reconciliation_required',
      'superseded',
      'not_started',
    ]),
    currentPlanRevision: z.number().int().nonnegative(),
    desiredRevision: z.number().int().nonnegative().nullable(),
    jobId: nonEmptyString.nullable(),
    attemptCount: z.number().int().nonnegative(),
    lastErrorCode: nonEmptyString.nullable(),
    automaticRetryEligible: z.boolean(),
    notBefore: nonEmptyString.nullable(),
    updatedAt: nonEmptyString.nullable(),
    bindingConflictCount: z.number().int().nonnegative(),
  })
  .strict();

export type AgentCalendarScope = Readonly<{
  provider: string;
  calendarId: string;
}>;

export type AgentLocalDateRangeResolver = Readonly<{
  resolve(
    input: Readonly<{
      start: string;
      endInclusive: string;
      timeZone: string;
    }>,
  ): Readonly<{ start: string; end: string }>;
}>;

export type AgentToolServices = Readonly<{
  tasks: Pick<TaskService, 'create' | 'update' | 'complete' | 'list'>;
  calendar: Pick<CalendarService, 'listBusy'>;
  scheduler: Pick<ScheduleService, 'preview' | 'replan' | 'commit'>;
  execution: Pick<ExecutionService, 'start' | 'finish'>;
  achievements: Pick<AchievementService, 'create' | 'list'>;
  notifications: Pick<IntegrationService, 'reconcileNotifications'>;
  preferences: Pick<PreferenceService, 'get' | 'update'>;
  calendarScopes: readonly AgentCalendarScope[];
  localDateRanges: AgentLocalDateRangeResolver;
}>;

type ToolDefinition<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
> = Readonly<{
  name: string;
  description: string;
  risk: ToolRisk;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  assessRisk?: (input: z.output<InputSchema>) => ToolRisk;
  execute: (
    input: z.output<InputSchema>,
    context: AgentToolExecutionContext,
  ) => Promise<unknown>;
}>;

function defineTool<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(definition: ToolDefinition<InputSchema, OutputSchema>): AgentTool {
  return {
    ...definition,
    inputJsonSchema: z.toJSONSchema(definition.inputSchema, { io: 'input' }),
    execute: async (input, context) =>
      definition.execute(input as z.output<InputSchema>, context),
  } as AgentTool;
}

function requireActive(context: AgentToolExecutionContext): void {
  if (context.signal.aborted) {
    throw Object.assign(new Error('Tool execution was aborted.'), {
      code: 'aborted',
      retryable: true,
    });
  }
}

function writeContext(context: AgentToolExecutionContext): WriteContext {
  requireActive(context);
  if (context.authorizationId === null) {
    throw new ApplicationError(
      'permission_required',
      'An approved write authorization is required.',
      { retryable: false },
    );
  }
  return {
    operationId: `agent:${context.runId}:${context.toolCallId}`,
    authority: {
      kind: 'agent_authorized',
      authorizationId: context.authorizationId,
    },
  };
}

function assertCalendarScope(
  input: Readonly<{ provider: string; calendarId: string }>,
  scopes: readonly AgentCalendarScope[],
): void {
  if (
    !scopes.some(
      (scope) =>
        scope.provider === input.provider &&
        scope.calendarId === input.calendarId,
    )
  ) {
    throw new ApplicationError(
      'permission_required',
      'The requested calendar is outside the authorized busy scope.',
      { retryable: false },
    );
  }
}

function taskUpdateRisk(
  input: z.output<typeof updateTaskInputSchema>,
): ToolRisk {
  const presentationOnly = new Set(['title', 'description']);
  return Object.keys(input.patch).every((key) => presentationOnly.has(key))
    ? 'low_write'
    : 'high_write';
}

export function createV1AgentTools(
  services: AgentToolServices,
): readonly AgentTool[] {
  return [
    defineTool({
      name: 'task.create',
      description:
        'Create a validated local Task without changing its status directly.',
      risk: 'low_write',
      inputSchema: createTaskInputSchema,
      outputSchema: taskMutationResultSchema,
      execute: (input, context) =>
        services.tasks.create(input, writeContext(context)),
    }),
    defineTool({
      name: 'task.update',
      description:
        'Update only the ordinary editable fields of an existing Task.',
      risk: 'low_write',
      assessRisk: taskUpdateRisk,
      inputSchema: updateTaskInputSchema,
      outputSchema: taskMutationResultSchema,
      execute: (input, context) =>
        services.tasks.update(input, writeContext(context)),
    }),
    defineTool({
      name: 'task.complete',
      description: 'Complete a Task and create durable completion evidence.',
      risk: 'high_write',
      inputSchema: completeTaskInputSchema,
      outputSchema: taskCompletionResultSchema,
      execute: (input, context) =>
        services.tasks.complete(input, writeContext(context)),
    }),
    defineTool({
      name: 'task.list',
      description: 'Read a bounded page of local Tasks using approved filters.',
      risk: 'read',
      inputSchema: taskListInputSchema,
      outputSchema: taskPageSchema,
      execute: (input, context) => {
        requireActive(context);
        return services.tasks.list(input);
      },
    }),
    defineTool({
      name: 'calendar.listBusy',
      description:
        'Read bounded cached busy intervals without event titles or identifiers.',
      risk: 'read',
      inputSchema: calendarListBusyToolInputSchema,
      outputSchema: calendarCachedBusyResultSchema,
      execute: (input, context) => {
        requireActive(context);
        assertCalendarScope(input, services.calendarScopes);
        return services.calendar.listBusy(input);
      },
    }),
    defineTool({
      name: 'scheduler.preview',
      description:
        'Calculate a schedule preview without committing local or external changes.',
      risk: 'read',
      inputSchema: schedulePreviewRequestSchema,
      outputSchema: schedulePreviewSchema,
      execute: (input, context) => {
        requireActive(context);
        return services.scheduler.preview(input);
      },
    }),
    defineTool({
      name: 'scheduler.replan',
      description: 'Calculate a replan diff without committing it.',
      risk: 'read',
      inputSchema: schedulePreviewRequestSchema,
      outputSchema: schedulePreviewSchema,
      execute: (input, context) => {
        requireActive(context);
        return services.scheduler.replan(input);
      },
    }),
    defineTool({
      name: 'scheduler.commit',
      description:
        'Commit one reviewed preview against its exact state version.',
      risk: 'high_write',
      inputSchema: scheduleCommitInputSchema,
      outputSchema: scheduleCommitResultSchema,
      execute: (input, context) =>
        services.scheduler.commit(input, writeContext(context)),
    }),
    defineTool({
      name: 'execution.start',
      description:
        'Start focus execution for one Task and optional planned TimeBlock.',
      risk: 'low_write',
      inputSchema: startExecutionInputSchema,
      outputSchema: executionMutationResultSchema,
      execute: (input, context) =>
        services.execution.start(input, writeContext(context)),
    }),
    defineTool({
      name: 'execution.complete',
      description:
        'Finish a focus session with an explicit session-only or Task-completion outcome.',
      risk: 'high_write',
      inputSchema: finishExecutionInputSchema,
      outputSchema: executionFinishResultSchema,
      execute: (input, context) =>
        services.execution.finish(input, writeContext(context)),
    }),
    defineTool({
      name: 'achievement.create',
      description:
        'Create an Achievement only from an existing CompletionRecord.',
      risk: 'low_write',
      inputSchema: createAchievementInputSchema,
      outputSchema: achievementMutationResultSchema,
      execute: (input, context) =>
        services.achievements.create(input, writeContext(context)),
    }),
    defineTool({
      name: 'achievement.list',
      description:
        'Read a bounded page of real, non-hidden completion Achievements.',
      risk: 'read',
      inputSchema: achievementListToolInputSchema,
      outputSchema: achievementPageSchema,
      async execute(input, context) {
        requireActive(context);
        const range =
          input.localDateRange === undefined
            ? undefined
            : services.localDateRanges.resolve({
                start: input.localDateRange.start,
                endInclusive: input.localDateRange.end,
                timeZone: input.timeZone!,
              });
        return services.achievements.list({
          ...(range === undefined ? {} : { range }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          limit: input.limit,
        });
      },
    }),
    defineTool({
      name: 'notification.reschedule',
      description:
        'Reconcile notifications only for the current committed plan revision.',
      risk: 'low_write',
      inputSchema: notificationRescheduleInputSchema,
      outputSchema: integrationChannelStateSchema,
      execute: (input, context) => {
        writeContext(context);
        return services.notifications.reconcileNotifications(
          input.planRevision,
        );
      },
    }),
    defineTool({
      name: 'preference.read',
      description:
        'Read only explicitly requested non-secret scheduling and wellbeing preferences.',
      risk: 'read',
      inputSchema: preferenceReadInputSchema,
      outputSchema: preferenceReadOutputSchema,
      async execute(input, context) {
        requireActive(context);
        const preferences = await Promise.all(
          input.keys.map((key) => services.preferences.get(key)),
        );
        return {
          items: input.keys.map((key, index) => ({
            key,
            value: preferences[index]?.valueJson ?? null,
            updatedAt: preferences[index]?.updatedAt ?? null,
          })),
        };
      },
    }),
    defineTool({
      name: 'preference.update',
      description:
        'Request a validated non-secret preference update; direct-user-only settings remain blocked by the application policy.',
      risk: 'high_write',
      inputSchema: updatePreferenceInputSchema,
      outputSchema: preferenceMutationResultSchema,
      execute: (input, context) =>
        services.preferences.update(input, writeContext(context)),
    }),
  ];
}

export function createV1AgentToolRegistry(
  services: AgentToolServices,
): AgentToolRegistry {
  return new AgentToolRegistry(createV1AgentTools(services));
}

export const v1AgentToolNames = [
  'task.create',
  'task.update',
  'task.complete',
  'task.list',
  'calendar.listBusy',
  'scheduler.preview',
  'scheduler.replan',
  'scheduler.commit',
  'execution.start',
  'execution.complete',
  'achievement.create',
  'achievement.list',
  'notification.reschedule',
  'preference.read',
  'preference.update',
] as const;

export type V1AgentToolName = (typeof v1AgentToolNames)[number];

const captureUncertainFieldSchema = z.enum([
  'title',
  'description',
  'duration',
  'earliestStart',
  'deadline',
  'project',
  'goal',
]);

const capturePreviewCallSchema = z
  .object({
    draft: createTaskInputSchema,
    uncertainFields: z
      .array(captureUncertainFieldSchema)
      .max(7)
      .refine((fields) => new Set(fields).size === fields.length, {
        message: 'Uncertain fields must be unique.',
      }),
  })
  .strict();

export type NaturalLanguageCapturePreview = Readonly<{
  draft: z.output<typeof createTaskInputSchema>;
  uncertainFields: readonly z.output<typeof captureUncertainFieldSchema>[];
  usage: ModelUsage | null;
}>;

export class CapturePreviewError extends Error {
  readonly code: 'aborted' | 'provider_error' | 'invalid_response';
  readonly retryable: boolean;

  constructor(
    code: CapturePreviewError['code'],
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = 'CapturePreviewError';
    this.code = code;
    this.retryable = retryable;
  }
}

const captureSystemMessage = [
  'Convert only the explicit user text into one capture.preview tool call.',
  'Do not invent dates, times, durations, projects, or goals.',
  'List ambiguous or missing interpreted fields in uncertainFields.',
  'Do not complete tasks or commit schedules.',
].join(' ');

export class NaturalLanguageCapturePreviewer {
  readonly #provider: ModelProvider;

  constructor(provider: ModelProvider) {
    this.#provider = provider;
  }

  async preview(
    text: string,
    signal: AgentAbortSignal,
  ): Promise<NaturalLanguageCapturePreview> {
    const normalized = text.trim();
    if (normalized.length === 0 || normalized.length > 4_000) {
      throw new CapturePreviewError(
        'invalid_response',
        'Natural-language capture must contain 1 to 4000 characters.',
        false,
      );
    }
    if (signal.aborted) {
      throw new CapturePreviewError(
        'aborted',
        'Capture preview was aborted.',
        true,
      );
    }
    let response;
    try {
      response = await this.#provider.complete(
        {
          messages: [
            { role: 'system', content: captureSystemMessage },
            { role: 'user', content: normalized },
          ],
          tools: [
            {
              name: 'capture.preview',
              description:
                'Return a non-persistent structured Task draft and explicit uncertainty.',
              inputJsonSchema: z.toJSONSchema(capturePreviewCallSchema, {
                io: 'input',
              }),
            },
          ],
          maxOutputTokens: 1_024,
        },
        signal,
      );
    } catch (error) {
      if (signal.aborted) {
        throw new CapturePreviewError(
          'aborted',
          'Capture preview was aborted.',
          true,
        );
      }
      const retryable =
        typeof error === 'object' &&
        error !== null &&
        (error as { retryable?: unknown }).retryable === true;
      throw new CapturePreviewError(
        'provider_error',
        'The model provider could not create a capture preview.',
        retryable,
      );
    }
    if (
      response.finishReason !== 'tool_calls' ||
      response.toolCalls.length !== 1 ||
      response.toolCalls[0]?.name !== 'capture.preview'
    ) {
      throw new CapturePreviewError(
        'invalid_response',
        'The model provider did not return one capture preview.',
        false,
      );
    }
    let parsed: z.output<typeof capturePreviewCallSchema>;
    try {
      parsed = capturePreviewCallSchema.parse(
        JSON.parse(response.toolCalls[0].argumentsJson),
      );
    } catch {
      throw new CapturePreviewError(
        'invalid_response',
        'The model provider returned an invalid capture preview.',
        false,
      );
    }
    return {
      draft: parsed.draft,
      uncertainFields: parsed.uncertainFields,
      usage: response.usage,
    };
  }
}

export async function runAgentWithMetadata(
  input: Readonly<{
    runtime: AgentRuntime;
    metadata: AgentRunMetadataService;
    modelProvider: string | null;
    run: StartAgentRunInput;
  }>,
): Promise<AgentRunResult> {
  await input.metadata.start({
    runId: input.run.runId,
    trigger: input.run.trigger,
    modelProvider: input.modelProvider,
  });
  let result: AgentRunResult;
  try {
    result = await input.runtime.run(input.run);
  } catch (error) {
    await input.metadata.finish({
      runId: input.run.runId,
      status: 'failed',
      turnCount: input.run.initialState?.turnCount ?? 0,
      errorCode: 'agent_runtime_failure',
    });
    throw error;
  }
  await input.metadata.finish({
    runId: input.run.runId,
    status: result.state.status === 'running' ? 'failed' : result.state.status,
    turnCount: result.state.turnCount,
    ...(result.state.status === 'failed' || result.state.status === 'aborted'
      ? { errorCode: result.error?.code ?? 'agent_runtime_failure' }
      : {}),
  });
  return result;
}
