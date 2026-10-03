import {
  createUserModelFeature,
  parseInstant,
  parseTimeZoneId,
  parseUserModelFeatureId,
  userModelFeatureIdentity,
  type Instant,
  type TimeZoneId,
  type UserModelFeature,
} from '@workspace/domain';
import {
  buildUserModelFeatures,
  type UserModelBuildPolicy,
  type UserModelExclusions,
} from '@workspace/user-model';
import { z } from 'zod';

import { ApplicationError } from './errors';
import {
  personalizationEnabledPreferenceKey,
  personalizationEnabledPreferenceValueSchema,
} from './preference-schemas';
import type { ApplicationUnitOfWork, Clock, IdGenerator } from './ports';
import {
  dataIntegrityError,
  generateId,
  protectApplicationCall,
  readClock,
  requireScheduleState,
} from './service-support';

const nonEmptyString = z.string().trim().min(1);
const positiveSafeInteger = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const rebuildUserModelInputSchema = z
  .object({
    window: z.object({ start: nonEmptyString, end: nonEmptyString }).strict(),
    policy: z
      .object({
        algorithmVersion: nonEmptyString,
        estimateBiasStatistic: z.enum(['mean', 'median']),
        confidenceFullSampleCounts: z
          .object({
            estimateBias: positiveSafeInteger,
            hourlyCompletionRate: positiveSafeInteger,
            sessionLength: positiveSafeInteger,
            postponeSkipFrequency: positiveSafeInteger,
            splitBlockCompletionRate: positiveSafeInteger,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type RebuildUserModelInput = z.input<typeof rebuildUserModelInputSchema>;

export type UserModelLocalHourPort = Readonly<{
  hourAt(instant: Instant, timeZone: TimeZoneId): number;
}>;

export type UserModelSnapshot = Readonly<{
  algorithmVersion: string;
  sourceStateVersion: number;
  personalizationEnabled: boolean;
  fresh: boolean;
  features: readonly UserModelFeature[];
}>;

export type UserModelRebuildResult = UserModelSnapshot &
  Readonly<{
    window: Readonly<{ start: Instant; end: Instant }>;
    exclusions: UserModelExclusions;
  }>;

export type UserModelServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  clock: Clock;
  featureIds: IdGenerator;
  localHour: UserModelLocalHourPort;
}>;

function parseWindow(input: RebuildUserModelInput['window']) {
  const window = {
    start: parseInstant(input.start),
    end: parseInstant(input.end),
  };
  if (Date.parse(window.start) >= Date.parse(window.end)) {
    throw new ApplicationError(
      'validation_error',
      'User Model observation window must be non-empty.',
      { retryable: false },
    );
  }
  return window;
}

function personalizationEnabled(value: unknown): boolean {
  const parsed = personalizationEnabledPreferenceValueSchema.safeParse(value);
  return parsed.success ? parsed.data.enabled : false;
}

function sortedFeatures(
  features: readonly UserModelFeature[],
): readonly UserModelFeature[] {
  return [...features].sort(
    (left, right) =>
      left.featureKey.localeCompare(right.featureKey) ||
      (left.scopeKey ?? '').localeCompare(right.scopeKey ?? '') ||
      left.id.localeCompare(right.id),
  );
}

export class UserModelService {
  readonly #dependencies: UserModelServiceDependencies;

  constructor(dependencies: UserModelServiceDependencies) {
    this.#dependencies = dependencies;
  }

  rebuild(input: RebuildUserModelInput): Promise<UserModelRebuildResult> {
    return protectApplicationCall(undefined, async () => {
      const parsed = rebuildUserModelInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ApplicationError(
          'validation_error',
          'User Model rebuild input is invalid.',
          { retryable: false },
        );
      }
      const window = parseWindow(parsed.data.window);
      const policy: UserModelBuildPolicy = parsed.data.policy;
      const lastUpdatedAt = readClock(this.#dependencies.clock);

      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const [state, tasks, completionRecords, sessions, timeBlocks, events] =
          await Promise.all([
            requireScheduleState(transaction),
            transaction.tasks.listAll(),
            transaction.completionRecords.listCompletedBetween(
              window.start,
              window.end,
            ),
            transaction.executionSessions.listEndedBetween(
              window.start,
              window.end,
            ),
            transaction.timeBlocks.listAll(),
            transaction.taskActivityEvents.listOccurredBetween(
              window.start,
              window.end,
            ),
          ]);
        const sessionFacts = await Promise.all(
          sessions.map(async (session) => ({
            session,
            intervals: await transaction.executionIntervals.listBySessionId(
              session.id,
            ),
          })),
        );
        const explicitSkippedBlocks = new Set(
          events
            .filter(
              (event) =>
                event.actor === 'user' &&
                event.eventType === 'skip' &&
                event.timeBlockId !== null,
            )
            .map((event) => event.timeBlockId!),
        );
        const plans = new Map<
          number,
          Awaited<ReturnType<typeof transaction.schedulePlans.findByRevision>>
        >();
        const timeBlockFacts = [];
        for (const block of timeBlocks) {
          let plan = plans.get(block.planRevision);
          if (!plans.has(block.planRevision)) {
            plan = await transaction.schedulePlans.findByRevision(
              block.planRevision,
            );
            plans.set(block.planRevision, plan);
          }
          let plannedLocalHour: number | null = null;
          if (plan !== null && plan !== undefined) {
            let hour: number;
            try {
              hour = this.#dependencies.localHour.hourAt(
                block.startAt,
                parseTimeZoneId(plan.timeZone),
              );
            } catch {
              throw dataIntegrityError(
                'The local-time adapter could not classify a planned block.',
              );
            }
            if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
              throw dataIntegrityError(
                'The local-time adapter returned an invalid planned hour.',
              );
            }
            plannedLocalHour = hour;
          }
          timeBlockFacts.push({
            block,
            plannedLocalHour,
            explicitUserSkip: explicitSkippedBlocks.has(block.id),
          });
        }
        const calculated = buildUserModelFeatures(
          {
            window,
            tasks,
            completionRecords,
            timeBlocks: timeBlockFacts,
            sessions: sessionFacts,
            activityEvents: events,
          },
          policy,
        );
        const existing = new Map(
          (
            await transaction.userModelFeatures.listByAlgorithmVersion(
              policy.algorithmVersion,
            )
          ).map((feature) => [userModelFeatureIdentity(feature), feature]),
        );
        const features = calculated.features.map((draft) => {
          const identity = userModelFeatureIdentity({
            algorithmVersion: policy.algorithmVersion,
            featureKey: draft.featureKey,
            scopeKey: draft.scopeKey,
          });
          return createUserModelFeature({
            id:
              existing.get(identity)?.id ??
              generateId(
                this.#dependencies.featureIds,
                parseUserModelFeatureId,
                'UserModelFeature ID',
              ),
            ...draft,
            windowStart: window.start,
            windowEnd: window.end,
            sourceStateVersion: state.stateVersion,
            algorithmVersion: policy.algorithmVersion,
            lastUpdatedAt,
          });
        });
        await transaction.userModelFeatures.replaceForAlgorithmVersion(
          policy.algorithmVersion,
          features,
        );
        const preference = await transaction.userPreferences.findByKey(
          personalizationEnabledPreferenceKey,
        );
        return {
          algorithmVersion: policy.algorithmVersion,
          sourceStateVersion: state.stateVersion,
          personalizationEnabled: personalizationEnabled(preference?.valueJson),
          fresh: true,
          features: sortedFeatures(features),
          window,
          exclusions: calculated.exclusions,
        };
      });
    });
  }

  snapshot(algorithmVersion: string): Promise<UserModelSnapshot> {
    return protectApplicationCall(undefined, async () => {
      const parsedVersion = nonEmptyString.safeParse(algorithmVersion);
      if (!parsedVersion.success) {
        throw new ApplicationError(
          'validation_error',
          'User Model algorithm version is invalid.',
          { retryable: false },
        );
      }
      return this.#dependencies.unitOfWork.transaction(async (transaction) => {
        const [state, features, preference] = await Promise.all([
          requireScheduleState(transaction),
          transaction.userModelFeatures.listByAlgorithmVersion(
            parsedVersion.data,
          ),
          transaction.userPreferences.findByKey(
            personalizationEnabledPreferenceKey,
          ),
        ]);
        return {
          algorithmVersion: parsedVersion.data,
          sourceStateVersion: state.stateVersion,
          personalizationEnabled: personalizationEnabled(preference?.valueJson),
          fresh:
            features.length > 0 &&
            features.every(
              (feature) => feature.sourceStateVersion === state.stateVersion,
            ),
          features: sortedFeatures(features),
        };
      });
    });
  }
}
