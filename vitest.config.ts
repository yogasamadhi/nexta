import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', 'tests/integration/**'],
    include: ['packages/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
