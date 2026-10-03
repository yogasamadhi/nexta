import { join } from 'node:path';

const mobileRoot = join(import.meta.dir, '..', 'apps', 'mobile');

for (const variant of ['development', 'preview', 'production'] as const) {
  console.log(`[build:check] resolving ${variant} Expo config`);
  const child = Bun.spawn(
    ['bunx', 'expo', 'config', '--type', 'public', '--json'],
    {
      cwd: mobileRoot,
      env: { ...process.env, APP_VARIANT: variant, CI: '1' },
      stderr: 'inherit',
      stdout: 'ignore',
    },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    console.error(
      `[build:check] ${variant} config failed with exit code ${exitCode}`,
    );
    process.exit(exitCode);
  }
}

for (const platform of ['ios', 'android'] as const) {
  console.log(`[build:check] exporting ${platform} bundle`);
  const child = Bun.spawn(
    [
      'bunx',
      'expo',
      'export',
      '--platform',
      platform,
      '--output-dir',
      `.expo-export/${platform}`,
      '--clear',
    ],
    {
      cwd: mobileRoot,
      env: { ...process.env, APP_VARIANT: 'production', CI: '1' },
      stderr: 'inherit',
      stdout: 'inherit',
    },
  );
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    console.error(
      `[build:check] ${platform} export failed with exit code ${exitCode}`,
    );
    process.exit(exitCode);
  }
}

console.log('[build:check] iOS and Android JavaScript bundles exported');
