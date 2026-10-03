import { ScheduleValidationError } from './errors';
import {
  formatInstant,
  minutesToMilliseconds,
  parseInstantMilliseconds,
} from './time';
import { SCHEDULER_VERSION } from './types';
import type {
  BusyEvent,
  DurationState,
  EnergyMatchScore,
  ExistingTimeBlock,
  ExistingTimeBlockStatus,
  ScheduleInput,
  SchedulableTask,
  ScoredWindow,
  SchedulingPolicy,
  SchedulingPreferences,
  SchedulingScoreWeights,
  SchedulingUserFeatures,
  TimeBlockType,
  TimeRange,
  WorkingWindow,
} from './types';

type UnknownRecord = Record<string, unknown>;

function invalid(
  path: string,
  code: 'invalid_type' | 'invalid_value' | 'unknown_field' | 'duplicate',
  message: string,
): never {
  throw new ScheduleValidationError([{ path, code, message }]);
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(path, 'invalid_type', `${path} must be an object`);
  }
  return value as UnknownRecord;
}

function exactRecord(
  value: unknown,
  path: string,
  fields: readonly string[],
): UnknownRecord {
  const parsed = record(value, path);
  const allowed = new Set(fields);
  for (const key of Reflect.ownKeys(parsed)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      return invalid(
        `${path}.${String(key)}`,
        'unknown_field',
        `${path} contains unknown field ${String(key)}`,
      );
    }
  }
  return parsed;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    return invalid(path, 'invalid_type', `${path} must be an array`);
  }
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(path, 'invalid_type', `${path} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    return invalid(
      path,
      'invalid_value',
      `${path} must not contain surrounding whitespace`,
    );
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : nonEmptyString(value, path);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalid(path, 'invalid_type', `${path} must be a finite number`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path);
  if (parsed < 0) {
    return invalid(path, 'invalid_value', `${path} must not be negative`);
  }
  return parsed;
}

function durationMinutes(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path);
  const milliseconds = minutesToMilliseconds(parsed);
  if (parsed <= 0 || !Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    return invalid(
      path,
      'invalid_value',
      `${path} must be a positive duration representable in whole milliseconds`,
    );
  }
  return parsed;
}

function nullableDuration(value: unknown, path: string): number | null {
  return value === null ? null : durationMinutes(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    return invalid(path, 'invalid_type', `${path} must be a boolean`);
  }
  return value;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  values: Values,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    return invalid(
      path,
      'invalid_value',
      `${path} must be one of ${values.join(', ')}`,
    );
  }
  return value as Values[number];
}

function instant(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    return invalid(
      path,
      'invalid_type',
      `${path} must be a UTC instant string`,
    );
  }
  const timestamp = parseInstantMilliseconds(value);
  if (timestamp === null) {
    return invalid(
      path,
      'invalid_value',
      `${path} must be a real ISO-8601 UTC instant ending in Z`,
    );
  }
  return formatInstant(timestamp);
}

function nullableInstant(value: unknown, path: string): string | null {
  return value === null ? null : instant(value, path);
}

function timeRange(value: unknown, path: string): TimeRange {
  const parsed = exactRecord(value, path, ['start', 'end']);
  return timeRangeFields(parsed, path);
}

function timeRangeFields(parsed: UnknownRecord, path: string): TimeRange {
  const start = instant(parsed.start, `${path}.start`);
  const end = instant(parsed.end, `${path}.end`);
  if (
    (parseInstantMilliseconds(start) as number) >=
    (parseInstantMilliseconds(end) as number)
  ) {
    return invalid(path, 'invalid_value', `${path} must have start before end`);
  }
  return { start, end };
}

function durationState(value: unknown, path: string): DurationState {
  const base = record(value, path);
  const state = enumValue(base.state, `${path}.state`, [
    'known',
    'missing',
    'exhausted',
  ] as const);
  if (state === 'known') {
    const parsed = exactRecord(value, path, ['state', 'remainingMinutes']);
    return {
      state,
      remainingMinutes: durationMinutes(
        parsed.remainingMinutes,
        `${path}.remainingMinutes`,
      ),
    };
  }
  exactRecord(value, path, ['state']);
  return { state };
}

function schedulableTask(value: unknown, path: string): SchedulableTask {
  const parsed = exactRecord(value, path, [
    'id',
    'priority',
    'duration',
    'earliestStart',
    'deadline',
    'splittable',
    'minBlockMinutes',
    'maxBlockMinutes',
    'energyDemand',
    'schedulingPolicy',
    'dependencyState',
  ]);
  const earliestStart = nullableInstant(
    parsed.earliestStart,
    `${path}.earliestStart`,
  );
  const deadline = nullableInstant(parsed.deadline, `${path}.deadline`);
  if (
    earliestStart !== null &&
    deadline !== null &&
    (parseInstantMilliseconds(deadline) as number) <
      (parseInstantMilliseconds(earliestStart) as number)
  ) {
    return invalid(
      `${path}.deadline`,
      'invalid_value',
      `${path}.deadline must not be before earliestStart`,
    );
  }
  const minBlockMinutes = nullableDuration(
    parsed.minBlockMinutes,
    `${path}.minBlockMinutes`,
  );
  const maxBlockMinutes = nullableDuration(
    parsed.maxBlockMinutes,
    `${path}.maxBlockMinutes`,
  );
  if (
    minBlockMinutes !== null &&
    maxBlockMinutes !== null &&
    minBlockMinutes > maxBlockMinutes
  ) {
    return invalid(
      `${path}.minBlockMinutes`,
      'invalid_value',
      `${path}.minBlockMinutes must not exceed maxBlockMinutes`,
    );
  }
  return {
    id: nonEmptyString(parsed.id, `${path}.id`),
    priority: nonEmptyString(parsed.priority, `${path}.priority`),
    duration: durationState(parsed.duration, `${path}.duration`),
    earliestStart,
    deadline,
    splittable: boolean(parsed.splittable, `${path}.splittable`),
    minBlockMinutes,
    maxBlockMinutes,
    energyDemand: nullableString(parsed.energyDemand, `${path}.energyDemand`),
    schedulingPolicy: nonEmptyString(
      parsed.schedulingPolicy,
      `${path}.schedulingPolicy`,
    ),
    dependencyState: enumValue(
      parsed.dependencyState,
      `${path}.dependencyState`,
      ['none', 'unsupported'] as const,
    ),
  };
}

function busyEvent(value: unknown, path: string): BusyEvent {
  const parsed = exactRecord(value, path, ['id', 'start', 'end']);
  const range = timeRangeFields(parsed, path);
  return { id: nonEmptyString(parsed.id, `${path}.id`), ...range };
}

const blockTypes = ['task', 'break', 'relax', 'buffer'] as const;
const blockStatuses = [
  'planned',
  'started',
  'completed',
  'skipped',
  'canceled',
] as const;

function existingBlock(value: unknown, path: string): ExistingTimeBlock {
  const parsed = exactRecord(value, path, [
    'id',
    'taskId',
    'type',
    'start',
    'end',
    'status',
    'locked',
  ]);
  const range = timeRangeFields(parsed, path);
  const type = enumValue(
    parsed.type,
    `${path}.type`,
    blockTypes,
  ) as TimeBlockType;
  const taskId = nullableString(parsed.taskId, `${path}.taskId`);
  if (type === 'task' && taskId === null) {
    return invalid(
      `${path}.taskId`,
      'invalid_value',
      `${path}.taskId is required for task blocks`,
    );
  }
  return {
    id: nonEmptyString(parsed.id, `${path}.id`),
    taskId,
    type,
    ...range,
    status: enumValue(
      parsed.status,
      `${path}.status`,
      blockStatuses,
    ) as ExistingTimeBlockStatus,
    locked: boolean(parsed.locked, `${path}.locked`),
  };
}

function workingWindow(value: unknown, path: string): WorkingWindow {
  const parsed = exactRecord(value, path, [
    'id',
    'start',
    'end',
    'energyLevel',
  ]);
  return {
    id: nonEmptyString(parsed.id, `${path}.id`),
    ...timeRangeFields(parsed, path),
    energyLevel: nullableString(parsed.energyLevel, `${path}.energyLevel`),
  };
}

function scoredWindow(value: unknown, path: string): ScoredWindow {
  const parsed = exactRecord(value, path, ['id', 'start', 'end', 'score']);
  return {
    id: nonEmptyString(parsed.id, `${path}.id`),
    ...timeRangeFields(parsed, path),
    score: finiteNumber(parsed.score, `${path}.score`),
  };
}

function mappedArray<T>(
  value: unknown,
  path: string,
  mapper: (item: unknown, itemPath: string) => T,
): readonly T[] {
  return array(value, path).map((item, index) =>
    mapper(item, `${path}[${index}]`),
  );
}

function assertUniqueIds(
  values: readonly { readonly id: string }[],
  path: string,
): void {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const id = values[index]?.id as string;
    if (seen.has(id)) {
      invalid(
        `${path}[${index}].id`,
        'duplicate',
        `${path} contains duplicate id ${id}`,
      );
    }
    seen.add(id);
  }
}

function preferences(value: unknown, path: string): SchedulingPreferences {
  const parsed = exactRecord(value, path, [
    'workingWindows',
    'preferredWindows',
  ]);
  const workingWindows = mappedArray(
    parsed.workingWindows,
    `${path}.workingWindows`,
    workingWindow,
  );
  const preferredWindows = mappedArray(
    parsed.preferredWindows,
    `${path}.preferredWindows`,
    scoredWindow,
  );
  assertUniqueIds(workingWindows, `${path}.workingWindows`);
  assertUniqueIds(preferredWindows, `${path}.preferredWindows`);

  const sortedWorking = [...workingWindows].sort(
    (left, right) =>
      (parseInstantMilliseconds(left.start) as number) -
        (parseInstantMilliseconds(right.start) as number) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  for (let index = 1; index < sortedWorking.length; index += 1) {
    const previous = sortedWorking[index - 1] as WorkingWindow;
    const current = sortedWorking[index] as WorkingWindow;
    if (
      (parseInstantMilliseconds(previous.end) as number) >
      (parseInstantMilliseconds(current.start) as number)
    ) {
      invalid(
        `${path}.workingWindows`,
        'invalid_value',
        `${path}.workingWindows must not overlap`,
      );
    }
  }
  return { workingWindows, preferredWindows };
}

function userFeatures(value: unknown, path: string): SchedulingUserFeatures {
  const parsed = exactRecord(value, path, [
    'completionRateWindows',
    'recoveryPenaltyWindows',
  ]);
  const completionRateWindows = mappedArray(
    parsed.completionRateWindows,
    `${path}.completionRateWindows`,
    scoredWindow,
  );
  const recoveryPenaltyWindows = mappedArray(
    parsed.recoveryPenaltyWindows,
    `${path}.recoveryPenaltyWindows`,
    scoredWindow,
  );
  assertUniqueIds(completionRateWindows, `${path}.completionRateWindows`);
  assertUniqueIds(recoveryPenaltyWindows, `${path}.recoveryPenaltyWindows`);
  for (const [index, window] of recoveryPenaltyWindows.entries()) {
    if (window.score < 0) {
      invalid(
        `${path}.recoveryPenaltyWindows[${index}].score`,
        'invalid_value',
        'recovery penalty scores must not be negative',
      );
    }
  }
  return { completionRateWindows, recoveryPenaltyWindows };
}

function scoreWeights(value: unknown, path: string): SchedulingScoreWeights {
  const parsed = exactRecord(value, path, [
    'planStability',
    'fragmentation',
    'preferredHours',
    'completionRate',
    'energyMatch',
    'recoveryPenalty',
  ]);
  return {
    planStability: nonNegativeNumber(
      parsed.planStability,
      `${path}.planStability`,
    ),
    fragmentation: nonNegativeNumber(
      parsed.fragmentation,
      `${path}.fragmentation`,
    ),
    preferredHours: nonNegativeNumber(
      parsed.preferredHours,
      `${path}.preferredHours`,
    ),
    completionRate: nonNegativeNumber(
      parsed.completionRate,
      `${path}.completionRate`,
    ),
    energyMatch: nonNegativeNumber(parsed.energyMatch, `${path}.energyMatch`),
    recoveryPenalty: nonNegativeNumber(
      parsed.recoveryPenalty,
      `${path}.recoveryPenalty`,
    ),
  };
}

function energyMatch(value: unknown, path: string): EnergyMatchScore {
  const parsed = exactRecord(value, path, ['demand', 'supply', 'score']);
  return {
    demand: nonEmptyString(parsed.demand, `${path}.demand`),
    supply: nonEmptyString(parsed.supply, `${path}.supply`),
    score: finiteNumber(parsed.score, `${path}.score`),
  };
}

function priorityRanks(
  value: unknown,
  path: string,
): Readonly<Record<string, number>> {
  const parsed = record(value, path);
  const result: Record<string, number> = {};
  for (const [priority, rank] of Object.entries(parsed)) {
    if (
      priority.length === 0 ||
      priority === '__proto__' ||
      priority === 'prototype' ||
      priority === 'constructor'
    ) {
      invalid(`${path}.${priority}`, 'invalid_value', 'priority key is unsafe');
    }
    result[priority] = finiteNumber(rank, `${path}.${priority}`);
  }
  return result;
}

function policy(value: unknown, path: string): SchedulingPolicy {
  const parsed = exactRecord(value, path, [
    'policyVersion',
    'schedulerVersion',
    'gridAnchor',
    'granularityMinutes',
    'defaultMinBlockMinutes',
    'defaultMaxBlockMinutes',
    'priorityRanks',
    'energyMatchScores',
    'defaultEnergyMatchScore',
    'scoreWeights',
  ]);
  const defaultMinBlockMinutes = durationMinutes(
    parsed.defaultMinBlockMinutes,
    `${path}.defaultMinBlockMinutes`,
  );
  const defaultMaxBlockMinutes = durationMinutes(
    parsed.defaultMaxBlockMinutes,
    `${path}.defaultMaxBlockMinutes`,
  );
  if (defaultMinBlockMinutes > defaultMaxBlockMinutes) {
    invalid(
      `${path}.defaultMinBlockMinutes`,
      'invalid_value',
      'defaultMinBlockMinutes must not exceed defaultMaxBlockMinutes',
    );
  }
  const energyMatchScores = mappedArray(
    parsed.energyMatchScores,
    `${path}.energyMatchScores`,
    energyMatch,
  );
  const seenMatches = new Set<string>();
  for (const [index, match] of energyMatchScores.entries()) {
    const key = `${match.demand.length}:${match.demand}${match.supply.length}:${match.supply}`;
    if (seenMatches.has(key)) {
      invalid(
        `${path}.energyMatchScores[${index}]`,
        'duplicate',
        `duplicate energy match for ${match.demand}/${match.supply}`,
      );
    }
    seenMatches.add(key);
  }
  const schedulerVersion = nonEmptyString(
    parsed.schedulerVersion,
    `${path}.schedulerVersion`,
  );
  if (schedulerVersion !== SCHEDULER_VERSION) {
    invalid(
      `${path}.schedulerVersion`,
      'invalid_value',
      `schedulerVersion must match this core build (${SCHEDULER_VERSION})`,
    );
  }
  return {
    policyVersion: nonEmptyString(
      parsed.policyVersion,
      `${path}.policyVersion`,
    ),
    schedulerVersion,
    gridAnchor: instant(parsed.gridAnchor, `${path}.gridAnchor`),
    granularityMinutes: durationMinutes(
      parsed.granularityMinutes,
      `${path}.granularityMinutes`,
    ),
    defaultMinBlockMinutes,
    defaultMaxBlockMinutes,
    priorityRanks: priorityRanks(parsed.priorityRanks, `${path}.priorityRanks`),
    energyMatchScores,
    defaultEnergyMatchScore: finiteNumber(
      parsed.defaultEnergyMatchScore,
      `${path}.defaultEnergyMatchScore`,
    ),
    scoreWeights: scoreWeights(parsed.scoreWeights, `${path}.scoreWeights`),
  };
}

// Syntax-only validation keeps the core independent of a platform time-zone
// database. The boundary that expands local windows must validate membership.
const TIME_ZONE_PATTERN = /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_.+-]+)*$/;

function timeZone(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (!TIME_ZONE_PATTERN.test(parsed)) {
    return invalid(
      path,
      'invalid_value',
      `${path} must use IANA time-zone identifier syntax`,
    );
  }
  return parsed;
}

function assertFiniteScoreSpace(
  parsedPreferences: SchedulingPreferences,
  parsedFeatures: SchedulingUserFeatures,
  parsedPolicy: SchedulingPolicy,
): void {
  const sumAbsoluteScores = (windows: readonly ScoredWindow[]): number =>
    windows.reduce((sum, window) => sum + Math.abs(window.score), 0);
  const maximumEnergyMagnitude = parsedPolicy.energyMatchScores.reduce(
    (maximum, match) => Math.max(maximum, Math.abs(match.score)),
    Math.abs(parsedPolicy.defaultEnergyMatchScore),
  );
  const weights = parsedPolicy.scoreWeights;
  const maximumAbsoluteTerms = [
    weights.planStability,
    weights.fragmentation,
    weights.preferredHours *
      sumAbsoluteScores(parsedPreferences.preferredWindows),
    weights.completionRate *
      sumAbsoluteScores(parsedFeatures.completionRateWindows),
    weights.energyMatch * maximumEnergyMagnitude,
    weights.recoveryPenalty *
      sumAbsoluteScores(parsedFeatures.recoveryPenaltyWindows),
  ];
  const bound = maximumAbsoluteTerms.reduce((sum, term) => sum + term, 0);
  if (
    maximumAbsoluteTerms.some((term) => !Number.isFinite(term)) ||
    !Number.isFinite(bound)
  ) {
    invalid(
      'input.policy.scoreWeights',
      'invalid_value',
      'the supplied weights and score ranges must have a finite combined score',
    );
  }
}

export function validateScheduleInput(value: unknown): ScheduleInput {
  const parsed = exactRecord(value, 'input', [
    'now',
    'horizon',
    'timeZone',
    'tasks',
    'busyEvents',
    'existingBlocks',
    'preferences',
    'userModel',
    'policy',
    'reason',
  ]);
  const tasks = mappedArray(parsed.tasks, 'input.tasks', schedulableTask);
  const busyEvents = mappedArray(
    parsed.busyEvents,
    'input.busyEvents',
    busyEvent,
  );
  const existingBlocks = mappedArray(
    parsed.existingBlocks,
    'input.existingBlocks',
    existingBlock,
  );
  assertUniqueIds(tasks, 'input.tasks');
  assertUniqueIds(busyEvents, 'input.busyEvents');
  assertUniqueIds(existingBlocks, 'input.existingBlocks');

  const parsedPolicy = policy(parsed.policy, 'input.policy');
  const parsedPreferences = preferences(
    parsed.preferences,
    'input.preferences',
  );
  const parsedFeatures = userFeatures(parsed.userModel, 'input.userModel');
  assertFiniteScoreSpace(parsedPreferences, parsedFeatures, parsedPolicy);
  for (const [index, task] of tasks.entries()) {
    if (!Object.hasOwn(parsedPolicy.priorityRanks, task.priority)) {
      invalid(
        `input.tasks[${index}].priority`,
        'invalid_value',
        `priority ${task.priority} has no rank in the scheduling policy`,
      );
    }
    const effectiveMin =
      task.minBlockMinutes ?? parsedPolicy.defaultMinBlockMinutes;
    const effectiveMax =
      task.maxBlockMinutes ?? parsedPolicy.defaultMaxBlockMinutes;
    if (effectiveMin > effectiveMax) {
      invalid(
        `input.tasks[${index}].minBlockMinutes`,
        'invalid_value',
        'effective minimum block duration must not exceed the effective maximum',
      );
    }
  }

  return {
    now: instant(parsed.now, 'input.now'),
    horizon: timeRange(parsed.horizon, 'input.horizon'),
    timeZone: timeZone(parsed.timeZone, 'input.timeZone'),
    tasks,
    busyEvents,
    existingBlocks,
    preferences: parsedPreferences,
    userModel: parsedFeatures,
    policy: parsedPolicy,
    reason: nonEmptyString(parsed.reason, 'input.reason'),
  };
}
