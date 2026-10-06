import { defineMapper, type ChannelType, type InteractionEventInput } from '@verbis/sdk-connector';

import { AvayaEnvelopeSchema, type AvayaAgent, type AvayaEnvelope } from './envelope.js';
import { decodeUui } from './uui.js';

import type { AvayaSidecarConfig } from './config.js';

export function channelOf(media: AvayaEnvelope['mediaType']): ChannelType {
  switch (media) {
    case 'voice':
    case 'voicemail':
      return 'voice';
    case 'email':
    case 'fax':
    case 'scanned':
      return 'email';
    case 'sms':
      return 'sms';
    case 'social':
      return 'social';
    default:
      return 'chat';
  }
}

export function agentKey(
  agent: AvayaAgent | undefined,
  identity: AvayaSidecarConfig['agentIdentity'],
): string | undefined {
  const value = agent?.[identity];
  return value === undefined || value === '' ? undefined : value;
}

const TYPE: Readonly<Record<AvayaEnvelope['event'], InteractionEventInput['type'] | null>> = {
  delivered: 'interactionOffered',
  established: 'connected',
  held: 'held',
  retrieved: 'resumed',
  transferred: 'transferred',
  conferenced: null,
  cleared: 'ended',
  acwCompleted: 'ended',
  closed: 'ended',
  dataChanged: null,
};

export function attributesOf(
  envelope: AvayaEnvelope,
  config: AvayaSidecarConfig,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {
    'avaya.mediaType': envelope.mediaType,
    ...(envelope.ucid === undefined ? {} : { 'avaya.ucid': envelope.ucid }),
    ...(envelope.vdn === undefined ? {} : { 'avaya.vdn': envelope.vdn }),
    ...(envelope.skill === undefined ? {} : { 'avaya.skill': envelope.skill }),
    ...decodeUui(envelope.uui, envelope.uuiEncoding, config.uui),
  };
  for (const key of config.intrinsics) {
    const value = envelope.intrinsics[key];
    if (value !== undefined)
      out[`intrinsic.${key.replace(/[^A-Za-z0-9_.-]/g, '_')}`.slice(0, 64)] = value;
  }
  if (envelope.outbound !== undefined) {
    out['outbound.system'] = envelope.outbound.system;
    out['outbound.campaign'] = envelope.outbound.campaign;
    out['outbound.recordId'] = envelope.outbound.recordId;
    if (envelope.outbound.list !== undefined) out['outbound.list'] = envelope.outbound.list;
    for (const [field, value] of Object.entries(envelope.outbound.fields))
      if (config.outbound.fields.length === 0 || config.outbound.fields.includes(field))
        out[`outbound.${field.replace(/[^A-Za-z0-9_.-]/g, '_')}`.slice(0, 64)] = value;
  }
  return out;
}

function contextOf(
  envelope: AvayaEnvelope,
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
      return envelope.email === undefined ? undefined : { channel, ...envelope.email };
    case 'chat':
      return {
        channel,
        transcript: envelope.chat?.messages ?? [],
        ...(envelope.chat?.customerName === undefined
          ? {}
          : { customerName: envelope.chat.customerName }),
      };
    case 'sms':
      return {
        channel,
        from: (envelope.ani ?? '').slice(0, 64),
        messages: envelope.chat?.messages ?? [],
      };
    default:
      return undefined;
  }
}

/** Envelope → event. Routing: outbound campaign › VDN › skill (campaign external mappings). */
export function createAvayaMapper(config: () => AvayaSidecarConfig) {
  return defineMapper({
    name: 'avaya-sidecar',
    payloadSchema: AvayaEnvelopeSchema,
    map(envelope) {
      const cfg = config();
      let type = TYPE[envelope.event];
      if (type === null) return null;
      if (envelope.event === 'cleared' && envelope.afterCallWork) type = 'wrapupRequired';
      const channel = channelOf(envelope.mediaType);
      const agentId = agentKey(envelope.agent, cfg.agentIdentity);
      const transferId = agentKey(envelope.transferTo, cfg.agentIdentity);
      const context = contextOf(envelope, channel);
      const campaignRef =
        envelope.outbound !== undefined
          ? { kind: 'campaign', externalId: envelope.outbound.campaign }
          : envelope.vdn !== undefined
            ? { kind: 'vdn', externalId: envelope.vdn }
            : envelope.skill !== undefined
              ? {
                  kind: envelope.source === 'aacc' ? 'skillset' : 'skill',
                  externalId: envelope.skill,
                }
              : undefined;
      return {
        eventId: envelope.eventId,
        type,
        occurredAt: envelope.occurredAt,
        platformInteractionId: envelope.interactionId,
        channel,
        direction: envelope.outbound !== undefined ? 'outbound' : envelope.direction,
        ...(agentId === undefined ? {} : { agent: { id: agentId } }),
        ...(type === 'transferred' && transferId !== undefined
          ? { transferTo: { id: transferId } }
          : {}),
        ...(envelope.skill === undefined ? {} : { queue: envelope.skill }),
        ...(campaignRef === undefined ? {} : { campaignRef }),
        attributes: attributesOf(envelope, cfg),
        ...(context === undefined ? {} : { context }),
        ...(type === 'wrapupRequired' ? { wrapUp: { required: true } } : {}),
      };
    },
  });
}
