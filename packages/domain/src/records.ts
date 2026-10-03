import { DomainError } from './errors';
import {
  type CompletionRecordId,
  type ExecutionSessionId,
  type Instant,
  type LocalDate,
  type OperationId,
  parseCompletionRecordId,
  parseExecutionSessionId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseTaskActivityEventId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNonNegativeNumber,
  type TaskActivityEventId,
  type TaskId,
  type TimeBlockId,
  type TimeZoneId,
} from './value-objects';

export const durationCoverages = ['complete', 'partial', 'unknown'] as const;
export type DurationCoverage = (typeof durationCoverages)[number];

export const achievementDispositions = ['record', 'skip'] as const;
export type AchievementDisposition = (typeof achievementDispositions)[number];

export const completionSources = ['user', 'agent_authorized'] as const;
export type CompletionSource = (typeof completionSources)[number];

export interface CompletionRecord {
  readonly id: CompletionRecordId;
  readonly taskId: TaskId;
  readonly sourceSessionId: ExecutionSessionId | null;
  readonly operationId: OperationId;
  readonly completedAt: Instant;
  readonly taskTitleSnapshot: string;
  readonly actualDurationSeconds: number | null;
  readonly durationCoverage: DurationCoverage;
  readonly achievementDisposition: AchievementDisposition;
  readonly source: CompletionSource;
}

export interface CreateCompletionRecordFields {
  readonly id: CompletionRecordId;
  readonly taskId: TaskId;
  readonly sourceSessionId?: ExecutionSessionId | null;
  readonly operationId: OperationId;
  readonly completedAt: Instant;
  readonly taskTitleSnapshot: string;
  readonly actualDurationSeconds?: number | null;
  readonly durationCoverage: DurationCoverage;
  readonly achievementDisposition: AchievementDisposition;
  readonly source: CompletionSource;
}

function assertOneOf<Value extends string>(
  value: string,
  values: readonly Value[],
  field: string,
): asserts value is Value {
  if (!values.includes(value as Value)) {
    throw new DomainError('invalid_value', `${field} is unsupported.`, {
      field,
    });
  }
}

export function assertValidCompletionRecord(record: CompletionRecord): void {
  parseCompletionRecordId(record.id);
  parseTaskId(record.taskId);
  if (record.sourceSessionId !== null) {
    parseExecutionSessionId(record.sourceSessionId);
  }
  parseOperationId(record.operationId);
  parseInstant(record.completedAt);
  requireNonEmptyString(record.taskTitleSnapshot, 'taskTitleSnapshot');
  if (record.actualDurationSeconds !== null) {
    requireNonNegativeNumber(
      record.actualDurationSeconds,
      'actualDurationSeconds',
    );
  }
  assertOneOf(record.durationCoverage, durationCoverages, 'durationCoverage');
  assertOneOf(
    record.achievementDisposition,
    achievementDispositions,
    'achievementDisposition',
  );
  assertOneOf(record.source, completionSources, 'source');

  if (
    record.durationCoverage !== 'unknown' &&
    record.actualDurationSeconds === null
  ) {
    throw new DomainError(
      'invariant_violation',
      'Complete or partial duration coverage requires recorded duration.',
      { completionRecordId: record.id },
    );
  }
}

export function createCompletionRecord(
  input: CreateCompletionRecordFields,
): CompletionRecord {
  const record: CompletionRecord = {
    id: parseCompletionRecordId(input.id),
    taskId: parseTaskId(input.taskId),
    sourceSessionId:
      input.sourceSessionId === null || input.sourceSessionId === undefined
        ? null
        : parseExecutionSessionId(input.sourceSessionId),
    operationId: parseOperationId(input.operationId),
    completedAt: parseInstant(input.completedAt),
    taskTitleSnapshot: requireNonEmptyString(
      input.taskTitleSnapshot,
      'taskTitleSnapshot',
    ),
    actualDurationSeconds:
      input.actualDurationSeconds === null ||
      input.actualDurationSeconds === undefined
        ? null
        : requireNonNegativeNumber(
            input.actualDurationSeconds,
            'actualDurationSeconds',
          ),
    durationCoverage: input.durationCoverage,
    achievementDisposition: input.achievementDisposition,
    source: input.source,
  };
  assertValidCompletionRecord(record);
  return record;
}

export function setCompletionRecordAchievementDisposition(
  record: CompletionRecord,
  disposition: AchievementDisposition,
): CompletionRecord {
  assertValidCompletionRecord(record);
  assertOneOf(disposition, achievementDispositions, 'achievementDisposition');
  const next = { ...record, achievementDisposition: disposition };
  assertValidCompletionRecord(next);
  return next;
}

export const knownTaskActivityEventTypes = [
  'create',
  'update',
  'postpone',
  'skip',
  'system_replan',
  'start',
  'finish_session',
  'complete_task',
  'cancel',
] as const;

export type KnownTaskActivityEventType =
  (typeof knownTaskActivityEventTypes)[number];

/** Extensible because the canonical model says event types include "at least". */
export type TaskActivityEventType = string;
export type TaskActivityActor = string;

export type TaskActivitySummaryValue = string | number | boolean | null;
export type TaskActivitySummary = Readonly<
  Record<string, TaskActivitySummaryValue>
>;

export interface TaskActivityEvent {
  readonly id: TaskActivityEventId;
  readonly taskId: TaskId;
  readonly timeBlockId: TimeBlockId | null;
  readonly eventType: TaskActivityEventType;
  readonly actor: TaskActivityActor;
  readonly occurredAt: Instant;
  readonly localDate: LocalDate;
  readonly timeZone: TimeZoneId;
  readonly operationId: OperationId;
  readonly beforeSummary: TaskActivitySummary | null;
  readonly afterSummary: TaskActivitySummary | null;
}

export interface CreateTaskActivityEventFields {
  readonly id: TaskActivityEventId;
  readonly taskId: TaskId;
  readonly timeBlockId?: TimeBlockId | null;
  readonly eventType: string;
  readonly actor: string;
  readonly occurredAt: Instant;
  readonly localDate: LocalDate;
  readonly timeZone: TimeZoneId;
  readonly operationId: OperationId;
  readonly beforeSummary?: TaskActivitySummary | null;
  readonly afterSummary?: TaskActivitySummary | null;
}

function normalizeSummary(
  value: TaskActivitySummary | null | undefined,
  field: string,
): TaskActivitySummary | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new DomainError(
      'invalid_value',
      `${field} must be a flat structured summary.`,
      { field },
    );
  }

  const summary: Record<string, TaskActivitySummaryValue> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new DomainError(
        'invalid_value',
        `${field} must use non-empty string keys.`,
        { field },
      );
    }
    const item = value[key];
    if (
      item !== null &&
      typeof item !== 'string' &&
      typeof item !== 'number' &&
      typeof item !== 'boolean'
    ) {
      throw new DomainError(
        'invalid_value',
        `${field} values must be scalar JSON values.`,
        { field },
      );
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      throw new DomainError(
        'invalid_value',
        `${field} numbers must be finite.`,
        { field },
      );
    }
    summary[key] = item;
  }
  return summary;
}

export function assertValidTaskActivityEvent(event: TaskActivityEvent): void {
  parseTaskActivityEventId(event.id);
  parseTaskId(event.taskId);
  if (event.timeBlockId !== null) parseTimeBlockId(event.timeBlockId);
  requireNonEmptyString(event.eventType, 'eventType');
  requireNonEmptyString(event.actor, 'actor');
  parseInstant(event.occurredAt);
  parseLocalDate(event.localDate);
  parseTimeZoneId(event.timeZone);
  parseOperationId(event.operationId);
  normalizeSummary(event.beforeSummary, 'beforeSummary');
  normalizeSummary(event.afterSummary, 'afterSummary');
}

export function createTaskActivityEvent(
  input: CreateTaskActivityEventFields,
): TaskActivityEvent {
  const event: TaskActivityEvent = {
    id: parseTaskActivityEventId(input.id),
    taskId: parseTaskId(input.taskId),
    timeBlockId:
      input.timeBlockId === null || input.timeBlockId === undefined
        ? null
        : parseTimeBlockId(input.timeBlockId),
    eventType: requireNonEmptyString(input.eventType, 'eventType'),
    actor: requireNonEmptyString(input.actor, 'actor'),
    occurredAt: parseInstant(input.occurredAt),
    localDate: parseLocalDate(input.localDate),
    timeZone: parseTimeZoneId(input.timeZone),
    operationId: parseOperationId(input.operationId),
    beforeSummary: normalizeSummary(input.beforeSummary, 'beforeSummary'),
    afterSummary: normalizeSummary(input.afterSummary, 'afterSummary'),
  };
  assertValidTaskActivityEvent(event);
  return event;
}

export interface OperationRecord {
  readonly operationId: OperationId;
  readonly command: string;
  readonly parameterHash: string;
  readonly resultJson: string;
  readonly baseStateVersion: number | null;
  readonly currentStateVersion: number;
  readonly occurredAt: Instant;
  readonly diffJson: string | null;
}

export interface CreateOperationRecordFields {
  readonly operationId: OperationId;
  readonly command: string;
  readonly parameterHash: string;
  readonly resultJson: string;
  readonly baseStateVersion?: number | null;
  readonly currentStateVersion: number;
  readonly occurredAt: Instant;
  readonly diffJson?: string | null;
}

function requireJson(value: string, field: string): string {
  requireNonEmptyString(value, field);
  try {
    JSON.parse(value);
  } catch {
    throw new DomainError(
      'invalid_value',
      `${field} must contain valid JSON.`,
      {
        field,
      },
    );
  }
  return value;
}

export function assertValidOperationRecord(record: OperationRecord): void {
  parseOperationId(record.operationId);
  requireNonEmptyString(record.command, 'command');
  requireNonEmptyString(record.parameterHash, 'parameterHash');
  requireJson(record.resultJson, 'resultJson');
  if (record.baseStateVersion !== null) {
    requireNonNegativeInteger(record.baseStateVersion, 'baseStateVersion');
  }
  requireNonNegativeInteger(record.currentStateVersion, 'currentStateVersion');
  if (
    record.baseStateVersion !== null &&
    record.currentStateVersion < record.baseStateVersion
  ) {
    throw new DomainError(
      'invariant_violation',
      'currentStateVersion must not precede baseStateVersion.',
      { operationId: record.operationId },
    );
  }
  parseInstant(record.occurredAt);
  if (record.diffJson !== null) requireJson(record.diffJson, 'diffJson');
}

export function createOperationRecord(
  input: CreateOperationRecordFields,
): OperationRecord {
  const record: OperationRecord = {
    operationId: parseOperationId(input.operationId),
    command: requireNonEmptyString(input.command, 'command'),
    parameterHash: requireNonEmptyString(input.parameterHash, 'parameterHash'),
    resultJson: requireJson(input.resultJson, 'resultJson'),
    baseStateVersion:
      input.baseStateVersion === null || input.baseStateVersion === undefined
        ? null
        : requireNonNegativeInteger(input.baseStateVersion, 'baseStateVersion'),
    currentStateVersion: requireNonNegativeInteger(
      input.currentStateVersion,
      'currentStateVersion',
    ),
    occurredAt: parseInstant(input.occurredAt),
    diffJson:
      input.diffJson === null || input.diffJson === undefined
        ? null
        : requireJson(input.diffJson, 'diffJson'),
  };
  assertValidOperationRecord(record);
  return record;
}
