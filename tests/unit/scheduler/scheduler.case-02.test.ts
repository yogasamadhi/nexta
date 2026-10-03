import { describe, expect, it } from 'vitest';

import { previewSchedule } from '@workspace/scheduler-core';

import { scheduleInput, task } from './fixtures';

describe('CASE-SCHED-02 protected facts and plan stability', () => {
  it('preserves locked, started, and completed blocks exactly and reports their hard conflicts', () => {
    const input = scheduleInput({
      now: '2026-04-06T09:30:00.000Z',
      tasks: [
        task('protected-task', {
          duration: { state: 'known', remainingMinutes: 180 },
        }),
      ],
      busyEvents: [
        {
          id: 'busy-started',
          start: '2026-04-06T09:30:00.000Z',
          end: '2026-04-06T09:45:00.000Z',
        },
        {
          id: 'busy-locked',
          start: '2026-04-06T10:45:00.000Z',
          end: '2026-04-06T11:15:00.000Z',
        },
        {
          id: 'busy-completed',
          start: '2026-04-06T08:15:00.000Z',
          end: '2026-04-06T08:20:00.000Z',
        },
      ],
      existingBlocks: [
        {
          id: 'locked',
          taskId: 'protected-task',
          type: 'task',
          start: '2026-04-06T10:30:00.000Z',
          end: '2026-04-06T11:30:00.000Z',
          status: 'planned',
          locked: true,
        },
        {
          id: 'started',
          taskId: 'protected-task',
          type: 'task',
          start: '2026-04-06T09:00:00.000Z',
          end: '2026-04-06T10:00:00.000Z',
          status: 'started',
          locked: false,
        },
        {
          id: 'completed',
          taskId: 'protected-task',
          type: 'task',
          start: '2026-04-06T08:00:00.000Z',
          end: '2026-04-06T08:30:00.000Z',
          status: 'completed',
          locked: false,
        },
      ],
    });

    const result = previewSchedule(input);
    for (const original of input.existingBlocks) {
      expect(result.blocks).toContainEqual({
        stableKey: `existing|${original.id.length}:${original.id}`,
        existingBlockId: original.id,
        taskId: original.taskId,
        type: original.type,
        start: original.start,
        end: original.end,
        status: original.status,
        locked: original.locked,
        changeReason: 'protected_existing',
      });
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          entityId: original.id,
          code: 'protected_busy_conflict',
        }),
      );
    }

    const generated = result.blocks.filter(
      (block) => block.changeReason !== 'protected_existing',
    );
    expect(
      generated.reduce(
        (minutes, block) =>
          minutes + (Date.parse(block.end) - Date.parse(block.start)) / 60_000,
        0,
      ),
    ).toBe(90);
    expect(result.metrics.protectedCommittedMinutes).toBe(90);
    expect(result.metrics.fullyScheduledTaskCount).toBe(0);
    expect(result.metrics.conflictedTaskCount).toBe(1);
    expect(result.explanations).not.toContainEqual(
      expect.objectContaining({
        entityId: 'protected-task',
        code: 'task_fully_scheduled',
      }),
    );
    expect(result.unscheduled).toEqual([]);
  });

  it('reuses a feasible unlocked block when the explicit stability weight wins', () => {
    const input = scheduleInput({
      tasks: [task('stable-task')],
      existingBlocks: [
        {
          id: 'existing-plan',
          taskId: 'stable-task',
          type: 'task',
          start: '2026-04-06T14:00:00.000Z',
          end: '2026-04-06T15:00:00.000Z',
          status: 'planned',
          locked: false,
        },
      ],
    });

    const result = previewSchedule(input);
    expect(result.blocks).toEqual([
      expect.objectContaining({
        stableKey: 'existing|13:existing-plan',
        existingBlockId: 'existing-plan',
        start: '2026-04-06T14:00:00.000Z',
        end: '2026-04-06T15:00:00.000Z',
        locked: false,
        status: 'planned',
        changeReason: 'preserved_existing',
      }),
    ]);
  });

  it('deducts protected future commitment and reports contradictory overcommitment', () => {
    const input = scheduleInput({
      tasks: [
        task('overcommitted', {
          duration: { state: 'known', remainingMinutes: 30 },
        }),
      ],
      existingBlocks: [
        {
          id: 'protected-long',
          taskId: 'overcommitted',
          type: 'task',
          start: '2026-04-06T10:00:00.000Z',
          end: '2026-04-06T11:00:00.000Z',
          status: 'planned',
          locked: true,
        },
      ],
    });

    const result = previewSchedule(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.changeReason).toBe('protected_existing');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        entityId: 'overcommitted',
        code: 'protected_commitment_exceeds_remaining',
      }),
    );
    expect(result.explanations).toContainEqual(
      expect.objectContaining({
        entityId: 'overcommitted',
        code: 'remaining_covered_by_protected_blocks',
      }),
    );
  });

  it.each(['missing', 'exhausted'] as const)(
    'makes omission of an unlocked planned block explicit for %s duration',
    (state) => {
      const input = scheduleInput({
        tasks: [task('unknown-effort', { duration: { state } })],
        existingBlocks: [
          {
            id: 'stale-unlocked',
            taskId: 'unknown-effort',
            type: 'task',
            start: '2026-04-06T14:00:00.000Z',
            end: '2026-04-06T15:00:00.000Z',
            status: 'planned',
            locked: false,
          },
        ],
      });

      const result = previewSchedule(input);
      expect(result.blocks).toEqual([]);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          entityId: 'stale-unlocked',
          code: 'existing_block_omitted',
        }),
      );
      expect(result.explanations).toContainEqual(
        expect.objectContaining({
          entityId: 'stale-unlocked',
          code: 'existing_block_not_proposed',
        }),
      );
    },
  );
});
