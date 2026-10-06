import { describe, expect, it } from 'vitest';

import { ChannelContextSchema, toScriptVariables } from './channel-context.js';

const at = '2026-10-01T10:00:00.000Z';

describe('channel context → script variables', () => {
  it('exposes chat transcript and derived values', () => {
    const vars = toScriptVariables(
      ChannelContextSchema.parse({
        channel: 'chat',
        customerName: 'Ayşe',
        transcript: [
          { from: 'customer', text: 'Merhaba', at },
          { from: 'agent', text: 'Hoş geldiniz', at },
          { from: 'customer', text: 'Faturam yüksek', at },
        ],
      }),
    );
    expect(vars).toMatchObject({
      'channel.type': 'chat',
      'channel.chat.messageCount': 3,
      'channel.chat.lastMessage': 'Faturam yüksek',
      'channel.chat.lastCustomerMessage': 'Faturam yüksek',
      'channel.chat.customerName': 'Ayşe',
    });
    expect(vars['channel.chat.transcript']).toHaveLength(3);
  });

  it('exposes email subject/body and social message', () => {
    expect(
      toScriptVariables(
        ChannelContextSchema.parse({
          channel: 'email',
          from: 'a@b.co',
          subject: 'İade',
          body: 'Ürün bozuk',
          attachments: [{ name: 'f.pdf', size: 10 }],
        }),
      ),
    ).toMatchObject({
      'channel.email.subject': 'İade',
      'channel.email.body': 'Ürün bozuk',
      'channel.email.attachmentCount': 1,
      'channel.email.to': [],
    });
    expect(
      toScriptVariables(
        ChannelContextSchema.parse({
          channel: 'social',
          network: 'x',
          handle: '@musteri',
          message: 'Rezalet',
          isPublic: true,
        }),
      ),
    ).toMatchObject({
      'channel.social.network': 'x',
      'channel.social.message': 'Rezalet',
      'channel.social.isPublic': true,
      'channel.social.postUrl': null,
    });
  });

  it.each([
    [{ channel: 'voice', ani: '+905551112233' }, 'channel.voice.ani', '+905551112233'],
    [
      { channel: 'sms', from: '+90555', messages: [{ from: 'customer', text: 'hi', at }] },
      'channel.sms.lastCustomerMessage',
      'hi',
    ],
    [
      { channel: 'whatsapp', from: '+90555', profileName: 'Can' },
      'channel.whatsapp.profileName',
      'Can',
    ],
    [{ channel: 'video', roomId: 'r1' }, 'channel.video.roomId', 'r1'],
    [
      { channel: 'callback', number: '+90555', reason: 'geri ara' },
      'channel.callback.reason',
      'geri ara',
    ],
  ])('maps %o', (input, key, value) => {
    expect(toScriptVariables(ChannelContextSchema.parse(input))[key]).toEqual(value);
  });

  it('rejects unbounded or unknown content', () => {
    expect(
      ChannelContextSchema.safeParse({
        channel: 'chat',
        transcript: [{ from: 'hacker', text: 'x', at }],
      }).success,
    ).toBe(false);
    expect(
      ChannelContextSchema.safeParse({
        channel: 'email',
        from: 'a',
        subject: 'x'.repeat(1_001),
        body: '',
      }).success,
    ).toBe(false);
    expect(ChannelContextSchema.safeParse({ channel: 'fax' }).success).toBe(false);
    expect(ChannelContextSchema.safeParse({ channel: 'voice', extra: 1 }).success).toBe(false);
  });
});
