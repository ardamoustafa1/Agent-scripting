import { context, propagation, trace, type Tracer } from '@opentelemetry/api';
import { afterEach, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({ forceFlush: vi.fn().mockResolvedValue(undefined) }));
const vitals = vi.hoisted(() => ({
  callbacks: [] as ((value: { name: string; value: number }) => void)[],
}));
vi.mock('./observability-sdk.js', () => ({ createBrowserProvider: () => provider }));
vi.mock('web-vitals', () => {
  const register = (callback: (value: { name: string; value: number }) => void) => {
    vitals.callbacks.push(callback);
  };
  return { onCLS: register, onINP: register, onLCP: register, onFCP: register, onTTFB: register };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vitals.callbacks.length = 0;
});
async function setup(enabled = true) {
  vi.resetModules();
  vi.stubEnv('VITE_OTEL_ENABLED', enabled ? 'true' : 'false');
  const spans: {
    attributes: Record<string, unknown>;
    setAttribute: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }[] = [];
  const startSpan = vi
    .fn()
    .mockImplementation((_name: string, options?: { attributes?: Record<string, unknown> }) => {
      const span = {
        attributes: options?.attributes ?? {},
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
      };
      spans.push(span);
      return span;
    });
  vi.spyOn(trace, 'getTracer').mockReturnValue({ startSpan } as unknown as Tracer);
  vi.spyOn(trace, 'setSpan').mockImplementation((current) => current);
  vi.spyOn(propagation, 'inject').mockImplementation((_context, carrier) => {
    (carrier as Record<string, string>)['traceparent'] = '00-synthetic';
  });
  vi.spyOn(propagation, 'extract').mockReturnValue(context.active());
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  const module = await import('./observability.js');
  return { module, fetch, spans, startSpan };
}
it('leaves tracing disabled until explicitly configured and keeps launch helpers inert', async () => {
  const f = await setup(false);
  await f.module.initializeObservability();
  expect(f.module.beginAgentLaunch()).toBeUndefined();
  expect(f.module.launchHeaders(undefined)).toEqual({});
  f.module.bindAgentLaunch('synthetic', undefined);
  f.module.agentLaunchFailed();
  f.module.agentScreenReady('missing');
  expect(f.startSpan).not.toHaveBeenCalled();
});
it('correlates launches, closes replaced/failed spans and ends successful launches after paint', async () => {
  const f = await setup();
  await f.module.initializeObservability();
  await f.module.initializeObservability();
  const first = f.module.beginAgentLaunch(),
    second = f.module.beginAgentLaunch();
  expect(f.module.launchHeaders(first)).toEqual({ traceparent: '00-synthetic' });
  f.module.bindAgentLaunch('synthetic', first);
  f.module.bindAgentLaunch('synthetic', second);
  expect(f.spans[0]?.end).toHaveBeenCalledOnce();
  f.module.agentScreenReady('synthetic');
  expect(f.spans[1]?.setAttribute).toHaveBeenCalledWith('verbis.agent.open.success', true);
  expect(f.spans[1]?.end).toHaveBeenCalledOnce();
  const failed = f.module.beginAgentLaunch();
  f.module.bindAgentLaunch('failed', failed);
  f.module.agentLaunchFailed('failed');
  expect(f.spans[2]?.setAttribute).toHaveBeenCalledWith('verbis.agent.open.success', false);
  expect(f.spans[2]?.end).toHaveBeenCalledOnce();
});
it('times out abandoned launches without retaining their session binding', async () => {
  vi.useFakeTimers();
  const f = await setup();
  await f.module.initializeObservability();
  const launch = f.module.beginAgentLaunch();
  f.module.bindAgentLaunch('timed-out', launch);
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.spans[0]?.end).toHaveBeenCalledOnce();
  f.module.agentScreenReady('timed-out');
  expect(f.spans[0]?.end).toHaveBeenCalledOnce();
});
it('traces only allowed same-origin routes, strips identifiers from attributes and closes both HTTP and network failures', async () => {
  const f = await setup();
  await f.module.initializeObservability();
  const base = location.origin;
  await window.fetch(`${base}/api/v1/sessions/private-session/state?token=private-query`);
  expect(f.spans[0]?.attributes).toEqual({
    'http.route': '/api/v1/sessions/:id/state',
    'http.request.method': 'GET',
  });
  expect(JSON.stringify(f.spans[0]?.attributes)).not.toContain('private');
  expect(f.spans[0]?.end).toHaveBeenCalledOnce();
  await window.fetch('https://external.example.test/api/auth/session');
  await window.fetch(`${base}/unknown`);
  expect(f.spans).toHaveLength(1);
  f.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await window.fetch(`${base}/api/auth/session`);
  expect(f.spans[1]?.setStatus).toHaveBeenCalled();
  const error = new Error('private network details');
  f.fetch.mockRejectedValueOnce(error);
  await expect(window.fetch(`${base}/api/v1/launch/redeem`)).rejects.toBe(error);
  expect(f.spans[2]?.end).toHaveBeenCalledOnce();
  expect(f.spans[2]?.setAttribute).not.toHaveBeenCalledWith('error.message', expect.anything());
});
it('binds requests to the launch span, records only bounded vital metadata and flushes on page exit', async () => {
  const f = await setup();
  await f.module.initializeObservability();
  const launch = f.module.beginAgentLaunch();
  f.module.bindAgentLaunch('synthetic', launch);
  await window.fetch(`${location.origin}/api/v1/sessions/synthetic/desktop`);
  expect(f.spans).toHaveLength(2);
  expect(vitals.callbacks).toHaveLength(5);
  vitals.callbacks[0]?.({ name: 'CLS', value: 0.01 });
  expect(f.spans[2]?.setAttribute).toHaveBeenCalledWith('verbis.vital.name', 'CLS');
  expect(f.spans[2]?.setAttribute).toHaveBeenCalledWith('verbis.vital.value', 0.01);
  firePageHide();
  await vi.waitFor(() => {
    expect(provider.forceFlush).toHaveBeenCalled();
  });
  f.module.agentLaunchFailed('synthetic');
});
function firePageHide() {
  window.dispatchEvent(new Event('pagehide'));
}
