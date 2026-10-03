import {
  IntegrationService,
  createTimeoutCalendarProvider,
  createTimeoutNotificationProvider,
  hashOperationParameters,
  type AppCalendarEventInput,
  type AppEventIdentity,
  type AppEventReconciliation,
  type CalendarProvider,
  type EnsureAppCalendarInput,
  type IntegrationProjectionPolicy,
  type LocalNotificationInput,
  type NotificationIdentity,
  type NotificationProvider,
  type NotificationReconciliation,
  type OwnedAppEventRef,
  type OwnedNotificationRef,
} from '@workspace/application';
import {
  cancelTask,
  createCalendarBinding,
  createCalendarContainerBinding,
  createExternalMutationIntent,
  createIntegrationJob,
  createNotificationBinding,
  createTask,
  createTimeBlock,
  createUserPreference,
  parseCalendarBindingId,
  parseCalendarContainerBindingId,
  parseExternalMutationIntentId,
  parseInstant,
  parseIntegrationJobId,
  parseNotificationBindingId,
  parseOperationId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseUserPreferenceId,
  type CalendarBinding,
  type Instant,
  type IntegrationJob,
  type NotificationBinding,
  type Task,
  type TimeBlock,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

import { MemoryUnitOfWork, QueueIdGenerator, createMemoryState } from './fakes';

const CREATED = parseInstant('2026-09-12T07:00:00.000Z');
const NOW = parseInstant('2026-09-12T08:00:00.000Z');
const RETRY_AT = parseInstant('2026-09-12T09:00:00.000Z');
const LEASE_END = parseInstant('2026-09-12T10:00:00.000Z');
const OLD_START = parseInstant('2026-09-12T11:00:00.000Z');
const OLD_END = parseInstant('2026-09-12T12:00:00.000Z');
const NEW_START = parseInstant('2026-09-12T13:00:00.000Z');
const NEW_END = parseInstant('2026-09-12T14:00:00.000Z');

const providerCallTimer = {
  schedule: (callback: () => void, delayMs: number): unknown =>
    setTimeout(callback, delayMs),
  cancel: (handle: unknown): void =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function oneHourAfter(instant: Instant): Instant {
  return parseInstant(
    new Date(Date.parse(instant) + 60 * 60 * 1000).toISOString(),
  );
}

function minutesBefore(instant: Instant, minutes: number): Instant {
  return parseInstant(
    new Date(Date.parse(instant) - minutes * 60 * 1000).toISOString(),
  );
}

function permission(status: 'granted' | 'denied' = 'granted') {
  return {
    status,
    canAskAgain: false,
    settingsRequired: status === 'denied',
  } as const;
}

class MutableClock {
  current: Instant = NOW;

  now(): Instant {
    return this.current;
  }
}

class FakeCalendarProvider implements CalendarProvider {
  readonly provider = 'system';
  permissionState: unknown = {
    read: permission('granted'),
    write: permission('granted'),
  };
  permissionRequest: unknown = this.permissionState;
  ensureResult: unknown = {
    outcome: 'succeeded',
    ref: {
      provider: 'system',
      calendarId: 'owned-calendar',
      ownershipKey: 'nexta-owned',
      ownershipVerified: true,
    },
  };
  readonly ensureCalls: EnsureAppCalendarInput[] = [];
  readonly reconcileCalls: AppEventIdentity[] = [];
  readonly createCalls: AppCalendarEventInput[] = [];
  readonly updateCalls: {
    ref: OwnedAppEventRef;
    patch: Parameters<CalendarProvider['updateAppEvent']>[1];
  }[] = [];
  readonly deleteCalls: OwnedAppEventRef[] = [];
  readonly inventoryCalls: Parameters<
    CalendarProvider['listOwnedAppEvents']
  >[0][] = [];
  inventoryResult: unknown = null;
  reconcileResults: unknown[] = [];
  createResults: unknown[] = [];
  updateResults: unknown[] = [];
  deleteResults: unknown[] = [];
  permissionReads = 0;
  permissionRequests = 0;
  failPermissionRead = false;
  onCreate: (() => void) | null = null;

  getPermissionState(): Promise<unknown> {
    this.permissionReads += 1;
    if (this.failPermissionRead) {
      return Promise.reject(new Error('calendar permission read failed'));
    }
    return Promise.resolve(this.permissionState);
  }

  requestPermission(_access: 'read' | 'write'): Promise<unknown> {
    this.permissionRequests += 1;
    return Promise.resolve(this.permissionRequest);
  }

  listCalendars(): Promise<unknown> {
    return Promise.resolve([]);
  }

  listBusyEvents(): Promise<unknown> {
    throw new Error('not used by IntegrationService');
  }

  ensureAppCalendar(input: EnsureAppCalendarInput): Promise<unknown> {
    this.ensureCalls.push(input);
    return Promise.resolve(this.ensureResult);
  }

  createAppEvent(input: AppCalendarEventInput): Promise<unknown> {
    this.createCalls.push(input);
    this.onCreate?.();
    return Promise.resolve(
      this.createResults.shift() ?? {
        outcome: 'succeeded',
        ref: eventRef(),
      },
    );
  }

  updateAppEvent(
    ref: OwnedAppEventRef,
    patch: Parameters<CalendarProvider['updateAppEvent']>[1],
  ): Promise<unknown> {
    this.updateCalls.push({ ref, patch });
    return Promise.resolve(
      this.updateResults.shift() ?? {
        outcome: 'succeeded',
        ref: eventRef(ref.externalEventId, ref.occurrenceKey),
      },
    );
  }

  deleteAppEvent(ref: OwnedAppEventRef): Promise<unknown> {
    this.deleteCalls.push(ref);
    return Promise.resolve(
      this.deleteResults.shift() ?? { outcome: 'succeeded' },
    );
  }

  reconcileAppEvent(identity: AppEventIdentity): Promise<unknown> {
    this.reconcileCalls.push(identity);
    const value = this.reconcileResults.shift();
    if (value === undefined) throw new Error('Missing calendar reconciliation');
    return Promise.resolve(value);
  }

  listOwnedAppEvents(
    input: Parameters<CalendarProvider['listOwnedAppEvents']>[0],
  ): Promise<unknown> {
    this.inventoryCalls.push(input);
    if (this.inventoryResult !== null) {
      return Promise.resolve(this.inventoryResult);
    }
    return Promise.resolve({
      status: 'complete',
      provider: input.calendar.provider,
      calendarId: input.calendar.calendarId,
      range: input.range,
      events: [],
    });
  }
}

class FakeNotificationProvider implements NotificationProvider {
  permissionState: unknown = permission('granted');
  permissionRequest: unknown = permission('granted');
  readonly reconcileCalls: NotificationIdentity[] = [];
  readonly scheduleCalls: LocalNotificationInput[] = [];
  readonly cancelCalls: OwnedNotificationRef[] = [];
  reconcileResults: unknown[] = [];
  scheduleResults: unknown[] = [];
  cancelResults: unknown[] = [];
  permissionReads = 0;
  permissionRequests = 0;
  inventoryResult: unknown = { status: 'complete', notifications: [] };
  onSchedule: (() => void) | null = null;

  getPermissionState(): Promise<unknown> {
    this.permissionReads += 1;
    return Promise.resolve(this.permissionState);
  }

  requestPermission(): Promise<unknown> {
    this.permissionRequests += 1;
    return Promise.resolve(this.permissionRequest);
  }

  schedule(input: LocalNotificationInput): Promise<unknown> {
    this.scheduleCalls.push(input);
    this.onSchedule?.();
    return Promise.resolve(
      this.scheduleResults.shift() ?? {
        outcome: 'succeeded',
        ref: notificationRef(input.identity.timeBlockId, input.type),
      },
    );
  }

  cancel(ref: OwnedNotificationRef): Promise<unknown> {
    this.cancelCalls.push(ref);
    return Promise.resolve(
      this.cancelResults.shift() ?? { outcome: 'succeeded' },
    );
  }

  cancelMany(refs: readonly OwnedNotificationRef[]): Promise<unknown> {
    this.cancelCalls.push(...refs);
    return Promise.resolve({ outcome: 'succeeded' });
  }

  reconcile(identity: NotificationIdentity): Promise<unknown> {
    this.reconcileCalls.push(identity);
    const value = this.reconcileResults.shift();
    if (value === undefined) {
      throw new Error('Missing notification reconciliation');
    }
    return Promise.resolve(value);
  }

  listOwnedScheduledNotifications(): Promise<unknown> {
    return Promise.resolve(this.inventoryResult);
  }
}

function task(id = 'task-1'): Task {
  return createTask({
    id: parseTaskId(id),
    title: 'Deep work',
    priority: 'opaque-priority',
    estimatedDurationMinutes: 60,
    splittable: false,
    schedulingPolicy: 'opaque-policy',
    source: 'manual',
    createdAt: CREATED,
  });
}

function block(
  startAt: Instant = NEW_START,
  endAt: Instant = NEW_END,
): TimeBlock {
  return createTimeBlock({
    id: parseTimeBlockId('block-1'),
    taskId: parseTaskId('task-1'),
    type: 'task',
    startAt,
    endAt,
    status: 'planned',
    source: 'scheduler',
    locked: false,
    planRevision: 1,
    createdAt: CREATED,
  });
}

function job(
  channel: 'calendar' | 'notification',
  overrides: Partial<Parameters<typeof createIntegrationJob>[0]> = {},
): IntegrationJob {
  return createIntegrationJob({
    id: parseIntegrationJobId(`${channel}-job-1`),
    operationId: parseOperationId('operation-1'),
    targetChannel: channel,
    targetEntityType: 'schedule_plan',
    targetEntityId: parseSchedulePlanId('plan-1'),
    desiredRevision: 1,
    desiredAction: 'reconcile',
    createdAt: CREATED,
    ...overrides,
  });
}

function calendarCreateIntent(
  owner: IntegrationJob,
  overrides: Partial<Parameters<typeof createExternalMutationIntent>[0]> = {},
) {
  return createExternalMutationIntent({
    id: parseExternalMutationIntentId(`intent-for-${owner.id}`),
    integrationJobId: owner.id,
    desiredRevision: owner.desiredRevision,
    action: 'calendar_event_create',
    payload: {
      provider: 'system',
      calendarId: 'owned-calendar',
      ownershipKey: 'nexta-owned',
      timeBlockId: parseTimeBlockId('block-1'),
      searchStartAt: OLD_START,
      searchEndAt: OLD_END,
      externalEventId: null,
      occurrenceKey: null,
      expectedContentHash: null,
      desiredContentHash: calendarHash(OLD_START, OLD_END),
      desiredStartAt: OLD_START,
      desiredEndAt: OLD_END,
    },
    createdAt: CREATED,
    ...overrides,
  });
}

function eventRef(
  externalEventId = 'event-1',
  occurrenceKey: string | null = null,
) {
  return {
    provider: 'system',
    calendarId: 'owned-calendar',
    externalEventId,
    occurrenceKey,
  };
}

function calendarResult(
  status: 'found' | 'conflict',
  contentHash: string,
  startAt: Instant,
  endAt: Instant,
  externalEventId = 'event-1',
  occurrenceKey: string | null = null,
): AppEventReconciliation {
  return {
    status,
    ref: eventRef(externalEventId, occurrenceKey),
    contentHash,
    startAt,
    endAt,
    ownershipVerified: true,
  };
}

function notificationRef(timeBlockId = 'block-1', type = 'start_reminder') {
  return {
    osNotificationId: 'notification-1',
    identity: { timeBlockId: parseTimeBlockId(timeBlockId), type },
  };
}

function notificationResult(
  status: 'found' | 'conflict',
  contentHash: string,
  scheduledAt: Instant,
): NotificationReconciliation {
  return {
    status,
    ref: notificationRef(),
    contentHash,
    scheduledAt,
    identityVerified: true,
  };
}

function calendarHash(startAt = NEW_START, endAt = NEW_END) {
  return hashOperationParameters({ title: 'Deep work', startAt, endAt });
}

function notificationHash(scheduledAt = NEW_START) {
  return hashOperationParameters({
    title: 'Deep work',
    body: null,
    scheduledAt,
    type: 'start_reminder',
  });
}

const projectionPolicy: IntegrationProjectionPolicy = {
  calendarProvisioning: (provider) => ({
    provider,
    ownershipKey: 'nexta-owned',
    title: 'Nexta',
    color: null,
    androidSource: null,
  }),
  calendarEvent: ({ block: current, task: currentTask }) => ({
    title: currentTask?.title ?? current.id,
    startAt: current.startAt,
    endAt: current.endAt,
  }),
  notification: ({
    block: current,
    task: currentTask,
    notificationLeadMinutes,
  }) => ({
    title: currentTask?.title ?? current.id,
    body: null,
    scheduledAt: minutesBefore(current.startAt, notificationLeadMinutes ?? 0),
    type: 'start_reminder',
  }),
};

function calendarContainer() {
  return createCalendarContainerBinding({
    id: parseCalendarContainerBindingId('container-1'),
    provider: 'system',
    calendarId: 'owned-calendar',
    ownershipKey: 'nexta-owned',
    ownershipVerified: true,
    status: 'synced',
    verifiedAt: CREATED,
    createdAt: CREATED,
  });
}

function calendarBinding(
  appliedContentHash: string,
  appliedStartAt = OLD_START,
  appliedEndAt = OLD_END,
  occurrenceKey: string | null = null,
): CalendarBinding {
  return createCalendarBinding({
    id: parseCalendarBindingId('calendar-binding-1'),
    timeBlockId: parseTimeBlockId('block-1'),
    provider: 'system',
    calendarId: 'owned-calendar',
    externalEventId: 'event-1',
    occurrenceKey,
    ownershipKey: 'nexta-owned',
    ownershipVerified: true,
    appliedContentHash,
    appliedStartAt,
    appliedEndAt,
    lastAppliedRevision: 0,
    status: 'synced',
    verifiedAt: CREATED,
    createdAt: CREATED,
  });
}

function notificationBinding(appliedContentHash: string): NotificationBinding {
  return createNotificationBinding({
    id: parseNotificationBindingId('notification-binding-1'),
    timeBlockId: parseTimeBlockId('block-1'),
    taskId: parseTaskId('task-1'),
    osNotificationId: 'notification-1',
    type: 'start_reminder',
    appliedContentHash,
    scheduledAt: OLD_START,
    desiredRevision: 1,
    lastAppliedRevision: 0,
    status: 'pending',
    identityVerified: true,
    verifiedAt: CREATED,
    createdAt: CREATED,
  });
}

type FixtureOptions = Readonly<{
  channel?: 'calendar' | 'notification';
  planRevision?: number;
  desiredRevision?: number;
  currentTask?: Task;
  currentBlock?: TimeBlock;
  existingCalendarBinding?: CalendarBinding;
  existingNotificationBinding?: NotificationBinding;
  providerCallTimeoutMs?: number;
}>;

function fixture(options: FixtureOptions = {}) {
  const channel = options.channel ?? 'calendar';
  const currentTask = options.currentTask ?? task();
  const currentBlock = options.currentBlock ?? block();
  const state = createMemoryState();
  state.scheduleState = {
    stateVersion: 1,
    planRevision: options.planRevision ?? 1,
  };
  state.tasks.set(currentTask.id, currentTask);
  state.timeBlocks.set(currentBlock.id, currentBlock);
  const currentJob = job(channel, {
    desiredRevision: options.desiredRevision ?? 1,
  });
  state.integrationJobs.set(currentJob.id, currentJob);
  if (options.existingCalendarBinding !== undefined) {
    const container = calendarContainer();
    state.calendarContainerBindings.set(container.id, container);
    state.calendarBindings.set(
      options.existingCalendarBinding.id,
      options.existingCalendarBinding,
    );
  }
  if (options.existingNotificationBinding !== undefined) {
    state.notificationBindings.set(
      options.existingNotificationBinding.id,
      options.existingNotificationBinding,
    );
  }
  const unitOfWork = new MemoryUnitOfWork(state);
  const calendar = new FakeCalendarProvider();
  const notifications = new FakeNotificationProvider();
  const clock = new MutableClock();
  const calendarBoundary =
    options.providerCallTimeoutMs === undefined
      ? calendar
      : createTimeoutCalendarProvider(
          calendar,
          options.providerCallTimeoutMs,
          providerCallTimer,
        );
  const notificationBoundary =
    options.providerCallTimeoutMs === undefined
      ? notifications
      : createTimeoutNotificationProvider(
          notifications,
          options.providerCallTimeoutMs,
          providerCallTimer,
        );
  const service = new IntegrationService({
    unitOfWork,
    calendar: calendarBoundary,
    notifications: notificationBoundary,
    projectionPolicy,
    inventoryPolicy: {
      calendarRange: () => ({ start: CREATED, end: LEASE_END }),
    },
    leasePolicy: { leaseExpiresAt: () => LEASE_END },
    retryPolicy: {
      nextAttemptAt: ({ finishedAt }) => oneHourAfter(finishedAt),
    },
    clock,
    ids: {
      claim: new QueueIdGenerator('claim-1', 'claim-2', 'claim-3', 'claim-4'),
      calendarContainerBinding: new QueueIdGenerator(
        'container-1',
        'container-2',
      ),
      calendarBinding: new QueueIdGenerator(
        'calendar-binding-1',
        'calendar-binding-2',
      ),
      notificationBinding: new QueueIdGenerator(
        'notification-binding-1',
        'notification-binding-2',
      ),
      externalMutationIntent: new QueueIdGenerator(
        'intent-1',
        'intent-2',
        'intent-3',
        'intent-4',
        'intent-5',
        'intent-6',
        'intent-7',
        'intent-8',
      ),
    },
  });
  return {
    service,
    unitOfWork,
    calendar,
    notifications,
    clock,
    currentJob,
    currentBlock,
  };
}

describe('IntegrationService synchronization and recovery', () => {
  it('bounds a hanging provider and keeps durable work eligible for a later retry', async () => {
    const test = fixture({
      channel: 'notification',
      providerCallTimeoutMs: 5,
    });
    test.notifications.permissionState = new Promise(() => undefined);

    await expect(
      test.service.processNext('notification'),
    ).resolves.toMatchObject({
      status: 'failed',
    });
    expect(
      test.unitOfWork.state.integrationJobs.get(test.currentJob.id),
    ).toMatchObject({
      status: 'failed',
      lastErrorCode: 'provider_timeout',
      automaticRetryEligible: true,
      notBefore: RETRY_AT,
    });
  });

  it('reconciles notifications only for the current plan revision', async () => {
    const test = fixture({ channel: 'notification', planRevision: 2 });

    await expect(test.service.reconcileNotifications(1)).rejects.toMatchObject({
      code: 'plan_conflict',
      retryable: false,
    });
    expect(test.notifications.permissionReads).toBe(0);

    await expect(test.service.reconcileNotifications(2)).resolves.toMatchObject(
      {
        channel: 'notification',
        currentPlanRevision: 2,
      },
    );
  });

  it('projects the current TimeBlock into a verified calendar binding and exposes current status', async () => {
    const test = fixture();
    const hash = calendarHash();
    test.calendar.reconcileResults = [
      { status: 'missing' },
      calendarResult('found', hash, NEW_START, NEW_END),
    ];

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'succeeded',
      desiredRevision: 1,
    });
    expect(test.calendar.createCalls).toHaveLength(1);
    expect(
      [...test.unitOfWork.state.calendarBindings.values()][0],
    ).toMatchObject({
      timeBlockId: 'block-1',
      appliedContentHash: hash,
      lastAppliedRevision: 1,
      status: 'synced',
    });
    await expect(test.service.getCurrentStatus()).resolves.toMatchObject({
      planRevision: 1,
      calendar: {
        status: 'synced',
        desiredRevision: 1,
        lastErrorCode: null,
        bindingConflictCount: 0,
      },
      notifications: { status: 'not_started' },
    });
  });

  it('commits a durable intent before invoking an external event mutation', async () => {
    const test = fixture();
    const hash = calendarHash();
    let observedIntent: unknown = null;
    test.calendar.onCreate = () => {
      observedIntent = [
        ...test.unitOfWork.state.externalMutationIntents.values(),
      ][0];
    };
    test.calendar.reconcileResults = [
      { status: 'missing' },
      calendarResult('found', hash, NEW_START, NEW_END),
    ];

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(observedIntent).toMatchObject({
      action: 'calendar_event_create',
      integrationJobId: 'calendar-job-1',
      desiredRevision: 1,
    });
    expect(test.unitOfWork.state.externalMutationIntents.size).toBe(0);
  });

  it('uses current blocks according to explicit policy even when the Task is canceled', async () => {
    const canceled = cancelTask(task(), { canceledAt: NOW });
    const test = fixture({ channel: 'notification', currentTask: canceled });
    const hash = notificationHash();
    test.notifications.reconcileResults = [
      { status: 'missing' },
      notificationResult('found', hash, NEW_START),
    ];

    await expect(
      test.service.processNext('notification'),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(test.notifications.scheduleCalls).toHaveLength(1);
    expect(
      [...test.unitOfWork.state.notificationBindings.values()][0],
    ).toMatchObject({ lastAppliedRevision: 1, status: 'synced' });
  });

  it('projects notifications from the validated lead-time preference captured with local facts', async () => {
    const test = fixture({ channel: 'notification' });
    const scheduledAt = minutesBefore(NEW_START, 15);
    const preference = createUserPreference({
      id: parseUserPreferenceId('notification-lead'),
      key: 'notification.leadMinutes.v1',
      valueJson: { leadMinutes: 15 },
      updatedAt: CREATED,
    });
    test.unitOfWork.state.userPreferences.set(preference.id, preference);
    test.notifications.reconcileResults = [
      { status: 'missing' },
      notificationResult('found', notificationHash(scheduledAt), scheduledAt),
    ];

    await expect(
      test.service.processNext('notification'),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(test.notifications.scheduleCalls).toHaveLength(1);
    expect(test.notifications.scheduleCalls[0]).toMatchObject({ scheduledAt });
  });

  it('requeues a successful projection when local state changes during an in-flight provider call', async () => {
    const test = fixture({ channel: 'notification' });
    const hash = notificationHash();
    test.notifications.reconcileResults = [
      { status: 'missing' },
      notificationResult('found', hash, NEW_START),
    ];
    test.notifications.onSchedule = () => {
      test.unitOfWork.state.scheduleState = {
        stateVersion: 2,
        planRevision: 1,
      };
    };

    await expect(
      test.service.processNext('notification'),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(
      test.unitOfWork.state.integrationJobs.get(test.currentJob.id),
    ).toMatchObject({
      status: 'pending',
      automaticRetryEligible: true,
      notBefore: NOW,
    });
  });

  it('never prompts in the worker and only requeues permission-blocked jobs after an explicit foreground grant', async () => {
    const test = fixture({ channel: 'notification' });
    test.notifications.permissionState = permission('denied');

    await expect(
      test.service.processNext('notification'),
    ).resolves.toMatchObject({ status: 'permission_required' });
    expect(test.notifications.permissionRequests).toBe(0);
    expect(
      test.unitOfWork.state.integrationJobs.get('notification-job-1'),
    ).toMatchObject({
      status: 'permission_required',
      automaticRetryEligible: false,
    });

    await expect(
      test.service.getNotificationPermissionState(),
    ).resolves.toMatchObject({ status: 'denied', settingsRequired: true });
    expect(test.notifications.permissionRequests).toBe(0);
    await expect(
      test.service.requestNotificationPermission(),
    ).resolves.toMatchObject({ status: 'granted' });
    expect(
      test.unitOfWork.state.integrationJobs.get('notification-job-1'),
    ).toMatchObject({ status: 'pending', automaticRetryEligible: true });
  });

  it('does not requeue a blocked job through the wrong channel', async () => {
    const test = fixture({ channel: 'notification' });
    const blocked = job('notification', {
      status: 'reconciliation_required',
      lastErrorCode: 'notification_external_conflict',
      automaticRetryEligible: false,
    });
    test.unitOfWork.state.integrationJobs.set(blocked.id, blocked);

    await expect(
      test.unitOfWork.transaction((transaction) =>
        transaction.integrationJobs.requeueBlockedJob({
          jobId: blocked.id,
          channel: 'calendar',
          requeuedAt: NOW,
          notBefore: NOW,
        }),
      ),
    ).resolves.toBe(false);
    expect(test.unitOfWork.state.integrationJobs.get(blocked.id)).toMatchObject(
      { status: 'reconciliation_required' },
    );
  });

  it('rejects contradictory permission metadata at the service boundary', async () => {
    const test = fixture({ channel: 'notification' });
    test.notifications.permissionState = {
      status: 'denied',
      canAskAgain: false,
      settingsRequired: false,
    };

    await expect(test.service.getNotificationPermissionState()).rejects.toEqual(
      expect.objectContaining({ code: 'adapter_error' }),
    );
  });

  it('supersedes stale work before any provider call', async () => {
    const test = fixture({ planRevision: 2, desiredRevision: 1 });

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'superseded',
    });
    expect(test.calendar.permissionReads).toBe(0);
    expect(
      test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
    ).toMatchObject({ status: 'superseded', automaticRetryEligible: false });
  });

  it('keeps only a pending recovery checkpoint when the plan changes after an external write', async () => {
    const test = fixture();
    const hash = calendarHash();
    test.calendar.reconcileResults = [
      { status: 'missing' },
      calendarResult('found', hash, NEW_START, NEW_END),
    ];
    test.calendar.onCreate = () => {
      test.unitOfWork.state.scheduleState = {
        stateVersion: 2,
        planRevision: 2,
      };
    };

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'superseded',
    });
    expect(test.unitOfWork.state.calendarContainerBindings.size).toBe(1);
    expect(
      [...test.unitOfWork.state.calendarBindings.values()][0],
    ).toMatchObject({ status: 'pending', lastAppliedRevision: 1 });
    expect(test.unitOfWork.state.externalMutationIntents.size).toBe(0);
  });

  it('does not automatically retry malformed calendar provisioning after an uncertain provider boundary', async () => {
    const test = fixture();
    test.calendar.ensureResult = {
      outcome: 'succeeded',
      ref: { provider: 'system', calendarId: 'owned-calendar' },
    };

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    expect(
      test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
    ).toMatchObject({
      status: 'reconciliation_required',
      automaticRetryEligible: false,
    });
    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'idle',
    });
    expect(test.calendar.ensureCalls).toHaveLength(1);
  });

  it('keeps the committed local plan intact when a provider read fails', async () => {
    const test = fixture();
    test.calendar.failPermissionRead = true;

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    expect(test.unitOfWork.state.timeBlocks.get('block-1')).toEqual(
      test.currentBlock,
    );
    expect(test.unitOfWork.state.scheduleState).toEqual({
      stateVersion: 1,
      planRevision: 1,
    });
    expect(
      test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
    ).toMatchObject({
      status: 'reconciliation_required',
      automaticRetryEligible: false,
    });
  });

  it('reclaims an expired lease with a new attempt before reconciling external state', async () => {
    const test = fixture();
    const expiredLease = parseInstant('2026-09-12T07:30:00.000Z');
    const abandoned = job('calendar', {
      status: 'processing',
      attemptCount: 1,
      automaticRetryEligible: true,
      claimToken: 'abandoned-claim',
      leaseExpiresAt: expiredLease,
      updatedAt: CREATED,
    });
    test.unitOfWork.state.integrationJobs.set(abandoned.id, abandoned);
    const hash = calendarHash();
    test.calendar.reconcileResults = [
      { status: 'missing' },
      calendarResult('found', hash, NEW_START, NEW_END),
    ];

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'succeeded',
      recoveredExpiredLease: true,
    });
    expect(
      test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
    ).toMatchObject({ status: 'succeeded', attemptCount: 2 });
  });

  it('recovers an expired channel lease before a newer pending revision', async () => {
    const test = fixture({ planRevision: 2, desiredRevision: 2 });
    const expired = createIntegrationJob({
      ...job('calendar', {
        id: parseIntegrationJobId('calendar-job-expired'),
        operationId: parseOperationId('operation-expired'),
        desiredRevision: 1,
      }),
      status: 'processing',
      attemptCount: 1,
      automaticRetryEligible: true,
      claimToken: 'abandoned-claim',
      leaseExpiresAt: parseInstant('2026-09-12T07:30:00.000Z'),
      updatedAt: CREATED,
    });
    test.unitOfWork.state.integrationJobs.set(expired.id, expired);

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      jobId: 'calendar-job-expired',
      status: 'superseded',
      recoveredExpiredLease: true,
    });
    expect(
      test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
    ).toMatchObject({ status: 'pending', desiredRevision: 2 });
  });

  it('prioritizes an eligible job with a durable intent before a newer revision', async () => {
    const test = fixture({ planRevision: 2, desiredRevision: 2 });
    const recoveryJob = job('calendar', {
      id: parseIntegrationJobId('calendar-job-recovery'),
      operationId: parseOperationId('operation-recovery'),
      desiredRevision: 1,
      status: 'reconciliation_required',
      lastErrorCode: 'external_mutation_intent_pending',
      automaticRetryEligible: true,
    });
    const intent = calendarCreateIntent(recoveryJob);
    test.unitOfWork.state.integrationJobs.set(recoveryJob.id, recoveryJob);
    test.unitOfWork.state.externalMutationIntents.set(intent.id, intent);

    await expect(
      test.unitOfWork.transaction((transaction) =>
        transaction.integrationJobs.claimNext({
          channel: 'calendar',
          claimToken: 'direct-claim',
          claimedAt: NOW,
          leaseExpiresAt: LEASE_END,
        }),
      ),
    ).resolves.toMatchObject({
      job: { id: 'calendar-job-recovery', status: 'processing' },
    });
  });

  it('defers a safely reconcilable lost event-create response and converges without creating twice', async () => {
    const test = fixture();
    const hash = calendarHash();
    test.calendar.createResults = [{ outcome: 'unknown' }];
    test.calendar.reconcileResults = [
      { status: 'missing' },
      calendarResult('found', hash, NEW_START, NEW_END),
      calendarResult('found', hash, NEW_START, NEW_END),
    ];

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    expect(
      test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
    ).toMatchObject({ automaticRetryEligible: true, notBefore: RETRY_AT });
    expect(
      [...test.unitOfWork.state.externalMutationIntents.values()][0],
    ).toMatchObject({ action: 'calendar_event_create' });
    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'idle',
    });
    test.clock.current = RETRY_AT;
    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(test.calendar.createCalls).toHaveLength(1);
    expect(test.unitOfWork.state.externalMutationIntents.size).toBe(0);
  });

  it('keeps a durable intent reachable after readback failure without repeating the mutation', async () => {
    const test = fixture();
    test.calendar.createResults = [{ outcome: 'unknown' }];
    test.calendar.reconcileResults = [{ status: 'missing' }];

    await test.service.processNext('calendar');
    test.clock.current = RETRY_AT;
    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });

    expect(test.calendar.createCalls).toHaveLength(1);
    expect(test.unitOfWork.state.externalMutationIntents.size).toBe(1);
    expect(
      test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
    ).toMatchObject({
      automaticRetryEligible: true,
      notBefore: LEASE_END,
      lastErrorCode: 'external_mutation_intent_pending',
    });
  });

  it('never automatically retries an unknown calendar-container creation', async () => {
    const test = fixture();
    test.calendar.ensureResult = { outcome: 'unknown' };

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    expect(
      test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
    ).toMatchObject({
      lastErrorCode: 'calendar_provisioning_unknown',
      automaticRetryEligible: false,
    });
    test.clock.current = RETRY_AT;
    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'idle',
    });
    expect(test.calendar.ensureCalls).toHaveLength(1);
  });

  it('preserves a write-ahead intent instead of repeating a timed-out calendar mutation', async () => {
    const test = fixture({ providerCallTimeoutMs: 5 });
    test.calendar.ensureResult = new Promise(() => undefined);

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    expect(test.calendar.ensureCalls).toHaveLength(1);
    expect(
      [...test.unitOfWork.state.externalMutationIntents.values()][0],
    ).toMatchObject({
      integrationJobId: test.currentJob.id,
      action: 'calendar_provision',
    });
    expect(
      test.unitOfWork.state.integrationJobs.get(test.currentJob.id),
    ).toMatchObject({
      status: 'reconciliation_required',
      lastErrorCode: 'calendar_provisioning_unknown',
      automaticRetryEligible: false,
    });

    test.clock.current = RETRY_AT;
    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'idle',
    });
    expect(test.calendar.ensureCalls).toHaveLength(1);
  });

  it('blocks a newer revision behind an unresolved provisioning intent until a user confirms absence, with exact replay', async () => {
    const test = fixture({ planRevision: 2, desiredRevision: 2 });
    const oldJob = job('calendar', {
      id: parseIntegrationJobId('calendar-job-old'),
      operationId: parseOperationId('operation-old'),
      desiredRevision: 1,
      status: 'reconciliation_required',
      lastErrorCode: 'calendar_provisioning_unknown',
      automaticRetryEligible: false,
    });
    const intent = createExternalMutationIntent({
      id: parseExternalMutationIntentId('provision-intent-old'),
      integrationJobId: oldJob.id,
      desiredRevision: oldJob.desiredRevision,
      action: 'calendar_provision',
      payload: {
        provider: 'system',
        ownershipKey: 'nexta-owned',
        existingCalendarId: null,
      },
      createdAt: CREATED,
    });
    test.unitOfWork.state.integrationJobs.set(oldJob.id, oldJob);
    test.unitOfWork.state.externalMutationIntents.set(intent.id, intent);

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      jobId: 'calendar-job-1',
      status: 'reconciliation_required',
    });
    expect(test.calendar.ensureCalls).toHaveLength(0);

    const input = {
      jobId: oldJob.id,
      confirmedAbsentInSystemCalendar: true as const,
    };
    await expect(
      test.service.confirmCalendarProvisioningAbsent(input, {
        operationId: 'confirm-provision-1',
        authority: { kind: 'agent_authorized', authorizationId: 'grant-1' },
      }),
    ).rejects.toMatchObject({ code: 'permission_required' });
    expect(test.unitOfWork.state.externalMutationIntents.size).toBe(1);

    const context = {
      operationId: 'confirm-provision-2',
      authority: { kind: 'user' as const },
    };
    const first = await test.service.confirmCalendarProvisioningAbsent(
      input,
      context,
    );
    expect(first).toMatchObject({
      operationId: 'confirm-provision-2',
      jobId: 'calendar-job-old',
      stateVersion: 1,
      planRevision: 2,
      releasedIntentId: 'provision-intent-old',
      requeuedJobCount: 2,
    });
    await expect(
      test.service.confirmCalendarProvisioningAbsent(input, context),
    ).resolves.toEqual(first);
    await expect(
      test.service.confirmCalendarProvisioningAbsent(
        {
          jobId: test.currentJob.id,
          confirmedAbsentInSystemCalendar: true,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(test.unitOfWork.state.externalMutationIntents.size).toBe(0);

    const hash = calendarHash();
    test.calendar.reconcileResults = [
      { status: 'missing' },
      calendarResult('found', hash, NEW_START, NEW_END),
    ];
    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      jobId: 'calendar-job-1',
      status: 'succeeded',
    });
    expect(test.calendar.ensureCalls).toHaveLength(1);
  });

  it('uses an older revision intent to remove an orphan without creating it again', async () => {
    const test = fixture({ planRevision: 2, desiredRevision: 2 });
    test.unitOfWork.state.timeBlocks.delete('block-1');
    const container = calendarContainer();
    test.unitOfWork.state.calendarContainerBindings.set(
      container.id,
      container,
    );
    const oldJob = job('calendar', {
      id: parseIntegrationJobId('calendar-job-old'),
      operationId: parseOperationId('operation-old'),
      desiredRevision: 1,
      status: 'reconciliation_required',
      lastErrorCode: 'external_mutation_intent_pending',
      automaticRetryEligible: false,
    });
    const intent = calendarCreateIntent(oldJob);
    test.unitOfWork.state.integrationJobs.set(oldJob.id, oldJob);
    test.unitOfWork.state.externalMutationIntents.set(intent.id, intent);
    const oldHash = calendarHash(OLD_START, OLD_END);
    test.calendar.reconcileResults = [
      calendarResult('found', oldHash, OLD_START, OLD_END),
      calendarResult('found', oldHash, OLD_START, OLD_END),
    ];

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      jobId: 'calendar-job-1',
      status: 'succeeded',
    });
    expect(test.calendar.createCalls).toHaveLength(0);
    expect(test.calendar.deleteCalls).toHaveLength(1);
    expect(test.unitOfWork.state.calendarBindings.size).toBe(0);
    expect(test.unitOfWork.state.externalMutationIntents.size).toBe(0);
  });

  it('recovers a lost moved-event update by checking old then desired ranges', async () => {
    const oldHash = calendarHash(OLD_START, OLD_END);
    const desiredHash = calendarHash();
    const test = fixture({ existingCalendarBinding: calendarBinding(oldHash) });
    test.calendar.updateResults = [{ outcome: 'unknown' }];
    test.calendar.reconcileResults = [
      calendarResult('found', oldHash, OLD_START, OLD_END),
      { status: 'missing' },
      { status: 'missing' },
      calendarResult('conflict', desiredHash, NEW_START, NEW_END),
      calendarResult('found', desiredHash, NEW_START, NEW_END),
    ];

    await test.service.processNext('calendar');
    test.clock.current = RETRY_AT;
    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(test.calendar.updateCalls).toHaveLength(1);
    expect(
      test.calendar.reconcileCalls.map((call) => call.searchRange),
    ).toEqual([
      { start: OLD_START, end: OLD_END },
      { start: OLD_START, end: OLD_END },
      { start: OLD_START, end: OLD_END },
      { start: NEW_START, end: NEW_END },
      { start: NEW_START, end: NEW_END },
    ]);
  });

  it('converges same-range calendar and notification lost updates from desired-state readback', async () => {
    const oldCalendarHash = hashOperationParameters({
      title: 'Old title',
      startAt: NEW_START,
      endAt: NEW_END,
    });
    const desiredCalendarHash = calendarHash();
    const calendarTest = fixture({
      existingCalendarBinding: calendarBinding(
        oldCalendarHash,
        NEW_START,
        NEW_END,
      ),
    });
    calendarTest.calendar.updateResults = [{ outcome: 'unknown' }];
    calendarTest.calendar.reconcileResults = [
      calendarResult('found', oldCalendarHash, NEW_START, NEW_END),
      calendarResult('found', desiredCalendarHash, NEW_START, NEW_END),
      calendarResult('found', desiredCalendarHash, NEW_START, NEW_END),
    ];
    await calendarTest.service.processNext('calendar');
    calendarTest.clock.current = RETRY_AT;
    await calendarTest.service.processNext('calendar');
    expect(calendarTest.calendar.updateCalls).toHaveLength(1);

    const oldNotificationHash = notificationHash(OLD_START);
    const desiredNotificationHash = notificationHash();
    const notificationTest = fixture({
      channel: 'notification',
      existingNotificationBinding: notificationBinding(oldNotificationHash),
    });
    notificationTest.notifications.cancelResults = [{ outcome: 'succeeded' }];
    notificationTest.notifications.scheduleResults = [{ outcome: 'unknown' }];
    notificationTest.notifications.reconcileResults = [
      notificationResult('found', oldNotificationHash, OLD_START),
      notificationResult('found', desiredNotificationHash, NEW_START),
      notificationResult('found', desiredNotificationHash, NEW_START),
    ];
    await notificationTest.service.processNext('notification');
    notificationTest.clock.current = RETRY_AT;
    await expect(
      notificationTest.service.processNext('notification'),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(notificationTest.notifications.scheduleCalls).toHaveLength(1);
  });

  it('keeps an exact duplicate conflict visible instead of treating it as synced', async () => {
    const hash = calendarHash();
    const test = fixture({
      existingCalendarBinding: calendarBinding(hash, NEW_START, NEW_END),
    });
    test.calendar.reconcileResults = [
      calendarResult('conflict', hash, NEW_START, NEW_END),
      calendarResult('conflict', hash, NEW_START, NEW_END),
    ];

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    await expect(test.service.getCurrentStatus()).resolves.toMatchObject({
      calendar: {
        status: 'reconciliation_required',
        lastErrorCode: 'calendar_external_conflict',
        bindingConflictCount: 1,
      },
    });
  });

  it('requires a unique notification readback before accepting exact desired content', async () => {
    const hash = notificationHash();
    const test = fixture({ channel: 'notification' });
    test.notifications.reconcileResults = [
      notificationResult('conflict', hash, NEW_START),
      notificationResult('conflict', hash, NEW_START),
    ];

    await expect(
      test.service.processNext('notification'),
    ).resolves.toMatchObject({ status: 'reconciliation_required' });
    expect(test.notifications.scheduleCalls).toHaveLength(0);
    expect(
      [...test.unitOfWork.state.notificationBindings.values()][0],
    ).toMatchObject({ status: 'conflict', lastAppliedRevision: 0 });
  });

  it('strictly fences a nullable occurrence when a verified binding already exists', async () => {
    const hash = calendarHash();
    const test = fixture({
      existingCalendarBinding: calendarBinding(hash, NEW_START, NEW_END, null),
    });
    test.calendar.reconcileResults = [
      calendarResult('found', hash, NEW_START, NEW_END, 'event-1', 'evil'),
    ];

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    expect(test.calendar.updateCalls).toHaveLength(0);
    expect(
      test.unitOfWork.state.calendarBindings.get('calendar-binding-1'),
    ).toMatchObject({ occurrenceKey: null, status: 'synced' });
  });

  it('blocks a copied owned marker without granting it update or delete authority', async () => {
    const canceledBlock = createTimeBlock({
      ...block(),
      status: 'canceled',
    });
    const test = fixture({ currentBlock: canceledBlock });
    test.calendar.inventoryResult = {
      status: 'complete',
      provider: 'system',
      calendarId: 'owned-calendar',
      range: { start: CREATED, end: LEASE_END },
      events: [
        {
          timeBlockId: 'block-1',
          planRevision: 1,
          ref: eventRef('copied-event'),
          contentHash: 'copied-marker-hash',
          startAt: NEW_START,
          endAt: NEW_END,
          ownershipVerified: true,
        },
      ],
    };

    await expect(test.service.processNext('calendar')).resolves.toMatchObject({
      status: 'reconciliation_required',
    });
    expect(test.calendar.reconcileCalls).toHaveLength(0);
    expect(test.calendar.createCalls).toHaveLength(0);
    expect(test.calendar.updateCalls).toHaveLength(0);
    expect(test.calendar.deleteCalls).toHaveLength(0);
    expect(test.unitOfWork.state.calendarBindings.size).toBe(0);
  });

  it.each([
    'calendarBindings.upsertIfNotNewer',
    'integrationJobs.updateClaimed',
  ])(
    'rolls back all binding mutations after a late %s fence failure',
    async (failingCall) => {
      const test = fixture();
      const hash = calendarHash();
      test.calendar.reconcileResults = [
        { status: 'missing' },
        calendarResult('found', hash, NEW_START, NEW_END),
      ];
      test.unitOfWork.returnFalseOn = failingCall;

      await expect(test.service.processNext('calendar')).resolves.toMatchObject(
        {
          status: 'reconciliation_required',
        },
      );
      expect(test.unitOfWork.state.calendarContainerBindings.size).toBe(1);
      if (failingCall === 'calendarBindings.upsertIfNotNewer') {
        expect(test.unitOfWork.state.calendarBindings.size).toBe(0);
        expect(test.unitOfWork.state.externalMutationIntents.size).toBe(1);
      } else {
        expect(
          [...test.unitOfWork.state.calendarBindings.values()][0],
        ).toMatchObject({ status: 'pending' });
        expect(test.unitOfWork.state.externalMutationIntents.size).toBe(0);
      }
      expect(
        test.unitOfWork.state.integrationJobs.get('calendar-job-1'),
      ).toMatchObject({
        status: 'reconciliation_required',
        automaticRetryEligible:
          failingCall === 'calendarBindings.upsertIfNotNewer',
      });
    },
  );
});
