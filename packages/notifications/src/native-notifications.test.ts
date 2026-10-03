import { describe, expect, it } from 'vitest';

import { normalizeNativeNotificationTrigger } from './native-notifications';

const INSTANT = '2026-09-12T09:55:00.000Z';
const MILLISECONDS = Date.parse(INSTANT);

describe('native notification trigger normalization', () => {
  it.each([
    new Date(INSTANT),
    MILLISECONDS,
    INSTANT,
    '2026-09-12T17:55:00.000+08:00',
    { type: 'date', date: new Date(INSTANT) },
    { type: 'date', date: MILLISECONDS },
    { type: 'date', date: INSTANT },
    { type: 'date', value: MILLISECONDS, repeats: false },
    { type: 'date', timestamp: MILLISECONDS },
    {
      type: 'date',
      date: INSTANT,
      value: MILLISECONDS,
      timestamp: MILLISECONDS,
    },
  ])('normalizes an unambiguous absolute Date trigger: %o', (trigger) => {
    expect(normalizeNativeNotificationTrigger(trigger)).toEqual({
      kind: 'date',
      scheduledAt: INSTANT,
    });
  });

  it.each([
    null,
    Number.NaN,
    new Date(Number.NaN),
    '2026-09-12T09:55:00',
    { type: 'timeInterval', seconds: 300, repeats: false },
    { type: 'calendar', dateComponents: { hour: 9, minute: 55 } },
    { type: 'date' },
    { type: 'date', date: INSTANT, repeats: true },
    { type: 'date', date: INSTANT, value: MILLISECONDS + 1_000 },
    { type: 'vendor-specific', scheduledAt: INSTANT },
  ])(
    'keeps an ambiguous or platform-unknown trigger unknown: %o',
    (trigger) => {
      expect(normalizeNativeNotificationTrigger(trigger)).toEqual({
        kind: 'unknown',
      });
    },
  );
});
