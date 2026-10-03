import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from './index';

describe('parseRuntimeConfig', () => {
  it('accepts an explicit supported environment', () => {
    expect(parseRuntimeConfig({ environment: 'development' })).toEqual({
      environment: 'development',
    });
  });

  it('rejects unknown keys and unsupported environments', () => {
    expect(() => parseRuntimeConfig({ environment: 'test' })).toThrow();
    expect(() =>
      parseRuntimeConfig({
        environment: 'production',
        secret: 'must-not-pass-boundary',
      }),
    ).toThrow();
  });
});
