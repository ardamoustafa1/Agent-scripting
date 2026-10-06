import { z } from 'zod';

import { defineMapper, type ChannelType, type InteractionEventInput } from '@verbis/sdk-connector';

import type { AxpConfig } from './config.js';

/**
 * AXP `AGENT_ENGAGEMENT` notifications → events (docs/connectors/avaya.md §AXP). Top level carries
 * the agent (`loginId`, `destinationLoginId`), `body.event` discriminates, `body.action` refines
 * `AgentParticipant`. The engagement id is the Workspaces interaction id the widget sees.
 */
const Str = (max: number) => z.string().max(max);
const Id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:@-]+$/);

export const AxpNotificationSchema = z.looseObject({
  family: Str(64).optional(),
  accountId: Str(64).optional(),
  sentAt: Str(64).optional(),
  correlationId: Str(128).optional(),
  loginId: Str(256).optional(),
  destinationLoginId: Str(256).optional(),
  body: z.looseObject({
    event: Str(64),
    action: Str(32).optional(),
    id: Str(128).optional(),
    agentId: Str(128).optional(),
    engagementId: Id.optional(),
    channelId: Str(64).optional(),
    state: Str(64).optional(),
    reasonCode: Str(128).optional(),
    timestamp: Str(64).optional(),
    queueId: Str(128).optional(),
    campaignId: Str(128).optional(),
    customerIdentifier: Str(256).optional(),
    direction: Str(16).optional(),
    customData: z
      .record(Str(64), z.union([Str(1_000), z.number(), z.boolean(), z.null()]))
      .optional(),
  }),
});
export type AxpNotification = z.infer<typeof AxpNotificationSchema>;

export function channelOf(channelId: string | undefined): ChannelType {
  const c = (channelId ?? '').toLowerCase();
  if (c.includes('voice') || c === 'call') return 'voice';
  if (c.includes('email')) return 'email';
  if (c.includes('sms')) return 'sms';
  if (c.includes('whatsapp')) return 'whatsapp';
  if (
    c.includes('facebook') ||
    c.includes('instagram') ||
    c.includes('twitter') ||
    c.includes('social')
  )
    return 'social';
  return 'chat';
}

function typeOf(n: AxpNotification, config: AxpConfig): InteractionEventInput['type'] | null {
  const { event, action } = n.body;
  switch (event) {
    case 'MatchOffered':
      return 'interactionOffered';
    case 'AgentParticipant':
      switch (action) {
        case 'INVITED':
          return 'interactionOffered';
        case 'ADDED':
          return 'connected';
        case 'HELD':
          return 'held';
        case 'UNHELD':
          return 'resumed';
        case 'REMOVED':
          return config.afterContactWork ? 'wrapupRequired' : 'ended';
        default:
          return null; // MOVED, OBSERVING, COACHING, BARGEDIN: supervisor actions
      }
    case 'SingleStepTransfer':
      return 'transferred';
    case 'AfterContactWorkActivated':
      return 'wrapupRequired';
    case 'AfterContactWorkCompleted':
      return 'ended';
    default:
      return null; // AgentState, Automation/ExternalParticipant, *EngagementCreated, ChannelReady …
  }
}

export function agentOf(n: AxpNotification, config: AxpConfig): string | undefined {
  const value = config.agentIdentity === 'loginId' ? n.loginId : n.body.agentId;
  return value === undefined || value === '' ? undefined : value;
}

export function createAxpMapper(config: () => AxpConfig, now: () => Date) {
  return defineMapper({
    name: 'avaya-axp',
    payloadSchema: AxpNotificationSchema,
    map(n) {
      const cfg = config();
      const type = typeOf(n, cfg);
      const engagementId = n.body.engagementId;
      if (type === null || engagementId === undefined) return null;
      const channel = channelOf(n.body.channelId);
      const agent = agentOf(n, cfg);
      const at = n.body.timestamp ?? n.sentAt;
      const occurredAt =
        at !== undefined && !Number.isNaN(Date.parse(at))
          ? new Date(at).toISOString()
          : now().toISOString();
      const discriminator = n.body.id ?? `${n.body.event}.${n.body.action ?? ''}.${at ?? ''}`;
      const attributes: Record<string, string | number | boolean | null> = {
        'axp.channelId': n.body.channelId ?? null,
        ...(n.body.customerIdentifier === undefined
          ? {}
          : { 'axp.customerIdentifier': n.body.customerIdentifier }),
        ...Object.fromEntries(
          Object.entries(n.body.customData ?? {})
            .slice(0, 100)
            .map(([k, v]) => [`axp.${k.replace(/[^A-Za-z0-9_.-]/g, '_')}`.slice(0, 64), v]),
        ),
      };
      return {
        eventId: `axp:${engagementId}:${discriminator}`
          .replace(/[^A-Za-z0-9._:-]/g, '_')
          .slice(0, 256),
        type,
        occurredAt,
        platformInteractionId: engagementId,
        channel,
        direction:
          n.body.direction?.toLowerCase() === 'outbound' || n.body.campaignId !== undefined
            ? 'outbound'
            : 'inbound',
        ...(agent === undefined ? {} : { agent: { id: agent } }),
        ...(type === 'transferred' && n.destinationLoginId !== undefined
          ? { transferTo: { id: n.destinationLoginId } }
          : {}),
        ...(n.body.queueId === undefined ? {} : { queue: n.body.queueId }),
        ...(n.body.campaignId !== undefined
          ? { campaignRef: { kind: 'campaign', externalId: n.body.campaignId } }
          : n.body.queueId !== undefined
            ? { campaignRef: { kind: 'queue', externalId: n.body.queueId } }
            : {}),
        attributes,
        ...(type === 'wrapupRequired' ? { wrapUp: { required: true } } : {}),
      };
    },
  });
}
