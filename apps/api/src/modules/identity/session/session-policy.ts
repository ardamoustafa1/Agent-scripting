import { SessionSettingsSchema } from '../../tenancy/tenancy.dto.js';

import type { SessionPolicy } from './session.types.js';
import type { ApiEnv } from '../../../env.js';

/** Effective policy for SSO sessions: tenant `settings.session` over env defaults. */
export function ssoSessionPolicy(tenantSettings: unknown, env: ApiEnv): SessionPolicy {
  const settings =
    tenantSettings !== null && typeof tenantSettings === 'object'
      ? (tenantSettings as Record<string, unknown>)
      : {};
  const parsed = SessionSettingsSchema.safeParse(settings['session'] ?? {});
  const session = parsed.success ? parsed.data : {};
  const legacyIdle =
    typeof settings['sessionTimeoutMinutes'] === 'number'
      ? settings['sessionTimeoutMinutes']
      : undefined;
  const idleMinutes = session.idleTimeoutMinutes ?? legacyIdle ?? env.SESSION_IDLE_TIMEOUT_MINUTES;
  const absoluteSeconds =
    (session.absoluteTimeoutHours ?? env.SESSION_ABSOLUTE_TIMEOUT_HOURS) * 3600;
  return {
    idleTimeoutSeconds: Math.min(idleMinutes * 60, absoluteSeconds),
    absoluteTimeoutSeconds: absoluteSeconds,
    maxConcurrent: session.maxConcurrentSessions ?? env.SESSION_MAX_CONCURRENT,
    onLimit: session.onLimit ?? 'evict_oldest',
  };
}

/** Break-glass sessions are short and single: a second break-glass login ends the first. */
export function breakGlassSessionPolicy(env: ApiEnv): SessionPolicy {
  return {
    idleTimeoutSeconds:
      Math.min(env.BREAK_GLASS_IDLE_MINUTES, env.BREAK_GLASS_SESSION_MINUTES) * 60,
    absoluteTimeoutSeconds: env.BREAK_GLASS_SESSION_MINUTES * 60,
    maxConcurrent: 1,
    onLimit: 'evict_oldest',
  };
}
