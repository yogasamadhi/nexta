import { parseInstant } from '@workspace/domain';
import { describe, expect, it } from 'vitest';

import {
  IntlTemporalAdapter,
  IntlTemporalError,
  type LocalWorkingHoursRule,
} from '../../../apps/mobile/src/runtime/intl-temporal-adapter';

function adapter(currentTimeZone = 'Asia/Shanghai') {
  return new IntlTemporalAdapter({ currentTimeZone: () => currentTimeZone });
}

function errorCode(work: () => unknown) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(IntlTemporalError);
    return (error as IntlTemporalError).code;
  }
  throw new Error('Expected an IntlTemporalError.');
}

describe('IntlTemporalAdapter', () => {
  it('resolves device-local dates and ordinary Shanghai wall times', () => {
    const temporal = adapter();

    expect(temporal.currentTimeZone()).toBe('Asia/Shanghai');
    expect(temporal.resolve(parseInstant('2026-09-12T16:30:00.000Z'))).toEqual({
      localDate: '2026-09-13',
      timeZone: 'Asia/Shanghai',
    });
    expect(
      temporal.resolveLocalDateTime({
        localDate: '2026-09-12',
        localTime: '08:30',
        timeZone: 'Asia/Shanghai',
      }),
    ).toEqual({
      instant: '2026-09-12T00:30:00.000Z',
      localDate: '2026-09-12',
      localTime: '08:30',
      timeZone: 'Asia/Shanghai',
      offsetMinutes: 480,
    });
    expect(
      temporal.dayRange({
        localDate: '2026-09-12',
        timeZone: 'Asia/Shanghai',
      }),
    ).toEqual({
      start: '2026-09-11T16:00:00.000Z',
      end: '2026-09-12T16:00:00.000Z',
    });
  });

  it('rejects unsupported zones and never accepts invalid local input', () => {
    expect(
      errorCode(() =>
        adapter('Not/A_Real_Zone').resolve(
          parseInstant('2026-09-12T00:00:00.000Z'),
        ),
      ),
    ).toBe('invalid_time_zone');
    expect(
      errorCode(() =>
        adapter().resolveLocalDateTime({
          localDate: '2026-02-29',
          localTime: '09:00',
          timeZone: 'Asia/Shanghai',
        }),
      ),
    ).toBe('invalid_local_date');
    expect(
      errorCode(() =>
        adapter().resolveLocalDateTime({
          localDate: '2026-09-12',
          localTime: '9:00',
          timeZone: 'Asia/Shanghai',
        }),
      ),
    ).toBe('invalid_local_time');
  });

  it('reports the New York spring gap and expands its civil day to 23 hours', () => {
    const temporal = adapter('America/New_York');

    expect(
      errorCode(() =>
        temporal.resolveLocalDateTime({
          localDate: '2026-03-08',
          localTime: '02:30',
          timeZone: 'America/New_York',
        }),
      ),
    ).toBe('nonexistent_local_time');

    const range = temporal.dayRange({
      localDate: '2026-03-08',
      timeZone: 'America/New_York',
    });
    expect(range).toEqual({
      start: '2026-03-08T05:00:00.000Z',
      end: '2026-03-09T04:00:00.000Z',
    });
    expect(Date.parse(range.end) - Date.parse(range.start)).toBe(
      23 * 60 * 60_000,
    );
  });

  it('requires New York fold disambiguation and supports earlier/later', () => {
    const temporal = adapter('America/New_York');
    const input = {
      localDate: '2026-11-01',
      localTime: '01:30',
      timeZone: 'America/New_York',
    } as const;

    expect(errorCode(() => temporal.resolveLocalDateTime(input))).toBe(
      'ambiguous_local_time',
    );
    expect(
      temporal.resolveLocalDateTime({ ...input, disambiguation: 'earlier' }),
    ).toMatchObject({
      instant: '2026-11-01T05:30:00.000Z',
      offsetMinutes: -240,
    });
    expect(
      temporal.resolveLocalDateTime({ ...input, disambiguation: 'later' }),
    ).toMatchObject({
      instant: '2026-11-01T06:30:00.000Z',
      offsetMinutes: -300,
    });

    const range = temporal.dayRange({
      localDate: '2026-11-01',
      timeZone: 'America/New_York',
    });
    expect(range).toEqual({
      start: '2026-11-01T04:00:00.000Z',
      end: '2026-11-02T05:00:00.000Z',
    });
    expect(Date.parse(range.end) - Date.parse(range.start)).toBe(
      25 * 60 * 60_000,
    );
  });

  it('handles Lord Howe half-hour folds and gaps without one-hour assumptions', () => {
    const temporal = adapter('Australia/Lord_Howe');
    const fold = {
      localDate: '2026-04-05',
      localTime: '01:45',
      timeZone: 'Australia/Lord_Howe',
    } as const;

    expect(errorCode(() => temporal.resolveLocalDateTime(fold))).toBe(
      'ambiguous_local_time',
    );
    const earlier = temporal.resolveLocalDateTime({
      ...fold,
      disambiguation: 'earlier',
    });
    const later = temporal.resolveLocalDateTime({
      ...fold,
      disambiguation: 'later',
    });
    expect(earlier).toMatchObject({
      instant: '2026-04-04T14:45:00.000Z',
      offsetMinutes: 660,
    });
    expect(later).toMatchObject({
      instant: '2026-04-04T15:15:00.000Z',
      offsetMinutes: 630,
    });
    expect(Date.parse(later.instant) - Date.parse(earlier.instant)).toBe(
      30 * 60_000,
    );
    expect(
      errorCode(() =>
        temporal.resolveLocalDateTime({
          localDate: '2026-10-04',
          localTime: '02:15',
          timeZone: 'Australia/Lord_Howe',
        }),
      ),
    ).toBe('nonexistent_local_time');
  });

  it('resolves working-window endpoints independently across a fold', () => {
    const temporal = adapter('America/New_York');
    const rule: LocalWorkingHoursRule = {
      id: 'fold-window',
      weekdays: [7],
      startLocalTime: '01:15',
      endLocalTime: '01:45',
      startDisambiguation: 'earlier',
      endDisambiguation: 'later',
      energyLevel: 'high',
    };

    expect(
      temporal.expandWorkingHours({
        range: {
          start: '2026-11-01T00:00:00.000Z',
          end: '2026-11-02T12:00:00.000Z',
        },
        timeZone: 'America/New_York',
        rules: [rule],
      }),
    ).toEqual([
      {
        id: 'fold-window@2026-11-01',
        sourceRuleId: 'fold-window',
        localDate: '2026-11-01',
        start: '2026-11-01T05:15:00.000Z',
        end: '2026-11-01T06:45:00.000Z',
        energyLevel: 'high',
      },
    ]);

    expect(
      errorCode(() =>
        temporal.expandWorkingHours({
          range: {
            start: '2026-11-01T00:00:00.000Z',
            end: '2026-11-02T12:00:00.000Z',
          },
          timeZone: 'America/New_York',
          rules: [{ ...rule, endDisambiguation: undefined }],
        }),
      ),
    ).toBe('ambiguous_local_time');
  });

  it('expands cross-midnight rules, clips to the UTC range and sorts stably', () => {
    const temporal = adapter('Asia/Shanghai');
    const windows = temporal.expandWorkingHours({
      range: {
        start: '2026-09-12T12:00:00.000Z',
        end: '2026-09-12T17:00:00.000Z',
      },
      timeZone: 'Asia/Shanghai',
      rules: [
        {
          id: 'late',
          weekdays: [6],
          startLocalTime: '23:00',
          endLocalTime: '23:30',
        },
        {
          id: 'overnight',
          weekdays: [6],
          startLocalTime: '22:00',
          endLocalTime: '02:00',
          energyLevel: 'low',
        },
        {
          id: 'early',
          weekdays: [6],
          startLocalTime: '21:00',
          endLocalTime: '21:30',
        },
      ],
    });

    expect(windows).toEqual([
      {
        id: 'early@2026-09-12',
        sourceRuleId: 'early',
        localDate: '2026-09-12',
        start: '2026-09-12T13:00:00.000Z',
        end: '2026-09-12T13:30:00.000Z',
        energyLevel: null,
      },
      {
        id: 'overnight@2026-09-12',
        sourceRuleId: 'overnight',
        localDate: '2026-09-12',
        start: '2026-09-12T14:00:00.000Z',
        end: '2026-09-12T17:00:00.000Z',
        energyLevel: 'low',
      },
      {
        id: 'late@2026-09-12',
        sourceRuleId: 'late',
        localDate: '2026-09-12',
        start: '2026-09-12T15:00:00.000Z',
        end: '2026-09-12T15:30:00.000Z',
        energyLevel: null,
      },
    ]);

    expect(
      temporal.expandWorkingHours({
        range: {
          start: '2026-09-12T16:30:00.000Z',
          end: '2026-09-12T17:30:00.000Z',
        },
        timeZone: 'Asia/Shanghai',
        rules: [
          {
            id: 'overnight',
            weekdays: [6],
            startLocalTime: '22:00',
            endLocalTime: '02:00',
          },
        ],
      }),
    ).toMatchObject([
      {
        id: 'overnight@2026-09-12',
        start: '2026-09-12T16:30:00.000Z',
        end: '2026-09-12T17:30:00.000Z',
      },
    ]);
  });
});
