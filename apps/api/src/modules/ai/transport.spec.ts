import { expect, it, vi } from 'vitest';

import { postJson } from './transport.js';

const resolve = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: resolve }));
for (const url of [
  'http://example.invalid',
  'https://user:pass@example.invalid',
  'https://example.invalid#fragment',
])
  it(`rejects unsafe target ${url}`, async () => {
    await expect(postJson(url, ['10.1.2.3'], {}, {}, new AbortController().signal)).rejects.toThrow(
      'EGRESS',
    );
  });
for (const address of ['127.0.0.1', '169.254.169.254', '168.63.129.16', '::1'])
  it(`never opens a socket to metadata or loopback ${address}`, async () => {
    resolve.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
    await expect(
      postJson('https://fixture.example.invalid', [address], {}, {}, new AbortController().signal),
    ).rejects.toThrow('EGRESS');
  });
it('rejects DNS rebinding or mixed answers outside operator pins', async () => {
  resolve.mockResolvedValue([
    { address: '10.1.2.3', family: 4 },
    { address: '10.9.9.9', family: 4 },
  ]);
  await expect(
    postJson('https://fixture.example.invalid', ['10.1.2.3'], {}, {}, new AbortController().signal),
  ).rejects.toThrow('EGRESS');
});
