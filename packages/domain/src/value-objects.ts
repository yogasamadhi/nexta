import { DomainError } from './errors';

declare const domainBrand: unique symbol;

type Brand<Value, Name extends string> = Value & {
  readonly [domainBrand]: Name;
};

export type GoalId = Brand<string, 'GoalId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type CompletionRecordId = Brand<string, 'CompletionRecordId'>;
export type TaskActivityEventId = Brand<string, 'TaskActivityEventId'>;
export type TimeBlockId = Brand<string, 'TimeBlockId'>;
export type SchedulePlanId = Brand<string, 'SchedulePlanId'>;
export type IntegrationJobId = Brand<string, 'IntegrationJobId'>;
export type ExternalCalendarEventSnapshotId = Brand<
  string,
  'ExternalCalendarEventSnapshotId'
>;
export type CalendarRefreshCoverageId = Brand<
  string,
  'CalendarRefreshCoverageId'
>;
export type CalendarContainerBindingId = Brand<
  string,
  'CalendarContainerBindingId'
>;
export type CalendarBindingId = Brand<string, 'CalendarBindingId'>;
export type NotificationBindingId = Brand<string, 'NotificationBindingId'>;
export type ExternalMutationIntentId = Brand<
  string,
  'ExternalMutationIntentId'
>;
export type UserPreferenceId = Brand<string, 'UserPreferenceId'>;
export type ExecutionSessionId = Brand<string, 'ExecutionSessionId'>;
export type ExecutionIntervalId = Brand<string, 'ExecutionIntervalId'>;
export type AchievementId = Brand<string, 'AchievementId'>;
export type AgentRunId = Brand<string, 'AgentRunId'>;
export type UserModelFeatureId = Brand<string, 'UserModelFeatureId'>;
export type DailyReflectionId = Brand<string, 'DailyReflectionId'>;
export type EnergyCheckInId = Brand<string, 'EnergyCheckInId'>;
export type RelaxSessionId = Brand<string, 'RelaxSessionId'>;
export type OperationId = Brand<string, 'OperationId'>;

/** Canonical UTC instant persisted as an ISO-8601 string ending in `Z`. */
export type Instant = Brand<string, 'Instant'>;

/** Calendar date with no implied UTC offset, formatted as YYYY-MM-DD. */
export type LocalDate = Brand<string, 'LocalDate'>;

/** IANA time-zone identifier, for example `Asia/Shanghai`. */
export type TimeZoneId = Brand<string, 'TimeZoneId'>;

function invalidValue(field: string, rule: string): never {
  throw new DomainError('invalid_value', `${field} ${rule}.`, { field });
}

export function requireNonEmptyString(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidValue(field, 'must be a non-empty string');
  }
  return value.trim();
}

function parseId<Name extends string>(
  value: string,
  field: string,
): Brand<string, Name> {
  return requireNonEmptyString(value, field) as Brand<string, Name>;
}

export function parseGoalId(value: string): GoalId {
  return parseId<'GoalId'>(value, 'goalId');
}

export function parseProjectId(value: string): ProjectId {
  return parseId<'ProjectId'>(value, 'projectId');
}

export function parseTaskId(value: string): TaskId {
  return parseId<'TaskId'>(value, 'taskId');
}

export function parseCompletionRecordId(value: string): CompletionRecordId {
  return parseId<'CompletionRecordId'>(value, 'completionRecordId');
}

export function parseTaskActivityEventId(value: string): TaskActivityEventId {
  return parseId<'TaskActivityEventId'>(value, 'taskActivityEventId');
}

export function parseTimeBlockId(value: string): TimeBlockId {
  return parseId<'TimeBlockId'>(value, 'timeBlockId');
}

export function parseSchedulePlanId(value: string): SchedulePlanId {
  return parseId<'SchedulePlanId'>(value, 'schedulePlanId');
}

export function parseIntegrationJobId(value: string): IntegrationJobId {
  return parseId<'IntegrationJobId'>(value, 'integrationJobId');
}

export function parseExternalCalendarEventSnapshotId(
  value: string,
): ExternalCalendarEventSnapshotId {
  return parseId<'ExternalCalendarEventSnapshotId'>(
    value,
    'externalCalendarEventSnapshotId',
  );
}

export function parseCalendarRefreshCoverageId(
  value: string,
): CalendarRefreshCoverageId {
  return parseId<'CalendarRefreshCoverageId'>(
    value,
    'calendarRefreshCoverageId',
  );
}

export function parseCalendarContainerBindingId(
  value: string,
): CalendarContainerBindingId {
  return parseId<'CalendarContainerBindingId'>(
    value,
    'calendarContainerBindingId',
  );
}

export function parseCalendarBindingId(value: string): CalendarBindingId {
  return parseId<'CalendarBindingId'>(value, 'calendarBindingId');
}

export function parseNotificationBindingId(
  value: string,
): NotificationBindingId {
  return parseId<'NotificationBindingId'>(value, 'notificationBindingId');
}

export function parseExternalMutationIntentId(
  value: string,
): ExternalMutationIntentId {
  return parseId<'ExternalMutationIntentId'>(value, 'externalMutationIntentId');
}

export function parseUserPreferenceId(value: string): UserPreferenceId {
  return parseId<'UserPreferenceId'>(value, 'userPreferenceId');
}

export function parseExecutionSessionId(value: string): ExecutionSessionId {
  return parseId<'ExecutionSessionId'>(value, 'executionSessionId');
}

export function parseExecutionIntervalId(value: string): ExecutionIntervalId {
  return parseId<'ExecutionIntervalId'>(value, 'executionIntervalId');
}

export function parseAchievementId(value: string): AchievementId {
  return parseId<'AchievementId'>(value, 'achievementId');
}

export function parseAgentRunId(value: string): AgentRunId {
  return parseId<'AgentRunId'>(value, 'agentRunId');
}

export function parseUserModelFeatureId(value: string): UserModelFeatureId {
  return parseId<'UserModelFeatureId'>(value, 'userModelFeatureId');
}

export function parseDailyReflectionId(value: string): DailyReflectionId {
  return parseId<'DailyReflectionId'>(value, 'dailyReflectionId');
}

export function parseEnergyCheckInId(value: string): EnergyCheckInId {
  return parseId<'EnergyCheckInId'>(value, 'energyCheckInId');
}

export function parseRelaxSessionId(value: string): RelaxSessionId {
  return parseId<'RelaxSessionId'>(value, 'relaxSessionId');
}

export function parseOperationId(value: string): OperationId {
  return parseId<'OperationId'>(value, 'operationId');
}

const UTC_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

export function parseInstant(value: string): Instant {
  if (typeof value !== 'string') {
    return invalidValue('instant', 'must be a canonical UTC instant');
  }

  const match = UTC_INSTANT_PATTERN.exec(value);
  if (match === null) {
    return invalidValue(
      'instant',
      'must be an ISO-8601 UTC instant ending in Z',
    );
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return invalidValue('instant', 'must represent a real UTC instant');
  }

  const parsed = new Date(timestamp);
  const expectedParts = [
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds(),
  ];
  const inputParts = match
    .slice(1, 7)
    .map((part) => Number.parseInt(part ?? '', 10));

  if (expectedParts.some((part, index) => part !== inputParts[index])) {
    return invalidValue('instant', 'must represent a real UTC instant');
  }

  return parsed.toISOString() as Instant;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(value: string): LocalDate {
  if (typeof value !== 'string') {
    return invalidValue('localDate', 'must use YYYY-MM-DD');
  }

  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) {
    return invalidValue('localDate', 'must use YYYY-MM-DD');
  }

  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return invalidValue('localDate', 'must represent a real calendar date');
  }

  return value as LocalDate;
}

export function parseTimeZoneId(value: string): TimeZoneId {
  const timeZone = requireNonEmptyString(value, 'timeZone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    return invalidValue('timeZone', 'must be a supported IANA time zone');
  }
  return timeZone as TimeZoneId;
}

export function compareInstants(left: Instant, right: Instant): number {
  return Date.parse(left) - Date.parse(right);
}

export function requireFiniteNumber(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidValue(field, 'must be finite');
  }
  return value;
}

export function requirePositiveNumber(value: number, field: string): number {
  if (requireFiniteNumber(value, field) <= 0) {
    return invalidValue(field, 'must be greater than zero');
  }
  return value;
}

export function requireNonNegativeNumber(value: number, field: string): number {
  if (requireFiniteNumber(value, field) < 0) {
    return invalidValue(field, 'must not be negative');
  }
  return value;
}

export function requireNonNegativeInteger(
  value: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    return invalidValue(field, 'must be a non-negative safe integer');
  }
  return value;
}
