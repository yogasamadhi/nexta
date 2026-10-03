import { createExpoSqliteDatabase } from '@workspace/database';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return {
    promise,
    resolve() {
      resolve?.();
    },
  };
}

function nativeDatabase(
  runTransaction: SQLiteDatabase['withExclusiveTransactionAsync'],
): SQLiteDatabase {
  return {
    getAllAsync: async () => [],
    getFirstAsync: async () => null,
    runAsync: async () => ({ changes: 0, lastInsertRowId: 0 }),
    withExclusiveTransactionAsync: runTransaction,
  } as unknown as SQLiteDatabase;
}

describe('Expo SQLite transaction coordination', () => {
  it('serializes concurrent exclusive transactions on one database', async () => {
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const database = createExpoSqliteDatabase(
      nativeDatabase(async (work) => {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (calls === 1) {
          firstEntered.resolve();
          await releaseFirst.promise;
        }
        try {
          await work(nativeDatabase(async () => undefined));
        } finally {
          active -= 1;
        }
      }),
    );

    const first = database.transaction(async () => 'first');
    await firstEntered.promise;
    const second = database.transaction(async () => 'second');
    await Promise.resolve();

    expect(calls).toBe(1);
    releaseFirst.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'second',
    ]);
    expect(maximumActive).toBe(1);
  });

  it('releases the queue when an exclusive transaction fails', async () => {
    let calls = 0;
    const database = createExpoSqliteDatabase(
      nativeDatabase(async (work) => {
        calls += 1;
        if (calls === 1) throw new Error('native failure');
        await work(nativeDatabase(async () => undefined));
      }),
    );

    await expect(database.transaction(async () => 'never')).rejects.toThrow(
      'native failure',
    );
    await expect(database.transaction(async () => 'recovered')).resolves.toBe(
      'recovered',
    );
  });
});
