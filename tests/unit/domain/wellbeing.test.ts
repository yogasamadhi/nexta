import { describe, expect, it } from 'vitest';

import {
  createDailyReflection,
  createEnergyCheckIn,
  endRelaxSession,
  parseCompletionRecordId,
  parseDailyReflectionId,
  parseEnergyCheckInId,
  parseInstant,
  parseLocalDate,
  parseRelaxSessionId,
  parseTaskId,
  parseTimeZoneId,
  startRelaxSession,
  updateDailyReflection,
} from '../../../packages/domain/src';

const T0 = parseInstant('2026-09-12T01:00:00.000Z');
const T1 = parseInstant('2026-09-12T01:01:00.000Z');
const DATE = parseLocalDate('2026-09-12');
const ZONE = parseTimeZoneId('Asia/Shanghai');

describe('Phase 8 wellbeing domain', () => {
  it('keeps reflection wins tied to unique completion evidence and preserves user notes', () => {
    const win = {
      completionRecordId: parseCompletionRecordId('completion-1'),
      taskId: parseTaskId('task-1'),
      title: '完成报告',
      completedAt: T0,
    };
    const reflection = createDailyReflection({
      id: parseDailyReflectionId('reflection-1'),
      localDate: DATE,
      timeZone: ZONE,
      summary: '今天完成了 1 项。',
      wins: [win],
      adjustmentSuggestion: '明天先确认下一步。',
      userNote: '值得记住。',
      generatedBy: 'local_facts',
      createdAt: T0,
    });
    const refreshed = updateDailyReflection(
      reflection,
      { summary: '事实已刷新。', wins: [win] },
      T1,
    );

    expect(refreshed).toMatchObject({
      userNote: '值得记住。',
      generatedBy: 'local_facts',
      wins: [{ completionRecordId: 'completion-1' }],
    });
    expect(() =>
      updateDailyReflection(reflection, { wins: [win, win] }, T1),
    ).toThrow('must not repeat completion evidence');
  });

  it('records a non-medical one-to-five energy level', () => {
    expect(
      createEnergyCheckIn({
        id: parseEnergyCheckInId('check-in-1'),
        localDate: DATE,
        timeZone: ZONE,
        level: 2,
        note: '今天主观精力偏低',
        createdAt: T0,
      }),
    ).toMatchObject({ level: 2, localDate: DATE, timeZone: ZONE });
  });

  it('keeps completed and abandoned relaxation separate and marks clock regression', () => {
    const active = startRelaxSession({
      id: parseRelaxSessionId('relax-1'),
      type: 'breathing',
      plannedMinutes: 1,
      source: 'focus',
      startedAt: T1,
    });
    const ended = endRelaxSession(active, 'completed', T0);

    expect(ended).toMatchObject({
      status: 'completed',
      endedAt: T1,
      actualSeconds: 0,
      timingQuality: 'needs_review',
    });
    expect(() => endRelaxSession(ended, 'abandoned', T1)).toThrow(
      'Only an active RelaxSession',
    );
  });
});
