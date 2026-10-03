import {
  createAchievement,
  parseAchievementId,
  parseCompletionRecordId,
  parseInstant,
  parseOperationId,
  setAchievementHidden,
  setCompletionRecordAchievementDisposition,
  updateAchievement,
  type Achievement,
  type CompletionRecord,
  type Goal,
  type Project,
  type Task,
} from '@workspace/domain';

import {
  achievementMutationResultSchema,
  achievementListInputSchema,
  achievementPageSchema,
  achievementRangeInputSchema,
  createAchievementInputSchema,
  setAchievementHiddenInputSchema,
  updateAchievementInputSchema,
  type AchievementMutationResult,
  type AchievementListInput,
  type AchievementPage,
  type AchievementRangeInput,
  type CreateAchievementInput,
  type SetAchievementHiddenInput,
  type UpdateAchievementInput,
} from './achievement-schemas';
import { ApplicationError } from './errors';
import type {
  ApplicationTransaction,
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  WriteContext,
} from './ports';
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
} from './service-support';

export type AchievementServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
  idGenerator: IdGenerator;
}>;

export type AchievementDetails = Readonly<{
  achievement: Achievement;
  completionRecord: CompletionRecord;
  task: Task;
  project: Project | null;
  goal: Goal | null;
}>;

function error(
  code:
    | 'not_found'
    | 'permission_required'
    | 'validation_error'
    | 'invalid_transition',
  message: string,
  operationId?: string,
): ApplicationError {
  return new ApplicationError(code, message, {
    retryable: false,
    operationId,
  });
}

function requireDirectUser(context: WriteContext): void {
  if (context.authority.kind !== 'user') {
    throw error(
      'permission_required',
      'Editing the Success Diary requires direct user action.',
      context.operationId,
    );
  }
}

async function readAchievementDetails(
  transaction: ApplicationTransaction,
  achievement: Achievement,
): Promise<AchievementDetails> {
  const completionRecord = await transaction.completionRecords.findById(
    achievement.sourceCompletionRecordId,
  );
  const task = await transaction.tasks.findById(achievement.sourceTaskId);
  if (
    completionRecord === null ||
    task === null ||
    completionRecord.taskId !== task.id
  ) {
    throw dataIntegrityError(
      'Achievement does not resolve to its completion evidence.',
    );
  }
  const project =
    task.projectId === null
      ? null
      : await transaction.projects.findById(task.projectId);
  if (task.projectId !== null && project === null) {
    throw dataIntegrityError('Achievement Task references a missing Project.');
  }
  const goalId = task.goalId ?? project?.goalId ?? null;
  const goal =
    goalId === null ? null : await transaction.goals.findById(goalId);
  if (goalId !== null && goal === null) {
    throw dataIntegrityError('Achievement Task references a missing Goal.');
  }
  return { achievement, completionRecord, task, project, goal };
}

async function insertNoStateChangeReceipt(
  transaction: ApplicationTransaction,
  identity: ReturnType<typeof operationIdentity>,
  achievement: Achievement,
  occurredAt: ReturnType<typeof parseInstant>,
): Promise<AchievementMutationResult> {
  const state = await requireScheduleState(transaction, identity.operationId);
  const result: AchievementMutationResult = {
    achievement,
    operationId: parseOperationId(identity.operationId),
    stateVersion: state.stateVersion,
    planRevision: state.planRevision,
  };
  await transaction.operationRecords.insert(
    buildOperationRecord(identity, result, state, state, occurredAt),
  );
  return result;
}

export class AchievementService {
  readonly #dependencies: AchievementServiceDependencies;

  constructor(dependencies: AchievementServiceDependencies) {
    this.#dependencies = dependencies;
  }

  get(achievementId: string): Promise<Achievement> {
    return protectApplicationCall(undefined, async () => {
      const id = parseAchievementId(achievementId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const achievement = await transaction.achievements.findById(id);
        if (achievement === null) {
          throw error('not_found', 'Achievement was not found.');
        }
        return achievement;
      });
    });
  }

  getDetails(achievementId: string): Promise<AchievementDetails> {
    return protectApplicationCall(undefined, async () => {
      const id = parseAchievementId(achievementId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const achievement = await transaction.achievements.findById(id);
        if (achievement === null) {
          throw error('not_found', 'Achievement was not found.');
        }
        return readAchievementDetails(transaction, achievement);
      });
    });
  }

  listRange(input: AchievementRangeInput): Promise<readonly Achievement[]> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        achievementRangeInputSchema,
        input,
        'Achievement range',
      );
      const start = parseInstant(parsed.start);
      const end = parseInstant(parsed.end);
      if (Date.parse(end) <= Date.parse(start)) {
        throw error(
          'validation_error',
          'Achievement range end must be after start.',
        );
      }
      return this.#dependencies.unitOfWork.transaction(async (transaction) =>
        (await transaction.achievements.listOccurredBetween(start, end)).filter(
          (achievement) => !achievement.hidden,
        ),
      );
    });
  }

  list(input: AchievementListInput = {}): Promise<AchievementPage> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        achievementListInputSchema,
        input,
        'Achievement list input',
      );
      const range =
        parsed.range === undefined
          ? null
          : {
              start: parseInstant(parsed.range.start),
              end: parseInstant(parsed.range.end),
            };
      if (range !== null && Date.parse(range.end) <= Date.parse(range.start)) {
        throw error(
          'validation_error',
          'Achievement list range end must be after start.',
        );
      }
      const achievements = await this.#dependencies.unitOfWork.transaction(
        async (transaction) => {
          const values =
            range === null
              ? await transaction.achievements.listAll()
              : await transaction.achievements.listOccurredBetween(
                  range.start,
                  range.end,
                );
          return values.filter((achievement) => !achievement.hidden);
        },
      );
      let startIndex = 0;
      if (parsed.cursor !== undefined) {
        const cursorIndex = achievements.findIndex(
          (achievement) => achievement.id === parsed.cursor,
        );
        if (cursorIndex < 0) {
          throw error(
            'validation_error',
            'Achievement list cursor is invalid for this query.',
          );
        }
        startIndex = cursorIndex + 1;
      }
      const items = achievements.slice(startIndex, startIndex + parsed.limit);
      const result: AchievementPage = {
        items,
        nextCursor:
          startIndex + items.length < achievements.length
            ? (items.at(-1)?.id ?? null)
            : null,
      };
      return parseBoundaryInput(
        achievementPageSchema,
        result,
        'Achievement list result',
      );
    });
  }

  listAll(
    input: Readonly<{ includeHidden?: boolean }> = {},
  ): Promise<readonly Achievement[]> {
    return protectApplicationCall(undefined, async () => {
      if (
        typeof input !== 'object' ||
        input === null ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => key !== 'includeHidden') ||
        (input.includeHidden !== undefined &&
          typeof input.includeHidden !== 'boolean')
      ) {
        throw error('validation_error', 'Achievement list input is invalid.');
      }
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const achievements = await transaction.achievements.listAll();
        return input.includeHidden === true
          ? achievements
          : achievements.filter((achievement) => !achievement.hidden);
      });
    });
  }

  listAllDetails(
    input: Readonly<{ includeHidden?: boolean }> = {},
  ): Promise<readonly AchievementDetails[]> {
    return protectApplicationCall(undefined, async () => {
      if (
        typeof input !== 'object' ||
        input === null ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => key !== 'includeHidden') ||
        (input.includeHidden !== undefined &&
          typeof input.includeHidden !== 'boolean')
      ) {
        throw error('validation_error', 'Achievement list input is invalid.');
      }
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const achievements = (await transaction.achievements.listAll()).filter(
          (achievement) => input.includeHidden === true || !achievement.hidden,
        );
        const details: AchievementDetails[] = [];
        for (const achievement of achievements) {
          details.push(await readAchievementDetails(transaction, achievement));
        }
        return details;
      });
    });
  }

  create(
    input: CreateAchievementInput,
    context: WriteContext,
  ): Promise<AchievementMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        createAchievementInputSchema,
        input,
        'Achievement create input',
        writeContext.operationId,
      );
      if (writeContext.authority.kind === 'system') {
        throw error(
          'permission_required',
          'Achievement creation requires direct user or authorized agent action.',
          writeContext.operationId,
        );
      }
      const identity = operationIdentity(
        writeContext,
        'achievement.create',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const completionRecordId = parseCompletionRecordId(
        parsed.completionRecordId,
      );
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            achievementMutationResultSchema,
          );
        }
        const completionRecord =
          await transaction.completionRecords.findById(completionRecordId);
        if (completionRecord === null) {
          throw error(
            'not_found',
            'CompletionRecord was not found.',
            writeContext.operationId,
          );
        }
        const existing =
          await transaction.achievements.findByCompletionRecordId(
            completionRecordId,
          );
        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        if (existing !== null) {
          return insertNoStateChangeReceipt(
            transaction,
            identity,
            existing,
            now,
          );
        }
        if (
          completionRecord.achievementDisposition === 'skip' &&
          writeContext.authority.kind !== 'user'
        ) {
          throw error(
            'permission_required',
            'Only a direct user may reverse an Achievement opt-out.',
            writeContext.operationId,
          );
        }
        const task = await transaction.tasks.findById(completionRecord.taskId);
        if (task === null || task.status !== 'completed') {
          throw dataIntegrityError(
            'CompletionRecord does not resolve to a completed Task.',
            writeContext.operationId,
          );
        }
        const achievement = createAchievement({
          id: generateId(
            this.#dependencies.idGenerator,
            parseAchievementId,
            'Achievement ID',
            writeContext.operationId,
          ),
          sourceCompletionRecordId: completionRecord.id,
          sourceTaskId: completionRecord.taskId,
          sourceExecutionSessionId: completionRecord.sourceSessionId,
          title: parsed.title ?? completionRecord.taskTitleSnapshot,
          summary: parsed.summary,
          evidenceType: 'task_completion',
          occurredAt: completionRecord.completedAt,
          userEdited:
            parsed.title !== undefined || parsed.summary !== undefined,
          createdAt: now,
        });
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: AchievementMutationResult = {
          achievement,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };
        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now, {
            completionRecordId,
            achievementId: achievement.id,
          }),
        );
        await transaction.completionRecords.update(
          setCompletionRecordAchievementDisposition(completionRecord, 'record'),
        );
        await transaction.achievements.insert(achievement);
        return result;
      });
    });
  }

  update(
    input: UpdateAchievementInput,
    context: WriteContext,
  ): Promise<AchievementMutationResult> {
    return this.#update(input, context, 'update');
  }

  setHidden(
    input: SetAchievementHiddenInput,
    context: WriteContext,
  ): Promise<AchievementMutationResult> {
    return this.#update(input, context, 'set_hidden');
  }

  async #update(
    input: UpdateAchievementInput | SetAchievementHiddenInput,
    context: WriteContext,
    command: 'update' | 'set_hidden',
  ): Promise<AchievementMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      requireDirectUser(writeContext);
      const parsed =
        command === 'update'
          ? parseBoundaryInput(
              updateAchievementInputSchema,
              input,
              'Achievement update input',
              writeContext.operationId,
            )
          : parseBoundaryInput(
              setAchievementHiddenInputSchema,
              input,
              'Achievement visibility input',
              writeContext.operationId,
            );
      const identity = operationIdentity(
        writeContext,
        `achievement.${command}`,
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const achievementId = parseAchievementId(parsed.achievementId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            achievementMutationResultSchema,
          );
        }
        const current = await transaction.achievements.findById(achievementId);
        if (current === null) {
          throw error(
            'not_found',
            'Achievement was not found.',
            writeContext.operationId,
          );
        }
        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const achievement =
          command === 'update'
            ? updateAchievement(
                current,
                (
                  parsed as ReturnType<
                    typeof updateAchievementInputSchema.parse
                  >
                ).patch,
                now,
              )
            : setAchievementHidden(
                current,
                (
                  parsed as ReturnType<
                    typeof setAchievementHiddenInputSchema.parse
                  >
                ).hidden,
                now,
              );
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: AchievementMutationResult = {
          achievement,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };
        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now, {
            before: current,
            after: achievement,
          }),
        );
        await transaction.achievements.update(achievement);
        return result;
      });
    });
  }
}
