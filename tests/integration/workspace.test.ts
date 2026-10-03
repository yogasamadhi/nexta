import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from '@workspace/application';

describe('workspace package integration', () => {
  it('resolves a pure application package through the Bun workspace', () => {
    expect(parseRuntimeConfig({ environment: 'preview' })).toEqual({
      environment: 'preview',
    });
  });
});
