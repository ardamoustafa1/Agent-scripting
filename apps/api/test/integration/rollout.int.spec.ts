import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { surveyScript } from '@verbis/script-schema/fixtures';

import { fixtureFact } from '../../src/modules/analytics/fixtures.js';
import { RolloutGuard } from '../../src/modules/assignments/rollout.service.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import { createTenant, integrationEnv, ownerPrisma, startApp, uniqueSlug } from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

let owner: PrismaClient, app: NestFastifyApplication, kit: TokenKit;
beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  app = await startApp(
    integrationEnv(kit.jwks, {
      ANALYTICS_ENABLED: 'true',
      ANALYTICS_PSEUDONYM_KEY: Buffer.alloc(32, 7).toString('base64'),
    }),
  );
});
afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

const json = { 'content-type': 'application/json' };
async function rollout(canaryWeight: number) {
  const tenant = await createTenant(owner, kit, uniqueSlug('rollout'));
  const headers = { ...json, ...(await tenant.auth()) };
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, extra = {}) =>
    app.inject({ method, url, headers: { ...headers, ...extra }, ...(payload ? { payload } : {}) });
  const script = (await call('POST', '/v1/scripts', { name: 'Canary' })).json<{ id: string }>();
  const versions: string[] = [];
  for (let n = 1; n <= 2; n += 1) {
    const created = await call('POST', `/v1/scripts/${script.id}/versions`, {
      document: surveyScript,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;
    await owner.scriptVersion.update({
      where: { id },
      data: { state: 'published', publishedAt: new Date() },
    });
    versions.push(id);
  }
  await owner.script.update({
    where: { id: script.id },
    data: { currentVersionId: versions[0] ?? null },
  });
  const campaign = (
    await call('POST', '/v1/campaigns', { name: 'Rollout', code: 'ROLLOUT', status: 'active' })
  ).json<{ id: string }>();
  const created = await call('POST', '/v1/assignments', {
    scriptId: script.id,
    campaignId: campaign.id,
    variants: [
      { key: 'stable', weight: 10_000 - canaryWeight, pinnedVersionId: versions[0] },
      { key: 'canary', weight: canaryWeight, pinnedVersionId: versions[1] },
    ],
  });
  expect(created.statusCode, created.body).toBe(201);
  const assignment = created.json<{ id: string }>();
  /** Inserts terminal sessions for one arm: `abandoned` of `total` end abandoned, the rest complete. */
  async function seed(
    variant: 'stable' | 'canary',
    total: number,
    abandoned: number,
    read: number,
  ) {
    const at = (s: number) => new Date(Date.now() - 3_600_000 + s * 1000).toISOString();
    for (let i = 0; i < total; i += 1) {
      const sessionId = randomUUID();
      const common = {
        tenantId: tenant.tenantId,
        sessionId,
        scriptId: script.id,
        versionId: versions[variant === 'stable' ? 0 : 1] ?? randomUUID(),
        campaignId: campaign.id,
        variant,
        experimentId: assignment.id,
      };
      const facts = [
        fixtureFact(0, { ...common, eventId: randomUUID(), at: at(0) }),
        fixtureFact(1, {
          ...common,
          eventId: randomUUID(),
          at: at(1),
          type: 'page',
          pageId: 'legal',
          requiredReadIds: ['terms'],
        }),
        ...(i < read
          ? [
              fixtureFact(2, {
                ...common,
                eventId: randomUUID(),
                at: at(2),
                type: 'read',
                pageId: 'legal',
                nodeId: 'terms',
              }),
            ]
          : []),
        fixtureFact(3, {
          ...common,
          eventId: randomUUID(),
          at: at(3),
          state: i < abandoned ? 'abandoned' : 'completed',
        }),
      ];
      for (const f of facts)
        await owner.$executeRaw`INSERT INTO analytics_facts(tenant_id,event_id,occurred_at,session_id,fact) VALUES(${tenant.tenantId}::uuid,${f.eventId}::uuid,${f.at}::timestamptz,${f.sessionId}::uuid,${JSON.stringify(f)}::jsonb)`;
    }
  }
  return { tenant, call, assignment, versions, seed };
}
const verdict = async (r: Awaited<ReturnType<typeof rollout>>) =>
  (await r.call('GET', `/v1/assignments/${r.assignment.id}/rollout`)).json<{
    decision: { action: string; reason: string; breached: string[]; to: number | null };
    canarySessions: number;
  }>();

describe('canary rollout (C4)', () => {
  it('holds while traffic is thin, then advises the next stage when nothing is wrong', async () => {
    const r = await rollout(500);
    await r.seed('stable', 40, 4, 40);
    await r.seed('canary', 40, 4, 40);
    expect((await verdict(r)).decision).toMatchObject({
      action: 'hold',
      reason: 'insufficient-sessions',
    });
    await r.seed('stable', 160, 16, 160);
    await r.seed('canary', 160, 16, 160);
    const ok = await verdict(r);
    expect(ok.canarySessions).toBe(200);
    expect(ok.decision).toMatchObject({ action: 'advance', reason: 'no-harm-detected', to: 2500 });
  });
  it('recommends and the guard performs a rollback on a worse guardrail, once, with an audit trail', async () => {
    const r = await rollout(2500);
    await r.seed('stable', 300, 30, 300);
    await r.seed('canary', 300, 150, 300);
    const bad = await verdict(r);
    expect(bad.decision.action).toBe('rollback');
    expect(bad.decision.breached).toContain('abandonment');
    // The verdict alone never changes anything.
    const before = await owner.assignment.findUniqueOrThrow({ where: { id: r.assignment.id } });
    expect(before.abTest).toMatchObject([
      { key: 'stable', weight: 7500 },
      { key: 'canary', weight: 2500 },
    ]);

    const guard = app.get(RolloutGuard);
    expect(await guard.tick()).toContain(r.assignment.id);
    const after = await owner.assignment.findUniqueOrThrow({ where: { id: r.assignment.id } });
    expect(after.abTest).toEqual([
      { key: 'stable', weight: 10_000, pinnedVersionId: r.versions[0] },
      { key: 'canary', weight: 0, pinnedVersionId: r.versions[1] },
    ]);
    expect(after.version).toBe(before.version + 1);
    const events = await owner.auditEvent.findMany({
      where: { tenantId: r.tenant.tenantId, action: 'assignment.rollout.rolledBack' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ automatic: true, fromWeight: 2500 });
    expect(events[0]?.actorId).toBe('rollout-guard');
    // Idempotent: a rollout that is no longer an active canary is not touched again.
    expect(await guard.tick()).not.toContain(r.assignment.id);
    expect(
      await owner.auditEvent.count({
        where: { tenantId: r.tenant.tenantId, action: 'assignment.rollout.rolledBack' },
      }),
    ).toBe(1);
    expect((await verdict(r)).decision.reason).toBe('not-started');
  });
  it('never rolls back a healthy rollout and ignores plain A/B tests', async () => {
    const healthy = await rollout(500);
    await healthy.seed('stable', 200, 20, 200);
    await healthy.seed('canary', 200, 20, 200);
    const guard = app.get(RolloutGuard);
    expect(await guard.tick()).not.toContain(healthy.assignment.id);
    expect(
      (await owner.assignment.findUniqueOrThrow({ where: { id: healthy.assignment.id } })).abTest,
    ).toMatchObject([{ weight: 9500 }, { weight: 500 }]);
    const ab = await rollout(0);
    expect((await verdict(ab)).decision.reason).toBe('not-started');
  });
  it('advises traffic by Thompson sampling without changing the assignment, and zeroes a harmful arm', async () => {
    const r = await rollout(5000);
    await r.seed('stable', 200, 60, 200);
    await r.seed('canary', 200, 20, 200);
    const advice = (await r.call('GET', `/v1/assignments/${r.assignment.id}/allocation`)).json<{
      allocation: {
        reason: string;
        arms: { key: string; weight: number; probabilityBest: number }[];
      };
    }>();
    expect(advice.allocation.reason).toBe('ok');
    const canary = advice.allocation.arms.find((a) => a.key === 'canary');
    const stable = advice.allocation.arms.find((a) => a.key === 'stable');
    expect(canary?.weight).toBeGreaterThan(stable?.weight ?? 10_000);
    expect(advice.allocation.arms.reduce((s, a) => s + a.weight, 0)).toBe(10_000);
    const row = await owner.assignment.findUniqueOrThrow({ where: { id: r.assignment.id } });
    expect(row.version).toBe(1);
    const harmful = await rollout(5000);
    await harmful.seed('stable', 200, 20, 200);
    await harmful.seed('canary', 200, 120, 200);
    const guarded = (
      await harmful.call('GET', `/v1/assignments/${harmful.assignment.id}/allocation`)
    ).json<{ allocation: { arms: { key: string; weight: number }[] } }>();
    expect(guarded.allocation.arms.find((a) => a.key === 'canary')?.weight).toBe(0);
  });
  it('is readable with read:Assignment, closed to an inactive user, and 404 for an unknown id', async () => {
    const r = await rollout(500);
    const designer = await app.inject({
      method: 'GET',
      url: `/v1/assignments/${r.assignment.id}/rollout`,
      headers: await r.tenant.auth(r.tenant.designerId),
    });
    expect(designer.statusCode).toBe(200);
    const inactive = await app.inject({
      method: 'GET',
      url: `/v1/assignments/${r.assignment.id}/rollout`,
      headers: await r.tenant.auth(r.tenant.inactiveId),
    });
    expect(inactive.statusCode).toBeGreaterThanOrEqual(401);
    expect(inactive.statusCode).toBeLessThanOrEqual(403);
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/assignments/${randomUUID()}/rollout`,
      headers: await r.tenant.auth(),
    });
    expect(missing.statusCode).toBe(404);
  });
});
