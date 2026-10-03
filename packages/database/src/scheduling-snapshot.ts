import {
  ApplicationError,
  calendarBusySourcesPreferenceValueSchema,
  calendarBusySourcesPreferenceKey,
  personalizationEnabledPreferenceKey,
  personalizationEnabledPreferenceValueSchema,
  schedulingTimeZonePreferenceKey,
  schedulingTimeZonePreferenceValueSchema,
  schedulingWorkingHoursPreferenceKey,
  schedulingWorkingHoursPreferenceValueSchema,
  type ApplicationTransaction,
  type ApplicationUnitOfWork,
  type BusySnapshot,
  type BusySnapshotScope,
  type ScheduleHorizonPolicy,
  type ScheduleSnapshotRequest,
  type ScheduleTimeRange,
  type SchedulingInputPolicyPort,
  type SchedulingSnapshot,
  type SchedulingSnapshotPort,
  type UtcWorkingWindowPort,
} from '@workspace/application';
import {
  parseInstant,
  parseTaskId,
  parseTimeZoneId,
  type CalendarBinding,
  type ExternalCalendarEventSnapshot,
  type Instant,
  type Task,
} from '@workspace/domain';

export type SqliteSchedulingSnapshotDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  workingWindows: UtcWorkingWindowPort;
  horizonPolicy: ScheduleHorizonPolicy;
  inputPolicy: SchedulingInputPolicyPort;
  maximumHorizonMs: number;
}>;

function setupRequired(message: string): ApplicationError {
  return new ApplicationError('scheduling_setup_required', message, {
    retryable: false,
    userAction: 'Review scheduling time zone, working hours, and calendars.',
  });
}

function validateRange(
  range: Readonly<{ start: string; end: string }>,
  maximumHorizonMs: number,
): ScheduleTimeRange {
  const parsed = {
    start: parseInstant(range.start),
    end: parseInstant(range.end),
  };
  const duration = Date.parse(parsed.end) - Date.parse(parsed.start);
  if (duration <= 0 || duration > maximumHorizonMs) {
    throw new ApplicationError(
      'validation_error',
      'Scheduling horizon must be positive and within the configured limit.',
      { retryable: false },
    );
  }
  return parsed;
}

function ownedIdentity(
  value: Pick<
    CalendarBinding,
    'provider' | 'calendarId' | 'externalEventId' | 'occurrenceKey'
  >,
): string {
  return JSON.stringify([
    value.provider,
    value.calendarId,
    value.externalEventId,
    value.occurrenceKey,
  ]);
}

function snapshotIdentity(value: ExternalCalendarEventSnapshot): string {
  return JSON.stringify([
    value.provider,
    value.calendarId,
    value.externalEventId,
    value.occurrenceKey,
  ]);
}

function overallBusySnapshot(
  scopes: readonly BusySnapshotScope[],
  events: BusySnapshot['events'],
): BusySnapshot {
  if (scopes.length === 0) {
    return {
      capturedAt: null,
      completeness: 'not_configured',
      scopes: [],
      events,
    };
  }
  const timestamps = scopes.flatMap((scope) =>
    scope.capturedAt === null ? [] : [scope.capturedAt],
  );
  const capturedAt =
    timestamps.length === scopes.length
      ? timestamps.reduce((oldest, value) =>
          Date.parse(value) < Date.parse(oldest) ? value : oldest,
        )
      : null;
  const completeness = scopes.every(
    (scope) => scope.completeness === 'complete',
  )
    ? 'complete'
    : scopes.some((scope) => scope.completeness === 'partial')
      ? 'partial'
      : 'missing';
  return { capturedAt, completeness, scopes, events };
}

async function schedulingTasks(
  transaction: ApplicationTransaction,
  requestedIds: ScheduleSnapshotRequest['taskIds'],
): Promise<readonly Task[]> {
  const tasks = new Map(
    (await transaction.tasks.listActive()).map((task) => [task.id, task]),
  );
  for (const requestedId of requestedIds ?? []) {
    const id = parseTaskId(requestedId);
    if (tasks.has(id)) continue;
    const task = await transaction.tasks.findById(id);
    if (task !== null) tasks.set(task.id, task);
  }
  return [...tasks.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export class SqliteSchedulingSnapshotPort implements SchedulingSnapshotPort {
  readonly #dependencies: SqliteSchedulingSnapshotDependencies;

  constructor(dependencies: SqliteSchedulingSnapshotDependencies) {
    if (
      !Number.isSafeInteger(dependencies.maximumHorizonMs) ||
      dependencies.maximumHorizonMs <= 0
    ) {
      throw new RangeError('maximumHorizonMs must be a positive safe integer.');
    }
    this.#dependencies = dependencies;
  }

  async capture(request: ScheduleSnapshotRequest): Promise<SchedulingSnapshot> {
    const now = parseInstant(request.now);
    return this.#dependencies.unitOfWork.transaction(async (transaction) => {
      const preferences = await transaction.userPreferences.listByKeys([
        schedulingTimeZonePreferenceKey,
        schedulingWorkingHoursPreferenceKey,
        calendarBusySourcesPreferenceKey,
        personalizationEnabledPreferenceKey,
      ]);
      const byKey = new Map(
        preferences.map((preference) => [preference.key, preference.valueJson]),
      );
      const parsedTimeZone = schedulingTimeZonePreferenceValueSchema.safeParse(
        byKey.get(schedulingTimeZonePreferenceKey),
      );
      const parsedWorkingHours =
        schedulingWorkingHoursPreferenceValueSchema.safeParse(
          byKey.get(schedulingWorkingHoursPreferenceKey),
        );
      const parsedBusySources =
        calendarBusySourcesPreferenceValueSchema.safeParse(
          byKey.get(calendarBusySourcesPreferenceKey),
        );
      const parsedPersonalization =
        personalizationEnabledPreferenceValueSchema.safeParse(
          byKey.get(personalizationEnabledPreferenceKey),
        );
      const personalizationEnabled = parsedPersonalization.success
        ? parsedPersonalization.data.enabled
        : false;
      if (
        !parsedTimeZone.success ||
        !parsedWorkingHours.success ||
        !parsedBusySources.success
      ) {
        throw setupRequired('Scheduling setup is incomplete or invalid.');
      }
      const timeZone = parseTimeZoneId(parsedTimeZone.data.timeZone);
      if (parsedWorkingHours.data.timeZone !== timeZone) {
        throw setupRequired(
          'Working hours must be reviewed after the scheduling time zone changes.',
        );
      }

      const tasks = await schedulingTasks(transaction, request.taskIds);
      const proposedHorizon =
        request.requestedTimeRange ??
        (await this.#dependencies.horizonPolicy.defaultHorizon({
          now,
          timeZone,
        }));
      const horizon = validateRange(
        proposedHorizon,
        this.#dependencies.maximumHorizonMs,
      );
      const [
        scheduleState,
        timeBlocks,
        calendarBindings,
        workingWindows,
        userModelFeatures,
        latestEnergyCheckIn,
      ] = await Promise.all([
        transaction.scheduleState.get(),
        transaction.timeBlocks.listAll(),
        transaction.calendarBindings.listAll(),
        this.#dependencies.workingWindows.listUtcWorkingWindows(
          horizon,
          timeZone,
          parsedWorkingHours.data.rules,
        ),
        transaction.userModelFeatures.listAll(),
        transaction.energyCheckIns.findLatestAtOrBefore(now),
      ]);
      if (scheduleState === null) {
        throw new ApplicationError(
          'adapter_error',
          'Schedule state is missing.',
          { retryable: false, causeCategory: 'data_integrity' },
        );
      }
      const policy = await this.#dependencies.inputPolicy.snapshot({
        now,
        horizon,
        timeZone,
        tasks,
        personalizationEnabled,
        userModelFeatures,
        latestEnergyCheckIn,
      });

      const owned = new Set(
        calendarBindings
          .filter((binding) => binding.ownershipVerified)
          .map(ownedIdentity),
      );
      const events: BusySnapshot['events'][number][] = [];
      const scopes: BusySnapshotScope[] = [];
      const enabledSources = parsedBusySources.data.sources
        .filter((source) => source.enabled)
        .sort(
          (left, right) =>
            left.provider.localeCompare(right.provider) ||
            left.calendarId.localeCompare(right.calendarId),
        );
      for (const source of enabledSources) {
        const scope = {
          provider: source.provider,
          calendarId: source.calendarId,
          rangeStart: horizon.start,
          rangeEnd: horizon.end,
        };
        const [snapshots, coverage] = await Promise.all([
          transaction.externalCalendarEventSnapshots.listOverlapping(scope),
          transaction.calendarRefreshCoverages.findLatestCovering(scope),
        ]);
        const partialCapturedAt = snapshots.reduce<Instant | null>(
          (latest, snapshot) =>
            latest === null ||
            Date.parse(snapshot.lastSeenAt) > Date.parse(latest)
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
          if (!snapshot.busy || owned.has(snapshotIdentity(snapshot))) continue;
          events.push({
            id: snapshot.id,
            start: snapshot.startAt,
            end: snapshot.endAt,
          });
        }
      }
      events.sort(
        (left, right) =>
          left.start.localeCompare(right.start) ||
          left.end.localeCompare(right.end) ||
          left.id.localeCompare(right.id),
      );

      return {
        scheduleState,
        horizon,
        timeZone,
        tasks,
        timeBlocks,
        busy: overallBusySnapshot(scopes, events),
        workingWindows,
        preferredWindows: policy.preferredWindows,
        userModel: policy.userModel,
        policy: policy.policy,
      };
    });
  }
}
