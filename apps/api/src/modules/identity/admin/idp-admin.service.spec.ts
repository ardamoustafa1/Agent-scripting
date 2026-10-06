import { beforeAll, expect, it, vi } from 'vitest';

import { requestContext } from '../../../common/context/request-context.js';
import { AppOrigins } from '../core/app-origins.js';
import { sha256Hex } from '../crypto/random.js';
import { OidcConfigSchema, SamlConfigSchema } from '../idp/idp-config.js';
import { generateSpCredential } from '../saml/sp-credentials.js';

import { CreateIdpSchema, UpdateIdpSchema } from './idp-admin.dto.js';
import { IdpAdminService } from './idp-admin.service.js';

import type { ApiEnv } from '../../../env.js';
import type { TenantDb } from '../../../infra/database/tenant-db.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { IdentitySecrets } from '../core/identity-secrets.js';
import type { IdpRepository, LoadedIdp } from '../idp/idp.repository.js';
import type { OidcService } from '../oidc/oidc.service.js';
import type { SessionStore } from '../session/session-store.js';
import type { SessionService } from '../session/session.service.js';

const tenantId = '01990000-0000-7000-8000-000000000001',
  id = '01990000-0000-7000-8000-000000000002',
  secretId = '01990000-0000-7000-8000-000000000003';
const now = Date.parse('2026-10-04T00:00:00Z');
let certificate: string;
beforeAll(async () => {
  certificate = (await generateSpCredential('Synthetic admin fixture', new Date(now))).certificate;
});
const context = {
  requestId: 'synthetic',
  correlationId: 'synthetic',
  ip: '',
  userAgent: 'test',
  principal: { type: 'user' as const, id, tenantId, scopes: [], authMethod: 'sso' as const },
};
function fixture() {
  let idp: LoadedIdp | undefined = {
    id,
    tenantId,
    version: 3,
    protocol: 'oidc',
    displayName: 'Synthetic',
    status: 'active',
    domainHints: [],
    jitProvisioning: false,
    scimEnabled: true,
    config: OidcConfigSchema.parse({
      vendor: 'generic',
      issuer: 'https://synthetic-idp.example.invalid',
      clientId: 'synthetic-client',
      clientSecretRef: secretId,
    }),
  };
  const token = {
    id,
    prefix: 'vscim_synth',
    createdAt: new Date(now),
    expiresAt: null as Date | null,
    lastUsedAt: null as Date | null,
    revokedAt: null as Date | null,
  };
  const tx = {
    identityProvider: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue({ createdAt: new Date(now), updatedAt: new Date(now) }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    identityProviderDomain: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'existing-domain', domain: 'keep.example.invalid' },
        { id: 'remove-domain', domain: 'remove.example.invalid' },
      ]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    tenant: { findFirst: vi.fn().mockResolvedValue({ slug: 'synthetic' }) },
    scimToken: {
      create: vi.fn().mockResolvedValue(token),
      findMany: vi.fn().mockResolvedValue([token]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const repository = {
    find: vi.fn((_tx: unknown, _tenant: string, requestedId: string) =>
      Promise.resolve(idp === undefined ? undefined : { ...idp, id: requestedId }),
    ),
  };
  const secrets = {
    put: vi.fn().mockResolvedValue(secretId),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { record: vi.fn().mockResolvedValue({}) },
    outbox = { record: vi.fn().mockResolvedValue('synthetic') };
  const oidc = { forget: vi.fn() },
    store = { revokeByIdp: vi.fn().mockResolvedValue(['synthetic-session']) },
    sessions = { recordEndedInRequest: vi.fn().mockResolvedValue(undefined) };
  const service = new IdpAdminService(
    { PUBLIC_API_URL: 'https://synthetic-api.example.invalid' } as ApiEnv,
    { current: () => tx, tenantId: () => tenantId } as unknown as TenantDb,
    audit as unknown as AuditService,
    outbox,
    repository as unknown as IdpRepository,
    secrets as unknown as IdentitySecrets,
    oidc as unknown as OidcService,
    store as unknown as SessionStore,
    sessions as unknown as SessionService,
    new AppOrigins({ admin: 'https://{tenant}.example.invalid' }, '/api'),
    () => now,
  );
  return {
    service,
    tx,
    token,
    repository,
    secrets,
    audit,
    outbox,
    oidc,
    store,
    sessions,
    setIdp: (value: LoadedIdp | undefined) => {
      idp = value;
    },
    idp: () => idp!,
  };
}

it('returns registration URLs and secret presence without returning secret references', async () => {
  const f = fixture();
  const detail = await f.service.get(id);
  expect(detail.config['clientSecretSet']).toBe(true);
  expect(JSON.stringify(detail)).not.toContain(secretId);
  expect(detail.endpoints['redirectUris']).toEqual([
    'https://synthetic.example.invalid/api/auth/oidc/callback',
  ]);
  f.tx.identityProvider.findFirst.mockResolvedValue(null);
  f.tx.tenant.findFirst.mockResolvedValue(null);
  expect(await f.service.get(id)).toMatchObject({ createdAt: '1970-01-01T00:00:00.000Z' });
  f.setIdp(undefined);
  await expect(f.service.get(id)).rejects.toMatchObject({ code: 'VERBIS_RESOURCE_NOT_FOUND' });
});

it.each([true, false])('stores a write-only OIDC secret when supplied: %s', async (withSecret) => {
  const f = fixture();
  const input = CreateIdpSchema.parse({
    protocol: 'oidc',
    displayName: 'Synthetic',
    status: withSecret ? 'active' : 'draft',
    domains: ['keep.example.invalid', 'new.example.invalid'],
    config: {
      vendor: 'generic',
      issuer: 'https://synthetic-idp.example.invalid',
      clientId: 'synthetic-client',
      ...(withSecret ? { clientSecret: 'synthetic-write-only-secret' } : {}),
    },
  });
  await requestContext.run(context, () => f.service.create(input));
  expect(f.secrets.put).toHaveBeenCalledTimes(withSecret ? 1 : 0);
  expect(JSON.stringify(f.tx.identityProvider.create.mock.calls)).not.toContain(
    'synthetic-write-only-secret',
  );
  expect(f.tx.identityProviderDomain.update).toHaveBeenCalledWith({
    where: { id: 'remove-domain' },
    data: { deletedAt: new Date(now), updatedBy: `user:${id}` },
  });
  expect(f.tx.identityProviderDomain.create).toHaveBeenCalledTimes(1);
  expect(f.audit.record).toHaveBeenCalledTimes(1);
  expect(f.outbox.record).toHaveBeenCalledTimes(1);
});

it('rejects active OIDC creation without credentials before storing the provider', async () => {
  const f = fixture();
  await expect(
    requestContext.run(context, () =>
      f.service.create(
        CreateIdpSchema.parse({
          protocol: 'oidc',
          displayName: 'Synthetic',
          status: 'active',
          config: {
            vendor: 'generic',
            issuer: 'https://synthetic.example.invalid',
            clientId: 'synthetic',
          },
        }),
      ),
    ),
  ).rejects.toMatchObject({ code: 'VERBIS_IDENTITY_IDP_CONFIG_INVALID' });
  expect(f.tx.identityProvider.create).not.toHaveBeenCalled();
});

it.each(['unique', 'unexpected'] as const)(
  'rolls back a domain claim savepoint after %s failure',
  async (reason) => {
    const f = fixture();
    f.tx.identityProviderDomain.create.mockRejectedValue(
      reason === 'unique' ? { code: 'P2002' } : new Error('Synthetic storage failure'),
    );
    await expect(
      requestContext.run(context, () =>
        f.service.update(id, 3, UpdateIdpSchema.parse({ domains: ['new.example.invalid'] })),
      ),
    ).rejects.toThrow(reason === 'unique' ? 'already claimed' : 'Synthetic storage failure');
    expect(
      f.tx.$executeRaw.mock.calls.map(([sql]) => (sql as TemplateStringsArray).join('')),
    ).toContain('ROLLBACK TO SAVEPOINT idp_domain');
    expect(f.audit.record).not.toHaveBeenCalled();
  },
);

it.each(['metadata', 'rotateSecret', 'disable'] as const)(
  'updates OIDC %s with optimistic concurrency and session revocation',
  async (change) => {
    const f = fixture();
    const input =
      change === 'metadata'
        ? { displayName: 'Updated', jitProvisioning: true, scimEnabled: false }
        : change === 'disable'
          ? { status: 'disabled' }
          : {
              config: {
                vendor: 'generic',
                issuer: 'https://synthetic.example.invalid',
                clientId: 'updated',
                clientSecret: 'synthetic-rotated-secret',
              },
            };
    await requestContext.run(context, () => f.service.update(id, 3, UpdateIdpSchema.parse(input)));
    expect(f.tx.identityProvider.updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id, tenantId, version: 3, deletedAt: null },
    });
    expect(f.oidc.forget).toHaveBeenCalledWith(id);
    expect(f.secrets.put).toHaveBeenCalledTimes(change === 'rotateSecret' ? 1 : 0);
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain('synthetic-rotated-secret');
    expect(f.store.revokeByIdp).toHaveBeenCalledTimes(change === 'disable' ? 1 : 0);
    if (change === 'disable')
      expect(f.sessions.recordEndedInRequest).toHaveBeenCalledWith(
        ['synthetic-session'],
        'idp_disabled',
      );
  },
);

it.each(['missing', 'version', 'concurrent', 'config'] as const)(
  'rejects unsafe provider updates: %s',
  async (reason) => {
    const f = fixture();
    if (reason === 'missing') f.setIdp(undefined);
    if (reason === 'concurrent') f.tx.identityProvider.updateMany.mockResolvedValue({ count: 0 });
    const input =
      reason === 'config'
        ? UpdateIdpSchema.parse({
            config: {
              vendor: 'generic',
              idpEntityId: 'synthetic',
              ssoUrl: 'https://synthetic.example.invalid',
              idpCertificates: [certificate],
            },
          })
        : { displayName: 'Synthetic' };
    await expect(
      requestContext.run(context, () => f.service.update(id, reason === 'version' ? 2 : 3, input)),
    ).rejects.toThrow();
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(f.store.revokeByIdp).not.toHaveBeenCalled();
  },
);

it('soft-deletes a provider, revokes credentials and ends its sessions', async () => {
  const f = fixture();
  await requestContext.run(context, () => f.service.remove(id, 3));
  expect(f.tx.identityProvider.update.mock.calls[0]![0]).toMatchObject({
    where: { id },
    data: { status: 'disabled', deletedAt: new Date(now) },
  });
  expect(f.secrets.remove).toHaveBeenCalledWith(f.tx, tenantId, secretId);
  expect(f.tx.scimToken.updateMany).toHaveBeenCalledTimes(1);
  expect(f.store.revokeByIdp).toHaveBeenCalledWith(tenantId, id);
});

function samlFixture() {
  const f = fixture();
  const config = SamlConfigSchema.parse({
    vendor: 'generic',
    idpEntityId: 'synthetic',
    ssoUrl: 'https://synthetic.example.invalid',
    idpCertificates: [certificate],
    spCredentials: [
      {
        id,
        use: 'signing',
        state: 'active',
        certificate,
        privateKeyRef: secretId,
        notAfter: '2027-10-04T00:00:00Z',
      },
      {
        id: tenantId,
        use: 'encryption',
        state: 'active',
        certificate,
        privateKeyRef: tenantId,
        notAfter: '2027-10-04T00:00:00Z',
      },
      {
        id: secretId,
        use: 'signing',
        state: 'next',
        certificate,
        privateKeyRef: id,
        notAfter: '2027-10-04T00:00:00Z',
      },
    ],
  });
  f.setIdp({ ...f.idp(), protocol: 'saml', config });
  return { ...f, config };
}

it('promotes only the matching next SAML credential and keeps encryption active', async () => {
  const f = samlFixture();
  const detail = await requestContext.run(context, () =>
    f.service.promoteSpCredential(id, secretId),
  );
  expect(JSON.stringify(detail.config)).not.toContain('privateKeyRef');
  const changed = f.tx.identityProvider.update.mock.calls[0]![0] as {
    data: { config: { spCredentials: { id: string; state: string }[] } };
  };
  expect(changed.data.config.spCredentials.map((c) => [c.id, c.state])).toEqual([
    [id, 'retired'],
    [tenantId, 'active'],
    [secretId, 'active'],
  ]);
  expect(f.secrets.remove).not.toHaveBeenCalled();
  await expect(
    requestContext.run(context, () => f.service.promoteSpCredential(id, id)),
  ).rejects.toThrow('Only a next credential');
});

it('refuses active SAML credential removal but permits deletion of next credentials and their secrets', async () => {
  const f = samlFixture();
  await expect(
    requestContext.run(context, () => f.service.removeSpCredential(id, id)),
  ).rejects.toThrow('active credential cannot be removed');
  await expect(
    requestContext.run(context, () => f.service.removeSpCredential(id, 'missing')),
  ).rejects.toThrow('not found');
  expect(f.tx.identityProvider.update).not.toHaveBeenCalled();
  await requestContext.run(context, () => f.service.removeSpCredential(id, secretId));
  expect(f.secrets.remove).toHaveBeenCalledWith(f.tx, tenantId, id);
  const changed = f.tx.identityProvider.update.mock.calls[0]![0] as {
    data: { config: { spCredentials: { id: string }[] } };
  };
  expect(changed.data.config.spCredentials.map((c) => c.id)).toEqual([id, tenantId]);
});

it('generates a new encryption credential while refusing a duplicate next signing key', async () => {
  const f = samlFixture();
  await expect(
    requestContext.run(context, () => f.service.rotateSpCredential(id, 'signing')),
  ).rejects.toThrow('already exists');
  await requestContext.run(context, () => f.service.rotateSpCredential(id, 'encryption'));
  expect(f.secrets.put).toHaveBeenCalledTimes(1);
  const changed = f.tx.identityProvider.update.mock.calls[0]![0] as {
    data: { config: { spCredentials: { use: string; state: string; certificate: string }[] } };
  };
  expect(changed.data.config.spCredentials.at(-1)).toMatchObject({
    use: 'encryption',
    state: 'next',
    certificate: expect.stringContaining('BEGIN CERTIFICATE') as unknown,
  });
});

it('preserves managed SAML credentials during configuration updates and deletes all secrets on provider removal', async () => {
  const f = samlFixture();
  const { spCredentials: _managed, ...config } = f.config;
  await requestContext.run(context, () =>
    f.service.update(
      id,
      3,
      UpdateIdpSchema.parse({ config: { ...config, ssoUrl: 'https://updated.example.invalid' } }),
    ),
  );
  const changed = f.tx.identityProvider.updateMany.mock.calls[0]![0] as {
    data: { config: { spCredentials: unknown } };
  };
  expect(changed.data.config.spCredentials).toEqual(f.config.spCredentials);
  await requestContext.run(context, () => f.service.remove(id, 3));
  expect(f.secrets.remove).toHaveBeenCalledTimes(3);
});

it('rejects SAML lifecycle actions on OIDC providers and removal with stale versions', async () => {
  const f = fixture();
  await expect(f.service.rotateSpCredential(id, 'signing')).rejects.toThrow(
    'SAML identity provider not found',
  );
  await expect(f.service.remove(id, 2)).rejects.toMatchObject({
    code: 'VERBIS_CONCURRENCY_VERSION_MISMATCH',
  });
  f.setIdp(undefined);
  await expect(f.service.remove(id, 3)).rejects.toThrow();
  expect(f.tx.identityProvider.update).not.toHaveBeenCalled();
});

it('generates both managed credentials for a new SAML provider without disclosing private keys', async () => {
  const f = samlFixture();
  const { spCredentials: _managed, ...config } = f.config;
  await requestContext.run(context, () =>
    f.service.create(
      CreateIdpSchema.parse({ protocol: 'saml', displayName: 'Synthetic SAML', config }),
    ),
  );
  const created = f.tx.identityProvider.create.mock.calls[0]![0] as {
    data: { config: { spCredentials: { use: string; state: string }[] } };
  };
  expect(created.data.config.spCredentials.map((c) => [c.use, c.state])).toEqual([
    ['signing', 'active'],
    ['encryption', 'active'],
  ]);
  expect(f.secrets.put).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain('PRIVATE KEY');
});

it('preserves an OIDC client secret on ordinary config changes and skips absent secret deletion', async () => {
  const f = fixture();
  await requestContext.run(context, () =>
    f.service.update(
      id,
      3,
      UpdateIdpSchema.parse({
        config: {
          vendor: 'generic',
          issuer: 'https://updated.example.invalid',
          clientId: 'synthetic',
        },
      }),
    ),
  );
  const changed = f.tx.identityProvider.updateMany.mock.calls[0]![0] as {
    data: { config: { clientSecretRef: string } };
  };
  expect(changed.data.config.clientSecretRef).toBe(secretId);
  expect(f.secrets.put).not.toHaveBeenCalled();
  f.setIdp({
    ...f.idp(),
    protocol: 'oidc',
    status: 'draft',
    config: OidcConfigSchema.parse({
      vendor: 'generic',
      issuer: 'https://synthetic.example.invalid',
      clientId: 'synthetic',
    }),
  });
  await requestContext.run(context, () => f.service.remove(id, 3));
  expect(f.secrets.remove).not.toHaveBeenCalled();
});

it.each([undefined, 30])(
  'issues a one-time SCIM token with optional expiry %s and stores only its hash',
  async (days) => {
    const f = fixture();
    const issued = await requestContext.run(context, () => f.service.issueScimToken(id, days));
    const saved = f.tx.scimToken.create.mock.calls[0]![0] as {
      data: { tokenHash: string; expiresAt?: Date };
    };
    expect(issued.token).toMatch(/^vscim_/);
    expect(saved.data.tokenHash).toBe(sha256Hex(issued.token));
    expect(saved.data.expiresAt).toEqual(
      days === undefined ? undefined : new Date(now + days * 86400000),
    );
    expect(issued.scimBaseUrl).toBe('https://synthetic-api.example.invalid/scim/v2/synthetic');
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain(issued.token);
    expect(JSON.stringify(await f.service.listScimTokens(id))).not.toContain(issued.token);
  },
);

it('returns token lifecycle timestamps and refuses disabled provisioning or unknown revocation', async () => {
  const f = fixture();
  f.token.expiresAt = new Date(now + 86400000);
  f.token.lastUsedAt = new Date(now);
  f.token.revokedAt = new Date(now);
  expect(await f.service.listScimTokens(id)).toEqual([
    {
      id,
      prefix: f.token.prefix,
      createdAt: new Date(now).toISOString(),
      expiresAt: f.token.expiresAt.toISOString(),
      lastUsedAt: new Date(now).toISOString(),
      revokedAt: new Date(now).toISOString(),
    },
  ]);
  await requestContext.run(context, () => f.service.revokeScimToken(id, id));
  expect(f.audit.record).toHaveBeenCalledTimes(1);
  f.tx.scimToken.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    requestContext.run(context, () => f.service.revokeScimToken(id, id)),
  ).rejects.toThrow();
  f.setIdp({ ...f.idp(), scimEnabled: false });
  await expect(f.service.issueScimToken(id)).rejects.toThrow('SCIM is not enabled');
  f.setIdp(undefined);
  await expect(f.service.issueScimToken(id)).rejects.toThrow();
});
