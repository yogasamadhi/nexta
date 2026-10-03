import { hashOperationParameters } from '@workspace/application';

export const notificationMarkerDataKey = '__local_app_notification_v1';

export type StableNotificationIdentity = Readonly<{
  timeBlockId: string;
  type: string;
}>;

export type NotificationMarker = Readonly<{
  version: 1;
  namespace: string;
  identity: StableNotificationIdentity;
  contentHash: string;
  nativeFingerprint: string;
  scheduledAt: string;
  planRevision: number;
}>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function notificationIdentifier(
  namespace: string,
  identity: StableNotificationIdentity,
): string {
  if (
    !isNonEmptyString(namespace) ||
    !isNonEmptyString(identity.timeBlockId) ||
    !isNonEmptyString(identity.type)
  ) {
    throw new Error('Notification identity fields must not be empty.');
  }
  return `local-notification-v1-${hashOperationParameters({
    namespace,
    identity: {
      timeBlockId: identity.timeBlockId,
      type: identity.type,
    },
  }).slice('sha256:'.length)}`;
}

export function notificationNativeFingerprint(input: {
  title: string;
  body: string | null;
  scheduledAt: string;
}): string {
  return hashOperationParameters({
    title: input.title,
    body: input.body,
    scheduledAt: input.scheduledAt,
  });
}

export function createNotificationMarker(
  marker: Omit<NotificationMarker, 'version'>,
): string {
  if (
    !isNonEmptyString(marker.namespace) ||
    !isNonEmptyString(marker.identity.timeBlockId) ||
    !isNonEmptyString(marker.identity.type) ||
    !isNonEmptyString(marker.contentHash) ||
    !isNonEmptyString(marker.nativeFingerprint) ||
    !isNonEmptyString(marker.scheduledAt) ||
    !Number.isSafeInteger(marker.planRevision) ||
    marker.planRevision < 0
  ) {
    throw new Error('Notification marker fields are invalid.');
  }
  return JSON.stringify({
    version: 1,
    namespace: marker.namespace,
    identity: {
      timeBlockId: marker.identity.timeBlockId,
      type: marker.identity.type,
    },
    contentHash: marker.contentHash,
    nativeFingerprint: marker.nativeFingerprint,
    scheduledAt: marker.scheduledAt,
    planRevision: marker.planRevision,
  });
}

export function parseNotificationMarker(
  data: Readonly<Record<string, unknown>>,
): NotificationMarker | null {
  const raw = data[notificationMarkerDataKey];
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    const identity = candidate.identity;
    if (
      Object.keys(candidate).length !== 7 ||
      candidate.version !== 1 ||
      !isNonEmptyString(candidate.namespace) ||
      typeof identity !== 'object' ||
      identity === null ||
      Array.isArray(identity) ||
      Object.keys(identity).length !== 2 ||
      !isNonEmptyString((identity as Record<string, unknown>).timeBlockId) ||
      !isNonEmptyString((identity as Record<string, unknown>).type) ||
      !isNonEmptyString(candidate.contentHash) ||
      !isNonEmptyString(candidate.nativeFingerprint) ||
      !isNonEmptyString(candidate.scheduledAt) ||
      !Number.isSafeInteger(candidate.planRevision) ||
      (candidate.planRevision as number) < 0
    ) {
      return null;
    }
    return {
      version: 1,
      namespace: candidate.namespace,
      identity: {
        timeBlockId: (identity as Record<string, unknown>)
          .timeBlockId as string,
        type: (identity as Record<string, unknown>).type as string,
      },
      contentHash: candidate.contentHash,
      nativeFingerprint: candidate.nativeFingerprint,
      scheduledAt: candidate.scheduledAt,
      planRevision: candidate.planRevision as number,
    };
  } catch {
    return null;
  }
}
