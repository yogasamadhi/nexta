import {
  advancePlanRevision,
  advanceStateVersion,
  createCommittedSchedulePlan,
  createIntegrationJob,
  createTimeBlock,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
  parseTimeZoneId,
  type Instant,
  type IntegrationJob,
  type OperationId,
  type SchedulePlan,
  type ScheduleState,
  type TimeBlock,
  type TimeZoneId,
} from '@workspace/domain';

import { hashOperationParameters } from './idempotency';
import type { ApplicationTransaction, IdGenerator } from './ports';
import { dataIntegrityError, generateId } from './service-support';

export type TimeBlockMutation = Readonly<{
  before: TimeBlock;
  after: TimeBlock;
}>;

export type PreparedExecutionPlanMutation = Readonly<{
  state: ScheduleState;
  plan: SchedulePlan | null;
  jobs: readonly IntegrationJob[];
  blockChanges: readonly TimeBlockMutation[];
  calendar: 'pending' | 'synced';
  notifications: 'pending' | 'synced';
}>;

export type ExecutionPlanIdGenerators = Readonly<{
  schedulePlan: IdGenerator;
  integrationJob: IdGenerator;
}>;

function fallbackHorizon(
  now: Instant,
  changes: readonly TimeBlockMutation[],
): Readonly<{ start: Instant; end: Instant }> {
  const values = changes.flatMap((change) => [
    change.before.startAt,
    change.before.endAt,
    change.after.startAt,
    change.after.endAt,
  ]);
  const startMs = Math.min(Date.parse(now), ...values.map(Date.parse));
  const endMs = Math.max(Date.parse(now) + 1, ...values.map(Date.parse));
  return {
    start: new Date(startMs).toISOString() as Instant,
    end: new Date(endMs).toISOString() as Instant,
  };
}

/**
 * Builds the plan envelope for an observed execution mutation.
 *
 * Execution facts advance stateVersion. A changed TimeBlock additionally
 * advances planRevision and creates the same durable reconciliation jobs as a
 * scheduler/manual plan commit.
 */
export async function prepareExecutionPlanMutation(
  input: Readonly<{
    transaction: ApplicationTransaction;
    baseState: ScheduleState;
    blockChanges: readonly TimeBlockMutation[];
    now: Instant;
    timeZone: TimeZoneId;
    operationId: OperationId;
    reason: string;
    ids: ExecutionPlanIdGenerators;
  }>,
): Promise<PreparedExecutionPlanMutation> {
  if (input.blockChanges.length === 0) {
    return {
      state: advanceStateVersion(input.baseState),
      plan: null,
      jobs: [],
      blockChanges: [],
      calendar: 'synced',
      notifications: 'synced',
    };
  }

  const nextState = advanceStateVersion(advancePlanRevision(input.baseState));
  const previousPlan =
    input.baseState.planRevision === 0
      ? null
      : await input.transaction.schedulePlans.findByRevision(
          input.baseState.planRevision,
        );
  if (input.baseState.planRevision > 0 && previousPlan === null) {
    throw dataIntegrityError(
      'The current plan revision is missing its SchedulePlan.',
      input.operationId,
    );
  }
  const normalizedChanges = input.blockChanges.map((change) => ({
    before: change.before,
    after: createTimeBlock({
      ...change.after,
      planRevision: nextState.planRevision,
      updatedAt: input.now,
    }),
  }));
  const fallback = fallbackHorizon(input.now, normalizedChanges);
  const plan = createCommittedSchedulePlan({
    id: generateId(
      input.ids.schedulePlan,
      parseSchedulePlanId,
      'SchedulePlan ID',
      input.operationId,
    ),
    planRevision: nextState.planRevision,
    basedOnStateVersion: input.baseState.stateVersion,
    createdAt: input.now,
    committedAt: input.now,
    inputHash: hashOperationParameters({
      reason: input.reason,
      changes: normalizedChanges,
    }),
    schedulerVersion: 'execution-state-v1',
    policyVersion: 'explicit-execution-v1',
    timeZone: parseTimeZoneId(previousPlan?.timeZone ?? input.timeZone),
    horizonStart: previousPlan?.horizonStart ?? fallback.start,
    horizonEnd: previousPlan?.horizonEnd ?? fallback.end,
    reason: input.reason,
  });
  const jobs = (['calendar', 'notification'] as const).map((channel) =>
    createIntegrationJob({
      id: generateId(
        input.ids.integrationJob,
        parseIntegrationJobId,
        'IntegrationJob ID',
        input.operationId,
      ),
      operationId: parseOperationId(input.operationId),
      targetChannel: channel,
      targetEntityType: 'schedule_plan',
      targetEntityId: plan.id,
      desiredRevision: nextState.planRevision,
      desiredAction: 'reconcile',
      createdAt: input.now,
    }),
  );
  return {
    state: nextState,
    plan,
    jobs,
    blockChanges: normalizedChanges,
    calendar: 'pending',
    notifications: 'pending',
  };
}

export async function persistExecutionPlanMutation(
  transaction: ApplicationTransaction,
  prepared: PreparedExecutionPlanMutation,
): Promise<void> {
  if (prepared.plan !== null) {
    await transaction.schedulePlans.insert(prepared.plan);
  }
  for (const change of prepared.blockChanges) {
    await transaction.timeBlocks.update(change.after);
  }
  for (const job of prepared.jobs) {
    await transaction.integrationJobs.insert(job);
  }
  await transaction.scheduleState.update(prepared.state);
}
