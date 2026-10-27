import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

import { runInherit, scriptsDir } from './lib/runtime';

const mobileRoot = join(scriptsDir, '..', 'apps', 'mobile');

async function sourceMaps(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceMaps(path)));
    else if (entry.name.endsWith('.map')) files.push(path);
  }
  return files;
}

async function verifyProductionModules(platform: string) {
  const maps = await sourceMaps(join(mobileRoot, '.expo-export', platform));
  if (maps.length === 0) throw new Error('Production source map is missing.');
  let sourceCount = 0;
  for (const path of maps) {
    const map = JSON.parse(await readFile(path, 'utf8')) as {
      sources?: string[];
    };
    if (!Array.isArray(map.sources) || map.sources.length === 0)
      throw new Error('Production module inventory is missing.');
    sourceCount += map.sources.length;
    for (const source of map.sources) {
      const normalized = source.replaceAll('\\', '/');
      if (
        /(?:^|\/)apps\/mobile\/testing\//.test(normalized) ||
        /(?:^|\/)tests\/benchmarks\/scheduler\//.test(normalized) ||
        /(?:^|\/)scripts\/test-(?:ui|hermes)\.ts$/.test(normalized) ||
        /(?:^|\/)\.artifacts\/tools\//.test(normalized)
      )
        throw new Error('Local testing module entered the production export.');
    }
  }
  console.log(
    `[build:check] ${platform} production module inventory checked (${sourceCount} sources); local test hosts/tools excluded`,
  );
}

for (const variant of ['development', 'preview', 'production'] as const) {
  console.log(`[build:check] resolving ${variant} Expo config`);
  const exitCode = await runInherit(
    'pnpm',
    ['exec', 'expo', 'config', '--type', 'public', '--json'],
    {
      cwd: mobileRoot,
      env: { ...process.env, APP_VARIANT: variant, CI: '1' },
    },
  );
  if (exitCode !== 0) {
    console.error(
      `[build:check] ${variant} config failed with exit code ${exitCode}`,
    );
    process.exit(exitCode);
  }
}

for (const platform of ['ios', 'android'] as const) {
  console.log(`[build:check] exporting ${platform} bundle`);
  const exitCode = await runInherit(
    'pnpm',
    [
      'exec',
      'expo',
      'export',
      '--platform',
      platform,
      '--output-dir',
      `.expo-export/${platform}`,
      '--clear',
      '--source-maps',
    ],
    {
      cwd: mobileRoot,
      env: { ...process.env, APP_VARIANT: 'production', CI: '1' },
    },
  );

  if (exitCode !== 0) {
    console.error(
      `[build:check] ${platform} export failed with exit code ${exitCode}`,
    );
    process.exit(exitCode);
  }
  await verifyProductionModules(platform);
}

console.log('[build:check] iOS and Android JavaScript bundles exported');
