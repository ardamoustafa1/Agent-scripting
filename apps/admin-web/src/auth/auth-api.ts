import { z } from 'zod';

import { retryAfterSeconds } from '@verbis/ui';

/**
 * BFF auth endpoints through the same-origin /api proxy. The browser never handles tokens: the
 * session is an httpOnly cookie, and the CSRF token from /auth/session goes in X-CSRF-Token.
 */
export const AuthSessionSchema = z.object({
  user: z.object({
    id: z.string(),
    tenantId: z.string(),
    authMethod: z.enum(['sso', 'break_glass']),
  }),
  session: z.object({
    id: z.string(),
    protocol: z.enum(['oidc', 'saml', 'local']),
    expiresAt: z.string(),
  }),
  csrfToken: z.string(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const DiscoverySchema = z.object({
  tenant: z.string(),
  providers: z.array(
    z.object({ id: z.string(), displayName: z.string(), protocol: z.enum(['oidc', 'saml']) }),
  ),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

const SignedOutSchema = z.object({ authenticated: z.literal(false) });

const ProblemSchema = z.object({ code: z.string() });

export class AuthApiError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

async function problemCode(response: Response): Promise<string> {
  const parsed = ProblemSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.code : 'VERBIS_HTTP_UNAVAILABLE';
}

export async function fetchSession(): Promise<AuthSession | null> {
  // The status probe answers 200 {authenticated:false} when signed out (no console-noisy 401).
  const response = await fetch('/api/auth/session/status', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (response.status === 401) return null;
  if (!response.ok)
    throw new AuthApiError(
      await problemCode(response),
      response.status === 429 ? retryAfterSeconds(response.headers.get('retry-after')) : undefined,
    );
  const body: unknown = await response.json().catch(() => null);
  if (SignedOutSchema.safeParse(body).success) return null;
  const parsed = AuthSessionSchema.safeParse(body);
  if (!parsed.success) throw new AuthApiError('VERBIS_HTTP_UNAVAILABLE');
  return parsed.data;
}

async function postJson(url: string, body: unknown, csrfToken?: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(csrfToken === undefined ? {} : { 'x-csrf-token': csrfToken }),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new AuthApiError(
      await problemCode(response),
      response.status === 429 ? retryAfterSeconds(response.headers.get('retry-after')) : undefined,
    );
  return response.json().catch(() => ({}));
}

export async function discover(email: string): Promise<Discovery> {
  const parsed = DiscoverySchema.safeParse(await postJson('/api/auth/discover', { email }));
  if (!parsed.success) throw new AuthApiError('VERBIS_HTTP_UNAVAILABLE');
  return parsed.data;
}

/** SSO is a top-level navigation (the IdP round trip needs the browser). Fixed parameters only. */
export function loginUrl(tenant: string, idpId: string): string {
  const params = new URLSearchParams({ tenant, idp: idpId, app: 'admin', returnTo: '/' });
  return `/api/auth/login?${params.toString()}`;
}

export async function breakGlassLogin(input: {
  tenant: string;
  email: string;
  password: string;
  code: string;
}): Promise<void> {
  await postJson('/api/auth/break-glass/login', input);
}

export async function logout(csrfToken: string): Promise<string> {
  const parsed = z
    .object({ redirectUrl: z.string() })
    .safeParse(await postJson('/api/auth/logout', {}, csrfToken));
  return parsed.success ? parsed.data.redirectUrl : '/';
}

/** Error code the BFF appended after a failed SSO round trip; removed from the address bar. */
export function takeAuthError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('authError');
  if (code === null) return null;
  url.searchParams.delete('authError');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return ['login_failed', 'not_provisioned', 'inactive', 'session_limit'].includes(code)
    ? code
    : 'login_failed';
}
