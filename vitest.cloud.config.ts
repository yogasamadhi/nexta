import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/cloud/**/*.test.ts'],
    testTimeout: 30000,
  },
});
