import { afterEach, expect, it, vi } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { Desktop, type View } from './api.js';
import { AgentController } from './controller.js';

import type { DraftVault } from './vault.js';

const socket = vi.hoisted(() => ({
  callbacks: new Map<string, () => void>(),
  disconnect: vi.fn(),
}));
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, callback: () => void) => {
      socket.callbacks.set(event, callback);
    },
    disconnect: socket.disconnect,
  }),
}));
const controllers: AgentController[] = [];
afterEach(() => {
  controllers.splice(0).forEach((controller) => {
    controller.dispose();
  });
  socket.callbacks.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture(
  state: View['state'] = 'active',
  configure?: (doc: ReturnType<typeof minimalScript>) => void,
) {
  const doc = minimalScript();
  doc.variables = [
    { key: 'name', type: 'string', scope: 'session', default: '', classification: 'public' },
    { key: 'constant', type: 'string', scope: 'global', default: 'fixed' },
    { key: 'payment', type: 'string', scope: 'session', classification: 'pci' },
  ];
  configure?.(doc);
  const desktop = Desktop.parse({
    view: {
      id: '01928f3a-0000-7000-8000-000000000001',
      state,
      sequence: 1,
      readOnly: true,
      snapshot: {
        variables: { name: '', payment: 'must-not-display' },
        currentPage: 'home',
        history: [],
        timers: {},
      },
    },
    document: doc,
    checksum: 'synthetic-checksum',
    startedAt: '2026-10-03T10:00:00Z',
    interaction: {
      channel: 'chat',
      status: 'connected',
      queue: null,
      platform: 'simulator',
      customerName: null,
      context: {},
    },
    campaign: { name: 'Synthetic campaign', outcomes: [] },
    writeback: 'none',
  });
  let view = structuredClone(desktop.view);
  const save = vi.fn().mockResolvedValue(undefined),
    load = vi.fn().mockResolvedValue(null),
    remove = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url, options) => {
    const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      body =
        typeof options?.body === 'string'
          ? (JSON.parse(options.body) as Record<string, unknown>)
          : undefined;
    if (path.endsWith('/attach'))
      return Promise.resolve(
        Response.json({
          ...view,
          readOnly: false,
          writeToken: 'synthetic-writer-token',
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
        }),
      );
    if (path.endsWith('/socket-ticket'))
      return Promise.resolve(Response.json({ ticket: 'synthetic-ticket' }));
    if (path.endsWith('/desktop'))
      return Promise.resolve(Response.json({ ...desktop, view, writeback: 'success' }));
    if (path.endsWith('/commands')) {
      const command = body?.['command'] as Record<string, unknown> | undefined;
      view = { ...view, sequence: view.sequence + 1 };
      if (command?.['type'] === 'field')
        view.snapshot.variables[String(command['variable'])] = String(command['value']);
      if (command?.['type'] === 'transition') view.state = command['state'] as View['state'];
    }
    if (path.endsWith('/outcome'))
      view = { ...view, sequence: view.sequence + 1, state: 'completed' };
    return Promise.resolve(Response.json(view));
  });
  vi.stubGlobal('fetch', fetch);
  const controller = new AgentController(
    desktop.view.id,
    desktop,
    'synthetic-csrf',
    { save, load, remove } as unknown as DraftVault,
    'en',
  );
  controllers.push(controller);
  return {
    controller,
    desktop,
    save,
    load,
    remove,
    fetch,
    remote: () => view,
    setRemote: (next: View) => {
      view = next;
    },
  };
}
function requests(f: ReturnType<typeof fixture>, suffix: string) {
  return f.fetch.mock.calls.filter(([url]) =>
    (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith(suffix),
  );
}
function body(
  call: (typeof globalThis.fetch extends (...args: infer A) => unknown ? A : never) | undefined,
): Record<string, unknown> {
  return typeof call?.[1]?.body === 'string'
    ? (JSON.parse(call[1].body) as Record<string, unknown>)
    : {};
}
it('persists field drafts before sending sequenced commands and removes pending writes after acknowledgement', async () => {
  const f = fixture(),
    listener = vi.fn(),
    unsubscribe = f.controller.subscribe(listener);
  await f.controller.initialize();
  f.controller.runtime.store.setVariable('name', 'Synthetic edit');
  await vi.waitFor(() => {
    expect(f.controller.getSnapshot().pending).toBe(0);
    expect(requests(f, '/commands')).toHaveLength(1);
  });
  expect(body(requests(f, '/commands')[0])).toMatchObject({
    expectedSequence: 1,
    command: { type: 'field', variable: 'name', value: 'Synthetic edit' },
  });
  expect(f.save).toHaveBeenCalled();
  expect(f.controller.runtime.store.variable('payment')).toBeNull();
  unsubscribe();
});
it.each(['completed', 'abandoned', 'expired'] as const)(
  'restores terminal %s sessions read-only without acquiring a writer',
  async (state) => {
    const f = fixture(state);
    await f.controller.initialize();
    expect(f.controller.getSnapshot().readOnly).toBe(true);
    expect(requests(f, '/attach')).toHaveLength(0);
    expect(f.controller.runtime.store.get('runtime.page')).toBe('home');
    await f.controller.refresh();
    expect(f.controller.getSnapshot().writeback).toBe('success');
  },
);
it('restores matching persisted drafts before acquiring a writer and synchronizing', async () => {
  const f = fixture();
  f.load.mockResolvedValue({
    checksum: 'synthetic-checksum',
    pending: { name: { value: 'Restored synthetic value', base: '' } },
    note: 'Restored note',
    disposition: 'DONE',
    callbackAt: '',
  });
  await f.controller.initialize();
  expect(f.controller.getSnapshot().note).toBe('Restored note');
  expect(f.controller.runtime.store.variable('name')).toBe('Restored synthetic value');
  expect(requests(f, '/commands')).toHaveLength(1);
});
it.each(['unknown', 'payment'])(
  'refuses unsafe draft variable %s before acquiring a writer',
  async (key) => {
    const f = fixture();
    f.load.mockResolvedValue({
      checksum: 'synthetic-checksum',
      pending: { [key]: { value: 'unsafe draft', base: null } },
      note: '',
      disposition: '',
      callbackAt: '',
    });
    await expect(f.controller.initialize()).rejects.toThrow('VERBIS_DRAFT_INVALID');
    expect(requests(f, '/attach')).toHaveLength(0);
  },
);
it('does not initialize a disposed controller after a delayed vault response', async () => {
  const f = fixture();
  let finish: ((value: null) => void) | undefined;
  f.load.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const initializing = f.controller.initialize();
  f.controller.dispose();
  finish?.(null);
  await initializing;
  expect(f.fetch).not.toHaveBeenCalled();
});
it.each(['acknowledged', 'unchanged', 'conflict'] as const)(
  'recovers a 412 field response when the remote value is %s',
  async (mode) => {
    const f = fixture();
    await f.controller.initialize();
    const original = f.fetch.getMockImplementation()!;
    let conflicted = false;
    f.fetch.mockImplementation((url, options) => {
      if (
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith(
          '/commands',
        ) &&
        !conflicted
      ) {
        conflicted = true;
        f.setRemote({
          ...f.remote(),
          sequence: 2,
          snapshot: {
            ...f.remote().snapshot,
            variables: {
              name:
                mode === 'acknowledged' ? 'Local edit' : mode === 'unchanged' ? '' : 'Foreign edit',
            },
          },
        });
        return Promise.resolve(Response.json({ code: 'VERBIS_SEQUENCE' }, { status: 412 }));
      }
      return original(url, options);
    });
    f.controller.runtime.store.setVariable('name', 'Local edit');
    if (mode === 'conflict') {
      await vi.waitFor(() => {
        expect(f.controller.getSnapshot().error).toBe('conflict');
      });
      expect(f.controller.getSnapshot().pending).toBe(1);
      await f.controller.resolveConflict('server');
      expect(f.controller.runtime.store.variable('name')).toBe('Foreign edit');
    } else {
      await vi.waitFor(() => {
        expect(f.controller.getSnapshot().pending).toBe(0);
      });
      expect(requests(f, '/commands')).toHaveLength(mode === 'unchanged' ? 2 : 1);
    }
  },
);
it.each([401, 403, 503])(
  'retains pending drafts after HTTP %s and can recover after renewal',
  async (status) => {
    const f = fixture();
    await f.controller.initialize();
    f.fetch.mockResolvedValueOnce(Response.json({ code: 'synthetic' }, { status }));
    f.controller.runtime.store.setVariable('name', 'Pending edit');
    await vi.waitFor(() => {
      expect(f.controller.getSnapshot().error).toBe(status === 503 ? 'sync' : 'authorization');
    });
    expect(f.controller.getSnapshot().pending).toBe(1);
    if (status !== 503) expect(f.controller.getSnapshot().readOnly).toBe(true);
    else expect(f.controller.getSnapshot().online).toBe(false);
    await f.controller.resolveConflict('local');
    expect(f.controller.getSnapshot().pending).toBe(0);
    expect(f.controller.runtime.store.variable('name')).toBe('Pending edit');
  },
);
it('marks storage failure explicitly and retains the draft without issuing a field command', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.save.mockRejectedValue(new Error('private storage error'));
  f.controller.preferences({ note: 'Synthetic note' });
  await vi.waitFor(() => {
    expect(f.controller.getSnapshot().error).toBe('storage');
  });
  expect(requests(f, '/commands')).toHaveLength(0);
});
it('submits outcome fields and callback time without payment data or global constants, then removes the encrypted draft', async () => {
  const f = fixture();
  await f.controller.initialize();
  f.controller.preferences({
    note: 'Synthetic wrap-up note',
    disposition: 'DONE',
    callbackAt: '2026-10-04T14:30:00Z',
  });
  await f.controller.wrapup();
  await f.controller.wrapup();
  expect(requests(f, '/commands')).toHaveLength(1);
  await f.controller.complete(['synthetic-subcode']);
  const outcome = body(requests(f, '/outcome')[0]);
  expect(outcome).toMatchObject({
    code: 'DONE',
    note: 'Synthetic wrap-up note',
    fields: { name: '' },
    callbackAt: '2026-10-04T14:30:00.000Z',
  });
  expect(outcome['fields']).not.toHaveProperty('payment');
  expect(outcome['fields']).not.toHaveProperty('constant');
  expect(f.remove).toHaveBeenCalledWith(f.controller.id);
  expect(f.controller.getSnapshot()).toMatchObject({ readOnly: true, writeback: 'queued' });
});
it('passes secure receipts only to the host endpoint and rejects offline use', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.confirmSecureReceipt(
    'payment',
    'synthetic-receipt',
    new AbortController().signal,
  );
  expect(body(requests(f, '/secure-field')[0])).toMatchObject({
    variable: 'payment',
    receipt: 'synthetic-receipt',
  });
  expect(JSON.stringify(f.save.mock.calls)).not.toContain('synthetic-receipt');
  await vi.waitFor(() => {
    expect(socket.callbacks.has('runtime.error')).toBe(true);
  });
  socket.callbacks.get('runtime.error')?.();
  await expect(
    f.controller.confirmSecureReceipt('payment', 'synthetic', new AbortController().signal),
  ).rejects.toMatchObject({ code: 'VERBIS_OFFLINE' });
});
it('refreshes on socket events, ignores older views and revokes writer authority on runtime errors', async () => {
  const f = fixture();
  await f.controller.initialize();
  await vi.waitFor(() => {
    expect(socket.callbacks.has('runtime.event')).toBe(true);
  });
  f.setRemote({ ...f.remote(), sequence: 0 });
  await f.controller.refresh();
  expect(f.controller.getSnapshot().view.sequence).toBe(1);
  f.setRemote({ ...f.remote(), sequence: 2 });
  socket.callbacks.get('runtime.event')?.();
  await vi.waitFor(() => {
    expect(f.controller.getSnapshot().writeback).toBe('success');
  });
  socket.callbacks.get('runtime.error')?.();
  expect(f.controller.getSnapshot()).toMatchObject({ readOnly: true, error: 'authorization' });
  await f.controller.renew();
  expect(f.controller.getSnapshot()).toMatchObject({ readOnly: false, error: null });
});
it('forwards host-supported script actions and rejects unavailable platform capabilities', async () => {
  const f = fixture();
  await f.controller.initialize();
  await f.controller.runtime.executor.execute([
    { type: 'setDisposition', code: 'DONE' },
    { type: 'transferHint', target: 'Synthetic support' },
    { type: 'showToast', messageKey: 'common.next', tone: 'info' },
  ]);
  expect(f.controller.getSnapshot()).toMatchObject({ disposition: 'DONE', notice: 'Next' });
  await expect(
    f.controller.runtime.executor.execute([{ type: 'writeBackToPlatform', attributes: {} }]),
  ).rejects.toThrow('VERBIS_PLATFORM_ACTION_UNAVAILABLE');
  await f.controller.runtime.executor.execute([{ type: 'submitOutcome', outcome: 'DONE' }]);
  await vi.waitFor(() => {
    expect(f.controller.getSnapshot().view.state).toBe('wrapup');
  });
});
it('executes a server datasource with writer claim, request inputs and caller cancellation', async () => {
  const f = fixture('active', (doc) => {
    doc.dataSources = [
      {
        id: 'lookup',
        ref: 'tenant-datasource:lookup',
        version: 1,
        inputs: { name: { $expr: 'vars.name' } },
        outputs: { answer: { path: '$.answer' } },
      },
    ];
  });
  await f.controller.initialize();
  const original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation((url, options) =>
    typeof url === 'string' && url.endsWith('/data-source')
      ? Promise.resolve(
          Response.json({
            value: { answer: 'Synthetic result' },
            view: { ...f.remote(), sequence: 2 },
          }),
        )
      : original(url, options),
  );
  await f.controller.runtime.executor.execute([{ type: 'callDataSource', dataSource: 'lookup' }]);
  expect(body(requests(f, '/data-source')[0])).toMatchObject({
    expectedSequence: 1,
    sourceId: 'lookup',
    input: { name: '' },
    writeToken: 'synthetic-writer-token',
  });
  expect(requests(f, '/data-source')[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  expect(f.controller.getSnapshot().view.sequence).toBe(2);
});
it('checks writer readiness before navigation and submits the new page with bounded history', async () => {
  const f = fixture('active', (doc) => {
    doc.pages.push({ id: 'second', name: 'Second', layout: { id: 'second-root', type: 'box' } });
    doc.flow.nodes.splice(1, 0, { id: 'n-second', type: 'page', page: 'second' });
    doc.flow.edges = [
      { id: 'e1', from: 'n-home', to: 'n-second' },
      { id: 'e2', from: 'n-second', to: 'n-end' },
    ];
  });
  await f.controller.initialize();
  await f.controller.runtime.next();
  expect(f.controller.runtime.store.get('runtime.page')).toBe('second');
  expect(body(requests(f, '/commands')[0])).toMatchObject({
    command: { type: 'page', pageId: 'second', history: ['home'] },
  });
  await f.controller.runtime.back();
  expect(f.controller.runtime.store.get('runtime.page')).toBe('home');
  await vi.waitFor(() => {
    expect(socket.callbacks.has('runtime.error')).toBe(true);
  });
  socket.callbacks.get('runtime.error')?.();
  await expect(f.controller.runtime.next()).rejects.toThrow('VERBIS_NAVIGATION_NOT_READY');
  expect(f.controller.runtime.store.get('runtime.page')).toBe('home');
});
it('activates launching sessions once and emits safe runtime telemetry through the host endpoint', async () => {
  const f = fixture('launching');
  await f.controller.initialize();
  expect(f.controller.getSnapshot().view.state).toBe('active');
  expect(body(requests(f, '/commands')[0])).toMatchObject({
    command: { type: 'transition', state: 'active' },
  });
  f.controller.runtime.recordInput({ type: 'read', node: 'synthetic-text', acknowledged: true });
  await vi.waitFor(() => {
    expect(requests(f, '/telemetry').length).toBeGreaterThan(0);
  });
  expect(body(requests(f, '/telemetry')[0])).toHaveProperty('metadata');
});
it('preserves a newer local edit while the older command acknowledgement is in flight', async () => {
  const f = fixture();
  await f.controller.initialize();
  const original = f.fetch.getMockImplementation()!;
  let finish: (() => void) | undefined;
  let delayed = false;
  f.fetch.mockImplementation((url, options) => {
    if (typeof url === 'string' && url.endsWith('/commands') && !delayed) {
      delayed = true;
      return new Promise((resolve) => {
        finish = () => {
          void original(url, options).then(resolve);
        };
      });
    }
    return original(url, options);
  });
  f.controller.runtime.store.setVariable('name', 'First local edit');
  await vi.waitFor(() => {
    expect(finish).toBeDefined();
  });
  f.controller.runtime.store.setVariable('name', 'Newer local edit');
  finish?.();
  await vi.waitFor(() => {
    expect(f.controller.getSnapshot().pending).toBe(0);
  });
  expect(f.controller.runtime.store.variable('name')).toBe('Newer local edit');
  expect(requests(f, '/commands').map((call) => body(call)['expectedSequence'])).toEqual([1, 2]);
  expect(f.remote().snapshot.variables['name']).toBe('Newer local edit');
});
it('renews and refreshes live sessions on the heartbeat, reports failure, and cancels timers on dispose', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.controller.initialize();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(requests(f, '/attach')).toHaveLength(2);
  expect(requests(f, '/state')).toHaveLength(1);
  f.fetch.mockRejectedValueOnce(new Error('synthetic unavailable'));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(f.controller.getSnapshot().online).toBe(false);
  await expect(
    f.controller.command({ type: 'page', pageId: 'home', history: [] }),
  ).rejects.toMatchObject({ code: 'VERBIS_OFFLINE' });
  await expect(f.controller.wrapup()).rejects.toMatchObject({ code: 'VERBIS_OFFLINE' });
  await expect(f.controller.complete()).rejects.toMatchObject({ code: 'VERBIS_OFFLINE' });
  f.controller.dispose();
  const count = f.fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(f.fetch).toHaveBeenCalledTimes(count);
});
it('reconnects after a socket error, renews on resume, and prevents reconnect after disposal', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.controller.initialize();
  await vi.advanceTimersByTimeAsync(0);
  socket.callbacks.get('connect_error')?.();
  socket.callbacks.get('disconnect')?.();
  expect(f.controller.getSnapshot().online).toBe(false);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(requests(f, '/socket-ticket')).toHaveLength(2);
  socket.callbacks.get('runtime.resume')?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.controller.getSnapshot().online).toBe(true);
  expect(requests(f, '/attach')).toHaveLength(1);
  socket.callbacks.get('disconnect')?.();
  f.controller.dispose();
  const count = f.fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3_000);
  expect(f.fetch).toHaveBeenCalledTimes(count);
});
it('does not poll a terminal session or obtain a writer', async () => {
  vi.useFakeTimers();
  const f = fixture('expired');
  await f.controller.initialize();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(requests(f, '/state')).toHaveLength(0);
  expect(requests(f, '/attach')).toHaveLength(0);
});
it('retains read-only authority when renewal omits the writer token and rejects writer commands', async () => {
  const f = fixture();
  f.fetch.mockResolvedValueOnce(
    Response.json({ ...f.remote(), readOnly: false, leaseUntil: null }),
  );
  await f.controller.initialize();
  expect(f.controller.getSnapshot().readOnly).toBe(true);
  await expect(
    f.controller.command({ type: 'page', pageId: 'home', history: [] }),
  ).rejects.toMatchObject({ code: 'VERBIS_WRITER_REQUIRED' });
});
it('ignores a socket ticket that arrives after controller disposal', async () => {
  const f = fixture();
  const original = f.fetch.getMockImplementation()!;
  let finish: ((response: Response) => void) | undefined;
  f.fetch.mockImplementation((url, options) =>
    typeof url === 'string' && url.endsWith('/socket-ticket')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(url, options),
  );
  await f.controller.initialize();
  await vi.waitFor(() => {
    expect(finish).toBeDefined();
  });
  f.controller.dispose();
  finish?.(Response.json({ ticket: 'synthetic' }));
  await Promise.resolve();
  expect(socket.callbacks.has('runtime.error')).toBe(false);
});

it('avoids a second attach on the initial socket resume and releases on pagehide with CSRF', async () => {
  const f = fixture();
  await f.controller.initialize();
  await vi.waitFor(() => {
    expect(socket.callbacks.has('runtime.resume')).toBe(true);
  });
  socket.callbacks.get('runtime.resume')?.();
  await vi.waitFor(() => {
    expect(requests(f, '/state').length).toBeGreaterThan(0);
  });
  expect(requests(f, '/attach')).toHaveLength(1);
  window.dispatchEvent(new Event('pagehide'));
  const release = requests(f, '/release')[0];
  expect(release?.[1]).toMatchObject({
    keepalive: true,
    headers: { 'x-csrf-token': 'synthetic-csrf' },
  });
  expect(body(release)).toMatchObject({
    tabId: f.controller.tabId,
    writeToken: 'synthetic-writer-token',
  });
});
it.each(['block', 'continue', 'manual'] as const)(
  'offers the authored %s datasource recovery and retries the current inputs',
  async (policy) => {
    const f = fixture('active', (doc) => {
      doc.dataSources = [
        {
          id: 'lookup',
          ref: 'tenant-datasource:lookup',
          version: 1,
          inputs: { name: { $expr: 'vars.name' } },
          outputs: { answer: { path: '$.answer', variable: 'name' } },
          policy: { onFailure: policy },
        },
      ];
    });
    await f.controller.initialize();
    const original = f.fetch.getMockImplementation()!;
    let unavailable = true;
    f.fetch.mockImplementation((url, options) =>
      typeof url === 'string' && url.endsWith('/data-source')
        ? Promise.resolve(
            unavailable
              ? Response.json(
                  { code: 'VERBIS_INTEGRATION_UNAVAILABLE', correlationId: 'support-ds' },
                  { status: 503 },
                )
              : Response.json({ value: { answer: 'Recovered' }, view: f.remote() }),
          )
        : original(url, options),
    );
    await expect(f.controller.runtime.callDataSource('lookup', undefined)).rejects.toThrow();
    expect(f.controller.getSnapshot().dataFailure).toMatchObject({
      policy,
      sourceId: 'lookup',
      failure: { correlationId: 'support-ds' },
    });
    await expect(f.controller.runtime.next()).rejects.toThrow('VERBIS_NAVIGATION_NOT_READY');
    if (policy === 'block') {
      await expect(f.controller.recoverDataSource('continue')).rejects.toThrow(
        'VERBIS_RECOVERY_FORBIDDEN',
      );
      unavailable = false;
      await f.controller.recoverDataSource('retry');
      expect(f.controller.runtime.store.variable('name')).toBe('Recovered');
    } else {
      if (policy === 'manual') f.controller.runtime.store.setVariable('name', 'Manual answer');
      await f.controller.recoverDataSource(policy);
      expect(body(requests(f, '/data-source-recovery')[0])).toMatchObject({
        sourceId: 'lookup',
        mode: policy,
      });
      if (policy === 'manual')
        expect(f.controller.runtime.store.get('ds.lookup')).toMatchObject({
          answer: 'Manual answer',
          status: 'success',
        });
    }
    expect(f.controller.getSnapshot().dataFailure).toBeNull();
  },
);

it('honors script-authored onError actions instead of blocking their fallback', async () => {
  const f = fixture('active', (doc) => {
    doc.dataSources = [{ id: 'lookup', ref: 'tenant-datasource:lookup', version: 1 }];
  });
  await f.controller.initialize();
  const original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation((url, options) =>
    typeof url === 'string' && url.endsWith('/data-source')
      ? Promise.resolve(Response.json({ code: 'VERBIS_INTEGRATION_UNAVAILABLE' }, { status: 503 }))
      : original(url, options),
  );
  await f.controller.runtime.executor.execute([
    {
      type: 'callDataSource',
      dataSource: 'lookup',
      onError: [
        { type: 'setVariable', variable: 'name', value: 'Authored fallback' },
        { type: 'next' },
      ],
    },
  ]);
  expect(f.controller.getSnapshot().dataFailure).toBeNull();
  expect(f.controller.runtime.store.variable('name')).toBe('Authored fallback');
  await vi.waitFor(() => {
    expect(f.controller.getSnapshot().view.state).toBe('wrapup');
  });
});

it('preserves conflicting local drafts during takeover instead of overwriting the remote writer', async () => {
  const f = fixture();
  f.load.mockResolvedValue({
    checksum: 'synthetic-checksum',
    pending: { name: { base: '', value: 'Local draft' } },
    note: '',
    disposition: '',
    callbackAt: '',
  });
  const original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation((url, options) =>
    typeof url === 'string' && (url.endsWith('/attach') || url.endsWith('/takeover'))
      ? Promise.resolve(
          Response.json({
            ...f.remote(),
            readOnly: url.endsWith('/attach'),
            ...(url.endsWith('/takeover') ? { writeToken: 'new-writer' } : {}),
            leaseUntil: new Date(Date.now() + 60000).toISOString(),
          }),
        )
      : original(url, options),
  );
  await f.controller.initialize();
  f.remote().snapshot.variables['name'] = 'Remote edit';
  await f.controller.takeover();
  expect(f.controller.getSnapshot().error).toBe('conflict');
  expect(f.controller.runtime.store.variable('name')).toBe('Local draft');
  expect(requests(f, '/commands')).toHaveLength(0);
});
it('exposes timeout recovery even when the datasource transport does not settle', async () => {
  vi.useFakeTimers();
  const f = fixture('active', (doc) => {
    doc.dataSources = [
      {
        id: 'lookup',
        ref: 'tenant-datasource:lookup',
        version: 1,
        policy: { timeoutMs: 100, onFailure: 'continue' },
      },
    ];
  });
  await f.controller.initialize();
  const original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation((url, options) =>
    typeof url === 'string' && url.endsWith('/data-source')
      ? new Promise(() => undefined)
      : original(url, options),
  );
  const call = f.controller.runtime.callDataSource('lookup', undefined);
  const rejected = expect(call).rejects.toThrow('VERBIS_DATASOURCE_TIMEOUT');
  await vi.advanceTimersByTimeAsync(101);
  await rejected;
  expect(f.controller.getSnapshot().dataFailure).toMatchObject({
    sourceId: 'lookup',
    policy: 'continue',
    failure: { kind: 'network' },
  });
  await f.controller.recoverDataSource('continue');
  expect(f.controller.getSnapshot().dataFailure).toBeNull();
});
it('releases a lease granted after the controller was disposed during attach', async () => {
  const f = fixture();
  const original = f.fetch.getMockImplementation()!;
  let finish: ((response: Response) => void) | undefined;
  f.fetch.mockImplementation((url, options) =>
    typeof url === 'string' && url.endsWith('/attach')
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : original(url, options),
  );
  const initialized = f.controller.initialize();
  await vi.waitFor(() => {
    expect(finish).toBeDefined();
  });
  f.controller.dispose();
  finish?.(
    Response.json({
      ...f.remote(),
      readOnly: false,
      writeToken: 'late-writer',
      leaseUntil: new Date(Date.now() + 60000).toISOString(),
    }),
  );
  await initialized;
  expect(body(requests(f, '/release')[0])).toMatchObject({
    tabId: f.controller.tabId,
    writeToken: 'late-writer',
  });
  expect(requests(f, '/socket-ticket')).toHaveLength(0);
});

it('takes over a launching session with one fenced activation command', async () => {
  const f = fixture('launching');
  const original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation((url, options) => {
    if (typeof url === 'string' && url.endsWith('/attach'))
      return Promise.resolve(
        Response.json({
          ...f.remote(),
          readOnly: true,
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
        }),
      );
    if (typeof url === 'string' && url.endsWith('/takeover'))
      return Promise.resolve(
        Response.json({
          ...f.remote(),
          readOnly: false,
          writeToken: 'takeover-writer',
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
        }),
      );
    return original(url, options);
  });
  await f.controller.initialize();
  expect(f.controller.getSnapshot().readOnly).toBe(true);
  await f.controller.takeover();
  expect(f.controller.getSnapshot().view.state).toBe('active');
  expect(requests(f, '/takeover')).toHaveLength(1);
  expect(requests(f, '/commands').map(body)).toContainEqual({
    expectedSequence: 1,
    tabId: f.controller.tabId,
    writeToken: 'takeover-writer',
    command: { type: 'transition', state: 'active' },
  });
});
it('retains a read-only session and classifies a denied takeover with its support code', async () => {
  const f = fixture();
  const original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation((url, options) => {
    if (typeof url === 'string' && url.endsWith('/attach'))
      return Promise.resolve(Response.json({ ...f.remote(), readOnly: true, leaseUntil: null }));
    if (typeof url === 'string' && url.endsWith('/takeover'))
      return Promise.resolve(
        Response.json(
          { code: 'VERBIS_AUTHZ_DENIED', correlationId: 'denied-takeover' },
          { status: 403 },
        ),
      );
    return original(url, options);
  });
  await f.controller.initialize();
  await expect(f.controller.takeover()).rejects.toMatchObject({
    status: 403,
    correlationId: 'denied-takeover',
  });
  expect(f.controller.getSnapshot().readOnly).toBe(true);
  expect(requests(f, '/commands')).toHaveLength(0);
});
it('pagehide release tolerates a network failure without losing the local draft', async () => {
  const f = fixture();
  await f.controller.initialize();
  const original = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation((url, options) =>
    typeof url === 'string' && url.endsWith('/release')
      ? Promise.reject(new TypeError('Offline'))
      : original(url, options),
  );
  f.controller.releaseOnPageHide();
  await vi.waitFor(() => {
    expect(requests(f, '/release')).toHaveLength(1);
  });
  expect(f.remove).not.toHaveBeenCalled();
});

it('receives terminal writeback acknowledgment through runtime push without polling', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.controller.initialize();
  await f.controller.complete();
  expect(f.controller.getSnapshot().writeback).toBe('queued');
  socket.callbacks.get('runtime.event')?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.controller.getSnapshot().writeback).toBe('success');
  const count = requests(f, '/state').length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(requests(f, '/state')).toHaveLength(count);
  expect(socket.disconnect).toHaveBeenCalled();
});
