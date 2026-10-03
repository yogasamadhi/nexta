import {
  alignAtOrAfter,
  formatInstant,
  mergeIntervals,
  millisecondsToMinutes,
  minutesToMilliseconds,
  overlapMilliseconds,
  overlaps,
  parseInstantMilliseconds,
  subtractIntervals,
  type NumericInterval,
} from './time';
import { SCHEDULER_VERSION } from './types';
import type {
  ExistingTimeBlock,
  ProposedBlockChangeReason,
  ProposedTimeBlock,
  ScheduleExplanation,
  ScheduleInput,
  ScheduleResult,
  ScheduleWarning,
  SchedulableTask,
  ScoredWindow,
  UnscheduledReasonCode,
  UnscheduledTask,
  WorkingWindow,
} from './types';
import { validateScheduleInput } from './validation';

type NumericTask = Readonly<{
  source: SchedulableTask;
  earliestStart: number | null;
  deadline: number | null;
  minBlock: number;
  maxBlock: number;
  priorityRank: number;
}>;

type NumericWorkingWindow = Readonly<{
  source: WorkingWindow;
  start: number;
  end: number;
}>;

type NumericExistingBlock = Readonly<{
  source: ExistingTimeBlock;
  start: number;
  end: number;
}>;

type NumericScoredWindow = Readonly<{
  source: ScoredWindow;
  start: number;
  end: number;
}>;

type ScoreComponents = Readonly<{
  planStability: number;
  fragmentation: number;
  preferredHours: number;
  completionRate: number;
  energyMatch: number;
  recoveryPenalty: number;
  total: number;
}>;

type Candidate = Readonly<{
  start: number;
  end: number;
  windowId: string;
  matchedExisting: NumericExistingBlock | null;
  score: ScoreComponents;
}>;

type Allocation = Readonly<{
  blocks: readonly ProposedTimeBlock[];
  explanations: readonly ScheduleExplanation[];
  allocatedMilliseconds: number;
  complete: boolean;
}>;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestamp(instant: string): number {
  return parseInstantMilliseconds(instant) as number;
}

function numericInterval(start: string, end: string): NumericInterval {
  return { start: timestamp(start), end: timestamp(end) };
}

function isActiveStatus(status: ExistingTimeBlock['status']): boolean {
  return status === 'planned' || status === 'started' || status === 'completed';
}

function isProtectedBlock(
  block: ExistingTimeBlock,
  tasksById: ReadonlyMap<string, SchedulableTask>,
): boolean {
  if (
    block.locked ||
    block.status === 'started' ||
    block.status === 'completed'
  ) {
    return true;
  }
  if (block.status !== 'planned') return false;
  if (block.taskId === null) return true;
  const task = tasksById.get(block.taskId);
  return task === undefined;
}

function stableExistingKey(id: string): string {
  return `existing|${id.length}:${id}`;
}

function stableGeneratedKey(
  taskId: string,
  start: number,
  end: number,
): string {
  return `new|${taskId.length}:${taskId}|${formatInstant(start)}|${formatInstant(end)}`;
}

function proposedFromProtected(block: ExistingTimeBlock): ProposedTimeBlock {
  return {
    stableKey: stableExistingKey(block.id),
    existingBlockId: block.id,
    taskId: block.taskId,
    type: block.type,
    start: block.start,
    end: block.end,
    status: block.status,
    locked: block.locked,
    changeReason: 'protected_existing',
  };
}

function blockSort(left: ProposedTimeBlock, right: ProposedTimeBlock): number {
  return (
    timestamp(left.start) - timestamp(right.start) ||
    timestamp(left.end) - timestamp(right.end) ||
    compareStrings(left.stableKey, right.stableKey)
  );
}

function warningSort(left: ScheduleWarning, right: ScheduleWarning): number {
  return (
    compareStrings(left.entityType, right.entityType) ||
    compareStrings(left.entityId ?? '', right.entityId ?? '') ||
    compareStrings(left.code, right.code) ||
    compareStrings(left.message, right.message)
  );
}

function explanationSort(
  left: ScheduleExplanation,
  right: ScheduleExplanation,
): number {
  return (
    compareStrings(left.entityType, right.entityType) ||
    compareStrings(left.entityId, right.entityId) ||
    compareStrings(left.code, right.code) ||
    compareStrings(
      String(left.metadata.start ?? ''),
      String(right.metadata.start ?? ''),
    )
  );
}

function addWarning(
  warnings: ScheduleWarning[],
  warning: ScheduleWarning,
): void {
  const duplicate = warnings.some(
    (candidate) =>
      candidate.entityType === warning.entityType &&
      candidate.entityId === warning.entityId &&
      candidate.code === warning.code &&
      candidate.message === warning.message,
  );
  if (!duplicate) warnings.push(warning);
}

function intervalCoveredByWorkingWindows(
  interval: NumericInterval,
  workingWindows: readonly NumericWorkingWindow[],
): boolean {
  let cursor = interval.start;
  const sorted = workingWindows
    .filter((window) => overlaps(interval, window))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        compareStrings(left.source.id, right.source.id),
    );
  for (const window of sorted) {
    if (window.start > cursor) return false;
    cursor = Math.max(cursor, window.end);
    if (cursor >= interval.end) return true;
  }
  return false;
}

function diagnoseProtectedBlocks(
  protectedBlocks: readonly NumericExistingBlock[],
  busy: readonly NumericInterval[],
  workingWindows: readonly NumericWorkingWindow[],
  tasksById: ReadonlyMap<string, NumericTask>,
  warnings: ScheduleWarning[],
): void {
  for (let index = 0; index < protectedBlocks.length; index += 1) {
    const block = protectedBlocks[index] as NumericExistingBlock;
    const interval = { start: block.start, end: block.end };
    const isActive = isActiveStatus(block.source.status);

    if (isActive && busy.some((event) => overlaps(interval, event))) {
      addWarning(warnings, {
        entityType: 'block',
        entityId: block.source.id,
        code: 'protected_busy_conflict',
        severity: 'error',
        message:
          'A protected existing block overlaps a busy event and was preserved.',
      });
    }

    for (
      let otherIndex = index + 1;
      otherIndex < protectedBlocks.length;
      otherIndex += 1
    ) {
      const other = protectedBlocks[otherIndex] as NumericExistingBlock;
      if (
        isActive &&
        isActiveStatus(other.source.status) &&
        overlaps(interval, { start: other.start, end: other.end })
      ) {
        addWarning(warnings, {
          entityType: 'block',
          entityId: block.source.id,
          code: 'protected_block_conflict',
          severity: 'error',
          message: `Protected blocks ${block.source.id} and ${other.source.id} overlap and were preserved.`,
        });
        addWarning(warnings, {
          entityType: 'block',
          entityId: other.source.id,
          code: 'protected_block_conflict',
          severity: 'error',
          message: `Protected blocks ${block.source.id} and ${other.source.id} overlap and were preserved.`,
        });
      }
    }

    if (
      isActive &&
      block.source.status !== 'completed' &&
      !intervalCoveredByWorkingWindows(interval, workingWindows)
    ) {
      addWarning(warnings, {
        entityType: 'block',
        entityId: block.source.id,
        code: 'protected_outside_working_window',
        severity: 'warning',
        message:
          'A protected existing block is outside the supplied working windows and was preserved.',
      });
    }

    if (block.source.taskId !== null && block.source.status !== 'completed') {
      const task = tasksById.get(block.source.taskId);
      if (
        task !== undefined &&
        ((task.earliestStart !== null && block.start < task.earliestStart) ||
          (task.deadline !== null && block.end > task.deadline))
      ) {
        addWarning(warnings, {
          entityType: 'block',
          entityId: block.source.id,
          code: 'protected_task_constraint_conflict',
          severity: 'error',
          message:
            'A protected existing block violates its task time constraints and was preserved.',
        });
      }
    }

    if (
      block.source.status === 'planned' &&
      (block.source.taskId === null || !tasksById.has(block.source.taskId))
    ) {
      addWarning(warnings, {
        entityType: 'block',
        entityId: block.source.id,
        code: 'orphan_existing_block_preserved',
        severity: 'warning',
        message:
          'A planned block without a schedulable task was preserved rather than changed implicitly.',
      });
    }
  }
}

function numericScoredWindows(
  windows: readonly ScoredWindow[],
): NumericScoredWindow[] {
  return windows
    .map((source) => ({
      source,
      start: timestamp(source.start),
      end: timestamp(source.end),
    }))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        compareStrings(left.source.id, right.source.id),
    );
}

function averageWindowScore(
  interval: NumericInterval,
  windows: readonly NumericScoredWindow[],
): number {
  const duration = interval.end - interval.start;
  if (duration <= 0) return 0;
  let weighted = 0;
  for (const window of windows) {
    const overlap = overlapMilliseconds(interval, window);
    if (overlap > 0) weighted += (overlap / duration) * window.source.score;
  }
  return weighted;
}

function energyScore(
  task: SchedulableTask,
  window: WorkingWindow,
  input: ScheduleInput,
): number {
  if (task.energyDemand === null) return 0;
  if (window.energyLevel === null) return input.policy.defaultEnergyMatchScore;
  const match = input.policy.energyMatchScores.find(
    (candidate) =>
      candidate.demand === task.energyDemand &&
      candidate.supply === window.energyLevel,
  );
  return match?.score ?? input.policy.defaultEnergyMatchScore;
}

function bestExistingMatch(
  candidate: NumericInterval,
  availableExisting: readonly NumericExistingBlock[],
): Readonly<{ block: NumericExistingBlock | null; score: number }> {
  let best: NumericExistingBlock | null = null;
  let bestScore = -1;
  for (const existing of availableExisting) {
    const overlap = overlapMilliseconds(candidate, existing);
    const denominator = Math.max(
      candidate.end - candidate.start,
      existing.end - existing.start,
    );
    const score = denominator === 0 ? 0 : overlap / denominator;
    if (
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        compareStrings(existing.source.id, best.source.id) < 0)
    ) {
      best = existing;
      bestScore = score;
    }
  }
  return { block: best, score: Math.max(0, bestScore) };
}

function scoreCandidate(
  task: NumericTask,
  candidate: NumericInterval,
  workingWindow: NumericWorkingWindow,
  desiredMaximumLength: number,
  availableExisting: readonly NumericExistingBlock[],
  input: ScheduleInput,
  preferred: readonly NumericScoredWindow[],
  completionRates: readonly NumericScoredWindow[],
  recoveryPenalties: readonly NumericScoredWindow[],
): Readonly<{
  matchedExisting: NumericExistingBlock | null;
  components: ScoreComponents;
}> {
  const existing = bestExistingMatch(candidate, availableExisting);
  const fragmentation =
    desiredMaximumLength === 0
      ? 0
      : (candidate.end - candidate.start) / desiredMaximumLength;
  const preferredHours = averageWindowScore(candidate, preferred);
  const completionRate = averageWindowScore(candidate, completionRates);
  const energyMatch = energyScore(task.source, workingWindow.source, input);
  const recoveryPenalty = averageWindowScore(candidate, recoveryPenalties);
  const weights = input.policy.scoreWeights;
  const total =
    existing.score * weights.planStability +
    fragmentation * weights.fragmentation +
    preferredHours * weights.preferredHours +
    completionRate * weights.completionRate +
    energyMatch * weights.energyMatch -
    recoveryPenalty * weights.recoveryPenalty;
  return {
    matchedExisting: existing.block,
    components: {
      planStability: existing.score,
      fragmentation,
      preferredHours,
      completionRate,
      energyMatch,
      recoveryPenalty,
      total,
    },
  };
}

function candidateSort(left: Candidate, right: Candidate): number {
  return (
    right.score.total - left.score.total ||
    left.start - right.start ||
    right.end - left.end ||
    compareStrings(
      left.matchedExisting?.source.id ?? '',
      right.matchedExisting?.source.id ?? '',
    ) ||
    compareStrings(left.windowId, right.windowId)
  );
}

function candidateLength(
  remaining: number,
  capacity: number,
  minBlock: number,
  maxBlock: number,
  splittable: boolean,
  requireComplete: boolean,
): number | null {
  if (!splittable) {
    return remaining >= minBlock &&
      remaining <= maxBlock &&
      remaining <= capacity
      ? remaining
      : null;
  }

  let length = Math.min(remaining, capacity, maxBlock);
  if (length < minBlock) return null;

  const leftover = remaining - length;
  if (requireComplete && leftover > 0 && leftover < minBlock) {
    const adjusted = remaining - minBlock;
    if (adjusted < minBlock || adjusted > capacity || adjusted > maxBlock) {
      return null;
    }
    length = adjusted;
  }
  return length;
}

function hasSufficientRemainingCapacity(
  task: NumericTask,
  remaining: number,
  occupied: readonly NumericInterval[],
  workingWindows: readonly NumericWorkingWindow[],
  input: ScheduleInput,
): boolean {
  if (remaining === 0) return true;
  if (!task.source.splittable) return false;
  if (task.minBlock === task.maxBlock && remaining % task.minBlock !== 0) {
    return false;
  }

  const horizonStart = timestamp(input.horizon.start);
  const horizonEnd = timestamp(input.horizon.end);
  const lowerBound = Math.max(
    timestamp(input.now),
    horizonStart,
    task.earliestStart ?? horizonStart,
  );
  const upperBound = Math.min(horizonEnd, task.deadline ?? horizonEnd);
  const grid = minutesToMilliseconds(input.policy.granularityMinutes);
  const anchor = timestamp(input.policy.gridAnchor);
  let usable = 0;

  for (const window of workingWindows) {
    const availableRange = {
      start: Math.max(window.start, lowerBound),
      end: Math.min(window.end, upperBound),
    };
    if (availableRange.start >= availableRange.end) continue;
    for (const free of subtractIntervals(availableRange, occupied)) {
      const alignedStart = alignAtOrAfter(free.start, anchor, grid);
      const capacity = Math.max(0, free.end - alignedStart);
      const possibleBlockCount = Math.floor(capacity / task.minBlock);
      usable += Math.min(capacity, possibleBlockCount * task.maxBlock);
      if (usable >= remaining) return true;
    }
  }
  return false;
}

function enumerateCandidates(
  task: NumericTask,
  remaining: number,
  occupied: readonly NumericInterval[],
  workingWindows: readonly NumericWorkingWindow[],
  availableExisting: readonly NumericExistingBlock[],
  requireComplete: boolean,
  input: ScheduleInput,
  preferred: readonly NumericScoredWindow[],
  completionRates: readonly NumericScoredWindow[],
  recoveryPenalties: readonly NumericScoredWindow[],
): Candidate[] {
  const horizonStart = timestamp(input.horizon.start);
  const horizonEnd = timestamp(input.horizon.end);
  const lowerBound = Math.max(
    timestamp(input.now),
    horizonStart,
    task.earliestStart ?? horizonStart,
  );
  const upperBound = Math.min(horizonEnd, task.deadline ?? horizonEnd);
  if (lowerBound >= upperBound) return [];

  const grid = minutesToMilliseconds(input.policy.granularityMinutes);
  const anchor = timestamp(input.policy.gridAnchor);
  const candidates: Candidate[] = [];

  for (const window of workingWindows) {
    const windowRange = {
      start: Math.max(window.start, lowerBound),
      end: Math.min(window.end, upperBound),
    };
    if (windowRange.start >= windowRange.end) continue;

    for (const free of subtractIntervals(windowRange, occupied)) {
      const starts = new Set<number>();
      const firstAligned = alignAtOrAfter(free.start, anchor, grid);
      for (
        let start = firstAligned;
        start + task.minBlock <= free.end;
        start += grid
      ) {
        starts.add(start);
      }
      for (const existing of availableExisting) {
        if (
          existing.start >= free.start &&
          existing.start + task.minBlock <= free.end
        ) {
          starts.add(existing.start);
        }
      }

      for (const start of [...starts].sort((left, right) => left - right)) {
        const capacity = free.end - start;
        const length = candidateLength(
          remaining,
          capacity,
          task.minBlock,
          task.maxBlock,
          task.source.splittable,
          requireComplete,
        );
        if (length === null) continue;
        const interval = { start, end: start + length };
        const leftover = remaining - length;
        if (
          requireComplete &&
          leftover > 0 &&
          !hasSufficientRemainingCapacity(
            task,
            leftover,
            [...occupied, interval],
            workingWindows,
            input,
          )
        ) {
          continue;
        }
        const scored = scoreCandidate(
          task,
          interval,
          window,
          Math.min(remaining, task.maxBlock),
          availableExisting,
          input,
          preferred,
          completionRates,
          recoveryPenalties,
        );
        candidates.push({
          ...interval,
          windowId: window.source.id,
          matchedExisting: scored.matchedExisting,
          score: scored.components,
        });
      }
    }
  }
  return candidates.sort(candidateSort);
}

function changeReason(
  existing: NumericExistingBlock | null,
  start: number,
  end: number,
): ProposedBlockChangeReason {
  if (existing === null) return 'new_allocation';
  const sameStart = existing.start === start;
  const sameDuration = existing.end - existing.start === end - start;
  if (sameStart && sameDuration) return 'preserved_existing';
  if (!sameStart && sameDuration) return 'moved_existing';
  if (sameStart) return 'resized_existing';
  return 'moved_and_resized_existing';
}

function allocateTask(
  task: NumericTask,
  requiredMilliseconds: number,
  baseOccupied: readonly NumericInterval[],
  workingWindows: readonly NumericWorkingWindow[],
  existingBlocks: readonly NumericExistingBlock[],
  requireComplete: boolean,
  input: ScheduleInput,
  preferred: readonly NumericScoredWindow[],
  completionRates: readonly NumericScoredWindow[],
  recoveryPenalties: readonly NumericScoredWindow[],
): Allocation {
  const generated: ProposedTimeBlock[] = [];
  const explanations: ScheduleExplanation[] = [];
  const localOccupied: NumericInterval[] = [];
  const usedExistingIds = new Set<string>();
  let remaining = requiredMilliseconds;

  while (remaining > 0) {
    const availableExisting = existingBlocks.filter(
      (block) => !usedExistingIds.has(block.source.id),
    );
    const candidates = enumerateCandidates(
      task,
      remaining,
      [...baseOccupied, ...localOccupied],
      workingWindows,
      availableExisting,
      requireComplete,
      input,
      preferred,
      completionRates,
      recoveryPenalties,
    );
    const selected = candidates[0];
    if (selected === undefined) break;

    const existing = selected.matchedExisting;
    if (existing !== null) usedExistingIds.add(existing.source.id);
    const reason = changeReason(existing, selected.start, selected.end);
    const stableKey =
      existing === null
        ? stableGeneratedKey(task.source.id, selected.start, selected.end)
        : stableExistingKey(existing.source.id);
    generated.push({
      stableKey,
      existingBlockId: existing?.source.id ?? null,
      taskId: task.source.id,
      type: 'task',
      start: formatInstant(selected.start),
      end: formatInstant(selected.end),
      status: 'planned',
      locked: false,
      changeReason: reason,
    });
    explanations.push({
      entityType: 'block',
      entityId: stableKey,
      code: 'block_scheduled',
      message:
        'The block satisfied all hard constraints and was selected by the supplied scoring policy.',
      metadata: {
        taskId: task.source.id,
        start: formatInstant(selected.start),
        end: formatInstant(selected.end),
        priorityRank: task.priorityRank,
        schedulingPolicy: task.source.schedulingPolicy,
        changeReason: reason,
        score: selected.score.total,
        stabilityScore: selected.score.planStability,
        fragmentationScore: selected.score.fragmentation,
        preferredHoursScore: selected.score.preferredHours,
        completionRateScore: selected.score.completionRate,
        energyMatchScore: selected.score.energyMatch,
        recoveryPenaltyScore: selected.score.recoveryPenalty,
      },
    });
    const interval = { start: selected.start, end: selected.end };
    localOccupied.push(interval);
    remaining -= selected.end - selected.start;

    if (!task.source.splittable) break;
  }

  return {
    blocks: generated,
    explanations,
    allocatedMilliseconds: requiredMilliseconds - remaining,
    complete: remaining === 0,
  };
}

function protectedCommitmentMilliseconds(
  taskId: string,
  blocks: readonly NumericExistingBlock[],
  now: number,
): number {
  let total = 0;
  for (const block of blocks) {
    if (
      block.source.taskId !== taskId ||
      (block.source.status !== 'planned' && block.source.status !== 'started')
    ) {
      continue;
    }
    const futureStart = Math.max(now, block.start);
    if (futureStart < block.end) total += block.end - futureStart;
  }
  return total;
}

function taskSort(left: NumericTask, right: NumericTask): number {
  const leftDeadline = left.deadline ?? Number.POSITIVE_INFINITY;
  const rightDeadline = right.deadline ?? Number.POSITIVE_INFINITY;
  return (
    leftDeadline - rightDeadline ||
    right.priorityRank - left.priorityRank ||
    compareStrings(left.source.id, right.source.id)
  );
}

function unscheduledMessage(
  reason: UnscheduledReasonCode,
  partial: boolean,
): string {
  switch (reason) {
    case 'missing_duration':
      return 'The task needs an estimated or explicit remaining duration before it can be scheduled.';
    case 'remaining_estimate_required':
      return 'Recorded effort exhausted the previous estimate, but the unfinished task needs a new remaining estimate.';
    case 'unsupported_dependency':
      return 'The task has dependencies that this scheduler version does not support.';
    case 'deadline_infeasible':
      return partial
        ? 'Only part of the remaining effort fits before the deadline.'
        : 'The remaining effort cannot be placed before the deadline.';
    case 'insufficient_time':
      return partial
        ? 'Only part of the remaining effort fits in the supplied horizon and working windows.'
        : 'The remaining effort does not fit in the supplied horizon and working windows.';
  }
}

function taskUnscheduledExplanation(
  taskId: string,
  unscheduled: UnscheduledTask,
): ScheduleExplanation {
  return {
    entityType: 'task',
    entityId: taskId,
    code: 'task_unscheduled',
    message: unscheduled.message,
    metadata: {
      reasonCode: unscheduled.reasonCode,
      remainingMinutes: unscheduled.remainingMinutes ?? null,
    },
  };
}

const protectedConflictCodes = new Set<ScheduleWarning['code']>([
  'protected_busy_conflict',
  'protected_block_conflict',
  'protected_outside_working_window',
  'protected_task_constraint_conflict',
]);

function tasksWithProtectedConflicts(
  protectedBlocks: readonly NumericExistingBlock[],
  warnings: readonly ScheduleWarning[],
): ReadonlySet<string> {
  const taskByBlockId = new Map(
    protectedBlocks
      .filter((block) => block.source.taskId !== null)
      .map((block) => [block.source.id, block.source.taskId as string]),
  );
  const result = new Set<string>();
  for (const warning of warnings) {
    if (
      warning.entityType !== 'block' ||
      warning.entityId === null ||
      !protectedConflictCodes.has(warning.code)
    ) {
      continue;
    }
    const taskId = taskByBlockId.get(warning.entityId);
    if (taskId !== undefined) result.add(taskId);
  }
  return result;
}

function calculate(rawInput: unknown): ScheduleResult {
  const input = validateScheduleInput(rawInput);
  const now = timestamp(input.now);
  const horizon = numericInterval(input.horizon.start, input.horizon.end);
  const tasks = input.tasks
    .map<NumericTask>((source) => ({
      source,
      earliestStart:
        source.earliestStart === null ? null : timestamp(source.earliestStart),
      deadline: source.deadline === null ? null : timestamp(source.deadline),
      minBlock: minutesToMilliseconds(
        source.minBlockMinutes ?? input.policy.defaultMinBlockMinutes,
      ),
      maxBlock: minutesToMilliseconds(
        source.maxBlockMinutes ?? input.policy.defaultMaxBlockMinutes,
      ),
      priorityRank: input.policy.priorityRanks[source.priority] as number,
    }))
    .sort(taskSort);
  const tasksById = new Map(tasks.map((task) => [task.source.id, task]));
  const sourceTasksById = new Map(
    tasks.map((task) => [task.source.id, task.source]),
  );
  const workingWindows = input.preferences.workingWindows
    .map<NumericWorkingWindow>((source) => ({
      source,
      start: timestamp(source.start),
      end: timestamp(source.end),
    }))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        compareStrings(left.source.id, right.source.id),
    );
  const allExisting = input.existingBlocks
    .map<NumericExistingBlock>((source) => ({
      source,
      start: timestamp(source.start),
      end: timestamp(source.end),
    }))
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        compareStrings(left.source.id, right.source.id),
    );
  const protectedBlocks = allExisting.filter((block) =>
    isProtectedBlock(block.source, sourceTasksById),
  );
  const movableByTask = new Map<string, NumericExistingBlock[]>();
  for (const block of allExisting) {
    if (
      block.source.status !== 'planned' ||
      isProtectedBlock(block.source, sourceTasksById) ||
      block.source.taskId === null
    ) {
      continue;
    }
    const list = movableByTask.get(block.source.taskId) ?? [];
    list.push(block);
    movableByTask.set(block.source.taskId, list);
  }

  const busy = mergeIntervals(
    input.busyEvents.map((event) => numericInterval(event.start, event.end)),
  );
  const warnings: ScheduleWarning[] = [];
  diagnoseProtectedBlocks(
    protectedBlocks,
    busy,
    workingWindows,
    tasksById,
    warnings,
  );
  const conflictedTaskIds = tasksWithProtectedConflicts(
    protectedBlocks,
    warnings,
  );

  const preservedBlocks = protectedBlocks.map((block) =>
    proposedFromProtected(block.source),
  );
  const explanations: ScheduleExplanation[] = protectedBlocks.map((block) => ({
    entityType: 'block',
    entityId: block.source.id,
    code: 'protected_block_preserved',
    message:
      'The existing protected block was retained without changing its time or state.',
    metadata: {
      status: block.source.status,
      locked: block.source.locked,
      start: block.source.start,
      end: block.source.end,
    },
  }));

  const occupied: NumericInterval[] = [
    ...busy,
    ...protectedBlocks
      .filter((block) => isActiveStatus(block.source.status))
      .map((block) => ({ start: block.start, end: block.end })),
  ];
  const generated: ProposedTimeBlock[] = [];
  const unscheduled: UnscheduledTask[] = [];
  const preferred = numericScoredWindows(input.preferences.preferredWindows);
  const completionRates = numericScoredWindows(
    input.userModel.completionRateWindows,
  );
  const recoveryPenalties = numericScoredWindows(
    input.userModel.recoveryPenaltyWindows,
  );
  let fullyScheduledTaskCount = 0;
  let partiallyScheduledTaskCount = 0;
  let protectedCommittedMilliseconds = 0;

  for (const task of tasks) {
    const source = task.source;
    const commitment = protectedCommitmentMilliseconds(
      source.id,
      protectedBlocks,
      now,
    );
    protectedCommittedMilliseconds += commitment;

    if (source.dependencyState === 'unsupported') {
      const record: UnscheduledTask = {
        taskId: source.id,
        ...(source.duration.state === 'known'
          ? {
              remainingMinutes: millisecondsToMinutes(
                Math.max(
                  0,
                  minutesToMilliseconds(source.duration.remainingMinutes) -
                    commitment,
                ),
              ),
            }
          : {}),
        reasonCode: 'unsupported_dependency',
        message: unscheduledMessage('unsupported_dependency', false),
      };
      unscheduled.push(record);
      explanations.push(taskUnscheduledExplanation(source.id, record));
      continue;
    }
    if (source.duration.state === 'missing') {
      const record: UnscheduledTask = {
        taskId: source.id,
        reasonCode: 'missing_duration',
        message: unscheduledMessage('missing_duration', false),
      };
      unscheduled.push(record);
      explanations.push(taskUnscheduledExplanation(source.id, record));
      continue;
    }
    if (source.duration.state === 'exhausted') {
      const record: UnscheduledTask = {
        taskId: source.id,
        reasonCode: 'remaining_estimate_required',
        message: unscheduledMessage('remaining_estimate_required', false),
      };
      unscheduled.push(record);
      explanations.push(taskUnscheduledExplanation(source.id, record));
      continue;
    }

    const statedRemaining = minutesToMilliseconds(
      source.duration.remainingMinutes,
    );
    if (commitment > statedRemaining) {
      addWarning(warnings, {
        entityType: 'task',
        entityId: source.id,
        code: 'protected_commitment_exceeds_remaining',
        severity: 'warning',
        message:
          'Protected future blocks exceed the task remaining estimate and were not rewritten.',
      });
    }
    const required = Math.max(0, statedRemaining - commitment);
    if (required === 0) {
      const hasProtectedConflict = conflictedTaskIds.has(source.id);
      if (!hasProtectedConflict) fullyScheduledTaskCount += 1;
      explanations.push({
        entityType: 'task',
        entityId: source.id,
        code: hasProtectedConflict
          ? 'task_effort_covered_with_conflicts'
          : 'remaining_covered_by_protected_blocks',
        message: hasProtectedConflict
          ? 'Protected future blocks cover the known effort, but their reported conflicts remain unresolved.'
          : 'Protected future blocks already cover the known remaining effort.',
        metadata: {
          remainingMinutes: source.duration.remainingMinutes,
          protectedCommittedMinutes: millisecondsToMinutes(commitment),
          protectedConflicts: hasProtectedConflict,
        },
      });
      continue;
    }

    let allocation = allocateTask(
      task,
      required,
      occupied,
      workingWindows,
      movableByTask.get(source.id) ?? [],
      true,
      input,
      preferred,
      completionRates,
      recoveryPenalties,
    );
    if (!allocation.complete && source.splittable) {
      allocation = allocateTask(
        task,
        required,
        occupied,
        workingWindows,
        movableByTask.get(source.id) ?? [],
        false,
        input,
        preferred,
        completionRates,
        recoveryPenalties,
      );
    }

    generated.push(...allocation.blocks);
    explanations.push(...allocation.explanations);
    for (const block of allocation.blocks) {
      occupied.push(numericInterval(block.start, block.end));
    }

    const remaining = required - allocation.allocatedMilliseconds;
    if (remaining === 0) {
      const hasProtectedConflict = conflictedTaskIds.has(source.id);
      if (!hasProtectedConflict) fullyScheduledTaskCount += 1;
      explanations.push({
        entityType: 'task',
        entityId: source.id,
        code: hasProtectedConflict
          ? 'task_effort_covered_with_conflicts'
          : 'task_fully_scheduled',
        message: hasProtectedConflict
          ? 'All known effort is covered, but protected-block conflicts remain unresolved.'
          : 'All known remaining effort is covered by protected and proposed blocks.',
        metadata: {
          generatedMinutes: millisecondsToMinutes(
            allocation.allocatedMilliseconds,
          ),
          protectedCommittedMinutes: millisecondsToMinutes(commitment),
          protectedConflicts: hasProtectedConflict,
        },
      });
      continue;
    }

    const partial = allocation.allocatedMilliseconds > 0 || commitment > 0;
    if (partial) {
      partiallyScheduledTaskCount += 1;
      addWarning(warnings, {
        entityType: 'task',
        entityId: source.id,
        code: 'partial_schedule',
        severity: 'warning',
        message: 'Only part of the known remaining effort could be placed.',
      });
    }
    const deadlineInHorizon =
      task.deadline !== null && task.deadline <= horizon.end;
    const reason: UnscheduledReasonCode = deadlineInHorizon
      ? 'deadline_infeasible'
      : 'insufficient_time';
    if (reason === 'deadline_infeasible') {
      addWarning(warnings, {
        entityType: 'task',
        entityId: source.id,
        code: 'deadline_risk',
        severity: 'error',
        message:
          'Known remaining effort cannot be fully placed before the deadline.',
      });
    }
    const record: UnscheduledTask = {
      taskId: source.id,
      remainingMinutes: millisecondsToMinutes(remaining),
      reasonCode: reason,
      message: unscheduledMessage(reason, partial),
    };
    unscheduled.push(record);
    explanations.push(taskUnscheduledExplanation(source.id, record));
    if (partial) {
      explanations.push({
        entityType: 'task',
        entityId: source.id,
        code: 'task_partially_scheduled',
        message:
          'The feasible portion was placed without violating hard constraints.',
        metadata: {
          generatedMinutes: millisecondsToMinutes(
            allocation.allocatedMilliseconds,
          ),
          protectedCommittedMinutes: millisecondsToMinutes(commitment),
          remainingMinutes: millisecondsToMinutes(remaining),
        },
      });
    }
  }

  const selectedExistingIds = new Set(
    generated
      .map((block) => block.existingBlockId)
      .filter((id): id is string => id !== null),
  );
  for (const existing of [...movableByTask.values()].flat()) {
    if (selectedExistingIds.has(existing.source.id)) continue;
    addWarning(warnings, {
      entityType: 'block',
      entityId: existing.source.id,
      code: 'existing_block_omitted',
      severity: 'info',
      message:
        'An unlocked planned block is not part of this candidate plan; a commit diff may cancel it.',
    });
    explanations.push({
      entityType: 'block',
      entityId: existing.source.id,
      code: 'existing_block_not_proposed',
      message:
        'The prior unlocked block was not retained because the task could not use it in this candidate plan.',
      metadata: {
        taskId: existing.source.taskId,
        start: existing.source.start,
        end: existing.source.end,
      },
    });
  }

  const sortedWarnings = [...warnings].sort(warningSort);
  const generatedMinutes = generated.reduce(
    (total, block) =>
      total +
      millisecondsToMinutes(timestamp(block.end) - timestamp(block.start)),
    0,
  );
  const knownUnscheduledMinutes = unscheduled.reduce(
    (total, task) => total + (task.remainingMinutes ?? 0),
    0,
  );
  return {
    schedulerVersion: SCHEDULER_VERSION,
    blocks: [...preservedBlocks, ...generated].sort(blockSort),
    unscheduled,
    warnings: sortedWarnings,
    metrics: {
      taskCount: tasks.length,
      fullyScheduledTaskCount,
      partiallyScheduledTaskCount,
      generatedBlockCount: generated.length,
      preservedBlockCount: preservedBlocks.length,
      generatedMinutes,
      protectedCommittedMinutes: millisecondsToMinutes(
        protectedCommittedMilliseconds,
      ),
      knownUnscheduledMinutes,
      unknownUnscheduledTaskCount: unscheduled.filter(
        (task) => task.remainingMinutes === undefined,
      ).length,
      conflictedTaskCount: conflictedTaskIds.size,
      warningCount: sortedWarnings.length,
    },
    explanations: [...explanations].sort(explanationSort),
  };
}

/** Computes a deterministic candidate plan. It never persists or commits it. */
export function previewSchedule(input: ScheduleInput): ScheduleResult;
export function previewSchedule(input: unknown): ScheduleResult {
  return calculate(input);
}

/** Replanning has the same pure contract; protection is expressed in the input. */
export function replanSchedule(input: ScheduleInput): ScheduleResult;
export function replanSchedule(input: unknown): ScheduleResult {
  return calculate(input);
}

export { validateScheduleInput };
