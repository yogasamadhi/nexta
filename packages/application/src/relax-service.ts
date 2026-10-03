import {
  advanceStateVersion,
  endRelaxSession,
  parseInstant,
  parseOperationId,
  parseRelaxSessionId,
  startRelaxSession,
  type RelaxSession,
} from '@workspace/domain';

import { ApplicationError } from './errors';
import type {
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  WriteContext,
} from './ports';
import {
  endRelaxSessionInputSchema,
  relaxSessionMutationResultSchema,
  relaxSessionRangeInputSchema,
  startRelaxSessionInputSchema,
  type EndRelaxSessionInput,
  type RelaxSessionMutationResult,
  type RelaxSessionRangeInput,
  type StartRelaxSessionInput,
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

export type RelaxServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
  idGenerator: IdGenerator;
}>;

function directUser(context: WriteContext): void {
  if (context.authority.kind !== 'user') {
    throw new ApplicationError(
      'permission_required',
      'Starting or ending a relax session requires direct user action.',
      { retryable: false, operationId: context.operationId },
    );
  }
}

export class RelaxService {
  readonly #dependencies: RelaxServiceDependencies;

  constructor(dependencies: RelaxServiceDependencies) {
    this.#dependencies = dependencies;
  }

  get(sessionId: string): Promise<RelaxSession> {
    return protectApplicationCall(undefined, async () => {
      const id = parseRelaxSessionId(sessionId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const session = await transaction.relaxSessions.findById(id);
        if (session === null) {
          throw new ApplicationError(
            'not_found',
            'Relax session was not found.',
            {
              retryable: false,
            },
          );
        }
        return session;
      });
    });
  }

  getActive(): Promise<RelaxSession | null> {
    return protectApplicationCall(undefined, () =>
      this.#dependencies.unitOfWork.transaction((transaction) =>
        transaction.relaxSessions.findActive(),
      ),
    );
  }

  listRange(input: RelaxSessionRangeInput): Promise<readonly RelaxSession[]> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        relaxSessionRangeInputSchema,
        input,
        'Relax session range input',
      );
      const start = parseInstant(parsed.start);
      const end = parseInstant(parsed.end);
      if (Date.parse(end) <= Date.parse(start)) {
        throw new ApplicationError(
          'validation_error',
          'Relax session range must be non-empty.',
          { retryable: false },
        );
      }
      return this.#dependencies.unitOfWork.transaction((transaction) =>
        transaction.relaxSessions.listStartedBetween(start, end),
      );
    });
  }

  start(
    input: StartRelaxSessionInput,
    context: WriteContext,
  ): Promise<RelaxSessionMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      directUser(writeContext);
      const parsed = parseBoundaryInput(
        startRelaxSessionInputSchema,
        input,
        'Relax session start input',
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'relax_session.start',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            relaxSessionMutationResultSchema,
          );
        }
        const beforeState = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        if ((await transaction.relaxSessions.findActive()) !== null) {
          throw new ApplicationError(
            'active_session_conflict',
            'Another relax session is already active.',
            { retryable: false, operationId: writeContext.operationId },
          );
        }
        const execution = await transaction.executionSessions.findActive();
        if (execution?.status === 'running') {
          throw new ApplicationError(
            'active_session_conflict',
            'Pause the active focus session before starting a relax session.',
            { retryable: false, operationId: writeContext.operationId },
          );
        }
        const startedAt = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const session = startRelaxSession({
          id: generateId(
            this.#dependencies.idGenerator,
            parseRelaxSessionId,
            'RelaxSession ID',
            writeContext.operationId,
          ),
          ...parsed,
          startedAt,
        });
        const nextState = advanceStateVersion(beforeState);
        await transaction.relaxSessions.insert(session);
        await transaction.scheduleState.update(nextState);
        const result: RelaxSessionMutationResult = {
          session,
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
            startedAt,
          ),
        );
        return relaxSessionMutationResultSchema.parse(result);
      });
    });
  }

  end(
    input: EndRelaxSessionInput,
    context: WriteContext,
  ): Promise<RelaxSessionMutationResult> {
    const writeContext = parseWriteContext(context);
    return protectApplicationCall(writeContext.operationId, async () => {
      directUser(writeContext);
      const parsed = parseBoundaryInput(
        endRelaxSessionInputSchema,
        input,
        'Relax session end input',
        writeContext.operationId,
      );
      const identity = operationIdentity(
        writeContext,
        'relax_session.end',
        parsed,
      );
      const operationId = parseOperationId(writeContext.operationId);
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const stored = await transaction.operationRecords.findById(operationId);
        if (stored !== null) {
          return decodeStoredReceipt(
            stored,
            identity,
            relaxSessionMutationResultSchema,
          );
        }
        const beforeState = await requireScheduleState(
          transaction,
          writeContext.operationId,
        );
        const session = await transaction.relaxSessions.findById(
          parseRelaxSessionId(parsed.sessionId),
        );
        if (session === null) {
          throw new ApplicationError(
            'not_found',
            'Relax session was not found.',
            {
              retryable: false,
              operationId: writeContext.operationId,
            },
          );
        }
        const endedAt = readClock(
          this.#dependencies.clock,
          writeContext.operationId,
        );
        const ended = endRelaxSession(session, parsed.outcome, endedAt);
        const nextState = advanceStateVersion(beforeState);
        await transaction.relaxSessions.update(ended);
        await transaction.scheduleState.update(nextState);
        const result: RelaxSessionMutationResult = {
          session: ended,
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
            endedAt,
          ),
        );
        return relaxSessionMutationResultSchema.parse(result);
      });
    });
  }
}
