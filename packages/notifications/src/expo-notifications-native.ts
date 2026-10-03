import {
  normalizeNativeNotificationTrigger,
  type NativeNotificationChannel,
  type NativeNotificationPermissionRequest,
  type NativeNotificationPermissionResponse,
  type NativeNotificationRequest,
  type NativeNotificationsFacade,
} from './native-notifications';

function permissionResponse(response: {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  ios?: { status: number };
}): NativeNotificationPermissionResponse {
  return {
    status: response.status,
    granted: response.granted,
    canAskAgain: response.canAskAgain,
    ...(response.ios === undefined
      ? {}
      : { iosAuthorizationStatus: response.ios.status }),
  };
}

function scheduledRequest(request: {
  identifier: string;
  content: {
    title: string | null;
    body: string | null;
    data?: Record<string, unknown>;
  };
  trigger: unknown;
}): NativeNotificationRequest {
  return {
    identifier: request.identifier,
    content: {
      title: request.content.title ?? '',
      ...(request.content.body === null ? {} : { body: request.content.body }),
      data: request.content.data ?? {},
    },
    trigger: normalizeNativeNotificationTrigger(request.trigger),
  };
}

/** Lazily loads Expo so package imports stay safe in Node unit tests. */
export async function loadExpoNotificationsNativeFacade(): Promise<NativeNotificationsFacade> {
  const Notifications = await import('expo-notifications');

  return {
    async getPermissionState() {
      return permissionResponse(await Notifications.getPermissionsAsync());
    },
    async requestPermission(request: NativeNotificationPermissionRequest) {
      return permissionResponse(
        await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: request.allowAlert,
            allowBadge: request.allowBadge,
            allowSound: request.allowSound,
          },
        }),
      );
    },
    async ensureChannel(channel: NativeNotificationChannel) {
      await Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        importance: channel.importance,
        ...(channel.description === undefined
          ? {}
          : { description: channel.description }),
        ...(channel.sound === undefined ? {} : { sound: channel.sound }),
        ...(channel.vibrationPattern === undefined
          ? {}
          : { vibrationPattern: [...channel.vibrationPattern] }),
      });
    },
    async schedule(input) {
      return Notifications.scheduleNotificationAsync({
        identifier: input.identifier,
        content: {
          title: input.content.title,
          ...(input.content.body === undefined
            ? {}
            : { body: input.content.body }),
          data: { ...input.content.data },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: input.scheduledAt,
          ...(input.channelId === undefined
            ? {}
            : { channelId: input.channelId }),
        },
      });
    },
    async listScheduled() {
      const requests = await Notifications.getAllScheduledNotificationsAsync();
      return requests.map(scheduledRequest);
    },
    async cancel(identifier) {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    },
  };
}
