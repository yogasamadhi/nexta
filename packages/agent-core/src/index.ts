export const agentTriggerKinds = [
  'user_input',
  'foreground_resume',
  'task_completed',
  'calendar_changed',
  'notification_opened',
  'background_window',
  'manual_replan',
] as const;

export type AgentTriggerKind = (typeof agentTriggerKinds)[number];
export type ToolRisk =
  'read' | 'low_write' | 'high_write' | 'external_sensitive';

export interface RuntimeSchema<Value> {
  parse(input: unknown): Value;
}

export type ModelUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}>;

export type ModelToolCall = Readonly<{
  id: string;
  name: string;
  argumentsJson: string;
}>;

export type ModelMessage = Readonly<{
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: readonly ModelToolCall[];
}>;

export type ModelToolDefinition = Readonly<{
  name: string;
  description: string;
  inputJsonSchema?: unknown;
}>;

export type ModelRequest = Readonly<{
  messages: readonly ModelMessage[];
  tools: readonly ModelToolDefinition[];
  maxOutputTokens?: number;
}>;

export type ModelResponse = Readonly<{
  text: string;
  toolCalls: readonly ModelToolCall[];
  usage: ModelUsage | null;
  finishReason: 'stop' | 'tool_calls' | 'length';
}>;

export type ModelEvent =
  | Readonly<{ type: 'text_delta'; delta: string }>
  | Readonly<{ type: 'tool_call_start'; id: string; name: string }>
  | Readonly<{ type: 'tool_call_delta'; id: string; delta: string }>
  | Readonly<{ type: 'tool_call_end'; id: string }>
  | Readonly<{ type: 'usage'; usage: ModelUsage }>
  | Readonly<{
      type: 'error';
      code: string;
      message: string;
      retryable: boolean;
    }>
  | Readonly<{
      type: 'done';
      finishReason: 'stop' | 'tool_calls' | 'length';
    }>;

export interface AgentAbortSignal {
  readonly aborted: boolean;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: Readonly<{ once?: boolean }>,
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface ModelProvider {
  complete(
    request: ModelRequest,
    signal: AgentAbortSignal,
  ): Promise<ModelResponse>;
  stream(
    request: ModelRequest,
    signal: AgentAbortSignal,
  ): AsyncIterable<ModelEvent>;
}

export type ToolAuthorization = Readonly<{
  approved: boolean;
  authorizationId?: string;
  reason?: string;
}>;

export type ToolApprovalRequest = Readonly<{
  runId: string;
  trigger: AgentTriggerKind;
  toolCallId: string;
  toolName: string;
  input: unknown;
  risk: ToolRisk;
}>;

export type ApprovalHook = (
  request: ToolApprovalRequest,
  signal: AgentAbortSignal,
) => Promise<ToolAuthorization>;

export type AgentToolExecutionContext = Readonly<{
  runId: string;
  trigger: AgentTriggerKind;
  toolCallId: string;
  risk: ToolRisk;
  authorizationId: string | null;
  signal: AgentAbortSignal;
}>;

export interface AgentTool<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRisk;
  readonly inputSchema: RuntimeSchema<Input>;
  readonly outputSchema: RuntimeSchema<Output>;
  readonly inputJsonSchema?: unknown;
  assessRisk?(input: Input): ToolRisk;
  execute(input: Input, context: AgentToolExecutionContext): Promise<Output>;
}

export class AgentToolRegistry {
  readonly #tools = new Map<string, AgentTool>();

  constructor(tools: readonly AgentTool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: AgentTool): void {
    const name = requireText(tool.name, 'Tool name');
    requireText(tool.description, 'Tool description');
    if (this.#tools.has(name)) {
      throw new TypeError(`Agent tool ${name} is already registered.`);
    }
    this.#tools.set(name, tool);
  }

  get(name: string): AgentTool | null {
    return this.#tools.get(name) ?? null;
  }

  definitions(): readonly ModelToolDefinition[] {
    return [...this.#tools.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        ...(tool.inputJsonSchema === undefined
          ? {}
          : { inputJsonSchema: tool.inputJsonSchema }),
      }));
  }
}

export type AgentToolReceipt = Readonly<{
  toolCallId: string;
  toolName: string;
  risk: ToolRisk;
  output: unknown;
}>;

export type AgentRunStatus =
  | 'running'
  | 'completed'
  | 'max_turns'
  | 'max_tool_calls'
  | 'aborted'
  | 'failed';

export type AgentState = Readonly<{
  runId: string;
  trigger: AgentTriggerKind;
  messages: readonly ModelMessage[];
  receipts: Readonly<Record<string, AgentToolReceipt>>;
  turnCount: number;
  toolCallCount: number;
  status: AgentRunStatus;
}>;

export type AgentRunError = Readonly<{
  code:
    | 'aborted'
    | 'provider_error'
    | 'provider_protocol_error'
    | 'tool_execution_error';
  message: string;
  retryable: boolean;
}>;

export type AgentRunResult = Readonly<{
  state: AgentState;
  text: string;
  usage: ModelUsage | null;
  error: AgentRunError | null;
}>;

export type AgentRuntimeEvent =
  | Readonly<{ type: 'run_started'; state: AgentState }>
  | Readonly<{ type: 'turn_started'; turn: number }>
  | Readonly<{ type: 'model_event'; event: ModelEvent }>
  | Readonly<{
      type: 'tool_started';
      toolCallId: string;
      toolName: string;
      risk: ToolRisk;
    }>
  | Readonly<{ type: 'tool_finished'; receipt: AgentToolReceipt }>
  | Readonly<{
      type: 'tool_rejected';
      toolCallId: string;
      toolName: string;
      reason: string;
    }>
  | Readonly<{ type: 'run_finished'; result: AgentRunResult }>;

export type AgentRuntimeOptions = Readonly<{
  provider: ModelProvider;
  tools: AgentToolRegistry;
  approval?: ApprovalHook;
  maxTurns: number;
  maxToolCalls: number;
  runTimeoutMs: number;
  maxOutputTokens?: number;
  modelMode?: 'complete' | 'stream';
  transformContext?: (
    messages: readonly ModelMessage[],
  ) => readonly ModelMessage[];
}>;

export type StartAgentRunInput = Readonly<{
  runId: string;
  trigger: AgentTriggerKind;
  userMessage: string;
  systemMessage?: string;
  initialState?: AgentState;
  signal?: AgentAbortSignal;
  onEvent?: (event: AgentRuntimeEvent) => void;
}>;

class ProviderProtocolError extends Error {}
class RuntimeAbortError extends Error {}

function waitForRunSignal<Value>(
  operation: Promise<Value>,
  signal: AgentAbortSignal,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new RuntimeAbortError('Agent run was aborted.'));
    };
    // Attach both handlers even when already aborted: a late rejection must not
    // become unhandled, and a late result cannot resume the terminated run.
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort);
  });
}

class RuntimeAbortController {
  readonly #listeners = new Set<() => void>();
  readonly signal: AgentAbortSignal;
  #aborted = false;

  constructor() {
    this.signal = {
      get aborted() {
        return controller.#aborted;
      },
      addEventListener: (_type, listener, options) => {
        if (this.#aborted) {
          listener();
          return;
        }
        if (options?.once === true) {
          const once = () => {
            this.#listeners.delete(once);
            listener();
          };
          this.#listeners.add(once);
        } else {
          this.#listeners.add(listener);
        }
      },
      removeEventListener: (_type, listener) => {
        this.#listeners.delete(listener);
      },
    };
    const controller = this;
  }

  abort(): void {
    if (this.#aborted) return;
    this.#aborted = true;
    for (const listener of [...this.#listeners]) listener();
    this.#listeners.clear();
  }
}

type RuntimeTimerGlobals = Readonly<{
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}>;

function startTimeout(callback: () => void, delayMs: number): () => void {
  const timerGlobals = globalThis as unknown as Partial<RuntimeTimerGlobals>;
  if (
    typeof timerGlobals.setTimeout !== 'function' ||
    typeof timerGlobals.clearTimeout !== 'function'
  ) {
    throw new TypeError('This runtime does not provide timers.');
  }
  const handle = timerGlobals.setTimeout(callback, delayMs);
  return () => timerGlobals.clearTimeout?.(handle);
}

function requireText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be non-empty text.`);
  }
  return value.trim();
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function validateTrigger(value: string): AgentTriggerKind {
  if (!agentTriggerKinds.includes(value as AgentTriggerKind)) {
    throw new TypeError('Agent trigger is unsupported.');
  }
  return value as AgentTriggerKind;
}

function validateUsage(usage: ModelUsage): ModelUsage {
  for (const value of [
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ProviderProtocolError('Provider usage metadata is invalid.');
    }
  }
  if (usage.totalTokens < usage.inputTokens + usage.outputTokens) {
    throw new ProviderProtocolError('Provider total token usage is invalid.');
  }
  return usage;
}

function validateResponse(response: ModelResponse): ModelResponse {
  if (typeof response.text !== 'string' || !Array.isArray(response.toolCalls)) {
    throw new ProviderProtocolError('Provider response shape is invalid.');
  }
  if (!['stop', 'tool_calls', 'length'].includes(response.finishReason)) {
    throw new ProviderProtocolError('Provider finish reason is invalid.');
  }
  const ids = new Set<string>();
  for (const call of response.toolCalls) {
    if (
      typeof call.id !== 'string' ||
      call.id.trim().length === 0 ||
      typeof call.name !== 'string' ||
      call.name.trim().length === 0 ||
      typeof call.argumentsJson !== 'string'
    ) {
      throw new ProviderProtocolError('Provider tool call shape is invalid.');
    }
    if (ids.has(call.id)) {
      throw new ProviderProtocolError(
        'Provider returned duplicate tool call IDs.',
      );
    }
    ids.add(call.id);
  }
  const hasCalls = response.toolCalls.length > 0;
  if ((response.finishReason === 'tool_calls') !== hasCalls) {
    throw new ProviderProtocolError(
      'Provider finish reason does not match its tool calls.',
    );
  }
  if (response.usage !== null) validateUsage(response.usage);
  return response;
}

function sanitizeToolFailure(error: unknown): Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}> {
  const codes = new Set([
    'validation_error',
    'not_found',
    'permission_required',
    'active_session_conflict',
    'invalid_transition',
    'preview_not_found',
    'preview_expired',
    'plan_conflict',
    'idempotency_conflict',
    'undo_unavailable',
    'reconciliation_required',
    'scheduling_setup_required',
    'adapter_error',
    'provider_error',
    'provider_timeout',
    'aborted',
  ]);
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      retryable?: unknown;
    };
    if (
      typeof candidate.code === 'string' &&
      codes.has(candidate.code) &&
      typeof candidate.retryable === 'boolean'
    ) {
      return {
        code: candidate.code,
        message: 'The tool did not complete.',
        retryable: candidate.retryable,
      };
    }
  }
  return {
    code: 'tool_execution_error',
    message: 'The tool did not complete.',
    retryable: false,
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      ok: false,
      error: {
        code: 'tool_output_invalid',
        message: 'Tool output is not JSON.',
      },
    });
  }
}

async function collectStream(
  provider: ModelProvider,
  request: ModelRequest,
  signal: AgentAbortSignal,
  emit: (event: ModelEvent) => void,
): Promise<ModelResponse> {
  let text = '';
  let usage: ModelUsage | null = null;
  let finishReason: ModelResponse['finishReason'] | null = null;
  const calls = new Map<
    string,
    { name: string; argumentsJson: string; ended: boolean }
  >();
  for await (const event of provider.stream(request, signal)) {
    if (signal.aborted) throw new RuntimeAbortError('Agent run was aborted.');
    emit(
      event.type === 'error'
        ? {
            type: 'error',
            code:
              event.code === 'rate_limited' ? 'rate_limited' : 'provider_error',
            message: 'The model provider stream failed.',
            retryable: event.retryable === true,
          }
        : event,
    );
    if (event.type === 'text_delta') text += event.delta;
    else if (event.type === 'tool_call_start') {
      if (
        typeof event.id !== 'string' ||
        event.id.trim().length === 0 ||
        typeof event.name !== 'string' ||
        event.name.trim().length === 0
      ) {
        throw new ProviderProtocolError('Streamed tool call shape is invalid.');
      }
      if (calls.has(event.id)) {
        throw new ProviderProtocolError('Duplicate streamed tool call id.');
      }
      calls.set(event.id, {
        name: event.name.trim(),
        argumentsJson: '',
        ended: false,
      });
    } else if (event.type === 'tool_call_delta') {
      const call = calls.get(event.id);
      if (call === undefined || call.ended) {
        throw new ProviderProtocolError('Tool arguments arrived out of order.');
      }
      call.argumentsJson += event.delta;
    } else if (event.type === 'tool_call_end') {
      const call = calls.get(event.id);
      if (call === undefined || call.ended) {
        throw new ProviderProtocolError('Tool call ended out of order.');
      }
      call.ended = true;
    } else if (event.type === 'usage') usage = validateUsage(event.usage);
    else if (event.type === 'error') {
      throw Object.assign(new Error(event.message), {
        code: event.code,
        retryable: event.retryable,
      });
    } else if (event.type === 'done') finishReason = event.finishReason;
  }
  if (
    finishReason === null ||
    [...calls.values()].some((call) => !call.ended)
  ) {
    throw new ProviderProtocolError('Provider stream ended before completion.');
  }
  return validateResponse({
    text,
    toolCalls: [...calls.entries()].map(([id, call]) => ({
      id,
      name: call.name,
      argumentsJson: call.argumentsJson,
    })),
    usage,
    finishReason,
  });
}

function mergeUsage(
  left: ModelUsage | null,
  right: ModelUsage | null,
): ModelUsage | null {
  if (left === null) return right;
  if (right === null) return left;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function initialState(input: StartAgentRunInput): AgentState {
  const runId = requireText(input.runId, 'Agent run ID');
  const trigger = validateTrigger(input.trigger);
  if (input.initialState !== undefined) {
    if (
      input.initialState.runId !== runId ||
      input.initialState.trigger !== trigger
    ) {
      throw new TypeError('Initial Agent state belongs to another run.');
    }
    return { ...input.initialState, status: 'running' };
  }
  const messages: ModelMessage[] = [];
  if (input.systemMessage !== undefined) {
    messages.push({
      role: 'system',
      content: requireText(input.systemMessage, 'System message'),
    });
  }
  messages.push({
    role: 'user',
    content: requireText(input.userMessage, 'User message'),
  });
  return {
    runId,
    trigger,
    messages,
    receipts: {},
    turnCount: 0,
    toolCallCount: 0,
    status: 'running',
  };
}

function finalize(
  state: AgentState,
  status: AgentRunStatus,
  text: string,
  usage: ModelUsage | null,
  error: AgentRunError | null,
  onEvent?: (event: AgentRuntimeEvent) => void,
): AgentRunResult {
  const result: AgentRunResult = {
    state: { ...state, status },
    text,
    usage,
    error,
  };
  onEvent?.({ type: 'run_finished', result });
  return result;
}

export class AgentRuntime {
  readonly #options: AgentRuntimeOptions;

  constructor(options: AgentRuntimeOptions) {
    this.#options = {
      ...options,
      maxTurns: requirePositiveInteger(options.maxTurns, 'maxTurns'),
      maxToolCalls: requirePositiveInteger(
        options.maxToolCalls,
        'maxToolCalls',
      ),
      runTimeoutMs: requirePositiveInteger(
        options.runTimeoutMs,
        'runTimeoutMs',
      ),
    };
  }

  async run(input: StartAgentRunInput): Promise<AgentRunResult> {
    let state = initialState(input);
    let latestText = '';
    let totalUsage: ModelUsage | null = null;
    const controller = new RuntimeAbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (input.signal?.aborted === true) controller.abort();
    else
      input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const cancelTimeout = startTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#options.runTimeoutMs);
    const stopIfAborted = (): AgentRunResult | null =>
      controller.signal.aborted
        ? finalize(
            state,
            'aborted',
            latestText,
            totalUsage,
            {
              code: 'aborted',
              message: timedOut
                ? 'Agent run timed out.'
                : 'Agent run was aborted.',
              retryable: true,
            },
            input.onEvent,
          )
        : null;

    input.onEvent?.({ type: 'run_started', state });
    try {
      while (state.turnCount < this.#options.maxTurns) {
        const aborted = stopIfAborted();
        if (aborted !== null) return aborted;
        const turn = state.turnCount + 1;
        input.onEvent?.({ type: 'turn_started', turn });
        const contextMessages =
          this.#options.transformContext?.(state.messages) ?? state.messages;
        const request: ModelRequest = {
          messages: contextMessages,
          tools: this.#options.tools.definitions(),
          ...(this.#options.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: this.#options.maxOutputTokens }),
        };
        let response: ModelResponse;
        try {
          response = validateResponse(
            await waitForRunSignal(
              this.#options.modelMode === 'stream'
                ? collectStream(
                    this.#options.provider,
                    request,
                    controller.signal,
                    (event) => input.onEvent?.({ type: 'model_event', event }),
                  )
                : this.#options.provider.complete(request, controller.signal),
              controller.signal,
            ),
          );
        } catch (error) {
          const abortedDuringModel = stopIfAborted();
          if (abortedDuringModel !== null) return abortedDuringModel;
          const protocol = error instanceof ProviderProtocolError;
          return finalize(
            state,
            'failed',
            latestText,
            totalUsage,
            {
              code: protocol ? 'provider_protocol_error' : 'provider_error',
              message: protocol
                ? error.message
                : 'The model provider did not complete the turn.',
              retryable: !protocol,
            },
            input.onEvent,
          );
        }
        const afterModelAbort = stopIfAborted();
        if (afterModelAbort !== null) return afterModelAbort;
        latestText = response.text;
        totalUsage = mergeUsage(totalUsage, response.usage);
        state = {
          ...state,
          turnCount: turn,
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: response.text,
              toolCalls: response.toolCalls,
            },
          ],
        };
        if (response.toolCalls.length === 0) {
          return finalize(
            state,
            'completed',
            response.text,
            totalUsage,
            null,
            input.onEvent,
          );
        }
        for (const call of response.toolCalls) {
          const afterAbort = stopIfAborted();
          if (afterAbort !== null) return afterAbort;
          const existing = state.receipts[call.id];
          if (existing !== undefined) {
            state = {
              ...state,
              messages: [
                ...state.messages,
                {
                  role: 'tool',
                  toolCallId: call.id,
                  content: safeJson({ ok: true, output: existing.output }),
                },
              ],
            };
            continue;
          }
          if (state.toolCallCount >= this.#options.maxToolCalls) {
            return finalize(
              state,
              'max_tool_calls',
              latestText,
              totalUsage,
              null,
              input.onEvent,
            );
          }
          state = { ...state, toolCallCount: state.toolCallCount + 1 };
          const tool = this.#options.tools.get(call.name);
          if (tool === null) {
            state = this.#appendToolError(state, call, {
              code: 'unknown_tool',
              message: 'The requested tool is not available.',
              retryable: false,
            });
            continue;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(call.argumentsJson);
            parsed = tool.inputSchema.parse(parsed);
          } catch {
            state = this.#appendToolError(state, call, {
              code: 'validation_error',
              message: 'Tool input did not match its schema.',
              retryable: false,
            });
            continue;
          }
          const risk = tool.assessRisk?.(parsed) ?? tool.risk;
          let authorization: ToolAuthorization = { approved: risk === 'read' };
          if (risk === 'external_sensitive') {
            authorization = {
              approved: false,
              reason: 'External-sensitive tools are not enabled in V1.',
            };
          } else if (risk !== 'read') {
            try {
              authorization =
                this.#options.approval === undefined
                  ? {
                      approved: false,
                      reason: 'This write requires explicit authorization.',
                    }
                  : await waitForRunSignal(
                      this.#options.approval(
                        {
                          runId: state.runId,
                          trigger: state.trigger,
                          toolCallId: call.id,
                          toolName: call.name,
                          input: parsed,
                          risk,
                        },
                        controller.signal,
                      ),
                      controller.signal,
                    );
            } catch {
              const afterApprovalAbort = stopIfAborted();
              if (afterApprovalAbort !== null) return afterApprovalAbort;
              return finalize(
                state,
                'failed',
                latestText,
                totalUsage,
                {
                  code: 'tool_execution_error',
                  message: 'Tool authorization did not complete.',
                  retryable: false,
                },
                input.onEvent,
              );
            }
          }
          const afterApprovalAbort = stopIfAborted();
          if (afterApprovalAbort !== null) return afterApprovalAbort;
          if (!authorization.approved) {
            const reason =
              authorization.reason ?? 'Tool execution was not authorized.';
            input.onEvent?.({
              type: 'tool_rejected',
              toolCallId: call.id,
              toolName: call.name,
              reason,
            });
            state = this.#appendToolError(state, call, {
              code: 'permission_required',
              message: reason,
              retryable: false,
            });
            continue;
          }
          input.onEvent?.({
            type: 'tool_started',
            toolCallId: call.id,
            toolName: call.name,
            risk,
          });
          try {
            const output = tool.outputSchema.parse(
              await waitForRunSignal(
                tool.execute(parsed, {
                  runId: state.runId,
                  trigger: state.trigger,
                  toolCallId: call.id,
                  risk,
                  authorizationId: authorization.authorizationId ?? null,
                  signal: controller.signal,
                }),
                controller.signal,
              ),
            );
            const receipt: AgentToolReceipt = {
              toolCallId: call.id,
              toolName: call.name,
              risk,
              output,
            };
            input.onEvent?.({ type: 'tool_finished', receipt });
            state = {
              ...state,
              receipts: { ...state.receipts, [call.id]: receipt },
              messages: [
                ...state.messages,
                {
                  role: 'tool',
                  toolCallId: call.id,
                  content: safeJson({ ok: true, output }),
                },
              ],
            };
          } catch (error) {
            const afterToolAbort = stopIfAborted();
            if (afterToolAbort !== null) return afterToolAbort;
            state = this.#appendToolError(
              state,
              call,
              sanitizeToolFailure(error),
            );
          }
        }
      }
      return finalize(
        state,
        'max_turns',
        latestText,
        totalUsage,
        null,
        input.onEvent,
      );
    } finally {
      cancelTimeout();
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  #appendToolError(
    state: AgentState,
    call: ModelToolCall,
    error: Readonly<{ code: string; message: string; retryable: boolean }>,
  ): AgentState {
    return {
      ...state,
      messages: [
        ...state.messages,
        {
          role: 'tool',
          toolCallId: call.id,
          content: safeJson({ ok: false, error }),
        },
      ],
    };
  }
}

export type BoundedContextOptions = Readonly<{
  maxMessages: number;
  maxCharacters: number;
  maxToolArgumentCharacters: number;
}>;

/**
 * Applies a deterministic size allowlist to context already selected by the
 * application. Product code remains responsible for selecting which facts may
 * enter the message list in the first place.
 */
export function createBoundedContextTransform(
  options: BoundedContextOptions,
): (messages: readonly ModelMessage[]) => readonly ModelMessage[] {
  const maxMessages = requirePositiveInteger(
    options.maxMessages,
    'maxMessages',
  );
  const maxCharacters = requirePositiveInteger(
    options.maxCharacters,
    'maxCharacters',
  );
  const maxToolArgumentCharacters = requirePositiveInteger(
    options.maxToolArgumentCharacters,
    'maxToolArgumentCharacters',
  );
  return (messages) => {
    const system = messages.find((message) => message.role === 'system');
    const tailBudget = system === undefined ? maxMessages : maxMessages - 1;
    const tail = tailBudget > 0 ? messages.slice(-tailBudget) : [];
    const selected = [
      ...(system === undefined ? [] : [system]),
      ...tail.filter((message) => message !== system),
    ].slice(-maxMessages);
    let remainingCharacters = maxCharacters;
    return selected.map((message) => {
      const content = message.content.slice(0, remainingCharacters);
      remainingCharacters -= content.length;
      return {
        role: message.role,
        content,
        ...(message.toolCallId === undefined
          ? {}
          : { toolCallId: message.toolCallId }),
        ...(message.toolCalls === undefined
          ? {}
          : {
              toolCalls: message.toolCalls.map((call) => ({
                ...call,
                argumentsJson: call.argumentsJson.slice(
                  0,
                  maxToolArgumentCharacters,
                ),
              })),
            }),
      };
    });
  };
}

export type AgentTriggerEvent<Payload = unknown> = Readonly<{
  kind: AgentTriggerKind;
  dedupeKey: string;
  payload: Payload;
}>;

export type AgentEventRunner<Payload> = (
  event: AgentTriggerEvent<Payload>,
  signal: AgentAbortSignal,
) => Promise<void>;

export type AgentEventCoordinatorOptions<Payload> = Readonly<{
  runner: AgentEventRunner<Payload>;
  onError?: (error: unknown, event: AgentTriggerEvent<Payload>) => void;
}>;

/**
 * Foreground-owned, event-driven dispatcher. It coalesces equal pending or
 * running events and aborts work when the host becomes inactive; it never
 * creates a background daemon.
 */
export class AgentEventCoordinator<Payload = unknown> {
  readonly #options: AgentEventCoordinatorOptions<Payload>;
  readonly #pending = new Map<string, AgentTriggerEvent<Payload>>();
  #active = false;
  #currentKey: string | null = null;
  #currentAbort: RuntimeAbortController | null = null;
  #drainPromise: Promise<void> | null = null;

  constructor(options: AgentEventCoordinatorOptions<Payload>) {
    this.#options = options;
  }

  setActive(active: boolean): void {
    this.#active = active;
    if (!active) this.#currentAbort?.abort();
    else this.#startDrain();
  }

  notify(event: AgentTriggerEvent<Payload>): boolean {
    validateTrigger(event.kind);
    const dedupeKey = requireText(event.dedupeKey, 'Agent event dedupe key');
    const key = `${event.kind}:${dedupeKey}`;
    if (key === this.#currentKey || this.#pending.has(key)) return false;
    this.#pending.set(key, { ...event, dedupeKey });
    this.#startDrain();
    return true;
  }

  async waitForIdle(): Promise<void> {
    while (this.#drainPromise !== null) await this.#drainPromise;
  }

  #startDrain(): void {
    if (!this.#active || this.#drainPromise !== null) return;
    this.#drainPromise = this.#drain().finally(() => {
      this.#drainPromise = null;
      if (this.#active && this.#pending.size > 0) this.#startDrain();
    });
  }

  async #drain(): Promise<void> {
    while (this.#active) {
      const next = this.#pending.entries().next().value as
        [string, AgentTriggerEvent<Payload>] | undefined;
      if (next === undefined) return;
      const [key, event] = next;
      this.#pending.delete(key);
      this.#currentKey = key;
      this.#currentAbort = new RuntimeAbortController();
      try {
        await this.#options.runner(event, this.#currentAbort.signal);
      } catch (error) {
        this.#options.onError?.(error, event);
        if (!this.#active && !this.#pending.has(key)) {
          this.#pending.set(key, event);
        }
      } finally {
        this.#currentKey = null;
        this.#currentAbort = null;
      }
    }
  }
}
