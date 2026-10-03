import type {
  AgentRun,
  Achievement,
  CalendarBinding,
  CalendarContainerBinding,
  CalendarRefreshCoverage,
  CompletionRecord,
  DailyReflection,
  EnergyCheckIn,
  ExecutionInterval,
  ExecutionSession,
  ExternalCalendarEventSnapshot,
  ExternalMutationIntent,
  Goal,
  Instant,
  IntegrationJob,
  LocalDate,
  NotificationBinding,
  OperationRecord,
  Project,
  RelaxSession,
  ScheduleState,
  SchedulePlan,
  Task,
  TaskActivityEvent,
  TimeBlock,
  TimeZoneId,
  UserPreference,
  UserModelFeature,
} from '@workspace/domain';
import {
  assertValidIntegrationJob,
  claimIntegrationJob,
  externalMutationIntentChannel,
} from '@workspace/domain';
import type {
  ApplicationTransaction,
  ApplicationUnitOfWork,
  Clock,
  IdGenerator,
  IntegrationJobWakeupPort,
  LocalTime,
  LocalTimeProvider,
  PreviewExpirationContext,
  PreviewExpirationPolicy,
  ScheduleSnapshotRequest,
  SchedulingSnapshot,
  SchedulingSnapshotPort,
} from '@workspace/application';

export interface MemoryApplicationState {
  agentRuns: Map<string, AgentRun>;
  tasks: Map<string, Task>;
  goals: Map<string, Goal>;
  projects: Map<string, Project>;
  completionRecords: Map<string, CompletionRecord>;
  executionSessions: Map<string, ExecutionSession>;
  executionIntervals: Map<string, ExecutionInterval>;
  achievements: Map<string, Achievement>;
  taskActivityEvents: TaskActivityEvent[];
  operationRecords: Map<string, OperationRecord>;
  timeBlocks: Map<string, TimeBlock>;
  schedulePlans: Map<number, SchedulePlan>;
  integrationJobs: Map<string, IntegrationJob>;
  externalCalendarEventSnapshots: Map<string, ExternalCalendarEventSnapshot>;
  calendarRefreshCoverages: Map<string, CalendarRefreshCoverage>;
  calendarContainerBindings: Map<string, CalendarContainerBinding>;
  calendarBindings: Map<string, CalendarBinding>;
  notificationBindings: Map<string, NotificationBinding>;
  externalMutationIntents: Map<string, ExternalMutationIntent>;
  userPreferences: Map<string, UserPreference>;
  userModelFeatures: Map<string, UserModelFeature>;
  dailyReflections: Map<string, DailyReflection>;
  energyCheckIns: Map<string, EnergyCheckIn>;
  relaxSessions: Map<string, RelaxSession>;
  scheduleState: ScheduleState | null;
}

export function createMemoryState(): MemoryApplicationState {
  return {
    agentRuns: new Map(),
    tasks: new Map(),
    goals: new Map(),
    projects: new Map(),
    completionRecords: new Map(),
    executionSessions: new Map(),
    executionIntervals: new Map(),
    achievements: new Map(),
    taskActivityEvents: [],
    operationRecords: new Map(),
    timeBlocks: new Map(),
    schedulePlans: new Map(),
    integrationJobs: new Map(),
    externalCalendarEventSnapshots: new Map(),
    calendarRefreshCoverages: new Map(),
    calendarContainerBindings: new Map(),
    calendarBindings: new Map(),
    notificationBindings: new Map(),
    externalMutationIntents: new Map(),
    userPreferences: new Map(),
    userModelFeatures: new Map(),
    dailyReflections: new Map(),
    energyCheckIns: new Map(),
    relaxSessions: new Map(),
    scheduleState: { stateVersion: 0, planRevision: 0 },
  };
}

function cloneState(state: MemoryApplicationState): MemoryApplicationState {
  return {
    agentRuns: new Map(state.agentRuns),
    tasks: new Map(state.tasks),
    goals: new Map(state.goals),
    projects: new Map(state.projects),
    completionRecords: new Map(state.completionRecords),
    executionSessions: new Map(state.executionSessions),
    executionIntervals: new Map(state.executionIntervals),
    achievements: new Map(state.achievements),
    taskActivityEvents: [...state.taskActivityEvents],
    operationRecords: new Map(state.operationRecords),
    timeBlocks: new Map(state.timeBlocks),
    schedulePlans: new Map(state.schedulePlans),
    integrationJobs: new Map(state.integrationJobs),
    externalCalendarEventSnapshots: new Map(
      state.externalCalendarEventSnapshots,
    ),
    calendarRefreshCoverages: new Map(state.calendarRefreshCoverages),
    calendarContainerBindings: new Map(state.calendarContainerBindings),
    calendarBindings: new Map(state.calendarBindings),
    notificationBindings: new Map(state.notificationBindings),
    externalMutationIntents: new Map(state.externalMutationIntents),
    userPreferences: new Map(state.userPreferences),
    userModelFeatures: new Map(state.userModelFeatures),
    dailyReflections: new Map(state.dailyReflections),
    energyCheckIns: new Map(state.energyCheckIns),
    relaxSessions: new Map(state.relaxSessions),
    scheduleState:
      state.scheduleState === null ? null : { ...state.scheduleState },
  };
}

export class MemoryUnitOfWork implements ApplicationUnitOfWork {
  state: MemoryApplicationState;
  readonly calls: string[] = [];
  failOn: string | null = null;
  returnFalseOn: string | null = null;

  constructor(state: MemoryApplicationState = createMemoryState()) {
    this.state = state;
  }

  #recordCall(name: string): void {
    this.calls.push(name);
    if (this.failOn === name) {
      this.failOn = null;
      throw new Error(`Injected failure: ${name}`);
    }
  }

  #shouldReturnFalse(name: string): boolean {
    if (this.returnFalseOn !== name) return false;
    this.returnFalseOn = null;
    return true;
  }

  async transaction<Result>(
    work: (transaction: ApplicationTransaction) => Promise<Result>,
  ): Promise<Result> {
    const draft = cloneState(this.state);
    const transaction: ApplicationTransaction = {
      agentRuns: {
        findById: (id) => Promise.resolve(draft.agentRuns.get(id) ?? null),
        listRunning: () =>
          Promise.resolve(
            [...draft.agentRuns.values()]
              .filter((run) => run.status === 'running')
              .sort(
                (left, right) =>
                  left.startedAt.localeCompare(right.startedAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (run) => {
          this.#recordCall('agentRuns.insert');
          if (draft.agentRuns.has(run.id))
            throw new Error('duplicate AgentRun');
          draft.agentRuns.set(run.id, run);
          return Promise.resolve();
        },
        update: (run) => {
          this.#recordCall('agentRuns.update');
          if (!draft.agentRuns.has(run.id)) throw new Error('missing AgentRun');
          draft.agentRuns.set(run.id, run);
          return Promise.resolve();
        },
      },
      userModelFeatures: {
        findById: (id) =>
          Promise.resolve(draft.userModelFeatures.get(id) ?? null),
        listAll: () =>
          Promise.resolve(
            [...draft.userModelFeatures.values()].sort(
              (left, right) =>
                left.algorithmVersion.localeCompare(right.algorithmVersion) ||
                left.featureKey.localeCompare(right.featureKey) ||
                (left.scopeKey ?? '').localeCompare(right.scopeKey ?? '') ||
                left.id.localeCompare(right.id),
            ),
          ),
        listByAlgorithmVersion: (algorithmVersion) =>
          Promise.resolve(
            [...draft.userModelFeatures.values()]
              .filter(
                (feature) => feature.algorithmVersion === algorithmVersion,
              )
              .sort(
                (left, right) =>
                  left.featureKey.localeCompare(right.featureKey) ||
                  (left.scopeKey ?? '').localeCompare(right.scopeKey ?? '') ||
                  left.id.localeCompare(right.id),
              ),
          ),
        replaceForAlgorithmVersion: (algorithmVersion, features) => {
          this.#recordCall('userModelFeatures.replaceForAlgorithmVersion');
          for (const [id, feature] of draft.userModelFeatures) {
            if (feature.algorithmVersion === algorithmVersion) {
              draft.userModelFeatures.delete(id);
            }
          }
          for (const feature of features) {
            if (draft.userModelFeatures.has(feature.id)) {
              throw new Error('duplicate UserModelFeature');
            }
            draft.userModelFeatures.set(feature.id, feature);
          }
          return Promise.resolve();
        },
      },
      dailyReflections: {
        findById: (id) =>
          Promise.resolve(draft.dailyReflections.get(id) ?? null),
        findByLocalDay: (localDate, timeZone) =>
          Promise.resolve(
            [...draft.dailyReflections.values()].find(
              (reflection) =>
                reflection.localDate === localDate &&
                reflection.timeZone === timeZone,
            ) ?? null,
          ),
        insert: (reflection) => {
          this.#recordCall('dailyReflections.insert');
          if (draft.dailyReflections.has(reflection.id)) {
            throw new Error('duplicate DailyReflection');
          }
          if (
            [...draft.dailyReflections.values()].some(
              (candidate) =>
                candidate.localDate === reflection.localDate &&
                candidate.timeZone === reflection.timeZone,
            )
          ) {
            throw new Error('duplicate DailyReflection local day');
          }
          draft.dailyReflections.set(reflection.id, reflection);
          return Promise.resolve();
        },
        update: (reflection) => {
          this.#recordCall('dailyReflections.update');
          if (!draft.dailyReflections.has(reflection.id)) {
            throw new Error('missing DailyReflection');
          }
          draft.dailyReflections.set(reflection.id, reflection);
          return Promise.resolve();
        },
      },
      energyCheckIns: {
        findById: (id) => Promise.resolve(draft.energyCheckIns.get(id) ?? null),
        findLatestByLocalDay: (localDate, timeZone) =>
          Promise.resolve(
            [...draft.energyCheckIns.values()]
              .filter(
                (checkIn) =>
                  checkIn.localDate === localDate &&
                  checkIn.timeZone === timeZone,
              )
              .sort(
                (left, right) =>
                  right.createdAt.localeCompare(left.createdAt) ||
                  right.id.localeCompare(left.id),
              )[0] ?? null,
          ),
        findLatestAtOrBefore: (instant) =>
          Promise.resolve(
            [...draft.energyCheckIns.values()]
              .filter((checkIn) => checkIn.createdAt <= instant)
              .sort(
                (left, right) =>
                  right.createdAt.localeCompare(left.createdAt) ||
                  right.id.localeCompare(left.id),
              )[0] ?? null,
          ),
        listByLocalDay: (localDate, timeZone) =>
          Promise.resolve(
            [...draft.energyCheckIns.values()]
              .filter(
                (checkIn) =>
                  checkIn.localDate === localDate &&
                  checkIn.timeZone === timeZone,
              )
              .sort(
                (left, right) =>
                  right.createdAt.localeCompare(left.createdAt) ||
                  right.id.localeCompare(left.id),
              ),
          ),
        insert: (checkIn) => {
          this.#recordCall('energyCheckIns.insert');
          if (draft.energyCheckIns.has(checkIn.id)) {
            throw new Error('duplicate EnergyCheckIn');
          }
          draft.energyCheckIns.set(checkIn.id, checkIn);
          return Promise.resolve();
        },
      },
      relaxSessions: {
        findById: (id) => Promise.resolve(draft.relaxSessions.get(id) ?? null),
        findActive: () =>
          Promise.resolve(
            [...draft.relaxSessions.values()].find(
              (session) => session.status === 'active',
            ) ?? null,
          ),
        listStartedBetween: (start, end) =>
          Promise.resolve(
            [...draft.relaxSessions.values()]
              .filter(
                (session) =>
                  session.startedAt >= start && session.startedAt < end,
              )
              .sort(
                (left, right) =>
                  right.startedAt.localeCompare(left.startedAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (session) => {
          this.#recordCall('relaxSessions.insert');
          if (draft.relaxSessions.has(session.id)) {
            throw new Error('duplicate RelaxSession');
          }
          if (
            session.status === 'active' &&
            [...draft.relaxSessions.values()].some(
              (candidate) => candidate.status === 'active',
            )
          ) {
            throw new Error('duplicate active RelaxSession');
          }
          draft.relaxSessions.set(session.id, session);
          return Promise.resolve();
        },
        update: (session) => {
          this.#recordCall('relaxSessions.update');
          if (!draft.relaxSessions.has(session.id)) {
            throw new Error('missing RelaxSession');
          }
          draft.relaxSessions.set(session.id, session);
          return Promise.resolve();
        },
      },
      tasks: {
        findById: (id) => Promise.resolve(draft.tasks.get(id) ?? null),
        listAll: () =>
          Promise.resolve(
            [...draft.tasks.values()].sort(
              (left, right) =>
                (left.deadlineAt ?? '9999').localeCompare(
                  right.deadlineAt ?? '9999',
                ) ||
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            ),
          ),
        listActive: () =>
          Promise.resolve(
            [...draft.tasks.values()]
              .filter(
                (task) =>
                  task.status !== 'completed' && task.status !== 'canceled',
              )
              .sort(
                (left, right) =>
                  (left.deadlineAt ?? '9999').localeCompare(
                    right.deadlineAt ?? '9999',
                  ) ||
                  left.createdAt.localeCompare(right.createdAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (task) => {
          this.#recordCall('tasks.insert');
          if (draft.tasks.has(task.id)) throw new Error('duplicate Task');
          draft.tasks.set(task.id, task);
          return Promise.resolve();
        },
        update: (task) => {
          this.#recordCall('tasks.update');
          if (!draft.tasks.has(task.id)) throw new Error('missing Task');
          draft.tasks.set(task.id, task);
          return Promise.resolve();
        },
        listByGoalId: (goalId) =>
          Promise.resolve(
            [...draft.tasks.values()].filter((task) => task.goalId === goalId),
          ),
        listByProjectIds: (projectIds) => {
          const ids = new Set(projectIds);
          return Promise.resolve(
            [...draft.tasks.values()].filter(
              (task) => task.projectId !== null && ids.has(task.projectId),
            ),
          );
        },
        listByParentIds: (parentIds) => {
          const ids = new Set(parentIds);
          return Promise.resolve(
            [...draft.tasks.values()].filter(
              (task) =>
                task.parentTaskId !== null && ids.has(task.parentTaskId),
            ),
          );
        },
      },
      goals: {
        findById: (id) => Promise.resolve(draft.goals.get(id) ?? null),
        listAll: () => Promise.resolve([...draft.goals.values()]),
        insert: (goal) => {
          this.#recordCall('goals.insert');
          if (draft.goals.has(goal.id)) throw new Error('duplicate Goal');
          draft.goals.set(goal.id, goal);
          return Promise.resolve();
        },
        update: (goal) => {
          this.#recordCall('goals.update');
          if (!draft.goals.has(goal.id)) throw new Error('missing Goal');
          draft.goals.set(goal.id, goal);
          return Promise.resolve();
        },
      },
      projects: {
        findById: (id) => Promise.resolve(draft.projects.get(id) ?? null),
        listAll: () => Promise.resolve([...draft.projects.values()]),
        insert: (project) => {
          this.#recordCall('projects.insert');
          if (draft.projects.has(project.id)) {
            throw new Error('duplicate Project');
          }
          draft.projects.set(project.id, project);
          return Promise.resolve();
        },
        update: (project) => {
          this.#recordCall('projects.update');
          if (!draft.projects.has(project.id)) {
            throw new Error('missing Project');
          }
          draft.projects.set(project.id, project);
          return Promise.resolve();
        },
        listByGoalId: (goalId) =>
          Promise.resolve(
            [...draft.projects.values()].filter(
              (project) => project.goalId === goalId,
            ),
          ),
      },
      completionRecords: {
        findById: (id) =>
          Promise.resolve(
            [...draft.completionRecords.values()].find(
              (record) => record.id === id,
            ) ?? null,
          ),
        findByTaskId: (taskId) =>
          Promise.resolve(draft.completionRecords.get(taskId) ?? null),
        listCompletedBetween: (start, end) =>
          Promise.resolve(
            [...draft.completionRecords.values()]
              .filter(
                (record) =>
                  Date.parse(record.completedAt) >= Date.parse(start) &&
                  Date.parse(record.completedAt) < Date.parse(end),
              )
              .sort(
                (left, right) =>
                  left.completedAt.localeCompare(right.completedAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (record) => {
          this.#recordCall('completionRecords.insert');
          if (draft.completionRecords.has(record.taskId)) {
            throw new Error('duplicate completion record');
          }
          draft.completionRecords.set(record.taskId, record);
          return Promise.resolve();
        },
        update: (record) => {
          this.#recordCall('completionRecords.update');
          if (!draft.completionRecords.has(record.taskId)) {
            throw new Error('missing completion record');
          }
          draft.completionRecords.set(record.taskId, record);
          return Promise.resolve();
        },
      },
      executionSessions: {
        findById: (id) =>
          Promise.resolve(draft.executionSessions.get(id) ?? null),
        findActive: () =>
          Promise.resolve(
            [...draft.executionSessions.values()].find(
              (session) =>
                session.status === 'running' || session.status === 'paused',
            ) ?? null,
          ),
        listByTaskId: (taskId) =>
          Promise.resolve(
            [...draft.executionSessions.values()]
              .filter((session) => session.taskId === taskId)
              .sort(
                (left, right) =>
                  left.startedAt.localeCompare(right.startedAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        listEndedBetween: (start, end) =>
          Promise.resolve(
            [...draft.executionSessions.values()]
              .filter(
                (session) =>
                  session.endedAt !== null &&
                  Date.parse(session.endedAt) >= Date.parse(start) &&
                  Date.parse(session.endedAt) < Date.parse(end),
              )
              .sort(
                (left, right) =>
                  left.endedAt!.localeCompare(right.endedAt!) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (session) => {
          this.#recordCall('executionSessions.insert');
          if (draft.executionSessions.has(session.id)) {
            throw new Error('duplicate ExecutionSession');
          }
          if (
            (session.status === 'running' || session.status === 'paused') &&
            [...draft.executionSessions.values()].some(
              (current) =>
                current.status === 'running' || current.status === 'paused',
            )
          ) {
            throw new Error('duplicate active ExecutionSession');
          }
          draft.executionSessions.set(session.id, session);
          return Promise.resolve();
        },
        update: (session) => {
          this.#recordCall('executionSessions.update');
          if (!draft.executionSessions.has(session.id)) {
            throw new Error('missing ExecutionSession');
          }
          draft.executionSessions.set(session.id, session);
          return Promise.resolve();
        },
      },
      executionIntervals: {
        findById: (id) =>
          Promise.resolve(draft.executionIntervals.get(id) ?? null),
        findOpenBySessionId: (sessionId) =>
          Promise.resolve(
            [...draft.executionIntervals.values()].find(
              (interval) =>
                interval.sessionId === sessionId && interval.endAt === null,
            ) ?? null,
          ),
        listBySessionId: (sessionId) =>
          Promise.resolve(
            [...draft.executionIntervals.values()]
              .filter((interval) => interval.sessionId === sessionId)
              .sort(
                (left, right) =>
                  left.startAt.localeCompare(right.startAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (interval) => {
          this.#recordCall('executionIntervals.insert');
          if (draft.executionIntervals.has(interval.id)) {
            throw new Error('duplicate ExecutionInterval');
          }
          if (
            interval.endAt === null &&
            [...draft.executionIntervals.values()].some(
              (current) =>
                current.sessionId === interval.sessionId &&
                current.endAt === null,
            )
          ) {
            throw new Error('duplicate open ExecutionInterval');
          }
          draft.executionIntervals.set(interval.id, interval);
          return Promise.resolve();
        },
        update: (interval) => {
          this.#recordCall('executionIntervals.update');
          if (!draft.executionIntervals.has(interval.id)) {
            throw new Error('missing ExecutionInterval');
          }
          draft.executionIntervals.set(interval.id, interval);
          return Promise.resolve();
        },
      },
      achievements: {
        findById: (id) => Promise.resolve(draft.achievements.get(id) ?? null),
        findByCompletionRecordId: (id) =>
          Promise.resolve(
            [...draft.achievements.values()].find(
              (achievement) => achievement.sourceCompletionRecordId === id,
            ) ?? null,
          ),
        listOccurredBetween: (start, end) =>
          Promise.resolve(
            [...draft.achievements.values()]
              .filter(
                (achievement) =>
                  Date.parse(achievement.occurredAt) >= Date.parse(start) &&
                  Date.parse(achievement.occurredAt) < Date.parse(end),
              )
              .sort(
                (left, right) =>
                  right.occurredAt.localeCompare(left.occurredAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        listAll: () =>
          Promise.resolve(
            [...draft.achievements.values()].sort(
              (left, right) =>
                right.occurredAt.localeCompare(left.occurredAt) ||
                left.id.localeCompare(right.id),
            ),
          ),
        insert: (achievement) => {
          this.#recordCall('achievements.insert');
          if (
            draft.achievements.has(achievement.id) ||
            [...draft.achievements.values()].some(
              (current) =>
                current.sourceCompletionRecordId ===
                achievement.sourceCompletionRecordId,
            )
          ) {
            throw new Error('duplicate Achievement');
          }
          draft.achievements.set(achievement.id, achievement);
          return Promise.resolve();
        },
        update: (achievement) => {
          this.#recordCall('achievements.update');
          if (!draft.achievements.has(achievement.id)) {
            throw new Error('missing Achievement');
          }
          draft.achievements.set(achievement.id, achievement);
          return Promise.resolve();
        },
      },
      taskActivityEvents: {
        listOccurredBetween: (start, end) =>
          Promise.resolve(
            draft.taskActivityEvents
              .filter(
                (event) =>
                  Date.parse(event.occurredAt) >= Date.parse(start) &&
                  Date.parse(event.occurredAt) < Date.parse(end),
              )
              .sort(
                (left, right) =>
                  left.occurredAt.localeCompare(right.occurredAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (event) => {
          this.#recordCall('taskActivityEvents.insert');
          draft.taskActivityEvents.push(event);
          return Promise.resolve();
        },
      },
      operationRecords: {
        findById: (operationId) =>
          Promise.resolve(draft.operationRecords.get(operationId) ?? null),
        insert: (record) => {
          this.#recordCall('operationRecords.insert');
          if (draft.operationRecords.has(record.operationId)) {
            throw new Error('duplicate operation record');
          }
          draft.operationRecords.set(record.operationId, record);
          return Promise.resolve();
        },
      },
      scheduleState: {
        get: () => Promise.resolve(draft.scheduleState),
        update: (state) => {
          this.#recordCall('scheduleState.update');
          draft.scheduleState = state;
          return Promise.resolve();
        },
      },
      timeBlocks: {
        findById: (id) => Promise.resolve(draft.timeBlocks.get(id) ?? null),
        listAll: () => Promise.resolve([...draft.timeBlocks.values()]),
        listOverlapping: (start, end) =>
          Promise.resolve(
            [...draft.timeBlocks.values()]
              .filter(
                (block) =>
                  Date.parse(block.startAt) < Date.parse(end) &&
                  Date.parse(block.endAt) > Date.parse(start),
              )
              .sort(
                (left, right) =>
                  left.startAt.localeCompare(right.startAt) ||
                  left.endAt.localeCompare(right.endAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (block) => {
          this.#recordCall('timeBlocks.insert');
          if (draft.timeBlocks.has(block.id)) {
            throw new Error('duplicate TimeBlock');
          }
          draft.timeBlocks.set(block.id, block);
          return Promise.resolve();
        },
        update: (block) => {
          this.#recordCall('timeBlocks.update');
          if (!draft.timeBlocks.has(block.id)) {
            throw new Error('missing TimeBlock');
          }
          draft.timeBlocks.set(block.id, block);
          return Promise.resolve();
        },
      },
      schedulePlans: {
        findByRevision: (revision) =>
          Promise.resolve(draft.schedulePlans.get(revision) ?? null),
        insert: (plan) => {
          this.#recordCall('schedulePlans.insert');
          if (draft.schedulePlans.has(plan.planRevision)) {
            throw new Error('duplicate SchedulePlan revision');
          }
          draft.schedulePlans.set(plan.planRevision, plan);
          return Promise.resolve();
        },
      },
      integrationJobs: {
        insert: (job) => {
          this.#recordCall('integrationJobs.insert');
          if (draft.integrationJobs.has(job.id)) {
            throw new Error('duplicate IntegrationJob');
          }
          draft.integrationJobs.set(job.id, job);
          return Promise.resolve();
        },
        findById: (id) =>
          Promise.resolve(draft.integrationJobs.get(id) ?? null),
        findLatestByChannel: (channel) =>
          Promise.resolve(
            [...draft.integrationJobs.values()]
              .filter((job) => job.targetChannel === channel)
              .sort(
                (left, right) =>
                  right.desiredRevision - left.desiredRevision ||
                  right.createdAt.localeCompare(left.createdAt) ||
                  right.id.localeCompare(left.id),
              )[0] ?? null,
          ),
        listByOperationId: (operationId) =>
          Promise.resolve(
            [...draft.integrationJobs.values()].filter(
              (job) => job.operationId === operationId,
            ),
          ),
        claimNext: (input) => {
          this.#recordCall('integrationJobs.claimNext');
          const jobs = [...draft.integrationJobs.values()].filter(
            (job) => job.targetChannel === input.channel,
          );
          const active = jobs.some(
            (job) =>
              job.status === 'processing' &&
              job.leaseExpiresAt !== null &&
              Date.parse(job.leaseExpiresAt) > Date.parse(input.claimedAt),
          );
          if (active) return Promise.resolve(null);
          const candidate = jobs
            .filter((job) => {
              const normallyEligible = [
                'pending',
                'failed',
                'reconciliation_required',
              ].includes(job.status);
              const expired =
                job.status === 'processing' &&
                job.leaseExpiresAt !== null &&
                Date.parse(job.leaseExpiresAt) <= Date.parse(input.claimedAt);
              return (
                (normallyEligible || expired) &&
                (expired || job.automaticRetryEligible) &&
                Date.parse(job.notBefore) <= Date.parse(input.claimedAt)
              );
            })
            .sort(
              (left, right) =>
                Number(
                  [...draft.externalMutationIntents.values()].some(
                    (intent) => intent.integrationJobId === right.id,
                  ),
                ) -
                  Number(
                    [...draft.externalMutationIntents.values()].some(
                      (intent) => intent.integrationJobId === left.id,
                    ),
                  ) ||
                Number(right.status === 'processing') -
                  Number(left.status === 'processing') ||
                right.desiredRevision - left.desiredRevision ||
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            )[0];
          if (candidate === undefined) return Promise.resolve(null);
          const recoveredExpiredLease = candidate.status === 'processing';
          const claimed = claimIntegrationJob(candidate, input);
          draft.integrationJobs.set(claimed.id, claimed);
          return Promise.resolve({ job: claimed, recoveredExpiredLease });
        },
        updateClaimed: (job, fence) => {
          this.#recordCall('integrationJobs.updateClaimed');
          if (this.#shouldReturnFalse('integrationJobs.updateClaimed')) {
            return Promise.resolve(false);
          }
          const current = draft.integrationJobs.get(job.id);
          if (
            current === undefined ||
            current.status !== 'processing' ||
            current.claimToken !== fence.expectedClaimToken ||
            current.attemptCount !== fence.expectedAttemptCount
          ) {
            return Promise.resolve(false);
          }
          draft.integrationJobs.set(job.id, job);
          return Promise.resolve(true);
        },
        requeueBlockedChannel: (input) => {
          this.#recordCall('integrationJobs.requeueBlockedChannel');
          let changed = 0;
          for (const [id, job] of draft.integrationJobs) {
            if (
              job.targetChannel !== input.channel ||
              job.status !== 'permission_required'
            ) {
              continue;
            }
            const requeued: IntegrationJob = {
              ...job,
              status: 'pending',
              lastErrorCode: null,
              automaticRetryEligible: true,
              notBefore: input.notBefore,
              updatedAt: input.requeuedAt,
            };
            assertValidIntegrationJob(requeued);
            draft.integrationJobs.set(id, requeued);
            changed += 1;
          }
          return Promise.resolve(changed);
        },
        requeueBlockedJob: (input) => {
          this.#recordCall('integrationJobs.requeueBlockedJob');
          const current = draft.integrationJobs.get(input.jobId);
          if (
            current === undefined ||
            current.targetChannel !== input.channel ||
            current.status !== 'reconciliation_required'
          ) {
            return Promise.resolve(false);
          }
          const requeued: IntegrationJob = {
            ...current,
            status: 'pending',
            lastErrorCode: null,
            automaticRetryEligible: true,
            notBefore: input.notBefore,
            updatedAt: input.requeuedAt,
          };
          assertValidIntegrationJob(requeued);
          draft.integrationJobs.set(current.id, requeued);
          return Promise.resolve(true);
        },
        requeueLatestProjection: (input) => {
          this.#recordCall('integrationJobs.requeueLatestProjection');
          const current = [...draft.integrationJobs.values()]
            .filter(
              (job) =>
                job.targetChannel === input.channel &&
                job.desiredRevision === input.desiredRevision,
            )
            .sort(
              (left, right) =>
                right.createdAt.localeCompare(left.createdAt) ||
                right.id.localeCompare(left.id),
            )[0];
          if (
            current === undefined ||
            ![
              'succeeded',
              'permission_required',
              'failed',
              'disabled',
            ].includes(current.status) ||
            [...draft.externalMutationIntents.values()].some(
              (intent) => intent.integrationJobId === current.id,
            )
          ) {
            return Promise.resolve(false);
          }
          const requeued: IntegrationJob = {
            ...current,
            status: 'pending',
            lastErrorCode: null,
            automaticRetryEligible: true,
            claimToken: null,
            leaseExpiresAt: null,
            notBefore: input.notBefore,
            updatedAt: input.requeuedAt,
          };
          assertValidIntegrationJob(requeued);
          draft.integrationJobs.set(current.id, requeued);
          return Promise.resolve(true);
        },
      },
      externalCalendarEventSnapshots: {
        listOverlapping: (scope) =>
          Promise.resolve(
            [...draft.externalCalendarEventSnapshots.values()].filter(
              (snapshot) =>
                snapshot.provider === scope.provider &&
                snapshot.calendarId === scope.calendarId &&
                Date.parse(snapshot.startAt) < Date.parse(scope.rangeEnd) &&
                Date.parse(snapshot.endAt) > Date.parse(scope.rangeStart),
            ),
          ),
        upsert: (snapshot) => {
          this.#recordCall('externalCalendarEventSnapshots.upsert');
          const duplicate = [
            ...draft.externalCalendarEventSnapshots.values(),
          ].find(
            (current) =>
              current.id !== snapshot.id &&
              current.provider === snapshot.provider &&
              current.calendarId === snapshot.calendarId &&
              current.externalEventId === snapshot.externalEventId &&
              current.occurrenceKey === snapshot.occurrenceKey,
          );
          if (duplicate !== undefined) {
            throw new Error('duplicate external calendar event identity');
          }
          draft.externalCalendarEventSnapshots.set(snapshot.id, snapshot);
          return Promise.resolve();
        },
        deleteByIds: (ids) => {
          this.#recordCall('externalCalendarEventSnapshots.deleteByIds');
          for (const id of ids) draft.externalCalendarEventSnapshots.delete(id);
          return Promise.resolve();
        },
      },
      calendarRefreshCoverages: {
        insert: (coverage) => {
          this.#recordCall('calendarRefreshCoverages.insert');
          if (draft.calendarRefreshCoverages.has(coverage.id)) {
            throw new Error('duplicate calendar refresh coverage');
          }
          draft.calendarRefreshCoverages.set(coverage.id, coverage);
          return Promise.resolve();
        },
        findLatestCovering: (scope) =>
          Promise.resolve(
            [...draft.calendarRefreshCoverages.values()]
              .filter(
                (coverage) =>
                  coverage.provider === scope.provider &&
                  coverage.calendarId === scope.calendarId &&
                  Date.parse(coverage.rangeStart) <=
                    Date.parse(scope.rangeStart) &&
                  Date.parse(coverage.rangeEnd) >= Date.parse(scope.rangeEnd),
              )
              .sort((left, right) =>
                right.fetchedAt.localeCompare(left.fetchedAt),
              )[0] ?? null,
          ),
      },
      calendarContainerBindings: {
        findByOwnership: (provider, ownershipKey) =>
          Promise.resolve(
            [...draft.calendarContainerBindings.values()].find(
              (binding) =>
                binding.provider === provider &&
                binding.ownershipKey === ownershipKey,
            ) ?? null,
          ),
        upsert: (binding) => {
          this.#recordCall('calendarContainerBindings.upsert');
          const duplicate = [...draft.calendarContainerBindings.values()].find(
            (current) =>
              current.id !== binding.id &&
              current.provider === binding.provider &&
              (current.calendarId === binding.calendarId ||
                current.ownershipKey === binding.ownershipKey),
          );
          if (duplicate !== undefined) {
            throw new Error('duplicate calendar container binding');
          }
          draft.calendarContainerBindings.set(binding.id, binding);
          return Promise.resolve();
        },
      },
      calendarBindings: {
        findByTimeBlockId: (timeBlockId) =>
          Promise.resolve(
            [...draft.calendarBindings.values()].find(
              (binding) => binding.timeBlockId === timeBlockId,
            ) ?? null,
          ),
        listAll: () => Promise.resolve([...draft.calendarBindings.values()]),
        upsertIfNotNewer: (binding) => {
          this.#recordCall('calendarBindings.upsertIfNotNewer');
          if (this.#shouldReturnFalse('calendarBindings.upsertIfNotNewer')) {
            return Promise.resolve(false);
          }
          const current = [...draft.calendarBindings.values()].find(
            (candidate) => candidate.timeBlockId === binding.timeBlockId,
          );
          if (
            current !== undefined &&
            (current.id !== binding.id ||
              current.lastAppliedRevision > binding.lastAppliedRevision)
          ) {
            return Promise.resolve(false);
          }
          draft.calendarBindings.set(binding.id, binding);
          return Promise.resolve(true);
        },
        deleteIfNotNewer: (id, expectedLastAppliedRevision) => {
          this.#recordCall('calendarBindings.deleteIfNotNewer');
          if (this.#shouldReturnFalse('calendarBindings.deleteIfNotNewer')) {
            return Promise.resolve(false);
          }
          const current = draft.calendarBindings.get(id);
          if (
            current === undefined ||
            current.lastAppliedRevision > expectedLastAppliedRevision
          ) {
            return Promise.resolve(false);
          }
          draft.calendarBindings.delete(id);
          return Promise.resolve(true);
        },
      },
      notificationBindings: {
        findByIdentity: (timeBlockId, type) =>
          Promise.resolve(
            [...draft.notificationBindings.values()].find(
              (binding) =>
                binding.timeBlockId === timeBlockId && binding.type === type,
            ) ?? null,
          ),
        listAll: () =>
          Promise.resolve([...draft.notificationBindings.values()]),
        upsertIfNotNewer: (binding) => {
          this.#recordCall('notificationBindings.upsertIfNotNewer');
          if (
            this.#shouldReturnFalse('notificationBindings.upsertIfNotNewer')
          ) {
            return Promise.resolve(false);
          }
          const current = [...draft.notificationBindings.values()].find(
            (candidate) =>
              candidate.timeBlockId === binding.timeBlockId &&
              candidate.type === binding.type,
          );
          if (
            current !== undefined &&
            (current.id !== binding.id ||
              current.lastAppliedRevision > binding.lastAppliedRevision)
          ) {
            return Promise.resolve(false);
          }
          draft.notificationBindings.set(binding.id, binding);
          return Promise.resolve(true);
        },
        deleteIfNotNewer: (id, expectedLastAppliedRevision) => {
          this.#recordCall('notificationBindings.deleteIfNotNewer');
          if (
            this.#shouldReturnFalse('notificationBindings.deleteIfNotNewer')
          ) {
            return Promise.resolve(false);
          }
          const current = draft.notificationBindings.get(id);
          if (
            current === undefined ||
            current.lastAppliedRevision > expectedLastAppliedRevision
          ) {
            return Promise.resolve(false);
          }
          draft.notificationBindings.delete(id);
          return Promise.resolve(true);
        },
      },
      externalMutationIntents: {
        findByJobId: (jobId) =>
          Promise.resolve(
            [...draft.externalMutationIntents.values()].find(
              (intent) => intent.integrationJobId === jobId,
            ) ?? null,
          ),
        findByScopeKey: (scopeKey) =>
          Promise.resolve(
            [...draft.externalMutationIntents.values()].find(
              (intent) => intent.scopeKey === scopeKey,
            ) ?? null,
          ),
        listByChannel: (channel) =>
          Promise.resolve(
            [...draft.externalMutationIntents.values()]
              .filter(
                (intent) => externalMutationIntentChannel(intent) === channel,
              )
              .sort(
                (left, right) =>
                  left.createdAt.localeCompare(right.createdAt) ||
                  left.id.localeCompare(right.id),
              ),
          ),
        insert: (intent) => {
          this.#recordCall('externalMutationIntents.insert');
          if (
            draft.externalMutationIntents.has(intent.id) ||
            [...draft.externalMutationIntents.values()].some(
              (current) =>
                current.integrationJobId === intent.integrationJobId ||
                current.scopeKey === intent.scopeKey,
            )
          ) {
            throw new Error('duplicate ExternalMutationIntent');
          }
          draft.externalMutationIntents.set(intent.id, intent);
          return Promise.resolve();
        },
        deleteById: (id) => {
          this.#recordCall('externalMutationIntents.deleteById');
          if (!draft.externalMutationIntents.delete(id)) {
            throw new Error('missing ExternalMutationIntent');
          }
          return Promise.resolve();
        },
      },
      userPreferences: {
        findByKey: (key) =>
          Promise.resolve(
            [...draft.userPreferences.values()].find(
              (preference) => preference.key === key,
            ) ?? null,
          ),
        listByKeys: (keys) => {
          const requested = new Set(keys);
          return Promise.resolve(
            [...draft.userPreferences.values()].filter((preference) =>
              requested.has(preference.key),
            ),
          );
        },
        upsert: (preference) => {
          this.#recordCall('userPreferences.upsert');
          const duplicate = [...draft.userPreferences.values()].find(
            (current) =>
              current.id !== preference.id && current.key === preference.key,
          );
          if (duplicate !== undefined) {
            throw new Error('duplicate UserPreference key');
          }
          draft.userPreferences.set(preference.id, preference);
          return Promise.resolve();
        },
      },
    };

    const result = await work(transaction);
    this.state = draft;
    return result;
  }
}

export class SequenceClock implements Clock {
  readonly #instants: Instant[];
  #index = 0;

  constructor(...instants: Instant[]) {
    this.#instants = instants;
  }

  now(): Instant {
    const value = this.#instants[this.#index] ?? this.#instants.at(-1);
    if (value === undefined) throw new Error('No fake clock value configured.');
    this.#index += 1;
    return value;
  }
}

export class QueueIdGenerator implements IdGenerator {
  readonly #ids: string[];
  #index = 0;

  constructor(...ids: string[]) {
    this.#ids = ids;
  }

  generate(): string {
    const value = this.#ids[this.#index];
    if (value === undefined) throw new Error('No fake ID configured.');
    this.#index += 1;
    return value;
  }
}

export class FixedLocalTimeProvider implements LocalTimeProvider {
  readonly #value: LocalTime;

  constructor(localDate: LocalDate, timeZone: TimeZoneId) {
    this.#value = { localDate, timeZone };
  }

  resolve(_instant: Instant): LocalTime {
    return this.#value;
  }
}

export class MutableSchedulingSnapshotPort implements SchedulingSnapshotPort {
  snapshot: SchedulingSnapshot;
  readonly requests: ScheduleSnapshotRequest[] = [];

  constructor(snapshot: SchedulingSnapshot) {
    this.snapshot = snapshot;
  }

  capture(request: ScheduleSnapshotRequest): Promise<SchedulingSnapshot> {
    this.requests.push(request);
    return Promise.resolve(this.snapshot);
  }
}

export class FixedPreviewExpirationPolicy implements PreviewExpirationPolicy {
  expiration: Instant;
  readonly contexts: PreviewExpirationContext[] = [];

  constructor(expiration: Instant) {
    this.expiration = expiration;
  }

  expirationFor(context: PreviewExpirationContext): Instant {
    this.contexts.push(context);
    return this.expiration;
  }
}

export class RecordingIntegrationWakeup implements IntegrationJobWakeupPort {
  readonly operationIds: string[] = [];
  fail = false;
  onWake: (() => void) | null = null;

  wake(operationId: string): Promise<void> {
    this.onWake?.();
    this.operationIds.push(operationId);
    if (this.fail) return Promise.reject(new Error('Injected wakeup failure'));
    return Promise.resolve();
  }
}
