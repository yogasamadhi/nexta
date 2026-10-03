import {
  abandonExecutionSession,
  advanceStateVersion,
  applyRecordedTaskWork,
  closeExecutionInterval,
  completeTask,
  createAchievement,
  createCompletionRecord,
  createExecutionInterval,
  createExecutionSession,
  createTaskActivityEvent,
  createTimeBlock,
  executionIntervalSeconds,
  finishExecutionSession,
  parseAchievementId,
  parseCompletionRecordId,
  parseExecutionIntervalId,
  parseExecutionSessionId,
  parseOperationId,
  parseTaskActivityEventId,
  parseTaskId,
  parseTimeBlockId,
  pauseExecutionSession,
  resumeExecutionSession,
  startTask,
  type ExecutionInterval,
  type ExecutionSession,
  type Instant,
  type IntegrationJob,
  type TimeBlock,
} from '@workspace/domain';

import { ApplicationError } from './errors';
import {
  executionFinishResultSchema,
  executionMutationResultSchema,
  executionSessionInputSchema,
  finishExecutionInputSchema,
  startExecutionInputSchema,
  type ExecutionDetails,
  type ExecutionFinishResult,
  type ExecutionMutationResult,
  type ExecutionSessionInput,
  type FinishExecutionInput,
  type StartExecutionInput,
} from './execution-schemas';
import {
  persistExecutionPlanMutation,
  prepareExecutionPlanMutation,
  type ExecutionPlanIdGenerators,
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
import type { IntegrationStatus } from './schedule-types';
import {
  buildOperationRecord,
  dataIntegrityError,
  decodeStoredReceipt,
  generateId,
  operationIdentity,
  parseBoundaryInput,
  parseWriteContext,
  protectApplicationCall,
  readClock,
  requireScheduleState,
  resolveLocalTime,
} from './service-support';

export type ExecutionServiceIdGenerators = ExecutionPlanIdGenerators &
  Readonly<{
    session: IdGenerator;
    interval: IdGenerator;
    activity: IdGenerator;
    completionRecord: IdGenerator;
    achievement: IdGenerator;
  }>;

export type ExecutionServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
  localTimeProvider: LocalTimeProvider;
  ids: ExecutionServiceIdGenerators;
  integrationWakeup?: IntegrationJobWakeupPort;
}>;

function executionError(
  code:
    | 'validation_error'
    | 'not_found'
    | 'permission_required'
    | 'active_session_conflict'
    | 'invalid_transition',
  message: string,
  operationId?: string,
): ApplicationError {
  return new ApplicationError(code, message, {
    retryable: false,
    operationId,
  });
}

function requireExecutionAuthority(
  authority: ApplicationAuthority,
  operationId: string,
): void {
  if (authority.kind === 'system') {
    throw executionError(
      'permission_required',
      'Execution changes require direct user or authorized agent action.',
      operationId,
    );
  }
}

function completionSource(
  authority: ApplicationAuthority,
): 'user' | 'agent_authorized' {
  if (authority.kind === 'system') {
    throw new Error('System authority cannot create completion evidence.');
  }
  return authority.kind;
}

function activityActor(authority: ApplicationAuthority): string {
  return authority.kind;
}

function sortIntervals(
  intervals: readonly ExecutionInterval[],
): readonly ExecutionInterval[] {
  return [...intervals].sort(
    (left, right) =>
      left.startAt.localeCompare(right.startAt) ||
      left.id.localeCompare(right.id),
  );
}

function recordedWorkSeconds(intervals: readonly ExecutionInterval[]): number {
  return intervals.reduce(
    (total, interval) =>
      total +
      (interval.kind === 'work' ? executionIntervalSeconds(interval) : 0),
    0,
  );
}

function mapIntegrationStatus(job: IntegrationJob | null): IntegrationStatus {
  if (job === null) return 'synced';
  switch (job.status) {
    case 'pending':
    case 'processing':
      return 'pending';
    case 'succeeded':
      return 'synced';
    case 'permission_required':
      return 'permission_required';
    case 'failed':
      return 'failed';
    case 'disabled':
      return 'disabled';
    case 'reconciliation_required':
      return 'reconciliation_required';
    case 'superseded':
      return 'superseded';
  }
}

async function currentIntegrationStatus(
  transaction: ApplicationTransaction,
): Promise<
  Readonly<{ calendar: IntegrationStatus; notifications: IntegrationStatus }>
> {
  const [calendar, notifications] = await Promise.all([
    transaction.integrationJobs.findLatestByChannel('calendar'),
    transaction.integrationJobs.findLatestByChannel('notification'),
  ]);
  return {
    calendar: mapIntegrationStatus(calendar),
    notifications: mapIntegrationStatus(notifications),
  };
}

function expectedOpenKind(session: ExecutionSession): 'work' | 'pause' {
  if (session.status === 'running') return 'work';
  if (session.status === 'paused') return 'pause';
  throw executionError(
    'invalid_transition',
    `ExecutionSession is already ${session.status}.`,
  );
}

async function requireOpenInterval(
  transaction: ApplicationTransaction,
  session: ExecutionSession,
  operationId?: string,
): Promise<ExecutionInterval> {
  const interval = await transaction.executionIntervals.findOpenBySessionId(
    session.id,
  );
  const expectedKind = expectedOpenKind(session);
  if (interval === null || interval.kind !== expectedKind) {
    throw dataIntegrityError(
      'Active ExecutionSession is missing its matching open interval.',
      operationId,
    );
  }
  return interval;
}

async function readExecutionDetails(
  transaction: ApplicationTransaction,
  session: ExecutionSession,
  operationId?: string,
): Promise<ExecutionDetails> {
  const [task, intervals, block] = await Promise.all([
    transaction.tasks.findById(session.taskId),
    transaction.executionIntervals.listBySessionId(session.id),
    session.timeBlockId === null
      ? Promise.resolve(null)
      : transaction.timeBlocks.findById(session.timeBlockId),
  ]);
  if (task === null) {
    throw dataIntegrityError(
      'ExecutionSession references a missing Task.',
      operationId,
    );
  }
  if (session.timeBlockId !== null && block === null) {
    throw dataIntegrityError(
      'ExecutionSession references a missing TimeBlock.',
      operationId,
    );
  }
  const open = intervals.filter((interval) => interval.endAt === null);
  if (
    (session.status === 'running' || session.status === 'paused') &&
    (open.length !== 1 || open[0]?.kind !== expectedOpenKind(session))
  ) {
    throw dataIntegrityError(
      'ExecutionSession interval state is inconsistent.',
      operationId,
    );
  }
  if (
    (session.status === 'completed' || session.status === 'abandoned') &&
    open.length !== 0
  ) {
    throw dataIntegrityError(
      'A terminal ExecutionSession retains an open interval.',
      operationId,
    );
  }
  return {
    session,
    intervals,
    task,
    timeBlock: block,
    recordedWorkSeconds: recordedWorkSeconds(intervals),
  };
}

function replaceInterval(
  intervals: readonly ExecutionInterval[],
  interval: ExecutionInterval,
): readonly ExecutionInterval[] {
  return sortIntervals(
    intervals.map((current) =>
      current.id === interval.id ? interval : current,
    ),
  );
}

function makeBlockMutation(
  block: TimeBlock,
  status: 'started' | 'completed' | 'skipped' | 'canceled',
  now: Instant,
): TimeBlockMutation {
  return {
    before: block,
    after: createTimeBlock({
      ...block,
      status,
      locked: status === 'started' ? true : block.locked,
      updatedAt: now,
    }),
  };
}

export class ExecutionService {
  readonly #dependencies: ExecutionServiceDependencies;

  constructor(dependencies: ExecutionServiceDependencies) {
    this.#dependencies = dependencies;
  }

  get(sessionId: string): Promise<ExecutionDetails> {
    return protectApplicationCall(undefined, async () => {
      const id = parseExecutionSessionId(sessionId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const session = await transaction.executionSessions.findById(id);
        if (session === null) {
          throw executionError('not_found', 'ExecutionSession was not found.');
        }
        return readExecutionDetails(transaction, session);
      });
    });
  }

  getActive(): Promise<ExecutionDetails | null> {
    return protectApplicationCall(undefined, async () =>
      this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const session = await transaction.executionSessions.findActive();
        return session === null
          ? null
          : readExecutionDetails(transaction, session);
      }),
    );
  }

  async start(
    input: StartExecutionInput,
    context: WriteContext,
  ): Promise<ExecutionMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        startExecutionInputSchema,
        input,
        'Execution start input',
        writeContext.operationId,
      );
      requireExecutionAuthority(
        writeContext.authority,
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'execution.start',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const taskId = parseTaskId(parsed.taskId);
      const timeBlockId =
        parsed.timeBlockId === null || parsed.timeBlockId === undefined
          ? null
          : parseTimeBlockId(parsed.timeBlockId);
      const result = await this.#dependencies.unitOfWork.transaction(
        async (transaction) => {
          const stored =
            await transaction.operationRecords.findById(operationId);
          if (stored !== null) {
            return decodeStoredReceipt(
              stored,
              identity,
              executionMutationResultSchema,
            );
          }
          if ((await transaction.executionSessions.findActive()) !== null) {
            throw executionError(
              'active_session_conflict',
              'Finish or abandon the active focus session before starting another.',
              writeContext.operationId,
            );
          }
          const currentTask = await transaction.tasks.findById(taskId);
          if (currentTask === null) {
            throw executionError(
              'not_found',
              'Task was not found.',
              writeContext.operationId,
            );
          }
          if (
            currentTask.status === 'completed' ||
            currentTask.status === 'canceled'
          ) {
            throw executionError(
              'invalid_transition',
              'A completed or canceled Task cannot start.',
              writeContext.operationId,
            );
          }
          const block =
            timeBlockId === null
              ? null
              : await transaction.timeBlocks.findById(timeBlockId);
          if (
            timeBlockId !== null &&
            (block === null || block.type !== 'task' || block.taskId !== taskId)
          ) {
            throw executionError(
              'validation_error',
              'The selected TimeBlock does not belong to this Task.',
              writeContext.operationId,
            );
          }
          if (block !== null && block.status !== 'planned') {
            throw executionError(
              'invalid_transition',
              'Only a planned TimeBlock can start.',
              writeContext.operationId,
            );
          }
          const now = readClock(
            this.#dependencies.clock,
            writeContext.operationId,
          );
          const localTime = resolveLocalTime(
            this.#dependencies.localTimeProvider,
            now,
            writeContext.operationId,
          );
          const baseState = await requireScheduleState(
            transaction,
            writeContext.operationId,
          );
          const task =
            currentTask.status === 'in_progress'
              ? currentTask
              : startTask(currentTask, now);
          const session = createExecutionSession({
            id: generateId(
              this.#dependencies.ids.session,
              parseExecutionSessionId,
              'ExecutionSession ID',
              writeContext.operationId,
            ),
            taskId,
            timeBlockId,
            startedAt: now,
          });
          const interval = createExecutionInterval({
            id: generateId(
              this.#dependencies.ids.interval,
              parseExecutionIntervalId,
              'ExecutionInterval ID',
              writeContext.operationId,
            ),
            sessionId: session.id,
            kind: 'work',
            startAt: now,
          });
          const blockChanges =
            block === null ? [] : [makeBlockMutation(block, 'started', now)];
          const planMutation = await prepareExecutionPlanMutation({
            transaction,
            baseState,
            blockChanges,
            now,
            timeZone: localTime.timeZone,
            operationId,
            reason: 'execution_start',
            ids: this.#dependencies.ids,
          });
          const startedBlock = planMutation.blockChanges[0]?.after ?? null;
          const mutation: ExecutionMutationResult = {
            session,
            intervals: [interval],
            task,
            timeBlock: startedBlock,
            recordedWorkSeconds: 0,
            operationId,
            stateVersion: planMutation.state.stateVersion,
            planRevision: planMutation.state.planRevision,
            calendar: planMutation.calendar,
            notifications: planMutation.notifications,
          };
          const activity = createTaskActivityEvent({
            id: generateId(
              this.#dependencies.ids.activity,
              parseTaskActivityEventId,
              'Task activity event ID',
              writeContext.operationId,
            ),
            taskId,
            timeBlockId,
            eventType: 'start',
            actor: activityActor(writeContext.authority),
            occurredAt: now,
            localDate: localTime.localDate,
            timeZone: localTime.timeZone,
            operationId,
            beforeSummary: { taskStatus: currentTask.status },
            afterSummary: {
              taskStatus: task.status,
              sessionStatus: session.status,
            },
          });
          await transaction.operationRecords.insert(
            buildOperationRecord(
              identity,
              mutation,
              baseState,
              planMutation.state,
              now,
              {
                sessionId: session.id,
                timeBlockChanges: planMutation.blockChanges,
              },
            ),
          );
          if (task !== currentTask) await transaction.tasks.update(task);
          await transaction.executionSessions.insert(session);
          await transaction.executionIntervals.insert(interval);
          await transaction.taskActivityEvents.insert(activity);
          await persistExecutionPlanMutation(transaction, planMutation);
          return mutation;
        },
      );
      await this.#wakeIfPending(result);
      return result;
    });
  }

  pause(
    input: ExecutionSessionInput,
    context: WriteContext,
  ): Promise<ExecutionMutationResult> {
    return this.#switchInterval(input, context, 'pause');
  }

  resume(
    input: ExecutionSessionInput,
    context: WriteContext,
  ): Promise<ExecutionMutationResult> {
    return this.#switchInterval(input, context, 'resume');
  }

  async #switchInterval(
    input: ExecutionSessionInput,
    context: WriteContext,
    action: 'pause' | 'resume',
  ): Promise<ExecutionMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        executionSessionInputSchema,
        input,
        `Execution ${action} input`,
        writeContext.operationId,
      );
      requireExecutionAuthority(
        writeContext.authority,
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        `execution.${action}`,
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const sessionId = parseExecutionSessionId(parsed.sessionId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            executionMutationResultSchema,
          );
        }
        const current = await transaction.executionSessions.findById(sessionId);
        if (current === null) {
          throw executionError(
            'not_found',
            'ExecutionSession was not found.',
            writeContext.operationId,
          );
        }
        if (
          (action === 'pause' && current.status !== 'running') ||
          (action === 'resume' && current.status !== 'paused')
        ) {
          throw executionError(
            'invalid_transition',
            `ExecutionSession cannot ${action} from ${current.status}.`,
            writeContext.operationId,
          );
        }
        const open = await requireOpenInterval(
          transaction,
          current,
          writeContext.operationId,
        );
        const observedAt = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const closed = closeExecutionInterval(open, observedAt);
        const transitionAt = closed.endAt as Instant;
        const pauseSeconds =
          open.kind === 'pause' ? executionIntervalSeconds(closed) : 0;
        const session =
          action === 'pause'
            ? pauseExecutionSession(current, transitionAt)
            : resumeExecutionSession(current, transitionAt, pauseSeconds);
        const nextInterval = createExecutionInterval({
          id: generateId(
            this.#dependencies.ids.interval,
            parseExecutionIntervalId,
            'ExecutionInterval ID',
            writeContext.operationId,
          ),
          sessionId,
          kind: action === 'pause' ? 'pause' : 'work',
          startAt: transitionAt,
        });
        const currentIntervals =
          await transaction.executionIntervals.listBySessionId(sessionId);
        const intervals = sortIntervals([
          ...replaceInterval(currentIntervals, closed),
          nextInterval,
        ]);
        const task = await transaction.tasks.findById(session.taskId);
        const block =
          session.timeBlockId === null
            ? null
            : await transaction.timeBlocks.findById(session.timeBlockId);
        if (task === null || (session.timeBlockId !== null && block === null)) {
          throw dataIntegrityError(
            'ExecutionSession references missing local facts.',
            writeContext.operationId,
          );
        }
        const baseState = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const nextState = advanceStateVersion(baseState);
        const status = await currentIntegrationStatus(transaction);
        const result: ExecutionMutationResult = {
          session,
          intervals: [...intervals],
          task,
          timeBlock: block,
          recordedWorkSeconds: recordedWorkSeconds(intervals),
          operationId,
          stateVersion: nextState.stateVersion,
          planRevision: nextState.planRevision,
          ...status,
        };
        const localTime = resolveLocalTime(
          this.#dependencies.localTimeProvider,
          transitionAt,
          writeContext.operationId,
        );
        const activity = createTaskActivityEvent({
          id: generateId(
            this.#dependencies.ids.activity,
            parseTaskActivityEventId,
            'Task activity event ID',
            writeContext.operationId,
          ),
          taskId: task.id,
          timeBlockId: session.timeBlockId,
          eventType: action,
          actor: activityActor(writeContext.authority),
          occurredAt: transitionAt,
          localDate: localTime.localDate,
          timeZone: localTime.timeZone,
          operationId,
          beforeSummary: { sessionStatus: current.status },
          afterSummary: { sessionStatus: session.status },
        });
        await transaction.operationRecords.insert(
          buildOperationRecord(
            identity,
            result,
            baseState,
            nextState,
            transitionAt,
            {
              sessionBefore: current,
              sessionAfter: session,
              intervalClosed: closed,
              intervalOpened: nextInterval,
            },
          ),
        );
        await transaction.executionIntervals.update(closed);
        await transaction.executionIntervals.insert(nextInterval);
        await transaction.executionSessions.update(session);
        await transaction.taskActivityEvents.insert(activity);
        await transaction.scheduleState.update(nextState);
        return result;
      });
    });
  }

  async finish(
    input: FinishExecutionInput,
    context: WriteContext,
  ): Promise<ExecutionFinishResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        finishExecutionInputSchema,
        input,
        'Execution finish input',
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
      requireExecutionAuthority(
        writeContext.authority,
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'execution.finish',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const sessionId = parseExecutionSessionId(parsed.sessionId);
      const result = await this.#dependencies.unitOfWork.transaction(
        async (transaction) => {
          const stored =
            await transaction.operationRecords.findById(operationId);
          if (stored !== null) {
            return decodeStoredReceipt(
              stored,
              identity,
              executionFinishResultSchema,
            );
          }
          const current =
            await transaction.executionSessions.findById(sessionId);
          if (current === null) {
            throw executionError(
              'not_found',
              'ExecutionSession was not found.',
              writeContext.operationId,
            );
          }
          if (current.status === 'completed') {
            if (current.completionType !== parsed.outcome) {
              throw executionError(
                'invalid_transition',
                'ExecutionSession already finished with another outcome.',
                writeContext.operationId,
              );
            }
            return this.#recordFinishedReplay(
              transaction,
              current,
              identity,
              operationId,
              writeContext.operationId,
            );
          }
          if (current.status === 'abandoned') {
            throw executionError(
              'invalid_transition',
              'An abandoned ExecutionSession cannot be completed.',
              writeContext.operationId,
            );
          }
          return this.#commitFinish(
            transaction,
            current,
            parsed,
            writeContext,
            identity,
            operationId,
          );
        },
      );
      await this.#wakeIfPending(result);
      return result;
    });
  }

  async abandon(
    input: ExecutionSessionInput,
    context: WriteContext,
  ): Promise<ExecutionFinishResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        executionSessionInputSchema,
        input,
        'Execution abandon input',
        writeContext.operationId,
      );
      requireExecutionAuthority(
        writeContext.authority,
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'execution.abandon',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const sessionId = parseExecutionSessionId(parsed.sessionId);
      const result = await this.#dependencies.unitOfWork.transaction(
        async (transaction) => {
          const stored =
            await transaction.operationRecords.findById(operationId);
          if (stored !== null) {
            return decodeStoredReceipt(
              stored,
              identity,
              executionFinishResultSchema,
            );
          }
          const current =
            await transaction.executionSessions.findById(sessionId);
          if (current === null) {
            throw executionError(
              'not_found',
              'ExecutionSession was not found.',
              writeContext.operationId,
            );
          }
          if (current.status === 'abandoned') {
            return this.#recordFinishedReplay(
              transaction,
              current,
              identity,
              operationId,
              writeContext.operationId,
            );
          }
          if (current.status === 'completed') {
            throw executionError(
              'invalid_transition',
              'A completed ExecutionSession cannot be abandoned.',
              writeContext.operationId,
            );
          }
          return this.#commitAbandon(
            transaction,
            current,
            writeContext,
            identity,
            operationId,
          );
        },
      );
      await this.#wakeIfPending(result);
      return result;
    });
  }

  async #commitFinish(
    transaction: ApplicationTransaction,
    current: ExecutionSession,
    parsed: ReturnType<typeof finishExecutionInputSchema.parse>,
    writeContext: WriteContext,
    identity: ReturnType<typeof operationIdentity>,
    operationId: ReturnType<typeof parseOperationId>,
  ): Promise<ExecutionFinishResult> {
    const open = await requireOpenInterval(
      transaction,
      current,
      writeContext.operationId,
    );
    const closed = closeExecutionInterval(
      open,
      readClock(this.#dependencies.clock, writeContext.operationId),
    );
    const endedAt = closed.endAt as Instant;
    const extraPause =
      open.kind === 'pause' ? executionIntervalSeconds(closed) : 0;
    const session = finishExecutionSession(
      current,
      endedAt,
      parsed.outcome,
      extraPause,
    );
    const currentIntervals =
      await transaction.executionIntervals.listBySessionId(session.id);
    const intervals = replaceInterval(currentIntervals, closed);
    const sessionWorkSeconds = recordedWorkSeconds(intervals);
    const currentTask = await transaction.tasks.findById(session.taskId);
    if (currentTask === null) {
      throw dataIntegrityError(
        'ExecutionSession references a missing Task.',
        writeContext.operationId,
      );
    }
    const workedTask =
      sessionWorkSeconds > 0
        ? applyRecordedTaskWork(currentTask, sessionWorkSeconds / 60, endedAt)
        : currentTask;
    const linkedBlock =
      session.timeBlockId === null
        ? null
        : await transaction.timeBlocks.findById(session.timeBlockId);
    if (
      linkedBlock !== null &&
      (linkedBlock.taskId !== session.taskId ||
        linkedBlock.status !== 'started')
    ) {
      throw dataIntegrityError(
        'ExecutionSession TimeBlock is not the matching started block.',
        writeContext.operationId,
      );
    }
    const allBlocks = await transaction.timeBlocks.listAll();
    const changesById = new Map<string, TimeBlockMutation>();
    if (linkedBlock !== null) {
      changesById.set(
        linkedBlock.id,
        makeBlockMutation(linkedBlock, 'completed', endedAt),
      );
    }
    if (parsed.outcome === 'complete_task') {
      for (const block of allBlocks) {
        if (
          block.taskId === session.taskId &&
          block.status === 'planned' &&
          Date.parse(block.startAt) > Date.parse(endedAt)
        ) {
          changesById.set(
            block.id,
            makeBlockMutation(block, 'canceled', endedAt),
          );
        }
      }
    }
    const localTime = resolveLocalTime(
      this.#dependencies.localTimeProvider,
      endedAt,
      writeContext.operationId,
    );
    const baseState = await requireScheduleState(
      transaction,
      writeContext.operationId,
    );
    const planMutation = await prepareExecutionPlanMutation({
      transaction,
      baseState,
      blockChanges: [...changesById.values()],
      now: endedAt,
      timeZone: localTime.timeZone,
      operationId,
      reason:
        parsed.outcome === 'complete_task'
          ? 'execution_complete_task'
          : 'execution_finish_session',
      ids: this.#dependencies.ids,
    });
    const resultBlock =
      linkedBlock === null
        ? null
        : (planMutation.blockChanges.find(
            (change) => change.before.id === linkedBlock.id,
          )?.after ?? null);
    let task = workedTask;
    let completionRecord: ExecutionFinishResult['completionRecord'] = null;
    let achievement: ExecutionFinishResult['achievement'] = null;
    if (parsed.outcome === 'complete_task') {
      const existing = await transaction.completionRecords.findByTaskId(
        session.taskId,
      );
      if (existing !== null) {
        throw dataIntegrityError(
          'An unfinished Task already has completion evidence.',
          writeContext.operationId,
        );
      }
      const taskSessions = await transaction.executionSessions.listByTaskId(
        session.taskId,
      );
      let allRecordedSeconds = 0;
      for (const taskSession of taskSessions) {
        const taskIntervals =
          taskSession.id === session.id
            ? intervals
            : await transaction.executionIntervals.listBySessionId(
                taskSession.id,
              );
        allRecordedSeconds += recordedWorkSeconds(taskIntervals);
      }
      task = completeTask(workedTask, {
        completedAt: endedAt,
        ...(allRecordedSeconds > 0 || parsed.allEffortRecorded === true
          ? { actualDurationMinutes: allRecordedSeconds / 60 }
          : {}),
      });
      completionRecord = createCompletionRecord({
        id: generateId(
          this.#dependencies.ids.completionRecord,
          parseCompletionRecordId,
          'CompletionRecord ID',
          writeContext.operationId,
        ),
        taskId: task.id,
        sourceSessionId: session.id,
        operationId,
        completedAt: endedAt,
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
        source: completionSource(writeContext.authority),
      });
      if (parsed.recordAchievement === true) {
        achievement = createAchievement({
          id: generateId(
            this.#dependencies.ids.achievement,
            parseAchievementId,
            'Achievement ID',
            writeContext.operationId,
          ),
          sourceCompletionRecordId: completionRecord.id,
          sourceTaskId: task.id,
          sourceExecutionSessionId: session.id,
          title: task.title,
          evidenceType: 'task_completion',
          occurredAt: endedAt,
          createdAt: endedAt,
        });
      }
    }
    const result: ExecutionFinishResult = {
      session,
      intervals: [...intervals],
      task,
      timeBlock: resultBlock,
      recordedWorkSeconds: sessionWorkSeconds,
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
        this.#dependencies.ids.activity,
        parseTaskActivityEventId,
        'Task activity event ID',
        writeContext.operationId,
      ),
      taskId: task.id,
      timeBlockId: session.timeBlockId,
      eventType: parsed.outcome,
      actor: activityActor(writeContext.authority),
      occurredAt: endedAt,
      localDate: localTime.localDate,
      timeZone: localTime.timeZone,
      operationId,
      beforeSummary: {
        taskStatus: currentTask.status,
        sessionStatus: current.status,
      },
      afterSummary: {
        taskStatus: task.status,
        sessionStatus: session.status,
      },
    });
    await transaction.operationRecords.insert(
      buildOperationRecord(
        identity,
        result,
        baseState,
        planMutation.state,
        endedAt,
        {
          sessionBefore: current,
          sessionAfter: session,
          intervalClosed: closed,
          timeBlockChanges: planMutation.blockChanges,
          completionRecord,
          achievement,
        },
      ),
    );
    await transaction.executionIntervals.update(closed);
    await transaction.executionSessions.update(session);
    if (task !== currentTask) await transaction.tasks.update(task);
    if (completionRecord !== null) {
      await transaction.completionRecords.insert(completionRecord);
    }
    if (achievement !== null)
      await transaction.achievements.insert(achievement);
    await transaction.taskActivityEvents.insert(activity);
    await persistExecutionPlanMutation(transaction, planMutation);
    return result;
  }

  async #commitAbandon(
    transaction: ApplicationTransaction,
    current: ExecutionSession,
    writeContext: WriteContext,
    identity: ReturnType<typeof operationIdentity>,
    operationId: ReturnType<typeof parseOperationId>,
  ): Promise<ExecutionFinishResult> {
    const open = await requireOpenInterval(
      transaction,
      current,
      writeContext.operationId,
    );
    const closed = closeExecutionInterval(
      open,
      readClock(this.#dependencies.clock, writeContext.operationId),
    );
    const endedAt = closed.endAt as Instant;
    const extraPause =
      open.kind === 'pause' ? executionIntervalSeconds(closed) : 0;
    const session = abandonExecutionSession(current, endedAt, extraPause);
    const currentIntervals =
      await transaction.executionIntervals.listBySessionId(session.id);
    const intervals = replaceInterval(currentIntervals, closed);
    const sessionWorkSeconds = recordedWorkSeconds(intervals);
    const currentTask = await transaction.tasks.findById(session.taskId);
    if (currentTask === null) {
      throw dataIntegrityError(
        'ExecutionSession references a missing Task.',
        writeContext.operationId,
      );
    }
    const task =
      sessionWorkSeconds > 0
        ? applyRecordedTaskWork(currentTask, sessionWorkSeconds / 60, endedAt)
        : currentTask;
    const linkedBlock =
      session.timeBlockId === null
        ? null
        : await transaction.timeBlocks.findById(session.timeBlockId);
    if (
      linkedBlock !== null &&
      (linkedBlock.taskId !== session.taskId ||
        linkedBlock.status !== 'started')
    ) {
      throw dataIntegrityError(
        'ExecutionSession TimeBlock is not the matching started block.',
        writeContext.operationId,
      );
    }
    const localTime = resolveLocalTime(
      this.#dependencies.localTimeProvider,
      endedAt,
      writeContext.operationId,
    );
    const baseState = await requireScheduleState(
      transaction,
      writeContext.operationId,
    );
    const planMutation = await prepareExecutionPlanMutation({
      transaction,
      baseState,
      blockChanges:
        linkedBlock === null
          ? []
          : [makeBlockMutation(linkedBlock, 'skipped', endedAt)],
      now: endedAt,
      timeZone: localTime.timeZone,
      operationId,
      reason: 'execution_abandon',
      ids: this.#dependencies.ids,
    });
    const result: ExecutionFinishResult = {
      session,
      intervals: [...intervals],
      task,
      timeBlock: planMutation.blockChanges[0]?.after ?? null,
      recordedWorkSeconds: sessionWorkSeconds,
      completionRecord: null,
      achievement: null,
      operationId,
      stateVersion: planMutation.state.stateVersion,
      planRevision: planMutation.state.planRevision,
      calendar: planMutation.calendar,
      notifications: planMutation.notifications,
    };
    const activity = createTaskActivityEvent({
      id: generateId(
        this.#dependencies.ids.activity,
        parseTaskActivityEventId,
        'Task activity event ID',
        writeContext.operationId,
      ),
      taskId: task.id,
      timeBlockId: session.timeBlockId,
      eventType: 'abandon',
      actor: activityActor(writeContext.authority),
      occurredAt: endedAt,
      localDate: localTime.localDate,
      timeZone: localTime.timeZone,
      operationId,
      beforeSummary: {
        taskStatus: currentTask.status,
        sessionStatus: current.status,
      },
      afterSummary: {
        taskStatus: task.status,
        sessionStatus: session.status,
      },
    });
    await transaction.operationRecords.insert(
      buildOperationRecord(
        identity,
        result,
        baseState,
        planMutation.state,
        endedAt,
        {
          sessionBefore: current,
          sessionAfter: session,
          intervalClosed: closed,
          timeBlockChanges: planMutation.blockChanges,
        },
      ),
    );
    await transaction.executionIntervals.update(closed);
    await transaction.executionSessions.update(session);
    if (task !== currentTask) await transaction.tasks.update(task);
    await transaction.taskActivityEvents.insert(activity);
    await persistExecutionPlanMutation(transaction, planMutation);
    return result;
  }

  async #recordFinishedReplay(
    transaction: ApplicationTransaction,
    session: ExecutionSession,
    identity: ReturnType<typeof operationIdentity>,
    operationId: ReturnType<typeof parseOperationId>,
    rawOperationId: string,
  ): Promise<ExecutionFinishResult> {
    const details = await readExecutionDetails(
      transaction,
      session,
      rawOperationId,
    );
    const completionRecord =
      session.completionType === 'complete_task'
        ? await transaction.completionRecords.findByTaskId(session.taskId)
        : null;
    if (
      session.completionType === 'complete_task' &&
      completionRecord === null
    ) {
      throw dataIntegrityError(
        'Completed Task execution is missing completion evidence.',
        rawOperationId,
      );
    }
    const achievement =
      completionRecord === null
        ? null
        : await transaction.achievements.findByCompletionRecordId(
            completionRecord.id,
          );
    const state = await requireScheduleState(transaction, rawOperationId);
    const status = await currentIntegrationStatus(transaction);
    const now = readClock(this.#dependencies.clock, rawOperationId);
    const result: ExecutionFinishResult = {
      ...details,
      intervals: [...details.intervals],
      completionRecord,
      achievement,
      operationId,
      stateVersion: state.stateVersion,
      planRevision: state.planRevision,
      ...status,
    };
    await transaction.operationRecords.insert(
      buildOperationRecord(identity, result, state, state, now),
    );
    return result;
  }

  async #wakeIfPending(
    result: Pick<
      ExecutionMutationResult,
      'operationId' | 'calendar' | 'notifications'
    >,
  ): Promise<void> {
    if (result.calendar !== 'pending' && result.notifications !== 'pending') {
      return;
    }
    try {
      await this.#dependencies.integrationWakeup?.wake(result.operationId);
    } catch {
      // Durable IntegrationJobs are the recovery source.
    }
  }
}
