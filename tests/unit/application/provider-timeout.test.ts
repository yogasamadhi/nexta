import {
  createTimeoutCalendarProvider,
  createTimeoutNotificationProvider,
  type CalendarProvider,
  type NotificationProvider,
} from '@workspace/application';
import { afterEach, describe, expect, it, vi } from 'vitest';

const timer = {
  schedule: (callback: () => void, delayMs: number): unknown =>
    setTimeout(callback, delayMs),
  cancel: (handle: unknown): void =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function calendarProvider(
  permission: () => Promise<unknown> = () =>
    Promise.resolve({
      read: {
        status: 'granted',
        canAskAgain: false,
        settingsRequired: false,
      },
      write: {
        status: 'granted',
        canAskAgain: false,
        settingsRequired: false,
      },
    }),
): CalendarProvider {
  return {
    provider: 'test-calendar',
    getPermissionState: permission,
    requestPermission: permission,
    listCalendars: () => Promise.resolve([]),
    listBusyEvents: () => Promise.resolve({}),
    ensureAppCalendar: () => Promise.resolve({}),
    createAppEvent: () => Promise.resolve({}),
    updateAppEvent: () => Promise.resolve({}),
    deleteAppEvent: () => Promise.resolve({}),
    reconcileAppEvent: () => Promise.resolve({}),
    listOwnedAppEvents: () => Promise.resolve({}),
  };
}

function notificationProvider(): NotificationProvider {
  return {
    getPermissionState: () =>
      Promise.resolve({
        status: 'granted',
        canAskAgain: false,
        settingsRequired: false,
      }),
    requestPermission: () => Promise.resolve({}),
    schedule: () => Promise.resolve({}),
    cancel: () => Promise.resolve({}),
    cancelMany: () => Promise.resolve({}),
    reconcile: () => Promise.resolve({}),
    listOwnedScheduledNotifications: () => Promise.resolve({}),
  };
}

describe('bounded Calendar and Notification providers', () => {
  afterEach(() => vi.useRealTimers());

  it('returns provider_timeout when a Calendar call never settles', async () => {
    vi.useFakeTimers();
    const provider = createTimeoutCalendarProvider(
      calendarProvider(() => new Promise(() => undefined)),
      50,
      timer,
    );
    const result = expect(provider.getPermissionState()).rejects.toMatchObject({
      code: 'provider_timeout',
      retryable: true,
      causeCategory: 'calendar_read_timeout',
    });

    await vi.advanceTimersByTimeAsync(50);
    await result;
  });

  it('forwards successful calls and retains the Calendar provider identity', async () => {
    const source = calendarProvider();
    const calendar = createTimeoutCalendarProvider(source, 1_000, timer);
    const notifications = createTimeoutNotificationProvider(
      notificationProvider(),
      1_000,
      timer,
    );

    expect(calendar.provider).toBe(source.provider);
    await expect(calendar.getPermissionState()).resolves.toMatchObject({
      read: { status: 'granted' },
    });
    await expect(notifications.getPermissionState()).resolves.toMatchObject({
      status: 'granted',
    });
  });

  it('rejects missing or non-positive timeout configuration', () => {
    expect(() =>
      createTimeoutCalendarProvider(calendarProvider(), 0, timer),
    ).toThrow('positive integer');
    expect(() =>
      createTimeoutNotificationProvider(notificationProvider(), 1.5, timer),
    ).toThrow('positive integer');
  });
});
