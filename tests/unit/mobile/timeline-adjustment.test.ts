import { describe, expect, it } from 'vitest';

import { adjustTimelineInterval } from '../../../apps/mobile/src/presentation/timeline-adjustment';

describe('timeline gesture adjustment', () => {
  it('snaps a move while preserving elapsed duration', () => {
    expect(
      adjustTimelineInterval({
        kind: 'move',
        startAt: '2026-09-12T10:00:00.000Z',
        endAt: '2026-09-12T11:00:00.000Z',
        deltaMinutes: 22,
        granularityMinutes: 15,
        minimumMinutes: 15,
      }),
    ).toEqual({
      startAt: '2026-09-12T10:15:00.000Z',
      endAt: '2026-09-12T11:15:00.000Z',
    });
  });

  it('resizes either edge and enforces the minimum duration', () => {
    expect(
      adjustTimelineInterval({
        kind: 'resize_start',
        startAt: '2026-09-12T10:00:00.000Z',
        endAt: '2026-09-12T11:00:00.000Z',
        deltaMinutes: 90,
        granularityMinutes: 15,
        minimumMinutes: 30,
      }),
    ).toMatchObject({ startAt: '2026-09-12T10:30:00.000Z' });
    expect(
      adjustTimelineInterval({
        kind: 'resize_end',
        startAt: '2026-09-12T10:00:00.000Z',
        endAt: '2026-09-12T11:00:00.000Z',
        deltaMinutes: -90,
        granularityMinutes: 15,
        minimumMinutes: 30,
      }),
    ).toMatchObject({ endAt: '2026-09-12T10:30:00.000Z' });
  });

  it('uses UTC elapsed time across local DST transitions', () => {
    const result = adjustTimelineInterval({
      kind: 'move',
      startAt: '2026-11-01T05:30:00.000Z',
      endAt: '2026-11-01T06:30:00.000Z',
      deltaMinutes: 60,
      granularityMinutes: 15,
      minimumMinutes: 15,
    });
    expect(Date.parse(result.endAt) - Date.parse(result.startAt)).toBe(
      60 * 60_000,
    );
  });
});
