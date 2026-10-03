import { describe, expect, it } from 'vitest';

import {
  previewSchedule,
  replanSchedule,
  type ExistingTimeBlock,
  type ScheduleInput,
  type SchedulableTask,
} from '@workspace/scheduler-core';

import { basePolicy, scheduleInput, task } from './fixtures';

const DAY_START = Date.parse('2026-04-06T09:00:00.000Z');
const SLOT_MINUTES = 30;
const SLOT_MILLISECONDS = SLOT_MINUTES * 60_000;
const SLOT_COUNT = 16;

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function rangeForSlot(slot: number): { start: string; end: string } {
  return {
    start: iso(DAY_START + slot * SLOT_MILLISECONDS),
    end: iso(DAY_START + (slot + 1) * SLOT_MILLISECONDS),
  };
}

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state;
  };
}

function randomizedInput(seed: number): ScheduleInput {
  const next = generator(seed);
  const taskCount = 2 + (next() % 4);
  const tasks: SchedulableTask[] = [];
  for (let index = 0; index < taskCount; index += 1) {
    const earliestSlot = next() % 5;
    const hasDeadline = next() % 3 !== 0;
    const deadlineSlot = 7 + (next() % (SLOT_COUNT - 6));
    tasks.push(
      task(`task-${seed}-${index}`, {
        priority: (['low', 'normal', 'high'] as const)[next() % 3],
        duration: {
          state: 'known',
          remainingMinutes: SLOT_MINUTES * (2 + (next() % 5)),
        },
        earliestStart: iso(DAY_START + earliestSlot * SLOT_MILLISECONDS),
        deadline: hasDeadline
          ? iso(DAY_START + deadlineSlot * SLOT_MILLISECONDS)
          : null,
        minBlockMinutes: SLOT_MINUTES,
        maxBlockMinutes: SLOT_MINUTES * 2,
        energyDemand: next() % 2 === 0 ? 'high' : 'low',
      }),
    );
  }

  const occupiedSlots = new Set<number>();
  const busyEvents: ScheduleInput['busyEvents'][number][] = [];
  for (let index = 0; index < 3; index += 1) {
    let slot = next() % SLOT_COUNT;
    while (occupiedSlots.has(slot)) slot = (slot + 1) % SLOT_COUNT;
    occupiedSlots.add(slot);
    busyEvents.push({ id: `busy-${seed}-${index}`, ...rangeForSlot(slot) });
  }

  let protectedSlot = next() % SLOT_COUNT;
  while (occupiedSlots.has(protectedSlot)) {
    protectedSlot = (protectedSlot + 1) % SLOT_COUNT;
  }
  const existingBlocks: ExistingTimeBlock[] = [
    {
      id: `locked-${seed}`,
      taskId: tasks[0]?.id ?? null,
      type: tasks[0] === undefined ? 'buffer' : 'task',
      ...rangeForSlot(protectedSlot),
      status: 'planned',
      locked: true,
    },
  ];

  return scheduleInput({
    tasks,
    busyEvents,
    existingBlocks,
    policy: {
      ...basePolicy,
      granularityMinutes: SLOT_MINUTES,
      defaultMinBlockMinutes: SLOT_MINUTES,
      defaultMaxBlockMinutes: SLOT_MINUTES * 2,
    },
  });
}

function overlap(
  left: { start: string; end: string },
  right: { start: string; end: string },
): boolean {
  return (
    Date.parse(left.start) < Date.parse(right.end) &&
    Date.parse(right.start) < Date.parse(left.end)
  );
}

describe('scheduler randomized invariants', () => {
  it('keeps every generated block feasible and every run deterministic', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const input = randomizedInput(seed);
      const result = previewSchedule(input);
      const generated = result.blocks.filter(
        (block) => block.changeReason !== 'protected_existing',
      );
      const protectedBlocks = result.blocks.filter(
        (block) => block.changeReason === 'protected_existing',
      );

      expect(new Set(result.blocks.map((block) => block.stableKey)).size).toBe(
        result.blocks.length,
      );
      expect(replanSchedule(input)).toEqual(result);
      expect(
        previewSchedule({
          ...input,
          tasks: [...input.tasks].reverse(),
          busyEvents: [...input.busyEvents].reverse(),
          existingBlocks: [...input.existingBlocks].reverse(),
          preferences: {
            workingWindows: [...input.preferences.workingWindows].reverse(),
            preferredWindows: [...input.preferences.preferredWindows].reverse(),
          },
          userModel: {
            completionRateWindows: [
              ...input.userModel.completionRateWindows,
            ].reverse(),
            recoveryPenaltyWindows: [
              ...input.userModel.recoveryPenaltyWindows,
            ].reverse(),
          },
        }),
      ).toEqual(result);

      for (const [index, block] of generated.entries()) {
        const sourceTask = input.tasks.find(
          (candidate) => candidate.id === block.taskId,
        );
        expect(sourceTask).toBeDefined();
        expect(block.status).toBe('planned');
        expect(block.locked).toBe(false);
        expect(Date.parse(block.start)).toBeGreaterThanOrEqual(
          Date.parse(input.now),
        );
        expect(Date.parse(block.start)).toBeGreaterThanOrEqual(
          Date.parse(input.horizon.start),
        );
        expect(Date.parse(block.end)).toBeLessThanOrEqual(
          Date.parse(input.horizon.end),
        );
        if (sourceTask?.earliestStart !== null) {
          expect(Date.parse(block.start)).toBeGreaterThanOrEqual(
            Date.parse(sourceTask?.earliestStart ?? ''),
          );
        }
        if (sourceTask?.deadline !== null) {
          expect(Date.parse(block.end)).toBeLessThanOrEqual(
            Date.parse(sourceTask?.deadline ?? ''),
          );
        }
        const duration =
          (Date.parse(block.end) - Date.parse(block.start)) / 60_000;
        expect(duration).toBeGreaterThanOrEqual(
          sourceTask?.minBlockMinutes ?? input.policy.defaultMinBlockMinutes,
        );
        expect(duration).toBeLessThanOrEqual(
          sourceTask?.maxBlockMinutes ?? input.policy.defaultMaxBlockMinutes,
        );
        expect(input.busyEvents.some((event) => overlap(block, event))).toBe(
          false,
        );
        expect(
          protectedBlocks.some((existing) => overlap(block, existing)),
        ).toBe(false);
        for (
          let otherIndex = index + 1;
          otherIndex < generated.length;
          otherIndex += 1
        ) {
          expect(
            overlap(block, generated[otherIndex] as (typeof generated)[number]),
          ).toBe(false);
        }
      }

      for (const sourceTask of input.tasks) {
        if (sourceTask.duration.state !== 'known') continue;
        const generatedMinutes = generated
          .filter((block) => block.taskId === sourceTask.id)
          .reduce(
            (sum, block) =>
              sum + (Date.parse(block.end) - Date.parse(block.start)) / 60_000,
            0,
          );
        const protectedMinutes = protectedBlocks
          .filter(
            (block) =>
              block.taskId === sourceTask.id &&
              (block.status === 'planned' || block.status === 'started'),
          )
          .reduce(
            (sum, block) =>
              sum +
              Math.max(
                0,
                (Date.parse(block.end) -
                  Math.max(Date.parse(input.now), Date.parse(block.start))) /
                  60_000,
              ),
            0,
          );
        expect(generatedMinutes + protectedMinutes).toBeLessThanOrEqual(
          sourceTask.duration.remainingMinutes,
        );
      }
    }
  });
});
