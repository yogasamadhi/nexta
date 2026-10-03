import { DomainError } from './errors';
import {
  compareInstants,
  type ExecutionIntervalId,
  type ExecutionSessionId,
  type Instant,
  parseExecutionIntervalId,
  parseExecutionSessionId,
  parseInstant,
  parseTaskId,
  parseTimeBlockId,
  requireNonNegativeInteger,
  type TaskId,
  type TimeBlockId,
} from './value-objects';

export const executionSessionStatuses = [
  'running',
  'paused',
  'completed',
  'abandoned',
] as const;
export type ExecutionSessionStatus = (typeof executionSessionStatuses)[number];

export const executionCompletionTypes = [
  'finish_session',
  'complete_task',
] as const;
export type ExecutionCompletionType = (typeof executionCompletionTypes)[number];

export const executionIntervalKinds = ['work', 'pause'] as const;
export type ExecutionIntervalKind = (typeof executionIntervalKinds)[number];

export const executionTimingQualities = ['trusted', 'needs_review'] as const;
export type ExecutionTimingQuality = (typeof executionTimingQualities)[number];

export interface ExecutionSession {
  readonly id: ExecutionSessionId;
  readonly taskId: TaskId;
  readonly timeBlockId: TimeBlockId | null;
  readonly startedAt: Instant;
  readonly endedAt: Instant | null;
  readonly pausedDurationSeconds: number;
  readonly activeIntervalStartedAt: Instant | null;
  readonly pausedAt: Instant | null;
  readonly status: ExecutionSessionStatus;
  readonly completionType: ExecutionCompletionType | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface ExecutionInterval {
  readonly id: ExecutionIntervalId;
  readonly sessionId: ExecutionSessionId;
  readonly kind: ExecutionIntervalKind;
  readonly startAt: Instant;
  readonly endAt: Instant | null;
  readonly timingQuality: ExecutionTimingQuality;
}

function oneOf<Value extends string>(
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

export function assertValidExecutionSession(session: ExecutionSession): void {
  parseExecutionSessionId(session.id);
  parseTaskId(session.taskId);
  if (session.timeBlockId !== null) parseTimeBlockId(session.timeBlockId);
  parseInstant(session.startedAt);
  if (session.endedAt !== null) parseInstant(session.endedAt);
  if (session.activeIntervalStartedAt !== null)
    parseInstant(session.activeIntervalStartedAt);
  if (session.pausedAt !== null) parseInstant(session.pausedAt);
  parseInstant(session.createdAt);
  parseInstant(session.updatedAt);
  requireNonNegativeInteger(
    session.pausedDurationSeconds,
    'pausedDurationSeconds',
  );
  oneOf(session.status, executionSessionStatuses, 'ExecutionSession status');
  if (session.completionType !== null)
    oneOf(
      session.completionType,
      executionCompletionTypes,
      'ExecutionSession completionType',
    );
  if (
    session.endedAt !== null &&
    compareInstants(session.endedAt, session.startedAt) < 0
  ) {
    throw new DomainError(
      'invariant_violation',
      'ExecutionSession cannot end before it starts.',
    );
  }
  const validState =
    (session.status === 'running' &&
      session.endedAt === null &&
      session.activeIntervalStartedAt !== null &&
      session.pausedAt === null &&
      session.completionType === null) ||
    (session.status === 'paused' &&
      session.endedAt === null &&
      session.activeIntervalStartedAt === null &&
      session.pausedAt !== null &&
      session.completionType === null) ||
    (session.status === 'completed' &&
      session.endedAt !== null &&
      session.activeIntervalStartedAt === null &&
      session.pausedAt === null &&
      session.completionType !== null) ||
    (session.status === 'abandoned' &&
      session.endedAt !== null &&
      session.activeIntervalStartedAt === null &&
      session.pausedAt === null &&
      session.completionType === null);
  if (!validState) {
    throw new DomainError(
      'invariant_violation',
      'ExecutionSession lifecycle timestamps do not match its status.',
      { executionSessionId: session.id },
    );
  }
}

export function createExecutionSession(input: {
  id: ExecutionSessionId;
  taskId: TaskId;
  timeBlockId?: TimeBlockId | null;
  startedAt: Instant;
}): ExecutionSession {
  const startedAt = parseInstant(input.startedAt);
  const session: ExecutionSession = {
    id: parseExecutionSessionId(input.id),
    taskId: parseTaskId(input.taskId),
    timeBlockId:
      input.timeBlockId === null || input.timeBlockId === undefined
        ? null
        : parseTimeBlockId(input.timeBlockId),
    startedAt,
    endedAt: null,
    pausedDurationSeconds: 0,
    activeIntervalStartedAt: startedAt,
    pausedAt: null,
    status: 'running',
    completionType: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
  assertValidExecutionSession(session);
  return session;
}

function requireSessionStatus(
  session: ExecutionSession,
  expected: ExecutionSessionStatus,
  action: string,
) {
  assertValidExecutionSession(session);
  if (session.status !== expected) {
    throw new DomainError(
      'invalid_transition',
      `ExecutionSession cannot ${action} from ${session.status}.`,
      { executionSessionId: session.id },
    );
  }
}

export function pauseExecutionSession(
  session: ExecutionSession,
  pausedAt: Instant,
): ExecutionSession {
  requireSessionStatus(session, 'running', 'pause');
  const at = parseInstant(pausedAt);
  const next: ExecutionSession = {
    ...session,
    status: 'paused',
    activeIntervalStartedAt: null,
    pausedAt: at,
    updatedAt: at,
  };
  assertValidExecutionSession(next);
  return next;
}

export function resumeExecutionSession(
  session: ExecutionSession,
  resumedAt: Instant,
  additionalPausedDurationSeconds: number,
): ExecutionSession {
  requireSessionStatus(session, 'paused', 'resume');
  const at = parseInstant(resumedAt);
  const next: ExecutionSession = {
    ...session,
    status: 'running',
    pausedDurationSeconds:
      session.pausedDurationSeconds +
      requireNonNegativeInteger(
        additionalPausedDurationSeconds,
        'additionalPausedDurationSeconds',
      ),
    activeIntervalStartedAt: at,
    pausedAt: null,
    updatedAt: at,
  };
  assertValidExecutionSession(next);
  return next;
}

export function finishExecutionSession(
  session: ExecutionSession,
  endedAt: Instant,
  completionType: ExecutionCompletionType,
  additionalPausedDurationSeconds = 0,
): ExecutionSession {
  assertValidExecutionSession(session);
  if (session.status !== 'running' && session.status !== 'paused') {
    throw new DomainError(
      'invalid_transition',
      `ExecutionSession cannot finish from ${session.status}.`,
      { executionSessionId: session.id },
    );
  }
  oneOf(
    completionType,
    executionCompletionTypes,
    'ExecutionSession completionType',
  );
  const at = parseInstant(endedAt);
  const next: ExecutionSession = {
    ...session,
    status: 'completed',
    endedAt: at,
    pausedDurationSeconds:
      session.pausedDurationSeconds +
      requireNonNegativeInteger(
        additionalPausedDurationSeconds,
        'additionalPausedDurationSeconds',
      ),
    activeIntervalStartedAt: null,
    pausedAt: null,
    completionType,
    updatedAt: at,
  };
  assertValidExecutionSession(next);
  return next;
}

export function abandonExecutionSession(
  session: ExecutionSession,
  endedAt: Instant,
  additionalPausedDurationSeconds = 0,
): ExecutionSession {
  assertValidExecutionSession(session);
  if (session.status !== 'running' && session.status !== 'paused') {
    throw new DomainError(
      'invalid_transition',
      `ExecutionSession cannot be abandoned from ${session.status}.`,
      { executionSessionId: session.id },
    );
  }
  const at = parseInstant(endedAt);
  const next: ExecutionSession = {
    ...session,
    status: 'abandoned',
    endedAt: at,
    pausedDurationSeconds:
      session.pausedDurationSeconds +
      requireNonNegativeInteger(
        additionalPausedDurationSeconds,
        'additionalPausedDurationSeconds',
      ),
    activeIntervalStartedAt: null,
    pausedAt: null,
    completionType: null,
    updatedAt: at,
  };
  assertValidExecutionSession(next);
  return next;
}

export function assertValidExecutionInterval(
  interval: ExecutionInterval,
): void {
  parseExecutionIntervalId(interval.id);
  parseExecutionSessionId(interval.sessionId);
  oneOf(interval.kind, executionIntervalKinds, 'ExecutionInterval kind');
  oneOf(
    interval.timingQuality,
    executionTimingQualities,
    'ExecutionInterval timingQuality',
  );
  parseInstant(interval.startAt);
  if (interval.endAt !== null) {
    parseInstant(interval.endAt);
    if (compareInstants(interval.endAt, interval.startAt) < 0) {
      throw new DomainError(
        'invariant_violation',
        'ExecutionInterval cannot end before it starts.',
        { executionIntervalId: interval.id },
      );
    }
  }
}

export function createExecutionInterval(input: {
  id: ExecutionIntervalId;
  sessionId: ExecutionSessionId;
  kind: ExecutionIntervalKind;
  startAt: Instant;
}): ExecutionInterval {
  const interval: ExecutionInterval = {
    id: parseExecutionIntervalId(input.id),
    sessionId: parseExecutionSessionId(input.sessionId),
    kind: input.kind,
    startAt: parseInstant(input.startAt),
    endAt: null,
    timingQuality: 'trusted',
  };
  assertValidExecutionInterval(interval);
  return interval;
}

export function closeExecutionInterval(
  interval: ExecutionInterval,
  observedEndAt: Instant,
): ExecutionInterval {
  assertValidExecutionInterval(interval);
  if (interval.endAt !== null) {
    throw new DomainError(
      'invalid_transition',
      'ExecutionInterval is already closed.',
      { executionIntervalId: interval.id },
    );
  }
  const observed = parseInstant(observedEndAt);
  const regressed = compareInstants(observed, interval.startAt) < 0;
  const next: ExecutionInterval = {
    ...interval,
    endAt: regressed ? interval.startAt : observed,
    timingQuality: regressed ? 'needs_review' : interval.timingQuality,
  };
  assertValidExecutionInterval(next);
  return next;
}

export function executionIntervalSeconds(interval: ExecutionInterval): number {
  assertValidExecutionInterval(interval);
  if (interval.endAt === null || interval.timingQuality !== 'trusted') return 0;
  return Math.floor(
    (Date.parse(interval.endAt) - Date.parse(interval.startAt)) / 1_000,
  );
}
