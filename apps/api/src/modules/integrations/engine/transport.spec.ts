import nock from 'nock';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PolicySchema } from './contracts.js';
import { createSecureTransport, resolveTarget } from './transport.js';

const policy = PolicySchema.parse({ allowedOrigins: ['https://service.test'] });
const origins = ['https://service.test'];
const publicDns = () => Promise.resolve([{ address: '93.184.215.14', family: 4 }]);
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});
describe('SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '168.63.129.16',
    '2001::1',
    '100.100.100.200',
    '::1',
    '::ffff:127.0.0.1',
    '::7f00:1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2002:7f00:1::',
  ])('blocks DNS answers pointing at %s', async (address) => {
    await expect(
      resolveTarget(new URL('https://service.test'), policy, origins, () =>
        Promise.resolve([{ address, family: address.includes(':') ? 6 : 4 }]),
      ),
    ).rejects.toThrow('EGRESS_DENIED');
  });
  it.each([
    'http://service.test',
    'file:///etc/passwd',
    'https://user:pass@service.test',
    'https://other.test',
    'https://service.test:8443',
  ])('rejects unauthorized target %s', async (url) => {
    await expect(resolveTarget(new URL(url), policy, origins, publicDns)).rejects.toThrow(
      'EGRESS_DENIED',
    );
  });
  it('denies mixed public/private DNS answers', async () => {
    await expect(
      resolveTarget(new URL('https://service.test'), policy, origins, async () => [
        ...(await publicDns()),
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow('EGRESS_DENIED');
  });
  it('requires tenant allowlist independently of source allowlist', async () => {
    await expect(
      resolveTarget(new URL('https://service.test'), policy, [], publicDns),
    ).rejects.toThrow('EGRESS_DENIED');
  });
  it('resolves once and returns the pinned IP', async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce(await publicDns())
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      resolveTarget(new URL('https://service.test'), policy, origins, resolver),
    ).resolves.toEqual((await publicDns())[0]);
    expect(resolver).toHaveBeenCalledTimes(1);
    await expect(
      resolveTarget(new URL('https://service.test'), policy, origins, resolver),
    ).rejects.toThrow('EGRESS_DENIED');
  });
  it('does not follow redirects to metadata', async () => {
    nock.disableNetConnect();
    const upstream = nock('https://service.test')
      .get('/')
      .reply(302, '', { location: 'http://169.254.169.254/latest/meta-data' });
    await expect(
      createSecureTransport(publicDns)(
        { url: new URL('https://service.test'), method: 'GET', headers: {} },
        policy,
        origins,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('REDIRECT_DENIED');
    expect(upstream.isDone()).toBe(true);
  });
  it('limits streaming responses without Content-Length', async () => {
    nock.disableNetConnect();
    nock('https://service.test').get('/').reply(200, 'x'.repeat(128));
    await expect(
      createSecureTransport(publicDns)(
        { url: new URL('https://service.test'), method: 'GET', headers: {} },
        { ...policy, maxResponseBytes: 16 },
        origins,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('RESPONSE_TOO_LARGE');
  });
});

it('normalizes upstream headers and returns the exact response body', async () => {
  nock.disableNetConnect();
  nock('https://service.test')
    .post('/', 'request')
    .reply(201, 'response', { 'set-cookie': ['a=1', 'b=2'], 'x-empty': '' });
  const response = await createSecureTransport(publicDns)(
    { url: new URL('https://service.test'), method: 'POST', headers: {}, body: 'request' },
    policy,
    origins,
    AbortSignal.timeout(1000),
  );
  expect(response).toMatchObject({
    status: 201,
    body: 'response',
    headers: { 'set-cookie': 'a=1, b=2', 'x-empty': '' },
  });
});
it('rejects declared oversized bodies before reading and classifies connection errors for retry', async () => {
  nock.disableNetConnect();
  nock('https://service.test').get('/').reply(200, 'small', { 'content-length': '2000000' });
  const transport = createSecureTransport(publicDns);
  const wire = { url: new URL('https://service.test'), method: 'GET' as const, headers: {} };
  await expect(transport(wire, policy, origins, AbortSignal.timeout(1000))).rejects.toThrow(
    'RESPONSE_TOO_LARGE',
  );
  nock('https://service.test').get('/').replyWithError('connection reset');
  await expect(transport(wire, policy, origins, AbortSignal.timeout(1000))).rejects.toMatchObject({
    code: 'UPSTREAM_NETWORK',
    retryable: true,
  });
  const aborted = new AbortController();
  aborted.abort();
  await expect(transport(wire, policy, origins, aborted.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});
