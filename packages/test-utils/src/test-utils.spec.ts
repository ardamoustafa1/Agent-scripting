import { describe, expect, it } from 'vitest';

import { fixedClock } from './clock.js';
import { sequentialIds } from './ids.js';

describe('fixedClock', () => {
  it('starts at the given instant and advances deterministically', () => {
    const clock = fixedClock('2026-10-01T00:00:00.000Z');
    clock.advance(1_500);
    expect(clock.now().toISOString()).toBe('2026-10-01T00:00:01.500Z');
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.now().getUTCFullYear()).toBe(2027);
  });

  it('has a stable default', () => {
    expect(fixedClock().now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('sequentialIds', () => {
  it('produces UUID-shaped sequential ids', () => {
    const next = sequentialIds();
    expect(next()).toBe('00000000-0000-7000-8000-000000000001');
    expect(next()).toBe('00000000-0000-7000-8000-000000000002');
  });
});
