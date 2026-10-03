import { describe, expect, it } from 'vitest';

import { mapBusyEvents } from './calendar-mapping';
import { createOwnedEventMarker } from './ownership-marker';

const RANGE = {
  start: '2026-09-12T00:00:00.000Z',
  end: '2026-09-13T00:00:00.000Z',
} as const;

describe('calendar busy mapping', () => {
  it('maps bounded events, availability, and stable recurring identities', () => {
    const mapped = mapBusyEvents({
      nativeCompleteness: 'complete',
      calendarId: 'calendar-1',
      range: RANGE,
      nativeEvents: [
        {
          id: 'instance-volatile-a',
          originalId: 'series-1',
          instanceId: '101',
          calendarId: 'calendar-1',
          title: 'Busy occurrence',
          startDate: '2026-09-12T10:00:00.000Z',
          endDate: '2026-09-12T11:00:00.000Z',
          availability: 'busy',
          status: 'confirmed',
        },
        {
          id: 'instance-volatile-b',
          originalId: 'series-1',
          instanceId: '202',
          calendarId: 'calendar-1',
          title: 'Free occurrence',
          startDate: '2026-09-12T12:00:00.000Z',
          endDate: '2026-09-12T13:00:00.000Z',
          availability: 'free',
          status: 'confirmed',
        },
        {
          id: 'outside',
          calendarId: 'calendar-1',
          title: 'Adjacent event',
          startDate: RANGE.end,
          endDate: '2026-09-13T01:00:00.000Z',
        },
      ],
    });

    expect(mapped.completeness).toBe('complete');
    expect(mapped.events).toEqual([
      expect.objectContaining({
        externalEventId: 'series-1',
        occurrenceKey: '2026-09-12T10:00:00.000Z',
        busy: true,
      }),
      expect.objectContaining({
        externalEventId: 'series-1',
        occurrenceKey: '2026-09-12T12:00:00.000Z',
        busy: false,
      }),
    ]);
    expect(mapped.events[0]?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('does not treat an unverified marker as ownership authority', () => {
    const startAt = '2026-09-12T10:00:00.000Z';
    const endAt = '2026-09-12T11:00:00.000Z';
    const notes = createOwnedEventMarker('test.namespace', {
      calendarOwnershipKey: 'owned-calendar',
      timeBlockId: 'block-1',
      contentHash: 'sha256:expected',
      nativeFingerprint: 'sha256:native',
      planRevision: 1,
    });

    const mapped = mapBusyEvents({
      nativeCompleteness: 'complete',
      calendarId: 'calendar-1',
      range: RANGE,
      nativeEvents: [
        {
          id: 'owned-event',
          calendarId: 'calendar-1',
          title: 'Any title',
          startDate: startAt,
          endDate: endAt,
          notes,
        },
      ],
    });

    expect(mapped.events).toEqual([
      expect.objectContaining({
        externalEventId: 'owned-event',
        busy: true,
      }),
    ]);
  });

  it('preserves usable observations but marks malformed native data partial', () => {
    const mapped = mapBusyEvents({
      nativeCompleteness: 'complete',
      calendarId: 'calendar-1',
      range: RANGE,
      nativeEvents: [
        {
          id: 'valid',
          calendarId: 'calendar-1',
          title: 'Valid',
          startDate: '2026-09-12T08:00:00.000Z',
          endDate: '2026-09-12T09:00:00.000Z',
        },
        {
          id: 'broken-date',
          calendarId: 'calendar-1',
          title: 'Broken',
          startDate: 'not-a-date',
          endDate: '2026-09-12T10:00:00.000Z',
        },
        {
          id: 'broken-marker',
          calendarId: 'calendar-1',
          title: 'Conservative busy',
          startDate: '2026-09-12T11:00:00.000Z',
          endDate: '2026-09-12T12:00:00.000Z',
          notes: '[[local-calendar-event:test.namespace:not-json]]',
        },
      ],
    });

    expect(mapped.completeness).toBe('partial');
    expect(mapped.events).toHaveLength(2);
    expect(mapped.events.map((event) => event.externalEventId)).toEqual([
      'broken-marker',
      'valid',
    ]);
  });

  it('rejects non-canonical or empty ranges before native access', () => {
    expect(() =>
      mapBusyEvents({
        nativeCompleteness: 'complete',
        calendarId: 'calendar-1',
        range: {
          start: '2026-09-12T00:00:00Z',
          end: '2026-09-12T00:00:00.000Z',
        },
        nativeEvents: [],
      }),
    ).toThrow(/canonical UTC range/);
  });

  it('selects a deterministic observation when native duplicates disagree', () => {
    const duplicates = [
      {
        id: 'same-event',
        calendarId: 'calendar-1',
        title: 'Moved later',
        startDate: '2026-09-12T10:00:00.000Z',
        endDate: '2026-09-12T11:00:00.000Z',
      },
      {
        id: 'same-event',
        calendarId: 'calendar-1',
        title: 'Moved earlier',
        startDate: '2026-09-12T08:00:00.000Z',
        endDate: '2026-09-12T09:00:00.000Z',
      },
    ] as const;
    const forward = mapBusyEvents({
      nativeCompleteness: 'complete',
      calendarId: 'calendar-1',
      range: RANGE,
      nativeEvents: duplicates,
    });
    const reversed = mapBusyEvents({
      nativeCompleteness: 'complete',
      calendarId: 'calendar-1',
      range: RANGE,
      nativeEvents: [...duplicates].reverse(),
    });

    expect(forward.completeness).toBe('partial');
    expect(reversed).toEqual(forward);
    expect(forward.events).toEqual([
      expect.objectContaining({ startAt: '2026-09-12T08:00:00.000Z' }),
    ]);
  });
});
