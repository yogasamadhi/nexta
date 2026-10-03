import { describe, expect, it } from 'vitest';

import {
  abandonExecutionSession,
  closeExecutionInterval,
  createAchievement,
  createExecutionInterval,
  createExecutionSession,
  executionIntervalSeconds,
  finishExecutionSession,
  parseAchievementId,
  parseCompletionRecordId,
  parseExecutionIntervalId,
  parseExecutionSessionId,
  parseInstant,
  parseTaskId,
  pauseExecutionSession,
  resumeExecutionSession,
  setAchievementHidden,
  updateAchievement,
} from '../../../packages/domain/src';

const T0 = parseInstant('2026-09-12T01:00:00.000Z');
const T1 = parseInstant('2026-09-12T01:30:00.000Z');
const T2 = parseInstant('2026-09-12T02:00:00.000Z');

function session() {
  return createExecutionSession({
    id: parseExecutionSessionId('session-1'),
    taskId: parseTaskId('task-1'),
    startedAt: T0,
  });
}

describe('Execution domain', () => {
  it('keeps running, paused, resumed and finished lifecycle facts distinct', () => {
    const running = session();
    const paused = pauseExecutionSession(running, T1);
    const resumed = resumeExecutionSession(paused, T2, 1_800);
    const finished = finishExecutionSession(
      resumed,
      parseInstant('2026-09-12T02:30:00.000Z'),
      'finish_session',
    );

    expect(paused).toMatchObject({ status: 'paused', pausedAt: T1 });
    expect(resumed).toMatchObject({
      status: 'running',
      pausedDurationSeconds: 1_800,
    });
    expect(finished).toMatchObject({
      status: 'completed',
      completionType: 'finish_session',
    });
    expect(() => abandonExecutionSession(finished, T2)).toThrow(
      'cannot be abandoned',
    );
  });

  it('clamps a regressed clock interval and excludes it from trusted duration', () => {
    const interval = createExecutionInterval({
      id: parseExecutionIntervalId('interval-1'),
      sessionId: session().id,
      kind: 'work',
      startAt: T1,
    });
    const closed = closeExecutionInterval(interval, T0);

    expect(closed).toMatchObject({
      startAt: T1,
      endAt: T1,
      timingQuality: 'needs_review',
    });
    expect(executionIntervalSeconds(closed)).toBe(0);
  });
});

describe('Achievement domain', () => {
  it('preserves evidence while user edits and hides its presentation', () => {
    const created = createAchievement({
      id: parseAchievementId('achievement-1'),
      sourceCompletionRecordId: parseCompletionRecordId('completion-1'),
      sourceTaskId: parseTaskId('task-1'),
      title: 'Ship the report',
      evidenceType: 'task_completion',
      occurredAt: T1,
      createdAt: T1,
    });
    const edited = updateAchievement(
      created,
      { title: 'Report delivered', summary: 'Sent to the team.' },
      T2,
    );
    const hidden = setAchievementHidden(edited, true, T2);

    expect(hidden).toMatchObject({
      sourceCompletionRecordId: created.sourceCompletionRecordId,
      sourceTaskId: created.sourceTaskId,
      title: 'Report delivered',
      summary: 'Sent to the team.',
      userEdited: true,
      hidden: true,
    });
  });
});
