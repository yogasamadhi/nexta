import { DomainError } from './errors';
import {
  compareInstants,
  type GoalId,
  type Instant,
  parseGoalId,
  parseInstant,
  parseProjectId,
  parseTaskId,
  requireNonEmptyString,
  requireNonNegativeNumber,
  requirePositiveNumber,
  type ProjectId,
  type TaskId,
  type LocalDate,
  type TimeZoneId,
  parseLocalDate,
  parseTimeZoneId,
} from './value-objects';

export const taskStatuses = [
  'inbox',
  'planned',
  'in_progress',
  'completed',
  'canceled',
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

/**
 * These values are deliberately open semantic strings. Their product-level
 * vocabularies are not yet specified by the canonical documentation.
 */
export type TaskPriority = string;
export type EnergyDemand = string;
export type TaskSchedulingPolicy = string;
export type TaskSource = string;
export type TaskCategoryKey = string;

export interface Task {
  readonly id: TaskId;
  readonly projectId: ProjectId | null;
  readonly goalId: GoalId | null;
  readonly parentTaskId: TaskId | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly estimatedDurationMinutes: number | null;
  readonly baselineEstimatedDurationMinutes: number | null;
  readonly actualDurationMinutes: number | null;
  readonly remainingDurationMinutes: number | null;
  readonly categoryKey: TaskCategoryKey | null;
  readonly earliestStartAt: Instant | null;
  readonly deadlineAt: Instant | null;
  readonly deadlineLocalDate: LocalDate | null;
  readonly deadlineTimeZone: TimeZoneId | null;
  readonly splittable: boolean;
  readonly minBlockMinutes: number | null;
  readonly maxBlockMinutes: number | null;
  readonly energyDemand: EnergyDemand | null;
  readonly schedulingPolicy: TaskSchedulingPolicy;
  readonly source: TaskSource;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly completedAt: Instant | null;
  readonly canceledAt: Instant | null;
}

export interface CreateTaskFields {
  readonly id: TaskId;
  readonly projectId?: ProjectId | null;
  readonly goalId?: GoalId | null;
  readonly parentTaskId?: TaskId | null;
  readonly title: string;
  readonly description?: string | null;
  readonly priority: string;
  readonly estimatedDurationMinutes?: number | null;
  readonly remainingDurationMinutes?: number | null;
  readonly categoryKey?: string | null;
  readonly earliestStartAt?: Instant | null;
  readonly deadlineAt?: Instant | null;
  readonly deadlineLocalDate?: LocalDate | null;
  readonly deadlineTimeZone?: TimeZoneId | null;
  readonly splittable: boolean;
  readonly minBlockMinutes?: number | null;
  readonly maxBlockMinutes?: number | null;
  readonly energyDemand?: string | null;
  readonly schedulingPolicy: string;
  readonly source: string;
  readonly createdAt: Instant;
}

/**
 * Ordinary edits cannot express lifecycle/evidence fields. Runtime checks in
 * `updateTask` also reject attempts from untyped JavaScript callers.
 */
export interface UpdateTaskFields {
  readonly projectId?: ProjectId | null;
  readonly goalId?: GoalId | null;
  readonly parentTaskId?: TaskId | null;
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: string;
  readonly estimatedDurationMinutes?: number | null;
  readonly remainingDurationMinutes?: number | null;
  readonly categoryKey?: string | null;
  readonly earliestStartAt?: Instant | null;
  readonly deadlineAt?: Instant | null;
  readonly deadlineLocalDate?: LocalDate | null;
  readonly deadlineTimeZone?: TimeZoneId | null;
  readonly splittable?: boolean;
  readonly minBlockMinutes?: number | null;
  readonly maxBlockMinutes?: number | null;
  readonly energyDemand?: string | null;
  readonly schedulingPolicy?: string;
}

export interface CompleteTaskFields {
  readonly completedAt: Instant;
  readonly actualDurationMinutes?: number | null;
}

export interface CancelTaskFields {
  readonly canceledAt: Instant;
}

const allowedUpdateFields = new Set<keyof UpdateTaskFields>([
  'projectId',
  'goalId',
  'parentTaskId',
  'title',
  'description',
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
]);

const protectedTaskFields = new Set([
  'id',
  'status',
  'source',
  'createdAt',
  'updatedAt',
  'baselineEstimatedDurationMinutes',
  'actualDurationMinutes',
  'completedAt',
  'canceledAt',
]);

function invalidTaskValue(field: string, rule: string): never {
  throw new DomainError('invalid_value', `Task ${field} ${rule}.`, { field });
}

function invalidTransition(task: Task, action: string): never {
  throw new DomainError(
    'invalid_transition',
    `Task cannot ${action} from ${task.status}.`,
    { taskId: task.id, fromStatus: task.status, action },
  );
}

function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return invalidTaskValue('description', 'must be a string or null');
  }
  if (value.trim().length === 0) return null;
  return value.trim();
}

function optionalSemanticString(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requireNonEmptyString(value, field);
}

function optionalPositiveNumber(
  value: number | null | undefined,
  field: string,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requirePositiveNumber(value, field);
}

function optionalTaskId(value: TaskId | null | undefined): TaskId | null {
  return value === null || value === undefined ? null : parseTaskId(value);
}

function optionalGoalId(value: GoalId | null | undefined): GoalId | null {
  return value === null || value === undefined ? null : parseGoalId(value);
}

function optionalProjectId(
  value: ProjectId | null | undefined,
): ProjectId | null {
  return value === null || value === undefined ? null : parseProjectId(value);
}

function optionalInstant(value: Instant | null | undefined): Instant | null {
  return value === null || value === undefined ? null : parseInstant(value);
}

function optionalLocalDate(
  value: LocalDate | null | undefined,
): LocalDate | null {
  return value === null || value === undefined ? null : parseLocalDate(value);
}

function optionalTimeZoneId(
  value: TimeZoneId | null | undefined,
): TimeZoneId | null {
  return value === null || value === undefined ? null : parseTimeZoneId(value);
}

function assertTaskStatus(status: string): asserts status is TaskStatus {
  if (!(taskStatuses as readonly string[]).includes(status)) {
    invalidTaskValue('status', 'is unsupported');
  }
}

function assertOrdinaryPatch(patch: UpdateTaskFields): void {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    invalidTaskValue('update', 'must be an object');
  }

  for (const key of Reflect.ownKeys(patch)) {
    if (typeof key !== 'string') {
      invalidTaskValue('update', 'must not contain symbol fields');
    }
    if (protectedTaskFields.has(key)) {
      throw new DomainError(
        'invalid_transition',
        `Task ${key} cannot be changed by an ordinary update.`,
        { field: key },
      );
    }
    if (!allowedUpdateFields.has(key as keyof UpdateTaskFields)) {
      invalidTaskValue('update', `contains unsupported field ${key}`);
    }
  }
}

export function assertValidTask(task: Task): void {
  parseTaskId(task.id);
  if (task.projectId !== null) parseProjectId(task.projectId);
  if (task.goalId !== null) parseGoalId(task.goalId);
  if (task.parentTaskId !== null) parseTaskId(task.parentTaskId);
  requireNonEmptyString(task.title, 'title');
  requireNonEmptyString(task.priority, 'priority');
  requireNonEmptyString(task.schedulingPolicy, 'schedulingPolicy');
  requireNonEmptyString(task.source, 'source');
  if (task.description !== null && typeof task.description !== 'string') {
    invalidTaskValue('description', 'must be a string or null');
  }
  if (task.categoryKey !== null) {
    requireNonEmptyString(task.categoryKey, 'categoryKey');
  }
  if (task.energyDemand !== null) {
    requireNonEmptyString(task.energyDemand, 'energyDemand');
  }
  if (typeof task.splittable !== 'boolean') {
    invalidTaskValue('splittable', 'must be a boolean');
  }
  assertTaskStatus(task.status);
  parseInstant(task.createdAt);
  parseInstant(task.updatedAt);

  if (task.estimatedDurationMinutes !== null) {
    requirePositiveNumber(
      task.estimatedDurationMinutes,
      'estimatedDurationMinutes',
    );
  }
  if (task.baselineEstimatedDurationMinutes !== null) {
    requirePositiveNumber(
      task.baselineEstimatedDurationMinutes,
      'baselineEstimatedDurationMinutes',
    );
  }
  if (task.actualDurationMinutes !== null) {
    requireNonNegativeNumber(
      task.actualDurationMinutes,
      'actualDurationMinutes',
    );
  }
  if (task.remainingDurationMinutes !== null) {
    requirePositiveNumber(
      task.remainingDurationMinutes,
      'remainingDurationMinutes',
    );
  }
  if (task.minBlockMinutes !== null) {
    requirePositiveNumber(task.minBlockMinutes, 'minBlockMinutes');
  }
  if (task.maxBlockMinutes !== null) {
    requirePositiveNumber(task.maxBlockMinutes, 'maxBlockMinutes');
  }
  if (
    task.minBlockMinutes !== null &&
    task.maxBlockMinutes !== null &&
    task.minBlockMinutes > task.maxBlockMinutes
  ) {
    invalidTaskValue(
      'block duration',
      'must have minBlockMinutes less than or equal to maxBlockMinutes',
    );
  }

  if (task.earliestStartAt !== null) parseInstant(task.earliestStartAt);
  if (task.deadlineAt !== null) parseInstant(task.deadlineAt);
  if (
    task.earliestStartAt !== null &&
    task.deadlineAt !== null &&
    compareInstants(task.deadlineAt, task.earliestStartAt) < 0
  ) {
    invalidTaskValue('deadlineAt', 'must not be before earliestStartAt');
  }

  if ((task.deadlineLocalDate === null) !== (task.deadlineTimeZone === null)) {
    invalidTaskValue(
      'date-only deadline',
      'must include both deadlineLocalDate and deadlineTimeZone',
    );
  }
  if (task.deadlineLocalDate !== null) parseLocalDate(task.deadlineLocalDate);
  if (task.deadlineTimeZone !== null) parseTimeZoneId(task.deadlineTimeZone);

  if (task.parentTaskId === task.id) {
    throw new DomainError(
      'invariant_violation',
      'Task cannot be its own parent.',
      { taskId: task.id },
    );
  }

  if (task.status === 'completed') {
    if (task.completedAt === null || task.canceledAt !== null) {
      throw new DomainError(
        'invariant_violation',
        'Completed Task must have completedAt and must not have canceledAt.',
        { taskId: task.id },
      );
    }
    parseInstant(task.completedAt);
  } else if (task.completedAt !== null) {
    throw new DomainError(
      'invariant_violation',
      'Only a completed Task may have completedAt.',
      { taskId: task.id },
    );
  }

  if (task.status === 'canceled') {
    if (task.canceledAt === null || task.completedAt !== null) {
      throw new DomainError(
        'invariant_violation',
        'Canceled Task must have canceledAt and must not have completedAt.',
        { taskId: task.id },
      );
    }
    parseInstant(task.canceledAt);
  } else if (task.canceledAt !== null) {
    throw new DomainError(
      'invariant_violation',
      'Only a canceled Task may have canceledAt.',
      { taskId: task.id },
    );
  }
}

export function createTask(input: CreateTaskFields): Task {
  const task: Task = {
    id: parseTaskId(input.id),
    projectId: optionalProjectId(input.projectId),
    goalId: optionalGoalId(input.goalId),
    parentTaskId: optionalTaskId(input.parentTaskId),
    title: requireNonEmptyString(input.title, 'title'),
    description: optionalText(input.description),
    status: 'inbox',
    priority: requireNonEmptyString(input.priority, 'priority'),
    estimatedDurationMinutes: optionalPositiveNumber(
      input.estimatedDurationMinutes,
      'estimatedDurationMinutes',
    ),
    baselineEstimatedDurationMinutes: null,
    actualDurationMinutes: null,
    remainingDurationMinutes: optionalPositiveNumber(
      input.remainingDurationMinutes,
      'remainingDurationMinutes',
    ),
    categoryKey: optionalSemanticString(input.categoryKey, 'categoryKey'),
    earliestStartAt: optionalInstant(input.earliestStartAt),
    deadlineAt: optionalInstant(input.deadlineAt),
    deadlineLocalDate: optionalLocalDate(input.deadlineLocalDate),
    deadlineTimeZone: optionalTimeZoneId(input.deadlineTimeZone),
    splittable: input.splittable,
    minBlockMinutes: optionalPositiveNumber(
      input.minBlockMinutes,
      'minBlockMinutes',
    ),
    maxBlockMinutes: optionalPositiveNumber(
      input.maxBlockMinutes,
      'maxBlockMinutes',
    ),
    energyDemand: optionalSemanticString(input.energyDemand, 'energyDemand'),
    schedulingPolicy: requireNonEmptyString(
      input.schedulingPolicy,
      'schedulingPolicy',
    ),
    source: requireNonEmptyString(input.source, 'source'),
    createdAt: parseInstant(input.createdAt),
    updatedAt: parseInstant(input.createdAt),
    completedAt: null,
    canceledAt: null,
  };

  assertValidTask(task);
  return task;
}

export function updateTask(
  task: Task,
  patch: UpdateTaskFields,
  updatedAt: Instant,
): Task {
  assertValidTask(task);
  assertOrdinaryPatch(patch);
  if (task.status === 'completed' || task.status === 'canceled') {
    return invalidTransition(task, 'update');
  }

  const next: Task = {
    ...task,
    projectId:
      patch.projectId === undefined
        ? task.projectId
        : optionalProjectId(patch.projectId),
    goalId:
      patch.goalId === undefined ? task.goalId : optionalGoalId(patch.goalId),
    parentTaskId:
      patch.parentTaskId === undefined
        ? task.parentTaskId
        : optionalTaskId(patch.parentTaskId),
    title:
      patch.title === undefined
        ? task.title
        : requireNonEmptyString(patch.title, 'title'),
    description:
      patch.description === undefined
        ? task.description
        : optionalText(patch.description),
    priority:
      patch.priority === undefined
        ? task.priority
        : requireNonEmptyString(patch.priority, 'priority'),
    estimatedDurationMinutes:
      patch.estimatedDurationMinutes === undefined
        ? task.estimatedDurationMinutes
        : optionalPositiveNumber(
            patch.estimatedDurationMinutes,
            'estimatedDurationMinutes',
          ),
    remainingDurationMinutes:
      patch.remainingDurationMinutes === undefined
        ? task.remainingDurationMinutes
        : optionalPositiveNumber(
            patch.remainingDurationMinutes,
            'remainingDurationMinutes',
          ),
    categoryKey:
      patch.categoryKey === undefined
        ? task.categoryKey
        : optionalSemanticString(patch.categoryKey, 'categoryKey'),
    earliestStartAt:
      patch.earliestStartAt === undefined
        ? task.earliestStartAt
        : optionalInstant(patch.earliestStartAt),
    deadlineAt:
      patch.deadlineAt === undefined
        ? task.deadlineAt
        : optionalInstant(patch.deadlineAt),
    deadlineLocalDate:
      patch.deadlineLocalDate === undefined
        ? task.deadlineLocalDate
        : optionalLocalDate(patch.deadlineLocalDate),
    deadlineTimeZone:
      patch.deadlineTimeZone === undefined
        ? task.deadlineTimeZone
        : optionalTimeZoneId(patch.deadlineTimeZone),
    splittable:
      patch.splittable === undefined ? task.splittable : patch.splittable,
    minBlockMinutes:
      patch.minBlockMinutes === undefined
        ? task.minBlockMinutes
        : optionalPositiveNumber(patch.minBlockMinutes, 'minBlockMinutes'),
    maxBlockMinutes:
      patch.maxBlockMinutes === undefined
        ? task.maxBlockMinutes
        : optionalPositiveNumber(patch.maxBlockMinutes, 'maxBlockMinutes'),
    energyDemand:
      patch.energyDemand === undefined
        ? task.energyDemand
        : optionalSemanticString(patch.energyDemand, 'energyDemand'),
    schedulingPolicy:
      patch.schedulingPolicy === undefined
        ? task.schedulingPolicy
        : requireNonEmptyString(patch.schedulingPolicy, 'schedulingPolicy'),
    updatedAt: parseInstant(updatedAt),
  };

  assertValidTask(next);
  return next;
}

export function freezeTaskBaselineEstimate(
  task: Task,
  updatedAt: Instant,
): Task {
  assertValidTask(task);
  if (
    task.baselineEstimatedDurationMinutes !== null ||
    task.estimatedDurationMinutes === null
  ) {
    return task;
  }
  if (task.status === 'completed' || task.status === 'canceled') {
    return invalidTransition(task, 'freeze the estimate baseline');
  }

  const next: Task = {
    ...task,
    baselineEstimatedDurationMinutes: task.estimatedDurationMinutes,
    updatedAt: parseInstant(updatedAt),
  };
  assertValidTask(next);
  return next;
}

export function markTaskPlanned(task: Task, updatedAt: Instant): Task {
  assertValidTask(task);
  if (task.status !== 'inbox') {
    return invalidTransition(task, 'mark planned');
  }

  const at = parseInstant(updatedAt);
  const next: Task = {
    ...task,
    status: 'planned',
    baselineEstimatedDurationMinutes:
      task.baselineEstimatedDurationMinutes ?? task.estimatedDurationMinutes,
    updatedAt: at,
  };
  assertValidTask(next);
  return next;
}

export function startTask(task: Task, updatedAt: Instant): Task {
  assertValidTask(task);
  if (task.status !== 'inbox' && task.status !== 'planned') {
    return invalidTransition(task, 'start');
  }

  const at = parseInstant(updatedAt);
  const next: Task = {
    ...task,
    status: 'in_progress',
    baselineEstimatedDurationMinutes:
      task.baselineEstimatedDurationMinutes ?? task.estimatedDurationMinutes,
    updatedAt: at,
  };
  assertValidTask(next);
  return next;
}

export function completeTask(task: Task, input: CompleteTaskFields): Task {
  assertValidTask(task);
  if (task.status === 'completed' || task.status === 'canceled') {
    return invalidTransition(task, 'complete');
  }

  const completedAt = parseInstant(input.completedAt);
  const next: Task = {
    ...task,
    status: 'completed',
    actualDurationMinutes:
      input.actualDurationMinutes === undefined ||
      input.actualDurationMinutes === null
        ? task.actualDurationMinutes
        : requireNonNegativeNumber(
            input.actualDurationMinutes,
            'actualDurationMinutes',
          ),
    remainingDurationMinutes: null,
    completedAt,
    canceledAt: null,
    updatedAt: completedAt,
  };
  assertValidTask(next);
  return next;
}

export function applyRecordedTaskWork(
  task: Task,
  workMinutes: number,
  updatedAt: Instant,
): Task {
  assertValidTask(task);
  if (task.status === 'completed' || task.status === 'canceled') {
    return invalidTransition(task, 'record work');
  }
  const recorded = requireNonNegativeNumber(workMinutes, 'workMinutes');
  const nextActual = (task.actualDurationMinutes ?? 0) + recorded;
  const currentRemaining =
    task.remainingDurationMinutes ??
    (task.estimatedDurationMinutes === null
      ? null
      : Math.max(
          0,
          task.estimatedDurationMinutes - (task.actualDurationMinutes ?? 0),
        ));
  const nextRemaining =
    currentRemaining === null || currentRemaining - recorded <= 0
      ? null
      : currentRemaining - recorded;
  const next: Task = {
    ...task,
    status:
      task.status === 'inbox' || task.status === 'planned'
        ? 'in_progress'
        : task.status,
    baselineEstimatedDurationMinutes:
      task.baselineEstimatedDurationMinutes ?? task.estimatedDurationMinutes,
    actualDurationMinutes: nextActual,
    remainingDurationMinutes: nextRemaining,
    updatedAt: parseInstant(updatedAt),
  };
  assertValidTask(next);
  return next;
}

export function cancelTask(task: Task, input: CancelTaskFields): Task {
  assertValidTask(task);
  if (task.status === 'completed' || task.status === 'canceled') {
    return invalidTransition(task, 'cancel');
  }

  const canceledAt = parseInstant(input.canceledAt);
  const next: Task = {
    ...task,
    status: 'canceled',
    completedAt: null,
    canceledAt,
    updatedAt: canceledAt,
  };
  assertValidTask(next);
  return next;
}

export function isTerminalTask(task: Task): boolean {
  return task.status === 'completed' || task.status === 'canceled';
}

export interface TaskParentLink {
  readonly id: TaskId;
  readonly parentTaskId: TaskId | null;
}

/**
 * Validates assigning `parentId` when `ancestorIds` is the prospective
 * parent's ancestor chain. Missing-parent existence remains a repository/FK
 * concern; this function owns the cycle invariant.
 */
export function assertTaskParentAssignment(
  taskId: TaskId,
  parentId: TaskId | null,
  ancestorIds: readonly TaskId[],
): void {
  const child = parseTaskId(taskId);
  if (parentId === null) return;

  const parent = parseTaskId(parentId);
  if (child === parent || ancestorIds.some((id) => parseTaskId(id) === child)) {
    throw new DomainError(
      'invariant_violation',
      'Task parent assignment would create a cycle.',
      { taskId: child, parentTaskId: parent },
    );
  }
}

/** Detects self-links and longer cycles in a complete or partial Task graph. */
export function assertAcyclicTaskGraph(links: readonly TaskParentLink[]): void {
  const parentById = new Map<TaskId, TaskId | null>();
  for (const link of links) {
    const id = parseTaskId(link.id);
    if (parentById.has(id)) {
      throw new DomainError(
        'invariant_violation',
        'Task graph contains duplicate Task IDs.',
        { taskId: id },
      );
    }
    const parentId = optionalTaskId(link.parentTaskId);
    if (parentId === id) {
      throw new DomainError(
        'invariant_violation',
        'Task cannot be its own parent.',
        { taskId: id },
      );
    }
    parentById.set(id, parentId);
  }

  const fullyVisited = new Set<TaskId>();
  for (const startId of parentById.keys()) {
    if (fullyVisited.has(startId)) continue;

    const path = new Set<TaskId>();
    let cursor: TaskId | null | undefined = startId;
    while (
      cursor !== null &&
      cursor !== undefined &&
      !fullyVisited.has(cursor)
    ) {
      if (path.has(cursor)) {
        throw new DomainError(
          'invariant_violation',
          'Task graph contains a parent cycle.',
          { taskId: cursor },
        );
      }
      path.add(cursor);
      cursor = parentById.get(cursor);
    }

    for (const id of path) fullyVisited.add(id);
  }
}
