import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from '../../apps/api/node_modules/vitest/dist/index.js';
import {
  createTenant,
  integrationEnv,
  ownerPrisma,
  startApp,
  uniqueSlug,
} from '../../apps/api/test/integration/helpers.js';
import { createTokenKit } from '../../apps/api/test/support/tokens.js';
import { surveyScript } from '../../packages/script-schema/dist/fixtures/index.js';

import { evidenceFile } from './evidence.js';

import type { NestFastifyApplication } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import type { TenantFixture } from '../../apps/api/test/integration/helpers.js';

interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  file: string;
  line: number;
  public: boolean;
}
interface Schema {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  default?: unknown;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  type?: string;
  format?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minItems?: number;
  minimum?: number;
  minLength?: number;
}
const routes = (
  JSON.parse(
    readFileSync(
      new URL('../../docs/verification/evidence/V1/routes.json', import.meta.url),
      'utf8',
    ),
  ) as { routes: Route[] }
).routes;
const spec = JSON.parse(
  readFileSync(new URL('../../apps/api/openapi.json', import.meta.url), 'utf8'),
) as {
  components: { schemas: Record<string, Schema> };
  paths: Record<
    string,
    Record<string, { requestBody?: { content?: Record<string, { schema: Schema }> } }>
  >;
};
let app: NestFastifyApplication, owner: PrismaClient, a: TenantFixture, b: TenantFixture;
let scriptId: string, versionId: string, campaignId: string, sessionId: string;
const canary = 'V2_FOREIGN_PRIVATE_' + randomUUID();
const results: Record<string, unknown>[] = [];
function sample(s: Schema = {}, key = '', depth = 0): unknown {
  if (depth > 12) return null;
  if (s.$ref)
    return sample(spec.components.schemas[s.$ref.split('/').at(-1) ?? ''] ?? {}, key, depth + 1);
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  if (s.anyOf || s.oneOf) return sample((s.anyOf ?? s.oneOf ?? [])[0], key, depth + 1);
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => sample(x, key, depth + 1)));
  if (s.type === 'object' || s.properties)
    return Object.fromEntries(
      (s.required ?? []).map((k) => [k, sample(s.properties?.[k], k, depth + 1)]),
    );
  if (s.type === 'array')
    return Array.from({ length: s.minItems ?? 0 }, () => sample(s.items, key, depth + 1));
  if (s.type === 'boolean') return false;
  if (s.type === 'integer' || s.type === 'number') return s.minimum ?? 1;
  if (s.format === 'uuid' || key.endsWith('Id')) return foreignId(key);
  if (s.format === 'date-time') return new Date().toISOString();
  if (s.format === 'email') return 'verification@example.test';
  if (s.format === 'uri' || s.format === 'url') return 'https://example.test';
  return 'audit'.padEnd(s.minLength ?? 0, 'x');
}
function foreignId(key: string): string {
  if (/tenant/i.test(key)) return b.tenantId;
  if (/campaign/i.test(key)) return campaignId;
  if (/session/i.test(key)) return sessionId;
  if (/version/i.test(key)) return versionId;
  if (/user/i.test(key)) return b.adminId;
  return scriptId;
}
beforeAll(async () => {
  owner = ownerPrisma();
  const kit = await createTokenKit();
  app = await startApp(integrationEnv(kit.jwks));
  a = await createTenant(owner, kit, uniqueSlug('v2-a'));
  b = await createTenant(owner, kit, uniqueSlug('v2-b'));
  const auth = await b.auth();
  const script = await app.inject({
    method: 'POST',
    url: '/v1/scripts',
    headers: auth,
    payload: { name: canary },
  });
  expect(script.statusCode).toBe(201);
  scriptId = script.json<{ id: string }>().id;
  const version = await app.inject({
    method: 'POST',
    url: `/v1/scripts/${scriptId}/versions`,
    headers: auth,
    payload: { document: surveyScript, screens: [] },
  });
  expect(version.statusCode, version.body).toBe(201);
  versionId = version.json<{ id: string }>().id;
  const campaign = await app.inject({
    method: 'POST',
    url: '/v1/campaigns',
    headers: auth,
    payload: { name: canary, channels: ['voice'] },
  });
  expect(campaign.statusCode).toBe(201);
  campaignId = campaign.json<{ id: string }>().id;
  const session = await owner.session.create({
    data: {
      kind: 'preview',
      tenantId: b.tenantId,
      userId: b.adminId,
      scriptVersionId: versionId,
      checksum: 'verification',
      variables: { privateCanary: canary },
      createdBy: 'test',
      updatedBy: 'test',
    },
  });
  sessionId = session.id;
});
afterAll(async () => {
  writeFileSync(
    evidenceFile('route-probes.json'),
    JSON.stringify(
      {
        interpretation:
          'A valid tenant admin probes every explicit route with foreign IDs. 400/401/428/5xx and unseeded foreign resource types are inconclusive; no success-path audit completeness inferred.',
        results,
      },
      null,
      2,
    ),
  );
  await app.close();
  await owner.$disconnect();
});
describe('V2 every-route foreign-tenant canary probes', () => {
  for (const route of routes)
    it(`${route.method} ${route.path}: no B private canary`, async () => {
      const correlation = randomUUID();
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) =>
        /number|versionNumber/i.test(key)
          ? '1'
          : /slug/i.test(key)
            ? 'foreign-unknown-slug'
            : foreignId(
                key === 'id'
                  ? route.path.startsWith('/v1/campaigns')
                    ? 'campaignId'
                    : /^\/v1\/(?:supervisor\/)?sessions/.test(route.path)
                      ? 'sessionId'
                      : route.path.startsWith('/v1/users')
                        ? 'userId'
                        : key
                  : key,
              ),
      );
      const openPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const bodySchema =
        spec.paths[openPath]?.[route.method.toLowerCase()]?.requestBody?.content?.[
          'application/json'
        ]?.schema;
      let payload: unknown = sample(bodySchema);
      if (route.path === '/v1/launch/redeem') payload = { code: 'A'.repeat(43) };
      if (route.path === '/v1/launch/jws') payload = { token: 'A'.repeat(64) };
      if (route.path === '/v1/launch/param-signals') payload = { params: ['scriptId'] };
      const res = await app.inject({
        method: route.method,
        url: path,
        headers: {
          ...(await a.auth()),
          ...(bodySchema === undefined ? {} : { 'content-type': 'application/json' }),
          'if-match': '"1"',
          'x-correlation-id': correlation,
        },
        ...(route.method === 'GET' || bodySchema === undefined
          ? {}
          : { payload: JSON.stringify(payload) }),
      });
      const audits = await owner.auditEvent.findMany({
        where: { tenantId: a.tenantId, correlationId: String(res.headers['x-correlation-id']) },
        select: { action: true, outcome: true },
      });
      results.push({
        ...route,
        requestPath: path,
        status: res.statusCode,
        problemCode: res.headers['content-type']?.includes('json')
          ? (res.json<{ code?: string }>().code ?? null)
          : null,
        audit: audits,
        foreignCanarySeen: res.body.includes(canary),
        validationReachable: ![400, 401, 428, 500, 502, 503].includes(res.statusCode),
        seededType: /scripts|campaigns|sessions|audit/.test(route.path),
      });
      expect(res.body, `${route.method} ${path}`).not.toContain(canary);
      if (
        !route.public &&
        !route.path.includes('audit-events') &&
        route.method === 'GET' &&
        res.statusCode === 200
      ) {
        for (const id of [scriptId, campaignId, sessionId, versionId, b.adminId])
          expect(res.body).not.toContain(id);
      }
    });
  it('foreign script campaign and session fixture rows remain unchanged', async () => {
    expect(await owner.script.findUniqueOrThrow({ where: { id: scriptId } })).toMatchObject({
      name: canary,
      version: 1,
      deletedAt: null,
    });
    expect(await owner.campaign.findUniqueOrThrow({ where: { id: campaignId } })).toMatchObject({
      name: canary,
      version: 1,
      deletedAt: null,
    });
    expect(await owner.session.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({
      sequence: 0,
      deletedAt: null,
      variables: { privateCanary: canary },
    });
  });
  it('query-only launch rejection must itself produce an audit event', async () => {
    const correlation = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/launch/redeem?scriptId=${scriptId}`,
      headers: { ...(await a.auth()), 'x-correlation-id': correlation },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(
      await owner.auditEvent.count({
        where: { tenantId: a.tenantId, correlationId: String(res.headers['x-correlation-id']) },
      }),
      'rejection without audit is critical',
    ).toBeGreaterThan(0);
  });
});
