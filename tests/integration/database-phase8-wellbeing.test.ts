import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
  createSqliteApplicationUnitOfWork,
  databaseMigrations,
  initializeSqliteApplicationUnitOfWork,
  migrateDatabase,
  phase8WellbeingMigration,
  phase8WellbeingSql,
  type SqliteDatabase,
} from '@workspace/database';
import {
  createDailyReflection,
  createEnergyCheckIn,
  endRelaxSession,
  parseCompletionRecordId,
  parseDailyReflectionId,
  parseEnergyCheckInId,
  parseInstant,
  parseLocalDate,
  parseRelaxSessionId,
  parseTaskId,
  parseTimeZoneId,
  startRelaxSession,
  updateDailyReflection,
} from '@workspace/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeSqliteDatabase } from './database-test-support';

const T0 = parseInstant('2026-09-12T08:00:00.000Z');
const T1 = parseInstant('2026-09-12T08:05:00.000Z');
const DAY = parseLocalDate('2026-09-12');
const ZONE = parseTimeZoneId('Asia/Shanghai');

function reflection(id: string, note: string | null = null) {
  return createDailyReflection({
    id: parseDailyReflectionId(id),
    localDate: DAY,
    timeZone: ZONE,
    summary: '今天完成了 1 项：「提交方案」。',
    wins: [
      {
        completionRecordId: parseCompletionRecordId('completion-1'),
        taskId: parseTaskId('task-1'),
        title: '提交方案',
        completedAt: T0,
      },
    ],
    adjustmentSuggestion: '下一步先整理反馈。',
    userNote: note,
    generatedBy: 'local_facts',
    createdAt: T0,
  });
}

describe('Phase 8 wellbeing SQLite', () => {
  let nativeDatabase: DatabaseSync;
  let database: SqliteDatabase;

  beforeEach(() => {
    nativeDatabase = new DatabaseSync(':memory:');
    database = createNodeSqliteDatabase(nativeDatabase);
  });

  afterEach(() => {
    nativeDatabase.close();
  });

  it('binds checked-in 0008 SQL and upgrades an existing 0007 database once', async () => {
    const sqlFile = await readFile(
      new URL(
        '../../packages/database/drizzle/0008_phase8_wellbeing.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const normalizedSql = sqlFile.trim();
    expect(phase8WellbeingSql).toBe(normalizedSql);
    expect(phase8WellbeingMigration.checksum).toBe(
      `sha256:${createHash('sha256').update(normalizedSql).digest('hex')}`,
    );
    expect(databaseMigrations[8]?.id).toBe('0008_phase8_wellbeing');

    const through0007 = databaseMigrations.slice(0, 8);
    await migrateDatabase(database, { migrations: through0007, now: () => T0 });
    await expect(
      migrateDatabase(database, {
        migrations: databaseMigrations,
        now: () => T1,
      }),
    ).resolves.toEqual({
      applied: ['0008_phase8_wellbeing'],
      alreadyApplied: through0007.map(({ id }) => id),
    });
  });

  it('persists and rehydrates reflections, ordered check-ins, and Relax lifecycle facts', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => T0,
    });
    const firstReflection = reflection('reflection-1', '记住这个进展。');
    const firstCheckIn = createEnergyCheckIn({
      id: parseEnergyCheckInId('check-in-1'),
      localDate: DAY,
      timeZone: ZONE,
      level: 2,
      note: '上午偏低',
      createdAt: T0,
    });
    const secondCheckIn = createEnergyCheckIn({
      id: parseEnergyCheckInId('check-in-2'),
      localDate: DAY,
      timeZone: ZONE,
      level: 4,
      createdAt: T1,
    });
    const active = startRelaxSession({
      id: parseRelaxSessionId('relax-1'),
      type: 'breathing',
      plannedMinutes: 1,
      source: 'focus',
      startedAt: T0,
    });

    await unitOfWork.transaction(async (transaction) => {
      await transaction.dailyReflections.insert(firstReflection);
      await transaction.energyCheckIns.insert(firstCheckIn);
      await transaction.energyCheckIns.insert(secondCheckIn);
      await transaction.relaxSessions.insert(active);
    });
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.dailyReflections.findByLocalDay(DAY, ZONE),
      ),
    ).resolves.toMatchObject({
      id: 'reflection-1',
      userNote: '记住这个进展。',
      wins: [{ completionRecordId: 'completion-1', taskId: 'task-1' }],
    });
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.energyCheckIns.listByLocalDay(DAY, ZONE),
      ),
    ).resolves.toMatchObject([
      { id: 'check-in-2', level: 4 },
      { id: 'check-in-1', level: 2 },
    ]);
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.energyCheckIns.findLatestAtOrBefore(T0),
      ),
    ).resolves.toMatchObject({ id: 'check-in-1' });
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.relaxSessions.findActive(),
      ),
    ).resolves.toMatchObject({ id: 'relax-1', status: 'active' });

    const updatedReflection = updateDailyReflection(
      firstReflection,
      { userNote: '更新后的真实感受。' },
      T1,
    );
    const completedRelax = endRelaxSession(active, 'completed', T1);
    await unitOfWork.transaction(async (transaction) => {
      await transaction.dailyReflections.update(updatedReflection);
      await transaction.relaxSessions.update(completedRelax);
    });
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.dailyReflections.findById(firstReflection.id),
      ),
    ).resolves.toMatchObject({ userNote: '更新后的真实感受。' });
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.relaxSessions.findActive(),
      ),
    ).resolves.toBeNull();
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.relaxSessions.listStartedBetween(
          parseInstant('2026-09-12T00:00:00.000Z'),
          parseInstant('2026-09-13T00:00:00.000Z'),
        ),
      ),
    ).resolves.toMatchObject([
      { id: 'relax-1', status: 'completed', actualSeconds: 300 },
    ]);
  });

  it('enforces wellbeing constraints and rolls a duplicate reflection transaction back', async () => {
    await migrateDatabase(database, { now: () => T0 });
    await expect(
      database.run(
        `INSERT INTO energy_check_ins (
          id, local_date, time_zone, level, note, created_at
        ) VALUES ('invalid-level', ?, ?, 6, null, ?)`,
        [DAY, ZONE, T0],
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO relax_sessions (
          id, type, planned_minutes, actual_seconds, started_at, ended_at,
          source, status, timing_quality, created_at
        ) VALUES ('invalid-active', 'pause', 3, 0, ?, ?,
          'relax_tab', 'active', 'trusted', ?)`,
        [T0, T1, T0],
      ),
    ).rejects.toThrow();
    await expect(
      database.run(
        `INSERT INTO relax_sessions (
          id, type, planned_minutes, actual_seconds, started_at, ended_at,
          source, status, timing_quality, created_at
        ) VALUES ('invalid-duration', 'pause', 61, null, ?, null,
          'relax_tab', 'active', 'trusted', ?)`,
        [T0, T0],
      ),
    ).rejects.toThrow();

    const unitOfWork = createSqliteApplicationUnitOfWork(database);
    await expect(
      unitOfWork.transaction(async (transaction) => {
        await transaction.dailyReflections.insert(reflection('reflection-a'));
        await transaction.dailyReflections.insert(reflection('reflection-b'));
      }),
    ).rejects.toThrow();
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.dailyReflections.findById(
          parseDailyReflectionId('reflection-a'),
        ),
      ),
    ).resolves.toBeNull();
  });

  it('enforces one active Relax session and rolls both inserts back', async () => {
    const unitOfWork = await initializeSqliteApplicationUnitOfWork(database, {
      now: () => T0,
    });
    const first = startRelaxSession({
      id: parseRelaxSessionId('relax-a'),
      type: 'pause',
      plannedMinutes: 3,
      source: 'relax_tab',
      startedAt: T0,
    });
    const second = startRelaxSession({
      id: parseRelaxSessionId('relax-b'),
      type: 'stretch',
      plannedMinutes: 5,
      source: 'today',
      startedAt: T1,
    });
    await expect(
      unitOfWork.transaction(async (transaction) => {
        await transaction.relaxSessions.insert(first);
        await transaction.relaxSessions.insert(second);
      }),
    ).rejects.toThrow();
    await expect(
      unitOfWork.transaction((transaction) =>
        transaction.relaxSessions.findActive(),
      ),
    ).resolves.toBeNull();
  });
});
