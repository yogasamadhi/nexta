import {
  hashOperationParameters,
  type LocalNotificationInput,
  type NotificationIdentity,
  type NotificationProvider,
  type OwnedNotificationRef,
} from '@workspace/application';

import { loadExpoNotificationsNativeFacade } from './expo-notifications-native';
import type {
  NativeNotificationChannel,
  NativeNotificationPermissionRequest,
  NativeNotificationRequest,
  NativeNotificationsFacade,
} from './native-notifications';
import {
  createNotificationMarker,
  notificationIdentifier,
  notificationMarkerDataKey,
  notificationNativeFingerprint,
  parseNotificationMarker,
} from './notification-marker';

export type NotificationsAdapterOptions = Readonly<{
  ownershipMarkerNamespace: string;
  permissionRequest: NativeNotificationPermissionRequest;
  androidChannel: NativeNotificationChannel | null;
  native: NativeNotificationsFacade;
}>;

export type ExpoNotificationsAdapterOptions = Omit<
  NotificationsAdapterOptions,
  'native'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value, label);
}

function canonicalInstant(value: unknown, label: string): string {
  const text = requireNonEmptyString(value, label);
  const millis = Date.parse(text);
  if (!Number.isFinite(millis)) {
    throw new Error(`${label} must be a canonical UTC instant.`);
  }
  const canonical = new Date(millis).toISOString();
  if (canonical !== text) {
    throw new Error(`${label} must be a canonical UTC instant.`);
  }
  return canonical;
}

function requireSafeRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('planRevision must be a non-negative safe integer.');
  }
  return value as number;
}

function copyPermissionRequest(
  input: NativeNotificationPermissionRequest,
): NativeNotificationPermissionRequest {
  if (
    typeof input.allowAlert !== 'boolean' ||
    typeof input.allowBadge !== 'boolean' ||
    typeof input.allowSound !== 'boolean'
  ) {
    throw new Error('Notification permission request scope is invalid.');
  }
  return {
    allowAlert: input.allowAlert,
    allowBadge: input.allowBadge,
    allowSound: input.allowSound,
  };
}

function copyChannel(
  input: NativeNotificationChannel,
): NativeNotificationChannel {
  const id = requireNonEmptyString(input.id, 'androidChannel.id');
  const name = requireNonEmptyString(input.name, 'androidChannel.name');
  if (!Number.isFinite(input.importance)) {
    throw new Error('androidChannel.importance must be finite.');
  }
  const description =
    input.description === undefined
      ? undefined
      : requireNonEmptyString(input.description, 'androidChannel.description');
  const sound =
    input.sound === undefined || input.sound === null
      ? input.sound
      : requireNonEmptyString(input.sound, 'androidChannel.sound');
  let vibrationPattern: readonly number[] | undefined;
  if (input.vibrationPattern !== undefined) {
    if (
      input.vibrationPattern.some(
        (duration) => !Number.isFinite(duration) || duration < 0,
      )
    ) {
      throw new Error('androidChannel.vibrationPattern is invalid.');
    }
    vibrationPattern = [...input.vibrationPattern];
  }
  return {
    id,
    name,
    importance: input.importance,
    ...(description === undefined ? {} : { description }),
    ...(sound === undefined ? {} : { sound }),
    ...(vibrationPattern === undefined ? {} : { vibrationPattern }),
  };
}

type ValidIdentity = Readonly<{
  timeBlockId: string;
  type: string;
  expectedOsNotificationId: string | null;
  expectedContentHash: string | null;
}>;

type ValidInput = Readonly<{
  identity: ValidIdentity;
  taskId: string | null;
  title: string;
  body: string | null;
  scheduledAt: string;
  type: string;
  contentHash: string;
  planRevision: number;
}>;

type ValidOwnedRef = Readonly<{
  osNotificationId: string;
  identity: Readonly<{ timeBlockId: string; type: string }>;
}>;

type ReconciliationCandidate = Readonly<{
  ref: Readonly<{
    osNotificationId: string;
    identity: Readonly<{ timeBlockId: string; type: string }>;
  }>;
  contentHash: string;
  scheduledAt: string;
  conflict: boolean;
}>;

function notificationIdentityConflictHash(
  candidates: readonly ReconciliationCandidate[],
): string {
  return hashOperationParameters({
    kind: 'notification_identity_conflict',
    candidates: candidates.map((candidate) => ({
      osNotificationId: candidate.ref.osNotificationId,
      timeBlockId: candidate.ref.identity.timeBlockId,
      type: candidate.ref.identity.type,
      contentHash: candidate.contentHash,
      scheduledAt: candidate.scheduledAt,
      contentConflict: candidate.conflict,
    })),
  });
}

/**
 * Expo local-notification provider. OS identifiers are deterministic from the
 * stable (timeBlockId, type) identity; planRevision is deliberately excluded.
 */
export class ExpoNotificationsAdapter implements NotificationProvider {
  readonly #namespace: string;
  readonly #permissionRequest: NativeNotificationPermissionRequest;
  readonly #androidChannel: NativeNotificationChannel | null;
  readonly #native: NativeNotificationsFacade;

  constructor(options: NotificationsAdapterOptions) {
    this.#namespace = requireNonEmptyString(
      options.ownershipMarkerNamespace,
      'ownershipMarkerNamespace',
    );
    this.#permissionRequest = copyPermissionRequest(options.permissionRequest);
    this.#androidChannel =
      options.androidChannel === null
        ? null
        : copyChannel(options.androidChannel);
    this.#native = options.native;
  }

  async getPermissionState(): Promise<unknown> {
    try {
      return this.#permissionResult(await this.#native.getPermissionState());
    } catch {
      return this.#unavailablePermission();
    }
  }

  async requestPermission(): Promise<unknown> {
    try {
      return this.#permissionResult(
        await this.#native.requestPermission(this.#permissionRequest),
      );
    } catch {
      return this.#unavailablePermission();
    }
  }

  async schedule(input: LocalNotificationInput): Promise<unknown> {
    const value = this.#input(input);
    const stableIdentity = {
      timeBlockId: value.identity.timeBlockId,
      type: value.identity.type,
    };
    const identifier = notificationIdentifier(this.#namespace, stableIdentity);
    const marker = createNotificationMarker({
      namespace: this.#namespace,
      identity: stableIdentity,
      contentHash: value.contentHash,
      nativeFingerprint: notificationNativeFingerprint(value),
      scheduledAt: value.scheduledAt,
      planRevision: value.planRevision,
    });
    try {
      if (this.#androidChannel !== null) {
        await this.#native.ensureChannel(this.#androidChannel);
      }
      const returnedIdentifier = await this.#native.schedule({
        identifier,
        content: {
          title: value.title,
          ...(value.body === null ? {} : { body: value.body }),
          data: { [notificationMarkerDataKey]: marker },
        },
        scheduledAt: new Date(value.scheduledAt),
        ...(this.#androidChannel === null
          ? {}
          : { channelId: this.#androidChannel.id }),
      });
      if (returnedIdentifier !== identifier) {
        return this.#recoverScheduled(value.identity, value.contentHash);
      }
      return {
        outcome: 'succeeded',
        ref: { osNotificationId: identifier, identity: stableIdentity },
      };
    } catch {
      return this.#recoverScheduled(value.identity, value.contentHash);
    }
  }

  async cancel(ref: OwnedNotificationRef): Promise<unknown> {
    const owned = this.#ownedRef(ref);
    return this.#cancelOwned(owned);
  }

  async cancelMany(refs: readonly OwnedNotificationRef[]): Promise<unknown> {
    if (!Array.isArray(refs)) {
      throw new Error('Notification references must be an array.');
    }
    // Validate everything before issuing the first external mutation.
    const unique = new Map<string, ValidOwnedRef>();
    for (const ref of refs) {
      const owned = this.#ownedRef(ref);
      const prior = unique.get(owned.osNotificationId);
      if (
        prior !== undefined &&
        (prior.identity.timeBlockId !== owned.identity.timeBlockId ||
          prior.identity.type !== owned.identity.type)
      ) {
        throw new Error('One OS notification id has conflicting identities.');
      }
      unique.set(owned.osNotificationId, owned);
    }
    let unknown = false;
    for (const owned of unique.values()) {
      const result = await this.#cancelOwned(owned);
      if (!isRecord(result) || result.outcome !== 'succeeded') unknown = true;
    }
    return unknown ? { outcome: 'unknown' } : { outcome: 'succeeded' };
  }

  async reconcile(identity: NotificationIdentity): Promise<unknown> {
    return this.#reconcile(this.#identity(identity));
  }

  async listOwnedScheduledNotifications(): Promise<unknown> {
    let requests: readonly NativeNotificationRequest[];
    try {
      requests = await this.#native.listScheduled();
    } catch {
      return { status: 'unknown' };
    }
    if (!Array.isArray(requests)) return { status: 'unknown' };

    let status: 'complete' | 'partial' = 'complete';
    const notifications: {
      planRevision: number;
      ref: Readonly<{
        osNotificationId: string;
        identity: Readonly<{ timeBlockId: string; type: string }>;
      }>;
      contentHash: string;
      scheduledAt: string;
      identityVerified: true;
    }[] = [];
    for (const request of requests) {
      if (!isRecord(request) || !isRecord(request.content)) {
        status = 'partial';
        continue;
      }
      const identifier =
        typeof request.identifier === 'string' &&
        request.identifier.trim().length > 0
          ? request.identifier
          : null;
      if (!isRecord(request.content.data)) {
        if (
          identifier === null ||
          identifier.startsWith('local-notification-v1-')
        ) {
          status = 'partial';
        }
        continue;
      }
      const marker = parseNotificationMarker(request.content.data);
      if (marker === null) {
        if (
          Object.hasOwn(request.content.data, notificationMarkerDataKey) ||
          identifier === null ||
          identifier.startsWith('local-notification-v1-')
        ) {
          status = 'partial';
        }
        continue;
      }
      if (marker.namespace !== this.#namespace) continue;
      if (identifier === null) {
        status = 'partial';
        continue;
      }
      const markerScheduledAt = this.#tryCanonicalInstant(marker.scheduledAt);
      const actualScheduledAt = this.#observedTriggerInstant(request.trigger);
      if (markerScheduledAt === null || actualScheduledAt === null) {
        status = 'partial';
        continue;
      }
      if (typeof request.content.title !== 'string') {
        status = 'partial';
        continue;
      }
      const body =
        request.content.body === undefined
          ? null
          : typeof request.content.body === 'string'
            ? request.content.body
            : undefined;
      if (body === undefined) {
        status = 'partial';
        continue;
      }
      const observedFingerprint = notificationNativeFingerprint({
        title: request.content.title,
        body,
        scheduledAt: actualScheduledAt,
      });
      notifications.push({
        planRevision: marker.planRevision,
        ref: {
          osNotificationId: identifier,
          identity: {
            timeBlockId: marker.identity.timeBlockId,
            type: marker.identity.type,
          },
        },
        contentHash: this.#observedNotificationContentHash({
          markerContentHash: marker.contentHash,
          markerFingerprint: marker.nativeFingerprint,
          markerScheduledAt,
          actualScheduledAt,
          observedFingerprint,
        }),
        scheduledAt: actualScheduledAt,
        identityVerified: true,
      });
    }
    notifications.sort((left, right) => {
      const leftKey = `${left.ref.identity.timeBlockId}\u0000${left.ref.identity.type}\u0000${left.ref.osNotificationId}`;
      const rightKey = `${right.ref.identity.timeBlockId}\u0000${right.ref.identity.type}\u0000${right.ref.osNotificationId}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    return { status, notifications };
  }

  #permissionResult(response: unknown): unknown {
    if (
      !isRecord(response) ||
      typeof response.status !== 'string' ||
      typeof response.granted !== 'boolean' ||
      typeof response.canAskAgain !== 'boolean' ||
      (response.iosAuthorizationStatus !== undefined &&
        !Number.isFinite(response.iosAuthorizationStatus))
    ) {
      throw new Error('Native notification permission result is invalid.');
    }
    const iosAuthorizationStatus =
      typeof response.iosAuthorizationStatus === 'number'
        ? response.iosAuthorizationStatus
        : undefined;
    let status: 'not_determined' | 'granted' | 'denied' | 'unavailable';
    if (
      response.granted ||
      response.status === 'granted' ||
      iosAuthorizationStatus === 2 ||
      iosAuthorizationStatus === 3 ||
      iosAuthorizationStatus === 4
    ) {
      status = 'granted';
    } else if (
      response.status === 'undetermined' ||
      response.status === 'not_determined' ||
      iosAuthorizationStatus === 0
    ) {
      status = 'not_determined';
    } else if (response.status === 'denied' || iosAuthorizationStatus === 1) {
      status = 'denied';
    } else {
      status = 'unavailable';
    }
    return {
      status,
      canAskAgain: response.canAskAgain,
      settingsRequired: status === 'denied' && !response.canAskAgain,
    };
  }

  #unavailablePermission(): unknown {
    return {
      status: 'unavailable',
      canAskAgain: false,
      settingsRequired: false,
    };
  }

  #identity(input: unknown): ValidIdentity {
    if (!isRecord(input)) throw new Error('Notification identity is invalid.');
    return {
      timeBlockId: requireNonEmptyString(input.timeBlockId, 'timeBlockId'),
      type: requireNonEmptyString(input.type, 'type'),
      expectedOsNotificationId: requireNullableString(
        input.expectedOsNotificationId,
        'expectedOsNotificationId',
      ),
      expectedContentHash: requireNullableString(
        input.expectedContentHash,
        'expectedContentHash',
      ),
    };
  }

  #input(input: unknown): ValidInput {
    if (!isRecord(input)) throw new Error('Notification input is invalid.');
    const identity = this.#identity(input.identity);
    const type = requireNonEmptyString(input.type, 'type');
    if (type !== identity.type) {
      throw new Error(
        'Notification projection type does not match its identity.',
      );
    }
    return {
      identity,
      taskId: requireNullableString(input.taskId, 'taskId'),
      title: requireNonEmptyString(input.title, 'title'),
      body: requireNullableString(input.body, 'body'),
      scheduledAt: canonicalInstant(input.scheduledAt, 'scheduledAt'),
      type,
      contentHash: requireNonEmptyString(input.contentHash, 'contentHash'),
      planRevision: requireSafeRevision(input.planRevision),
    };
  }

  #ownedRef(input: unknown): ValidOwnedRef {
    if (!isRecord(input) || !isRecord(input.identity)) {
      throw new Error('Owned notification reference is invalid.');
    }
    if (input.identityVerified !== true) {
      throw new Error('Notification reference is not identity verified.');
    }
    canonicalInstant(input.verifiedAt, 'verifiedAt');
    return {
      osNotificationId: requireNonEmptyString(
        input.osNotificationId,
        'osNotificationId',
      ),
      identity: {
        timeBlockId: requireNonEmptyString(
          input.identity.timeBlockId,
          'identity.timeBlockId',
        ),
        type: requireNonEmptyString(input.identity.type, 'identity.type'),
      },
    };
  }

  async #cancelOwned(owned: ValidOwnedRef): Promise<unknown> {
    try {
      await this.#native.cancel(owned.osNotificationId);
      return { outcome: 'succeeded' };
    } catch {
      // A cancel response can be lost after the OS applied it. A complete
      // scheduled-request read proves success only for this exact verified id.
      try {
        const requests = await this.#native.listScheduled();
        return requests.some(
          (request) => request.identifier === owned.osNotificationId,
        )
          ? { outcome: 'unknown' }
          : { outcome: 'succeeded' };
      } catch {
        return { outcome: 'unknown' };
      }
    }
  }

  async #recoverScheduled(
    identity: ValidIdentity,
    contentHash: string,
  ): Promise<unknown> {
    const result = await this.#reconcile({
      ...identity,
      expectedOsNotificationId: notificationIdentifier(
        this.#namespace,
        this.#stableIdentity(identity),
      ),
      expectedContentHash: contentHash,
    });
    if (isRecord(result) && result.status === 'found' && isRecord(result.ref)) {
      return { outcome: 'succeeded', ref: result.ref };
    }
    return { outcome: 'unknown' };
  }

  async #reconcile(identity: ValidIdentity): Promise<unknown> {
    let requests: readonly NativeNotificationRequest[];
    try {
      requests = await this.#native.listScheduled();
    } catch {
      return { status: 'unknown' };
    }
    if (!Array.isArray(requests)) return { status: 'unknown' };
    const deterministicId = notificationIdentifier(
      this.#namespace,
      this.#stableIdentity(identity),
    );
    let ambiguousTarget = false;
    const candidates: ReconciliationCandidate[] = [];
    for (const request of requests) {
      if (typeof request.identifier !== 'string') {
        continue;
      }
      if (!isRecord(request.content) || !isRecord(request.content.data)) {
        if (request.identifier === deterministicId) ambiguousTarget = true;
        continue;
      }
      const marker = parseNotificationMarker(request.content.data);
      if (marker === null) {
        if (request.identifier === deterministicId) ambiguousTarget = true;
        continue;
      }
      if (
        marker.namespace !== this.#namespace ||
        marker.identity.timeBlockId !== identity.timeBlockId ||
        marker.identity.type !== identity.type
      ) {
        if (request.identifier === deterministicId) ambiguousTarget = true;
        continue;
      }
      const scheduledAt = this.#tryCanonicalInstant(marker.scheduledAt);
      if (scheduledAt === null) {
        ambiguousTarget = true;
        continue;
      }
      const actualScheduledAt = this.#observedTriggerInstant(request.trigger);
      if (actualScheduledAt === null) {
        ambiguousTarget = true;
        continue;
      }
      const title =
        typeof request.content.title === 'string' ? request.content.title : '';
      const body =
        request.content.body === undefined
          ? null
          : typeof request.content.body === 'string'
            ? request.content.body
            : null;
      const observedFingerprint = notificationNativeFingerprint({
        title,
        body,
        scheduledAt: actualScheduledAt,
      });
      const triggerConflict = actualScheduledAt !== scheduledAt;
      const contentHash = this.#observedNotificationContentHash({
        markerContentHash: marker.contentHash,
        markerFingerprint: marker.nativeFingerprint,
        markerScheduledAt: scheduledAt,
        actualScheduledAt,
        observedFingerprint,
      });
      candidates.push({
        ref: {
          osNotificationId: request.identifier,
          identity: {
            timeBlockId: identity.timeBlockId,
            type: identity.type,
          },
        },
        contentHash,
        scheduledAt: actualScheduledAt,
        conflict:
          triggerConflict || observedFingerprint !== marker.nativeFingerprint,
      });
    }
    if (ambiguousTarget) return { status: 'unknown' };
    candidates.sort((left, right) =>
      left.ref.osNotificationId < right.ref.osNotificationId
        ? -1
        : left.ref.osNotificationId > right.ref.osNotificationId
          ? 1
          : 0,
    );
    const first = candidates[0];
    if (first === undefined) {
      return ambiguousTarget ? { status: 'unknown' } : { status: 'missing' };
    }
    const osIdentityConflict =
      identity.expectedOsNotificationId !== null &&
      identity.expectedOsNotificationId !== first.ref.osNotificationId;
    const identityConflict = candidates.length > 1 || osIdentityConflict;
    const contentHash = identityConflict
      ? notificationIdentityConflictHash(candidates)
      : first.contentHash;
    const conflict =
      identityConflict ||
      first.conflict ||
      (identity.expectedContentHash !== null &&
        identity.expectedContentHash !== first.contentHash);
    return {
      status: conflict ? 'conflict' : 'found',
      ref: first.ref,
      contentHash,
      scheduledAt: first.scheduledAt,
      identityVerified: true,
    };
  }

  #tryCanonicalInstant(value: unknown): string | null {
    try {
      return canonicalInstant(value, 'scheduledAt');
    } catch {
      return null;
    }
  }

  #observedTriggerInstant(value: unknown): string | null {
    if (
      !isRecord(value) ||
      value.kind !== 'date' ||
      typeof value.scheduledAt !== 'string'
    ) {
      return null;
    }
    return this.#tryCanonicalInstant(value.scheduledAt);
  }

  #observedNotificationContentHash(
    input: Readonly<{
      markerContentHash: string;
      markerFingerprint: string;
      markerScheduledAt: string;
      actualScheduledAt: string;
      observedFingerprint: string;
    }>,
  ): string {
    if (input.actualScheduledAt !== input.markerScheduledAt) {
      return hashOperationParameters({
        kind: 'notification_trigger_conflict',
        markerScheduledAt: input.markerScheduledAt,
        actualScheduledAt: input.actualScheduledAt,
        observedFingerprint: input.observedFingerprint,
      });
    }
    return input.observedFingerprint === input.markerFingerprint
      ? input.markerContentHash
      : input.observedFingerprint;
  }

  #stableIdentity(identity: ValidIdentity): {
    timeBlockId: string;
    type: string;
  } {
    return {
      timeBlockId: identity.timeBlockId,
      type: identity.type,
    };
  }
}

/** Creates the production adapter without loading Expo until explicitly called. */
export async function createExpoNotificationsAdapter(
  options: ExpoNotificationsAdapterOptions,
): Promise<ExpoNotificationsAdapter> {
  return new ExpoNotificationsAdapter({
    ...options,
    native: await loadExpoNotificationsNativeFacade(),
  });
}
