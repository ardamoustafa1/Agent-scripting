import { describe, expect, it } from 'vitest';

import { AvayaSidecarConfigSchema } from './config.js';
import { channelOf } from './mapper.js';
import { decodeUui } from './uui.js';

const uui = (input: Record<string, unknown>) =>
  AvayaSidecarConfigSchema.parse({
    kind: 'sidecar',
    nats: { servers: ['nats://n:4222'] },
    uui: input,
  }).uui;

describe('UUI decoding', () => {
  it('raw ASCII and hex', () => {
    expect(decodeUui('ABC123', 'ascii', uui({}))).toEqual({ 'uui.raw': 'ABC123' });
    expect(decodeUui('414243', 'hex', uui({}))).toEqual({ 'uui.raw': 'ABC' });
    // Binary UUI stays hex under uui.raw.
    expect(decodeUui('00FF10', 'hex', uui({}))).toEqual({ 'uui.raw': '00FF10' });
  });

  it('key/value pairs with custom separators and an allow-list', () => {
    expect(
      decodeUui(
        'a:1;b:2;c:3',
        'ascii',
        uui({ format: 'kv', pairSeparator: ';', keyValueSeparator: ':', allow: ['a', 'c'] }),
      ),
    ).toEqual({ 'uui.a': '1', 'uui.c': '3' });
    expect(decodeUui('broken|=x|k=v', 'ascii', uui({ format: 'kv' }))).toEqual({ 'uui.k': 'v' });
  });

  it('CM shared UUI elements (id, length, data)', () => {
    // C8 = 4 bytes "C-42", FA = 2 bytes "TR", 01 unmapped
    const hex =
      'C8' +
      '04' +
      Buffer.from('C-42').toString('hex') +
      'FA' +
      '02' +
      Buffer.from('TR').toString('hex') +
      '01' +
      '01' +
      '41';
    expect(
      decodeUui(hex, 'hex', uui({ format: 'shared', sharedIds: { C8: 'customerId', FA: 'lang' } })),
    ).toEqual({ 'uui.customerId': 'C-42', 'uui.lang': 'TR' });
    expect(decodeUui('C8FF00', 'hex', uui({ format: 'shared', sharedIds: { C8: 'x' } }))).toEqual(
      {},
    );
  });

  it('maps Avaya media to channels', () => {
    expect(
      ['voice', 'email', 'webcomm', 'im', 'sms', 'social', 'fax', 'voicemail'].map((m) =>
        channelOf(m as never),
      ),
    ).toEqual(['voice', 'email', 'chat', 'chat', 'sms', 'social', 'email', 'voice']);
  });
});
