import { z } from 'zod';
import * as domain from '@workspace/domain';
import { syncEntityFields } from './sync-entity-fields';
import { hashOperationParameters } from './idempotency';
import { updatePreferenceInputSchema } from './preference-schemas';

export interface CloudAbortSignal {
  readonly aborted: boolean;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
class CloudAbortController {
  readonly signal: CloudAbortSignal;
  #aborted = false;
  #listeners = new Set<() => void>();
  constructor() {
    const self = this;
    this.signal = {
      get aborted() {
        return self.#aborted;
      },
      addEventListener(_type, listener) {
        self.#listeners.add(listener);
      },
      removeEventListener(_type, listener) {
        self.#listeners.delete(listener);
      },
    };
  }
  abort() {
    if (this.#aborted) return;
    this.#aborted = true;
    for (const listener of this.#listeners) listener();
    this.#listeners.clear();
  }
}

export type SyncKind = keyof typeof syncEntityFields;
export type SyncDocument = Record<string, unknown>;
const version = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
export const cloudEntitySchema = z
  .object({
    kind: z.enum(Object.keys(syncEntityFields) as [SyncKind, ...SyncKind[]]),
    key: z.string().min(1).max(512),
    version,
    ownerDeviceId: z.string().max(128),
    value: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((e, ctx) => {
    try {
      validateSyncDocument(e.kind, e.value, e.key);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid portable fact.' });
    }
  });
export type CloudEntity = z.infer<typeof cloudEntitySchema>;
export const cloudBatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.string().min(8).max(160),
    changes: z.array(cloudEntitySchema).min(1).max(20000),
  })
  .strict();
export type CloudBatch = z.infer<typeof cloudBatchSchema>;
export const cloudResultSchema = z
  .object({
    revision: version,
    entities: z.array(cloudEntitySchema),
    conflictId: z.string().default(''),
  })
  .strict();
export type CloudResult = z.infer<typeof cloudResultSchema>;
export const cloudCommitSchema = z
  .object({
    revision: version,
    batchId: z.string(),
    entities: z.array(cloudEntitySchema),
  })
  .strict();
export type CloudCommit = z.infer<typeof cloudCommitSchema>;
export const cloudBootstrapPageSchema = z
  .object({
    id: z.string().min(1),
    revision: version,
    page: z.number().int().min(0),
    entities: z.array(cloudEntitySchema),
    hasMore: z.boolean(),
  })
  .strict();
export type CloudBootstrapPage = z.infer<typeof cloudBootstrapPageSchema>;
export const cloudPullSchema = z
  .object({
    cursor: version,
    commits: z.array(cloudCommitSchema),
    hasMore: z.boolean(),
  })
  .strict();
export const cloudConflictSchema = z
  .object({
    id: z.string(),
    batchId: z.string(),
    status: z.enum(['open', 'local', 'cloud']),
    local: cloudBatchSchema,
    remote: z.array(cloudEntitySchema),
  })
  .strict();
export type CloudConflict = z.infer<typeof cloudConflictSchema>;
export const cloudTokensSchema = z
  .object({
    userId: z.string().min(1),
    deviceId: z.string().min(1),
    email: z.string().email(),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn: z.number().int().positive(),
  })
  .strict();
export type CloudTokens = z.infer<typeof cloudTokensSchema>;
export type CloudCredentials = Readonly<{
  email: string;
  password: string;
  installationId: string;
  deviceName: string;
}>;
export const portablePreferenceKeys = [
  'scheduling.timeZone.v1',
  'scheduling.workingHours.v1',
  'notification.leadMinutes.v1',
  'focus.mindfulTransition.enabled.v1',
  'personalization.enabled.v1',
  'wellbeing.checkIn.enabled.v1',
  'wellbeing.relaxSuggestions.enabled.v1',
] as const;
export function syncEntityKey(kind: SyncKind, value: SyncDocument): string {
  if (kind === 'preference') return String(value.key);
  if (kind === 'reflection')
    return `${String(value.localDate)}@${String(value.timeZone)}`;
  return String(value.id);
}
const validators: Partial<Record<SyncKind, (value: never) => void>> = {
  goal: domain.assertValidGoal,
  project: domain.assertValidProject,
  task: domain.assertValidTask,
  time_block: domain.assertValidTimeBlock,
  execution_session: domain.assertValidExecutionSession,
  execution_interval: domain.assertValidExecutionInterval,
  completion_record: domain.assertValidCompletionRecord,
  achievement: domain.assertValidAchievement,
  task_activity: domain.assertValidTaskActivityEvent,
  reflection: domain.assertValidDailyReflection,
  energy_check_in: domain.assertValidEnergyCheckIn,
  relax_session: domain.assertValidRelaxSession,
  preference: domain.assertValidUserPreference,
};
export function validateSyncDocument(
  kind: SyncKind,
  value: SyncDocument,
  key: string,
): void {
  const fields = syncEntityFields[kind].fields;
  if (
    Object.keys(value).length !== Object.keys(fields).length ||
    syncEntityKey(kind, value) !== key
  )
    throw new Error('Invalid portable fact.');
  for (const [name, rule] of Object.entries(fields)) {
    if (!Object.hasOwn(value, name)) throw new Error('Missing field.');
    const v = value[name];
    if (v === null) {
      if (!rule.nullable) throw new Error('Unexpected null.');
      continue;
    }
    switch (rule.type) {
      case 'instant':
        domain.parseInstant(v as string);
        break;
      case 'date':
        domain.parseLocalDate(v as string);
        break;
      case 'zone':
        domain.parseTimeZoneId(v as string);
        break;
      case 'string':
        if (typeof v !== 'string' || v.length > 65536)
          throw new Error('Invalid string.');
        break;
      case 'number':
        if (
          typeof v !== 'number' ||
          !Number.isFinite(v) ||
          v < 0 ||
          v > Number.MAX_SAFE_INTEGER
        )
          throw new Error('Invalid number.');
        break;
      case 'boolean':
        if (typeof v !== 'boolean') throw new Error('Invalid boolean.');
        break;
      case 'json':
        domain.normalizePreferenceJson(v);
    }
  }
  if (kind === 'plan_origin') {
    if (
      !Array.isArray(value.affectedBlockIds) ||
      value.affectedBlockIds.length > 20000
    )
      throw new Error('Invalid plan references.');
    for (const id of value.affectedBlockIds)
      domain.parseTimeBlockId(id as string);
    return;
  }
  if (kind === 'operation_provenance') {
    domain.parseOperationId(value.id as string);
    domain.requireNonEmptyString(value.command as string, 'command');
    return;
  }
  if (kind === 'preference') {
    updatePreferenceInputSchema.parse({
      key: value.key,
      value: value.valueJson,
    });
    if (!(portablePreferenceKeys as readonly unknown[]).includes(value.key))
      throw new Error('Device preference cannot be synced.');
  }
  const normalized =
    kind === 'time_block'
      ? { ...value, planRevision: 0, externalCalendarEventId: null }
      : value;
  validators[kind]?.(normalized as never);
}
export function portableFact(
  kind: SyncKind,
  value: SyncDocument,
): SyncDocument {
  return Object.fromEntries(
    Object.keys(syncEntityFields[kind].fields).map((key) => [key, value[key]]),
  );
}
export class CloudError extends Error {
  constructor(
    readonly code:
      | 'network'
      | 'authentication'
      | 'conflict'
      | 'validation'
      | 'unavailable'
      | 'canceled'
      | 'remote_active'
      | 'credential_storage',
    readonly retryable = false,
  ) {
    super(`Cloud operation failed: ${code}`);
  }
}
export interface CloudAPI {
  bootstrap(
    accessToken: string,
    id: string,
    page: number,
    signal: CloudAbortSignal,
  ): Promise<CloudBootstrapPage>;

  authenticate(
    credentials: CloudCredentials,
    register: boolean,
    signal: CloudAbortSignal,
  ): Promise<CloudTokens>;
  refresh(refreshToken: string, signal: CloudAbortSignal): Promise<CloudTokens>;
  logout(accessToken: string, signal: CloudAbortSignal): Promise<void>;
  push(
    accessToken: string,
    batch: CloudBatch,
    signal: CloudAbortSignal,
  ): Promise<CloudResult>;
  pull(
    accessToken: string,
    cursor: string,
    signal: CloudAbortSignal,
  ): Promise<z.infer<typeof cloudPullSchema>>;
  conflicts(
    accessToken: string,
    signal: CloudAbortSignal,
  ): Promise<readonly CloudConflict[]>;
  resolve(
    accessToken: string,
    id: string,
    choice: 'local' | 'cloud',
    replacement: CloudBatch | undefined,
    signal: CloudAbortSignal,
  ): Promise<CloudResult>;
}
export interface CloudSecretStore {
  read(): Promise<CloudTokens | null>;
  write(tokens: CloudTokens): Promise<void>;
  remove(): Promise<void>;
}
export type CloudLocalState = Readonly<{
  deviceId: string;
  userId: string | null;
  cursor: string;
  pending: number;
  conflicts: number;
  projectionEnabled: boolean;
}>;
export interface CloudLocalStore {
  initialization(): Promise<{ id: string; page: number } | null>;
  stageBootstrap(page: CloudBootstrapPage): Promise<boolean>;

  state(): Promise<CloudLocalState>;
  owner(kind: SyncKind, id: string): Promise<string | null>;
  bind(userId: string, deviceId: string): Promise<void>;
  pending(): Promise<readonly CloudBatch[]>;
  acknowledge(batch: CloudBatch, result: CloudResult): Promise<void>;
  apply(commit: CloudCommit): Promise<boolean>;
  conflict(
    batch: CloudBatch,
    id: string,
    remote: readonly CloudEntity[],
  ): Promise<void>;
  conflicts(): Promise<readonly CloudConflict[]>;
  resolve(
    id: string,
    choice: 'local' | 'cloud',
    result: CloudResult,
  ): Promise<void>;
  projection(enabled: boolean): Promise<void>;
}
export type CloudSyncStatus =
  | 'local'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'authentication'
  | 'conflict'
  | 'failed';
/** A foreground-only orchestrator; all durable facts/receipts stay in LocalStore. */
export class CloudSyncService {
  #active = false;
  #generation = 0;
  #controller: CloudAbortController | null = null;
  #running: Promise<void> | null = null;
  #credentialWrite: Promise<void> | null = null;
  #dirty = false;
  #status: CloudSyncStatus = 'local';
  #listeners = new Set<() => void>();
  constructor(
    private readonly ports: Readonly<{
      api: CloudAPI;
      secrets: CloudSecretStore;
      local: CloudLocalStore;
      onImported?: () => void;
    }>,
  ) {}
  get status() {
    return this.#status;
  }
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  #set(status: CloudSyncStatus) {
    this.#status = status;
    for (const fn of this.#listeners) fn();
  }
  async authenticate(
    credentials: CloudCredentials,
    register: boolean,
  ): Promise<CloudTokens> {
    const signal = new CloudAbortController().signal;
    return cloudTokensSchema.parse(
      await this.ports.api.authenticate(credentials, register, signal),
    );
  }
  async connect(tokens: CloudTokens): Promise<void> {
    tokens = cloudTokensSchema.parse(tokens);
    await this.ports.local.bind(tokens.userId, tokens.deviceId);
    await this.ports.secrets.write(tokens);
    this.#set('idle');
    void this.wake();
  }
  async disconnect(): Promise<void> {
    await this.setActive(false);
    await this.#credentialWrite;
    const tokens = await this.ports.secrets.read();
    await this.ports.secrets.remove();
    if (tokens) {
      try {
        await this.ports.api.logout(
          tokens.accessToken,
          new CloudAbortController().signal,
        );
      } catch {
        /* Local revocation is durable; a network failure cannot restore credentials. */
      }
    }
    this.#set('local');
  }
  async setActive(active: boolean): Promise<void> {
    this.#active = active;
    if (!active) {
      this.#generation++;
      this.#controller?.abort();
      this.#running = null;
      this.#dirty = false;
      return;
    }
    void this.wake();
  }
  wake(): Promise<void> {
    this.#dirty = true;
    if (!this.#active) return Promise.resolve();
    if (this.#running) return this.#running;
    const generation = this.#generation;
    const running = this.#drain(generation).finally(() => {
      if (this.#running === running) this.#running = null;
      if (this.#dirty && this.#active && generation === this.#generation)
        void this.wake();
    });
    this.#running = running;
    return running;
  }
  async #drain(generation: number): Promise<void> {
    const controller = new CloudAbortController();
    this.#controller = controller;
    const current = () => {
      if (
        controller.signal.aborted ||
        generation !== this.#generation ||
        !this.#active
      )
        throw new CloudError('canceled');
    };
    try {
      let tokens = await this.ports.secrets.read();
      current();
      if (!tokens) {
        this.#dirty = false;
        this.#set('local');
        return;
      }
      this.#set('syncing');
      const call = async <T>(
        work: (token: string) => Promise<T>,
      ): Promise<T> => {
        try {
          return await work(tokens!.accessToken);
        } catch (error) {
          if (!(error instanceof CloudError) || error.code !== 'authentication')
            throw error;
          const refreshed = cloudTokensSchema.parse(
            await this.ports.api.refresh(
              tokens!.refreshToken,
              controller.signal,
            ),
          );
          current();
          if (
            refreshed.userId !== tokens!.userId ||
            refreshed.deviceId !== tokens!.deviceId
          )
            throw new CloudError('authentication');
          tokens = refreshed;
          const writing = this.ports.secrets.write(tokens);
          this.#credentialWrite = writing;
          try {
            await writing;
          } finally {
            if (this.#credentialWrite === writing) this.#credentialWrite = null;
          }
          current();
          return work(tokens.accessToken);
        }
      };
      while (this.#dirty) {
        this.#dirty = false;
        current();
        for (const batch of await this.ports.local.pending()) {
          current();
          if (
            !(await this.ports.local.pending()).some(
              (b) => b.batchId === batch.batchId,
            )
          )
            continue;
          const result = cloudResultSchema.parse(
            await call((token) =>
              this.ports.api.push(token, batch, controller.signal),
            ),
          );
          current();
          if (result.conflictId) {
            const remote = await call((token) =>
              this.ports.api.conflicts(token, controller.signal),
            );
            current();
            const detail = remote.find((c) => c.id === result.conflictId);
            await this.ports.local.conflict(
              batch,
              result.conflictId,
              detail?.remote ?? [],
            );
          } else await this.ports.local.acknowledge(batch, result);
        }
        let initialization = await this.ports.local.initialization();
        let initialized = true;
        while (initialization) {
          current();
          const page = cloudBootstrapPageSchema.parse(
            await call((token) =>
              this.ports.api.bootstrap(
                token,
                initialization!.id,
                initialization!.page,
                controller.signal,
              ),
            ),
          );
          current();
          if (!(await this.ports.local.stageBootstrap(page))) {
            initialized = false;
            break;
          }
          if (!page.hasMore) this.ports.onImported?.();
          initialization = await this.ports.local.initialization();
        }
        let more = initialized;
        while (more) {
          current();
          const state = await this.ports.local.state();
          const page = cloudPullSchema.parse(
            await call((token) =>
              this.ports.api.pull(token, state.cursor, controller.signal),
            ),
          );
          current();
          for (const commit of page.commits) {
            if (!(await this.ports.local.apply(commit))) {
              const pending = await this.ports.local.state();
              this.#dirty = pending.pending > 0 && pending.conflicts === 0;
              more = false;
              break;
            }
            this.ports.onImported?.();
          }
          if (more) more = page.hasMore;
        }
      }
      current();
      const state = await this.ports.local.state();
      this.#set(state.conflicts > 0 ? 'conflict' : 'idle');
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#dirty = false;
      if (error instanceof CloudError && error.code === 'canceled') return;
      this.#set(
        error instanceof CloudError
          ? error.code === 'authentication'
            ? 'authentication'
            : error.code === 'network'
              ? 'offline'
              : 'failed'
          : 'failed',
      );
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
  }
  async conflicts() {
    return this.ports.local.conflicts();
  }
  async resolve(id: string, choice: 'local' | 'cloud'): Promise<void> {
    await this.#running;
    const generation = this.#generation;
    const tokens = await this.ports.secrets.read();
    if (!tokens) throw new CloudError('authentication');
    const conflicts = await this.ports.local.conflicts();
    const conflict = conflicts.find((c) => c.id === id);
    if (!conflict) throw new CloudError('validation');
    const replacement =
      choice === 'local'
        ? {
            ...conflict.local,
            batchId: `resolve_${hashOperationParameters({ id, choice, remote: conflict.remote })}`,
            changes: conflict.local.changes.map((e) => ({
              ...e,
              version:
                conflict.remote.find(
                  (r) => r.kind === e.kind && r.key === e.key,
                )?.version ?? '0',
            })),
          }
        : undefined;
    const response = cloudResultSchema.parse(
      await this.ports.api.resolve(
        tokens.accessToken,
        id,
        choice,
        replacement,
        new CloudAbortController().signal,
      ),
    );
    if (generation !== this.#generation) throw new CloudError('canceled');
    if (response.conflictId) throw new CloudError('conflict');
    await this.ports.local.resolve(id, choice, response);
    this.ports.onImported?.();
    void this.wake();
  }
}

/** Enforced at the Application repository boundary, including Task terminal actions. */
export function withCloudOwnership(
  transaction: import('./ports').ApplicationTransaction,
  deviceId: string,
  owners: ReadonlyMap<string, string>,
): import('./ports').ApplicationTransaction {
  const guard = (kind: SyncKind, id: string) => {
    const owner = owners.get(`${kind}:${id}`);
    if (owner && owner !== deviceId) throw new CloudError('remote_active');
  };
  function wrap<T extends object>(
    target: T,
    before: (value: SyncDocument) => Promise<void>,
  ): T {
    return new Proxy(target, {
      get(object, key) {
        const original = Reflect.get(object, key) as unknown;
        if (typeof original !== 'function') return original;
        const fn = original as (...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          if (
            (key === 'update' || key === 'insert' || key === 'upsert') &&
            args[0] &&
            typeof args[0] === 'object'
          )
            await before(args[0] as SyncDocument);
          return fn.apply(object, args);
        };
      },
    });
  }
  return {
    ...transaction,
    executionSessions: wrap(transaction.executionSessions, async (v) =>
      guard('execution_session', String(v.id)),
    ),
    executionIntervals: wrap(transaction.executionIntervals, async (v) =>
      guard('execution_session', String(v.sessionId)),
    ),
    relaxSessions: wrap(transaction.relaxSessions, async (v) =>
      guard('relax_session', String(v.id)),
    ),
    tasks: wrap(transaction.tasks, async (v) => {
      if (v.status === 'completed' || v.status === 'canceled') {
        const active = await transaction.executionSessions.findActive();
        if (active && active.taskId === v.id)
          guard('execution_session', active.id);
      }
    }),
  };
}

/** Account changes are delegated to a host profile port, never to a Screen. */
export class CloudAccountService {
  #changing = false;
  constructor(
    readonly sync: CloudSyncService,
    readonly local: CloudLocalStore,
    private readonly ports: Readonly<{
      api: CloudAPI;
      installationId: () => Promise<string>;
      switchProfile: (tokens: CloudTokens) => Promise<void>;
      signOut: () => Promise<void>;
      projectionChanged?: (enabled: boolean) => void;
      prepareCredentialStorage?: () => Promise<void>;
    }>,
  ) {}
  async login(
    email: string,
    password: string,
    register: boolean,
  ): Promise<void> {
    if (this.#changing) throw new CloudError('validation');
    this.#changing = true;
    try {
      await this.ports.prepareCredentialStorage?.();
      const credentials = {
        email,
        password,
        installationId: await this.ports.installationId(),
        deviceName: 'Mobile device',
      };
      const tokens = await this.sync.authenticate(credentials, register);
      await this.ports.switchProfile(tokens);
    } finally {
      this.#changing = false;
    }
  }
  async logout(): Promise<void> {
    await this.sync.disconnect();
    await this.ports.signOut();
  }
  async setProjection(enabled: boolean): Promise<void> {
    await this.local.projection(enabled);
    this.ports.projectionChanged?.(enabled);
  }
  async canControl(kind: SyncKind, id: string): Promise<boolean> {
    const [state, owner] = await Promise.all([
      this.local.state(),
      this.local.owner(kind, id),
    ]);
    return owner === null || owner === state.deviceId;
  }
}

/** Referenced facts hold dependent transactions while a branch is unresolved. */
export function cloudEntityDependencies(
  entity: CloudEntity,
): readonly string[] {
  const refs: Partial<Record<SyncKind, Record<string, SyncKind>>> = {
    project: { goalId: 'goal' },
    task: { projectId: 'project', goalId: 'goal', parentTaskId: 'task' },
    time_block: { taskId: 'task' },
    execution_session: { taskId: 'task', timeBlockId: 'time_block' },
    execution_interval: { sessionId: 'execution_session' },
    completion_record: {
      taskId: 'task',
      sourceSessionId: 'execution_session',
      operationId: 'operation_provenance',
    },
    achievement: {
      sourceCompletionRecordId: 'completion_record',
      sourceTaskId: 'task',
      sourceExecutionSessionId: 'execution_session',
    },
    task_activity: {
      taskId: 'task',
      timeBlockId: 'time_block',
      operationId: 'operation_provenance',
    },
  };
  const out = Object.entries(refs[entity.kind] ?? {}).flatMap(
    ([field, kind]) =>
      typeof entity.value[field] === 'string'
        ? [`${kind}:${String(entity.value[field])}`]
        : [],
  );
  if (entity.kind === 'reflection' && Array.isArray(entity.value.wins))
    for (const win of entity.value.wins) {
      if (
        typeof win === 'object' &&
        win !== null &&
        'completionRecordId' in win
      )
        out.push(`completion_record:${String(win.completionRecordId)}`);
    }
  return out;
}

/** Validates a complete replicated graph before facts and cursor become visible. */
export function validateSyncGraph(entities: readonly CloudEntity[]): void {
  const byKey = new Map(entities.map((e) => [`${e.kind}:${e.key}`, e.value]));
  const invalid = () => {
    throw new CloudError('validation');
  };
  const completions = new Map<string, SyncDocument>();
  const achievements = new Set<string>();
  let active = 0;
  let relax = 0;
  for (const entity of entities) {
    const value = entity.value;
    for (const dependency of cloudEntityDependencies(entity))
      if (!byKey.has(dependency)) invalid();
    if (entity.kind === 'completion_record') {
      const task = byKey.get(`task:${String(value.taskId)}`);
      if (
        completions.has(String(value.taskId)) ||
        task?.status !== 'completed' ||
        task.completedAt !== value.completedAt
      )
        invalid();
      completions.set(String(value.taskId), value);
      if (value.sourceSessionId !== null) {
        const session = byKey.get(
          `execution_session:${String(value.sourceSessionId)}`,
        );
        if (
          session?.taskId !== value.taskId ||
          session?.status !== 'completed' ||
          session?.completionType !== 'complete_task'
        )
          invalid();
      }
    }
    if (entity.kind === 'achievement') {
      const completion = byKey.get(
        `completion_record:${String(value.sourceCompletionRecordId)}`,
      );
      if (
        achievements.has(String(value.sourceCompletionRecordId)) ||
        completion?.taskId !== value.sourceTaskId ||
        completion?.achievementDisposition !== 'record' ||
        completion?.sourceSessionId !== value.sourceExecutionSessionId
      )
        invalid();
      achievements.add(String(value.sourceCompletionRecordId));
    }
    if (entity.kind === 'execution_session') {
      const running = value.status === 'running' || value.status === 'paused';
      if (running) active++;
      if (
        value.timeBlockId !== null &&
        byKey.get(`time_block:${String(value.timeBlockId)}`)?.taskId !==
          value.taskId
      )
        invalid();
      const open = entities.filter(
        (e) =>
          e.kind === 'execution_interval' &&
          e.value.sessionId === value.id &&
          e.value.endAt === null,
      );
      if (
        running &&
        (open.length !== 1 ||
          open[0]?.value.kind !==
            (value.status === 'running' ? 'work' : 'pause') ||
          byKey.get(`task:${String(value.taskId)}`)?.status !== 'in_progress')
      )
        invalid();
      if (!running && open.length !== 0) invalid();
    }
    if (entity.kind === 'relax_session' && value.status === 'active') relax++;
    if (entity.kind === 'reflection')
      for (const win of value.wins as SyncDocument[]) {
        const completion = byKey.get(
          `completion_record:${String(win.completionRecordId)}`,
        );
        if (
          completion?.taskId !== win.taskId ||
          completion?.completedAt !== win.completedAt
        )
          invalid();
      }
    if (entity.kind === 'task') {
      const visited = new Set([value.id]);
      let parent = value.parentTaskId;
      while (parent !== null && parent !== undefined) {
        if (visited.has(parent)) invalid();
        visited.add(parent);
        parent = byKey.get(`task:${String(parent)}`)?.parentTaskId;
      }
    }
  }
  if (active > 1 || relax > 1) invalid();
  for (const entity of entities)
    if (
      entity.kind === 'task' &&
      entity.value.status === 'completed' &&
      !completions.has(entity.key)
    )
      invalid();
}
