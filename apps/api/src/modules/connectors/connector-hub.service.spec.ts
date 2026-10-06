import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { requestContext, systemContext } from '../../common/context/request-context.js';
import { Keyring } from '../identity/crypto/keyring.js';
import { EnvelopeVault, EnvKeyAdapter } from '../integrations/engine/vault.js';
import { RuntimeCipher } from '../runtime/runtime-cipher.js';

import { ConnectorHubService } from './connector-hub.service.js';

import type { TenantDb } from '../../infra/database/tenant-db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RuntimeInteractionsHandler } from '../runtime/runtime-interactions.handler.js';

async function fixture() {
  const tenantId = randomUUID(),
    id = randomUUID(),
    secretId = randomUUID();
  const vault = new EnvelopeVault(new EnvKeyAdapter(Buffer.alloc(32, 14)));
  const cipher = new RuntimeCipher(
    new Keyring(`synthetic:${Buffer.alloc(32, 13).toString('base64')}`),
  );
  const connector = {
    id,
    adapterType: 'genesys_engage',
    platform: 'genesys',
    version: 1,
    config: { secrets: { authSecret: secretId } } as unknown,
    secretRefs: [secretId],
    health: null as unknown,
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    connector: {
      findFirst: vi.fn().mockResolvedValue(connector),
      findMany: vi.fn().mockResolvedValue([connector]),
      update: vi.fn().mockResolvedValue(connector),
    },
    secret: {
      findFirst: vi.fn().mockResolvedValue({
        keyVersion: 1,
        ciphertext: await vault.encrypt(tenantId, secretId, 1, 'synthetic-connector-secret'),
      }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    interaction: { findFirst: vi.fn().mockResolvedValue(null) },
    campaignExternalMapping: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) },
    outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const interactions = {
    handle: vi.fn<RuntimeInteractionsHandler['handle']>().mockResolvedValue(undefined),
  };
  const service = new ConnectorHubService(
    { current: () => tx, tenantId: () => tenantId } as unknown as TenantDb,
    audit as unknown as AuditService,
    outbox,
    cipher,
    interactions as unknown as RuntimeInteractionsHandler,
    vault,
  );
  const principal = {
    type: 'service' as const,
    id: randomUUID(),
    tenantId,
    scopes: [],
    certificateThumbprint: 'synthetic-cert',
  };
  const run = <T>(work: () => T) =>
    requestContext.run({ ...systemContext(randomUUID(), 'synthetic-hub'), principal }, work);
  return {
    tenantId,
    id,
    secretId,
    connector,
    tx,
    audit,
    outbox,
    interactions,
    service,
    run,
    cipher,
  };
}
const event = {
  eventId: 'synthetic-event',
  type: 'interactionOffered',
  occurredAt: '2026-10-01T10:00:00.000Z',
  platformInteractionId: 'synthetic-conversation',
  channel: 'chat',
  direction: 'inbound',
};
describe('connector hub secret, health and normalized event boundaries', () => {
  it('decrypts only bound credentials under tenant AAD and omits values from audit', async () => {
    const f = await fixture();
    expect(await f.run(() => f.service.resolveSecrets(f.id))).toEqual({
      secrets: { authSecret: 'synthetic-connector-secret' },
    });
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain('synthetic-connector-secret');
    expect(await f.run(() => f.service.listConnectors())).toHaveLength(1);
    expect(f.tx.connector.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { tenantId: f.tenantId, status: 'active', deletedAt: null },
    });
  });
  it.each([
    'missing connector',
    'invalid names',
    'unbound secret',
    'missing secret',
    'empty config',
  ] as const)('handles secret resolution safely: %s', async (reason) => {
    const f = await fixture();
    if (reason === 'missing connector') f.tx.connector.findFirst.mockResolvedValue(null);
    if (reason === 'invalid names')
      f.connector.config = { secrets: { 'invalid name': f.secretId } };
    if (reason === 'unbound secret') f.connector.secretRefs = [];
    if (reason === 'missing secret') f.tx.secret.findFirst.mockResolvedValue(null);
    if (reason === 'empty config') f.connector.config = null;
    const result = f.run(() => f.service.resolveSecrets(f.id));
    if (reason === 'empty config') await expect(result).resolves.toEqual({ secrets: {} });
    else await expect(result).rejects.toThrow();
  });
  it('audits health transitions without duplicating unchanged health status', async () => {
    const f = await fixture();
    await f.run(() => f.service.reportHealth(f.id, { status: 'up' }));
    expect(f.audit.record).toHaveBeenCalledOnce();
    f.connector.health = { status: 'up' };
    await f.run(() => f.service.reportHealth(f.id, { status: 'up', detail: 'synthetic' }));
    expect(f.audit.record).toHaveBeenCalledOnce();
    await f.run(() => f.service.reportHealth(f.id, { status: 'down' }));
    expect(f.audit.record).toHaveBeenCalledTimes(2);
  });
  it('seals normalized chat content before the runtime handler and omits attributes from public events', async () => {
    const f = await fixture();
    const result = await f.run(() =>
      f.service.ingest(f.id, {
        ...event,
        attributes: { privateValue: 'synthetic-private-content' },
      }),
    );
    expect(result).toMatchObject({ agentId: null, status: 'alerting' });
    const handled = f.interactions.handle.mock.calls[0]?.[0];
    if (!handled) throw new Error('No normalized event');
    const sealed = handled.payload['sealed'];
    expect(typeof sealed).toBe('string');
    const normalized = JSON.parse(
      f.cipher.openString(
        sealed as string,
        `runtime:interaction:${f.tenantId}:${result.interactionId}`,
      ),
    ) as Record<string, unknown>;
    expect(normalized['attachedData']).toEqual({ privateValue: 'synthetic-private-content' });
    expect(normalized).not.toHaveProperty('agentId');
    expect(JSON.stringify(f.outbox.record.mock.calls)).not.toContain('synthetic-private-content');
    expect(JSON.stringify(f.audit.record.mock.calls)).not.toContain('synthetic-private-content');
  });
  it.each([true, false])(
    'maps transfers with explicit or fallback platform agents (%s)',
    async (explicit) => {
      const f = await fixture();
      const userId = randomUUID();
      f.tx.user.findMany.mockResolvedValue([
        {
          id: userId,
          email: 'synthetic@example.invalid',
          externalId: 'new-agent',
          ctiIdentities: [],
        },
      ]);
      f.tx.interaction.findFirst.mockResolvedValue({ id: f.id });
      f.tx.campaignExternalMapping.findFirst.mockResolvedValue({ campaignId: randomUUID() });
      const result = await f.run(() =>
        f.service.ingest(f.id, {
          ...event,
          type: 'transferred',
          channel: 'voice',
          agent: { id: 'new-agent', email: 'synthetic@example.invalid' },
          ...(explicit ? { transferTo: { id: 'new-agent' } } : {}),
          campaignRef: { kind: 'campaign', externalId: 'synthetic-campaign' },
          queue: 'synthetic-queue',
          customerId: 'synthetic-customer',
          transferContext: { reason: 'synthetic' },
          context: { channel: 'voice', ani: '+900000000000', dnis: '+900000000001' },
        }),
      );
      expect(result).toMatchObject({ interactionId: f.id, agentId: userId, status: 'transferred' });
    },
  );
  it('rejects malformed platform events before handing them to runtime', async () => {
    const f = await fixture();
    await expect(
      f.run(() => f.service.ingest(f.id, { ...event, attributes: { nested: {} } })),
    ).rejects.toMatchObject({ code: 'VERBIS_VALIDATION_FAILED' });
    expect(f.interactions.handle).not.toHaveBeenCalled();
  });
  it('refuses users and services without a verified certificate before reading connectors', async () => {
    const f = await fixture();
    for (const principal of [
      undefined,
      { type: 'user' as const, id: f.id, tenantId: f.tenantId, scopes: [] },
      { type: 'service' as const, id: f.id, tenantId: f.tenantId, scopes: [] },
    ])
      await expect(
        requestContext.run(
          { ...systemContext(randomUUID(), 'test'), ...(principal ? { principal } : {}) },
          () => f.service.listConnectors(),
        ),
      ).rejects.toThrow('mTLS');
    expect(f.tx.connector.findMany).not.toHaveBeenCalled();
  });
});
