import type { IntegrationWorkerResult } from '@workspace/application';
import type { IntegrationJobChannel } from '@workspace/domain';
import { describe, expect, it, vi } from 'vitest';

import { ForegroundIntegrationCoordinator } from '../../../apps/mobile/src/runtime/integration-coordinator';

function result(
  channel: IntegrationJobChannel,
  status: IntegrationWorkerResult['status'],
): IntegrationWorkerResult {
  return {
    channel,
    jobId: status === 'idle' ? null : `${channel}-job`,
    desiredRevision: status === 'idle' ? null : 1,
    status,
    recoveredExpiredLease: false,
  };
}

describe('ForegroundIntegrationCoordinator', () => {
  it('keeps durable work dormant until the host is active', async () => {
    const processNext = vi.fn(async (channel: IntegrationJobChannel) =>
      result(channel, 'idle'),
    );
    const coordinator = new ForegroundIntegrationCoordinator({
      worker: { processNext },
    });

    await coordinator.wake();
    expect(processNext).not.toHaveBeenCalled();

    await coordinator.setActive(true);
    expect(processNext).toHaveBeenCalledTimes(2);
  });

  it('drains successful and superseded jobs then stops at idle', async () => {
    const queues: Record<IntegrationJobChannel, IntegrationWorkerResult[]> = {
      calendar: [
        result('calendar', 'succeeded'),
        result('calendar', 'superseded'),
        result('calendar', 'idle'),
      ],
      notification: [
        result('notification', 'pending'),
        result('notification', 'succeeded'),
        result('notification', 'idle'),
      ],
    };
    const seen: IntegrationWorkerResult[] = [];
    const coordinator = new ForegroundIntegrationCoordinator({
      worker: {
        processNext(channel) {
          return Promise.resolve(queues[channel].shift()!);
        },
      },
      onResult: (value) => seen.push(value),
    });

    await coordinator.setActive(true);

    expect(seen.filter(({ channel }) => channel === 'calendar')).toHaveLength(
      3,
    );
    expect(
      seen.filter(({ channel }) => channel === 'notification'),
    ).toHaveLength(3);
  });

  it('stops a blocked channel without preventing the other channel', async () => {
    const processNext = vi.fn(async (channel: IntegrationJobChannel) =>
      result(channel, channel === 'calendar' ? 'permission_required' : 'idle'),
    );
    const coordinator = new ForegroundIntegrationCoordinator({
      worker: { processNext },
    });

    await coordinator.setActive(true);

    expect(processNext).toHaveBeenCalledTimes(2);
    expect(processNext).toHaveBeenCalledWith('calendar');
    expect(processNext).toHaveBeenCalledWith('notification');
  });

  it('waits for an in-flight provider call before an inactive host can close', async () => {
    let finishCalendar!: (value: IntegrationWorkerResult) => void;
    const calendarCall = new Promise<IntegrationWorkerResult>((resolve) => {
      finishCalendar = resolve;
    });
    const processNext = vi.fn((channel: IntegrationJobChannel) =>
      channel === 'calendar'
        ? calendarCall
        : Promise.resolve(result('notification', 'idle')),
    );
    const coordinator = new ForegroundIntegrationCoordinator({
      worker: { processNext },
    });
    const activation = coordinator.setActive(true);
    await vi.waitFor(() => expect(processNext).toHaveBeenCalled());

    let stopped = false;
    const deactivation = coordinator.setActive(false).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishCalendar(result('calendar', 'succeeded'));
    await Promise.all([activation, deactivation]);
    expect(stopped).toBe(true);
  });

  it('guards against a worker that never reaches a terminal drain result', async () => {
    const coordinator = new ForegroundIntegrationCoordinator({
      worker: {
        processNext(channel) {
          return Promise.resolve(result(channel, 'succeeded'));
        },
      },
      maximumJobsPerChannelRun: 2,
    });

    await expect(coordinator.setActive(true)).rejects.toThrow(
      'exceeded its foreground drain limit',
    );
  });
});
