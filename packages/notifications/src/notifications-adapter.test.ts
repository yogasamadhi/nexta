import {
  externalDeletionResultSchema,
  notificationMutationResultSchema,
  ownedNotificationInventorySchema,
  notificationPermissionStateSchema,
  notificationReconciliationSchema,
  type LocalNotificationInput,
  type NotificationIdentity,
  type OwnedNotificationRef,
} from '@workspace/application';
import { describe, expect, it } from 'vitest';

import type {
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
import { ExpoNotificationsAdapter } from './notifications-adapter';

function instant(value: string): LocalNotificationInput['scheduledAt'] {
  return value as LocalNotificationInput['scheduledAt'];
}

function timeBlockId(value: string): NotificationIdentity['timeBlockId'] {
  return value as NotificationIdentity['timeBlockId'];
}

function taskId(value: string): NonNullable<LocalNotificationInput['taskId']> {
  return value as NonNullable<LocalNotificationInput['taskId']>;
}

function nativeFacade(
  overrides: Partial<NativeNotificationsFacade> = {},
): NativeNotificationsFacade {
  return {
    async getPermissionState() {
      return { status: 'granted', granted: true, canAskAgain: true };
    },
    async requestPermission() {
      return { status: 'granted', granted: true, canAskAgain: true };
    },
    async ensureChannel() {},
    async schedule(input) {
      return input.identifier;
    },
    async listScheduled() {
      return [];
    },
    async cancel() {},
    ...overrides,
  };
}

function adapter(native: NativeNotificationsFacade): ExpoNotificationsAdapter {
  return new ExpoNotificationsAdapter({
    ownershipMarkerNamespace: 'test.namespace',
    permissionRequest: {
      allowAlert: true,
      allowBadge: false,
      allowSound: false,
    },
    androidChannel: {
      id: 'scheduled-work',
      name: 'Scheduled work',
      importance: 3,
      sound: null,
    },
    native,
  });
}

function identity(
  overrides: Partial<NotificationIdentity> = {},
): NotificationIdentity {
  return {
    timeBlockId: timeBlockId('block-1'),
    type: 'start',
    expectedOsNotificationId: null,
    expectedContentHash: null,
    ...overrides,
  };
}

function input(
  overrides: Partial<LocalNotificationInput> = {},
): LocalNotificationInput {
  return {
    identity: identity(),
    taskId: taskId('task-1'),
    title: 'Focus block',
    body: null,
    scheduledAt: instant('2026-09-12T09:55:00.000Z'),
    type: 'start',
    contentHash: 'sha256:desired',
    planRevision: 7,
    ...overrides,
  };
}

function ownedRef(
  overrides: Partial<OwnedNotificationRef> = {},
): OwnedNotificationRef {
  return {
    osNotificationId: notificationIdentifier('test.namespace', {
      timeBlockId: 'block-1',
      type: 'start',
    }),
    identity: {
      timeBlockId: timeBlockId('block-1'),
      type: 'start',
    },
    identityVerified: true,
    verifiedAt: instant('2026-09-12T09:00:00.000Z'),
    ...overrides,
  };
}

describe('ExpoNotificationsAdapter', () => {
  it('keeps permission reads prompt-free and passes the explicit request scope', async () => {
    let reads = 0;
    let requested: NativeNotificationPermissionRequest | null = null;
    const provider = adapter(
      nativeFacade({
        async getPermissionState() {
          reads += 1;
          return {
            status: 'undetermined',
            granted: false,
            canAskAgain: true,
            iosAuthorizationStatus: 0,
          };
        },
        async requestPermission(request) {
          requested = request;
          return {
            status: 'denied',
            granted: false,
            canAskAgain: false,
            iosAuthorizationStatus: 1,
          };
        },
      }),
    );

    expect(
      notificationPermissionStateSchema.parse(
        await provider.getPermissionState(),
      ),
    ).toEqual({
      status: 'not_determined',
      canAskAgain: true,
      settingsRequired: false,
    });
    expect(reads).toBe(1);
    expect(requested).toBeNull();

    expect(
      notificationPermissionStateSchema.parse(
        await provider.requestPermission(),
      ),
    ).toEqual({
      status: 'denied',
      canAskAgain: false,
      settingsRequired: true,
    });
    expect(requested).toEqual({
      allowAlert: true,
      allowBadge: false,
      allowSound: false,
    });
  });

  it('treats iOS provisional authorization as granted and preserves canAskAgain', async () => {
    const provider = adapter(
      nativeFacade({
        async getPermissionState() {
          return {
            status: 'undetermined',
            granted: false,
            canAskAgain: false,
            iosAuthorizationStatus: 3,
          };
        },
      }),
    );
    expect(
      notificationPermissionStateSchema.parse(
        await provider.getPermissionState(),
      ),
    ).toEqual({
      status: 'granted',
      canAskAgain: false,
      settingsRequired: false,
    });
  });

  it('schedules with deterministic identity, explicit channel, and opaque marker', async () => {
    const scheduled: Parameters<NativeNotificationsFacade['schedule']>[0][] =
      [];
    const channels: Parameters<
      NativeNotificationsFacade['ensureChannel']
    >[0][] = [];
    const provider = adapter(
      nativeFacade({
        async ensureChannel(channel) {
          channels.push(channel);
        },
        async schedule(value) {
          scheduled.push(value);
          return value.identifier;
        },
      }),
    );

    const result = notificationMutationResultSchema.parse(
      await provider.schedule(input()),
    );
    const expectedId = notificationIdentifier('test.namespace', {
      timeBlockId: 'block-1',
      type: 'start',
    });
    expect(result).toEqual({
      outcome: 'succeeded',
      ref: {
        osNotificationId: expectedId,
        identity: { timeBlockId: 'block-1', type: 'start' },
      },
    });
    expect(channels).toEqual([
      {
        id: 'scheduled-work',
        name: 'Scheduled work',
        importance: 3,
        sound: null,
      },
    ]);
    expect(scheduled[0]).toMatchObject({
      identifier: expectedId,
      scheduledAt: new Date('2026-09-12T09:55:00.000Z'),
      channelId: 'scheduled-work',
      content: { title: 'Focus block' },
    });
    const data = scheduled[0]?.content.data;
    expect(data).toBeDefined();
    const marker = parseNotificationMarker(data ?? {});
    expect(marker).toMatchObject({
      namespace: 'test.namespace',
      identity: { timeBlockId: 'block-1', type: 'start' },
      contentHash: 'sha256:desired',
      planRevision: 7,
    });
    expect(data?.[notificationMarkerDataKey]).not.toContain('Focus block');
    expect(data?.[notificationMarkerDataKey]).not.toContain('task-1');
  });

  it('recovers a lost schedule response by deterministic marker readback', async () => {
    const pending: NativeNotificationRequest[] = [];
    const provider = adapter(
      nativeFacade({
        async schedule(value) {
          pending.push({
            identifier: value.identifier,
            content: value.content,
            trigger: {
              kind: 'date',
              scheduledAt: value.scheduledAt.toISOString(),
            },
          });
          throw new Error('response lost after native commit');
        },
        async listScheduled() {
          return pending;
        },
      }),
    );

    expect(
      notificationMutationResultSchema.parse(await provider.schedule(input())),
    ).toEqual({
      outcome: 'succeeded',
      ref: {
        osNotificationId: notificationIdentifier('test.namespace', {
          timeBlockId: 'block-1',
          type: 'start',
        }),
        identity: { timeBlockId: 'block-1', type: 'start' },
      },
    });
  });

  it('returns conflict for edited content or duplicate stable identities', async () => {
    let request: NativeNotificationRequest | null = null;
    const setup = adapter(
      nativeFacade({
        async schedule(value) {
          request = {
            identifier: value.identifier,
            content: value.content,
            trigger: {
              kind: 'date',
              scheduledAt: value.scheduledAt.toISOString(),
            },
          };
          return value.identifier;
        },
      }),
    );
    await setup.schedule(input());
    expect(request).not.toBeNull();
    const original = request as unknown as NativeNotificationRequest;
    const provider = adapter(
      nativeFacade({
        async listScheduled() {
          return [
            {
              ...original,
              identifier: 'duplicate-b',
              content: { ...original.content, title: 'Edited title' },
            },
            {
              ...original,
              identifier: 'duplicate-a',
              content: { ...original.content, title: 'Edited title' },
            },
          ];
        },
      }),
    );
    const result = notificationReconciliationSchema.parse(
      await provider.reconcile(
        identity({ expectedContentHash: 'sha256:desired' }),
      ),
    );
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.ref.osNotificationId).toBe('duplicate-a');
      expect(result.contentHash).not.toBe('sha256:desired');
      expect(result.identityVerified).toBe(true);
    }
  });

  it('allows a sole stale expected hash to converge but never hides duplicates', async () => {
    const scheduledAt = '2026-09-12T09:55:00.000Z';
    const stableIdentity = { timeBlockId: 'block-1', type: 'start' };
    const marker = createNotificationMarker({
      namespace: 'test.namespace',
      identity: stableIdentity,
      contentHash: 'sha256:desired',
      nativeFingerprint: notificationNativeFingerprint({
        title: 'Focus block',
        body: null,
        scheduledAt,
      }),
      scheduledAt,
      planRevision: 7,
    });
    const request = (osNotificationId: string): NativeNotificationRequest => ({
      identifier: osNotificationId,
      content: {
        title: 'Focus block',
        data: { [notificationMarkerDataKey]: marker },
      },
      trigger: { kind: 'date', scheduledAt },
    });
    const expectedId = notificationIdentifier('test.namespace', stableIdentity);
    let pending: readonly NativeNotificationRequest[] = [request(expectedId)];
    const provider = adapter(
      nativeFacade({
        async listScheduled() {
          return pending;
        },
      }),
    );

    expect(
      notificationReconciliationSchema.parse(
        await provider.reconcile(
          identity({
            expectedOsNotificationId: expectedId,
            expectedContentHash: 'sha256:old',
          }),
        ),
      ),
    ).toMatchObject({
      status: 'conflict',
      contentHash: 'sha256:desired',
    });
    expect(
      notificationReconciliationSchema.parse(
        await provider.reconcile(
          identity({
            expectedOsNotificationId: expectedId,
            expectedContentHash: 'sha256:desired',
          }),
        ),
      ),
    ).toMatchObject({ status: 'found', contentHash: 'sha256:desired' });

    pending = [request(expectedId), request('duplicate-id')];
    const duplicate = notificationReconciliationSchema.parse(
      await provider.reconcile(
        identity({
          expectedOsNotificationId: expectedId,
          expectedContentHash: 'sha256:desired',
        }),
      ),
    );
    expect(duplicate.status).toBe('conflict');
    if (duplicate.status === 'conflict') {
      expect(duplicate.contentHash).not.toBe('sha256:desired');
    }
  });

  it('compares the actual OS date trigger and never trusts marker time alone', async () => {
    const markerScheduledAt = '2026-09-12T09:55:00.000Z';
    const actualScheduledAt = '2026-09-12T10:05:00.000Z';
    const stableIdentity = { timeBlockId: 'block-1', type: 'start' };
    const marker = createNotificationMarker({
      namespace: 'test.namespace',
      identity: stableIdentity,
      contentHash: 'sha256:desired',
      nativeFingerprint: notificationNativeFingerprint({
        title: 'Focus block',
        body: null,
        scheduledAt: markerScheduledAt,
      }),
      scheduledAt: markerScheduledAt,
      planRevision: 7,
    });
    const expectedId = notificationIdentifier('test.namespace', stableIdentity);
    let trigger: NativeNotificationRequest['trigger'] = {
      kind: 'date',
      scheduledAt: actualScheduledAt,
    };
    const provider = adapter(
      nativeFacade({
        async listScheduled() {
          return [
            {
              identifier: expectedId,
              content: {
                title: 'Focus block',
                data: { [notificationMarkerDataKey]: marker },
              },
              trigger,
            },
          ];
        },
      }),
    );

    const mismatch = notificationReconciliationSchema.parse(
      await provider.reconcile(
        identity({
          expectedOsNotificationId: expectedId,
          expectedContentHash: 'sha256:desired',
        }),
      ),
    );
    expect(mismatch.status).toBe('conflict');
    if (mismatch.status === 'conflict') {
      expect(mismatch.scheduledAt).toBe(actualScheduledAt);
      expect(mismatch.contentHash).not.toBe('sha256:desired');
    }

    trigger = { kind: 'unknown' };
    expect(
      notificationReconciliationSchema.parse(
        await provider.reconcile(
          identity({
            expectedOsNotificationId: expectedId,
            expectedContentHash: 'sha256:desired',
          }),
        ),
      ),
    ).toEqual({ status: 'unknown' });
  });

  it('keeps a malformed deterministic target unknown and absence distinct', async () => {
    const expectedId = notificationIdentifier('test.namespace', {
      timeBlockId: 'block-1',
      type: 'start',
    });
    const malformed = adapter(
      nativeFacade({
        async listScheduled() {
          return [
            {
              identifier: expectedId,
              content: { title: 'Unknown', data: {} },
              trigger: { kind: 'unknown' },
            },
          ];
        },
      }),
    );
    expect(
      notificationReconciliationSchema.parse(
        await malformed.reconcile(identity()),
      ),
    ).toEqual({ status: 'unknown' });

    const empty = adapter(nativeFacade());
    expect(
      notificationReconciliationSchema.parse(await empty.reconcile(identity())),
    ).toEqual({ status: 'missing' });
  });

  it('inventories all namespace markers without collapsing duplicate identities', async () => {
    const scheduledAt = '2026-09-12T09:55:00.000Z';
    const stableIdentity = { timeBlockId: 'block-1', type: 'start' };
    const marker = createNotificationMarker({
      namespace: 'test.namespace',
      identity: stableIdentity,
      contentHash: 'sha256:desired',
      nativeFingerprint: notificationNativeFingerprint({
        title: 'Focus block',
        body: null,
        scheduledAt,
      }),
      scheduledAt,
      planRevision: 6,
    });
    const foreignMarker = createNotificationMarker({
      namespace: 'another.namespace',
      identity: { timeBlockId: 'foreign-block', type: 'start' },
      contentHash: 'sha256:foreign',
      nativeFingerprint: 'sha256:foreign-native',
      scheduledAt,
      planRevision: 1,
    });
    const request = (
      identifier: string,
      markerValue: string,
    ): NativeNotificationRequest => ({
      identifier,
      content: {
        title: 'Focus block',
        data: { [notificationMarkerDataKey]: markerValue },
      },
      trigger: { kind: 'date', scheduledAt },
    });
    const provider = adapter(
      nativeFacade({
        async listScheduled() {
          return [
            request('notification-b', marker),
            request('notification-a', marker),
            request('foreign-notification', foreignMarker),
            {
              identifier: 'ordinary-notification',
              content: { title: 'Other feature', data: {} },
              trigger: { kind: 'date', scheduledAt },
            },
          ];
        },
      }),
    );

    expect(
      ownedNotificationInventorySchema.parse(
        await provider.listOwnedScheduledNotifications(),
      ),
    ).toEqual({
      status: 'complete',
      notifications: [
        {
          planRevision: 6,
          ref: {
            osNotificationId: 'notification-a',
            identity: stableIdentity,
          },
          contentHash: 'sha256:desired',
          scheduledAt,
          identityVerified: true,
        },
        {
          planRevision: 6,
          ref: {
            osNotificationId: 'notification-b',
            identity: stableIdentity,
          },
          contentHash: 'sha256:desired',
          scheduledAt,
          identityVerified: true,
        },
      ],
    });
  });

  it('uses actual triggers in inventory and marks unobservable candidates partial', async () => {
    const markerScheduledAt = '2026-09-12T09:55:00.000Z';
    const actualScheduledAt = '2026-09-12T10:05:00.000Z';
    const marker = createNotificationMarker({
      namespace: 'test.namespace',
      identity: { timeBlockId: 'block-1', type: 'start' },
      contentHash: 'sha256:desired',
      nativeFingerprint: notificationNativeFingerprint({
        title: 'Focus block',
        body: null,
        scheduledAt: markerScheduledAt,
      }),
      scheduledAt: markerScheduledAt,
      planRevision: 6,
    });
    const provider = adapter(
      nativeFacade({
        async listScheduled() {
          return [
            {
              identifier: 'known-actual-trigger',
              content: {
                title: 'Focus block',
                data: { [notificationMarkerDataKey]: marker },
              },
              trigger: { kind: 'date', scheduledAt: actualScheduledAt },
            },
            {
              identifier: 'unknown-actual-trigger',
              content: {
                title: 'Focus block',
                data: { [notificationMarkerDataKey]: marker },
              },
              trigger: { kind: 'unknown' },
            },
          ];
        },
      }),
    );

    const result = ownedNotificationInventorySchema.parse(
      await provider.listOwnedScheduledNotifications(),
    );
    expect(result.status).toBe('partial');
    if (result.status === 'partial') {
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]).toMatchObject({
        ref: { osNotificationId: 'known-actual-trigger' },
        scheduledAt: actualScheduledAt,
      });
      expect(result.notifications[0]?.contentHash).not.toBe('sha256:desired');
    }
  });

  it('keeps notification inventory read failures unknown', async () => {
    const provider = adapter(
      nativeFacade({
        async listScheduled() {
          throw new Error('native inventory unavailable');
        },
      }),
    );
    expect(
      ownedNotificationInventorySchema.parse(
        await provider.listOwnedScheduledNotifications(),
      ),
    ).toEqual({ status: 'unknown' });
  });

  it('requires verified cancellation and proves a lost cancel response by readback', async () => {
    const target = ownedRef();
    const pending: NativeNotificationRequest[] = [
      {
        identifier: target.osNotificationId,
        content: { title: 'Focus', data: {} },
        trigger: { kind: 'unknown' },
      },
    ];
    let cancellations = 0;
    const provider = adapter(
      nativeFacade({
        async cancel(identifier) {
          cancellations += 1;
          const index = pending.findIndex(
            (candidate) => candidate.identifier === identifier,
          );
          if (index >= 0) pending.splice(index, 1);
          throw new Error('response lost after cancel');
        },
        async listScheduled() {
          return pending;
        },
      }),
    );
    const unverified = {
      ...target,
      identityVerified: false,
    } as unknown as OwnedNotificationRef;
    await expect(provider.cancel(unverified)).rejects.toThrow(
      /not identity verified/,
    );
    expect(cancellations).toBe(0);

    expect(
      externalDeletionResultSchema.parse(await provider.cancel(target)),
    ).toEqual({ outcome: 'succeeded' });
    expect(cancellations).toBe(1);
  });

  it('attempts every unique cancelMany target but preserves an unknown outcome', async () => {
    const calls: string[] = [];
    const first = ownedRef();
    const second = ownedRef({
      osNotificationId: 'second-os-id',
      identity: {
        timeBlockId: timeBlockId('block-2'),
        type: 'start',
      },
    });
    const provider = adapter(
      nativeFacade({
        async cancel(identifier) {
          calls.push(identifier);
          if (identifier === 'second-os-id') {
            throw new Error('still pending');
          }
        },
        async listScheduled() {
          return [
            {
              identifier: 'second-os-id',
              content: { title: 'Still pending', data: {} },
              trigger: { kind: 'unknown' },
            },
          ];
        },
      }),
    );
    expect(
      externalDeletionResultSchema.parse(
        await provider.cancelMany([first, second, first]),
      ),
    ).toEqual({ outcome: 'unknown' });
    expect(calls).toEqual([first.osNotificationId, 'second-os-id']);
  });

  it('rejects a projection/identity mismatch before native scheduling', async () => {
    let schedules = 0;
    const provider = adapter(
      nativeFacade({
        async schedule(value) {
          schedules += 1;
          return value.identifier;
        },
      }),
    );
    await expect(provider.schedule(input({ type: 'end' }))).rejects.toThrow(
      /does not match/,
    );
    expect(schedules).toBe(0);
  });
});
