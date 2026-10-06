import { describe, expect, it } from 'vitest';

import {
  MAX_FRAME_BYTES,
  MAX_UPDATE_BYTES,
  UPDATE_TOO_LARGE_CLOSE_CODE,
  UpdateTooLargeError,
  assertUpdateWithinLimit,
  isUpdateWithinLimit,
} from './index.js';

describe('per-update size limit', () => {
  it('is exactly 2 MiB and the frame limit leaves framing headroom', () => {
    expect(MAX_UPDATE_BYTES).toBe(2_097_152);
    expect(MAX_FRAME_BYTES).toBeGreaterThan(MAX_UPDATE_BYTES);
  });
  it.each([
    [0, true],
    [1, true],
    [MAX_UPDATE_BYTES - 1, true],
    [MAX_UPDATE_BYTES, true],
    [MAX_UPDATE_BYTES + 1, false],
    [-1, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [1.5, false],
  ])('size %s allowed=%s', (size, ok) => {
    expect(isUpdateWithinLimit(size)).toBe(ok);
  });
  it('accepts the boundary and rejects one byte over with close code 1009', () => {
    expect(() => {
      assertUpdateWithinLimit(new Uint8Array(MAX_UPDATE_BYTES));
    }).not.toThrow();
    const over = new Uint8Array(MAX_UPDATE_BYTES + 1);
    try {
      assertUpdateWithinLimit(over);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UpdateTooLargeError);
      expect((error as UpdateTooLargeError).code).toBe(UPDATE_TOO_LARGE_CLOSE_CODE);
      expect((error as UpdateTooLargeError).size).toBe(MAX_UPDATE_BYTES + 1);
    }
  });
  it('property: allowed iff 0 <= size <= limit for sampled sizes', () => {
    for (let i = 0; i < 2000; i++) {
      const size = Math.floor(((i * 2654435761) % 4294967296) / 1000);
      expect(isUpdateWithinLimit(size)).toBe(size <= MAX_UPDATE_BYTES);
    }
  });
});
