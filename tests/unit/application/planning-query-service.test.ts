import {
  PlanningQueryService,
  type IntegrationState,
  type LocalDayRangePort,
} from '@workspace/application';
import {
  createCompletionRecord,
  createTask,
  createTimeBlock,
  createUserPreference,
  parseCompletionRecordId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  parseUserPreferenceId,
  type Task,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

import {
  MemoryUnitOfWork,
  SequenceClock,
  FixedLocalTimeProvider,
} from './fakes';

const dayStart = parseInstant('2026-09-12T00:00:00.000Z');
const now = parseInstant('2026-09-12T10:30:00.000Z');
const dayEnd = parseInstant('2026-09-13T00:00:00.000Z');
const localDate = parseLocalDate('2026-09-12');
const timeZone = parseTimeZoneId('Asia/Shanghai');

class FixedDayRange implements LocalDayRangePort {
  dayRange() {
    return Promise.resolve({ start: dayStart, end: dayEnd });
  }
}

const integrationState: IntegrationState = {
  planRevision: 2,
  calendar: {
    channel: 'calendar',
    status: 'pending',
    currentPlanRevision: 2,
    desiredRevision: 2,
    jobId: 'calendar-job',
    attemptCount: 0,
    lastErrorCode: null,
    automaticRetryEligible: true,
    notBefore: now,
    updatedAt: now,
    bindingConflictCount: 0,
  },
  notifications: {
    channel: 'notification',
    status: 'permission_required',
    currentPlanRevision: 2,
    desiredRevision: 2,
    jobId: 'notification-job',
    attemptCount: 1,
    lastErrorCode: 'notification_permission_required',
    automaticRetryEligible: false,
    notBefore: now,
    updatedAt: now,
    bindingConflictCount: 0,
  },
};

function task(id: string, overrides: Partial<Task> = {}) {
  return createTask({
    id: parseTaskId(id),
    title: `Task ${id}`,
    priority: 'normal',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: dayStart,
    ...overrides,
  });
}

function block(id: string, taskValue: Task, startAt: string, endAt: string) {
  return createTimeBlock({
    id: parseTimeBlockId(id),
    taskId: taskValue.id,
    type: 'task',
    startAt: parseInstant(startAt),
    endAt: parseInstant(endAt),
    status: 'planned',
    source: 'scheduler',
    locked: false,
    planRevision: 2,
    createdAt: dayStart,
  });
}

function fixture(tasks: readonly Task[] = []) {
  const unitOfWork = new MemoryUnitOfWork();
  unitOfWork.state.scheduleState = { stateVersion: 4, planRevision: 2 };
  for (const value of tasks) unitOfWork.state.tasks.set(value.id, value);
  const service = new PlanningQueryService({
    unitOfWork,
    clock: new SequenceClock(now, now),
    localTime: new FixedLocalTimeProvider(localDate, timeZone),
    days: new FixedDayRange(),
    integrations: {
      getCurrentStatus: () => Promise.resolve(integrationState),
    },
  });
  return { unitOfWork, service };
}

describe('PlanningQueryService CASE-TODAY-01', () => {
  it('returns the current block, at most three next blocks, and only real completion wins', async () => {
    const currentTask = task('current');
    const nextTasks = [1, 2, 3, 4].map((index) => task(`next-${index}`));
    const test = fixture([currentTask, ...nextTasks]);
    const blocks = [
      block(
        'current-block',
        currentTask,
        '2026-09-12T10:00:00.000Z',
        '2026-09-12T11:00:00.000Z',
      ),
      ...nextTasks.map((value, index) =>
        block(
          `next-block-${index + 1}`,
          value,
          `2026-09-12T${String(12 + index).padStart(2, '0')}:00:00.000Z`,
          `2026-09-12T${String(13 + index).padStart(2, '0')}:00:00.000Z`,
        ),
      ),
    ];
    for (const value of blocks) {
      test.unitOfWork.state.timeBlocks.set(value.id, value);
    }
    const win = createCompletionRecord({
      id: parseCompletionRecordId('completion-real'),
      taskId: parseTaskId('completed-task'),
      operationId: parseOperationId('completion-operation'),
      completedAt: parseInstant('2026-09-12T08:00:00.000Z'),
      taskTitleSnapshot: 'A real completed task',
      actualDurationSeconds: null,
      durationCoverage: 'unknown',
      achievementDisposition: 'record',
      source: 'user',
    });
    test.unitOfWork.state.completionRecords.set(win.taskId, win);

    const result = await test.service.getToday();

    expect(result.nowCard).toMatchObject({
      kind: 'current_block',
      remainingMinutes: 30,
      block: { id: 'current-block', task: { id: 'current' } },
    });
    expect(result.next.map(({ id }) => id)).toEqual([
      'next-block-1',
      'next-block-2',
      'next-block-3',
    ]);
    expect(result.wins).toEqual([
      {
        completionRecordId: 'completion-real',
        taskId: 'completed-task',
        title: 'A real completed task',
        completedAt: '2026-09-12T08:00:00.000Z',
        actualDurationSeconds: null,
        durationCoverage: 'unknown',
      },
    ]);
    expect(result.calendarFreshness.status).toBe('setup_required');
    expect(result.integration).toEqual(integrationState);
  });

  it('offers a deterministic executable task candidate when there is no current block', async () => {
    const later = task('later', {
      deadlineAt: parseInstant('2026-09-20T00:00:00.000Z'),
    });
    const urgent = task('urgent', {
      deadlineAt: parseInstant('2026-09-13T00:00:00.000Z'),
    });
    const test = fixture([later, urgent]);

    await expect(test.service.getToday()).resolves.toMatchObject({
      nowCard: {
        kind: 'candidate_task',
        action: 'schedule',
        task: { id: 'urgent' },
      },
    });
  });

  it('explains missing duration, future availability, and true empty state', async () => {
    const missing = fixture([
      task('missing', { estimatedDurationMinutes: null }),
    ]);
    await expect(missing.service.getToday()).resolves.toMatchObject({
      nowCard: { kind: 'empty', reason: 'missing_duration' },
    });

    const future = fixture([
      task('future', {
        earliestStartAt: parseInstant('2026-09-12T14:00:00.000Z'),
      }),
    ]);
    await expect(future.service.getToday()).resolves.toMatchObject({
      nowCard: { kind: 'empty', reason: 'not_yet_available' },
    });

    const empty = fixture();
    await expect(empty.service.getToday()).resolves.toMatchObject({
      nowCard: { kind: 'empty', reason: 'no_tasks' },
      next: [],
      wins: [],
    });
  });

  it('treats explicit empty calendar selection as local-only, not missing setup', async () => {
    const test = fixture();
    const preference = createUserPreference({
      id: parseUserPreferenceId('preference-calendars'),
      key: 'calendar.busySources.v1',
      valueJson: { sources: [] },
      updatedAt: now,
    });
    test.unitOfWork.state.userPreferences.set(preference.id, preference);

    await expect(
      test.service.getDayTimeline({
        localDate,
        timeZone,
      }),
    ).resolves.toMatchObject({
      localDate,
      timeZone,
      range: { start: dayStart, end: dayEnd },
      calendarFreshness: {
        status: 'not_configured',
        capturedAt: null,
      },
    });
  });

  it('does not show skipped/canceled blocks as executable timeline content', async () => {
    const value = task('task');
    const test = fixture([value]);
    for (const status of ['skipped', 'canceled'] as const) {
      const hidden = createTimeBlock({
        ...block(
          `${status}-block`,
          value,
          '2026-09-12T09:00:00.000Z',
          '2026-09-12T10:00:00.000Z',
        ),
        status,
      });
      test.unitOfWork.state.timeBlocks.set(hidden.id, hidden);
    }

    await expect(
      test.service.getDayTimeline({ localDate, timeZone }),
    ).resolves.toMatchObject({ blocks: [] });
  });
});
