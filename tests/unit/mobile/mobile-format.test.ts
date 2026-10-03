import { describe, expect, it } from 'vitest';

import {
  busyCompletenessLabel,
  durationMinutes,
  focusTransitionDurationMs,
  focusTransitionRemainingSeconds,
  formatDatedRange,
  formatMinuteEstimate,
  isFuturePlannedTimeBlock,
  localWeekDates,
  persistedTaskPreviewError,
  previewChangeReasonLabel,
  previewDeadlineLabel,
  previewBlockTypeLabel,
  schedulePreviewSummary,
  scheduleWarningLabel,
  shouldShowMindfulTransition,
  shiftLocalDate,
  timeBlockStatusLabel,
  timeBlockTypeLabel,
  unscheduledReasonLabel,
  userFacingError,
} from '../../../apps/mobile/src/presentation/mobile-format';

describe('mobile presentation formatting', () => {
  it('shifts canonical local dates without using the device time zone', () => {
    expect(shiftLocalDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftLocalDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftLocalDate('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('builds a stable Monday-to-Sunday local week across month boundaries', () => {
    expect(localWeekDates('2026-09-12')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(localWeekDates('2026-03-01')).toEqual([
      '2026-02-23',
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
    expect(() => localWeekDates('2026-02-31')).toThrow('valid calendar date');
  });

  it('calculates elapsed duration and rejects unsafe date shifts', () => {
    expect(
      durationMinutes('2026-09-12T01:00:00.000Z', '2026-09-12T02:30:00.000Z'),
    ).toBe(90);
    expect(() => shiftLocalDate('09/12/2026', 1)).toThrow('YYYY-MM-DD');
  });

  it('keeps fractional minute precision out of user-facing copy', () => {
    expect(formatMinuteEstimate(30)).toBe('30 分钟');
    expect(formatMinuteEstimate(29.483333333333334)).toBe('约 29 分钟');
    expect(formatMinuteEstimate(0.5)).toBe('少于 1 分钟');
    expect(formatMinuteEstimate(0)).toBe('0 分钟');
    expect(() => formatMinuteEstimate(Number.NaN)).toThrow('finite');
    expect(() => formatMinuteEstimate(-1)).toThrow('non-negative');
  });

  it('offers adjustment only for future planned TimeBlocks', () => {
    const nowMs = Date.parse('2026-09-12T01:00:00.000Z');
    expect(
      isFuturePlannedTimeBlock(
        { status: 'planned', startAt: '2026-09-12T01:15:00.000Z' },
        nowMs,
      ),
    ).toBe(true);
    expect(
      isFuturePlannedTimeBlock(
        { status: 'started', startAt: '2026-09-12T01:15:00.000Z' },
        nowMs,
      ),
    ).toBe(false);
    expect(
      isFuturePlannedTimeBlock(
        { status: 'planned', startAt: '2026-09-12T01:00:00.000Z' },
        nowMs,
      ),
    ).toBe(false);
  });

  it('shows a bounded mindful transition only for a newly requested running session', () => {
    expect(focusTransitionDurationMs).toBe(10_000);
    expect(
      shouldShowMindfulTransition({
        requested: true,
        enabled: true,
        sessionStatus: 'running',
      }),
    ).toBe(true);
    expect(
      shouldShowMindfulTransition({
        requested: true,
        enabled: true,
        sessionStatus: 'paused',
      }),
    ).toBe(false);
    expect(
      shouldShowMindfulTransition({
        requested: false,
        enabled: true,
        sessionStatus: 'running',
      }),
    ).toBe(false);
    expect(focusTransitionRemainingSeconds(11_000, 1_001)).toBe(10);
    expect(focusTransitionRemainingSeconds(11_000, 11_000)).toBe(0);
  });

  it('maps safe application error codes to actionable copy', () => {
    expect(userFacingError({ code: 'scheduling_setup_required' })).toContain(
      '设置',
    );
    expect(userFacingError({ code: 'plan_conflict' })).toContain('重新');
    expect(userFacingError(new Error('secret internal detail'))).not.toContain(
      'secret',
    );
  });

  it('keeps a committed Task distinct from a failed schedule preview', () => {
    expect(
      persistedTaskPreviewError(
        { code: 'scheduling_setup_required' },
        'created',
      ),
    ).toBe(
      '任务已保存在本机，但排程预览尚未生成。请先设置时区、工作时间和日历范围，再生成排程。',
    );
    expect(
      persistedTaskPreviewError({ code: 'plan_conflict' }, 'updated'),
    ).toContain('任务修改已保存在本机');
  });

  it('renders Schedule Preview from structured codes instead of core English messages', () => {
    expect(
      schedulePreviewSummary([
        { kind: 'create' },
        { kind: 'create' },
        { kind: 'update' },
        { kind: 'cancel' },
      ]),
    ).toBe('新增 2 个、调整 1 个、取消 1 个时间块');
    expect(busyCompletenessLabel('partial')).toBe('部分可用');
    expect(previewBlockTypeLabel('buffer')).toBe('缓冲时间');
    expect(timeBlockTypeLabel('relax')).toBe('放松');
    expect(timeBlockStatusLabel('completed')).toBe('已完成');
    expect(unscheduledReasonLabel('missing_duration')).toContain('预计用时');
    expect(unscheduledReasonLabel('insufficient_time', 42)).toContain(
      '约 42 分钟',
    );
    expect(scheduleWarningLabel('deadline_risk')).toContain('截止时间');
    expect(previewChangeReasonLabel('moved_existing')).toContain('移动');
    expect(previewDeadlineLabel([{ code: 'deadline_risk' }])).toContain('风险');
    expect(previewDeadlineLabel([])).toContain('没有报告');
  });

  it('includes local dates when preview ranges cross a day boundary', () => {
    expect(
      formatDatedRange(
        '2026-09-12T15:30:00.000Z',
        '2026-09-12T16:30:00.000Z',
        'Asia/Shanghai',
      ),
    ).toContain('9月12日');
    expect(
      formatDatedRange(
        '2026-09-12T15:30:00.000Z',
        '2026-09-12T16:30:00.000Z',
        'Asia/Shanghai',
      ),
    ).toContain('9月13日');
  });
});
