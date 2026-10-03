import {
  assertValidTask,
  assertValidTimeBlock,
  parseInstant,
  parseLocalDate,
  parseTimeZoneId,
  type CompletionRecord,
  type Instant,
  type LocalDate,
  type Task,
  type TimeBlock,
  type TimeZoneId,
} from '@workspace/domain';
import { z } from 'zod';

import {
  calendarBusySourcesPreferenceKey,
  calendarBusySourcesPreferenceValueSchema,
} from './preference-schemas';
import type {
  ApplicationTransaction,
  ApplicationUnitOfWork,
  Clock,
  LocalTimeProvider,
} from './ports';
import type { BusySnapshotScope, ScheduleTimeRange } from './schedule-ports';
import type { IntegrationState } from './integration-service';
import {
  dataIntegrityError,
  parseBoundaryInput,
  protectApplicationCall,
  readClock,
  requireScheduleState,
  resolveLocalTime,
} from './service-support';

export interface LocalDayRangePort {
  dayRange(
    input: Readonly<{
      localDate: LocalDate;
      timeZone: TimeZoneId;
    }>,
  ): Promise<ScheduleTimeRange>;
}

export interface IntegrationStateReader {
  getCurrentStatus(): Promise<IntegrationState>;
}

export type PlanningQueryDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
  localTime: LocalTimeProvider;
  days: LocalDayRangePort;
  integrations: IntegrationStateReader;
}>;

export type TaskSummary = Readonly<{
  id: string;
  title: string;
  status: Task['status'];
  remainingMinutes: number | null;
  deadlineAt: Instant | null;
}>;

export type TimeBlockSummary = Readonly<{
  id: string;
  taskId: string | null;
  type: TimeBlock['type'];
  startAt: Instant;
  endAt: Instant;
  status: TimeBlock['status'];
  locked: boolean;
  task: TaskSummary | null;
}>;

export type TodayNow =
  | Readonly<{
      kind: 'current_block';
      block: TimeBlockSummary;
      remainingMinutes: number;
    }>
  | Readonly<{
      kind: 'candidate_task';
      task: TaskSummary;
      action: 'schedule';
    }>
  | Readonly<{
      kind: 'empty';
      reason:
        | 'no_tasks'
        | 'missing_duration'
        | 'not_yet_available'
        | 'no_current_or_executable_task';
    }>;

export type TodayWin = Readonly<{
  completionRecordId: string;
  taskId: string;
  title: string;
  completedAt: Instant;
  actualDurationSeconds: number | null;
  durationCoverage: CompletionRecord['durationCoverage'];
}>;

export type CalendarFreshness = Readonly<{
  status:
    'setup_required' | 'not_configured' | 'complete' | 'partial' | 'missing';
  capturedAt: Instant | null;
  scopes: readonly BusySnapshotScope[];
}>;

export type DayTimelineBusyItem = Readonly<{
  id: string;
  startAt: Instant;
  endAt: Instant;
}>;

export type DayTimelineView = Readonly<{
  localDate: LocalDate;
  timeZone: TimeZoneId;
  range: ScheduleTimeRange;
  stateVersion: number;
  planRevision: number;
  blocks: readonly TimeBlockSummary[];
  busy: readonly DayTimelineBusyItem[];
  calendarFreshness: CalendarFreshness;
  integration: IntegrationState;
}>;

export type TodayView = DayTimelineView &
  Readonly<{
    now: Instant;
    nowCard: TodayNow;
    next: readonly TimeBlockSummary[];
    wins: readonly TodayWin[];
  }>;

const dayRequestSchema = z
  .object({
    localDate: z.string().trim().min(1),
    timeZone: z.string().trim().min(1),
  })
  .strict();

type DayFacts = Readonly<{
  stateVersion: number;
  planRevision: number;
  blocks: readonly TimeBlock[];
  activeTasks: readonly Task[];
  taskById: ReadonlyMap<string, Task>;
  wins: readonly CompletionRecord[];
  busy: readonly DayTimelineBusyItem[];
  calendarFreshness: CalendarFreshness;
}>;

function remainingMinutes(task: Task): number | null {
  if (task.remainingDurationMinutes !== null) {
    return task.remainingDurationMinutes;
  }
  if (task.estimatedDurationMinutes === null) return null;
  return Math.max(
    0,
    task.estimatedDurationMinutes - (task.actualDurationMinutes ?? 0),
  );
}

function taskSummary(task: Task): TaskSummary {
  assertValidTask(task);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    remainingMinutes: remainingMinutes(task),
    deadlineAt: task.deadlineAt,
  };
}

function blockSummary(
  block: TimeBlock,
  taskById: ReadonlyMap<string, Task>,
): TimeBlockSummary {
  assertValidTimeBlock(block);
  const task =
    block.taskId === null ? null : (taskById.get(block.taskId) ?? null);
  if (block.type === 'task' && task === null) {
    throw dataIntegrityError('A TimeBlock references a missing Task.');
  }
  return {
    id: block.id,
    taskId: block.taskId,
    type: block.type,
    startAt: block.startAt,
    endAt: block.endAt,
    status: block.status,
    locked: block.locked,
    task: task === null ? null : taskSummary(task),
  };
}

function ownedIdentity(value: {
  provider: string;
  calendarId: string;
  externalEventId: string;
  occurrenceKey: string | null;
}): string {
  return JSON.stringify([
    value.provider,
    value.calendarId,
    value.externalEventId,
    value.occurrenceKey,
  ]);
}

function freshness(
  scopes: readonly BusySnapshotScope[],
  configured: boolean,
): CalendarFreshness {
  if (!configured) {
    return { status: 'setup_required', capturedAt: null, scopes: [] };
  }
  if (scopes.length === 0) {
    return { status: 'not_configured', capturedAt: null, scopes: [] };
  }
  const captured = scopes.flatMap((scope) =>
    scope.capturedAt === null ? [] : [scope.capturedAt],
  );
  const capturedAt =
    captured.length === scopes.length
      ? captured.reduce((oldest, value) =>
          Date.parse(value) < Date.parse(oldest) ? value : oldest,
        )
      : null;
  const status = scopes.every((scope) => scope.completeness === 'complete')
    ? 'complete'
    : scopes.some((scope) => scope.completeness === 'partial')
      ? 'partial'
      : 'missing';
  return { status, capturedAt, scopes };
}

async function readDayFacts(
  transaction: ApplicationTransaction,
  range: ScheduleTimeRange,
): Promise<DayFacts> {
  const [state, blocks, activeTasks, wins, sourcePreference, bindings] =
    await Promise.all([
      requireScheduleState(transaction),
      transaction.timeBlocks.listOverlapping(range.start, range.end),
      transaction.tasks.listActive(),
      transaction.completionRecords.listCompletedBetween(
        range.start,
        range.end,
      ),
      transaction.userPreferences.findByKey(calendarBusySourcesPreferenceKey),
      transaction.calendarBindings.listAll(),
    ]);
  const taskById = new Map(activeTasks.map((task) => [task.id, task]));
  for (const block of blocks) {
    if (block.taskId === null || taskById.has(block.taskId)) continue;
    const task = await transaction.tasks.findById(block.taskId);
    if (task !== null) taskById.set(task.id, task);
  }
  const parsedSources = calendarBusySourcesPreferenceValueSchema.safeParse(
    sourcePreference?.valueJson,
  );
  const sources = parsedSources.success
    ? parsedSources.data.sources.filter((source) => source.enabled)
    : [];
  const owned = new Set(
    bindings.filter((binding) => binding.ownershipVerified).map(ownedIdentity),
  );
  const busy: DayTimelineBusyItem[] = [];
  const scopes: BusySnapshotScope[] = [];
  for (const source of sources.sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.calendarId.localeCompare(right.calendarId),
  )) {
    const scope = {
      provider: source.provider,
      calendarId: source.calendarId,
      rangeStart: range.start,
      rangeEnd: range.end,
    };
    const [snapshots, coverage] = await Promise.all([
      transaction.externalCalendarEventSnapshots.listOverlapping(scope),
      transaction.calendarRefreshCoverages.findLatestCovering(scope),
    ]);
    const partialCapturedAt = snapshots.reduce<Instant | null>(
      (latest, snapshot) =>
        latest === null || Date.parse(snapshot.lastSeenAt) > Date.parse(latest)
          ? snapshot.lastSeenAt
          : latest,
      null,
    );
    scopes.push({
      provider: source.provider,
      calendarId: source.calendarId,
      capturedAt: coverage?.fetchedAt ?? partialCapturedAt,
      completeness:
        coverage !== null
          ? 'complete'
          : partialCapturedAt === null
            ? 'missing'
            : 'partial',
    });
    for (const snapshot of snapshots) {
      if (!snapshot.busy || owned.has(ownedIdentity(snapshot))) continue;
      busy.push({
        id: snapshot.id,
        startAt: snapshot.startAt,
        endAt: snapshot.endAt,
      });
    }
  }
  return {
    stateVersion: state.stateVersion,
    planRevision: state.planRevision,
    blocks,
    activeTasks,
    taskById,
    wins,
    busy: busy.sort(
      (left, right) =>
        left.startAt.localeCompare(right.startAt) ||
        left.endAt.localeCompare(right.endAt) ||
        left.id.localeCompare(right.id),
    ),
    calendarFreshness: freshness(scopes, parsedSources.success),
  };
}

function isVisibleBlock(block: TimeBlock): boolean {
  return block.status !== 'canceled' && block.status !== 'skipped';
}

function nowCard(
  facts: DayFacts,
  summaries: readonly TimeBlockSummary[],
  now: Instant,
): TodayNow {
  const nowMs = Date.parse(now);
  const current = summaries
    .filter(
      (block) =>
        (block.status === 'planned' || block.status === 'started') &&
        Date.parse(block.startAt) <= nowMs &&
        Date.parse(block.endAt) > nowMs,
    )
    .sort(
      (left, right) =>
        Number(right.status === 'started') -
          Number(left.status === 'started') ||
        left.startAt.localeCompare(right.startAt) ||
        left.id.localeCompare(right.id),
    )[0];
  if (current !== undefined) {
    return {
      kind: 'current_block',
      block: current,
      remainingMinutes: Math.max(
        0,
        Math.ceil((Date.parse(current.endAt) - nowMs) / 60_000),
      ),
    };
  }

  const candidates = facts.activeTasks
    .filter((task) =>
      task.earliestStartAt === null
        ? true
        : Date.parse(task.earliestStartAt) <= nowMs,
    )
    .filter((task) => (remainingMinutes(task) ?? 0) > 0)
    .sort(
      (left, right) =>
        (left.deadlineAt ?? '9999').localeCompare(right.deadlineAt ?? '9999') ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  if (candidates[0] !== undefined) {
    return {
      kind: 'candidate_task',
      task: taskSummary(candidates[0]),
      action: 'schedule',
    };
  }
  if (facts.activeTasks.length === 0) {
    return { kind: 'empty', reason: 'no_tasks' };
  }
  if (facts.activeTasks.every((task) => remainingMinutes(task) === null)) {
    return { kind: 'empty', reason: 'missing_duration' };
  }
  if (
    facts.activeTasks.every(
      (task) =>
        task.earliestStartAt !== null &&
        Date.parse(task.earliestStartAt) > nowMs,
    )
  ) {
    return { kind: 'empty', reason: 'not_yet_available' };
  }
  return { kind: 'empty', reason: 'no_current_or_executable_task' };
}

export class PlanningQueryService {
  readonly #dependencies: PlanningQueryDependencies;

  constructor(dependencies: PlanningQueryDependencies) {
    this.#dependencies = dependencies;
  }

  getToday(): Promise<TodayView> {
    return protectApplicationCall(undefined, async () => {
      const now = readClock(this.#dependencies.clock);
      const local = resolveLocalTime(this.#dependencies.localTime, now);
      const base = await this.#getDay(local.localDate, local.timeZone);
      const { facts, ...view } = base;
      const summaries = base.blocks;
      return {
        ...view,
        now,
        nowCard: nowCard(facts, summaries, now),
        next: summaries
          .filter(
            (block) =>
              block.status === 'planned' &&
              Date.parse(block.startAt) > Date.parse(now),
          )
          .slice(0, 3),
        wins: facts.wins.map((record) => ({
          completionRecordId: record.id,
          taskId: record.taskId,
          title: record.taskTitleSnapshot,
          completedAt: record.completedAt,
          actualDurationSeconds: record.actualDurationSeconds,
          durationCoverage: record.durationCoverage,
        })),
      };
    });
  }

  getDayTimeline(input: {
    localDate: string;
    timeZone: string;
  }): Promise<DayTimelineView> {
    return protectApplicationCall(undefined, async () => {
      const parsed = parseBoundaryInput(
        dayRequestSchema,
        input,
        'Day timeline request',
      );
      const result = await this.#getDay(
        parseLocalDate(parsed.localDate),
        parseTimeZoneId(parsed.timeZone),
      );
      const { facts: _facts, ...view } = result;
      return view;
    });
  }

  async #getDay(localDate: LocalDate, timeZone: TimeZoneId) {
    const rawRange = await this.#dependencies.days.dayRange({
      localDate,
      timeZone,
    });
    const range = {
      start: parseInstant(rawRange.start),
      end: parseInstant(rawRange.end),
    };
    if (Date.parse(range.end) <= Date.parse(range.start)) {
      throw dataIntegrityError('Local day adapter returned an invalid range.');
    }
    const [facts, integration] = await Promise.all([
      this.#dependencies.unitOfWork.transaction((transaction) =>
        readDayFacts(transaction, range),
      ),
      this.#dependencies.integrations.getCurrentStatus(),
    ]);
    const blocks = facts.blocks
      .filter(isVisibleBlock)
      .map((block) => blockSummary(block, facts.taskById));
    return {
      localDate,
      timeZone,
      range,
      stateVersion: facts.stateVersion,
      planRevision: facts.planRevision,
      blocks,
      busy: facts.busy,
      calendarFreshness: facts.calendarFreshness,
      integration,
      facts,
    };
  }
}
