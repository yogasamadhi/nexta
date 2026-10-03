const millisecondsPerMinute = 60_000;

export type TimelineItem = Readonly<{
  id: string;
  startAt: string;
  endAt: string;
}>;

export type TimelineItemLayout<Item extends TimelineItem = TimelineItem> =
  Readonly<{
    item: Item;
    top: number;
    height: number;
    visibleStartAt: string;
    visibleEndAt: string;
    continuesBefore: boolean;
    continuesAfter: boolean;
  }>;

export type TimelineLayoutInput<Item extends TimelineItem = TimelineItem> =
  Readonly<{
    rangeStart: string;
    rangeEnd: string;
    pixelsPerMinute: number;
    items: readonly Item[];
  }>;

function instantMilliseconds(value: string, field: string): number {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be an ISO instant string.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${field} must be a valid ISO instant.`);
  }
  return milliseconds;
}

function positivePixelsPerMinute(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('pixelsPerMinute must be a positive finite number.');
  }
  return value;
}

/**
 * Maps elapsed UTC minutes to the common vertical timeline scale.
 *
 * The caller supplies the local day's resolved start/end instants. This keeps
 * the geometry correct for 23, 24, 25, and fractional-DST-hour days without
 * duplicating time-zone resolution inside presentation code.
 */
export function minuteOffsetToPixels(
  instant: string,
  rangeStart: string,
  pixelsPerMinute: number,
): number {
  const scale = positivePixelsPerMinute(pixelsPerMinute);
  return (
    ((instantMilliseconds(instant, 'instant') -
      instantMilliseconds(rangeStart, 'rangeStart')) /
      millisecondsPerMinute) *
    scale
  );
}

/**
 * Produces deterministic, clipped vertical geometry for one timeline range.
 * Items outside the range are omitted and the source values are never mutated.
 */
export function layoutTimelineItems<Item extends TimelineItem>(
  input: TimelineLayoutInput<Item>,
): readonly TimelineItemLayout<Item>[] {
  const rangeStartMs = instantMilliseconds(input.rangeStart, 'rangeStart');
  const rangeEndMs = instantMilliseconds(input.rangeEnd, 'rangeEnd');
  const scale = positivePixelsPerMinute(input.pixelsPerMinute);
  if (rangeEndMs <= rangeStartMs) {
    throw new RangeError('Timeline rangeEnd must be after rangeStart.');
  }

  const layouts: (TimelineItemLayout<Item> &
    Readonly<{ sortStartMs: number; sortEndMs: number }>)[] = [];
  const seenIds = new Set<string>();

  for (const item of input.items) {
    if (typeof item.id !== 'string' || item.id.trim().length === 0) {
      throw new TypeError('Timeline item id must be a non-empty string.');
    }
    if (seenIds.has(item.id)) {
      throw new RangeError(`Timeline item id must be unique: ${item.id}`);
    }
    seenIds.add(item.id);

    const itemStartMs = instantMilliseconds(item.startAt, 'item.startAt');
    const itemEndMs = instantMilliseconds(item.endAt, 'item.endAt');
    if (itemEndMs <= itemStartMs) {
      throw new RangeError(
        `Timeline item ${item.id} must have a non-empty range.`,
      );
    }
    if (itemEndMs <= rangeStartMs || itemStartMs >= rangeEndMs) continue;

    const visibleStartMs = Math.max(itemStartMs, rangeStartMs);
    const visibleEndMs = Math.min(itemEndMs, rangeEndMs);
    layouts.push({
      item,
      top: ((visibleStartMs - rangeStartMs) / millisecondsPerMinute) * scale,
      height: ((visibleEndMs - visibleStartMs) / millisecondsPerMinute) * scale,
      visibleStartAt: new Date(visibleStartMs).toISOString(),
      visibleEndAt: new Date(visibleEndMs).toISOString(),
      continuesBefore: itemStartMs < rangeStartMs,
      continuesAfter: itemEndMs > rangeEndMs,
      sortStartMs: itemStartMs,
      sortEndMs: itemEndMs,
    });
  }

  return layouts
    .sort(
      (left, right) =>
        left.sortStartMs - right.sortStartMs ||
        left.sortEndMs - right.sortEndMs ||
        left.item.id.localeCompare(right.item.id),
    )
    .map(({ sortStartMs: _sortStartMs, sortEndMs: _sortEndMs, ...layout }) =>
      Object.freeze(layout),
    );
}

export function timelineHeight(
  rangeStart: string,
  rangeEnd: string,
  pixelsPerMinute: number,
): number {
  const startMs = instantMilliseconds(rangeStart, 'rangeStart');
  const endMs = instantMilliseconds(rangeEnd, 'rangeEnd');
  if (endMs <= startMs) {
    throw new RangeError('Timeline rangeEnd must be after rangeStart.');
  }
  return (
    ((endMs - startMs) / millisecondsPerMinute) *
    positivePixelsPerMinute(pixelsPerMinute)
  );
}
