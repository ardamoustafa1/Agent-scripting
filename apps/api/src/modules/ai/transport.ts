import { lookup } from 'node:dns/promises';
import { request } from 'node:https';

import { isPublicAddress } from '../identity/egress/idp-fetch.js';
/** Operator-pinned private addresses support on-prem endpoints; tenants cannot set these pins. */
export async function postJson(
  endpoint: string,
  addresses: readonly string[],
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
    throw new Error('EGRESS');
  signal.throwIfAborted();
  const answers = await lookup(url.hostname, { all: true });
  if (
    !answers.length ||
    answers.some(
      ({ address }) =>
        !addresses.includes(address) ||
        address === '168.63.129.16' ||
        (!isPublicAddress(address) &&
          !/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(address)),
    )
  )
    throw new Error('EGRESS');
  signal.throwIfAborted();
  const target = answers[0];
  if (!target) throw new Error('EGRESS');
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        signal,
        rejectUnauthorized: true,
        headers: { 'content-type': 'application/json', ...headers },
        lookup: (_host, _opts, cb) => {
          cb(null, target.address, target.family);
        },
      },
      (res) => {
        if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
          res.destroy();
          reject(new Error('UPSTREAM'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_000_000) {
            res.destroy();
            reject(new Error('SIZE'));
          } else chunks.push(chunk);
        });
        res.on('error', () => {
          reject(new Error('NETWORK'));
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
          } catch {
            reject(new Error('JSON'));
          }
        });
      },
    );
    req.on('error', () => {
      reject(new Error('NETWORK'));
    });
    req.setTimeout(60000, () => req.destroy());
    req.end(JSON.stringify(body));
  });
}
