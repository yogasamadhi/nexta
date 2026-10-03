import type { Task } from '@workspace/domain';

import type { IntlTemporalAdapter } from '../runtime/intl-temporal-adapter';

export type TaskConstraintDraft = Readonly<{
  earliestDate: string;
  earliestTime: string;
  deadlineDate: string;
  deadlineTime: string;
  splittable: boolean;
  minBlockMinutes: string;
  maxBlockMinutes: string;
  categoryKey: string;
  energyDemand: string;
}>;

export type TaskConstraintValues = Readonly<{
  earliestStartAt: string | null;
  deadlineAt: string | null;
  deadlineLocalDate: string | null;
  deadlineTimeZone: string | null;
  splittable: boolean;
  minBlockMinutes: number | null;
  maxBlockMinutes: number | null;
  categoryKey: string | null;
  energyDemand: string | null;
}>;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const dashVariants = /[‐‑‒–—―﹘﹣－]/g;

export function normalizeLocalDateInput(value: string): string {
  return value.trim().replace(dashVariants, '-');
}

function normalizedTime(value: string): string {
  return value.trim().replaceAll('：', ':');
}

export class TaskConstraintDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskConstraintDraftError';
  }
}

export function emptyTaskConstraintDraft(): TaskConstraintDraft {
  return {
    earliestDate: '',
    earliestTime: '',
    deadlineDate: '',
    deadlineTime: '',
    splittable: false,
    minBlockMinutes: '',
    maxBlockMinutes: '',
    categoryKey: '',
    energyDemand: '',
  };
}

function localParts(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.get('year')}-${values.get('month')}-${values.get('day')}`,
    time: `${values.get('hour')}:${values.get('minute')}`,
  };
}

export function taskConstraintDraftFromTask(
  task: Task,
  temporal: IntlTemporalAdapter,
): TaskConstraintDraft {
  const currentZone = temporal.currentTimeZone();
  const earliest =
    task.earliestStartAt === null
      ? null
      : localParts(task.earliestStartAt, currentZone);
  const deadline =
    task.deadlineAt === null
      ? null
      : localParts(task.deadlineAt, task.deadlineTimeZone ?? currentZone);
  return {
    earliestDate: earliest?.date ?? '',
    earliestTime: earliest?.time ?? '',
    deadlineDate: deadline?.date ?? task.deadlineLocalDate ?? '',
    deadlineTime: deadline?.time ?? '',
    splittable: task.splittable,
    minBlockMinutes: task.minBlockMinutes?.toString() ?? '',
    maxBlockMinutes: task.maxBlockMinutes?.toString() ?? '',
    categoryKey: task.categoryKey ?? '',
    energyDemand: task.energyDemand ?? '',
  };
}

function optionalPositiveMinutes(raw: string, label: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new TaskConstraintDraftError(`${label}必须是大于 0 的分钟数。`);
  }
  return value;
}

function resolveExactLocalDateTime(
  date: string,
  time: string,
  label: string,
  temporal: IntlTemporalAdapter,
): string | null {
  const parsedDate = normalizeLocalDateInput(date);
  const parsedTime = normalizedTime(time);
  if (parsedDate === '' && parsedTime === '') return null;
  if (!datePattern.test(parsedDate) || !timePattern.test(parsedTime)) {
    throw new TaskConstraintDraftError(
      `${label}需要同时填写 YYYY-MM-DD 日期和 HH:MM 时间。`,
    );
  }
  try {
    return temporal.resolveLocalDateTime({
      localDate: parsedDate,
      localTime: parsedTime,
      timeZone: temporal.currentTimeZone(),
    }).instant;
  } catch {
    throw new TaskConstraintDraftError(
      `${label}在当前时区不存在或存在重复，请换一个时间。`,
    );
  }
}

export function parseTaskConstraintDraft(
  draft: TaskConstraintDraft,
  temporal: IntlTemporalAdapter,
): TaskConstraintValues {
  const earliestStartAt = resolveExactLocalDateTime(
    draft.earliestDate,
    draft.earliestTime,
    '最早开始',
    temporal,
  );
  const normalizedDeadlineDate = normalizeLocalDateInput(draft.deadlineDate);
  const normalizedDeadlineTime = normalizedTime(draft.deadlineTime);
  let deadlineAt: string | null = null;
  let deadlineLocalDate: string | null = null;
  let deadlineTimeZone: string | null = null;
  if (normalizedDeadlineDate !== '' || normalizedDeadlineTime !== '') {
    if (!datePattern.test(normalizedDeadlineDate)) {
      throw new TaskConstraintDraftError('截止日期必须使用 YYYY-MM-DD。');
    }
    if (normalizedDeadlineTime === '') {
      deadlineLocalDate = normalizedDeadlineDate;
      deadlineTimeZone = temporal.currentTimeZone();
    } else {
      deadlineAt = resolveExactLocalDateTime(
        normalizedDeadlineDate,
        normalizedDeadlineTime,
        '截止时间',
        temporal,
      );
    }
  }

  if (
    earliestStartAt !== null &&
    deadlineAt !== null &&
    Date.parse(deadlineAt) < Date.parse(earliestStartAt)
  ) {
    throw new TaskConstraintDraftError('截止时间不能早于最早开始时间。');
  }
  if (
    earliestStartAt !== null &&
    deadlineLocalDate !== null &&
    normalizeLocalDateInput(draft.earliestDate) > deadlineLocalDate
  ) {
    throw new TaskConstraintDraftError('截止日期不能早于最早开始日期。');
  }

  const minBlockMinutes = optionalPositiveMinutes(
    draft.minBlockMinutes,
    '最短时间块',
  );
  const maxBlockMinutes = optionalPositiveMinutes(
    draft.maxBlockMinutes,
    '最长时间块',
  );
  if (
    minBlockMinutes !== null &&
    maxBlockMinutes !== null &&
    minBlockMinutes > maxBlockMinutes
  ) {
    throw new TaskConstraintDraftError('最短时间块不能大于最长时间块。');
  }

  return {
    earliestStartAt,
    deadlineAt,
    deadlineLocalDate,
    deadlineTimeZone,
    splittable: draft.splittable,
    minBlockMinutes,
    maxBlockMinutes,
    categoryKey: draft.categoryKey.trim() || null,
    energyDemand: draft.energyDemand.trim() || null,
  };
}

export function hasDateOnlyDeadline(values: TaskConstraintValues): boolean {
  return values.deadlineLocalDate !== null && values.deadlineAt === null;
}
