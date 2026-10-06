import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { connectGuest, type GuestApi, type GuestState } from './guest.js';

function fixture() {
  const render = vi.fn<(state: GuestState, api: GuestApi) => void>();
  const port = {
    start: vi.fn(),
    close: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
  };
  const dispose = connectGuest(z.strictObject({ value: z.string() }), render);
  const init = (
    source: MessageEventSource | null = window.parent,
    data: unknown = {
      protocol: 1,
      op: 'init',
      props: { value: 'initial' },
      locale: 'tr',
      enabled: true,
    },
    ports = [port as unknown as MessagePort],
  ) => {
    window.dispatchEvent(new MessageEvent('message', { source, data, ports }));
  };
  const send = (data: unknown) => port.onmessage?.(new MessageEvent('message', { data }));
  return {
    render,
    port,
    dispose,
    init,
    send,
    api: () => {
      const api = render.mock.calls[0]?.[1];
      if (!api) throw new Error('Guest not initialized');
      return api;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe('sandbox guest capability protocol', () => {
  it('accepts a parent-provided port once and rejects unauthenticated, invalid or portless initialization', () => {
    const f = fixture();
    try {
      f.init(null);
      f.init(window.parent, { protocol: 2 });
      f.init(window.parent, undefined, []);
      expect(f.render).not.toHaveBeenCalled();
      f.init();
      f.init();
      expect(f.render).toHaveBeenCalledOnce();
      expect(f.port.start).toHaveBeenCalledOnce();
      expect(f.render.mock.calls[0]?.[0]).toMatchObject({
        props: { value: 'initial' },
        locale: 'tr',
        enabled: true,
      });
      f.send({
        protocol: 1,
        op: 'state',
        props: { value: 'updated' },
        locale: 'en',
        enabled: false,
      });
      expect(f.render.mock.calls[1]?.[0]).toMatchObject({
        props: { value: 'updated' },
        locale: 'en',
        enabled: false,
      });
      f.send({ protocol: 9, op: 'state' });
      expect(f.render).toHaveBeenCalledTimes(2);
    } finally {
      f.dispose();
    }
  });
  it('sends sequenced emit, write and resize operations and resolves only matching acknowledgments', async () => {
    const f = fixture();
    f.init();
    try {
      const emitted = f.api().emit('onPress');
      const written = f.api().write('value', 'new');
      const resized = f.api().resize(240);
      expect(f.port.postMessage.mock.calls).toEqual([
        [{ protocol: 1, seq: 1, op: 'emit', event: 'onPress' }],
        [{ protocol: 1, seq: 2, op: 'write', prop: 'value', value: 'new' }],
        [{ protocol: 1, seq: 3, op: 'resize', height: 240 }],
      ]);
      f.send({ protocol: 1, op: 'reply', seq: 999, ok: true });
      f.send({ protocol: 1, op: 'reply', seq: 2, ok: true });
      await expect(written).resolves.toBeUndefined();
      f.send({ protocol: 1, op: 'reply', seq: 1, ok: true });
      f.send({ protocol: 1, op: 'reply', seq: 3, ok: true });
      await expect(emitted).resolves.toBeUndefined();
      await expect(resized).resolves.toBeUndefined();
    } finally {
      f.dispose();
    }
  });
  it('rejects negative replies, times out missing acknowledgments and cancels every pending request on disposal', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.init();
    const negative = expect(f.api().emit('onPress')).rejects.toThrow('VERBIS_PLUGIN_REJECTED');
    f.send({ protocol: 1, op: 'reply', seq: 1, ok: false });
    await negative;
    const timeout = expect(f.api().resize(100)).rejects.toThrow('VERBIS_PLUGIN_TIMEOUT');
    await vi.advanceTimersByTimeAsync(10000);
    await timeout;
    const pending = expect(f.api().write('value', 'pending')).rejects.toThrow(
      'VERBIS_PLUGIN_REJECTED',
    );
    f.dispose();
    await pending;
    expect(f.port.close).toHaveBeenCalledOnce();
    await expect(f.api().emit('onPress')).rejects.toThrow('VERBIS_PLUGIN_DISCONNECTED');
    expect(vi.getTimerCount()).toBe(0);
  });
});
