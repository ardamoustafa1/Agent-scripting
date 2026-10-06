import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signWebhook } from '@verbis/sdk-connector';

import { createHub } from '../bootstrap.js';
import { loadHubEnv } from '../env.js';
import { ConnectorSupervisor } from '../runtime/connector-supervisor.js';
import { EventPipeline } from '../runtime/event-pipeline.js';
import { FakeVerbisApi, TENANT_ID } from '../test/fake-api.js';
import { loadScenario } from '../test/scenario.js';

const WEBHOOK = '0190f000-0000-7000-8000-0000000000a1';
const SIM = '0190f000-0000-7000-8000-0000000000b1';
const SECRET = 'whsec-http-test-0001';
const AGENT = '0190f000-0000-7000-8000-0000000000c1';

let app: NestFastifyApplication;
let api: FakeVerbisApi;
let key: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  key = pair.privateKey;
  const jwks = JSON.stringify({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'api-1', alg: 'EdDSA' }],
  });
  api = new FakeVerbisApi();
  api.connectors = [
    {
      id: WEBHOOK,
      adapterType: 'generic',
      platform: 'generic',
      config: { kind: 'webhook' },
      version: 1,
    },
    {
      id: SIM,
      adapterType: 'generic',
      platform: 'generic',
      config: { kind: 'simulator' },
      version: 1,
    },
  ];
  api.secrets = { [WEBHOOK]: { signingSecret: SECRET } };
  api.users = { 'agent-007': AGENT, 'sim-agent': AGENT };
  app = await createHub(
    loadHubEnv({
      LOG_LEVEL: 'fatal',
      HUB_TRUSTED_JWKS: jwks,
      SIMULATOR_ENABLED: 'true',
      NODE_ENV: 'test',
    }),
    { api, autoStart: false },
    false,
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await app.get(ConnectorSupervisor).sync();
});

afterAll(async () => {
  await app.close();
});

const token = (claims: Record<string, unknown> = {}, audience = 'verbis-connector-hub') =>
  new SignJWT({ tnt: TENANT_ID, typ: 'service', ...claims })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'api-1' })
    .setIssuer('verbis-api')
    .setAudience(audience)
    .setSubject('verbis-api')
    .setIssuedAt()
    .setExpirationTime('60s')
    .setJti(crypto.randomUUID())
    .sign(key);

async function internal(method: 'GET' | 'POST', url: string, payload?: unknown, auth?: string) {
  return app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${auth ?? (await token())}`,
      'content-type': 'application/json',
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}

function signed(payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-verbis-signature': signWebhook(secret, body, Math.floor(Date.now() / 1000)),
    },
  };
}

describe('generic webhook endpoint', () => {
  const voice = loadScenario(
    new URL('../connectors/generic-webhook/fixtures/voice-call.json', import.meta.url),
  );

  it('accepts signed events, forwards them to the API and launches on connect', async () => {
    for (const fixture of voice.fixtures.slice(0, 2)) {
      const { body, headers } = signed(fixture.payload);
      const res = await app.inject({
        method: 'POST',
        url: `/webhooks/${WEBHOOK}`,
        headers,
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(202);
    }
    await app.get(EventPipeline).drain();
    expect(api.ingested.map((i) => i.event.type)).toEqual(['interactionOffered', 'connected']);
    expect(api.launches).toEqual([
      expect.objectContaining({ connectorId: WEBHOOK, userId: AGENT }),
    ]);
  });

  it('refuses bad signatures (401), unknown connectors (404) and invalid payloads (422)', async () => {
    const { body, headers } = signed(voice.fixtures[0]?.payload, 'wrong-secret');
    expect(
      (await app.inject({ method: 'POST', url: `/webhooks/${WEBHOOK}`, headers, payload: body }))
        .statusCode,
    ).toBe(401);
    const ok = signed(voice.fixtures[0]?.payload);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/webhooks/0190f000-0000-7000-8000-000000000999`,
          headers: ok.headers,
          payload: ok.body,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/webhooks/${SIM}`,
          headers: ok.headers,
          payload: ok.body,
        })
      ).statusCode,
    ).toBe(404);
    const bad = signed({ id: 'x', type: 'interaction.offered' });
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/${WEBHOOK}`,
      headers: bad.headers,
      payload: bad.body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('internal API (API → hub)', () => {
  it('requires a valid API token', async () => {
    expect((await app.inject({ method: 'GET', url: '/internal/v1/connectors' })).statusCode).toBe(
      401,
    );
    expect(
      (await internal('GET', '/internal/v1/connectors', undefined, await token({}, 'someone-else')))
        .statusCode,
    ).toBe(401);
    expect(
      (await internal('GET', '/internal/v1/connectors', undefined, 'garbage')).statusCode,
    ).toBe(401);
    const res = await internal('GET', '/internal/v1/connectors');
    expect(res.statusCode).toBe(200);
    expect(res.json<{ connectors: unknown[] }>().connectors).toHaveLength(2);
  });

  it('scopes connectors to the token tenant', async () => {
    const foreign = await token({ tnt: '0190f000-0000-7000-8000-0000000000bb' });
    expect(
      (await internal('GET', '/internal/v1/connectors', undefined, foreign)).json<{
        connectors: unknown[];
      }>().connectors,
    ).toEqual([]);
    expect(
      (await internal('GET', `/internal/v1/simulator/${SIM}`, undefined, foreign)).statusCode,
    ).toBe(404);
  });

  it('verifies participants for secure launch', async () => {
    const verify = (ids: string[], pid = 'call-1001') =>
      internal('POST', `/internal/v1/connectors/${WEBHOOK}/verify-participant`, {
        platformUserIds: ids,
        platformInteractionId: pid,
      });
    expect((await verify(['nobody', 'agent-007'])).json()).toEqual({ verified: true });
    expect((await verify(['nobody'])).json()).toEqual({ verified: false });
    expect((await verify(['agent-007'], 'other-call')).json()).toEqual({ verified: false });
  });

  it('drives the simulator: chat → connect → runtime command recorded', async () => {
    const created = await internal('POST', `/internal/v1/simulator/${SIM}/interactions`, {
      channel: 'chat',
      agentPlatformUserId: 'sim-agent',
      message: 'Merhaba',
      autoConnect: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const pid = created.json<{ platformInteractionId: string }>().platformInteractionId;
    const cmd = await internal('POST', `/internal/v1/connectors/${SIM}/commands/setWrapUp`, {
      platformInteractionId: pid,
      commandId: 'cmd-0001',
      wrapUp: { code: 'SOLVED' },
    });
    expect(cmd.statusCode, cmd.body).toBe(204);
    expect(
      (await internal('POST', `/internal/v1/connectors/${SIM}/commands/explode`, {})).statusCode,
    ).toBe(404);
    expect(
      (
        await internal('POST', `/internal/v1/connectors/${WEBHOOK}/commands/pauseRecording`, {
          platformInteractionId: 'call-1001',
          commandId: 'cmd-0002',
        })
      ).statusCode,
    ).toBe(422);
    const ended = await internal(
      'POST',
      `/internal/v1/simulator/${SIM}/interactions/${pid}/actions`,
      { action: 'wrapup' },
    );
    expect(ended.json()).toMatchObject({ status: 'wrapup' });
    const state = (await internal('GET', `/internal/v1/simulator/${SIM}`)).json<{
      commands: { command: string }[];
    }>();
    expect(state.commands.map((c) => c.command)).toEqual(['setWrapUp']);
    await app.get(EventPipeline).drain();
    expect(api.launches.some((l) => l.connectorId === SIM)).toBe(true);
  });
});

it('rejects malformed internal commands and simulator requests without reaching a connector', async () => {
  expect(
    (await internal('POST', `/internal/v1/connectors/${SIM}/verify-participant`, {})).json(),
  ).toEqual({ verified: false });
  expect(
    (await internal('POST', `/internal/v1/connectors/${SIM}/commands/writeAttributes`, {}))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await internal('POST', `/internal/v1/connectors/${SIM}/commands/setWrapUp`, {
        platformInteractionId: 'synthetic',
        commandId: 'cmd-no-wrapup',
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await internal('POST', `/internal/v1/simulator/${SIM}/interactions`, { channel: 'invalid' }))
      .statusCode,
  ).toBe(422);
  expect(
    (
      await internal('POST', `/internal/v1/simulator/${SIM}/interactions/missing/actions`, {
        action: 'connect',
      })
    ).statusCode,
  ).toBe(422);
  expect((await internal('GET', `/internal/v1/simulator/${WEBHOOK}`)).statusCode).toBe(404);
});
it('executes attribute and recording commands through authenticated tenant-scoped routes', async () => {
  const created = await internal('POST', `/internal/v1/simulator/${SIM}/interactions`, {
    channel: 'voice',
    agentPlatformUserId: 'synthetic-agent',
    autoConnect: true,
  });
  expect(created.statusCode).toBe(201);
  const pid = created.json<{ platformInteractionId: string }>().platformInteractionId;
  for (const [index, name] of ['writeAttributes', 'pauseRecording', 'resumeRecording'].entries()) {
    const result = await internal('POST', `/internal/v1/connectors/${SIM}/commands/${name}`, {
      platformInteractionId: pid,
      commandId: `synthetic-command-${String(index)}`,
    });
    expect(result.statusCode, result.body).toBe(204);
  }
  expect(
    (
      await internal('POST', `/internal/v1/connectors/${SIM}/commands/writeAttributes`, {
        platformInteractionId: pid,
        commandId: 'synthetic-attributes',
        attributes: { synthetic: 'value' },
      })
    ).statusCode,
  ).toBe(204);
  const state = (await internal('GET', `/internal/v1/simulator/${SIM}`)).json<{
    commands: { command: string }[];
  }>();
  expect(state.commands.slice(-4).map((command) => command.command)).toEqual([
    'writeAttributes',
    'pauseRecording',
    'resumeRecording',
    'writeAttributes',
  ]);
});
