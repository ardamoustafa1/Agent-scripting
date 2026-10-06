import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  parseInteractionEvent,
  STATUS_OF_EVENT,
  toScriptVariables,
  type InteractionEvent,
} from '@verbis/sdk-connector';
import { normalizeCtiPlatform } from '@verbis/shared-types';

import { requestContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-errors.js';
import { actorRef, type Principal } from '../../common/security/principal.js';
import { TenantDb } from '../../infra/database/tenant-db.js';
import { OutboxWriter } from '../../infra/outbox/outbox.writer.js';
import { AuditService } from '../audit/audit.service.js';
import { EnvelopeVault } from '../integrations/engine/vault.js';
import { INTEGRATION_VAULT } from '../integrations/integration-engine.service.js';
import { RuntimeCipher } from '../runtime/runtime-cipher.js';
import { RuntimeInteractionsHandler } from '../runtime/runtime-interactions.handler.js';

import { matchUser, type PlatformUserRef } from './user-mapping.js';

import type { TransactionClient } from '../../infra/database/prisma.service.js';

/** `config.secrets` maps a connector-local name to a Secret id listed in `secret_refs`. */
const SecretNamesSchema = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.uuid());

export interface HubConnectorDto {
  readonly id: string;
  readonly adapterType: string;
  readonly platform: string;
  readonly config: unknown;
  readonly version: number;
}

/**
 * Server side of the connector-hub bridge (ADR-0018). Callers are certificate-bound service
 * clients only (client credentials + mTLS). Platform events arrive here already normalized by the
 * hub's mappers; the API maps the platform user, resolves the campaign, writes the interaction
 * synchronously (so a launch intent can follow immediately) and audits the receipt.
 */
@Injectable()
export class ConnectorHubService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(RuntimeCipher) private readonly cipher: RuntimeCipher,
    @Inject(RuntimeInteractionsHandler) private readonly interactions: RuntimeInteractionsHandler,
    @Inject(INTEGRATION_VAULT) private readonly vault: EnvelopeVault,
  ) {}

  async listConnectors(): Promise<HubConnectorDto[]> {
    this.hubPrincipal();
    const rows = await this.db.current().connector.findMany({
      where: { tenantId: this.db.tenantId(), deletedAt: null, status: 'active' },
      orderBy: { id: 'asc' },
      select: { id: true, adapterType: true, platform: true, config: true, version: true },
      take: 500,
    });
    return rows;
  }

  async resolveSecrets(connectorId: string): Promise<{ secrets: Record<string, string> }> {
    this.hubPrincipal();
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const connector = await this.activeConnector(tx, connectorId);
    const names = SecretNamesSchema.safeParse(
      (connector.config as { secrets?: unknown } | null)?.secrets ?? {},
    );
    if (!names.success)
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'config.secrets is invalid');
    const secrets: Record<string, string> = {};
    for (const [name, ref] of Object.entries(names.data)) {
      if (!connector.secretRefs.includes(ref))
        throw new ForbiddenError('Secret is not bound to this connector');
      const row = await tx.secret.findFirst({
        where: { id: ref, tenantId, deletedAt: null },
        select: { id: true, ciphertext: true, keyVersion: true },
      });
      if (row === null) throw new NotFoundError('Secret');
      secrets[name] = await this.vault.decrypt(tenantId, ref, row.keyVersion, row.ciphertext);
    }
    // Secret metadata read is audited (CLAUDE.md §6); values never are.
    await this.audit.record(tx, {
      action: 'connector.secret.read',
      target: { type: 'Connector', id: connectorId },
      metadata: { names: Object.keys(secrets).sort(), count: Object.keys(secrets).length },
    });
    return { secrets };
  }

  async reportHealth(
    connectorId: string,
    input: { status: 'up' | 'degraded' | 'down'; detail?: string | undefined },
  ) {
    const principal = this.hubPrincipal();
    const tx = this.db.current();
    const connector = await this.activeConnector(tx, connectorId);
    const previous = (connector.health as { status?: string } | null)?.status;
    await tx.connector.update({
      where: { id: connectorId, tenantId: this.db.tenantId() },
      data: {
        health: {
          status: input.status,
          detail: input.detail ?? null,
          reportedAt: new Date().toISOString(),
        },
        updatedBy: actorRef(principal),
      },
    });
    if (previous !== input.status)
      await this.audit.record(tx, {
        action: 'connector.health.changed',
        target: { type: 'Connector', id: connectorId },
        before: { status: previous ?? null },
        after: { status: input.status },
      });
  }

  async ingest(
    connectorId: string,
    raw: unknown,
  ): Promise<{ interactionId: string; agentId: string | null; status: string }> {
    const principal = this.hubPrincipal();
    const tx = this.db.current();
    const tenantId = this.db.tenantId();
    const connector = await this.activeConnector(tx, connectorId);
    let event: InteractionEvent;
    try {
      event = parseInteractionEvent(raw);
    } catch {
      throw new DomainError('VERBIS_VALIDATION_FAILED', 'Interaction event is invalid');
    }
    const platform = connector.adapterType;
    const assignee = event.type === 'transferred' ? (event.transferTo ?? event.agent) : event.agent;
    const agentId =
      assignee === undefined ? undefined : await this.mapUser(tx, tenantId, platform, assignee);
    const campaignId =
      event.campaignRef === undefined
        ? undefined
        : (
            await tx.campaignExternalMapping.findFirst({
              where: {
                tenantId,
                platform: platform.replaceAll('_', '-'),
                kind: event.campaignRef.kind,
                externalId: event.campaignRef.externalId,
                deletedAt: null,
              },
              select: { campaignId: true },
            })
          )?.campaignId;
    const existing = await tx.interaction.findFirst({
      where: { tenantId, connectorId, externalId: event.platformInteractionId },
      select: { id: true },
    });
    const interactionId = existing?.id ?? uuidv7();
    const voice = event.context?.channel === 'voice' ? event.context : undefined;
    const attachedData: Record<string, unknown> = {
      ...event.attributes,
      ...(event.context === undefined ? {} : toScriptVariables(event.context)),
      ...Object.fromEntries(
        Object.entries(event.transferContext ?? {}).map(([k, v]) => [`transfer.${k}`, v]),
      ),
    };
    const normalized = {
      id: interactionId,
      platform,
      platformInteractionId: event.platformInteractionId,
      connectorId,
      channel: event.channel,
      direction: event.direction,
      ...(voice?.ani === undefined ? {} : { ani: voice.ani }),
      ...(voice?.dnis === undefined ? {} : { dnis: voice.dnis }),
      ...(event.customerId === undefined ? {} : { customerId: event.customerId }),
      ...(event.queue === undefined ? {} : { queue: event.queue }),
      ...(campaignId === undefined ? {} : { campaignId }),
      attachedData,
      participantData: [],
      status: STATUS_OF_EVENT[event.type],
      ...(agentId === undefined ? {} : { agentId, platformAgentId: assignee?.id }),
    };
    const aad = `runtime:interaction:${tenantId}:${interactionId}`;
    // A platform clock ahead of ours must not freeze the stale-event watermark in the future.
    const occurredAt = new Date(Math.min(Date.parse(event.occurredAt), Date.now())).toISOString();
    // Same code path as the event consumer: one normalization/authorization rule set.
    await this.interactions.handle(
      {
        id: randomUUID(),
        type: 'verbis.interaction.contact.changed.v1',
        tenantId,
        aggregate: { type: 'Interaction', id: interactionId },
        occurredAt,
        correlationId: requestContext.require().correlationId,
        actor: actorRef(principal),
        payload: {
          interactionId,
          connectorId,
          sealed: this.cipher.seal(JSON.stringify(normalized), aad),
        },
      },
      tx,
    );
    await this.outbox.record(tx, {
      type: 'verbis.interaction.contact.received.v1',
      aggregateType: 'Interaction',
      aggregateId: interactionId,
      payload: {
        interactionId,
        connectorId,
        event: event.type,
        channel: event.channel,
        status: normalized.status,
        agentMapped: agentId !== undefined,
      },
    });
    await this.audit.record(tx, {
      action: 'connector.event.received',
      target: { type: 'Interaction', id: interactionId },
      interactionId,
      metadata: {
        connectorId,
        eventId: event.eventId,
        event: event.type,
        channel: event.channel,
        agentMapped: agentId !== undefined,
        campaignMapped: campaignId !== undefined,
      },
    });
    return { interactionId, agentId: agentId ?? null, status: normalized.status };
  }

  /** Platform user → Verbis user (cti identity → externalId → email; ambiguous ⇒ nobody). */
  async mapUser(
    tx: TransactionClient,
    tenantId: string,
    platform: string,
    ref: PlatformUserRef,
  ): Promise<string | undefined> {
    const normalized = normalizeCtiPlatform(platform);
    const mapped = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE tenant_id=${tenantId}::uuid AND status='active' AND deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cti_identities)='array' THEN cti_identities ELSE '[]'::jsonb END) AS identity
        WHERE regexp_replace(lower(btrim(identity->>'platform')), '[[:space:]_-]+', '-', 'g')=${normalized}
        AND COALESCE(identity->>'id', identity->>'platformUserId')=${ref.id})`;
    const users = await tx.user.findMany({
      where: {
        tenantId,
        status: 'active',
        deletedAt: null,
        OR: [
          {
            id: { in: mapped.map((user) => user.id) },
          },
          { externalId: ref.id },
          ...(ref.email === undefined
            ? []
            : [{ email: { equals: ref.email, mode: 'insensitive' as const } }]),
        ],
      },
      select: { id: true, email: true, externalId: true, ctiIdentities: true },
    });
    return matchUser(users, platform, ref);
  }

  private async activeConnector(tx: TransactionClient, connectorId: string) {
    const connector = await tx.connector.findFirst({
      where: { id: connectorId, tenantId: this.db.tenantId(), deletedAt: null, status: 'active' },
    });
    if (connector === null) throw new NotFoundError('Connector');
    return connector;
  }

  /** The hub is a certificate-bound service client; users and bearer-only services are refused. */
  private hubPrincipal(): Principal {
    const principal = requestContext.require().principal;
    if (principal?.type !== 'service' || principal.certificateThumbprint === undefined)
      throw new ForbiddenError('Only the mTLS-authenticated connector hub may call this');
    return principal;
  }
}
