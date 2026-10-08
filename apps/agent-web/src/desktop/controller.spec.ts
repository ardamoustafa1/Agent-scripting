import { afterEach, describe, expect, it, vi } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { Desktop } from './api.js';
import { AgentController } from './controller.js';

import type { DraftVault } from './vault.js';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), disconnect: vi.fn() }) }));
const id = '01928f3a-0000-7000-8000-000000000001';
function fixture() {
  const desktop = Desktop.parse({
    view: {
      id,
      state: 'active',
      sequence: 1,
      readOnly: true,
      snapshot: { variables: {}, currentPage: 'home', history: [], timers: {} },
    },
    document: minimalScript(),
    checksum: 'synthetic',
    startedAt: '2026-10-03T09:00:00Z',
    interaction: {
      channel: 'voice',
      status: 'connected',
      queue: 'Synthetic queue',
      platform: 'simulator',
      customerName: 'Synthetic customer',
      context: {},
    },
    campaign: { name: 'Synthetic campaign', outcomes: [] },
    agent: { id, displayName: 'Ayşe Yılmaz', firstName: 'Ayşe' },
    writeback: 'none',
  });
  const save = vi.fn().mockResolvedValue(undefined),
    load = vi.fn().mockResolvedValue(null),
    remove = vi.fn().mockResolvedValue(undefined);
  const requests: { path: string; body: unknown }[] = [];
  let sequence = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options?: RequestInit) => {
      const body: unknown =
        typeof options?.body === 'string' ? JSON.parse(options.body) : undefined;
      requests.push({ path: url, body });
      const result = url.endsWith('/attach')
        ? {
            ...desktop.view,
            readOnly: false,
            writeToken: 'a'.repeat(43),
            leaseUntil: '2026-10-03T10:00:00Z',
          }
        : url.endsWith('/socket-ticket')
          ? { ticket: 'synthetic' }
          : url.endsWith('/commands')
            ? { ...desktop.view, sequence: ++sequence }
            : desktop.view;
      return Promise.resolve(
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  const controller = new AgentController(
    id,
    desktop,
    'synthetic-csrf',
    { save, load, remove } as unknown as DraftVault,
    'en',
  );
  return { controller, save, load, requests, desktop };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('independent agent session writer', () => {
  it('attaches with a tab identity and resumes without executing on-enter actions', async () => {
    const f = fixture();
    f.controller.runtime.document.pages[0]?.onEnter.push({
      type: 'setVariable',
      variable: 'customerName',
      value: 'must-not-replay',
    });
    await f.controller.initialize();
    expect(f.controller.getSnapshot().readOnly).toBe(false);
    expect(f.requests.filter((r) => r.path.endsWith('/commands'))).toHaveLength(0);
    expect(f.controller.runtime.store.get('runtime.page')).toBe('home');
    f.controller.dispose();
  });
  it('has different writer identities for simultaneous interactions', () => {
    const a = fixture(),
      b = fixture();
    expect(a.controller.tabId).not.toBe(b.controller.tabId);
    a.controller.dispose();
    b.controller.dispose();
  });
  it('persists wrap-up edits through the vault without storing the CSRF or writer capability', async () => {
    const f = fixture();
    f.controller.preferences({ note: 'Synthetic note', disposition: 'SUCCESS' });
    await vi.waitFor(() => {
      expect(f.save).toHaveBeenCalled();
    });
    const serialized = JSON.stringify(f.save.mock.calls);
    expect(serialized).toContain('Synthetic note');
    expect(serialized).not.toContain('synthetic-csrf');
    expect(serialized).not.toContain('writeToken');
    f.controller.dispose();
  });
  it('retains a draft with a mismatched checksum and refuses to acquire a writer', async () => {
    const f = fixture();
    f.load.mockResolvedValue({
      checksum: 'different',
      pending: {},
      note: 'Synthetic retained note',
      disposition: '',
      callbackAt: '',
    });
    await f.controller.initialize();
    expect(f.controller.getSnapshot().error).toBe('version');
    expect(f.requests).toHaveLength(0);
    expect(f.save).not.toHaveBeenCalled();
    f.controller.dispose();
  });
});
// M-Z6: `agent.firstName` bindings rendered empty because the runtime had no agent context.
describe('script personalization context', () => {
  it('exposes the signed-in agent name to agent.* bindings', () => {
    const f = fixture();
    expect(f.controller.runtime.store.contextRoots['agent']).toEqual({
      id,
      displayName: 'Ayşe Yılmaz',
      firstName: 'Ayşe',
    });
    f.controller.dispose();
  });
  it('accepts a desktop payload without agent details and leaves the gap visible', () => {
    const { agent: _omitted, ...legacy } = fixture().desktop;
    const controller = new AgentController(
      id,
      Desktop.parse(legacy),
      'synthetic-csrf',
      { save: vi.fn(), load: vi.fn(), remove: vi.fn() } as unknown as DraftVault,
      'en',
    );
    expect(controller.runtime.store.contextRoots['agent']).toEqual({});
    controller.dispose();
  });
});
describe('probable notices (ADR-0052 E5)', () => {
  it('records AI "probably said" marks without touching the runtime acknowledgement', () => {
    const f = fixture();
    expect(f.controller.getSnapshot().probablySaid).toEqual([]);
    f.controller.markProbablySaid(['notice-a']);
    f.controller.markProbablySaid(['notice-a', 'notice-b']);
    expect(f.controller.getSnapshot().probablySaid).toEqual(['notice-a', 'notice-b']);
    expect(f.controller.runtime.store.get('runtime.read.notice-a')).not.toBe(true);
    f.controller.dispose();
  });
});
