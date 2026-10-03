import {
  createUserPreference,
  normalizePreferenceJson,
  parseInstant,
  parseUserPreferenceId,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

describe('UserPreference', () => {
  it('normalizes an isolated JSON snapshot', () => {
    const source = {
      timeZone: 'Asia/Shanghai',
      windows: [{ weekday: 1, enabled: true }],
    };
    const preference = createUserPreference({
      id: parseUserPreferenceId('preference-time-zone'),
      key: 'scheduling.timeZone.v1',
      valueJson: source,
      updatedAt: parseInstant('2026-09-12T08:00:00.000Z'),
    });

    source.timeZone = 'UTC';
    expect(preference.valueJson).toEqual({
      timeZone: 'Asia/Shanghai',
      windows: [{ weekday: 1, enabled: true }],
    });
    expect(Object.isFrozen(preference.valueJson)).toBe(true);
  });

  it('accepts every JSON primitive including null', () => {
    expect(normalizePreferenceJson(null)).toBeNull();
    expect(normalizePreferenceJson('value')).toBe('value');
    expect(normalizePreferenceJson(false)).toBe(false);
    expect(normalizePreferenceJson(0)).toBe(0);
  });

  it('rejects non-JSON, non-finite, cyclic, and class values', () => {
    expect(() => normalizePreferenceJson(undefined)).toThrow('JSON values');
    expect(() => normalizePreferenceJson(Number.NaN)).toThrow('finite');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => normalizePreferenceJson(cyclic)).toThrow('cyclic');

    expect(() => normalizePreferenceJson(new Date())).toThrow('plain');
  });

  it('rejects empty identities and invalid instants', () => {
    expect(() =>
      createUserPreference({
        id: parseUserPreferenceId('preference-1'),
        key: ' ',
        valueJson: true,
        updatedAt: parseInstant('2026-09-12T08:00:00.000Z'),
      }),
    ).toThrow('key');
  });
});
