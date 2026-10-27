import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { run as runCommand, sleep, workspaceRoot } from './lib/runtime';

const root = workspaceRoot;
const directory = resolve(root, '.artifacts/cloud');
await mkdir(directory, { recursive: true });
async function run(command: string[], cwd = root, env = process.env) {
  const { exitCode } = await runCommand(command[0]!, command.slice(1), {
    cwd,
    env,
    inherit: true,
  });
  if (exitCode !== 0)
    throw new Error(`Command failed with exit ${exitCode}: ${command[0]}`);
}
let server: ReturnType<typeof spawn> | undefined;
try {
  let url = process.env.CLOUD_TEST_URL;
  if (!url) {
    const database = process.env.TEST_DATABASE_URL;
    if (!database)
      throw new Error(
        'Set TEST_DATABASE_URL to a disposable PostgreSQL 18 database, or CLOUD_TEST_URL to a running test service.',
      );
    const env = {
      ...process.env,
      DATABASE_URL: database,
      ACCESS_TOKEN_SECRET: randomBytes(48).toString('hex'),
      ALLOW_UNVERIFIED_REGISTRATION: 'true',
      HTTP_ADDR: '127.0.0.1:18048',
      GRPC_ADDR: '127.0.0.1:19048',
    };
    await run(['go', 'run', './cmd/migrate'], resolve(root, 'server'), env);
    const binary = resolve(directory, 'server');
    await run(
      ['go', 'build', '-o', binary, './cmd/server'],
      resolve(root, 'server'),
    );
    const serviceLog = createWriteStream(resolve(directory, 'service.log'));
    const serviceErrorLog = createWriteStream(
      resolve(directory, 'service-error.log'),
    );
    await Promise.all([
      once(serviceLog, 'open'),
      once(serviceErrorLog, 'open'),
    ]);
    server = spawn(binary, [], {
      cwd: resolve(root, 'server'),
      env,
      stdio: ['ignore', serviceLog, serviceErrorLog],
    });
    url = 'http://127.0.0.1:18048';
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      if (server.exitCode !== null)
        throw new Error('Test server exited before becoming ready.');
      try {
        ready = (await fetch(`${url}/readyz`)).ok;
      } catch {
        /* bounded startup */
      }
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error('Test server did not become ready.');
  }
  await run(
    ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.cloud.config.ts'],
    root,
    { ...process.env, CLOUD_TEST_URL: url },
  );
} finally {
  if (server) {
    server.kill();
    await once(server, 'close');
  }
}
export {};
