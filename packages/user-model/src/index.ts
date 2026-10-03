import {
  assertValidCompletionRecord,
  assertValidExecutionInterval,
  assertValidExecutionSession,
  assertValidTask,
  assertValidTaskActivityEvent,
  assertValidTimeBlock,
  parseInstant,
  requireNonEmptyString,
  type CompletionRecord,
  type ExecutionInterval,
  type ExecutionSession,
  type Instant,
  type Task,
  type TaskActivityEvent,
  type TimeBlock,
} from '@workspace/domain';

export const USER_MODEL_FEATURE_KEYS = {
  estimateBias: 'estimate_bias',
  hourlyCompletionRate: 'completion_rate_hour',
  meanSessionMinutes: 'mean_session_minutes',
  medianSessionMinutes: 'median_session_minutes',
  postponeSkipFrequency: 'postpone_skip_frequency',
  splitBlockCompletionRate: 'split_block_completion_rate',
} as const;

export type UserModelFeatureFamily =
  | 'estimateBias'
  | 'hourlyCompletionRate'
  | 'sessionLength'
  | 'postponeSkipFrequency'
  | 'splitBlockCompletionRate';

export type UserModelConfidencePolicy = Readonly<
  Record<UserModelFeatureFamily, number>
>;

export type UserModelBuildPolicy = Readonly<{
  algorithmVersion: string;
  estimateBiasStatistic: 'mean' | 'median';
  confidenceFullSampleCounts: UserModelConfidencePolicy;
}>;

export type UserModelTimeBlockFact = Readonly<{
  block: TimeBlock;
  plannedLocalHour: number | null;
  explicitUserSkip: boolean;
}>;

export type UserModelSessionFact = Readonly<{
  session: ExecutionSession;
  intervals: readonly ExecutionInterval[];
}>;

export type UserModelFactSnapshot = Readonly<{
  window: Readonly<{ start: Instant; end: Instant }>;
  tasks: readonly Task[];
  completionRecords: readonly CompletionRecord[];
  timeBlocks: readonly UserModelTimeBlockFact[];
  sessions: readonly UserModelSessionFact[];
  activityEvents: readonly TaskActivityEvent[];
}>;

export type ComputedUserModelFeature = Readonly<{
  featureKey: string;
  scopeKey: string | null;
  numericValue: number;
  sampleCount: number;
  confidence: number;
}>;

export type UserModelExclusions = Readonly<{
  estimateBias: number;
  hourlyCompletionRate: number;
  sessionLength: number;
  postponeSkipFrequency: number;
  splitBlockCompletionRate: number;
}>;

export type UserModelBuildResult = Readonly<{
  algorithmVersion: string;
  window: Readonly<{ start: Instant; end: Instant }>;
  features: readonly ComputedUserModelFeature[];
  exclusions: UserModelExclusions;
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inWindow(
  instant: Instant,
  window: UserModelFactSnapshot['window'],
): boolean {
  const value = Date.parse(instant);
  return value >= Date.parse(window.start) && value < Date.parse(window.end);
}

function validatePolicy(policy: UserModelBuildPolicy): void {
  requireNonEmptyString(policy.algorithmVersion, 'algorithmVersion');
  if (
    policy.estimateBiasStatistic !== 'mean' &&
    policy.estimateBiasStatistic !== 'median'
  ) {
    throw new RangeError('estimateBiasStatistic is unsupported.');
  }
  const families: readonly UserModelFeatureFamily[] = [
    'estimateBias',
    'hourlyCompletionRate',
    'sessionLength',
    'postponeSkipFrequency',
    'splitBlockCompletionRate',
  ];
  if (
    typeof policy.confidenceFullSampleCounts !== 'object' ||
    policy.confidenceFullSampleCounts === null ||
    Object.keys(policy.confidenceFullSampleCounts).length !== families.length ||
    Object.keys(policy.confidenceFullSampleCounts).some(
      (key) => !families.includes(key as UserModelFeatureFamily),
    )
  ) {
    throw new RangeError(
      'confidenceFullSampleCounts must define exactly every feature family.',
    );
  }
  for (const family of families) {
    const count = policy.confidenceFullSampleCounts[family];
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new RangeError(
        `confidenceFullSampleCounts.${family} must be a positive safe integer.`,
      );
    }
  }
}

function validateSnapshot(snapshot: UserModelFactSnapshot): void {
  const start = parseInstant(snapshot.window.start);
  const end = parseInstant(snapshot.window.end);
  if (Date.parse(start) >= Date.parse(end)) {
    throw new RangeError('User Model observation window must be non-empty.');
  }
  const taskIds = new Set<string>();
  for (const task of snapshot.tasks) {
    assertValidTask(task);
    if (taskIds.has(task.id)) throw new Error(`Duplicate Task ${task.id}.`);
    taskIds.add(task.id);
  }
  const completionIds = new Set<string>();
  for (const record of snapshot.completionRecords) {
    assertValidCompletionRecord(record);
    if (completionIds.has(record.id)) {
      throw new Error(`Duplicate CompletionRecord ${record.id}.`);
    }
    completionIds.add(record.id);
  }
  const blockIds = new Set<string>();
  for (const fact of snapshot.timeBlocks) {
    assertValidTimeBlock(fact.block);
    if (blockIds.has(fact.block.id)) {
      throw new Error(`Duplicate TimeBlock ${fact.block.id}.`);
    }
    blockIds.add(fact.block.id);
    if (
      fact.plannedLocalHour !== null &&
      (!Number.isInteger(fact.plannedLocalHour) ||
        fact.plannedLocalHour < 0 ||
        fact.plannedLocalHour > 23)
    ) {
      throw new RangeError('plannedLocalHour must be an integer from 0 to 23.');
    }
  }
  const sessionIds = new Set<string>();
  for (const fact of snapshot.sessions) {
    assertValidExecutionSession(fact.session);
    if (sessionIds.has(fact.session.id)) {
      throw new Error(`Duplicate ExecutionSession ${fact.session.id}.`);
    }
    sessionIds.add(fact.session.id);
    const intervalIds = new Set<string>();
    for (const interval of fact.intervals) {
      assertValidExecutionInterval(interval);
      if (interval.sessionId !== fact.session.id) {
        throw new Error('ExecutionInterval belongs to another Session.');
      }
      if (intervalIds.has(interval.id)) {
        throw new Error(`Duplicate ExecutionInterval ${interval.id}.`);
      }
      intervalIds.add(interval.id);
    }
  }
  const eventIds = new Set<string>();
  for (const event of snapshot.activityEvents) {
    assertValidTaskActivityEvent(event);
    if (eventIds.has(event.id)) {
      throw new Error(`Duplicate TaskActivityEvent ${event.id}.`);
    }
    eventIds.add(event.id);
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function aggregate(
  values: readonly number[],
  statistic: 'mean' | 'median',
): number {
  return statistic === 'mean' ? mean(values) : median(values);
}

function confidence(sampleCount: number, fullAt: number): number {
  return Math.min(1, sampleCount / fullAt);
}

function feature(
  family: UserModelFeatureFamily,
  policy: UserModelBuildPolicy,
  input: Omit<ComputedUserModelFeature, 'confidence'>,
): ComputedUserModelFeature {
  return {
    ...input,
    confidence: confidence(
      input.sampleCount,
      policy.confidenceFullSampleCounts[family],
    ),
  };
}

function recordedWorkSeconds(fact: UserModelSessionFact): number | null {
  if (
    fact.session.endedAt === null ||
    (fact.session.status !== 'completed' &&
      fact.session.status !== 'abandoned') ||
    fact.intervals.length === 0 ||
    fact.intervals.some(
      (interval) =>
        interval.endAt === null || interval.timingQuality !== 'trusted',
    )
  ) {
    return null;
  }
  const work = fact.intervals.filter((interval) => interval.kind === 'work');
  if (work.length === 0) return null;
  return work.reduce(
    (seconds, interval) =>
      seconds +
      Math.max(
        0,
        (Date.parse(interval.endAt!) - Date.parse(interval.startAt)) / 1_000,
      ),
    0,
  );
}

/**
 * Rebuilds behavior-only statistics from an explicit fact snapshot. The
 * caller supplies every undecided statistical parameter; this function has no
 * ambient clock, time-zone lookup, storage, or production tuning default.
 */
export function buildUserModelFeatures(
  snapshot: UserModelFactSnapshot,
  policy: UserModelBuildPolicy,
): UserModelBuildResult {
  validatePolicy(policy);
  validateSnapshot(snapshot);

  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const features: ComputedUserModelFeature[] = [];

  const estimateGroups = new Map<string, number[]>();
  let excludedEstimateBias = 0;
  for (const record of snapshot.completionRecords) {
    const task = tasks.get(record.taskId);
    if (
      !inWindow(record.completedAt, snapshot.window) ||
      task === undefined ||
      task.categoryKey === null ||
      task.baselineEstimatedDurationMinutes === null ||
      record.durationCoverage !== 'complete' ||
      record.actualDurationSeconds === null
    ) {
      excludedEstimateBias += 1;
      continue;
    }
    const values = estimateGroups.get(task.categoryKey) ?? [];
    values.push(
      record.actualDurationSeconds /
        (task.baselineEstimatedDurationMinutes * 60) -
        1,
    );
    estimateGroups.set(task.categoryKey, values);
  }
  for (const [scopeKey, values] of [...estimateGroups].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    features.push(
      feature('estimateBias', policy, {
        featureKey: USER_MODEL_FEATURE_KEYS.estimateBias,
        scopeKey,
        numericValue: aggregate(values, policy.estimateBiasStatistic),
        sampleCount: values.length,
      }),
    );
  }

  const hourly = new Map<number, { completed: number; total: number }>();
  let excludedHourly = 0;
  const decidableBlocks: UserModelTimeBlockFact[] = [];
  for (const fact of snapshot.timeBlocks) {
    const { block } = fact;
    const eligibleStatus =
      block.status === 'completed' ||
      (block.status === 'skipped' && fact.explicitUserSkip);
    if (
      block.type !== 'task' ||
      block.taskId === null ||
      !inWindow(block.updatedAt, snapshot.window) ||
      fact.plannedLocalHour === null ||
      !eligibleStatus
    ) {
      excludedHourly += 1;
      continue;
    }
    decidableBlocks.push(fact);
    const current = hourly.get(fact.plannedLocalHour) ?? {
      completed: 0,
      total: 0,
    };
    current.total += 1;
    if (block.status === 'completed') current.completed += 1;
    hourly.set(fact.plannedLocalHour, current);
  }
  for (const [hour, counts] of [...hourly].sort(
    ([left], [right]) => left - right,
  )) {
    features.push(
      feature('hourlyCompletionRate', policy, {
        featureKey: USER_MODEL_FEATURE_KEYS.hourlyCompletionRate,
        scopeKey: `hour_${hour.toString().padStart(2, '0')}`,
        numericValue: counts.completed / counts.total,
        sampleCount: counts.total,
      }),
    );
  }

  const sessionMinutes: number[] = [];
  let excludedSessionLength = 0;
  for (const sessionFact of snapshot.sessions) {
    const seconds = recordedWorkSeconds(sessionFact);
    if (
      sessionFact.session.endedAt === null ||
      !inWindow(sessionFact.session.endedAt, snapshot.window) ||
      seconds === null
    ) {
      excludedSessionLength += 1;
      continue;
    }
    sessionMinutes.push(seconds / 60);
  }
  if (sessionMinutes.length > 0) {
    for (const [featureKey, numericValue] of [
      [USER_MODEL_FEATURE_KEYS.meanSessionMinutes, mean(sessionMinutes)],
      [USER_MODEL_FEATURE_KEYS.medianSessionMinutes, median(sessionMinutes)],
    ] as const) {
      features.push(
        feature('sessionLength', policy, {
          featureKey,
          scopeKey: null,
          numericValue,
          sampleCount: sessionMinutes.length,
        }),
      );
    }
  }

  const explicitUserActions = snapshot.activityEvents.filter(
    (event) =>
      inWindow(event.occurredAt, snapshot.window) &&
      event.actor === 'user' &&
      (event.eventType === 'postpone' || event.eventType === 'skip'),
  );
  const observedActivityCount = snapshot.activityEvents.filter((event) =>
    inWindow(event.occurredAt, snapshot.window),
  ).length;
  if (decidableBlocks.length > 0) {
    features.push(
      feature('postponeSkipFrequency', policy, {
        featureKey: USER_MODEL_FEATURE_KEYS.postponeSkipFrequency,
        scopeKey: null,
        numericValue: explicitUserActions.length / decidableBlocks.length,
        sampleCount: decidableBlocks.length,
      }),
    );
  }

  const splitTaskIds = new Set(
    snapshot.tasks.filter((task) => task.splittable).map((task) => task.id),
  );
  const splitBlocks = snapshot.timeBlocks.filter(
    ({ block }) =>
      block.type === 'task' &&
      block.taskId !== null &&
      splitTaskIds.has(block.taskId) &&
      inWindow(block.updatedAt, snapshot.window) &&
      (block.status === 'completed' || block.status === 'skipped'),
  );
  if (splitBlocks.length > 0) {
    const completed = splitBlocks.filter(
      ({ block }) => block.status === 'completed',
    ).length;
    features.push(
      feature('splitBlockCompletionRate', policy, {
        featureKey: USER_MODEL_FEATURE_KEYS.splitBlockCompletionRate,
        scopeKey: null,
        numericValue: completed / splitBlocks.length,
        sampleCount: splitBlocks.length,
      }),
    );
  }

  return {
    algorithmVersion: requireNonEmptyString(
      policy.algorithmVersion,
      'algorithmVersion',
    ),
    window: {
      start: parseInstant(snapshot.window.start),
      end: parseInstant(snapshot.window.end),
    },
    features: features.sort(
      (left, right) =>
        compareText(left.featureKey, right.featureKey) ||
        compareText(left.scopeKey ?? '', right.scopeKey ?? ''),
    ),
    exclusions: {
      estimateBias: excludedEstimateBias,
      hourlyCompletionRate: excludedHourly,
      sessionLength: excludedSessionLength,
      postponeSkipFrequency: observedActivityCount - explicitUserActions.length,
      splitBlockCompletionRate: snapshot.timeBlocks.length - splitBlocks.length,
    },
  };
}
