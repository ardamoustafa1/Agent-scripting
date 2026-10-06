import { z } from 'zod';

import { defineMapper, type ChannelType, type InteractionEventInput } from '@verbis/sdk-connector';

/**
 * Genesys Cloud conversation → normalized events. The same shape arrives from the Notifications
 * API (`v2.users.{id}.conversations`, `v2.routing.queues.{id}.conversations`: full snapshot in
 * `eventBody`) and from `GET /api/v2/conversations/{id}` (resync), so one schema covers both.
 * Unknown fields are ignored (loose objects); every value we use is bounded.
 */
const Id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:@-]+$/);
const Str = (max: number) => z.string().max(max);
const When = z.string().max(64);

const Address = z.looseObject({
  addressNormalized: Str(320).optional(),
  addressRaw: Str(320).optional(),
  name: Str(256).optional(),
});

const Communication = z.looseObject({
  id: Id,
  state: Str(32).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  held: z.boolean().optional(),
  startHoldTime: When.optional(),
  connectedTime: When.optional(),
  disconnectedTime: When.optional(),
  disconnectType: Str(64).optional(),
  recordingState: Str(32).optional(),
  securePause: z.boolean().optional(),
  self: Address.optional(),
  other: Address.optional(),
  /** emails */
  subject: Str(1_000).optional(),
  /** messages: sms | whatsapp | webmessaging | open | facebook | instagram | twitter | line | apple … */
  type: Str(32).optional(),
  /** callbacks */
  callbackNumbers: z.array(Str(64)).max(10).optional(),
  callbackScheduledTime: When.optional(),
  callbackUserName: Str(256).optional(),
});
export type GenesysCommunication = z.infer<typeof Communication>;

const MEDIA = ['calls', 'callbacks', 'chats', 'emails', 'messages'] as const;
export type GenesysMediaType = (typeof MEDIA)[number];

const Participant = z.looseObject({
  id: Id,
  purpose: Str(32).optional(),
  userId: Id.optional(),
  queueId: Id.optional(),
  name: Str(256).optional(),
  address: Str(320).optional(),
  ani: Str(320).optional(),
  dnis: Str(320).optional(),
  endTime: When.optional(),
  wrapupRequired: z.boolean().optional(),
  wrapupTimeoutMs: z.number().int().nonnegative().optional(),
  wrapup: z.looseObject({ code: Str(256).optional() }).nullish(),
  attributes: z.record(Str(256), z.unknown()).optional(),
  calls: z.array(Communication).max(50).optional(),
  callbacks: z.array(Communication).max(50).optional(),
  chats: z.array(Communication).max(50).optional(),
  emails: z.array(Communication).max(50).optional(),
  messages: z.array(Communication).max(50).optional(),
});
export type GenesysParticipant = z.infer<typeof Participant>;

export const ConversationSchema = z.looseObject({
  id: Id,
  participants: z.array(Participant).max(200),
});
export type GenesysConversation = z.infer<typeof ConversationSchema>;

const CONVERSATION_TOPIC = /^v2\.(users|routing\.queues)\.[A-Za-z0-9-]{1,64}\.conversations$/;

/**
 * A notification frame. Conversation topics (and `resync`, used for snapshots fetched with GET)
 * must carry a valid conversation; any other topic is ignored (`null`).
 */
export const NotificationSchema = z.union([
  z.looseObject({
    topicName: z.string().regex(CONVERSATION_TOPIC).or(z.literal('resync')),
    eventBody: ConversationSchema,
  }),
  z
    .looseObject({
      topicName: z
        .string()
        .max(512)
        .refine((t) => !CONVERSATION_TOPIC.test(t) && t !== 'resync'),
      eventBody: z.unknown().optional(),
    })
    .transform(() => null),
]);

const AGENT_PURPOSES = new Set(['agent', 'user']);
const ACTIVE = new Set(['alerting', 'offering', 'dialing', 'contacting', 'connected']);
const ALERTING = new Set(['alerting', 'offering', 'dialing', 'contacting']);
const GONE = new Set(['disconnected', 'terminated']);

export interface AgentLeg {
  readonly participant: GenesysParticipant;
  readonly media: GenesysMediaType;
  readonly communication: GenesysCommunication;
}

/** The agent's current communication (last entry of the first non-empty media list). */
export function legOf(participant: GenesysParticipant): AgentLeg | undefined {
  for (const media of MEDIA) {
    const list = participant[media];
    const communication = list?.at(-1);
    if (communication !== undefined) return { participant, media, communication };
  }
  return undefined;
}

export const isAgent = (p: GenesysParticipant) =>
  p.userId !== undefined && AGENT_PURPOSES.has(p.purpose ?? '');
export const isActive = (leg: AgentLeg) =>
  leg.participant.endTime === undefined && ACTIVE.has(leg.communication.state ?? '');
export const isAlerting = (leg: AgentLeg) => ALERTING.has(leg.communication.state ?? '');
export const isConnected = (leg: AgentLeg) =>
  leg.participant.endTime === undefined && leg.communication.state === 'connected';
/** Disconnected but still owing a wrap-up (the agent is working the conversation in ACW). */
export const inAfterCallWork = (leg: AgentLeg) =>
  leg.participant.endTime === undefined &&
  leg.participant.wrapupRequired === true &&
  (leg.participant.wrapup ?? undefined) === undefined &&
  !isActive(leg);
const isGone = (leg: AgentLeg) =>
  leg.participant.endTime !== undefined || GONE.has(leg.communication.state ?? '');

export function agentLegs(conversation: GenesysConversation): AgentLeg[] {
  return conversation.participants.filter(isAgent).flatMap((p) => legOf(p) ?? []);
}

export function customerOf(conversation: GenesysConversation): GenesysParticipant | undefined {
  return conversation.participants.find(
    (p) => p.purpose === 'customer' || p.purpose === 'external',
  );
}

/** Message sub-types → Verbis channels. Web messaging / open messaging behave like chat. */
export function channelOf(leg: Pick<AgentLeg, 'media' | 'communication'>): ChannelType {
  switch (leg.media) {
    case 'calls':
      return 'voice';
    case 'callbacks':
      return 'callback';
    case 'chats':
      return 'chat';
    case 'emails':
      return 'email';
    case 'messages':
      switch ((leg.communication.type ?? '').toLowerCase()) {
        case 'sms':
          return 'sms';
        case 'whatsapp':
          return 'whatsapp';
        case 'facebook':
        case 'instagram':
        case 'twitter':
          return 'social';
        default:
          return 'chat';
      }
  }
}

const ATTRIBUTE_KEY = /[^A-Za-z0-9_.-]/g;
/** Genesys participant data keys may contain spaces etc.; normalise to the event key grammar. */
export function attributeKey(key: string): string | undefined {
  const cleaned = key.replace(ATTRIBUTE_KEY, '_').slice(0, 64);
  return cleaned === '' || /^_+$/.test(cleaned) ? undefined : cleaned;
}

export function flatAttributes(
  source: Record<string, unknown> | undefined,
  prefix = '',
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, value] of Object.entries(source ?? {})) {
    const key = attributeKey(`${prefix}${rawKey}`);
    if (key === undefined) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 1_000);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      out[key] = value;
    if (Object.keys(out).length >= 200) break;
  }
  return out;
}

/** Outbound dialer markers set by Genesys on the customer participant. */
export function dialerOf(
  conversation: GenesysConversation,
): { campaignId: string; contactListId?: string; contactId?: string } | undefined {
  const attributes = customerOf(conversation)?.attributes ?? {};
  const pick = (name: string) => {
    const value = attributes[name];
    return typeof value === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(value) ? value : undefined;
  };
  const campaignId = pick('dialerCampaignId');
  if (campaignId === undefined) return undefined;
  const contactListId = pick('dialerContactListId');
  const contactId = pick('dialerContactId');
  return {
    campaignId,
    ...(contactListId === undefined ? {} : { contactListId }),
    ...(contactId === undefined ? {} : { contactId }),
  };
}

const iso = (value: string | undefined, fallback: string) =>
  value !== undefined && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;

function contextOf(
  conversation: GenesysConversation,
  leg: AgentLeg,
  channel: ChannelType,
): InteractionEventInput['context'] {
  const customer = customerOf(conversation);
  const remote =
    leg.communication.other?.addressNormalized ?? customer?.address ?? customer?.ani ?? '';
  switch (channel) {
    case 'voice': {
      const ani = customer?.ani ?? remote;
      return {
        channel,
        ...(ani === '' ? {} : { ani: ani.slice(0, 64) }),
        ...(customer?.dnis === undefined ? {} : { dnis: customer.dnis.slice(0, 64) }),
      };
    }
    case 'callback': {
      const callback = customer?.callbacks?.at(-1) ?? leg.communication;
      return {
        channel,
        number: (callback.callbackNumbers?.[0] ?? remote).slice(0, 64),
        ...(callback.callbackScheduledTime === undefined ||
        Number.isNaN(Date.parse(callback.callbackScheduledTime))
          ? {}
          : { scheduledAt: new Date(callback.callbackScheduledTime).toISOString() }),
      };
    }
    case 'email':
      return {
        channel,
        from: remote.slice(0, 320),
        subject: (leg.communication.subject ?? customer?.emails?.at(-1)?.subject ?? '').slice(
          0,
          1_000,
        ),
        body: '',
      };
    case 'sms':
      return { channel, from: remote.slice(0, 64) };
    case 'whatsapp':
      return {
        channel,
        from: remote.slice(0, 64),
        ...(customer?.name === undefined ? {} : { profileName: customer.name }),
      };
    case 'chat':
      return { channel, ...(customer?.name === undefined ? {} : { customerName: customer.name }) };
    default:
      return undefined;
  }
}

/** What the connector already knows about a conversation (for resume ids and dedupe). */
export interface ConversationMemory {
  /** Hold start seen for this participant, so the matching resume gets a stable id. */
  lastHoldStart(conversationId: string, participantId: string): string | undefined;
}

/**
 * Derives the agent-side state of one snapshot. Transfers: the previous agent leg disconnected
 * with `disconnectType = transfer` while another agent leg is active ⇒ `transferred` + the new
 * leg's own state. `ended` only when no agent leg is active.
 */
export function createGenesysMapper(memory: ConversationMemory, fallbackNow: () => Date) {
  return defineMapper({
    name: 'genesys-cloud',
    payloadSchema: NotificationSchema,
    map(notification) {
      if (notification === null) return null;
      const conversation = notification.eventBody;
      const legs = agentLegs(conversation);
      if (legs.length === 0) return null;
      const active = legs.filter(isActive);
      const current = active.at(-1) ?? legs.at(-1);
      if (current === undefined) return null;
      const channel = channelOf(current);
      const now = fallbackNow().toISOString();
      const dialer = dialerOf(conversation);
      const queueId =
        current.participant.queueId ??
        conversation.participants.find((p) => p.purpose === 'acd')?.queueId;
      const customer = customerOf(conversation);
      const direction =
        current.communication.direction ?? (dialer === undefined ? 'inbound' : 'outbound');
      const base = (
        type: InteractionEventInput['type'],
        idSuffix: string,
        at: string | undefined,
        leg: AgentLeg,
      ) => ({
        eventId: `${conversation.id}:${leg.participant.id}:${idSuffix}`.slice(0, 256),
        type,
        occurredAt: iso(at, now),
        platformInteractionId: conversation.id,
        channel,
        direction,
        agent: { id: leg.participant.userId ?? '' },
        ...(queueId === undefined ? {} : { queue: queueId }),
        ...(dialer !== undefined
          ? { campaignRef: { kind: 'campaign', externalId: dialer.campaignId } }
          : queueId === undefined
            ? {}
            : { campaignRef: { kind: 'queue', externalId: queueId } }),
        ...(customer?.id === undefined ? {} : { customerId: customer.id }),
        attributes: {
          ...flatAttributes(customer?.attributes),
          'genesys.mediaType': current.media,
          ...(current.communication.type === undefined
            ? {}
            : { 'genesys.messageType': current.communication.type }),
          ...(dialer === undefined
            ? {}
            : {
                'dialer.campaignId': dialer.campaignId,
                ...(dialer.contactListId === undefined
                  ? {}
                  : { 'dialer.contactListId': dialer.contactListId }),
                ...(dialer.contactId === undefined ? {} : { 'dialer.contactId': dialer.contactId }),
              }),
        },
        ...(() => {
          const context = contextOf(conversation, current, channel);
          return context === undefined ? {} : { context };
        })(),
      });

      const events: InteractionEventInput[] = [];
      const previous = legs.filter(
        (leg) => leg !== current && isGone(leg) && leg.communication.disconnectType === 'transfer',
      );
      if (isActive(current))
        for (const leg of previous)
          events.push({
            ...base(
              'transferred',
              `transferred:${current.participant.id}`,
              leg.communication.disconnectedTime ?? leg.participant.endTime,
              leg,
            ),
            transferTo: { id: current.participant.userId ?? '' },
          });

      const leg = current;
      const c = leg.communication;
      if (isActive(leg) && isAlerting(leg))
        events.push(base('interactionOffered', 'offered', undefined, leg));
      else if (isActive(leg) && c.held === true)
        events.push(base('held', `held:${c.startHoldTime ?? 'na'}`, c.startHoldTime, leg));
      else if (isActive(leg)) {
        const hold = memory.lastHoldStart(conversation.id, leg.participant.id);
        events.push(
          hold === undefined
            ? base('connected', 'connected', c.connectedTime, leg)
            : base('resumed', `resumed:${hold}`, undefined, leg),
        );
      } else if (
        leg.participant.wrapupRequired === true &&
        (leg.participant.wrapup ?? undefined) === undefined
      )
        events.push({
          ...base('wrapupRequired', 'wrapup', c.disconnectedTime ?? leg.participant.endTime, leg),
          wrapUp: {
            required: true,
            ...(leg.participant.wrapupTimeoutMs === undefined
              ? {}
              : {
                  timeoutSeconds: Math.min(
                    3_600,
                    Math.round(leg.participant.wrapupTimeoutMs / 1_000),
                  ),
                }),
          },
        });
      else events.push(base('ended', 'ended', c.disconnectedTime ?? leg.participant.endTime, leg));
      return events;
    },
  });
}
