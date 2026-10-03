import { describe, expect, it } from 'vitest';

import {
  previewSchedule,
  ScheduleValidationError,
  validateScheduleInput,
  type ScheduleInput,
} from '@workspace/scheduler-core';

import { scheduleInput, task } from './fixtures';

function expectInvalid(value: unknown, path: string): void {
  try {
    validateScheduleInput(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ScheduleValidationError);
    expect((error as ScheduleValidationError).issues[0]?.path).toBe(path);
    return;
  }
  throw new Error('Expected schedule input validation to fail.');
}

describe('scheduler runtime boundary validation', () => {
  it('rejects unknown fields rather than silently accepting an altered contract', () => {
    const input = { ...scheduleInput(), hiddenPolicy: true };
    expectInvalid(input, 'input.hiddenPolicy');
  });

  it('rejects non-UTC and impossible instants', () => {
    expectInvalid(
      { ...scheduleInput(), now: '2026-04-06T09:00:00+08:00' },
      'input.now',
    );
    expectInvalid(
      { ...scheduleInput(), now: '2026-02-30T09:00:00.000Z' },
      'input.now',
    );
  });

  it('rejects ambiguous working windows and missing explicit policy ranks', () => {
    const base = scheduleInput();
    expectInvalid(
      {
        ...base,
        preferences: {
          ...base.preferences,
          workingWindows: [
            ...base.preferences.workingWindows,
            {
              id: 'overlap',
              start: '2026-04-06T16:00:00.000Z',
              end: '2026-04-06T18:00:00.000Z',
              energyLevel: null,
            },
          ],
        },
      },
      'input.preferences.workingWindows',
    );

    expectInvalid(
      {
        ...base,
        tasks: [task('unknown-priority', { priority: 'unranked' })],
      },
      'input.tasks[0].priority',
    );
  });

  it('validates opaque schedulingPolicy without assigning it hidden behavior', () => {
    const left = scheduleInput({
      tasks: [task('opaque', { schedulingPolicy: 'policy-a' })],
    });
    const right = scheduleInput({
      tasks: [task('opaque', { schedulingPolicy: 'policy-b' })],
    });
    expect(previewSchedule(left).blocks).toEqual(previewSchedule(right).blocks);

    const malformed = scheduleInput({ tasks: [task('opaque')] });
    const taskValue = { ...malformed.tasks[0], schedulingPolicy: '' };
    expectInvalid(
      { ...malformed, tasks: [taskValue] } as unknown as ScheduleInput,
      'input.tasks[0].schedulingPolicy',
    );
  });

  it('rejects finite individual scores whose weighted combination overflows', () => {
    const base = scheduleInput();
    expectInvalid(
      {
        ...base,
        preferences: {
          ...base.preferences,
          preferredWindows: [
            {
              id: 'huge-score',
              start: '2026-04-06T09:00:00.000Z',
              end: '2026-04-06T10:00:00.000Z',
              score: Number.MAX_VALUE,
            },
          ],
        },
        policy: {
          ...base.policy,
          scoreWeights: {
            ...base.policy.scoreWeights,
            preferredHours: Number.MAX_VALUE,
          },
        },
      },
      'input.policy.scoreWeights',
    );
  });

  it('rejects a caller-supplied algorithm version that does not match this build', () => {
    const base = scheduleInput();
    expectInvalid(
      {
        ...base,
        policy: { ...base.policy, schedulerVersion: 'future-algorithm' },
      },
      'input.policy.schedulerVersion',
    );
  });
});
