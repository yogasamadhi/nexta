import { describe, expect, it } from 'vitest';

import type {
  AgentAbortSignal,
  ModelEvent,
  ModelRequest,
  ModelResponse,
} from '@workspace/agent-core';
import {
  FakeModelProvider,
  ProviderError,
  collectModelStream,
  createModelProvider,
  mapProviderError,
} from '@workspace/model-runtime';

const signal: AgentAbortSignal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};
const request: ModelRequest = { messages: [], tools: [] };
const response: ModelResponse = {
  text: 'done',
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  finishReason: 'stop',
};

async function* events(values: readonly ModelEvent[]) {
  for (const value of values) yield value;
}

describe('model-runtime', () => {
  it('aggregates complete tool calls only after a done event', async () => {
    await expect(
      collectModelStream(
        events([
          { type: 'tool_call_start', id: 'call-1', name: 'task.list' },
          { type: 'tool_call_delta', id: 'call-1', delta: '{"limit":10}' },
          { type: 'tool_call_end', id: 'call-1' },
          {
            type: 'usage',
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
          { type: 'done', finishReason: 'tool_calls' },
        ]),
        signal,
      ),
    ).resolves.toEqual({
      text: '',
      toolCalls: [
        { id: 'call-1', name: 'task.list', argumentsJson: '{"limit":10}' },
      ],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      finishReason: 'tool_calls',
    });

    await expect(
      collectModelStream(
        events([
          { type: 'tool_call_start', id: 'partial', name: 'task.list' },
          { type: 'tool_call_delta', id: 'partial', delta: '{' },
        ]),
        signal,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      category: 'provider_protocol',
    });
  });

  it('supports complete-from-stream and stream-from-complete adapters', async () => {
    const streamed = createModelProvider({
      stream: () =>
        events([
          { type: 'text_delta', delta: 'done' },
          { type: 'done', finishReason: 'stop' },
        ]),
    });
    await expect(streamed.complete(request, signal)).resolves.toMatchObject({
      text: 'done',
      finishReason: 'stop',
    });

    const completed = createModelProvider({ complete: async () => response });
    const emitted: ModelEvent[] = [];
    for await (const event of completed.stream(request, signal))
      emitted.push(event);
    expect(emitted).toEqual([
      { type: 'text_delta', delta: 'done' },
      { type: 'usage', usage: response.usage },
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('maps provider failures without retaining raw messages or causes', () => {
    const raw = Object.assign(new Error('secret upstream response'), {
      status: 429,
      responseBody: 'credential=secret',
    });
    const mapped = mapProviderError(raw);

    expect(mapped).toBeInstanceOf(ProviderError);
    expect(mapped).toMatchObject({
      code: 'rate_limited',
      retryable: true,
      category: 'provider_rate_limit',
    });
    expect(mapped.message).not.toContain('secret');
    expect(mapped).not.toHaveProperty('responseBody');
    expect(mapped).not.toHaveProperty('cause');
  });

  it('provides deterministic scripted fake turns and records requests', async () => {
    const provider = new FakeModelProvider([{ response }]);

    await expect(provider.complete(request, signal)).resolves.toEqual(response);
    expect(provider.requests).toEqual([request]);
    await expect(provider.complete(request, signal)).rejects.toMatchObject({
      code: 'unavailable',
      category: 'fake_provider_exhausted',
    });
  });
});
