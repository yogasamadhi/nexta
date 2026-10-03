import { describe, expect, it } from 'vitest';

import {
  previewSchedule,
  type ProposedTimeBlock,
  type ScheduleInput,
} from '@workspace/scheduler-core';

import { basePolicy, scheduleInput, task } from './fixtures';

function generatedFor(
  result: ReturnType<typeof previewSchedule>,
  taskId: string,
): readonly ProposedTimeBlock[] {
  return result.blocks.filter(
    (block) =>
      block.taskId === taskId && block.changeReason !== 'protected_existing',
  );
}

describe('CASE-SCHED-01 hard constraints and explainable partial plans', () => {
  it('respects busy time, deadline, splitting limits, and reports every unscheduled state', () => {
    const input = scheduleInput({
      horizon: {
        start: '2026-04-06T09:00:00.000Z',
        end: '2026-04-06T15:00:00.000Z',
      },
      tasks: [
        task('deadline-task', {
          priority: 'high',
          duration: { state: 'known', remainingMinutes: 120 },
          deadline: '2026-04-06T13:00:00.000Z',
          minBlockMinutes: 30,
          maxBlockMinutes: 60,
        }),
        task('large-task', {
          duration: { state: 'known', remainingMinutes: 240 },
        }),
        task('missing-task', { duration: { state: 'missing' } }),
        task('exhausted-task', { duration: { state: 'exhausted' } }),
        task('dependency-task', {
          duration: { state: 'known', remainingMinutes: 30 },
          dependencyState: 'unsupported',
        }),
      ],
      busyEvents: [
        {
          id: 'meeting',
          start: '2026-04-06T10:00:00.000Z',
          end: '2026-04-06T11:00:00.000Z',
        },
      ],
      preferences: {
        workingWindows: [
          {
            id: 'short-workday',
            start: '2026-04-06T09:00:00.000Z',
            end: '2026-04-06T15:00:00.000Z',
            energyLevel: 'high',
          },
        ],
        preferredWindows: [],
      },
    });

    const result = previewSchedule(input);
    expect(
      generatedFor(result, 'deadline-task').map((block) => [
        block.start,
        block.end,
      ]),
    ).toEqual([
      ['2026-04-06T09:00:00.000Z', '2026-04-06T10:00:00.000Z'],
      ['2026-04-06T11:00:00.000Z', '2026-04-06T12:00:00.000Z'],
    ]);

    const largeBlocks = generatedFor(result, 'large-task');
    expect(largeBlocks).toHaveLength(3);
    expect(
      largeBlocks.reduce(
        (minutes, block) =>
          minutes + (Date.parse(block.end) - Date.parse(block.start)) / 60_000,
        0,
      ),
    ).toBe(180);

    expect(result.unscheduled).toEqual([
      expect.objectContaining({
        taskId: 'dependency-task',
        remainingMinutes: 30,
        reasonCode: 'unsupported_dependency',
      }),
      expect.objectContaining({
        taskId: 'exhausted-task',
        reasonCode: 'remaining_estimate_required',
      }),
      expect.objectContaining({
        taskId: 'large-task',
        remainingMinutes: 60,
        reasonCode: 'insufficient_time',
      }),
      expect.objectContaining({
        taskId: 'missing-task',
        reasonCode: 'missing_duration',
      }),
    ]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        entityId: 'large-task',
        code: 'partial_schedule',
      }),
    );
    expect(result.metrics).toMatchObject({
      taskCount: 5,
      fullyScheduledTaskCount: 1,
      partiallyScheduledTaskCount: 1,
      generatedBlockCount: 5,
      generatedMinutes: 300,
      knownUnscheduledMinutes: 90,
      unknownUnscheduledTaskCount: 2,
    });
    expect(
      result.blocks.some((block) => block.taskId === 'dependency-task'),
    ).toBe(false);
  });

  it('uses explicit soft-score inputs while preserving hard time boundaries', () => {
    const input = scheduleInput({
      tasks: [
        task('energy-task', {
          energyDemand: 'high',
          duration: { state: 'known', remainingMinutes: 60 },
        }),
      ],
      preferences: {
        workingWindows: [
          {
            id: 'low-energy',
            start: '2026-04-06T09:00:00.000Z',
            end: '2026-04-06T10:00:00.000Z',
            energyLevel: 'low',
          },
          {
            id: 'high-energy',
            start: '2026-04-06T10:00:00.000Z',
            end: '2026-04-06T12:00:00.000Z',
            energyLevel: 'high',
          },
        ],
        preferredWindows: [
          {
            id: 'preferred',
            start: '2026-04-06T10:00:00.000Z',
            end: '2026-04-06T11:00:00.000Z',
            score: 3,
          },
        ],
      },
    });

    const result = previewSchedule(input);
    expect(generatedFor(result, 'energy-task')).toEqual([
      expect.objectContaining({
        start: '2026-04-06T10:00:00.000Z',
        end: '2026-04-06T11:00:00.000Z',
      }),
    ]);
    expect(result.explanations).toContainEqual(
      expect.objectContaining({
        code: 'block_scheduled',
        metadata: expect.objectContaining({
          energyMatchScore: 2,
          preferredHoursScore: 3,
        }),
      }),
    );
  });

  it('is stable when semantically unordered input collections are reordered', () => {
    const input = scheduleInput({
      tasks: [task('b', { priority: 'low' }), task('a', { priority: 'high' })],
      busyEvents: [
        {
          id: 'later',
          start: '2026-04-06T13:00:00.000Z',
          end: '2026-04-06T13:30:00.000Z',
        },
        {
          id: 'earlier',
          start: '2026-04-06T11:00:00.000Z',
          end: '2026-04-06T11:30:00.000Z',
        },
      ],
      preferences: {
        workingWindows: [
          {
            id: 'afternoon',
            start: '2026-04-06T12:00:00.000Z',
            end: '2026-04-06T17:00:00.000Z',
            energyLevel: 'high',
          },
          {
            id: 'morning',
            start: '2026-04-06T09:00:00.000Z',
            end: '2026-04-06T12:00:00.000Z',
            energyLevel: 'low',
          },
        ],
        preferredWindows: [
          {
            id: 'p2',
            start: '2026-04-06T14:00:00.000Z',
            end: '2026-04-06T15:00:00.000Z',
            score: 1,
          },
          {
            id: 'p1',
            start: '2026-04-06T09:00:00.000Z',
            end: '2026-04-06T10:00:00.000Z',
            score: 1,
          },
        ],
      },
    });
    const reordered: ScheduleInput = {
      ...input,
      tasks: [...input.tasks].reverse(),
      busyEvents: [...input.busyEvents].reverse(),
      preferences: {
        workingWindows: [...input.preferences.workingWindows].reverse(),
        preferredWindows: [...input.preferences.preferredWindows].reverse(),
      },
      policy: {
        ...input.policy,
        energyMatchScores: [...input.policy.energyMatchScores].reverse(),
        priorityRanks: { high: 3, normal: 2, low: 1 },
      },
    };

    expect(previewSchedule(reordered)).toEqual(previewSchedule(input));
  });

  it('uses explicit UTC windows correctly across a DST transition', () => {
    const input = scheduleInput({
      now: '2026-03-08T06:00:00.000Z',
      horizon: {
        start: '2026-03-08T06:00:00.000Z',
        end: '2026-03-08T09:00:00.000Z',
      },
      timeZone: 'America/New_York',
      tasks: [
        task('dst-task', {
          duration: { state: 'known', remainingMinutes: 120 },
          minBlockMinutes: 60,
          maxBlockMinutes: 120,
        }),
      ],
      preferences: {
        workingWindows: [
          {
            id: 'expanded-by-boundary',
            start: '2026-03-08T06:00:00.000Z',
            end: '2026-03-08T08:00:00.000Z',
            energyLevel: null,
          },
        ],
        preferredWindows: [],
      },
      policy: {
        ...basePolicy,
        gridAnchor: '2026-03-08T06:00:00.000Z',
      },
    });

    const result = previewSchedule(input);
    expect(generatedFor(result, 'dst-task')).toEqual([
      expect.objectContaining({
        start: '2026-03-08T06:00:00.000Z',
        end: '2026-03-08T08:00:00.000Z',
      }),
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('does not split an unsplittable task around busy time after earliestStart', () => {
    const input = scheduleInput({
      horizon: {
        start: '2026-04-06T09:00:00.000Z',
        end: '2026-04-06T12:00:00.000Z',
      },
      tasks: [
        task('one-contiguous-block', {
          duration: { state: 'known', remainingMinutes: 90 },
          earliestStart: '2026-04-06T10:00:00.000Z',
          deadline: '2026-04-06T12:00:00.000Z',
          splittable: false,
          minBlockMinutes: 30,
          maxBlockMinutes: 120,
        }),
      ],
      busyEvents: [
        {
          id: 'interrupting-busy-time',
          start: '2026-04-06T10:30:00.000Z',
          end: '2026-04-06T11:30:00.000Z',
        },
      ],
      preferences: {
        workingWindows: [
          {
            id: 'short-window',
            start: '2026-04-06T09:00:00.000Z',
            end: '2026-04-06T12:00:00.000Z',
            energyLevel: null,
          },
        ],
        preferredWindows: [],
      },
    });

    const result = previewSchedule(input);
    expect(generatedFor(result, 'one-contiguous-block')).toEqual([]);
    expect(result.unscheduled).toContainEqual(
      expect.objectContaining({
        taskId: 'one-contiguous-block',
        remainingMinutes: 90,
        reasonCode: 'deadline_infeasible',
      }),
    );
  });

  it('never emits a split tail shorter than minBlock', () => {
    const input = scheduleInput({
      horizon: {
        start: '2026-04-06T09:00:00.000Z',
        end: '2026-04-06T10:00:00.000Z',
      },
      tasks: [
        task('minimum-tail', {
          duration: { state: 'known', remainingMinutes: 70 },
          minBlockMinutes: 30,
          maxBlockMinutes: 60,
        }),
      ],
      preferences: {
        workingWindows: [
          {
            id: 'only-sixty-minutes',
            start: '2026-04-06T09:00:00.000Z',
            end: '2026-04-06T10:00:00.000Z',
            energyLevel: null,
          },
        ],
        preferredWindows: [],
      },
    });

    const result = previewSchedule(input);
    const blocks = generatedFor(result, 'minimum-tail');
    expect(blocks).toHaveLength(1);
    expect(
      blocks.every(
        (block) =>
          (Date.parse(block.end) - Date.parse(block.start)) / 60_000 >= 30,
      ),
    ).toBe(true);
    expect(result.unscheduled).toContainEqual(
      expect.objectContaining({
        taskId: 'minimum-tail',
        remainingMinutes: 10,
      }),
    );
  });

  it('does not let a high-scoring middle slot destroy an otherwise feasible plan', () => {
    const input = scheduleInput({
      horizon: {
        start: '2026-04-06T09:00:00.000Z',
        end: '2026-04-06T11:00:00.000Z',
      },
      tasks: [
        task('avoid-fragmenting-gap', {
          duration: { state: 'known', remainingMinutes: 120 },
          minBlockMinutes: 60,
          maxBlockMinutes: 60,
        }),
      ],
      preferences: {
        workingWindows: [
          {
            id: 'exact-capacity',
            start: '2026-04-06T09:00:00.000Z',
            end: '2026-04-06T11:00:00.000Z',
            energyLevel: null,
          },
        ],
        preferredWindows: [
          {
            id: 'tempting-middle',
            start: '2026-04-06T09:30:00.000Z',
            end: '2026-04-06T10:30:00.000Z',
            score: 100,
          },
        ],
      },
    });

    const result = previewSchedule(input);
    expect(generatedFor(result, 'avoid-fragmenting-gap')).toEqual([
      expect.objectContaining({
        start: '2026-04-06T09:00:00.000Z',
        end: '2026-04-06T10:00:00.000Z',
      }),
      expect.objectContaining({
        start: '2026-04-06T10:00:00.000Z',
        end: '2026-04-06T11:00:00.000Z',
      }),
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('uses the policy grid instead of an implicit calendar-event boundary', () => {
    const input = scheduleInput({
      horizon: {
        start: '2026-04-06T09:00:00.000Z',
        end: '2026-04-06T10:00:00.000Z',
      },
      tasks: [
        task('grid-task', {
          duration: { state: 'known', remainingMinutes: 30 },
          minBlockMinutes: 30,
          maxBlockMinutes: 30,
        }),
      ],
      busyEvents: [
        {
          id: 'off-grid-event',
          start: '2026-04-06T09:00:00.000Z',
          end: '2026-04-06T09:07:00.000Z',
        },
      ],
      preferences: {
        workingWindows: [
          {
            id: 'one-hour-window',
            start: '2026-04-06T09:00:00.000Z',
            end: '2026-04-06T10:00:00.000Z',
            energyLevel: null,
          },
        ],
        preferredWindows: [],
      },
    });

    expect(generatedFor(previewSchedule(input), 'grid-task')).toEqual([
      expect.objectContaining({
        start: '2026-04-06T09:15:00.000Z',
        end: '2026-04-06T09:45:00.000Z',
      }),
    ]);
  });
});
