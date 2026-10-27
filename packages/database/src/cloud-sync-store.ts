import {
  cloudBatchSchema,
  cloudBootstrapPageSchema,
  type CloudBootstrapPage,
  cloudEntityDependencies,
  cloudEntitySchema,
  cloudConflictSchema,
  portableFact,
  portablePreferenceKeys,
  syncEntityKey,
  validateSyncDocument,
  validateSyncGraph,
  withCloudOwnership,
  hashOperationParameters,
  type ApplicationTransaction,
  type CloudBatch,
  type CloudCommit,
  type CloudConflict,
  type CloudEntity,
  type CloudLocalState,
  type CloudLocalStore,
  type CloudResult,
  type SyncDocument,
  type SyncKind,
} from '@workspace/application';
import {
  createCommittedSchedulePlan,
  createIntegrationJob,
  createOperationRecord,
  parseInstant,
  parseOperationId,
  parseIntegrationJobId,
  parseSchedulePlanId,
  parseTimeZoneId,
} from '@workspace/domain';
import { syncEntityFields } from '@workspace/application';
import { createSqliteApplicationTransaction } from './repositories';
import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteBindableValue,
} from './sqlite';

type StateRow = {
  device_id: string;
  user_id: string | null;
  cursor: string;
  projection_enabled: number;
};
type VersionRow = {
  entity_key: string;
  version: string;
  owner_device_id: string;
  value_json: string;
};
type OutboxRow = {
  batch_id: string;
  payload_json: string;
  status: string;
  conflict_id: string | null;
};
const zBootstrapEntities = (raw: string): CloudEntity[] => {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Invalid snapshot stage.');
  return value.map((e) => cloudEntitySchema.parse(e));
};
const column = (field: string) =>
  field === 'wins'
    ? 'wins_json'
    : field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function fromRow(kind: SyncKind, row: Record<string, unknown>): SyncDocument {
  const out: SyncDocument = {};
  for (const f of Object.keys(syncEntityFields[kind].fields)) {
    const v = row[column(f)];
    out[f] =
      (syncEntityFields[kind].fields as Record<string, { type: string }>)[f]
        ?.type === 'json' && typeof v === 'string'
        ? (JSON.parse(v) as unknown)
        : typeof v === 'number' &&
            (syncEntityFields[kind].fields as Record<string, { type: string }>)[
              f
            ]?.type === 'boolean'
          ? v === 1
          : v;
  }
  return out;
}
function encode(value: unknown): SqliteBindableValue {
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return JSON.stringify(value);
}
const identity = (e: Pick<CloudEntity, 'kind' | 'key'>) => `${e.kind}:${e.key}`;
const rowId = () =>
  `cloud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
export async function ensureCloudState(
  tx: SqliteExecutor,
  deviceId = rowId(),
): Promise<StateRow> {
  await tx.run(
    'INSERT OR IGNORE INTO cloud_sync_state(id,device_id) VALUES(1,?)',
    [deviceId],
  );
  return (await tx.get<StateRow>('SELECT * FROM cloud_sync_state WHERE id=1'))!;
}
async function versions(tx: SqliteExecutor) {
  return new Map(
    (await tx.all<VersionRow>('SELECT * FROM cloud_sync_versions')).map((v) => [
      v.entity_key,
      v,
    ]),
  );
}
export async function portableSnapshot(
  tx: SqliteExecutor,
): Promise<CloudEntity[]> {
  const state = await ensureCloudState(tx);
  const known = await versions(tx);
  const out: CloudEntity[] = [];
  for (const kind of Object.keys(syncEntityFields) as SyncKind[]) {
    const table = syncEntityFields[kind].table;
    const rows = await tx.all<Record<string, unknown>>(
      `SELECT * FROM ${table}`,
    );
    for (const row of rows) {
      const value = fromRow(kind, row);
      if (
        kind === 'preference' &&
        !(portablePreferenceKeys as readonly unknown[]).includes(value.key)
      )
        continue;
      const key = syncEntityKey(kind, value);
      validateSyncDocument(kind, value, key);
      const version = known.get(`${kind}:${key}`);
      out.push({
        kind,
        key,
        version: version?.version ?? '0',
        ownerDeviceId: version?.owner_device_id ?? state.device_id,
        value,
      });
    }
  }
  return out;
}
/** Wraps local Repository writes; outbox append shares the business transaction. */
export async function captureCloudTransaction<T>(
  tx: SqliteExecutor,
  work: (transaction: ApplicationTransaction) => Promise<T>,
  onChanged?: () => void,
): Promise<T> {
  const state = await ensureCloudState(tx);
  const known = await versions(tx);
  const owners = new Map([...known].map(([k, v]) => [k, v.owner_device_id]));
  const base = withCloudOwnership(
    createSqliteApplicationTransaction(tx),
    state.device_id,
    owners,
  );
  const changes = new Map<string, CloudEntity>();
  const plans: SyncDocument[] = [];
  const mapping: Partial<Record<keyof ApplicationTransaction, SyncKind>> = {
    goals: 'goal',
    projects: 'project',
    tasks: 'task',
    timeBlocks: 'time_block',
    executionSessions: 'execution_session',
    executionIntervals: 'execution_interval',
    completionRecords: 'completion_record',
    achievements: 'achievement',
    taskActivityEvents: 'task_activity',
    dailyReflections: 'reflection',
    energyCheckIns: 'energy_check_in',
    relaxSessions: 'relax_session',
    userPreferences: 'preference',
    operationRecords: 'operation_provenance',
  };
  const originalPlans = base.schedulePlans;
  const planRepository = new Proxy(originalPlans, {
    get(object, key) {
      const fn = Reflect.get(object, key) as unknown;
      if (typeof fn !== 'function') return fn;
      return async (...args: unknown[]) => {
        const result = await (
          fn as (...a: unknown[]) => Promise<unknown>
        ).apply(object, args);
        if (key === 'insert') plans.push(args[0] as SyncDocument);
        return result;
      };
    },
  });
  const wrapped = { ...base, schedulePlans: planRepository };
  for (const [repo, kind] of Object.entries(mapping) as [
    keyof ApplicationTransaction,
    SyncKind,
  ][]) {
    const target = base[repo];
    const proxy = new Proxy(target, {
      get(object, key) {
        const original = Reflect.get(object, key) as unknown;
        if (typeof original !== 'function') return original;
        const fn = original as (...args: unknown[]) => Promise<unknown>;
        return async (...args: unknown[]) => {
          const mutating =
            key === 'insert' || key === 'update' || key === 'upsert';
          let portable: SyncDocument | null = null;
          if (mutating && args[0] && typeof args[0] === 'object') {
            const value = args[0] as SyncDocument;
            portable =
              kind === 'operation_provenance'
                ? {
                    id: value.operationId,
                    command: value.command,
                    occurredAt: value.occurredAt,
                  }
                : portableFact(kind, value);
            if (
              kind === 'preference' &&
              !(portablePreferenceKeys as readonly unknown[]).includes(
                portable.key,
              )
            )
              portable = null;
            if (kind === 'operation_provenance' && portable) {
              await tx.run(
                'INSERT OR IGNORE INTO operation_provenance(id,command,occurred_at,device_id) VALUES(?,?,?,?)',
                [
                  String(portable.id),
                  String(portable.command),
                  String(portable.occurredAt),
                  state.device_id,
                ],
              );
            }
          }
          const result = await fn.apply(object, args);
          if (portable) {
            const key = syncEntityKey(kind, portable);
            validateSyncDocument(kind, portable, key);
            const id = `${kind}:${key}`;
            const old = known.get(id);
            if (
              !old ||
              hashOperationParameters(portable) !==
                hashOperationParameters(JSON.parse(old.value_json))
            ) {
              changes.set(id, {
                kind,
                key,
                version: old?.version ?? '0',
                ownerDeviceId: old?.owner_device_id ?? state.device_id,
                value: portable,
              });
            }
          }
          return result;
        };
      },
    });
    Object.assign(wrapped, { [repo]: proxy });
  }
  const result = await work(wrapped);
  for (const plan of plans) {
    const blocks = await tx.all<{ id: string }>(
      'SELECT id FROM time_blocks WHERE plan_revision=?',
      [Number(plan.planRevision)],
    );
    const value = {
      id: String(plan.id),
      originDeviceId: state.device_id,
      sourceRevision: Number(plan.planRevision),
      committedAt: String(plan.committedAt),
      schedulerVersion: String(plan.schedulerVersion),
      policyVersion: String(plan.policyVersion),
      timeZone: String(plan.timeZone),
      reason: String(plan.reason),
      affectedBlockIds: blocks.map((b) => b.id),
    };
    const fields = Object.keys(value);
    await tx.run(
      `INSERT INTO cloud_plan_origins (${fields.map(column).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
      fields.map((f) => encode((value as SyncDocument)[f])),
    );
    const old = known.get(`plan_origin:${value.id}`);
    changes.set(`plan_origin:${value.id}`, {
      kind: 'plan_origin',
      key: value.id,
      version: old?.version ?? '0',
      ownerDeviceId: state.device_id,
      value,
    });
  }
  if (changes.size && state.user_id) {
    const pending = await tx.all<OutboxRow>(
      "SELECT * FROM cloud_sync_outbox WHERE status<>'archived' ORDER BY sequence",
    );
    for (const row of pending) {
      const b = cloudBatchSchema.parse(JSON.parse(row.payload_json));
      for (const e of b.changes) {
        const next = changes.get(identity(e));
        if (next) next.version = (BigInt(e.version) + 1n).toString();
      }
    }
    const batch: CloudBatch = {
      schemaVersion: 1,
      batchId: rowId(),
      changes: [...changes.values()],
    };
    await tx.run(
      'INSERT INTO cloud_sync_outbox(batch_id,payload_json) VALUES(?,?)',
      [batch.batchId, JSON.stringify(batch)],
    );
    onChanged?.();
  }
  return result;
}
export class SqliteCloudLocalStore implements CloudLocalStore {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly onWrite?: () => void,
  ) {}
  async owner(kind: SyncKind, id: string): Promise<string | null> {
    return this.db.transaction(
      async (tx) =>
        (
          await tx.get<{ owner_device_id: string }>(
            'SELECT owner_device_id FROM cloud_sync_versions WHERE entity_key=?',
            [`${kind}:${id}`],
          )
        )?.owner_device_id ?? null,
    );
  }
  async state(): Promise<CloudLocalState> {
    return this.db.transaction(async (tx) => {
      const s = await ensureCloudState(tx);
      const pending = await tx.get<{ n: number }>(
        "SELECT count(*) n FROM cloud_sync_outbox WHERE status='pending'",
      );
      const conflicts = await tx.get<{ n: number }>(
        "SELECT count(*) n FROM cloud_sync_conflicts WHERE status='open'",
      );
      return {
        deviceId: s.device_id,
        userId: s.user_id,
        cursor: s.cursor,
        projectionEnabled: s.projection_enabled === 1,
        pending: pending?.n ?? 0,
        conflicts: conflicts?.n ?? 0,
      };
    });
  }
  async bind(userId: string, deviceId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const s = await ensureCloudState(tx);
      if (s.user_id && s.user_id !== userId)
        throw new Error('Account-isolated database required.');
      if (s.user_id === userId && s.device_id === deviceId) return;
      const snapshot = await portableSnapshot(tx);
      if (!s.user_id) {
        const changes = snapshot.map((e) => ({
          ...e,
          ownerDeviceId: deviceId,
          version: '0',
        }));
        if (changes.length) {
          await tx.run(
            'INSERT INTO cloud_sync_outbox(batch_id,payload_json) VALUES(?,?)',
            [
              rowId(),
              JSON.stringify({
                schemaVersion: 1,
                batchId:
                  'initial_' +
                  hashOperationParameters({ userId, deviceId, changes }),
                changes,
              }),
            ],
          );
          /* batch_id is the wire identity, repaired below in the same transaction. */ await tx.run(
            "UPDATE cloud_sync_outbox SET batch_id=json_extract(payload_json,'$.batchId')",
          );
        }
      }
      await tx.run(
        'UPDATE cloud_sync_state SET user_id=?,device_id=? WHERE id=1',
        [userId, deviceId],
      );
      await tx.run(
        "UPDATE operation_provenance SET device_id=? WHERE device_id='legacy'",
        [deviceId],
      );
    });
  }
  async pending(): Promise<readonly CloudBatch[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.all<OutboxRow>(
        "SELECT * FROM cloud_sync_outbox WHERE status<>'archived' ORDER BY sequence",
      );
      const blocked = new Set<string>();
      const out: CloudBatch[] = [];
      for (const r of rows) {
        const b = cloudBatchSchema.parse(JSON.parse(r.payload_json));
        if (
          r.status === 'conflict' ||
          b.changes.some(
            (e) =>
              blocked.has(identity(e)) ||
              cloudEntityDependencies(e).some((dep) => blocked.has(dep)),
          )
        ) {
          for (const e of b.changes) blocked.add(identity(e));
          continue;
        }
        out.push(b);
      }
      return out;
    });
  }
  async acknowledge(batch: CloudBatch, result: CloudResult): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const e of result.entities) await this.saveVersion(tx, e);
      await tx.run('DELETE FROM cloud_sync_outbox WHERE batch_id=?', [
        batch.batchId,
      ]);
    });
  }
  private async saveVersion(tx: SqliteExecutor, e: CloudEntity) {
    await tx.run(
      'INSERT INTO cloud_sync_versions(entity_key,version,owner_device_id,value_json) VALUES(?,?,?,?) ON CONFLICT(entity_key) DO UPDATE SET version=excluded.version,owner_device_id=excluded.owner_device_id,value_json=excluded.value_json',
      [identity(e), e.version, e.ownerDeviceId, JSON.stringify(e.value)],
    );
  }
  async conflict(
    batch: CloudBatch,
    id: string,
    remote: readonly CloudEntity[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(
        "UPDATE cloud_sync_outbox SET status='conflict',conflict_id=? WHERE batch_id=?",
        [id, batch.batchId],
      );
      await tx.run(
        'INSERT OR IGNORE INTO cloud_sync_conflicts(id,local_json,remote_json) VALUES(?,?,?)',
        [id, JSON.stringify(batch), JSON.stringify(remote)],
      );
    });
  }
  async initialization(): Promise<{ id: string; page: number } | null> {
    return this.db.transaction(async (tx) => {
      const row = await tx.get<{
        remote_id: string;
        next_page: number;
        complete: number;
      }>(
        'SELECT remote_id,next_page,complete FROM cloud_sync_bootstrap WHERE id=1',
      );
      return row?.complete
        ? null
        : { id: row?.remote_id ?? '', page: row?.next_page ?? 0 };
    });
  }
  async stageBootstrap(input: CloudBootstrapPage): Promise<boolean> {
    const page = cloudBootstrapPageSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const row = await tx.get<{
        remote_id: string;
        revision: string;
        next_page: number;
        entities_json: string;
        complete: number;
      }>('SELECT * FROM cloud_sync_bootstrap WHERE id=1');
      if (row?.complete) return true;
      if (
        page.page !== (row?.next_page ?? 0) ||
        (row && (row.remote_id !== page.id || row.revision !== page.revision))
      )
        throw new Error('Snapshot changed.');
      const prior = row ? zBootstrapEntities(row.entities_json) : [];
      const entities = [...prior, ...page.entities];
      if (new Set(entities.map(identity)).size !== entities.length)
        throw new Error('Duplicate snapshot fact.');
      if (!page.hasMore) {
        if (
          !(await this.applyInTransaction(tx, {
            batchId: `snapshot_${page.id}`,
            revision: page.revision,
            entities,
          }))
        )
          return false;
        await tx.run(
          "INSERT INTO cloud_sync_bootstrap(id,remote_id,revision,next_page,entities_json,complete) VALUES(1,?,?,?,'[]',1) ON CONFLICT(id) DO UPDATE SET complete=1,entities_json='[]'",
          [page.id, page.revision, page.page + 1],
        );
      } else {
        await tx.run(
          'INSERT INTO cloud_sync_bootstrap(id,remote_id,revision,next_page,entities_json) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET next_page=excluded.next_page,entities_json=excluded.entities_json',
          [page.id, page.revision, page.page + 1, JSON.stringify(entities)],
        );
      }
      return true;
    });
  }
  async apply(commit: CloudCommit): Promise<boolean> {
    return this.db.transaction((tx) => this.applyInTransaction(tx, commit));
  }
  private async applyInTransaction(
    tx: SqliteExecutor,
    commit: CloudCommit,
  ): Promise<boolean> {
    const s = await ensureCloudState(tx);
    if (BigInt(commit.revision) <= BigInt(s.cursor)) return true;
    const known = await versions(tx);
    const incoming = commit.entities
      .map((e) => cloudEntitySchema.parse(e))
      .filter(
        (e) =>
          BigInt(e.version) > BigInt(known.get(identity(e))?.version ?? '0'),
      );
    const rows = await tx.all<OutboxRow>(
      "SELECT * FROM cloud_sync_outbox WHERE status<>'archived'",
    );
    const incomingKeys = new Set(incoming.map(identity));
    const collision = rows
      .map((r) => cloudBatchSchema.parse(JSON.parse(r.payload_json)))
      .find((b) => b.changes.some((e) => incomingKeys.has(identity(e))));
    if (collision) return false;
    await this.importFacts(tx, incoming);
    for (const e of incoming) await this.saveVersion(tx, e);
    await tx.run('UPDATE cloud_sync_state SET cursor=? WHERE id=1', [
      commit.revision,
    ]);
    return true;
  }
  private async importFacts(
    tx: SqliteExecutor,
    entities: readonly CloudEntity[],
  ) {
    if (!entities.length) return;
    await tx.run('PRAGMA defer_foreign_keys=ON');
    const transaction = createSqliteApplicationTransaction(tx);
    const base = await transaction.scheduleState.get();
    if (!base) throw new Error('Schedule state missing.');
    const timeBlocks = entities.filter((e) => e.kind === 'time_block');
    const state = {
      ...base,
      stateVersion: base.stateVersion + 1,
      planRevision: base.planRevision + (timeBlocks.length ? 1 : 0),
    };
    for (const e of entities) {
      validateSyncDocument(e.kind, e.value, e.key);
      const fields = syncEntityFields[e.kind].fields;
      const table = syncEntityFields[e.kind].table;
      const value = { ...e.value };
      const names = Object.keys(fields);
      if (e.kind === 'preference' || e.kind === 'reflection') {
        const where =
          e.kind === 'preference' ? 'key=?' : 'local_date=? AND time_zone=?';
        const params =
          e.kind === 'preference'
            ? [String(value.key)]
            : [String(value.localDate), String(value.timeZone)];
        const old = await tx.get<{ id: string }>(
          `SELECT id FROM ${table} WHERE ${where}`,
          params,
        );
        if (old) value.id = old.id;
      }
      if (e.kind === 'time_block') {
        names.push('planRevision', 'externalCalendarEventId');
        value.planRevision = state.planRevision;
        const old = await tx.get<{ external_calendar_event_id: string | null }>(
          'SELECT external_calendar_event_id FROM time_blocks WHERE id=?',
          [String(value.id)],
        );
        value.externalCalendarEventId = old?.external_calendar_event_id ?? null;
      }
      if (e.kind === 'operation_provenance') {
        names.push('deviceId');
        value.deviceId = e.ownerDeviceId;
      }
      const columns = names.map(column);
      await tx.run(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns
          .filter((c) => c !== 'id')
          .map((c) => `${c}=excluded.${c}`)
          .join(',')}`,
        names.map((n) => encode(value[n])),
      );
    }
    if ((await tx.all('PRAGMA foreign_key_check')).length)
      throw new Error('Invalid remote reference graph.');
    validateSyncGraph(await portableSnapshot(tx));
    await transaction.scheduleState.update(state);
    if (timeBlocks.length) {
      const now = parseInstant(new Date().toISOString());
      const operationId = parseOperationId(rowId());
      const planId = parseSchedulePlanId(rowId());
      const starts = timeBlocks.map((e) => Date.parse(String(e.value.startAt)));
      const ends = timeBlocks.map((e) => Date.parse(String(e.value.endAt)));
      const plan = createCommittedSchedulePlan({
        id: planId,
        planRevision: state.planRevision,
        basedOnStateVersion: base.stateVersion,
        createdAt: now,
        committedAt: now,
        inputHash: hashOperationParameters(entities),
        schedulerVersion: 'replication-v1',
        policyVersion: 'explicit-sync-v1',
        timeZone: parseTimeZoneId('UTC'),
        horizonStart: parseInstant(new Date(Math.min(...starts)).toISOString()),
        horizonEnd: parseInstant(new Date(Math.max(...ends)).toISOString()),
        reason: 'sync_pull',
      });
      await transaction.operationRecords.insert(
        createOperationRecord({
          operationId,
          command: 'sync.import',
          parameterHash: hashOperationParameters(entities),
          resultJson: JSON.stringify({ stateVersion: state.stateVersion }),
          currentStateVersion: state.stateVersion,
          occurredAt: now,
        }),
      );
      await transaction.schedulePlans.insert(plan);
      for (const channel of ['calendar', 'notification'] as const)
        await transaction.integrationJobs.insert(
          createIntegrationJob({
            id: parseIntegrationJobId(rowId()),
            operationId,
            targetChannel: channel,
            targetEntityType: 'schedule_plan',
            targetEntityId: planId,
            desiredRevision: state.planRevision,
            desiredAction: 'reconcile',
            createdAt: now,
          }),
        );
    }
    this.onWrite?.();
  }
  async conflicts(): Promise<readonly CloudConflict[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.all<{
        id: string;
        local_json: string;
        remote_json: string;
        status: string;
      }>('SELECT * FROM cloud_sync_conflicts ORDER BY id');
      const conflicts = rows.map((r) =>
        cloudConflictSchema.parse({
          id: r.id,
          batchId: (JSON.parse(r.local_json) as CloudBatch).batchId,
          local: JSON.parse(r.local_json),
          remote: JSON.parse(r.remote_json),
          status: r.status,
        }),
      );
      const archived = await tx.all<{ batch_id: string; payload_json: string }>(
        "SELECT o.batch_id,o.payload_json FROM cloud_sync_outbox o JOIN cloud_sync_conflicts c ON c.id=o.conflict_id WHERE o.status='archived' ORDER BY o.sequence",
      );
      for (const row of archived) {
        const batch = cloudBatchSchema.parse(JSON.parse(row.payload_json));
        if (conflicts.some((c) => c.batchId === batch.batchId)) continue;
        conflicts.push(
          cloudConflictSchema.parse({
            id: `archive_${row.batch_id}`,
            batchId: batch.batchId,
            status: 'cloud',
            local: batch,
            remote: [],
          }),
        );
      }
      return conflicts;
    });
  }
  async resolve(
    id: string,
    choice: 'local' | 'cloud',
    result: CloudResult,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const conflict = await tx.get<{ local_json: string }>(
        "SELECT local_json FROM cloud_sync_conflicts WHERE id=? AND status='open'",
        [id],
      );
      if (!conflict) throw new Error('Missing conflict.');
      const batch = cloudBatchSchema.parse(JSON.parse(conflict.local_json));
      await tx.run('PRAGMA defer_foreign_keys=ON');
      let accepted = result.entities;
      if (choice === 'cloud') {
        const all = await tx.all<OutboxRow>(
          "SELECT * FROM cloud_sync_outbox WHERE status<>'archived'",
        );
        let blocked = new Set(batch.changes.map(identity));
        for (const row of all) {
          const b = cloudBatchSchema.parse(JSON.parse(row.payload_json));
          if (
            b.changes.some(
              (e) =>
                blocked.has(identity(e)) ||
                cloudEntityDependencies(e).some((dep) => blocked.has(dep)),
            )
          ) {
            await tx.run(
              "UPDATE cloud_sync_outbox SET status='archived',conflict_id=? WHERE batch_id=?",
              [id, b.batchId],
            );
            for (const e of b.changes) blocked.add(identity(e));
          }
        }
        // Preserve original evidence in immutable outbox/archive; select cloud as the shared graph.
        const current = await portableSnapshot(tx);
        const cloudIDs = new Set(
          result.entities.map((e) => `${e.kind}:${String(e.value.id)}`),
        );
        for (const e of [...current].reverse()) {
          if (
            (blocked.has(identity(e)) ||
              cloudEntityDependencies(e).some((dep) => blocked.has(dep))) &&
            !cloudIDs.has(`${e.kind}:${String(e.value.id)}`)
          ) {
            await tx.run(
              `DELETE FROM ${syncEntityFields[e.kind].table} WHERE id=?`,
              [String(e.value.id)],
            );
          }
        }
        const remaining = await tx.all<OutboxRow>(
          "SELECT * FROM cloud_sync_outbox WHERE status<>'archived'",
        );
        const held = new Set(
          remaining.flatMap((row) =>
            cloudBatchSchema
              .parse(JSON.parse(row.payload_json))
              .changes.map(identity),
          ),
        );
        let changed = true;
        while (changed) {
          changed = false;
          for (const entity of result.entities) {
            if (
              !held.has(identity(entity)) &&
              cloudEntityDependencies(entity).some((key) => held.has(key))
            ) {
              held.add(identity(entity));
              changed = true;
            }
          }
        }
        accepted = result.entities.filter(
          (entity) => !held.has(identity(entity)),
        );
        await this.importFacts(tx, accepted);
      } else {
        await tx.run(
          "UPDATE cloud_sync_outbox SET status='archived' WHERE batch_id=?",
          [batch.batchId],
        );
      }
      for (const e of accepted) await this.saveVersion(tx, e);
      await tx.run('UPDATE cloud_sync_conflicts SET status=? WHERE id=?', [
        choice,
        id,
      ]);
    });
  }
  async projection(enabled: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      await ensureCloudState(tx);
      await tx.run(
        'UPDATE cloud_sync_state SET projection_enabled=? WHERE id=1',
        [enabled ? 1 : 0],
      );
      const transaction = createSqliteApplicationTransaction(tx);
      const state = await transaction.scheduleState.get();
      if (state) {
        const now = parseInstant(new Date().toISOString());
        for (const channel of ['calendar', 'notification'] as const)
          await transaction.integrationJobs.requeueLatestProjection({
            channel,
            desiredRevision: state.planRevision,
            requeuedAt: now,
            notBefore: now,
          });
      }
    });
  }
}
