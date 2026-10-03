import { DomainError } from './errors';
import { assertValidTask, type Task } from './task';
import {
  type GoalId,
  type Instant,
  type LocalDate,
  parseGoalId,
  parseInstant,
  parseLocalDate,
  parseProjectId,
  requireNonEmptyString,
  type ProjectId,
  type TaskId,
} from './value-objects';

/** Goal/Project status vocabularies remain open until product docs define them. */
export type GoalStatus = string;
export type ProjectStatus = string;

export interface Goal {
  readonly id: GoalId;
  readonly title: string;
  readonly description: string;
  readonly status: GoalStatus;
  readonly targetDate: LocalDate | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly archivedAt: Instant | null;
}

export interface Project {
  readonly id: ProjectId;
  readonly goalId: GoalId | null;
  readonly title: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly deadline: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly archivedAt: Instant | null;
}

export interface CreateGoalFields {
  readonly id: GoalId;
  readonly title: string;
  readonly description?: string;
  readonly status: string;
  readonly targetDate?: LocalDate | null;
  readonly createdAt: Instant;
}

export interface UpdateGoalFields {
  readonly title?: string;
  readonly description?: string;
  readonly status?: string;
  readonly targetDate?: LocalDate | null;
}

export interface CreateProjectFields {
  readonly id: ProjectId;
  readonly goalId?: GoalId | null;
  readonly title: string;
  readonly description?: string;
  readonly status: string;
  readonly deadline?: Instant | null;
  readonly createdAt: Instant;
}

export interface UpdateProjectFields {
  readonly goalId?: GoalId | null;
  readonly title?: string;
  readonly description?: string;
  readonly status?: string;
  readonly deadline?: Instant | null;
}

function normalizeDescription(value: string | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new DomainError('invalid_value', 'Description must be a string.', {
      field: 'description',
    });
  }
  return value.trim();
}

function invalidEntityValue(entity: 'Goal' | 'Project', rule: string): never {
  throw new DomainError('invalid_value', `${entity} ${rule}.`);
}

function assertPatch(
  entity: 'Goal' | 'Project',
  patch: object,
  allowedFields: ReadonlySet<string>,
): void {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    invalidEntityValue(entity, 'update must be an object');
  }
  for (const key of Reflect.ownKeys(patch)) {
    if (typeof key !== 'string' || !allowedFields.has(key)) {
      invalidEntityValue(entity, 'update contains an unsupported field');
    }
  }
}

export function assertValidGoal(goal: Goal): void {
  parseGoalId(goal.id);
  requireNonEmptyString(goal.title, 'title');
  requireNonEmptyString(goal.status, 'status');
  if (typeof goal.description !== 'string') {
    invalidEntityValue('Goal', 'description must be a string');
  }
  if (goal.targetDate !== null) parseLocalDate(goal.targetDate);
  parseInstant(goal.createdAt);
  parseInstant(goal.updatedAt);
  if (goal.archivedAt !== null) parseInstant(goal.archivedAt);
}

export function createGoal(input: CreateGoalFields): Goal {
  const at = parseInstant(input.createdAt);
  const goal: Goal = {
    id: parseGoalId(input.id),
    title: requireNonEmptyString(input.title, 'title'),
    description: normalizeDescription(input.description),
    status: requireNonEmptyString(input.status, 'status'),
    targetDate:
      input.targetDate === null || input.targetDate === undefined
        ? null
        : parseLocalDate(input.targetDate),
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
  };
  assertValidGoal(goal);
  return goal;
}

const allowedGoalUpdateFields = new Set<keyof UpdateGoalFields>([
  'title',
  'description',
  'status',
  'targetDate',
]);

export function updateGoal(
  goal: Goal,
  patch: UpdateGoalFields,
  updatedAt: Instant,
): Goal {
  assertValidGoal(goal);
  assertPatch('Goal', patch, allowedGoalUpdateFields);

  const next: Goal = {
    ...goal,
    title:
      patch.title === undefined
        ? goal.title
        : requireNonEmptyString(patch.title, 'title'),
    description:
      patch.description === undefined
        ? goal.description
        : normalizeDescription(patch.description),
    status:
      patch.status === undefined
        ? goal.status
        : requireNonEmptyString(patch.status, 'status'),
    targetDate:
      patch.targetDate === undefined
        ? goal.targetDate
        : patch.targetDate === null
          ? null
          : parseLocalDate(patch.targetDate),
    updatedAt: parseInstant(updatedAt),
  };
  assertValidGoal(next);
  return next;
}

export function archiveGoal(goal: Goal, archivedAt: Instant): Goal {
  assertValidGoal(goal);
  if (goal.archivedAt !== null) return goal;

  const at = parseInstant(archivedAt);
  const next: Goal = { ...goal, archivedAt: at, updatedAt: at };
  assertValidGoal(next);
  return next;
}

export function assertValidProject(project: Project): void {
  parseProjectId(project.id);
  if (project.goalId !== null) parseGoalId(project.goalId);
  requireNonEmptyString(project.title, 'title');
  requireNonEmptyString(project.status, 'status');
  if (typeof project.description !== 'string') {
    invalidEntityValue('Project', 'description must be a string');
  }
  if (project.deadline !== null) parseInstant(project.deadline);
  parseInstant(project.createdAt);
  parseInstant(project.updatedAt);
  if (project.archivedAt !== null) parseInstant(project.archivedAt);
}

export function createProject(input: CreateProjectFields): Project {
  const at = parseInstant(input.createdAt);
  const project: Project = {
    id: parseProjectId(input.id),
    goalId:
      input.goalId === null || input.goalId === undefined
        ? null
        : parseGoalId(input.goalId),
    title: requireNonEmptyString(input.title, 'title'),
    description: normalizeDescription(input.description),
    status: requireNonEmptyString(input.status, 'status'),
    deadline:
      input.deadline === null || input.deadline === undefined
        ? null
        : parseInstant(input.deadline),
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
  };
  assertValidProject(project);
  return project;
}

const allowedProjectUpdateFields = new Set<keyof UpdateProjectFields>([
  'goalId',
  'title',
  'description',
  'status',
  'deadline',
]);

export function updateProject(
  project: Project,
  patch: UpdateProjectFields,
  updatedAt: Instant,
): Project {
  assertValidProject(project);
  assertPatch('Project', patch, allowedProjectUpdateFields);

  const next: Project = {
    ...project,
    goalId:
      patch.goalId === undefined
        ? project.goalId
        : patch.goalId === null
          ? null
          : parseGoalId(patch.goalId),
    title:
      patch.title === undefined
        ? project.title
        : requireNonEmptyString(patch.title, 'title'),
    description:
      patch.description === undefined
        ? project.description
        : normalizeDescription(patch.description),
    status:
      patch.status === undefined
        ? project.status
        : requireNonEmptyString(patch.status, 'status'),
    deadline:
      patch.deadline === undefined
        ? project.deadline
        : patch.deadline === null
          ? null
          : parseInstant(patch.deadline),
    updatedAt: parseInstant(updatedAt),
  };
  assertValidProject(next);
  return next;
}

export function archiveProject(project: Project, archivedAt: Instant): Project {
  assertValidProject(project);
  if (project.archivedAt !== null) return project;

  const at = parseInstant(archivedAt);
  const next: Project = { ...project, archivedAt: at, updatedAt: at };
  assertValidProject(next);
  return next;
}

export interface GoalProgress {
  readonly goalId: GoalId;
  readonly completedTaskCount: number;
  readonly effectiveTaskCount: number;
  /** Null means there are no effective Tasks; callers must not show 0%. */
  readonly completionRatio: number | null;
}

/**
 * Aggregates facts from directly-linked and Project-linked Tasks. Archived
 * Goals/Projects remain included because archive does not rewrite history.
 */
export function calculateGoalProgress(
  goalId: GoalId,
  tasks: readonly Task[],
  projects: readonly Project[],
): GoalProgress {
  const id = parseGoalId(goalId);
  const linkedProjectIds = new Set<ProjectId>();
  for (const project of projects) {
    assertValidProject(project);
    if (project.goalId === id) linkedProjectIds.add(project.id);
  }

  const groupingParentIds = new Set<TaskId>();
  for (const task of tasks) {
    assertValidTask(task);
    if (task.parentTaskId !== null) groupingParentIds.add(task.parentTaskId);
  }

  const effectiveTasks = new Map<TaskId, Task>();
  for (const task of tasks) {
    const linkedDirectly = task.goalId === id;
    const linkedThroughProject =
      task.projectId !== null && linkedProjectIds.has(task.projectId);
    if (!linkedDirectly && !linkedThroughProject) continue;
    if (task.status === 'canceled' || groupingParentIds.has(task.id)) continue;
    if (!effectiveTasks.has(task.id)) effectiveTasks.set(task.id, task);
  }

  let completedTaskCount = 0;
  for (const task of effectiveTasks.values()) {
    if (task.status === 'completed') completedTaskCount += 1;
  }
  const effectiveTaskCount = effectiveTasks.size;

  return {
    goalId: id,
    completedTaskCount,
    effectiveTaskCount,
    completionRatio:
      effectiveTaskCount === 0 ? null : completedTaskCount / effectiveTaskCount,
  };
}
