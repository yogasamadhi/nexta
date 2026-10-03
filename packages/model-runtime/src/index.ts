import type {
  AgentAbortSignal,
  ModelEvent,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ModelUsage,
} from '@workspace/agent-core';

export type ProviderErrorCode =
  | 'aborted'
  | 'authentication'
  | 'rate_limited'
  | 'network'
  | 'invalid_response'
  | 'unavailable'
  | 'unknown';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly category: string;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: Readonly<{ retryable: boolean; category: string }>,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options.retryable;
    this.category = options.category;
  }
}

export function mapProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    const descriptions: Record<ProviderErrorCode, string> = {
      aborted: 'The model request was aborted.',
      authentication: 'The model provider credentials were rejected.',
      rate_limited: 'The model provider is temporarily rate limited.',
      network: 'The model provider could not be reached.',
      invalid_response: 'The model provider returned an invalid response.',
      unavailable: 'The model provider is unavailable.',
      unknown: 'The model provider request failed.',
    };
    const code = Object.hasOwn(descriptions, error.code)
      ? error.code
      : 'unknown';
    const categories = new Set([
      'provider_abort',
      'provider_authentication',
      'provider_rate_limit',
      'provider_network',
      'provider_protocol',
      'provider_stream',
      'provider_unknown',
      'provider_unavailable',
      'fake_provider_exhausted',
    ]);
    return new ProviderError(code, descriptions[code], {
      retryable: error.retryable === true,
      category: categories.has(error.category)
        ? error.category
        : `provider_${code}`,
    });
  }
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      code?: unknown;
      status?: unknown;
      retryable?: unknown;
    };
    if (candidate.status === 401 || candidate.status === 403) {
      return new ProviderError(
        'authentication',
        'The model provider credentials were rejected.',
        { retryable: false, category: 'provider_authentication' },
      );
    }
    if (candidate.status === 429) {
      return new ProviderError(
        'rate_limited',
        'The model provider is temporarily rate limited.',
        { retryable: true, category: 'provider_rate_limit' },
      );
    }
    if (
      candidate.code === 'ECONNRESET' ||
      candidate.code === 'ETIMEDOUT' ||
      candidate.code === 'ENETUNREACH'
    ) {
      return new ProviderError(
        'network',
        'The model provider could not be reached.',
        { retryable: true, category: 'provider_network' },
      );
    }
  }
  return new ProviderError('unknown', 'The model provider request failed.', {
    retryable: false,
    category: 'provider_unknown',
  });
}

function throwIfAborted(signal: AgentAbortSignal): void {
  if (signal.aborted) {
    throw new ProviderError('aborted', 'The model request was aborted.', {
      retryable: true,
      category: 'provider_abort',
    });
  }
}

function usageOrNull(usage: ModelUsage | null): ModelUsage | null {
  if (usage === null) return null;
  const values = [usage.inputTokens, usage.outputTokens, usage.totalTokens];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new ProviderError(
      'invalid_response',
      'The model provider returned invalid usage metadata.',
      { retryable: false, category: 'provider_protocol' },
    );
  }
  return usage;
}

export async function collectModelStream(
  events: AsyncIterable<ModelEvent>,
  signal: AgentAbortSignal,
): Promise<ModelResponse> {
  let text = '';
  let usage: ModelUsage | null = null;
  let finishReason: ModelResponse['finishReason'] | null = null;
  const calls = new Map<
    string,
    { name: string; argumentsJson: string; ended: boolean }
  >();
  for await (const event of events) {
    throwIfAborted(signal);
    if (event.type === 'text_delta') text += event.delta;
    else if (event.type === 'tool_call_start') {
      if (calls.has(event.id)) {
        throw new ProviderError(
          'invalid_response',
          'The model provider reused a tool call identifier.',
          { retryable: false, category: 'provider_protocol' },
        );
      }
      calls.set(event.id, {
        name: event.name,
        argumentsJson: '',
        ended: false,
      });
    } else if (event.type === 'tool_call_delta') {
      const call = calls.get(event.id);
      if (call === undefined || call.ended) {
        throw new ProviderError(
          'invalid_response',
          'The model provider streamed tool arguments out of order.',
          { retryable: false, category: 'provider_protocol' },
        );
      }
      call.argumentsJson += event.delta;
    } else if (event.type === 'tool_call_end') {
      const call = calls.get(event.id);
      if (call === undefined || call.ended) {
        throw new ProviderError(
          'invalid_response',
          'The model provider ended an unknown tool call.',
          { retryable: false, category: 'provider_protocol' },
        );
      }
      call.ended = true;
    } else if (event.type === 'usage') usage = usageOrNull(event.usage);
    else if (event.type === 'error') {
      throw new ProviderError(
        event.code === 'rate_limited' ? 'rate_limited' : 'unknown',
        'The model provider stream failed.',
        {
          retryable: event.retryable,
          category: 'provider_stream',
        },
      );
    } else if (event.type === 'done') finishReason = event.finishReason;
  }
  throwIfAborted(signal);
  if (
    finishReason === null ||
    [...calls.values()].some((call) => !call.ended)
  ) {
    throw new ProviderError(
      'invalid_response',
      'The model provider stream ended before completion.',
      { retryable: false, category: 'provider_protocol' },
    );
  }
  const toolCalls: readonly ModelToolCall[] = [...calls.entries()].map(
    ([id, call]) => ({
      id,
      name: call.name,
      argumentsJson: call.argumentsJson,
    }),
  );
  return { text, toolCalls, usage, finishReason };
}

async function* responseEvents(
  response: ModelResponse,
  signal: AgentAbortSignal,
): AsyncIterable<ModelEvent> {
  throwIfAborted(signal);
  if (response.text.length > 0) {
    yield { type: 'text_delta', delta: response.text };
  }
  for (const call of response.toolCalls) {
    throwIfAborted(signal);
    yield { type: 'tool_call_start', id: call.id, name: call.name };
    yield { type: 'tool_call_delta', id: call.id, delta: call.argumentsJson };
    yield { type: 'tool_call_end', id: call.id };
  }
  if (response.usage !== null) yield { type: 'usage', usage: response.usage };
  yield { type: 'done', finishReason: response.finishReason };
}

export type ModelProviderAdapter = Readonly<{
  complete?: (
    request: ModelRequest,
    signal: AgentAbortSignal,
  ) => Promise<ModelResponse>;
  stream?: (
    request: ModelRequest,
    signal: AgentAbortSignal,
  ) => AsyncIterable<ModelEvent>;
  mapError?: (error: unknown) => ProviderError;
}>;

export function createModelProvider(
  adapter: ModelProviderAdapter,
): ModelProvider {
  if (adapter.complete === undefined && adapter.stream === undefined) {
    throw new TypeError('A model provider adapter needs complete or stream.');
  }
  const convertError = (error: unknown): ProviderError => {
    if (error instanceof ProviderError) return mapProviderError(error);
    try {
      return mapProviderError(adapter.mapError?.(error) ?? error);
    } catch {
      return mapProviderError(error);
    }
  };
  return {
    async complete(request, signal) {
      throwIfAborted(signal);
      try {
        if (adapter.complete !== undefined) {
          const response = await adapter.complete(request, signal);
          throwIfAborted(signal);
          return response;
        }
        return await collectModelStream(
          adapter.stream!(request, signal),
          signal,
        );
      } catch (error) {
        throw convertError(error);
      }
    },
    stream(request, signal) {
      return (async function* () {
        throwIfAborted(signal);
        try {
          if (adapter.stream !== undefined) {
            for await (const event of adapter.stream(request, signal)) {
              throwIfAborted(signal);
              yield event.type === 'error'
                ? {
                    type: 'error',
                    code:
                      event.code === 'rate_limited'
                        ? 'rate_limited'
                        : 'unknown',
                    message: 'The model provider stream failed.',
                    retryable: event.retryable === true,
                  }
                : event;
            }
            throwIfAborted(signal);
          } else {
            const response = await adapter.complete!(request, signal);
            yield* responseEvents(response, signal);
          }
        } catch (error) {
          throw convertError(error);
        }
      })();
    },
  };
}

export type FakeModelTurn = Readonly<{
  response?: ModelResponse;
  events?: readonly ModelEvent[];
  error?: unknown;
  before?: (signal: AgentAbortSignal) => Promise<void>;
}>;

export class FakeModelProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  readonly #turns: FakeModelTurn[];

  constructor(turns: readonly FakeModelTurn[]) {
    this.#turns = [...turns];
  }

  async complete(
    request: ModelRequest,
    signal: AgentAbortSignal,
  ): Promise<ModelResponse> {
    this.requests.push(request);
    const turn = this.#takeTurn();
    await turn.before?.(signal);
    throwIfAborted(signal);
    if (turn.error !== undefined) throw mapProviderError(turn.error);
    if (turn.response !== undefined) return turn.response;
    return collectModelStream(
      this.#eventIterator(turn.events ?? [], signal),
      signal,
    );
  }

  stream(
    request: ModelRequest,
    signal: AgentAbortSignal,
  ): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const turn = this.#takeTurn();
    return this.#streamTurn(turn, signal);
  }

  #takeTurn(): FakeModelTurn {
    const turn = this.#turns.shift();
    if (turn === undefined) {
      throw new ProviderError(
        'unavailable',
        'The fake model provider has no scripted turn remaining.',
        { retryable: false, category: 'fake_provider_exhausted' },
      );
    }
    return turn;
  }

  async *#streamTurn(
    turn: FakeModelTurn,
    signal: AgentAbortSignal,
  ): AsyncIterable<ModelEvent> {
    await turn.before?.(signal);
    throwIfAborted(signal);
    if (turn.error !== undefined) throw mapProviderError(turn.error);
    if (turn.events !== undefined) {
      yield* this.#eventIterator(turn.events, signal);
      return;
    }
    yield* responseEvents(turn.response!, signal);
  }

  async *#eventIterator(
    events: readonly ModelEvent[],
    signal: AgentAbortSignal,
  ): AsyncIterable<ModelEvent> {
    for (const event of events) {
      throwIfAborted(signal);
      yield event;
    }
  }
}
