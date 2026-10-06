import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { IntegrationPolicySchema } from '@verbis/shared-types';

import { scrubSecrets } from '../engine/mapping.js';
import { IntegrationError, createPinnedTransport } from '../engine/transport.js';

import { localTarget } from './local-target.js';
import { executeSql, SqlTargetSchema } from './sql-driver.js';

import type { GatewayJob } from '../engine/gateway-contracts.js';

export const HttpTargetSchema = z.strictObject({
  kind: z.literal('http'),
  origin: z.url(),
  allowedCidrs: z.array(z.string()).min(1).max(100),
  allowHttp: z.boolean().default(false),
  bearerTokenFile: z.string().startsWith('/').optional(),
  caFile: z.string().startsWith('/').optional(),
});
export const GatewayTargetsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  z.discriminatedUnion('kind', [HttpTargetSchema, SqlTargetSchema]),
);
export type GatewayTargets = z.infer<typeof GatewayTargetsSchema>;
export async function executeGatewayJob(
  job: GatewayJob,
  targets: GatewayTargets,
  parentSignal: AbortSignal,
) {
  const target = Object.hasOwn(targets, job.target) ? targets[job.target] : undefined;
  if (!target || job.deadline <= Date.now()) throw new IntegrationError('GATEWAY_TARGET_DENIED');
  const timeoutMs = Math.min(10000, job.deadline - Date.now());
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(timeoutMs)]);
  if (target.kind === 'postgres' && job.command.kind === 'sql')
    return executeSql(
      target,
      job.command.queryKey,
      job.command.parameters,
      signal,
      timeoutMs,
      job.maxResponseBytes,
    );
  if (target.kind !== 'http' || job.command.kind !== 'http')
    throw new IntegrationError('GATEWAY_TARGET_DENIED');
  const url = new URL(job.command.url),
    origin = new URL(target.origin);
  if (
    url.origin !== origin.origin ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    url.username ||
    url.password ||
    url.hash ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && target.allowHttp))
  )
    throw new IntegrationError('EGRESS_DENIED');
  const transport = createPinnedTransport(() => localTarget(url.hostname, target.allowedCidrs));
  const headers = Object.fromEntries(
    Object.entries(job.command.headers).filter(
      ([key]) =>
        !/^(host|authorization|proxy-authorization|cookie|connection|content-length|transfer-encoding)$/i.test(
          key,
        ),
    ),
  );
  const credential = target.bearerTokenFile
    ? readFileSync(target.bearerTokenFile, 'utf8').trim()
    : undefined;
  if (credential) headers['Authorization'] = `Bearer ${credential}`;
  const result = await transport(
    {
      url,
      method: job.command.method,
      headers,
      ...(job.command.body === undefined ? {} : { body: job.command.body }),
      ...(target.caFile ? { tls: { ca: readFileSync(target.caFile, 'utf8') } } : {}),
    },
    IntegrationPolicySchema.parse({
      timeoutMs: Math.max(100, timeoutMs),
      maxResponseBytes: job.maxResponseBytes,
    }),
    [],
    signal,
  );
  let body = result.body;
  if (credential) {
    try {
      body = JSON.stringify(scrubSecrets(JSON.parse(body), [credential]));
    } catch {
      body = body.replaceAll(credential, '[REDACTED]');
    }
  }
  return { status: result.status, body };
}
