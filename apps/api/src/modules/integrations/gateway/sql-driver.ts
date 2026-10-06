import { readFileSync } from 'node:fs';

import pg from 'pg';
import { z } from 'zod';

import { scrubSecrets } from '../engine/mapping.js';
import { IntegrationError } from '../engine/transport.js';

import { localTarget } from './local-target.js';

const name = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const SqlTargetSchema = z.strictObject({
  kind: z.literal('postgres'),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(5432),
  allowedCidrs: z.array(z.string()).min(1).max(100),
  credentialsFile: z.string().startsWith('/'),
  caFile: z.string().startsWith('/').optional(),
  allowPlaintext: z.boolean().default(false),
  queries: z.record(
    name,
    z.strictObject({
      text: z.string().min(1).max(32768),
      parameterCount: z.number().int().min(0).max(100),
      maxRows: z.number().int().min(1).max(1000).default(100),
    }),
  ),
});
export type SqlTarget = z.infer<typeof SqlTargetSchema>;
const Credentials = z.strictObject({
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
});

export async function executeSql(
  target: SqlTarget,
  queryKey: string,
  parameters: readonly unknown[],
  signal: AbortSignal,
  timeoutMs: number,
  maxBytes: number,
  dependencies: {
    resolve?: typeof localTarget;
    client?: (config: pg.ClientConfig) => pg.Client;
  } = {},
) {
  const query = Object.hasOwn(target.queries, queryKey) ? target.queries[queryKey] : undefined;
  if (
    parameters.length !== query?.parameterCount ||
    !/^\s*(select|with)\b/i.test(query.text) ||
    query.text.includes(';')
  )
    throw new IntegrationError('SQL_QUERY_DENIED');
  const address = await (dependencies.resolve ?? localTarget)(target.host, target.allowedCidrs);
  signal.throwIfAborted();
  const credentials = Credentials.parse(JSON.parse(readFileSync(target.credentialsFile, 'utf8')));
  const client = (dependencies.client ?? ((config) => new pg.Client(config)))({
    ...credentials,
    host: address.address,
    port: target.port,
    connectionTimeoutMillis: timeoutMs,
    ssl: target.allowPlaintext
      ? false
      : {
          rejectUnauthorized: true,
          servername: target.host,
          ...(target.caFile ? { ca: readFileSync(target.caFile) } : {}),
        },
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
  });
  const cancel = () => {
    void client.end().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await client.connect();
    signal.throwIfAborted();
    await client.query('BEGIN READ ONLY');
    await client.query(
      "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)",
      [String(timeoutMs)],
    );
    // The server owns the catalog SQL. User data is always passed separately as positional values.
    const result = await client.query(
      `SELECT * FROM (${query.text}) AS verbis_read LIMIT $${parameters.length + 1}`,
      [...parameters, query.maxRows + 1],
    );
    if (result.rows.length > query.maxRows) throw new IntegrationError('SQL_ROW_LIMIT');
    const body = JSON.stringify(scrubSecrets(result.rows, [credentials.password]));
    if (Buffer.byteLength(body) > maxBytes) throw new IntegrationError('RESPONSE_TOO_LARGE');
    await client.query('ROLLBACK');
    return { status: 200, body };
  } catch (error) {
    throw error instanceof IntegrationError ? error : new IntegrationError('SQL_EXECUTION_FAILED');
  } finally {
    signal.removeEventListener('abort', cancel);
    await client.end().catch(() => undefined);
  }
}
