import { defineMapper, type ChannelType, type InteractionEventInput } from '@verbis/sdk-connector';

import { EngageEnvelopeSchema, type EngageAgent, type EngageEnvelope } from './envelope.js';

import type { AttachedDataMapping, GenesysEngageConfig } from './config.js';

type Scalar = string | number | boolean | null;

export function channelOf(media: EngageEnvelope['mediaType']): ChannelType {
  switch (media) {
    case 'voice':
      return 'voice';
    case 'email':
      return 'email';
    case 'sms':
      return 'sms';
    case 'whatsapp':
      return 'whatsapp';
    case 'facebook':
    case 'twitter':
      return 'social';
    default:
      return 'chat';
  }
}

/** The configured identity of an Engage agent (employee id by default), or undefined. */
export function agentKey(
  agent: EngageAgent | undefined,
  identity: GenesysEngageConfig['agentIdentity'],
): string | undefined {
  const value = agent?.[identity];
  return value === undefined || value === '' ? undefined : value.slice(0, 256);
}

function coerce(value: Scalar, type: AttachedDataMapping['type']): Scalar {
  if (value === null) return null;
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean')
    return typeof value === 'boolean'
      ? value
      : ['true', '1', 'yes', 'y'].includes(String(value).toLowerCase());
  return String(value).slice(0, 1_000);
}

const OUTBOUND_KEY = /[^A-Za-z0-9_.-]/g;

/**
 * Attached data → event attributes. Only *mapped* keys become variables (data minimisation),
 * plus the configured OCS record fields as `outbound.<field>` and a few Genesys facts.
 */
export function attributesOf(
  envelope: EngageEnvelope,
  config: GenesysEngageConfig,
): Record<string, Scalar> {
  const out: Record<string, Scalar> = {
    'engage.mediaType': envelope.mediaType,
    'engage.callType': envelope.callType,
  };
  for (const mapping of config.attachedData) {
    const value = envelope.userData[mapping.key];
    if (value !== undefined) out[mapping.variable] = coerce(value, mapping.type);
  }
  for (const field of config.outbound.fields) {
    const value = envelope.userData[field];
    if (value !== undefined)
      out[`outbound.${field.replace(OUTBOUND_KEY, '_')}`.slice(0, 64)] =
        typeof value === 'string' ? value.slice(0, 1_000) : value;
  }
  return out;
}

/** OCS record handle of an outbound interaction (needed for call-result feedback). */
export function recordHandleOf(envelope: Pick<EngageEnvelope, 'userData'>): number | undefined {
  const raw = envelope.userData['GSW_RECORD_HANDLE'];
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d{1,12}$/.test(raw)
        ? Number(raw)
        : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function contextOf(
  envelope: EngageEnvelope,
  channel: ChannelType,
): InteractionEventInput['context'] {
  switch (channel) {
    case 'voice':
      return {
        channel,
        ...(envelope.ani === undefined ? {} : { ani: envelope.ani }),
        ...(envelope.dnis === undefined ? {} : { dnis: envelope.dnis }),
      };
    case 'email':
      return envelope.email === undefined
        ? undefined
        : {
            channel,
            from: envelope.email.from,
            to: envelope.email.to,
            subject: envelope.email.subject,
            body: envelope.email.body,
          };
    case 'chat':
      return {
        channel,
        transcript: envelope.chat?.messages ?? [],
        ...(envelope.chat?.customerName === undefined
          ? {}
          : { customerName: envelope.chat.customerName }),
      };
    case 'sms':
    case 'whatsapp':
      return {
        channel,
        from: (envelope.ani ?? '').slice(0, 64),
        messages: envelope.chat?.messages ?? [],
      };
    default:
      return undefined;
  }
}

const TYPE: Readonly<Record<EngageEnvelope['event'], InteractionEventInput['type'] | null>> = {
  ringing: 'interactionOffered',
  dialing: 'interactionOffered',
  established: 'connected',
  held: 'held',
  retrieved: 'resumed',
  partyChanged: 'transferred',
  released: 'ended', // or wrapupRequired, see below
  markedDone: 'ended',
  abandoned: 'ended',
  attachedDataChanged: null,
};

/** Envelope → normalized event. `attachedDataChanged` carries no lifecycle change (ignored). */
export function createEngageMapper(config: () => GenesysEngageConfig) {
  return defineMapper({
    name: 'genesys-engage',
    payloadSchema: EngageEnvelopeSchema,
    map(envelope) {
      const cfg = config();
      let type = TYPE[envelope.event];
      if (type === null) return null;
      if (envelope.event === 'released' && cfg.disposition.requireAfterCall)
        type = 'wrapupRequired';
      const channel = channelOf(envelope.mediaType);
      const agentId = agentKey(envelope.agent, cfg.agentIdentity);
      const transferId = agentKey(envelope.transferTo, cfg.agentIdentity);
      const campaign = envelope.userData['GSW_CAMPAIGN_NAME'];
      const context = contextOf(envelope, channel);
      return {
        eventId: envelope.eventId,
        type,
        occurredAt: envelope.occurredAt,
        platformInteractionId: envelope.interactionId,
        channel,
        direction:
          envelope.callType === 'Outbound' || envelope.event === 'dialing' ? 'outbound' : 'inbound',
        ...(agentId === undefined ? {} : { agent: { id: agentId } }),
        ...(type === 'transferred' && transferId !== undefined
          ? { transferTo: { id: transferId } }
          : {}),
        ...(envelope.queue === undefined ? {} : { queue: envelope.queue }),
        ...(typeof campaign === 'string' && campaign !== ''
          ? { campaignRef: { kind: 'campaign', externalId: campaign.slice(0, 256) } }
          : envelope.queue === undefined
            ? {}
            : { campaignRef: { kind: 'queue', externalId: envelope.queue } }),
        attributes: attributesOf(envelope, cfg),
        ...(context === undefined ? {} : { context }),
        ...(type === 'wrapupRequired' ? { wrapUp: { required: true } } : {}),
      };
    },
  });
}
