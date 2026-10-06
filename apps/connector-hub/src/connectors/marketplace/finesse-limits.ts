import { ConnectorError, type Attributes } from '@verbis/sdk-connector';

/**
 * UCCE call variables 1-10 hold 40 bytes; ECC (`user.*`) variables hold up to 210 bytes by default.
 * Limits are in UTF-8 BYTES. Values are rejected, never silently truncated (fail closed).
 * Unverified against a vendor system; the limit is a documented UCCE default (audit M-26).
 */
export const FINESSE_CALL_VARIABLE_MAX_BYTES = 40;
export const FINESSE_ECC_MAX_BYTES = 210;

const encoder = new TextEncoder();
export const utf8ByteLength = (value: string): number => encoder.encode(value).length;

export function assertFinesseAttributes(attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    const limit = /^callVariable([1-9]|10)$/.test(name)
      ? FINESSE_CALL_VARIABLE_MAX_BYTES
      : /^user\.[A-Za-z0-9_.-]+$/.test(name)
        ? FINESSE_ECC_MAX_BYTES
        : undefined;
    if (limit === undefined)
      throw new ConnectorError('Unknown call variable or ECC name', 'attribute_not_allowed', false);
    if (value !== null && utf8ByteLength(String(value)) > limit)
      throw new ConnectorError(
        `Call variable exceeds ${String(limit)} bytes`,
        'attribute_too_long',
        false,
      );
  }
}
