import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from '../../server/contracts/fixtures.json';
import { afterEach, describe, it, expect } from 'vitest';
import {
  createSqliteApplicationUnitOfWork,
  SqliteCloudLocalStore,
  databaseMigrations,
  migrateDatabase,
  cloudSyncMigration,
  SqliteCloudProfileCatalog,
  cloudSyncSql,
  portableSnapshot,
} from '@workspace/database';
import { TaskService, cloudBatchSchema } from '@workspace/application';
import {
  parseInstant,
  parseLocalDate,
  parseTimeZoneId,
} from '@workspace/domain';
import { createNodeSqliteDatabase } from './database-test-support';
const natives: DatabaseSync[] = [];
afterEach(() => {
  for (const d of natives.splice(0)) d.close();
});
async function setup(legacy = false) {
  const native = new DatabaseSync(':memory:');
  natives.push(native);
  const db = createNodeSqliteDatabase(native);
  await migrateDatabase(
    db,
    legacy ? { migrations: databaseMigrations.slice(0, 9) } : {},
  );
  const unitOfWork = createSqliteApplicationUnitOfWork(db);
  let counter = 0;
  const ids = { generate: () => `cloud_test_${++counter}` };
  const clock = { now: () => parseInstant('2026-10-25T10:00:00.000Z') };
  const localTimeProvider = {
    resolve: () => ({
      localDate: parseLocalDate('2026-10-25'),
      timeZone: parseTimeZoneId('Asia/Singapore'),
    }),
  };
  const tasks = new TaskService({
    unitOfWork,
    clock,
    localTimeProvider,
    idGenerator: ids,
  });
  return {
    native,
    db,
    unitOfWork,
    ids,
    clock,
    localTimeProvider,
    tasks,
    local: new SqliteCloudLocalStore(db),
    context: () => ({
      operationId: `op_${++counter}`,
      authority: { kind: 'user' as const },
    }),
  };
}
describe('cloud SQLite boundary', () => {
  it('keeps the new migration digest and preserves existing completion/achievement references', async () => {
    const s = await setup(true);
    const task = await s.tasks.create(
      { title: 'Legacy completion' },
      s.context(),
    );
    await s.tasks.complete(
      { taskId: task.task.id, recordAchievement: true },
      s.context(),
    );
    const before = s.native.prepare('SELECT * FROM completion_records').all();
    const history = s.native.prepare('SELECT * FROM __nexta_migrations').all();
    const sql = (
      await readFile(
        new URL(
          '../../packages/database/drizzle/0009_cloud_sync.sql',
          import.meta.url,
        ),
        'utf8',
      )
    ).trim();
    expect(cloudSyncSql).toBe(sql);
    expect(cloudSyncMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(sql).digest('hex')}`,
    );
    await migrateDatabase(s.db);
    expect(s.native.prepare('SELECT * FROM completion_records').all()).toEqual(
      before,
    );
    expect(
      s.native
        .prepare('SELECT * FROM __nexta_migrations WHERE sequence<=9')
        .all(),
    ).toEqual(history);
    expect(s.native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      s.native.prepare('SELECT count(*) n FROM operation_provenance').get(),
    ).toEqual({ n: 2 });
    expect(
      s.native.prepare('SELECT count(*) n FROM achievements').get(),
    ).toEqual({ n: 1 });
  });
  it('claims existing guest facts once, isolates accounts, and never uploads local receipts', async () => {
    const s = await setup();
    await s.tasks.create({ title: 'Guest fact' }, s.context());
    expect(await s.local.pending()).toEqual([]);
    await s.local.bind('user_one', 'device_one');
    const batches = await s.local.pending();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.changes.some((e) => e.kind === 'task')).toBe(true);
    expect(JSON.stringify(batches)).not.toContain('resultJson');
    expect(JSON.stringify(batches)).not.toContain('parameterHash');
    await s.local.bind('user_one', 'device_one');
    expect(await s.local.pending()).toHaveLength(1);
    await expect(s.local.bind('user_two', 'other_device')).rejects.toThrow();
  });
  it('rolls back captured outbox writes with a failing business transaction', async () => {
    const s = await setup();
    await s.local.bind('user_one', 'device_one');
    await expect(
      s.unitOfWork.transaction(async (tx) => {
        await tx.goals.insert({
          id: 'g1' as never,
          title: 'rollback',
          description: '',
          status: 'active',
          targetDate: null,
          createdAt: s.clock.now(),
          updatedAt: s.clock.now(),
          archivedAt: null,
        });
        throw new Error('late failure');
      }),
    ).rejects.toThrow('late failure');
    expect(s.native.prepare('SELECT count(*) n FROM goals').get()).toEqual({
      n: 0,
    });
    expect(await s.local.pending()).toEqual([]);
  });
  it('imports a portable graph atomically, invalidates local versions, and never echoes it', async () => {
    const a = await setup();
    const task = await a.tasks.create({ title: 'Remote fact' }, a.context());
    const facts = await a.db.transaction(portableSnapshot);
    const b = await setup();
    await b.local.bind('user_b', 'device_b');
    const entities = facts.map((e) => ({
      ...e,
      version: '1',
      ownerDeviceId: 'device_a',
    }));
    expect(
      await b.local.apply({ revision: '1', batchId: 'remote_batch', entities }),
    ).toBe(true);
    expect((await b.tasks.get(task.task.id)).title).toBe('Remote fact');
    expect(await b.local.pending()).toEqual([]);
    expect(
      b.native.prepare('SELECT state_version FROM schedule_state').get(),
    ).toEqual({ state_version: 1 });
    expect(
      b.native.prepare('SELECT count(*) n FROM operation_records').get(),
    ).toEqual({ n: 0 });
    expect(
      await b.local.apply({ revision: '1', batchId: 'remote_batch', entities }),
    ).toBe(true);
    expect(
      b.native.prepare('SELECT state_version FROM schedule_state').get(),
    ).toEqual({ state_version: 1 });
  });
  it('rejects a malformed reference graph without advancing the cursor or partial imports', async () => {
    const a = await setup();
    await a.tasks.create({ title: 'dangling' }, a.context());
    const facts = await a.db.transaction(portableSnapshot);
    const task = facts.find((e) => e.kind === 'task')!;
    const b = await setup();
    await b.local.bind('user_b', 'device_b');
    await expect(
      b.local.apply({
        revision: '1',
        batchId: 'bad_remote',
        entities: [
          {
            ...task,
            version: '1',
            value: { ...task.value, goalId: 'missing_goal' },
          },
        ],
      }),
    ).rejects.toBeDefined();
    expect((await b.local.state()).cursor).toBe('0');
    expect(b.native.prepare('SELECT count(*) n FROM tasks').get()).toEqual({
      n: 0,
    });
  });
  it('retains transaction boundaries and increments expected versions for pending updates', async () => {
    const s = await setup();
    await s.local.bind('user_one', 'device_one');
    const task = await s.tasks.create({ title: 'First' }, s.context());
    await s.tasks.update(
      { taskId: task.task.id, patch: { title: 'Second' } },
      s.context(),
    );
    const batches = await s.local.pending();
    expect(batches).toHaveLength(2);
    expect(batches[0]?.changes.find((e) => e.kind === 'task')?.version).toBe(
      '0',
    );
    expect(batches[1]?.changes.find((e) => e.kind === 'task')?.version).toBe(
      '1',
    );
    for (const b of batches) expect(cloudBatchSchema.parse(b)).toEqual(b);
  });
});

describe('non-secret cloud profile catalog', () => {
  it('opens without SecureStore, persists metadata, and leaves credentials outside SQLite', async () => {
    const s = await setup();
    const catalog = new SqliteCloudProfileCatalog(s.db);
    expect(await catalog.read()).toBeNull();
    const value = JSON.stringify({
      active: 'profile_one',
      guestClaimed: true,
      profiles: {
        profile_one: {
          userId: 'user_one',
          baseURL: 'https://example.test',
          databaseName: 'account_one.sqlite',
          email: 'test@example.test',
        },
      },
    });
    await catalog.write(value);
    expect(await new SqliteCloudProfileCatalog(s.db).read()).toBe(value);
    expect(
      s.native
        .prepare('PRAGMA table_info(cloud_profile_catalog)')
        .all()
        .map((r) => r.name),
    ).toEqual(['id', 'value_json']);
  });
});

it('stages a fixed snapshot across database reopen and only publishes the complete graph', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-snapshot-'));
  const file = join(directory, 'client.sqlite');
  let native = new DatabaseSync(file);
  try {
    let db = createNodeSqliteDatabase(native);
    await migrateDatabase(db);
    let local = new SqliteCloudLocalStore(db);
    await local.bind('snapshot_user', 'snapshot_device');
    const entities = cloudBatchSchema.parse(fixture).changes.map((e) => ({
      ...e,
      version: '1',
      ownerDeviceId: 'remote_device',
    }));
    expect(await local.initialization()).toEqual({ id: '', page: 0 });
    await local.stageBootstrap({
      id: 'fixed_snapshot',
      revision: '12',
      page: 0,
      entities: entities.slice(0, 7),
      hasMore: true,
    });
    expect(native.prepare('SELECT count(*) n FROM tasks').get()).toEqual({
      n: 0,
    });
    expect((await local.state()).cursor).toBe('0');
    native.close();
    native = new DatabaseSync(file);
    db = createNodeSqliteDatabase(native);
    await migrateDatabase(db);
    local = new SqliteCloudLocalStore(db);
    expect(await local.initialization()).toEqual({
      id: 'fixed_snapshot',
      page: 1,
    });
    await expect(
      local.stageBootstrap({
        id: 'changed_snapshot',
        revision: '13',
        page: 1,
        entities: entities.slice(7),
        hasMore: false,
      }),
    ).rejects.toThrow('Snapshot changed');
    expect(
      native.prepare('SELECT count(*) n FROM completion_records').get(),
    ).toEqual({ n: 0 });
    await local.stageBootstrap({
      id: 'fixed_snapshot',
      revision: '12',
      page: 1,
      entities: entities.slice(7),
      hasMore: false,
    });
    expect(await local.initialization()).toBeNull();
    expect((await local.state()).cursor).toBe('12');
    expect(
      native.prepare('SELECT count(*) n FROM completion_records').get(),
    ).toEqual({ n: 1 });
    expect(native.prepare('SELECT count(*) n FROM achievements').get()).toEqual(
      { n: 1 },
    );
    expect(native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(await local.pending()).toEqual([]);
  } finally {
    native.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects a shape-valid completed task without its completion evidence atomically', async () => {
  const s = await setup();
  await s.local.bind('evidence_user', 'evidence_device');
  const task = cloudBatchSchema
    .parse(fixture)
    .changes.find((e) => e.kind === 'task')!;
  const entities = cloudBatchSchema
    .parse(fixture)
    .changes.filter((e) =>
      ['operation_provenance', 'goal', 'project'].includes(e.kind),
    );
  await expect(
    s.local.apply({
      batchId: 'missing_evidence',
      revision: '1',
      entities: [...entities, task].map((e) => ({
        ...e,
        version: '1',
        ownerDeviceId: 'origin',
      })),
    }),
  ).rejects.toBeDefined();
  expect((await s.local.state()).cursor).toBe('0');
  expect(s.native.prepare('SELECT count(*) n FROM tasks').get()).toEqual({
    n: 0,
  });
});
