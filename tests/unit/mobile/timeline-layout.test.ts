import { describe, expect, it } from 'vitest';

import {
  layoutTimelineItems,
  minuteOffsetToPixels,
  timelineHeight,
} from '../../../apps/mobile/src/presentation/timeline-layout';

describe('mobile timeline layout', () => {
  it('uses one uniform elapsed-minute to pixel mapping', () => {
    const start = '2026-09-12T00:00:00.000Z';

    expect(minuteOffsetToPixels('2026-09-12T01:30:00.000Z', start, 2)).toBe(
      180,
    );
    expect(timelineHeight(start, '2026-09-13T00:00:00.000Z', 1.5)).toBe(2160);
  });

  it('clips cross-boundary items and marks both continuations', () => {
    const items = [
      {
        id: 'before',
        startAt: '2026-09-11T23:30:00.000Z',
        endAt: '2026-09-12T01:00:00.000Z',
        label: 'continues from yesterday',
      },
      {
        id: 'after',
        startAt: '2026-09-12T23:30:00.000Z',
        endAt: '2026-09-13T01:00:00.000Z',
        label: 'continues tomorrow',
      },
      {
        id: 'outside',
        startAt: '2026-09-13T02:00:00.000Z',
        endAt: '2026-09-13T03:00:00.000Z',
        label: 'not visible',
      },
    ] as const;

    const result = layoutTimelineItems({
      rangeStart: '2026-09-12T00:00:00.000Z',
      rangeEnd: '2026-09-13T00:00:00.000Z',
      pixelsPerMinute: 1,
      items,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      item: items[0],
      top: 0,
      height: 60,
      visibleStartAt: '2026-09-12T00:00:00.000Z',
      visibleEndAt: '2026-09-12T01:00:00.000Z',
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(result[1]).toMatchObject({
      item: items[1],
      top: 1410,
      height: 30,
      continuesBefore: false,
      continuesAfter: true,
    });
  });

  it('uses resolved day instants, including a 23-hour DST day', () => {
    const start = '2026-03-08T05:00:00.000Z';
    const end = '2026-03-09T04:00:00.000Z';

    expect(timelineHeight(start, end, 1)).toBe(23 * 60);
    expect(
      layoutTimelineItems({
        rangeStart: start,
        rangeEnd: end,
        pixelsPerMinute: 1,
        items: [
          {
            id: 'whole-day',
            startAt: start,
            endAt: end,
          },
        ],
      })[0]?.height,
    ).toBe(23 * 60);
  });

  it('sorts deterministically without mutating source items', () => {
    const items = Object.freeze([
      Object.freeze({
        id: 'b',
        startAt: '2026-09-12T10:00:00.000Z',
        endAt: '2026-09-12T11:00:00.000Z',
      }),
      Object.freeze({
        id: 'a',
        startAt: '2026-09-12T09:00:00.000Z',
        endAt: '2026-09-12T10:00:00.000Z',
      }),
    ]);

    const result = layoutTimelineItems({
      rangeStart: '2026-09-12T00:00:00.000Z',
      rangeEnd: '2026-09-13T00:00:00.000Z',
      pixelsPerMinute: 1,
      items,
    });

    expect(result.map(({ item }) => item.id)).toEqual(['a', 'b']);
    expect(items.map(({ id }) => id)).toEqual(['b', 'a']);
  });

  it('rejects invalid scales, ranges, intervals, and duplicate identities', () => {
    const valid = {
      rangeStart: '2026-09-12T00:00:00.000Z',
      rangeEnd: '2026-09-13T00:00:00.000Z',
      pixelsPerMinute: 1,
    } as const;

    expect(() =>
      layoutTimelineItems({ ...valid, pixelsPerMinute: 0, items: [] }),
    ).toThrow('pixelsPerMinute');
    expect(() =>
      layoutTimelineItems({
        ...valid,
        rangeEnd: valid.rangeStart,
        items: [],
      }),
    ).toThrow('rangeEnd');
    expect(() =>
      layoutTimelineItems({
        ...valid,
        items: [
          {
            id: 'invalid',
            startAt: '2026-09-12T10:00:00.000Z',
            endAt: '2026-09-12T10:00:00.000Z',
          },
        ],
      }),
    ).toThrow('non-empty range');
    expect(() =>
      layoutTimelineItems({
        ...valid,
        items: [
          {
            id: 'same',
            startAt: '2026-09-12T10:00:00.000Z',
            endAt: '2026-09-12T11:00:00.000Z',
          },
          {
            id: 'same',
            startAt: '2026-09-12T12:00:00.000Z',
            endAt: '2026-09-12T13:00:00.000Z',
          },
        ],
      }),
    ).toThrow('unique');
  });
});
