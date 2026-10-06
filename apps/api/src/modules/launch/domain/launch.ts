import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secure launch domain rules (SECURITY §4). Framework-free and deterministic: every check takes
 * the clock as input. A launch is refused unless *all* checks pass (fail closed).
 */

/** Hard ceiling from the requirement; the schema enforces the same bound (migration CHECK). */
export const MAX_LAUNCH_TTL_SECONDS = 60;
export const DEFAULT_LAUNCH_TTL_SECONDS = 45;
export const CLOCK_SKEW_SECONDS = 5;

/** 256-bit opaque, URL-safe code. Carries no meaning; the server-side intent is authoritative. */
export const LAUNCH_CODE = /^[A-Za-z0-9_-]{43}$/;

export function newLaunchCode(random: (size: number) => Buffer = randomBytes): string {
  return random(32).toString('base64url');
}

export function launchCodeHash(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Why a launch was refused. Only recorded in audit; the client always sees one generic code. */
export type LaunchDenial =
  | 'code_malformed'
  | 'code_unknown'
  | 'code_replayed'
  | 'code_expired'
  | 'intent_revoked'
  | 'user_mismatch'
  | 'tenant_mismatch'
  | 'session_missing'
  | 'break_glass'
  | 'user_inactive'
  | 'interaction_inactive'
  | 'interaction_not_assigned'
  | 'platform_unverified'
  | 'connector_unavailable'
  | 'token_invalid'
  | 'token_signature'
  | 'token_lifetime'
  | 'token_audience'
  | 'issuer_unknown'
  | 'rate_limited'
  | 'not_service'
  | 'mtls_required';

export class LaunchDeniedError extends Error {
  override readonly name = 'LaunchDeniedError';

  constructor(readonly reason: LaunchDenial) {
    super(`launch denied: ${reason}`);
  }
}

export interface IntentView {
  readonly tenantId: string;
  readonly userId: string;
  readonly state: 'pending' | 'redeemed' | 'expired' | 'revoked';
  readonly expiresAt: Date;
}

export interface RedeemerView {
  readonly tenantId: string;
  readonly userId: string;
  readonly bffSessionId: string | undefined;
  readonly authMethod: 'sso' | 'break_glass' | undefined;
}

/**
 * Checks the binding of an intent to the redeeming principal. The order puts replay and
 * identity before time, so a stolen code used late is still reported as the more serious event.
 */
export function checkRedemption(
  intent: IntentView,
  redeemer: RedeemerView,
  now: Date,
): LaunchDenial | undefined {
  if (intent.tenantId !== redeemer.tenantId) return 'tenant_mismatch';
  if (intent.state === 'redeemed') return 'code_replayed';
  if (intent.state === 'revoked') return 'intent_revoked';
  if (intent.userId !== redeemer.userId) return 'user_mismatch';
  if (redeemer.authMethod === 'break_glass') return 'break_glass';
  if (redeemer.bffSessionId === undefined) return 'session_missing';
  if (intent.state === 'expired' || intent.expiresAt.getTime() <= now.getTime())
    return 'code_expired';
  return undefined;
}

export const ACTIVE_INTERACTION_STATUSES: ReadonlySet<string> = new Set([
  'alerting',
  'connected',
  'held',
]);

export interface InteractionView {
  readonly status: string;
  readonly endedAt: Date | null;
  readonly agentId: string | null;
}

/** The agent may only work an interaction that is live and assigned to them. */
export function checkInteraction(
  interaction: InteractionView | null,
  userId: string,
): LaunchDenial | undefined {
  if (interaction?.endedAt !== null || !ACTIVE_INTERACTION_STATUSES.has(interaction.status))
    return 'interaction_inactive';
  if (interaction.agentId !== userId) return 'interaction_not_assigned';
  return undefined;
}

export function intentExpiry(now: Date, ttlSeconds = DEFAULT_LAUNCH_TTL_SECONDS): Date {
  const ttl = Math.min(Math.max(1, Math.trunc(ttlSeconds)), MAX_LAUNCH_TTL_SECONDS);
  return new Date(now.getTime() + ttl * 1000);
}

/** Query parameters that must never select content (SECURITY §4.1 rule 1): a security signal. */
export const FORBIDDEN_LAUNCH_PARAMS = [
  'campaignid',
  'campaign',
  'scriptid',
  'script',
  'userid',
  'user',
  'agentid',
  'interactionid',
  'interaction',
  'conversationid',
  'customerid',
  'sessionid',
] as const;

export function forbiddenParams(query: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(query)
    .filter((key) => (FORBIDDEN_LAUNCH_PARAMS as readonly string[]).includes(key.toLowerCase()))
    .sort();
}
