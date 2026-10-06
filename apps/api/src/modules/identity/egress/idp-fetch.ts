import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Egress guard for server-side calls to identity providers (OIDC discovery, JWKS, token and
 * userinfo endpoints). SECURITY §5.1 for this narrow case, until the integration engine's SSRF
 * guard exists (step 16):
 * - https only, except hosts explicitly allowed for development;
 * - the address the socket actually connects to is checked (the check runs inside DNS lookup of
 *   the connection), so DNS rebinding cannot swap in an internal address after validation;
 * - loopback, private, link-local (cloud metadata), CGNAT, ULA, multicast and IPv4-mapped forms are
 *   refused unless the host is on the private allow-list (on-prem ADFS/Keycloak);
 * - redirects are not followed, timeouts and response sizes are capped.
 */
export interface EgressPolicy {
  readonly allowHttpHosts: readonly string[];
  readonly allowPrivateHosts: readonly string[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

export class EgressDeniedError extends Error {
  override readonly name = 'EgressDeniedError';
}

// Separate lists: a BlockList matches IPv4 addresses against IPv4-mapped IPv6 subnets.
const DENIED_V4 = new BlockList();
const DENIED_V6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  DENIED_V4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  DENIED_V6.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !DENIED_V4.check(address, 'ipv4');
  if (family !== 6) return false;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms are judged as the IPv4 address.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1] !== undefined) return isPublicAddress(mapped[1]);
  if (/^::ffff:/i.test(address)) return false;
  return !DENIED_V6.check(address, 'ipv6');
}

const hostMatches = (host: string, list: readonly string[]) =>
  list.some((item) => item.toLowerCase() === host.toLowerCase());

export function assertEgressUrl(url: URL, policy: EgressPolicy): void {
  if (url.username !== '' || url.password !== '') {
    throw new EgressDeniedError('credentials in IdP URLs are not allowed');
  }
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && hostMatches(url.hostname, policy.allowHttpHosts)) return;
  throw new EgressDeniedError(`scheme not allowed for ${url.hostname}`);
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** DNS lookup that refuses non-public answers for hosts not on the private allow-list. */
export function guardedLookup(policy: EgressPolicy) {
  return (
    hostname: string,
    options: { all?: boolean | undefined },
    callback: LookupCallback,
  ): void => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error !== null) {
        callback(error, []);
        return;
      }
      const allowPrivate = hostMatches(hostname, policy.allowPrivateHosts);
      const usable = addresses.filter((entry) => allowPrivate || isPublicAddress(entry.address));
      if (usable.length === 0) {
        callback(
          Object.assign(new EgressDeniedError(`address of ${hostname} is not allowed`), {
            code: 'EEGRESSDENIED',
          }),
          [],
        );
        return;
      }
      if (options.all === true) callback(null, usable);
      else callback(null, usable[0]?.address ?? '', usable[0]?.family);
    });
  };
}

export type IdpFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

export function createIdpFetch(policy: EgressPolicy): IdpFetch {
  const dispatcher = new Agent({
    connect: { lookup: guardedLookup(policy), timeout: policy.timeoutMs ?? 5_000 },
    headersTimeout: policy.timeoutMs ?? 5_000,
    bodyTimeout: policy.timeoutMs ?? 5_000,
  });
  const maxBytes = policy.maxResponseBytes ?? 1_048_576;
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    assertEgressUrl(url, policy);
    // Literal IPs never go through DNS: check them here.
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (
      isIP(literal) !== 0 &&
      !isPublicAddress(literal) &&
      !hostMatches(url.hostname, policy.allowPrivateHosts)
    ) {
      throw new EgressDeniedError(`address ${literal} is not allowed`);
    }
    const signal = AbortSignal.timeout(policy.timeoutMs ?? 5_000);
    const response = await undiciFetch(url, {
      ...(init as unknown as Parameters<typeof undiciFetch>[1]),
      redirect: 'manual',
      dispatcher,
      signal:
        init.signal === undefined || init.signal === null
          ? signal
          : AbortSignal.any([init.signal, signal]),
    });
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new EgressDeniedError('IdP response too large');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader() as
      ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new EgressDeniedError('IdP response too large');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const body = Buffer.concat(chunks, size);
    return new Response(response.status === 204 || response.status === 304 ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
