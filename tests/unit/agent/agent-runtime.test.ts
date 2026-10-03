import { describe, expect, it, vi } from 'vitest';

import {
  AgentEventCoordinator,
  AgentRuntime,
  AgentToolRegistry,
  createBoundedContextTransform,
  type AgentTool,
  type ModelProvider,
  type ModelResponse,
  type RuntimeSchema,
} from '@workspace/agent-core';
import { FakeModelProvider } from '@workspace/model-runtime';

const usage = { inputTokens: 2, outputTokens: 1, totalTokens: 3 } as const;

function response(
  toolCalls: ModelResponse['toolCalls'] = [],
  text = '',
): ModelResponse {
  return {
    text,
    toolCalls,
    usage,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  };
}

function stringValueSchema(): RuntimeSchema<Readonly<{ value: string }>> {
  return {
    parse(input) {
      if (
        typeof input !== 'object' ||
        input === null ||
        typeof (input as { value?: unknown }).value !== 'string'
      ) {
        throw new TypeError('value is required');
      }
      return { value: (input as { value: string }).value };
    },
  };
}

function echoTool(
  execute: (value: string) => Promise<string>,
  risk: AgentTool<Readonly<{ value: string }>>['risk'] = 'read',
): AgentTool<Readonly<{ value: string }>, Readonly<{ echoed: string }>> {
  return {
    name: 'test.echo',
    description: 'Echoes a validated value.',
    risk,
    inputSchema: stringValueSchema(),
    outputSchema: {
      parse(input) {
        if (
          typeof input !== 'object' ||
          input === null ||
          typeof (input as { echoed?: unknown }).echoed !== 'string'
        ) {
          throw new TypeError('echoed is required');
        }
        return { echoed: (input as { echoed: string }).echoed };
      },
    },
    async execute(input) {
      return { echoed: await execute(input.value) };
    },
  };
}

function runtime(
  provider: ModelProvider,
  tool: AgentTool = echoTool(async (value) => value),
  options: Partial<ConstructorParameters<typeof AgentRuntime>[0]> = {},
): AgentRuntime {
  return new AgentRuntime({
    provider,
    tools: new AgentToolRegistry([tool]),
    maxTurns: 4,
    maxToolCalls: 4,
    runTimeoutMs: 1_000,
    ...options,
  });
}

describe('AgentRuntime', () => {
  it('validates input, obtains write authorization, and feeds output back', async () => {
    const execute = vi.fn(async (value: string) => value.toUpperCase());
    const approval = vi.fn(async () => ({
      approved: true,
      authorizationId: 'approval-1',
    }));
    const provider = new FakeModelProvider([
      {
        response: response([
          {
            id: 'call-1',
            name: 'test.echo',
            argumentsJson: '{"value":"next"}',
          },
        ]),
      },
      { response: response([], '完成') },
    ]);

    const result = await runtime(provider, echoTool(execute, 'low_write'), {
      approval,
    }).run({
      runId: 'run-1',
      trigger: 'user_input',
      userMessage: '继续',
    });

    expect(result.state.status).toBe('completed');
    expect(result.text).toBe('完成');
    expect(result.state.turnCount).toBe(2);
    expect(result.state.toolCallCount).toBe(1);
    expect(result.state.receipts['call-1']?.output).toEqual({ echoed: 'NEXT' });
    expect(execute).toHaveBeenCalledOnce();
    expect(approval).toHaveBeenCalledWith(
      expect.objectContaining({ risk: 'low_write', toolName: 'test.echo' }),
      expect.objectContaining({ aborted: false }),
    );
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain('NEXT');
  });

  it('does not execute a write without explicit authorization', async () => {
    const execute = vi.fn(async (value: string) => value);
    const provider = new FakeModelProvider([
      {
        response: response([
          {
            id: 'call-1',
            name: 'test.echo',
            argumentsJson: '{"value":"blocked"}',
          },
        ]),
      },
      { response: response([], '需要确认') },
    ]);

    const result = await runtime(provider, echoTool(execute, 'high_write')).run(
      {
        runId: 'run-approval',
        trigger: 'user_input',
        userMessage: '执行',
      },
    );

    expect(result.state.status).toBe('completed');
    expect(result.state.toolCallCount).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
      'permission_required',
    );
  });

  it('never executes incomplete streamed tool arguments', async () => {
    const execute = vi.fn(async (value: string) => value);
    const provider = new FakeModelProvider([
      {
        events: [
          { type: 'tool_call_start', id: 'partial', name: 'test.echo' },
          { type: 'tool_call_delta', id: 'partial', delta: '{"value":"x"' },
        ],
      },
    ]);

    const result = await runtime(provider, echoTool(execute), {
      modelMode: 'stream',
    }).run({
      runId: 'run-partial',
      trigger: 'user_input',
      userMessage: '测试',
    });

    expect(result.state.status).toBe('failed');
    expect(result.error?.code).toBe('provider_protocol_error');
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes complete streamed arguments exactly once', async () => {
    const execute = vi.fn(async (value: string) => value);
    const provider = new FakeModelProvider([
      {
        events: [
          { type: 'tool_call_start', id: 'complete', name: 'test.echo' },
          { type: 'tool_call_delta', id: 'complete', delta: '{"value":' },
          { type: 'tool_call_delta', id: 'complete', delta: '"x"}' },
          { type: 'tool_call_end', id: 'complete' },
          { type: 'done', finishReason: 'tool_calls' },
        ],
      },
      {
        events: [
          { type: 'text_delta', delta: '完成' },
          { type: 'done', finishReason: 'stop' },
        ],
      },
    ]);

    const result = await runtime(provider, echoTool(execute), {
      modelMode: 'stream',
    }).run({
      runId: 'run-stream',
      trigger: 'user_input',
      userMessage: '测试',
    });

    expect(result.state.status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('enforces turn and attempted-tool budgets', async () => {
    const maxTurns = await runtime(
      new FakeModelProvider([
        {
          response: response([
            {
              id: 'call-1',
              name: 'test.echo',
              argumentsJson: '{"value":"x"}',
            },
          ]),
        },
      ]),
      undefined,
      { maxTurns: 1 },
    ).run({
      runId: 'run-turns',
      trigger: 'user_input',
      userMessage: '测试',
    });
    expect(maxTurns.state.status).toBe('max_turns');

    const maxTools = await runtime(
      new FakeModelProvider([
        {
          response: response([
            { id: 'bad-1', name: 'missing', argumentsJson: '{}' },
            { id: 'bad-2', name: 'missing', argumentsJson: '{}' },
          ]),
        },
      ]),
      undefined,
      { maxToolCalls: 1 },
    ).run({
      runId: 'run-tools',
      trigger: 'user_input',
      userMessage: '测试',
    });
    expect(maxTools.state.status).toBe('max_tool_calls');
    expect(maxTools.state.toolCallCount).toBe(1);
  });

  it('times out a provider and returns an abort-safe state', async () => {
    const provider: ModelProvider = {
      complete: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped')), {
            once: true,
          });
        }),
      async *stream() {
        yield { type: 'done', finishReason: 'stop' };
      },
    };

    const result = await runtime(provider, undefined, {
      runTimeoutMs: 5,
    }).run({
      runId: 'run-timeout',
      trigger: 'foreground_resume',
      userMessage: '恢复',
    });

    expect(result.state.status).toBe('aborted');
    expect(result.error?.message).toContain('timed out');
  });

  it.each(['complete', 'stream'] as const)(
    'reuses a successful receipt after %s provider interruption',
    async (modelMode) => {
      const execute = vi.fn(async (value: string) => value);
      const call = {
        id: 'stable-call',
        name: 'test.echo',
        argumentsJson: '{"value":"once"}',
      } as const;
      const interrupted = await runtime(
        new FakeModelProvider([
          { response: response([call]) },
          {
            error: Object.assign(new Error('offline'), { code: 'ENETUNREACH' }),
          },
        ]),
        echoTool(execute),
        { modelMode },
      ).run({
        runId: 'run-recovery',
        trigger: 'user_input',
        userMessage: '执行一次',
      });
      expect(interrupted.state.status).toBe('failed');
      expect(interrupted.state.receipts['stable-call']).toBeDefined();

      const resumed = await runtime(
        new FakeModelProvider([
          { response: response([call]) },
          { response: response([], '已恢复') },
        ]),
        echoTool(execute),
        { modelMode },
      ).run({
        runId: 'run-recovery',
        trigger: 'user_input',
        userMessage: '继续',
        initialState: interrupted.state,
      });

      expect(resumed.state.status).toBe('completed');
      expect(execute).toHaveBeenCalledOnce();
      expect(resumed.state.toolCallCount).toBe(1);
    },
  );

  it('returns at the timeout even when a provider ignores abort and fences its late reply', async () => {
    vi.useFakeTimers();
    try {
      let resolveLate!: (value: ModelResponse) => void;
      const execute = vi.fn(async (value: string) => value);
      const provider: ModelProvider = {
        complete: () =>
          new Promise((resolve) => {
            resolveLate = resolve;
          }),
        async *stream() {
          yield { type: 'done', finishReason: 'stop' };
        },
      };
      let settled = false;
      const running = runtime(provider, echoTool(execute), {
        runTimeoutMs: 5,
      }).run({
        runId: 'late-timeout',
        trigger: 'user_input',
        userMessage: '测试',
      });
      void running.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(6);
      const settledAtDeadline = settled;
      resolveLate(
        response([
          { id: 'late', name: 'test.echo', argumentsJson: '{"value":"late"}' },
        ]),
      );
      const result = await running;
      expect(settledAtDeadline).toBe(true);
      expect(result.state.status).toBe('aborted');
      expect(execute).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not accept a completed reply or late approval after caller cancellation', async () => {
    const controller = new AbortController();
    const complete = new FakeModelProvider([
      {
        before: async () => {
          controller.abort();
        },
        response: response([], 'late reply'),
      },
    ]);
    // A custom adapter deliberately ignores its signal.
    const provider: ModelProvider = {
      complete: async () => {
        controller.abort();
        return response([], 'late reply');
      },
      stream: complete.stream.bind(complete),
    };
    const result = await runtime(provider).run({
      runId: 'late-complete',
      trigger: 'user_input',
      userMessage: '取消',
      signal: controller.signal,
    });
    expect(result.state.status).toBe('aborted');
    expect(result.text).toBe('');

    const approvalController = new AbortController();
    const execute = vi.fn(async (value: string) => value);
    const approved = await runtime(
      new FakeModelProvider([
        {
          response: response([
            {
              id: 'write',
              name: 'test.echo',
              argumentsJson: '{"value":"write"}',
            },
          ]),
        },
      ]),
      echoTool(execute, 'high_write'),
      {
        approval: async () => {
          approvalController.abort();
          return { approved: true, authorizationId: 'late-approval' };
        },
      },
    ).run({
      runId: 'late-approval',
      trigger: 'user_input',
      userMessage: '取消',
      signal: approvalController.signal,
    });
    expect(approved.state.status).toBe('aborted');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['stream', 'approval', 'tool'] as const)(
    'bounds an uncooperative %s and ignores its late output',
    async (phase) => {
      vi.useFakeTimers();
      try {
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const pending = () =>
          new Promise<void>((resolve) => {
            release = resolve;
            entered();
          });
        const emissions: unknown[] = [];
        const execute = vi.fn(async (value: string) => {
          if (phase === 'tool') await pending();
          return value;
        });
        const scripted = new FakeModelProvider([
          {
            response: response([
              {
                id: 'pending-call',
                name: 'test.echo',
                argumentsJson: '{"value":"x"}',
              },
            ]),
          },
        ]);
        const provider: ModelProvider =
          phase === 'stream'
            ? {
                complete: scripted.complete.bind(scripted),
                async *stream() {
                  await pending();
                  yield { type: 'text_delta', delta: 'late' };
                  yield { type: 'done', finishReason: 'stop' };
                },
              }
            : scripted;
        const running = runtime(
          provider,
          echoTool(execute, phase === 'approval' ? 'high_write' : 'read'),
          {
            modelMode: phase === 'stream' ? 'stream' : 'complete',
            runTimeoutMs: 5,
            approval: async () => {
              await pending();
              return { approved: true, authorizationId: 'late' };
            },
          },
        ).run({
          runId: `timeout-${phase}`,
          trigger: 'user_input',
          userMessage: '测试',
          onEvent: (event) => emissions.push(event),
        });
        await started;
        await vi.advanceTimersByTimeAsync(6);
        const result = await running;
        expect(result.state.status).toBe('aborted');
        const atFinish = JSON.stringify(emissions);
        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(JSON.stringify(emissions)).toBe(atFinish);
        expect(result.state.receipts).toEqual({});
        if (phase !== 'tool') expect(execute).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('rejects unknown, invalid and external-sensitive calls before executing any tool', async () => {
    const execute = vi.fn(async (value: string) => value);
    const approval = vi.fn(async () => ({
      approved: true,
      authorizationId: 'approval',
    }));
    const provider = new FakeModelProvider([
      {
        response: response([
          { id: 'unknown', name: 'missing', argumentsJson: '{}' },
          { id: 'invalid', name: 'test.echo', argumentsJson: '{"value":7}' },
          { id: 'external', name: 'test.echo', argumentsJson: '{"value":"x"}' },
        ]),
      },
      { response: response([], 'review') },
    ]);
    const result = await runtime(
      provider,
      echoTool(execute, 'external_sensitive'),
      { approval },
    ).run({
      runId: 'invalid-boundaries',
      trigger: 'user_input',
      userMessage: '测试',
    });
    expect(result.state.status).toBe('completed');
    expect(execute).not.toHaveBeenCalled();
    expect(approval).not.toHaveBeenCalled();
    expect(
      result.state.messages
        .filter((m) => m.role === 'tool')
        .map((m) => JSON.parse(m.content).error.code),
    ).toEqual(['unknown_tool', 'validation_error', 'permission_required']);
  });

  it('keeps upstream error payloads out of tool messages and stream error events', async () => {
    const provider = new FakeModelProvider([
      {
        response: response([
          { id: 'failure', name: 'test.echo', argumentsJson: '{"value":"x"}' },
        ]),
      },
      { response: response([], 'done') },
    ]);
    const result = await runtime(
      provider,
      echoTool(async () => {
        throw Object.assign(new Error('credential=fixture-secret'), {
          code: 'prompt=fixture-secret',
          retryable: true,
          body: 'fixture-secret',
        });
      }),
    ).run({
      runId: 'tool-privacy',
      trigger: 'user_input',
      userMessage: '测试',
    });
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    expect(
      result.state.messages.find((m) => m.role === 'tool')?.content,
    ).toContain('tool_execution_error');
    const emitted: unknown[] = [];
    const streamed = await runtime(
      new FakeModelProvider([
        {
          events: [
            {
              type: 'error',
              code: 'credential=fixture-secret',
              message: 'body=fixture-secret',
              retryable: false,
            },
          ],
        },
      ]),
      undefined,
      { modelMode: 'stream' },
    ).run({
      runId: 'stream-privacy',
      trigger: 'user_input',
      userMessage: '测试',
      onEvent: (event) => emitted.push(event),
    });
    expect(streamed.state.status).toBe('failed');
    expect(JSON.stringify(emitted)).not.toContain('fixture-secret');
  });

  it('bounds messages, content, and tool argument context', () => {
    const transform = createBoundedContextTransform({
      maxMessages: 3,
      maxCharacters: 12,
      maxToolArgumentCharacters: 4,
    });
    const transformed = transform([
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'old-secret' },
      {
        role: 'assistant',
        content: 'new',
        toolCalls: [{ id: 'c', name: 'test.echo', argumentsJson: '123456789' }],
      },
      { role: 'tool', toolCallId: 'c', content: 'output' },
    ]);

    expect(transformed).toHaveLength(3);
    expect(transformed.map((message) => message.content).join('')).toHaveLength(
      12,
    );
    expect(
      transformed.map((message) => message.content).join(''),
    ).not.toContain('old-secret');
    expect(transformed[1]?.toolCalls?.[0]?.argumentsJson).toBe('1234');
  });

  it('does not send excluded history to the Provider context', async () => {
    const provider = new FakeModelProvider([
      { response: response([], '最小上下文') },
    ]);
    const agent = runtime(provider, undefined, {
      transformContext: createBoundedContextTransform({
        maxMessages: 2,
        maxCharacters: 100,
        maxToolArgumentCharacters: 20,
      }),
    });

    await agent.run({
      runId: 'run-privacy',
      trigger: 'foreground_resume',
      userMessage: '恢复',
      initialState: {
        runId: 'run-privacy',
        trigger: 'foreground_resume',
        status: 'running',
        turnCount: 2,
        toolCallCount: 0,
        receipts: {},
        messages: [
          { role: 'system', content: '只读取必要事实' },
          { role: 'user', content: 'API_KEY=secret; 历史日记：不相关内容' },
          { role: 'assistant', content: '旧回复' },
          { role: 'user', content: '只检查今天' },
        ],
      },
    });

    const sent = JSON.stringify(provider.requests[0]);
    expect(sent).toContain('只检查今天');
    expect(sent).not.toContain('API_KEY');
    expect(sent).not.toContain('历史日记');
  });
});

describe('AgentEventCoordinator', () => {
  it('queues while inactive, coalesces duplicates, and drains on activation', async () => {
    const runs: string[] = [];
    const coordinator = new AgentEventCoordinator<string>({
      async runner(event) {
        runs.push(event.payload);
      },
    });

    expect(
      coordinator.notify({
        kind: 'calendar_changed',
        dedupeKey: 'calendar-v2',
        payload: 'first',
      }),
    ).toBe(true);
    expect(
      coordinator.notify({
        kind: 'calendar_changed',
        dedupeKey: 'calendar-v2',
        payload: 'duplicate',
      }),
    ).toBe(false);
    expect(runs).toEqual([]);

    coordinator.setActive(true);
    await coordinator.waitForIdle();
    expect(runs).toEqual(['first']);
  });

  it('aborts active work and retries the coalesced event after reactivation', async () => {
    let attempts = 0;
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const coordinator = new AgentEventCoordinator({
      runner: async (_event, signal) => {
        attempts += 1;
        if (attempts > 1) return;
        started();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('inactive')),
            {
              once: true,
            },
          );
        });
      },
    });
    coordinator.setActive(true);
    coordinator.notify({
      kind: 'foreground_resume',
      dedupeKey: 'resume-1',
      payload: null,
    });
    await didStart;
    coordinator.setActive(false);
    await coordinator.waitForIdle();
    coordinator.setActive(true);
    await coordinator.waitForIdle();

    expect(attempts).toBe(2);
  });
});
