import { z } from 'zod';

import { backoffDelay, ConnectorError } from '@verbis/sdk-connector';

import { retryAfterMs } from '../../genesys-cloud/genesys-client.js';

import { axpUrls, type AxpConfig } from './config.js';

export interface AxpCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  /** API key sent as `appkey` header (new `*.api.avayacloud.com` base). */
  readonly appKey: string;
}

const TokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const MAX_ATTEMPTS = 4;

/**
 * AXP REST client: Client Credentials at the account realm (Keycloak), token cached until 60 s
 * before expiry (AXP: 15 min), refreshed once on 401; 429 `Retry-After`, jittered 5xx retries.
 */
export class AxpClient {
  readonly #urls;
  #token: { value: string; expiresAt: number } | undefined;
  #pending: Promise<string> | undefined;

  constructor(
    config: Pick<AxpConfig, 'host' | 'accountId'>,
    private readonly credentials: () => Promise<AxpCredentials>,
    private readonly deps: {
      fetch?: typeof fetch;
      now?: () => Date;
      sleep?: (ms: number) => Promise<void>;
      random?: () => number;
    } = {},
    endpoints: { tokenPath?: string } = {},
  ) {
    this.#urls = axpUrls(config, endpoints.tokenPath);
  }

  async token(): Promise<string> {
    if (this.#token !== undefined && this.#token.expiresAt > this.#now()) return this.#token.value;
    this.#pending ??= this.#fetchToken().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    idempotent = method !== 'POST',
  ): Promise<T> {
    if (!path.startsWith('/api/'))
      throw new ConnectorError('Invalid AXP path', 'axp_bad_path', false);
    const { appKey } = await this.credentials();
    let refreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch()(`${this.#urls.api}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${await this.token()}`,
            appkey: appKey,
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        if (error instanceof ConnectorError) throw error;
        if (idempotent && attempt + 1 < MAX_ATTEMPTS) {
          await this.#sleep(backoffDelay(attempt, this.#backoff()));
          continue;
        }
        throw new ConnectorError('AXP unreachable', 'axp_unavailable', true);
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.#token = undefined;
        attempt -= 1;
        continue;
      }
      if (response.status === 429 || (response.status >= 500 && idempotent)) {
        if (attempt + 1 >= MAX_ATTEMPTS)
          throw new ConnectorError(
            `AXP responded ${String(response.status)}`,
            response.status === 429 ? 'axp_rate_limited' : 'axp_unavailable',
            true,
          );
        await this.#sleep(
          retryAfterMs(response.headers.get('retry-after'), new Date(this.#now())) ??
            backoffDelay(attempt, this.#backoff()),
        );
        continue;
      }
      if (response.status >= 500)
        throw new ConnectorError(
          `AXP responded ${String(response.status)}`,
          'axp_unavailable',
          true,
        );
      if (response.status === 404)
        throw new ConnectorError('AXP resource not found', 'axp_not_found', false);
      if (!response.ok)
        throw new ConnectorError(
          `AXP rejected the request (${String(response.status)})`,
          'axp_bad_request',
          false,
        );
      if (response.status === 204) return schema.parse(undefined);
      const parsed = schema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success)
        throw new ConnectorError('Unexpected AXP response', 'axp_bad_response', false);
      return parsed.data;
    }
  }

  async #fetchToken(): Promise<string> {
    const { clientId, clientSecret } = await this.credentials();
    let response: Response;
    try {
      response = await this.#fetch()(this.#urls.token, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ConnectorError('AXP auth unreachable', 'axp_unavailable', true);
    }
    const token = TokenSchema.safeParse(
      response.ok ? await response.json().catch(() => undefined) : undefined,
    );
    if (!token.success)
      throw new ConnectorError(
        'AXP token request failed',
        'axp_auth_failed',
        response.status >= 500 || response.status === 429,
      );
    this.#token = {
      value: token.data.access_token,
      expiresAt: this.#now() + Math.max(0, token.data.expires_in - 60) * 1_000,
    };
    return token.data.access_token;
  }

  #fetch() {
    return this.deps.fetch ?? fetch;
  }

  #now() {
    return (this.deps.now?.() ?? new Date()).getTime();
  }

  #sleep(ms: number) {
    return this.deps.sleep?.(ms) ?? new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  #backoff() {
    return {
      baseMs: 500,
      maxMs: 15_000,
      ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
    };
  }
}
