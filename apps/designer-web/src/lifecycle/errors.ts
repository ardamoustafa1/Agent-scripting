import { ApiError } from '../api/client.js';

/**
 * Maps a failed release command to the most specific message we can show. The generic fallback
 * ("check failed") hid the actual reason, e.g. separation of duties, from the person who needed it.
 */
export function releaseErrorKey(failure: unknown, generic: string): string {
  if (!(failure instanceof ApiError)) return generic;
  if (failure.code === 'VERBIS_AUTHZ_SOD_VIOLATION') return 'designer.lifecycle.errors.sod';
  if (failure.code === 'VERBIS_AUTHZ_SCOPE_MISSING') return 'designer.workspace.scopeMissing';
  if (failure.status === 403) return 'designer.lifecycle.errors.forbidden';
  if (failure.status === 409 || failure.status === 412) return 'designer.lifecycle.errors.stale';
  if (failure.status === 401) return 'designer.lifecycle.errors.session';
  return generic;
}
