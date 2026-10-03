import type {
  Instant,
  TaskId,
  TimeBlockId,
  TimeBlockStatus,
  TimeBlockType,
  TimeZoneId,
} from '@workspace/domain';
import type {
  ProposedBlockChangeReason,
  ScheduleResult,
  ScheduleWarning,
  UnscheduledTask,
} from '@workspace/scheduler-core';

import type {
  BusySnapshot,
  ScheduleTimeRange,
  SchedulingSnapshot,
} from './schedule-ports';

export type SchedulePreviewRequest = Readonly<{
  reason: string;
  taskIds?: readonly string[];
  timeRange?: Readonly<{ start: string; end: string }>;
}>;

export type NormalizedSchedulePreviewRequest = Readonly<{
  reason: string;
  taskIds: readonly TaskId[] | null;
  timeRange: ScheduleTimeRange | null;
}>;

export type PlanBlockCandidate = Readonly<{
  stableKey: string;
  timeBlockId: TimeBlockId | null;
  taskId: TaskId | null;
  /** Snapshot title for review UI; never used as commit authority. */
  taskTitle: string | null;
  type: TimeBlockType;
  startAt: Instant;
  endAt: Instant;
  status: TimeBlockStatus;
  locked: boolean;
  changeReason: ProposedBlockChangeReason | 'removed_by_plan';
}>;

export type PlanChange =
  | Readonly<{
      kind: 'create';
      stableKey: string;
      before: null;
      after: PlanBlockCandidate;
    }>
  | Readonly<{
      kind: 'update';
      stableKey: string;
      timeBlockId: TimeBlockId;
      before: PlanBlockCandidate;
      after: PlanBlockCandidate;
    }>
  | Readonly<{
      kind: 'cancel';
      stableKey: string;
      timeBlockId: TimeBlockId;
      before: PlanBlockCandidate;
      after: PlanBlockCandidate;
    }>;

export type ScheduleRiskAssessment = Readonly<{
  autoCommitEligible: false;
  requiresExplicitConfirmation: true;
  changedBlockCount: number;
  hasBlockingWarnings: boolean;
}>;

export type SchedulePreviewUnscheduledTask = UnscheduledTask &
  Readonly<{ taskTitle: string }>;

export type SchedulePreviewWarning = ScheduleWarning &
  Readonly<{ entityTitle: string | null }>;

export type SchedulePreview = Readonly<{
  previewId: string;
  basedOnStateVersion: number;
  basedOnPlanRevision: number;
  inputHash: string;
  schedulerVersion: string;
  policyVersion: string;
  createdAt: Instant;
  expiresAt: Instant;
  timeZone: TimeZoneId;
  busyFreshness: Pick<BusySnapshot, 'capturedAt' | 'completeness' | 'scopes'>;
  changedBlocks: readonly PlanChange[];
  unscheduled: readonly SchedulePreviewUnscheduledTask[];
  warnings: readonly SchedulePreviewWarning[];
  summary: string;
  riskAssessment: ScheduleRiskAssessment;
}>;

export type SchedulePreviewMode = 'preview' | 'replan';

/** Full trusted candidate retained only in process memory. */
export type StoredSchedulePreview = Readonly<{
  preview: SchedulePreview;
  mode: SchedulePreviewMode;
  request: NormalizedSchedulePreviewRequest;
  snapshot: SchedulingSnapshot;
  result: ScheduleResult;
}>;

export type ScheduleCommitInput = Readonly<{
  previewId: string;
  expectedStateVersion: number;
}>;

export type IntegrationStatus =
  | 'synced'
  | 'pending'
  | 'permission_required'
  | 'failed'
  | 'disabled'
  | 'reconciliation_required'
  | 'superseded';

export type ScheduleCommitResult = Readonly<{
  operationId: string;
  local: 'committed';
  planRevision: number;
  stateVersion: number;
  calendar: IntegrationStatus;
  notifications: IntegrationStatus;
}>;
