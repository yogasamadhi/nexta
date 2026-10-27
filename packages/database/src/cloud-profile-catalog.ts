import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { SqliteDatabase } from './sqlite';

/** Separate non-secret metadata database; never contains passwords or tokens. */
export const cloudProfileCatalog = sqliteTable('cloud_profile_catalog', {
  id: integer('id').primaryKey(),
  valueJson: text('value_json').notNull(),
});
export const cloudProfileCatalogSchema = { cloudProfileCatalog };
export class SqliteCloudProfileCatalog {
  constructor(private readonly database: SqliteDatabase) {}
  async read(): Promise<string | null> {
    return this.database.transaction(async (tx) => {
      await tx.run(
        'CREATE TABLE IF NOT EXISTS cloud_profile_catalog(id integer PRIMARY KEY,value_json text NOT NULL)',
      );
      return (
        (
          await tx.get<{ value_json: string }>(
            'SELECT value_json FROM cloud_profile_catalog WHERE id=1',
          )
        )?.value_json ?? null
      );
    });
  }
  async write(value: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.run(
        'CREATE TABLE IF NOT EXISTS cloud_profile_catalog(id integer PRIMARY KEY,value_json text NOT NULL)',
      );
      await tx.run(
        'INSERT INTO cloud_profile_catalog(id,value_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
        [value],
      );
    });
  }
}
