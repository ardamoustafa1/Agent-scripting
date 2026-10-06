import { describe, expect, it } from 'vitest';

import { ctiIdsOf, matchUser, type MappableUser } from './user-mapping.js';

const users: MappableUser[] = [
  {
    id: 'u1',
    email: 'ayse@acme.test',
    externalId: 'idp-1',
    ctiIdentities: [{ platform: 'genesys_cloud', id: 'g-1' }],
  },
  {
    id: 'u2',
    email: 'can@acme.test',
    externalId: null,
    ctiIdentities: [{ platform: 'generic', id: 'g-1' }],
  },
  { id: 'u3', email: 'dup@acme.test', externalId: null, ctiIdentities: [] },
  { id: 'u4', email: 'DUP@acme.test', externalId: null, ctiIdentities: 'garbage' },
];

describe('platform user mapping', () => {
  it('prefers the CTI identity of the same platform', () => {
    expect(matchUser(users, 'genesys_cloud', { id: 'g-1', email: 'can@acme.test' })).toBe('u1');
    expect(matchUser(users, 'generic', { id: 'g-1' })).toBe('u2');
  });
  it('falls back to externalId, then email (case-insensitive)', () => {
    expect(matchUser(users, 'five9', { id: 'idp-1' })).toBe('u1');
    expect(matchUser(users, 'five9', { id: 'x', email: 'CAN@acme.test' })).toBe('u2');
  });
  it('maps ambiguous or unknown users to nobody', () => {
    expect(matchUser(users, 'five9', { id: 'x', email: 'dup@acme.test' })).toBeUndefined();
    expect(matchUser(users, 'five9', { id: 'nobody' })).toBeUndefined();
    expect(
      matchUser([users[0]!, { ...users[0]!, id: 'u9' }], 'genesys_cloud', { id: 'g-1' }),
    ).toBeUndefined();
  });
  it('ignores malformed identity lists', () => {
    expect(ctiIdsOf({ ctiIdentities: 'garbage' }, 'generic')).toEqual([]);
    expect(ctiIdsOf(users[1]!, 'generic')).toEqual(['g-1']);
  });
});
