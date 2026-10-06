import { describe, expect, it } from 'vitest';

import { startHarness } from '@verbis/sdk-connector/testing';

import { assertFinesseAttributes, utf8ByteLength } from './finesse-limits.js';
import { marketplaceSubject, transports } from './marketplace-test.js';
import { type MarketplaceConnector } from './marketplace.connector.js';

describe('Finesse call variable limits (M-26, unverified against vendor)', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('ğüş')).toBe(6);
    expect(utf8ByteLength('😀')).toBe(4);
  });
  it('accepts callVariable1..10 up to exactly 40 bytes', () => {
    expect(() => {
      assertFinesseAttributes({ callVariable1: 'a'.repeat(40) });
    }).not.toThrow();
    expect(() => {
      assertFinesseAttributes({ callVariable10: null });
    }).not.toThrow();
  });
  it('rejects 41 bytes and multibyte values that fit by characters but not by bytes', () => {
    expect(() => {
      assertFinesseAttributes({ callVariable1: 'a'.repeat(41) });
    }).toThrow(expect.objectContaining({ code: 'attribute_too_long' }));
    // 21 x 2 bytes = 42 bytes, only 21 characters.
    expect(() => {
      assertFinesseAttributes({ callVariable2: 'ş'.repeat(21) });
    }).toThrow(expect.objectContaining({ code: 'attribute_too_long' }));
    expect(() => {
      assertFinesseAttributes({ callVariable2: 'ş'.repeat(20) });
    }).not.toThrow();
  });
  it('measures numbers and booleans as written', () => {
    expect(() => {
      assertFinesseAttributes({ callVariable3: 12345 });
    }).not.toThrow();
  });
  it('uses the 210 byte ECC limit for user.* variables and refuses unknown names', () => {
    expect(() => {
      assertFinesseAttributes({ 'user.note': 'a'.repeat(210) });
    }).not.toThrow();
    expect(() => {
      assertFinesseAttributes({ 'user.note': 'a'.repeat(211) });
    }).toThrow(expect.objectContaining({ code: 'attribute_too_long' }));
    expect(() => {
      assertFinesseAttributes({ callVariable11: 'x' });
    }).toThrow(expect.objectContaining({ code: 'attribute_not_allowed' }));
    expect(() => {
      assertFinesseAttributes({ other: 'x' });
    }).toThrow(expect.objectContaining({ code: 'attribute_not_allowed' }));
  });
  it('the Finesse connector refuses an oversized write before it reaches the bridge', async () => {
    const subject = marketplaceSubject('cisco-finesse');
    const h = await startHarness({
      ...subject,
      config: { ...(subject.config as object), attributeAllowList: ['callVariable1'] },
    });
    const c = h.connector as MarketplaceConnector;
    await c.ingest({
      version: 1,
      platform: 'cisco-finesse',
      variables: {},
      event: {
        eventId: 'e1',
        type: 'connected',
        occurredAt: '2026-10-01T10:00:00.000Z',
        platformInteractionId: 'contact-1',
        channel: 'voice',
        direction: 'inbound',
        agent: { id: 'agent-1' },
      },
    });
    const target = { platformInteractionId: 'contact-1', commandId: 'c1' };
    await expect(
      c.writeAttributes(target, { callVariable1: 'ş'.repeat(21) }),
    ).rejects.toMatchObject({ code: 'attribute_too_long', retryable: false });
    expect(transports.get(c)?.commands).toHaveLength(0);
    await c.writeAttributes({ ...target, commandId: 'c2' }, { callVariable1: 'ş'.repeat(20) });
    expect(transports.get(c)?.commands).toHaveLength(1);
  });
});
