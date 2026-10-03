import { DatabaseSync } from 'node:sqlite';

import {
  InMemorySchedulePreviewStore,
  InMemoryTimeBlockAdjustmentPreviewStore,
  ScheduleService,
  TaskService,
  TimeBlockAdjustmentService,
  type ApplicationUnitOfWork,
  type Clock,
  type IdGenerator,
  type LocalTime,
  type LocalTimeProvider,
  type PreviewExpirationContext,
  type PreviewExpirationPolicy,
  type ScheduleSnapshotRequest,
  type SchedulingSnapshot,
  type SchedulingSnapshotPort,
  type WriteContext,
} from '@workspace/application';
import {
  createSqliteApplicationUnitOfWork,
  initializeSqliteApplicationUnitOfWork,
  type SqliteDatabase,
  type SqliteExecutor,
} from '@workspace/database';
import {
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  type Instant,
  type TaskId,
} from '@workspace/domain';
import {
  SCHEDULER_VERSION,
  type SchedulingPolicy,
} from '@workspace/scheduler-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const MIGRATION_AT = parseInstant('2026-09-12T00:00:00.000Z');
const TASK_CREATED_AT = parseInstant('2026-09-12T08:00:00.000Z');
const PREVIEWED_AT = parseInstant('2026-09-12T09:00:00.000Z');
const TASK_CHANGED_AT = parseInstant('2026-09-12T09:02:00.000Z');
const COMMITTED_AT = parseInstant('2026-09-12T09:05:00.000Z');
const ADJUST_PREVIEWED_AT = parseInstant('2026-09-12T09:10:00.000Z');
const ADJUST_COMMITTED_AT = parseInstant('2026-09-12T09:11:00.000Z');
const UNLOCKED_AT = parseInstant('2026-09-12T09:12:00.000Z');
const EXPIRES_AT = parseInstant('2026-09-12T09:30:00.000Z');
const HORIZON_START = parseInstant('2026-09-12T09:00:00.000Z');
const WORK_START = parseInstant('2026-09-12T10:00:00.000Z');
const HORIZON_END = parseInstant('2026-09-12T18:00:00.000Z');
const TIME_ZONE = parseTimeZoneId('Asia/Shanghai');

const POLICY: SchedulingPolicy = {
  policyVersion: 'policy-integration-v1',
  schedulerVersion: SCHEDULER_VERSION,
  gridAnchor: parseInstant('2026-01-01T00:00:00.000Z'),
  granularityMinutes: 15,
  defaultMinBlockMinutes: 30,
  defaultMaxBlockMinutes: 60,
  priorityRanks: { low: 1, normal: 2, high: 3 },
  energyMatchScores: [],
  defaultEnergyMatchScore: 0,
  scoreWeights: {
    planStability: 10,
    fragmentation: 1,
    preferredHours: 1,
    completionRate: 1,
    energyMatch: 1,
    recoveryPenalty: 1,
  },
};

class SequenceClock implements Clock {
  readonly #values: readonly Instant[];
  #index = 0;

  constructor(...values: readonly Instant[]) {
    this.#values = values;
  }

  now(): Instant {
    const value = this.#values[this.#index] ?? this.#values.at(-1);
    if (value === undefined) throw new Error('Missing test clock value.');
    this.#index += 1;
    return value;
  }
}

class QueueIdGenerator implements IdGenerator {
  readonly #values: readonly string[];
  #index = 0;

  constructor(...values: readonly string[]) {
    this.#values = values;
  }

  generate(): string {
    const value = this.#values[this.#index];
    if (value === undefined) throw new Error('Missing test identifier.');
    this.#index += 1;
    return value;
  }
}

class FixedLocalTimeProvider implements LocalTimeProvider {
  resolve(_instant: Instant): LocalTime {
    return {
      localDate: parseLocalDate('2026-09-12'),
      timeZone: TIME_ZONE,
    };
  }
}

class FixedExpirationPolicy implements PreviewExpirationPolicy {
  constructor(private readonly expiration: Instant) {}

  expirationFor(_context: PreviewExpirationContext): Instant {
    return this.expiration;
  }
}

/** Reads every mutable scheduling fact inside one real SQLite transaction. */
class DatabaseSchedulingSnapshotPort implements SchedulingSnapshotPort {
  captureCount = 0;

  constructor(
    private readonly unitOfWork: ApplicationUnitOfWork,
    private readonly taskIds: readonly TaskId[],
  ) {}

  async capture(request: ScheduleSnapshotRequest): Promise<SchedulingSnapshot> {
    this.captureCount += 1;
    return this.unitOfWork.transaction(async (transaction) => {
      const scheduleState = await transaction.scheduleState.get();
      if (scheduleState === null) throw new Error('Missing ScheduleState.');
      const tasks = await Promise.all(
        this.taskIds.map((taskId) => transaction.tasks.findById(taskId)),
      );
      if (tasks.some((task) => task === null)) {
        throw new Error('Missing Task for scheduling snapshot.');
      }

      return {
        scheduleState,
        horizon: request.requestedTimeRange ?? {
          start: HORIZON_START,
          end: HORIZON_END,
        },
        timeZone: TIME_ZONE,
        tasks: tasks.filter((task) => task !== null),
        timeBlocks: await transaction.timeBlocks.listAll(),
        busy: {
          capturedAt: request.now,
          completeness: 'complete',
          scopes: [],
          events: [],
        },
        workingWindows: [
          {
            id: 'integration-work-window',
            start: WORK_START,
            end: HORIZON_END,
            energyLevel: 'high',
          },
        ],
        preferredWindows: [],
        userModel: {
          completionRateWindows: [],
          recoveryPenaltyWindows: [],
        },
        policy: POLICY,
      };
    });
  }
}

function userContext(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

async function createSchedulableTask(
  unitOfWork: ApplicationUnitOfWork,
  suffix: string,
): Promise<TaskId> {
  const service = new TaskService({
    unitOfWork,
    clock: new SequenceClock(TASK_CREATED_AT),
    localTimeProvider: new FixedLocalTimeProvider(),
    idGenerator: new QueueIdGenerator(
      `task-${suffix}`,
      `activity-create-${suffix}`,
    ),
  });
  const created = await service.create(
    {
      title: `Schedule task ${suffix}`,
      priority: 'normal',
      estimatedDurationMinutes: 60,
      splittable: false,
      schedulingPolicy: 'flexible',
    },
    userContext(`operation-task-create-${suffix}`),
  );
  return parseTaskId(created.task.id);
}

type ScheduleHarness = Readonly<{
  previews: InMemorySchedulePreviewStore;
  service: ScheduleService;
  snapshots: DatabaseSchedulingSnapshotPort;
}>;

function scheduleHarness(
  unitOfWork: ApplicationUnitOfWork,
  taskId: TaskId,
  suffix: string,
  clock: Clock = new SequenceClock(PREVIEWED_AT, COMMITTED_AT),
): ScheduleHarness {
  const previews = new InMemorySchedulePreviewStore();
  const snapshots = new DatabaseSchedulingSnapshotPort(unitOfWork, [taskId]);
  return {
    previews,
    snapshots,
    service: new ScheduleService({
      unitOfWork,
      snapshots,
      previews,
      expirationPolicy: new FixedExpirationPolicy(EXPIRES_AT),
      clock,
      ids: {
        preview: new QueueIdGenerator(`preview-${suffix}`),
        schedulePlan: new QueueIdGenerator(`plan-${suffix}`),
        timeBlock: new QueueIdGenerator(`block-${suffix}`),
        integrationJob: new QueueIdGenerator(
          `job-calendar-${suffix}`,
          `job-notification-${suffix}`,
        ),
      },
    }),
  };
}

interface DatabaseFacts {
  readonly block_count: number;
  readonly job_count: number;
  readonly operation_count: number;
  readonly plan_count: number;
  readonly plan_revision: number;
  readonly state_version: number;
}

async function readFacts(database: SqliteExecutor): Promise<DatabaseFacts> {
  const row = await database.get<DatabaseFacts>(`
    SELECT
      (SELECT COUNT(*) FROM time_blocks) AS block_count,
      (SELECT COUNT(*) FROM schedule_plans) AS plan_count,
      (SELECT COUNT(*) FROM integration_jobs) AS job_count,
      (SELECT COUNT(*) FROM operation_records) AS operation_count,
      state_version,
      plan_revision
    FROM schedule_state
    WHERE id = 1
  `);
  if (row === undefined) throw new Error('Missing persisted schedule facts.');
  return row;
}

/** Fails only after Operation, Plan, Block, and the first Job were written. */
function failOnSecondIntegrationJob(database: SqliteDatabase): SqliteDatabase {
  let integrationJobInsertCount = 0;
  const failingExecutor = (executor: SqliteExecutor): SqliteExecutor => ({
    run: (sql, parameters) => {
      if (sql.includes('INSERT INTO integration_jobs')) {
        integrationJobInsertCount += 1;
        if (integrationJobInsertCount === 2) {
          throw new Error('Injected late IntegrationJob write failure.');
        }
      }
      return executor.run(sql, parameters);
    },
    get: (sql, parameters) => executor.get(sql, parameters),
    all: (sql, parameters) => executor.all(sql, parameters),
  });

  return {
    run: (sql, parameters) => database.run(sql, parameters),
    get: (sql, parameters) => database.get(sql, parameters),
    all: (sql, parameters) => database.all(sql, parameters),
    transaction: (work) =>
      database.transaction((transaction) => work(failingExecutor(transaction))),
  };
}

describe('CASE-COMMIT-01 ScheduleService over real SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;
  let unitOfWork: ApplicationUnitOfWork;

  beforeEach(async () => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
    unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => MIGRATION_AT,
    });
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('previews without writes, commits all facts, and exactly replays after response loss', async () => {
    const taskId = await createSchedulableTask(unitOfWork, 'success');
    const { previews, service, snapshots } = scheduleHarness(
      unitOfWork,
      taskId,
      'success',
    );
    const beforePreview = await readFacts(database);

    const preview = await service.preview({ reason: 'user_requested_plan' });

    expect(preview).toMatchObject({
      previewId: 'preview-success',
      basedOnStateVersion: 1,
      basedOnPlanRevision: 0,
      changedBlocks: [
        {
          kind: 'create',
          before: null,
          after: { taskId, type: 'task', status: 'planned' },
        },
      ],
    });
    expect(await readFacts(database)).toEqual(beforePreview);
    expect(snapshots.captureCount).toBe(1);

    const returnedChange = preview.changedBlocks[0];
    if (returnedChange === undefined) throw new Error('Missing plan change.');
    const trustedStart = returnedChange.after.startAt;
    expect(
      Reflect.set(returnedChange.after, 'startAt', '2030-01-01T00:00:00.000Z'),
    ).toBe(true);

    const commitInput = {
      previewId: preview.previewId,
      expectedStateVersion: preview.basedOnStateVersion,
    };
    const commitContext = userContext('operation-schedule-success');
    const committed = await service.commit(commitInput, commitContext);

    expect(committed).toEqual({
      operationId: 'operation-schedule-success',
      local: 'committed',
      planRevision: 1,
      stateVersion: 2,
      calendar: 'pending',
      notifications: 'pending',
    });
    expect(snapshots.captureCount).toBe(2);
    expect(await readFacts(database)).toEqual({
      block_count: 1,
      plan_count: 1,
      job_count: 2,
      operation_count: 2,
      state_version: 2,
      plan_revision: 1,
    });

    await unitOfWork.transaction(async (transaction) => {
      await expect(transaction.tasks.findById(taskId)).resolves.toMatchObject({
        status: 'planned',
        baselineEstimatedDurationMinutes: 60,
        updatedAt: COMMITTED_AT,
      });
      await expect(
        transaction.schedulePlans.findByRevision(1),
      ).resolves.toMatchObject({
        id: 'plan-success',
        planRevision: 1,
        basedOnStateVersion: 1,
        status: 'committed',
        createdAt: PREVIEWED_AT,
        committedAt: COMMITTED_AT,
      });
      const blocks = await transaction.timeBlocks.listAll();
      expect(blocks).toEqual([
        expect.objectContaining({
          id: 'block-success',
          taskId,
          startAt: trustedStart,
          source: 'scheduler',
          planRevision: 1,
        }),
      ]);
      await expect(
        transaction.integrationJobs.listByOperationId(
          parseOperationId(committed.operationId),
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          id: 'job-calendar-success',
          targetChannel: 'calendar',
          targetEntityId: 'plan-success',
          desiredRevision: 1,
          status: 'pending',
        }),
        expect.objectContaining({
          id: 'job-notification-success',
          targetChannel: 'notification',
          targetEntityId: 'plan-success',
          desiredRevision: 1,
          status: 'pending',
        }),
      ]);
    });

    // Simulate losing the first response and restarting the in-memory store.
    previews.clear();
    const factsBeforeReplay = await readFacts(database);
    const replayed = await service.commit(commitInput, commitContext);
    expect(replayed).toEqual(committed);
    expect(await readFacts(database)).toEqual(factsBeforeReplay);
    expect(snapshots.captureCount).toBe(2);
    await unitOfWork.transaction(async (transaction) => {
      await expect(transaction.tasks.findById(taskId)).resolves.toMatchObject({
        status: 'planned',
        baselineEstimatedDurationMinutes: 60,
        updatedAt: COMMITTED_AT,
      });
    });
  });

  it('rejects an old preview after a persisted Task scheduling change', async () => {
    const taskId = await createSchedulableTask(unitOfWork, 'conflict');
    const { service } = scheduleHarness(unitOfWork, taskId, 'conflict');
    const preview = await service.preview({ reason: 'before_task_edit' });
    const taskService = new TaskService({
      unitOfWork,
      clock: new SequenceClock(TASK_CHANGED_AT),
      localTimeProvider: new FixedLocalTimeProvider(),
      idGenerator: new QueueIdGenerator('activity-update-conflict'),
    });
    await taskService.update(
      { taskId, patch: { priority: 'high' } },
      userContext('operation-task-update-conflict'),
    );

    await expect(
      service.commit(
        {
          previewId: preview.previewId,
          expectedStateVersion: preview.basedOnStateVersion,
        },
        userContext('operation-schedule-conflict'),
      ),
    ).rejects.toMatchObject({
      code: 'plan_conflict',
      retryable: false,
      operationId: 'operation-schedule-conflict',
    });
    expect(await readFacts(database)).toEqual({
      block_count: 0,
      plan_count: 0,
      job_count: 0,
      operation_count: 2,
      state_version: 2,
      plan_revision: 0,
    });
  });

  it('rejects expired and process-cleared previews without commit writes', async () => {
    const taskId = await createSchedulableTask(unitOfWork, 'invalidated');
    const expired = scheduleHarness(
      unitOfWork,
      taskId,
      'expired',
      new SequenceClock(PREVIEWED_AT, EXPIRES_AT),
    );
    const expiredPreview = await expired.service.preview({
      reason: 'expires_before_confirmation',
    });

    await expect(
      expired.service.commit(
        {
          previewId: expiredPreview.previewId,
          expectedStateVersion: expiredPreview.basedOnStateVersion,
        },
        userContext('operation-schedule-expired'),
      ),
    ).rejects.toMatchObject({
      code: 'preview_expired',
      operationId: 'operation-schedule-expired',
    });

    const cleared = scheduleHarness(unitOfWork, taskId, 'cleared');
    const clearedPreview = await cleared.service.preview({
      reason: 'restart_before_confirmation',
    });
    cleared.previews.clear();
    await expect(
      cleared.service.commit(
        {
          previewId: clearedPreview.previewId,
          expectedStateVersion: clearedPreview.basedOnStateVersion,
        },
        userContext('operation-schedule-cleared'),
      ),
    ).rejects.toMatchObject({
      code: 'preview_not_found',
      operationId: 'operation-schedule-cleared',
    });
    expect(cleared.snapshots.captureCount).toBe(1);
    expect(await readFacts(database)).toEqual({
      block_count: 0,
      plan_count: 0,
      job_count: 0,
      operation_count: 1,
      state_version: 1,
      plan_revision: 0,
    });
  });

  it('rolls back every commit fact and both versions after a late SQLite failure', async () => {
    const taskId = await createSchedulableTask(unitOfWork, 'rollback');
    const failingUnitOfWork = createSqliteApplicationUnitOfWork(
      failOnSecondIntegrationJob(database),
    );
    const { previews, service } = scheduleHarness(
      failingUnitOfWork,
      taskId,
      'rollback',
    );
    const preview = await service.preview({ reason: 'late_failure' });

    await expect(
      service.commit(
        {
          previewId: preview.previewId,
          expectedStateVersion: preview.basedOnStateVersion,
        },
        userContext('operation-schedule-rollback'),
      ),
    ).rejects.toMatchObject({
      code: 'adapter_error',
      retryable: true,
      causeCategory: 'local_storage',
      operationId: 'operation-schedule-rollback',
    });
    expect(previews.get(preview.previewId)).not.toBeNull();
    expect(await readFacts(database)).toEqual({
      block_count: 0,
      plan_count: 0,
      job_count: 0,
      operation_count: 1,
      state_version: 1,
      plan_revision: 0,
    });
    await unitOfWork.transaction(async (transaction) => {
      await expect(transaction.tasks.findById(taskId)).resolves.toMatchObject({
        status: 'inbox',
        baselineEstimatedDurationMinutes: null,
        updatedAt: TASK_CREATED_AT,
      });
      await expect(
        transaction.operationRecords.findById(
          parseOperationId('operation-schedule-rollback'),
        ),
      ).resolves.toBeNull();
    });
  });

  it('persists a manual adjustment as a locked plan and an explicit unlock as another plan', async () => {
    const taskId = await createSchedulableTask(unitOfWork, 'adjustment');
    const scheduled = scheduleHarness(unitOfWork, taskId, 'adjustment');
    const schedulePreview = await scheduled.service.preview({
      reason: 'before_manual_adjustment',
    });
    await scheduled.service.commit(
      {
        previewId: schedulePreview.previewId,
        expectedStateVersion: schedulePreview.basedOnStateVersion,
      },
      userContext('operation-schedule-adjustment'),
    );

    const service = new TimeBlockAdjustmentService({
      unitOfWork,
      snapshots: new DatabaseSchedulingSnapshotPort(unitOfWork, [taskId]),
      previews: new InMemoryTimeBlockAdjustmentPreviewStore(),
      expirationPolicy: new FixedExpirationPolicy(EXPIRES_AT),
      clock: new SequenceClock(
        ADJUST_PREVIEWED_AT,
        ADJUST_COMMITTED_AT,
        UNLOCKED_AT,
      ),
      ids: {
        preview: new QueueIdGenerator('manual-adjustment-preview'),
        schedulePlan: new QueueIdGenerator(
          'manual-adjustment-plan',
          'manual-unlock-plan',
        ),
        integrationJob: new QueueIdGenerator(
          'manual-adjustment-calendar',
          'manual-adjustment-notification',
          'manual-unlock-calendar',
          'manual-unlock-notification',
        ),
      },
    });
    const preview = await service.preview({
      timeBlockId: 'block-adjustment',
      startAt: '2026-09-12T12:00:00.000Z',
      endAt: '2026-09-12T13:00:00.000Z',
    });
    expect(preview).toMatchObject({
      basedOnStateVersion: 2,
      basedOnPlanRevision: 1,
      after: { locked: true },
    });

    await expect(
      service.commit(
        {
          previewId: preview.previewId,
          expectedStateVersion: preview.basedOnStateVersion,
        },
        userContext('operation-manual-adjustment'),
      ),
    ).resolves.toMatchObject({ stateVersion: 3, planRevision: 2 });
    await expect(
      service.unlock(
        { timeBlockId: 'block-adjustment', expectedStateVersion: 3 },
        userContext('operation-manual-unlock'),
      ),
    ).resolves.toMatchObject({ stateVersion: 4, planRevision: 3 });

    expect(await readFacts(database)).toEqual({
      block_count: 1,
      plan_count: 3,
      job_count: 6,
      operation_count: 4,
      state_version: 4,
      plan_revision: 3,
    });
    await unitOfWork.transaction(async (transaction) => {
      await expect(
        transaction.timeBlocks.findById(parseTimeBlockId('block-adjustment')),
      ).resolves.toMatchObject({
        startAt: '2026-09-12T12:00:00.000Z',
        endAt: '2026-09-12T13:00:00.000Z',
        locked: false,
        planRevision: 3,
      });
      await expect(
        transaction.schedulePlans.findByRevision(2),
      ).resolves.toMatchObject({
        id: 'manual-adjustment-plan',
        reason: 'manual_time_block_adjustment',
      });
      await expect(
        transaction.schedulePlans.findByRevision(3),
      ).resolves.toMatchObject({
        id: 'manual-unlock-plan',
        reason: 'manual_time_block_unlock',
      });
    });
  });
});
