import {
  advanceStateVersion,
  createCalendarRefreshCoverage,
  createExternalCalendarEventSnapshot,
  externalCalendarEventIdentity,
  parseCalendarRefreshCoverageId,
  parseExternalCalendarEventSnapshotId,
  parseInstant,
  requireNonEmptyString,
  type ExternalCalendarEventSnapshot,
  type Instant,
} from '@workspace/domain';
import type { z } from 'zod';

import { ApplicationError, isApplicationError } from './errors';
import type {
  BusySnapshotResult,
  CalendarInfo,
  CalendarPermissionState,
  CalendarProvider,
  CalendarRefreshRangePolicy,
} from './integration-ports';
import {
  busySnapshotResultSchema,
  calendarCachedBusyRequestSchema,
  calendarCachedBusyResultSchema,
  calendarBusyRequestSchema,
  calendarInfoListSchema,
  calendarPermissionStateSchema,
  calendarRefreshResultSchema,
} from './integration-schemas';
import type {
  ApplicationTransaction,
  ApplicationUnitOfWork,
  CalendarSnapshotScope,
  Clock,
  IdGenerator,
} from './ports';
import type { ScheduleTimeRange } from './schedule-ports';
import {
  dataIntegrityError,
  generateId,
  protectApplicationCall,
  readClock,
  requireScheduleState,
} from './service-support';

export type CalendarRefreshInput = Readonly<{
  provider: string;
  calendarId: string;
  range: Readonly<{ start: string; end: string }>;
}>;

export type CalendarRefreshResult = Readonly<{
  status: 'complete' | 'partial' | 'permission_required' | 'unavailable';
  permission: CalendarPermissionState;
  provider: string;
  calendarId: string;
  range: ScheduleTimeRange;
  fetchedAt: Instant | null;
  upsertedCount: number;
  deletedCount: number;
  busyChanged: boolean;
  stateVersion: number;
}>;

export type CalendarCachedBusyInput = Readonly<{
  provider: string;
  calendarId: string;
  range: Readonly<{ start: string; end: string }>;
  limit?: number;
}>;

export type CalendarCachedBusyResult = Readonly<{
  provider: string;
  calendarId: string;
  range: ScheduleTimeRange;
  capturedAt: Instant | null;
  completeness: 'complete' | 'partial' | 'missing';
  events: readonly Readonly<{
    startAt: Instant;
    endAt: Instant;
    busy: true;
  }>[];
  truncated: boolean;
}>;

export type CalendarServiceDependencies = Readonly<{
  unitOfWork: ApplicationUnitOfWork;
  provider: CalendarProvider;
  rangePolicy: CalendarRefreshRangePolicy;
  snapshotIds: IdGenerator;
  coverageIds: IdGenerator;
  clock: Clock;
}>;

function providerFailure(message: string): ApplicationError {
  return new ApplicationError('provider_error', message, {
    retryable: true,
    causeCategory: 'calendar',
  });
}

async function readProviderResult<Schema extends z.ZodType>(
  call: () => Promise<unknown>,
  schema: Schema,
  label: string,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await call();
  } catch (error) {
    if (isApplicationError(error)) throw error;
    throw providerFailure(`The calendar provider could not ${label}.`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw dataIntegrityError(
      `The calendar provider returned an invalid ${label} result.`,
    );
  }
  return parsed.data;
}

function sameRange(
  left: Readonly<{ start: string; end: string }>,
  right: ScheduleTimeRange,
): boolean {
  return left.start === right.start && left.end === right.end;
}

function overlaps(
  startAt: string,
  endAt: string,
  range: ScheduleTimeRange,
): boolean {
  return (
    Date.parse(startAt) < Date.parse(range.end) &&
    Date.parse(endAt) > Date.parse(range.start)
  );
}

function snapshotScope(
  provider: string,
  calendarId: string,
  range: ScheduleTimeRange,
): CalendarSnapshotScope {
  return {
    provider,
    calendarId,
    rangeStart: range.start,
    rangeEnd: range.end,
  };
}

function effectiveBusySet(
  snapshots: readonly ExternalCalendarEventSnapshot[],
  ownedExternalIdentities: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(
    snapshots
      .filter(
        (snapshot) =>
          snapshot.busy &&
          !ownedExternalIdentities.has(externalCalendarEventIdentity(snapshot)),
      )
      .map((snapshot) =>
        JSON.stringify([
          externalCalendarEventIdentity(snapshot),
          snapshot.startAt,
          snapshot.endAt,
        ]),
      ),
  );
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function validateExistingSnapshots(
  snapshots: readonly ExternalCalendarEventSnapshot[],
  provider: string,
  calendarId: string,
  range: ScheduleTimeRange,
): void {
  const identities = new Set<string>();
  for (const snapshot of snapshots) {
    if (
      snapshot.provider !== provider ||
      snapshot.calendarId !== calendarId ||
      !overlaps(snapshot.startAt, snapshot.endAt, range)
    ) {
      throw dataIntegrityError(
        'The calendar snapshot repository returned an out-of-scope event.',
      );
    }
    const identity = externalCalendarEventIdentity(snapshot);
    if (identities.has(identity)) {
      throw dataIntegrityError(
        'The calendar snapshot repository returned a duplicate event.',
      );
    }
    identities.add(identity);
  }
}

export class CalendarService {
  readonly #unitOfWork: ApplicationUnitOfWork;
  readonly #provider: CalendarProvider;
  readonly #rangePolicy: CalendarRefreshRangePolicy;
  readonly #snapshotIds: IdGenerator;
  readonly #coverageIds: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: CalendarServiceDependencies) {
    this.#unitOfWork = dependencies.unitOfWork;
    this.#provider = dependencies.provider;
    this.#rangePolicy = dependencies.rangePolicy;
    this.#snapshotIds = dependencies.snapshotIds;
    this.#coverageIds = dependencies.coverageIds;
    this.#clock = dependencies.clock;
  }

  getPermissionState(): Promise<CalendarPermissionState> {
    return protectApplicationCall(undefined, () =>
      readProviderResult(
        () => this.#provider.getPermissionState(),
        calendarPermissionStateSchema,
        'read its permission state',
      ),
    );
  }

  requestPermission(
    access: 'read' | 'write',
  ): Promise<CalendarPermissionState> {
    return protectApplicationCall(undefined, async () => {
      const permission = await readProviderResult(
        () => this.#provider.requestPermission(access),
        calendarPermissionStateSchema,
        'request permission',
      );
      if (permission.write.status === 'granted') {
        const now = readClock(this.#clock);
        await this.#unitOfWork.transaction((transaction) =>
          transaction.integrationJobs.requeueBlockedChannel({
            channel: 'calendar',
            requeuedAt: now,
            notBefore: now,
          }),
        );
      }
      return permission;
    });
  }

  listCalendars(): Promise<readonly CalendarInfo[]> {
    return protectApplicationCall(undefined, () =>
      readProviderResult(
        () => this.#provider.listCalendars(),
        calendarInfoListSchema,
        'list calendars',
      ),
    );
  }

  listBusy(input: CalendarCachedBusyInput): Promise<CalendarCachedBusyResult> {
    return protectApplicationCall(undefined, async () => {
      const parsed = calendarCachedBusyRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw new ApplicationError(
          'validation_error',
          'Calendar busy list input is invalid.',
          { retryable: false },
        );
      }
      const provider = requireNonEmptyString(parsed.data.provider, 'provider');
      const calendarId = requireNonEmptyString(
        parsed.data.calendarId,
        'calendarId',
      );
      const range: ScheduleTimeRange = {
        start: parseInstant(parsed.data.range.start),
        end: parseInstant(parsed.data.range.end),
      };
      if (
        provider !== requireNonEmptyString(this.#provider.provider, 'provider')
      ) {
        throw new ApplicationError(
          'validation_error',
          'Calendar busy provider does not match the configured adapter.',
          { retryable: false },
        );
      }
      let allowed: boolean;
      try {
        allowed = this.#rangePolicy.allows(range);
      } catch {
        throw dataIntegrityError('The calendar busy range policy failed.');
      }
      if (!allowed) {
        throw new ApplicationError(
          'validation_error',
          'Calendar busy range exceeds the configured bounded scope.',
          { retryable: false },
        );
      }
      const result = await this.#unitOfWork.transaction(async (transaction) => {
        const scope = snapshotScope(provider, calendarId, range);
        const [snapshots, coverage, bindings] = await Promise.all([
          transaction.externalCalendarEventSnapshots.listOverlapping(scope),
          transaction.calendarRefreshCoverages.findLatestCovering(scope),
          transaction.calendarBindings.listAll(),
        ]);
        validateExistingSnapshots(snapshots, provider, calendarId, range);
        const owned = new Set(
          bindings
            .filter(
              (binding) =>
                binding.ownershipVerified &&
                binding.provider === provider &&
                binding.calendarId === calendarId,
            )
            .map((binding) =>
              JSON.stringify([
                binding.provider,
                binding.calendarId,
                binding.externalEventId,
                binding.occurrenceKey,
              ]),
            ),
        );
        const busy = snapshots
          .filter(
            (snapshot) =>
              snapshot.busy &&
              !owned.has(externalCalendarEventIdentity(snapshot)),
          )
          .sort(
            (left, right) =>
              left.startAt.localeCompare(right.startAt) ||
              left.endAt.localeCompare(right.endAt) ||
              left.id.localeCompare(right.id),
          );
        const capturedAt =
          coverage?.fetchedAt ??
          snapshots.reduce<Instant | null>(
            (latest, event) =>
              latest === null || event.lastSeenAt > latest
                ? event.lastSeenAt
                : latest,
            null,
          );
        const events = busy.slice(0, parsed.data.limit).map((event) => ({
          startAt: event.startAt,
          endAt: event.endAt,
          busy: true as const,
        }));
        return {
          provider,
          calendarId,
          range,
          capturedAt,
          completeness:
            coverage !== null
              ? ('complete' as const)
              : capturedAt === null
                ? ('missing' as const)
                : ('partial' as const),
          events,
          truncated: busy.length > events.length,
        };
      });
      const validated = calendarCachedBusyResultSchema.safeParse(result);
      if (!validated.success) {
        throw dataIntegrityError('CalendarService produced invalid busy data.');
      }
      return result;
    });
  }

  refreshBusy(input: CalendarRefreshInput): Promise<CalendarRefreshResult> {
    return protectApplicationCall(undefined, async () => {
      const parsedInput = calendarBusyRequestSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new ApplicationError(
          'validation_error',
          'Calendar refresh input is invalid.',
          { retryable: false },
        );
      }
      const provider = requireNonEmptyString(
        parsedInput.data.provider,
        'provider',
      );
      const calendarId = requireNonEmptyString(
        parsedInput.data.calendarId,
        'calendarId',
      );
      const range: ScheduleTimeRange = {
        start: parseInstant(parsedInput.data.range.start),
        end: parseInstant(parsedInput.data.range.end),
      };
      if (
        provider !== requireNonEmptyString(this.#provider.provider, 'provider')
      ) {
        throw new ApplicationError(
          'validation_error',
          'Calendar refresh provider does not match the configured adapter.',
          { retryable: false },
        );
      }
      let allowed: boolean;
      try {
        allowed = this.#rangePolicy.allows(range);
      } catch {
        throw dataIntegrityError('The calendar refresh range policy failed.');
      }
      if (allowed !== true) {
        throw new ApplicationError(
          'validation_error',
          'Calendar refresh range exceeds the configured bounded scope.',
          { retryable: false },
        );
      }

      const permission = await readProviderResult(
        () => this.#provider.getPermissionState(),
        calendarPermissionStateSchema,
        'read its permission state',
      );
      if (permission.read.status !== 'granted') {
        const state = await this.#unitOfWork.transaction((transaction) =>
          requireScheduleState(transaction),
        );
        return this.#result({
          status:
            permission.read.status === 'unavailable'
              ? 'unavailable'
              : 'permission_required',
          permission,
          provider,
          calendarId,
          range,
          fetchedAt: null,
          upsertedCount: 0,
          deletedCount: 0,
          busyChanged: false,
          stateVersion: state.stateVersion,
        });
      }

      const rawResult = await readProviderResult(
        () => this.#provider.listBusyEvents({ provider, calendarId, range }),
        busySnapshotResultSchema,
        'list busy events',
      );
      const result: BusySnapshotResult = {
        provider: rawResult.provider,
        calendarId: rawResult.calendarId,
        range: {
          start: parseInstant(rawResult.range.start),
          end: parseInstant(rawResult.range.end),
        },
        fetchedAt: parseInstant(rawResult.fetchedAt),
        completeness: rawResult.completeness,
        events: rawResult.events.map((event) => ({
          externalEventId: event.externalEventId,
          occurrenceKey: event.occurrenceKey,
          startAt: parseInstant(event.startAt),
          endAt: parseInstant(event.endAt),
          busy: event.busy,
          contentHash: event.contentHash,
        })),
      };
      if (
        result.provider !== provider ||
        result.calendarId !== calendarId ||
        !sameRange(result.range, range)
      ) {
        throw dataIntegrityError(
          'The calendar provider returned a snapshot for a different scope.',
        );
      }
      const observed = this.#validateObserved(result, range);
      return this.#unitOfWork.transaction((transaction) =>
        this.#commitRefresh(
          transaction,
          permission,
          provider,
          calendarId,
          range,
          result,
          observed,
        ),
      );
    });
  }

  #validateObserved(
    result: BusySnapshotResult,
    range: ScheduleTimeRange,
  ): ReadonlyMap<string, BusySnapshotResult['events'][number]> {
    const observed = new Map<string, BusySnapshotResult['events'][number]>();
    for (const event of result.events) {
      if (!overlaps(event.startAt, event.endAt, range)) {
        throw dataIntegrityError(
          'The calendar provider returned an event outside the requested range.',
        );
      }
      const identity = JSON.stringify([
        result.provider,
        result.calendarId,
        event.externalEventId,
        event.occurrenceKey,
      ]);
      if (observed.has(identity)) {
        throw dataIntegrityError(
          'The calendar provider returned a duplicate event instance.',
        );
      }
      observed.set(identity, event);
    }
    return observed;
  }

  async #commitRefresh(
    transaction: ApplicationTransaction,
    permission: CalendarPermissionState,
    provider: string,
    calendarId: string,
    range: ScheduleTimeRange,
    result: BusySnapshotResult,
    observed: ReadonlyMap<string, BusySnapshotResult['events'][number]>,
  ): Promise<CalendarRefreshResult> {
    const state = await requireScheduleState(transaction);
    const scope = snapshotScope(provider, calendarId, range);
    const existing =
      await transaction.externalCalendarEventSnapshots.listOverlapping(scope);
    validateExistingSnapshots(existing, provider, calendarId, range);
    const incomingFetchedAt = parseInstant(result.fetchedAt);
    const latestComplete =
      await transaction.calendarRefreshCoverages.findLatestCovering(scope);
    if (
      latestComplete !== null &&
      Date.parse(latestComplete.fetchedAt) >= Date.parse(incomingFetchedAt)
    ) {
      return this.#result({
        status: result.completeness,
        permission,
        provider,
        calendarId,
        range,
        fetchedAt: incomingFetchedAt,
        upsertedCount: 0,
        deletedCount: 0,
        busyChanged: false,
        stateVersion: state.stateVersion,
      });
    }
    const existingByIdentity = new Map(
      existing.map((event) => [externalCalendarEventIdentity(event), event]),
    );
    const nextByIdentity = new Map(existingByIdentity);
    const nextObserved: ExternalCalendarEventSnapshot[] = [];
    for (const [identity, event] of observed) {
      const previous = existingByIdentity.get(identity);
      if (
        previous !== undefined &&
        Date.parse(previous.lastSeenAt) > Date.parse(incomingFetchedAt)
      ) {
        continue;
      }
      const next = createExternalCalendarEventSnapshot({
        id:
          previous?.id ??
          generateId(
            this.#snapshotIds,
            parseExternalCalendarEventSnapshotId,
            'External calendar snapshot ID',
          ),
        provider,
        calendarId,
        externalEventId: event.externalEventId,
        occurrenceKey: event.occurrenceKey,
        startAt: parseInstant(event.startAt),
        endAt: parseInstant(event.endAt),
        busy: event.busy,
        lastSeenAt: incomingFetchedAt,
        contentHash: event.contentHash,
      });
      nextObserved.push(next);
      nextByIdentity.set(identity, next);
    }
    const deletableUnseen = existing.filter(
      (event) =>
        !observed.has(externalCalendarEventIdentity(event)) &&
        Date.parse(event.lastSeenAt) <= Date.parse(incomingFetchedAt),
    );
    if (result.completeness === 'complete') {
      for (const event of deletableUnseen) {
        nextByIdentity.delete(externalCalendarEventIdentity(event));
      }
    }
    const nextSnapshots = [...nextByIdentity.values()];
    const bindings = await transaction.calendarBindings.listAll();
    const owned = new Set(
      bindings
        .filter(
          (binding) =>
            binding.ownershipVerified &&
            binding.provider === provider &&
            binding.calendarId === calendarId,
        )
        .map((binding) =>
          JSON.stringify([
            binding.provider,
            binding.calendarId,
            binding.externalEventId,
            binding.occurrenceKey,
          ]),
        ),
    );
    const busyChanged = !setsEqual(
      effectiveBusySet(existing, owned),
      effectiveBusySet(nextSnapshots, owned),
    );

    for (const snapshot of nextObserved) {
      await transaction.externalCalendarEventSnapshots.upsert(snapshot);
    }
    if (result.completeness === 'complete' && deletableUnseen.length > 0) {
      await transaction.externalCalendarEventSnapshots.deleteByIds(
        deletableUnseen.map((event) => event.id),
      );
    }
    if (result.completeness === 'complete') {
      await transaction.calendarRefreshCoverages.insert(
        createCalendarRefreshCoverage({
          id: generateId(
            this.#coverageIds,
            parseCalendarRefreshCoverageId,
            'Calendar refresh coverage ID',
          ),
          provider,
          calendarId,
          rangeStart: range.start,
          rangeEnd: range.end,
          fetchedAt: incomingFetchedAt,
          completeness: 'complete',
          observedEventCount: result.events.length,
        }),
      );
    }
    const nextState = busyChanged ? advanceStateVersion(state) : state;
    if (busyChanged) await transaction.scheduleState.update(nextState);
    return this.#result({
      status: result.completeness,
      permission,
      provider,
      calendarId,
      range,
      fetchedAt: incomingFetchedAt,
      upsertedCount: nextObserved.length,
      deletedCount:
        result.completeness === 'complete' ? deletableUnseen.length : 0,
      busyChanged,
      stateVersion: nextState.stateVersion,
    });
  }

  #result(result: CalendarRefreshResult): CalendarRefreshResult {
    const parsed = calendarRefreshResultSchema.safeParse(result);
    if (!parsed.success) {
      throw dataIntegrityError('CalendarService produced an invalid result.');
    }
    return result;
  }
}
