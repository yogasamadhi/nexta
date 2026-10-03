import type {
  CalendarPermissionState,
  CalendarProvisioningRecoveryResult,
  IntegrationService,
  NotificationPermissionState,
  WriteContext,
} from '@workspace/application';

type CalendarPermissionService = Readonly<{
  requestPermission(access: 'read' | 'write'): Promise<CalendarPermissionState>;
}>;

type NotificationPermissionService = Readonly<{
  requestNotificationPermission(): Promise<NotificationPermissionState>;
}>;

type CalendarProvisioningRecoveryService = Pick<
  IntegrationService,
  'confirmCalendarProvisioningAbsent'
>;

type ForegroundWakeup = Readonly<{
  wake(): Promise<void>;
}>;

async function bestEffortWake(integrations: ForegroundWakeup): Promise<void> {
  try {
    await integrations.wake();
  } catch {
    // The Application services already persisted the permission requeue or
    // recovery intent release. A later foreground transition can retry it.
  }
}

/**
 * Permission services durably requeue blocked jobs. The foreground host must
 * also wake its coordinator so the user does not need an AppState round trip
 * before those jobs are attempted again.
 */
export async function requestCalendarPermissionAndWake(
  calendar: CalendarPermissionService,
  integrations: ForegroundWakeup,
  access: 'read' | 'write',
): Promise<CalendarPermissionState> {
  const permission = await calendar.requestPermission(access);
  if (permission.write.status === 'granted') await bestEffortWake(integrations);
  return permission;
}

export async function requestNotificationPermissionAndWake(
  notifications: NotificationPermissionService,
  integrations: ForegroundWakeup,
): Promise<NotificationPermissionState> {
  const permission = await notifications.requestNotificationPermission();
  if (permission.status === 'granted') await bestEffortWake(integrations);
  return permission;
}

export async function confirmCalendarProvisioningAbsentAndWake(
  integrationsService: CalendarProvisioningRecoveryService,
  integrations: ForegroundWakeup,
  jobId: string,
  context: WriteContext,
): Promise<CalendarProvisioningRecoveryResult> {
  const result = await integrationsService.confirmCalendarProvisioningAbsent(
    {
      jobId,
      confirmedAbsentInSystemCalendar: true,
    },
    context,
  );
  await bestEffortWake(integrations);
  return result;
}
