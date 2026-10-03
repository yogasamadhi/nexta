import { DomainError } from './errors';
import {
  type Instant,
  type IntegrationJobId,
  type OperationId,
  parseInstant,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type SchedulePlanId,
} from './value-objects';

export const integrationJobChannels = ['calendar', 'notification'] as const;
export type IntegrationJobChannel = (typeof integrationJobChannels)[number];

export const integrationJobStatuses = [
  'pending',
  'processing',
  'succeeded',
  'permission_required',
  'failed',
  'reconciliation_required',
  'disabled',
  'superseded',
] as const;
export type IntegrationJobStatus = (typeof integrationJobStatuses)[number];

export interface IntegrationJob {
  readonly id: IntegrationJobId;
  readonly operationId: OperationId;
  readonly targetChannel: IntegrationJobChannel;
  readonly targetEntityType: 'schedule_plan';
  readonly targetEntityId: SchedulePlanId;
  readonly desiredRevision: number;
  readonly desiredAction: 'reconcile';
  readonly status: IntegrationJobStatus;
  readonly attemptCount: number;
  readonly lastErrorCode: string | null;
  readonly automaticRetryEligible: boolean;
  readonly claimToken: string | null;
  readonly leaseExpiresAt: Instant | null;
  readonly notBefore: Instant;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateIntegrationJobFields {
  readonly id: IntegrationJobId;
  readonly operationId: OperationId;
  readonly targetChannel: IntegrationJobChannel;
  readonly targetEntityType: 'schedule_plan';
  readonly targetEntityId: SchedulePlanId;
  readonly desiredRevision: number;
  readonly desiredAction: 'reconcile';
  readonly status?: IntegrationJobStatus;
  readonly attemptCount?: number;
  readonly lastErrorCode?: string | null;
  readonly automaticRetryEligible?: boolean;
  readonly claimToken?: string | null;
  readonly leaseExpiresAt?: Instant | null;
  readonly notBefore?: Instant;
  readonly createdAt: Instant;
  readonly updatedAt?: Instant;
}

function assertMember<Value extends string>(
  value: string,
  values: readonly Value[],
  field: string,
): asserts value is Value {
  if (!values.includes(value as Value)) {
    throw new DomainError(
      'invalid_value',
      `IntegrationJob ${field} is unsupported.`,
      { field },
    );
  }
}

export function assertValidIntegrationJob(job: IntegrationJob): void {
  parseIntegrationJobId(job.id);
  parseOperationId(job.operationId);
  assertMember(job.targetChannel, integrationJobChannels, 'targetChannel');
  if (job.targetEntityType !== 'schedule_plan') {
    throw new DomainError(
      'invalid_value',
      'IntegrationJob targetEntityType is unsupported.',
      { field: 'targetEntityType' },
    );
  }
  parseSchedulePlanId(job.targetEntityId);
  requireNonNegativeInteger(job.desiredRevision, 'desiredRevision');
  if (job.desiredAction !== 'reconcile') {
    throw new DomainError(
      'invalid_value',
      'IntegrationJob desiredAction is unsupported.',
      { field: 'desiredAction' },
    );
  }
  assertMember(job.status, integrationJobStatuses, 'status');
  requireNonNegativeInteger(job.attemptCount, 'attemptCount');
  if (job.lastErrorCode !== null) {
    requireNonEmptyString(job.lastErrorCode, 'lastErrorCode');
  }
  if (typeof job.automaticRetryEligible !== 'boolean') {
    throw new DomainError(
      'invalid_value',
      'IntegrationJob automaticRetryEligible must be boolean.',
      { field: 'automaticRetryEligible' },
    );
  }
  if (
    ['pending', 'processing'].includes(job.status) &&
    !job.automaticRetryEligible
  ) {
    throw new DomainError(
      'invariant_violation',
      'Runnable IntegrationJobs must be eligible for automatic processing.',
      { field: 'automaticRetryEligible' },
    );
  }
  if (
    ['succeeded', 'permission_required', 'disabled', 'superseded'].includes(
      job.status,
    ) &&
    job.automaticRetryEligible
  ) {
    throw new DomainError(
      'invariant_violation',
      'Terminal or permission-blocked IntegrationJobs cannot auto-retry.',
      { field: 'automaticRetryEligible' },
    );
  }
  if (job.status === 'processing') {
    if (job.claimToken === null || job.leaseExpiresAt === null) {
      throw new DomainError(
        'invariant_violation',
        'A processing IntegrationJob requires a claim and lease.',
        { field: 'claimToken' },
      );
    }
    if (Date.parse(job.leaseExpiresAt) <= Date.parse(job.updatedAt)) {
      throw new DomainError(
        'invariant_violation',
        'A processing IntegrationJob lease must expire after its update time.',
        { field: 'leaseExpiresAt' },
      );
    }
  } else if (job.claimToken !== null || job.leaseExpiresAt !== null) {
    throw new DomainError(
      'invariant_violation',
      'Only a processing IntegrationJob may retain a claim or lease.',
      { field: 'claimToken' },
    );
  }
  if (job.claimToken !== null) {
    requireNonEmptyString(job.claimToken, 'claimToken');
  }
  if (job.leaseExpiresAt !== null) parseInstant(job.leaseExpiresAt);
  parseInstant(job.notBefore);
  parseInstant(job.createdAt);
  parseInstant(job.updatedAt);
}

export function createIntegrationJob(
  input: CreateIntegrationJobFields,
): IntegrationJob {
  const createdAt = parseInstant(input.createdAt);
  const job: IntegrationJob = {
    id: parseIntegrationJobId(input.id),
    operationId: parseOperationId(input.operationId),
    targetChannel: input.targetChannel,
    targetEntityType: input.targetEntityType,
    targetEntityId: parseSchedulePlanId(input.targetEntityId),
    desiredRevision: requireNonNegativeInteger(
      input.desiredRevision,
      'desiredRevision',
    ),
    desiredAction: input.desiredAction,
    status: input.status ?? 'pending',
    attemptCount: requireNonNegativeInteger(
      input.attemptCount ?? 0,
      'attemptCount',
    ),
    lastErrorCode:
      input.lastErrorCode === null || input.lastErrorCode === undefined
        ? null
        : requireNonEmptyString(input.lastErrorCode, 'lastErrorCode'),
    automaticRetryEligible:
      input.automaticRetryEligible ??
      ['pending', 'processing', 'failed'].includes(input.status ?? 'pending'),
    claimToken:
      input.claimToken === null || input.claimToken === undefined
        ? null
        : requireNonEmptyString(input.claimToken, 'claimToken'),
    leaseExpiresAt:
      input.leaseExpiresAt === null || input.leaseExpiresAt === undefined
        ? null
        : parseInstant(input.leaseExpiresAt),
    notBefore: parseInstant(input.notBefore ?? createdAt),
    createdAt,
    updatedAt: parseInstant(input.updatedAt ?? createdAt),
  };
  assertValidIntegrationJob(job);
  return job;
}

export interface ClaimIntegrationJobFields {
  readonly claimToken: string;
  readonly claimedAt: Instant;
  readonly leaseExpiresAt: Instant;
}

export function claimIntegrationJob(
  job: IntegrationJob,
  input: ClaimIntegrationJobFields,
): IntegrationJob {
  assertValidIntegrationJob(job);
  const claimedAt = parseInstant(input.claimedAt);
  const leaseExpiresAt = parseInstant(input.leaseExpiresAt);
  const expiredProcessing =
    job.status === 'processing' &&
    job.leaseExpiresAt !== null &&
    Date.parse(job.leaseExpiresAt) <= Date.parse(claimedAt);
  if (
    !['pending', 'failed', 'reconciliation_required'].includes(job.status) &&
    !expiredProcessing
  ) {
    throw new DomainError(
      'invalid_transition',
      'IntegrationJob is not eligible to be claimed.',
      { field: 'status' },
    );
  }
  if (!job.automaticRetryEligible && !expiredProcessing) {
    throw new DomainError(
      'invalid_transition',
      'IntegrationJob requires an explicit recovery action.',
      { field: 'automaticRetryEligible' },
    );
  }
  if (Date.parse(job.notBefore) > Date.parse(claimedAt)) {
    throw new DomainError(
      'invalid_transition',
      'IntegrationJob is not ready to run.',
      { field: 'notBefore' },
    );
  }
  if (Date.parse(leaseExpiresAt) <= Date.parse(claimedAt)) {
    throw new DomainError(
      'invalid_value',
      'IntegrationJob lease must expire after it is claimed.',
      { field: 'leaseExpiresAt' },
    );
  }
  const claimed: IntegrationJob = {
    ...job,
    status: 'processing',
    attemptCount: job.attemptCount + 1,
    lastErrorCode: null,
    automaticRetryEligible: true,
    claimToken: requireNonEmptyString(input.claimToken, 'claimToken'),
    leaseExpiresAt,
    updatedAt: claimedAt,
  };
  assertValidIntegrationJob(claimed);
  return claimed;
}

export interface SettleIntegrationJobFields {
  readonly claimToken: string;
  readonly attemptCount: number;
  readonly status: Exclude<IntegrationJobStatus, 'pending' | 'processing'>;
  readonly lastErrorCode?: string | null;
  readonly automaticRetryEligible?: boolean;
  readonly notBefore?: Instant;
  readonly updatedAt: Instant;
}

export function settleIntegrationJob(
  job: IntegrationJob,
  input: SettleIntegrationJobFields,
): IntegrationJob {
  assertValidIntegrationJob(job);
  if (
    job.status !== 'processing' ||
    job.claimToken !== requireNonEmptyString(input.claimToken, 'claimToken') ||
    job.attemptCount !==
      requireNonNegativeInteger(input.attemptCount, 'attemptCount')
  ) {
    throw new DomainError(
      'invalid_transition',
      'IntegrationJob claim fence no longer matches.',
      { field: 'claimToken' },
    );
  }
  const settled: IntegrationJob = {
    ...job,
    status: input.status,
    lastErrorCode:
      input.lastErrorCode === null || input.lastErrorCode === undefined
        ? null
        : requireNonEmptyString(input.lastErrorCode, 'lastErrorCode'),
    automaticRetryEligible:
      input.automaticRetryEligible ?? input.status === 'failed',
    claimToken: null,
    leaseExpiresAt: null,
    notBefore: parseInstant(input.notBefore ?? job.notBefore),
    updatedAt: parseInstant(input.updatedAt),
  };
  assertValidIntegrationJob(settled);
  return settled;
}

export function requeueClaimedIntegrationJob(
  job: IntegrationJob,
  input: Readonly<{
    claimToken: string;
    attemptCount: number;
    updatedAt: Instant;
  }>,
): IntegrationJob {
  assertValidIntegrationJob(job);
  if (
    job.status !== 'processing' ||
    job.claimToken !== requireNonEmptyString(input.claimToken, 'claimToken') ||
    job.attemptCount !==
      requireNonNegativeInteger(input.attemptCount, 'attemptCount')
  ) {
    throw new DomainError(
      'invalid_transition',
      'IntegrationJob claim fence no longer matches.',
      { field: 'claimToken' },
    );
  }
  const updatedAt = parseInstant(input.updatedAt);
  const requeued: IntegrationJob = {
    ...job,
    status: 'pending',
    lastErrorCode: null,
    automaticRetryEligible: true,
    claimToken: null,
    leaseExpiresAt: null,
    notBefore: updatedAt,
    updatedAt,
  };
  assertValidIntegrationJob(requeued);
  return requeued;
}
