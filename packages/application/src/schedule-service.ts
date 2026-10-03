import {
  advancePlanRevision,
  advanceStateVersion,
  assertValidTask,
  assertValidTimeBlock,
  createCommittedSchedulePlan,
  createIntegrationJob,
  createScheduleState,
  createTimeBlock,
  freezeTaskBaselineEstimate,
  markTaskPlanned,
  parseInstant,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  requireNonEmptyString,
  type Instant,
  type IntegrationJob,
  type ScheduleState,
  type Task,
  type TimeBlock,
} from '@workspace/domain';
import {
  previewSchedule,
  replanSchedule,
  validateScheduleInput,
  type ExistingTimeBlock,
  type ProposedTimeBlock,
  type ScheduleInput,
  type ScheduleResult,
  type SchedulableTask,
} from '@workspace/scheduler-core';

import { ApplicationError, isApplicationError } from './errors';
import {
  canonicalizeOperationParameters,
  hashOperationParameters,
  type OperationIdentity,
} from './idempotency';
import type {
  ApplicationTransaction,
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  WriteContext,
} from './ports';
import type { SchedulePreviewStore } from './preview-store';
import type {
  IntegrationJobWakeupPort,
  PreviewExpirationPolicy,
  ScheduleSnapshotRequest,
  ScheduleTimeRange,
  SchedulingSnapshot,
  SchedulingSnapshotPort,
} from './schedule-ports';
import {
  scheduleCommitInputSchema,
  scheduleCommitResultSchema,
  schedulePreviewRequestSchema,
} from './schedule-schemas';
import type {
  IntegrationStatus,
  NormalizedSchedulePreviewRequest,
  PlanBlockCandidate,
  PlanChange,
  ScheduleCommitInput,
  ScheduleCommitResult,
  SchedulePreview,
  SchedulePreviewMode,
  SchedulePreviewRequest,
  SchedulePreviewUnscheduledTask,
  SchedulePreviewWarning,
  StoredSchedulePreview,
} from './schedule-types';
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

const COMMIT_COMMAND = 'scheduler.commit';
const SCHEDULED_BLOCK_SOURCE = 'scheduler';

export type ScheduleServiceIdGenerators = Readonly<{
  preview: IdGenerator;
  schedulePlan: IdGenerator;
  timeBlock: IdGenerator;
  integrationJob: IdGenerator;
}>;

export type ScheduleServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  snapshots: SchedulingSnapshotPort;
  previews: SchedulePreviewStore;
  expirationPolicy: PreviewExpirationPolicy;
  clock: Clock;
  ids: ScheduleServiceIdGenerators;
  integrationWakeup?: IntegrationJobWakeupPort;
}>;

type PreparedSnapshot = Readonly<{
  snapshot: SchedulingSnapshot;
  input: ScheduleInput;
  inputHash: string;
}>;

type PersistedBlockWrite = Readonly<{
  kind: PlanChange['kind'];
  before: TimeBlock | null;
  after: TimeBlock;
}>;

type PlannedTaskTransition = Readonly<{
  before: Task;
  after: Task;
}>;

type CommitOutcome = Readonly<{
  result: ScheduleCommitResult;
  newlyCommitted: boolean;
}>;

function applicationError(
  code:
    | 'validation_error'
    | 'not_found'
    | 'permission_required'
    | 'preview_not_found'
    | 'preview_expired'
    | 'plan_conflict',
  message: string,
  operationId?: string,
): ApplicationError {
  return new ApplicationError(code, message, {
    retryable: false,
    operationId,
    ...(code === 'permission_required'
      ? {
          userAction:
            'Review the preview and confirm it in the user interface.',
        }
      : {}),
  });
}

function normalizePreviewRequest(
  input: unknown,
): NormalizedSchedulePreviewRequest {
  const parsed = parseBoundaryInput(
    schedulePreviewRequestSchema,
    input,
    'Schedule preview request',
  );
  const timeRange =
    parsed.timeRange === undefined
      ? null
      : {
          start: parseInstant(parsed.timeRange.start),
          end: parseInstant(parsed.timeRange.end),
        };
  if (
    timeRange !== null &&
    Date.parse(timeRange.end) <= Date.parse(timeRange.start)
  ) {
    throw applicationError(
      'validation_error',
      'Schedule preview timeRange end must be after start.',
    );
  }
  return {
    reason: parsed.reason,
    taskIds:
      parsed.taskIds === undefined
        ? null
        : parsed.taskIds.map((taskId) => parseTaskId(taskId)),
    timeRange,
  };
}

function scheduleRequest(
  request: NormalizedSchedulePreviewRequest,
  now: Instant,
): ScheduleSnapshotRequest {
  return {
    reason: request.reason,
    taskIds: request.taskIds,
    requestedTimeRange: request.timeRange,
    now,
  };
}

function normalizedDuration(minutes: number): SchedulableTask['duration'] {
  // Domain facts allow arbitrary finite minute fractions while scheduler time
  // is millisecond based. Nearest-millisecond rounding avoids IEEE-754 residue
  // (for example 0.3 - 0.1) without inventing sub-millisecond work.
  const milliseconds = Math.round(minutes * 60_000);
  if (milliseconds <= 0) return { state: 'exhausted' };
  return { state: 'known', remainingMinutes: milliseconds / 60_000 };
}

function durationForTask(task: Task): SchedulableTask['duration'] {
  if (task.remainingDurationMinutes !== null) {
    return normalizedDuration(task.remainingDurationMinutes);
  }
  if (task.estimatedDurationMinutes !== null) {
    if (
      task.actualDurationMinutes !== null &&
      task.actualDurationMinutes >= task.estimatedDurationMinutes
    ) {
      return { state: 'exhausted' };
    }
    return normalizedDuration(
      task.estimatedDurationMinutes - (task.actualDurationMinutes ?? 0),
    );
  }
  return { state: 'missing' };
}

function toSchedulableTask(task: Task): SchedulableTask {
  return {
    id: task.id,
    priority: task.priority,
    duration: durationForTask(task),
    earliestStart: task.earliestStartAt,
    deadline: task.deadlineAt,
    splittable: task.splittable,
    minBlockMinutes: task.minBlockMinutes,
    maxBlockMinutes: task.maxBlockMinutes,
    energyDemand: task.energyDemand,
    schedulingPolicy: task.schedulingPolicy,
    // DEC-006: dependencies are not accepted in the current product boundary.
    dependencyState: 'none',
  };
}

function blockWithinHorizon(
  block: Pick<TimeBlock, 'startAt' | 'endAt'>,
  horizon: ScheduleTimeRange,
): boolean {
  return (
    Date.parse(block.startAt) >= Date.parse(horizon.start) &&
    Date.parse(block.endAt) <= Date.parse(horizon.end)
  );
}

function toExistingTimeBlock(
  block: TimeBlock,
  horizon: ScheduleTimeRange,
): ExistingTimeBlock {
  return {
    id: block.id,
    taskId: block.taskId,
    type: block.type,
    start: block.startAt,
    end: block.endAt,
    status: block.status,
    // Out-of-scope commitments are protected input: core deducts their future
    // work but cannot reinterpret this preview as authority to move them.
    locked: block.locked || !blockWithinHorizon(block, horizon),
  };
}

function sortByCanonical<Value>(values: readonly Value[]): readonly Value[] {
  return [...values].sort((left, right) => {
    const leftKey = canonicalizeOperationParameters(left);
    const rightKey = canonicalizeOperationParameters(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function materialInput(input: ScheduleInput): Omit<ScheduleInput, 'now'> {
  const { now: _now, ...material } = input;
  return {
    ...material,
    tasks: sortByCanonical(material.tasks),
    busyEvents: sortByCanonical(material.busyEvents),
    existingBlocks: sortByCanonical(material.existingBlocks),
    preferences: {
      workingWindows: sortByCanonical(material.preferences.workingWindows),
      preferredWindows: sortByCanonical(material.preferences.preferredWindows),
    },
    userModel: {
      completionRateWindows: sortByCanonical(
        material.userModel.completionRateWindows,
      ),
      recoveryPenaltyWindows: sortByCanonical(
        material.userModel.recoveryPenaltyWindows,
      ),
    },
    policy: {
      ...material.policy,
      energyMatchScores: sortByCanonical(material.policy.energyMatchScores),
    },
  };
}

function prepareSnapshot(
  snapshot: SchedulingSnapshot,
  request: NormalizedSchedulePreviewRequest,
  now: Instant,
): PreparedSnapshot {
  if (request.taskIds !== null) {
    const available = new Set(snapshot.tasks.map((task) => task.id));
    const missing = request.taskIds.find((taskId) => !available.has(taskId));
    if (missing !== undefined) {
      throw applicationError(
        'not_found',
        'A requested Task was not found in the scheduling snapshot.',
      );
    }
  }
  try {
    createScheduleState(snapshot.scheduleState);
    const timeZone = parseTimeZoneId(snapshot.timeZone);
    const horizon: ScheduleTimeRange = {
      start: parseInstant(snapshot.horizon.start),
      end: parseInstant(snapshot.horizon.end),
    };
    if (Date.parse(horizon.end) <= Date.parse(horizon.start)) {
      throw new Error('Snapshot horizon is empty or reversed.');
    }
    if (
      request.timeRange !== null &&
      (request.timeRange.start !== horizon.start ||
        request.timeRange.end !== horizon.end)
    ) {
      throw new Error('Snapshot did not honor the requested time range.');
    }
    if (snapshot.busy.capturedAt !== null) {
      parseInstant(snapshot.busy.capturedAt);
    }
    if (
      !['complete', 'partial', 'missing', 'not_configured'].includes(
        snapshot.busy.completeness,
      )
    ) {
      throw new Error('Snapshot busy completeness is invalid.');
    }
    for (const scope of snapshot.busy.scopes) {
      requireNonEmptyString(scope.provider, 'busy scope provider');
      requireNonEmptyString(scope.calendarId, 'busy scope calendarId');
      if (scope.capturedAt !== null) parseInstant(scope.capturedAt);
      if (!['complete', 'partial', 'missing'].includes(scope.completeness)) {
        throw new Error('Snapshot busy scope completeness is invalid.');
      }
    }
    for (const task of snapshot.tasks) assertValidTask(task);
    for (const block of snapshot.timeBlocks) assertValidTimeBlock(block);

    const focus =
      request.taskIds === null ? null : new Set<string>(request.taskIds);
    const tasks = snapshot.tasks
      .filter((task) => focus === null || focus.has(task.id))
      .filter(
        (task) => task.status !== 'completed' && task.status !== 'canceled',
      )
      .map(toSchedulableTask);
    const input = validateScheduleInput({
      now,
      horizon,
      timeZone,
      tasks,
      busyEvents: snapshot.busy.events,
      existingBlocks: snapshot.timeBlocks.map((block) =>
        toExistingTimeBlock(block, horizon),
      ),
      preferences: {
        workingWindows: snapshot.workingWindows,
        preferredWindows: snapshot.preferredWindows,
      },
      userModel: snapshot.userModel,
      policy: snapshot.policy,
      reason: request.reason,
    });
    return {
      snapshot,
      input,
      inputHash: hashOperationParameters(materialInput(input)),
    };
  } catch (error) {
    if (isApplicationError(error) && error.code === 'adapter_error')
      throw error;
    throw dataIntegrityError('The scheduling snapshot is invalid.');
  }
}

function calculate(
  mode: SchedulePreviewMode,
  input: ScheduleInput,
): ScheduleResult {
  try {
    return mode === 'preview' ? previewSchedule(input) : replanSchedule(input);
  } catch {
    throw dataIntegrityError('The scheduler rejected its validated snapshot.');
  }
}

function baseCandidate(
  block: TimeBlock,
  stableKey: string,
  tasksById: ReadonlyMap<string, Task>,
): PlanBlockCandidate {
  return {
    stableKey,
    timeBlockId: block.id,
    taskId: block.taskId,
    taskTitle:
      block.taskId === null
        ? null
        : (tasksById.get(block.taskId)?.title ?? null),
    type: block.type,
    startAt: block.startAt,
    endAt: block.endAt,
    status: block.status,
    locked: block.locked,
    changeReason: 'preserved_existing',
  };
}

function proposedCandidate(
  block: ProposedTimeBlock,
  tasksById: ReadonlyMap<string, Task>,
): PlanBlockCandidate {
  const taskId = block.taskId === null ? null : parseTaskId(block.taskId);
  return {
    stableKey: requireNonEmptyString(block.stableKey, 'stableKey'),
    timeBlockId:
      block.existingBlockId === null
        ? null
        : parseTimeBlockId(block.existingBlockId),
    taskId,
    taskTitle: taskId === null ? null : (tasksById.get(taskId)?.title ?? null),
    type: block.type,
    startAt: parseInstant(block.start),
    endAt: parseInstant(block.end),
    status: block.status,
    locked: block.locked,
    changeReason: block.changeReason,
  };
}

function samePlanFields(
  before: PlanBlockCandidate,
  after: PlanBlockCandidate,
): boolean {
  return (
    before.timeBlockId === after.timeBlockId &&
    before.taskId === after.taskId &&
    before.type === after.type &&
    before.startAt === after.startAt &&
    before.endAt === after.endAt &&
    before.status === after.status &&
    before.locked === after.locked
  );
}

function isFutureMutable(
  block: TimeBlock,
  now: Instant,
  horizon: ScheduleTimeRange,
): boolean {
  return (
    block.status === 'planned' &&
    !block.locked &&
    blockWithinHorizon(block, horizon) &&
    Date.parse(block.startAt) > Date.parse(now)
  );
}

function derivePlanChanges(
  snapshot: SchedulingSnapshot,
  result: ScheduleResult,
  now: Instant,
): readonly PlanChange[] {
  const tasksById = new Map<string, Task>(
    snapshot.tasks.map((task) => [task.id, task]),
  );
  const existing = new Map(
    snapshot.timeBlocks.map((block) => [block.id, block]),
  );
  if (existing.size !== snapshot.timeBlocks.length) {
    throw new Error('Snapshot contains duplicate TimeBlock IDs.');
  }
  const stableKeys = new Set<string>();
  const referenced = new Set<string>();
  const changes: PlanChange[] = [];
  const horizon: ScheduleTimeRange = {
    start: parseInstant(snapshot.horizon.start),
    end: parseInstant(snapshot.horizon.end),
  };

  for (const proposed of result.blocks) {
    const after = proposedCandidate(proposed, tasksById);
    if (stableKeys.has(after.stableKey)) {
      throw new Error('Scheduler returned duplicate stable keys.');
    }
    stableKeys.add(after.stableKey);

    if (after.timeBlockId === null) {
      if (
        after.status !== 'planned' ||
        after.locked ||
        Date.parse(after.startAt) < Date.parse(now)
      ) {
        throw new Error('Scheduler returned an invalid new block.');
      }
      changes.push({
        kind: 'create',
        stableKey: after.stableKey,
        before: null,
        after,
      });
      continue;
    }

    if (referenced.has(after.timeBlockId)) {
      throw new Error('Scheduler referenced an existing block twice.');
    }
    referenced.add(after.timeBlockId);
    const source = existing.get(after.timeBlockId);
    if (source === undefined) {
      throw new Error('Scheduler referenced an unknown existing block.');
    }
    const before = baseCandidate(source, after.stableKey, tasksById);
    if (samePlanFields(before, after)) continue;
    if (!blockWithinHorizon(source, horizon)) {
      const syntheticProtectionOnly =
        before.taskId === after.taskId &&
        before.type === after.type &&
        before.startAt === after.startAt &&
        before.endAt === after.endAt &&
        before.status === after.status &&
        !before.locked &&
        after.locked;
      if (syntheticProtectionOnly) continue;
      throw new Error('Scheduler attempted to change an out-of-scope block.');
    }
    if (!isFutureMutable(source, now, horizon)) {
      throw new Error('Scheduler attempted to change protected block history.');
    }
    if (
      after.status !== 'planned' ||
      Date.parse(after.startAt) < Date.parse(now)
    ) {
      throw new Error(
        'Scheduler moved a block into the past or changed its state.',
      );
    }
    changes.push({
      kind: 'update',
      stableKey: after.stableKey,
      timeBlockId: source.id,
      before,
      after,
    });
  }

  for (const source of snapshot.timeBlocks) {
    if (!referenced.has(source.id) && isFutureMutable(source, now, horizon)) {
      const stableKey = `removed:${source.id}`;
      const before = baseCandidate(source, stableKey, tasksById);
      changes.push({
        kind: 'cancel',
        stableKey,
        timeBlockId: source.id,
        before,
        after: {
          ...before,
          status: 'canceled',
          changeReason: 'removed_by_plan',
        },
      });
    }
  }

  return changes.sort((left, right) =>
    left.stableKey < right.stableKey
      ? -1
      : left.stableKey > right.stableKey
        ? 1
        : 0,
  );
}

function enrichUnscheduledTasks(
  snapshot: SchedulingSnapshot,
  result: ScheduleResult,
): readonly SchedulePreviewUnscheduledTask[] {
  const tasksById = new Map<string, Task>(
    snapshot.tasks.map((task) => [task.id, task]),
  );
  return result.unscheduled.map((item) => {
    const task = tasksById.get(item.taskId);
    if (task === undefined) {
      throw new Error('Scheduler returned an unknown unscheduled Task.');
    }
    return { ...item, taskTitle: task.title };
  });
}

function enrichWarnings(
  snapshot: SchedulingSnapshot,
  result: ScheduleResult,
): readonly SchedulePreviewWarning[] {
  const tasksById = new Map<string, Task>(
    snapshot.tasks.map((task) => [task.id, task]),
  );
  const blocksById = new Map<string, TimeBlock>(
    snapshot.timeBlocks.map((block) => [block.id, block]),
  );
  return result.warnings.map((warning) => {
    let taskId: string | null = null;
    if (warning.entityType === 'task') taskId = warning.entityId;
    if (warning.entityType === 'block' && warning.entityId !== null) {
      taskId = blocksById.get(warning.entityId)?.taskId ?? null;
    }
    return {
      ...warning,
      entityTitle:
        taskId === null ? null : (tasksById.get(taskId)?.title ?? null),
    };
  });
}

function earliestChangedStart(changes: readonly PlanChange[]): Instant | null {
  let earliest: Instant | null = null;
  for (const change of changes) {
    const instants =
      change.kind === 'create'
        ? [change.after.startAt]
        : [change.before.startAt, change.after.startAt];
    for (const instant of instants) {
      if (earliest === null || Date.parse(instant) < Date.parse(earliest)) {
        earliest = instant;
      }
    }
  }
  return earliest;
}

function summarizeChanges(changes: readonly PlanChange[]): string {
  const created = changes.filter((change) => change.kind === 'create').length;
  const updated = changes.filter((change) => change.kind === 'update').length;
  const canceled = changes.filter((change) => change.kind === 'cancel').length;
  return `${created} block(s) created, ${updated} updated, ${canceled} canceled.`;
}

function cappedExpiration(
  policy: PreviewExpirationPolicy,
  createdAt: Instant,
  horizon: ScheduleTimeRange,
  changes: readonly PlanChange[],
): Instant {
  const earliest = earliestChangedStart(changes);
  let requested: Instant;
  try {
    requested = parseInstant(
      policy.expirationFor({
        createdAt,
        horizon,
        earliestChangedBlockStart: earliest,
      }),
    );
    if (Date.parse(requested) <= Date.parse(createdAt)) {
      throw new Error('Expiration policy must provide a positive lifetime.');
    }
  } catch {
    throw dataIntegrityError('The preview expiration policy is invalid.');
  }
  const cap = Math.min(
    Date.parse(requested),
    Date.parse(horizon.end),
    earliest === null ? Number.POSITIVE_INFINITY : Date.parse(earliest),
  );
  if (cap <= Date.parse(createdAt)) {
    throw applicationError(
      'preview_expired',
      'The candidate has no safe commit lifetime. Choose a future scheduling window.',
    );
  }
  return parseInstant(new Date(cap).toISOString());
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return (
    canonicalizeOperationParameters(left) ===
    canonicalizeOperationParameters(right)
  );
}

function integrationStatus(job: IntegrationJob): IntegrationStatus {
  switch (job.status) {
    case 'pending':
    case 'processing':
      return 'pending';
    case 'succeeded':
      return 'synced';
    case 'permission_required':
      return 'permission_required';
    case 'disabled':
      return 'disabled';
    case 'failed':
      return 'failed';
    case 'reconciliation_required':
      return 'reconciliation_required';
    case 'superseded':
      return 'superseded';
  }
}

function planConflict(message: string, operationId: string): ApplicationError {
  return applicationError('plan_conflict', message, operationId);
}

function sameStoredBlock(left: TimeBlock, right: TimeBlock): boolean {
  return canonicalEqual(left, right);
}

function sameStoredTask(left: Task, right: Task): boolean {
  return canonicalEqual(left, right);
}

export class ScheduleService {
  readonly #unitOfWork: ApplicationUnitOfWork;
  readonly #snapshots: SchedulingSnapshotPort;
  readonly #previews: SchedulePreviewStore;
  readonly #expirationPolicy: PreviewExpirationPolicy;
  readonly #clock: Clock;
  readonly #ids: ScheduleServiceIdGenerators;
  readonly #integrationWakeup: IntegrationJobWakeupPort | undefined;

  constructor(dependencies: ScheduleServiceDependencies) {
    this.#unitOfWork = dependencies.unitOfWork;
    this.#snapshots = dependencies.snapshots;
    this.#previews = dependencies.previews;
    this.#expirationPolicy = dependencies.expirationPolicy;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#integrationWakeup = dependencies.integrationWakeup;
  }

  getPreview(previewId: string): Promise<SchedulePreview> {
    return protectApplicationCall(undefined, async () => {
      const normalized = requireNonEmptyString(previewId, 'previewId');
      const stored = this.#previews.get(normalized);
      if (stored === null) {
        throw applicationError(
          'preview_not_found',
          'Schedule preview was not found. Generate a new preview.',
        );
      }
      return stored.preview;
    });
  }

  preview(input: SchedulePreviewRequest): Promise<SchedulePreview> {
    return this.#createPreview('preview', input);
  }

  replan(input: SchedulePreviewRequest): Promise<SchedulePreview> {
    return this.#createPreview('replan', input);
  }

  #createPreview(
    mode: SchedulePreviewMode,
    rawInput: SchedulePreviewRequest,
  ): Promise<SchedulePreview> {
    return protectApplicationCall(undefined, async () => {
      const request = normalizePreviewRequest(rawInput);
      const now = readClock(this.#clock);
      const snapshot = await this.#snapshots.capture(
        scheduleRequest(request, now),
      );
      const prepared = prepareSnapshot(snapshot, request, now);
      const result = calculate(mode, prepared.input);
      let changes: readonly PlanChange[];
      let unscheduled: readonly SchedulePreviewUnscheduledTask[];
      let warnings: readonly SchedulePreviewWarning[];
      try {
        changes = derivePlanChanges(snapshot, result, now);
        unscheduled = enrichUnscheduledTasks(snapshot, result);
        warnings = enrichWarnings(snapshot, result);
      } catch {
        throw dataIntegrityError(
          'The scheduler returned an invalid review projection.',
        );
      }
      const horizon: ScheduleTimeRange = {
        start: parseInstant(prepared.input.horizon.start),
        end: parseInstant(prepared.input.horizon.end),
      };
      const expiresAt = cappedExpiration(
        this.#expirationPolicy,
        now,
        horizon,
        changes,
      );
      const previewId = generateId(
        this.#ids.preview,
        (value) => requireNonEmptyString(value, 'previewId'),
        'Preview ID',
      );
      const preview: SchedulePreview = {
        previewId,
        basedOnStateVersion: snapshot.scheduleState.stateVersion,
        basedOnPlanRevision: snapshot.scheduleState.planRevision,
        inputHash: prepared.inputHash,
        schedulerVersion: result.schedulerVersion,
        policyVersion: prepared.input.policy.policyVersion,
        createdAt: now,
        expiresAt,
        timeZone: parseTimeZoneId(prepared.input.timeZone),
        busyFreshness: {
          capturedAt: snapshot.busy.capturedAt,
          completeness: snapshot.busy.completeness,
          scopes: snapshot.busy.scopes,
        },
        changedBlocks: changes,
        unscheduled,
        warnings,
        summary: summarizeChanges(changes),
        riskAssessment: {
          autoCommitEligible: false,
          requiresExplicitConfirmation: true,
          changedBlockCount: changes.length,
          hasBlockingWarnings: result.warnings.some(
            (warning) => warning.severity === 'error',
          ),
        },
      };
      const resolvedRequest: NormalizedSchedulePreviewRequest = {
        ...request,
        timeRange: horizon,
      };
      try {
        this.#previews.put({
          preview,
          mode,
          request: resolvedRequest,
          snapshot,
          result,
        });
      } catch {
        throw dataIntegrityError(
          'The preview store rejected the generated preview.',
        );
      }
      return preview;
    });
  }

  commit(
    input: ScheduleCommitInput,
    writeContext: WriteContext,
  ): Promise<ScheduleCommitResult> {
    let suppliedOperationId: string | undefined;
    if (
      typeof writeContext === 'object' &&
      writeContext !== null &&
      'operationId' in writeContext &&
      typeof writeContext.operationId === 'string'
    ) {
      suppliedOperationId = writeContext.operationId;
    }
    return protectApplicationCall(suppliedOperationId, async () => {
      const context = parseWriteContext(writeContext);
      const parsed = parseBoundaryInput(
        scheduleCommitInputSchema,
        input,
        'Schedule commit request',
        context.operationId,
      );
      const identity = operationIdentity(context, COMMIT_COMMAND, parsed);

      const replay = await this.#unitOfWork.transaction((transaction) =>
        this.#replay(transaction, identity),
      );
      if (replay !== null) return replay;

      const stored = this.#previews.get(parsed.previewId);
      if (stored === null) {
        throw applicationError(
          'preview_not_found',
          'The schedule preview is no longer available. Generate a new preview.',
          context.operationId,
        );
      }
      if (stored.preview.previewId !== parsed.previewId) {
        throw dataIntegrityError(
          'The preview store returned a mismatched preview.',
          context.operationId,
        );
      }
      if (parsed.expectedStateVersion !== stored.preview.basedOnStateVersion) {
        throw planConflict(
          'The expected state version does not match the preview.',
          context.operationId,
        );
      }
      if (context.authority.kind !== 'user') {
        throw applicationError(
          'permission_required',
          'Schedule commit requires explicit user confirmation.',
          context.operationId,
        );
      }

      this.#assertStoredPreview(stored, context.operationId);
      if (stored.preview.changedBlocks.length === 0) {
        throw applicationError(
          'validation_error',
          'The preview contains no plan changes to commit.',
          context.operationId,
        );
      }

      const now = readClock(this.#clock, context.operationId);
      if (Date.parse(now) >= Date.parse(stored.preview.expiresAt)) {
        throw applicationError(
          'preview_expired',
          'The schedule preview has expired. Generate and review a new preview.',
          context.operationId,
        );
      }
      if (
        stored.preview.changedBlocks.some(
          (change) =>
            change.kind !== 'cancel' &&
            Date.parse(change.after.startAt) < Date.parse(now),
        )
      ) {
        throw applicationError(
          'preview_expired',
          'A changed block would start in the past. Generate a new preview.',
          context.operationId,
        );
      }

      const currentSnapshot = await this.#snapshots.capture(
        scheduleRequest(stored.request, now),
      );
      const current = prepareSnapshot(currentSnapshot, stored.request, now);
      this.#assertCurrentContext(stored, current, context.operationId);

      const outcome = await this.#unitOfWork.transaction((transaction) =>
        this.#commitTransaction(transaction, stored, identity, parsed, now),
      );
      this.#previews.delete(parsed.previewId);
      if (outcome.newlyCommitted && this.#integrationWakeup !== undefined) {
        try {
          await this.#integrationWakeup.wake(
            parseOperationId(context.operationId),
          );
        } catch {
          // Durable pending jobs are the recovery path; local commit still wins.
        }
      }
      return outcome.result;
    });
  }

  #assertStoredPreview(
    stored: StoredSchedulePreview,
    operationId: string,
  ): void {
    try {
      const prepared = prepareSnapshot(
        stored.snapshot,
        stored.request,
        stored.preview.createdAt,
      );
      const recalculated = calculate(stored.mode, prepared.input);
      const changes = derivePlanChanges(
        stored.snapshot,
        recalculated,
        stored.preview.createdAt,
      );
      if (
        prepared.inputHash !== stored.preview.inputHash ||
        stored.preview.basedOnStateVersion !==
          stored.snapshot.scheduleState.stateVersion ||
        stored.preview.basedOnPlanRevision !==
          stored.snapshot.scheduleState.planRevision ||
        stored.preview.schedulerVersion !== recalculated.schedulerVersion ||
        stored.preview.policyVersion !== prepared.input.policy.policyVersion ||
        stored.preview.timeZone !== prepared.input.timeZone ||
        !canonicalEqual(recalculated, stored.result) ||
        !canonicalEqual(changes, stored.preview.changedBlocks)
      ) {
        throw new Error('Stored preview does not match its trusted snapshot.');
      }
    } catch {
      throw dataIntegrityError(
        'The stored schedule preview failed integrity validation.',
        operationId,
      );
    }
  }

  #assertCurrentContext(
    stored: StoredSchedulePreview,
    current: PreparedSnapshot,
    operationId: string,
  ): void {
    if (
      current.snapshot.scheduleState.stateVersion !==
        stored.preview.basedOnStateVersion ||
      current.snapshot.scheduleState.planRevision !==
        stored.preview.basedOnPlanRevision ||
      current.input.policy.schedulerVersion !==
        stored.preview.schedulerVersion ||
      current.input.policy.policyVersion !== stored.preview.policyVersion ||
      current.input.timeZone !== stored.preview.timeZone ||
      current.inputHash !== stored.preview.inputHash
    ) {
      throw planConflict(
        'Scheduling inputs or versions changed after the preview.',
        operationId,
      );
    }
  }

  async #replay(
    transaction: ApplicationTransaction,
    identity: OperationIdentity,
  ): Promise<ScheduleCommitResult | null> {
    const record = await transaction.operationRecords.findById(
      parseOperationId(identity.operationId),
    );
    if (record === null) return null;
    const receipt = decodeStoredReceipt(
      record,
      identity,
      scheduleCommitResultSchema,
    );
    const jobs = await transaction.integrationJobs.listByOperationId(
      record.operationId,
    );
    if (jobs.length !== 2) {
      throw dataIntegrityError(
        'A committed schedule operation must have two integration jobs.',
        identity.operationId,
      );
    }
    const plan = await transaction.schedulePlans.findByRevision(
      receipt.planRevision,
    );
    if (plan === null) {
      throw dataIntegrityError(
        'The committed SchedulePlan is missing.',
        identity.operationId,
      );
    }
    const byChannel = new Map(jobs.map((job) => [job.targetChannel, job]));
    const calendar = byChannel.get('calendar');
    const notification = byChannel.get('notification');
    if (
      byChannel.size !== 2 ||
      calendar === undefined ||
      notification === undefined ||
      jobs.some(
        (job) =>
          job.operationId !== record.operationId ||
          job.targetEntityType !== 'schedule_plan' ||
          job.targetEntityId !== plan.id ||
          job.desiredRevision !== receipt.planRevision ||
          job.desiredAction !== 'reconcile',
      )
    ) {
      throw dataIntegrityError(
        'Schedule integration jobs do not match the committed plan.',
        identity.operationId,
      );
    }
    return {
      ...receipt,
      calendar: integrationStatus(calendar),
      notifications: integrationStatus(notification),
    };
  }

  async #commitTransaction(
    transaction: ApplicationTransaction,
    stored: StoredSchedulePreview,
    identity: OperationIdentity,
    input: ScheduleCommitInput,
    now: Instant,
  ): Promise<CommitOutcome> {
    const replay = await this.#replay(transaction, identity);
    if (replay !== null) return { result: replay, newlyCommitted: false };

    const baseState = await requireScheduleState(
      transaction,
      identity.operationId,
    );
    if (
      baseState.stateVersion !== input.expectedStateVersion ||
      baseState.stateVersion !== stored.preview.basedOnStateVersion ||
      baseState.planRevision !== stored.preview.basedOnPlanRevision
    ) {
      throw planConflict(
        'The local schedule changed before the preview could be committed.',
        identity.operationId,
      );
    }
    const currentState = advanceStateVersion(advancePlanRevision(baseState));
    const planId = generateId(
      this.#ids.schedulePlan,
      parseSchedulePlanId,
      'SchedulePlan ID',
      identity.operationId,
    );
    const plan = createCommittedSchedulePlan({
      id: planId,
      planRevision: currentState.planRevision,
      basedOnStateVersion: baseState.stateVersion,
      createdAt: stored.preview.createdAt,
      committedAt: now,
      inputHash: stored.preview.inputHash,
      schedulerVersion: stored.preview.schedulerVersion,
      policyVersion: stored.preview.policyVersion,
      timeZone: stored.preview.timeZone,
      horizonStart: parseInstant(stored.snapshot.horizon.start),
      horizonEnd: parseInstant(stored.snapshot.horizon.end),
      reason: stored.request.reason,
    });
    const writes = this.#buildBlockWrites(stored, currentState, now);
    const taskTransitions = await this.#buildTaskTransitions(
      transaction,
      stored,
      now,
      identity.operationId,
    );
    const operationId = parseOperationId(identity.operationId);
    const result: ScheduleCommitResult = {
      operationId,
      local: 'committed',
      planRevision: currentState.planRevision,
      stateVersion: currentState.stateVersion,
      calendar: 'pending',
      notifications: 'pending',
    };
    const calendarJob = createIntegrationJob({
      id: generateId(
        this.#ids.integrationJob,
        parseIntegrationJobId,
        'IntegrationJob ID',
        identity.operationId,
      ),
      operationId,
      targetChannel: 'calendar',
      targetEntityType: 'schedule_plan',
      targetEntityId: plan.id,
      desiredRevision: currentState.planRevision,
      desiredAction: 'reconcile',
      createdAt: now,
    });
    const notificationJob = createIntegrationJob({
      id: generateId(
        this.#ids.integrationJob,
        parseIntegrationJobId,
        'IntegrationJob ID',
        identity.operationId,
      ),
      operationId,
      targetChannel: 'notification',
      targetEntityType: 'schedule_plan',
      targetEntityId: plan.id,
      desiredRevision: currentState.planRevision,
      desiredAction: 'reconcile',
      createdAt: now,
    });
    const diff = {
      schedulePlanId: plan.id,
      changes: writes.map((write) => ({
        kind: write.kind,
        before: write.before,
        after: write.after,
      })),
      taskTransitions,
    };

    // Operation first because IntegrationJob rows reference it. Everything is
    // still rolled back together if a later write fails.
    await transaction.operationRecords.insert(
      buildOperationRecord(
        identity,
        result,
        baseState,
        currentState,
        now,
        diff,
      ),
    );
    await transaction.schedulePlans.insert(plan);
    for (const write of writes) {
      if (write.before === null) {
        await transaction.timeBlocks.insert(write.after);
        continue;
      }
      const current = await transaction.timeBlocks.findById(write.before.id);
      if (current === null || !sameStoredBlock(current, write.before)) {
        throw planConflict(
          'A TimeBlock changed before the plan was committed.',
          identity.operationId,
        );
      }
      await transaction.timeBlocks.update(write.after);
    }
    for (const transition of taskTransitions) {
      await transaction.tasks.update(transition.after);
    }
    await transaction.integrationJobs.insert(calendarJob);
    await transaction.integrationJobs.insert(notificationJob);
    await transaction.scheduleState.update(currentState);
    return { result, newlyCommitted: true };
  }

  async #buildTaskTransitions(
    transaction: ApplicationTransaction,
    stored: StoredSchedulePreview,
    now: Instant,
    operationId: string,
  ): Promise<readonly PlannedTaskTransition[]> {
    const tasksWithFutureBlocks = new Set(
      stored.result.blocks
        .filter(
          (block) =>
            block.type === 'task' &&
            block.taskId !== null &&
            block.status === 'planned' &&
            Date.parse(block.start) > Date.parse(now),
        )
        .map((block) => block.taskId as string),
    );
    const transitions: PlannedTaskTransition[] = [];
    for (const trusted of stored.snapshot.tasks) {
      if (
        trusted.status !== 'inbox' ||
        !tasksWithFutureBlocks.has(trusted.id)
      ) {
        continue;
      }
      const current = await transaction.tasks.findById(trusted.id);
      if (current === null || !sameStoredTask(current, trusted)) {
        throw planConflict(
          'A Task changed before its scheduled plan was committed.',
          operationId,
        );
      }
      const frozen = freezeTaskBaselineEstimate(current, now);
      transitions.push({
        before: current,
        after: markTaskPlanned(frozen, now),
      });
    }
    return transitions;
  }

  #buildBlockWrites(
    stored: StoredSchedulePreview,
    currentState: ScheduleState,
    now: Instant,
  ): readonly PersistedBlockWrite[] {
    const existing = new Map(
      stored.snapshot.timeBlocks.map((block) => [block.id, block]),
    );
    return stored.preview.changedBlocks.map((change) => {
      if (change.kind === 'create') {
        return {
          kind: change.kind,
          before: null,
          after: createTimeBlock({
            id: generateId(
              this.#ids.timeBlock,
              parseTimeBlockId,
              'TimeBlock ID',
            ),
            taskId: change.after.taskId,
            type: change.after.type,
            startAt: change.after.startAt,
            endAt: change.after.endAt,
            status: change.after.status,
            source: SCHEDULED_BLOCK_SOURCE,
            locked: change.after.locked,
            planRevision: currentState.planRevision,
            createdAt: now,
          }),
        };
      }
      const before = existing.get(change.timeBlockId);
      if (before === undefined) {
        throw dataIntegrityError('A preview TimeBlock snapshot is missing.');
      }
      return {
        kind: change.kind,
        before,
        after: createTimeBlock({
          id: before.id,
          taskId: change.after.taskId,
          type: change.after.type,
          startAt: change.after.startAt,
          endAt: change.after.endAt,
          status: change.after.status,
          source: before.source,
          locked: change.after.locked,
          planRevision: currentState.planRevision,
          externalCalendarEventId: before.externalCalendarEventId,
          createdAt: before.createdAt,
          updatedAt: now,
        }),
      };
    });
  }
}
