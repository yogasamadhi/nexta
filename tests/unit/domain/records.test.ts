import { describe, expect, it } from 'vitest';

import {
  advancePlanRevision,
  advanceStateVersion,
  createCompletionRecord,
  createOperationRecord,
  createScheduleState,
  createTaskActivityEvent,
  DomainError,
  parseCompletionRecordId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseTaskActivityEventId,
  parseTaskId,
  parseTimeZoneId,
} from '../../../packages/domain/src';

const AT = parseInstant('2026-09-12T01:00:00.000Z');
const taskId = parseTaskId('task-1');
const operationId = parseOperationId('operation-1');

describe('CompletionRecord', () => {
  it('represents a no-timer completion without inventing duration', () => {
    const record = createCompletionRecord({
      id: parseCompletionRecordId('completion-1'),
      taskId,
      operationId,
      completedAt: AT,
      taskTitleSnapshot: 'Write report',
      durationCoverage: 'unknown',
      achievementDisposition: 'skip',
      source: 'user',
    });

    expect(record.actualDurationSeconds).toBeNull();
    expect(record.durationCoverage).toBe('unknown');
  });

  it('requires recorded duration when claiming partial or complete coverage', () => {
    expect(() =>
      createCompletionRecord({
        id: parseCompletionRecordId('completion-1'),
        taskId,
        operationId,
        completedAt: AT,
        taskTitleSnapshot: 'Write report',
        durationCoverage: 'complete',
        achievementDisposition: 'record',
        source: 'user',
      }),
    ).toThrowError(DomainError);
  });

  it('allows zero or fractional recorded seconds without replacing them', () => {
    const record = createCompletionRecord({
      id: parseCompletionRecordId('completion-1'),
      taskId,
      operationId,
      completedAt: AT,
      taskTitleSnapshot: 'Write report',
      actualDurationSeconds: 0.5,
      durationCoverage: 'partial',
      achievementDisposition: 'record',
      source: 'agent_authorized',
    });

    expect(record.actualDurationSeconds).toBe(0.5);
  });
});

describe('TaskActivityEvent', () => {
  it('keeps only a minimal flat structured summary', () => {
    const event = createTaskActivityEvent({
      id: parseTaskActivityEventId('event-1'),
      taskId,
      eventType: 'complete_task',
      actor: 'user',
      occurredAt: AT,
      localDate: parseLocalDate('2026-09-12'),
      timeZone: parseTimeZoneId('Asia/Shanghai'),
      operationId,
      beforeSummary: { status: 'in_progress' },
      afterSummary: { status: 'completed', durationKnown: false },
    });

    expect(event.afterSummary).toEqual({
      status: 'completed',
      durationKnown: false,
    });
  });

  it('rejects nested audit payloads', () => {
    expect(() =>
      createTaskActivityEvent({
        id: parseTaskActivityEventId('event-1'),
        taskId,
        eventType: 'update',
        actor: 'user',
        occurredAt: AT,
        localDate: parseLocalDate('2026-09-12'),
        timeZone: parseTimeZoneId('Asia/Shanghai'),
        operationId,
        afterSummary: { payload: { raw: 'not allowed' } } as never,
      }),
    ).toThrowError(DomainError);
  });
});

describe('OperationRecord and ScheduleState', () => {
  it('validates replay metadata and JSON result', () => {
    const record = createOperationRecord({
      operationId,
      command: 'task.complete',
      parameterHash: 'sha256:abc',
      resultJson: '{"taskId":"task-1"}',
      baseStateVersion: 2,
      currentStateVersion: 3,
      occurredAt: AT,
    });

    expect(record.currentStateVersion).toBe(3);
    expect(() =>
      createOperationRecord({
        operationId,
        command: 'task.complete',
        parameterHash: 'sha256:abc',
        resultJson: 'not-json',
        currentStateVersion: 3,
        occurredAt: AT,
      }),
    ).toThrowError(DomainError);
  });

  it('advances input and plan versions independently', () => {
    const initial = createScheduleState();
    const inputChanged = advanceStateVersion(initial);
    const planChanged = advancePlanRevision(inputChanged);

    expect(initial).toEqual({ stateVersion: 0, planRevision: 0 });
    expect(inputChanged).toEqual({ stateVersion: 1, planRevision: 0 });
    expect(planChanged).toEqual({ stateVersion: 1, planRevision: 1 });
  });
});

describe('time value objects', () => {
  it('accepts only real canonical UTC instants and local dates', () => {
    expect(parseInstant('2026-09-12T01:00:00Z')).toBe(
      '2026-09-12T01:00:00.000Z',
    );
    expect(() => parseInstant('2026-09-12T09:00:00+08:00')).toThrowError(
      DomainError,
    );
    expect(() => parseInstant('2026-02-31T01:00:00Z')).toThrowError(
      DomainError,
    );
    expect(() => parseLocalDate('2026-02-31')).toThrowError(DomainError);
  });
});
