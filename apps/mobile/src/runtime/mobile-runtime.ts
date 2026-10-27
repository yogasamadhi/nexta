import {
  AchievementService,
  CloudSyncService,
  CloudAccountService,
  CalendarService,
  createTimeoutCalendarProvider,
  createTimeoutNotificationProvider,
  EnergyCheckInService,
  ExecutionService,
  GoalService,
  InMemoryTimeBlockAdjustmentPreviewStore,
  InMemorySchedulePreviewStore,
  IntegrationService,
  PreferenceService,
  PlanningQueryService,
  ProjectService,
  ReflectionService,
  RelaxService,
  ScheduleService,
  TaskService,
  TimeBlockAdjustmentService,
  UserModelService,
  type ApplicationUnitOfWork,
  type CalendarRefreshRangePolicy,
  type Clock,
  type IdGenerator,
  type IntegrationInventoryPolicy,
  type IntegrationJobLeasePolicy,
  type IntegrationJobRetryPolicy,
  type IntegrationProjectionPolicy,
  type WriteContext,
  type CloudTokens,
} from '@workspace/application';
import {
  createExpoCalendarAdapter,
  type ExpoCalendarAdapter,
  type ExpoCalendarAdapterOptions,
} from '@workspace/calendar';
import {
  createExpoSqliteDatabase,
  initializeSqliteApplicationUnitOfWork,
  SqliteSchedulingSnapshotPort,
  SqliteCloudLocalStore,
  createSqliteApplicationUnitOfWork,
} from '@workspace/database';
import { parseInstant } from '@workspace/domain';
import {
  createExpoNotificationsAdapter,
  type ExpoNotificationsAdapter,
  type ExpoNotificationsAdapterOptions,
} from '@workspace/notifications';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { HttpCloudAPI } from './cloud-api';
import {
  profileSecrets,
  guestCloudSecrets,
  installationId,
  prepareCloudSecretStorage,
  type CloudProfile,
} from './cloud-profiles';

import { ForegroundIntegrationCoordinator } from './integration-coordinator';
import { IntlTemporalAdapter } from './intl-temporal-adapter';
import { IntlLocalDayRangePort } from './local-day-port';
import {
  MobileNeutralSchedulingInputPolicy,
  MobilePreviewExpirationPolicy,
  MobileScheduleHorizonPolicy,
  type MobileSchedulingPolicyOptions,
} from './mobile-scheduling-policy';
import { IntlUtcWorkingWindowPort } from './working-window-port';

export type MobileRuntimeOptions = Readonly<{
  databaseName: string;
  cloud?: Readonly<{
    baseURL: string;
    profile: CloudProfile | null;
    switchProfile: (tokens: CloudTokens) => Promise<void>;
    signOut: () => Promise<void>;
  }>;
  calendar: Omit<ExpoCalendarAdapterOptions, 'clock'>;
  notifications: ExpoNotificationsAdapterOptions;
  projectionPolicy: IntegrationProjectionPolicy;
  maximumCalendarRefreshSpanMs: number;
  calendarInventoryLookbackMs: number;
  calendarInventoryLookaheadMs: number;
  integrationLeaseMs: number;
  retryBaseDelayMs: number;
  retryMaximumDelayMs: number;
  providerCallTimeoutMs: number;
  scheduling: MobileSchedulingPolicyOptions &
    Readonly<{ maximumHorizonMs: number }>;
}>;

export type MobileRuntime = Readonly<{
  nativeDatabase: SQLiteDatabase;
  cloudAccount: CloudAccountService;
  setActive(active: boolean): Promise<void>;
  unitOfWork: ApplicationUnitOfWork;
  calendarAdapter: ExpoCalendarAdapter;
  notificationsAdapter: ExpoNotificationsAdapter;
  calendarService: CalendarService;
  integrationService: IntegrationService;
  integrations: ForegroundIntegrationCoordinator;
  temporal: IntlTemporalAdapter;
  taskService: TaskService;
  goalService: GoalService;
  projectService: ProjectService;
  executionService: ExecutionService;
  achievementService: AchievementService;
  energyCheckInService: EnergyCheckInService;
  reflectionService: ReflectionService;
  relaxService: RelaxService;
  preferenceService: PreferenceService;
  scheduleService: ScheduleService;
  timeBlockAdjustments: TimeBlockAdjustmentService;
  planningQueries: PlanningQueryService;
  userModelService: UserModelService;
  createUserWriteContext(label: string): WriteContext;
  close(): Promise<void>;
}>;

class SystemClock implements Clock {
  now() {
    return parseInstant(new Date().toISOString());
  }
}

class RuntimeIdGenerator implements IdGenerator {
  #sequence = 0;

  constructor(private readonly prefix: string) {}

  generate(): string {
    this.#sequence += 1;
    const random = Math.random().toString(36).slice(2, 12);
    return `${this.prefix}_${Date.now().toString(36)}_${this.#sequence.toString(36)}_${random}`;
  }
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

const providerCallTimer = {
  schedule(callback: () => void, delayMs: number): unknown {
    return setTimeout(callback, delayMs);
  },
  cancel(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

function addMilliseconds(instant: string, milliseconds: number) {
  return parseInstant(
    new Date(Date.parse(instant) + milliseconds).toISOString(),
  );
}

function calendarRangePolicy(
  maximumSpanMs: number,
): CalendarRefreshRangePolicy {
  const maximum = positiveDuration(
    maximumSpanMs,
    'maximumCalendarRefreshSpanMs',
  );
  return {
    allows(range) {
      const span = Date.parse(range.end) - Date.parse(range.start);
      return Number.isFinite(span) && span > 0 && span <= maximum;
    },
  };
}

function leasePolicy(durationMs: number): IntegrationJobLeasePolicy {
  const duration = positiveDuration(durationMs, 'integrationLeaseMs');
  return {
    leaseExpiresAt({ claimedAt }) {
      return addMilliseconds(claimedAt, duration);
    },
  };
}

function inventoryPolicy(
  lookbackMs: number,
  lookaheadMs: number,
): IntegrationInventoryPolicy {
  const lookback = positiveDuration(lookbackMs, 'calendarInventoryLookbackMs');
  const lookahead = positiveDuration(
    lookaheadMs,
    'calendarInventoryLookaheadMs',
  );
  return {
    calendarRange({ now }) {
      const timestamp = Date.parse(now);
      return {
        start: parseInstant(new Date(timestamp - lookback).toISOString()),
        end: parseInstant(new Date(timestamp + lookahead).toISOString()),
      };
    },
  };
}

function retryPolicy(
  baseDelayMs: number,
  maximumDelayMs: number,
): IntegrationJobRetryPolicy {
  const base = positiveDuration(baseDelayMs, 'retryBaseDelayMs');
  const maximum = positiveDuration(maximumDelayMs, 'retryMaximumDelayMs');
  if (maximum < base) {
    throw new Error('retryMaximumDelayMs must not be below retryBaseDelayMs.');
  }
  return {
    nextAttemptAt({ job, finishedAt }) {
      const exponent = Math.min(Math.max(job.attemptCount - 1, 0), 12);
      const delay = Math.min(maximum, base * 2 ** exponent);
      return addMilliseconds(finishedAt, delay);
    },
  };
}

/**
 * The mobile composition root. Calling this function opens and migrates the
 * local fact source before any Application Service is exposed. Product
 * projection choices remain explicit inputs instead of hidden defaults.
 */
export async function createMobileRuntime(
  options: MobileRuntimeOptions,
): Promise<MobileRuntime> {
  if (options.databaseName.trim().length === 0) {
    throw new Error('databaseName must be non-empty.');
  }
  const inventorySpan =
    positiveDuration(
      options.calendarInventoryLookbackMs,
      'calendarInventoryLookbackMs',
    ) +
    positiveDuration(
      options.calendarInventoryLookaheadMs,
      'calendarInventoryLookaheadMs',
    );
  if (inventorySpan > options.maximumCalendarRefreshSpanMs) {
    throw new Error(
      'The calendar inventory range must fit within the adapter query limit.',
    );
  }
  const clock = new SystemClock();
  const nativeDatabase = await openDatabaseAsync(options.databaseName);
  try {
    await initializeSqliteApplicationUnitOfWork(
      createExpoSqliteDatabase(nativeDatabase),
    );
    let cloudSync: CloudSyncService | null = null;
    const database = createExpoSqliteDatabase(nativeDatabase);
    const unitOfWork = createSqliteApplicationUnitOfWork(database, () => {
      void cloudSync?.wake();
    });
    let integrationsRef: ForegroundIntegrationCoordinator | null = null;
    const localSync = new SqliteCloudLocalStore(database, () => {
      void integrationsRef?.wake();
    });
    const cloudOptions = options.cloud;
    const cloudAPI = new HttpCloudAPI(
      cloudOptions?.baseURL ?? 'https://cloud.invalid',
    );
    const secrets = cloudOptions?.profile
      ? profileSecrets(cloudOptions.profile)
      : guestCloudSecrets();
    cloudSync = new CloudSyncService({
      api: cloudAPI,
      secrets,
      local: localSync,
      onImported: () => {
        void integrationsRef?.wake();
      },
    });
    const savedTokens = await secrets.read().catch(() => null);
    if (savedTokens) await cloudSync.connect(savedTokens);
    const projectionState = await localSync.state();
    let projectionEnabled =
      projectionState.userId === null || projectionState.projectionEnabled;
    const cloudAccount = new CloudAccountService(cloudSync, localSync, {
      api: cloudAPI,
      installationId,
      prepareCredentialStorage: prepareCloudSecretStorage,
      projectionChanged: (enabled) => {
        projectionEnabled = enabled;
        void integrationsRef?.wake();
      },
      switchProfile:
        cloudOptions?.switchProfile ??
        (() => Promise.reject(new Error('Cloud profile host unavailable.'))),
      signOut: cloudOptions?.signOut ?? (() => Promise.resolve()),
    });
    const explicitProjection = options.projectionPolicy;
    const projectionPolicy: IntegrationProjectionPolicy = {
      calendarProvisioning: (provider) =>
        explicitProjection.calendarProvisioning(provider),
      calendarEvent: (context) =>
        projectionEnabled ? explicitProjection.calendarEvent(context) : null,
      notification: (context) =>
        projectionEnabled ? explicitProjection.notification(context) : null,
    };
    const [calendarAdapter, notificationsAdapter] = await Promise.all([
      createExpoCalendarAdapter({ ...options.calendar, clock }),
      createExpoNotificationsAdapter(options.notifications),
    ]);
    const calendarProvider = createTimeoutCalendarProvider(
      calendarAdapter,
      options.providerCallTimeoutMs,
      providerCallTimer,
    );
    const notificationsProvider = createTimeoutNotificationProvider(
      notificationsAdapter,
      options.providerCallTimeoutMs,
      providerCallTimer,
    );
    const calendarService = new CalendarService({
      unitOfWork,
      provider: calendarProvider,
      rangePolicy: calendarRangePolicy(options.maximumCalendarRefreshSpanMs),
      snapshotIds: new RuntimeIdGenerator('calendar_snapshot'),
      coverageIds: new RuntimeIdGenerator('calendar_coverage'),
      clock,
    });
    const integrationService = new IntegrationService({
      unitOfWork,
      calendar: calendarProvider,
      notifications: notificationsProvider,
      projectionPolicy,
      inventoryPolicy: inventoryPolicy(
        options.calendarInventoryLookbackMs,
        options.calendarInventoryLookaheadMs,
      ),
      leasePolicy: leasePolicy(options.integrationLeaseMs),
      retryPolicy: retryPolicy(
        options.retryBaseDelayMs,
        options.retryMaximumDelayMs,
      ),
      clock,
      ids: {
        claim: new RuntimeIdGenerator('integration_claim'),
        calendarContainerBinding: new RuntimeIdGenerator('calendar_container'),
        calendarBinding: new RuntimeIdGenerator('calendar_binding'),
        notificationBinding: new RuntimeIdGenerator('notification_binding'),
        externalMutationIntent: new RuntimeIdGenerator('external_intent'),
      },
    });
    const integrations = new ForegroundIntegrationCoordinator({
      worker: integrationService,
    });
    integrationsRef = integrations;
    const temporal = new IntlTemporalAdapter();
    const snapshots = new SqliteSchedulingSnapshotPort({
      unitOfWork,
      workingWindows: new IntlUtcWorkingWindowPort(temporal),
      horizonPolicy: new MobileScheduleHorizonPolicy(options.scheduling),
      inputPolicy: new MobileNeutralSchedulingInputPolicy(options.scheduling),
      maximumHorizonMs: options.scheduling.maximumHorizonMs,
    });
    const preferenceService = new PreferenceService({
      unitOfWork,
      clock,
      idGenerator: new RuntimeIdGenerator('user_preference'),
      integrationWakeup: integrations,
    });
    const userModelService = new UserModelService({
      unitOfWork,
      clock,
      featureIds: new RuntimeIdGenerator('user_model_feature'),
      localHour: temporal,
    });
    const taskService = new TaskService({
      unitOfWork,
      clock,
      localTimeProvider: temporal,
      idGenerator: new RuntimeIdGenerator('task'),
      integrationWakeup: integrations,
    });
    const goalService = new GoalService({
      unitOfWork,
      clock,
      idGenerator: new RuntimeIdGenerator('goal'),
    });
    const projectService = new ProjectService({
      unitOfWork,
      clock,
      idGenerator: new RuntimeIdGenerator('project'),
    });
    const executionService = new ExecutionService({
      unitOfWork,
      clock,
      localTimeProvider: temporal,
      ids: {
        session: new RuntimeIdGenerator('execution_session'),
        interval: new RuntimeIdGenerator('execution_interval'),
        activity: new RuntimeIdGenerator('execution_activity'),
        completionRecord: new RuntimeIdGenerator('completion_record'),
        achievement: new RuntimeIdGenerator('achievement'),
        schedulePlan: new RuntimeIdGenerator('execution_plan'),
        integrationJob: new RuntimeIdGenerator('execution_job'),
      },
      integrationWakeup: integrations,
    });
    const achievementService = new AchievementService({
      unitOfWork,
      clock,
      idGenerator: new RuntimeIdGenerator('achievement'),
    });
    const energyCheckInService = new EnergyCheckInService({
      unitOfWork,
      clock,
      localTimeProvider: temporal,
      idGenerator: new RuntimeIdGenerator('energy_check_in'),
    });
    const reflectionService = new ReflectionService({
      unitOfWork,
      clock,
      idGenerator: new RuntimeIdGenerator('daily_reflection'),
    });
    const relaxService = new RelaxService({
      unitOfWork,
      clock,
      idGenerator: new RuntimeIdGenerator('relax_session'),
    });
    const scheduleService = new ScheduleService({
      unitOfWork,
      snapshots,
      previews: new InMemorySchedulePreviewStore(),
      expirationPolicy: new MobilePreviewExpirationPolicy(options.scheduling),
      clock,
      ids: {
        preview: new RuntimeIdGenerator('schedule_preview'),
        schedulePlan: new RuntimeIdGenerator('schedule_plan'),
        timeBlock: new RuntimeIdGenerator('time_block'),
        integrationJob: new RuntimeIdGenerator('integration_job'),
      },
      integrationWakeup: integrations,
    });
    const timeBlockAdjustments = new TimeBlockAdjustmentService({
      unitOfWork,
      snapshots,
      previews: new InMemoryTimeBlockAdjustmentPreviewStore(),
      expirationPolicy: new MobilePreviewExpirationPolicy(options.scheduling),
      clock,
      ids: {
        preview: new RuntimeIdGenerator('adjustment_preview'),
        schedulePlan: new RuntimeIdGenerator('adjustment_plan'),
        integrationJob: new RuntimeIdGenerator('adjustment_job'),
      },
      integrationWakeup: integrations,
    });
    const planningQueries = new PlanningQueryService({
      unitOfWork,
      clock,
      localTime: temporal,
      days: new IntlLocalDayRangePort(temporal),
      integrations: integrationService,
    });
    const operationIds = new RuntimeIdGenerator('user_operation');
    let closed = false;
    return {
      cloudAccount,
      async setActive(active) {
        await Promise.all([
          integrations.setActive(active),
          cloudSync!.setActive(active),
        ]);
      },
      nativeDatabase,
      unitOfWork,
      calendarAdapter,
      notificationsAdapter,
      calendarService,
      integrationService,
      integrations,
      temporal,
      taskService,
      goalService,
      projectService,
      executionService,
      achievementService,
      energyCheckInService,
      reflectionService,
      relaxService,
      preferenceService,
      scheduleService,
      timeBlockAdjustments,
      planningQueries,
      userModelService,
      createUserWriteContext(label) {
        if (label.trim().length === 0) {
          throw new Error('User operation label must be non-empty.');
        }
        return {
          operationId: `${label}_${operationIds.generate()}`,
          authority: { kind: 'user' },
        };
      },
      async close() {
        if (closed) return;
        closed = true;
        await cloudSync!.setActive(false);
        await integrations.setActive(false);
        await nativeDatabase.closeAsync();
      },
    };
  } catch (error) {
    await nativeDatabase.closeAsync();
    throw error;
  }
}
