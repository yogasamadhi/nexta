import {
  createOperationRecord,
  isDomainError,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseTimeZoneId,
  type Instant,
  type OperationRecord,
  type ScheduleState,
} from '@workspace/domain';
import { z } from 'zod';

import { ApplicationError, isApplicationError } from './errors';
import {
  assertOperationIdentity,
  canonicalizeOperationParameters,
  hashOperationParameters,
  type OperationIdentity,
} from './idempotency';
import type {
  ApplicationTransaction,
  Clock,
  IdGenerator,
  LocalTime,
  LocalTimeProvider,
  WriteContext,
} from './ports';
import { writeContextSchema } from './schemas';

export function parseBoundaryInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  label: string,
  operationId?: string,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApplicationError('validation_error', `${label} is invalid.`, {
      retryable: false,
      causeCategory: 'schema',
      operationId,
    });
  }
  return parsed.data;
}

export function parseWriteContext(input: unknown): WriteContext {
  return parseBoundaryInput(writeContextSchema, input, 'Write context');
}

export function operationIdentity(
  context: WriteContext,
  command: string,
  normalizedInput: unknown,
): OperationIdentity {
  return {
    operationId: context.operationId,
    command,
    parameterHash: hashOperationParameters(normalizedInput),
  };
}

export function decodeStoredReceipt<Schema extends z.ZodType>(
  record: OperationRecord,
  requested: OperationIdentity,
  schema: Schema,
): z.output<Schema> {
  assertOperationIdentity(record, requested);

  try {
    let parsedJson: unknown;
    parsedJson = JSON.parse(record.resultJson);
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) throw parsed.error;
    if (
      typeof parsed.data !== 'object' ||
      parsed.data === null ||
      !('stateVersion' in parsed.data) ||
      parsed.data.stateVersion !== record.currentStateVersion
    ) {
      throw new Error('Stored result version does not match OperationRecord.');
    }
    if (
      !('operationId' in parsed.data) ||
      parsed.data.operationId !== record.operationId
    ) {
      throw new Error('Stored result does not match OperationRecord.');
    }
    return parsed.data;
  } catch {
    throw dataIntegrityError(
      'A stored operation result is invalid.',
      requested.operationId,
    );
  }
}

export function buildOperationRecord(
  identity: OperationIdentity,
  receipt: unknown,
  baseState: ScheduleState,
  currentState: ScheduleState,
  occurredAt: Instant,
  diff?: unknown,
): OperationRecord {
  return createOperationRecord({
    operationId: parseOperationId(identity.operationId),
    command: identity.command,
    parameterHash: identity.parameterHash,
    resultJson: canonicalizeOperationParameters(receipt),
    baseStateVersion: baseState.stateVersion,
    currentStateVersion: currentState.stateVersion,
    occurredAt,
    ...(diff === undefined
      ? {}
      : { diffJson: canonicalizeOperationParameters(diff) }),
  });
}

export function dataIntegrityError(
  message: string,
  operationId?: string,
): ApplicationError {
  return new ApplicationError('adapter_error', message, {
    retryable: false,
    causeCategory: 'data_integrity',
    operationId,
  });
}

export function notFoundError(
  entity: 'Task' | 'Goal' | 'Project',
  operationId?: string,
): ApplicationError {
  return new ApplicationError('not_found', `${entity} was not found.`, {
    retryable: false,
    operationId,
  });
}

export function invalidReferenceError(
  entity: 'Task' | 'Goal' | 'Project',
  operationId: string,
): ApplicationError {
  return new ApplicationError(
    'validation_error',
    `Referenced ${entity} was not found.`,
    {
      retryable: false,
      operationId,
    },
  );
}

export async function requireScheduleState(
  transaction: ApplicationTransaction,
  operationId?: string,
): Promise<ScheduleState> {
  const state = await transaction.scheduleState.get();
  if (state === null) {
    throw dataIntegrityError('Schedule state is missing.', operationId);
  }
  return state;
}

export function readClock(clock: Clock, operationId?: string): Instant {
  try {
    return parseInstant(clock.now());
  } catch {
    throw dataIntegrityError('Clock returned an invalid instant.', operationId);
  }
}

export function resolveLocalTime(
  provider: LocalTimeProvider,
  instant: Instant,
  operationId?: string,
): LocalTime {
  try {
    const value = provider.resolve(instant);
    return {
      localDate: parseLocalDate(value.localDate),
      timeZone: parseTimeZoneId(value.timeZone),
    };
  } catch {
    throw dataIntegrityError(
      'Local time provider returned invalid context.',
      operationId,
    );
  }
}

export function generateId<Id>(
  generator: IdGenerator,
  parser: (value: string) => Id,
  label: string,
  operationId?: string,
): Id {
  try {
    return parser(generator.generate());
  } catch {
    throw dataIntegrityError(
      `${label} generator returned an invalid identifier.`,
      operationId,
    );
  }
}

export async function protectApplicationCall<Result>(
  operationId: string | undefined,
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    if (isApplicationError(error)) throw error;
    if (isDomainError(error)) {
      throw new ApplicationError(
        error.code === 'invalid_transition'
          ? 'invalid_transition'
          : 'validation_error',
        error.message,
        {
          retryable: false,
          causeCategory: 'domain',
          operationId,
        },
      );
    }
    throw new ApplicationError(
      'adapter_error',
      'The local operation could not be completed.',
      {
        retryable: true,
        causeCategory: 'local_storage',
        operationId,
      },
    );
  }
}
