import { describe, expect, it } from 'vitest';

import { requestContext } from '../../../common/context/request-context.js';

import {
  EngageLinkConfigSchema,
  EngageLinkError,
  engageAuthorizeUrl,
  platformUserIdOf,
  withEngageIdentity,
  type EngageLink,
  type EngageLinkState,
  type EngageLinkStore,
} from './engage-agent-link.js';
import { EngageAgentLinkService } from './engage-agent-link.service.js';

const TENANT = '0190f000-0000-7000-8000-00000000beef';
const USER = '0190f000-0000-7000-8000-000000000001';
const CONNECTOR = '0190f000-0000-7000-8000-00000000e001';
const SECRET = '0190f000-0000-7000-8000-00000000500c';
const config = {
  kind: 'workspace',
  baseUrl: 'https://gws.acme.internal',
  authUrl: 'https://gauth.acme.internal',
  authClientId: 'verbis',
  redirectUri: 'https://acme.agent.example/api/v1/genesys-engage/oauth/callback',
  secrets: { authClientSecret: SECRET },
};

function fakeAuth(
  options: {
    refreshFails?: boolean;
    missingRefresh?: boolean;
    exchangeThrows?: boolean;
    userInfoMissing?: boolean;
  } = {},
) {
  const calls: { url: string; body: string | undefined; auth: string | null }[] = [];
  let n = 0;
  const fetchImpl = ((input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      body: typeof init.body === 'string' ? init.body : undefined,
      auth: new Headers(init.headers).get('authorization'),
    });
    if (url === 'https://gauth.acme.internal/auth/v3/oauth/token') {
      if (options.exchangeThrows) return Promise.reject(new Error('synthetic exchange failure'));
      const grant = new URLSearchParams(typeof init.body === 'string' ? init.body : '').get(
        'grant_type',
      );
      if (grant === 'refresh_token' && options.refreshFails === true)
        return Promise.resolve(new Response(null, { status: 400 }));
      n += 1;
      return Promise.resolve(
        Response.json({
          access_token: `at-${String(n)}`,
          ...(options.missingRefresh ? {} : { refresh_token: `rt-${String(n)}` }),
          expires_in: 900,
        }),
      );
    }
    if (url === 'https://gauth.acme.internal/auth/v3/userinfo')
      return Promise.resolve(
        Response.json(options.userInfoMissing ? {} : { employeeId: 'E1001', username: 'ayse.k' }),
      );
    return Promise.resolve(new Response(null, { status: 404 }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function memoryStore(): EngageLinkStore & { links: Map<string, EngageLink> } {
  const states = new Map<string, EngageLinkState>();
  const links = new Map<string, EngageLink>();
  return {
    links,
    putState: (s, v) => Promise.resolve(void states.set(s, v)),
    takeState: (s) => {
      const v = states.get(s);
      states.delete(s);
      return Promise.resolve(v);
    },
    putLink: (_t, c, l) => Promise.resolve(void links.set(`${c}:${l.platformUserId}`, l)),
    getLink: (_t, c, p) => Promise.resolve(links.get(`${c}:${p}`)),
    deleteLink: (_t, c, p) => Promise.resolve(void links.delete(`${c}:${p}`)),
    listLinks: (_t, c) =>
      Promise.resolve(
        [...links.values()]
          .filter((l) => links.has(`${c}:${l.platformUserId}`) && l.expiresAt > Date.now())
          .map((l) => l.platformUserId),
      ),
  };
}

function build(
  options: {
    owners?: { id: string }[];
    refreshFails?: boolean;
    missingRefresh?: boolean;
    exchangeThrows?: boolean;
    userInfoMissing?: boolean;
    connector?: { config: unknown; secretRefs: string[] } | null;
    secretMissing?: boolean;
    identities?: unknown;
  } = {},
) {
  const store = memoryStore();
  const audits: { action: string; reason?: string }[] = [];
  const updates: unknown[] = [];
  const tx = {
    connector: {
      findFirst: () =>
        Promise.resolve(
          options.connector === undefined ? { config, secretRefs: [SECRET] } : options.connector,
        ),
      findMany: () => Promise.resolve([{ id: CONNECTOR, config }]),
    },
    secret: {
      findFirst: () =>
        Promise.resolve(
          options.secretMissing ? null : { keyVersion: 1, ciphertext: Buffer.from('x') },
        ),
    },
    user: {
      findMany: () => Promise.resolve(options.owners ?? []),
      findFirst: () =>
        Promise.resolve({
          ctiIdentities: options.identities ?? [
            { platform: 'genesys_engage', id: 'E1001', connectorId: CONNECTOR },
          ],
        }),
      findFirstOrThrow: () => Promise.resolve({ ctiIdentities: [] }),
      update: (args: unknown) => Promise.resolve(void updates.push(args)),
    },
  };
  const db = { current: () => tx, tenantId: () => TENANT };
  const audit = {
    record: (_tx: unknown, input: { action: string; reason?: string }) =>
      Promise.resolve(void audits.push(input)),
  };
  const vault = { decrypt: () => Promise.resolve('gauth-client-secret-test') };
  const auth = fakeAuth(options);
  const service = new EngageAgentLinkService(
    db as never,
    audit as never,
    vault as never,
    {} as never,
    {} as never,
    store,
    auth.fetchImpl,
  );
  return { service, store, audits, updates, auth };
}

const agent = <T>(fn: () => Promise<T>, sessionId = 'sid-1') =>
  requestContext.run(
    {
      requestId: 'r',
      correlationId: 'c',
      ip: '',
      userAgent: '',
      principal: {
        type: 'user',
        id: USER,
        tenantId: TENANT,
        scopes: [],
        sessionId,
        authMethod: 'sso',
      },
    },
    fn,
  );
const hub = <T>(fn: () => Promise<T>) =>
  requestContext.run(
    {
      requestId: 'r',
      correlationId: 'c',
      ip: '',
      userAgent: '',
      principal: {
        type: 'service',
        id: 'connector-hub',
        tenantId: TENANT,
        scopes: [],
        certificateThumbprint: 'x5t',
      },
    },
    fn,
  );

describe('genesys engage delegated agent link', () => {
  it('builds the Genesys Authentication authorize URL (code grant, state)', () => {
    const url = new URL(engageAuthorizeUrl(EngageLinkConfigSchema.parse(config), 'st'));
    expect(url.origin + url.pathname).toBe('https://gauth.acme.internal/auth/v3/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('reads the configured agent identity from userinfo and refuses a missing one', async () => {
    const { fetchImpl } = fakeAuth();
    expect(await platformUserIdOf(fetchImpl, EngageLinkConfigSchema.parse(config), 'at')).toBe(
      'E1001',
    );
    expect(
      await platformUserIdOf(
        fetchImpl,
        EngageLinkConfigSchema.parse({ ...config, agentIdentity: 'userName' }),
        'at',
      ),
    ).toBe('ayse.k');
    await expect(
      platformUserIdOf(
        fetchImpl,
        EngageLinkConfigSchema.parse({ ...config, agentIdentity: 'agentLoginId' }),
        'at',
      ),
    ).rejects.toBeInstanceOf(EngageLinkError);
  });

  it('links, stores the refresh token sealed server-side, and vends tokens only to the mTLS hub', async () => {
    const { service, store, audits, updates, auth } = build();
    const state =
      new URL(await agent(() => service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await agent(() => service.complete('code-1', state));
    expect(store.links.get(`${CONNECTOR}:E1001`)).toMatchObject({
      userId: USER,
      refreshToken: 'rt-1',
    });
    expect(JSON.stringify(updates)).toContain('genesys_engage');
    expect(auth.calls[0]?.auth).toBe(
      `Basic ${Buffer.from('verbis:gauth-client-secret-test').toString('base64')}`,
    );
    expect(await hub(() => service.linkedAgents(CONNECTOR))).toEqual({ agents: ['E1001'] });
    const token = await hub(() => service.agentToken(CONNECTOR, 'E1001'));
    expect(token.accessToken).toBe('at-1');
    await expect(agent(() => service.agentToken(CONNECTOR, 'E1001'))).rejects.toThrow();
    expect(audits.map((a) => a.action)).toEqual([
      'user.ctiIdentity.linked',
      'connector.agentToken.issued',
    ]);
    expect(await agent(() => service.status())).toEqual([
      { connectorId: CONNECTOR, linked: true, expiresAt: expect.any(String) as string },
    ]);
  });

  it('refreshes expired access tokens and drops the link when Genesys refuses the refresh', async () => {
    const ok = build();
    const s1 =
      new URL(await agent(() => ok.service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await agent(() => ok.service.complete('c', s1));
    const link = ok.store.links.get(`${CONNECTOR}:E1001`);
    if (link !== undefined)
      ok.store.links.set(`${CONNECTOR}:E1001`, { ...link, accessExpiresAt: Date.now() - 1 });
    expect((await hub(() => ok.service.agentToken(CONNECTOR, 'E1001'))).accessToken).toBe('at-2');
    expect(ok.store.links.get(`${CONNECTOR}:E1001`)?.refreshToken).toBe('rt-2');

    const bad = build({ refreshFails: true });
    const s2 =
      new URL(await agent(() => bad.service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await agent(() => bad.service.complete('c', s2));
    const l2 = bad.store.links.get(`${CONNECTOR}:E1001`);
    if (l2 !== undefined)
      bad.store.links.set(`${CONNECTOR}:E1001`, { ...l2, accessExpiresAt: Date.now() - 1 });
    await expect(hub(() => bad.service.agentToken(CONNECTOR, 'E1001'))).rejects.toThrow();
    expect(bad.store.links.size).toBe(0);
  });

  it('refuses replayed state, other sessions and identities owned by someone else', async () => {
    const a = build();
    const state =
      new URL(await agent(() => a.service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await expect(agent(() => a.service.complete('c', state), 'sid-other')).rejects.toMatchObject({
      reason: 'session_mismatch',
    });
    await expect(agent(() => a.service.complete('c', state))).rejects.toMatchObject({
      reason: 'state_invalid',
    });
    const b = build({ owners: [{ id: 'someone' }] });
    const s =
      new URL(await agent(() => b.service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await expect(agent(() => b.service.complete('c', s))).rejects.toMatchObject({
      reason: 'identity_conflict',
    });
    expect(b.store.links.size).toBe(0);
  });

  it('replaces only this connector’s Engage identity', () => {
    expect(
      withEngageIdentity(
        [
          { platform: 'genesys_engage', id: 'old', connectorId: CONNECTOR },
          { platform: 'cisco', id: '1' },
        ],
        CONNECTOR,
        'E1001',
        't',
      ),
    ).toEqual([
      { platform: 'cisco', id: '1' },
      {
        platform: 'genesys_engage',
        id: 'E1001',
        connectorId: CONNECTOR,
        source: 'genesys-auth-code',
        linkedAt: 't',
      },
    ]);
  });
});

describe('Engage link authorization and failure recovery', () => {
  it.each([
    { connector: null },
    { connector: { config: {}, secretRefs: [] } },
    { connector: { config: { ...config, secrets: {} }, secretRefs: [] } },
    { connector: { config, secretRefs: [] } },
    { secretMissing: true },
  ])('rejects an unavailable or unbound connector credential (%j)', async (options) => {
    const f = build(options);
    await expect(agent(() => f.service.start(CONNECTOR))).rejects.toMatchObject({
      reason: 'connector_invalid',
    });
    expect(f.auth.calls).toEqual([]);
    expect(f.store.links.size).toBe(0);
  });
  it.each([
    { missingRefresh: true, reason: 'exchange_failed' },
    { exchangeThrows: true, reason: 'exchange_failed' },
    { userInfoMissing: true, reason: 'identity_missing' },
  ])(
    'rejects an incomplete upstream authorization response (%j)',
    async ({ reason, ...options }) => {
      const f = build(options);
      const state =
        new URL(await agent(() => f.service.start(CONNECTOR))).searchParams.get('state') ?? '';
      await expect(agent(() => f.service.complete('synthetic-code', state))).rejects.toMatchObject({
        reason,
      });
      expect(f.store.links.size).toBe(0);
      expect(f.updates).toEqual([]);
      expect(f.audits).toContainEqual(
        expect.objectContaining({ action: 'user.ctiIdentity.linkDenied', reason }),
      );
    },
  );
  it('reports missing or foreign author links as unlinked and makes repeated unlink harmless', async () => {
    const f = build({ identities: [] });
    expect(await agent(() => f.service.status())).toEqual([
      { connectorId: CONNECTOR, linked: false, expiresAt: null },
    ]);
    await agent(() => f.service.unlink(CONNECTOR));
    expect(f.audits).toEqual([]);
    const linked = build();
    const state =
      new URL(await agent(() => linked.service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await agent(() => linked.service.complete('code', state));
    await agent(() => linked.service.unlink(CONNECTOR));
    expect(linked.store.links.size).toBe(0);
    expect(linked.audits.at(-1)?.action).toBe('connector.agentLink.revoked');
    await expect(hub(() => linked.service.agentToken(CONNECTOR, 'E1001'))).rejects.toThrow();
    linked.store.links.set(`${CONNECTOR}:E1001`, {
      userId: 'foreign-user',
      platformUserId: 'E1001',
      refreshToken: 'synthetic',
      linkedAt: new Date().toISOString(),
      expiresAt: Date.now() + 100000,
    });
    expect(await agent(() => linked.service.status())).toEqual([
      { connectorId: CONNECTOR, linked: false, expiresAt: null },
    ]);
  });
  it('refreshes links without cached access tokens and retains the old refresh token when none rotates', async () => {
    const f = build({ missingRefresh: true });
    f.store.links.set(`${CONNECTOR}:E1001`, {
      userId: USER,
      platformUserId: 'E1001',
      refreshToken: 'synthetic-original-refresh',
      linkedAt: new Date().toISOString(),
      expiresAt: Date.now() + 100000,
    });
    expect((await hub(() => f.service.agentToken(CONNECTOR, 'E1001'))).accessToken).toBe('at-1');
    expect(f.store.links.get(`${CONNECTOR}:E1001`)?.refreshToken).toBe(
      'synthetic-original-refresh',
    );
  });
  it('rejects absent, break-glass and sessionless agent principals and certificate-free services', async () => {
    const f = build();
    await expect(f.service.status()).rejects.toMatchObject({ reason: 'session_mismatch' });
    await expect(hub(() => f.service.status())).rejects.toMatchObject({
      reason: 'session_mismatch',
    });
    for (const principal of [
      {
        type: 'user' as const,
        id: USER,
        tenantId: TENANT,
        scopes: [],
        sessionId: 'sid',
        authMethod: 'break_glass' as const,
      },
      { type: 'user' as const, id: USER, tenantId: TENANT, scopes: [] },
    ])
      await expect(
        requestContext.run(
          { requestId: 'r', correlationId: 'c', ip: '', userAgent: '', principal },
          () => f.service.status(),
        ),
      ).rejects.toMatchObject({ reason: 'session_mismatch' });
    await expect(
      requestContext.run(
        {
          requestId: 'r',
          correlationId: 'c',
          ip: '',
          userAgent: '',
          principal: { type: 'service', id: 'service', tenantId: TENANT, scopes: [] },
        },
        () => f.service.linkedAgents(CONNECTOR),
      ),
    ).rejects.toThrow('mTLS');
    await expect(f.service.linkedAgents(CONNECTOR)).rejects.toThrow('mTLS');
  });
});
