import {
  CloudError,
  cloudTokensSchema,
  cloudBootstrapPageSchema,
  cloudEntitySchema,
  cloudResultSchema,
  cloudPullSchema,
  cloudConflictSchema,
  type CloudAbortSignal,
  type CloudAPI,
  type CloudBatch,
  type CloudCredentials,
} from '@workspace/application';
import { z } from 'zod';
export class HttpCloudAPI implements CloudAPI {
  readonly baseURL: string;
  constructor(baseURL: string) {
    const url = new URL(baseURL);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !['https:', 'http:'].includes(url.protocol) ||
      (!__DEV__ && url.protocol !== 'https:')
    )
      throw new CloudError('validation');
    this.baseURL = url.origin;
  }
  private async request(
    path: string,
    token: string | null,
    body: unknown | undefined,
    signal: CloudAbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, 15000);
    try {
      const response = await fetch(this.baseURL + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new CloudError(
          response.status === 401
            ? 'authentication'
            : response.status === 409
              ? 'conflict'
              : response.status === 400
                ? 'validation'
                : 'unavailable',
          response.status >= 500 || response.status === 429,
        );
      return (await response.json()) as unknown;
    } catch (error) {
      if (signal.aborted) throw new CloudError('canceled');
      if (error instanceof CloudError) throw error;
      throw new CloudError('network', true);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  async authenticate(
    credentials: CloudCredentials,
    register: boolean,
    signal: CloudAbortSignal,
  ) {
    return cloudTokensSchema.parse(
      await this.request(
        `/v1/auth/${register ? 'register' : 'login'}`,
        null,
        credentials,
        signal,
      ),
    );
  }
  async refresh(refreshToken: string, signal: CloudAbortSignal) {
    return cloudTokensSchema.parse(
      await this.request('/v1/auth/refresh', null, { refreshToken }, signal),
    );
  }
  async logout(accessToken: string, signal: CloudAbortSignal) {
    await this.request('/v1/auth/logout', accessToken, {}, signal);
  }
  async push(accessToken: string, batch: CloudBatch, signal: CloudAbortSignal) {
    if (batch.batchId.startsWith('initial_')) {
      const schema = z
        .object({
          id: z.string(),
          revision: z.string(),
          entities: z.array(cloudEntitySchema),
          hasMore: z.boolean(),
          conflictId: z.string(),
        })
        .strict();
      let id = '';
      const count = Math.ceil(batch.changes.length / 250);
      for (let page = 0; page < count; page++) {
        const chunk = schema.parse(
          await this.request(
            '/v1/sync/bootstrap',
            accessToken,
            {
              id,
              action: 'upload',
              batchId: batch.batchId,
              page,
              entities: batch.changes.slice(page * 250, (page + 1) * 250),
            },
            signal,
          ),
        );
        id = chunk.id;
      }
      const result = schema.parse(
        await this.request(
          '/v1/sync/bootstrap',
          accessToken,
          { id, action: 'commit', batchId: batch.batchId, chunkCount: count },
          signal,
        ),
      );
      return cloudResultSchema.parse({
        revision: result.revision,
        entities: result.entities,
        conflictId: result.conflictId,
      });
    }
    return cloudResultSchema.parse(
      await this.request('/v1/sync/push', accessToken, batch, signal),
    );
  }
  async bootstrap(
    accessToken: string,
    id: string,
    page: number,
    signal: CloudAbortSignal,
  ) {
    const response = z
      .object({
        id: z.string(),
        revision: z.string(),
        entities: z.array(cloudEntitySchema),
        hasMore: z.boolean(),
        conflictId: z.string(),
      })
      .strict()
      .parse(
        await this.request(
          '/v1/sync/bootstrap',
          accessToken,
          { id, action: 'download', page },
          signal,
        ),
      );
    if (response.conflictId) throw new CloudError('conflict');
    return cloudBootstrapPageSchema.parse({
      id: response.id,
      revision: response.revision,
      entities: response.entities,
      hasMore: response.hasMore,
      page,
    });
  }
  async pull(accessToken: string, cursor: string, signal: CloudAbortSignal) {
    return cloudPullSchema.parse(
      await this.request(
        `/v1/sync/pull?cursor=${encodeURIComponent(cursor)}&limit=50`,
        accessToken,
        undefined,
        signal,
      ),
    );
  }
  async conflicts(accessToken: string, signal: CloudAbortSignal) {
    return z
      .object({ conflicts: z.array(cloudConflictSchema) })
      .strict()
      .parse(
        await this.request(
          '/v1/sync/conflicts',
          accessToken,
          undefined,
          signal,
        ),
      ).conflicts;
  }
  async resolve(
    accessToken: string,
    id: string,
    choice: 'local' | 'cloud',
    replacement: CloudBatch | undefined,
    signal: CloudAbortSignal,
  ) {
    return cloudResultSchema.parse(
      await this.request(
        `/v1/sync/conflicts/${encodeURIComponent(id)}/resolve`,
        accessToken,
        { id, choice, ...(replacement ? { replacement } : {}) },
        signal,
      ),
    );
  }
}
