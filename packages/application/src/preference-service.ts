import {
  advanceStateVersion,
  createUserPreference,
  parseOperationId,
  parseUserPreferenceId,
  type UserPreference,
} from '@workspace/domain';

import { ApplicationError } from './errors';
import { canonicalizeOperationParameters } from './idempotency';
import type {
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  WriteContext,
} from './ports';
import {
  notificationLeadMinutesPreferenceKey,
  preferenceMutationResultSchema,
  readPreferenceKeySchema,
  updatePreferenceInputSchema,
  type PreferenceMutationResult,
  type SupportedPreferenceKey,
  type UpdatePreferenceInput,
} from './preference-schemas';
import type { IntegrationJobWakeupPort } from './schedule-ports';
import {
  buildOperationRecord,
  decodeStoredReceipt,
  generateId,
  operationIdentity,
  parseBoundaryInput,
  parseWriteContext,
  protectApplicationCall,
  readClock,
  requireScheduleState,
} from './service-support';

export type PreferenceServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
  idGenerator: IdGenerator;
  integrationWakeup?: IntegrationJobWakeupPort;
}>;

type PreferenceUpdateOutcome = Readonly<{
  result: PreferenceMutationResult;
  shouldWakeIntegrations: boolean;
}>;

export class PreferenceService {
  readonly #dependencies: PreferenceServiceDependencies;

  constructor(dependencies: PreferenceServiceDependencies) {
    this.#dependencies = dependencies;
  }

  get(key: SupportedPreferenceKey): Promise<UserPreference | null> {
    return protectApplicationCall(undefined, async () => {
      const parsedKey = parseBoundaryInput(
        readPreferenceKeySchema,
        key,
        'Preference key',
      );
      return this.#dependencies.unitOfWork.transaction((transaction) =>
        transaction.userPreferences.findByKey(parsedKey),
      );
    });
  }

  update(
    input: UpdatePreferenceInput,
    context: WriteContext,
  ): Promise<PreferenceMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      const parsed = parseBoundaryInput(
        updatePreferenceInputSchema,
        input,
        'Preference update input',
        writeContext.operationId,
      );
      if (writeContext.authority.kind !== 'user') {
        throw new ApplicationError(
          'permission_required',
          'Scheduling and calendar scope preferences require a direct user action.',
          { retryable: false, operationId: writeContext.operationId },
        );
      }
      const identity = operationIdentity(
        writeContext,
        'preference.update',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);

      const outcome = await this.#dependencies.unitOfWork.transaction(
        async (transaction): Promise<PreferenceUpdateOutcome> => {
          const stored =
            await transaction.operationRecords.findById(operationId);
          if (stored !== null) {
            return {
              result: decodeStoredReceipt(
                stored,
                identity,
                preferenceMutationResultSchema,
              ),
              shouldWakeIntegrations: false,
            };
          }

          const beforeState = await requireScheduleState(
            transaction,
            writeContext.operationId,
          );
          const current = await transaction.userPreferences.findByKey(
            parsed.key,
          );
          const changed =
            current === null ||
            canonicalizeOperationParameters(current.valueJson) !==
              canonicalizeOperationParameters(parsed.value);
          const now = readClock(
            this.#dependencies.clock,
            writeContext.operationId,
          );
          const preference = changed
            ? createUserPreference({
                id:
                  current?.id ??
                  generateId(
                    this.#dependencies.idGenerator,
                    parseUserPreferenceId,
                    'UserPreference ID',
                    writeContext.operationId,
                  ),
                key: parsed.key,
                valueJson: parsed.value,
                updatedAt: now,
              })
            : current;
          if (preference === null) {
            throw new Error('Preference normalization unexpectedly failed.');
          }

          const nextState = changed
            ? advanceStateVersion(beforeState)
            : beforeState;
          if (changed) {
            await transaction.userPreferences.upsert(preference);
            await transaction.scheduleState.update(nextState);
            if (
              parsed.key === notificationLeadMinutesPreferenceKey &&
              nextState.planRevision > 0
            ) {
              await transaction.integrationJobs.requeueLatestProjection({
                channel: 'notification',
                desiredRevision: nextState.planRevision,
                requeuedAt: now,
                notBefore: now,
              });
            }
          }
          const result: PreferenceMutationResult = {
            operationId,
            stateVersion: nextState.stateVersion,
            planRevision: nextState.planRevision,
            preference,
          };
          await transaction.operationRecords.insert(
            buildOperationRecord(
              identity,
              result,
              beforeState,
              nextState,
              now,
              {
                preferenceKey: parsed.key,
                before: current?.valueJson ?? null,
                after: preference.valueJson,
              },
            ),
          );
          return {
            result,
            shouldWakeIntegrations:
              changed && parsed.key === notificationLeadMinutesPreferenceKey,
          };
        },
      );
      if (outcome.shouldWakeIntegrations) {
        try {
          await this.#dependencies.integrationWakeup?.wake(operationId);
        } catch {
          // The durable requeued job remains the recovery source.
        }
      }
      return outcome.result;
    });
  }
}
