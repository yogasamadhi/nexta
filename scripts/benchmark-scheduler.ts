import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { dirname, resolve } from 'node:path';

import { previewSchedule, replanSchedule } from '@workspace/scheduler-core';
import type { ScheduleInput, ScheduleResult } from '@workspace/scheduler-core';

import {
  assertFeasible,
  planChanges,
  timingSummary,
} from '../tests/benchmarks/scheduler/analysis';
import {
  benchmarkScenarios,
  replanInput,
} from '../tests/benchmarks/scheduler/scenarios';

const argumentsByName = new Map<string, string>();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (
    !key ||
    !['--samples', '--warmup', '--case', '--output'].includes(key) ||
    !value ||
    argumentsByName.has(key)
  )
    throw new Error('Invalid benchmark arguments.');
  argumentsByName.set(key, value);
}
function integerOption(name: string, fallback: number, minimum: number) {
  const raw = argumentsByName.get(name);
  if (raw !== undefined && !/^\d+$/.test(raw))
    throw new Error('Invalid ' + name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > 100)
    throw new Error('Invalid ' + name);
  return value;
}
const samples = integerOption('--samples', 5, 3);
const warmup = integerOption('--warmup', 1, 1);
const selectedCase = argumentsByName.get('--case');
const scenarios = benchmarkScenarios().filter(
  (scenario) => !selectedCase || scenario.id === selectedCase,
);
if (scenarios.length === 0) throw new Error('Unknown benchmark case.');
const output = resolve(
  argumentsByName.get('--output') ??
    '.ai/evidence/optimization/scheduler-benchmark.json',
);

function measure(
  input: ScheduleInput,
  calculate: (i: ScheduleInput) => ScheduleResult,
) {
  const originalInput = JSON.stringify(input);
  const expected = calculate(input);
  assertFeasible(input, expected);
  const times: number[] = [];
  for (let iteration = 0; iteration < warmup + samples; iteration += 1) {
    const start = performance.now();
    const actual = calculate(input);
    const elapsed = performance.now() - start;
    if (iteration >= warmup) times.push(elapsed);
    assert.deepEqual(actual, expected, 'deterministic schedule result');
  }
  assert.equal(JSON.stringify(input), originalInput, 'input not mutated');
  assert.deepEqual(
    calculate({
      ...input,
      tasks: [...input.tasks].reverse(),
      busyEvents: [...input.busyEvents].reverse(),
      existingBlocks: [...input.existingBlocks].reverse(),
      preferences: {
        ...input.preferences,
        workingWindows: [...input.preferences.workingWindows].reverse(),
      },
    }),
    expected,
    'collection permutation stability',
  );
  return {
    result: expected,
    timing: timingSummary(times),
    changes: planChanges(input, expected),
    metrics: expected.metrics,
  };
}

const cases = [];
for (const scenario of scenarios) {
  const preview = measure(scenario.input, previewSchedule);
  const replan = measure(
    replanInput(scenario.input, preview.result),
    replanSchedule,
  );
  cases.push({
    id: scenario.id,
    seed: scenario.seed,
    taskCount: scenario.taskCount,
    horizonDays: scenario.horizonDays,
    busyDensity: scenario.busyDensity,
    policyVersion: scenario.input.policy.policyVersion,
    preview: {
      timing: preview.timing,
      changes: preview.changes,
      metrics: preview.metrics,
    },
    replan: {
      timing: replan.timing,
      changes: replan.changes,
      metrics: replan.metrics,
    },
    invariants: 'passed',
  });
  console.log(
    '[bench:scheduler]',
    scenario.id,
    'preview p95',
    preview.timing.p95Ms,
    'ms; replan p95',
    replan.timing.p95Ms,
    'ms',
  );
}
const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
});
const revision =
  revisionResult.status === 0 ? revisionResult.stdout.trim() : null;
const statusResult = spawnSync('git', ['status', '--porcelain'], {
  encoding: 'utf8',
});
const sourcePaths = [
  'packages/scheduler-core/src/scheduler.ts',
  'packages/scheduler-core/src/time.ts',
  'packages/scheduler-core/src/types.ts',
  'packages/scheduler-core/src/validation.ts',
  'tests/benchmarks/scheduler/scenarios.ts',
  'tests/benchmarks/scheduler/analysis.ts',
  'scripts/benchmark-scheduler.ts',
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    ]),
  ),
);
const report = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  revision,
  workingTreeDirty:
    statusResult.status === 0 ? statusResult.stdout.trim().length > 0 : null,
  sourceHashes,
  runtime: 'Node ' + process.versions.node,
  environment: {
    platform: platform(),
    architecture: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
  },
  samples,
  warmup,
  timingMethod:
    'Empirical nearest-rank p95; correctness checks outside timed interval.',
  scope:
    'Synthetic UTC-expanded working windows; neutral and explicitly labelled example policy. No production policy change; no Hermes claim.',
  cases,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log('[bench:scheduler] wrote', cases.length, 'cases to', output);
