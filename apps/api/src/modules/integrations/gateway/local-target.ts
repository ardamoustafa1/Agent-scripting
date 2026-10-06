import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { IntegrationError, type Resolver } from '../engine/transport.js';

/** First slice supports only explicitly permitted RFC1918 IPv4 networks. */
export async function localTarget(
  host: string,
  cidrs: readonly string[],
  resolve: Resolver = (name) => lookup(name, { all: true }),
) {
  const allowed = new BlockList();
  for (const cidr of cidrs) {
    const [ip, prefix] = cidr.split('/');
    if (!ip || isIP(ip) !== 4 || !prefix || !/^\d+$/.test(prefix) || Number(prefix) > 32)
      throw new IntegrationError('EGRESS_DENIED');
    allowed.addSubnet(ip, Number(prefix), 'ipv4');
  }
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (
    !addresses.length ||
    addresses.some(({ address, family }) => {
      if (family !== 4 || isIP(address) !== 4) return true;
      const parts = address.split('.').map(Number);
      const privateIp =
        parts[0] === 10 ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31);
      return !privateIp || !allowed.check(address, 'ipv4');
    })
  )
    throw new IntegrationError('EGRESS_DENIED');
  const target = addresses[0];
  if (!target) throw new IntegrationError('EGRESS_DENIED');
  return target;
}
