import { DomainError } from './errors';
import {
  compareInstants,
  type Instant,
  parseInstant,
  parseSchedulePlanId,
  parseTimeZoneId,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requirePositiveNumber,
  type SchedulePlanId,
  type TimeZoneId,
} from './value-objects';

/** Only committed plans are business records; previews remain in memory. */
export type SchedulePlanStatus = 'committed';

export interface SchedulePlan {
  readonly id: SchedulePlanId;
  readonly planRevision: number;
  readonly basedOnStateVersion: number;
  readonly status: SchedulePlanStatus;
  readonly createdAt: Instant;
  readonly committedAt: Instant;
  readonly inputHash: string;
  readonly schedulerVersion: string;
  readonly policyVersion: string;
  readonly timeZone: TimeZoneId;
  readonly horizonStart: Instant;
  readonly horizonEnd: Instant;
  readonly reason: string;
}

export type CreateCommittedSchedulePlanFields = Omit<SchedulePlan, 'status'>;

export function assertValidSchedulePlan(plan: SchedulePlan): void {
  parseSchedulePlanId(plan.id);
  requirePositiveNumber(plan.planRevision, 'planRevision');
  if (!Number.isSafeInteger(plan.planRevision)) {
    throw new DomainError(
      'invalid_value',
      'SchedulePlan planRevision must be a positive safe integer.',
      { field: 'planRevision' },
    );
  }
  requireNonNegativeInteger(plan.basedOnStateVersion, 'basedOnStateVersion');
  if (plan.status !== 'committed') {
    throw new DomainError(
      'invalid_value',
      'Persisted SchedulePlan status must be committed.',
      { field: 'status' },
    );
  }
  parseInstant(plan.createdAt);
  parseInstant(plan.committedAt);
  requireNonEmptyString(plan.inputHash, 'inputHash');
  requireNonEmptyString(plan.schedulerVersion, 'schedulerVersion');
  requireNonEmptyString(plan.policyVersion, 'policyVersion');
  parseTimeZoneId(plan.timeZone);
  parseInstant(plan.horizonStart);
  parseInstant(plan.horizonEnd);
  if (compareInstants(plan.horizonEnd, plan.horizonStart) <= 0) {
    throw new DomainError(
      'invariant_violation',
      'SchedulePlan horizonEnd must be after horizonStart.',
      { schedulePlanId: plan.id },
    );
  }
  requireNonEmptyString(plan.reason, 'reason');
}

export function createCommittedSchedulePlan(
  input: CreateCommittedSchedulePlanFields,
): SchedulePlan {
  const plan: SchedulePlan = {
    id: parseSchedulePlanId(input.id),
    planRevision: input.planRevision,
    basedOnStateVersion: requireNonNegativeInteger(
      input.basedOnStateVersion,
      'basedOnStateVersion',
    ),
    status: 'committed',
    createdAt: parseInstant(input.createdAt),
    committedAt: parseInstant(input.committedAt),
    inputHash: requireNonEmptyString(input.inputHash, 'inputHash'),
    schedulerVersion: requireNonEmptyString(
      input.schedulerVersion,
      'schedulerVersion',
    ),
    policyVersion: requireNonEmptyString(input.policyVersion, 'policyVersion'),
    timeZone: parseTimeZoneId(input.timeZone),
    horizonStart: parseInstant(input.horizonStart),
    horizonEnd: parseInstant(input.horizonEnd),
    reason: requireNonEmptyString(input.reason, 'reason'),
  };
  assertValidSchedulePlan(plan);
  return plan;
}
