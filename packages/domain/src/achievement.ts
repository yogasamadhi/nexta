import { DomainError } from './errors';
import {
  type AchievementId,
  type CompletionRecordId,
  type ExecutionSessionId,
  type Instant,
  parseAchievementId,
  parseCompletionRecordId,
  parseExecutionSessionId,
  parseInstant,
  parseTaskId,
  requireNonEmptyString,
  type TaskId,
} from './value-objects';

export interface Achievement {
  readonly id: AchievementId;
  readonly sourceCompletionRecordId: CompletionRecordId;
  readonly sourceTaskId: TaskId;
  readonly sourceExecutionSessionId: ExecutionSessionId | null;
  readonly title: string;
  readonly summary: string | null;
  readonly evidenceType: string;
  readonly occurredAt: Instant;
  readonly userEdited: boolean;
  readonly hidden: boolean;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

function optionalSummary(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  return value.trim();
}

export function assertValidAchievement(achievement: Achievement): void {
  parseAchievementId(achievement.id);
  parseCompletionRecordId(achievement.sourceCompletionRecordId);
  parseTaskId(achievement.sourceTaskId);
  if (achievement.sourceExecutionSessionId !== null)
    parseExecutionSessionId(achievement.sourceExecutionSessionId);
  requireNonEmptyString(achievement.title, 'Achievement title');
  if (achievement.summary !== null && typeof achievement.summary !== 'string') {
    throw new DomainError(
      'invalid_value',
      'Achievement summary must be text or null.',
    );
  }
  requireNonEmptyString(achievement.evidenceType, 'Achievement evidenceType');
  parseInstant(achievement.occurredAt);
  parseInstant(achievement.createdAt);
  parseInstant(achievement.updatedAt);
  if (
    typeof achievement.userEdited !== 'boolean' ||
    typeof achievement.hidden !== 'boolean'
  ) {
    throw new DomainError(
      'invalid_value',
      'Achievement flags must be boolean.',
    );
  }
}

export function createAchievement(input: {
  id: AchievementId;
  sourceCompletionRecordId: CompletionRecordId;
  sourceTaskId: TaskId;
  sourceExecutionSessionId?: ExecutionSessionId | null;
  title: string;
  summary?: string | null;
  evidenceType: string;
  occurredAt: Instant;
  userEdited?: boolean;
  createdAt: Instant;
}): Achievement {
  const achievement: Achievement = {
    id: parseAchievementId(input.id),
    sourceCompletionRecordId: parseCompletionRecordId(
      input.sourceCompletionRecordId,
    ),
    sourceTaskId: parseTaskId(input.sourceTaskId),
    sourceExecutionSessionId:
      input.sourceExecutionSessionId === null ||
      input.sourceExecutionSessionId === undefined
        ? null
        : parseExecutionSessionId(input.sourceExecutionSessionId),
    title: requireNonEmptyString(input.title, 'Achievement title'),
    summary: optionalSummary(input.summary),
    evidenceType: requireNonEmptyString(
      input.evidenceType,
      'Achievement evidenceType',
    ),
    occurredAt: parseInstant(input.occurredAt),
    userEdited: input.userEdited ?? false,
    hidden: false,
    createdAt: parseInstant(input.createdAt),
    updatedAt: parseInstant(input.createdAt),
  };
  assertValidAchievement(achievement);
  return achievement;
}

export function updateAchievement(
  achievement: Achievement,
  patch: Readonly<{ title?: string; summary?: string | null }>,
  updatedAt: Instant,
): Achievement {
  assertValidAchievement(achievement);
  if (Object.keys(patch).length === 0) {
    throw new DomainError('invalid_value', 'Achievement patch is empty.');
  }
  const next: Achievement = {
    ...achievement,
    title:
      patch.title === undefined
        ? achievement.title
        : requireNonEmptyString(patch.title, 'Achievement title'),
    summary:
      patch.summary === undefined
        ? achievement.summary
        : optionalSummary(patch.summary),
    userEdited: true,
    updatedAt: parseInstant(updatedAt),
  };
  assertValidAchievement(next);
  return next;
}

export function setAchievementHidden(
  achievement: Achievement,
  hidden: boolean,
  updatedAt: Instant,
): Achievement {
  assertValidAchievement(achievement);
  if (typeof hidden !== 'boolean') {
    throw new DomainError(
      'invalid_value',
      'Achievement hidden must be boolean.',
    );
  }
  const next = {
    ...achievement,
    hidden,
    updatedAt: parseInstant(updatedAt),
  };
  assertValidAchievement(next);
  return next;
}
