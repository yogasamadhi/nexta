import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { runInherit } from './lib/runtime';

const files = [
  'packages/application/src/sync-entity-fields.ts',
  'server/internal/data/facts_generated.go',
  'server/openapi.yaml',
];
for (const root of ['server/internal/data/sqlcdb', 'server/sync/v1'])
  for (const name of await readdir(root))
    if (name.endsWith('.go')) files.push(join(root, name));
async function hashes() {
  return Promise.all(
    files.map(async (f) => [
      f,
      createHash('sha256')
        .update(await readFile(f))
        .digest('hex'),
    ]),
  );
}
const before = await hashes();
const exitCode = await runInherit('make', ['-C', 'server', 'generate']);
if (exitCode !== 0) process.exit(1);
const after = await hashes();
if (JSON.stringify(before) !== JSON.stringify(after)) {
  console.error(
    'Generated server artifacts were stale; regenerate and review them.',
  );
  process.exit(1);
}
console.log('Server generated artifacts are reproducible.');
export {};
