import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'Start: EXPO_NO_TELEMETRY=1 CI=1 bunx expo start apps/mobile/testing --dev-client --offline --port 8089',
  );
  console.log(
    'Then: bun run test:hermes --device <owned Android emulator> [--port 8089]',
  );
  console.log(
    'Requires the installed development app. Restarts only that app; does not reset business data.',
  );
  process.exit(0);
}
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (
    !key ||
    !['--device', '--port'].includes(key) ||
    !value ||
    options.has(key)
  ) {
    console.error('Invalid arguments. Use --help.');
    process.exit(2);
  }
  options.set(key, value);
}
const device = options.get('--device');
const port = Number(options.get('--port') ?? '8089');
if (
  !device ||
  !/^emulator-\d+$/.test(device) ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
) {
  console.error('Specify an owned emulator and valid port.');
  process.exit(2);
}
const appId = 'com.personalexecution.agent.development';
const adb = join(root, '.artifacts/tools/android-sdk/platform-tools/adb');
const timestamp = new Date().toISOString();
const artifacts = join(
  root,
  '.artifacts/optimization/hermes-runs',
  timestamp.replaceAll(':', '-'),
);
await mkdir(artifacts, { recursive: true });
const commands: { argv: string[]; exitCode: number }[] = [];
async function command(argv: string[]) {
  const child = Bun.spawn(argv, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 30_000);
  try {
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    commands.push({ argv, exitCode });
    assert.equal(exitCode, 0, 'Host command failed');
    return stdout.trim();
  } finally {
    clearTimeout(timer);
  }
}
function sourceHash() {
  return Promise.all(
    [
      'apps/mobile/testing/hermes-smoke-entry.tsx',
      'tests/benchmarks/scheduler/scenarios.ts',
      'tests/benchmarks/scheduler/analysis.ts',
      'packages/scheduler-core/src/index.ts',
      'packages/scheduler-core/src/scheduler.ts',
      'packages/scheduler-core/src/time.ts',
      'packages/scheduler-core/src/validation.ts',
      'packages/scheduler-core/src/types.ts',
      'packages/scheduler-core/src/errors.ts',
      'packages/agent-core/src/index.ts',
      'packages/model-runtime/src/index.ts',
      'bun.lock',
    ].map(async (path) => [path, await readFile(join(root, path))] as const),
  ).then((rows) => {
    const hash = createHash('sha256');
    for (const [path, bytes] of rows)
      hash.update(path).update('\0').update(bytes);
    return hash.digest('hex');
  });
}
let failure: string | null = null;
let evidence: Record<string, unknown> = {};
try {
  const receipts = JSON.parse(
    await readFile(
      join(root, '.artifacts/optimization/ui-devices.json'),
      'utf8',
    ),
  ) as {
    id: string;
    owner: string;
    platform: string;
    name: string;
    path?: string;
  }[];
  const receipt = receipts.find(
    (r) =>
      r.id === device &&
      r.owner === 'OPT-NC-20261003' &&
      r.platform === 'android',
  );
  assert.ok(receipt?.path, 'No owned test emulator receipt');
  const ownedPath = relative(
    join(root, '.artifacts/tools/android-avd'),
    resolve(receipt.path),
  );
  assert.ok(
    ownedPath && !ownedPath.startsWith('..'),
    'Emulator path outside test tools',
  );
  assert.equal(
    (await command([adb, '-s', device, 'emu', 'avd', 'name'])).split(
      /\r?\n/,
    )[0],
    receipt.name,
  );
  assert.equal(
    await command([
      adb,
      '-s',
      device,
      'shell',
      'getprop',
      'sys.boot_completed',
    ]),
    '1',
  );
  const manifest = (await fetch('http://127.0.0.1:' + port, {
    headers: { 'expo-platform': 'android', accept: 'application/expo+json' },
    signal: AbortSignal.timeout(10_000),
  }).then((r) => {
    assert.ok(r.ok, 'Test manifest unavailable');
    return r.json();
  })) as {
    launchAsset?: { url?: string };
    extra?: { expoClient?: { name?: string } };
  };
  assert.equal(manifest.extra?.expoClient?.name, 'Isolated Hermes Test Host');
  assert.ok(
    manifest.launchAsset?.url?.includes('/hermes-smoke-entry.tsx.bundle?'),
    'Refusing a production entry',
  );
  const metadata = await command([
    adb,
    '-s',
    device,
    'shell',
    'dumpsys',
    'package',
    appId,
  ]);
  assert.ok(/versionName=/.test(metadata), 'Development app is not installed');
  const nativeVersion = metadata.match(/versionName=(\S+)/)?.[1];
  const os = await command([
    adb,
    '-s',
    device,
    'shell',
    'getprop',
    'ro.build.version.release',
  ]);
  await command([adb, '-s', device, 'reverse', 'tcp:' + port, 'tcp:' + port]);
  await command([adb, '-s', device, 'shell', 'am', 'force-stop', appId]);
  const url =
    'execution-agent-development://expo-development-client/?url=' +
    encodeURIComponent('http://127.0.0.1:' + port);
  await command([
    adb,
    '-s',
    device,
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    url,
    appId,
  ]);
  const pid = await command([adb, '-s', device, 'shell', 'pidof', appId]);
  assert.ok(/^\d+$/.test(pid), 'No unique owned process');
  let markers = '';
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const log = await command([
      adb,
      '-s',
      device,
      'logcat',
      '-d',
      '--pid=' + pid,
      '-s',
      'ReactNativeJS:I',
    ]);
    markers = log
      .split('\n')
      .filter((line) =>
        /\[OPT-(HERMES-(RUNTIME|AGENT|CASE|DONE|FAIL)|NATIVE-PREFERENCE)\]/.test(
          line,
        ),
      )
      .join('\n');
    if (
      markers.includes('[OPT-HERMES-DONE]') ||
      markers.includes('[OPT-HERMES-FAIL]')
    )
      break;
    await Bun.sleep(1000);
  }
  await writeFile(join(artifacts, 'markers.log'), markers);
  const records = markers.split('\n').flatMap((line) => {
    const match = line.match(
      /\[OPT-HERMES-(RUNTIME|AGENT|CASE|DONE|FAIL)\] (.*)$/,
    );
    return match
      ? [
          {
            kind: match[1],
            data: JSON.parse(match[2]!) as Record<string, unknown>,
          },
        ]
      : [];
  });
  const nativePreference = markers.split('\n').flatMap((line) => {
    const match = line.match(/\[OPT-NATIVE-PREFERENCE\] (.*)$/);
    return match ? [JSON.parse(match[1]!) as Record<string, unknown>] : [];
  })[0] ?? { status: 'not_executed' };
  assert.ok(!records.some((r) => r.kind === 'FAIL'), 'Hermes test failed');
  const runtime = records.find((r) => r.kind === 'RUNTIME')?.data;
  const agents = records.filter((r) => r.kind === 'AGENT').map((r) => r.data);
  const cases = records.filter((r) => r.kind === 'CASE').map((r) => r.data);
  assert.equal(runtime?.engine, 'Hermes');
  assert.deepEqual(agents.map((r) => r.mode).sort(), ['complete', 'stream']);
  assert.ok(
    agents.every(
      (r) =>
        r.status === 'completed' &&
        r.turns === 2 &&
        r.toolCalls === 1 &&
        r.receiptVerified === true,
    ),
  );
  assert.equal(cases.length, 13);
  assert.equal(new Set(cases.map((r) => r.id)).size, 13);
  assert.ok(
    cases.every((r) => r.invariantsPassed === true && r.seed === 20261003),
  );
  assert.equal(records.find((r) => r.kind === 'DONE')?.data.status, 'passed');
  evidence = {
    device: { ...receipt, os, physicalDevice: false },
    nativeVersion,
    runtime,
    nativePreference,
    agents,
    cases,
    warmup: 1,
    samples: 5,
    gitCommit: await command(['git', 'rev-parse', 'HEAD']),
    sourceSHA256: await sourceHash(),
    limitations: [
      'Synthetic Fake Provider; no real model request or production Capture.',
      'Android emulator Debug host; not physical-device performance or native OS provider acceptance.',
      'Bun and Hermes timing results must be compared separately.',
    ],
  };
} catch {
  failure =
    'Owned-device configuration, runtime, timeout or evidence assertion failed. Inspect local host artifacts.';
}
const report = {
  planId: 'OPT-NC-20261003',
  timestamp,
  status: failure ? 'failed' : 'passed',
  ...evidence,
  commands,
  artifacts,
  failure,
};
await writeFile(
  join(artifacts, 'report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile(
  join(root, '.ai/evidence/optimization/hermes-runtime.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  '[test:hermes]',
  report.status,
  '.ai/evidence/optimization/hermes-runtime.json',
);
if (failure) process.exit(1);
