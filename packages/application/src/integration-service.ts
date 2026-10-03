import {
  assertValidExternalMutationIntent,
  assertValidIntegrationJob,
  createCalendarBinding,
  createCalendarContainerBinding,
  createExternalMutationIntent,
  createNotificationBinding,
  externalMutationIntentChannel,
  parseCalendarBindingId,
  parseCalendarContainerBindingId,
  parseExternalMutationIntentId,
  parseInstant,
  parseIntegrationJobId,
  parseNotificationBindingId,
  parseOperationId,
  parseTimeBlockId,
  requeueClaimedIntegrationJob,
  requireNonEmptyString,
  settleIntegrationJob,
  type CalendarBinding,
  type CalendarContainerBinding,
  type CalendarEventMutationPayload,
  type ExternalMutationIntent,
  type Instant,
  type IntegrationJob,
  type IntegrationJobChannel,
  type IntegrationJobStatus,
  type NotificationBinding,
  type NotificationMutationPayload,
  type Task,
  type TimeBlock,
} from '@workspace/domain';
import type { z } from 'zod';

import { ApplicationError, isApplicationError } from './errors';
import { hashOperationParameters } from './idempotency';
import {
  notificationLeadMinutesPreferenceKey,
  notificationLeadMinutesPreferenceValueSchema,
} from './preference-schemas';
import type {
  AppCalendarEventInput,
  AppEventIdentity,
  AppEventReconciliation,
  CalendarEventProjection,
  CalendarPermissionState,
  CalendarProvider,
  CalendarProvisioningInput,
  CalendarRef,
  IntegrationInventoryPolicy,
  IntegrationJobLeasePolicy,
  IntegrationJobRetryPolicy,
  IntegrationProjectionContext,
  IntegrationProjectionPolicy,
  LocalNotificationInput,
  NotificationIdentity,
  NotificationPermissionState,
  NotificationProjection,
  NotificationProvider,
  NotificationReconciliation,
  OwnedCalendarEventInventoryResult,
  OwnedAppEventRef,
  OwnedNotificationInventoryResult,
  OwnedNotificationRef,
} from './integration-ports';
import {
  appEventReconciliationSchema,
  calendarEventProjectionSchema,
  calendarMutationResultSchema,
  calendarProvisioningAbsenceConfirmationSchema,
  calendarProvisioningRecoveryResultSchema,
  calendarPermissionStateSchema,
  calendarProvisioningSchema,
  externalDeletionResultSchema,
  externalEventMutationResultSchema,
  integrationTimeRangeSchema,
  notificationMutationResultSchema,
  notificationPermissionStateSchema,
  notificationProjectionSchema,
  notificationReconciliationSchema,
  ownedCalendarEventInventorySchema,
  ownedNotificationInventorySchema,
} from './integration-schemas';
import type {
  ApplicationTransaction,
  ApplicationUnitOfWork,
  IdGenerator,
  IntegrationJobClaim,
  IntegrationJobClaimFence,
  WriteContext,
} from './ports';
import type { IntegrationStatus } from './schedule-types';
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

export type IntegrationWorkerResult = Readonly<{
  channel: IntegrationJobChannel;
  jobId: string | null;
  desiredRevision: number | null;
  status:
    | 'idle'
    | 'pending'
    | 'succeeded'
    | 'permission_required'
    | 'disabled'
    | 'failed'
    | 'reconciliation_required'
    | 'superseded';
  recoveredExpiredLease: boolean;
}>;

export type IntegrationChannelState = Readonly<{
  channel: IntegrationJobChannel;
  status: IntegrationStatus | 'not_started';
  currentPlanRevision: number;
  desiredRevision: number | null;
  jobId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  automaticRetryEligible: boolean;
  notBefore: Instant | null;
  updatedAt: Instant | null;
  bindingConflictCount: number;
}>;

export type IntegrationState = Readonly<{
  planRevision: number;
  calendar: IntegrationChannelState;
  notifications: IntegrationChannelState;
}>;

export type CalendarProvisioningRecoveryResult = Readonly<{
  operationId: string;
  jobId: string;
  stateVersion: number;
  planRevision: number;
  releasedIntentId: string;
  requeuedJobCount: number;
}>;

export type CalendarProvisioningAbsenceConfirmation = Readonly<{
  jobId: string;
  /** The user checked the system calendar and verified no App calendar exists. */
  confirmedAbsentInSystemCalendar: true;
}>;

export type IntegrationServiceIdGenerators = Readonly<{
  claim: IdGenerator;
  calendarContainerBinding: IdGenerator;
  calendarBinding: IdGenerator;
  notificationBinding: IdGenerator;
  externalMutationIntent: IdGenerator;
}>;

export type IntegrationServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  calendar: CalendarProvider;
  notifications: NotificationProvider;
  projectionPolicy: IntegrationProjectionPolicy;
  inventoryPolicy: IntegrationInventoryPolicy;
  leasePolicy: IntegrationJobLeasePolicy;
  retryPolicy: IntegrationJobRetryPolicy;
  clock: Readonly<{ now(): Instant }>;
  ids: IntegrationServiceIdGenerators;
}>;

type WorkSnapshot = Readonly<{
  stateVersion: number;
  planRevision: number;
  notificationLeadMinutes: number | null;
  blocks: readonly TimeBlock[];
  tasks: ReadonlyMap<string, Task>;
  calendarBindings: readonly CalendarBinding[];
  notificationBindings: readonly NotificationBinding[];
}>;

type BindingMutation =
  | Readonly<{
      kind: 'calendar_container_upsert';
      value: CalendarContainerBinding;
    }>
  | Readonly<{ kind: 'calendar_upsert'; value: CalendarBinding }>
  | Readonly<{
      kind: 'calendar_delete';
      value: CalendarBinding;
    }>
  | Readonly<{ kind: 'notification_upsert'; value: NotificationBinding }>
  | Readonly<{
      kind: 'notification_delete';
      value: NotificationBinding;
    }>;

type SynchronizeOutcome = Readonly<{
  status: Exclude<IntegrationJobStatus, 'pending' | 'processing'>;
  lastErrorCode: string | null;
  externallyUncertain: boolean;
  mutations: readonly BindingMutation[];
}>;

type IntentRecoveryResult = SynchronizeOutcome | 'resolved' | null;

type BindingDiscoveryResult<Binding> =
  | Readonly<{ status: 'ok'; bindings: readonly Binding[] }>
  | Readonly<{ status: 'blocked'; outcome: SynchronizeOutcome }>;

function synchronizationFailure(error: unknown): SynchronizeOutcome {
  const safeReadTimeout =
    isApplicationError(error) &&
    error.code === 'provider_timeout' &&
    error.causeCategory?.endsWith('_read_timeout') === true;
  return {
    status:
      isApplicationError(error) && error.code === 'permission_required'
        ? 'permission_required'
        : safeReadTimeout
          ? 'failed'
          : 'reconciliation_required',
    lastErrorCode: isApplicationError(error) ? error.code : 'provider_unknown',
    externallyUncertain: !safeReadTimeout,
    mutations: [],
  };
}

function workerResult(
  channel: IntegrationJobChannel,
  claim: IntegrationJobClaim | null,
  status: IntegrationWorkerResult['status'],
): IntegrationWorkerResult {
  return {
    channel,
    jobId: claim?.job.id ?? null,
    desiredRevision: claim?.job.desiredRevision ?? null,
    status,
    recoveredExpiredLease: claim?.recoveredExpiredLease ?? false,
  };
}

function publicJobStatus(job: IntegrationJob): IntegrationStatus {
  if (job.status === 'succeeded') return 'synced';
  if (job.status === 'processing') return 'pending';
  return job.status;
}

function channelState(
  channel: IntegrationJobChannel,
  currentPlanRevision: number,
  job: IntegrationJob | null,
  bindingConflictCount: number,
): IntegrationChannelState {
  let status: IntegrationChannelState['status'];
  if (job === null) status = 'not_started';
  else if (job.desiredRevision < currentPlanRevision) status = 'superseded';
  else if (job.desiredRevision > currentPlanRevision) {
    status = 'reconciliation_required';
  } else status = publicJobStatus(job);
  return {
    channel,
    status,
    currentPlanRevision,
    desiredRevision: job?.desiredRevision ?? null,
    jobId: job?.id ?? null,
    attemptCount: job?.attemptCount ?? 0,
    lastErrorCode: job?.lastErrorCode ?? null,
    automaticRetryEligible: job?.automaticRetryEligible ?? false,
    notBefore: job?.notBefore ?? null,
    updatedAt: job?.updatedAt ?? null,
    bindingConflictCount,
  };
}

function providerError(channel: IntegrationJobChannel): ApplicationError {
  return new ApplicationError(
    'provider_error',
    `The ${channel} provider operation failed.`,
    { retryable: true, causeCategory: channel },
  );
}

async function providerResult<Schema extends z.ZodType>(
  channel: IntegrationJobChannel,
  call: () => Promise<unknown>,
  schema: Schema,
  label: string,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await call();
  } catch (error) {
    if (isApplicationError(error)) throw error;
    throw providerError(channel);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw dataIntegrityError(
      `The ${channel} provider returned an invalid ${label} result.`,
    );
  }
  return parsed.data;
}

function calendarIdentity(
  provider: string,
  calendarId: string,
  ownershipKey: string,
  block: Pick<TimeBlock, 'id'>,
  searchRange: Readonly<{ start: Instant; end: Instant }>,
  binding: CalendarBinding | null,
  expectedContentHash: string | null,
): AppEventIdentity {
  return {
    provider,
    calendarId,
    ownershipKey,
    timeBlockId: block.id,
    searchRange,
    expectedExternalEventId: binding?.externalEventId ?? null,
    expectedOccurrenceKey: binding?.occurrenceKey ?? null,
    expectedContentHash,
  };
}

function notificationIdentity(
  block: TimeBlock,
  type: string,
  binding: NotificationBinding | null,
  expectedContentHash: string | null,
): NotificationIdentity {
  return {
    timeBlockId: block.id,
    type,
    expectedOsNotificationId: binding?.osNotificationId ?? null,
    expectedContentHash,
  };
}

function sameCalendarRef(
  result: AppEventReconciliation,
  provider: string,
  calendarId: string,
): result is Extract<AppEventReconciliation, { status: 'found' | 'conflict' }> {
  return (
    (result.status === 'found' || result.status === 'conflict') &&
    result.ref.provider === provider &&
    result.ref.calendarId === calendarId
  );
}

function sameCalendarIdentity(
  result: AppEventReconciliation,
  identity: AppEventIdentity,
): boolean {
  if (!sameCalendarRef(result, identity.provider, identity.calendarId)) {
    return false;
  }
  if (
    identity.expectedExternalEventId !== null &&
    result.ref.externalEventId !== identity.expectedExternalEventId
  ) {
    return false;
  }
  return (
    identity.expectedExternalEventId === null ||
    result.ref.occurrenceKey === identity.expectedOccurrenceKey
  );
}

function calendarResultMatchesDesired(
  result: Extract<AppEventReconciliation, { status: 'found' | 'conflict' }>,
  identity: AppEventIdentity,
  projection: CalendarEventProjection,
  contentHash: string,
): boolean {
  return (
    sameCalendarIdentity(result, identity) &&
    result.contentHash === contentHash &&
    result.startAt === projection.startAt &&
    result.endAt === projection.endAt
  );
}

function sameNotificationIdentity(
  result: NotificationReconciliation,
  identity: NotificationIdentity,
): boolean {
  return (
    (result.status === 'found' || result.status === 'conflict') &&
    result.ref.identity.timeBlockId === identity.timeBlockId &&
    result.ref.identity.type === identity.type &&
    (identity.expectedOsNotificationId === null ||
      result.ref.osNotificationId === identity.expectedOsNotificationId)
  );
}

function notificationResultMatchesDesired(
  result: Extract<NotificationReconciliation, { status: 'found' | 'conflict' }>,
  identity: NotificationIdentity,
  projection: NotificationProjection,
  contentHash: string,
): boolean {
  return (
    sameNotificationIdentity(result, identity) &&
    result.contentHash === contentHash &&
    result.scheduledAt === projection.scheduledAt
  );
}

class IntegrationFinishConflict extends Error {
  constructor(readonly errorCode: string) {
    super(errorCode);
    this.name = 'IntegrationFinishConflict';
  }
}

function ownedCalendarRef(binding: CalendarBinding): OwnedAppEventRef {
  return {
    provider: binding.provider,
    calendarId: binding.calendarId,
    externalEventId: binding.externalEventId,
    occurrenceKey: binding.occurrenceKey,
    timeBlockId: binding.timeBlockId,
    ownershipKey: binding.ownershipKey,
    ownershipVerified: true,
    verifiedAt: binding.verifiedAt,
  };
}

function ownedNotificationRef(
  binding: NotificationBinding,
): OwnedNotificationRef {
  return {
    osNotificationId: binding.osNotificationId,
    identity: { timeBlockId: binding.timeBlockId, type: binding.type },
    identityVerified: true,
    verifiedAt: binding.verifiedAt,
  };
}

export class IntegrationService {
  readonly #unitOfWork: ApplicationUnitOfWork;
  readonly #calendar: CalendarProvider;
  readonly #notifications: NotificationProvider;
  readonly #projection: IntegrationProjectionPolicy;
  readonly #inventory: IntegrationInventoryPolicy;
  readonly #lease: IntegrationJobLeasePolicy;
  readonly #retry: IntegrationJobRetryPolicy;
  readonly #clock: Readonly<{ now(): Instant }>;
  readonly #ids: IntegrationServiceIdGenerators;

  constructor(dependencies: IntegrationServiceDependencies) {
    this.#unitOfWork = dependencies.unitOfWork;
    this.#calendar = dependencies.calendar;
    this.#notifications = dependencies.notifications;
    this.#projection = dependencies.projectionPolicy;
    this.#inventory = dependencies.inventoryPolicy;
    this.#lease = dependencies.leasePolicy;
    this.#retry = dependencies.retryPolicy;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  processNext(
    channel: IntegrationJobChannel,
  ): Promise<IntegrationWorkerResult> {
    return protectApplicationCall(undefined, async () => {
      if (channel !== 'calendar' && channel !== 'notification') {
        throw new ApplicationError(
          'validation_error',
          'Integration channel is unsupported.',
          { retryable: false },
        );
      }
      const claimedAt = readClock(this.#clock);
      let leaseExpiresAt: Instant;
      try {
        leaseExpiresAt = parseInstant(
          this.#lease.leaseExpiresAt({ claimedAt, channel }),
        );
      } catch {
        throw dataIntegrityError(
          'The IntegrationJob lease policy returned an invalid expiration.',
        );
      }
      if (Date.parse(leaseExpiresAt) <= Date.parse(claimedAt)) {
        throw dataIntegrityError(
          'The IntegrationJob lease policy returned an expired lease.',
        );
      }
      const claimToken = generateId(
        this.#ids.claim,
        (value) => requireNonEmptyString(value, 'claimToken'),
        'IntegrationJob claim token',
      );
      const claim = await this.#unitOfWork.transaction((transaction) =>
        transaction.integrationJobs.claimNext({
          channel,
          claimToken,
          claimedAt,
          leaseExpiresAt,
        }),
      );
      if (claim === null) return workerResult(channel, null, 'idle');
      this.#assertClaim(claim, channel, claimToken);

      while (true) {
        let recoveryOutcome: IntentRecoveryResult;
        try {
          recoveryOutcome = await this.#recoverExternalMutationIntent(claim);
        } catch (error) {
          recoveryOutcome = synchronizationFailure(error);
        }
        if (recoveryOutcome === 'resolved') continue;
        if (recoveryOutcome !== null) {
          return this.#finish(claim, recoveryOutcome, readClock(this.#clock));
        }
        break;
      }

      const work = await this.#readWork(claim);
      if (work === null) {
        return this.#finish(
          claim,
          {
            status: 'superseded',
            lastErrorCode: null,
            externallyUncertain: false,
            mutations: [],
          },
          readClock(this.#clock),
        );
      }

      let outcome: SynchronizeOutcome;
      try {
        outcome =
          channel === 'calendar'
            ? await this.#synchronizeCalendar(claim, work)
            : await this.#synchronizeNotifications(claim, work);
      } catch (error) {
        outcome = synchronizationFailure(error);
      }
      return this.#finish(
        claim,
        outcome,
        readClock(this.#clock),
        work.stateVersion,
      );
    });
  }

  getCurrentStatus(): Promise<IntegrationState> {
    return protectApplicationCall(undefined, async () =>
      this.#unitOfWork.transaction(async (transaction) => {
        const state = await requireScheduleState(transaction);
        const [calendarJob, notificationJob, calendarBindings, notifications] =
          await Promise.all([
            transaction.integrationJobs.findLatestByChannel('calendar'),
            transaction.integrationJobs.findLatestByChannel('notification'),
            transaction.calendarBindings.listAll(),
            transaction.notificationBindings.listAll(),
          ]);
        return {
          planRevision: state.planRevision,
          calendar: channelState(
            'calendar',
            state.planRevision,
            calendarJob,
            calendarBindings.filter((binding) => binding.status === 'conflict')
              .length,
          ),
          notifications: channelState(
            'notification',
            state.planRevision,
            notificationJob,
            notifications.filter((binding) => binding.status === 'conflict')
              .length,
          ),
        };
      }),
    );
  }

  async reconcileNotifications(
    planRevision: number,
  ): Promise<IntegrationChannelState> {
    if (!Number.isSafeInteger(planRevision) || planRevision < 0) {
      throw new ApplicationError(
        'validation_error',
        'Notification reconciliation planRevision is invalid.',
        { retryable: false },
      );
    }
    const before = await this.getCurrentStatus();
    if (before.planRevision !== planRevision) {
      throw new ApplicationError(
        'plan_conflict',
        'Notification reconciliation rejected a stale plan revision.',
        { retryable: false },
      );
    }
    await this.processNext('notification');
    const after = await this.getCurrentStatus();
    if (after.planRevision !== planRevision) {
      throw new ApplicationError(
        'plan_conflict',
        'The plan changed during notification reconciliation.',
        { retryable: false },
      );
    }
    return after.notifications;
  }

  requestNotificationPermission(): Promise<NotificationPermissionState> {
    return protectApplicationCall(undefined, async () => {
      const permission = await providerResult(
        'notification',
        () => this.#notifications.requestPermission(),
        notificationPermissionStateSchema,
        'permission request',
      );
      if (permission.status === 'granted') {
        const now = readClock(this.#clock);
        await this.#unitOfWork.transaction((transaction) =>
          transaction.integrationJobs.requeueBlockedChannel({
            channel: 'notification',
            requeuedAt: now,
            notBefore: now,
          }),
        );
      }
      return permission;
    });
  }

  getNotificationPermissionState(): Promise<NotificationPermissionState> {
    return protectApplicationCall(undefined, () =>
      providerResult(
        'notification',
        () => this.#notifications.getPermissionState(),
        notificationPermissionStateSchema,
        'permission',
      ),
    );
  }

  confirmCalendarProvisioningAbsent(
    input: CalendarProvisioningAbsenceConfirmation,
    context: WriteContext,
  ): Promise<CalendarProvisioningRecoveryResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        calendarProvisioningAbsenceConfirmationSchema,
        input,
        'Calendar provisioning absence confirmation',
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'integration.confirm_calendar_provisioning_absent',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      const parsedJobId = parseIntegrationJobId(parsed.jobId);
      return this.#unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          const replay = decodeStoredReceipt(
            stored,
            identity,
            calendarProvisioningRecoveryResultSchema,
          );
          if (replay.jobId !== parsedJobId) {
            throw dataIntegrityError(
              'Stored calendar provisioning recovery references another IntegrationJob.',
              writeContext.operationId,
            );
          }
          return replay;
        }
        if (writeContext.authority.kind !== 'user') {
          throw new ApplicationError(
            'permission_required',
            'Only a direct user who checked the system calendar may confirm that App calendar provisioning is absent.',
            { retryable: false, operationId: writeContext.operationId },
          );
        }
        const recoveredAt = readClock(this.#clock, writeContext.operationId);
        const owner = await transaction.integrationJobs.findById(parsedJobId);
        const intent =
          await transaction.externalMutationIntents.findByJobId(parsedJobId);
        if (owner === null || intent === null) {
          throw new ApplicationError(
            'not_found',
            'No unresolved calendar provisioning attempt was found.',
            { retryable: false, operationId: context.operationId },
          );
        }
        if (intent.action !== 'calendar_provision') {
          throw new ApplicationError(
            'validation_error',
            'The unresolved external mutation is not calendar provisioning.',
            { retryable: false, operationId: context.operationId },
          );
        }
        await transaction.externalMutationIntents.deleteById(intent.id);
        const jobIds = new Set([owner.id]);
        const latest =
          await transaction.integrationJobs.findLatestByChannel('calendar');
        if (latest !== null) jobIds.add(latest.id);
        let requeuedJobCount = 0;
        for (const currentJobId of jobIds) {
          if (
            await transaction.integrationJobs.requeueBlockedJob({
              jobId: currentJobId,
              channel: 'calendar',
              requeuedAt: recoveredAt,
              notBefore: recoveredAt,
            })
          ) {
            requeuedJobCount += 1;
          }
        }
        const state = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const result: CalendarProvisioningRecoveryResult = {
          operationId,
          jobId: parsedJobId,
          stateVersion: state.stateVersion,
          planRevision: state.planRevision,
          releasedIntentId: intent.id,
          requeuedJobCount,
        };
        await transaction.operationRecords.insert(
          buildOperationRecord(identity, result, state, state, recoveredAt, {
            releasedExternalMutationIntentId: intent.id,
            requeuedIntegrationJobIds: [...jobIds],
          }),
        );
        return result;
      });
    });
  }

  #assertClaim(
    claim: IntegrationJobClaim,
    channel: IntegrationJobChannel,
    claimToken: string,
  ): void {
    try {
      assertValidIntegrationJob(claim.job);
    } catch {
      throw dataIntegrityError(
        'The IntegrationJob repository returned an invalid claim.',
      );
    }
    if (
      claim.job.targetChannel !== channel ||
      claim.job.status !== 'processing' ||
      claim.job.claimToken !== claimToken ||
      claim.job.leaseExpiresAt === null ||
      typeof claim.recoveredExpiredLease !== 'boolean'
    ) {
      throw dataIntegrityError(
        'The IntegrationJob repository returned a mismatched claim.',
      );
    }
  }

  async #prepareExternalMutationIntent(
    claim: IntegrationJobClaim,
    action: ExternalMutationIntent['action'],
    payload: ExternalMutationIntent['payload'],
    preparedAt: Instant,
  ): Promise<ExternalMutationIntent> {
    const intent = createExternalMutationIntent({
      id: generateId(
        this.#ids.externalMutationIntent,
        parseExternalMutationIntentId,
        'External mutation intent ID',
      ),
      integrationJobId: claim.job.id,
      desiredRevision: claim.job.desiredRevision,
      action,
      payload,
      createdAt: preparedAt,
    });
    await this.#unitOfWork.transaction(async (transaction) => {
      const current = await transaction.integrationJobs.findById(claim.job.id);
      if (!this.#sameClaim(current, claim)) {
        throw dataIntegrityError(
          'The IntegrationJob claim changed before preparing an external mutation.',
        );
      }
      const state = await requireScheduleState(transaction);
      if (state.planRevision !== claim.job.desiredRevision) {
        throw new ApplicationError(
          'plan_conflict',
          'The schedule changed before preparing an external mutation.',
          { retryable: true },
        );
      }
      if (
        (await transaction.externalMutationIntents.findByJobId(
          claim.job.id,
        )) !== null ||
        (await transaction.externalMutationIntents.findByScopeKey(
          intent.scopeKey,
        )) !== null
      ) {
        throw dataIntegrityError(
          'The IntegrationJob already has an unresolved external mutation.',
        );
      }
      await transaction.externalMutationIntents.insert(intent);
    });
    return intent;
  }

  async #checkpointExternalMutationIntent(
    claim: IntegrationJobClaim,
    intent: ExternalMutationIntent,
    mutations: readonly BindingMutation[],
  ): Promise<void> {
    await this.#unitOfWork.transaction(async (transaction) => {
      const current = await transaction.integrationJobs.findById(claim.job.id);
      if (!this.#sameClaim(current, claim)) {
        throw dataIntegrityError(
          'The IntegrationJob claim changed before checkpointing an external mutation.',
        );
      }
      const stored = await transaction.externalMutationIntents.findByJobId(
        intent.integrationJobId,
      );
      if (
        externalMutationIntentChannel(intent) !== claim.job.targetChannel ||
        stored === null ||
        stored.id !== intent.id
      ) {
        throw dataIntegrityError(
          'The external mutation intent changed before its checkpoint.',
        );
      }
      await this.#applyMutations(transaction, mutations);
      await transaction.externalMutationIntents.deleteById(intent.id);
    });
  }

  async #recoverExternalMutationIntent(
    claim: IntegrationJobClaim,
  ): Promise<IntentRecoveryResult> {
    const recovered = await this.#unitOfWork.transaction(
      async (transaction) => {
        const intents = await transaction.externalMutationIntents.listByChannel(
          claim.job.targetChannel,
        );
        const intent = intents[0] ?? null;
        if (intent === null) return null;
        return {
          intent,
          owner: await transaction.integrationJobs.findById(
            intent.integrationJobId,
          ),
        };
      },
    );
    const intent = recovered?.intent ?? null;
    if (intent === null) return null;
    try {
      assertValidExternalMutationIntent(intent);
    } catch {
      throw dataIntegrityError(
        'The ExternalMutationIntent repository returned invalid data.',
      );
    }
    if (
      recovered?.owner === null ||
      recovered?.owner === undefined ||
      intent.desiredRevision !== recovered.owner.desiredRevision ||
      externalMutationIntentChannel(intent) !== claim.job.targetChannel
    ) {
      throw dataIntegrityError(
        'The external mutation intent does not match its IntegrationJob.',
      );
    }
    if (intent.action === 'calendar_provision') {
      return this.#uncertain('calendar_provisioning_unknown');
    }
    if (intent.action.startsWith('calendar_event_')) {
      return this.#recoverCalendarIntent(claim, intent);
    }
    return this.#recoverNotificationIntent(claim, intent);
  }

  async #recoverCalendarIntent(
    claim: IntegrationJobClaim,
    intent: ExternalMutationIntent,
  ): Promise<Exclude<IntentRecoveryResult, null>> {
    let permission: CalendarPermissionState;
    try {
      permission = await providerResult(
        'calendar',
        () => this.#calendar.getPermissionState(),
        calendarPermissionStateSchema,
        'permission',
      );
    } catch {
      return this.#uncertain('external_intent_readback_failed');
    }
    const blocked = this.#calendarPermissionOutcome(permission);
    if (blocked !== null) return blocked;
    const payload = intent.payload as CalendarEventMutationPayload;
    const identity: AppEventIdentity = {
      provider: payload.provider,
      calendarId: payload.calendarId,
      ownershipKey: payload.ownershipKey,
      timeBlockId: payload.timeBlockId,
      searchRange: {
        start: payload.searchStartAt,
        end: payload.searchEndAt,
      },
      expectedExternalEventId: payload.externalEventId,
      expectedOccurrenceKey: payload.occurrenceKey,
      expectedContentHash:
        payload.desiredContentHash ?? payload.expectedContentHash,
    };
    let reconciled: AppEventReconciliation;
    try {
      reconciled = (await providerResult(
        'calendar',
        () => this.#calendar.reconcileAppEvent(identity),
        appEventReconciliationSchema,
        'external intent reconciliation',
      )) as AppEventReconciliation;
    } catch {
      return this.#uncertain('external_intent_readback_failed');
    }
    if (reconciled.status === 'unknown') {
      return this.#uncertain('external_intent_readback_unknown');
    }
    if (reconciled.status === 'conflict') {
      return {
        status: 'reconciliation_required',
        lastErrorCode: 'external_intent_identity_conflict',
        externallyUncertain: false,
        mutations: [],
      };
    }
    if (reconciled.status === 'missing') {
      await this.#checkpointExternalMutationIntent(claim, intent, []);
      return 'resolved';
    }
    if (!sameCalendarIdentity(reconciled, identity)) {
      return this.#uncertain('external_intent_identity_mismatch');
    }
    const existing = await this.#unitOfWork.transaction(async (transaction) => {
      const container =
        await transaction.calendarContainerBindings.findByOwnership(
          payload.provider,
          payload.ownershipKey,
        );
      if (
        container === null ||
        container.calendarId !== payload.calendarId ||
        !container.ownershipVerified
      ) {
        return { containerVerified: false as const, binding: null };
      }
      return {
        containerVerified: true as const,
        binding: await transaction.calendarBindings.findByTimeBlockId(
          payload.timeBlockId,
        ),
      };
    });
    if (!existing.containerVerified) {
      return this.#uncertain('external_intent_container_missing');
    }
    const now = readClock(this.#clock);
    const binding = createCalendarBinding({
      id:
        existing.binding?.id ??
        generateId(
          this.#ids.calendarBinding,
          parseCalendarBindingId,
          'Calendar binding ID',
        ),
      timeBlockId: payload.timeBlockId,
      provider: payload.provider,
      calendarId: payload.calendarId,
      externalEventId: reconciled.ref.externalEventId,
      occurrenceKey: reconciled.ref.occurrenceKey,
      ownershipKey: payload.ownershipKey,
      ownershipVerified: true,
      appliedContentHash: reconciled.contentHash,
      appliedStartAt: reconciled.startAt,
      appliedEndAt: reconciled.endAt,
      lastAppliedRevision: intent.desiredRevision,
      status: 'pending',
      verifiedAt: now,
      createdAt: existing.binding?.createdAt ?? now,
      updatedAt: now,
    });
    await this.#checkpointExternalMutationIntent(claim, intent, [
      { kind: 'calendar_upsert', value: binding },
    ]);
    return 'resolved';
  }

  async #recoverNotificationIntent(
    claim: IntegrationJobClaim,
    intent: ExternalMutationIntent,
  ): Promise<Exclude<IntentRecoveryResult, null>> {
    let permission: NotificationPermissionState;
    try {
      permission = await providerResult(
        'notification',
        () => this.#notifications.getPermissionState(),
        notificationPermissionStateSchema,
        'permission',
      );
    } catch {
      return this.#uncertain('external_intent_readback_failed');
    }
    const blocked = this.#notificationPermissionOutcome(permission);
    if (blocked !== null) return blocked;
    const payload = intent.payload as NotificationMutationPayload;
    const identity: NotificationIdentity = {
      timeBlockId: payload.timeBlockId,
      type: payload.type,
      expectedOsNotificationId: payload.osNotificationId,
      expectedContentHash:
        payload.desiredContentHash ?? payload.expectedContentHash,
    };
    let reconciled: NotificationReconciliation;
    try {
      reconciled = (await providerResult(
        'notification',
        () => this.#notifications.reconcile(identity),
        notificationReconciliationSchema,
        'external intent reconciliation',
      )) as NotificationReconciliation;
    } catch {
      return this.#uncertain('external_intent_readback_failed');
    }
    if (reconciled.status === 'unknown') {
      return this.#uncertain('external_intent_readback_unknown');
    }
    if (reconciled.status === 'conflict') {
      return {
        status: 'reconciliation_required',
        lastErrorCode: 'external_intent_identity_conflict',
        externallyUncertain: false,
        mutations: [],
      };
    }
    if (reconciled.status === 'missing') {
      await this.#checkpointExternalMutationIntent(claim, intent, []);
      return 'resolved';
    }
    if (!sameNotificationIdentity(reconciled, identity)) {
      return this.#uncertain('external_intent_identity_mismatch');
    }
    const existing = await this.#unitOfWork.transaction((transaction) =>
      transaction.notificationBindings.findByIdentity(
        payload.timeBlockId,
        payload.type,
      ),
    );
    const currentBlock = await this.#unitOfWork.transaction((transaction) =>
      transaction.timeBlocks.findById(payload.timeBlockId),
    );
    const now = readClock(this.#clock);
    const binding = createNotificationBinding({
      id:
        existing?.id ??
        generateId(
          this.#ids.notificationBinding,
          parseNotificationBindingId,
          'Notification binding ID',
        ),
      timeBlockId: payload.timeBlockId,
      taskId: currentBlock?.taskId ?? existing?.taskId ?? null,
      osNotificationId: reconciled.ref.osNotificationId,
      type: payload.type,
      appliedContentHash: reconciled.contentHash,
      scheduledAt: reconciled.scheduledAt,
      desiredRevision: Math.max(
        intent.desiredRevision,
        claim.job.desiredRevision,
      ),
      lastAppliedRevision: intent.desiredRevision,
      status: 'pending',
      identityVerified: true,
      verifiedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await this.#checkpointExternalMutationIntent(claim, intent, [
      { kind: 'notification_upsert', value: binding },
    ]);
    return 'resolved';
  }

  async #readWork(claim: IntegrationJobClaim): Promise<WorkSnapshot | null> {
    return this.#unitOfWork.transaction(async (transaction) => {
      const currentJob = await transaction.integrationJobs.findById(
        claim.job.id,
      );
      if (!this.#sameClaim(currentJob, claim)) return null;
      const state = await requireScheduleState(transaction);
      if (state.planRevision !== claim.job.desiredRevision) return null;
      const notificationLeadPreference =
        await transaction.userPreferences.findByKey(
          notificationLeadMinutesPreferenceKey,
        );
      const parsedNotificationLead =
        notificationLeadPreference === null
          ? null
          : notificationLeadMinutesPreferenceValueSchema.safeParse(
              notificationLeadPreference.valueJson,
            );
      if (parsedNotificationLead !== null && !parsedNotificationLead.success) {
        throw dataIntegrityError(
          'The stored notification lead-time preference is invalid.',
        );
      }
      const blocks = await transaction.timeBlocks.listAll();
      const tasks = new Map<string, Task>();
      for (const block of blocks) {
        if (block.taskId === null || tasks.has(block.taskId)) continue;
        const task = await transaction.tasks.findById(block.taskId);
        if (task === null) {
          throw dataIntegrityError(
            'A TimeBlock references a missing Task during integration.',
          );
        }
        tasks.set(task.id, task);
      }
      return {
        stateVersion: state.stateVersion,
        planRevision: state.planRevision,
        notificationLeadMinutes:
          parsedNotificationLead?.data.leadMinutes ?? null,
        blocks,
        tasks,
        calendarBindings: await transaction.calendarBindings.listAll(),
        notificationBindings: await transaction.notificationBindings.listAll(),
      };
    });
  }

  #sameClaim(
    job: IntegrationJob | null,
    claim: IntegrationJobClaim,
  ): job is IntegrationJob {
    return (
      job !== null &&
      job.status === 'processing' &&
      job.claimToken === claim.job.claimToken &&
      job.attemptCount === claim.job.attemptCount
    );
  }

  #projectionContext(
    channel: IntegrationJobChannel,
    block: TimeBlock,
    work: WorkSnapshot,
    now: Instant,
  ): IntegrationProjectionContext {
    return {
      channel,
      block,
      task:
        block.taskId === null ? null : (work.tasks.get(block.taskId) ?? null),
      planRevision: work.planRevision,
      notificationLeadMinutes: work.notificationLeadMinutes,
      now,
    };
  }

  #calendarProjection(
    block: TimeBlock,
    work: WorkSnapshot,
    now: Instant,
  ): CalendarEventProjection | null {
    const parsed = calendarEventProjectionSchema.safeParse(
      this.#projection.calendarEvent(
        this.#projectionContext('calendar', block, work, now),
      ),
    );
    if (!parsed.success) {
      throw dataIntegrityError(
        'The integration projection policy returned an invalid calendar event.',
      );
    }
    return parsed.data === null
      ? null
      : {
          title: parsed.data.title,
          startAt: parseInstant(parsed.data.startAt),
          endAt: parseInstant(parsed.data.endAt),
        };
  }

  #notificationProjection(
    block: TimeBlock,
    work: WorkSnapshot,
    now: Instant,
  ): NotificationProjection | null {
    const parsed = notificationProjectionSchema.safeParse(
      this.#projection.notification(
        this.#projectionContext('notification', block, work, now),
      ),
    );
    if (!parsed.success) {
      throw dataIntegrityError(
        'The integration projection policy returned an invalid notification.',
      );
    }
    return parsed.data === null
      ? null
      : {
          title: parsed.data.title,
          body: parsed.data.body,
          scheduledAt: parseInstant(parsed.data.scheduledAt),
          type: parsed.data.type,
        };
  }

  #calendarInventoryRange(
    now: Instant,
    currentPlanRevision: number,
  ): Readonly<{ start: Instant; end: Instant }> {
    const parsed = integrationTimeRangeSchema.safeParse(
      this.#inventory.calendarRange({ now, currentPlanRevision }),
    );
    if (!parsed.success) {
      throw dataIntegrityError(
        'The integration inventory policy returned an invalid calendar range.',
      );
    }
    return {
      start: parseInstant(parsed.data.start),
      end: parseInstant(parsed.data.end),
    };
  }

  async #discoverCalendarBindings(
    _claim: IntegrationJobClaim,
    work: WorkSnapshot,
    calendar: CalendarRef,
    now: Instant,
  ): Promise<BindingDiscoveryResult<CalendarBinding>> {
    const range = this.#calendarInventoryRange(now, work.planRevision);
    const inventory = (await providerResult(
      'calendar',
      () => this.#calendar.listOwnedAppEvents({ calendar, range }),
      ownedCalendarEventInventorySchema,
      'owned event inventory',
    )) as OwnedCalendarEventInventoryResult;
    if (inventory.status === 'unknown') {
      return {
        status: 'blocked',
        outcome: this.#uncertain('calendar_inventory_unknown'),
      };
    }
    if (
      inventory.provider !== calendar.provider ||
      inventory.calendarId !== calendar.calendarId ||
      inventory.range.start !== range.start ||
      inventory.range.end !== range.end
    ) {
      throw dataIntegrityError(
        'The calendar provider returned an out-of-scope owned event inventory.',
      );
    }
    const currentBlocks = new Map(
      work.blocks.map((block) => [block.id, block]),
    );
    const existing = new Map(
      work.calendarBindings.map((binding) => [binding.timeBlockId, binding]),
    );
    const grouped = new Map<string, typeof inventory.events>();
    for (const candidate of inventory.events) {
      if (
        candidate.ref.provider !== calendar.provider ||
        candidate.ref.calendarId !== calendar.calendarId ||
        candidate.planRevision > work.planRevision
      ) {
        throw dataIntegrityError(
          'The calendar provider returned an invalid owned event candidate.',
        );
      }
      const candidates = grouped.get(candidate.timeBlockId) ?? [];
      grouped.set(candidate.timeBlockId, [...candidates, candidate]);
    }
    for (const [timeBlockId, candidates] of grouped) {
      if (candidates.length > 1) {
        return {
          status: 'blocked',
          outcome: {
            status: 'reconciliation_required',
            lastErrorCode: 'calendar_owned_marker_duplicate',
            externallyUncertain: false,
            mutations: [],
          },
        };
      }
      const parsedTimeBlockId = parseTimeBlockId(timeBlockId);
      const alreadyBound = existing.get(parsedTimeBlockId);
      if (alreadyBound !== undefined) continue;
      const currentBlock = currentBlocks.get(parsedTimeBlockId);
      // A provider marker is discoverable evidence, not write authority. Even
      // when a local block still exists, a user may have copied or forged the
      // marker. Only a Binding created from a durable mutation intent can be
      // pending/synced and authorize a later update or delete.
      if (currentBlock === undefined) continue;
      return {
        status: 'blocked',
        outcome: {
          status: 'reconciliation_required',
          lastErrorCode: 'calendar_unbound_owned_marker',
          externallyUncertain: false,
          mutations: [],
        },
      };
    }
    return { status: 'ok', bindings: work.calendarBindings };
  }

  async #discoverNotificationBindings(
    _claim: IntegrationJobClaim,
    work: WorkSnapshot,
    _now: Instant,
  ): Promise<BindingDiscoveryResult<NotificationBinding>> {
    const inventory = (await providerResult(
      'notification',
      () => this.#notifications.listOwnedScheduledNotifications(),
      ownedNotificationInventorySchema,
      'owned notification inventory',
    )) as OwnedNotificationInventoryResult;
    if (inventory.status === 'unknown') {
      return {
        status: 'blocked',
        outcome: this.#uncertain('notification_inventory_unknown'),
      };
    }
    const currentBlocks = new Map(
      work.blocks.map((block) => [block.id, block]),
    );
    const existing = new Map(
      work.notificationBindings.map((binding) => [
        JSON.stringify([binding.timeBlockId, binding.type]),
        binding,
      ]),
    );
    const grouped = new Map<string, typeof inventory.notifications>();
    for (const candidate of inventory.notifications) {
      if (candidate.planRevision > work.planRevision) {
        throw dataIntegrityError(
          'The notification provider returned a future owned marker revision.',
        );
      }
      const key = JSON.stringify([
        candidate.ref.identity.timeBlockId,
        candidate.ref.identity.type,
      ]);
      grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
    }
    for (const [key, candidates] of grouped) {
      if (candidates.length > 1) {
        return {
          status: 'blocked',
          outcome: {
            status: 'reconciliation_required',
            lastErrorCode: 'notification_owned_marker_duplicate',
            externallyUncertain: false,
            mutations: [],
          },
        };
      }
      if (existing.has(key)) continue;
      const candidate = candidates[0]!;
      const currentBlock = currentBlocks.get(
        candidate.ref.identity.timeBlockId,
      );
      if (currentBlock === undefined) continue;
      return {
        status: 'blocked',
        outcome: {
          status: 'reconciliation_required',
          lastErrorCode: 'notification_unbound_owned_marker',
          externallyUncertain: false,
          mutations: [],
        },
      };
    }
    return { status: 'ok', bindings: work.notificationBindings };
  }

  async #synchronizeCalendar(
    claim: IntegrationJobClaim,
    work: WorkSnapshot,
  ): Promise<SynchronizeOutcome> {
    const permission = await providerResult(
      'calendar',
      () => this.#calendar.getPermissionState(),
      calendarPermissionStateSchema,
      'permission',
    );
    const permissionOutcome = this.#calendarPermissionOutcome(permission);
    if (permissionOutcome !== null) return permissionOutcome;
    const now = readClock(this.#clock);
    const provisioning = this.#calendarProvisioning();
    const existingContainer = await this.#unitOfWork.transaction(
      (transaction) =>
        transaction.calendarContainerBindings.findByOwnership(
          provisioning.provider,
          provisioning.ownershipKey,
        ),
    );
    const existingRef: CalendarRef | null =
      existingContainer === null
        ? null
        : {
            provider: existingContainer.provider,
            calendarId: existingContainer.calendarId,
            ownershipKey: existingContainer.ownershipKey,
            ownershipVerified: true,
          };
    const provisioningIntent = await this.#prepareExternalMutationIntent(
      claim,
      'calendar_provision',
      {
        provider: provisioning.provider,
        ownershipKey: provisioning.ownershipKey,
        existingCalendarId: existingContainer?.calendarId ?? null,
      },
      now,
    );
    const calendarResult = await providerResult(
      'calendar',
      () =>
        this.#calendar.ensureAppCalendar({
          ...provisioning,
          existingRef,
        }),
      calendarMutationResultSchema,
      'calendar provisioning',
    );
    if (calendarResult.outcome === 'unknown') {
      return this.#uncertain('calendar_provisioning_unknown');
    }
    const calendar = calendarResult.ref as CalendarRef;
    if (
      calendar.provider !== provisioning.provider ||
      calendar.ownershipKey !== provisioning.ownershipKey ||
      (existingContainer !== null &&
        existingContainer.calendarId !== calendar.calendarId)
    ) {
      return this.#uncertain('calendar_container_conflict');
    }
    const containerMutation: BindingMutation = {
      kind: 'calendar_container_upsert',
      value: createCalendarContainerBinding({
        id:
          existingContainer?.id ??
          generateId(
            this.#ids.calendarContainerBinding,
            parseCalendarContainerBindingId,
            'Calendar container binding ID',
          ),
        provider: calendar.provider,
        calendarId: calendar.calendarId,
        ownershipKey: calendar.ownershipKey,
        ownershipVerified: true,
        status: 'synced',
        verifiedAt: now,
        createdAt: existingContainer?.createdAt ?? now,
        updatedAt: now,
      }),
    };
    await this.#checkpointExternalMutationIntent(claim, provisioningIntent, [
      containerMutation,
    ]);
    const mutations: BindingMutation[] = [];
    const discovery = await this.#discoverCalendarBindings(
      claim,
      work,
      calendar,
      now,
    );
    if (discovery.status === 'blocked') return discovery.outcome;
    const existingByBlock = new Map(
      discovery.bindings
        .filter(
          (binding) =>
            binding.provider === calendar.provider &&
            binding.ownershipKey === calendar.ownershipKey,
        )
        .map((binding) => [binding.timeBlockId, binding]),
    );
    const desiredIds = new Set<string>();
    for (const block of [...work.blocks].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const projection = this.#calendarProjection(block, work, now);
      if (projection === null) continue;
      desiredIds.add(block.id);
      const binding = existingByBlock.get(block.id) ?? null;
      const item = await this.#reconcileCalendarItem(
        claim,
        calendar,
        block,
        projection,
        binding,
        now,
      );
      mutations.push(...item.mutations);
      if (item.status !== 'succeeded') {
        return { ...item, mutations };
      }
    }
    for (const binding of existingByBlock.values()) {
      if (desiredIds.has(binding.timeBlockId)) continue;
      const item = await this.#removeCalendarItem(claim, binding, now);
      mutations.push(...item.mutations);
      if (item.status !== 'succeeded') return { ...item, mutations };
    }
    return {
      status: 'succeeded',
      lastErrorCode: null,
      externallyUncertain: false,
      mutations,
    };
  }

  #calendarPermissionOutcome(
    permission: CalendarPermissionState,
  ): SynchronizeOutcome | null {
    if (permission.write.status === 'granted') return null;
    return {
      status:
        permission.write.status === 'unavailable'
          ? 'disabled'
          : 'permission_required',
      lastErrorCode:
        permission.write.status === 'unavailable'
          ? 'calendar_unavailable'
          : 'calendar_permission_required',
      externallyUncertain: false,
      mutations: [],
    };
  }

  #calendarProvisioning(): CalendarProvisioningInput {
    const parsed = calendarProvisioningSchema.safeParse(
      this.#projection.calendarProvisioning(this.#calendar.provider),
    );
    if (!parsed.success || parsed.data.provider !== this.#calendar.provider) {
      throw dataIntegrityError(
        'The integration projection policy returned invalid calendar provisioning.',
      );
    }
    return parsed.data;
  }

  async #reconcileCalendarItem(
    claim: IntegrationJobClaim,
    calendar: CalendarRef,
    block: TimeBlock,
    projection: CalendarEventProjection,
    binding: CalendarBinding | null,
    now: Instant,
  ): Promise<SynchronizeOutcome> {
    if (binding?.status === 'conflict') {
      return {
        status: 'reconciliation_required',
        lastErrorCode: 'calendar_binding_conflict',
        externallyUncertain: false,
        mutations: [],
      };
    }
    const contentHash = hashOperationParameters({
      title: projection.title,
      startAt: projection.startAt,
      endAt: projection.endAt,
    });
    let identity = calendarIdentity(
      calendar.provider,
      calendar.calendarId,
      calendar.ownershipKey,
      block,
      binding === null
        ? { start: projection.startAt, end: projection.endAt }
        : {
            start: binding.appliedStartAt,
            end: binding.appliedEndAt,
          },
      binding,
      binding?.appliedContentHash ?? null,
    );
    let reconciled = (await providerResult(
      'calendar',
      () => this.#calendar.reconcileAppEvent(identity),
      appEventReconciliationSchema,
      'event reconciliation',
    )) as AppEventReconciliation;
    let sideEffectIntent: ExternalMutationIntent | null = null;
    if (reconciled.status === 'unknown') {
      return this.#uncertain('calendar_reconciliation_unknown');
    }
    if (
      (reconciled.status === 'found' || reconciled.status === 'conflict') &&
      !sameCalendarIdentity(reconciled, identity)
    ) {
      return this.#uncertain('calendar_reconciliation_scope_mismatch');
    }
    if (
      (reconciled.status === 'found' || reconciled.status === 'conflict') &&
      calendarResultMatchesDesired(
        reconciled,
        identity,
        projection,
        contentHash,
      )
    ) {
      return this.#resolveDesiredCalendarResult(
        claim,
        calendar,
        block,
        binding,
        reconciled,
        contentHash,
        projection,
        now,
      );
    }
    if (reconciled.status === 'conflict') {
      return this.#calendarConflict(
        claim,
        calendar,
        block,
        binding,
        reconciled,
        now,
      );
    }
    if (reconciled.status === 'missing' && binding !== null) {
      const rangeMoved =
        binding.appliedStartAt !== projection.startAt ||
        binding.appliedEndAt !== projection.endAt;
      if (!rangeMoved) return this.#calendarMissingConflict(binding, now);
      identity = {
        ...identity,
        searchRange: { start: projection.startAt, end: projection.endAt },
        expectedContentHash: contentHash,
      };
      reconciled = (await providerResult(
        'calendar',
        () => this.#calendar.reconcileAppEvent(identity),
        appEventReconciliationSchema,
        'moved event reconciliation',
      )) as AppEventReconciliation;
      if (reconciled.status === 'unknown') {
        return this.#uncertain('calendar_reconciliation_unknown');
      }
      if (
        (reconciled.status === 'found' || reconciled.status === 'conflict') &&
        !sameCalendarIdentity(reconciled, identity)
      ) {
        return this.#uncertain('calendar_reconciliation_scope_mismatch');
      }
      if (
        (reconciled.status === 'found' || reconciled.status === 'conflict') &&
        calendarResultMatchesDesired(
          reconciled,
          identity,
          projection,
          contentHash,
        )
      ) {
        return this.#resolveDesiredCalendarResult(
          claim,
          calendar,
          block,
          binding,
          reconciled,
          contentHash,
          projection,
          now,
        );
      }
      if (reconciled.status === 'found' || reconciled.status === 'conflict') {
        return this.#calendarConflict(
          claim,
          calendar,
          block,
          binding,
          reconciled,
          now,
        );
      }
      return this.#calendarMissingConflict(binding, now);
    }
    if (reconciled.status === 'found') {
      if (
        binding === null ||
        reconciled.contentHash !== binding.appliedContentHash
      ) {
        return this.#calendarConflict(
          claim,
          calendar,
          block,
          binding,
          reconciled,
          now,
        );
      }
      sideEffectIntent = await this.#prepareExternalMutationIntent(
        claim,
        'calendar_event_update',
        {
          provider: calendar.provider,
          calendarId: calendar.calendarId,
          ownershipKey: calendar.ownershipKey,
          timeBlockId: block.id,
          searchStartAt: binding.appliedStartAt,
          searchEndAt: binding.appliedEndAt,
          externalEventId: binding.externalEventId,
          occurrenceKey: binding.occurrenceKey,
          expectedContentHash: binding.appliedContentHash,
          desiredContentHash: contentHash,
          desiredStartAt: projection.startAt,
          desiredEndAt: projection.endAt,
        },
        now,
      );
      const update = await providerResult(
        'calendar',
        () =>
          this.#calendar.updateAppEvent(ownedCalendarRef(binding), {
            title: projection.title,
            startAt: projection.startAt,
            endAt: projection.endAt,
            contentHash,
            planRevision: claim.job.desiredRevision,
          }),
        externalEventMutationResultSchema,
        'event update',
      );
      if (update.outcome === 'unknown') {
        return this.#uncertain('calendar_update_unknown');
      }
      identity = {
        ...identity,
        searchRange: { start: projection.startAt, end: projection.endAt },
        expectedExternalEventId: update.ref.externalEventId,
        expectedOccurrenceKey: update.ref.occurrenceKey,
        expectedContentHash: contentHash,
      };
      reconciled = (await providerResult(
        'calendar',
        () => this.#calendar.reconcileAppEvent(identity),
        appEventReconciliationSchema,
        'updated event readback',
      )) as AppEventReconciliation;
    } else {
      const input: AppCalendarEventInput = {
        calendar,
        identity: { ...identity, expectedContentHash: contentHash },
        title: projection.title,
        startAt: projection.startAt,
        endAt: projection.endAt,
        contentHash,
        planRevision: claim.job.desiredRevision,
      };
      sideEffectIntent = await this.#prepareExternalMutationIntent(
        claim,
        'calendar_event_create',
        {
          provider: calendar.provider,
          calendarId: calendar.calendarId,
          ownershipKey: calendar.ownershipKey,
          timeBlockId: block.id,
          searchStartAt: projection.startAt,
          searchEndAt: projection.endAt,
          externalEventId: null,
          occurrenceKey: null,
          expectedContentHash: null,
          desiredContentHash: contentHash,
          desiredStartAt: projection.startAt,
          desiredEndAt: projection.endAt,
        },
        now,
      );
      const creation = await providerResult(
        'calendar',
        () => this.#calendar.createAppEvent(input),
        externalEventMutationResultSchema,
        'event creation',
      );
      if (creation.outcome === 'unknown') {
        return this.#uncertain('calendar_create_unknown');
      }
      identity = {
        ...identity,
        searchRange: { start: projection.startAt, end: projection.endAt },
        expectedExternalEventId: creation.ref.externalEventId,
        expectedOccurrenceKey: creation.ref.occurrenceKey,
        expectedContentHash: contentHash,
      };
      reconciled = (await providerResult(
        'calendar',
        () => this.#calendar.reconcileAppEvent(identity),
        appEventReconciliationSchema,
        'created event readback',
      )) as AppEventReconciliation;
    }
    if (reconciled.status === 'unknown') {
      return this.#uncertain('calendar_readback_unknown');
    }
    if (!(
      (reconciled.status === 'found' || reconciled.status === 'conflict') &&
      calendarResultMatchesDesired(
        reconciled,
        identity,
        projection,
        contentHash,
      )
    )) {
      if (reconciled.status === 'found' || reconciled.status === 'conflict') {
        return this.#calendarConflict(
          claim,
          calendar,
          block,
          binding,
          reconciled,
          now,
        );
      }
      return this.#uncertain('calendar_readback_missing');
    }
    const resolved = await this.#resolveDesiredCalendarResult(
      claim,
      calendar,
      block,
      binding,
      reconciled,
      contentHash,
      projection,
      now,
    );
    if (sideEffectIntent !== null && resolved.status === 'succeeded') {
      const checkpointMutations = resolved.mutations.map((mutation) =>
        mutation.kind === 'calendar_upsert'
          ? {
              kind: 'calendar_upsert' as const,
              value: createCalendarBinding({
                ...mutation.value,
                status: 'pending',
              }),
            }
          : mutation,
      );
      await this.#checkpointExternalMutationIntent(
        claim,
        sideEffectIntent,
        checkpointMutations,
      );
    }
    return resolved;
  }

  async #resolveDesiredCalendarResult(
    claim: IntegrationJobClaim,
    calendar: CalendarRef,
    block: TimeBlock,
    binding: CalendarBinding | null,
    reconciled: Extract<
      AppEventReconciliation,
      { status: 'found' | 'conflict' }
    >,
    contentHash: string,
    projection: CalendarEventProjection,
    now: Instant,
  ): Promise<SynchronizeOutcome> {
    if (reconciled.status === 'found') {
      return this.#calendarSynced(
        claim,
        calendar,
        block,
        binding,
        reconciled,
        contentHash,
        projection,
        now,
      );
    }
    const confirmationIdentity = calendarIdentity(
      calendar.provider,
      calendar.calendarId,
      calendar.ownershipKey,
      block,
      { start: projection.startAt, end: projection.endAt },
      binding,
      contentHash,
    );
    const confirmation = (await providerResult(
      'calendar',
      () => this.#calendar.reconcileAppEvent(confirmationIdentity),
      appEventReconciliationSchema,
      'desired event confirmation',
    )) as AppEventReconciliation;
    if (confirmation.status === 'unknown') {
      return this.#uncertain('calendar_reconciliation_unknown');
    }
    if (
      confirmation.status === 'found' &&
      calendarResultMatchesDesired(
        confirmation,
        confirmationIdentity,
        projection,
        contentHash,
      )
    ) {
      return this.#calendarSynced(
        claim,
        calendar,
        block,
        binding,
        confirmation,
        contentHash,
        projection,
        now,
      );
    }
    if (
      (confirmation.status === 'found' || confirmation.status === 'conflict') &&
      !sameCalendarIdentity(confirmation, confirmationIdentity)
    ) {
      return this.#uncertain('calendar_reconciliation_scope_mismatch');
    }
    return this.#calendarConflict(
      claim,
      calendar,
      block,
      binding,
      confirmation.status === 'found' || confirmation.status === 'conflict'
        ? confirmation
        : reconciled,
      now,
    );
  }

  #calendarSynced(
    claim: IntegrationJobClaim,
    calendar: CalendarRef,
    block: TimeBlock,
    binding: CalendarBinding | null,
    reconciled: Extract<
      AppEventReconciliation,
      { status: 'found' | 'conflict' }
    >,
    contentHash: string,
    projection: CalendarEventProjection,
    now: Instant,
  ): SynchronizeOutcome {
    return {
      status: 'succeeded',
      lastErrorCode: null,
      externallyUncertain: false,
      mutations: [
        {
          kind: 'calendar_upsert',
          value: createCalendarBinding({
            id:
              binding?.id ??
              generateId(
                this.#ids.calendarBinding,
                parseCalendarBindingId,
                'Calendar binding ID',
              ),
            timeBlockId: block.id,
            provider: calendar.provider,
            calendarId: calendar.calendarId,
            externalEventId: reconciled.ref.externalEventId,
            occurrenceKey: reconciled.ref.occurrenceKey,
            ownershipKey: calendar.ownershipKey,
            ownershipVerified: true,
            appliedContentHash: contentHash,
            appliedStartAt: projection.startAt,
            appliedEndAt: projection.endAt,
            lastAppliedRevision: claim.job.desiredRevision,
            status: 'synced',
            verifiedAt: now,
            createdAt: binding?.createdAt ?? now,
            updatedAt: now,
          }),
        },
      ],
    };
  }

  #calendarConflict(
    claim: IntegrationJobClaim,
    calendar: CalendarRef,
    block: TimeBlock,
    binding: CalendarBinding | null,
    reconciled: Extract<
      AppEventReconciliation,
      { status: 'found' | 'conflict' }
    >,
    now: Instant,
  ): SynchronizeOutcome {
    return {
      status: 'reconciliation_required',
      lastErrorCode: 'calendar_external_conflict',
      externallyUncertain: false,
      mutations: [
        {
          kind: 'calendar_upsert',
          value: createCalendarBinding({
            id:
              binding?.id ??
              generateId(
                this.#ids.calendarBinding,
                parseCalendarBindingId,
                'Calendar binding ID',
              ),
            timeBlockId: block.id,
            provider: calendar.provider,
            calendarId: calendar.calendarId,
            externalEventId: reconciled.ref.externalEventId,
            occurrenceKey: reconciled.ref.occurrenceKey,
            ownershipKey: calendar.ownershipKey,
            ownershipVerified: true,
            appliedContentHash:
              binding?.appliedContentHash ?? reconciled.contentHash,
            appliedStartAt: binding?.appliedStartAt ?? reconciled.startAt,
            appliedEndAt: binding?.appliedEndAt ?? reconciled.endAt,
            lastAppliedRevision: binding?.lastAppliedRevision ?? 0,
            status: 'conflict',
            verifiedAt: now,
            createdAt: binding?.createdAt ?? now,
            updatedAt: now,
          }),
        },
      ],
    };
  }

  #calendarMissingConflict(
    binding: CalendarBinding,
    now: Instant,
  ): SynchronizeOutcome {
    return {
      status: 'reconciliation_required',
      lastErrorCode: 'calendar_owned_event_missing',
      externallyUncertain: false,
      mutations: [
        {
          kind: 'calendar_upsert',
          value: createCalendarBinding({
            ...binding,
            status: 'conflict',
            verifiedAt: now,
            updatedAt: now,
          }),
        },
      ],
    };
  }

  async #removeCalendarItem(
    claim: IntegrationJobClaim,
    binding: CalendarBinding,
    now: Instant,
  ): Promise<SynchronizeOutcome> {
    if (binding.status === 'conflict') {
      return {
        status: 'reconciliation_required',
        lastErrorCode: 'calendar_binding_conflict',
        externallyUncertain: false,
        mutations: [],
      };
    }
    const identity: AppEventIdentity = {
      provider: binding.provider,
      calendarId: binding.calendarId,
      ownershipKey: binding.ownershipKey,
      timeBlockId: binding.timeBlockId,
      searchRange: {
        start: binding.appliedStartAt,
        end: binding.appliedEndAt,
      },
      expectedExternalEventId: binding.externalEventId,
      expectedOccurrenceKey: binding.occurrenceKey,
      expectedContentHash: binding.appliedContentHash,
    };
    const reconciled = (await providerResult(
      'calendar',
      () => this.#calendar.reconcileAppEvent(identity),
      appEventReconciliationSchema,
      'obsolete event reconciliation',
    )) as AppEventReconciliation;
    if (reconciled.status === 'unknown') {
      return this.#uncertain('calendar_delete_reconciliation_unknown');
    }
    if (reconciled.status === 'missing') {
      return {
        status: 'succeeded',
        lastErrorCode: null,
        externallyUncertain: false,
        mutations: [{ kind: 'calendar_delete', value: binding }],
      };
    }
    if (
      !sameCalendarRef(reconciled, binding.provider, binding.calendarId) ||
      reconciled.contentHash !== binding.appliedContentHash
    ) {
      return {
        status: 'reconciliation_required',
        lastErrorCode: 'calendar_external_conflict',
        externallyUncertain: false,
        mutations: [
          {
            kind: 'calendar_upsert',
            value: createCalendarBinding({
              ...binding,
              status: 'conflict',
              verifiedAt: now,
              updatedAt: now,
            }),
          },
        ],
      };
    }
    const intent = await this.#prepareExternalMutationIntent(
      claim,
      'calendar_event_delete',
      {
        provider: binding.provider,
        calendarId: binding.calendarId,
        ownershipKey: binding.ownershipKey,
        timeBlockId: binding.timeBlockId,
        searchStartAt: binding.appliedStartAt,
        searchEndAt: binding.appliedEndAt,
        externalEventId: binding.externalEventId,
        occurrenceKey: binding.occurrenceKey,
        expectedContentHash: binding.appliedContentHash,
        desiredContentHash: null,
        desiredStartAt: null,
        desiredEndAt: null,
      },
      now,
    );
    const deletion = await providerResult(
      'calendar',
      () => this.#calendar.deleteAppEvent(ownedCalendarRef(binding)),
      externalDeletionResultSchema,
      'event deletion',
    );
    if (deletion.outcome === 'unknown') {
      return this.#uncertain('calendar_delete_unknown');
    }
    await this.#checkpointExternalMutationIntent(claim, intent, [
      { kind: 'calendar_delete', value: binding },
    ]);
    return {
      status: 'succeeded',
      lastErrorCode: null,
      externallyUncertain: false,
      mutations: [],
    };
  }

  async #synchronizeNotifications(
    claim: IntegrationJobClaim,
    work: WorkSnapshot,
  ): Promise<SynchronizeOutcome> {
    const permission = await providerResult(
      'notification',
      () => this.#notifications.getPermissionState(),
      notificationPermissionStateSchema,
      'permission',
    );
    const permissionOutcome = this.#notificationPermissionOutcome(permission);
    if (permissionOutcome !== null) return permissionOutcome;
    const now = readClock(this.#clock);
    const discovery = await this.#discoverNotificationBindings(
      claim,
      work,
      now,
    );
    if (discovery.status === 'blocked') return discovery.outcome;
    const existingByIdentity = new Map(
      discovery.bindings.map((binding) => [
        JSON.stringify([binding.timeBlockId, binding.type]),
        binding,
      ]),
    );
    const desired = new Set<string>();
    const mutations: BindingMutation[] = [];
    for (const block of [...work.blocks].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const projection = this.#notificationProjection(block, work, now);
      if (projection === null) continue;
      const key = JSON.stringify([block.id, projection.type]);
      if (desired.has(key)) {
        throw dataIntegrityError(
          'The integration projection produced a duplicate notification identity.',
        );
      }
      desired.add(key);
      const item = await this.#reconcileNotificationItem(
        claim,
        block,
        projection,
        existingByIdentity.get(key) ?? null,
        now,
      );
      mutations.push(...item.mutations);
      if (item.status !== 'succeeded') return { ...item, mutations };
    }
    for (const [key, binding] of existingByIdentity) {
      if (desired.has(key)) continue;
      const item = await this.#removeNotificationItem(claim, binding, now);
      mutations.push(...item.mutations);
      if (item.status !== 'succeeded') return { ...item, mutations };
    }
    return {
      status: 'succeeded',
      lastErrorCode: null,
      externallyUncertain: false,
      mutations,
    };
  }

  #notificationPermissionOutcome(
    permission: NotificationPermissionState,
  ): SynchronizeOutcome | null {
    if (permission.status === 'granted') return null;
    return {
      status:
        permission.status === 'unavailable'
          ? 'disabled'
          : 'permission_required',
      lastErrorCode:
        permission.status === 'unavailable'
          ? 'notification_unavailable'
          : 'notification_permission_required',
      externallyUncertain: false,
      mutations: [],
    };
  }

  async #reconcileNotificationItem(
    claim: IntegrationJobClaim,
    block: TimeBlock,
    projection: NotificationProjection,
    binding: NotificationBinding | null,
    now: Instant,
  ): Promise<SynchronizeOutcome> {
    if (binding?.status === 'conflict') {
      return {
        status: 'reconciliation_required',
        lastErrorCode: 'notification_binding_conflict',
        externallyUncertain: false,
        mutations: [],
      };
    }
    const contentHash = hashOperationParameters({
      title: projection.title,
      body: projection.body,
      scheduledAt: projection.scheduledAt,
      type: projection.type,
    });
    let identity = notificationIdentity(
      block,
      projection.type,
      binding,
      binding?.appliedContentHash ?? null,
    );
    let reconciled = (await providerResult(
      'notification',
      () => this.#notifications.reconcile(identity),
      notificationReconciliationSchema,
      'notification reconciliation',
    )) as NotificationReconciliation;
    if (reconciled.status === 'unknown') {
      return this.#uncertain('notification_reconciliation_unknown');
    }
    if (
      (reconciled.status === 'found' || reconciled.status === 'conflict') &&
      !sameNotificationIdentity(reconciled, identity)
    ) {
      return this.#uncertain('notification_identity_mismatch');
    }
    if (
      (reconciled.status === 'found' || reconciled.status === 'conflict') &&
      notificationResultMatchesDesired(
        reconciled,
        identity,
        projection,
        contentHash,
      )
    ) {
      return this.#resolveDesiredNotificationResult(
        claim,
        block,
        projection,
        binding,
        reconciled,
        contentHash,
        now,
      );
    }
    if (reconciled.status === 'conflict') {
      return this.#notificationConflict(
        claim,
        block,
        projection,
        binding,
        reconciled,
        now,
      );
    }
    if (
      reconciled.status === 'found' &&
      binding !== null &&
      reconciled.contentHash !== binding.appliedContentHash
    ) {
      return this.#notificationConflict(
        claim,
        block,
        projection,
        binding,
        reconciled,
        now,
      );
    }
    if (reconciled.status === 'found' && binding === null) {
      return this.#notificationConflict(
        claim,
        block,
        projection,
        binding,
        reconciled,
        now,
      );
    }
    if (reconciled.status === 'found' && binding !== null) {
      const cancelIntent = await this.#prepareExternalMutationIntent(
        claim,
        'notification_cancel',
        {
          timeBlockId: binding.timeBlockId,
          type: binding.type,
          osNotificationId: binding.osNotificationId,
          expectedContentHash: binding.appliedContentHash,
          desiredContentHash: null,
          desiredScheduledAt: null,
        },
        now,
      );
      const canceled = await providerResult(
        'notification',
        () => this.#notifications.cancel(ownedNotificationRef(binding)),
        externalDeletionResultSchema,
        'notification cancellation',
      );
      if (canceled.outcome === 'unknown') {
        return this.#uncertain('notification_cancel_unknown');
      }
      await this.#checkpointExternalMutationIntent(claim, cancelIntent, [
        { kind: 'notification_delete', value: binding },
      ]);
    }
    const input: LocalNotificationInput = {
      identity: { ...identity, expectedContentHash: contentHash },
      taskId: block.taskId,
      title: projection.title,
      body: projection.body,
      scheduledAt: projection.scheduledAt,
      type: projection.type,
      contentHash,
      planRevision: claim.job.desiredRevision,
    };
    const scheduleIntent = await this.#prepareExternalMutationIntent(
      claim,
      'notification_schedule',
      {
        timeBlockId: block.id,
        type: projection.type,
        osNotificationId: null,
        expectedContentHash: null,
        desiredContentHash: contentHash,
        desiredScheduledAt: projection.scheduledAt,
      },
      now,
    );
    const scheduled = await providerResult(
      'notification',
      () => this.#notifications.schedule(input),
      notificationMutationResultSchema,
      'notification scheduling',
    );
    if (scheduled.outcome === 'unknown') {
      return this.#uncertain('notification_schedule_unknown');
    }
    identity = {
      ...identity,
      expectedOsNotificationId: scheduled.ref.osNotificationId,
      expectedContentHash: contentHash,
    };
    reconciled = (await providerResult(
      'notification',
      () => this.#notifications.reconcile(identity),
      notificationReconciliationSchema,
      'scheduled notification readback',
    )) as NotificationReconciliation;
    if (!(
      (reconciled.status === 'found' || reconciled.status === 'conflict') &&
      notificationResultMatchesDesired(
        reconciled,
        identity,
        projection,
        contentHash,
      )
    )) {
      return reconciled.status === 'unknown'
        ? this.#uncertain('notification_readback_unknown')
        : this.#notificationConflict(
            claim,
            block,
            projection,
            binding,
            reconciled.status === 'missing'
              ? {
                  status: 'conflict',
                  ref: {
                    osNotificationId: scheduled.ref.osNotificationId,
                    identity: {
                      timeBlockId: block.id,
                      type: projection.type,
                    },
                  },
                  contentHash,
                  scheduledAt: projection.scheduledAt,
                  identityVerified: true,
                }
              : reconciled,
            now,
          );
    }
    const resolved = await this.#resolveDesiredNotificationResult(
      claim,
      block,
      projection,
      binding,
      reconciled,
      contentHash,
      now,
    );
    if (resolved.status === 'succeeded') {
      const checkpointMutations = resolved.mutations.map((mutation) =>
        mutation.kind === 'notification_upsert'
          ? {
              kind: 'notification_upsert' as const,
              value: createNotificationBinding({
                ...mutation.value,
                status: 'pending',
              }),
            }
          : mutation,
      );
      await this.#checkpointExternalMutationIntent(
        claim,
        scheduleIntent,
        checkpointMutations,
      );
    }
    return resolved;
  }

  async #resolveDesiredNotificationResult(
    claim: IntegrationJobClaim,
    block: TimeBlock,
    projection: NotificationProjection,
    binding: NotificationBinding | null,
    reconciled: Extract<
      NotificationReconciliation,
      { status: 'found' | 'conflict' }
    >,
    contentHash: string,
    now: Instant,
  ): Promise<SynchronizeOutcome> {
    if (reconciled.status === 'found') {
      return this.#notificationSynced(
        claim,
        block,
        projection,
        binding,
        reconciled,
        contentHash,
        now,
      );
    }
    const confirmationIdentity = notificationIdentity(
      block,
      projection.type,
      binding,
      contentHash,
    );
    const confirmation = (await providerResult(
      'notification',
      () => this.#notifications.reconcile(confirmationIdentity),
      notificationReconciliationSchema,
      'desired notification confirmation',
    )) as NotificationReconciliation;
    if (confirmation.status === 'unknown') {
      return this.#uncertain('notification_reconciliation_unknown');
    }
    if (
      confirmation.status === 'found' &&
      notificationResultMatchesDesired(
        confirmation,
        confirmationIdentity,
        projection,
        contentHash,
      )
    ) {
      return this.#notificationSynced(
        claim,
        block,
        projection,
        binding,
        confirmation,
        contentHash,
        now,
      );
    }
    if (
      (confirmation.status === 'found' || confirmation.status === 'conflict') &&
      !sameNotificationIdentity(confirmation, confirmationIdentity)
    ) {
      return this.#uncertain('notification_identity_mismatch');
    }
    return this.#notificationConflict(
      claim,
      block,
      projection,
      binding,
      confirmation.status === 'found' || confirmation.status === 'conflict'
        ? confirmation
        : reconciled,
      now,
    );
  }

  #notificationSynced(
    claim: IntegrationJobClaim,
    block: TimeBlock,
    projection: NotificationProjection,
    binding: NotificationBinding | null,
    reconciled: Extract<
      NotificationReconciliation,
      { status: 'found' | 'conflict' }
    >,
    contentHash: string,
    now: Instant,
  ): SynchronizeOutcome {
    return {
      status: 'succeeded',
      lastErrorCode: null,
      externallyUncertain: false,
      mutations: [
        {
          kind: 'notification_upsert',
          value: createNotificationBinding({
            id:
              binding?.id ??
              generateId(
                this.#ids.notificationBinding,
                parseNotificationBindingId,
                'Notification binding ID',
              ),
            timeBlockId: block.id,
            taskId: block.taskId,
            osNotificationId: reconciled.ref.osNotificationId,
            type: projection.type,
            appliedContentHash: contentHash,
            scheduledAt: projection.scheduledAt,
            desiredRevision: claim.job.desiredRevision,
            lastAppliedRevision: claim.job.desiredRevision,
            status: 'synced',
            identityVerified: true,
            verifiedAt: now,
            createdAt: binding?.createdAt ?? now,
            updatedAt: now,
          }),
        },
      ],
    };
  }

  #notificationConflict(
    claim: IntegrationJobClaim,
    block: TimeBlock,
    projection: NotificationProjection,
    binding: NotificationBinding | null,
    reconciled: Extract<
      NotificationReconciliation,
      { status: 'found' | 'conflict' }
    >,
    now: Instant,
  ): SynchronizeOutcome {
    return {
      status: 'reconciliation_required',
      lastErrorCode: 'notification_external_conflict',
      externallyUncertain: false,
      mutations: [
        {
          kind: 'notification_upsert',
          value: createNotificationBinding({
            id:
              binding?.id ??
              generateId(
                this.#ids.notificationBinding,
                parseNotificationBindingId,
                'Notification binding ID',
              ),
            timeBlockId: block.id,
            taskId: block.taskId,
            osNotificationId: reconciled.ref.osNotificationId,
            type: projection.type,
            appliedContentHash:
              binding?.appliedContentHash ?? reconciled.contentHash,
            scheduledAt: binding?.scheduledAt ?? reconciled.scheduledAt,
            desiredRevision: claim.job.desiredRevision,
            lastAppliedRevision: binding?.lastAppliedRevision ?? 0,
            status: 'conflict',
            identityVerified: true,
            verifiedAt: now,
            createdAt: binding?.createdAt ?? now,
            updatedAt: now,
          }),
        },
      ],
    };
  }

  async #removeNotificationItem(
    claim: IntegrationJobClaim,
    binding: NotificationBinding,
    now: Instant,
  ): Promise<SynchronizeOutcome> {
    if (binding.status === 'conflict') {
      return {
        status: 'reconciliation_required',
        lastErrorCode: 'notification_binding_conflict',
        externallyUncertain: false,
        mutations: [],
      };
    }
    const identity: NotificationIdentity = {
      timeBlockId: binding.timeBlockId,
      type: binding.type,
      expectedOsNotificationId: binding.osNotificationId,
      expectedContentHash: binding.appliedContentHash,
    };
    const reconciled = (await providerResult(
      'notification',
      () => this.#notifications.reconcile(identity),
      notificationReconciliationSchema,
      'obsolete notification reconciliation',
    )) as NotificationReconciliation;
    if (reconciled.status === 'unknown') {
      return this.#uncertain('notification_delete_reconciliation_unknown');
    }
    if (reconciled.status === 'missing') {
      return {
        status: 'succeeded',
        lastErrorCode: null,
        externallyUncertain: false,
        mutations: [{ kind: 'notification_delete', value: binding }],
      };
    }
    if (
      !sameNotificationIdentity(reconciled, identity) ||
      reconciled.contentHash !== binding.appliedContentHash
    ) {
      return {
        status: 'reconciliation_required',
        lastErrorCode: 'notification_external_conflict',
        externallyUncertain: false,
        mutations: [],
      };
    }
    const intent = await this.#prepareExternalMutationIntent(
      claim,
      'notification_cancel',
      {
        timeBlockId: binding.timeBlockId,
        type: binding.type,
        osNotificationId: binding.osNotificationId,
        expectedContentHash: binding.appliedContentHash,
        desiredContentHash: null,
        desiredScheduledAt: null,
      },
      now,
    );
    const canceled = await providerResult(
      'notification',
      () => this.#notifications.cancel(ownedNotificationRef(binding)),
      externalDeletionResultSchema,
      'obsolete notification cancellation',
    );
    if (canceled.outcome === 'unknown') {
      return this.#uncertain('notification_delete_unknown');
    }
    await this.#checkpointExternalMutationIntent(claim, intent, [
      { kind: 'notification_delete', value: binding },
    ]);
    return {
      status: 'succeeded',
      lastErrorCode: null,
      externallyUncertain: false,
      mutations: [],
    };
  }

  #uncertain(errorCode: string): SynchronizeOutcome {
    return {
      status: 'reconciliation_required',
      lastErrorCode: errorCode,
      externallyUncertain: true,
      mutations: [],
    };
  }

  async #finish(
    claim: IntegrationJobClaim,
    outcome: SynchronizeOutcome,
    finishedAt: Instant,
    basedOnStateVersion?: number,
  ): Promise<IntegrationWorkerResult> {
    try {
      return await this.#unitOfWork.transaction(async (transaction) => {
        const current = await transaction.integrationJobs.findById(
          claim.job.id,
        );
        if (!this.#sameClaim(current, claim)) {
          return workerResult(
            claim.job.targetChannel,
            claim,
            'reconciliation_required',
          );
        }
        const state = await requireScheduleState(transaction);
        let status = outcome.status;
        let errorCode = outcome.lastErrorCode;
        if (state.planRevision !== claim.job.desiredRevision) {
          if (outcome.externallyUncertain) {
            status = 'reconciliation_required';
            errorCode ??= 'revision_changed_after_unknown_external_result';
          } else if (state.planRevision > claim.job.desiredRevision) {
            status = 'superseded';
            errorCode = null;
          } else {
            status = 'reconciliation_required';
            errorCode = 'job_revision_ahead_of_schedule';
          }
        }
        const unresolvedIntents =
          await transaction.externalMutationIntents.listByChannel(
            claim.job.targetChannel,
          );
        if (
          unresolvedIntents.length > 0 &&
          status !== 'permission_required' &&
          status !== 'disabled'
        ) {
          status = 'reconciliation_required';
          errorCode = unresolvedIntents.some(
            (intent) => intent.action === 'calendar_provision',
          )
            ? 'calendar_provisioning_unknown'
            : 'external_mutation_intent_pending';
        }
        const retryDisposition = this.#retryDisposition(
          current,
          status,
          errorCode,
          finishedAt,
        );
        if (
          state.planRevision === claim.job.desiredRevision &&
          unresolvedIntents.length === 0
        ) {
          await this.#applyMutations(transaction, outcome.mutations);
        }
        if (
          basedOnStateVersion !== undefined &&
          state.planRevision === claim.job.desiredRevision &&
          state.stateVersion !== basedOnStateVersion &&
          unresolvedIntents.length === 0 &&
          status === 'succeeded'
        ) {
          const requeued = requeueClaimedIntegrationJob(current, {
            claimToken: current.claimToken!,
            attemptCount: current.attemptCount,
            updatedAt: finishedAt,
          });
          const updated = await transaction.integrationJobs.updateClaimed(
            requeued,
            this.#fence(claim),
          );
          if (!updated) {
            throw new IntegrationFinishConflict('job_claim_fence_conflict');
          }
          return workerResult(claim.job.targetChannel, claim, 'pending');
        }
        const settled = settleIntegrationJob(current, {
          claimToken: current.claimToken!,
          attemptCount: current.attemptCount,
          status,
          lastErrorCode: errorCode,
          ...retryDisposition,
          updatedAt: finishedAt,
        });
        const updated = await transaction.integrationJobs.updateClaimed(
          settled,
          this.#fence(claim),
        );
        if (!updated) {
          throw new IntegrationFinishConflict('job_claim_fence_conflict');
        }
        return workerResult(claim.job.targetChannel, claim, status);
      });
    } catch (error) {
      if (!(error instanceof IntegrationFinishConflict)) throw error;
      return this.#settleFinishConflict(claim, error.errorCode, finishedAt);
    }
  }

  async #settleFinishConflict(
    claim: IntegrationJobClaim,
    errorCode: string,
    finishedAt: Instant,
  ): Promise<IntegrationWorkerResult> {
    return this.#unitOfWork.transaction(async (transaction) => {
      const current = await transaction.integrationJobs.findById(claim.job.id);
      if (!this.#sameClaim(current, claim)) {
        return workerResult(
          claim.job.targetChannel,
          claim,
          'reconciliation_required',
        );
      }
      const settled = settleIntegrationJob(current, {
        claimToken: current.claimToken!,
        attemptCount: current.attemptCount,
        status: 'reconciliation_required',
        lastErrorCode: errorCode,
        automaticRetryEligible: false,
        updatedAt: finishedAt,
      });
      await transaction.integrationJobs.updateClaimed(
        settled,
        this.#fence(claim),
      );
      return workerResult(
        claim.job.targetChannel,
        claim,
        'reconciliation_required',
      );
    });
  }

  #retryDisposition(
    job: IntegrationJob,
    status: Exclude<IntegrationJobStatus, 'pending' | 'processing'>,
    errorCode: string | null,
    finishedAt: Instant,
  ): Readonly<{
    automaticRetryEligible: boolean;
    notBefore?: Instant;
  }> {
    const safeReconciliationCodes = new Set([
      'calendar_reconciliation_unknown',
      'calendar_update_unknown',
      'calendar_create_unknown',
      'calendar_readback_unknown',
      'calendar_readback_missing',
      'calendar_delete_reconciliation_unknown',
      'calendar_delete_unknown',
      'calendar_inventory_unknown',
      'notification_reconciliation_unknown',
      'notification_cancel_unknown',
      'notification_schedule_unknown',
      'notification_readback_unknown',
      'notification_delete_reconciliation_unknown',
      'notification_delete_unknown',
      'notification_inventory_unknown',
      'external_mutation_intent_pending',
      'external_intent_readback_failed',
      'external_intent_readback_unknown',
    ]);
    const automaticRetryEligible =
      (status === 'failed' && errorCode === 'provider_timeout') ||
      (status === 'reconciliation_required' &&
        errorCode !== null &&
        safeReconciliationCodes.has(errorCode));
    if (!automaticRetryEligible) return { automaticRetryEligible: false };
    let notBefore: Instant;
    try {
      notBefore = parseInstant(
        this.#retry.nextAttemptAt({ job, status, finishedAt }),
      );
    } catch {
      throw dataIntegrityError(
        'The IntegrationJob retry policy returned an invalid Instant.',
      );
    }
    if (Date.parse(notBefore) <= Date.parse(finishedAt)) {
      throw dataIntegrityError(
        'The IntegrationJob retry policy must defer the next attempt.',
      );
    }
    return { automaticRetryEligible: true, notBefore };
  }

  #fence(claim: IntegrationJobClaim): IntegrationJobClaimFence {
    return {
      expectedClaimToken: claim.job.claimToken!,
      expectedAttemptCount: claim.job.attemptCount,
    };
  }

  async #applyMutations(
    transaction: ApplicationTransaction,
    mutations: readonly BindingMutation[],
  ): Promise<void> {
    for (const mutation of mutations) {
      switch (mutation.kind) {
        case 'calendar_container_upsert':
          await transaction.calendarContainerBindings.upsert(mutation.value);
          break;
        case 'calendar_upsert': {
          const applied = await transaction.calendarBindings.upsertIfNotNewer(
            mutation.value,
          );
          if (!applied) {
            throw new IntegrationFinishConflict(
              'binding_revision_fence_conflict',
            );
          }
          break;
        }
        case 'calendar_delete': {
          const applied = await transaction.calendarBindings.deleteIfNotNewer(
            mutation.value.id,
            mutation.value.lastAppliedRevision,
          );
          if (!applied) {
            throw new IntegrationFinishConflict(
              'binding_revision_fence_conflict',
            );
          }
          break;
        }
        case 'notification_upsert': {
          const applied =
            await transaction.notificationBindings.upsertIfNotNewer(
              mutation.value,
            );
          if (!applied) {
            throw new IntegrationFinishConflict(
              'binding_revision_fence_conflict',
            );
          }
          break;
        }
        case 'notification_delete': {
          const applied =
            await transaction.notificationBindings.deleteIfNotNewer(
              mutation.value.id,
              mutation.value.lastAppliedRevision,
            );
          if (!applied) {
            throw new IntegrationFinishConflict(
              'binding_revision_fence_conflict',
            );
          }
          break;
        }
      }
    }
  }
}
