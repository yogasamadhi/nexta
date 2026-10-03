import {
  parseInstant,
  parseLocalDate,
  type Instant,
  type LocalDate,
  type TimeZoneId,
} from '@workspace/domain';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const OFFSET_SAMPLE_RADIUS_HOURS = 48;
const OFFSET_SAMPLE_STEP_HOURS = 6;
const MAX_EXPANSION_DAYS = 10_000;

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type LocalClockTime = string;
export type LocalDateTimeDisambiguation = 'earlier' | 'later';
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type IntlTemporalErrorCode =
  | 'ambiguous_local_time'
  | 'invalid_instant'
  | 'invalid_local_date'
  | 'invalid_local_time'
  | 'invalid_range'
  | 'invalid_time_zone'
  | 'invalid_working_hours'
  | 'nonexistent_local_time';

export class IntlTemporalError extends Error {
  readonly code: IntlTemporalErrorCode;

  constructor(code: IntlTemporalErrorCode, message: string) {
    super(message);
    this.name = 'IntlTemporalError';
    this.code = code;
  }
}

export type ResolvedInstant = Readonly<{
  localDate: LocalDate;
  timeZone: TimeZoneId;
}>;

export type LocalDateTimeInput = Readonly<{
  localDate: string;
  localTime: string;
  timeZone: string;
  disambiguation?: LocalDateTimeDisambiguation;
}>;

export type ResolvedLocalDateTime = Readonly<{
  instant: Instant;
  localDate: LocalDate;
  localTime: LocalClockTime;
  timeZone: TimeZoneId;
  offsetMinutes: number;
}>;

export type DayRangeInput = Readonly<{
  localDate: string;
  timeZone: string;
  startDisambiguation?: LocalDateTimeDisambiguation;
  endDisambiguation?: LocalDateTimeDisambiguation;
}>;

export type UtcTimeRange = Readonly<{
  start: Instant;
  end: Instant;
}>;

/**
 * A weekly rule is anchored to the local date on which it starts. An end time
 * earlier than the start time ends on the following local date. Equal
 * endpoints are rejected instead of being guessed as either zero or 24 hours.
 */
export type LocalWorkingHoursRule = Readonly<{
  id: string;
  weekdays: readonly IsoWeekday[];
  startLocalTime: string;
  endLocalTime: string;
  energyLevel?: string | null;
  startDisambiguation?: LocalDateTimeDisambiguation;
  endDisambiguation?: LocalDateTimeDisambiguation;
}>;

export type ExpandWorkingHoursInput = Readonly<{
  range: Readonly<{ start: string; end: string }>;
  timeZone: string;
  rules: readonly LocalWorkingHoursRule[];
}>;

export type ExpandedWorkingWindow = Readonly<{
  /** Stable for one rule occurrence, independent of input rule ordering. */
  id: string;
  sourceRuleId: string;
  localDate: LocalDate;
  start: Instant;
  end: Instant;
  energyLevel: string | null;
}>;

export type IntlTemporalAdapterOptions = Readonly<{
  /** Injectable for deterministic tests; the default reads the device zone. */
  currentTimeZone?: () => string;
}>;

type LocalParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

type ParsedLocalDateTime = LocalParts &
  Readonly<{
    localDate: LocalDate;
    localTime: LocalClockTime;
  }>;

function temporalError(code: IntlTemporalErrorCode, message: string): never {
  throw new IntlTemporalError(code, message);
}

function validateInstant(value: string, field: string): Instant {
  try {
    return parseInstant(value);
  } catch {
    return temporalError(
      'invalid_instant',
      `${field} must be a real canonical UTC instant.`,
    );
  }
}

function validateLocalDate(value: string): LocalDate {
  try {
    return parseLocalDate(value);
  } catch {
    return temporalError(
      'invalid_local_date',
      'localDate must be a real date in YYYY-MM-DD form.',
    );
  }
}

function validateLocalTime(value: string): LocalClockTime {
  if (!LOCAL_TIME_PATTERN.test(value)) {
    return temporalError(
      'invalid_local_time',
      'localTime must use canonical 24-hour HH:mm form.',
    );
  }
  return value;
}

function validateTimeZone(value: string): TimeZoneId {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return temporalError(
      'invalid_time_zone',
      'timeZone must be a supported IANA time-zone identifier.',
    );
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: value });
    if (formatter.resolvedOptions().timeZone.length === 0) {
      return temporalError(
        'invalid_time_zone',
        'timeZone must be a supported IANA time-zone identifier.',
      );
    }
  } catch {
    return temporalError(
      'invalid_time_zone',
      'timeZone must be a supported IANA time-zone identifier.',
    );
  }

  return value as TimeZoneId;
}

function createFormatter(timeZone: TimeZoneId): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function integerPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Intl did not provide a numeric ${type} part.`);
  }
  return parsed;
}

function localPartsAt(
  formatter: Intl.DateTimeFormat,
  epochMilliseconds: number,
): LocalParts {
  const parts = formatter.formatToParts(new Date(epochMilliseconds));
  return {
    year: integerPart(parts, 'year'),
    month: integerPart(parts, 'month'),
    day: integerPart(parts, 'day'),
    hour: integerPart(parts, 'hour'),
    minute: integerPart(parts, 'minute'),
    second: integerPart(parts, 'second'),
  };
}

function utcEpoch(parts: LocalParts): number {
  // Date.UTC treats years 0..99 as 1900..1999. setUTCFullYear preserves the
  // actual proleptic Gregorian year and still avoids parsing offset-less text.
  const value = new Date(0);
  value.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return value.getTime();
}

function sameLocalParts(left: LocalParts, right: LocalParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function parseLocalDateTime(input: LocalDateTimeInput): ParsedLocalDateTime {
  const localDate = validateLocalDate(input.localDate);
  const localTime = validateLocalTime(input.localTime);
  const dateParts = localDate
    .split('-')
    .map((part) => Number.parseInt(part, 10));
  const timeParts = localTime
    .split(':')
    .map((part) => Number.parseInt(part, 10));

  return {
    year: dateParts[0]!,
    month: dateParts[1]!,
    day: dateParts[2]!,
    hour: timeParts[0]!,
    minute: timeParts[1]!,
    second: 0,
    localDate,
    localTime,
  };
}

function formatLocalDate(parts: Pick<LocalParts, 'year' | 'month' | 'day'>) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addLocalDays(localDate: LocalDate, days: number): LocalDate {
  const [year, month, day] = localDate
    .split('-')
    .map((part) => Number.parseInt(part, 10));
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year!, month! - 1, day! + days);
  return validateLocalDate(
    formatLocalDate({
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    }),
  );
}

function isoWeekday(localDate: LocalDate): IsoWeekday {
  const [year, month, day] = localDate
    .split('-')
    .map((part) => Number.parseInt(part, 10));
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year!, month! - 1, day!);
  const weekday = value.getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateDisambiguation(
  value: LocalDateTimeDisambiguation | undefined,
): void {
  if (value !== undefined && value !== 'earlier' && value !== 'later') {
    temporalError(
      'invalid_local_time',
      'disambiguation must be either earlier or later.',
    );
  }
}

function offsetMillisecondsAt(
  formatter: Intl.DateTimeFormat,
  epochMilliseconds: number,
): number {
  const epochAtWholeSecond = Math.floor(epochMilliseconds / 1_000) * 1_000;
  return (
    utcEpoch(localPartsAt(formatter, epochAtWholeSecond)) - epochAtWholeSecond
  );
}

function possibleEpochs(
  formatter: Intl.DateTimeFormat,
  target: ParsedLocalDateTime,
): readonly number[] {
  const localAsUtc = utcEpoch(target);
  const offsets = new Set<number>();

  for (
    let hours = -OFFSET_SAMPLE_RADIUS_HOURS;
    hours <= OFFSET_SAMPLE_RADIUS_HOURS;
    hours += OFFSET_SAMPLE_STEP_HOURS
  ) {
    offsets.add(offsetMillisecondsAt(formatter, localAsUtc + hours * HOUR_MS));
  }

  const candidates = [...offsets]
    .map((offset) => localAsUtc - offset)
    .filter((epoch) => sameLocalParts(localPartsAt(formatter, epoch), target));

  return [...new Set(candidates)].sort((left, right) => left - right);
}

function validateRange(range: ExpandWorkingHoursInput['range']): UtcTimeRange {
  const start = validateInstant(range.start, 'range.start');
  const end = validateInstant(range.end, 'range.end');
  if (Date.parse(start) >= Date.parse(end)) {
    return temporalError(
      'invalid_range',
      'range must be a non-empty [start, end) UTC interval.',
    );
  }
  return { start, end };
}

function validateRule(rule: LocalWorkingHoursRule): void {
  if (rule.id.trim().length === 0) {
    temporalError(
      'invalid_working_hours',
      'Working-hours rule id is required.',
    );
  }
  if (rule.weekdays.length === 0) {
    temporalError(
      'invalid_working_hours',
      `Working-hours rule ${rule.id} must select at least one weekday.`,
    );
  }
  if (
    rule.weekdays.some(
      (weekday) => !Number.isInteger(weekday) || weekday < 1 || weekday > 7,
    )
  ) {
    temporalError(
      'invalid_working_hours',
      `Working-hours rule ${rule.id} has an invalid ISO weekday.`,
    );
  }
  const start = validateLocalTime(rule.startLocalTime);
  const end = validateLocalTime(rule.endLocalTime);
  if (start === end) {
    temporalError(
      'invalid_working_hours',
      `Working-hours rule ${rule.id} must not have equal endpoints.`,
    );
  }
  validateDisambiguation(rule.startDisambiguation);
  validateDisambiguation(rule.endDisambiguation);
}

/**
 * Intl-based local-time boundary for Hermes. It only parses canonical UTC
 * instants; local wall time is resolved through formatToParts and verified
 * candidate offsets, never through `new Date("YYYY-MM-DDTHH:mm")`.
 */
export class IntlTemporalAdapter {
  readonly #currentTimeZone: () => string;
  readonly #formatters = new Map<string, Intl.DateTimeFormat>();

  constructor(options: IntlTemporalAdapterOptions = {}) {
    this.#currentTimeZone =
      options.currentTimeZone ??
      (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  }

  currentTimeZone(): TimeZoneId {
    return validateTimeZone(this.#currentTimeZone());
  }

  resolve(instant: Instant): ResolvedInstant {
    const parsedInstant = validateInstant(instant, 'instant');
    const timeZone = this.currentTimeZone();
    const parts = localPartsAt(
      this.#formatter(timeZone),
      Date.parse(parsedInstant),
    );
    return {
      localDate: validateLocalDate(formatLocalDate(parts)),
      timeZone,
    };
  }

  hourAt(instant: Instant, timeZone: TimeZoneId): number {
    const parsedInstant = validateInstant(instant, 'instant');
    const zone = validateTimeZone(timeZone);
    return localPartsAt(this.#formatter(zone), Date.parse(parsedInstant)).hour;
  }

  resolveLocalDateTime(input: LocalDateTimeInput): ResolvedLocalDateTime {
    validateDisambiguation(input.disambiguation);
    const target = parseLocalDateTime(input);
    const timeZone = validateTimeZone(input.timeZone);
    const formatter = this.#formatter(timeZone);
    const candidates = possibleEpochs(formatter, target);

    if (candidates.length === 0) {
      return temporalError(
        'nonexistent_local_time',
        `${target.localDate} ${target.localTime} does not exist in ${timeZone}.`,
      );
    }
    if (candidates.length > 1 && input.disambiguation === undefined) {
      return temporalError(
        'ambiguous_local_time',
        `${target.localDate} ${target.localTime} occurs more than once in ${timeZone}; choose earlier or later.`,
      );
    }

    const epoch =
      input.disambiguation === 'later'
        ? candidates[candidates.length - 1]!
        : candidates[0]!;
    return {
      instant: validateInstant(
        new Date(epoch).toISOString(),
        'resolved instant',
      ),
      localDate: target.localDate,
      localTime: target.localTime,
      timeZone,
      offsetMinutes: offsetMillisecondsAt(formatter, epoch) / MINUTE_MS,
    };
  }

  dayRange(input: DayRangeInput): UtcTimeRange {
    const localDate = validateLocalDate(input.localDate);
    const timeZone = validateTimeZone(input.timeZone);
    const nextLocalDate = addLocalDays(localDate, 1);
    const start = this.resolveLocalDateTime({
      localDate,
      localTime: '00:00',
      timeZone,
      disambiguation: input.startDisambiguation,
    }).instant;
    const end = this.resolveLocalDateTime({
      localDate: nextLocalDate,
      localTime: '00:00',
      timeZone,
      disambiguation: input.endDisambiguation,
    }).instant;

    if (Date.parse(start) >= Date.parse(end)) {
      return temporalError(
        'invalid_range',
        `Local day ${localDate} does not resolve to a positive UTC range in ${timeZone}.`,
      );
    }
    return { start, end };
  }

  expandWorkingHours(
    input: ExpandWorkingHoursInput,
  ): readonly ExpandedWorkingWindow[] {
    const range = validateRange(input.range);
    const timeZone = validateTimeZone(input.timeZone);
    const ruleIds = new Set<string>();
    for (const rule of input.rules) {
      validateRule(rule);
      if (ruleIds.has(rule.id)) {
        temporalError(
          'invalid_working_hours',
          `Working-hours rule id ${rule.id} is duplicated.`,
        );
      }
      ruleIds.add(rule.id);
    }

    const formatter = this.#formatter(timeZone);
    const rangeStartEpoch = Date.parse(range.start);
    const rangeEndEpoch = Date.parse(range.end);
    const firstCoveredDate = validateLocalDate(
      formatLocalDate(localPartsAt(formatter, rangeStartEpoch)),
    );
    const lastCoveredDate = validateLocalDate(
      formatLocalDate(localPartsAt(formatter, rangeEndEpoch - 1)),
    );
    let localDate = addLocalDays(firstCoveredDate, -1);
    let visitedDays = 0;
    const windows: ExpandedWorkingWindow[] = [];

    while (compareLocalDates(localDate, lastCoveredDate) <= 0) {
      visitedDays += 1;
      if (visitedDays > MAX_EXPANSION_DAYS) {
        return temporalError(
          'invalid_range',
          `Working-hours expansion exceeds ${MAX_EXPANSION_DAYS} local dates.`,
        );
      }

      const weekday = isoWeekday(localDate);
      for (const rule of input.rules) {
        if (!rule.weekdays.includes(weekday)) continue;

        const crossesMidnight = rule.endLocalTime < rule.startLocalTime;
        const endLocalDate = crossesMidnight
          ? addLocalDays(localDate, 1)
          : localDate;
        const resolvedStart = this.resolveLocalDateTime({
          localDate,
          localTime: rule.startLocalTime,
          timeZone,
          disambiguation: rule.startDisambiguation,
        }).instant;
        const resolvedEnd = this.resolveLocalDateTime({
          localDate: endLocalDate,
          localTime: rule.endLocalTime,
          timeZone,
          disambiguation: rule.endDisambiguation,
        }).instant;
        const resolvedStartEpoch = Date.parse(resolvedStart);
        const resolvedEndEpoch = Date.parse(resolvedEnd);

        if (resolvedStartEpoch >= resolvedEndEpoch) {
          return temporalError(
            'invalid_working_hours',
            `Working-hours rule ${rule.id} resolves to a non-positive interval on ${localDate}.`,
          );
        }

        const clippedStart = Math.max(resolvedStartEpoch, rangeStartEpoch);
        const clippedEnd = Math.min(resolvedEndEpoch, rangeEndEpoch);
        if (clippedStart >= clippedEnd) continue;

        windows.push({
          id: `${rule.id}@${localDate}`,
          sourceRuleId: rule.id,
          localDate,
          start: validateInstant(
            new Date(clippedStart).toISOString(),
            'working window start',
          ),
          end: validateInstant(
            new Date(clippedEnd).toISOString(),
            'working window end',
          ),
          energyLevel: rule.energyLevel ?? null,
        });
      }

      localDate = addLocalDays(localDate, 1);
    }

    return windows.sort(
      (left, right) =>
        Date.parse(left.start) - Date.parse(right.start) ||
        Date.parse(left.end) - Date.parse(right.end) ||
        left.id.localeCompare(right.id),
    );
  }

  #formatter(timeZone: TimeZoneId): Intl.DateTimeFormat {
    const existing = this.#formatters.get(timeZone);
    if (existing !== undefined) return existing;
    const formatter = createFormatter(timeZone);
    this.#formatters.set(timeZone, formatter);
    return formatter;
  }
}
