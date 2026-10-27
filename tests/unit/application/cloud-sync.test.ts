import { describe, it, expect, vi } from 'vitest';
import {
  CloudSyncService,
  CloudAccountService,
  CloudError,
  cloudBatchSchema,
  type CloudAPI,
  type CloudTokens,
  type CloudLocalStore,
  type CloudSecretStore,
} from '@workspace/application';
import fixture from '../../../server/contracts/fixtures.json';
const tokens: CloudTokens = {
  userId: 'user_one',
  deviceId: 'device_one',
  email: 'test@example.test',
  accessToken: 'access',
  refreshToken: 'refresh_token_that_is_long_enough',
  expiresIn: 900,
};
const batch = cloudBatchSchema.parse({
  ...fixture,
  batchId: 'foreground_batch',
  changes: fixture.changes.filter((e) => e.kind === 'goal'),
});
function setup() {
  const acknowledge = vi.fn(async () => {});
  const state = {
    userId: tokens.userId,
    deviceId: tokens.deviceId,
    cursor: '0',
    pending: 1,
    conflicts: 0,
    projectionEnabled: false,
  };
  const local: CloudLocalStore = {
    initialization: async () => null,
    stageBootstrap: async () => true,
    state: () => Promise.resolve(state),
    owner: () => Promise.resolve(null),
    bind: async () => {},
    pending: () => Promise.resolve([batch]),
    acknowledge,
    apply: async () => true,
    conflict: async () => {},
    conflicts: async () => [],
    resolve: async () => {},
    projection: async () => {},
  };
  const secrets: CloudSecretStore = {
    read: () => Promise.resolve(tokens),
    write: vi.fn(async () => {}),
    remove: async () => {},
  };
  const api: CloudAPI = {
    bootstrap: async () => ({
      id: 'snapshot',
      revision: '0',
      page: 0,
      entities: [],
      hasMore: false,
    }),
    authenticate: async () => tokens,
    refresh: async () => tokens,
    logout: async () => {},
    push: async () => ({ revision: '1', entities: [], conflictId: '' }),
    pull: async () => ({ cursor: '0', commits: [], hasMore: false }),
    conflicts: async () => [],
    resolve: async () => ({ revision: '1', entities: [], conflictId: '' }),
  };
  const service = new CloudSyncService({ api, secrets, local });
  return { api, secrets, local, service, acknowledge };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 50 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}
describe('foreground cloud coordinator', () => {
  it('does not start network work until foreground activation', async () => {
    const s = setup();
    s.api.push = vi.fn(s.api.push);
    await s.service.wake();
    expect(s.api.push).not.toHaveBeenCalled();
    await s.service.setActive(true);
    await s.service.wake();
    expect(s.api.push).toHaveBeenCalled();
    await s.service.setActive(false);
  });
  it('stops promptly even when the upstream ignores Abort and isolates the late receipt', async () => {
    const s = setup();
    let finish:
      | ((value: {
          revision: string;
          entities: [];
          conflictId: string;
        }) => void)
      | undefined;
    let started = false;
    s.api.push = () =>
      new Promise((resolve) => {
        started = true;
        finish = resolve;
      });
    await s.service.setActive(true);
    await until(() => started);
    await s.service.setActive(false);
    finish!({ revision: '1', entities: [], conflictId: '' });
    await until(() => s.service.status !== 'failed');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(s.acknowledge).not.toHaveBeenCalled();
  });
  it('keeps durable local work on a network error and retries on the next foreground event', async () => {
    const s = setup();
    let fail = true;
    s.api.push = async () => {
      if (fail) throw new CloudError('network', true);
      return { revision: '1', entities: [], conflictId: '' };
    };
    await s.service.setActive(true);
    await s.service.wake();
    expect(s.service.status).toBe('offline');
    expect(s.acknowledge).not.toHaveBeenCalled();
    fail = false;
    await s.service.wake();
    expect(s.acknowledge).toHaveBeenCalledTimes(1);
    await s.service.setActive(false);
  });
  it('does not retry a request after backgrounding during credential storage and clears credentials after an in-flight write', async () => {
    const s = setup();
    let finish: (() => void) | undefined;
    let writing = false;
    s.api.push = vi.fn(async () => {
      throw new CloudError('authentication');
    });
    s.secrets.write = () =>
      new Promise<void>((resolve) => {
        writing = true;
        finish = resolve;
      });
    s.secrets.remove = vi.fn(async () => {});
    await s.service.setActive(true);
    await until(() => writing);
    const stopped = s.service.disconnect();
    await Promise.resolve();
    expect(s.secrets.remove).not.toHaveBeenCalled();
    finish!();
    await stopped;
    expect(s.api.push).toHaveBeenCalledTimes(1);
    expect(s.secrets.remove).toHaveBeenCalledTimes(1);
    expect(s.acknowledge).not.toHaveBeenCalled();
  });
  it('does not store credentials for a different account returned by refresh', async () => {
    const s = setup();
    s.api.push = async () => {
      throw new CloudError('authentication');
    };
    s.api.refresh = async () => ({ ...tokens, userId: 'other_user' });
    await s.service.setActive(true);
    await s.service.wake();
    expect(s.service.status).toBe('authentication');
    expect(s.secrets.write).not.toHaveBeenCalled();
    expect(s.acknowledge).not.toHaveBeenCalled();
  });
});

describe('cloud account credential boundary', () => {
  it('refuses login before network when secure credential storage is unavailable', async () => {
    const s = setup();
    s.api.authenticate = vi.fn(s.api.authenticate);
    const switchProfile = vi.fn(async () => {});
    const account = new CloudAccountService(s.service, s.local, {
      api: s.api,
      installationId: async () => 'install_test',
      switchProfile,
      signOut: async () => {},
      prepareCredentialStorage: async () => {
        throw new CloudError('credential_storage');
      },
    });
    await expect(
      account.login('test@example.test', 'a sufficiently long password', true),
    ).rejects.toMatchObject({ code: 'credential_storage' });
    expect(s.api.authenticate).not.toHaveBeenCalled();
    expect(switchProfile).not.toHaveBeenCalled();
    expect(s.secrets.write).not.toHaveBeenCalled();
  });
});
