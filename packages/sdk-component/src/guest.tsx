import { z } from 'zod';

import type { JsonValue } from '@verbis/script-schema';

import { HostStateSchema, HostReplySchema } from './protocol.js';

export interface GuestApi {
  emit(event: string): Promise<void>;
  write(prop: string, value: JsonValue): Promise<void>;
  resize(height: number): Promise<void>;
}
export interface GuestState {
  props: Record<string, unknown>;
  locale: 'tr' | 'en';
  enabled: boolean;
}
/** Guest imports this subpath; it receives neither runtime/store nor authenticated BFF credentials. */
export function connectGuest(
  schema: z.ZodType<Record<string, unknown>>,
  render: (state: GuestState, api: GuestApi) => void,
): () => void {
  let port: MessagePort | undefined,
    sequence = 0;
  const pending = new Map<
    number,
    { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }
  >();
  const request = (operation: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => {
      if (!port) {
        reject(new Error('VERBIS_PLUGIN_DISCONNECTED'));
        return;
      }
      const seq = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(seq);
        reject(new Error('VERBIS_PLUGIN_TIMEOUT'));
      }, 10000);
      pending.set(seq, {
        resolve,
        reject: () => {
          reject(new Error('VERBIS_PLUGIN_REJECTED'));
        },
        timer,
      });
      port.postMessage({ protocol: 1, seq, ...operation });
    });
  const api: GuestApi = Object.freeze({
    emit: (event: string) => request({ op: 'emit', event }),
    write: (prop: string, value: JsonValue) => request({ op: 'write', prop, value }),
    resize: (height: number) => request({ op: 'resize', height }),
  });
  const initSchema = HostStateSchema.omit({ op: true }).extend({ op: z.literal('init') });
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== window.parent || port) return;
    const parsed = initSchema.safeParse(event.data);
    if (!parsed.success || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = (message) => {
      const reply = HostReplySchema.safeParse(message.data);
      if (reply.success) {
        const waiter = pending.get(reply.data.seq);
        if (waiter) {
          clearTimeout(waiter.timer);
          pending.delete(reply.data.seq);
          if (reply.data.ok) waiter.resolve();
          else waiter.reject();
        }
        return;
      }
      const state = HostStateSchema.safeParse(message.data);
      if (state.success) render({ ...state.data, props: schema.parse(state.data.props) }, api);
    };
    port.start();
    render({ ...parsed.data, props: schema.parse(parsed.data.props) }, api);
  };
  window.addEventListener('message', receive);
  return () => {
    window.removeEventListener('message', receive);
    port?.close();
    port = undefined;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject();
    }
    pending.clear();
  };
}
