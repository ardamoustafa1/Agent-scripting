import { expect, it } from 'vitest';

import { CtiIdentitiesSchema } from './cti-identities.js';

it('canonicalizes admin/SCIM identities while preserving exact case-sensitive platform user ids', () => {
  expect(
    CtiIdentitiesSchema.parse([
      { platform: ' GENESYS CLOUD ', platformUserId: 'Agent-1' },
      { platform: 'genesys-cloud', id: 'Agent-2' },
    ]),
  ).toEqual([
    { platform: 'genesys-cloud', id: 'Agent-1' },
    { platform: 'genesys-cloud', id: 'Agent-2' },
  ]);
});
it('rejects ambiguous fields and empty identities', () => {
  for (const identity of [
    { platform: '', id: 'id' },
    { platform: 'generic', id: '' },
    { platform: 'generic', id: 'one', platformUserId: 'two' },
  ])
    expect(CtiIdentitiesSchema.safeParse([identity]).success).toBe(false);
});
