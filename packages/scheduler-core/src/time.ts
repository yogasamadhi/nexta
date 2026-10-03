import type { Instant } from './types';

const UTC_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export function parseInstantMilliseconds(value: string): number | null {
  const match = UTC_INSTANT_PATTERN.exec(value);
  if (match === null) return null;

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const parsed = new Date(timestamp);
  const expectedParts = [
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
    parsed.getUTCHours(),
    parsed.getUTCMinutes(),
    parsed.getUTCSeconds(),
  ];
  const actualParts = match
    .slice(1, 7)
    .map((part) => Number.parseInt(part ?? '', 10));

  return expectedParts.some((part, index) => part !== actualParts[index])
    ? null
    : timestamp;
}

export function formatInstant(timestamp: number): Instant {
  return new Date(timestamp).toISOString();
}

export function minutesToMilliseconds(minutes: number): number {
  return minutes * 60_000;
}

export function millisecondsToMinutes(milliseconds: number): number {
  return milliseconds / 60_000;
}

export type NumericInterval = Readonly<{
  start: number;
  end: number;
}>;

export function overlaps(
  left: NumericInterval,
  right: NumericInterval,
): boolean {
  return left.start < right.end && right.start < left.end;
}

export function overlapMilliseconds(
  left: NumericInterval,
  right: NumericInterval,
): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

export function containsInterval(
  container: NumericInterval,
  candidate: NumericInterval,
): boolean {
  return container.start <= candidate.start && candidate.end <= container.end;
}

export function mergeIntervals(
  intervals: readonly NumericInterval[],
): NumericInterval[] {
  const sorted = [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: NumericInterval[] = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || previous.end < interval.start) {
      merged.push({ ...interval });
    } else if (interval.end > previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: interval.end };
    }
  }

  return merged;
}

export function subtractIntervals(
  container: NumericInterval,
  occupied: readonly NumericInterval[],
): NumericInterval[] {
  const result: NumericInterval[] = [];
  let cursor = container.start;

  // Only the intersection with this window matters. Avoid sorting the full
  // horizon's occupancy again for every candidate's capacity check.
  const relevant = occupied.filter(
    (interval) =>
      interval.end > container.start && interval.start < container.end,
  );
  for (const interval of mergeIntervals(relevant)) {
    if (interval.end <= cursor || interval.start >= container.end) continue;
    if (interval.start > cursor) {
      result.push({
        start: cursor,
        end: Math.min(interval.start, container.end),
      });
    }
    cursor = Math.max(cursor, interval.end);
    if (cursor >= container.end) break;
  }

  if (cursor < container.end)
    result.push({ start: cursor, end: container.end });
  return result;
}

export function alignAtOrAfter(
  timestamp: number,
  anchor: number,
  step: number,
): number {
  const offset = timestamp - anchor;
  const remainder = ((offset % step) + step) % step;
  return remainder === 0 ? timestamp : timestamp + step - remainder;
}
