import { z } from 'zod';

import { AttributesSchema } from '../connector.js';
import { parseInteractionEvent, type InteractionEventType } from '../interaction.js';

import { type MarketplaceEnvelope } from './marketplace.js';

const ContactEvent = z.object({
  source: z.literal('aws.connect'),
  'detail-type': z.literal('Amazon Connect Contact Event'),
  id: z.string().min(1),
  time: z.iso.datetime({ offset: true }),
  detail: z.object({
    instanceArn: z.string().min(1),
    contactId: z.string().min(1),
    eventType: z.string(),
    channel: z.string(),
    initiationMethod: z.string(),
    agentInfo: z.object({ agentArn: z.string().min(1) }).optional(),
    queueInfo: z.object({ queueArn: z.string().min(1) }).optional(),
  }),
});
const EVENT_TYPES: Readonly<Record<string, InteractionEventType>> = {
  INITIATED: 'interactionOffered',
  QUEUED: 'interactionOffered',
  CONNECTED_TO_AGENT: 'connected',
  COMPLETED: 'ended',
};
/** EventBridge event or decoded Kinesis record body. Instance is pinned by server configuration. */
export function amazonContactEvent(
  input: unknown,
  instanceArn: string,
  attributes: unknown = {},
): MarketplaceEnvelope | undefined {
  const payload = ContactEvent.parse(input);
  if (payload.detail.instanceArn !== instanceArn) throw new Error('Wrong Amazon Connect instance');
  const detail = payload.detail;
  const channel =
    detail.channel === 'VOICE'
      ? 'voice'
      : detail.channel === 'CHAT'
        ? 'chat'
        : detail.channel === 'EMAIL'
          ? 'email'
          : undefined;
  const type =
    detail.eventType === 'DISCONNECTED'
      ? detail.agentInfo === undefined
        ? 'ended'
        : 'wrapupRequired'
      : EVENT_TYPES[detail.eventType];
  if (channel === undefined || type === undefined) return undefined; // TASK is not an SDK channel.
  const agent = detail.agentInfo?.agentArn.split('/agent/')[1];
  return {
    version: 1,
    platform: 'amazon-connect',
    event: parseInteractionEvent({
      eventId: payload.id,
      type,
      occurredAt: payload.time,
      platformInteractionId: detail.contactId,
      channel,
      direction: ['OUTBOUND', 'API', 'EXTERNAL_OUTBOUND'].includes(detail.initiationMethod)
        ? 'outbound'
        : 'inbound',
      ...(agent === undefined ? {} : { agent: { id: agent } }),
    }),
    variables: AttributesSchema.parse(attributes),
    ...(detail.queueInfo === undefined ? {} : { routingId: detail.queueInfo.queueArn }),
  };
}
