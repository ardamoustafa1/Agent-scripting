import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertEgressUrl,
  createIdpFetch,
  EgressDeniedError,
  guardedLookup,
  isPublicAddress,
} from './idp-fetch.js';

import type { AddressInfo } from 'node:net';

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/empty') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.url === '/chunked') {
      res.write('x'.repeat(600));
      res.end('x'.repeat(600));
      return;
    }
    if (req.url === '/big') {
      res.setHeader('content-type', 'application/json');
      res.end('x'.repeat(2048));
      return;
    }
    if (req.url === '/redirect') {
      res.statusCode = 302;
      res.setHeader('location', 'http://169.254.169.254/latest/meta-data');
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '224.0.0.1',
    'not-an-ip',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('assertEgressUrl', () => {
  const policy = { allowHttpHosts: ['localhost'], allowPrivateHosts: [] };
  it('allows https and listed http hosts only', () => {
    expect(() => {
      assertEgressUrl(new URL('https://idp.example.com/x'), policy);
    }).not.toThrow();
    expect(() => {
      assertEgressUrl(new URL('http://localhost:8080/x'), policy);
    }).not.toThrow();
    expect(() => {
      assertEgressUrl(new URL('http://idp.example.com/x'), policy);
    }).toThrow(EgressDeniedError);
    expect(() => {
      assertEgressUrl(new URL('file:///etc/passwd'), policy);
    }).toThrow(EgressDeniedError);
    expect(() => {
      assertEgressUrl(new URL('https://user:pw@idp.example.com/'), policy);
    }).toThrow(EgressDeniedError);
  });
});

describe('createIdpFetch', () => {
  it('refuses loopback unless the host is allow-listed as private', async () => {
    const strict = createIdpFetch({
      allowHttpHosts: ['localhost', '127.0.0.1'],
      allowPrivateHosts: [],
    });
    await expect(strict(`http://127.0.0.1:${String(port)}/`)).rejects.toBeInstanceOf(
      EgressDeniedError,
    );
    await expect(strict(`http://localhost:${String(port)}/`)).rejects.toThrow();
    const allowed = createIdpFetch({
      allowHttpHosts: ['localhost', '127.0.0.1'],
      allowPrivateHosts: ['localhost', '127.0.0.1'],
    });
    const response = await allowed(`http://127.0.0.1:${String(port)}/`);
    expect(await response.json()).toEqual({ ok: true });
    const viaName = await allowed(`http://localhost:${String(port)}/`);
    expect(viaName.status).toBe(200);
  });

  it('does not follow redirects and caps response size', async () => {
    const fetcher = createIdpFetch({
      allowHttpHosts: ['127.0.0.1'],
      allowPrivateHosts: ['127.0.0.1'],
      maxResponseBytes: 1024,
    });
    const redirect = await fetcher(`http://127.0.0.1:${String(port)}/redirect`);
    expect(redirect.status).toBe(302);
    await expect(fetcher(`http://127.0.0.1:${String(port)}/big`)).rejects.toThrow(/too large/);
  });

  it('guardedLookup refuses private answers for unlisted hosts', async () => {
    const lookup = guardedLookup({ allowHttpHosts: [], allowPrivateHosts: [] });
    const error = await new Promise<unknown>((resolve) => {
      lookup('localhost', {}, (err) => {
        resolve(err);
      });
    });
    expect(error).toBeInstanceOf(EgressDeniedError);
    const all = await new Promise<unknown>((resolve) => {
      guardedLookup({ allowHttpHosts: [], allowPrivateHosts: ['localhost'] })(
        'localhost',
        { all: true },
        (err, addresses) => {
          resolve(err ?? addresses);
        },
      );
    });
    expect(Array.isArray(all)).toBe(true);
  });
});

it('rejects DNS failure and supports scalar private allow-listed answers', async () => {
  const lookup = guardedLookup({ allowHttpHosts: [], allowPrivateHosts: ['localhost'] });
  const missing = await new Promise<unknown>((resolve) => {
    lookup('missing.invalid', {}, (error) => {
      resolve(error);
    });
  });
  expect(missing).toMatchObject({ code: 'ENOTFOUND' });
  const allowed = await new Promise<unknown>((resolve) => {
    lookup('localhost', {}, (error, address, family) => {
      resolve(error ?? { address, family });
    });
  });
  expect(typeof (allowed as { family: unknown }).family).toBe('number');
  expect(typeof (allowed as { address: unknown }).address).toBe('string');
});
it('limits streamed responses without Content-Length and handles empty bodies', async () => {
  const fetcher = createIdpFetch({
    allowHttpHosts: ['127.0.0.1'],
    allowPrivateHosts: ['127.0.0.1'],
    maxResponseBytes: 1024,
  });
  await expect(fetcher(`http://127.0.0.1:${String(port)}/chunked`)).rejects.toThrow(/too large/);
  const empty = await fetcher(`http://127.0.0.1:${String(port)}/empty`);
  expect(empty.status).toBe(204);
  expect(await empty.text()).toBe('');
});
