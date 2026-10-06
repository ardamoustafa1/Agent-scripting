import { expect, it } from 'vitest';

import { localTarget } from './local-target.js';

it('allows only an explicit RFC1918 CIDR and pins the DNS answer', async () => {
  const answer = [{ address: '10.8.4.7', family: 4 }];
  expect(
    await localTarget('crm.corp.test', ['10.8.0.0/16'], () => Promise.resolve(answer)),
  ).toEqual(answer[0]);
  await expect(
    localTarget('crm.corp.test', ['10.9.0.0/16'], () => Promise.resolve(answer)),
  ).rejects.toThrow('EGRESS_DENIED');
});
it.each([
  '127.0.0.1',
  '169.254.169.254',
  '168.63.129.16',
  '0.0.0.0',
  '8.8.8.8',
  '::1',
  '::ffff:10.8.0.1',
])('denies sensitive/public/mapped addresses even with /0: %s', async (address) => {
  await expect(localTarget(address, ['0.0.0.0/0'])).rejects.toThrow('EGRESS_DENIED');
});
it('rejects mixed DNS answers and empty or malformed allowlists', async () => {
  await expect(
    localTarget('crm.corp.test', ['10.0.0.0/8'], () =>
      Promise.resolve([
        { address: '10.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ),
  ).rejects.toThrow('EGRESS_DENIED');
  for (const cidrs of [[], ['10.0.0.0/33'], ['10.0.0.0/foo']])
    await expect(localTarget('10.1.1.1', cidrs)).rejects.toThrow('EGRESS_DENIED');
});
