/** Explicit local demo provisioning. Never creates credentials or bypasses runtime launch. */
import path from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

import { SYSTEM_ROLE_KEYS } from '@verbis/authz';

import { requestContext, systemContext } from '../src/common/context/request-context.js';
import { canonicalJson, sha256Hex } from '../src/common/crypto/canonical-json.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { OutboxWriter } from '../src/infra/outbox/outbox.writer.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { checksumOf } from '../src/modules/scripts/document-storage.js';
import { projectDocument } from '../src/modules/scripts/projection.js';

import {
  assertDemoTarget,
  DEMO_ACTOR,
  DEMO_CONNECTOR_ID,
  DEMO_SHARED_ID,
  DEMO_SEED_VERSION,
  DEMO_SHARED_VERSION_ID,
  DEMO_SLUG,
  DEMO_TENANT_ID,
  DEMO_USERS,
  demoCampaigns,
  demoFacts,
  demoId,
  demoOutcomeCodes,
  demoRoleScope,
  mockDefinition,
  sharedFragment,
} from './demo/fixture.js';
import { provisionDemoIdentity } from './demo/identity.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });
const connectionString = assertDemoTarget(process.env);
const day = z.iso.date().parse(process.env['DEMO_DATE'] ?? '2026-10-03');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const outbox = new OutboxWriter();
const audit = new AuditService(outbox);
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const actor = { type: 'apiClient' as const, id: 'seed-demo' };
const campaigns = demoCampaigns();

try {
  const context = systemContext(demoId(999), DEMO_ACTOR);
  context.principal = { type: 'service', id: 'seed-demo', tenantId: DEMO_TENANT_ID, scopes: [] };
  await requestContext.run(context, () =>
    prisma.$transaction(
      async (tx) => {
        // Serialize the whole local bundle and reject collisions instead of altering existing data.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('verbis-demo-seed-v1', 0))`;
        if (process.env['DEMO_REQUIRE_EMPTY_DB'] === '1' && (await tx.tenant.count()) !== 0)
          throw new Error('Clean demo acceptance requires an empty isolated database');
        const existing = await tx.tenant.findUnique({ where: { slug: DEMO_SLUG } });
        if (existing) {
          if (
            existing.id !== DEMO_TENANT_ID ||
            (existing.settings as Record<string, unknown>)['demoSeedVersion'] !== DEMO_SEED_VERSION
          )
            throw new Error('Demo tenant collision; refusing to overwrite');
          process.stdout.write('Demo bundle already exists; preserved without mutation.\n');
          return;
        }
        await tx.tenant.create({
          data: {
            id: DEMO_TENANT_ID,
            slug: DEMO_SLUG,
            name: 'Verbis Türkçe Demo',
            region: 'tr-1',
            status: 'active',
            settings: {
              defaultLocale: 'tr',
              demoSeedVersion: DEMO_SEED_VERSION,
              synthetic: true,
              allowedOrigins: [
                'http://localhost:5173',
                'http://localhost:5174',
                'http://localhost:5175',
              ],
            },
          },
        });
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${DEMO_TENANT_ID}, true)`;
        const meta = { tenantId: DEMO_TENANT_ID, createdBy: DEMO_ACTOR, updatedBy: DEMO_ACTOR };
        const record = async (action: string, type: string, id: string) => {
          await audit.record(tx, {
            action,
            target: { type, id },
            actor,
            metadata: { synthetic: true },
          });
        };
        await record('demo.tenant.created', 'Tenant', DEMO_TENANT_ID);
        const roles = new Map<string, string>();
        for (const [index, name] of SYSTEM_ROLE_KEYS.entries()) {
          if (name === 'super_admin') continue;
          const id = demoId(40 + index);
          roles.set(name, id);
          await tx.role.create({ data: { ...meta, id, name, permissions: [], isSystem: true } });
          await record('demo.role.created', 'Role', id);
        }
        for (const user of DEMO_USERS) {
          await tx.user.create({
            data: {
              ...meta,
              id: user.id,
              email: user.email,
              displayName: user.displayName,
              locale: 'tr',
              status: 'active',
              ctiIdentities:
                'platformId' in user ? [{ platform: 'generic', id: user.platformId }] : [],
            },
          });
          for (const name of user.roles) {
            const roleId = roles.get(name);
            if (!roleId) throw new Error('Unknown demo role');
            await tx.userRole.create({
              data: { ...meta, userId: user.id, roleId, scope: demoRoleScope(name) },
            });
          }
          await record('demo.user.provisioned', 'User', user.id);
        }
        await provisionDemoIdentity(tx, process.env, record);
        await tx.connector.create({
          data: {
            ...meta,
            id: DEMO_CONNECTOR_ID,
            adapterType: 'generic',
            platform: 'generic',
            config: { kind: 'simulator' },
            secretRefs: [],
            status: 'active',
          },
        });
        await record('demo.connector.created', 'Connector', DEMO_CONNECTOR_ID);
        await tx.sharedScreen.create({
          data: {
            ...meta,
            id: DEMO_SHARED_ID,
            key: 'demo-welcome',
            name: 'Ortak Karşılama',
            tags: ['demo', 'shared'],
          },
        });
        await tx.sharedScreenVersion.create({
          data: {
            tenantId: DEMO_TENANT_ID,
            createdBy: DEMO_ACTOR,
            id: DEMO_SHARED_VERSION_ID,
            sharedScreenId: DEMO_SHARED_ID,
            number: 1,
            semver: '1.0.0',
            fragment: json(sharedFragment),
            checksum: sha256Hex(canonicalJson(sharedFragment)),
          },
        });
        await record('demo.sharedScreen.created', 'SharedScreen', DEMO_SHARED_ID);
        const sources = new Map<string, number>();
        for (const campaign of campaigns)
          for (const source of campaign.document.dataSources)
            sources.set(source.ref.replace('tenant-datasource:', ''), source.version);
        for (const [index, [key, version]] of [...sources].entries()) {
          const id = demoId(700 + index);
          await tx.dataSource.create({
            data: {
              ...meta,
              id,
              key,
              protocol: 'rest',
              version,
              definition: json(mockDefinition(key)),
              policy: { timeoutMs: 4000, retries: 0, containsPii: true, cacheTtlSeconds: 0 },
              secretRefs: [],
            },
          });
          await record('demo.datasource.created', 'DataSource', id);
        }
        for (const campaign of campaigns) {
          const checksum = checksumOf(campaign.document);
          await tx.campaign.create({
            data: {
              ...meta,
              id: campaign.id,
              name: campaign.name,
              code: campaign.code,
              status: 'active',
              defaultLocale: 'tr',
              locales: ['tr', 'en'],
              channels: ['voice'],
              queues: [campaign.queue],
              outcomeSet: demoOutcomeCodes(campaign.document).map((code) => ({
                code,
                label: code,
                category: code === 'demo-success' ? 'success' : 'other',
                requiresNote: false,
              })),
            },
          });
          await tx.script.create({
            data: {
              ...meta,
              id: campaign.scriptId,
              name: campaign.name,
              status: 'active',
              tags: ['demo'],
            },
          });
          await tx.scriptVersion.create({
            data: {
              ...meta,
              id: campaign.versionId,
              scriptId: campaign.scriptId,
              number: 1,
              state: 'published',
              schemaVersion: campaign.document.schemaVersion,
              document: json(campaign.document),
              documentSize: Buffer.byteLength(canonicalJson(campaign.document)),
              checksum,
              semver: '1.0.0',
              publishedAt: new Date(day + 'T08:00:00Z'),
              publishedBy: DEMO_USERS[2].id,
              changeNote: 'Sentetik demo bootstrap; gerçek approval kabulü değildir.',
            },
          });
          await tx.script.update({
            where: { id: campaign.scriptId },
            data: { currentVersionId: campaign.versionId },
          });
          await projectDocument(
            tx,
            { tenantId: DEMO_TENANT_ID, scriptVersionId: campaign.versionId, actor: DEMO_ACTOR },
            campaign.document,
          );
          await tx.scriptScreenLink.create({
            data: {
              tenantId: DEMO_TENANT_ID,
              createdBy: DEMO_ACTOR,
              id: campaign.linkId,
              scriptVersionId: campaign.versionId,
              sharedScreenId: DEMO_SHARED_ID,
              sharedScreenVersionId: DEMO_SHARED_VERSION_ID,
              mode: 'linked',
              pageIds: ['demo-intro'],
            },
          });
          await tx.assignment.create({
            data: {
              ...meta,
              id: campaign.assignmentId,
              campaignId: campaign.id,
              scriptId: campaign.scriptId,
              pinnedVersionId: campaign.versionId,
              versionPolicy: 'pinned',
              priority: 10,
              conditions: { channels: ['voice'], queues: [campaign.queue] },
            },
          });
          await tx.campaignExternalMapping.create({
            data: {
              tenantId: DEMO_TENANT_ID,
              createdBy: DEMO_ACTOR,
              id: campaign.mappingId,
              campaignId: campaign.id,
              platform: 'generic',
              kind: 'queue',
              externalId: campaign.queue,
            },
          });
          await record('demo.campaign.created', 'Campaign', campaign.id);
          await record('demo.script.bootstrapPublished', 'ScriptVersion', campaign.versionId);
          await record('demo.assignment.created', 'Assignment', campaign.assignmentId);
          await record('demo.routing.created', 'CampaignExternalMapping', campaign.mappingId);
        }
        for (let ordinal = 0; ordinal < 28; ordinal++) {
          const campaign = campaigns[ordinal % 4];
          if (!campaign) throw new Error('Missing demo campaign');
          const history = demoFacts(campaign, day, ordinal);
          await tx.interaction.create({
            data: {
              ...meta,
              id: history.interactionId,
              connectorId: DEMO_CONNECTOR_ID,
              externalId: `demo-history-${ordinal}`,
              channelType: 'voice',
              direction: 'inbound',
              campaignId: campaign.id,
              queue: campaign.queue,
              startedAt: history.start,
              endedAt: history.end,
              status: 'ended',
              attributes: { synthetic: true },
            },
          });
          await tx.session.create({
            data: {
              ...meta,
              id: history.sessionId,
              interactionId: history.interactionId,
              userId: DEMO_USERS[3].id,
              scriptVersionId: campaign.versionId,
              assignmentId: campaign.assignmentId,
              state: history.completed ? 'completed' : 'abandoned',
              startedAt: history.start,
              endedAt: history.end,
              checksum: checksumOf(campaign.document),
              sequence: 2,
              variables: {},
              decisionTrace: { synthetic: true, source: 'seed-demo' },
            },
          });
          for (const fact of history.facts)
            await tx.$executeRaw`INSERT INTO analytics_facts(tenant_id,event_id,occurred_at,session_id,fact) VALUES(${DEMO_TENANT_ID}::uuid,${fact.eventId}::uuid,${new Date(fact.at)},${history.sessionId}::uuid,${JSON.stringify(fact)}::jsonb) ON CONFLICT DO NOTHING`;
          await record('demo.session.historyCreated', 'Session', history.sessionId);
        }
        await record('demo.bundle.created', 'Tenant', DEMO_TENANT_ID);
      },
      { timeout: 120000 },
    ),
  );
  process.stdout.write(
    'Demo tenant ready: verbis-demo; four campaigns, shared screens, mocks and synthetic analytics. No login credentials or live launch grants created.\n',
  );
} catch {
  process.stderr.write(
    'Demo seed failed; transaction rolled back. Inspect configuration securely.\n',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
