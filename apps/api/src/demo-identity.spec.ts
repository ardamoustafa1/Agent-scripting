import { describe, expect, it, vi } from 'vitest';

import { provisionDemoIdentity, DEMO_HUB_CLIENT_ID } from '../prisma/demo/identity.js';

import type { Prisma } from './generated/prisma/client.js';

describe('optional synthetic demo identity', () => {
  it('does not provision credentials when no explicit operator settings exist', async () => {
    const record = vi.fn();
    await provisionDemoIdentity({} as Prisma.TransactionClient, {}, record);
    expect(record).not.toHaveBeenCalled();
  });
  it.each([
    'https://idp.example/realms/verbis-demo',
    'http://localhost:8080/realms/production',
    'http://user:secret@localhost:8080/realms/verbis-demo',
  ])('rejects an unauthorized IdP before writing secrets (%s)', async (issuer) => {
    await expect(
      provisionDemoIdentity(
        {} as Prisma.TransactionClient,
        {
          DEMO_OIDC_ISSUER: issuer,
          DEMO_OIDC_CLIENT_ID: 'demo-fixture',
          DEMO_OIDC_CLIENT_SECRET: 'synthetic-placeholder',
          IDENTITY_ENCRYPTION_KEYS: 'unused-before-guard',
        },
        vi.fn(),
      ),
    ).rejects.toThrow(/dedicated local/);
  });
  it('rejects partial OIDC settings and invalid certificate bindings', async () => {
    await expect(
      provisionDemoIdentity(
        {} as Prisma.TransactionClient,
        { DEMO_OIDC_ISSUER: 'http://localhost:8080/realms/verbis-demo' },
        vi.fn(),
      ),
    ).rejects.toThrow(/together/);
    await expect(
      provisionDemoIdentity(
        {} as Prisma.TransactionClient,
        { DEMO_HUB_CERT_THUMBPRINT: 'invalid' },
        vi.fn(),
      ),
    ).rejects.toThrow();
  });
  it('binds the hub to an operator certificate with a transactional audit', async () => {
    const create = vi.fn<(input: { data: unknown }) => Promise<unknown>>().mockResolvedValue({});
    const record = vi.fn().mockResolvedValue(undefined);
    await provisionDemoIdentity(
      { serviceClient: { create } } as unknown as Prisma.TransactionClient,
      { DEMO_HUB_CERT_THUMBPRINT: 'a'.repeat(43) },
      record,
    );
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        id: DEMO_HUB_CLIENT_ID,
        authMethod: 'tls_client_auth',
        certificateThumbprint: 'a'.repeat(43),
        scopes: ['read:Connector', 'update:Connector', 'create:Session'],
      },
    });
    expect(record).toHaveBeenCalledWith(
      'demo.serviceClient.created',
      'ServiceClient',
      DEMO_HUB_CLIENT_ID,
    );
  });
});
