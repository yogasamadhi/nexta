import {
  emptyTaskConstraintDraft,
  hasDateOnlyDeadline,
  normalizeLocalDateInput,
  parseTaskConstraintDraft,
  taskConstraintDraftFromTask,
  TaskConstraintDraftError,
} from '../../../apps/mobile/src/presentation/task-constraints';
import { IntlTemporalAdapter } from '../../../apps/mobile/src/runtime/intl-temporal-adapter';
import { createTask, parseInstant, parseTaskId } from '@workspace/domain';
import { describe, expect, it } from 'vitest';

const temporal = new IntlTemporalAdapter({
  currentTimeZone: () => 'Asia/Shanghai',
});

describe('mobile Task constraint form', () => {
  it('resolves exact local constraints and parses block bounds', () => {
    const result = parseTaskConstraintDraft(
      {
        ...emptyTaskConstraintDraft(),
        earliestDate: '2026-09-14',
        earliestTime: '09:00',
        deadlineDate: '2026-09-14',
        deadlineTime: '18:30',
        splittable: true,
        minBlockMinutes: '30',
        maxBlockMinutes: '90',
        categoryKey: ' 写作 ',
        energyDemand: ' high ',
      },
      temporal,
    );

    expect(result).toEqual({
      earliestStartAt: '2026-09-14T01:00:00.000Z',
      deadlineAt: '2026-09-14T10:30:00.000Z',
      deadlineLocalDate: null,
      deadlineTimeZone: null,
      splittable: true,
      minBlockMinutes: 30,
      maxBlockMinutes: 90,
      categoryKey: '写作',
      energyDemand: 'high',
    });
  });

  it('preserves a date-only deadline with its explicit device zone', () => {
    const result = parseTaskConstraintDraft(
      {
        ...emptyTaskConstraintDraft(),
        deadlineDate: '2026-09-30',
      },
      temporal,
    );

    expect(result.deadlineAt).toBeNull();
    expect(result.deadlineLocalDate).toBe('2026-09-30');
    expect(result.deadlineTimeZone).toBe('Asia/Shanghai');
    expect(hasDateOnlyDeadline(result)).toBe(true);
  });

  it('normalizes smart punctuation produced by mobile keyboards', () => {
    expect(normalizeLocalDateInput(' 2026—09—14 ')).toBe('2026-09-14');
    const result = parseTaskConstraintDraft(
      {
        ...emptyTaskConstraintDraft(),
        earliestDate: '2026–09–14',
        earliestTime: '09：00',
        deadlineDate: '2026‑09‑15',
        deadlineTime: '18：30',
      },
      temporal,
    );

    expect(result.earliestStartAt).toBe('2026-09-14T01:00:00.000Z');
    expect(result.deadlineAt).toBe('2026-09-15T10:30:00.000Z');
  });

  it('rejects incomplete, reversed, and impossible constraints', () => {
    expect(() =>
      parseTaskConstraintDraft(
        {
          ...emptyTaskConstraintDraft(),
          earliestDate: '2026-09-14',
        },
        temporal,
      ),
    ).toThrow(TaskConstraintDraftError);
    expect(() =>
      parseTaskConstraintDraft(
        {
          ...emptyTaskConstraintDraft(),
          minBlockMinutes: '60',
          maxBlockMinutes: '30',
        },
        temporal,
      ),
    ).toThrow('最短时间块不能大于最长时间块');
    expect(() =>
      parseTaskConstraintDraft(
        {
          ...emptyTaskConstraintDraft(),
          earliestDate: '2026-09-14',
          earliestTime: '18:00',
          deadlineDate: '2026-09-14',
          deadlineTime: '09:00',
        },
        temporal,
      ),
    ).toThrow('截止时间不能早于最早开始时间');
  });

  it('hydrates exact and date-only Task constraints without guessing', () => {
    const exact = createTask({
      id: parseTaskId('task_form_exact'),
      title: 'Exact',
      priority: 'normal',
      earliestStartAt: parseInstant('2026-09-14T01:00:00.000Z'),
      deadlineAt: parseInstant('2026-09-14T10:30:00.000Z'),
      splittable: true,
      minBlockMinutes: 30,
      maxBlockMinutes: 90,
      energyDemand: 'high',
      categoryKey: 'writing',
      schedulingPolicy: 'flexible',
      source: 'user',
      createdAt: parseInstant('2026-09-12T00:00:00.000Z'),
    });
    expect(taskConstraintDraftFromTask(exact, temporal)).toMatchObject({
      earliestDate: '2026-09-14',
      earliestTime: '09:00',
      deadlineDate: '2026-09-14',
      deadlineTime: '18:30',
      splittable: true,
    });

    const dateOnly = createTask({
      id: parseTaskId('task_form_date_only'),
      title: 'Date only',
      priority: 'normal',
      deadlineLocalDate: '2026-09-30' as never,
      deadlineTimeZone: 'Asia/Shanghai' as never,
      splittable: false,
      schedulingPolicy: 'flexible',
      source: 'user',
      createdAt: parseInstant('2026-09-12T00:00:00.000Z'),
    });
    expect(taskConstraintDraftFromTask(dateOnly, temporal)).toMatchObject({
      deadlineDate: '2026-09-30',
      deadlineTime: '',
    });
  });
});
