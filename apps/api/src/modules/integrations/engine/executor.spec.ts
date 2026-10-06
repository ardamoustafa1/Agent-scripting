import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefinitionSchema, PolicySchema, type DataSource } from './contracts.js';
import { cacheKey, IntegrationExecutor, type IntegrationCache } from './executor.js';
import { mapValue, template, validateSchema } from './mapping.js';
import { checkGraphql, importWsdl, soapEnvelope, xmlToJson } from './protocols.js';
import { IntegrationError, type Transport } from './transport.js';

const source = (overrides: Record<string, unknown> = {}): DataSource => ({
  id: 'source-a',
  version: 1,
  protocol: 'rest',
  definition: DefinitionSchema.parse({
    baseUrl: 'https://service.test',
    endpoint: '/api',
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    ...overrides,
  }),
  policy: PolicySchema.parse({
    allowedOrigins: ['https://service.test'],
    retries: 0,
    containsPii: false,
  }),
});
const call = { input: {}, environment: 'prod' as const };
const cache: IntegrationCache = {
  get: vi.fn(() => Promise.resolve(null)),
  set: vi.fn(() => Promise.resolve(undefined)),
};
const secret = vi.fn(() => Promise.resolve({ value: 'synthetic', version: 1 }));
const good = { status: 200, headers: {}, body: '{"ok":true}' };
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe('integration executor', () => {
  it('counts success and failure per tenant without exposing another tenant metrics', async () => {
    const executor = new IntegrationExecutor(cache, vi.fn<Transport>().mockResolvedValue(good));
    await executor.execute('tenant-a', source(), call, secret, ['https://service.test']);
    await executor.execute('tenant-a', source(), { ...call, scenario: 'synthetic' }, secret, []);
    expect(executor.metrics('tenant-a', 'source-a')[0]).toMatchObject({
      calls: 2,
      errors: 1,
      errorRate: 0.5,
    });
    expect(executor.metrics('tenant-b', 'source-a')).toEqual([]);
  });

  it('rejects mock scenarios on a live call and honors explicitly enabled test tenant mocks', async () => {
    const transport = vi.fn<Transport>(),
      executor = new IntegrationExecutor(cache, transport);
    expect(
      (await executor.execute('tenant-a', source(), { ...call, scenario: 'synthetic' }, secret, []))
        .trace.error,
    ).toBe('MOCK_REQUIRED');
    expect(
      (
        await executor.execute(
          'tenant-a',
          source({ mock: { enabled: true, response: { ok: true } } }),
          { ...call, environment: 'test' },
          secret,
          [],
        )
      ).value,
    ).toEqual({ ok: true });
    expect(transport).not.toHaveBeenCalled();
  });

  it('refuses an enabled mock on a production live call instead of returning simulated success', async () => {
    const transport = vi.fn<Transport>();
    const result = await new IntegrationExecutor(cache, transport).execute(
      'tenant-a',
      source({ mock: { enabled: true, response: { ok: true } } }),
      call,
      secret,
      [],
    );
    expect(result.value).toBeUndefined();
    expect(result.trace.error).toBe('MOCK_FORBIDDEN');
    expect(result.trace.mock).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(secret).not.toHaveBeenCalled();
  });

  it.each(['not-json', '{"ok":"wrong-type"}'])(
    'ignores invalid best-effort cache entries and obtains a validated live response: %s',
    async (stored) => {
      const ds = source();
      ds.policy.cacheTtlSeconds = 60;
      const transport = vi.fn<Transport>().mockResolvedValue(good);
      const set = vi.fn<IntegrationCache['set']>().mockResolvedValue(undefined);
      const result = await new IntegrationExecutor(
        { get: () => Promise.resolve(stored), set },
        transport,
      ).execute('tenant-a', ds, call, secret, ['https://service.test']);
      expect(result.value).toEqual({ ok: true });
      expect(result.trace).toMatchObject({ cached: false, error: null });
      expect(transport).toHaveBeenCalledOnce();
      expect(set).toHaveBeenCalledOnce();
    },
  );

  it('returns validated cache hits without transport and binds cache entries to credential versions', async () => {
    const ds = source();
    ds.policy.cacheTtlSeconds = 60;
    const get = vi.fn().mockResolvedValue('{"ok":true}'),
      set = vi.fn(),
      transport = vi.fn<Transport>().mockResolvedValue({ ...good, body: '{"ok":"invalid"}' });
    const executor = new IntegrationExecutor({ get, set }, transport);
    const result = await executor.execute('tenant-a', ds, call, secret, [], {
      sessionId: 'synthetic-session',
      credentialVersion: '2',
    });
    expect(result.value).toEqual({ ok: true });
    expect(result.trace.cached).toBe(true);
    expect(get.mock.calls[0]?.[0]).toBe(`${cacheKey('tenant-a', ds, call, 'synthetic-session')}:2`);
    expect(transport).not.toHaveBeenCalled();
    get.mockResolvedValue('{"ok":"invalid"}');
    expect((await executor.execute('tenant-a', ds, call, secret, [])).trace.error).toBe(
      'SCHEMA_INVALID',
    );
    expect(transport).toHaveBeenCalledOnce();
  });

  it('continues live execution during cache outages and excludes classified output from caching', async () => {
    const get = vi.fn().mockRejectedValue(new Error('Synthetic cache outage')),
      set = vi.fn().mockRejectedValue(new Error('Synthetic cache outage'));
    const transport = vi.fn<Transport>().mockResolvedValue(good),
      executor = new IntegrationExecutor({ get, set }, transport),
      ds = source();
    ds.policy.cacheTtlSeconds = 60;
    expect(
      (await executor.execute('tenant-a', ds, call, secret, ['https://service.test'])).value,
    ).toEqual({ ok: true });
    expect(get).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    const classified = source({ outputSchema: { type: 'object', classification: 'pii' } });
    classified.policy.cacheTtlSeconds = 60;
    await executor.execute('tenant-a', classified, call, secret, ['https://service.test']);
    expect(get).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('applies profile credentials and typed templates while masking console request/response details', async () => {
    const transport = vi
      .fn<Transport>()
      .mockResolvedValue({ status: 200, headers: {}, body: '{"ok":true,"echo":"synthetic"}' });
    const ds = source({
      method: 'POST',
      endpoint: '/customer/{{customer.id}}',
      query: { public: '{{count}}' },
      headers: { 'X-Public': '{{count}}' },
      mapping: { request: '{"quantity": count}' },
      body: { quantity: '{{quantity}}' },
      profiles: {
        prod: {
          baseUrl: 'https://profile.test',
          auth: { type: 'bearer', secretRef: '01990000-0000-7000-8000-000000000001' },
        },
      },
    });
    const result = await new IntegrationExecutor(cache, transport).execute(
      'tenant-a',
      ds,
      { ...call, input: { customer: { id: 'id/with spaces' }, count: 3 } },
      secret,
      ['https://profile.test'],
    );
    const request = transport.mock.calls[0]![0];
    expect(request.url.toString()).toBe(
      'https://profile.test/customer/id%2Fwith%20spaces?public=3',
    );
    expect(request.body).toBe('{"quantity":3}');
    expect(request.headers['Authorization']).toBe('Bearer synthetic');
    expect(result.value).toEqual({ ok: true, echo: '[REDACTED]' });
    expect(result.trace.request).toMatchObject({
      origin: 'https://profile.test',
      path: '/customer/[REDACTED]',
      query: { public: '[REDACTED]' },
      body: '[REDACTED]',
    });
    expect(JSON.stringify(result.trace)).not.toContain('Bearer synthetic');
  });

  it.each([401, 429, 503])(
    'normalizes upstream status %s and invalidates rejected authentication',
    async (status) => {
      const executor = new IntegrationExecutor(
        cache,
        vi.fn<Transport>().mockResolvedValue({ ...good, status }),
      );
      const invalidate = vi.spyOn(executor.authentication, 'invalidate');
      const result = await executor.execute('tenant-a', source(), call, secret, [
        'https://service.test',
      ]);
      expect(result.trace.error).toBe('UPSTREAM_ERROR');
      expect(invalidate).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    },
  );

  it.each([
    'graphqlConfig',
    'graphqlMethod',
    'graphqlErrors',
    'soapConfig',
    'emptyResponse',
    'oversized',
    'origin',
  ] as const)('fails closed before accepting unsafe protocol result: %s', async (reason) => {
    const ds = source({
      method: reason === 'graphqlMethod' ? 'GET' : 'POST',
      ...(reason === 'oversized' ? { body: 'x'.repeat(1024 * 1024) } : {}),
      ...(reason === 'origin' ? { endpoint: '//rogue.test/api' } : {}),
    });
    if (reason.startsWith('graphql')) ds.protocol = 'graphql';
    if (reason === 'graphqlMethod' || reason === 'graphqlErrors')
      ds.definition.graphql = { query: '{ ok }', maxDepth: 3, maxComplexity: 100 };
    if (reason === 'soapConfig') ds.protocol = 'soap';
    const transport = vi.fn<Transport>().mockResolvedValue({
      ...good,
      body:
        reason === 'graphqlErrors'
          ? '{"errors":[{"message":"synthetic"}]}'
          : reason === 'emptyResponse'
            ? ''
            : good.body,
    });
    const result = await new IntegrationExecutor(cache, transport).execute(
      'tenant-a',
      ds,
      call,
      secret,
      ['https://service.test'],
    );
    expect(result.trace.error).toBe(
      {
        graphqlConfig: 'GRAPHQL_CONFIG_REQUIRED',
        graphqlMethod: 'GRAPHQL_POST_REQUIRED',
        graphqlErrors: 'GRAPHQL_UPSTREAM_ERROR',
        soapConfig: 'SOAP_CONFIG_REQUIRED',
        emptyResponse: 'SCHEMA_INVALID',
        oversized: 'REQUEST_TOO_LARGE',
        origin: 'EGRESS_DENIED',
      }[reason],
    );
    expect(result.value).toBeUndefined();
  });

  it('sends SOAP POST envelopes and decodes the XML response before output mapping', async () => {
    const ds = source({
      method: 'POST',
      soap: { operation: 'Lookup', namespace: 'https://synthetic.test', action: 'urn:Lookup' },
      outputSchema: { type: 'object' },
    });
    ds.protocol = 'soap';
    const transport = vi.fn<Transport>().mockResolvedValue({
      ...good,
      body: '<Envelope><Body><LookupResponse><ok>true</ok></LookupResponse></Body></Envelope>',
    });
    const result = await new IntegrationExecutor(cache, transport).execute(
      'tenant-a',
      ds,
      call,
      secret,
      ['https://service.test'],
    );
    expect(result.trace.error).toBeNull();
    expect(transport.mock.calls[0]![0].body).toContain('Lookup');
    expect(transport.mock.calls[0]![0].headers['Content-Type']).toBe('text/xml; charset=utf-8');
    expect(result.value).toEqual({ Envelope: { Body: { LookupResponse: { ok: true } } } });
  });
  it('previews mocks without DNS, secret or network access', async () => {
    const transport = vi.fn<Transport>();
    const result = await new IntegrationExecutor(cache, transport).execute(
      'tenant-a',
      source({ mock: { response: { ok: true } } }),
      call,
      secret,
      [],
      { preview: true },
    );
    expect(result.value).toEqual({ ok: true });
    expect(result.trace.mock).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    expect(secret).not.toHaveBeenCalled();
  });
  it('fails closed for preview without a mock', async () => {
    const transport = vi.fn<Transport>();
    const result = await new IntegrationExecutor(cache, transport).execute(
      'tenant-a',
      source(),
      call,
      secret,
      [],
      { preview: true },
    );
    expect(result.trace.error).toBe('MOCK_REQUIRED');
    expect(transport).not.toHaveBeenCalled();
  });
  it('opens the breaker and refuses further upstream calls, then probes after reset', async () => {
    vi.useFakeTimers();
    const transport = vi
      .fn<Transport>()
      .mockRejectedValueOnce(new IntegrationError('UPSTREAM_ERROR', true))
      .mockResolvedValue(good);
    const executor = new IntegrationExecutor(cache, transport);
    const ds = source();
    ds.policy.breakerThreshold = 1;
    ds.policy.breakerResetMs = 100;
    expect(
      (await executor.execute('tenant-a', ds, call, secret, ['https://service.test'])).trace.error,
    ).toBe('UPSTREAM_ERROR');
    expect(
      (await executor.execute('tenant-a', ds, call, secret, ['https://service.test'])).trace.error,
    ).toBe('CIRCUIT_OPEN');
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101);
    expect(
      (await executor.execute('tenant-a', ds, call, secret, ['https://service.test'])).value,
    ).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each(['GET', 'POST', 'PATCH'])('only retries idempotent %s', async (method) => {
    vi.useFakeTimers();
    const transport = vi
      .fn<Transport>()
      .mockRejectedValueOnce(new IntegrationError('UPSTREAM_ERROR', true))
      .mockResolvedValue(good);
    const ds = source({ method });
    ds.policy.retries = 1;
    const promise = new IntegrationExecutor(cache, transport).execute(
      'tenant-a',
      ds,
      call,
      secret,
      ['https://service.test'],
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(transport).toHaveBeenCalledTimes(method === 'GET' ? 2 : 1);
    expect(result.trace.error).toBe(method === 'GET' ? null : 'UPSTREAM_ERROR');
  });
  it('rejects excess concurrency and times out hanging upstream calls', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<Transport>(() => new Promise(() => undefined));
    const ds = source();
    ds.policy.concurrency = 1;
    ds.policy.timeoutMs = 100;
    const executor = new IntegrationExecutor(cache, transport);
    const first = executor.execute('tenant-a', ds, call, secret, ['https://service.test']);
    const queued = executor.execute('tenant-a', ds, call, secret, ['https://service.test']);
    await Promise.resolve();
    expect(
      (await executor.execute('tenant-a', ds, call, secret, ['https://service.test'])).trace.error,
    ).toBe('BULKHEAD_FULL');
    await vi.advanceTimersByTimeAsync(250);
    expect((await first).trace.error).toBe('TIMEOUT');
    expect((await queued).trace.error).toBe('TIMEOUT');
  });
  it('validates fallback and never falls back on SSRF failures', async () => {
    const ds = source();
    ds.policy.fallback = { ok: true };
    expect(
      (
        await new IntegrationExecutor(cache, () =>
          Promise.reject(new IntegrationError('UPSTREAM_ERROR', true)),
        ).execute('tenant-a', ds, call, secret, [])
      ).value,
    ).toEqual({ ok: true });
    expect(
      (
        await new IntegrationExecutor(cache, () =>
          Promise.reject(new IntegrationError('EGRESS_DENIED')),
        ).execute('tenant-a', ds, call, secret, [])
      ).value,
    ).toBeUndefined();
  });
  it('does not cache PII responses', async () => {
    const ds = source();
    ds.policy.cacheTtlSeconds = 60;
    ds.policy.containsPii = true;
    await new IntegrationExecutor(cache, () => Promise.resolve(good)).execute(
      'tenant-a',
      ds,
      call,
      secret,
      ['https://service.test'],
    );
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
  it('isolates cache keys by tenant, profile, version and session and canonicalizes input', () => {
    const ds = source();
    const key = cacheKey('a', ds, { ...call, input: { x: 1, y: 2 } }, 's1');
    expect(cacheKey('a', ds, { ...call, input: { y: 2, x: 1 } }, 's1')).toBe(key);
    expect(cacheKey('b', ds, call, 's1')).not.toBe(key);
    expect(cacheKey('a', ds, call, 's2')).not.toBe(key);
    expect(cacheKey('a', { ...ds, version: 2 }, call, 's1')).not.toBe(key);
  });
  it('maps with JSONata and rejects wrong output schema', async () => {
    await expect(mapValue('{"ok": success}', { success: true })).resolves.toEqual({ ok: true });
    expect(() => {
      validateSchema(source().definition.outputSchema, { ok: 'wrong' });
    }).toThrow('SCHEMA_INVALID');
  });
  it('preserves typed body templates and refuses prototype traversal', () => {
    expect(template({ quantity: '{{count}}' }, { count: 3 })).toEqual({ quantity: 3 });
    expect(() => template('{{constructor.name}}', {})).toThrow('TEMPLATE_INVALID');
  });
  it('rejects DTD/entities and imports SOAP operations', () => {
    expect(() =>
      xmlToJson('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><foo>&x;</foo>'),
    ).toThrow('XML_INVALID');
    expect(
      importWsdl(
        '<definitions><binding><operation name="Lookup"><operation soapAction="urn:Lookup"/></operation></binding></definitions>',
      ).operations,
    ).toEqual([{ name: 'Lookup', action: 'urn:Lookup' }]);
    expect(
      soapEnvelope(
        { operation: 'Lookup', namespace: 'https://example.test', action: 'urn:Lookup' },
        { text: '<safe>' },
      ),
    ).toContain('&lt;safe&gt;');
  });
  it('bounds GraphQL depth and refuses mutations and recursive fragments', () => {
    const config = { query: '{ a { b { c } } }', maxDepth: 2, maxComplexity: 100 };
    expect(() => {
      checkGraphql(config);
    }).toThrow('GRAPHQL_BUDGET');
    expect(() => {
      checkGraphql({ ...config, query: 'mutation { remove }' });
    }).toThrow('GRAPHQL_QUERY_ONLY');
    expect(() => {
      checkGraphql({ ...config, query: '{ ...A } fragment A on Query { ...A }' });
    }).toThrow('GRAPHQL_FRAGMENT_DENIED');
  });
});

describe('authoring mock scenarios', () => {
  it('selects named success/empty scenarios without contacting transport or vault', async () => {
    const transport = vi.fn<Transport>();
    const definition = source({
      mockScenarios: [
        { key: 'success', kind: 'success', response: { ok: true } },
        { key: 'empty', kind: 'empty', response: { ok: false } },
      ],
    });
    const engine = new IntegrationExecutor(cache, transport);
    const result = await engine.execute(
      'tenant-a',
      definition,
      { ...call, scenario: 'success' },
      secret,
      [],
      { preview: true },
    );
    expect(result.value).toEqual({ ok: true });
    expect(result.trace.mock).toBe(true);
    const empty = await engine.execute(
      'tenant-a',
      definition,
      { ...call, scenario: 'empty' },
      secret,
      [],
      { preview: true },
    );
    expect(empty.value).toEqual({ ok: false });
    expect(transport).not.toHaveBeenCalled();
    expect(secret).not.toHaveBeenCalled();
  });
  it('returns an error trace for error or missing scenarios', async () => {
    const engine = new IntegrationExecutor(cache, vi.fn<Transport>());
    const definition = source({ mockScenarios: [{ key: 'error', kind: 'error', response: null }] });
    const failed = await engine.execute(
      'tenant-a',
      definition,
      { ...call, scenario: 'error' },
      secret,
      [],
      { preview: true },
    );
    expect(failed.trace.error).not.toBeNull();
    const missing = await engine.execute(
      'tenant-a',
      definition,
      { ...call, scenario: 'absent' },
      secret,
      [],
      { preview: true },
    );
    expect(missing.trace.error).not.toBeNull();
  });
});

it('models bounded delay scenarios using an injected fake timer, without transport', async () => {
  vi.useFakeTimers();
  const transport = vi.fn<Transport>(),
    engine = new IntegrationExecutor(cache, transport);
  const definition = source({
    mockScenarios: [{ key: 'delay', kind: 'delay', delayMs: 100, response: { ok: true } }],
  });
  const pending = engine.execute(
    'tenant-a',
    definition,
    { ...call, scenario: 'delay' },
    secret,
    [],
    { preview: true },
  );
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).value).toEqual({ ok: true });
  expect(transport).not.toHaveBeenCalled();
});

it('retries a timed-out attempt with a fresh per-attempt deadline', async () => {
  vi.useFakeTimers();
  const transport = vi
    .fn<Transport>()
    .mockImplementationOnce(() => new Promise(() => undefined))
    .mockResolvedValue(good);
  const ds = source();
  ds.policy.timeoutMs = 200;
  ds.policy.retries = 1;
  const promise = new IntegrationExecutor(cache, transport).execute(
    'retry-tenant',
    ds,
    call,
    secret,
    ['https://service.test'],
  );
  await vi.advanceTimersByTimeAsync(1500);
  expect((await promise).value).toEqual({ ok: true });
  expect(transport).toHaveBeenCalledTimes(2);
});

it('evicts the least recently used policy without resetting a hot tenant breaker', async () => {
  const transport = vi
    .fn<Transport>()
    .mockRejectedValue(new IntegrationError('UPSTREAM_ERROR', true));
  const executor = new IntegrationExecutor(cache, transport);
  const ds = source();
  ds.policy.breakerThreshold = 1;
  ds.policy.breakerResetMs = 60000;
  await executor.execute('hot', ds, call, secret, ['https://service.test']);
  for (let index = 0; index < 999; index++)
    await executor.execute(`cold-${index}`, ds, call, secret, ['https://service.test']);
  expect(
    (await executor.execute('hot', ds, call, secret, ['https://service.test'])).trace.error,
  ).toBe('CIRCUIT_OPEN');
  await executor.execute('new', ds, call, secret, ['https://service.test']);
  expect(
    (await executor.execute('hot', ds, call, secret, ['https://service.test'])).trace.error,
  ).toBe('CIRCUIT_OPEN');
});
