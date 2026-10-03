import { describe, expect, it } from 'vitest';

import {
  checkpointAgentRun,
  createAgentRun,
  finishAgentRun,
  parseAgentRunId,
  parseInstant,
} from '@workspace/domain';

const startedAt = parseInstant('2026-09-12T08:00:00.000Z');
const endedAt = parseInstant('2026-09-12T08:01:00.000Z');

describe('AgentRun metadata', () => {
  it('stores only bounded lifecycle metadata and monotonic turn counts', () => {
    const started = createAgentRun({
      id: parseAgentRunId('run-1'),
      startedAt,
      trigger: 'user_input',
      modelProvider: 'fake',
    });
    const checkpoint = checkpointAgentRun(started, 2);
    const finished = finishAgentRun(checkpoint, {
      status: 'completed',
      endedAt,
      turnCount: 3,
    });

    expect(finished).toEqual({
      id: 'run-1',
      startedAt,
      endedAt,
      status: 'completed',
      trigger: 'user_input',
      modelProvider: 'fake',
      turnCount: 3,
      errorCode: null,
    });
    expect(finished).not.toHaveProperty('messages');
    expect(finished).not.toHaveProperty('toolResults');
    expect(() => checkpointAgentRun(checkpoint, 1)).toThrow();
  });

  it('requires sanitized error metadata only for abort and failure states', () => {
    const started = createAgentRun({
      id: parseAgentRunId('run-2'),
      startedAt,
      trigger: 'background_window',
    });
    expect(() =>
      finishAgentRun(started, {
        status: 'failed',
        endedAt,
        turnCount: 0,
      }),
    ).toThrow();
    expect(() =>
      finishAgentRun(started, {
        status: 'completed',
        endedAt,
        turnCount: 0,
        errorCode: 'provider_secret',
      }),
    ).toThrow();
  });
});
