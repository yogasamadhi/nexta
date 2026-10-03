import type {
  IntegrationProjectionContext,
  IntegrationProjectionPolicy,
} from '@workspace/application';

export type MobileIntegrationProjectionSettings = Readonly<{
  calendar: Readonly<{
    provider: string;
    ownershipKey: string;
    title: string;
    color: string | null;
    androidSource: string | null;
    exposeTaskTitle: boolean;
    genericEventTitle: string;
  }>;
  notification: Readonly<{
    enabled: boolean;
    leadMinutes: number;
    type: string;
    exposeTaskTitle: boolean;
    genericTitle: string;
    body: string | null;
  }>;
}>;

function nonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
  return value;
}

function isFuturePlannedTaskBlock(context: IntegrationProjectionContext) {
  return (
    context.block.type === 'task' &&
    context.block.status === 'planned' &&
    Date.parse(context.block.startAt) > Date.parse(context.now) &&
    context.task !== null &&
    context.task.status !== 'completed' &&
    context.task.status !== 'canceled'
  );
}

/**
 * Builds projection rules only from explicit settings. The caller owns all
 * user-visible naming, privacy and reminder timing choices.
 */
export function createMobileIntegrationProjectionPolicy(
  settings: MobileIntegrationProjectionSettings,
): IntegrationProjectionPolicy {
  const provider = nonEmpty(settings.calendar.provider, 'calendar.provider');
  const ownershipKey = nonEmpty(
    settings.calendar.ownershipKey,
    'calendar.ownershipKey',
  );
  const calendarTitle = nonEmpty(settings.calendar.title, 'calendar.title');
  const genericEventTitle = nonEmpty(
    settings.calendar.genericEventTitle,
    'calendar.genericEventTitle',
  );
  const notificationType = nonEmpty(
    settings.notification.type,
    'notification.type',
  );
  const genericNotificationTitle = nonEmpty(
    settings.notification.genericTitle,
    'notification.genericTitle',
  );
  if (
    !Number.isSafeInteger(settings.notification.leadMinutes) ||
    settings.notification.leadMinutes < 0 ||
    settings.notification.leadMinutes > 24 * 60
  ) {
    throw new Error(
      'notification.leadMinutes must be an integer from 0 to 1440.',
    );
  }

  return {
    calendarProvisioning(requestedProvider) {
      if (requestedProvider !== provider) {
        throw new Error('Calendar projection provider is not configured.');
      }
      return {
        provider,
        ownershipKey,
        title: calendarTitle,
        color: settings.calendar.color,
        androidSource: settings.calendar.androidSource,
      };
    },
    calendarEvent(context) {
      if (!isFuturePlannedTaskBlock(context)) return null;
      return {
        title: settings.calendar.exposeTaskTitle
          ? context.task!.title
          : genericEventTitle,
        startAt: context.block.startAt,
        endAt: context.block.endAt,
      };
    },
    notification(context) {
      if (
        !settings.notification.enabled ||
        !isFuturePlannedTaskBlock(context)
      ) {
        return null;
      }
      const leadMinutes =
        context.notificationLeadMinutes ?? settings.notification.leadMinutes;
      if (
        !Number.isSafeInteger(leadMinutes) ||
        leadMinutes < 0 ||
        leadMinutes > 24 * 60
      ) {
        throw new Error(
          'notification lead-time preference must be an integer from 0 to 1440.',
        );
      }
      const scheduledAt = new Date(
        Date.parse(context.block.startAt) - leadMinutes * 60_000,
      ).toISOString();
      if (Date.parse(scheduledAt) <= Date.parse(context.now)) return null;
      return {
        title: settings.notification.exposeTaskTitle
          ? context.task!.title
          : genericNotificationTitle,
        body: settings.notification.body,
        scheduledAt,
        type: notificationType,
      };
    },
  };
}
