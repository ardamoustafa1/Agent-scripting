import { EventEmitter } from 'node:events';

import { afterEach, expect, it, vi } from 'vitest';

import { PolicySchema } from './contracts.js';
import { createSecureTransport, resolveTarget } from './transport.js';

import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';

const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: network.request }));
const policy = PolicySchema.parse({ allowedOrigins: ['https://service.test'], timeoutMs: 100 });
const origins = ['https://service.test'];
const wire = { url: new URL('https://service.test'), method: 'GET' as const, headers: {} };
const dns = vi.fn().mockResolvedValue([{ address: '93.184.215.14', family: 4 }]);
afterEach(() => {
  vi.clearAllMocks();
});
function connection(response: (res: IncomingMessage) => void) {
  const req = new EventEmitter() as ClientRequest;
  let timeout: (() => void) | undefined;
  req.setTimeout = vi.fn((_ms: number, callback?: () => void) => {
    timeout = callback;
    return req;
  });
  const destroy = vi.fn((error?: Error) => {
    queueMicrotask(() => req.emit('error', error));
    return req;
  });
  req.destroy = destroy;
  req.end = vi.fn(() => {
    queueMicrotask(() => {
      response(res);
    });
    return req;
  }) as ClientRequest['end'];
  const res = new EventEmitter() as IncomingMessage;
  res.headers = { 'x-empty': undefined };
  res.statusCode = 200;
  res.destroy = vi.fn(() => res);
  return { req, res, destroy, expire: () => timeout?.() };
}
it('pins the actual socket lookup and refuses truncated network responses', async () => {
  let socket: ReturnType<typeof connection> | undefined;
  network.request.mockImplementation(
    (_url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => {
      expect(options.rejectUnauthorized).toBe(true);
      const lookup = options.lookup as (
        host: string,
        options: object,
        callback: (error: null, address: string, family: number) => void,
      ) => void;
      const resolved = vi.fn();
      lookup('service.test', {}, resolved);
      expect(resolved).toHaveBeenCalledWith(null, '93.184.215.14', 4);
      socket = connection(callback);
      setImmediate(() => socket?.res.emit('error', new Error('truncated')));
      return socket.req;
    },
  );
  await expect(
    createSecureTransport(dns)(wire, policy, origins, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'UPSTREAM_NETWORK', retryable: true });
  expect(dns).toHaveBeenCalledOnce();
});
it('classifies a socket timeout as TIMEOUT and destroys the upstream connection', async () => {
  let socket: ReturnType<typeof connection> | undefined;
  network.request.mockImplementation(
    (_url: URL, _options: RequestOptions, callback: (res: IncomingMessage) => void) => {
      socket = connection(callback);
      setImmediate(() => socket?.expire());
      return socket.req;
    },
  );
  await expect(
    createSecureTransport(dns)(wire, policy, origins, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  expect(socket?.destroy.mock.calls).toHaveLength(1);
});
it('normalizes absent status and undefined response headers', async () => {
  network.request.mockImplementation(
    (_url: URL, _options: RequestOptions, callback: (res: IncomingMessage) => void) => {
      const socket = connection(callback);
      socket.res.statusCode = undefined;
      setImmediate(() => {
        socket.res.emit('data', Buffer.from('ok'));
        socket.res.emit('end');
      });
      return socket.req;
    },
  );
  await expect(
    createSecureTransport(dns)(wire, policy, origins, new AbortController().signal),
  ).resolves.toEqual({ status: 502, body: 'ok', headers: { 'x-empty': '' } });
});
it('checks real DNS answers and rejects empty resolution sets', async () => {
  const local = PolicySchema.parse({ allowedOrigins: ['https://localhost'] });
  await expect(
    resolveTarget(new URL('https://localhost'), local, ['https://localhost']),
  ).rejects.toThrow('EGRESS_DENIED');
  await expect(resolveTarget(wire.url, policy, origins, () => Promise.resolve([]))).rejects.toThrow(
    'EGRESS_DENIED',
  );
});
