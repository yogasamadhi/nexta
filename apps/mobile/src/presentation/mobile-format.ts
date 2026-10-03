import type { SchedulePreview } from '@workspace/application';
import type { ExecutionSession, TimeBlock } from '@workspace/domain';

const minuteMs = 60_000;
export const focusTransitionDurationMs = 10_000;

type PreviewChange = SchedulePreview['changedBlocks'][number];
type BusyCompleteness = SchedulePreview['busyFreshness']['completeness'];
type UnscheduledReason = SchedulePreview['unscheduled'][number]['reasonCode'];
type WarningCode = SchedulePreview['warnings'][number]['code'];
type PreviewBlockType = PreviewChange['after']['type'];
type PreviewChangeReason = PreviewChange['after']['changeReason'];

const busyCompletenessCopy: Record<BusyCompleteness, string> = {
  complete: '完整',
  partial: '部分可用',
  missing: '缺失',
  not_configured: '未配置',
};

const blockTypeCopy: Record<PreviewBlockType, string> = {
  task: '任务时间',
  break: '休息',
  relax: '放松',
  buffer: '缓冲时间',
};

const blockStatusCopy: Record<TimeBlock['status'], string> = {
  planned: '计划中',
  started: '进行中',
  completed: '已完成',
  skipped: '已跳过',
  canceled: '已取消',
};

const unscheduledReasonCopy: Record<UnscheduledReason, string> = {
  missing_duration: '任务缺少预计用时，补充后才能安排。',
  remaining_estimate_required:
    '已记录用时达到原估时；未完成任务需要新的剩余用时。',
  insufficient_time: '当前排程范围或工作时间不足，无法安排全部剩余用时。',
  deadline_infeasible: '截止时间前没有足够可用时间安排全部剩余用时。',
  unsupported_dependency: '当前排程器暂不支持此任务的依赖关系。',
};

const scheduleWarningCopy: Record<WarningCode, string> = {
  protected_busy_conflict: '受保护时间块与忙碌日历冲突，系统已保留该时间块。',
  protected_block_conflict: '受保护时间块彼此重叠，系统已保留这些时间块。',
  protected_outside_working_window:
    '受保护时间块位于工作时间之外，系统已保留该时间块。',
  protected_task_constraint_conflict:
    '受保护时间块不符合任务时间约束，系统已保留该时间块。',
  protected_commitment_exceeds_remaining:
    '受保护的未来时间超过任务剩余估时，系统未自动改写这些时间块。',
  orphan_existing_block_preserved:
    '已有时间块没有可排程任务，系统已保留它而未自动修改。',
  existing_block_omitted:
    '一个未锁定的已有时间块不在候选计划中；提交后可能会取消。',
  partial_schedule: '只能安排部分已知剩余用时。',
  deadline_risk: '截止时间前无法安排全部已知剩余用时。',
};

const previewChangeReasonCopy: Record<PreviewChangeReason, string> = {
  protected_existing: '这是受保护时间块，候选计划不会自动移动它。',
  preserved_existing: '候选计划保留了已有时间块。',
  moved_existing: '候选计划移动了这个未受保护的时间块。',
  resized_existing: '候选计划调整了这个未受保护时间块的长度。',
  moved_and_resized_existing:
    '候选计划同时移动并调整了这个未受保护时间块的长度。',
  new_allocation: '这是根据当前可用时间和任务约束生成的新时间块。',
  removed_by_plan: '候选计划不再保留这个未锁定的未来时间块。',
};

export function formatInstantTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

export function formatInstantDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(instant));
}

export function formatRange(
  startAt: string,
  endAt: string,
  timeZone: string,
): string {
  return `${formatInstantTime(startAt, timeZone)}–${formatInstantTime(endAt, timeZone)}`;
}

export function formatDatedRange(
  startAt: string,
  endAt: string,
  timeZone: string,
): string {
  const startDate = formatInstantDate(startAt, timeZone);
  const endDate = formatInstantDate(endAt, timeZone);
  if (startDate === endDate) {
    return `${startDate} · ${formatRange(startAt, endAt, timeZone)}`;
  }
  return `${startDate} ${formatInstantTime(startAt, timeZone)} → ${endDate} ${formatInstantTime(endAt, timeZone)}`;
}

export function durationMinutes(startAt: string, endAt: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(endAt) - Date.parse(startAt)) / minuteMs),
  );
}

export function formatMinuteEstimate(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new TypeError(
      'Minute estimate must be a finite non-negative number.',
    );
  }
  if (minutes === 0) return '0 分钟';
  if (minutes < 1) return '少于 1 分钟';
  if (Number.isInteger(minutes)) return `${minutes} 分钟`;
  return `约 ${Math.round(minutes)} 分钟`;
}

export function shiftLocalDate(localDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new TypeError('localDate must use YYYY-MM-DD.');
  }
  if (!Number.isSafeInteger(days)) {
    throw new TypeError('days must be a safe integer.');
  }
  const [year, month, day] = localDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
}

export function localWeekDates(localDate: string): readonly string[] {
  const canonicalDate = shiftLocalDate(localDate, 0);
  if (canonicalDate !== localDate) {
    throw new TypeError('localDate must be a valid calendar date.');
  }
  const [year, month, day] = localDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const mondayOffset = -(weekday === 0 ? 6 : weekday - 1);
  const monday = shiftLocalDate(localDate, mondayOffset);
  return Array.from({ length: 7 }, (_, index) => shiftLocalDate(monday, index));
}

export function isFuturePlannedTimeBlock(
  block: Readonly<{ startAt: string; status: TimeBlock['status'] }>,
  nowMs: number,
): boolean {
  const startMs = Date.parse(block.startAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) {
    throw new TypeError('TimeBlock comparison requires finite timestamps.');
  }
  return block.status === 'planned' && startMs > nowMs;
}

export function shouldShowMindfulTransition(input: {
  requested: boolean;
  enabled: boolean;
  sessionStatus: ExecutionSession['status'];
}): boolean {
  return input.requested && input.enabled && input.sessionStatus === 'running';
}

export function focusTransitionRemainingSeconds(
  endsAtMs: number,
  nowMs: number,
): number {
  if (!Number.isFinite(endsAtMs) || !Number.isFinite(nowMs)) {
    throw new TypeError('Focus transition requires finite timestamps.');
  }
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1_000));
}

export function userFacingError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    switch (error.code) {
      case 'scheduling_setup_required':
        return '请先设置时区、工作时间和日历范围，再生成排程。';
      case 'preview_expired':
      case 'preview_not_found':
      case 'plan_conflict':
        return '计划条件已经变化，请重新生成预览。原计划没有被修改。';
      case 'permission_required':
        return '需要你明确授权后才能继续；本地计划仍可使用。';
      case 'validation_error':
        return '输入有误，请检查后重试。';
      case 'invalid_transition':
        return '当前状态不允许这次调整，请刷新计划后重试。';
      case 'provider_error':
      case 'provider_timeout':
      case 'adapter_error':
        return '系统服务暂时不可用；本地计划没有丢失。';
    }
  }
  return '操作没有完成，请稍后重试。';
}

export function persistedTaskPreviewError(
  error: unknown,
  change: 'created' | 'updated',
): string {
  const persistedCopy =
    change === 'created' ? '任务已保存在本机' : '任务修改已保存在本机';
  return `${persistedCopy}，但排程预览尚未生成。${userFacingError(error)}`;
}

export function schedulePreviewSummary(
  changes: readonly Pick<PreviewChange, 'kind'>[],
): string {
  const counts = { create: 0, update: 0, cancel: 0 };
  for (const change of changes) counts[change.kind] += 1;
  return `新增 ${counts.create} 个、调整 ${counts.update} 个、取消 ${counts.cancel} 个时间块`;
}

export function busyCompletenessLabel(value: BusyCompleteness): string {
  return busyCompletenessCopy[value];
}

export function previewBlockTypeLabel(value: PreviewBlockType): string {
  return blockTypeCopy[value];
}

export function timeBlockTypeLabel(value: TimeBlock['type']): string {
  return blockTypeCopy[value];
}

export function timeBlockStatusLabel(value: TimeBlock['status']): string {
  return blockStatusCopy[value];
}

export function unscheduledReasonLabel(
  reason: UnscheduledReason,
  remainingMinutes?: number,
): string {
  const remaining =
    remainingMinutes === undefined
      ? ''
      : ` 仍有约 ${Math.round(remainingMinutes)} 分钟未安排。`;
  return `${unscheduledReasonCopy[reason]}${remaining}`;
}

export function scheduleWarningLabel(code: WarningCode): string {
  return scheduleWarningCopy[code];
}

export function previewChangeReasonLabel(reason: PreviewChangeReason): string {
  return previewChangeReasonCopy[reason];
}

export function previewDeadlineLabel(
  warnings: readonly Pick<SchedulePreview['warnings'][number], 'code'>[],
): string {
  return warnings.some((warning) => warning.code === 'deadline_risk')
    ? '存在无法在截止时间前完成的风险。'
    : '当前预览没有报告截止时间不足。';
}
