import { expect, it, vi } from 'vitest';

import { requestContext } from '../../common/context/request-context.js';

import { newLaunchCode } from './domain/launch.js';
import { LaunchService } from './launch.service.js';

import type { LaunchAttempts } from './launch-attempts.js';
import type { LaunchPorts } from './launch-ports.js';
import type { LaunchReplayGuard } from './launch-replay.js';
import type { Principal } from '../../common/security/principal.js';
import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { RedisService } from '../../infra/redis/redis.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthzService } from '../authz/authz.service.js';
import type { ResolverService } from '../routing/resolver.service.js';
import type { RuntimeEngineService } from '../runtime/runtime-engine.service.js';

const id = '01990000-0000-7000-8000-000000000001';
const now = new Date('2026-10-06T12:00:00Z');
function fixture() {
  const tx = {
    connector: { findFirst: vi.fn().mockResolvedValue({ id }) },
    user: { findFirst: vi.fn().mockResolvedValue({ id, ctiIdentities: [] }) },
    interaction: {
      findFirst: vi.fn().mockResolvedValue({
        id,
        status: 'connected',
        endedAt: null,
        agentId: id,
        campaignId: id,
        channelType: 'voice',
        queue: null,
        externalId: 'external',
        platform: 'test',
      }),
    },
    launchIntent: {
      create: vi.fn().mockResolvedValue({ id }),
      findFirst: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id,
        tenantId: id,
        userId: id,
        state: 'pending',
        expiresAt: new Date(now.getTime() + 60000),
        interactionId: id,
        connectorId: null,
        flow: 's2s',
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    launchTrustedIssuer: { findFirst: vi.fn().mockResolvedValue(null) },
    groupMember: { findFirst: vi.fn().mockResolvedValue(null) },
    scriptVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    session: { create: vi.fn().mockResolvedValue({ id }) },
    $queryRaw: vi.fn().mockResolvedValue([{ id, settings: {} }]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const db = {
    current: () => tx,
    run: (_tenant: string, work: (transaction: typeof tx) => unknown) => Promise.resolve(work(tx)),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) },
    outbox = { record: vi.fn().mockResolvedValue(undefined) },
    authz = { can: vi.fn().mockReturnValue(false) };
  const resolver = {
    resolve: vi
      .fn()
      .mockResolvedValue({ outcome: 'resolved', version: { id, checksum: 'checksum' }, trace: {} }),
  };
  const engine = {
    initialize: vi.fn().mockResolvedValue(undefined),
    routingInput: vi.fn().mockReturnValue({ attributes: {}, routing: {} }),
    mappedPlatformIdentity: vi.fn().mockReturnValue('platform-agent'),
  };
  const attempts = {
    blocked: vi.fn().mockResolvedValue(false),
    fail: vi.fn().mockResolvedValue({ anomaly: false, count: 1 }),
  };
  const ports = { verify: vi.fn().mockResolvedValue(undefined) };
  const service = new LaunchService(
    db as unknown as TenantDb,
    audit as unknown as AuditService,
    outbox,
    authz as unknown as AuthzService,
    { client: { set: vi.fn().mockResolvedValue('OK') } } as unknown as RedisService,
    resolver as unknown as ResolverService,
    engine as unknown as RuntimeEngineService,
    ports as unknown as LaunchPorts,
    attempts as unknown as LaunchAttempts,
    { consume: vi.fn() } as unknown as LaunchReplayGuard,
    () => now,
  );
  const principal: Principal = {
    id,
    tenantId: id,
    type: 'user',
    scopes: [],
    authMethod: 'sso',
    sessionId: 'bff',
  };
  const run = <T>(work: () => T, actor = principal) =>
    requestContext.run(
      { principal: actor, requestId: 'test', correlationId: 'test', ip: '', userAgent: '' },
      work,
    );
  return { service, tx, run, principal, authz, attempts, resolver, engine, ports };
}
it.each(['service', 'break-glass', 'missing-session', 'inactive-user'])(
  'rejects embedded launch for %s before creating a session',
  async (kind) => {
    const f = fixture();
    const { sessionId: _session, ...withoutSession } = f.principal;
    const actor: Principal =
      kind === 'service'
        ? { ...f.principal, type: 'service' }
        : kind === 'break-glass'
          ? { ...f.principal, authMethod: 'break_glass' }
          : kind === 'missing-session'
            ? withoutSession
            : f.principal;
    if (kind === 'inactive-user') f.tx.user.findFirst.mockResolvedValue(null);
    await expect(
      f.run(() => f.service.embedded({ connectorId: id, conversationId: 'external' }), actor),
    ).rejects.toMatchObject({ code: 'VERBIS_LAUNCH_DENIED' });
    expect(f.tx.session.create).not.toHaveBeenCalled();
  },
);
it('rejects missing mTLS, inactive connectors and unavailable preview/live-data permissions', async () => {
  const f = fixture();
  await expect(
    f.run(
      () =>
        f.service.createIntent({
          connectorId: id,
          userId: id,
          interactionId: id,
          delivery: 'fragment',
        }),
      { ...f.principal, type: 'service' },
    ),
  ).rejects.toMatchObject({ code: 'VERBIS_LAUNCH_DENIED' });
  f.tx.connector.findFirst.mockResolvedValue(null);
  await expect(
    f.run(
      () =>
        f.service.createIntent({
          connectorId: id,
          userId: id,
          interactionId: id,
          delivery: 'fragment',
        }),
      { ...f.principal, type: 'service', certificateThumbprint: 'bound' },
    ),
  ).rejects.toMatchObject({ code: 'VERBIS_LAUNCH_DENIED' });
  await expect(
    f.run(
      () =>
        f.service.preview({
          scriptVersionId: id,
          liveDataSources: false,
          mockInteraction: { channel: 'voice', attributes: {} },
        }),
      { ...f.principal, type: 'service' },
    ),
  ).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
  await expect(
    f.run(() =>
      f.service.preview({
        scriptVersionId: id,
        liveDataSources: false,
        mockInteraction: { channel: 'voice', attributes: {} },
      }),
    ),
  ).rejects.toMatchObject({ code: 'VERBIS_RESOURCE_NOT_FOUND' });
  f.tx.scriptVersion.findFirst.mockResolvedValue({ id, scriptId: id, checksum: 'checksum' });
  await expect(
    f.run(() =>
      f.service.preview({
        scriptVersionId: id,
        liveDataSources: true,
        mockInteraction: { channel: 'voice', attributes: {} },
      }),
    ),
  ).rejects.toMatchObject({ code: 'VERBIS_AUTHZ_FORBIDDEN' });
});
it.each([
  'missing-campaign',
  'invalid-routing',
  'unresolved',
  'missing-version',
  'lost-redemption-fence',
])('never initializes a session when redemption has %s', async (kind) => {
  const f = fixture();
  if (kind === 'missing-campaign')
    f.tx.interaction.findFirst.mockResolvedValue({
      ...(await f.tx.interaction.findFirst()),
      campaignId: null,
    });
  if (kind === 'invalid-routing')
    f.tx.interaction.findFirst.mockResolvedValue({
      ...(await f.tx.interaction.findFirst()),
      channelType: 'bogus',
    });
  if (kind === 'unresolved')
    f.resolver.resolve.mockResolvedValue({ outcome: 'unresolved', trace: {} });
  if (kind === 'missing-version')
    f.resolver.resolve.mockResolvedValue({ outcome: 'resolved', trace: {} });
  if (kind === 'lost-redemption-fence')
    f.tx.launchIntent.updateMany.mockResolvedValue({ count: 0 });
  await expect(f.run(() => f.service.redeem(newLaunchCode()))).rejects.toThrow();
  expect(f.engine.initialize).not.toHaveBeenCalled();
});
it.each([
  null,
  [],
  'untrusted',
  {
    bad: {},
    'invalid-key!': true,
    customer: 'synthetic',
    nested: [],
    count: 2,
    ok: true,
    absent: null,
  },
])('accepts only flat routing attributes: %j', async (attributes) => {
  const f = fixture();
  f.engine.routingInput.mockReturnValue({ attributes, routing: {} });
  f.tx.user.findFirst.mockResolvedValue({ id, ctiIdentities: {} });
  const result = await f.run(() => f.service.redeem(newLaunchCode()));
  expect(result.path).toBe(`/s/${result.sessionId}`);
  const routingCall = f.resolver.resolve.mock.calls[0]![0] as unknown as { attributes: unknown };
  expect(routingCall.attributes).toEqual(
    attributes && !Array.isArray(attributes) && typeof attributes === 'object'
      ? { customer: 'synthetic', count: 2, ok: true, absent: null }
      : {},
  );
  const sessionCall = f.tx.session.create.mock.calls[0]![0] as unknown as { data: unknown };
  expect(sessionCall.data).toMatchObject({
    teamId: null,
    assignmentId: null,
  });
});
it('denies unknown/malformed trusted issuer keys and a blocked caller without issuing an intent', async () => {
  const f = fixture();
  const token = `e30.${Buffer.from(JSON.stringify({ iss: 'tenant-issuer' })).toString('base64url')}.signature`;
  await expect(f.run(() => f.service.jws(token))).rejects.toMatchObject({
    code: 'VERBIS_LAUNCH_DENIED',
  });
  f.tx.launchTrustedIssuer.findFirst.mockResolvedValue({
    id,
    issuer: 'tenant-issuer',
    jwks: { keys: [{ kty: 'oct', k: 'secret' }] },
  });
  await expect(f.run(() => f.service.jws(token))).rejects.toMatchObject({
    code: 'VERBIS_LAUNCH_DENIED',
  });
  f.attempts.blocked.mockResolvedValue(true);
  await expect(f.run(() => f.service.redeem(newLaunchCode()))).rejects.toMatchObject({
    code: 'VERBIS_LAUNCH_RATE_LIMITED',
  });
  expect(f.tx.launchIntent.create).not.toHaveBeenCalled();
});
