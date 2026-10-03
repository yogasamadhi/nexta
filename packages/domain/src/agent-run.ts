import { DomainError } from './errors';
import {
  parseAgentRunId,
  parseInstant,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type AgentRunId,
  type Instant,
} from './value-objects';

export const agentRunTriggerValues = [
  'user_input',
  'foreground_resume',
  'task_completed',
  'calendar_changed',
  'notification_opened',
  'background_window',
  'manual_replan',
] as const;

export const agentRunStatusValues = [
  'running',
  'completed',
  'max_turns',
  'max_tool_calls',
  'aborted',
  'failed',
] as const;

export type AgentRunTrigger = (typeof agentRunTriggerValues)[number];
export type AgentRunStatus = (typeof agentRunStatusValues)[number];

export type AgentRun = Readonly<{
  id: AgentRunId;
  startedAt: Instant;
  endedAt: Instant | null;
  status: AgentRunStatus;
  trigger: AgentRunTrigger;
  modelProvider: string | null;
  turnCount: number;
  errorCode: string | null;
}>;

function requireEnum<Value extends string>(
  value: string,
  values: readonly Value[],
  field: string,
): Value {
  if (!values.includes(value as Value)) {
    throw new DomainError('invalid_value', `${field} is unsupported.`, {
      field,
    });
  }
  return value as Value;
}

function optionalText(value: string | null | undefined, field: string) {
  return value === null || value === undefined
    ? null
    : requireNonEmptyString(value, field);
}

export function assertValidAgentRun(run: AgentRun): void {
  parseAgentRunId(run.id);
  parseInstant(run.startedAt);
  const status = requireEnum(run.status, agentRunStatusValues, 'status');
  requireEnum(run.trigger, agentRunTriggerValues, 'trigger');
  optionalText(run.modelProvider, 'modelProvider');
  requireNonNegativeInteger(run.turnCount, 'turnCount');
  optionalText(run.errorCode, 'errorCode');
  if (status === 'running') {
    if (run.endedAt !== null || run.errorCode !== null) {
      throw new DomainError(
        'invalid_transition',
        'A running AgentRun cannot have terminal metadata.',
      );
    }
    return;
  }
  if (run.endedAt === null) {
    throw new DomainError(
      'invalid_transition',
      'A terminal AgentRun requires endedAt.',
    );
  }
  parseInstant(run.endedAt);
  if (Date.parse(run.endedAt) < Date.parse(run.startedAt)) {
    throw new DomainError(
      'invalid_transition',
      'AgentRun endedAt cannot precede startedAt.',
    );
  }
  if (
    (status === 'failed' || status === 'aborted') !==
    (run.errorCode !== null)
  ) {
    throw new DomainError(
      'invalid_transition',
      'AgentRun error metadata does not match its status.',
    );
  }
}

export function createAgentRun(
  input: Readonly<{
    id: AgentRunId;
    startedAt: Instant;
    trigger: AgentRunTrigger;
    modelProvider?: string | null;
  }>,
): AgentRun {
  const run: AgentRun = {
    id: parseAgentRunId(input.id),
    startedAt: parseInstant(input.startedAt),
    endedAt: null,
    status: 'running',
    trigger: requireEnum(input.trigger, agentRunTriggerValues, 'trigger'),
    modelProvider: optionalText(input.modelProvider, 'modelProvider'),
    turnCount: 0,
    errorCode: null,
  };
  assertValidAgentRun(run);
  return run;
}

export function checkpointAgentRun(run: AgentRun, turnCount: number): AgentRun {
  assertValidAgentRun(run);
  const nextTurnCount = requireNonNegativeInteger(turnCount, 'turnCount');
  if (run.status !== 'running' || nextTurnCount < run.turnCount) {
    throw new DomainError(
      'invalid_transition',
      'AgentRun checkpoints must be monotonic while running.',
    );
  }
  const next = { ...run, turnCount: nextTurnCount };
  assertValidAgentRun(next);
  return next;
}

export function finishAgentRun(
  run: AgentRun,
  input: Readonly<{
    status: Exclude<AgentRunStatus, 'running'>;
    endedAt: Instant;
    turnCount: number;
    errorCode?: string | null;
  }>,
): AgentRun {
  assertValidAgentRun(run);
  if (run.status !== 'running') {
    throw new DomainError(
      'invalid_transition',
      'AgentRun is already terminal.',
    );
  }
  const next: AgentRun = {
    ...run,
    status: requireEnum(input.status, agentRunStatusValues, 'status'),
    endedAt: parseInstant(input.endedAt),
    turnCount: requireNonNegativeInteger(input.turnCount, 'turnCount'),
    errorCode: optionalText(input.errorCode, 'errorCode'),
  };
  assertValidAgentRun(next);
  return next;
}
