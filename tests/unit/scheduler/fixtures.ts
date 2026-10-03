import { SCHEDULER_VERSION } from '@workspace/scheduler-core';
import type {
  ScheduleInput,
  SchedulableTask,
  SchedulingPolicy,
} from '@workspace/scheduler-core';

export const basePolicy: SchedulingPolicy = {
  policyVersion: 'policy-test-v1',
  schedulerVersion: SCHEDULER_VERSION,
  gridAnchor: '2026-01-01T00:00:00.000Z',
  granularityMinutes: 15,
  defaultMinBlockMinutes: 30,
  defaultMaxBlockMinutes: 60,
  priorityRanks: { low: 1, normal: 2, high: 3 },
  energyMatchScores: [
    { demand: 'high', supply: 'high', score: 2 },
    { demand: 'high', supply: 'low', score: -2 },
    { demand: 'low', supply: 'high', score: 0 },
    { demand: 'low', supply: 'low', score: 1 },
  ],
  defaultEnergyMatchScore: 0,
  scoreWeights: {
    planStability: 10,
    fragmentation: 1,
    preferredHours: 1,
    completionRate: 1,
    energyMatch: 1,
    recoveryPenalty: 1,
  },
};

export function task(
  id: string,
  overrides: Partial<SchedulableTask> = {},
): SchedulableTask {
  return {
    id,
    priority: 'normal',
    duration: { state: 'known', remainingMinutes: 60 },
    earliestStart: null,
    deadline: null,
    splittable: true,
    minBlockMinutes: null,
    maxBlockMinutes: null,
    energyDemand: null,
    schedulingPolicy: 'default',
    dependencyState: 'none',
    ...overrides,
  };
}

export function scheduleInput(
  overrides: Partial<ScheduleInput> = {},
): ScheduleInput {
  return {
    now: '2026-04-06T09:00:00.000Z',
    horizon: {
      start: '2026-04-06T09:00:00.000Z',
      end: '2026-04-06T17:00:00.000Z',
    },
    timeZone: 'Asia/Shanghai',
    tasks: [],
    busyEvents: [],
    existingBlocks: [],
    preferences: {
      workingWindows: [
        {
          id: 'workday',
          start: '2026-04-06T09:00:00.000Z',
          end: '2026-04-06T17:00:00.000Z',
          energyLevel: 'high',
        },
      ],
      preferredWindows: [],
    },
    userModel: {
      completionRateWindows: [],
      recoveryPenaltyWindows: [],
    },
    policy: basePolicy,
    reason: 'unit_test',
    ...overrides,
  };
}
