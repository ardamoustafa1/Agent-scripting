import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { GenericContainer, Wait } from '../../apps/api/node_modules/testcontainers/build/index.js';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from '../../apps/api/node_modules/vitest/dist/index.js';
import { NatsService } from '../../apps/api/src/infra/nats/nats.service.js';
import { SESSION_STORE } from '../../apps/api/src/modules/identity/core/identity.tokens.js';
import { type SessionStore } from '../../apps/api/src/modules/identity/session/session-store.js';
import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
} from '../../apps/api/test/integration/helpers.js';
import { createTokenKit } from '../../apps/api/test/support/tokens.js';
import { surveyScript } from '../../packages/script-schema/dist/fixtures/index.js';

import { evidenceFile } from './evidence.js';

import type { NestFastifyApplication } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';

interface AuditSocket {
  connected: boolean;
  io: { engine?: { close(): void } };
  once(event: string, callback: (payload: unknown) => void): void;
  connect(): void;
  close(): void;
}
const { io } = createRequire(new URL('../../apps/agent-web/package.json', import.meta.url))(
  'socket.io-client',
) as {
  io: (
    uri: string,
    options: {
      transports: string[];
      auth: { ticket: string };
      extraHeaders: { origin: string };
      reconnection: boolean;
      autoConnect: boolean;
    },
  ) => AuditSocket;
};

let app: NestFastifyApplication,
  owner: PrismaClient,
  url: string,
  sessionId: string,
  headers: Record<string, string>;
const sockets: AuditSocket[] = [];
beforeAll(async () => {
  owner = ownerPrisma();
  const kit = await createTokenKit();
  app = await startApp(integrationEnv(kit.jwks));
  const t = await createTenant(owner, kit, uniqueSlug('v2-ws'));
  const script = await app.inject({
    method: 'POST',
    url: '/v1/scripts',
    headers: await t.auth(),
    payload: { name: 'WS audit fixture' },
  });
  expect(script.statusCode).toBe(201);
  const version = await app.inject({
    method: 'POST',
    url: `/v1/scripts/${script.json<{ id: string }>().id}/versions`,
    headers: await t.auth(),
    payload: { document: surveyScript, screens: [] },
  });
  expect(version.statusCode).toBe(201);
  const v = version.json<{ id: string; checksum: string }>();
  sessionId = (
    await owner.session.create({
      data: {
        kind: 'preview',
        tenantId: t.tenantId,
        userId: t.adminId,
        scriptVersionId: v.id,
        checksum: v.checksum,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  ).id;
  const browser = await app.get<SessionStore>(SESSION_STORE).create(
    {
      tenantId: t.tenantId,
      userId: t.adminId,
      kind: 'sso',
      protocol: 'oidc',
      app: 'admin',
      ip: '127.0.0.1',
      userAgent: 'verification',
    },
    { idleTimeoutSeconds: 600, absoluteTimeoutSeconds: 3600, maxConcurrent: 10, onLimit: 'deny' },
  );
  headers = {
    cookie: `__Host-verbis_session=${browser.token}`,
    origin: 'http://localhost:5175',
    'x-csrf-token': browser.record.csrfToken,
  };
  // The disposable nginx container reaches the API through the Docker host gateway, so the
  // listener must not be loopback-only (Linux runners have no loopback proxy like Docker Desktop).
  await app.listen(0, '0.0.0.0');
  url = `http://127.0.0.1:${new URL(await app.getUrl()).port}`;
});
afterAll(async () => {
  for (const socket of sockets) socket.close();
  await app.close();
  await owner.$disconnect();
});
async function ticket(afterSequence: number) {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/sessions/${sessionId}/socket-ticket`,
    headers,
    payload: { afterSequence },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ ticket: string }>().ticket;
}
async function connect(code: string, origin = 'http://localhost:5175') {
  const socket = io(url + '/runtime', {
    transports: ['websocket'],
    auth: { ticket: code },
    extraHeaders: { origin },
    reconnection: false,
    autoConnect: false,
  });
  sockets.push(socket);
  const result = new Promise<{ kind: string; payload: { sequence?: number; code?: string } }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('WebSocket handshake timeout'));
      }, 10000);
      socket.once('runtime.resume', (payload) => {
        clearTimeout(timer);
        resolve({ kind: 'resume', payload: payload as { sequence: number } });
      });
      socket.once('runtime.error', (payload) => {
        clearTimeout(timer);
        resolve({ kind: 'error', payload: payload as { code: string } });
      });
      socket.once('connect_error', reject);
    },
  );
  socket.connect();
  return { socket, result: await result };
}
describe('V2 real WebSocket disconnect reconnect', () => {
  it('reconnects with a fresh one-use ticket and resumes the persisted sequence', async () => {
    const code = await ticket(0),
      first = await connect(code);
    expect(first.result.kind).toBe('resume');
    expect(first.result.payload.sequence).toBe(0);
    first.socket.io.engine?.close();
    await expect.poll(() => first.socket.connected).toBe(false);
    const second = await connect(await ticket(0));
    expect(second.result).toMatchObject({ kind: 'resume', payload: { sequence: 0 } });
    const replay = await connect(code);
    expect(replay.result).toMatchObject({
      kind: 'error',
      payload: { code: 'VERBIS_AUTHZ_FORBIDDEN' },
    });
  });
  it('rejects an unauthorized origin on the real WebSocket handshake', async () => {
    const denied = await connect(await ticket(0), 'https://evil.example');
    expect(denied.result).toMatchObject({
      kind: 'error',
      payload: { code: 'VERBIS_AUTHZ_FORBIDDEN' },
    });
  });
  it('wrong-origin cookie launch must be rejected and audited', async () => {
    const correlation = randomUUID();
    const before = await owner.auditEvent.count();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/launch/redeem',
      headers: { ...headers, origin: 'https://evil.example', 'x-correlation-id': correlation },
      payload: { code: 'Q'.repeat(43) },
    });
    writeFileSync(
      evidenceFile('wrong-origin-launch.json'),
      JSON.stringify(
        {
          status: res.statusCode,
          problemCode: res.json<{ code: string }>().code,
          correlationId: String(res.headers['x-correlation-id']),
          auditCount: await owner.auditEvent.count({
            where: { correlationId: String(res.headers['x-correlation-id']) },
          }),
        },
        null,
        2,
      ),
    );
    expect(res.statusCode, res.body).toBe(403);
    expect(
      await owner.auditEvent.count({
        where: { correlationId: String(res.headers['x-correlation-id']) },
      }),
      'every wrong-origin launch denial must be audited',
    ).toBeGreaterThan(0);
    expect(await owner.auditEvent.count()).toBeGreaterThan(before);
  });
  it('real nginx agent bundle blocks a foreign iframe and must audit the rejection', async () => {
    const appPort = new URL(url).port;
    const config = readFileSync(
      new URL('../../deploy/nginx-compose.conf', import.meta.url),
      'utf8',
    ).replace(/\b(?:api|collaboration):\d+/g, `host.docker.internal:${appPort}`);
    const edge = await new GenericContainer('nginxinc/nginx-unprivileged:1.31-alpine')
      .withCopyContentToContainer([{ target: '/etc/nginx/conf.d/default.conf', content: config }])
      .withCopyFilesToContainer([
        {
          source: fileURLToPath(
            new URL('../../infra/docker/security-headers.conf', import.meta.url),
          ),
          target: '/etc/nginx/snippets/security-headers.conf',
        },
        {
          source: fileURLToPath(new URL('../../infra/docker/frame-sources.conf', import.meta.url)),
          target: '/etc/nginx/snippets/frame-sources.conf',
        },
      ])
      .withCopyDirectoriesToContainer([
        {
          source: fileURLToPath(new URL('../../apps/agent-web/dist', import.meta.url)),
          target: '/usr/share/nginx/html',
        },
      ])
      .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forHttp('/health', 8080))
      .start();
    const edgeUrl = `http://${edge.getHost()}:${edge.getMappedPort(8080)}`;
    const parent = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(`<iframe src="${edgeUrl}/launch?scriptId=forged"></iframe>`);
    });
    const browser = await chromium.launch();
    let blocked = false;
    try {
      await new Promise<void>((resolve) => parent.listen(0, '127.0.0.1', resolve));
      const address = parent.address();
      if (!address || typeof address === 'string') throw new Error('No parent address');
      const page = await browser.newPage();
      page.on('console', (message) => {
        if (message.text().includes('frame-ancestors')) blocked = true;
      });
      const nats = app.get(NatsService);
      await nats.ensureStreams();
      const manager = await nats.manager();
      const before = (await manager.streams.info('SECURITY')).state.messages;
      await page.goto(`http://127.0.0.1:${address.port}`);
      await expect.poll(() => blocked).toBe(true);
      const response = await fetch(edgeUrl + '/launch');
      await expect
        .poll(async () => (await manager.streams.info('SECURITY')).state.messages, {
          timeout: 10000,
        })
        .toBeGreaterThan(before);
      const after = (await manager.streams.info('SECURITY')).state.messages;
      const message = await manager.streams.getMessage('SECURITY', {
        last_by_subj: 'verbis.security.csp.reported.v1',
      });
      if (message === null) throw new Error('Security report was not retained');
      const signal = JSON.parse(new TextDecoder().decode(message.data)) as {
        source: string;
        directive: string;
        documentOrigin: string;
      };
      expect(signal).toMatchObject({
        source: 'untrusted-browser-report',
        directive: 'frame-ancestors',
        documentOrigin: new URL(edgeUrl).origin,
      });
      writeFileSync(
        evidenceFile('iframe-observations.json'),
        JSON.stringify(
          {
            image: 'nginxinc/nginx-unprivileged:1.31-alpine',
            headersSource: 'infra/docker/security-headers.conf:2',
            htmlStatus: response.status,
            csp: response.headers.get('content-security-policy'),
            foreignIframeBlocked: blocked,
            auditDelta: after - before,
            scope:
              'Existing built agent bundle, repository nginx and security snippets, only upstream addresses changed for disposable API; no production image build claim.',
          },
          null,
          2,
        ),
      );
      expect(
        after - before,
        'every foreign iframe rejection must reach the durable security journal',
      ).toBeGreaterThan(0);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) =>
        parent.close(() => {
          resolve();
        }),
      );
      await edge.stop();
    }
  });
});
