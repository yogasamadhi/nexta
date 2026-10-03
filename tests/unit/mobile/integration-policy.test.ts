import type { IntegrationProjectionContext } from '@workspace/application';
import {
  createTask,
  createTimeBlock,
  parseInstant,
  parseTaskId,
  parseTimeBlockId,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

import { createMobileIntegrationProjectionPolicy } from '../../../apps/mobile/src/runtime/integration-policy';

function context(
  overrides: Partial<IntegrationProjectionContext> = {},
): IntegrationProjectionContext {
  const now = parseInstant('2026-09-12T08:00:00.000Z');
  const task = createTask({
    id: parseTaskId('task-1'),
    title: 'Private task title',
    description: 'Never project this description',
    priority: 'normal',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: now,
  });
  return {
    channel: 'calendar',
    block: createTimeBlock({
      id: parseTimeBlockId('block-1'),
      taskId: task.id,
      type: 'task',
      startAt: parseInstant('2026-09-12T10:00:00.000Z'),
      endAt: parseInstant('2026-09-12T11:00:00.000Z'),
      status: 'planned',
      source: 'scheduler',
      locked: false,
      planRevision: 1,
      createdAt: now,
    }),
    task,
    planRevision: 1,
    notificationLeadMinutes: null,
    now,
    ...overrides,
  };
}

function policy() {
  return createMobileIntegrationProjectionPolicy({
    calendar: {
      provider: 'expo-calendar',
      ownershipKey: 'execution-agent.calendar.v1',
      title: 'Personal schedule',
      color: null,
      androidSource: null,
      exposeTaskTitle: false,
      genericEventTitle: 'Planned focus block',
    },
    notification: {
      enabled: true,
      leadMinutes: 15,
      type: 'time_block_start',
      exposeTaskTitle: false,
      genericTitle: 'A focus block is coming up',
      body: null,
    },
  });
}

describe('mobile integration projection policy', () => {
  it('keeps private task text out of the conservative projection', () => {
    const value = context();

    expect(policy().calendarEvent(value)).toEqual({
      title: 'Planned focus block',
      startAt: value.block.startAt,
      endAt: value.block.endAt,
    });
    expect(
      policy().notification({ ...value, channel: 'notification' }),
    ).toEqual({
      title: 'A focus block is coming up',
      body: null,
      scheduledAt: '2026-09-12T09:45:00.000Z',
      type: 'time_block_start',
    });
  });

  it('uses a validated user lead-time override without changing the host default', () => {
    const value = context({ notificationLeadMinutes: 30 });

    expect(
      policy().notification({ ...value, channel: 'notification' }),
    ).toMatchObject({ scheduledAt: '2026-09-12T09:30:00.000Z' });
    expect(
      policy().notification({
        ...value,
        channel: 'notification',
        notificationLeadMinutes: null,
      }),
    ).toMatchObject({ scheduledAt: '2026-09-12T09:45:00.000Z' });
  });

  it('projects only future planned task blocks', () => {
    const value = context();
    const completed = createTimeBlock({
      ...value.block,
      status: 'completed',
    });

    expect(policy().calendarEvent({ ...value, block: completed })).toBeNull();
    expect(policy().notification({ ...value, block: completed })).toBeNull();
    expect(
      policy().notification({
        ...value,
        now: parseInstant('2026-09-12T09:50:00.000Z'),
      }),
    ).toBeNull();
  });

  it('requires every user-visible and timing choice explicitly', () => {
    expect(() =>
      createMobileIntegrationProjectionPolicy({
        calendar: {
          provider: 'expo-calendar',
          ownershipKey: 'owner',
          title: 'Calendar',
          color: null,
          androidSource: null,
          exposeTaskTitle: false,
          genericEventTitle: 'Focus',
        },
        notification: {
          enabled: true,
          leadMinutes: -1,
          type: 'start',
          exposeTaskTitle: false,
          genericTitle: 'Focus',
          body: null,
        },
      }),
    ).toThrow('leadMinutes');
  });
});
