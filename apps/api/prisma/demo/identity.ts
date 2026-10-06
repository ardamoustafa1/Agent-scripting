/** Optional local acceptance IdP/service binding. All credentials come from the operator's env. */
import { z } from 'zod';

import { Keyring } from '../../src/modules/identity/crypto/keyring.js';

import { DEMO_ACTOR, DEMO_TENANT_ID, DEMO_USERS, demoId } from './fixture.js';

import type { Prisma } from '../../src/generated/prisma/client.js';

export const DEMO_IDP_ID = demoId(20);
export const DEMO_HUB_CLIENT_ID = demoId(22);
export async function provisionDemoIdentity(
  tx: Prisma.TransactionClient,
  source: Record<string, string | undefined>,
  record: (action: string, type: string, id: string) => Promise<void>,
): Promise<void> {
  const issuer = source['DEMO_OIDC_ISSUER'];
  const clientSecret = source['DEMO_OIDC_CLIENT_SECRET'];
  const clientId = source['DEMO_OIDC_CLIENT_ID'];
  const encryptionKeys = source['IDENTITY_ENCRYPTION_KEYS'];
  if ([issuer, clientSecret, clientId].some(Boolean)) {
    if (!issuer || !clientSecret || !clientId || !encryptionKeys)
      throw new Error('Demo OIDC settings must be provided together');
    const url = new URL(issuer);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/realms/verbis-demo'
    )
      throw new Error('Demo IdP must be the dedicated local verbis-demo realm');
    const name = `idp:${DEMO_IDP_ID}:client-secret`;
    await tx.secret.create({
      data: {
        id: demoId(21),
        tenantId: DEMO_TENANT_ID,
        name,
        kind: 'oauth_client',
        ciphertext: Buffer.from(
          new Keyring(encryptionKeys).seal(clientSecret, `secret:${DEMO_TENANT_ID}:${name}`),
          'utf8',
        ),
        createdBy: DEMO_ACTOR,
        updatedBy: DEMO_ACTOR,
      },
    });
    await tx.identityProvider.create({
      data: {
        id: DEMO_IDP_ID,
        tenantId: DEMO_TENANT_ID,
        protocol: 'oidc',
        displayName: 'Keycloak (synthetic demo)',
        status: 'active',
        domainHints: ['example.invalid'],
        jitProvisioning: true,
        config: {
          vendor: 'keycloak',
          issuer,
          clientId,
          clientAuth: 'client_secret_basic',
          clientSecretRef: demoId(21),
          linkByVerifiedEmail: true,
          roleMapping: {
            defaultRoles: [],
            rules: DEMO_USERS.map((user, index) => ({
              claim: 'groups',
              equals: `demo-${index}`,
              roles: [...user.roles],
            })),
          },
        },
        createdBy: DEMO_ACTOR,
        updatedBy: DEMO_ACTOR,
      },
    });
    await tx.identityProviderDomain.create({
      data: {
        tenantId: DEMO_TENANT_ID,
        idpId: DEMO_IDP_ID,
        domain: 'example.invalid',
        createdBy: DEMO_ACTOR,
        updatedBy: DEMO_ACTOR,
      },
    });
    await record('demo.identityProvider.created', 'IdentityProvider', DEMO_IDP_ID);
    await record('demo.secret.created', 'Secret', demoId(21));
  }
  const thumbprint = source['DEMO_HUB_CERT_THUMBPRINT'];
  if (thumbprint) {
    z.string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(thumbprint);
    await tx.serviceClient.create({
      data: {
        id: DEMO_HUB_CLIENT_ID,
        tenantId: DEMO_TENANT_ID,
        name: 'synthetic-demo-hub',
        authMethod: 'tls_client_auth',
        certificateThumbprint: thumbprint,
        scopes: ['read:Connector', 'update:Connector', 'create:Session'],
        status: 'active',
        createdBy: DEMO_ACTOR,
        updatedBy: DEMO_ACTOR,
      },
    });
    await record('demo.serviceClient.created', 'ServiceClient', DEMO_HUB_CLIENT_ID);
  }
}
