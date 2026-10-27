import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TaskService,
  ExecutionService,
  CloudSyncService,
  type CloudTokens,
  type CloudSecretStore,
  type WriteContext,
  cloudBatchSchema,
} from '@workspace/application';
import {
  initializeSqliteApplicationUnitOfWork,
  SqliteCloudLocalStore,
  createSqliteApplicationUnitOfWork,
} from '@workspace/database';
import {
  parseInstant,
  parseLocalDate,
  parseTimeZoneId,
} from '@workspace/domain';
import { createNodeSqliteDatabase } from '../integration/database-test-support';
import fixture from '../../server/contracts/fixtures.json';
import { HttpCloudAPI } from '../../apps/mobile/src/runtime/cloud-api';
Object.defineProperty(globalThis, '__DEV__', {
  value: true,
  configurable: true,
});
const baseURL = process.env.CLOUD_TEST_URL;
if (!baseURL)
  throw new Error(
    'CLOUD_TEST_URL is required; run the local Kratos/PostgreSQL service first.',
  );
const native: DatabaseSync[] = [];
afterEach(() => {
  for (const db of native.splice(0)) db.close();
});
async function client(tokens: CloudTokens, bind = true) {
  const db = new DatabaseSync(':memory:');
  native.push(db);
  const database = createNodeSqliteDatabase(db);
  await initializeSqliteApplicationUnitOfWork(database);
  const local = new SqliteCloudLocalStore(database);
  if (bind) await local.bind(tokens.userId, tokens.deviceId);
  const unitOfWork = createSqliteApplicationUnitOfWork(database);
  let stored: CloudTokens | null = tokens;
  const secrets: CloudSecretStore = {
    read: () => Promise.resolve(stored),
    write: (t) => {
      stored = t;
      return Promise.resolve();
    },
    remove: () => {
      stored = null;
      return Promise.resolve();
    },
  };
  const api = new HttpCloudAPI(baseURL!);
  const sync = new CloudSyncService({ api, secrets, local });
  let now = '2026-10-25T10:00:00.000Z';
  const clock = { now: () => parseInstant(now) };
  const ids = { generate: () => `test_${randomUUID()}` };
  const localTimeProvider = {
    resolve: () => ({
      localDate: parseLocalDate('2026-10-25'),
      timeZone: parseTimeZoneId('Asia/Singapore'),
    }),
  };
  return {
    db,
    local,
    sync,
    api,
    unitOfWork,
    tokens,
    tasks: new TaskService({
      unitOfWork,
      clock,
      localTimeProvider,
      idGenerator: ids,
    }),
    execution: new ExecutionService({
      unitOfWork,
      clock,
      localTimeProvider,
      ids: {
        session: ids,
        interval: ids,
        activity: ids,
        completionRecord: ids,
        achievement: ids,
        schedulePlan: ids,
        integrationJob: ids,
      },
    }),
    time: (value: string) => {
      now = value;
    },
  };
}
function context(): WriteContext {
  return {
    operationId: `test_op_${randomUUID()}`,
    authority: { kind: 'user' },
  };
}
async function pair() {
  const api = new HttpCloudAPI(baseURL!);
  const email = `${randomUUID()}@example.test`;
  const credentials = {
    email,
    password: 'correct horse battery staple',
    installationId: `install_${randomUUID()}`,
    deviceName: 'A',
  };
  const a = await api.authenticate(
    credentials,
    true,
    new AbortController().signal,
  );
  const b = await api.authenticate(
    {
      ...credentials,
      installationId: `install_${randomUUID()}`,
      deviceName: 'B',
    },
    false,
    new AbortController().signal,
  );
  return { a: await client(a), b: await client(b) };
}
async function push(c: Awaited<ReturnType<typeof client>>) {
  for (const batch of await c.local.pending()) {
    const result = await c.api.push(
      c.tokens.accessToken,
      batch,
      new AbortController().signal,
    );
    expect(result.conflictId).toBe('');
    await c.local.acknowledge(batch, result);
  }
}
async function pull(c: Awaited<ReturnType<typeof client>>) {
  let more = true;
  while (more) {
    const state = await c.local.state();
    const page = await c.api.pull(
      c.tokens.accessToken,
      state.cursor,
      new AbortController().signal,
    );
    for (const commit of page.commits)
      expect(await c.local.apply(commit)).toBe(true);
    more = page.hasMore;
  }
}
describe('real PostgreSQL / Kratos / two SQLite clients', () => {
  it('replicates completion evidence exactly once, keeps receipts local, and protects active ownership', async () => {
    const { a, b } = await pair();
    const task = await a.tasks.create(
      { title: 'Offline task', estimatedDurationMinutes: 30 },
      context(),
    );
    expect((await a.local.pending()).length).toBe(1);
    await push(a);
    await pull(b);
    expect(await b.tasks.get(task.task.id)).toEqual(task.task);
    expect((await b.local.pending()).length).toBe(0);
    expect(
      b.db.prepare('SELECT count(*) n FROM operation_records').get(),
    ).toEqual({ n: 0 });
    const start = await a.execution.start({ taskId: task.task.id }, context());
    await push(a);
    await pull(b);
    expect((await b.execution.getActive())?.session.id).toBe(start.session.id);
    await expect(
      b.execution.pause({ sessionId: start.session.id }, context()),
    ).rejects.toBeDefined();
    await expect(
      b.tasks.cancel({ taskId: task.task.id }, context()),
    ).rejects.toBeDefined();
    expect(await b.local.pending()).toEqual([]);
    a.time('2026-10-25T10:20:00.000Z');
    await a.execution.finish(
      {
        sessionId: start.session.id,
        outcome: 'complete_task',
        recordAchievement: true,
      },
      context(),
    );
    const pending = await a.local.pending();
    expect(
      pending[0]?.changes.some((e) => e.kind === 'completion_record'),
    ).toBe(true);
    await push(a);
    await pull(b);
    await pull(b);
    expect((await b.tasks.get(task.task.id)).status).toBe('completed');
    expect(
      b.db.prepare('SELECT count(*) n FROM completion_records').get(),
    ).toEqual({ n: 1 });
    expect(b.db.prepare('SELECT count(*) n FROM achievements').get()).toEqual({
      n: 1,
    });
    expect(b.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect((await b.local.pending()).length).toBe(0);
    const raw = JSON.stringify(pending);
    expect(raw).not.toContain('resultJson');
    expect(raw).not.toContain('externalCalendarEventId');
    expect(raw).not.toContain('planRevision');
    expect(raw).not.toContain('calendarId');
  });
  it('detects divergent offline writes and resolves mutable facts with a new version', async () => {
    const { a, b } = await pair();
    const task = await a.tasks.create({ title: 'Original' }, context());
    await push(a);
    await pull(b);
    await a.tasks.update(
      { taskId: task.task.id, patch: { title: 'From A' } },
      context(),
    );
    await b.tasks.update(
      { taskId: task.task.id, patch: { title: 'From B' } },
      context(),
    );
    await push(a);
    const batch = (await b.local.pending())[0]!;
    const result = await b.api.push(
      b.tokens.accessToken,
      batch,
      new AbortController().signal,
    );
    expect(result.conflictId).not.toBe('');
    const remote = await b.api.conflicts(
      b.tokens.accessToken,
      new AbortController().signal,
    );
    const conflict = remote.find((v) => v.id === result.conflictId)!;
    await b.local.conflict(batch, conflict.id, conflict.remote);
    expect((await b.local.state()).conflicts).toBe(1);
    await b.sync.resolve(conflict.id, 'local');
    expect((await b.local.state()).conflicts).toBe(0);
    await pull(a);
    expect((await a.tasks.get(task.task.id)).title).toBe('From B');
    expect((await b.local.conflicts())[0]?.status).toBe('local');
  });
  it('retains a cloud-selected local branch and survives replay without echo', async () => {
    const { a, b } = await pair();
    const task = await a.tasks.create({ title: 'Original' }, context());
    const unrelated = await a.tasks.create(
      { title: 'Shared independent task' },
      context(),
    );
    await push(a);
    await pull(b);
    await a.tasks.update(
      { taskId: task.task.id, patch: { title: 'Shared' } },
      context(),
    );
    await b.tasks.update(
      { taskId: task.task.id, patch: { title: 'Archived branch' } },
      context(),
    );
    await push(a);
    const batch = (await b.local.pending())[0]!;
    const result = await b.api.push(
      b.tokens.accessToken,
      batch,
      new AbortController().signal,
    );
    const conflict = (
      await b.api.conflicts(b.tokens.accessToken, new AbortController().signal)
    ).find((v) => v.id === result.conflictId)!;
    await b.local.conflict(batch, conflict.id, conflict.remote);
    await b.tasks.update(
      { taskId: unrelated.task.id, patch: { title: 'Independent local work' } },
      context(),
    );
    await b.sync.resolve(conflict.id, 'cloud');
    expect((await b.tasks.get(unrelated.task.id)).title).toBe(
      'Independent local work',
    );
    expect(
      (await b.local.pending()).some((batch) =>
        batch.changes.some((e) => e.key === unrelated.task.id),
      ),
    ).toBe(true);
    await pull(b);
    expect((await b.tasks.get(task.task.id)).title).toBe('Shared');
    expect(JSON.stringify(await b.local.conflicts())).toContain(
      'Archived branch',
    );
    expect(
      b.db
        .prepare(
          "SELECT count(*) n FROM cloud_sync_outbox WHERE status='archived'",
        )
        .get(),
    ).toEqual({ n: 1 });
    const stored = cloudBatchSchema.parse(JSON.parse(JSON.stringify(batch)));
    expect(stored.batchId).toBe(batch.batchId);
  });
});

it('resumes a staged guest upload after a lost final response without publishing a second batch', async () => {
  const { a } = await pair();
  const guest = await client(a.tokens, false);
  await guest.tasks.create({ title: 'Existing offline guest data' }, context());
  expect(await guest.local.pending()).toEqual([]);
  await guest.local.bind(a.tokens.userId, a.tokens.deviceId);
  const batch = (await guest.local.pending())[0]!;
  expect(batch.batchId.startsWith('initial_')).toBe(true);
  const first = await guest.api.push(
    guest.tokens.accessToken,
    batch,
    new AbortController().signal,
  );
  expect(first.conflictId).toBe('');
  const restarted = new HttpCloudAPI(baseURL!);
  const replay = await restarted.push(
    guest.tokens.accessToken,
    batch,
    new AbortController().signal,
  );
  expect(replay).toEqual(first);
  await guest.local.acknowledge(batch, replay);
  expect(await guest.local.pending()).toEqual([]);
});

it('resumes a paged fixed snapshot then pulls commits made during initialization', async () => {
  const { a, b } = await pair();
  const goal = fixture.changes.find((e) => e.kind === 'goal')!;
  const goals = Array.from({ length: 300 }, (_, index) => ({
    ...goal,
    key: `paged_goal_${index}`,
    value: { ...goal.value, id: `paged_goal_${index}` },
  }));
  const batch = cloudBatchSchema.parse({
    ...fixture,
    batchId: `snapshot_${randomUUID()}`,
    changes: [...fixture.changes, ...goals],
  });
  const first = await a.api.push(
    a.tokens.accessToken,
    batch,
    new AbortController().signal,
  );
  expect(first.conflictId).toBe('');
  const page = await b.api.bootstrap(
    b.tokens.accessToken,
    '',
    0,
    new AbortController().signal,
  );
  expect(page.hasMore).toBe(true);
  await b.local.stageBootstrap(page);
  expect(b.db.prepare('SELECT count(*) n FROM tasks').get()).toEqual({ n: 0 });
  expect((await b.local.state()).cursor).toBe('0');
  const later = cloudBatchSchema.parse({
    schemaVersion: 1,
    batchId: `later_${randomUUID()}`,
    changes: [
      {
        ...goal,
        key: 'later_goal',
        value: { ...goal.value, id: 'later_goal' },
      },
    ],
  });
  await a.api.push(a.tokens.accessToken, later, new AbortController().signal);
  await b.sync.setActive(true);
  await b.sync.wake();
  await b.sync.setActive(false);
  expect(b.sync.status).toBe('idle');
  expect(await b.local.initialization()).toBeNull();
  expect((await b.local.state()).cursor).toBe('2');
  expect(b.db.prepare('SELECT count(*) n FROM goals').get()).toEqual({
    n: 302,
  });
  expect(
    b.db.prepare('SELECT count(*) n FROM completion_records').get(),
  ).toEqual({ n: 1 });
  expect(await b.local.pending()).toEqual([]);
});

it('keeps concurrent active evidence and dependent completion in a read-only branch when cloud mainline is chosen', async () => {
  const { a, b } = await pair();
  const first = await a.tasks.create({ title: 'A task' }, context());
  const second = await b.tasks.create({ title: 'B task' }, context());
  await push(a);
  await push(b);
  await pull(a);
  await pull(b);
  await a.execution.start({ taskId: first.task.id }, context());
  const localSession = await b.execution.start(
    { taskId: second.task.id },
    context(),
  );
  await push(a);
  const batch = (await b.local.pending())[0]!;
  const rejected = await b.api.push(
    b.tokens.accessToken,
    batch,
    new AbortController().signal,
  );
  expect(rejected.conflictId).not.toBe('');
  const conflicts = await b.api.conflicts(
    b.tokens.accessToken,
    new AbortController().signal,
  );
  const conflict = conflicts.find((c) => c.id === rejected.conflictId)!;
  await b.local.conflict(batch, conflict.id, conflict.remote);
  b.time('2026-10-25T10:20:00.000Z');
  await b.execution.finish(
    {
      sessionId: localSession.session.id,
      outcome: 'complete_task',
      recordAchievement: true,
    },
    context(),
  );
  expect(await b.local.pending()).toEqual([]);
  await b.sync.resolve(conflict.id, 'cloud');
  expect((await b.execution.getActive())?.session.taskId).toBe(first.task.id);
  expect(
    b.db.prepare('SELECT count(*) n FROM completion_records').get(),
  ).toEqual({ n: 0 });
  expect(b.db.prepare('SELECT count(*) n FROM achievements').get()).toEqual({
    n: 0,
  });
  const archive = await b.local.conflicts();
  expect(
    archive.some((c) =>
      c.local.changes.some((e) => e.kind === 'completion_record'),
    ),
  ).toBe(true);
  expect(b.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('requires explicit choice for offline completion versus cancellation and preserves unique shared evidence', async () => {
  const { a, b } = await pair();
  const task = await a.tasks.create({ title: 'Terminal conflict' }, context());
  await push(a);
  await pull(b);
  await a.tasks.complete(
    { taskId: task.task.id, recordAchievement: true },
    context(),
  );
  await b.tasks.cancel({ taskId: task.task.id }, context());
  await push(a);
  const batch = (await b.local.pending())[0]!;
  const rejected = await b.api.push(
    b.tokens.accessToken,
    batch,
    new AbortController().signal,
  );
  expect(rejected.conflictId).not.toBe('');
  const detail = (
    await b.api.conflicts(b.tokens.accessToken, new AbortController().signal)
  ).find((c) => c.id === rejected.conflictId)!;
  await b.local.conflict(batch, detail.id, detail.remote);
  await b.sync.resolve(detail.id, 'cloud');
  expect((await b.tasks.get(task.task.id)).status).toBe('completed');
  await pull(b);
  await pull(b);
  expect(
    b.db.prepare('SELECT count(*) n FROM completion_records').get(),
  ).toEqual({ n: 1 });
  expect(b.db.prepare('SELECT count(*) n FROM achievements').get()).toEqual({
    n: 1,
  });
});
