import {
  hashOperationParameters,
  CloudError,
  cloudTokensSchema,
  type CloudTokens,
  type CloudSecretStore,
} from '@workspace/application';
import * as SecureStore from 'expo-secure-store';
import {
  SqliteCloudProfileCatalog,
  createExpoSqliteDatabase,
} from '@workspace/database';
import { openDatabaseAsync, backupDatabaseAsync } from 'expo-sqlite';
import { z } from 'zod';
const profileSchema = z
  .object({
    baseURL: z.string(),
    userId: z.string(),
    email: z.string(),
    databaseName: z.string(),
  })
  .strict();
const registrySchema = z
  .object({
    active: z.string().nullable(),
    guestClaimed: z.boolean(),
    profiles: z.record(z.string(), profileSchema),
  })
  .strict();
type Registry = z.infer<typeof registrySchema>;
export type CloudProfile = z.infer<typeof profileSchema>;
const registryKey = 'execution.cloud.profiles.v1';
const secretOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const key = (baseURL: string, userId: string) =>
  hashOperationParameters({ baseURL, userId }).replace(/[^a-zA-Z0-9_-]/g, '');
async function catalog<T>(
  work: (store: SqliteCloudProfileCatalog) => Promise<T>,
): Promise<T> {
  const db = await openDatabaseAsync('execution-cloud-catalog.sqlite');
  try {
    return await work(
      new SqliteCloudProfileCatalog(createExpoSqliteDatabase(db)),
    );
  } finally {
    await db.closeAsync();
  }
}
async function registry(): Promise<Registry> {
  const raw = await catalog((store) => store.read());
  if (raw) return registrySchema.parse(JSON.parse(raw));
  // Migrate only the non-secret index from early internal builds. Keychain unavailability must not break local mode.
  const old = await SecureStore.getItemAsync(registryKey).catch(() => null);
  const value = old
    ? registrySchema.parse(JSON.parse(old))
    : { active: null, guestClaimed: false, profiles: {} };
  await save(value);
  return value;
}
async function save(value: Registry) {
  await catalog((store) => store.write(JSON.stringify(value)));
}
export async function prepareCloudSecretStorage(): Promise<void> {
  const probe = 'execution.cloud.storage-probe';
  try {
    await SecureStore.setItemAsync(probe, 'available', secretOptions);
    if ((await SecureStore.getItemAsync(probe)) !== 'available')
      throw new Error('Unavailable');
    await SecureStore.deleteItemAsync(probe);
  } catch {
    throw new CloudError('credential_storage');
  }
}
export async function activeCloudProfile(): Promise<CloudProfile | null> {
  const value = await registry();
  return value.active ? (value.profiles[value.active] ?? null) : null;
}
export async function installationId(): Promise<string> {
  const name = 'execution.cloud.installation.v1';
  let id = await SecureStore.getItemAsync(name);
  if (!id) {
    id = `install_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    await SecureStore.setItemAsync(name, id, secretOptions);
  }
  return id;
}
export function profileSecrets(profile: CloudProfile): CloudSecretStore {
  const name = `execution.cloud.tokens.${key(profile.baseURL, profile.userId)}`;
  return {
    async read() {
      const raw = await SecureStore.getItemAsync(name);
      return raw ? cloudTokensSchema.parse(JSON.parse(raw)) : null;
    },
    async write(tokens) {
      if (tokens.userId !== profile.userId)
        throw new Error('Account identity changed.');
      await SecureStore.setItemAsync(
        name,
        JSON.stringify(tokens),
        secretOptions,
      );
    },
    async remove() {
      await SecureStore.deleteItemAsync(name);
    },
  };
}
const emptySecrets: CloudSecretStore = {
  read: () => Promise.resolve(null),
  write: () => Promise.reject(new Error('Profile required.')),
  remove: () => Promise.resolve(),
};
export function guestCloudSecrets() {
  return emptySecrets;
}
export async function activateCloudProfile(
  baseURL: string,
  tokens: CloudTokens,
  guestDatabaseName: string,
): Promise<void> {
  const value = await registry();
  const id = key(baseURL, tokens.userId);
  let profile = value.profiles[id];
  if (!profile) {
    profile = {
      baseURL,
      userId: tokens.userId,
      email: tokens.email,
      databaseName: `execution-account-${id}.sqlite`,
    };
    const destination = await openDatabaseAsync(profile.databaseName);
    try {
      if (!value.guestClaimed) {
        const source = await openDatabaseAsync(guestDatabaseName);
        try {
          await backupDatabaseAsync({
            sourceDatabase: source,
            destDatabase: destination,
          });
        } finally {
          await source.closeAsync();
        }
        const result = await destination.getFirstAsync<{
          integrity_check: string;
        }>('PRAGMA integrity_check');
        if (result?.integrity_check !== 'ok')
          throw new Error('Profile migration failed.');
        if ((await destination.getAllAsync('PRAGMA foreign_key_check')).length)
          throw new Error('Profile references invalid.');
        await destination.runAsync(
          'INSERT OR IGNORE INTO cloud_profile_claim(source_name,user_id) VALUES(?,?)',
          [guestDatabaseName, tokens.userId],
        );
        value.guestClaimed = true;
      }
    } finally {
      await destination.closeAsync();
    }
    value.profiles[id] = profile;
  }
  await profileSecrets(profile).write(tokens);
  value.active = id;
  await save(value);
}
export async function deactivateCloudProfile(): Promise<void> {
  const value = await registry();
  value.active = null;
  await save(value);
}
export async function guestDatabaseName(): Promise<string> {
  const value = await registry();
  return value.guestClaimed
    ? 'execution-guest-unclaimed.sqlite'
    : 'execution-agent.sqlite';
}
