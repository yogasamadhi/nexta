import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { run, sleep, workspaceRoot } from './lib/runtime';

const root = workspaceRoot;
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'pnpm run test:ui --platform ios|android --app <Debug .app|.apk> [--device <owned UDID|emulator serial>] [--runtime <simctl runtime>] [--maestro <CLI>] [--port 8087] [--runs 2]',
  );
  console.log(
    'Uses a newly created, recorded test simulator; never accepts an arbitrary device. Android/offline acceptance is reported separately.',
  );
  process.exit(0);
}
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (
    !key ||
    ![
      '--platform',
      '--app',
      '--device',
      '--runtime',
      '--maestro',
      '--port',
      '--runs',
    ].includes(key) ||
    !value ||
    options.has(key)
  ) {
    console.error('[test:ui] Invalid arguments. Use --help.');
    process.exit(2);
  }
  options.set(key, value);
}
const platform = options.get('--platform') ?? 'ios';
if (platform !== 'ios' && platform !== 'android') {
  console.error('[test:ui] Platform must be ios or android.');
  process.exit(2);
}
const app = resolve(
  options.get('--app') ??
    (platform === 'android'
      ? join(
          root,
          'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk',
        )
      : join(
          root,
          '.artifacts/optimization/ios-build/Build/Products/Debug-iphonesimulator/ExecutionAgentdevelopment.app',
        )),
);
const maestro = resolve(
  options.get('--maestro') ??
    join(root, '.artifacts/tools/maestro-2.11.0/maestro/bin/maestro'),
);
const runs = Number(options.get('--runs') ?? '2');
const port = Number(options.get('--port') ?? '8087');
if (
  !Number.isInteger(runs) ||
  runs < 1 ||
  runs > 10 ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
) {
  console.error('[test:ui] Invalid runs/port.');
  process.exit(2);
}
const appId = 'com.personalexecution.agent.development';
const appScheme = 'execution-agent-development';
const owner = 'OPT-NC-20261003';
const sdk = join(root, '.artifacts/tools/android-sdk');
const adb = join(sdk, 'platform-tools/adb');
const receiptPath = join(root, '.artifacts/optimization/ui-devices.json');
const outputRoot = join(
  root,
  '.artifacts/optimization/ui-runs',
  new Date().toISOString().replaceAll(':', '-'),
);
await mkdir(outputRoot, { recursive: true });
const commands: {
  executable: string;
  arguments: string[];
  exitCode: number;
}[] = [];
async function command(argv: string[], logName?: string, allowFailure = false) {
  const { exitCode, stdout, stderr } = await run(argv[0]!, argv.slice(1), {
    cwd: root,
    timeoutMs: basename(argv[0] ?? '') === 'maestro' ? 900_000 : 60_000,
    env: {
      ...process.env,
      MAESTRO_CLI_NO_ANALYTICS: '1',
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
    },
  });
  commands.push({
    executable: basename(argv[0] ?? ''),
    arguments: argv.slice(1),
    exitCode,
  });
  if (logName || exitCode !== 0)
    await writeFile(
      join(outputRoot, logName ?? 'failed-command-' + commands.length + '.log'),
      stdout + stderr,
    );
  if (exitCode !== 0 && !allowFailure)
    throw new Error(
      'Subcommand failed: ' +
        basename(argv[0] ?? '') +
        ' (exit ' +
        exitCode +
        '). See local artifacts.',
    );
  return { exitCode, stdout, stderr };
}
type DeviceReceipt = {
  owner: string;
  id: string;
  name: string;
  runtime: string;
  platform?: string;
  path?: string;
};
type Device = {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
};
type Row = Record<string, string | number | null>;
type Facts = {
  state: Row;
  tasks: Row[];
  plans: Row[];
  blocks: Row[];
  sessions: Row[];
  intervals: Row[];
  completions: Row[];
  achievements: Row[];
  timeZone: string;
  integrity: Row[];
};
async function ownedDevice(): Promise<DeviceReceipt> {
  const receipts: DeviceReceipt[] = await readFile(receiptPath, 'utf8').then(
    (s) => JSON.parse(s) as DeviceReceipt[],
    () => [],
  );
  if (platform === 'android') {
    const requested = options.get('--device');
    const candidates = receipts.filter(
      (r) =>
        r.owner === owner &&
        r.platform === 'android' &&
        (!requested || r.id === requested),
    );
    for (const candidate of candidates) {
      const ownedPath = candidate.path
        ? relative(join(root, '.artifacts/tools/android-avd'), candidate.path)
        : '..';
      if (
        !/^emulator-\d+$/.test(candidate.id) ||
        ownedPath === '..' ||
        ownedPath.startsWith('../') ||
        isAbsolute(ownedPath)
      )
        continue;
      const name = (
        await command(
          [adb, '-s', candidate.id, 'emu', 'avd', 'name'],
          undefined,
          true,
        )
      ).stdout.split(/\r?\n/)[0];
      if (name === candidate.name) return candidate;
    }
    throw new Error(
      'Refusing an unowned/disconnected Android emulator. Create and record a dedicated AVD as documented.',
    );
  }
  const listing = JSON.parse(
    (await command(['xcrun', 'simctl', 'list', 'devices', 'available', '-j']))
      .stdout,
  ) as { devices: Record<string, Device[]> };
  const requested = options.get('--device');
  const candidates = receipts.filter(
    (r) =>
      r.owner === owner &&
      (r.platform ?? 'ios') === 'ios' &&
      (!requested || r.id === requested),
  );
  const found = candidates.find((r) =>
    listing.devices[r.runtime]?.some(
      (d) => d.udid === r.id && d.name === r.name && d.isAvailable,
    ),
  );
  if (requested && !found)
    throw new Error(
      'Refusing to reset an unowned or renamed simulator. Omit --device to create an isolated test device.',
    );
  if (found) return found;
  const runtime =
    options.get('--runtime') ?? 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
  const name =
    'Execution Agent OPT-NC Test ' + new Date().toISOString().slice(0, 10);
  const id = (
    await command([
      'xcrun',
      'simctl',
      'create',
      name,
      'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
      runtime,
    ])
  ).stdout.trim();
  if (!/^[0-9A-F-]{36}$/i.test(id))
    throw new Error('Unexpected simulator identifier.');
  const receipt = { owner, id, name, runtime };
  await mkdir(resolve(receiptPath, '..'), { recursive: true });
  await writeFile(
    receiptPath,
    JSON.stringify([...receipts, receipt], null, 2) + '\n',
  );
  return receipt;
}
function snapshot(path: string): Facts {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = (query: string) => db.prepare(query).all() as Row[];
    return {
      state: rows(
        'SELECT state_version, plan_revision FROM schedule_state',
      )[0]!,
      tasks: rows(
        'SELECT id, title, status, estimated_duration_minutes, actual_duration_minutes FROM tasks ORDER BY id',
      ),
      plans: rows(
        'SELECT id, plan_revision FROM schedule_plans ORDER BY plan_revision',
      ),
      blocks: rows(
        'SELECT id, task_id, start_at, end_at, status FROM time_blocks ORDER BY id',
      ),
      sessions: rows(
        'SELECT id, task_id, status, completion_type, paused_at FROM execution_sessions ORDER BY id',
      ),
      intervals: rows(
        'SELECT id, session_id, kind, start_at, end_at, timing_quality FROM execution_intervals ORDER BY id',
      ),
      completions: rows(
        'SELECT id, task_id, actual_duration_seconds, duration_coverage FROM completion_records ORDER BY id',
      ),
      achievements: rows(
        'SELECT id, source_completion_record_id, title FROM achievements ORDER BY id',
      ),
      timeZone: JSON.parse(
        String(
          rows(
            "SELECT value_json FROM user_preferences WHERE key = 'scheduling.timeZone.v1'",
          )[0]?.value_json,
        ),
      ).timeZone as string,
      integrity: rows('PRAGMA integrity_check'),
    };
  } finally {
    db.close();
  }
}
function workSeconds(intervals: Row[]) {
  return intervals
    .filter(
      (i) =>
        i.kind === 'work' &&
        i.end_at !== null &&
        i.timing_quality === 'trusted',
    )
    .reduce(
      (sum, i) =>
        sum +
        Math.floor(
          (Date.parse(String(i.end_at)) - Date.parse(String(i.start_at))) /
            1000,
        ),
      0,
    );
}
function quoteRemote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}
async function androidSnapshot(id: string): Promise<Facts> {
  const tables: [string, string, string[]][] = [
    [
      'tasks',
      'tasks',
      [
        'id',
        'title',
        'status',
        'estimated_duration_minutes',
        'actual_duration_minutes',
      ],
    ],
    ['plans', 'schedule_plans', ['id', 'plan_revision']],
    [
      'blocks',
      'time_blocks',
      ['id', 'task_id', 'start_at', 'end_at', 'status'],
    ],
    [
      'sessions',
      'execution_sessions',
      ['id', 'task_id', 'status', 'completion_type', 'paused_at'],
    ],
    [
      'intervals',
      'execution_intervals',
      ['id', 'session_id', 'kind', 'start_at', 'end_at', 'timing_quality'],
    ],
    [
      'completions',
      'completion_records',
      ['id', 'task_id', 'actual_duration_seconds', 'duration_coverage'],
    ],
    [
      'achievements',
      'achievements',
      ['id', 'source_completion_record_id', 'title'],
    ],
  ];
  const properties = tables.map(
    ([name, table, columns]) =>
      `'${name}', (SELECT json_group_array(json_object(${columns.map((c) => `'${c}', ${c}`).join(', ')})) FROM (SELECT * FROM ${table} ORDER BY id))`,
  );
  // One read-only statement observes all facts from the same SQLite snapshot.
  const sql = `SELECT json_object('state', (SELECT json_object('state_version', state_version, 'plan_revision', plan_revision) FROM schedule_state), ${properties.join(', ')}, 'timeZone', (SELECT json_extract(value_json, '$.timeZone') FROM user_preferences WHERE key = 'scheduling.timeZone.v1'), 'integrity', (SELECT json_group_array(json_object('integrity_check', integrity_check)) FROM pragma_integrity_check)) AS snapshot;`;
  const remote = [
    'run-as',
    appId,
    '/system/bin/sqlite3',
    '-readonly',
    '-json',
    'files/SQLite/execution-agent.sqlite',
    sql,
  ]
    .map(quoteRemote)
    .join(' ');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await command(
      [adb, '-s', id, 'shell', remote],
      undefined,
      true,
    );
    if (result.exitCode === 0) {
      const rows = JSON.parse(result.stdout) as { snapshot: string }[];
      return JSON.parse(rows[0]!.snapshot) as Facts;
    }
    // Retry only transport loss while observing facts. Never repeat a write or
    // suppress a SQLite/business assertion failure.
    if (
      attempt === 3 ||
      !/device offline|no devices|device .* not found/i.test(result.stderr)
    )
      throw new Error(
        'Read-only Android fact snapshot failed. See local artifacts.',
      );
    await command([adb, '-s', id, 'wait-for-device']);
  }
  throw new Error(
    'Read-only Android fact snapshot exhausted transport recovery.',
  );
}
async function androidNetwork(id: string, offline: boolean, label: string) {
  await command([adb, '-s', id, 'wait-for-device']);
  await command(
    [
      adb,
      '-s',
      id,
      'shell',
      'cmd',
      'connectivity',
      'airplane-mode',
      offline ? 'enable' : 'disable',
    ],
    label + '-airplane.log',
  );
  await command([
    adb,
    '-s',
    id,
    'shell',
    'svc',
    'wifi',
    offline ? 'disable' : 'enable',
  ]);
  await command([
    adb,
    '-s',
    id,
    'shell',
    'svc',
    'data',
    offline ? 'disable' : 'enable',
  ]);
  let observation = await observeAndroidNetwork(id, label);
  // Radio settings return before ConnectivityService removes its default
  // network. Wait for the observed offline condition, not a fixed delay.
  const deadline = Date.now() + 15_000;
  let attempt = 0;
  while (offline && !isAndroidOffline(observation) && Date.now() < deadline) {
    await sleep(250);
    observation = await observeAndroidNetwork(id, label + '-wait-' + ++attempt);
  }
  if (offline) assertAndroidOffline(observation);
  return observation;
}
async function observeAndroidNetwork(id: string, label: string) {
  await command([adb, '-s', id, 'wait-for-device']);
  const state: Record<string, string> = {};
  for (const key of ['airplane_mode_on', 'wifi_on', 'mobile_data']) {
    state[key] = (
      await command([adb, '-s', id, 'shell', 'settings', 'get', 'global', key])
    ).stdout.trim();
  }
  const connectivity = (
    await command(
      [adb, '-s', id, 'shell', 'dumpsys', 'connectivity'],
      label + '-connectivity.log',
    )
  ).stdout;
  const defaultNetwork = connectivity
    .split('\n')
    .find((line) => line.includes('Active default network:'))
    ?.trim();
  return {
    state,
    defaultNetwork,
    bridge: `Development bundle transport uses only adb-reversed localhost:${port}; business interfaces are recorded separately.`,
  };
}
function isAndroidOffline(observation: {
  state: Record<string, string>;
  defaultNetwork: string | undefined;
}) {
  return (
    observation.state.airplane_mode_on === '1' &&
    observation.state.wifi_on === '0' &&
    observation.state.mobile_data === '0' &&
    observation.defaultNetwork?.includes('none') === true
  );
}
function assertAndroidOffline(observation: {
  state: Record<string, string>;
  defaultNetwork: string | undefined;
}) {
  assert.equal(observation.state.airplane_mode_on, '1');
  assert.equal(observation.state.wifi_on, '0');
  assert.equal(observation.state.mobile_data, '0');
  assert.ok(
    observation.defaultNetwork?.includes('none'),
    'offline journey requires no active default network',
  );
}
async function androidDevelopmentBridge(id: string) {
  await command([adb, '-s', id, 'wait-for-device']);
  // Emulator/ADB reconnection drops reverse mappings. Restore only local bundle
  // transport; this does not re-enable any business internet interface.
  await command([adb, '-s', id, 'reverse', 'tcp:' + port, 'tcp:' + port]);
}
const results: {
  run: number;
  checkpoints: { stage: string; facts: unknown }[];
  status: string;
}[] = [];
let device: DeviceReceipt | null = null;
let driverVersion: string | null = null;
let failure: string | null = null;
let offlineStatus = 'not_executed';
let offlineAttempted = false;
let build: Record<string, unknown> | null = null;
try {
  const identifier =
    platform === 'android'
      ? (
          await command([
            join(sdk, 'cmdline-tools/15859902/bin/apkanalyzer'),
            'manifest',
            'application-id',
            app,
          ])
        ).stdout.trim()
      : (
          await command([
            '/usr/libexec/PlistBuddy',
            '-c',
            'Print CFBundleIdentifier',
            join(app, 'Info.plist'),
          ])
        ).stdout.trim();
  assert.equal(identifier, appId, 'only development test app allowed');
  const analyzer = join(sdk, 'cmdline-tools/15859902/bin/apkanalyzer');
  const infoValue = async (key: string) =>
    (
      await command([
        '/usr/libexec/PlistBuddy',
        '-c',
        'Print ' + key,
        join(app, 'Info.plist'),
      ])
    ).stdout.trim();
  const version =
    platform === 'android'
      ? (
          await command([analyzer, 'manifest', 'version-name', app])
        ).stdout.trim()
      : await infoValue('CFBundleShortVersionString');
  const buildNumber =
    platform === 'android'
      ? (
          await command([analyzer, 'manifest', 'version-code', app])
        ).stdout.trim()
      : await infoValue('CFBundleVersion');
  const binary =
    platform === 'android'
      ? app
      : join(app, await infoValue('CFBundleExecutable'));
  const binaryHash = createHash('sha256');
  for await (const bytes of createReadStream(binary)) binaryHash.update(bytes);
  const sources = (
    await command(['rg', '--files', 'apps/mobile/src', 'packages', 'tests/ui'])
  ).stdout
    .trim()
    .split('\n')
    .sort();
  const sourceHash = createHash('sha256');
  for (const path of [
    ...sources,
    'scripts/test-ui.ts',
    'apps/mobile/app.config.ts',
    'pnpm-lock.yaml',
  ])
    sourceHash
      .update(path)
      .update('\0')
      .update(await readFile(join(root, path)));
  build = {
    version,
    buildNumber,
    artifactSHA256: binaryHash.digest('hex'),
    artifactHashScope:
      platform === 'android' ? 'Debug APK' : 'Main Debug executable',
    sourceSHA256: sourceHash.digest('hex'),
    gitCommit: (await command(['git', 'rev-parse', 'HEAD'])).stdout.trim(),
  };
  driverVersion = (
    await command([maestro, '--version'], 'driver-version.log')
  ).stdout.trim();
  device = await ownedDevice();
  if (platform === 'ios') {
    const listing = JSON.parse(
      (await command(['xcrun', 'simctl', 'list', 'devices', '-j'])).stdout,
    ) as { devices: Record<string, Device[]> };
    if (
      listing.devices[device.runtime]?.find((d) => d.udid === device!.id)
        ?.state !== 'Booted'
    )
      await command(['xcrun', 'simctl', 'boot', device.id], 'boot.log');
    await command(
      ['xcrun', 'simctl', 'bootstatus', device.id, '-b'],
      'boot-status.log',
    );
  } else {
    assert.equal(
      (
        await command([
          adb,
          '-s',
          device.id,
          'shell',
          'getprop',
          'sys.boot_completed',
        ])
      ).stdout.trim(),
      '1',
    );
    await command([
      adb,
      '-s',
      device.id,
      'reverse',
      'tcp:' + port,
      'tcp:' + port,
    ]);
  }
  build.os =
    platform === 'android'
      ? (
          await command([
            adb,
            '-s',
            device.id,
            'shell',
            'getprop',
            'ro.build.version.release',
          ])
        ).stdout.trim()
      : device.runtime;
  const env = {
    APP_ID: appId,
    APP_SCHEME: appScheme,
    EXECUTION_TITLE: 'UI Execution Task',
    METRO_URL: 'http://127.0.0.1:' + port,
    DEV_URL:
      appScheme +
      '://expo-development-client/?url=' +
      encodeURIComponent('http://127.0.0.1:' + port),
  };
  const flow = async (
    iteration: number,
    name: string,
    values: Record<string, string> = {},
  ) => {
    console.log('[test:ui] run', iteration, 'stage', name);
    if (platform === 'android') await androidDevelopmentBridge(device!.id);
    const label = values.JOURNEY ? values.JOURNEY + '-' + name : name;
    const folder = join(outputRoot, 'run-' + iteration, label);
    await mkdir(folder, { recursive: true });
    const vars = Object.entries({ ...env, ...values }).flatMap(
      ([key, value]) => ['-e', key + '=' + value],
    );
    await command(
      [
        maestro,
        '--device',
        device!.id,
        'test',
        '--no-ansi',
        '--test-output-dir',
        folder,
        '--format',
        'JUNIT',
        '--output',
        join(folder, 'report.xml'),
        ...vars,
        join(root, 'tests/ui/flows', name + '.yaml'),
      ],
      'run-' + iteration + '-' + label + '.log',
    );
  };
  for (let iteration = 1; iteration <= runs; iteration += 1) {
    const result = {
      run: iteration,
      checkpoints: [] as { stage: string; facts: unknown }[],
      status: 'running',
    };
    results.push(result);
    // Device ownership is verified before the only data reset: uninstalling our app.
    if (platform === 'android') {
      await androidNetwork(device.id, false, 'run-' + iteration + '-online');
      await command(
        [adb, '-s', device.id, 'uninstall', appId],
        'uninstall-' + iteration + '.log',
        true,
      );
      await command(
        [adb, '-s', device.id, 'install', app],
        'install-' + iteration + '.log',
      );
      // Native diagnostic preferences in this newly installed test sandbox.
      // Expo's first-launch menu can obscure the app after the bundle loads.
      const diagnosticPreferences =
        '<map><boolean name="showsAtLaunch" value="false"/><boolean name="isOnboardingFinished" value="true"/><boolean name="showFab" value="false"/></map>';
      await command(
        [
          adb,
          '-s',
          device.id,
          'shell',
          [
            'run-as',
            appId,
            'sh',
            '-c',
            "mkdir -p shared_prefs && printf '%s' " +
              quoteRemote(diagnosticPreferences) +
              ' > shared_prefs/expo.modules.devmenu.sharedpreferences.xml',
          ]
            .map(quoteRemote)
            .join(' '),
        ],
        'diagnostic-preferences-' + iteration + '.log',
      );
    } else {
      await command(
        ['xcrun', 'simctl', 'uninstall', device.id, appId],
        'uninstall-' + iteration + '.log',
        true,
      );
    }
    let dbPath = '';
    if (platform === 'ios') {
      await command(
        ['xcrun', 'simctl', 'install', device.id, app],
        'install-' + iteration + '.log',
      );
      const container = (
        await command([
          'xcrun',
          'simctl',
          'get_app_container',
          device.id,
          appId,
          'data',
        ])
      ).stdout.trim();
      dbPath = join(container, 'Documents/SQLite/execution-agent.sqlite');
      // The freshly installed, owned development sandbox only: Expo's diagnostic
      // floating button overlaps the Settings link on iOS. This does not touch
      // business SQLite or introduce an application testing API.
      const preferences = join(container, 'Library/Preferences');
      await mkdir(preferences, { recursive: true });
      await writeFile(
        join(preferences, appId + '.plist'),
        '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>EXDevMenuShowFloatingActionButton</key><false/><key>EXDevMenuShowsAtLaunch</key><false/><key>EXDevMenuIsOnboardingFinished</key><true/></dict></plist>',
      );
    }
    const checkpoint = async (stage: string): Promise<Facts> => {
      const facts =
        platform === 'android'
          ? await androidSnapshot(device!.id)
          : snapshot(dbPath);
      assert.ok(
        facts.integrity.every((row) => row.integrity_check === 'ok'),
        'SQLite integrity check',
      );
      result.checkpoints.push({ stage, facts });
      return facts;
    };
    await flow(iteration, 'setup-inbox');
    const inbox = await checkpoint('inbox');
    assert.equal(
      inbox.tasks.length,
      1,
      'duplicate taps must create exactly one inbox task',
    );
    assert.equal(inbox.tasks[0]?.title, 'UI Inbox Task');
    assert.equal(inbox.tasks[0]?.estimated_duration_minutes, null);
    assert.equal(inbox.tasks[0]?.status, 'inbox');
    await flow(iteration, 'reject-preview');
    const rejected = await checkpoint('rejected-preview');
    assert.equal(rejected.tasks.length, 2);
    assert.deepEqual(
      rejected.plans,
      inbox.plans,
      'rejecting Preview must not change plan facts',
    );
    assert.deepEqual(rejected.blocks, inbox.blocks);
    assert.equal(rejected.state.plan_revision, inbox.state.plan_revision);
    const journeys: { title: string; offline: boolean }[] = [
      { title: 'UI Execution Task', offline: false },
      ...(platform === 'android'
        ? [{ title: 'UI Offline Task', offline: true }]
        : []),
    ];
    for (const journey of journeys) {
      const flowValues: Record<string, string> = {
        EXECUTION_TITLE: journey.title,
        JOURNEY: journey.offline ? 'offline' : 'online',
      };
      const journeyCheckpoint = (stage: string): Promise<Facts> =>
        checkpoint(flowValues.JOURNEY + '-' + stage);
      if (journey.offline) {
        offlineAttempted = true;
        await androidDevelopmentBridge(device.id);
        await command([
          adb,
          '-s',
          device.id,
          'shell',
          'am',
          'force-stop',
          appId,
        ]);
        const network = await androidNetwork(
          device.id,
          true,
          'run-' + iteration + '-offline',
        );
        result.checkpoints.push({ stage: 'offline-network', facts: network });
      }
      const beforeJourney = await journeyCheckpoint('before');
      await flow(iteration, 'commit-plan', flowValues);
      const committed = await journeyCheckpoint('committed');
      assert.equal(committed.tasks.length, beforeJourney.tasks.length + 1);
      assert.equal(
        committed.plans.length,
        beforeJourney.plans.length + 1,
        'duplicate commit taps must create one plan',
      );
      const task = committed.tasks.find((t) => t.title === journey.title);
      assert.ok(task && task.status === 'planned');
      const block = committed.blocks.find((b) => b.task_id === task.id);
      assert.ok(block && block.status === 'planned');
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: committed.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const plannedDate = formatter.format(new Date(String(block.start_at)));
      const today = formatter.format(new Date());
      const dayAdvance =
        (Date.parse(plannedDate) - Date.parse(today)) / 86_400_000;
      assert.ok(
        Number.isInteger(dayAdvance) && dayAdvance >= 0 && dayAdvance <= 7,
      );
      await flow(iteration, 'start-pause', {
        ...flowValues,
        TASK_ID: String(task.id),
        DAY_ADVANCE: String(dayAdvance),
      });
      const paused = await journeyCheckpoint('paused');
      assert.equal(paused.sessions.length, beforeJourney.sessions.length + 1);
      assert.equal(
        paused.sessions.find((row) => row.task_id === task.id)?.status,
        'paused',
      );
      const pausedSession = paused.sessions.find(
        (row) => row.task_id === task.id,
      );
      assert.ok(
        workSeconds(
          paused.intervals.filter(
            (row) => row.session_id === pausedSession?.id,
          ),
        ) > 0,
        'this journey must record trusted work before pausing',
      );
      assert.equal(
        paused.intervals.filter((i) => i.end_at === null && i.kind === 'pause')
          .length,
        1,
      );
      assert.equal(
        paused.intervals.filter((i) => i.end_at === null && i.kind === 'work')
          .length,
        0,
      );
      await flow(iteration, 'recover-paused', flowValues);
      const recovered = await journeyCheckpoint('recovered-paused');
      assert.deepEqual(
        recovered.sessions,
        paused.sessions,
        'restart preserves paused session identity and facts',
      );
      assert.equal(
        workSeconds(recovered.intervals),
        workSeconds(paused.intervals),
        'paused work must not advance after restart',
      );
      await flow(iteration, 'resume-complete', flowValues);
      const completed = await journeyCheckpoint('completed');
      assert.equal(
        completed.sessions.length,
        beforeJourney.sessions.length + 1,
      );
      assert.equal(
        completed.sessions.find((row) => row.task_id === task.id)
          ?.completion_type,
        'complete_task',
      );
      assert.equal(
        completed.tasks.find((t) => t.id === task.id)?.status,
        'completed',
      );
      assert.equal(
        completed.intervals.filter((i) => i.end_at === null).length,
        0,
      );
      assert.equal(
        completed.completions.length,
        beforeJourney.completions.length + 1,
        'duplicate complete taps must retain a single completion',
      );
      const completion = completed.completions.find(
        (row) => row.task_id === task.id,
      );
      const actualSeconds = completion?.actual_duration_seconds;
      assert.ok(
        typeof actualSeconds === 'number' &&
          Math.abs(
            actualSeconds -
              workSeconds(
                completed.intervals.filter(
                  (row) =>
                    row.session_id ===
                    completed.sessions.find(
                      (session) => session.task_id === task.id,
                    )?.id,
                ),
              ),
          ) < 0.000001,
        'recorded effort agrees with trusted intervals',
      );
      const actualMinutes = completed.tasks.find(
        (row) => row.id === task.id,
      )?.actual_duration_minutes;
      assert.ok(
        typeof actualMinutes === 'number' &&
          Math.abs(actualMinutes - actualSeconds / 60) < 0.000001,
        'task effort projection agrees with the completion record',
      );
      assert.equal(completion?.duration_coverage, 'partial');
      assert.equal(
        completed.achievements.length,
        beforeJourney.achievements.length + 1,
      );
      assert.equal(
        completed.achievements.filter(
          (row) => row.source_completion_record_id === completion?.id,
        ).length,
        1,
      );
      await flow(iteration, 'achievement', {
        ...flowValues,
        COMPLETION_ID: String(completion?.id),
      });
      if (journey.offline) {
        const networkAfter = await observeAndroidNetwork(
          device.id,
          'run-' + iteration + '-offline-after',
        );
        assertAndroidOffline(networkAfter);
        result.checkpoints.push({
          stage: 'offline-network-after',
          facts: networkAfter,
        });
        offlineStatus = 'passed';
      }
    }
    result.status = 'passed';
    console.log('[test:ui] run', iteration, 'manual journey passed');
  }
} catch (error) {
  failure = error instanceof Error ? error.message : 'UI runner failed';
  const current = results.at(-1);
  if (current) current.status = 'failed';
  console.error('[test:ui]', failure);
} finally {
  if (platform === 'android' && device)
    await androidNetwork(device.id, false, 'restore-network').catch(
      () => undefined,
    );
}
const report = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  platform,
  physicalDevice: false,
  device,
  appId,
  build,
  driverVersion,
  requestedRuns: runs,
  consecutiveCleanRunsPassed: results.filter((r) => r.status === 'passed')
    .length,
  localJourney: failure ? 'failed' : 'passed',
  offline: {
    status: failure && offlineAttempted ? 'failed' : offlineStatus,
    reason:
      platform === 'android' && offlineAttempted
        ? 'Airplane enabled, Wi-Fi/mobile data disabled, no active default network; only local adb Metro bridge.'
        : 'Network isolation not executed in this run.',
  },
  planAcceptance:
    !failure && runs >= 2 && offlineStatus === 'passed' ? 'passed' : 'partial',
  results,
  commands,
  artifacts: outputRoot,
  failure,
};
const reportPath = join(root, '.ai/evidence/optimization/ui-results.json');
await mkdir(resolve(reportPath, '..'), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
await writeFile(
  join(outputRoot, 'report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
await writeFile(
  join(root, `.ai/evidence/optimization/ui-results-${platform}.json`),
  JSON.stringify(report, null, 2) + '\n',
);
console.log('[test:ui] evidence:', reportPath);
if (failure) process.exit(1);
