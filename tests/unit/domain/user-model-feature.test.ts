import {
  createUserModelFeature,
  parseInstant,
  parseUserModelFeatureId,
  userModelFeatureIdentity,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

describe('UserModelFeature domain', () => {
  const valid = {
    id: parseUserModelFeatureId('feature-1'),
    featureKey: 'estimate_bias',
    scopeKey: 'document',
    numericValue: 0.25,
    windowStart: parseInstant('2026-08-01T00:00:00.000Z'),
    windowEnd: parseInstant('2026-09-01T00:00:00.000Z'),
    sourceStateVersion: 12,
    sampleCount: 4,
    confidence: 0.5,
    algorithmVersion: 'test-model-v1',
    lastUpdatedAt: parseInstant('2026-09-01T00:00:00.000Z'),
  } as const;

  it('creates a versioned, behavior-only feature with stable identity', () => {
    const feature = createUserModelFeature(valid);
    expect(feature).toEqual(valid);
    expect(userModelFeatureIdentity(feature)).toBe(
      '["test-model-v1","estimate_bias","document"]',
    );
  });

  it('rejects invalid windows, confidence, and unsafe numeric values', () => {
    expect(() =>
      createUserModelFeature({
        ...valid,
        windowEnd: valid.windowStart,
      }),
    ).toThrow('window');
    expect(() =>
      createUserModelFeature({ ...valid, confidence: 1.01 }),
    ).toThrow('confidence');
    expect(() =>
      createUserModelFeature({
        ...valid,
        numericValue: Number.MAX_VALUE,
      }),
    ).toThrow('safe finite range');
  });
});
