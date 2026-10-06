import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

import { isPublicAddress } from '../../identity/egress/idp-fetch.js';

import type { Policy, WireRequest, WireResponse } from './contracts.js';

export class IntegrationError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}
export type Resolver = (host: string) => Promise<readonly { address: string; family: number }[]>;
export type Transport = (
  request: WireRequest,
  policy: Policy,
  tenantOrigins: readonly string[],
  signal: AbortSignal,
) => Promise<WireResponse>;
export async function resolveTarget(
  url: URL,
  policy: Policy,
  tenantOrigins: readonly string[],
  resolve: Resolver = (host) => lookup(host, { all: true }),
) {
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && policy.allowHttp))
  )
    throw new IntegrationError('EGRESS_DENIED');
  if (!policy.allowedOrigins.includes(url.origin) || !tenantOrigins.includes(url.origin))
    throw new IntegrationError('EGRESS_DENIED');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  // Reject mixed public/private answers as well as literal and mapped metadata IPs.
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) =>
        !isPublicAddress(address) ||
        address === '168.63.129.16' ||
        (isIP(address) === 6 && /^::|^2002:|^2001:(?:0:|:)/i.test(address)),
    )
  )
    throw new IntegrationError('EGRESS_DENIED');
  const target = addresses[0];
  if (!target) throw new IntegrationError('EGRESS_DENIED');
  return target;
}
export function createSecureTransport(resolver?: Resolver): Transport {
  return createPinnedTransport((url, policy, origins) =>
    resolveTarget(url, policy, origins, resolver),
  );
}
/** Socket transport shared with the separately validated customer-network worker. */
export function createPinnedTransport(
  resolve: (
    url: URL,
    policy: Policy,
    origins: readonly string[],
  ) => Promise<{ address: string; family: number }>,
): Transport {
  return async (wire, policy, tenantOrigins, signal) => {
    const target = await resolve(wire.url, policy, tenantOrigins);
    signal.throwIfAborted();
    return new Promise<WireResponse>((resolve, reject) => {
      const send = wire.url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = send(
        wire.url,
        {
          method: wire.method,
          headers: wire.headers,
          signal,
          family: target.family,
          // DNS is resolved once; socket connects to this exact validated address.
          lookup: (_hostname, _options, callback) => {
            callback(null, target.address, target.family);
          },
          ...(wire.tls ?? {}),
          rejectUnauthorized: true,
        },
        (res) => {
          const status = res.statusCode ?? 502;
          if (status >= 300 && status < 400) {
            res.destroy();
            reject(new IntegrationError('REDIRECT_DENIED'));
            return;
          }
          if (Number(res.headers['content-length'] ?? 0) > policy.maxResponseBytes) {
            res.destroy();
            reject(new IntegrationError('RESPONSE_TOO_LARGE'));
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > policy.maxResponseBytes) {
              res.destroy();
              reject(new IntegrationError('RESPONSE_TOO_LARGE'));
            } else chunks.push(chunk);
          });
          res.on('error', () => {
            reject(new IntegrationError('UPSTREAM_NETWORK', true));
          });
          res.on('end', () => {
            resolve({
              status,
              headers: Object.fromEntries(
                Object.entries(res.headers).map(([key, value]) => [
                  key,
                  Array.isArray(value) ? value.join(', ') : (value ?? ''),
                ]),
              ),
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      req.on('error', (error: Error) => {
        reject(
          error instanceof IntegrationError
            ? error
            : new IntegrationError(signal.aborted ? 'TIMEOUT' : 'UPSTREAM_NETWORK', true),
        );
      });
      req.setTimeout(policy.timeoutMs, () => req.destroy(new IntegrationError('TIMEOUT', true)));
      req.end(wire.body);
    });
  };
}
export const secureTransport = createSecureTransport();
