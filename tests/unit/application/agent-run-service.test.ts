import { describe, expect, it } from 'vitest';

import { AgentRunMetadataService } from '@workspace/application';
import { parseInstant } from '@workspace/domain';

import { MemoryUnitOfWork, SequenceClock } from './fakes';

const T0 = parseInstant('2026-09-12T08:00:00.000Z');
const T1 = parseInstant('2026-09-12T08:01:00.000Z');

describe('AgentRunMetadataService', () => {
  it('persists start/checkpoint/finish metadata without conversation content', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = new AgentRunMetadataService({
      unitOfWork,
      clock: new SequenceClock(T0, T1),
    });

    const started = await service.start({
      runId: 'run-1',
      trigger: 'user_input',
      modelProvider: 'fake',
    });
    await expect(
      service.start({
        runId: 'run-1',
        trigger: 'user_input',
        modelProvider: 'fake',
      }),
    ).resolves.toEqual(started);
    await expect(service.listRunning()).resolves.toHaveLength(1);
    await service.checkpoint({ runId: 'run-1', turnCount: 2 });
    const finished = await service.finish({
      runId: 'run-1',
      status: 'completed',
      turnCount: 3,
    });

    expect(finished).toMatchObject({
      id: 'run-1',
      status: 'completed',
      turnCount: 3,
      endedAt: T1,
    });
    await expect(service.listRunning()).resolves.toEqual([]);
    await expect(
      service.finish({
        runId: 'run-1',
        status: 'completed',
        turnCount: 3,
      }),
    ).resolves.toEqual(finished);
    expect(JSON.stringify(finished)).not.toContain('message');
  });

  it('rejects conflicting reuse and rolls back a failed checkpoint', async () => {
    const unitOfWork = new MemoryUnitOfWork();
    const service = new AgentRunMetadataService({
      unitOfWork,
      clock: new SequenceClock(T0),
    });
    await service.start({ runId: 'run-1', trigger: 'user_input' });

    await expect(
      service.start({ runId: 'run-1', trigger: 'manual_replan' }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    unitOfWork.failOn = 'agentRuns.update';
    await expect(
      service.checkpoint({ runId: 'run-1', turnCount: 2 }),
    ).rejects.toMatchObject({ code: 'adapter_error' });
    await expect(service.get('run-1')).resolves.toMatchObject({ turnCount: 0 });
  });
});
