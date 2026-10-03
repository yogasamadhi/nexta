import {
  closeExecutionInterval,
  completeTask,
  createCompletionRecord,
  createExecutionInterval,
  createExecutionSession,
  createTask,
  createTaskActivityEvent,
  createTimeBlock,
  finishExecutionSession,
  freezeTaskBaselineEstimate,
  parseCompletionRecordId,
  parseExecutionIntervalId,
  parseExecutionSessionId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseTaskActivityEventId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  type CompletionRecord,
  type ExecutionInterval,
  type ExecutionSession,
  type Task,
  type TimeBlock,
} from '@workspace/domain';
import {
  buildUserModelFeatures,
  USER_MODEL_FEATURE_KEYS,
  type UserModelBuildPolicy,
} from '@workspace/user-model';
import { describe, expect, it } from 'vitest';

const window = {
  start: parseInstant('2026-09-01T00:00:00.000Z'),
  end: parseInstant('2026-10-01T00:00:00.000Z'),
};

const policy: UserModelBuildPolicy = {
  algorithmVersion: 'case-model-01-v1',
  estimateBiasStatistic: 'mean',
  confidenceFullSampleCounts: {
    estimateBias: 2,
    hourlyCompletionRate: 4,
    sessionLength: 4,
    postponeSkipFrequency: 4,
    splitBlockCompletionRate: 4,
  },
};

function completedTask(
  id: string,
  input: Readonly<{
    categoryKey?: string | null;
    baselineMinutes?: number | null;
    splittable?: boolean;
  }> = {},
): Task {
  const created = createTask({
    id: parseTaskId(id),
    title: id,
    priority: 'normal',
    estimatedDurationMinutes: input.baselineMinutes ?? 60,
    categoryKey: input.categoryKey ?? 'document',
    splittable: input.splittable ?? false,
    schedulingPolicy: 'flexible',
    source: 'manual',
    createdAt: parseInstant('2026-09-01T08:00:00.000Z'),
  });
  return completeTask(
    freezeTaskBaselineEstimate(
      created,
      parseInstant('2026-09-01T08:01:00.000Z'),
    ),
    {
      completedAt: parseInstant('2026-09-10T08:00:00.000Z'),
      actualDurationMinutes: 90,
    },
  );
}

function completion(
  task: Task,
  id: string,
  coverage: CompletionRecord['durationCoverage'],
  seconds: number | null,
): CompletionRecord {
  return createCompletionRecord({
    id: parseCompletionRecordId(id),
    taskId: task.id,
    operationId: parseOperationId(`operation-${id}`),
    completedAt: task.completedAt!,
    taskTitleSnapshot: task.title,
    actualDurationSeconds: seconds,
    durationCoverage: coverage,
    achievementDisposition: 'skip',
    source: 'user',
  });
}

function block(
  id: string,
  taskId: string,
  status: TimeBlock['status'],
  hour: number,
  explicitUserSkip = false,
) {
  return {
    block: createTimeBlock({
      id: parseTimeBlockId(id),
      taskId: parseTaskId(taskId),
      type: 'task',
      startAt: parseInstant(
        `2026-09-12T${String(hour).padStart(2, '0')}:00:00.000Z`,
      ),
      endAt: parseInstant(
        `2026-09-12T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
      ),
      status,
      source: 'scheduler',
      locked: false,
      planRevision: 1,
      createdAt: parseInstant('2026-09-11T08:00:00.000Z'),
      updatedAt: parseInstant('2026-09-12T12:00:00.000Z'),
    }),
    plannedLocalHour: hour,
    explicitUserSkip,
  } as const;
}

function sessionFact(
  id: string,
  minutes: number,
  quality: ExecutionInterval['timingQuality'] = 'trusted',
): Readonly<{
  session: ExecutionSession;
  intervals: readonly ExecutionInterval[];
}> {
  const startedAt = parseInstant('2026-09-15T08:00:00.000Z');
  const endedAt = parseInstant(
    new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
  );
  const session = finishExecutionSession(
    createExecutionSession({
      id: parseExecutionSessionId(id),
      taskId: parseTaskId('task-document'),
      startedAt,
    }),
    endedAt,
    'finish_session',
  );
  const interval = {
    ...closeExecutionInterval(
      createExecutionInterval({
        id: parseExecutionIntervalId(`interval-${id}`),
        sessionId: session.id,
        kind: 'work',
        startAt: startedAt,
      }),
      endedAt,
    ),
    timingQuality: quality,
  };
  return { session, intervals: [interval] };
}

describe('CASE-MODEL-01 User Model fact reconstruction', () => {
  it('uses only complete, decidable facts and reports sample confidence', () => {
    const document = completedTask('task-document');
    const partial = completedTask('task-partial');
    const split = completedTask('task-split', { splittable: true });
    const explicitSkip = block(
      'block-user-skip',
      document.id,
      'skipped',
      9,
      true,
    );
    const facts = {
      window,
      tasks: [document, partial, split],
      completionRecords: [
        completion(document, 'completion-document', 'complete', 90 * 60),
        completion(partial, 'completion-partial', 'partial', 30 * 60),
      ],
      timeBlocks: [
        block('block-complete', document.id, 'completed', 9),
        explicitSkip,
        block('block-system-skip', document.id, 'skipped', 9, false),
        block('block-split-complete', split.id, 'completed', 10),
        block('block-split-skip', split.id, 'skipped', 10, true),
      ],
      sessions: [
        sessionFact('session-40', 40),
        sessionFact('session-20', 20),
        sessionFact('session-review', 10, 'needs_review'),
      ],
      activityEvents: [
        createTaskActivityEvent({
          id: parseTaskActivityEventId('event-user-skip'),
          taskId: document.id,
          timeBlockId: explicitSkip.block.id,
          eventType: 'skip',
          actor: 'user',
          occurredAt: explicitSkip.block.updatedAt,
          localDate: parseLocalDate('2026-09-12'),
          timeZone: parseTimeZoneId('UTC'),
          operationId: parseOperationId('operation-user-skip'),
        }),
        createTaskActivityEvent({
          id: parseTaskActivityEventId('event-system-replan'),
          taskId: document.id,
          eventType: 'system_replan',
          actor: 'system',
          occurredAt: parseInstant('2026-09-12T13:00:00.000Z'),
          localDate: parseLocalDate('2026-09-12'),
          timeZone: parseTimeZoneId('UTC'),
          operationId: parseOperationId('operation-system-replan'),
        }),
      ],
    } as const;

    const result = buildUserModelFeatures(facts, policy);
    const byIdentity = new Map(
      result.features.map((feature) => [
        `${feature.featureKey}:${feature.scopeKey ?? ''}`,
        feature,
      ]),
    );

    expect(byIdentity.get('estimate_bias:document')).toMatchObject({
      numericValue: 0.5,
      sampleCount: 1,
      confidence: 0.5,
    });
    expect(byIdentity.get('completion_rate_hour:hour_09')).toMatchObject({
      numericValue: 0.5,
      sampleCount: 2,
      confidence: 0.5,
    });
    expect(byIdentity.get('completion_rate_hour:hour_10')).toMatchObject({
      numericValue: 0.5,
      sampleCount: 2,
      confidence: 0.5,
    });
    expect(byIdentity.get('mean_session_minutes:')).toMatchObject({
      numericValue: 30,
      sampleCount: 2,
      confidence: 0.5,
    });
    expect(byIdentity.get('median_session_minutes:')?.numericValue).toBe(30);
    expect(byIdentity.get('postpone_skip_frequency:')).toMatchObject({
      numericValue: 0.25,
      sampleCount: 4,
    });
    expect(byIdentity.get('split_block_completion_rate:')).toMatchObject({
      numericValue: 0.5,
      sampleCount: 2,
    });
    expect(result.exclusions.estimateBias).toBe(1);
    expect(result.exclusions.sessionLength).toBe(1);
    expect(result.features.map((feature) => feature.featureKey)).toContain(
      USER_MODEL_FEATURE_KEYS.estimateBias,
    );
    expect(
      buildUserModelFeatures(
        {
          ...facts,
          tasks: [...facts.tasks].reverse(),
          completionRecords: [...facts.completionRecords].reverse(),
          timeBlocks: [...facts.timeBlocks].reverse(),
          sessions: [...facts.sessions].reverse(),
          activityEvents: [...facts.activityEvents].reverse(),
        },
        policy,
      ).features,
    ).toEqual(result.features);
  });

  it('does not produce estimate or session claims from partial/unknown facts', () => {
    const task = completedTask('task-unknown');
    const result = buildUserModelFeatures(
      {
        window,
        tasks: [task],
        completionRecords: [
          completion(task, 'completion-unknown', 'unknown', null),
        ],
        timeBlocks: [],
        sessions: [],
        activityEvents: [],
      },
      policy,
    );

    expect(result.features).toEqual([]);
    expect(result.exclusions.estimateBias).toBe(1);
  });
});
