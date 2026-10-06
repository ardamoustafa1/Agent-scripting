import { describe, expect, it } from 'vitest';

import { WorkspaceSession } from './workspace-session.js';

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Fake GWS: cookie session, CometD long-poll that hands out queued messages once. */
function fakeGws() {
  const calls: { path: string; body: unknown; auth: string | null; cookie: string | null }[] = [];
  const queue: unknown[] = [];
  let tokenCount = 0;
  let unauthorizedOnce = false;
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const headers = new Headers(init.headers);
    calls.push({
      path: url.pathname,
      body,
      auth: headers.get('authorization'),
      cookie: headers.get('cookie'),
    });
    if (unauthorizedOnce && url.pathname !== '/workspace/v3/notifications') {
      unauthorizedOnce = false;
      return new Response(null, { status: 401 });
    }
    if (url.pathname === '/workspace/v3/initialize-workspace')
      return new Response(JSON.stringify({ status: { code: 1 } }), {
        status: 202,
        headers: { 'set-cookie': 'WORKSPACE_SESSIONID=s1; Path=/; HttpOnly' },
      });
    if (url.pathname === '/workspace/v3/notifications') {
      const [message] = body as { channel: string }[];
      if (message?.channel === '/meta/handshake')
        return Response.json([{ channel: '/meta/handshake', successful: true, clientId: 'cid-1' }]);
      if (message?.channel === '/meta/subscribe')
        return Response.json([{ channel: '/meta/subscribe', successful: true }]);
      if (message?.channel === '/meta/connect') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const out = queue.splice(0, queue.length);
        return Response.json([{ channel: '/meta/connect', successful: true }, ...out]);
      }
      return Response.json([{ channel: message?.channel ?? '', successful: true }]);
    }
    return Response.json({ status: { code: 0 } });
  }) as typeof fetch;
  return {
    calls,
    queue,
    fetchImpl,
    tokens: {
      linkedAgents: () => Promise.resolve(['E1001']),
      token: () => {
        tokenCount += 1;
        return Promise.resolve({
          accessToken: `agent-token-${String(tokenCount)}`,
          expiresAt: Date.now() + 3_600_000,
        });
      },
    },
    get tokenCount() {
      return tokenCount;
    },
    failNextWith401() {
      unauthorizedOnce = true;
    },
  };
}

describe('workspace session (Workspace API v3 + CometD)', () => {
  it('initializes, keeps the session cookie, subscribes and activates channels without agent state changes', async () => {
    const gws = fakeGws();
    const identities: unknown[] = [];
    const messages: unknown[] = [];
    const session = new WorkspaceSession({
      baseUrl: 'https://gws.acme.internal',
      platformUserId: 'E1001',
      tokens: gws.tokens,
      channels: ['voice', 'chat'],
      fetch: gws.fetchImpl,
      logger,
      now: () => new Date(),
      sleep: () => Promise.resolve(),
      onIdentity: (agent) => identities.push(agent),
      onMessage: (message) => {
        messages.push(message);
        return Promise.resolve();
      },
    });
    gws.queue.push(
      {
        channel: '/workspace/v3/initialization',
        data: {
          state: 'Complete',
          user: { employeeId: 'E1001', userName: 'ayse.k', agentLogin: '5001' },
        },
      },
      {
        channel: '/workspace/v3/voice',
        data: {
          messageType: 'CallStateChanged',
          call: { id: 'c1', state: 'Ringing', userData: [] },
        },
      },
    );
    await session.start();
    await expect.poll(() => messages.length).toBe(1);
    expect(identities).toEqual([{ employeeId: 'E1001', userName: 'ayse.k', agentLoginId: '5001' }]);
    const paths = gws.calls.map((c) => c.path);
    expect(paths.slice(0, 1)).toEqual(['/workspace/v3/initialize-workspace']);
    expect(paths).toContain('/workspace/v3/activate-channels');
    expect(paths.some((p) => /ready|not-ready|logout-agent|set-agent-state/.test(p))).toBe(false);
    const subscriptions = gws.calls
      .flatMap((c) =>
        Array.isArray(c.body)
          ? (c.body as { subscription?: string }[]).map((m) => m.subscription)
          : [],
      )
      .filter(Boolean);
    expect(subscriptions).toEqual([
      '/workspace/v3/initialization',
      '/workspace/v3/voice',
      '/workspace/v3/media',
    ]);
    expect(gws.calls.at(-1)?.cookie).toBe('WORKSPACE_SESSIONID=s1');
    expect(gws.calls.every((c) => c.auth === 'Bearer agent-token-1')).toBe(true);
    await session.stop();
  });

  it('refreshes the delegated token once on 401 and refuses foreign paths', async () => {
    const gws = fakeGws();
    const session = new WorkspaceSession({
      baseUrl: 'https://gws.acme.internal',
      platformUserId: 'E1001',
      tokens: gws.tokens,
      channels: ['voice'],
      fetch: gws.fetchImpl,
      logger,
      now: () => new Date(),
      sleep: () => Promise.resolve(),
      onIdentity: () => undefined,
      onMessage: () => Promise.resolve(),
    });
    gws.failNextWith401();
    await session.request('POST', '/workspace/v3/voice/calls/c1/update-user-data', {
      data: { userData: [] },
    });
    expect(gws.tokenCount).toBe(2);
    await expect(session.request('GET', '/api/v2/me', undefined)).rejects.toMatchObject({
      code: 'engage_bad_path',
    });
  });
});
