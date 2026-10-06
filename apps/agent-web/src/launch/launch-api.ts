import { z } from 'zod';

import {
  beginAgentLaunch,
  agentLaunchFailed,
  bindAgentLaunch,
  launchHeaders,
  type AgentLaunch,
} from '../observability.js';

/**
 * BFF calls through the same-origin /api proxy. The session is an httpOnly cookie; the CSRF token
 * from /auth/session goes in X-CSRF-Token. No token or code is ever put in a URL or storage.
 */
export const AgentSessionSchema = z.object({
  user: z.object({
    id: z.string(),
    tenantId: z.string(),
    authMethod: z.enum(['sso', 'break_glass']),
  }),
  csrfToken: z.string(),
  session: z.object({ id: z.string() }).optional(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

export const LaunchResultSchema = z.object({
  sessionId: z.string().regex(/^[0-9a-f-]{36}$/),
  path: z.string().regex(/^\/s\/[0-9a-f-]{36}$/),
});
export type LaunchResult = z.infer<typeof LaunchResultSchema>;

const TicketSchema = z.object({ ticket: z.string(), namespace: z.literal('/launch') });
const ProblemSchema = z.object({
  code: z.string(),
  correlationId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});

export class LaunchApiError extends Error {
  constructor(
    readonly code: string,
    readonly correlationId: string = crypto.randomUUID(),
    readonly status = 503,
    /** Seconds from a valid Retry-After header (429/503), when present. */
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

export async function fetchAgentSession(): Promise<AgentSession | null> {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  // Only 401 means "signed out". Rate limiting (429) or outages must never look like a logout.
  if (response.status === 401) return null;
  if (!response.ok) {
    const problem = ProblemSchema.safeParse(await response.json().catch(() => null));
    const header = response.headers.get('retry-after');
    const retryAfter = header !== null && /^\d{1,5}$/.test(header) ? Number(header) : undefined;
    throw new LaunchApiError(
      problem.success ? problem.data.code : 'VERBIS_HTTP_UNAVAILABLE',
      problem.success ? problem.data.correlationId : undefined,
      response.status,
      retryAfter,
    );
  }
  const parsed = AgentSessionSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

async function post(
  path: string,
  body: unknown,
  csrfToken: string,
  telemetry?: AgentLaunch,
): Promise<unknown> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    referrerPolicy: 'no-referrer',
    headers: {
      ...launchHeaders(telemetry),
      'x-correlation-id': correlationId,
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = ProblemSchema.safeParse(await response.json().catch(() => null));
    throw new LaunchApiError(
      problem.success ? problem.data.code : 'VERBIS_HTTP_UNAVAILABLE',
      problem.success ? (problem.data.correlationId ?? correlationId) : correlationId,
      response.status,
    );
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

async function launch(path: string, body: unknown, csrfToken: string): Promise<LaunchResult> {
  const telemetry = beginAgentLaunch();
  let result: unknown;
  try {
    result = await post(path, body, csrfToken, telemetry);
  } catch (error) {
    agentLaunchFailed(telemetry);
    throw error;
  }
  const parsed = LaunchResultSchema.safeParse(result);
  if (!parsed.success) {
    agentLaunchFailed(telemetry);
    throw new LaunchApiError('VERBIS_HTTP_UNAVAILABLE');
  }
  bindAgentLaunch(parsed.data.sessionId, telemetry);
  return parsed.data;
}

export const redeemCode = (code: string, csrf: string) =>
  launch('/v1/launch/redeem', { code }, csrf);
export const redeemJws = (token: string, csrf: string) => launch('/v1/launch/jws', { token }, csrf);
export const redeemEmbedded = (connectorId: string, conversationId: string, csrf: string) =>
  launch('/v1/launch/embedded', { connectorId, conversationId }, csrf);

export async function reportIgnoredParams(params: string[], csrf: string): Promise<void> {
  if (params.length === 0) return;
  await post('/v1/launch/param-signals', { params }, csrf).catch(() => undefined);
}

export async function launchSocketTicket(csrf: string): Promise<string> {
  const parsed = TicketSchema.safeParse(await post('/v1/launch/socket-ticket', {}, csrf));
  if (!parsed.success) throw new LaunchApiError('VERBIS_HTTP_UNAVAILABLE');
  return parsed.data.ticket;
}
