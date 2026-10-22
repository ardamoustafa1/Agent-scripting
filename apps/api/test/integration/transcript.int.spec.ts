import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { surveyScript } from '@verbis/script-schema/fixtures';

import { requestContext } from '../../src/common/context/request-context.js';
import { uuidv7 } from '../../src/common/crypto/uuid.js';
import { TenantDb } from '../../src/infra/database/tenant-db.js';
import { RedisService } from '../../src/infra/redis/redis.service.js';
import { AgentDesktopController } from '../../src/modules/runtime/agent-desktop.controller.js';
import { RuntimeEngineService } from '../../src/modules/runtime/runtime-engine.service.js';
import { TranscriptService } from '../../src/modules/runtime/transcript.service.js';
import { createTokenKit, type TokenKit } from '../support/tokens.js';

import { createTenant, integrationEnv, ownerPrisma, startApp, uniqueSlug } from './helpers.js';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

// ADR-0052: live transcript → sealed Redis window → trigger hit → prompt, on PostgreSQL + Redis.
let owner: PrismaClient, app: NestFastifyApplication, kit: TokenKit;
beforeAll(async () => {
  kit = await createTokenKit();
  owner = ownerPrisma();
  app = await startApp(integrationEnv(kit.jwks));
});
afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

const SPOKEN = 'Aboneliğimi iptal etmek istiyorum';

async function fixture(enabled: boolean) {
  const tenant = await createTenant(owner, kit, uniqueSlug('transcript'), {
    liveTranscript: { enabled },
  });
  const headers = { 'content-type': 'application/json', ...(await tenant.auth()) };
  const firstPage = surveyScript.pages[0]?.id ?? '';
  const script = (
    await app.inject({
      method: 'POST',
      url: '/v1/scripts',
      headers,
      payload: { name: 'Transcript fixture' },
    })
  ).json<{ id: string }>();
  const created = await app.inject({
    method: 'POST',
    url: `/v1/scripts/${script.id}/versions`,
    headers,
    payload: {
      document: {
        ...surveyScript,
        i18n: {
          ...surveyScript.i18n,
          messages: Object.fromEntries(
            Object.entries(surveyScript.i18n.messages).map(([locale, messages]) => [
              locale,
              { ...messages, 'triggers.cancel.alert1': 'Önce sadakat indirimini önerin.' },
            ]),
          ),
        },
        triggers: [
          {
            id: 'cancel-intent',
            name: 'Cancel intent',
            phrases: { tr: ['iptal etmek'] },
            actions: [
              { type: 'alert', messageKey: 'triggers.cancel.alert1', tone: 'warning' },
              { type: 'suggestPage', pageId: firstPage },
            ],
          },
        ],
      },
    },
  });
  expect(created.statusCode).toBe(201);
  const version = created.json<{ id: string; checksum: string }>();
  const interaction = await owner.interaction.create({
    data: {
      tenantId: tenant.tenantId,
      externalId: `conv-${uuidv7()}`,
      channelType: 'voice',
      direction: 'inbound',
      status: 'connected',
      agentId: tenant.adminId,
      startedAt: new Date(),
      createdBy: 'fixture',
      updatedBy: 'fixture',
    },
  });
  const session = await owner.session.create({
    data: {
      kind: 'preview',
      tenantId: tenant.tenantId,
      userId: tenant.adminId,
      scriptVersionId: version.id,
      checksum: version.checksum,
      createdBy: 'fixture',
      updatedBy: 'fixture',
    },
  });
  const bffId = uuidv7(),
    tabId = uuidv7(),
    engine = app.get(RuntimeEngineService);
  const run = <T>(fn: () => Promise<T>) =>
    requestContext.run(
      {
        requestId: uuidv7(),
        correlationId: uuidv7(),
        ip: '',
        userAgent: 'fixture',
        principal: {
          type: 'user',
          authMethod: 'sso',
          tenantId: tenant.tenantId,
          id: tenant.adminId,
          sessionId: bffId,
          scopes: [],
        },
        authz: {
          ability: createAbility([{ action: 'manage', subject: 'all' }]),
          rules: [{ action: 'manage', subject: 'all' }],
          roles: ['tenant_admin'],
          separationOfDuties: true,
        },
      },
      () =>
        app.get(TenantDb).run(tenant.tenantId, async (tx) => {
          requestContext.require().tx = tx;
          return fn();
        }),
    );
  await run(() => engine.initialize(session.id));
  const lease = await run(() => engine.attach(session.id, { tabId }));
  if (lease.writeToken === undefined) throw new Error('Fixture lease missing');
  const claim = { tabId, writeToken: lease.writeToken };
  await run(() =>
    engine.command(session.id, {
      ...claim,
      expectedSequence: 1,
      command: { type: 'transition', state: 'active' },
    }),
  );
  await owner.session.update({
    where: { id: session.id },
    data: { kind: 'interaction', interactionId: interaction.id },
  });
  const receive = (segmentId: string, text = SPOKEN, final = true) =>
    run(() =>
      app.get(TranscriptService).receive(
        { id: interaction.id, status: 'connected', connectorId: uuidv7() },
        {
          segmentId,
          platformInteractionId: interaction.externalId,
          speaker: 'customer',
          text,
          final,
          occurredAt: new Date().toISOString(),
        },
      ),
    );
  return { tenant, session, interaction, run, claim, receive, engine };
}

describe('live transcript on PostgreSQL and Redis (ADR-0052)', () => {
  it('turns a spoken phrase into one prompt without the text reaching the database', async () => {
    const f = await fixture(true);
    expect(await f.receive('utt-1')).toEqual({ accepted: true });
    expect(await f.receive('utt-1')).toEqual({ accepted: true });
    expect(await f.receive('utt-2', 'iptal etmek için aradım')).toEqual({ accepted: true });

    const events = await owner.sessionEvent.findMany({
      where: { sessionId: f.session.id, type: 'transcript.triggered' },
    });
    expect(events.map((event) => event.payload)).toEqual([
      { triggerIds: ['cancel-intent'], speaker: 'customer', segmentId: 'utt-1' },
    ]);
    expect(
      await owner.auditEvent.count({
        where: { tenantId: f.tenant.tenantId, action: 'runtime.transcript.started' },
      }),
    ).toBe(1);

    const desktop = await f.run(() => app.get(AgentDesktopController).desktop(f.session.id));
    expect(desktop.transcript).toEqual({ enabled: true });
    expect(desktop.prompts).toEqual([
      expect.objectContaining({ triggerId: 'cancel-intent', segmentId: 'utt-1' }),
    ]);
    const window = await f.run(() => app.get(AgentDesktopController).transcript(f.session.id));
    expect(window.lines.map((line) => [line.segmentId, line.text])).toEqual([
      ['utt-1', SPOKEN],
      ['utt-2', 'iptal etmek için aradım'],
    ]);

    // Redis holds sealed lines only; SQL never holds the text.
    // ioredis does not prefix a KEYS pattern but does prefix the keys of other commands.
    const redis = app.get(RedisService).client;
    const prefix = redis.options.keyPrefix ?? '';
    const keys = await redis.keys(`${prefix}runtime:transcript:${f.tenant.tenantId}:*`);
    expect(keys.length).toBeGreaterThan(0);
    const raw = (
      await Promise.all(
        keys
          .filter((k) => k.endsWith(':lines'))
          .map((k) => redis.lrange(k.slice(prefix.length), 0, -1)),
      )
    )
      .flat()
      .join('');
    expect(raw).not.toContain('iptal');
    const sql = JSON.stringify(
      [
        await owner.sessionEvent.findMany({ where: { sessionId: f.session.id } }),
        await owner.auditEvent.findMany({ where: { tenantId: f.tenant.tenantId } }),
        await owner.outboxEvent.findMany({ where: { tenantId: f.tenant.tenantId } }),
      ],
      (_, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    );
    expect(sql).not.toContain('iptal');
    expect(sql).not.toContain('Aboneliğimi');

    const sequence = (await owner.session.findUniqueOrThrow({ where: { id: f.session.id } }))
      .sequence;
    await f.run(() =>
      app.get(AgentDesktopController).resolvePrompt(f.session.id, 'cancel-intent', {
        ...f.claim,
        expectedSequence: sequence,
        resolution: 'dismissed',
      }),
    );
    expect(
      (await f.run(() => app.get(AgentDesktopController).desktop(f.session.id))).prompts,
    ).toEqual([]);
    expect(
      await owner.auditEvent.count({
        where: { tenantId: f.tenant.tenantId, action: 'runtime.session.promptresolved' },
      }),
    ).toBe(1);
  });

  it('discards everything for a tenant that has not opted in', async () => {
    const f = await fixture(false);
    expect(await f.receive('utt-1')).toEqual({ accepted: false });
    expect(
      await owner.sessionEvent.count({
        where: { sessionId: f.session.id, type: 'transcript.triggered' },
      }),
    ).toBe(0);
    const redis = app.get(RedisService).client;
    const prefix = redis.options.keyPrefix ?? '';
    expect(await redis.keys(`${prefix}runtime:transcript:${f.tenant.tenantId}:*`)).toEqual([]);
    const desktop = await f.run(() => app.get(AgentDesktopController).desktop(f.session.id));
    expect(desktop).toMatchObject({ transcript: { enabled: false }, prompts: [] });
  });
});
