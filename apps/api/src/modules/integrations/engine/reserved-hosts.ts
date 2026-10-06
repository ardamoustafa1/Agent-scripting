import type { IntegrationDefinition } from '@verbis/shared-types';

import { DomainError } from '../../../common/errors/domain-errors.js';

export function reservedHost(value: string): boolean {
  const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  return /(?:^|\.)(?:example\.(?:com|org|net)|test|invalid|localhost)$/.test(host);
}
export function assertProductionEndpoints(definition: IntegrationDefinition): void {
  const profiles = [definition.profiles.prod ?? definition];
  for (const profile of profiles) {
    if (
      reservedHost(profile.baseUrl) ||
      ('tokenUrl' in profile.auth && reservedHost(profile.auth.tokenUrl))
    )
      throw new DomainError(
        'VERBIS_VALIDATION_FAILED',
        'Reserved example and test hosts cannot be production endpoints',
      );
  }
}

/** Documentation domains are placeholders in every environment, including development saves. */
export function assertConfiguredEndpoints(definition: IntegrationDefinition): void {
  for (const profile of [definition, ...Object.values(definition.profiles)]) {
    if (!profile) continue;
    for (const value of [
      profile.baseUrl,
      ...('tokenUrl' in profile.auth ? [profile.auth.tokenUrl] : []),
    ]) {
      const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
      if (/(?:^|\.)example\.(?:com|org|net)$/.test(host))
        throw new DomainError(
          'VERBIS_VALIDATION_FAILED',
          'Example domains must be replaced with configured endpoints',
        );
    }
  }
}
