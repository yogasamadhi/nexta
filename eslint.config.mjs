import { defineConfig } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

export default defineConfig([
  {
    ignores: [
      '**/.expo/**',
      '**/.expo-export/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
    ],
  },
  ...expoConfig,
  {
    settings: {
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.json', './apps/mobile/tsconfig.json'],
        },
      },
    },
  },
]);
