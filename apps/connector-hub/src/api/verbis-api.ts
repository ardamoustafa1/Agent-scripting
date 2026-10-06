import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { z } from 'zod';

import { ConnectorError, type InteractionEvent } from '@verbis/sdk-connector';

import type { HubEnv } from '../env.js';

export const HubConnectorSchema = z.object({
  id: z.uuid(),
  adapterType: z.string(),
  platform: z.string(),
  config: z.unknown(),
  version: z.number().int(),
});
export type HubConnector = z.infer<typeof HubConnectorSchema>;

export const IngestResultSchema = z.object({
  interactionId: z.uuid(),
  agentId: z.uuid().nullable(),
  status: z.string(),
});
export type IngestResult = z.infer<typeof IngestResultSchema>;

export interface ConnectorHealthReport {
  status: 'up' | 'degraded' | 'down';
  detail?: string;
}

/** Everything the hub needs from the API. Tests use an in-memory fake. */
export interface VerbisApi {
  tenantSlugs(): readonly string[];
  tenantIdOf(slug: string): Promise<string>;
  listConnectors(slug: string): Promise<HubConnector[]>;
  resolveSecrets(slug: string, connectorId: string): Promise<Record<string, string>>;
  reportHealth(slug: string, connectorId: string, report: ConnectorHealthReport): Promise<void>;
  ingest(slug: string, connectorId: string, event: InteractionEvent): Promise<IngestResult>;
  createLaunchIntent(
    slug: string,
    input: { connectorId: string; interactionId: string; userId: string },
  ): Promise<void>;
  /** Genesys Engage workspace mode: agents with a live delegated link, and their access tokens. */
  engageLinkedAgents(slug: string, connectorId: string): Promise<string[]>;
  engageAgentToken(
    slug: string,
    connectorId: string,
    platformUserId: string,
  ): Promise<{ accessToken: string; expiresAt: number }>;
}

export const VERBIS_API = Symbol('VERBIS_API');

interface RawResponse {
  status: number;
  body: string;
}

/**
 * HTTP client for the API: client-credentials tokens per tenant (`/oauth2/{slug}/token`) bound to
 * the hub's client certificate (RFC 8705). 5xx/429/network errors are retryable; other 4xx are not.
 * Tokens and secrets never reach logs.
 */
export class HttpVerbisApi implements VerbisApi {
  readonly #tokens = new Map<string, { token: string; tenantId: string; expiresAt: number }>();
  readonly #tls: { cert?: Buffer; key?: Buffer; ca?: Buffer };

  constructor(
    private readonly env: Pick<
      HubEnv,
      'HUB_API_URL' | 'HUB_TENANTS' | 'HUB_CLIENT_CERT_FILE' | 'HUB_CLIENT_KEY_FILE' | 'HUB_CA_FILE'
    >,
    private readonly now: () => number = Date.now,
  ) {
    const read = (path: string) => (path === '' ? undefined : readFileSync(path));
    const cert = read(env.HUB_CLIENT_CERT_FILE);
    const key = read(env.HUB_CLIENT_KEY_FILE);
    const ca = read(env.HUB_CA_FILE);
    this.#tls = {
      ...(cert === undefined ? {} : { cert }),
      ...(key === undefined ? {} : { key }),
      ...(ca === undefined ? {} : { ca }),
    };
  }

  tenantSlugs(): readonly string[] {
    return this.env.HUB_TENANTS.map((t) => t.slug);
  }

  async tenantIdOf(slug: string): Promise<string> {
    return (await this.token(slug)).tenantId;
  }

  async listConnectors(slug: string): Promise<HubConnector[]> {
    return z
      .array(HubConnectorSchema)
      .parse(await this.json(slug, 'GET', '/v1/connector-hub/connectors'));
  }

  async resolveSecrets(slug: string, connectorId: string): Promise<Record<string, string>> {
    const body = await this.json(
      slug,
      'POST',
      `/v1/connector-hub/connectors/${connectorId}/secrets`,
      {},
    );
    return z.object({ secrets: z.record(z.string(), z.string()) }).parse(body).secrets;
  }

  async reportHealth(
    slug: string,
    connectorId: string,
    report: ConnectorHealthReport,
  ): Promise<void> {
    await this.json(slug, 'POST', `/v1/connector-hub/connectors/${connectorId}/health`, report);
  }

  async ingest(slug: string, connectorId: string, event: InteractionEvent): Promise<IngestResult> {
    const body = await this.json(
      slug,
      'POST',
      `/v1/connector-hub/connectors/${connectorId}/events`,
      { event },
      {
        'idempotency-key': `evt:${event.eventId}`.slice(0, 255),
      },
    );
    return IngestResultSchema.parse(body);
  }

  async createLaunchIntent(
    slug: string,
    input: { connectorId: string; interactionId: string; userId: string },
  ): Promise<void> {
    await this.json(
      slug,
      'POST',
      '/v1/launch-intents',
      { ...input, delivery: 'push' },
      {
        'idempotency-key': `launch:${input.interactionId}:${input.userId}`,
      },
    );
  }

  async engageLinkedAgents(slug: string, connectorId: string): Promise<string[]> {
    const body = await this.json(
      slug,
      'GET',
      `/v1/connector-hub/connectors/${connectorId}/engage/agents`,
    );
    return z.object({ agents: z.array(z.string().min(1).max(256)).max(10_000) }).parse(body).agents;
  }

  async engageAgentToken(
    slug: string,
    connectorId: string,
    platformUserId: string,
  ): Promise<{ accessToken: string; expiresAt: number }> {
    const body = await this.json(
      slug,
      'POST',
      `/v1/connector-hub/connectors/${connectorId}/engage/agent-token`,
      { platformUserId },
    );
    const parsed = z
      .object({ accessToken: z.string().min(1), expiresAt: z.iso.datetime() })
      .parse(body);
    return { accessToken: parsed.accessToken, expiresAt: Date.parse(parsed.expiresAt) };
  }

  private async token(slug: string) {
    const cached = this.#tokens.get(slug);
    if (cached !== undefined && cached.expiresAt > this.now() + 30_000) return cached;
    const tenant = this.env.HUB_TENANTS.find((t) => t.slug === slug);
    if (tenant === undefined) throw new ConnectorError('Unknown tenant', 'tenant_unknown', false);
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: tenant.clientId,
    }).toString();
    const response = await this.send('POST', `/oauth2/${slug}/token`, form, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    this.check(response);
    const parsed = z
      .object({ access_token: z.string(), expires_in: z.number().int() })
      .parse(JSON.parse(response.body));
    const [, payload] = parsed.access_token.split('.');
    const tenantId = z
      .object({ tnt: z.uuid() })
      .parse(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'))).tnt;
    const entry = {
      token: parsed.access_token,
      tenantId,
      expiresAt: this.now() + parsed.expires_in * 1_000,
    };
    this.#tokens.set(slug, entry);
    return entry;
  }

  private async json(
    slug: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const { token } = await this.token(slug);
    const response = await this.send(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
    );
    if (response.status === 401) this.#tokens.delete(slug);
    this.check(response);
    return response.status === 204 || response.body === '' ? null : JSON.parse(response.body);
  }

  private check(response: RawResponse): void {
    if (response.status < 400) return;
    const code = z.object({ code: z.string() }).safeParse(
      (() => {
        try {
          return JSON.parse(response.body) as unknown;
        } catch {
          return null;
        }
      })(),
    );
    const retryable = response.status >= 500 || response.status === 429 || response.status === 401;
    throw new ConnectorError(
      `API responded ${String(response.status)}`,
      code.success ? code.data.code : `http_${String(response.status)}`,
      retryable,
    );
  }

  private send(
    method: string,
    path: string,
    body: string | undefined,
    headers: Record<string, string>,
  ): Promise<RawResponse> {
    const url = new URL(path, this.env.HUB_API_URL);
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method,
          headers: {
            ...headers,
            ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }),
          },
          timeout: 5_000,
          ...this.#tls,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 5_000_000) req.destroy(new Error('response too large'));
            else chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => {
        reject(new ConnectorError('API unreachable', 'api_unreachable', true));
      });
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}
