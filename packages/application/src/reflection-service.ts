import {
  createDailyReflection,
  parseDailyReflectionId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseTimeZoneId,
  updateDailyReflection,
  type DailyReflection,
  type ReflectionWin,
  type TimeBlock,
} from '@workspace/domain';

import { ApplicationError } from './errors';
import type {
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  WriteContext,
} from './ports';
import {
  dailyReflectionSnapshotSchema,
  reflectionDayInputSchema,
  reflectionMutationResultSchema,
  refreshDailyReflectionInputSchema,
  type ReflectionDayInput,
  type ReflectionMutationResult,
  type RefreshDailyReflectionInput,
} from './wellbeing-schemas';
import {
  buildOperationRecord,
  decodeStoredReceipt,
  generateId,
  operationIdentity,
  parseBoundaryInput,
  parseWriteContext,
  protectApplicationCall,
  readClock,
  requireScheduleState,
} from './service-support';

export type ReflectionServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
  idGenerator: IdGenerator;
}>;

function requireDirectUser(context: WriteContext): void {
  if (context.authority.kind !== 'user') {
    throw new ApplicationError(
      'permission_required',
      'Creating or editing a reflection requires direct user action.',
      { retryable: false, operationId: context.operationId },
    );
  }
}

function validateDay(input: ReflectionDayInput) {
  const localDate = parseLocalDate(input.localDate);
  const timeZone = parseTimeZoneId(input.timeZone);
  const range = {
    start: parseInstant(input.range.start),
    end: parseInstant(input.range.end),
  };
  if (Date.parse(range.end) <= Date.parse(range.start)) {
    throw new ApplicationError(
      'validation_error',
      'Reflection day range must be non-empty.',
      { retryable: false },
    );
  }
  return { localDate, timeZone, range };
}

function localSummary(
  completions: readonly ReflectionWin[],
  total: number,
  taskBlocks: readonly TimeBlock[],
): string {
  const completionSummary =
    total === 0
      ? '今天还没有可核对的完成记录。你可以补充备注，但系统不会代写未发生的成果。'
      : total === 1
        ? `今天完成了 1 项：${completions
            .map((win) => `「${win.title}」`)
            .join('、')}。`
        : `今天完成了 ${total} 项，其中包括 ${completions
            .map((win) => `「${win.title}」`)
            .join('、')}。`;
  if (taskBlocks.length === 0) return completionSummary;
  const count = (status: TimeBlock['status']) =>
    taskBlocks.filter((block) => block.status === status).length;
  const open = count('planned') + count('started');
  return `${completionSummary} 今日任务时间块共 ${taskBlocks.length} 个：完成 ${count('completed')} 个，跳过 ${count('skipped')} 个，取消 ${count('canceled')} 个，仍在计划中 ${open} 个。`;
}

export class ReflectionService {
  readonly #dependencies: ReflectionServiceDependencies;

  constructor(dependencies: ReflectionServiceDependencies) {
    this.#dependencies = dependencies;
  }

  getForDay(input: ReflectionDayInput): Promise<DailyReflection | null> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        reflectionDayInputSchema,
        input,
        'Reflection day input',
      );
      const day = validateDay(parsed);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const reflection = await transaction.dailyReflections.findByLocalDay(
          day.localDate,
          day.timeZone,
        );
        return reflection === null
          ? null
          : dailyReflectionSnapshotSchema.parse(reflection);
      });
    });
  }

  refresh(
    input: RefreshDailyReflectionInput,
    context: WriteContext,
  ): Promise<ReflectionMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      requireDirectUser(writeContext);
      const parsed = parseBoundaryInput(
        refreshDailyReflectionInputSchema,
        input,
        'Reflection refresh input',
        writeContext.operationId,
      );
      const day = validateDay(parsed);
      const identity = operationIdentity(
        writeContext,
        'reflection.refresh',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            reflectionMutationResultSchema,
          );
        }
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const [records, tasks, blocks, current] = await Promise.all([
          transaction.completionRecords.listCompletedBetween(
            day.range.start,
            day.range.end,
          ),
          transaction.tasks.listActive(),
          transaction.timeBlocks.listOverlapping(
            day.range.start,
            day.range.end,
          ),
          transaction.dailyReflections.findByLocalDay(
            day.localDate,
            day.timeZone,
          ),
        ]);
        const ordered = [...records].sort(
          (left, right) =>
            right.completedAt.localeCompare(left.completedAt) ||
            left.id.localeCompare(right.id),
        );
        const wins: readonly ReflectionWin[] = ordered
          .slice(0, 3)
          .map((record) => ({
            completionRecordId: record.id,
            taskId: record.taskId,
            title: record.taskTitleSnapshot,
            completedAt: record.completedAt,
          }));
        const taskBlocks = blocks.filter((block) => block.type === 'task');
        const nextTask = [...tasks].sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )[0];
        const adjustmentSuggestion =
          nextTask === undefined
            ? '明天先确认一件最重要的事，并为它留出可执行时间。'
            : `明天先确认「${nextTask.title}」的下一步和可用时间。`;
        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const reflection =
          current === null
            ? createDailyReflection({
                id: generateId(
                  this.#dependencies.idGenerator,
                  parseDailyReflectionId,
                  'DailyReflection ID',
                  writeContext.operationId,
                ),
                localDate: day.localDate,
                timeZone: day.timeZone,
                summary: localSummary(wins, ordered.length, taskBlocks),
                wins,
                adjustmentSuggestion,
                userNote: parsed.userNote,
                generatedBy: 'local_facts',
                createdAt: now,
              })
            : updateDailyReflection(
                current,
                {
                  summary: localSummary(wins, ordered.length, taskBlocks),
                  wins,
                  adjustmentSuggestion,
                  ...(parsed.userNote === undefined
                    ? {}
                    : { userNote: parsed.userNote }),
                  generatedBy: 'local_facts',
                },
                now,
              );
        if (current === null) {
          await transaction.dailyReflections.insert(reflection);
        } else {
          await transaction.dailyReflections.update(reflection);
        }
        const result: ReflectionMutationResult = {
          reflection,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
          sourceCompletionRecordCount: ordered.length,
        };
        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now, {
            localDate: day.localDate,
            timeZone: day.timeZone,
            sourceCompletionRecordIds: ordered.map((record) => record.id),
            sourceTimeBlockIds: taskBlocks.map((block) => block.id),
          }),
        );
        return reflectionMutationResultSchema.parse(result);
      });
    });
  }
}
