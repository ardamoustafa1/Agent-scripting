import { BlockList, isIP } from 'node:net';

import { z } from 'zod';

import { AdminSecuritySchema } from '@verbis/shared-types';
/** The trusted proxy chain is resolved by Fastify, never by a client-supplied header here. */
export function ipAllowed(settings: unknown, address: string): boolean {
  const parsed = z.object({ security: AdminSecuritySchema.optional() }).safeParse(settings);
  if (!parsed.success) return false;
  const entries = parsed.data.security?.ipAllowlist ?? [];
  if (!entries.length) return true;
  const normalized =
    address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  const family = isIP(normalized);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of entries) {
    const [ip, prefix] = entry.split('/');
    if (!ip) return false;
    const type = isIP(ip) === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(ip, type);
    else list.addSubnet(ip, Number(prefix), type);
  }
  return list.check(normalized, family === 4 ? 'ipv4' : 'ipv6');
}
