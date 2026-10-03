import {
  advanceStateVersion,
  createEnergyCheckIn,
  parseEnergyCheckInId,
  parseLocalDate,
  parseOperationId,
  parseTimeZoneId,
  type EnergyCheckIn,
} from '@workspace/domain';

import { ApplicationError } from './errors';
import type {
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  LocalTimeProvider,
  WriteContext,
} from './ports';
import {
  energyCheckInDayInputSchema,
  energyCheckInMutationResultSchema,
  recordEnergyCheckInInputSchema,
  type EnergyCheckInDayInput,
  type EnergyCheckInMutationResult,
  type RecordEnergyCheckInInput,
} from './wellbeing-schemas';
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

export type EnergyCheckInServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
  localTimeProvider: LocalTimeProvider;
  idGenerator: IdGenerator;
}>;

export class EnergyCheckInService {
  readonly #dependencies: EnergyCheckInServiceDependencies;

  constructor(dependencies: EnergyCheckInServiceDependencies) {
    this.#dependencies = dependencies;
  }

  getLatestForDay(input: EnergyCheckInDayInput): Promise<EnergyCheckIn | null> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        energyCheckInDayInputSchema,
        input,
        'Energy check-in day input',
      );
      const localDate = parseLocalDate(parsed.localDate);
      const timeZone = parseTimeZoneId(parsed.timeZone);
      return this.#dependencies.unitOfWork.transaction((transaction) =>
        transaction.energyCheckIns.findLatestByLocalDay(localDate, timeZone),
      );
    });
  }

  getLatestCurrentDay(): Promise<EnergyCheckIn | null> {
    return protectApplicationCall(undefined, async () => {
      const now = readClock(this.#dependencies.clock);
      const local = this.#dependencies.localTimeProvider.resolve(now);
      return this.#dependencies.unitOfWork.transaction((transaction) =>
        transaction.energyCheckIns.findLatestByLocalDay(
          local.localDate,
          local.timeZone,
        ),
      );
    });
  }

  record(
    input: RecordEnergyCheckInInput,
    context: WriteContext,
  ): Promise<EnergyCheckInMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      if (writeContext.authority.kind !== 'user') {
        throw new ApplicationError(
          'permission_required',
          'Recording an energy check-in requires direct user action.',
          { retryable: false, operationId: writeContext.operationId },
        );
      }
      const parsed = parseBoundaryInput(
        recordEnergyCheckInInputSchema,
        input,
        'Energy check-in input',
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'energy_check_in.record',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            energyCheckInMutationResultSchema,
          );
        }
        const beforeState = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const createdAt = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const local = this.#dependencies.localTimeProvider.resolve(createdAt);
        const checkIn = createEnergyCheckIn({
          id: generateId(
            this.#dependencies.idGenerator,
            parseEnergyCheckInId,
            'EnergyCheckIn ID',
            writeContext.operationId,
          ),
          localDate: local.localDate,
          timeZone: local.timeZone,
          level: parsed.level,
          note: parsed.note,
          createdAt,
        });
        const nextState = advanceStateVersion(beforeState);
        await transaction.energyCheckIns.insert(checkIn);
        await transaction.scheduleState.update(nextState);
        const result: EnergyCheckInMutationResult = {
          checkIn,
          operationId,
          stateVersion: nextState.stateVersion,
          planRevision: nextState.planRevision,
        };
        await transaction.operationRecords.insert(
          buildOperationRecord(
            identity,
            result,
            beforeState,
            nextState,
            createdAt,
          ),
        );
        return energyCheckInMutationResultSchema.parse(result);
      });
    });
  }
}
