import { afterEach, expect, it, vi } from 'vitest';

import { fixtureFact, fixtureId } from './fixtures.js';
import { AnalyticsStore } from './storage.js';

import type { ApiEnv } from '../../env.js';
import type { TransactionClient } from '../../infra/database/prisma.service.js';

const env = {
  ANALYTICS_ENABLED: true,
  ANALYTICS_STORAGE: 'postgres',
  ANALYTICS_PSEUDONYM_KEY: Buffer.alloc(32, 1).toString('base64'),
} as ApiEnv;
afterEach(() => vi.unstubAllGlobals());

const filter = { from: '2026-10-03', to: '2026-10-03' };
function clickhouse() {
  const request = vi.fn().mockImplementation(() => Promise.resolve(new Response('')));
  vi.stubGlobal('fetch', request);
  const query = vi.fn().mockResolvedValue([]),
    execute = vi.fn().mockResolvedValue(1);
  return {
    request,
    query,
    execute,
    tx: { $queryRaw: query, $executeRaw: execute } as unknown as TransactionClient,
    store: new AnalyticsStore({
      ...env,
      ANALYTICS_STORAGE: 'clickhouse',
      ANALYTICS_CLICKHOUSE_URL: 'https://synthetic-clickhouse.example.invalid',
    }),
  };
}

it('requires a configured ClickHouse endpoint but permits a disabled analytics adapter', async () => {
  expect(
    () =>
      new AnalyticsStore({
        ...env,
        ANALYTICS_STORAGE: 'clickhouse',
        ANALYTICS_CLICKHOUSE_URL: undefined,
      }),
  ).toThrow('ANALYTICS_CLICKHOUSE_URL is required');
  const tx = { $queryRaw: vi.fn() };
  expect(
    await new AnalyticsStore({
      ...env,
      ANALYTICS_ENABLED: false,
      ANALYTICS_PSEUDONYM_KEY: undefined,
    }).read(tx as unknown as TransactionClient, fixtureId(1), filter),
  ).toEqual([]);
  expect(tx.$queryRaw).not.toHaveBeenCalled();
});

it('uses tenant-bound ClickHouse parameters and validates each returned fact', async () => {
  const f = clickhouse();
  f.request.mockResolvedValue(
    new Response(
      [fixtureFact(0), fixtureFact(1)]
        .map((fact) => JSON.stringify({ fact: JSON.stringify(fact) }))
        .join('\n'),
    ),
  );
  expect(await f.store.read(f.tx, fixtureId(1), filter)).toHaveLength(2);
  const url = f.request.mock.calls[0]![0] as URL;
  expect(url.searchParams.get('param_tenant')).toBe(fixtureId(1));
  expect(url.searchParams.get('param_from')).toBe('2026-10-03T00:00:00.000Z');
  expect(url.searchParams.get('param_until')).toBe('2026-10-04T00:00:00.000Z');
  expect(url.searchParams.get('query')).toContain('FINAL');
  expect(f.request.mock.calls[0]![1]).toMatchObject({
    method: 'POST',
    headers: { 'X-ClickHouse-User': 'default', 'X-ClickHouse-Key': '' },
  });
  f.request.mockResolvedValue(new Response('{"fact":"{}"}'));
  await expect(f.store.read(f.tx, fixtureId(1), filter)).rejects.toThrow();
});

it('returns an empty cohort for an empty ClickHouse response', async () => {
  const f = clickhouse();
  expect(await f.store.read(f.tx, fixtureId(1), filter)).toEqual([]);
});

it.each(['campaignId', 'scriptId', 'teamId', 'channel'] as const)(
  'applies %s filtering after selecting started sessions',
  async (key) => {
    const f = clickhouse();
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([fixtureFact(0), fixtureFact(1)].map((fact) => ({ fact }))),
    } as unknown as TransactionClient;
    const store = new AnalyticsStore(env);
    expect(
      await store.read(tx, fixtureId(1), {
        ...filter,
        [key]: key === 'channel' ? 'chat' : fixtureId(99),
      }),
    ).toEqual([]);
    expect(f.request).not.toHaveBeenCalled();
  },
);

it('refuses truncated cohorts rather than silently returning misleading analytics', async () => {
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue(Array.from({ length: 50001 }, () => ({ fact: fixtureFact(0) }))),
  } as unknown as TransactionClient;
  await expect(new AnalyticsStore(env).read(tx, fixtureId(1), filter)).rejects.toThrow(
    'The request is invalid',
  );
});

it('serializes projection with privacy erasure and skips both stores for tombstoned sessions', async () => {
  const f = clickhouse();
  f.query
    .mockResolvedValueOnce([{ id: fixtureId(2) }])
    .mockResolvedValueOnce([{ session_id: fixtureId(2) }]);
  await f.store.append(f.tx, fixtureFact(0));
  expect(f.query.mock.calls[0]).toContain(fixtureId(1));
  expect((f.query.mock.calls[0]![0] as TemplateStringsArray).join('')).toContain('FOR SHARE');
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.request).not.toHaveBeenCalled();
});

it('projects safe facts to both stores and mirrors privacy erasure with bound identifiers', async () => {
  const f = clickhouse(),
    fact = fixtureFact(0);
  await f.store.append(f.tx, fact);
  const body = f.request.mock.calls[0]![1] as RequestInit;
  expect(JSON.parse(body.body as string)).toMatchObject({
    tenant_id: fact.tenantId,
    session_id: fact.sessionId,
    fact: JSON.stringify(fact),
  });
  expect(f.execute.mock.calls[0]).toContain(fact.tenantId);
  await f.store.purge(f.tx, fact.tenantId, new Date('2026-09-01T00:00:00Z'));
  expect((f.request.mock.calls[1]![0] as URL).searchParams.get('param_cutoff')).toBe(
    '2026-09-01T00:00:00.000Z',
  );
  await f.store.eraseSessions(f.tx, fact.tenantId, [fact.sessionId]);
  const eraseUrl = f.request.mock.calls[2]![0] as URL;
  expect(eraseUrl.searchParams.get('param_tenant')).toBe(fact.tenantId);
  expect(eraseUrl.searchParams.get('param_sessions')).toBe(`['${fact.sessionId}']`);
  expect(f.execute).toHaveBeenCalledTimes(4);
  expect((f.execute.mock.calls[2]![0] as TemplateStringsArray).join('')).toContain(
    'analytics_erased_sessions',
  );
});

it('handles PostgreSQL-only purge/erasure and rejects invalid session IDs before writing', async () => {
  const f = clickhouse(),
    store = new AnalyticsStore(env);
  await store.eraseSessions(f.tx, fixtureId(1), []);
  expect(f.execute).not.toHaveBeenCalled();
  await expect(store.eraseSessions(f.tx, fixtureId(1), ['invalid'])).rejects.toThrow();
  expect(f.execute).not.toHaveBeenCalled();
  await store.purge(f.tx, fixtureId(1), new Date());
  await store.eraseSessions(f.tx, fixtureId(1), [fixtureId(2)]);
  await store.append(f.tx, fixtureFact(0));
  expect(f.execute).toHaveBeenCalledTimes(4);
  expect(f.request).not.toHaveBeenCalled();
});

it.each(['protocol', 'status', 'size'] as const)(
  'fails closed on ClickHouse %s errors',
  async (reason) => {
    const f = clickhouse();
    if (reason === 'status')
      f.request.mockResolvedValue(new Response('synthetic-private-message', { status: 503 }));
    if (reason === 'size') f.request.mockResolvedValue(new Response('x'.repeat(32_000_001)));
    const store =
      reason === 'protocol'
        ? new AnalyticsStore({
            ...env,
            ANALYTICS_STORAGE: 'clickhouse',
            ANALYTICS_CLICKHOUSE_URL: 'file:///synthetic',
          })
        : f.store;
    await expect(store.read(f.tx, fixtureId(1), filter)).rejects.toThrow(
      reason === 'protocol'
        ? 'Invalid ClickHouse protocol'
        : reason === 'status'
          ? 'ClickHouse operation failed'
          : 'ClickHouse response too large',
    );
    if (reason === 'protocol') expect(f.request).not.toHaveBeenCalled();
  },
);
it('cohort selection excludes sessions whose start lies outside the interval', async () => {
  const rows = [fixtureFact(0), fixtureFact(1), fixtureFact(2, { sessionId: fixtureId(22) })];
  const query = vi.fn().mockResolvedValue(rows.map((fact) => ({ fact })));
  const store = new AnalyticsStore(env);
  const result = await store.read(
    { $queryRaw: query } as unknown as TransactionClient,
    fixtureId(1),
    { from: '2026-10-03', to: '2026-10-03' },
  );
  expect(result).toHaveLength(2);
  expect(query.mock.calls[0]).toContain(fixtureId(1));
});
it('filters rogue backend tenant data even before authorization', async () => {
  const fact = fixtureFact(0, { tenantId: fixtureId(99) });
  const store = new AnalyticsStore(env);
  expect(
    await store.read(
      { $queryRaw: vi.fn().mockResolvedValue([{ fact }]) } as unknown as TransactionClient,
      fixtureId(1),
      { from: '2026-10-03', to: '2026-10-03' },
    ),
  ).toEqual([]);
});
it('requires a pseudonym key when enabled', () => {
  expect(() => new AnalyticsStore({ ...env, ANALYTICS_PSEUDONYM_KEY: undefined })).toThrow();
});
