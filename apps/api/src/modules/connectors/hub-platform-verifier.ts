import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { normalizeCtiPlatform } from '@verbis/shared-types';

import { LaunchPorts } from '../launch/launch-ports.js';

import { HubClient } from './hub-client.js';
import { CtiIdentitiesSchema } from './user-mapping.js';

/**
 * Secure-launch platform check through the connector hub: the hub's connector asks the platform
 * (or its authoritative event state) whether one of the user's platform identities is a current
 * participant. Unconfigured hub ⇒ the launch module fails closed.
 */
@Injectable()
export class HubPlatformVerifier implements OnModuleInit {
  constructor(
    @Inject(HubClient) private readonly hub: HubClient,
    @Inject(LaunchPorts) private readonly ports: LaunchPorts,
  ) {}

  onModuleInit(): void {
    if (!this.hub.configured) return;
    this.ports.registerFallbackVerifier({
      isActiveParticipant: async (input) => {
        const ids = CtiIdentitiesSchema.safeParse(input.ctiIdentities);
        const platformUserIds = ids.success
          ? [
              ...new Set(
                ids.data
                  .filter(
                    (i) =>
                      input.platform === undefined ||
                      i.platform === normalizeCtiPlatform(input.platform),
                  )
                  .map((i) => i.id),
              ),
            ].slice(0, 20)
          : [];
        if (input.platformUserId)
          platformUserIds.splice(0, platformUserIds.length, input.platformUserId);
        if (platformUserIds.length === 0) return false;
        const result = await this.hub.call(
          input.tenantId,
          'POST',
          `/internal/v1/connectors/${input.connectorId}/verify-participant`,
          z.object({ verified: z.boolean() }),
          { platformUserIds, platformInteractionId: input.externalId },
        );
        return result.verified;
      },
    });
  }
}
