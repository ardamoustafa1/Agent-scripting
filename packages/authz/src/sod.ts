import type { RuleDefinition } from './rules.js';

export const SOD_REASON = 'authz.sod.authorCannotApprove';

/**
 * Separation of duties (tenant setting `authz.separationOfDuties`, default on): an author of a
 * script version — `authorIds` on the Script subject of that version — may not approve or
 * publish it, whatever roles they hold.
 */
export function separationOfDutiesRules(userId: string): RuleDefinition[] {
  return [
    {
      action: ['approve', 'publish'],
      subject: 'Script',
      conditions: { authorIds: userId },
      inverted: true,
      reason: SOD_REASON,
    },
  ];
}

export interface VersionAuthorship {
  readonly createdBy: string;
  readonly updatedBy?: string;
  readonly contributors?: readonly string[];
}

/** Every actor who wrote the version; used as `authorIds` on the Script subject. */
export function authorIdsOf(version: VersionAuthorship): string[] {
  const ids = new Set([version.createdBy, ...(version.contributors ?? [])]);
  if (version.updatedBy !== undefined) ids.add(version.updatedBy);
  return [...ids].map(stripActorPrefix);
}

/** Audit actors may be written as `user:<id>`; abilities use the bare id. */
function stripActorPrefix(actor: string): string {
  return actor.startsWith('user:') ? actor.slice('user:'.length) : actor;
}
