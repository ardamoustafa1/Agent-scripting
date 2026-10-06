import { createServer, type Server, type IncomingHttpHeaders } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { parseInteractionEvent } from '@verbis/sdk-connector';

import { HttpVerbisApi } from './verbis-api.js';

const tenantId = '01928f3a-0000-7000-8000-0000000000ff',
  connectorId = '01928f3a-0000-7000-8000-000000000001';
const jwt = `header.${Buffer.from(JSON.stringify({ tnt: tenantId })).toString('base64url')}.signature`;
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          }),
        ),
    ),
  );
});
async function fixture() {
  const requests: { path: string; method: string; body: string; headers: IncomingHttpHeaders }[] =
    [];
  let failure: { status: number; body: string } | undefined;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '',
        body = Buffer.concat(chunks).toString();
      requests.push({ path, method: req.method ?? '', body, headers: req.headers });
      if (failure && !path.includes('/oauth2/')) {
        res.writeHead(failure.status);
        res.end(failure.body);
        failure = undefined;
        return;
      }
      const payload = path.includes('/oauth2/')
        ? { access_token: jwt, expires_in: 60 }
        : path.endsWith('/secrets')
          ? { secrets: { synthetic: 'secret' } }
          : path.endsWith('/connectors')
            ? [
                {
                  id: connectorId,
                  adapterType: 'simulator',
                  platform: 'simulator',
                  config: {},
                  version: 1,
                },
              ]
            : path.endsWith('/events')
              ? { interactionId: connectorId, agentId: tenantId, status: 'active' }
              : path.endsWith('/agents')
                ? { agents: ['agent'] }
                : path.endsWith('/agent-token')
                  ? { accessToken: 'delegated', expiresAt: '2026-10-03T12:00:00Z' }
                  : null;
      if (payload === null) {
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  let now = 1000;
  const api = new HttpVerbisApi(
    {
      HUB_API_URL: `http://127.0.0.1:${address.port}`,
      HUB_TENANTS: [{ slug: 'demo', clientId: 'hub-client' }],
      HUB_CLIENT_CERT_FILE: '',
      HUB_CLIENT_KEY_FILE: '',
      HUB_CA_FILE: '',
    },
    () => now,
  );
  return {
    api,
    requests,
    fail: (status: number, body: string) => {
      failure = { status, body };
    },
    advance: () => {
      now += 31_000;
    },
  };
}
describe('hub authenticated API transport', () => {
  it('caches tenant-scoped tokens, refreshes before expiry and does not issue tokens for unknown tenants', async () => {
    const f = await fixture();
    expect(f.api.tenantSlugs()).toEqual(['demo']);
    expect(await f.api.tenantIdOf('demo')).toBe(tenantId);
    expect(await f.api.tenantIdOf('demo')).toBe(tenantId);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({
      path: '/oauth2/demo/token',
      method: 'POST',
      body: 'grant_type=client_credentials&client_id=hub-client',
    });
    f.advance();
    await f.api.tenantIdOf('demo');
    expect(f.requests).toHaveLength(2);
    await expect(f.api.tenantIdOf('unknown')).rejects.toMatchObject({
      code: 'tenant_unknown',
      retryable: false,
    });
    expect(f.requests).toHaveLength(2);
  });
  it('validates connectors, secrets and delegated agent responses and sends idempotent ingest/launch requests', async () => {
    const f = await fixture();
    expect(await f.api.listConnectors('demo')).toEqual([
      { id: connectorId, adapterType: 'simulator', platform: 'simulator', config: {}, version: 1 },
    ]);
    expect(await f.api.resolveSecrets('demo', connectorId)).toEqual({ synthetic: 'secret' });
    await f.api.reportHealth('demo', connectorId, { status: 'degraded', detail: 'synthetic' });
    const event = parseInteractionEvent({
      eventId: 'fixture-event',
      type: 'connected',
      occurredAt: '2026-10-03T12:00:00Z',
      platformInteractionId: 'platform',
      channel: 'voice',
      direction: 'inbound',
      agent: { id: 'agent' },
    });
    expect(await f.api.ingest('demo', connectorId, event)).toEqual({
      interactionId: connectorId,
      agentId: tenantId,
      status: 'active',
    });
    await f.api.createLaunchIntent('demo', {
      connectorId,
      interactionId: connectorId,
      userId: tenantId,
    });
    expect(await f.api.engageLinkedAgents('demo', connectorId)).toEqual(['agent']);
    expect(await f.api.engageAgentToken('demo', connectorId, 'agent')).toEqual({
      accessToken: 'delegated',
      expiresAt: Date.parse('2026-10-03T12:00:00Z'),
    });
    const ingest = f.requests.find((r) => r.path.endsWith('/events'))!,
      launch = f.requests.find((r) => r.path.endsWith('/launch-intents'))!;
    expect(ingest.headers['idempotency-key']).toBe('evt:fixture-event');
    expect(launch.headers['idempotency-key']).toBe(`launch:${connectorId}:${tenantId}`);
    expect(JSON.parse(launch.body)).toMatchObject({
      delivery: 'push',
      connectorId,
      interactionId: connectorId,
      userId: tenantId,
    });
    expect(f.requests.slice(1).every((r) => r.headers.authorization === `Bearer ${jwt}`)).toBe(
      true,
    );
  });
  it.each([
    [400, false],
    [401, true],
    [429, true],
    [500, true],
  ])('classifies status %i and invalidates an unauthorized token', async (status, retryable) => {
    const f = await fixture();
    f.fail(status, JSON.stringify({ code: 'fixture_problem', private: 'must never appear' }));
    await expect(f.api.listConnectors('demo')).rejects.toMatchObject({
      code: 'fixture_problem',
      retryable,
      message: `API responded ${status}`,
    });
    await f.api.listConnectors('demo');
    expect(f.requests.filter((r) => r.path.includes('/oauth2/'))).toHaveLength(
      status === 401 ? 2 : 1,
    );
  });
  it('uses bounded generic errors for malformed upstream responses and connection failures', async () => {
    const f = await fixture();
    f.fail(503, 'private upstream details');
    await expect(f.api.listConnectors('demo')).rejects.toMatchObject({
      code: 'http_503',
      message: 'API responded 503',
      retryable: true,
    });
    const server = servers.pop()!;
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
    await expect(f.api.listConnectors('demo')).rejects.toMatchObject({
      code: 'api_unreachable',
      message: 'API unreachable',
      retryable: true,
    });
  });
});
