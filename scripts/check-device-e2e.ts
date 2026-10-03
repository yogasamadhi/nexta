import { readFile } from 'node:fs/promises';

const requiredCases = [
  'E2E-001',
  'E2E-002',
  'E2E-003',
  'E2E-004',
  'E2E-005',
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[test:e2e] ${message}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label} must be an object.`,
  );
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.trim() !== '', `${label} missing.`);
  assert(!value.includes('REPLACE_WITH_'), `${label} is still a placeholder.`);
  return value;
}

async function verify(path: string, expectedPlatform: 'ios' | 'android') {
  const evidence = object(
    JSON.parse(await readFile(path, 'utf8')),
    `${expectedPlatform} evidence`,
  );
  assert(evidence.schemaVersion === 1, 'unsupported evidence schema.');
  assert(evidence.releaseVersion === '0.1.0', 'release version mismatch.');
  assert(evidence.platform === expectedPlatform, 'platform mismatch.');
  assert(
    evidence.physicalDevice === true,
    'evidence must use a physical device.',
  );
  text(evidence.deviceModel, 'deviceModel');
  text(evidence.osVersion, 'osVersion');
  text(evidence.buildIdentifier, 'buildIdentifier');
  text(evidence.tester, 'tester');
  const observedAt = text(evidence.observedAt, 'observedAt');
  assert(
    Number.isFinite(Date.parse(observedAt)),
    'observedAt must be ISO-8601.',
  );
  assert(Array.isArray(evidence.cases), 'cases must be an array.');
  const byId = new Map(
    evidence.cases.map((value) => {
      const item = object(value, 'case');
      return [item.id, item] as const;
    }),
  );
  for (const id of requiredCases) {
    const item = byId.get(id);
    assert(item !== undefined, `${expectedPlatform} ${id} missing.`);
    assert(
      item.status === 'passed',
      `${expectedPlatform} ${id} is not passed.`,
    );
    assert(
      Array.isArray(item.evidence) && item.evidence.length > 0,
      `${expectedPlatform} ${id} needs evidence references.`,
    );
    for (const reference of item.evidence) text(reference, `${id} evidence`);
  }
  assert(
    byId.size === requiredCases.length,
    'unexpected E2E case identifiers.',
  );
}

const iosPath = process.env.NEXTA_IOS_DEVICE_EVIDENCE;
const androidPath = process.env.NEXTA_ANDROID_DEVICE_EVIDENCE;
assert(
  iosPath !== undefined && androidPath !== undefined,
  'set NEXTA_IOS_DEVICE_EVIDENCE and NEXTA_ANDROID_DEVICE_EVIDENCE to reviewed physical-device evidence files; copy the release/*.example.json templates first.',
);

await verify(iosPath, 'ios');
await verify(androidPath, 'android');
console.log('[test:e2e] physical iOS and Android E2E-001..005 evidence passed');
