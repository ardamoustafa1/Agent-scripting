import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  type Span,
} from '@opentelemetry/api';

let enabled = false;
export interface AgentLaunch {
  span: Span;
  start: number;
  timeout: ReturnType<typeof setTimeout>;
}
const launches = new Map<string, AgentLaunch>();
const tracer = () => trace.getTracer('verbis.agent-web');

/** Deliberate route allow-list; no URL, session ID, query, fragment, DOM text or body is exported. */
export function routeTemplate(path: string): string {
  if (
    /^\/api\/v1\/sessions\/[^/]+\/(desktop(?:\/(?:data-source|telemetry))?|state|attach|commands|outcome|socket-ticket)$/.test(
      path,
    )
  )
    return path.replace(/(\/sessions\/)[^/]+/, '$1:id');
  if (/^\/api\/v1\/launch\/(redeem|jws|embedded|socket-ticket)$/.test(path)) return path;
  if (path === '/api/auth/session') return path;
  return 'other';
}
export function beginAgentLaunch(): AgentLaunch | undefined {
  if (!enabled) return undefined;
  const span = tracer().startSpan('agent.screen.open');
  const current: AgentLaunch = {
    span,
    start: performance.now(),
    timeout: setTimeout(() => {
      agentLaunchFailed(current);
      for (const [key, value] of launches) if (value === current) launches.delete(key);
    }, 60000),
  };
  return current;
}
export function launchHeaders(current: AgentLaunch | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (current) propagation.inject(trace.setSpan(context.active(), current.span), headers);
  return headers;
}
export function bindAgentLaunch(id: string, current: AgentLaunch | undefined): void {
  if (!current) return;
  const previous = launches.get(id);
  if (previous) agentLaunchFailed(previous);
  launches.set(id, current);
}
export function agentScreenReady(id: string): void {
  const current = launches.get(id);
  if (!current) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (launches.get(id) !== current) return;
      current.span.setAttribute('verbis.agent.open.duration_ms', performance.now() - current.start);
      current.span.setAttribute('verbis.agent.open.success', true);
      clearTimeout(current.timeout);
      current.span.end();
      launches.delete(id);
    }),
  );
}
export function agentLaunchFailed(current?: AgentLaunch | string): void {
  const handle = typeof current === 'string' ? launches.get(current) : current;
  if (!handle) return;
  clearTimeout(handle.timeout);
  handle.span.setStatus({ code: SpanStatusCode.ERROR });
  handle.span.setAttribute('verbis.agent.open.success', false);
  handle.span.end();
  if (typeof current === 'string') launches.delete(current);
}
export async function initializeObservability(): Promise<void> {
  // Public collector proxy is explicitly enabled per deployment, same origin only.
  if (import.meta.env['VITE_OTEL_ENABLED'] !== 'true' || enabled) return;
  enabled = true;
  const { createBrowserProvider } = await import('./observability-sdk.js');
  const provider = createBrowserProvider();
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const route = routeTemplate(url.pathname);
    if (url.origin !== location.origin || route === 'other') return originalFetch(input, init);
    const id = /^\/api\/v1\/sessions\/([^/]+)/.exec(url.pathname)?.[1];
    const launch = id ? launches.get(id) : undefined;
    const parent = launch
      ? trace.setSpan(context.active(), launch.span)
      : propagation.extract(context.active(), {
          traceparent: request.headers.get('traceparent') ?? '',
          tracestate: request.headers.get('tracestate') ?? '',
        });
    const span = tracer().startSpan(
      'agent.api',
      {
        kind: SpanKind.CLIENT,
        attributes: { 'http.route': route, 'http.request.method': request.method },
      },
      parent,
    );
    const carrier: Record<string, string> = {};
    propagation.inject(trace.setSpan(parent, span), carrier);
    const headers = new Headers(request.headers);
    for (const [key, value] of Object.entries(carrier)) headers.set(key, value);
    return originalFetch(new Request(request, { headers })).then(
      (response) => {
        span.setAttribute('http.response.status_code', response.status);
        if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        return response;
      },
      (error: unknown) => {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        throw error;
      },
    );
  };
  const report = (metric: { name: string; value: number }) => {
    const span = tracer().startSpan('agent.web_vital');
    span.setAttribute('verbis.vital.name', metric.name);
    span.setAttribute('verbis.vital.value', metric.value);
    span.end();
  };
  const { onCLS, onINP, onLCP, onFCP, onTTFB } = await import('web-vitals');
  onCLS(report);
  onINP(report);
  onLCP(report);
  onFCP(report);
  onTTFB(report);
  window.addEventListener('pagehide', () => {
    void provider.forceFlush();
  });
}
