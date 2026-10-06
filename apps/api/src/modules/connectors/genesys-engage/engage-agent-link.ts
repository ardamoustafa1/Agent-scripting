import { randomBytes } from 'node:crypto';

import { z } from 'zod';

/**
 * Genesys Engage delegated agent link (docs/connectors/genesys-engage.md §3, ADR-0019).
 *
 * Workspace API v3 / GWS only deliver the *signed-in* agent's events (`/me`). The agent, already
 * signed in to Verbis with SSO, links once per shift in a first-party popup: Authorization Code
 * grant at the Genesys Authentication Service (confidential client, secret from the vault). The
 * refresh token stays sealed in Redis on the API; the hub receives short-lived access tokens over
 * mTLS for that agent's Workspace session only. Nothing reaches the browser.
 */
export const ENGAGE_CALLBACK_PATH = '/v1/genesys-engage/oauth/callback';
export const CTI_PLATFORM = 'genesys_engage';
export const LINK_STATE_TTL_SECONDS = 300;

/** The subset of the hub's workspace config the API needs. */
export const EngageLinkConfigSchema = z.looseObject({
  kind: z.literal('workspace'),
  authUrl: z.url({ protocol: /^https$/ }).max(2_048),
  authClientId: z.string().min(1).max(256),
  redirectUri: z
    .url({ protocol: /^https?$/ })
    .max(2_048)
    .refine(
      (value) => new URL(value).pathname.endsWith(ENGAGE_CALLBACK_PATH),
      `must end with ${ENGAGE_CALLBACK_PATH}`,
    )
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      );
    }, 'https required outside localhost'),
  agentIdentity: z.enum(['employeeId', 'userName', 'agentLoginId']).default('employeeId'),
  /** Link lifetime (shift length); the refresh token is dropped afterwards. */
  linkTtlHours: z.number().int().min(1).max(24).default(12),
  secrets: z.record(z.string(), z.uuid()).optional(),
});
export type EngageLinkConfig = z.infer<typeof EngageLinkConfigSchema>;

export interface EngageLinkState {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly connectorId: string;
  readonly createdAt: number;
}
export const EngageLinkStateSchema = z.object({
  tenantId: z.uuid(),
  userId: z.uuid(),
  sessionId: z.string().min(1),
  connectorId: z.uuid(),
  createdAt: z.number().int(),
});

/** Sealed per-agent link (Redis): refresh token + cached access token. */
export const EngageLinkSchema = z.object({
  userId: z.uuid(),
  platformUserId: z.string().min(1).max(256),
  refreshToken: z.string().min(1),
  accessToken: z.string().min(1).optional(),
  accessExpiresAt: z.number().int().optional(),
  linkedAt: z.string(),
  expiresAt: z.number().int(),
});
export type EngageLink = z.infer<typeof EngageLinkSchema>;

export interface EngageLinkStore {
  putState(state: string, value: EngageLinkState, ttlSeconds: number): Promise<void>;
  takeState(state: string): Promise<EngageLinkState | undefined>;
  putLink(tenantId: string, connectorId: string, link: EngageLink): Promise<void>;
  getLink(
    tenantId: string,
    connectorId: string,
    platformUserId: string,
  ): Promise<EngageLink | undefined>;
  deleteLink(tenantId: string, connectorId: string, platformUserId: string): Promise<void>;
  /** Live (unexpired) platform user ids. */
  listLinks(tenantId: string, connectorId: string): Promise<string[]>;
}

export class EngageLinkError extends Error {
  override readonly name = 'EngageLinkError';

  constructor(
    readonly reason:
      | 'state_invalid'
      | 'session_mismatch'
      | 'connector_invalid'
      | 'exchange_failed'
      | 'identity_missing'
      | 'identity_conflict'
      | 'not_linked',
  ) {
    super(reason);
  }
}

export const newState = (random: (n: number) => Buffer = randomBytes) =>
  random(32).toString('base64url');

export function engageAuthorizeUrl(config: EngageLinkConfig, state: string): string {
  const url = new URL('/auth/v3/oauth/authorize', config.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.authClientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
});
const UserInfoSchema = z.looseObject({
  employeeId: z.string().max(128).optional(),
  employee_id: z.string().max(128).optional(),
  username: z.string().max(128).optional(),
  user_name: z.string().max(128).optional(),
  agentLogin: z.string().max(128).optional(),
});

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly expiresAt: number;
}

async function post(
  fetchImpl: typeof fetch,
  config: EngageLinkConfig,
  clientSecret: string,
  form: Record<string, string>,
  now: number,
): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetchImpl(new URL('/auth/v3/oauth/token', config.authUrl).toString(), {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.authClientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EngageLinkError('exchange_failed');
  }
  const token = TokenSchema.safeParse(response.ok ? await response.json().catch(() => null) : null);
  if (!token.success) throw new EngageLinkError('exchange_failed');
  return {
    accessToken: token.data.access_token,
    refreshToken: token.data.refresh_token,
    expiresAt: now + token.data.expires_in * 1_000,
  };
}

export function exchangeCode(
  fetchImpl: typeof fetch,
  config: EngageLinkConfig,
  clientSecret: string,
  code: string,
  now: number,
): Promise<TokenSet> {
  return post(
    fetchImpl,
    config,
    clientSecret,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.authClientId,
    },
    now,
  );
}

export function refreshTokens(
  fetchImpl: typeof fetch,
  config: EngageLinkConfig,
  clientSecret: string,
  refreshToken: string,
  now: number,
): Promise<TokenSet> {
  return post(
    fetchImpl,
    config,
    clientSecret,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: config.authClientId },
    now,
  );
}

/** Who the token belongs to, in the connector's configured agent identity. */
export async function platformUserIdOf(
  fetchImpl: typeof fetch,
  config: EngageLinkConfig,
  accessToken: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(new URL('/auth/v3/userinfo', config.authUrl).toString(), {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EngageLinkError('exchange_failed');
  }
  const info = UserInfoSchema.safeParse(
    response.ok ? await response.json().catch(() => null) : null,
  );
  if (!info.success) throw new EngageLinkError('exchange_failed');
  const value =
    config.agentIdentity === 'employeeId'
      ? (info.data.employeeId ?? info.data.employee_id)
      : config.agentIdentity === 'userName'
        ? (info.data.username ?? info.data.user_name)
        : info.data.agentLogin;
  if (value === undefined || value.trim() === '') throw new EngageLinkError('identity_missing');
  return value.trim();
}

/** Replaces this connector's Engage identity of the user (other platforms/connectors kept). */
export function withEngageIdentity(
  current: unknown,
  connectorId: string,
  platformUserId: string,
  linkedAt: string,
): Record<string, unknown>[] {
  const list = z.array(z.looseObject({ platform: z.string(), id: z.string() })).safeParse(current);
  const kept = (list.success ? list.data : []).filter(
    (identity) =>
      !(
        identity.platform === CTI_PLATFORM &&
        (identity['connectorId'] === connectorId || identity.id === platformUserId)
      ),
  );
  return [
    ...kept,
    {
      platform: CTI_PLATFORM,
      id: platformUserId,
      connectorId,
      source: 'genesys-auth-code',
      linkedAt,
    },
  ];
}
