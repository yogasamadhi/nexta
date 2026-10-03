import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ExecutionService,
  InMemorySchedulePreviewStore,
  ReflectionService,
  RelaxService,
  ScheduleService,
  TaskService,
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
  databaseMigrations,
  initializeSqliteApplicationUnitOfWork,
  type SqliteDatabase,
  type SqliteExecutor,
} from '@workspace/database';
import {
  parseInstant,
  parseLocalDate,
  parseTaskId,
  parseTimeZoneId,
  type Instant,
  type TaskId,
} from '@workspace/domain';
import {
  SCHEDULER_VERSION,
  type SchedulingPolicy,
} from '@workspace/scheduler-core';
import { describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const MIGRATION_AT = parseInstant('2026-09-12T00:00:00.000Z');
const TASK_CREATED_AT = parseInstant('2026-09-12T08:00:00.000Z');
const PREVIEWED_AT = parseInstant('2026-09-12T09:00:00.000Z');
const COMMITTED_AT = parseInstant('2026-09-12T09:05:00.000Z');
const EXPIRES_AT = parseInstant('2026-09-12T09:30:00.000Z');
const HORIZON_START = parseInstant('2026-09-12T09:00:00.000Z');
const WORK_START = parseInstant('2026-09-12T10:00:00.000Z');
const PAUSED_AT = parseInstant('2026-09-12T10:20:00.000Z');
const RESUMED_AT = parseInstant('2026-09-12T10:25:00.000Z');
const COMPLETED_AT = parseInstant('2026-09-12T10:45:00.000Z');
const RELAX_STARTED_AT = parseInstant('2026-09-12T11:00:00.000Z');
const RELAX_ENDED_AT = parseInstant('2026-09-12T11:05:00.000Z');
const REFLECTED_AT = parseInstant('2026-09-12T11:10:00.000Z');
const DAY_END = parseInstant('2026-09-12T16:00:00.000Z');
const HORIZON_END = parseInstant('2026-09-12T18:00:00.000Z');
const LOCAL_DATE = parseLocalDate('2026-09-12');
const TIME_ZONE = parseTimeZoneId('Asia/Shanghai');

const POLICY: SchedulingPolicy = {
  policyVersion: 'phase9-reliability-v1',
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

class FixedClock implements Clock {
  constructor(private readonly instant: Instant) {}

  now(): Instant {
    return this.instant;
  }
}

class QueueIds implements IdGenerator {
  #index = 0;

  constructor(private readonly values: readonly string[]) {}

  generate(): string {
    const value = this.values[this.#index];
    if (value === undefined)
      throw new Error('Test identifier queue exhausted.');
    this.#index += 1;
    return value;
  }
}

class FixedLocalTime implements LocalTimeProvider {
  resolve(_instant: Instant): LocalTime {
    return { localDate: LOCAL_DATE, timeZone: TIME_ZONE };
  }
}

class FixedExpiration implements PreviewExpirationPolicy {
  expirationFor(_context: PreviewExpirationContext): Instant {
    return EXPIRES_AT;
  }
}

class SqliteSnapshot implements SchedulingSnapshotPort {
  constructor(
    private readonly unitOfWork: ApplicationUnitOfWork,
    private readonly taskId: TaskId,
  ) {}

  capture(request: ScheduleSnapshotRequest): Promise<SchedulingSnapshot> {
    return this.unitOfWork.transaction(async (transaction) => {
      const scheduleState = await transaction.scheduleState.get();
      const task = await transaction.tasks.findById(this.taskId);
      if (scheduleState === null || task === null) {
        throw new Error('Scheduling snapshot facts are missing.');
      }
      return {
        scheduleState,
        horizon: request.requestedTimeRange ?? {
          start: HORIZON_START,
          end: HORIZON_END,
        },
        timeZone: TIME_ZONE,
        tasks: [task],
        timeBlocks: await transaction.timeBlocks.listAll(),
        busy: {
          capturedAt: request.now,
          completeness: 'complete',
          scopes: [],
          events: [],
        },
        workingWindows: [
          {
            id: 'phase9-working-window',
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

function context(operationId: string): WriteContext {
  return { operationId, authority: { kind: 'user' } };
}

function scheduleService(
  unitOfWork: ApplicationUnitOfWork,
  taskId: TaskId,
  clock: Clock,
): ScheduleService {
  return new ScheduleService({
    unitOfWork,
    snapshots: new SqliteSnapshot(unitOfWork, taskId),
    previews: new InMemorySchedulePreviewStore(),
    expirationPolicy: new FixedExpiration(),
    clock,
    ids: {
      preview: new QueueIds(['phase9-preview']),
      schedulePlan: new QueueIds(['phase9-plan']),
      timeBlock: new QueueIds(['phase9-block']),
      integrationJob: new QueueIds([
        'phase9-calendar-job',
        'phase9-notification-job',
      ]),
    },
  });
}

type ExecutionIds = Readonly<{
  session?: readonly string[];
  interval?: readonly string[];
  activity?: readonly string[];
  completion?: readonly string[];
  achievement?: readonly string[];
  plan?: readonly string[];
  jobs?: readonly string[];
}>;

function executionService(
  unitOfWork: ApplicationUnitOfWork,
  instant: Instant,
  values: ExecutionIds,
): ExecutionService {
  const fallback = ['unused'];
  return new ExecutionService({
    unitOfWork,
    clock: new FixedClock(instant),
    localTimeProvider: new FixedLocalTime(),
    ids: {
      session: new QueueIds(values.session ?? fallback),
      interval: new QueueIds(values.interval ?? fallback),
      activity: new QueueIds(values.activity ?? fallback),
      completionRecord: new QueueIds(values.completion ?? fallback),
      achievement: new QueueIds(values.achievement ?? fallback),
      schedulePlan: new QueueIds(values.plan ?? fallback),
      integrationJob: new QueueIds(values.jobs ?? fallback),
    },
  });
}

interface ReliabilityFacts {
  readonly achievement_count: number;
  readonly completion_count: number;
  readonly integration_job_count: number;
  readonly migration_count: number;
  readonly operation_count: number;
  readonly reflection_count: number;
  readonly relax_count: number;
  readonly schedule_plan_count: number;
  readonly session_count: number;
  readonly state_version: number;
  readonly plan_revision: number;
}

async function readFacts(database: SqliteExecutor): Promise<ReliabilityFacts> {
  const facts = await database.get<ReliabilityFacts>(`
    SELECT
      (SELECT COUNT(*) FROM achievements) AS achievement_count,
      (SELECT COUNT(*) FROM completion_records) AS completion_count,
      (SELECT COUNT(*) FROM integration_jobs) AS integration_job_count,
      (SELECT COUNT(*) FROM __nexta_migrations) AS migration_count,
      (SELECT COUNT(*) FROM operation_records) AS operation_count,
      (SELECT COUNT(*) FROM daily_reflections) AS reflection_count,
      (SELECT COUNT(*) FROM relax_sessions) AS relax_count,
      (SELECT COUNT(*) FROM schedule_plans) AS schedule_plan_count,
      (SELECT COUNT(*) FROM execution_sessions) AS session_count,
      state_version,
      plan_revision
    FROM schedule_state
    WHERE id = 1
  `);
  if (facts === undefined) throw new Error('Reliability facts are missing.');
  return facts;
}

describe('Phase 9 combined offline and process-restart reliability', () => {
  it('keeps local facts and exact replay receipts across repeated process loss while integrations remain pending', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexta-phase9-'));
    const path = join(directory, 'local-first.sqlite');
    let nativeDatabase = new DatabaseSync(path);
    let database: SqliteDatabase = createNodeSqliteDatabase(nativeDatabase);
    let unitOfWork: ApplicationUnitOfWork =
      await initializeSqliteApplicationUnitOfWork(database, {
        now: () => MIGRATION_AT,
      });

    const reopen = async () => {
      nativeDatabase.close();
      nativeDatabase = new DatabaseSync(path);
      database = createNodeSqliteDatabase(nativeDatabase);
      unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
        now: () => MIGRATION_AT,
      });
    };

    try {
      const tasks = new TaskService({
        unitOfWork,
        clock: new FixedClock(TASK_CREATED_AT),
        localTimeProvider: new FixedLocalTime(),
        idGenerator: new QueueIds(['phase9-task', 'phase9-task-created']),
      });
      const created = await tasks.create(
        {
          title: 'Survive offline restart',
          estimatedDurationMinutes: 60,
          priority: 'high',
        },
        context('phase9-task-create'),
      );
      const taskId = parseTaskId(created.task.id);
      const scheduling = scheduleService(
        unitOfWork,
        taskId,
        new FixedClock(PREVIEWED_AT),
      );
      const preview = await scheduling.preview({
        reason: 'phase9_offline_commit',
      });
      const committed = await scheduling.commit(
        {
          previewId: preview.previewId,
          expectedStateVersion: preview.basedOnStateVersion,
        },
        context('phase9-schedule-commit'),
      );
      expect(committed).toMatchObject({
        local: 'committed',
        planRevision: 1,
        calendar: 'pending',
        notifications: 'pending',
      });
      const timeBlockId = await unitOfWork.transaction(
        async (transaction) =>
          (await transaction.timeBlocks.listAll()).find(
            (block) => block.taskId === taskId,
          )?.id,
      );
      if (timeBlockId === undefined) {
        throw new Error('Missing persisted TimeBlock identifier.');
      }

      // Reopen the physical file after a lost response. Migrations are
      // re-entrant and the durable OperationRecord replays without a Preview.
      await reopen();
      const replayedCommit = await scheduleService(
        unitOfWork,
        taskId,
        new FixedClock(COMMITTED_AT),
      ).commit(
        {
          previewId: preview.previewId,
          expectedStateVersion: preview.basedOnStateVersion,
        },
        context('phase9-schedule-commit'),
      );
      expect(replayedCommit).toEqual(committed);

      const started = await executionService(unitOfWork, WORK_START, {
        session: ['phase9-session'],
        interval: ['phase9-work-1'],
        activity: ['phase9-started'],
        plan: ['phase9-start-plan'],
        jobs: ['phase9-start-calendar-job', 'phase9-start-notification-job'],
      }).start({ taskId, timeBlockId }, context('phase9-execution-start'));

      // A process dies with an open work interval. Replaying the start receipt
      // after reopen must neither create a second session nor reset its clock.
      await reopen();
      const replayedStart = await executionService(unitOfWork, PAUSED_AT, {
        session: ['unused-replay-session'],
      }).start({ taskId, timeBlockId }, context('phase9-execution-start'));
      expect(replayedStart).toEqual(started);
      await executionService(unitOfWork, PAUSED_AT, {
        interval: ['phase9-pause-interval'],
        activity: ['phase9-paused'],
      }).pause(
        { sessionId: started.session.id },
        context('phase9-execution-pause'),
      );

      await reopen();
      await expect(
        executionService(unitOfWork, RESUMED_AT, {}).getActive(),
      ).resolves.toMatchObject({ session: { status: 'paused' } });
      await executionService(unitOfWork, RESUMED_AT, {
        interval: ['phase9-work-2'],
        activity: ['phase9-resumed'],
      }).resume(
        { sessionId: started.session.id },
        context('phase9-execution-resume'),
      );
      const finished = await executionService(unitOfWork, COMPLETED_AT, {
        activity: ['phase9-completed'],
        completion: ['phase9-completion'],
        achievement: ['phase9-achievement'],
        plan: ['phase9-finish-plan'],
        jobs: ['phase9-finish-calendar-job', 'phase9-finish-notification-job'],
      }).finish(
        {
          sessionId: started.session.id,
          outcome: 'complete_task',
          recordAchievement: true,
        },
        context('phase9-execution-finish'),
      );
      expect(finished).toMatchObject({
        task: { status: 'completed', actualDurationMinutes: 40 },
        recordedWorkSeconds: 2_400,
        completionRecord: { id: 'phase9-completion' },
        achievement: { id: 'phase9-achievement' },
        calendar: 'pending',
        notifications: 'pending',
      });

      const reflectionInput = {
        localDate: LOCAL_DATE,
        timeZone: TIME_ZONE,
        range: { start: MIGRATION_AT, end: DAY_END },
        userNote: '离线重启后记录仍然完整。',
      };
      const reflection = await new ReflectionService({
        unitOfWork,
        clock: new FixedClock(REFLECTED_AT),
        idGenerator: new QueueIds(['phase9-reflection']),
      }).refresh(reflectionInput, context('phase9-reflection-refresh'));
      expect(reflection).toMatchObject({
        sourceCompletionRecordCount: 1,
        reflection: {
          wins: [{ completionRecordId: 'phase9-completion' }],
          generatedBy: 'local_facts',
        },
      });
      const relax = await new RelaxService({
        unitOfWork,
        clock: new FixedClock(RELAX_STARTED_AT),
        idGenerator: new QueueIds(['phase9-relax']),
      }).start(
        { type: 'pause', plannedMinutes: 5, source: 'today' },
        context('phase9-relax-start'),
      );

      // Another process loss leaves Relax active. The next process rehydrates
      // it, ends it, and can replay every terminal receipt exactly once.
      await reopen();
      const relaxService = new RelaxService({
        unitOfWork,
        clock: new FixedClock(RELAX_ENDED_AT),
        idGenerator: new QueueIds(['unused-relax']),
      });
      await expect(relaxService.getActive()).resolves.toMatchObject({
        id: relax.session.id,
        status: 'active',
      });
      const endedRelax = await relaxService.end(
        { sessionId: relax.session.id, outcome: 'completed' },
        context('phase9-relax-end'),
      );
      await expect(
        relaxService.end(
          { sessionId: relax.session.id, outcome: 'completed' },
          context('phase9-relax-end'),
        ),
      ).resolves.toEqual(endedRelax);
      await expect(
        executionService(unitOfWork, RELAX_ENDED_AT, {}).finish(
          {
            sessionId: started.session.id,
            outcome: 'complete_task',
            recordAchievement: true,
          },
          context('phase9-execution-finish'),
        ),
      ).resolves.toEqual(finished);
      await expect(
        new ReflectionService({
          unitOfWork,
          clock: new FixedClock(RELAX_ENDED_AT),
          idGenerator: new QueueIds(['unused-reflection']),
        }).refresh(reflectionInput, context('phase9-reflection-refresh')),
      ).resolves.toEqual(reflection);

      expect(await readFacts(database)).toEqual({
        achievement_count: 1,
        completion_count: 1,
        integration_job_count: 6,
        migration_count: databaseMigrations.length,
        operation_count: 9,
        reflection_count: 1,
        relax_count: 1,
        schedule_plan_count: 3,
        session_count: 1,
        state_version: 8,
        plan_revision: 3,
      });
      await expect(
        database.get<{ pending_count: number }>(`
          SELECT COUNT(*) AS pending_count
          FROM integration_jobs
          WHERE status = 'pending'
        `),
      ).resolves.toEqual({ pending_count: 6 });
    } finally {
      nativeDatabase.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
