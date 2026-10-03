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

  it('sanitizes already mapped and custom mapped provider failures', async () => {
    const raw = new ProviderError('network', 'credential=fixture-secret', {
      retryable: true,
      category: 'prompt=fixture-secret',
    });
    const mapped = mapProviderError(raw);
    expect(mapped).toMatchObject({ code: 'network', retryable: true });
    expect(
      `${mapped.message} ${mapped.category} ${mapped.stack}`,
    ).not.toContain('fixture-secret');
    const provider = createModelProvider({
      complete: async () => {
        throw raw;
      },
      mapError: () => raw,
    });
    const error = await provider
      .complete(request, signal)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'network', retryable: true });
    expect(JSON.stringify(error)).not.toContain('fixture-secret');
    expect((error as Error).message).not.toContain('fixture-secret');
  });

  it('sanitizes stream error events for both complete and stream callers', async () => {
    const provider = createModelProvider({
      stream: () =>
        events([
          {
            type: 'error',
            code: 'rate_limited',
            message: 'raw body credential=fixture-secret',
            retryable: true,
          },
        ]),
    });
    const error = await provider
      .complete(request, signal)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'rate_limited', retryable: true });
    expect((error as Error).message).not.toContain('fixture-secret');
    const emitted: ModelEvent[] = [];
    for await (const event of provider.stream(request, signal))
      emitted.push(event);
    expect(emitted[0]).toMatchObject({
      type: 'error',
      code: 'rate_limited',
      retryable: true,
    });
    expect(JSON.stringify(emitted)).not.toContain('fixture-secret');
  });

  it('maps thrown native stream failures without retaining upstream fields', async () => {
    const provider = createModelProvider({
      async *stream() {
        yield { type: 'text_delta', delta: 'partial' };
        throw Object.assign(new Error('prompt=fixture-secret'), {
          status: 401,
          body: 'fixture-secret',
        });
      },
    });
    const consume = async () => {
      for await (const event of provider.stream(request, signal)) void event;
    };
    const error = await consume().catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'authentication', retryable: false });
    expect((error as Error).message).not.toContain('fixture-secret');
    expect(error).not.toHaveProperty('body');
    expect(error).not.toHaveProperty('cause');
  });

  it('rejects late responses and deltas after cancellation even if the adapter ignores it', async () => {
    const controller = new AbortController();
    const completed = createModelProvider({
      complete: async () => {
        controller.abort();
        return response;
      },
    });
    await expect(
      completed.complete(request, controller.signal),
    ).rejects.toMatchObject({ code: 'aborted' });
    const streamController = new AbortController();
    const streamed = createModelProvider({
      async *stream() {
        streamController.abort();
        yield { type: 'text_delta', delta: 'late' };
      },
    });
    const emitted: ModelEvent[] = [];
    const consume = async () => {
      for await (const event of streamed.stream(
        request,
        streamController.signal,
      ))
        emitted.push(event);
    };
    await expect(consume()).rejects.toMatchObject({ code: 'aborted' });
    expect(emitted).toEqual([]);
  });
});
