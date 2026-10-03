import {
  confirmCalendarProvisioningAbsentAndWake,
  requestCalendarPermissionAndWake,
  requestNotificationPermissionAndWake,
} from '../../../apps/mobile/src/runtime/integration-user-actions';
import { describe, expect, it, vi } from 'vitest';

const grantedCalendarPermission = {
  read: {
    status: 'granted' as const,
    canRequestAgain: false,
    settingsRequired: false,
  },
  write: {
    status: 'granted' as const,
    canRequestAgain: false,
    settingsRequired: false,
  },
};

describe('mobile integration user actions', () => {
  it('wakes the foreground worker after Calendar write permission is granted', async () => {
    const requestPermission = vi
      .fn()
      .mockResolvedValue(grantedCalendarPermission);
    const wake = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestCalendarPermissionAndWake(
        { requestPermission },
        { wake },
        'write',
      ),
    ).resolves.toEqual(grantedCalendarPermission);

    expect(requestPermission).toHaveBeenCalledWith('write');
    expect(wake).toHaveBeenCalledOnce();
  });

  it('does not wake after Calendar permission remains blocked', async () => {
    const requestPermission = vi.fn().mockResolvedValue({
      read: {
        status: 'denied' as const,
        canRequestAgain: true,
        settingsRequired: false,
      },
      write: {
        status: 'denied' as const,
        canRequestAgain: true,
        settingsRequired: false,
      },
    });
    const wake = vi.fn().mockResolvedValue(undefined);

    await requestCalendarPermissionAndWake(
      { requestPermission },
      { wake },
      'write',
    );

    expect(wake).not.toHaveBeenCalled();
  });

  it('wakes only after Notification permission is granted', async () => {
    const wake = vi.fn().mockResolvedValue(undefined);
    const granted = vi.fn().mockResolvedValue({
      status: 'granted' as const,
      canRequestAgain: false,
      settingsRequired: false,
    });
    await requestNotificationPermissionAndWake(
      { requestNotificationPermission: granted },
      { wake },
    );
    expect(wake).toHaveBeenCalledOnce();

    wake.mockClear();
    const denied = vi.fn().mockResolvedValue({
      status: 'denied' as const,
      canRequestAgain: false,
      settingsRequired: true,
    });
    await requestNotificationPermissionAndWake(
      { requestNotificationPermission: denied },
      { wake },
    );
    expect(wake).not.toHaveBeenCalled();
  });

  it('releases a user-confirmed missing Calendar provision intent before waking', async () => {
    const calls: string[] = [];
    const result = {
      operationId: 'operation-1',
      jobId: 'job-1',
      stateVersion: 4,
      planRevision: 2,
      releasedIntentId: 'intent-1',
      requeuedJobCount: 1,
    };
    const confirmCalendarProvisioningAbsent = vi
      .fn()
      .mockImplementation(async () => {
        calls.push('confirm');
        return result;
      });
    const wake = vi.fn().mockImplementation(async () => {
      calls.push('wake');
    });
    const context = {
      operationId: 'operation-1',
      authority: { kind: 'user' as const },
    };

    await expect(
      confirmCalendarProvisioningAbsentAndWake(
        { confirmCalendarProvisioningAbsent },
        { wake },
        'job-1',
        context,
      ),
    ).resolves.toEqual(result);

    expect(confirmCalendarProvisioningAbsent).toHaveBeenCalledWith(
      {
        jobId: 'job-1',
        confirmedAbsentInSystemCalendar: true,
      },
      context,
    );
    expect(calls).toEqual(['confirm', 'wake']);
  });

  it('does not wake when Calendar recovery confirmation fails', async () => {
    const confirmCalendarProvisioningAbsent = vi
      .fn()
      .mockRejectedValue(new Error('confirmation failed'));
    const wake = vi.fn().mockResolvedValue(undefined);

    await expect(
      confirmCalendarProvisioningAbsentAndWake(
        { confirmCalendarProvisioningAbsent },
        { wake },
        'job-1',
        {
          operationId: 'operation-1',
          authority: { kind: 'user' },
        },
      ),
    ).rejects.toThrow('confirmation failed');
    expect(wake).not.toHaveBeenCalled();
  });

  it('keeps a committed permission/recovery action successful when wake fails', async () => {
    const wake = vi.fn().mockRejectedValue(new Error('foreground stopped'));
    const requestNotificationPermission = vi.fn().mockResolvedValue({
      status: 'granted' as const,
      canRequestAgain: false,
      settingsRequired: false,
    });

    await expect(
      requestNotificationPermissionAndWake(
        { requestNotificationPermission },
        { wake },
      ),
    ).resolves.toMatchObject({ status: 'granted' });

    const result = {
      operationId: 'operation-2',
      jobId: 'job-2',
      stateVersion: 5,
      planRevision: 3,
      releasedIntentId: 'intent-2',
      requeuedJobCount: 1,
    };
    await expect(
      confirmCalendarProvisioningAbsentAndWake(
        {
          confirmCalendarProvisioningAbsent: vi.fn().mockResolvedValue(result),
        },
        { wake },
        'job-2',
        {
          operationId: 'operation-2',
          authority: { kind: 'user' },
        },
      ),
    ).resolves.toEqual(result);
  });
});
