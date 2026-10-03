import {
  advancePlanRevision,
  advanceStateVersion,
  createCommittedSchedulePlan,
  createIntegrationJob,
  createTimeBlock,
  parseInstant,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
  parseTimeBlockId,
  parseTimeZoneId,
  requireNonEmptyString,
  type Instant,
  type ScheduleState,
  type TimeBlock,
} from '@workspace/domain';
import { z } from 'zod';

import { ApplicationError } from './errors';
import {
  canonicalizeOperationParameters,
  hashOperationParameters,
} from './idempotency';
import type {
  ApplicationTransaction,
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  WriteContext,
} from './ports';
import type {
  IntegrationJobWakeupPort,
  PreviewExpirationPolicy,
  SchedulingSnapshot,
  SchedulingSnapshotPort,
} from './schedule-ports';
import { scheduleCommitResultSchema } from './schedule-schemas';
import type { ScheduleCommitResult } from './schedule-types';
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

const adjustmentInputSchema = z
  .object({
    timeBlockId: z.string().trim().min(1),
    startAt: z.string().trim().min(1),
    endAt: z.string().trim().min(1),
  })
  .strict();

const commitInputSchema = z
  .object({
    previewId: z.string().trim().min(1),
    expectedStateVersion: z.number().int().nonnegative().safe(),
  })
  .strict();

const unlockInputSchema = z
  .object({
    timeBlockId: z.string().trim().min(1),
    expectedStateVersion: z.number().int().nonnegative().safe(),
  })
  .strict();

export type TimeBlockAdjustmentPreview = Readonly<{
  previewId: string;
  basedOnStateVersion: number;
  basedOnPlanRevision: number;
  createdAt: Instant;
  expiresAt: Instant;
  timeZone: string;
  busyFreshness: Pick<
    SchedulingSnapshot['busy'],
    'capturedAt' | 'completeness' | 'scopes'
  >;
  before: TimeBlock;
  after: TimeBlock;
}>;

type StoredAdjustment = Readonly<{
  preview: TimeBlockAdjustmentPreview;
  snapshot: SchedulingSnapshot;
}>;

function isolated<Value>(value: Value): Value {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => isolated(item))) as Value;
  }
  if (typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = isolated((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(clone) as Value;
  }
  throw new TypeError('Adjustment previews must contain only data values.');
}

export class InMemoryTimeBlockAdjustmentPreviewStore {
  readonly #entries = new Map<string, StoredAdjustment>();

  get(id: string): StoredAdjustment | null {
    const value = this.#entries.get(id);
    return value === undefined ? null : isolated(value);
  }

  put(value: StoredAdjustment): void {
    if (this.#entries.has(value.preview.previewId)) {
      throw new Error('Duplicate adjustment preview ID.');
    }
    this.#entries.set(value.preview.previewId, isolated(value));
  }

  delete(id: string): void {
    this.#entries.delete(id);
  }
}

export type TimeBlockAdjustmentServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  snapshots: SchedulingSnapshotPort;
  previews: InMemoryTimeBlockAdjustmentPreviewStore;
  expirationPolicy: PreviewExpirationPolicy;
  clock: Clock;
  ids: Readonly<{
    preview: IdGenerator;
    schedulePlan: IdGenerator;
    integrationJob: IdGenerator;
  }>;
  integrationWakeup?: IntegrationJobWakeupPort;
}>;

function error(
  code:
    | 'validation_error'
    | 'not_found'
    | 'invalid_transition'
    | 'preview_not_found'
    | 'preview_expired'
    | 'plan_conflict'
    | 'permission_required',
  message: string,
  operationId?: string,
): ApplicationError {
  return new ApplicationError(code, message, {
    retryable: false,
    operationId,
  });
}

function equal(left: unknown, right: unknown): boolean {
  return (
    canonicalizeOperationParameters(left) ===
    canonicalizeOperationParameters(right)
  );
}

function overlaps(
  left: Readonly<{ startAt: string; endAt: string }>,
  right: Readonly<{ start: string; end: string }>,
): boolean {
  return (
    Date.parse(left.startAt) < Date.parse(right.end) &&
    Date.parse(left.endAt) > Date.parse(right.start)
  );
}

function contains(
  outer: Readonly<{ start: string; end: string }>,
  inner: Readonly<{ startAt: string; endAt: string }>,
): boolean {
  return outer.start <= inner.startAt && outer.end >= inner.endAt;
}

function validateCandidate(
  snapshot: SchedulingSnapshot,
  block: TimeBlock,
  candidate: Readonly<{ startAt: Instant; endAt: Instant }>,
  now: Instant,
): void {
  if (block.status !== 'planned' || block.locked) {
    throw error(
      'invalid_transition',
      'Only an unlocked planned TimeBlock can be adjusted.',
    );
  }
  if (Date.parse(block.startAt) <= Date.parse(now)) {
    throw error('invalid_transition', 'A started or past block cannot move.');
  }
  if (
    Date.parse(candidate.endAt) <= Date.parse(candidate.startAt) ||
    Date.parse(candidate.startAt) <= Date.parse(now)
  ) {
    throw error('validation_error', 'The adjusted interval is invalid.');
  }
  const gridMs = snapshot.policy.granularityMinutes * 60_000;
  const anchorMs = Date.parse(snapshot.policy.gridAnchor);
  if (
    !Number.isSafeInteger(gridMs) ||
    gridMs <= 0 ||
    (Date.parse(candidate.startAt) - anchorMs) % gridMs !== 0 ||
    (Date.parse(candidate.endAt) - anchorMs) % gridMs !== 0
  ) {
    throw error(
      'validation_error',
      'The adjusted interval must align to the scheduling grid.',
    );
  }
  if (candidate.startAt === block.startAt && candidate.endAt === block.endAt) {
    throw error('validation_error', 'The adjustment contains no change.');
  }
  if (
    candidate.startAt < snapshot.horizon.start ||
    candidate.endAt > snapshot.horizon.end
  ) {
    throw error('validation_error', 'The adjustment is outside the horizon.');
  }
  if (!snapshot.workingWindows.some((window) => contains(window, candidate))) {
    throw error(
      'validation_error',
      'The adjusted block must fit inside working hours.',
    );
  }
  if (snapshot.busy.events.some((busy) => overlaps(candidate, busy))) {
    throw error('validation_error', 'The adjusted block overlaps busy time.');
  }
  if (
    snapshot.timeBlocks.some(
      (other) =>
        other.id !== block.id &&
        other.status !== 'canceled' &&
        other.status !== 'skipped' &&
        overlaps(candidate, { start: other.startAt, end: other.endAt }),
    )
  ) {
    throw error(
      'validation_error',
      'The adjusted block overlaps another plan block.',
    );
  }
  const task =
    block.taskId === null
      ? null
      : snapshot.tasks.find((value) => value.id === block.taskId);
  if (block.taskId !== null && task === undefined) {
    throw dataIntegrityError('The adjusted block references a missing Task.');
  }
  if (task !== null && task !== undefined) {
    const duration =
      (Date.parse(candidate.endAt) - Date.parse(candidate.startAt)) / 60_000;
    if (
      (task.earliestStartAt !== null &&
        candidate.startAt < task.earliestStartAt) ||
      (task.deadlineAt !== null && candidate.endAt > task.deadlineAt) ||
      (task.minBlockMinutes !== null && duration < task.minBlockMinutes) ||
      (task.maxBlockMinutes !== null && duration > task.maxBlockMinutes)
    ) {
      throw error(
        'validation_error',
        'The adjusted block violates its Task constraints.',
      );
    }
  }
}

export class TimeBlockAdjustmentService {
  readonly #dependencies: TimeBlockAdjustmentServiceDependencies;

  constructor(dependencies: TimeBlockAdjustmentServiceDependencies) {
    this.#dependencies = dependencies;
  }

  getTarget(timeBlockId: string): Promise<
    Readonly<{
      block: TimeBlock;
      stateVersion: number;
      planRevision: number;
    }>
  > {
    return protectApplicationCall(undefined, async () => {
      const id = parseTimeBlockId(timeBlockId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const [block, state] = await Promise.all([
          transaction.timeBlocks.findById(id),
          requireScheduleState(transaction),
        ]);
        if (block === null)
          throw error('not_found', 'TimeBlock was not found.');
        return {
          block,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
        };
      });
    });
  }

  preview(input: {
    timeBlockId: string;
    startAt: string;
    endAt: string;
  }): Promise<TimeBlockAdjustmentPreview> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        adjustmentInputSchema,
        input,
        'TimeBlock adjustment',
      );
      const now = readClock(this.#dependencies.clock);
      const startAt = parseInstant(parsed.startAt);
      const endAt = parseInstant(parsed.endAt);
      const snapshot = await this.#dependencies.snapshots.capture({
        reason: 'manual_time_block_adjustment',
        taskIds: null,
        requestedTimeRange: { start: now, end: endAt },
        now,
      });
      const id = parseTimeBlockId(parsed.timeBlockId);
      const block = snapshot.timeBlocks.find((value) => value.id === id);
      if (block === undefined)
        throw error('not_found', 'TimeBlock was not found.');
      validateCandidate(snapshot, block, { startAt, endAt }, now);
      const requestedExpiration = parseInstant(
        this.#dependencies.expirationPolicy.expirationFor({
          createdAt: now,
          horizon: {
            start: parseInstant(snapshot.horizon.start),
            end: parseInstant(snapshot.horizon.end),
          },
          earliestChangedBlockStart: startAt,
        }),
      );
      const expiresAt = parseInstant(
        new Date(
          Math.min(
            Date.parse(requestedExpiration),
            Date.parse(startAt),
            Date.parse(snapshot.horizon.end),
          ),
        ).toISOString(),
      );
      if (Date.parse(expiresAt) <= Date.parse(now)) {
        throw error('preview_expired', 'The adjustment has no safe lifetime.');
      }
      const after = createTimeBlock({
        ...block,
        startAt,
        endAt,
        locked: true,
        updatedAt: now,
      });
      const preview: TimeBlockAdjustmentPreview = {
        previewId: generateId(
          this.#dependencies.ids.preview,
          (value) => requireNonEmptyString(value, 'previewId'),
          'Adjustment preview ID',
        ),
        basedOnStateVersion: snapshot.scheduleState.stateVersion,
        basedOnPlanRevision: snapshot.scheduleState.planRevision,
        createdAt: now,
        expiresAt,
        timeZone: snapshot.timeZone,
        busyFreshness: {
          capturedAt: snapshot.busy.capturedAt,
          completeness: snapshot.busy.completeness,
          scopes: snapshot.busy.scopes,
        },
        before: block,
        after,
      };
      this.#dependencies.previews.put({ preview, snapshot });
      return isolated(preview);
    });
  }

  getPreview(previewId: string): TimeBlockAdjustmentPreview {
    const stored = this.#dependencies.previews.get(
      requireNonEmptyString(previewId, 'previewId'),
    );
    if (stored === null) {
      throw error('preview_not_found', 'Adjustment preview was not found.');
    }
    return isolated(stored.preview);
  }

  commit(
    input: Readonly<{ previewId: string; expectedStateVersion: number }>,
    context: WriteContext,
  ): Promise<ScheduleCommitResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        commitInputSchema,
        input,
        'TimeBlock adjustment commit',
        writeContext.operationId,
      );
      if (writeContext.authority.kind !== 'user') {
        throw error(
          'permission_required',
          'TimeBlock adjustment requires direct user confirmation.',
          writeContext.operationId,
        );
      }
      const identity = operationIdentity(
        writeContext,
        'time_block.adjust',
        parsed,
      );
      const replay = await this.#dependencies.unitOfWork.transaction(
        async (transaction) => {
          const record = await transaction.operationRecords.findById(
            parseOperationId(writeContext.operationId),
          );
          return record === null
            ? null
            : decodeStoredReceipt(record, identity, scheduleCommitResultSchema);
        },
      );
      if (replay !== null) return replay;
      const stored = this.#dependencies.previews.get(parsed.previewId);
      if (stored === null) {
        throw error(
          'preview_not_found',
          'Adjustment preview is no longer available.',
          writeContext.operationId,
        );
      }
      const now = readClock(this.#dependencies.clock, writeContext.operationId);
      if (
        Date.parse(now) >= Date.parse(stored.preview.expiresAt) ||
        Date.parse(stored.preview.after.startAt) <= Date.parse(now)
      ) {
        throw error(
          'preview_expired',
          'The adjustment preview expired.',
          writeContext.operationId,
        );
      }
      const result = await this.#dependencies.unitOfWork.transaction(
        (transaction) =>
          this.#commitBlock(
            transaction,
            stored.snapshot.scheduleState,
            stored.preview.before,
            stored.preview.after,
            parsed.expectedStateVersion,
            identity,
            now,
            stored.preview.timeZone,
            stored.snapshot.horizon,
            'manual_time_block_adjustment',
          ),
      );
      this.#dependencies.previews.delete(parsed.previewId);
      await this.#wake(result.operationId);
      return result;
    });
  }

  unlock(
    input: Readonly<{ timeBlockId: string; expectedStateVersion: number }>,
    context: WriteContext,
  ): Promise<ScheduleCommitResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        unlockInputSchema,
        input,
        'TimeBlock unlock',
        writeContext.operationId,
      );
      if (writeContext.authority.kind !== 'user') {
        throw error(
          'permission_required',
          'Unlock requires a direct user action.',
          writeContext.operationId,
        );
      }
      const identity = operationIdentity(
        writeContext,
        'time_block.unlock',
        parsed,
      );
      const now = readClock(this.#dependencies.clock, writeContext.operationId);
      const result = await this.#dependencies.unitOfWork.transaction(
        async (transaction) => {
          const existing = await transaction.operationRecords.findById(
            parseOperationId(writeContext.operationId),
          );
          if (existing !== null) {
            return decodeStoredReceipt(
              existing,
              identity,
              scheduleCommitResultSchema,
            );
          }
          const state = await requireScheduleState(
            transaction,
            writeContext.operationId,
          );
          const block = await transaction.timeBlocks.findById(
            parseTimeBlockId(parsed.timeBlockId),
          );
          if (block === null)
            throw error('not_found', 'TimeBlock was not found.');
          if (
            !block.locked ||
            block.status !== 'planned' ||
            Date.parse(block.startAt) <= Date.parse(now)
          ) {
            throw error(
              'invalid_transition',
              'Only a future locked planned block can be unlocked.',
            );
          }
          return this.#commitBlock(
            transaction,
            state,
            block,
            createTimeBlock({ ...block, locked: false, updatedAt: now }),
            parsed.expectedStateVersion,
            identity,
            now,
            'UTC',
            { start: block.startAt, end: block.endAt },
            'manual_time_block_unlock',
          );
        },
      );
      await this.#wake(result.operationId);
      return result;
    });
  }

  async #commitBlock(
    transaction: ApplicationTransaction,
    expectedSnapshotState: ScheduleState,
    before: TimeBlock,
    candidate: TimeBlock,
    expectedStateVersion: number,
    identity: ReturnType<typeof operationIdentity>,
    now: Instant,
    timeZone: string,
    horizon: Readonly<{ start: string; end: string }>,
    reason: string,
  ): Promise<ScheduleCommitResult> {
    const state = await requireScheduleState(transaction, identity.operationId);
    const current = await transaction.timeBlocks.findById(before.id);
    if (
      state.stateVersion !== expectedStateVersion ||
      state.stateVersion !== expectedSnapshotState.stateVersion ||
      state.planRevision !== expectedSnapshotState.planRevision ||
      current === null ||
      !equal(current, before)
    ) {
      throw error(
        'plan_conflict',
        'The plan changed before the TimeBlock operation committed.',
        identity.operationId,
      );
    }
    const next = advanceStateVersion(advancePlanRevision(state));
    const operationId = parseOperationId(identity.operationId);
    const planId = generateId(
      this.#dependencies.ids.schedulePlan,
      parseSchedulePlanId,
      'SchedulePlan ID',
      identity.operationId,
    );
    const after = createTimeBlock({
      ...candidate,
      planRevision: next.planRevision,
      updatedAt: now,
    });
    const plan = createCommittedSchedulePlan({
      id: planId,
      planRevision: next.planRevision,
      basedOnStateVersion: state.stateVersion,
      createdAt: now,
      committedAt: now,
      inputHash: hashOperationParameters({ before, after }),
      schedulerVersion: 'manual-adjustment-v1',
      policyVersion: 'explicit-user-adjustment-v1',
      timeZone: parseTimeZoneId(timeZone),
      horizonStart: parseInstant(horizon.start),
      horizonEnd: parseInstant(horizon.end),
      reason,
    });
    const result: ScheduleCommitResult = {
      operationId,
      local: 'committed',
      stateVersion: next.stateVersion,
      planRevision: next.planRevision,
      calendar: 'pending',
      notifications: 'pending',
    };
    await transaction.operationRecords.insert(
      buildOperationRecord(identity, result, state, next, now, {
        schedulePlanId: plan.id,
        changes: [{ kind: 'update', before, after }],
      }),
    );
    await transaction.schedulePlans.insert(plan);
    await transaction.timeBlocks.update(after);
    for (const channel of ['calendar', 'notification'] as const) {
      await transaction.integrationJobs.insert(
        createIntegrationJob({
          id: generateId(
            this.#dependencies.ids.integrationJob,
            parseIntegrationJobId,
            'IntegrationJob ID',
            identity.operationId,
          ),
          operationId,
          targetChannel: channel,
          targetEntityType: 'schedule_plan',
          targetEntityId: plan.id,
          desiredRevision: next.planRevision,
          desiredAction: 'reconcile',
          createdAt: now,
        }),
      );
    }
    await transaction.scheduleState.update(next);
    return result;
  }

  async #wake(operationId: string): Promise<void> {
    try {
      await this.#dependencies.integrationWakeup?.wake(
        parseOperationId(operationId),
      );
    } catch {
      // Durable jobs are the recovery source.
    }
  }
}
