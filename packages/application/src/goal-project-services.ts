import {
  archiveGoal,
  archiveProject,
  calculateGoalProgress,
  createGoal,
  createProject,
  parseGoalId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseProjectId,
  updateGoal,
  updateProject,
  type Goal,
  type GoalProgress,
  type Project,
} from '@workspace/domain';

import type {
  ApplicationTransaction,
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  WriteContext,
} from './ports';
import { ApplicationError } from './errors';
import {
  archiveGoalInputSchema,
  archiveProjectInputSchema,
  createGoalInputSchema,
  createProjectInputSchema,
  goalListInputSchema,
  goalPageSchema,
  goalMutationResultSchema,
  projectListInputSchema,
  projectPageSchema,
  projectMutationResultSchema,
  updateGoalInputSchema,
  updateProjectInputSchema,
  type ArchiveGoalInput,
  type ArchiveProjectInput,
  type CreateGoalInput,
  type CreateProjectInput,
  type GoalListInput,
  type GoalPage,
  type GoalMutationResult,
  type ProjectMutationResult,
  type ProjectListInput,
  type ProjectPage,
  type UpdateGoalInput,
  type UpdateProjectInput,
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
} from './service-support';

export interface GoalProjectServiceDependencies {
  readonly unitOfWork: ApplicationUnitOfWork;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

function boundedPage<Entity extends { readonly id: string }>(
  items: readonly Entity[],
  input: Readonly<{ cursor?: string; limit: number }>,
): Readonly<{ items: readonly Entity[]; nextCursor: string | null }> {
  let startIndex = 0;
  if (input.cursor !== undefined) {
    const cursorIndex = items.findIndex((item) => item.id === input.cursor);
    if (cursorIndex < 0) {
      throw new ApplicationError(
        'validation_error',
        'List cursor is invalid for this query.',
        { retryable: false },
      );
    }
    startIndex = cursorIndex + 1;
  }
  const pageItems = items.slice(startIndex, startIndex + input.limit);
  return {
    items: pageItems,
    nextCursor:
      startIndex + pageItems.length < items.length
        ? (pageItems.at(-1)?.id ?? null)
        : null,
  };
}

async function ensureGoalExists(
  transaction: ApplicationTransaction,
  goalId: ReturnType<typeof parseGoalId> | null | undefined,
  operationId: string,
): Promise<void> {
  if (
    goalId !== null &&
    goalId !== undefined &&
    (await transaction.goals.findById(goalId)) === null
  ) {
    throw invalidReferenceError('Goal', operationId);
  }
}

export class GoalService {
  readonly #dependencies: GoalProjectServiceDependencies;

  constructor(dependencies: GoalProjectServiceDependencies) {
    this.#dependencies = dependencies;
  }

  async get(goalId: string): Promise<Goal> {
    return protectApplicationCall(undefined, async () => {
      const id = parseGoalId(goalId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const goal = await transaction.goals.findById(id);
        if (goal === null) throw notFoundError('Goal');
        return goal;
      });
    });
  }

  async list(input: GoalListInput = {}): Promise<GoalPage> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        goalListInputSchema,
        input,
        'Goal list input',
      );
      const goals = await this.#dependencies.unitOfWork.transaction(
        (transaction) => transaction.goals.listAll(),
      );
      return parseBoundaryInput(
        goalPageSchema,
        boundedPage(
          goals
            .filter(
              (goal) => parsed.includeArchived || goal.archivedAt === null,
            )
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            ),
          parsed,
        ),
        'Goal list result',
      );
    });
  }

  async create(
    input: CreateGoalInput,
    context: WriteContext,
  ): Promise<GoalMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        createGoalInputSchema,
        input,
        'Goal create input',
        writeContext.operationId,
      );
      const identity = operationIdentity(writeContext, 'goal.create', parsed);
      const operationId = parseOperationId(writeContext.operationId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            goalMutationResultSchema,
          );
        }

        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const goal = createGoal({
          id: generateId(
            this.#dependencies.idGenerator,
            parseGoalId,
            'Goal ID',
            writeContext.operationId,
          ),
          title: parsed.title,
          description: parsed.description,
          status: parsed.status,
          targetDate:
            parsed.targetDate === null || parsed.targetDate === undefined
              ? null
              : parseLocalDate(parsed.targetDate),
          createdAt: now,
        });
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: GoalMutationResult = {
          goal,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };

        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now),
        );
        await transaction.goals.insert(goal);
        return result;
      });
    });
  }

  async update(
    input: UpdateGoalInput,
    context: WriteContext,
  ): Promise<GoalMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        updateGoalInputSchema,
        input,
        'Goal update input',
        writeContext.operationId,
      );
      const identity = operationIdentity(writeContext, 'goal.update', parsed);
      const operationId = parseOperationId(writeContext.operationId);
      const goalId = parseGoalId(parsed.goalId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          const replay = decodeStoredReceipt(
            stored,
            identity,
            goalMutationResultSchema,
          );
          if (replay.goal.id !== goalId) {
            throw dataIntegrityError(
              'Stored Goal update result references another Goal.',
              writeContext.operationId,
            );
          }
          return replay;
        }

        const current = await transaction.goals.findById(goalId);
        if (current === null) {
          throw notFoundError('Goal', writeContext.operationId);
        }
        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const goal = updateGoal(
          current,
          {
            title: parsed.patch.title,
            description: parsed.patch.description,
            status: parsed.patch.status,
            targetDate:
              parsed.patch.targetDate === undefined
                ? undefined
                : parsed.patch.targetDate === null
                  ? null
                  : parseLocalDate(parsed.patch.targetDate),
          },
          now,
        );
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: GoalMutationResult = {
          goal,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };

        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now),
        );
        await transaction.goals.update(goal);
        return result;
      });
    });
  }

  async archive(
    input: ArchiveGoalInput,
    context: WriteContext,
  ): Promise<GoalMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        archiveGoalInputSchema,
        input,
        'Goal archive input',
        writeContext.operationId,
      );
      const identity = operationIdentity(writeContext, 'goal.archive', parsed);
      const operationId = parseOperationId(writeContext.operationId);
      const goalId = parseGoalId(parsed.goalId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          const replay = decodeStoredReceipt(
            stored,
            identity,
            goalMutationResultSchema,
          );
          if (replay.goal.id !== goalId) {
            throw dataIntegrityError(
              'Stored Goal archive result references another Goal.',
              writeContext.operationId,
            );
          }
          return replay;
        }

        const current = await transaction.goals.findById(goalId);
        if (current === null) {
          throw notFoundError('Goal', writeContext.operationId);
        }
        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const goal = archiveGoal(current, now);
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: GoalMutationResult = {
          goal,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };

        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now),
        );
        await transaction.goals.update(goal);
        return result;
      });
    });
  }

  async progress(goalId: string): Promise<GoalProgress> {
    return protectApplicationCall(undefined, async () => {
      const id = parseGoalId(goalId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const goal = await transaction.goals.findById(id);
        if (goal === null) throw notFoundError('Goal');

        const projects = await transaction.projects.listByGoalId(id);
        const directTasks = await transaction.tasks.listByGoalId(id);
        const projectTasks =
          projects.length === 0
            ? []
            : await transaction.tasks.listByProjectIds(
                projects.map((project) => project.id),
              );
        const linkedTasks = new Map(
          [...directTasks, ...projectTasks].map((task) => [task.id, task]),
        );
        const children =
          linkedTasks.size === 0
            ? []
            : await transaction.tasks.listByParentIds([...linkedTasks.keys()]);

        return calculateGoalProgress(
          id,
          [...linkedTasks.values(), ...children],
          projects,
        );
      });
    });
  }
}

export class ProjectService {
  readonly #dependencies: GoalProjectServiceDependencies;

  constructor(dependencies: GoalProjectServiceDependencies) {
    this.#dependencies = dependencies;
  }

  async get(projectId: string): Promise<Project> {
    return protectApplicationCall(undefined, async () => {
      const id = parseProjectId(projectId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const project = await transaction.projects.findById(id);
        if (project === null) throw notFoundError('Project');
        return project;
      });
    });
  }

  async list(input: ProjectListInput = {}): Promise<ProjectPage> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        projectListInputSchema,
        input,
        'Project list input',
      );
      const goalId =
        parsed.goalId === undefined ? undefined : parseGoalId(parsed.goalId);
      const projects = await this.#dependencies.unitOfWork.transaction(
        (transaction) => transaction.projects.listAll(),
      );
      return parseBoundaryInput(
        projectPageSchema,
        boundedPage(
          projects
            .filter(
              (project) =>
                (parsed.includeArchived || project.archivedAt === null) &&
                (goalId === undefined || project.goalId === goalId),
            )
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            ),
          parsed,
        ),
        'Project list result',
      );
    });
  }

  async create(
    input: CreateProjectInput,
    context: WriteContext,
  ): Promise<ProjectMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        createProjectInputSchema,
        input,
        'Project create input',
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'project.create',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            projectMutationResultSchema,
          );
        }

        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const goalId =
          parsed.goalId === null || parsed.goalId === undefined
            ? null
            : parseGoalId(parsed.goalId);
        await ensureGoalExists(transaction, goalId, writeContext.operationId);
        const project = createProject({
          id: generateId(
            this.#dependencies.idGenerator,
            parseProjectId,
            'Project ID',
            writeContext.operationId,
          ),
          goalId,
          title: parsed.title,
          description: parsed.description,
          status: parsed.status,
          deadline:
            parsed.deadline === null || parsed.deadline === undefined
              ? null
              : parseInstant(parsed.deadline),
          createdAt: now,
        });
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: ProjectMutationResult = {
          project,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };

        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now),
        );
        await transaction.projects.insert(project);
        return result;
      });
    });
  }

  async update(
    input: UpdateProjectInput,
    context: WriteContext,
  ): Promise<ProjectMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        updateProjectInputSchema,
        input,
        'Project update input',
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'project.update',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const projectId = parseProjectId(parsed.projectId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          const replay = decodeStoredReceipt(
            stored,
            identity,
            projectMutationResultSchema,
          );
          if (replay.project.id !== projectId) {
            throw dataIntegrityError(
              'Stored Project update result references another Project.',
              writeContext.operationId,
            );
          }
          return replay;
        }

        const current = await transaction.projects.findById(projectId);
        if (current === null) {
          throw notFoundError('Project', writeContext.operationId);
        }
        const goalId =
          parsed.patch.goalId === undefined
            ? undefined
            : parsed.patch.goalId === null
              ? null
              : parseGoalId(parsed.patch.goalId);
        await ensureGoalExists(transaction, goalId, writeContext.operationId);
        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const project = updateProject(
          current,
          {
            goalId,
            title: parsed.patch.title,
            description: parsed.patch.description,
            status: parsed.patch.status,
            deadline:
              parsed.patch.deadline === undefined
                ? undefined
                : parsed.patch.deadline === null
                  ? null
                  : parseInstant(parsed.patch.deadline),
          },
          now,
        );
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: ProjectMutationResult = {
          project,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };

        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now),
        );
        await transaction.projects.update(project);
        return result;
      });
    });
  }

  async archive(
    input: ArchiveProjectInput,
    context: WriteContext,
  ): Promise<ProjectMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        archiveProjectInputSchema,
        input,
        'Project archive input',
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'project.archive',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const projectId = parseProjectId(parsed.projectId);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          const replay = decodeStoredReceipt(
            stored,
            identity,
            projectMutationResultSchema,
          );
          if (replay.project.id !== projectId) {
            throw dataIntegrityError(
              'Stored Project archive result references another Project.',
              writeContext.operationId,
            );
          }
          return replay;
        }

        const current = await transaction.projects.findById(projectId);
        if (current === null) {
          throw notFoundError('Project', writeContext.operationId);
        }
        const now = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const project = archiveProject(current, now);
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: ProjectMutationResult = {
          project,
          operationId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };

        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, now),
        );
        await transaction.projects.update(project);
        return result;
      });
    });
  }
}
