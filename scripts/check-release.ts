import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ANDROID_VERSION_CODE,
  APP_VERSION,
  IOS_BUILD_NUMBER,
  createAppConfig,
} from '../apps/mobile/app.config';

const workspaceRoot = join(import.meta.dir, '..');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[release:check] ${message}`);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(workspaceRoot, path), 'utf8'));
}

function object(value: unknown, label: string): Record<string, unknown> {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label} must be an object.`,
  );
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.trim() !== '', `${label} missing.`);
  return value;
}

function array(value: unknown, label: string): readonly unknown[] {
  assert(Array.isArray(value), `${label} must be an array.`);
  return value;
}

const rootPackage = object(await readJson('package.json'), 'package.json');
const rootScripts = object(rootPackage.scripts, 'package.json scripts');
const devDependencies = object(
  rootPackage.devDependencies,
  'package.json devDependencies',
);
assert(devDependencies['eas-cli'] === '24.3.0', 'eas-cli must be pinned.');
for (const script of [
  'release:check',
  'release:gate',
  'test:e2e',
  'build:ios',
  'build:android',
  'submit:ios',
  'submit:android',
]) {
  string(rootScripts[script], `script ${script}`);
}

const mobilePackage = object(
  await readJson('apps/mobile/package.json'),
  'mobile package.json',
);
assert(mobilePackage.version === APP_VERSION, 'mobile version must match app.');

const eas = object(await readJson('apps/mobile/eas.json'), 'eas.json');
const cli = object(eas.cli, 'eas.json cli');
assert(cli.version === '= 24.3.0', 'eas.json must pin the installed CLI.');
assert(
  cli.appVersionSource === 'remote',
  'production build numbers must use the EAS remote source.',
);
const profiles = object(eas.build, 'eas.json build');
for (const variant of ['development', 'preview', 'production'] as const) {
  const profile = object(profiles[variant], `build.${variant}`);
  assert(profile.environment === variant, `${variant} environment mismatch.`);
  const env = object(profile.env, `build.${variant}.env`);
  assert(env.APP_VARIANT === variant, `${variant} APP_VARIANT mismatch.`);
  for (const key of Object.keys(env)) {
    assert(
      !/(?:secret|password|token|private|credential|api[_-]?key)/i.test(key),
      `committed EAS env key ${key} looks secret-bearing.`,
    );
  }
}
assert(
  object(profiles.development, 'development').developmentClient === true,
  'development must use expo-dev-client.',
);
assert(
  object(profiles.preview, 'preview').distribution === 'internal',
  'preview must use internal distribution.',
);
assert(
  object(profiles.production, 'production').autoIncrement === true,
  'production must auto-increment remote build versions.',
);
assert(
  object(eas.submit, 'eas.json submit').production !== undefined,
  'production submit profile missing.',
);

const iosIdentifiers = new Set<string>();
const androidIdentifiers = new Set<string>();
for (const variant of ['development', 'preview', 'production'] as const) {
  const config = createAppConfig({}, variant);
  assert(config.version === APP_VERSION, `${variant} app version mismatch.`);
  assert(
    config.ios?.buildNumber === IOS_BUILD_NUMBER,
    `${variant} iOS build number mismatch.`,
  );
  assert(
    config.android?.versionCode === ANDROID_VERSION_CODE,
    `${variant} Android version code mismatch.`,
  );
  assert(
    config.updates?.enabled === false,
    `${variant} must keep production OTA disabled while DEC-008 is open.`,
  );
  assert(
    config.extra?.environment === variant,
    `${variant} runtime environment mismatch.`,
  );
  const bundleIdentifier = string(
    config.ios?.bundleIdentifier,
    `${variant} iOS bundleIdentifier`,
  );
  const packageName = string(
    config.android?.package,
    `${variant} Android package`,
  );
  iosIdentifiers.add(bundleIdentifier);
  androidIdentifiers.add(packageName);
}
assert(
  iosIdentifiers.size === 3 && androidIdentifiers.size === 3,
  'development, preview and production identifiers must be distinct per platform.',
);

const privacy = object(
  await readJson('release/store-privacy.json'),
  'store privacy metadata',
);
assert(privacy.schemaVersion === 1, 'privacy schemaVersion must be 1.');
assert(privacy.releaseVersion === APP_VERSION, 'privacy version mismatch.');
assert(privacy.tracking === false, 'tracking cannot be enabled implicitly.');
assert(
  privacy.status === 'draft_requires_product_legal_and_store_review',
  'privacy copy must retain human review status.',
);
const copy = object(privacy.storeCopy, 'privacy storeCopy');
string(copy['zh-CN'], 'zh-CN privacy copy');
string(copy['en-US'], 'en-US privacy copy');
assert(
  array(privacy.requiredBeforeSubmission, 'privacy requiredBeforeSubmission')
    .length > 0,
  'privacy review requirements missing.',
);

const checklist = object(
  await readJson('release/release-checklist.json'),
  'release checklist',
);
assert(checklist.releaseVersion === APP_VERSION, 'checklist version mismatch.');
for (const gate of array(checklist.technicalGates, 'technicalGates')) {
  const item = object(gate, 'technical gate');
  const command = string(item.command, 'technical gate command');
  assert(
    Object.values(rootScripts).includes(command.replace('bun run ', '')) ||
      command === 'bun run check' ||
      command === 'bun run release:check' ||
      command === 'bun run test:e2e' ||
      command === 'bun run build:ios' ||
      command === 'bun run build:android',
    `unknown technical gate command ${command}.`,
  );
}
const externalGates = array(checklist.externalGates, 'externalGates');
assert(externalGates.length > 0, 'external release gates must be explicit.');
for (const gate of externalGates) {
  const item = object(gate, 'external gate');
  assert(
    item.status === 'pending' || item.status === 'passed',
    'external gate status must be pending or passed.',
  );
  if (item.status === 'passed') {
    string(item.evidence, 'passed external gate evidence');
  } else {
    string(item.reason, 'pending external gate reason');
  }
}

console.log(
  `[release:check] static release configuration passed; ${externalGates.filter((gate) => object(gate, 'external gate').status === 'pending').length} external gates remain pending`,
);
