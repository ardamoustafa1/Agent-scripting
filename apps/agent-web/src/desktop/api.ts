import { z } from 'zod';

import { ScriptDocumentSchema, JsonValueSchema } from '@verbis/script-schema';

export const View = z.object({
  id: z.uuid(),
  state: z.enum(['launching', 'active', 'paused', 'wrapup', 'completed', 'abandoned', 'expired']),
  sequence: z.number().int(),
  readOnly: z.boolean(),
  snapshot: z.object({
    variables: z.record(z.string(), JsonValueSchema),
    currentPage: z.string().nullable(),
    history: z.array(z.string()),
    timers: z.record(z.string(), z.number()),
  }),
});
export type View = z.infer<typeof View>;
export const Desktop = z.object({
  view: View,
  document: ScriptDocumentSchema,
  checksum: z.string(),
  secureCapture: z.object({ url: z.url(), origin: z.url() }).optional(),
  startedAt: z.string(),
  interaction: z.object({
    channel: z.string(),
    status: z.string(),
    queue: z.string().nullable(),
    platform: z.string(),
    customerName: z.string().nullable(),
    context: z.record(z.string(), JsonValueSchema),
  }),
  campaign: z.object({
    name: z.string(),
    outcomes: z.array(
      z.object({
        code: z.string(),
        label: z.string(),
        category: z.string(),
        requiresNote: z.boolean(),
        requiredFields: z.array(z.string()),
        subCodes: z.array(z.string()),
      }),
    ),
  }),
  writeback: z.enum(['none', 'queued', 'success']),
});
export type Desktop = z.infer<typeof Desktop>;
export class AgentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly correlationId: string = crypto.randomUUID(),
  ) {
    super(code);
  }
}
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  csrf?: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!/^\/(auth|v1)\//.test(path) || path.includes('..') || path.includes('://'))
    throw new AgentError(400, 'VERBIS_CLIENT_PATH');
  const correlationId = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      method: body === undefined ? 'GET' : 'POST',
      ...(signal ? { signal } : {}),
      headers: {
        accept: 'application/json',
        'x-correlation-id': correlationId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AgentError(0, 'VERBIS_NETWORK_UNAVAILABLE', correlationId);
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = z
      .object({
        code: z.string(),
        correlationId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,128}$/)
          .optional(),
      })
      .safeParse(value);
    throw new AgentError(
      response.status,
      problem.success ? problem.data.code : 'VERBIS_HTTP_UNAVAILABLE',
      problem.success ? (problem.data.correlationId ?? correlationId) : correlationId,
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AgentError(200, 'VERBIS_CLIENT_SCHEMA', correlationId);
  return parsed.data;
}
