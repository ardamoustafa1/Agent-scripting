import { describe, it, expect } from 'vitest';

import { ipAllowed } from './ip-policy.js';

describe('tenant IP enforcement', () => {
  it('allows an unset policy and denies malformed configuration', () => {
    expect(ipAllowed({}, '192.0.2.1')).toBe(true);
    expect(ipAllowed({ security: { ipAllowlist: ['*'] } }, '192.0.2.1')).toBe(false);
  });
  it('applies subnet boundaries and IPv4-mapped addresses', () => {
    const policy = { security: { ipAllowlist: ['192.0.2.0/24'] } };
    expect(ipAllowed(policy, '192.0.2.255')).toBe(true);
    expect(ipAllowed(policy, '::ffff:192.0.2.1')).toBe(true);
    expect(ipAllowed(policy, '192.0.3.1')).toBe(false);
  });
  it('supports IPv6 and rejects non-address input', () => {
    const policy = { security: { ipAllowlist: ['2001:db8::/32'] } };
    expect(ipAllowed(policy, '2001:db8::1')).toBe(true);
    expect(ipAllowed(policy, '2001:db9::1')).toBe(false);
    expect(ipAllowed(policy, 'fixture.example')).toBe(false);
  });
});
