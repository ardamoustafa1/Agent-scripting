import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  GenesysCloudRegionSchema,
  genesysCloudHosts,
  type GenesysCloudRegion,
} from '@verbis/sdk-connector';

/**
 * Genesys Cloud user ↔ Verbis user link (docs/connectors/genesys-cloud.md §Identity).
 *
 * The Interaction Widget opens a first-party popup on the agent-web origin; the BFF runs the
 * Authorization Code + PKCE (S256) grant against `login.<region>` with a *public* OAuth client
 * (no secret, no implicit grant). The token is used once — `GET /api/v2/users/me` and
 * `/organizations/me` — and discarded; it never reaches the browser and is never stored. The
 * proven Genesys user id becomes a CTI identity of the signed-in Verbis user, which the secure
 * launch then re-verifies against the Conversations API on every embedded launch.
 */
export const CALLBACK_PATH = '/v1/genesys-cloud/oauth/callback';

/** Connector config subset the API reads (the hub owns the full schema). */
export const UserAuthConfigSchema = z.looseObject({
  kind: z.literal('cloud'),
  region: GenesysCloudRegionSchema,
  organizationId: z.uuid(),
  userAuth: z.strictObject({
    /** Public "Code Authorization (PKCE)" OAuth client id in Genesys Cloud. */
    clientId: z.uuid(),
    /** Must be registered on the OAuth client: `<agent-web origin>/api/v1/genesys-cloud/oauth/callback`. */
    redirectUri: z
      .url({ protocol: /^https?$/ })
      .max(2_048)
      .refine(
        (value) => new URL(value).pathname.endsWith(CALLBACK_PATH),
        `must end with ${CALLBACK_PATH}`,
      )
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
        );
      }, 'https required outside localhost'),
  }),
});
export type UserAuthConfig = z.infer<typeof UserAuthConfigSchema>;

export const STATE_TTL_SECONDS = 300;

export interface LinkState {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly connectorId: string;
  readonly codeVerifier: string;
  readonly createdAt: number;
}
export const LinkStateSchema = z.object({
  tenantId: z.uuid(),
  userId: z.uuid(),
  sessionId: z.string().min(1),
  connectorId: z.uuid(),
  codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  createdAt: z.number().int(),
});

/** Single-use state store (Redis GETDEL in production). */
export interface LinkStateStore {
  put(state: string, value: LinkState, ttlSeconds: number): Promise<void>;
  take(state: string): Promise<LinkState | undefined>;
}

const b64url = (buffer: Buffer) => buffer.toString('base64url');

export function createPkce(random: (bytes: number) => Buffer = randomBytes): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = b64url(random(32));
  return {
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
    state: b64url(random(32)),
  };
}

export function authorizeUrl(
  region: GenesysCloudRegion,
  clientId: string,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const url = new URL('/oauth/authorize', genesysCloudHosts(region).login);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const TokenSchema = z.object({ access_token: z.string().min(1) });
const MeSchema = z.object({ id: z.uuid(), email: z.string().max(320).optional() });
const OrgSchema = z.object({ id: z.uuid() });

export class GenesysLinkError extends Error {
  override readonly name = 'GenesysLinkError';

  constructor(
    readonly reason:
      | 'state_invalid'
      | 'session_mismatch'
      | 'connector_invalid'
      | 'exchange_failed'
      | 'org_mismatch'
      | 'identity_conflict',
  ) {
    super(reason);
  }
}

export interface ProvenIdentity {
  readonly genesysUserId: string;
  readonly organizationId: string;
}

/** Exchanges the code (with the PKCE verifier) and reads who the token belongs to. */
export async function proveIdentity(
  config: UserAuthConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProvenIdentity> {
  const hosts = genesysCloudHosts(config.region);
  const call = async (url: string, init: RequestInit) => {
    try {
      return await fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GenesysLinkError('exchange_failed');
    }
  };
  const tokenResponse = await call(`${hosts.login}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.userAuth.redirectUri,
      client_id: config.userAuth.clientId,
      code_verifier: codeVerifier,
    }).toString(),
  });
  const token = TokenSchema.safeParse(
    tokenResponse.ok ? await tokenResponse.json().catch(() => null) : null,
  );
  if (!token.success) throw new GenesysLinkError('exchange_failed');
  const get = async <T>(path: string, schema: z.ZodType<T>) => {
    const response = await call(`${hosts.api}${path}`, {
      headers: { authorization: `Bearer ${token.data.access_token}`, accept: 'application/json' },
    });
    const parsed = schema.safeParse(response.ok ? await response.json().catch(() => null) : null);
    if (!parsed.success) throw new GenesysLinkError('exchange_failed');
    return parsed.data;
  };
  const [me, org] = await Promise.all([
    get('/api/v2/users/me', MeSchema),
    get('/api/v2/organizations/me', OrgSchema),
  ]);
  if (org.id !== config.organizationId) throw new GenesysLinkError('org_mismatch');
  return { genesysUserId: me.id, organizationId: org.id };
}

export const CTI_PLATFORM = 'genesys_cloud';

/** Replaces this connector's Genesys identity of the user (other platforms/connectors kept). */
export function withGenesysIdentity(
  current: unknown,
  connectorId: string,
  genesysUserId: string,
  linkedAt: string,
): Record<string, unknown>[] {
  const list = z.array(z.looseObject({ platform: z.string(), id: z.string() })).safeParse(current);
  const kept = (list.success ? list.data : []).filter(
    (identity) =>
      !(
        identity.platform === CTI_PLATFORM &&
        (identity['connectorId'] === connectorId || identity.id === genesysUserId)
      ),
  );
  return [
    ...kept,
    {
      platform: CTI_PLATFORM,
      id: genesysUserId,
      connectorId,
      source: 'genesys-oauth-pkce',
      linkedAt,
    },
  ];
}
