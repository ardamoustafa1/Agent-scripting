import { createHash } from 'node:crypto';

import {
  BrokenCircuitError,
  CircuitState,
  BulkheadRejectedError,
  TaskCancelledError,
  bulkhead,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleWhen,
  retry,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';

import { instruments, inSpan } from '@verbis/observability';

import { Authentication, type SecretReader } from './auth.js';
import {
  containsSensitiveSchema,
  mapValue,
  redact,
  scrubSecrets,
  scalarText,
  template,
  validateSchema,
} from './mapping.js';
import { checkGraphql, soapEnvelope, xmlToJson } from './protocols.js';
import { IntegrationError, secureTransport } from './transport.js';

import type { Call, DataSource, WireRequest, WireResponse } from './contracts.js';
import type { Transport } from './transport.js';

export interface IntegrationCache {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttl: number) => Promise<void>;
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return value === undefined ? 'null' : JSON.stringify(value);
};
export const cacheKey = (tenant: string, source: DataSource, call: Call, session: string) =>
  `integration:${tenant}:${source.id}:${source.version}:${call.environment}:${session}:${createHash('sha256').update(canonical(call.input)).digest('hex')}`;
export class IntegrationExecutor {
  readonly authentication: Authentication;
  private readonly policies = new Map<string, ReturnType<typeof this.makePolicy>>();
  private readonly counters = new Map<
    string,
    { calls: number; errors: number; durations: number[] }
  >();
  constructor(
    private readonly cache: IntegrationCache,
    private readonly transport: Transport = secureTransport,
  ) {
    this.authentication = new Authentication(transport);
    instruments.breakerOpen.addCallback((result) => {
      result.observe(
        [...this.policies.values()].filter(({ breaker }) => breaker.state === CircuitState.Open)
          .length,
      );
    });
  }
  private makePolicy(source: DataSource) {
    const handle = handleWhen(
      (error) =>
        (error instanceof IntegrationError && error.retryable) ||
        error instanceof TaskCancelledError,
    );
    const breaker = circuitBreaker(handle, {
      halfOpenAfter: source.policy.breakerResetMs,
      breaker: new ConsecutiveBreaker(source.policy.breakerThreshold),
    });
    const retries = retry(handle, {
      maxAttempts:
        ['GET', 'HEAD', 'PUT', 'DELETE'].includes(source.definition.method) &&
        source.protocol === 'rest'
          ? source.policy.retries
          : 0,
      backoff: new ExponentialBackoff({ initialDelay: 100, maxDelay: 1000 }),
    });
    const policy = wrap(
      bulkhead(source.policy.concurrency, 0),
      breaker,
      timeout(source.policy.timeoutMs, TimeoutStrategy.Aggressive),
      retries,
    );
    return { policy, breaker };
  }
  async execute(
    tenant: string,
    source: DataSource,
    call: Call,
    read: SecretReader,
    tenantOrigins: readonly string[],
    options: { preview?: boolean; sessionId?: string; credentialVersion?: string } = {},
  ) {
    const started = performance.now();
    const key = `${tenant}:${source.id}:${source.version}:${call.environment}`;
    const stats = this.counters.get(key) ?? { calls: 0, errors: 0, durations: [] };
    this.counters.set(key, stats);
    stats.calls++;
    let wire: WireRequest | undefined;
    let raw: unknown = null;
    let secretValues: string[] = [];
    let usedMock = false;
    let failed = false;
    const trace = (mapped: unknown, error: string | null, cached = false) => ({
      request: wire
        ? {
            method: wire.method,
            origin: wire.url.origin,
            path: source.definition.endpoint.replace(/\{\{[^}]+\}\}/g, '[REDACTED]'),
            query: Object.fromEntries(
              [...wire.url.searchParams.keys()].map((name) => [name, '[REDACTED]']),
            ),
            headers: Object.fromEntries(
              Object.keys(wire.headers).map((name) => [name, '[REDACTED]']),
            ),
            body: redact(wire.body, [], secretValues, '', true),
          }
        : null,
      response: redact(raw, source.policy.piiPaths, secretValues, '', source.policy.containsPii),
      mapped: redact(mapped, source.policy.piiPaths, secretValues, '', source.policy.containsPii),
      durationMs: performance.now() - started,
      cached,
      mock: usedMock,
      error,
    });
    try {
      if (call.scenario && !options.preview) throw new IntegrationError('MOCK_REQUIRED');
      validateSchema(source.definition.inputSchema, call.input);
      if (call.environment === 'prod' && !options.preview && source.definition.mock?.enabled)
        throw new IntegrationError('MOCK_FORBIDDEN');
      let result: unknown;
      if (options.preview || source.definition.mock?.enabled) {
        usedMock = true;
        const scenario = call.scenario
          ? source.definition.mockScenarios.find((s) => s.key === call.scenario)
          : undefined;
        if (call.scenario && !scenario) throw new IntegrationError('MOCK_REQUIRED');
        if (!scenario && !source.definition.mock) throw new IntegrationError('MOCK_REQUIRED');
        if (scenario?.kind === 'error') throw new IntegrationError('MOCK_ERROR');
        if (scenario?.kind === 'delay')
          await new Promise<void>((resolve) => {
            setTimeout(resolve, scenario.delayMs);
          });
        raw = scenario ? scenario.response : source.definition.mock?.response;
        result = await mapValue(source.definition.mapping.response, raw);
      } else {
        const canCache =
          source.policy.cacheTtlSeconds > 0 &&
          source.policy.piiPaths.length === 0 &&
          !source.policy.containsPii &&
          !containsSensitiveSchema(source.definition.outputSchema) &&
          source.definition.method === 'GET';
        const ck = `${cacheKey(tenant, source, call, options.sessionId ?? 'designer')}:${options.credentialVersion ?? ''}`;
        if (canCache) {
          const stored = await this.cache.get(ck).catch(() => null);
          if (stored !== null) {
            try {
              const cached: unknown = JSON.parse(stored);
              validateSchema(source.definition.outputSchema, cached);
              return { value: cached, trace: trace(cached, null, true) };
            } catch {
              // Cache is best effort; corrupt or obsolete entries must not block a live read.
            }
          }
        }
        let policies = this.policies.get(key);
        if (!policies) {
          policies = this.makePolicy(source);
          if (this.policies.size > 1000) this.policies.clear();
          this.policies.set(key, policies);
        }
        const profile = source.definition.profiles[call.environment];
        const base = new URL(profile?.baseUrl ?? source.definition.baseUrl);
        const auth = profile?.auth ?? source.definition.auth;
        const endpoint = source.definition.endpoint.replace(
          /\{\{([A-Za-z0-9_.]+)\}\}/g,
          (_match, path: string) =>
            encodeURIComponent(scalarText(template(`{{${path}}}`, call.input))),
        );
        const url = new URL(endpoint, base);
        if (url.origin !== base.origin) throw new IntegrationError('EGRESS_DENIED');
        for (const [name, value] of Object.entries(source.definition.query))
          url.searchParams.set(name, scalarText(template(value, call.input)));
        const body = await mapValue(source.definition.mapping.request, call.input);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...Object.fromEntries(
            Object.entries(source.definition.headers).map(([name, value]) => [
              name,
              scalarText(template(value, call.input)),
            ]),
          ),
        };
        let encoded =
          source.definition.body === undefined ? body : template(source.definition.body, body);
        if (source.protocol === 'graphql') {
          if (!source.definition.graphql) throw new IntegrationError('GRAPHQL_CONFIG_REQUIRED');
          checkGraphql(source.definition.graphql);
          encoded = {
            query: source.definition.graphql.query,
            variables: body,
            operationName: source.definition.graphql.operationName,
          };
        }
        wire = {
          url,
          method: source.definition.method,
          headers,
          ...(['GET', 'HEAD'].includes(source.definition.method)
            ? {}
            : { body: JSON.stringify(encoded) }),
        };
        if (Buffer.byteLength(wire.body ?? '') > 1024 * 1024)
          throw new IntegrationError('REQUEST_TOO_LARGE');
        const outgoing = wire;
        if (source.protocol === 'graphql' && outgoing.method !== 'POST')
          throw new IntegrationError('GRAPHQL_POST_REQUIRED');
        if (source.protocol === 'soap' && source.definition.soap)
          outgoing.body = soapEnvelope(source.definition.soap, encoded);
        const response: WireResponse = await policies.policy.execute(async ({ signal }) => {
          const authResult = await this.authentication.apply(
            tenant,
            auth,
            outgoing,
            read,
            source.policy,
            tenantOrigins,
            signal,
          );
          secretValues = authResult.secrets;
          if (source.protocol === 'soap') {
            if (!source.definition.soap || outgoing.method !== 'POST')
              throw new IntegrationError('SOAP_CONFIG_REQUIRED');
            outgoing.headers['Content-Type'] = 'text/xml; charset=utf-8';
            outgoing.headers['SOAPAction'] = source.definition.soap.action;
            if (authResult.security)
              outgoing.body = soapEnvelope(source.definition.soap, encoded, authResult.security);
          }
          const response = await inSpan('integration.upstream', () =>
            this.transport(outgoing, source.policy, tenantOrigins, signal),
          );
          if (response.status === 401) this.authentication.invalidate(tenant);
          if (response.status >= 400)
            throw new IntegrationError(
              'UPSTREAM_ERROR',
              response.status >= 500 || response.status === 429,
            );
          return response;
        });
        raw =
          source.protocol === 'soap'
            ? xmlToJson(response.body)
            : response.body
              ? (JSON.parse(response.body) as unknown)
              : null;
        if (source.protocol === 'graphql' && raw && typeof raw === 'object' && 'errors' in raw)
          throw new IntegrationError('GRAPHQL_UPSTREAM_ERROR');
        result = scrubSecrets(
          await mapValue(source.definition.mapping.response, raw),
          secretValues,
        );
        validateSchema(source.definition.outputSchema, result);
        if (canCache)
          await this.cache
            .set(ck, JSON.stringify(result), source.policy.cacheTtlSeconds)
            .catch(() => undefined);
      }
      validateSchema(source.definition.outputSchema, result);
      return { value: result, trace: trace(result, null) };
    } catch (error) {
      stats.errors++;
      failed = true;
      const code =
        error instanceof IntegrationError
          ? error.code
          : error instanceof BrokenCircuitError
            ? 'CIRCUIT_OPEN'
            : error instanceof TaskCancelledError
              ? 'TIMEOUT'
              : error instanceof BulkheadRejectedError
                ? 'BULKHEAD_FULL'
                : 'INTEGRATION_FAILED';
      // Fallback is only for transient upstream failures, never validation/auth/SSRF failures.
      if (
        ((error instanceof IntegrationError && error.retryable) ||
          error instanceof TaskCancelledError ||
          error instanceof BrokenCircuitError ||
          error instanceof TaskCancelledError ||
          error instanceof BulkheadRejectedError) &&
        source.policy.fallback !== undefined
      ) {
        validateSchema(source.definition.outputSchema, source.policy.fallback);
        return { value: source.policy.fallback, trace: trace(source.policy.fallback, code) };
      }
      return { value: undefined, trace: trace(null, code) };
    } finally {
      const labels = {
        protocol: source.protocol,
        outcome: failed ? 'failure' : 'success',
        mode: usedMock ? 'mock' : 'live',
      };
      instruments.integrations.add(1, labels);
      instruments.integrationDuration.record((performance.now() - started) / 1000, labels);
      stats.durations.push(performance.now() - started);
      if (stats.durations.length > 1000) stats.durations.shift();
      if (this.counters.size > 1000) this.counters.delete(this.counters.keys().next().value ?? '');
    }
  }
  metrics(tenant: string, id: string) {
    return [...this.counters]
      .filter(([key]) => key.startsWith(`${tenant}:${id}:`))
      .map(([key, stats]) => {
        const sorted = [...stats.durations].sort((a, b) => a - b);
        const percentile = (p: number) =>
          sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
        return {
          profile: key.split(':').at(-1),
          calls: stats.calls,
          errors: stats.errors,
          errorRate: stats.calls ? stats.errors / stats.calls : 0,
          p50: percentile(0.5),
          p95: percentile(0.95),
          p99: percentile(0.99),
          breaker: this.policies.get(key)?.breaker.state ?? 0,
        };
      });
  }
}
