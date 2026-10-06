import type { RoleMapping } from './idp-config.js';

/** Reads a dot path from a claim set (`realm_access.roles`); flat keys with dots win (SAML URIs). */
export function claimValue(claims: Readonly<Record<string, unknown>>, path: string): unknown {
  if (Object.hasOwn(claims, path)) return claims[path];
  let current: unknown = claims;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Strings of a claim value: a string, a number/boolean, or an array of those. */
export function claimStrings(value: unknown): string[] {
  const one = (item: unknown): string | undefined =>
    typeof item === 'string'
      ? item
      : typeof item === 'number' || typeof item === 'boolean'
        ? String(item)
        : undefined;
  if (Array.isArray(value))
    return value.map(one).filter((item): item is string => item !== undefined);
  const single = one(value);
  return single === undefined ? [] : [single];
}

/** Roles granted by the mapping for a claim set; sorted and de-duplicated (deterministic). */
export function mapRoles(
  mapping: RoleMapping,
  claims: Readonly<Record<string, unknown>>,
): string[] {
  const roles = new Set(mapping.defaultRoles);
  for (const rule of mapping.rules) {
    if (claimStrings(claimValue(claims, rule.claim)).includes(rule.equals)) {
      for (const role of rule.roles) roles.add(role);
    }
  }
  return [...roles].sort();
}
