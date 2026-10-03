const minuteMs = 60_000;

export type TimelineAdjustmentKind = 'move' | 'resize_start' | 'resize_end';

export type TimelineAdjustment = Readonly<{
  startAt: string;
  endAt: string;
}>;

function instant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid.`);
  return parsed;
}

function snap(deltaMinutes: number, granularityMinutes: number): number {
  if (!Number.isFinite(deltaMinutes)) {
    throw new TypeError('deltaMinutes must be finite.');
  }
  if (!Number.isSafeInteger(granularityMinutes) || granularityMinutes <= 0) {
    throw new RangeError('granularityMinutes must be a positive integer.');
  }
  return Math.round(deltaMinutes / granularityMinutes) * granularityMinutes;
}

/** Pure elapsed-time gesture math. Local/DST interpretation stays adapter-side. */
export function adjustTimelineInterval(
  input: Readonly<{
    kind: TimelineAdjustmentKind;
    startAt: string;
    endAt: string;
    deltaMinutes: number;
    granularityMinutes: number;
    minimumMinutes: number;
  }>,
): TimelineAdjustment {
  const start = instant(input.startAt, 'startAt');
  const end = instant(input.endAt, 'endAt');
  if (end <= start) throw new RangeError('endAt must be after startAt.');
  if (
    !Number.isSafeInteger(input.minimumMinutes) ||
    input.minimumMinutes <= 0
  ) {
    throw new RangeError('minimumMinutes must be a positive integer.');
  }
  const delta = snap(input.deltaMinutes, input.granularityMinutes) * minuteMs;
  const minimum = input.minimumMinutes * minuteMs;
  let nextStart = start;
  let nextEnd = end;
  if (input.kind === 'move') {
    nextStart += delta;
    nextEnd += delta;
  } else if (input.kind === 'resize_start') {
    nextStart = Math.min(start + delta, end - minimum);
  } else {
    nextEnd = Math.max(end + delta, start + minimum);
  }
  return {
    startAt: new Date(nextStart).toISOString(),
    endAt: new Date(nextEnd).toISOString(),
  };
}
