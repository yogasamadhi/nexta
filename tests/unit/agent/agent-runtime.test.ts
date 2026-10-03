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

  it('reuses a successful receipt after provider interruption', async () => {
    const execute = vi.fn(async (value: string) => value);
    const call = {
      id: 'stable-call',
      name: 'test.echo',
      argumentsJson: '{"value":"once"}',
    } as const;
    const interrupted = await runtime(
      new FakeModelProvider([
        { response: response([call]) },
        { error: Object.assign(new Error('offline'), { code: 'ENETUNREACH' }) },
      ]),
      echoTool(execute),
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
    ).run({
      runId: 'run-recovery',
      trigger: 'user_input',
      userMessage: '继续',
      initialState: interrupted.state,
    });

    expect(resumed.state.status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    expect(resumed.state.toolCallCount).toBe(1);
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
