import { z } from 'zod';

import {
  backoffDelay,
  ConnectorError,
  genesysCloudHosts,
  type GenesysCloudRegion,
} from '@verbis/sdk-connector';

export interface GenesysClientDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

export interface ClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

const TokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
});

const MAX_ATTEMPTS = 4;
const MAX_RETRY_AFTER_MS = 60_000;

/** Seconds (or HTTP date) from `Retry-After`, capped; undefined when absent/invalid. */
export function retryAfterMs(header: string | null, now: Date): number | undefined {
  if (header === null || header.trim() === '') return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - now.getTime();
  return Number.isFinite(ms) ? Math.min(Math.max(0, ms), MAX_RETRY_AFTER_MS) : undefined;
}

export interface RequestOptions {
  readonly body?: unknown;
  /** Safe to repeat after a 5xx/timeout (GET, PUT, attribute PATCH, deduped commands). */
  readonly idempotent?: boolean;
}

/**
 * Platform API client with the Client Credentials grant (token cached until 60 s before expiry,
 * refreshed once on 401). 429 honours `Retry-After` (Genesys rate limits are per token/org); 5xx
 * and network errors retry with jittered backoff for idempotent calls. Never logs tokens.
 */
export class GenesysCloudClient {
  readonly #hosts;
  #token: { value: string; expiresAt: number } | undefined;
  #pendingToken: Promise<string> | undefined;

  constructor(
    region: GenesysCloudRegion,
    private readonly credentials: () => Promise<ClientCredentials>,
    private readonly deps: GenesysClientDeps = {},
  ) {
    this.#hosts = genesysCloudHosts(region);
  }

  get hosts() {
    return this.#hosts;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    if (!path.startsWith('/api/v2/'))
      throw new ConnectorError('Invalid Genesys path', 'genesys_bad_path', false);
    const idempotent = options.idempotent ?? (method === 'GET' || method === 'PUT');
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch()(`${this.#hosts.api}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${await this.#accessToken()}`,
            accept: 'application/json',
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        if (error instanceof ConnectorError) throw error;
        if (idempotent && attempt + 1 < MAX_ATTEMPTS) {
          await this.#sleep(backoffDelay(attempt, this.#backoff()));
          continue;
        }
        throw new ConnectorError('Genesys Cloud unreachable', 'genesys_unavailable', true);
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.#token = undefined;
        attempt -= 1;
        continue;
      }
      if (response.status === 429) {
        if (attempt + 1 >= MAX_ATTEMPTS)
          throw new ConnectorError('Genesys Cloud rate limit', 'genesys_rate_limited', true);
        await this.#sleep(
          retryAfterMs(response.headers.get('retry-after'), this.#now()) ??
            backoffDelay(attempt, this.#backoff()),
        );
        continue;
      }
      if (response.status >= 500) {
        if (idempotent && attempt + 1 < MAX_ATTEMPTS) {
          await this.#sleep(backoffDelay(attempt, this.#backoff()));
          continue;
        }
        throw new ConnectorError(
          `Genesys Cloud responded ${String(response.status)}`,
          'genesys_unavailable',
          true,
        );
      }
      if (!response.ok) throw statusError(response.status);
      if (response.status === 204) return schema.parse(undefined);
      const json: unknown = await response.json().catch(() => undefined);
      const parsed = schema.safeParse(json);
      if (!parsed.success)
        throw new ConnectorError(
          'Unexpected Genesys Cloud response',
          'genesys_bad_response',
          false,
        );
      return parsed.data;
    }
  }

  async #accessToken(): Promise<string> {
    if (this.#token !== undefined && this.#token.expiresAt > this.#now().getTime())
      return this.#token.value;
    this.#pendingToken ??= this.#fetchToken().finally(() => {
      this.#pendingToken = undefined;
    });
    return this.#pendingToken;
  }

  async #fetchToken(): Promise<string> {
    const { clientId, clientSecret } = await this.credentials();
    let response: Response;
    try {
      response = await this.#fetch()(`${this.#hosts.login}/oauth/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ConnectorError('Genesys Cloud login unreachable', 'genesys_unavailable', true);
    }
    if (!response.ok)
      throw new ConnectorError(
        `Genesys Cloud token request failed (${String(response.status)})`,
        response.status === 429 || response.status >= 500
          ? 'genesys_unavailable'
          : 'genesys_auth_failed',
        response.status === 429 || response.status >= 500,
      );
    const token = TokenSchema.safeParse(await response.json().catch(() => undefined));
    if (!token.success)
      throw new ConnectorError(
        'Unexpected Genesys Cloud token response',
        'genesys_auth_failed',
        false,
      );
    this.#token = {
      value: token.data.access_token,
      expiresAt: this.#now().getTime() + Math.max(0, token.data.expires_in - 60) * 1_000,
    };
    return token.data.access_token;
  }

  #fetch(): typeof fetch {
    return this.deps.fetch ?? fetch;
  }

  #now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  #sleep(ms: number): Promise<void> {
    return this.deps.sleep?.(ms) ?? new Promise((resolve) => setTimeout(resolve, ms));
  }

  #backoff() {
    return {
      baseMs: 500,
      maxMs: 15_000,
      ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
    };
  }
}

function statusError(status: number): ConnectorError {
  if (status === 404)
    return new ConnectorError('Genesys Cloud resource not found', 'genesys_not_found', false);
  if (status === 401 || status === 403)
    return new ConnectorError('Genesys Cloud refused the credentials', 'genesys_forbidden', false);
  if (status === 409) return new ConnectorError('Genesys Cloud conflict', 'genesys_conflict', true);
  return new ConnectorError(
    `Genesys Cloud rejected the request (${String(status)})`,
    'genesys_bad_request',
    false,
  );
}

/** Path segment encoder: ids from events/commands never change the path shape. */
export const seg = (value: string) => encodeURIComponent(value);
