/**
 * Development seed. Idempotent: safe to run repeatedly. Runs with the owner connection.
 * Creates only non-sensitive fixture data (CLAUDE.md: no real customer data, no secrets).
 */
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';

import { SYSTEM_ROLE_KEYS } from '@verbis/authz';

import { requestContext, systemContext } from '../src/common/context/request-context.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { OutboxWriter } from '../src/infra/outbox/outbox.writer.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { Keyring } from '../src/modules/identity/crypto/keyring.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env (pnpm install does this).');
}

/** Stable ids so `pnpm --filter @verbis/api dev:token` works without arguments. */
export const DEV_TENANT_ID = '01928f3a-0000-7000-8000-00000000d001';
export const DEV_ADMIN_ID = '01928f3a-0000-7000-8000-00000000d101';
/** Dev Keycloak IdP (realm verbis-dev); stable so the realm's back-channel logout URL matches. */
export const DEV_IDP_ID = '01928f3a-0000-7000-8000-00000000d201';
const SEED = 'seed';
const DEV_SIMULATOR_ID = '01928f3a-0000-7000-8000-00000000d401';
const DEV_HUB_CLIENT_ID = '01928f3a-0000-7000-8000-00000000d301';
const audit = new AuditService(new OutboxWriter());

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  if (process.env['DEV_BOOTSTRAP_REQUIRE_EMPTY'] === '1' && (await prisma.tenant.count()) !== 0)
    throw new Error('Bootstrap acceptance requires an empty isolated database');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'verbis-dev' },
    update: {},
    create: {
      id: DEV_TENANT_ID,
      slug: 'verbis-dev',
      name: 'Verbis Development',
      region: 'tr-1',
      status: 'active',
      settings: {
        defaultLocale: 'tr',
        allowedOrigins: (
          process.env['CORS_ALLOWED_ORIGINS'] ??
          'http://localhost:5173,http://localhost:5174,http://localhost:5175'
        ).split(','),
      },
    },
  });

  // Tenant-scoped tables are FORCE RLS: set the tenant context, as the API does.
  const context = systemContext(randomUUID(), 'dev-seed');
  context.principal = { type: 'service', id: SEED, tenantId: tenant.id, scopes: [] };
  await requestContext.run(context, () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      const roleIds: Record<string, string> = {};
      for (const name of SYSTEM_ROLE_KEYS) {
        const existing = await tx.role.findFirst({
          where: { tenantId: tenant.id, name, deletedAt: null },
        });
        const role =
          existing ??
          (await tx.role.create({
            data: {
              tenantId: tenant.id,
              name,
              // System role rules live in @verbis/authz (code), not in the row.
              permissions: [],
              isSystem: true,
              createdBy: SEED,
              updatedBy: SEED,
            },
          }));
        roleIds[name] = role.id;
      }
      const admin = await tx.user.upsert({
        where: { id: DEV_ADMIN_ID },
        update: {},
        create: {
          id: DEV_ADMIN_ID,
          tenantId: tenant.id,
          email: 'admin@verbis.test',
          displayName: 'Dev Admin',
          status: 'active',
          createdBy: SEED,
          updatedBy: SEED,
        },
      });
      const adminRole = roleIds['tenant_admin'];
      if (
        adminRole !== undefined &&
        (await tx.userRole.count({
          where: { userId: admin.id, roleId: adminRole, deletedAt: null },
        })) === 0
      ) {
        await tx.userRole.create({
          data: {
            tenantId: tenant.id,
            userId: admin.id,
            roleId: adminRole,
            createdBy: SEED,
            updatedBy: SEED,
          },
        });
      }
      await seedKeycloakIdp(tx, tenant.id);
      await seedSimulator(tx, tenant.id);
      await seedHubClient(tx, tenant.id);
    }),
  );
  process.stdout.write(
    `Seeded tenant ${tenant.slug} (${tenant.id}) with system roles and a dev admin\n`,
  );
  // Existing dev databases keep their original tenant id, so print the exact command.
  process.stdout.write(
    `Dev token: pnpm --filter @verbis/api dev:token ${DEV_ADMIN_ID} ${tenant.id}\n`,
  );
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * OIDC IdP for the dev Keycloak realm: JIT provisioning, Keycloak groups → system roles, and the
 * `verbis.test` domain for home-realm discovery. The client secret is sealed like the API does.
 */
async function seedKeycloakIdp(tx: Tx, tenantId: string): Promise<void> {
  const issuer = process.env['OIDC_ISSUER_URL'];
  const clientId = process.env['OIDC_CLIENT_ID'];
  const clientSecret = process.env['OIDC_CLIENT_SECRET'];
  const keys = process.env['IDENTITY_ENCRYPTION_KEYS'];
  if (!issuer || !clientId || !clientSecret || !keys) {
    process.stdout.write(
      'Skipping the dev Keycloak IdP (OIDC_* or IDENTITY_ENCRYPTION_KEYS not set)\n',
    );
    return;
  }
  const secretName = `idp:${DEV_IDP_ID}:client-secret`;
  const ciphertext = Buffer.from(
    new Keyring(keys).seal(clientSecret, `secret:${tenantId}:${secretName}`),
    'utf8',
  );
  const existingSecret = await tx.secret.findFirst({
    where: { tenantId, name: secretName, deletedAt: null },
  });
  const secret = existingSecret
    ? await tx.secret.update({
        where: { id: existingSecret.id },
        data: { ciphertext, updatedBy: SEED },
      })
    : await tx.secret.create({
        data: {
          tenantId,
          name: secretName,
          kind: 'oauth_client',
          ciphertext,
          createdBy: SEED,
          updatedBy: SEED,
        },
      });
  const config = {
    vendor: 'keycloak',
    issuer,
    clientId,
    clientAuth: 'client_secret_basic',
    clientSecretRef: secret.id,
    linkByVerifiedEmail: true,
    roleMapping: {
      defaultRoles: [],
      rules: [
        { claim: 'groups', equals: 'verbis-admins', roles: ['tenant_admin'] },
        { claim: 'groups', equals: 'verbis-designers', roles: ['script_designer'] },
        { claim: 'groups', equals: 'verbis-agents', roles: ['agent'] },
      ],
    },
  };
  await tx.identityProvider.upsert({
    where: { id: DEV_IDP_ID },
    update: { config, status: 'active', updatedBy: SEED },
    create: {
      id: DEV_IDP_ID,
      tenantId,
      protocol: 'oidc',
      displayName: 'Keycloak (dev)',
      config,
      domainHints: ['verbis.test'],
      jitProvisioning: true,
      status: 'active',
      createdBy: SEED,
      updatedBy: SEED,
    },
  });
  if (
    (await tx.identityProviderDomain.count({
      where: { domain: 'verbis.test', deletedAt: null },
    })) === 0
  ) {
    await tx.identityProviderDomain.create({
      data: {
        tenantId,
        idpId: DEV_IDP_ID,
        domain: 'verbis.test',
        createdBy: SEED,
        updatedBy: SEED,
      },
    });
  }
}

async function seedSimulator(tx: Tx, tenantId: string): Promise<void> {
  if (process.env['SIMULATOR_ENABLED'] !== 'true') return;
  const existing = await tx.connector.findUnique({ where: { id: DEV_SIMULATOR_ID } });
  if (existing) {
    if (existing.tenantId !== tenantId) throw new Error('Dev simulator identity collision');
    return;
  }
  await tx.connector.create({
    data: {
      id: DEV_SIMULATOR_ID,
      tenantId,
      adapterType: 'generic',
      platform: 'generic',
      config: { kind: 'simulator' },
      status: 'active',
      createdBy: SEED,
      updatedBy: SEED,
    },
  });
  await audit.record(tx, {
    action: 'connector.created',
    target: { type: 'Connector', id: DEV_SIMULATOR_ID },
    actor: { type: 'system', id: SEED },
    metadata: { synthetic: true, bootstrap: true },
  });
}
async function seedHubClient(tx: Tx, tenantId: string): Promise<void> {
  const file = process.env['HUB_CLIENT_CERT_FILE'];
  if (!file) return;
  if (process.env['NODE_ENV'] !== 'development')
    throw new Error('Dev service client seeding is development only');
  const certificateThumbprint = createHash('sha256')
    .update(new X509Certificate(readFileSync(file)).raw)
    .digest('base64url');
  const existing = await tx.serviceClient.findUnique({ where: { id: DEV_HUB_CLIENT_ID } });
  if (existing && existing.tenantId !== tenantId) throw new Error('Dev hub identity collision');
  const scopes = ['read:Connector', 'update:Connector', 'create:Session'];
  if (existing?.certificateThumbprint !== certificateThumbprint) {
    await tx.serviceClient.upsert({
      where: { id: DEV_HUB_CLIENT_ID },
      create: {
        id: DEV_HUB_CLIENT_ID,
        tenantId,
        name: 'Development connector hub',
        authMethod: 'tls_client_auth',
        certificateThumbprint,
        scopes,
        status: 'active',
        createdBy: SEED,
        updatedBy: SEED,
      },
      update: { certificateThumbprint, updatedBy: SEED, version: { increment: 1 } },
    });
    await audit.record(tx, {
      action: existing ? 'identity.serviceClient.updated' : 'identity.serviceClient.created',
      target: { type: 'ServiceClient', id: DEV_HUB_CLIENT_ID },
      actor: { type: 'system', id: SEED },
      metadata: { synthetic: true, bootstrap: true },
    });
  }
  const metadataFile = process.env['DEV_BOOTSTRAP_METADATA_FILE'];
  if (metadataFile) {
    const previous = JSON.parse(readFileSync(metadataFile, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      metadataFile,
      JSON.stringify(
        {
          ...previous,
          hub: { slug: 'verbis-dev', clientId: DEV_HUB_CLIENT_ID },
          tenantId,
          simulatorId: DEV_SIMULATOR_ID,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
