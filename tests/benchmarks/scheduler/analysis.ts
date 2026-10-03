import type { ScheduleInput, ScheduleResult } from '@workspace/scheduler-core';

function requireInvariant(valid: boolean, message: string): asserts valid {
  if (!valid) throw new Error('Benchmark invariant failed: ' + message);
}

function minutes(start: string, end: string) {
  return (Date.parse(end) - Date.parse(start)) / 60_000;
}

function overlaps(
  a: { start: string; end: string },
  b: { start: string; end: string },
) {
  return (
    Date.parse(a.start) < Date.parse(b.end) &&
    Date.parse(b.start) < Date.parse(a.end)
  );
}

/** Independent postconditions; protected pre-existing conflicts remain facts. */
export function assertFeasible(input: ScheduleInput, result: ScheduleResult) {
  const protectedInputs = input.existingBlocks.filter(
    (block) =>
      block.locked ||
      block.status === 'started' ||
      block.status === 'completed',
  );
  requireInvariant(
    new Set(result.blocks.map((block) => block.stableKey)).size ===
      result.blocks.length,
    'duplicate stable block key',
  );
  for (const source of protectedInputs) {
    const block = result.blocks.find((b) => b.existingBlockId === source.id);
    requireInvariant(
      block !== undefined,
      'protected block missing: ' + source.id,
    );
    requireInvariant(
      (['start', 'end', 'status', 'locked', 'taskId', 'type'] as const).every(
        (key) => block[key] === source[key],
      ),
      'protected block changed: ' + source.id,
    );
  }
  const tasks = new Map(input.tasks.map((task) => [task.id, task]));
  const generated = result.blocks.filter(
    (b) => b.changeReason !== 'protected_existing',
  );
  for (const block of generated) {
    const task = tasks.get(block.taskId ?? '');
    requireInvariant(
      task?.duration.state === 'known',
      'allocation without known task effort',
    );
    const start = Date.parse(block.start);
    const end = Date.parse(block.end);
    requireInvariant(
      block.status === 'planned' &&
        !block.locked &&
        start >= Date.parse(input.now) &&
        start >= Date.parse(input.horizon.start) &&
        end <= Date.parse(input.horizon.end) &&
        end > start,
      'generated status or horizon',
    );
    requireInvariant(
      input.preferences.workingWindows.some(
        (w) => start >= Date.parse(w.start) && end <= Date.parse(w.end),
      ),
      'outside working window',
    );
    requireInvariant(
      task.earliestStart === null || start >= Date.parse(task.earliestStart),
      'before earliest start',
    );
    requireInvariant(
      task.deadline === null || end <= Date.parse(task.deadline),
      'after deadline',
    );
    const duration = minutes(block.start, block.end);
    requireInvariant(
      duration >=
        (task.minBlockMinutes ?? input.policy.defaultMinBlockMinutes) &&
        duration <=
          (task.maxBlockMinutes ?? input.policy.defaultMaxBlockMinutes),
      'block duration constraint',
    );
    const grid = input.policy.granularityMinutes * 60_000;
    requireInvariant(
      (start - Date.parse(input.policy.gridAnchor)) % grid === 0 &&
        (end - Date.parse(input.policy.gridAnchor)) % grid === 0,
      'off-grid allocation',
    );
    requireInvariant(
      !input.busyEvents.some((busy) => overlaps(block, busy)),
      'Busy overlap',
    );
    requireInvariant(
      !result.blocks.some(
        (other) =>
          other !== block &&
          (other.status === 'planned' || other.status === 'started') &&
          overlaps(block, other),
      ),
      'block overlap',
    );
  }
  for (const task of input.tasks) {
    if (task.duration.state !== 'known' || task.dependencyState !== 'none')
      continue;
    const allocations = generated.filter((b) => b.taskId === task.id);
    requireInvariant(
      task.splittable || allocations.length <= 1,
      'unsplittable task split',
    );
    const allocated = allocations.reduce(
      (sum, b) => sum + minutes(b.start, b.end),
      0,
    );
    const committed = protectedInputs
      .filter(
        (b) =>
          b.taskId === task.id &&
          (b.status === 'planned' || b.status === 'started'),
      )
      .reduce(
        (sum, b) =>
          sum +
          Math.max(
            0,
            (Date.parse(b.end) -
              Math.max(Date.parse(b.start), Date.parse(input.now))) /
              60_000,
          ),
        0,
      );
    const missing =
      result.unscheduled.find((u) => u.taskId === task.id)?.remainingMinutes ??
      0;
    requireInvariant(
      allocated + missing ===
        Math.max(0, task.duration.remainingMinutes - committed),
      'effort conservation: ' + task.id,
    );
  }
}

export function planChanges(input: ScheduleInput, result: ScheduleResult) {
  const before = new Map(
    input.existingBlocks.map((block) => [block.id, block]),
  );
  const matched = new Set<string>();
  let added = 0;
  let moved = 0;
  let resized = 0;
  let unchanged = 0;
  let totalStartOffsetMinutes = 0;
  for (const block of result.blocks) {
    const source =
      block.existingBlockId === null
        ? undefined
        : before.get(block.existingBlockId);
    if (source === undefined) {
      added += 1;
      continue;
    }
    requireInvariant(!matched.has(source.id), 'duplicate existing block match');
    matched.add(source.id);
    const startOffset = Math.abs(minutes(source.start, block.start));
    const durationChanged =
      minutes(source.start, source.end) !== minutes(block.start, block.end);
    if (startOffset > 0) moved += 1;
    if (durationChanged) resized += 1;
    if (startOffset === 0 && !durationChanged) unchanged += 1;
    totalStartOffsetMinutes += startOffset;
  }
  return {
    added,
    removed: before.size - matched.size,
    moved,
    resized,
    unchanged,
    totalStartOffsetMinutes,
  };
}

export function timingSummary(samples: readonly number[]) {
  requireInvariant(samples.length > 0, 'empty timing sample');
  const sorted = [...samples].sort((a, b) => a - b);
  const quantile = (fraction: number) =>
    Number(
      (
        sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
      ).toFixed(3),
    );
  return {
    samples: samples.length,
    minMs: quantile(0),
    medianMs: quantile(0.5),
    p95Ms: quantile(0.95),
    maxMs: quantile(1),
  };
}
