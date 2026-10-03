import type {
  PreviewExpirationContext,
  PreviewExpirationPolicy,
  ScheduleHorizonPolicy,
  SchedulingInputPolicyPort,
  SchedulingPolicyInput,
  SchedulingPolicySnapshot,
} from '@workspace/application';
import { parseInstant } from '@workspace/domain';
import { SCHEDULER_VERSION } from '@workspace/scheduler-core';

export type MobileSchedulingPolicyOptions = Readonly<{
  policyVersion: string;
  gridAnchor: string;
  defaultHorizonMs: number;
  previewTtlMs: number;
  granularityMinutes: number;
  defaultMinBlockMinutes: number;
  defaultMaxBlockMinutes: number;
}>;

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function addMilliseconds(instant: string, milliseconds: number) {
  return parseInstant(
    new Date(Date.parse(parseInstant(instant)) + milliseconds).toISOString(),
  );
}

function validateOptions(options: MobileSchedulingPolicyOptions) {
  if (options.policyVersion.trim().length === 0) {
    throw new RangeError('policyVersion must be non-empty.');
  }
  parseInstant(options.gridAnchor);
  positiveSafeInteger(options.defaultHorizonMs, 'defaultHorizonMs');
  positiveSafeInteger(options.previewTtlMs, 'previewTtlMs');
  const granularity = positiveSafeInteger(
    options.granularityMinutes,
    'granularityMinutes',
  );
  const minimum = positiveSafeInteger(
    options.defaultMinBlockMinutes,
    'defaultMinBlockMinutes',
  );
  const maximum = positiveSafeInteger(
    options.defaultMaxBlockMinutes,
    'defaultMaxBlockMinutes',
  );
  if (
    minimum > maximum ||
    minimum % granularity !== 0 ||
    maximum % granularity !== 0
  ) {
    throw new RangeError(
      'Default block bounds must be ordered multiples of granularityMinutes.',
    );
  }
}

/** Explicit rolling horizon used only when a caller does not request a range. */
export class MobileScheduleHorizonPolicy implements ScheduleHorizonPolicy {
  constructor(private readonly options: MobileSchedulingPolicyOptions) {
    validateOptions(options);
  }

  defaultHorizon(
    input: Parameters<ScheduleHorizonPolicy['defaultHorizon']>[0],
  ) {
    const start = parseInstant(input.now);
    return Promise.resolve({
      start,
      end: addMilliseconds(start, this.options.defaultHorizonMs),
    });
  }
}

/**
 * DEC-011 pre-decision policy: every observed priority has the same rank and
 * every soft weight is zero. This is intentionally neutral, explicit, and
 * versioned; it is not a product vocabulary or accepted tuning decision.
 */
export class MobileNeutralSchedulingInputPolicy implements SchedulingInputPolicyPort {
  constructor(private readonly options: MobileSchedulingPolicyOptions) {
    validateOptions(options);
  }

  snapshot(input: SchedulingPolicyInput): Promise<SchedulingPolicySnapshot> {
    const priorityRanks = Object.fromEntries(
      [...new Set(input.tasks.map((task) => task.priority))]
        .sort()
        .map((priority) => [priority, 1]),
    );
    return Promise.resolve({
      preferredWindows: [],
      userModel: {
        completionRateWindows: [],
        recoveryPenaltyWindows: [],
      },
      policy: {
        policyVersion: this.options.policyVersion,
        schedulerVersion: SCHEDULER_VERSION,
        gridAnchor: parseInstant(this.options.gridAnchor),
        granularityMinutes: this.options.granularityMinutes,
        defaultMinBlockMinutes: this.options.defaultMinBlockMinutes,
        defaultMaxBlockMinutes: this.options.defaultMaxBlockMinutes,
        priorityRanks,
        energyMatchScores: [],
        defaultEnergyMatchScore: 0,
        scoreWeights: {
          planStability: 0,
          fragmentation: 0,
          preferredHours: 0,
          completionRate: 0,
          energyMatch: 0,
          recoveryPenalty: 0,
        },
      },
    });
  }
}

export class MobilePreviewExpirationPolicy implements PreviewExpirationPolicy {
  constructor(private readonly options: MobileSchedulingPolicyOptions) {
    validateOptions(options);
  }

  expirationFor(context: PreviewExpirationContext) {
    return addMilliseconds(context.createdAt, this.options.previewTtlMs);
  }
}
