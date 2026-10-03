import { describe, expect, it } from 'vitest';

import {
  assertAcyclicTaskGraph,
  assertTaskParentAssignment,
  cancelTask,
  completeTask,
  createTask,
  DomainError,
  freezeTaskBaselineEstimate,
  markTaskPlanned,
  parseInstant,
  parseTaskId,
  startTask,
  updateTask,
  type Task,
  type UpdateTaskFields,
} from '../../../packages/domain/src';

const T0 = parseInstant('2026-09-12T01:00:00.000Z');
const T1 = parseInstant('2026-09-12T02:00:00.000Z');
const T2 = parseInstant('2026-09-12T03:00:00.000Z');

function makeTask(
  overrides: Partial<Parameters<typeof createTask>[0]> = {},
): Task {
  return createTask({
    id: parseTaskId('task-1'),
    title: 'Write the report',
    priority: 'normal',
    estimatedDurationMinutes: 120,
    splittable: true,
    minBlockMinutes: 25,
    maxBlockMinutes: 60,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: T0,
    ...overrides,
  });
}

function expectDomainCode(
  action: () => unknown,
  code: DomainError['code'],
): void {
  try {
    action();
    throw new Error('Expected a DomainError.');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe('Task creation and ordinary updates', () => {
  it('creates an inbox Task without inventing execution or completion facts', () => {
    const task = makeTask();

    expect(task).toMatchObject({
      status: 'inbox',
      estimatedDurationMinutes: 120,
      baselineEstimatedDurationMinutes: null,
      actualDurationMinutes: null,
      completedAt: null,
      canceledAt: null,
    });
  });

  it.each([
    ['estimatedDurationMinutes', 0],
    ['estimatedDurationMinutes', -1],
    ['remainingDurationMinutes', 0],
    ['minBlockMinutes', -5],
    ['maxBlockMinutes', Number.POSITIVE_INFINITY],
  ] as const)('rejects invalid %s', (field, value) => {
    expectDomainCode(() => makeTask({ [field]: value }), 'invalid_value');
  });

  it('permits finite fractional minutes while preserving the positivity rules', () => {
    const task = makeTask({
      estimatedDurationMinutes: 12.5,
      remainingDurationMinutes: 2.25,
    });

    expect(task.estimatedDurationMinutes).toBe(12.5);
    expect(task.remainingDurationMinutes).toBe(2.25);
  });

  it('rejects an inverted block range and an impossible deadline window', () => {
    expectDomainCode(
      () => makeTask({ minBlockMinutes: 61, maxBlockMinutes: 60 }),
      'invalid_value',
    );
    expectDomainCode(
      () =>
        makeTask({
          earliestStartAt: T2,
          deadlineAt: T1,
        }),
      'invalid_value',
    );
  });

  it('requires a time zone alongside a date-only deadline', () => {
    expectDomainCode(
      () =>
        makeTask({
          deadlineLocalDate: '2026-09-30' as never,
        }),
      'invalid_value',
    );
  });

  it('rejects a non-boolean splittable value from an untyped caller', () => {
    expectDomainCode(
      () => makeTask({ splittable: 'true' as never }),
      'invalid_value',
    );
  });

  it('edits ordinary fields while preserving the original estimate baseline', () => {
    const planned = markTaskPlanned(makeTask(), T1);
    const edited = updateTask(
      planned,
      {
        title: 'Write and review the report',
        estimatedDurationMinutes: 180,
        description: 'Final draft',
      },
      T2,
    );

    expect(edited.title).toBe('Write and review the report');
    expect(edited.estimatedDurationMinutes).toBe(180);
    expect(edited.baselineEstimatedDurationMinutes).toBe(120);
    expect(edited.updatedAt).toBe(T2);
  });

  it.each(['status', 'completedAt', 'canceledAt', 'actualDurationMinutes'])(
    'rejects an untyped ordinary patch of protected field %s',
    (field) => {
      const patch = { [field]: field === 'status' ? 'completed' : T1 };
      expectDomainCode(
        () => updateTask(makeTask(), patch as UpdateTaskFields, T1),
        'invalid_transition',
      );
    },
  );

  it('rejects ordinary updates after completion or cancellation', () => {
    const completed = completeTask(makeTask(), { completedAt: T1 });
    const canceled = cancelTask(makeTask(), { canceledAt: T1 });

    expectDomainCode(
      () => updateTask(completed, { title: 'Reopened' }, T2),
      'invalid_transition',
    );
    expectDomainCode(
      () => updateTask(canceled, { title: 'Reopened' }, T2),
      'invalid_transition',
    );
  });
});

describe('Task lifecycle transitions', () => {
  it('freezes a known estimate on first planning and never overwrites it', () => {
    const planned = markTaskPlanned(makeTask(), T1);
    const edited = updateTask(planned, { estimatedDurationMinutes: 200 }, T2);

    expect(planned.status).toBe('planned');
    expect(planned.baselineEstimatedDurationMinutes).toBe(120);
    expect(edited.baselineEstimatedDurationMinutes).toBe(120);
    expect(freezeTaskBaselineEstimate(edited, T2)).toBe(edited);
  });

  it('freezes the estimate when starting directly from inbox', () => {
    const started = startTask(makeTask(), T1);

    expect(started.status).toBe('in_progress');
    expect(started.baselineEstimatedDurationMinutes).toBe(120);
  });

  it('does not invent a baseline when the Task has no estimate', () => {
    const started = startTask(makeTask({ estimatedDurationMinutes: null }), T1);

    expect(started.baselineEstimatedDurationMinutes).toBeNull();
  });

  it('completes only a non-terminal Task and does not use estimate as actual', () => {
    const completed = completeTask(startTask(makeTask(), T1), {
      completedAt: T2,
    });

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBe(T2);
    expect(completed.actualDurationMinutes).toBeNull();
    expect(completed.canceledAt).toBeNull();
    expectDomainCode(
      () => completeTask(completed, { completedAt: T2 }),
      'invalid_transition',
    );
    expectDomainCode(
      () => cancelTask(completed, { canceledAt: T2 }),
      'invalid_transition',
    );
  });

  it('cancels without creating a completion timestamp', () => {
    const canceled = cancelTask(makeTask(), { canceledAt: T1 });

    expect(canceled.status).toBe('canceled');
    expect(canceled.canceledAt).toBe(T1);
    expect(canceled.completedAt).toBeNull();
  });

  it('rejects unsupported state transitions', () => {
    const planned = markTaskPlanned(makeTask(), T1);
    const started = startTask(planned, T2);

    expectDomainCode(() => markTaskPlanned(planned, T2), 'invalid_transition');
    expectDomainCode(() => startTask(started, T2), 'invalid_transition');
  });
});

describe('Task parent-cycle invariants', () => {
  const task1 = parseTaskId('task-1');
  const task2 = parseTaskId('task-2');
  const task3 = parseTaskId('task-3');

  it('rejects a direct or ancestor cycle', () => {
    expectDomainCode(
      () => assertTaskParentAssignment(task1, task1, []),
      'invariant_violation',
    );
    expectDomainCode(
      () => assertTaskParentAssignment(task1, task2, [task3, task1]),
      'invariant_violation',
    );
  });

  it('accepts an acyclic parent chain and rejects a cyclic graph', () => {
    expect(() =>
      assertTaskParentAssignment(task3, task2, [task1]),
    ).not.toThrow();
    expect(() =>
      assertAcyclicTaskGraph([
        { id: task1, parentTaskId: task2 },
        { id: task2, parentTaskId: task3 },
        { id: task3, parentTaskId: task1 },
      ]),
    ).toThrowError(DomainError);
  });
});
