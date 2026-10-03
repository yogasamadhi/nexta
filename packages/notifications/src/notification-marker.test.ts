import { describe, expect, it } from 'vitest';

import {
  createNotificationMarker,
  notificationIdentifier,
  notificationMarkerDataKey,
  notificationNativeFingerprint,
  parseNotificationMarker,
} from './notification-marker';

describe('notification stable identity metadata', () => {
  it('derives the same OS identifier regardless of plan revision', () => {
    const identity = { timeBlockId: 'block-1', type: 'start' };
    expect(notificationIdentifier('test.namespace', identity)).toBe(
      notificationIdentifier('test.namespace', { ...identity }),
    );
    expect(notificationIdentifier('test.namespace', identity)).toMatch(
      /^local-notification-v1-[0-9a-f]{64}$/,
    );
  });

  it('round-trips opaque ownership data without copying title or body', () => {
    const marker = createNotificationMarker({
      namespace: 'test.namespace',
      identity: { timeBlockId: 'block-1', type: 'start' },
      contentHash: 'sha256:expected',
      nativeFingerprint: notificationNativeFingerprint({
        title: 'Private task title',
        body: null,
        scheduledAt: '2026-09-12T10:00:00.000Z',
      }),
      scheduledAt: '2026-09-12T10:00:00.000Z',
      planRevision: 7,
    });
    const parsed = parseNotificationMarker({
      [notificationMarkerDataKey]: marker,
    });

    expect(parsed).toMatchObject({
      version: 1,
      namespace: 'test.namespace',
      identity: { timeBlockId: 'block-1', type: 'start' },
      contentHash: 'sha256:expected',
      planRevision: 7,
    });
    expect(marker).not.toContain('Private task title');
  });

  it('rejects malformed or foreign marker data', () => {
    expect(parseNotificationMarker({})).toBeNull();
    expect(
      parseNotificationMarker({ [notificationMarkerDataKey]: '{bad json' }),
    ).toBeNull();
    expect(
      parseNotificationMarker({
        [notificationMarkerDataKey]: JSON.stringify({ version: 2 }),
      }),
    ).toBeNull();
  });
});
