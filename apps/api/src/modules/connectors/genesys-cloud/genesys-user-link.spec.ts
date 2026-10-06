import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { requestContext } from '../../../common/context/request-context.js';

import {
  authorizeUrl,
  createPkce,
  GenesysLinkError,
  proveIdentity,
  UserAuthConfigSchema,
  withGenesysIdentity,
  type LinkState,
  type LinkStateStore,
} from './genesys-user-link.js';
import { GenesysUserLinkService } from './genesys-user-link.service.js';

const TENANT = '0190f000-0000-7000-8000-00000000beef';
const USER = '0190f000-0000-7000-8000-000000000001';
const OTHER = '0190f000-0000-7000-8000-000000000002';
const CONNECTOR = '0190f000-0000-7000-8000-00000000c0de';
const ORG = '0f0c2a1e-0000-4000-8000-0000000000aa';
const GC_USER = '0f0c2a1e-0000-4000-8000-000000000101';
const config = {
  kind: 'cloud',
  region: 'mypurecloud.de',
  organizationId: ORG,
  userAuth: {
    clientId: '0f0c2a1e-0000-4000-8000-0000000000c1',
    redirectUri: 'https://acme.agent.example/api/v1/genesys-cloud/oauth/callback',
  },
  queueIds: [],
};

function fakeGenesys(org = ORG) {
  const calls: { url: string; body: string | undefined; auth: string | null }[] = [];
  const fetchImpl = ((input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      body: typeof init.body === 'string' ? init.body : undefined,
      auth: new Headers(init.headers).get('authorization'),
    });
    if (url === 'https://login.mypurecloud.de/oauth/token')
      return Promise.resolve(
        Response.json({ access_token: 'user-token-xyz', token_type: 'bearer', expires_in: 3600 }),
      );
    if (url === 'https://api.mypurecloud.de/api/v2/users/me')
      return Promise.resolve(Response.json({ id: GC_USER, email: 'agent@acme.test' }));
    if (url === 'https://api.mypurecloud.de/api/v2/organizations/me')
      return Promise.resolve(Response.json({ id: org }));
    return Promise.resolve(new Response(null, { status: 404 }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('genesys user link (PKCE)', () => {
  it('creates an S256 challenge from a 43-char verifier and a random state', () => {
    const pkce = createPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'));
  });

  it('builds the authorize URL on the region login host (code + S256, no implicit grant)', () => {
    const parsed = UserAuthConfigSchema.parse(config);
    const url = new URL(
      authorizeUrl(
        parsed.region,
        parsed.userAuth.clientId,
        parsed.userAuth.redirectUri,
        'st',
        'ch',
      ),
    );
    expect(url.origin).toBe('https://login.mypurecloud.de');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: parsed.userAuth.clientId,
      redirect_uri: parsed.userAuth.redirectUri,
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });

  it('validates the redirect URI (callback path, https outside localhost)', () => {
    const bad = (redirectUri: string) =>
      UserAuthConfigSchema.safeParse({ ...config, userAuth: { ...config.userAuth, redirectUri } })
        .success;
    expect(bad('http://acme.agent.example/api/v1/genesys-cloud/oauth/callback')).toBe(false);
    expect(bad('https://acme.agent.example/elsewhere')).toBe(false);
    expect(bad('http://localhost:5174/api/v1/genesys-cloud/oauth/callback')).toBe(true);
  });

  it('exchanges the code with the verifier and proves user + org', async () => {
    const { calls, fetchImpl } = fakeGenesys();
    const proven = await proveIdentity(
      UserAuthConfigSchema.parse(config),
      'the-code',
      'v'.repeat(43),
      fetchImpl,
    );
    expect(proven).toEqual({ genesysUserId: GC_USER, organizationId: ORG });
    const body = new URLSearchParams(calls[0]?.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('v'.repeat(43));
    expect(body.get('client_secret')).toBeNull();
    expect(calls.slice(1).every((c) => c.auth === 'Bearer user-token-xyz')).toBe(true);
  });

  it('refuses a token from another Genesys organization', async () => {
    const { fetchImpl } = fakeGenesys('0f0c2a1e-0000-4000-8000-0000000000bb');
    await expect(
      proveIdentity(UserAuthConfigSchema.parse(config), 'c', 'v'.repeat(43), fetchImpl),
    ).rejects.toMatchObject({ reason: 'org_mismatch' });
  });

  it('replaces only this connector’s Genesys identity', () => {
    const next = withGenesysIdentity(
      [
        { platform: 'genesys_cloud', id: 'old', connectorId: CONNECTOR },
        { platform: 'avaya_aes', id: '4711' },
      ],
      CONNECTOR,
      GC_USER,
      '2026-10-01T10:00:00.000Z',
    );
    expect(next).toEqual([
      { platform: 'avaya_aes', id: '4711' },
      {
        platform: 'genesys_cloud',
        id: GC_USER,
        connectorId: CONNECTOR,
        source: 'genesys-oauth-pkce',
        linkedAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
  });
});

describe('GenesysUserLinkService', () => {
  function build(options: { owners?: { id: string }[]; org?: string } = {}) {
    const states = new Map<string, LinkState>();
    const store: LinkStateStore = {
      put: (state, value) => {
        states.set(state, value);
        return Promise.resolve();
      },
      take: (state) => {
        const value = states.get(state);
        states.delete(state);
        return Promise.resolve(value);
      },
    };
    const audits: { action: string; reason?: string }[] = [];
    const updates: unknown[] = [];
    const tx = {
      connector: { findFirst: () => Promise.resolve({ config }) },
      user: {
        findMany: () => Promise.resolve(options.owners ?? []),
        findFirstOrThrow: () => Promise.resolve({ ctiIdentities: [] }),
        update: (args: unknown) => {
          updates.push(args);
          return Promise.resolve({});
        },
      },
    };
    const db = { current: () => tx, tenantId: () => TENANT };
    const audit = {
      record: (_tx: unknown, input: { action: string; reason?: string }) => {
        audits.push(input);
        return Promise.resolve({ id: 'a', seq: 1n });
      },
    };
    const { fetchImpl } = fakeGenesys(options.org);
    const service = new GenesysUserLinkService(
      db as never,
      audit as never,
      {} as never,
      {} as never,
      store,
      fetchImpl,
    );
    return { service, states, audits, updates };
  }
  const as = <T>(userId: string, fn: () => Promise<T>, sessionId = 'sid-1') =>
    requestContext.run(
      {
        requestId: 'r',
        correlationId: 'c',
        ip: '127.0.0.1',
        userAgent: 'vitest',
        principal: {
          type: 'user',
          id: userId,
          tenantId: TENANT,
          scopes: [],
          sessionId,
          authMethod: 'sso',
        },
      },
      fn,
    );

  it('links the proven Genesys user to the signed-in agent and audits it', async () => {
    const { service, states, audits, updates } = build();
    const url = new URL(await as(USER, () => service.start(CONNECTOR)));
    const state = url.searchParams.get('state') ?? '';
    expect(states.has(state)).toBe(true);
    await as(USER, () => service.complete('code-1', state));
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0])).toContain(GC_USER);
    expect(audits.map((a) => a.action)).toEqual(['user.ctiIdentity.linked']);
    // Single use.
    await expect(as(USER, () => service.complete('code-1', state))).rejects.toBeInstanceOf(
      GenesysLinkError,
    );
  });

  it('refuses a state started by another user or session, and identity conflicts', async () => {
    const a = build();
    const state =
      new URL(await as(USER, () => a.service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await expect(as(OTHER, () => a.service.complete('c', state))).rejects.toMatchObject({
      reason: 'session_mismatch',
    });
    const b = build();
    const state2 =
      new URL(await as(USER, () => b.service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await expect(as(USER, () => b.service.complete('c', state2), 'sid-2')).rejects.toMatchObject({
      reason: 'session_mismatch',
    });
    const c = build({ owners: [{ id: OTHER }] });
    const state3 =
      new URL(await as(USER, () => c.service.start(CONNECTOR))).searchParams.get('state') ?? '';
    await expect(as(USER, () => c.service.complete('c', state3))).rejects.toMatchObject({
      reason: 'identity_conflict',
    });
    expect(c.updates).toHaveLength(0);
    expect(c.audits.at(-1)).toMatchObject({
      action: 'user.ctiIdentity.linkDenied',
      reason: 'identity_conflict',
    });
  });

  it('refuses break-glass and service principals', async () => {
    const { service } = build();
    await expect(
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
            sessionId: 's',
            authMethod: 'break_glass',
          },
        },
        () => service.start(CONNECTOR),
      ),
    ).rejects.toBeInstanceOf(GenesysLinkError);
  });
});
