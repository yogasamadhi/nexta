import type {
  CalendarProvider,
  NotificationProvider,
} from './integration-ports';
import { ApplicationError } from './errors';

export type ProviderCallTimer = Readonly<{
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}>;

function positiveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Provider call timeout must be a positive integer.');
  }
  return value;
}

function callWithTimeout<Result>(
  channel: 'calendar' | 'notification',
  operation: string,
  mutationPossible: boolean,
  timeoutMs: number,
  timer: ProviderCallTimer,
  call: () => Promise<Result>,
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: unknown;
    const finish = (work: () => void) => {
      if (settled) return;
      settled = true;
      timer.cancel(timeoutHandle);
      work();
    };
    timeoutHandle = timer.schedule(() => {
      finish(() =>
        reject(
          new ApplicationError(
            'provider_timeout',
            `The ${channel} provider timed out while attempting ${operation}.`,
            {
              retryable: true,
              causeCategory: `${channel}_${mutationPossible ? 'mutation' : 'read'}_timeout`,
            },
          ),
        ),
      );
    }, timeoutMs);
    Promise.resolve()
      .then(call)
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

/**
 * Bounds every Calendar provider call without inventing cancellation support.
 * A timed-out external mutation remains uncertain; IntegrationService's
 * write-ahead intent is the recovery source when the provider eventually
 * completes or the app returns to the foreground.
 */
export function createTimeoutCalendarProvider(
  provider: CalendarProvider,
  timeoutMs: number,
  timer: ProviderCallTimer,
): CalendarProvider {
  const timeout = positiveTimeout(timeoutMs);
  return {
    provider: provider.provider,
    getPermissionState: () =>
      callWithTimeout(
        'calendar',
        'read permission state',
        false,
        timeout,
        timer,
        () => provider.getPermissionState(),
      ),
    requestPermission: (access) =>
      callWithTimeout(
        'calendar',
        'request permission',
        true,
        timeout,
        timer,
        () => provider.requestPermission(access),
      ),
    listCalendars: () =>
      callWithTimeout('calendar', 'list calendars', false, timeout, timer, () =>
        provider.listCalendars(),
      ),
    listBusyEvents: (input) =>
      callWithTimeout(
        'calendar',
        'list busy events',
        false,
        timeout,
        timer,
        () => provider.listBusyEvents(input),
      ),
    ensureAppCalendar: (input) =>
      callWithTimeout(
        'calendar',
        'provision the App calendar',
        true,
        timeout,
        timer,
        () => provider.ensureAppCalendar(input),
      ),
    createAppEvent: (input) =>
      callWithTimeout(
        'calendar',
        'create an App event',
        true,
        timeout,
        timer,
        () => provider.createAppEvent(input),
      ),
    updateAppEvent: (ref, patch) =>
      callWithTimeout(
        'calendar',
        'update an App event',
        true,
        timeout,
        timer,
        () => provider.updateAppEvent(ref, patch),
      ),
    deleteAppEvent: (ref) =>
      callWithTimeout(
        'calendar',
        'delete an App event',
        true,
        timeout,
        timer,
        () => provider.deleteAppEvent(ref),
      ),
    reconcileAppEvent: (identity) =>
      callWithTimeout(
        'calendar',
        'reconcile an App event',
        false,
        timeout,
        timer,
        () => provider.reconcileAppEvent(identity),
      ),
    listOwnedAppEvents: (input) =>
      callWithTimeout(
        'calendar',
        'list owned App events',
        false,
        timeout,
        timer,
        () => provider.listOwnedAppEvents(input),
      ),
  };
}

/** Bounds notification calls using the same uncertainty-preserving protocol. */
export function createTimeoutNotificationProvider(
  provider: NotificationProvider,
  timeoutMs: number,
  timer: ProviderCallTimer,
): NotificationProvider {
  const timeout = positiveTimeout(timeoutMs);
  return {
    getPermissionState: () =>
      callWithTimeout(
        'notification',
        'read permission state',
        false,
        timeout,
        timer,
        () => provider.getPermissionState(),
      ),
    requestPermission: () =>
      callWithTimeout(
        'notification',
        'request permission',
        true,
        timeout,
        timer,
        () => provider.requestPermission(),
      ),
    schedule: (input) =>
      callWithTimeout(
        'notification',
        'schedule a notification',
        true,
        timeout,
        timer,
        () => provider.schedule(input),
      ),
    cancel: (ref) =>
      callWithTimeout(
        'notification',
        'cancel a notification',
        true,
        timeout,
        timer,
        () => provider.cancel(ref),
      ),
    cancelMany: (refs) =>
      callWithTimeout(
        'notification',
        'cancel notifications',
        true,
        timeout,
        timer,
        () => provider.cancelMany(refs),
      ),
    reconcile: (identity) =>
      callWithTimeout(
        'notification',
        'reconcile a notification',
        false,
        timeout,
        timer,
        () => provider.reconcile(identity),
      ),
    listOwnedScheduledNotifications: () =>
      callWithTimeout(
        'notification',
        'list owned notifications',
        false,
        timeout,
        timer,
        () => provider.listOwnedScheduledNotifications(),
      ),
  };
}
