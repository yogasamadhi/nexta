import {
  abandonExecutionSession,
  advanceStateVersion,
  applyRecordedTaskWork,
  assertTaskParentAssignment,
  cancelTask,
  closeExecutionInterval,
  completeTask,
  createAchievement,
  createCompletionRecord,
  createTask,
  createTaskActivityEvent,
  createTimeBlock,
  executionIntervalSeconds,
  finishExecutionSession,
  parseAchievementId,
  parseCompletionRecordId,
  parseGoalId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseProjectId,
  parseTaskActivityEventId,
  parseTaskId,
  parseTimeZoneId,
  updateTask,
  type GoalId,
  type ExecutionInterval,
  type Instant,
  type ProjectId,
  type Task,
  type TaskId,
  type TimeBlock,
  type UpdateTaskFields,
} from '@workspace/domain';

import { ApplicationError } from './errors';
import {
  persistExecutionPlanMutation,
  prepareExecutionPlanMutation,
  type TimeBlockMutation,
} from './execution-plan-support';
import type {
  ApplicationAuthority,
  ApplicationTransaction,
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  LocalTimeProvider,
  WriteContext,
} from './ports';
import type { IntegrationJobWakeupPort } from './schedule-ports';
import {
  cancelTaskInputSchema,
  completeTaskInputSchema,
  createTaskInputSchema,
  taskCancellationResultSchema,
  taskCompletionResultSchema,
  taskListInputSchema,
  taskMutationResultSchema,
  taskPageSchema,
  updateTaskInputSchema,
  type CancelTaskInput,
  type CompleteTaskInput,
  type CreateTaskInput,
  type TaskCancellationResult,
  type TaskCompletionResult,
  type TaskListInput,
  type TaskMutationResult,
  type TaskPage,
  type UpdateTaskInput,
} from './schemas';
import {
  buildOperationRecord,
  dataIntegrityError,
  decodeStoredReceipt,
  generateId,
  invalidReferenceError,
  notFoundError,
  operationIdentity,
  parseBoundaryInput,
  parseWriteContext,
  protectApplicationCall,
  readClock,
  requireScheduleState,
  resolveLocalTime,
} from './service-support';

export interface TaskServiceDependencies {
  readonly unitOfWork: ApplicationUnitOfWork;
  readonly clock: Clock;
  readonly localTimeProvider: LocalTimeProvider;
  readonly idGenerator: IdGenerator;
  readonly integrationWakeup?: IntegrationJobWakeupPort;
}

const schedulingTaskFields: readonly (keyof Task)[] = [
  'projectId',
  'goalId',
  'parentTaskId',
  'priority',
  'estimatedDurationMinutes',
  'remainingDurationMinutes',
  'categoryKey',
  'earliestStartAt',
  'deadlineAt',
  'deadlineLocalDate',
  'deadlineTimeZone',
  'splittable',
  'minBlockMinutes',
  'maxBlockMinutes',
  'energyDemand',
  'schedulingPolicy',
];

function optionalId<Id>(
  value: string | null | undefined,
  parser: (raw: string) => Id,
): Id | null {
  return value === null || value === undefined ? null : parser(value);
}

function optionalPatchId<Id>(
  value: string | null | undefined,
  parser: (raw: string) => Id,
): Id | null | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? null
      : parser(value);
}

function optionalInstant(value: string | null | undefined): Instant | null {
  return value === null || value === undefined ? null : parseInstant(value);
}

function optionalPatchInstant(
  value: string | null | undefined,
): Instant | null | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? null
      : parseInstant(value);
}

function actorForAuthority(authority: ApplicationAuthority): string {
  return authority.kind;
}

function sourceForAuthority(authority: ApplicationAuthority): string {
  return authority.kind;
}

function completionSource(
  authority: ApplicationAuthority,
  operationId: string,
): 'user' | 'agent_authorized' {
  if (authority.kind === 'system') {
    throw new ApplicationError(
      'permission_required',
      'Completing a Task requires explicit user or authorized agent action.',
      {
        retryable: false,
        operationId,
      },
    );
  }
  return authority.kind;
}

function requireExplicitTaskAuthority(
  authority: ApplicationAuthority,
  operationId: string,
  action: 'completing' | 'canceling',
): void {
  if (authority.kind === 'system') {
    throw new ApplicationError(
      'permission_required',
      `${action === 'completing' ? 'Completing' : 'Canceling'} a Task requires explicit user or authorized agent action.`,
      {
        retryable: false,
        operationId,
      },
    );
  }
}

function parseTaskPatch(
  patch: ReturnType<typeof updateTaskInputSchema.parse>['patch'],
): UpdateTaskFields {
  return {
    projectId: optionalPatchId(patch.projectId, parseProjectId),
    goalId: optionalPatchId(patch.goalId, parseGoalId),
    parentTaskId: optionalPatchId(patch.parentTaskId, parseTaskId),
    title: patch.title,
    description: patch.description,
    priority: patch.priority,
    estimatedDurationMinutes: patch.estimatedDurationMinutes,
    remainingDurationMinutes: patch.remainingDurationMinutes,
    categoryKey: patch.categoryKey,
    earliestStartAt: optionalPatchInstant(patch.earliestStartAt),
    deadlineAt: optionalPatchInstant(patch.deadlineAt),
    deadlineLocalDate:
      patch.deadlineLocalDate === undefined
        ? undefined
        : patch.deadlineLocalDate === null
          ? null
          : parseLocalDate(patch.deadlineLocalDate),
    deadlineTimeZone:
      patch.deadlineTimeZone === undefined
        ? undefined
        : patch.deadlineTimeZone === null
          ? null
          : parseTimeZoneId(patch.deadlineTimeZone),
    splittable: patch.splittable,
    minBlockMinutes: patch.minBlockMinutes,
    maxBlockMinutes: patch.maxBlockMinutes,
    energyDemand: patch.energyDemand,
    schedulingPolicy: patch.schedulingPolicy,
  };
}

function schedulingFactsChanged(current: Task, next: Task): boolean {
  return schedulingTaskFields.some((field) => current[field] !== next[field]);
}

function trustedWorkSeconds(intervals: readonly ExecutionInterval[]): number {
  return intervals.reduce(
    (total, interval) =>
      total +
      (interval.kind === 'work' ? executionIntervalSeconds(interval) : 0),
    0,
  );
}

function completionBlockMutation(
  block: TimeBlock,
  status: 'completed' | 'canceled',
  now: Instant,
): TimeBlockMutation {
  return {
    before: block,
    after: createTimeBlock({ ...block, status, updatedAt: now }),
  };
}

async function requireReferencedGoal(
  transaction: ApplicationTransaction,
  goalId: GoalId | null | undefined,
  operationId: string,
): Promise<void> {
  if (goalId !== null && goalId !== undefined) {
    if ((await transaction.goals.findById(goalId)) === null) {
      throw invalidReferenceError('Goal', operationId);
    }
  }
}

async function requireReferencedProject(
  transaction: ApplicationTransaction,
  projectId: ProjectId | null | undefined,
  operationId: string,
): Promise<void> {
  if (projectId !== null && projectId !== undefined) {
    if ((await transaction.projects.findById(projectId)) === null) {
      throw invalidReferenceError('Project', operationId);
    }
  }
}

async function validateParentAssignment(
  transaction: ApplicationTransaction,
  taskId: TaskId,
  parentTaskId: TaskId | null | undefined,
  operationId: string,
): Promise<void> {
  if (parentTaskId === undefined || parentTaskId === null) return;

  // Catch self-links before a create attempts to load its not-yet-persisted ID.
  assertTaskParentAssignment(taskId, parentTaskId, []);

  const parent = await transaction.tasks.findById(parentTaskId);
  if (parent === null) throw invalidReferenceError('Task', operationId);

  const ancestors: TaskId[] = [];
  const visited = new Set<TaskId>([parentTaskId]);
  let cursor = parent.parentTaskId;
  while (cursor !== null) {
    ancestors.push(cursor);
    if (cursor === taskId) break;
    if (visited.has(cursor)) {
      throw dataIntegrityError(
        'The stored Task parent graph contains a cycle.',
        operationId,
      );
    }
    visited.add(cursor);
    const ancestor = await transaction.tasks.findById(cursor);
    if (ancestor === null) {
      throw dataIntegrityError(
        'The stored Task parent graph references a missing Task.',
        operationId,
      );
    }
    cursor = ancestor.parentTaskId;
  }

  assertTaskParentAssignment(taskId, parentTaskId, ancestors);
}

export class TaskService {
  readonly #dependencies: TaskServiceDependencies;

  constructor(dependencies: TaskServiceDependencies) {
    this.#dependencies = dependencies;
  }

  async get(taskId: string): Promise<Task> {
    return protectApplicationCall(undefined, async () => {
      const id = parseTaskId(taskId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const task = await transaction.tasks.findById(id);
        if (task === null) throw notFoundError('Task');
        return task;
      });
    });
  }

  async list(input: TaskListInput = {}): Promise<TaskPage> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        taskListInputSchema,
        input,
        'Task list input',
      );
      const range =
        parsed.timeRange === undefined
          ? null
          : {
              start: parseInstant(parsed.timeRange.start),
              end: parseInstant(parsed.timeRange.end),
            };
      if (range !== null && Date.parse(range.end) <= Date.parse(range.start)) {
        throw new ApplicationError(
          'validation_error',
          'Task list timeRange end must be after start.',
          { retryable: false },
        );
      }
      const tasks = await this.#dependencies.unitOfWork.transaction(
        (transaction) => transaction.tasks.listAll(),
      );
      const filtered = tasks.filter((task) => {
        if (parsed.status !== undefined && task.status !== parsed.status) {
          return false;
        }
        if (
          parsed.projectId !== undefined &&
          task.projectId !== parseProjectId(parsed.projectId)
        ) {
          return false;
        }
        if (range === null) return true;
        const effectiveStart =
          task.earliestStartAt === null
            ? Number.NEGATIVE_INFINITY
            : Date.parse(task.earliestStartAt);
        const effectiveEnd =
          task.deadlineAt === null
            ? Number.POSITIVE_INFINITY
            : Date.parse(task.deadlineAt);
        return (
          effectiveStart < Date.parse(range.end) &&
          effectiveEnd > Date.parse(range.start)
        );
      });
      let startIndex = 0;
      if (parsed.cursor !== undefined) {
        const cursorIndex = filtered.findIndex(
          (task) => task.id === parsed.cursor,
        );
        if (cursorIndex < 0) {
          throw new ApplicationError(
            'validation_error',
            'Task list cursor is invalid for this query.',
            { retryable: false },
          );
        }
        startIndex = cursorIndex + 1;
      }
      const items = filtered.slice(startIndex, startIndex + parsed.limit);
      const result: TaskPage = {
        items,
        nextCursor:
          startIndex + items.length < filtered.length
            ? (items.at(-1)?.id ?? null)
            : null,
      };
      return parseBoundaryInput(taskPageSchema, result, 'Task list result');
    });
  }

  async create(
    input: CreateTaskInput,
    context: WriteContext,
  ): Promise<TaskMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        createTaskInputSchema,
        input,
        'Task create input',
        writeContext.operationId,
      );
      const identity = operationIdentity(writeContext, 'task.create', parsed);
      const operationId = parseOperationId(writeContext.operationId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            taskMutationResultSchema,
          );
        }

        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const taskId = generateId(
          this.#dependencies.idGenerator,
          parseTaskId,
          'Task ID',
          writeContext.operationId,
        );
        const projectId = optionalId(parsed.projectId, parseProjectId);
        const goalId = optionalId(parsed.goalId, parseGoalId);
        const parentTaskId = optionalId(parsed.parentTaskId, parseTaskId);

        await requireReferencedProject(
          transaction,
          projectId,
          writeContext.operationId,
        );
        await requireReferencedGoal(
          transaction,
          goalId,
          writeContext.operationId,
        );
        await validateParentAssignment(
          transaction,
          taskId,
          parentTaskId,
          writeContext.operationId,
        );

        const task = createTask({
          id: taskId,
          projectId,
          goalId,
          parentTaskId,
          title: parsed.title,
          description: parsed.description,
          priority: parsed.priority,
          estimatedDurationMinutes: parsed.estimatedDurationMinutes,
          remainingDurationMinutes: parsed.remainingDurationMinutes,
          categoryKey: parsed.categoryKey,
          earliestStartAt: optionalInstant(parsed.earliestStartAt),
          deadlineAt: optionalInstant(parsed.deadlineAt),
          deadlineLocalDate:
            parsed.deadlineLocalDate === null ||
            parsed.deadlineLocalDate === undefined
              ? null
              : parseLocalDate(parsed.deadlineLocalDate),
          deadlineTimeZone:
            parsed.deadlineTimeZone === null ||
            parsed.deadlineTimeZone === undefined
              ? null
              : parseTimeZoneId(parsed.deadlineTimeZone),
          splittable: parsed.splittable,
          minBlockMinutes: parsed.minBlockMinutes,
          maxBlockMinutes: parsed.maxBlockMinutes,
          energyDemand: parsed.energyDemand,
          schedulingPolicy: parsed.schedulingPolicy,
          source: sourceForAuthority(writeContext.authority),
          createdAt: now,
        });
        const baseState = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const currentState = advanceStateVersion(baseState);
        const result: TaskMutationResult = {
          task,
          operationId,
          stateVersion: currentState.stateVersion,
          planRevision: currentState.planRevision,
        };
        const operation = buildOperationRecord(
          identity,
          result,
          baseState,
          currentState,
          now,
        );
        const localTime = resolveLocalTime(
          this.#dependencies.localTimeProvider,
          now,
          writeContext.operationId,
        );
        const activity = createTaskActivityEvent({
          id: generateId(
            this.#dependencies.idGenerator,
            parseTaskActivityEventId,
            'Task activity event ID',
            writeContext.operationId,
          ),
          taskId: task.id,
          eventType: 'create',
          actor: actorForAuthority(writeContext.authority),
          occurredAt: now,
          localDate: localTime.localDate,
          timeZone: localTime.timeZone,
          operationId,
          afterSummary: { status: task.status },
        });

        await transaction.operationRecords.insert(operation);
        await transaction.tasks.insert(task);
        await transaction.taskActivityEvents.insert(activity);
        await transaction.scheduleState.update(currentState);
        return result;
      });
    });
  }

  async update(
    input: UpdateTaskInput,
    context: WriteContext,
  ): Promise<TaskMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        updateTaskInputSchema,
        input,
        'Task update input',
        writeContext.operationId,
      );
      const identity = operationIdentity(writeContext, 'task.update', parsed);
      const operationId = parseOperationId(writeContext.operationId);
      const taskId = parseTaskId(parsed.taskId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          const replay = decodeStoredReceipt(
            stored,
            identity,
            taskMutationResultSchema,
          );
          if (replay.task.id !== taskId) {
            throw dataIntegrityError(
              'Stored Task update result references another Task.',
              writeContext.operationId,
            );
          }
          return replay;
        }

        const current = await transaction.tasks.findById(taskId);
        if (current === null) {
          throw notFoundError('Task', writeContext.operationId);
        }
        const patch = parseTaskPatch(parsed.patch);
        await requireReferencedProject(
          transaction,
          patch.projectId,
          writeContext.operationId,
        );
        await requireReferencedGoal(
          transaction,
          patch.goalId,
          writeContext.operationId,
        );
        await validateParentAssignment(
          transaction,
          taskId,
          patch.parentTaskId,
          writeContext.operationId,
        );

        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const task = updateTask(current, patch, now);
        const baseState = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const currentState = schedulingFactsChanged(current, task)
          ? advanceStateVersion(baseState)
          : baseState;
        const result: TaskMutationResult = {
          task,
          operationId,
          stateVersion: currentState.stateVersion,
          planRevision: currentState.planRevision,
        };
        const operation = buildOperationRecord(
          identity,
          result,
          baseState,
          currentState,
          now,
        );
        const localTime = resolveLocalTime(
          this.#dependencies.localTimeProvider,
          now,
          writeContext.operationId,
        );
        const activity = createTaskActivityEvent({
          id: generateId(
            this.#dependencies.idGenerator,
            parseTaskActivityEventId,
            'Task activity event ID',
            writeContext.operationId,
          ),
          taskId: task.id,
          eventType: 'update',
          actor: actorForAuthority(writeContext.authority),
          occurredAt: now,
          localDate: localTime.localDate,
          timeZone: localTime.timeZone,
          operationId,
          beforeSummary: { status: current.status },
          afterSummary: { status: task.status },
        });

        await transaction.operationRecords.insert(operation);
        await transaction.tasks.update(task);
        await transaction.taskActivityEvents.insert(activity);
        if (currentState !== baseState) {
          await transaction.scheduleState.update(currentState);
        }
        return result;
      });
    });
  }

  async complete(
    input: CompleteTaskInput,
    context: WriteContext,
  ): Promise<TaskCompletionResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        completeTaskInputSchema,
        input,
        'Task complete input',
        writeContext.operationId,
      );
      if (
        parsed.allEffortRecorded === true &&
        writeContext.authority.kind !== 'user'
      ) {
        throw new ApplicationError(
          'permission_required',
          'Only the user can confirm that all effort was recorded.',
          { retryable: false, operationId: writeContext.operationId },
        );
      }
      const identity = operationIdentity(writeContext, 'task.complete', parsed);
      const operationId = parseOperationId(writeContext.operationId);
      const taskId = parseTaskId(parsed.taskId);
      const result = await this.#dependencies.unitOfWork.transaction(
        async (transaction) => {
          const stored =
            await transaction.operationRecords.findById(operationId);
          if (stored !== null) {
            const replay = decodeStoredReceipt(
              stored,
              identity,
              taskCompletionResultSchema,
            );
            if (replay.task.id !== taskId) {
              throw dataIntegrityError(
                'Stored Task completion result references another Task.',
                writeContext.operationId,
              );
            }
            return replay;
          }

          requireExplicitTaskAuthority(
            writeContext.authority,
            writeContext.operationId,
            'completing',
          );
          const source = completionSource(
            writeContext.authority,
            writeContext.operationId,
          );
          const current = await transaction.tasks.findById(taskId);
          if (current === null) {
            throw notFoundError('Task', writeContext.operationId);
          }
          const existingCompletion =
            await transaction.completionRecords.findByTaskId(taskId);
          const observedAt = readClock(
            this.#dependencies.clock,
            writeContext.operationId,
          );
          const baseState = await requireScheduleState(
            transaction,
            writeContext.operationId,
          );

          if (current.status === 'completed') {
            if (existingCompletion === null) {
              throw dataIntegrityError(
                'Completed Task is missing its completion record.',
                writeContext.operationId,
              );
            }
            let completionRecord = existingCompletion;
            let achievement =
              await transaction.achievements.findByCompletionRecordId(
                existingCompletion.id,
              );
            if (parsed.recordAchievement === true && achievement === null) {
              if (writeContext.authority.kind !== 'user') {
                throw new ApplicationError(
                  'permission_required',
                  'Only a direct user may reverse an Achievement opt-out.',
                  {
                    retryable: false,
                    operationId: writeContext.operationId,
                  },
                );
              }
              achievement = createAchievement({
                id: generateId(
                  this.#dependencies.idGenerator,
                  parseAchievementId,
                  'Achievement ID',
                  writeContext.operationId,
                ),
                sourceCompletionRecordId: existingCompletion.id,
                sourceTaskId: current.id,
                sourceExecutionSessionId: existingCompletion.sourceSessionId,
                title: existingCompletion.taskTitleSnapshot,
                evidenceType: 'task_completion',
                occurredAt: existingCompletion.completedAt,
                createdAt: observedAt,
              });
              completionRecord = {
                ...existingCompletion,
                achievementDisposition: 'record',
              };
            }
            const result: TaskCompletionResult = {
              task: current,
              completionRecord,
              achievement,
              operationId,
              stateVersion: baseState.stateVersion,
              planRevision: baseState.planRevision,
            };
            await transaction.operationRecords.insert(
              buildOperationRecord(
                identity,
                result,
                baseState,
                baseState,
                observedAt,
              ),
            );
            if (completionRecord !== existingCompletion) {
              await transaction.completionRecords.update(completionRecord);
            }
            if (achievement !== null) {
              const storedAchievement = await transaction.achievements.findById(
                achievement.id,
              );
              if (storedAchievement === null) {
                await transaction.achievements.insert(achievement);
              }
            }
            return result;
          }

          if (existingCompletion !== null) {
            throw dataIntegrityError(
              'An unfinished Task already has a completion record.',
              writeContext.operationId,
            );
          }

          const active = await transaction.executionSessions.findActive();
          const activeForTask = active?.taskId === taskId ? active : null;
          let effectiveAt = observedAt;
          let closedInterval: ExecutionInterval | null = null;
          let finishedSession = null as typeof activeForTask;
          let taskBeforeCompletion = current;
          let sessionIntervals: readonly ExecutionInterval[] = [];
          let linkedBlock: TimeBlock | null = null;
          if (activeForTask !== null) {
            const open =
              await transaction.executionIntervals.findOpenBySessionId(
                activeForTask.id,
              );
            const expectedKind =
              activeForTask.status === 'running' ? 'work' : 'pause';
            if (open === null || open.kind !== expectedKind) {
              throw dataIntegrityError(
                'Active ExecutionSession is missing its matching interval.',
                writeContext.operationId,
              );
            }
            closedInterval = closeExecutionInterval(open, observedAt);
            effectiveAt = closedInterval.endAt as Instant;
            finishedSession = finishExecutionSession(
              activeForTask,
              effectiveAt,
              'complete_task',
              open.kind === 'pause'
                ? executionIntervalSeconds(closedInterval)
                : 0,
            );
            const storedIntervals =
              await transaction.executionIntervals.listBySessionId(
                activeForTask.id,
              );
            sessionIntervals = storedIntervals.map((interval) =>
              interval.id === closedInterval?.id ? closedInterval : interval,
            );
            const currentWork = trustedWorkSeconds(sessionIntervals);
            if (currentWork > 0) {
              taskBeforeCompletion = applyRecordedTaskWork(
                current,
                currentWork / 60,
                effectiveAt,
              );
            }
            if (activeForTask.timeBlockId !== null) {
              linkedBlock = await transaction.timeBlocks.findById(
                activeForTask.timeBlockId,
              );
              if (
                linkedBlock === null ||
                linkedBlock.taskId !== taskId ||
                linkedBlock.status !== 'started'
              ) {
                throw dataIntegrityError(
                  'Active ExecutionSession references an invalid started TimeBlock.',
                  writeContext.operationId,
                );
              }
            }
          }

          const sessions =
            await transaction.executionSessions.listByTaskId(taskId);
          let allRecordedSeconds = 0;
          for (const session of sessions) {
            const intervals =
              activeForTask !== null && session.id === activeForTask.id
                ? sessionIntervals
                : await transaction.executionIntervals.listBySessionId(
                    session.id,
                  );
            allRecordedSeconds += trustedWorkSeconds(intervals);
          }
          const task = completeTask(taskBeforeCompletion, {
            completedAt: effectiveAt,
            ...(allRecordedSeconds > 0 || parsed.allEffortRecorded === true
              ? { actualDurationMinutes: allRecordedSeconds / 60 }
              : {}),
          });
          const completionRecord = createCompletionRecord({
            id: generateId(
              this.#dependencies.idGenerator,
              parseCompletionRecordId,
              'Completion record ID',
              writeContext.operationId,
            ),
            taskId: task.id,
            sourceSessionId: finishedSession?.id,
            operationId,
            completedAt: effectiveAt,
            taskTitleSnapshot: task.title,
            actualDurationSeconds:
              allRecordedSeconds > 0 || parsed.allEffortRecorded === true
                ? allRecordedSeconds
                : null,
            durationCoverage:
              parsed.allEffortRecorded === true
                ? 'complete'
                : allRecordedSeconds > 0
                  ? 'partial'
                  : 'unknown',
            achievementDisposition:
              parsed.recordAchievement === true ? 'record' : 'skip',
            source,
          });
          const achievement =
            parsed.recordAchievement === true
              ? createAchievement({
                  id: generateId(
                    this.#dependencies.idGenerator,
                    parseAchievementId,
                    'Achievement ID',
                    writeContext.operationId,
                  ),
                  sourceCompletionRecordId: completionRecord.id,
                  sourceTaskId: task.id,
                  sourceExecutionSessionId: finishedSession?.id,
                  title: task.title,
                  evidenceType: 'task_completion',
                  occurredAt: effectiveAt,
                  createdAt: effectiveAt,
                })
              : null;
          const changes = new Map<string, TimeBlockMutation>();
          if (linkedBlock !== null) {
            changes.set(
              linkedBlock.id,
              completionBlockMutation(linkedBlock, 'completed', effectiveAt),
            );
          }
          for (const block of await transaction.timeBlocks.listAll()) {
            if (
              block.taskId === taskId &&
              block.status === 'planned' &&
              Date.parse(block.startAt) > Date.parse(effectiveAt)
            ) {
              changes.set(
                block.id,
                completionBlockMutation(block, 'canceled', effectiveAt),
              );
            }
          }
          const localTime = resolveLocalTime(
            this.#dependencies.localTimeProvider,
            effectiveAt,
            writeContext.operationId,
          );
          const planMutation = await prepareExecutionPlanMutation({
            transaction,
            baseState,
            blockChanges: [...changes.values()],
            now: effectiveAt,
            timeZone: localTime.timeZone,
            operationId,
            reason: 'task_complete',
            ids: {
              schedulePlan: this.#dependencies.idGenerator,
              integrationJob: this.#dependencies.idGenerator,
            },
          });
          const result: TaskCompletionResult = {
            task,
            completionRecord,
            achievement,
            operationId,
            stateVersion: planMutation.state.stateVersion,
            planRevision: planMutation.state.planRevision,
            calendar: planMutation.calendar,
            notifications: planMutation.notifications,
          };
          const activity = createTaskActivityEvent({
            id: generateId(
              this.#dependencies.idGenerator,
              parseTaskActivityEventId,
              'Task activity event ID',
              writeContext.operationId,
            ),
            taskId: task.id,
            timeBlockId: activeForTask?.timeBlockId,
            eventType: 'complete_task',
            actor: actorForAuthority(writeContext.authority),
            occurredAt: effectiveAt,
            localDate: localTime.localDate,
            timeZone: localTime.timeZone,
            operationId,
            beforeSummary: { status: current.status },
            afterSummary: { status: task.status },
          });

          await transaction.operationRecords.insert(
            buildOperationRecord(
              identity,
              result,
              baseState,
              planMutation.state,
              effectiveAt,
              {
                sessionBefore: activeForTask,
                sessionAfter: finishedSession,
                intervalClosed: closedInterval,
                timeBlockChanges: planMutation.blockChanges,
                completionRecord,
                achievement,
              },
            ),
          );
          if (closedInterval !== null) {
            await transaction.executionIntervals.update(closedInterval);
          }
          if (finishedSession !== null) {
            await transaction.executionSessions.update(finishedSession);
          }
          await transaction.tasks.update(task);
          await transaction.completionRecords.insert(completionRecord);
          if (achievement !== null) {
            await transaction.achievements.insert(achievement);
          }
          await transaction.taskActivityEvents.insert(activity);
          await persistExecutionPlanMutation(transaction, planMutation);
          return result;
        },
      );
      if (result.calendar === 'pending' || result.notifications === 'pending') {
        try {
          await this.#dependencies.integrationWakeup?.wake(result.operationId);
        } catch {
          // Durable IntegrationJobs remain the recovery source.
        }
      }
      return result;
    });
  }

  async cancel(
    input: CancelTaskInput,
    context: WriteContext,
  ): Promise<TaskCancellationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        cancelTaskInputSchema,
        input,
        'Task cancel input',
        writeContext.operationId,
      );
      const identity = operationIdentity(writeContext, 'task.cancel', parsed);
      const operationId = parseOperationId(writeContext.operationId);
      const taskId = parseTaskId(parsed.taskId);

      const result = await this.#dependencies.unitOfWork.transaction(
        async (transaction) => {
          const stored =
            await transaction.operationRecords.findById(operationId);
          if (stored !== null) {
            const replay = decodeStoredReceipt(
              stored,
              identity,
              taskCancellationResultSchema,
            );
            if (replay.task.id !== taskId) {
              throw dataIntegrityError(
                'Stored Task cancellation result references another Task.',
                writeContext.operationId,
              );
            }
            return replay;
          }

          requireExplicitTaskAuthority(
            writeContext.authority,
            writeContext.operationId,
            'canceling',
          );

          const current = await transaction.tasks.findById(taskId);
          if (current === null) {
            throw notFoundError('Task', writeContext.operationId);
          }
          const now = readClock(
            this.#dependencies.clock,
            writeContext.operationId,
          );
          const baseState = await requireScheduleState(
            transaction,
            writeContext.operationId,
          );

          const active = await transaction.executionSessions.findActive();
          const activeForTask = active?.taskId === taskId ? active : null;
          let effectiveAt = now;
          let closedInterval: ExecutionInterval | null = null;
          let abandonedSession = null as typeof activeForTask;
          let linkedBlock: TimeBlock | null = null;
          if (activeForTask !== null) {
            const open =
              await transaction.executionIntervals.findOpenBySessionId(
                activeForTask.id,
              );
            const expectedKind =
              activeForTask.status === 'running' ? 'work' : 'pause';
            if (open === null || open.kind !== expectedKind) {
              throw dataIntegrityError(
                'Active ExecutionSession is missing its matching interval.',
                writeContext.operationId,
              );
            }
            closedInterval = closeExecutionInterval(open, now);
            effectiveAt = closedInterval.endAt as Instant;
            abandonedSession = abandonExecutionSession(
              activeForTask,
              effectiveAt,
              open.kind === 'pause'
                ? executionIntervalSeconds(closedInterval)
                : 0,
            );
            if (activeForTask.timeBlockId !== null) {
              linkedBlock = await transaction.timeBlocks.findById(
                activeForTask.timeBlockId,
              );
              if (
                linkedBlock === null ||
                linkedBlock.taskId !== taskId ||
                linkedBlock.status !== 'started'
              ) {
                throw dataIntegrityError(
                  'Active ExecutionSession references an invalid started TimeBlock.',
                  writeContext.operationId,
                );
              }
            }
          }

          const task = cancelTask(current, { canceledAt: effectiveAt });
          const changes = new Map<string, TimeBlockMutation>();
          if (linkedBlock !== null) {
            changes.set(
              linkedBlock.id,
              completionBlockMutation(linkedBlock, 'canceled', effectiveAt),
            );
          }
          for (const block of await transaction.timeBlocks.listAll()) {
            if (block.taskId !== taskId) continue;
            if (block.status === 'planned') {
              changes.set(
                block.id,
                completionBlockMutation(block, 'canceled', effectiveAt),
              );
            } else if (
              block.status === 'started' &&
              block.id !== linkedBlock?.id
            ) {
              throw dataIntegrityError(
                'A started TimeBlock is missing its active ExecutionSession.',
                writeContext.operationId,
              );
            }
          }
          const localTime = resolveLocalTime(
            this.#dependencies.localTimeProvider,
            effectiveAt,
            writeContext.operationId,
          );
          const planMutation = await prepareExecutionPlanMutation({
            transaction,
            baseState,
            blockChanges: [...changes.values()],
            now: effectiveAt,
            timeZone: localTime.timeZone,
            operationId,
            reason: 'task_cancel',
            ids: {
              schedulePlan: this.#dependencies.idGenerator,
              integrationJob: this.#dependencies.idGenerator,
            },
          });
          const result: TaskCancellationResult = {
            task,
            operationId,
            stateVersion: planMutation.state.stateVersion,
            planRevision: planMutation.state.planRevision,
            calendar: planMutation.calendar,
            notifications: planMutation.notifications,
          };
          const activity = createTaskActivityEvent({
            id: generateId(
              this.#dependencies.idGenerator,
              parseTaskActivityEventId,
              'Task activity event ID',
              writeContext.operationId,
            ),
            taskId: task.id,
            eventType: 'cancel',
            actor: actorForAuthority(writeContext.authority),
            occurredAt: effectiveAt,
            localDate: localTime.localDate,
            timeZone: localTime.timeZone,
            operationId,
            beforeSummary: { status: current.status },
            afterSummary: { status: task.status },
          });

          await transaction.operationRecords.insert(
            buildOperationRecord(
              identity,
              result,
              baseState,
              planMutation.state,
              effectiveAt,
              {
                sessionBefore: activeForTask,
                sessionAfter: abandonedSession,
                intervalClosed: closedInterval,
                timeBlockChanges: planMutation.blockChanges,
              },
            ),
          );
          if (closedInterval !== null) {
            await transaction.executionIntervals.update(closedInterval);
          }
          if (abandonedSession !== null) {
            await transaction.executionSessions.update(abandonedSession);
          }
          await transaction.tasks.update(task);
          await transaction.taskActivityEvents.insert(activity);
          await persistExecutionPlanMutation(transaction, planMutation);
          return result;
        },
      );
      if (result.calendar === 'pending' || result.notifications === 'pending') {
        try {
          await this.#dependencies.integrationWakeup?.wake(result.operationId);
        } catch {
          // Durable IntegrationJobs remain the recovery source.
        }
      }
      return result;
    });
  }
}
