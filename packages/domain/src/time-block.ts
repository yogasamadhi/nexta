import { DomainError } from './errors';
import {
  compareInstants,
  type Instant,
  parseInstant,
  parseTaskId,
  parseTimeBlockId,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type TaskId,
  type TimeBlockId,
} from './value-objects';

export const timeBlockTypes = ['task', 'break', 'relax', 'buffer'] as const;
export type TimeBlockType = (typeof timeBlockTypes)[number];

export const timeBlockStatuses = [
  'planned',
  'started',
  'completed',
  'skipped',
  'canceled',
] as const;
export type TimeBlockStatus = (typeof timeBlockStatuses)[number];

/** Open semantic value owned by the application/adapters. */
export type TimeBlockSource = string;

export interface TimeBlock {
  readonly id: TimeBlockId;
  readonly taskId: TaskId | null;
  readonly type: TimeBlockType;
  readonly startAt: Instant;
  readonly endAt: Instant;
  readonly status: TimeBlockStatus;
  readonly source: TimeBlockSource;
  readonly locked: boolean;
  readonly planRevision: number;
  readonly externalCalendarEventId: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateTimeBlockFields {
  readonly id: TimeBlockId;
  readonly taskId?: TaskId | null;
  readonly type: TimeBlockType;
  readonly startAt: Instant;
  readonly endAt: Instant;
  readonly status: TimeBlockStatus;
  readonly source: string;
  readonly locked: boolean;
  readonly planRevision: number;
  readonly externalCalendarEventId?: string | null;
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
      `TimeBlock ${field} is unsupported.`,
      {
        field,
      },
    );
  }
}

export function assertValidTimeBlock(block: TimeBlock): void {
  parseTimeBlockId(block.id);
  if (block.taskId !== null) parseTaskId(block.taskId);
  assertMember(block.type, timeBlockTypes, 'type');
  if (block.type === 'task' && block.taskId === null) {
    throw new DomainError(
      'invariant_violation',
      'A task TimeBlock must reference a Task.',
      { timeBlockId: block.id },
    );
  }
  assertMember(block.status, timeBlockStatuses, 'status');
  parseInstant(block.startAt);
  parseInstant(block.endAt);
  if (compareInstants(block.endAt, block.startAt) <= 0) {
    throw new DomainError(
      'invariant_violation',
      'TimeBlock endAt must be after startAt.',
      { timeBlockId: block.id },
    );
  }
  requireNonEmptyString(block.source, 'source');
  if (typeof block.locked !== 'boolean') {
    throw new DomainError(
      'invalid_value',
      'TimeBlock locked must be a boolean.',
      { field: 'locked' },
    );
  }
  requireNonNegativeInteger(block.planRevision, 'planRevision');
  if (block.externalCalendarEventId !== null) {
    requireNonEmptyString(
      block.externalCalendarEventId,
      'externalCalendarEventId',
    );
  }
  parseInstant(block.createdAt);
  parseInstant(block.updatedAt);
}

export function createTimeBlock(input: CreateTimeBlockFields): TimeBlock {
  const createdAt = parseInstant(input.createdAt);
  const block: TimeBlock = {
    id: parseTimeBlockId(input.id),
    taskId:
      input.taskId === null || input.taskId === undefined
        ? null
        : parseTaskId(input.taskId),
    type: input.type,
    startAt: parseInstant(input.startAt),
    endAt: parseInstant(input.endAt),
    status: input.status,
    source: requireNonEmptyString(input.source, 'source'),
    locked: input.locked,
    planRevision: requireNonNegativeInteger(input.planRevision, 'planRevision'),
    externalCalendarEventId:
      input.externalCalendarEventId === null ||
      input.externalCalendarEventId === undefined
        ? null
        : requireNonEmptyString(
            input.externalCalendarEventId,
            'externalCalendarEventId',
          ),
    createdAt,
    updatedAt: parseInstant(input.updatedAt ?? createdAt),
  };
  assertValidTimeBlock(block);
  return block;
}
