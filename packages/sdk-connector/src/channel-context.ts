import { z } from 'zod';

/**
 * Rich, channel-specific context (chat transcript, email subject/body, social post…). Connectors
 * fill it; the runtime exposes it to scripts as `channel.*` variables (see `toScriptVariables`).
 * Every field is bounded: platform payloads are untrusted input.
 */
const Text = (max: number) => z.string().max(max);
const When = z.iso.datetime({ offset: true });

export const ChatMessageSchema = z.strictObject({
  from: z.enum(['customer', 'agent', 'bot', 'system']),
  text: Text(8_000),
  at: When,
});

export const ChannelContextSchema = z.discriminatedUnion('channel', [
  z.strictObject({
    channel: z.literal('voice'),
    ani: Text(64).optional(),
    dnis: Text(64).optional(),
    ivrPath: z.array(Text(128)).max(50).default([]),
  }),
  z.strictObject({
    channel: z.literal('chat'),
    transcript: z.array(ChatMessageSchema).max(500).default([]),
    customerName: Text(256).optional(),
    entryPoint: Text(256).optional(),
  }),
  z.strictObject({
    channel: z.literal('email'),
    from: Text(320),
    to: z.array(Text(320)).max(50).default([]),
    subject: Text(1_000),
    body: Text(100_000),
    threadId: Text(256).optional(),
    attachments: z
      .array(z.strictObject({ name: Text(256), size: z.number().int().nonnegative() }))
      .max(50)
      .default([]),
  }),
  z.strictObject({
    channel: z.literal('sms'),
    from: Text(64),
    messages: z.array(ChatMessageSchema).max(500).default([]),
  }),
  z.strictObject({
    channel: z.literal('whatsapp'),
    from: Text(64),
    profileName: Text(256).optional(),
    messages: z.array(ChatMessageSchema).max(500).default([]),
  }),
  z.strictObject({
    channel: z.literal('social'),
    network: z.enum(['facebook', 'instagram', 'x', 'linkedin', 'youtube', 'tiktok', 'other']),
    handle: Text(256),
    postUrl: z.url().max(2_048).optional(),
    message: Text(8_000),
    isPublic: z.boolean().default(false),
  }),
  z.strictObject({
    channel: z.literal('video'),
    roomId: Text(256).optional(),
    customerName: Text(256).optional(),
  }),
  z.strictObject({
    channel: z.literal('callback'),
    number: Text(64),
    scheduledAt: When.optional(),
    reason: Text(1_000).optional(),
  }),
]);
export type ChannelContext = z.infer<typeof ChannelContextSchema>;

export type ScriptValue =
  string | number | boolean | null | ScriptValue[] | { [key: string]: ScriptValue };

/**
 * Flat, script-friendly view: `channel.type`, `channel.email.subject`, `channel.chat.lastMessage`,
 * `channel.chat.transcript` (array) … Derived values (last customer message, counts) save scripts
 * from re-implementing them.
 */
export function toScriptVariables(context: ChannelContext): Record<string, ScriptValue> {
  const base: Record<string, ScriptValue> = { 'channel.type': context.channel };
  const prefix = `channel.${context.channel}`;
  const messages = (list: { from: string; text: string; at: string }[]) => {
    const fromCustomer = list.filter((m) => m.from === 'customer');
    return {
      [`${prefix}.transcript`]: list.map((m) => ({ from: m.from, text: m.text, at: m.at })),
      [`${prefix}.messageCount`]: list.length,
      [`${prefix}.lastMessage`]: list.at(-1)?.text ?? null,
      [`${prefix}.lastCustomerMessage`]: fromCustomer.at(-1)?.text ?? null,
    };
  };
  switch (context.channel) {
    case 'voice':
      return {
        ...base,
        [`${prefix}.ani`]: context.ani ?? null,
        [`${prefix}.dnis`]: context.dnis ?? null,
        [`${prefix}.ivrPath`]: context.ivrPath,
      };
    case 'chat':
      return {
        ...base,
        ...messages(context.transcript),
        [`${prefix}.customerName`]: context.customerName ?? null,
        [`${prefix}.entryPoint`]: context.entryPoint ?? null,
      };
    case 'email':
      return {
        ...base,
        [`${prefix}.from`]: context.from,
        [`${prefix}.to`]: context.to,
        [`${prefix}.subject`]: context.subject,
        [`${prefix}.body`]: context.body,
        [`${prefix}.threadId`]: context.threadId ?? null,
        [`${prefix}.attachmentCount`]: context.attachments.length,
      };
    case 'sms':
      return { ...base, ...messages(context.messages), [`${prefix}.from`]: context.from };
    case 'whatsapp':
      return {
        ...base,
        ...messages(context.messages),
        [`${prefix}.from`]: context.from,
        [`${prefix}.profileName`]: context.profileName ?? null,
      };
    case 'social':
      return {
        ...base,
        [`${prefix}.network`]: context.network,
        [`${prefix}.handle`]: context.handle,
        [`${prefix}.postUrl`]: context.postUrl ?? null,
        [`${prefix}.message`]: context.message,
        [`${prefix}.isPublic`]: context.isPublic,
      };
    case 'video':
      return {
        ...base,
        [`${prefix}.roomId`]: context.roomId ?? null,
        [`${prefix}.customerName`]: context.customerName ?? null,
      };
    case 'callback':
      return {
        ...base,
        [`${prefix}.number`]: context.number,
        [`${prefix}.scheduledAt`]: context.scheduledAt ?? null,
        [`${prefix}.reason`]: context.reason ?? null,
      };
  }
}
