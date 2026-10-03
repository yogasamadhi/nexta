// Isolated Metro entry. The production expo-router entry never imports this file.
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { registerRootComponent } from 'expo';
import { openDatabaseAsync } from 'expo-sqlite';
import { PreferenceService } from '@workspace/application';
import { parseInstant } from '@workspace/domain';
import {
  createExpoSqliteDatabase,
  initializeSqliteApplicationUnitOfWork,
  type SqliteDatabase,
} from '@workspace/database';

import {
  AgentRuntime,
  AgentToolRegistry,
  type AgentTool,
} from '@workspace/agent-core';
import { FakeModelProvider } from '@workspace/model-runtime';
import {
  previewSchedule,
  replanSchedule,
  type ScheduleInput,
  type ScheduleResult,
} from '@workspace/scheduler-core';
import {
  assertFeasible,
  planChanges,
  timingSummary,
} from '../../../tests/benchmarks/scheduler/analysis';
import {
  benchmarkScenarios,
  replanInput,
} from '../../../tests/benchmarks/scheduler/scenarios';

function invariant(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
function same(a: unknown, b: unknown, code: string) {
  invariant(JSON.stringify(a) === JSON.stringify(b), code);
}
function measure(
  input: ScheduleInput,
  calculate: (input: ScheduleInput) => ScheduleResult,
) {
  const original = JSON.stringify(input);
  const result = calculate(input);
  assertFeasible(input, result);
  const samples = [];
  for (let i = 0; i < 6; i += 1) {
    const start = performance.now();
    const actual = calculate(input);
    const elapsed = performance.now() - start;
    if (i > 0) samples.push(elapsed);
    same(actual, result, 'determinism');
  }
  same(
    calculate({
      ...input,
      tasks: [...input.tasks].reverse(),
      busyEvents: [...input.busyEvents].reverse(),
      existingBlocks: [...input.existingBlocks].reverse(),
      preferences: {
        ...input.preferences,
        workingWindows: [...input.preferences.workingWindows].reverse(),
      },
    }),
    result,
    'permutation',
  );
  invariant(original === JSON.stringify(input), 'input_mutated');
  return {
    result,
    timing: timingSummary(samples),
    changes: planChanges(input, result),
    metrics: result.metrics,
  };
}
async function agentSmoke(mode: 'complete' | 'stream') {
  let calls = 0;
  const tool: AgentTool<{ value: string }, { echoed: string }> = {
    name: 'test.echo',
    description: 'Synthetic read-only smoke tool.',
    risk: 'read',
    inputSchema: {
      parse(input) {
        invariant(
          typeof input === 'object' &&
            input !== null &&
            typeof (input as { value?: unknown }).value === 'string',
          'tool_input',
        );
        return { value: (input as { value: string }).value };
      },
    },
    outputSchema: {
      parse(input) {
        invariant(
          typeof input === 'object' &&
            input !== null &&
            typeof (input as { echoed?: unknown }).echoed === 'string',
          'tool_output',
        );
        return { echoed: (input as { echoed: string }).echoed };
      },
    },
    async execute(input) {
      calls += 1;
      return { echoed: input.value };
    },
  };
  const provider = new FakeModelProvider(
    mode === 'complete'
      ? [
          {
            response: {
              text: '',
              toolCalls: [
                {
                  id: 'smoke-call',
                  name: 'test.echo',
                  argumentsJson: '{"value":"synthetic"}',
                },
              ],
              usage: null,
              finishReason: 'tool_calls',
            },
          },
          {
            response: {
              text: 'done',
              toolCalls: [],
              usage: null,
              finishReason: 'stop',
            },
          },
        ]
      : [
          {
            events: [
              { type: 'tool_call_start', id: 'smoke-call', name: 'test.echo' },
              { type: 'tool_call_delta', id: 'smoke-call', delta: '{"value":' },
              {
                type: 'tool_call_delta',
                id: 'smoke-call',
                delta: '"synthetic"}',
              },
              { type: 'tool_call_end', id: 'smoke-call' },
              { type: 'done', finishReason: 'tool_calls' },
            ],
          },
          {
            events: [
              { type: 'text_delta', delta: 'done' },
              { type: 'done', finishReason: 'stop' },
            ],
          },
        ],
  );
  const result = await new AgentRuntime({
    provider,
    tools: new AgentToolRegistry([tool]),
    modelMode: mode,
    maxTurns: 3,
    maxToolCalls: 2,
    runTimeoutMs: 2000,
  }).run({
    runId: 'hermes-' + mode,
    trigger: 'user_input',
    userMessage: 'Synthetic finite smoke',
  });
  invariant(
    result.state.status === 'completed' &&
      result.state.turnCount === 2 &&
      result.state.toolCallCount === 1 &&
      calls === 1 &&
      result.text === 'done',
    'agent_finite_run',
  );
  same(
    result.state.receipts['smoke-call']?.output,
    { echoed: 'synthetic' },
    'agent_receipt',
  );
  return {
    mode,
    status: result.state.status,
    turns: result.state.turnCount,
    toolCalls: calls,
    receiptVerified: true,
  };
}

let started = false;
async function nativePreferenceSmoke() {
  const native = await openDatabaseAsync(
    'opt_native_diagnostic_' + Date.now() + '.sqlite',
  );
  const database = createExpoSqliteDatabase(native);
  let stage = 'migration';
  let sqlStage = 'none';
  const trace: SqliteDatabase = {
    ...database,
    transaction: (work) =>
      database.transaction((transaction) =>
        work({
          async run(sql, parameters) {
            sqlStage = 'run';
            return transaction.run(sql, parameters);
          },
          async get(sql, parameters) {
            sqlStage = 'get';
            return transaction.get(sql, parameters);
          },
          async all(sql, parameters) {
            sqlStage = 'all';
            return transaction.all(sql, parameters);
          },
        }),
      ),
  };
  try {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(trace, {
      now: () => '2026-10-03T01:00:00.000Z',
    });
    const service = new PreferenceService({
      unitOfWork,
      clock: { now: () => parseInstant('2026-10-03T01:00:00.000Z') },
      idGenerator: { generate: () => 'diagnostic-preference' },
    });
    stage = 'preference-update';
    const first = await service.update(
      { key: 'scheduling.timeZone.v1', value: { timeZone: 'Asia/Shanghai' } },
      { operationId: 'diagnostic-operation', authority: { kind: 'user' } },
    );
    stage = 'preference-read';
    const saved = await service.get('scheduling.timeZone.v1');
    same(saved?.valueJson, { timeZone: 'Asia/Shanghai' }, 'native_preference');
    console.info(
      '[OPT-NATIVE-PREFERENCE] ' +
        JSON.stringify({
          status: 'passed',
          operationId: first.operationId,
          stage,
          sqlStage,
        }),
    );
  } catch (error) {
    const safe = error as {
      name?: string;
      code?: string;
      causeCategory?: string;
    };
    console.info(
      '[OPT-NATIVE-PREFERENCE] ' +
        JSON.stringify({
          status: 'failed',
          stage,
          sqlStage,
          name: safe.name,
          code: safe.code,
          causeCategory: safe.causeCategory,
        }),
    );
  } finally {
    await native.closeAsync();
  }
}
function Smoke() {
  const [status, setStatus] = useState('Starting isolated Hermes smoke');
  useEffect(() => {
    if (started) return;
    started = true;
    void (async () => {
      const hermes = (
        globalThis as typeof globalThis & {
          HermesInternal?: {
            getRuntimeProperties?: () => Record<string, unknown>;
          };
        }
      ).HermesInternal;
      invariant(hermes, 'not_hermes');
      console.info(
        '[OPT-HERMES-RUNTIME] ' +
          JSON.stringify({
            engine: 'Hermes',
            properties: hermes.getRuntimeProperties?.() ?? {},
          }),
      );
      for (const mode of ['complete', 'stream'] as const)
        console.info(
          '[OPT-HERMES-AGENT] ' + JSON.stringify(await agentSmoke(mode)),
        );
      await nativePreferenceSmoke();
      for (const scenario of benchmarkScenarios()) {
        setStatus('Measuring ' + scenario.id);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const preview = measure(scenario.input, previewSchedule);
        const replan = measure(
          replanInput(scenario.input, preview.result),
          replanSchedule,
        );
        const { result: _previewResult, ...previewSummary } = preview;
        const { result: _replanResult, ...replanSummary } = replan;
        console.info(
          '[OPT-HERMES-CASE] ' +
            JSON.stringify({
              id: scenario.id,
              seed: scenario.seed,
              taskCount: scenario.taskCount,
              horizonDays: scenario.horizonDays,
              busyDensity: scenario.busyDensity,
              policyVersion: scenario.input.policy.policyVersion,
              preview: previewSummary,
              replan: replanSummary,
              invariantsPassed: true,
            }),
        );
      }
      console.info(
        '[OPT-HERMES-DONE] ' +
          JSON.stringify({
            status: 'passed',
            cases: benchmarkScenarios().length,
            agentModes: 2,
          }),
      );
      setStatus(
        'Passed: Hermes, complete/stream Agent, 13 scheduler scenarios',
      );
    })().catch(() => {
      console.info('[OPT-HERMES-FAIL] {"status":"failed"}');
      setStatus('Isolated smoke failed. Inspect the synthetic local report.');
    });
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 32 }}>
      <Text accessibilityRole="header">Isolated test host</Text>
      <Text testID="hermes-smoke-status">{status}</Text>
    </ScrollView>
  );
}
registerRootComponent(Smoke);
