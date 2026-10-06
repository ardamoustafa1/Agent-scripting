import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import { GatewayJobSchema } from '../engine/gateway-contracts.js';
import { IntegrationError } from '../engine/transport.js';

import { executeGatewayJob, GatewayTargetsSchema } from './execute-job.js';

export const GatewayWorkerConfigSchema = z.strictObject({
  apiOrigin: z.url().refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      u.pathname === '/' &&
      !u.search &&
      !u.hash
    );
  }),
  tenantSlug: z.string().regex(/^[a-z0-9-]{1,63}$/),
  clientId: z.uuid(),
  certFile: z.string().startsWith('/'),
  keyFile: z.string().startsWith('/'),
  caFile: z.string().startsWith('/'),
  targets: GatewayTargetsSchema,
});
export type GatewayWorkerConfig = z.infer<typeof GatewayWorkerConfigSchema>;

/** No listener or inbound port. The customer worker opens only mTLS requests to the API. */
export async function runGatewayWorker(config: GatewayWorkerConfig, signal: AbortSignal) {
  const tls = {
    cert: readFileSync(config.certFile),
    key: readFileSync(config.keyFile),
    ca: readFileSync(config.caFile),
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2' as const,
  };
  const send = (path: string, body: string, token?: string, form = false) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        new URL(path, config.apiOrigin),
        {
          ...tls,
          method: 'POST',
          signal,
          headers: {
            'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) req.destroy(new IntegrationError('RESPONSE_TOO_LARGE'));
            else chunks.push(chunk);
          });
          res.on('error', () => {
            reject(new IntegrationError('GATEWAY_API_UNAVAILABLE'));
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 502,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      req.setTimeout(15000, () => req.destroy());
      req.on('error', () => {
        reject(new IntegrationError('GATEWAY_API_UNAVAILABLE'));
      });
      req.end(body);
    });
  let token = '',
    expiresAt = 0;
  const authenticated = async (path: string, body: unknown) => {
    if (expiresAt <= Date.now() + 30000) {
      const response = await send(
        `/oauth2/${config.tenantSlug}/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.clientId,
          scope: 'execute:Integration',
        }).toString(),
        undefined,
        true,
      );
      if (response.status !== 200) throw new IntegrationError('GATEWAY_AUTH_FAILED');
      const grant = z
        .object({ access_token: z.string().max(16384), expires_in: z.number().min(30).max(300) })
        .parse(JSON.parse(response.body));
      token = grant.access_token;
      expiresAt = Date.now() + grant.expires_in * 1000;
    }
    const response = await send(path, JSON.stringify(body), token);
    if (response.status === 401) expiresAt = 0;
    if (response.status >= 400) throw new IntegrationError('GATEWAY_API_REJECTED');
    return response.body ? (JSON.parse(response.body) as unknown) : null;
  };
  const isStopped = () => signal.aborted;
  while (!isStopped()) {
    try {
      const claimed = await authenticated('/v1/private-egress/jobs/claim', {});
      if (claimed === null) {
        await delay(100, undefined, { signal });
        continue;
      }
      const job = GatewayJobSchema.parse(claimed);
      let response;
      try {
        response = await executeGatewayJob(job, config.targets, signal);
      } catch {
        response = { status: 502, body: '{}' };
      }
      await authenticated(`/v1/private-egress/jobs/${job.id}/complete`, {
        lease: job.lease,
        response,
      });
    } catch {
      if (!isStopped()) await delay(1000, undefined, { signal });
    }
  }
}
