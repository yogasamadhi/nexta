import { UserModelService } from '@workspace/application';
import {
  completeTask,
  createCompletionRecord,
  createTask,
  createUserPreference,
  freezeTaskBaselineEstimate,
  parseCompletionRecordId,
  parseInstant,
  parseOperationId,
  parseTaskId,
  parseUserPreferenceId,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

import { MemoryUnitOfWork, QueueIdGenerator, createMemoryState } from './fakes';

const T0 = parseInstant('2026-09-01T00:00:00.000Z');
const T1 = parseInstant('2026-09-12T08:00:00.000Z');
const T2 = parseInstant('2026-10-01T00:00:00.000Z');

function policy() {
  return {
    algorithmVersion: 'application-user-model-v1',
    estimateBiasStatistic: 'mean' as const,
    confidenceFullSampleCounts: {
      estimateBias: 2,
      hourlyCompletionRate: 2,
      sessionLength: 2,
      postponeSkipFrequency: 2,
      splitBlockCompletionRate: 2,
    },
  };
}

describe('UserModelService', () => {
  it('rebuilds a versioned cache from one transaction and preserves identities', async () => {
    const state = createMemoryState();
    state.scheduleState = { stateVersion: 7, planRevision: 0 };
    const task = completeTask(
      freezeTaskBaselineEstimate(
        createTask({
          id: parseTaskId('task-document'),
          title: 'Document',
          priority: 'normal',
          estimatedDurationMinutes: 60,
          categoryKey: 'document',
          splittable: false,
          schedulingPolicy: 'flexible',
          source: 'manual',
          createdAt: T0,
        }),
        T0,
      ),
      { completedAt: T1, actualDurationMinutes: 90 },
    );
    state.tasks.set(task.id, task);
    state.completionRecords.set(
      task.id,
      createCompletionRecord({
        id: parseCompletionRecordId('completion-document'),
        taskId: task.id,
        operationId: parseOperationId('operation-document'),
        completedAt: T1,
        taskTitleSnapshot: task.title,
        actualDurationSeconds: 90 * 60,
        durationCoverage: 'complete',
        achievementDisposition: 'skip',
        source: 'user',
      }),
    );
    state.userPreferences.set(
      'preference-personalization',
      createUserPreference({
        id: parseUserPreferenceId('preference-personalization'),
        key: 'personalization.enabled.v1',
        valueJson: { enabled: true },
        updatedAt: T1,
      }),
    );
    const unitOfWork = new MemoryUnitOfWork(state);
    const service = new UserModelService({
      unitOfWork,
      clock: { now: () => T2 },
      featureIds: new QueueIdGenerator('feature-document', 'unused-id'),
      localHour: { hourAt: () => 9 },
    });

    const first = await service.rebuild({
      window: { start: T0, end: T2 },
      policy: policy(),
    });
    const second = await service.rebuild({
      window: { start: T0, end: T2 },
      policy: policy(),
    });

    expect(first).toMatchObject({
      sourceStateVersion: 7,
      personalizationEnabled: true,
      fresh: true,
      features: [
        {
          id: 'feature-document',
          featureKey: 'estimate_bias',
          scopeKey: 'document',
          numericValue: 0.5,
          sampleCount: 1,
          confidence: 0.5,
          sourceStateVersion: 7,
        },
      ],
    });
    expect(second.features[0]?.id).toBe('feature-document');
    await expect(
      service.snapshot('application-user-model-v1'),
    ).resolves.toMatchObject({
      personalizationEnabled: true,
      fresh: true,
      features: [{ id: 'feature-document' }],
    });

    unitOfWork.state.scheduleState = { stateVersion: 8, planRevision: 0 };
    await expect(
      service.snapshot('application-user-model-v1'),
    ).resolves.toMatchObject({
      sourceStateVersion: 8,
      fresh: false,
    });
  });

  it('defaults personalization to disabled and validates explicit policy input', async () => {
    const service = new UserModelService({
      unitOfWork: new MemoryUnitOfWork(),
      clock: { now: () => T1 },
      featureIds: new QueueIdGenerator(),
      localHour: { hourAt: () => 9 },
    });
    await expect(
      service.rebuild({ window: { start: T0, end: T2 }, policy: policy() }),
    ).resolves.toMatchObject({
      personalizationEnabled: false,
      features: [],
      fresh: true,
    });
    await expect(
      service.rebuild({
        window: { start: T2, end: T0 },
        policy: policy(),
      }),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });
});
