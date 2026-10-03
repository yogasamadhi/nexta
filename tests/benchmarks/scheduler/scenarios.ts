import { SCHEDULER_VERSION } from '@workspace/scheduler-core';
import type {
  ScheduleInput,
  ScheduleResult,
  SchedulableTask,
  SchedulingPolicy,
} from '@workspace/scheduler-core';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.parse('2026-10-05T01:00:00.000Z');

export type BenchmarkScenario = Readonly<{
  id: string;
  seed: number;
  taskCount: number;
  horizonDays: number;
  busyDensity: 'sparse' | 'dense';
  policyKind: 'neutral' | 'stability-example';
  input: ScheduleInput;
}>;

/** Synthetic policies are measurements, never production recommendations. */
function policy(stability: boolean): SchedulingPolicy {
  return {
    policyVersion: stability
      ? 'benchmark-stability-example/1'
      : 'benchmark-neutral/1',
    schedulerVersion: SCHEDULER_VERSION,
    gridAnchor: '2026-01-01T00:00:00.000Z',
    granularityMinutes: 15,
    defaultMinBlockMinutes: 30,
    defaultMaxBlockMinutes: 120,
    priorityRanks: { normal: 1 },
    energyMatchScores: [],
    defaultEnergyMatchScore: 0,
    scoreWeights: {
      planStability: stability ? 8 : 0,
      fragmentation: 0,
      preferredHours: 0,
      completionRate: 0,
      energyMatch: 0,
      recoveryPenalty: 0,
    },
  };
}

export function createScenario(
  taskCount: number,
  horizonDays: number,
  busyDensity: 'sparse' | 'dense',
  seed = 20261003,
  stability = false,
): BenchmarkScenario {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const instant = (value: number) => new Date(value).toISOString();
  const tasks: SchedulableTask[] = Array.from(
    { length: taskCount },
    (_, index) => {
      const earliestDay = index < 3 ? 0 : next() % horizonDays;
      const splittable = index % 3 !== 0;
      return {
        id: 'task-' + String(index).padStart(4, '0'),
        priority: 'normal',
        duration: {
          state: 'known',
          remainingMinutes:
            index < 3 ? 90 : (2 + (next() % (splittable ? 11 : 5))) * 15,
        },
        earliestStart: instant(NOW + earliestDay * DAY),
        deadline:
          index % 5 === 0
            ? instant(NOW + Math.min(horizonDays, earliestDay + 1) * DAY)
            : null,
        splittable,
        minBlockMinutes: 30,
        maxBlockMinutes: 120,
        energyDemand: null,
        schedulingPolicy: 'benchmark-only',
        dependencyState: 'none',
      };
    },
  );
  const workingWindows = Array.from({ length: horizonDays }, (_, day) => ({
    id: 'work-' + day,
    start: instant(NOW + day * DAY),
    end: instant(NOW + day * DAY + 8 * 60 * MINUTE),
    energyLevel: null,
  }));
  const busyEvents = workingWindows.flatMap((_, day) =>
    (busyDensity === 'dense' ? [150, 240, 330, 420] : [240]).map(
      (offset, index) => ({
        id: 'busy-' + day + '-' + index,
        start: instant(NOW + day * DAY + offset * MINUTE),
        end: instant(NOW + day * DAY + (offset + 45) * MINUTE),
      }),
    ),
  );
  const input: ScheduleInput = {
    now: instant(NOW),
    horizon: { start: instant(NOW), end: instant(NOW + horizonDays * DAY) },
    timeZone: 'Asia/Shanghai',
    tasks,
    busyEvents,
    existingBlocks: [
      {
        id: 'locked-block',
        taskId: 'task-0000',
        type: 'task',
        start: instant(NOW + 60 * MINUTE),
        end: instant(NOW + 120 * MINUTE),
        status: 'planned',
        locked: true,
      },
      {
        id: 'started-block',
        taskId: 'task-0001',
        type: 'task',
        start: instant(NOW - 15 * MINUTE),
        end: instant(NOW + 15 * MINUTE),
        status: 'started',
        locked: false,
      },
      {
        id: 'completed-block',
        taskId: 'task-0002',
        type: 'task',
        start: instant(NOW - 60 * MINUTE),
        end: instant(NOW - 30 * MINUTE),
        status: 'completed',
        locked: false,
      },
    ],
    preferences: { workingWindows, preferredWindows: [] },
    userModel: { completionRateWindows: [], recoveryPenaltyWindows: [] },
    policy: policy(stability),
    reason: 'benchmark-preview',
  };
  return {
    id:
      taskCount +
      '-' +
      horizonDays +
      '-' +
      busyDensity +
      '-' +
      (stability ? 'stability-example' : 'neutral'),
    seed,
    taskCount,
    horizonDays,
    busyDensity,
    policyKind: stability ? 'stability-example' : 'neutral',
    input,
  };
}

export function benchmarkScenarios(): BenchmarkScenario[] {
  const result = [50, 200, 500].flatMap((count) =>
    [7, 30].flatMap((days) =>
      (['sparse', 'dense'] as const).map((density) =>
        createScenario(count, days, density),
      ),
    ),
  );
  result.push(createScenario(50, 7, 'sparse', 20261003, true));
  return result;
}

/** Replan the first candidate after a new observed Busy interval. */
export function replanInput(
  input: ScheduleInput,
  first: ScheduleResult,
): ScheduleInput {
  return {
    ...input,
    reason: 'benchmark-busy-change',
    existingBlocks: first.blocks.map((block) => ({
      id: block.existingBlockId ?? 'candidate-' + block.stableKey,
      taskId: block.taskId,
      type: block.type,
      start: block.start,
      end: block.end,
      status: block.status,
      locked: block.locked,
    })),
    busyEvents: [
      ...input.busyEvents,
      {
        id: 'new-observed-busy',
        start: new Date(NOW + 180 * MINUTE).toISOString(),
        end: new Date(NOW + 225 * MINUTE).toISOString(),
      },
    ],
  };
}
