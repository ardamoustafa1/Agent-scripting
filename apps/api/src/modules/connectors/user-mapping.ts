import { CtiIdentitiesSchema, normalizeCtiPlatform } from '@verbis/shared-types';

export { CtiIdentitiesSchema } from '@verbis/shared-types';

/**
 * Platform user ↔ Verbis user (DOMAIN User). Order of trust: an explicit CTI identity for this
 * platform (admin- or SCIM-provisioned, `users.cti_identities`), then the IdP `externalId`, then the
 * work email. Ambiguity (two users match the same rung) maps to nobody: a launch for the wrong
 * agent is worse than no launch.
 */

export interface MappableUser {
  readonly id: string;
  readonly email: string;
  readonly externalId: string | null;
  readonly ctiIdentities: unknown;
}

export interface PlatformUserRef {
  readonly id: string;
  readonly email?: string | undefined;
}

export function ctiIdsOf(user: Pick<MappableUser, 'ctiIdentities'>, platform: string): string[] {
  const parsed = CtiIdentitiesSchema.safeParse(user.ctiIdentities);
  return parsed.success
    ? parsed.data.filter((i) => i.platform === normalizeCtiPlatform(platform)).map((i) => i.id)
    : [];
}

export function matchUser(
  users: readonly MappableUser[],
  platform: string,
  ref: PlatformUserRef,
): string | undefined {
  const rungs: ((u: MappableUser) => boolean)[] = [
    (u) => ctiIdsOf(u, platform).includes(ref.id),
    (u) => u.externalId !== null && u.externalId === ref.id,
    (u) => u.email.toLowerCase() === ref.email?.toLowerCase(),
  ];
  for (const rung of rungs) {
    const hits = users.filter(rung);
    if (hits.length === 1) return hits[0]?.id;
    if (hits.length > 1) return undefined;
  }
  return undefined;
}
