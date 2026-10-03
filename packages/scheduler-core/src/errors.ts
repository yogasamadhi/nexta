export type ScheduleValidationIssue = Readonly<{
  path: string;
  code: 'invalid_type' | 'invalid_value' | 'unknown_field' | 'duplicate';
  message: string;
}>;

export class ScheduleValidationError extends Error {
  readonly code = 'invalid_schedule_input' as const;
  readonly issues: readonly ScheduleValidationIssue[];

  constructor(issues: readonly ScheduleValidationIssue[]) {
    super(
      issues.length === 1
        ? `Invalid schedule input: ${issues[0]?.message ?? 'unknown issue'}`
        : `Invalid schedule input: ${issues.length} issues`,
    );
    this.name = 'ScheduleValidationError';
    this.issues = issues;
  }
}
