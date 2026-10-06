import { expect, it } from 'vitest';

import { applyGroupPatch, applyUserPatch, PatchRequestSchema } from './scim-patch.js';
import {
  ENTERPRISE_USER_SCHEMA,
  PATCH_SCHEMA,
  type GroupState,
  type UserState,
} from './scim.resources.js';

const user: UserState = {
  userName: 'synthetic@example.invalid',
  email: 'synthetic@example.invalid',
  externalId: 'external-1',
  displayName: 'Synthetic',
  active: true,
  locale: 'tr',
};
const group = (): GroupState => ({
  displayName: 'Synthetic group',
  externalId: 'external-1',
  members: new Set(['one', 'two', 'three']),
});

it('accepts provider operation casing and requires a bounded PatchOp document', () => {
  expect(
    PatchRequestSchema.parse({
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: 'REPLACE', path: 'active', value: 'False' }],
    }).Operations[0]?.op,
  ).toBe('replace');
  for (const Operations of [
    [],
    [{ op: 'delete' }],
    Array.from({ length: 1001 }, () => ({ op: 'add' })),
  ]) {
    expect(PatchRequestSchema.safeParse({ schemas: [PATCH_SCHEMA], Operations }).success).toBe(
      false,
    );
  }
  expect(PatchRequestSchema.safeParse({ schemas: [], Operations: [{ op: 'add' }] }).success).toBe(
    false,
  );
});

it('applies pathless identity changes in order without mutating the original user', () => {
  const next = applyUserPatch(user, [
    {
      op: 'replace',
      value: {
        schemas: ['ignored'],
        [ENTERPRISE_USER_SCHEMA]: { department: 'ignored' },
        userName: 'NEXT@EXAMPLE.INVALID',
        active: 'False',
        name: { formatted: 'Next synthetic' },
        locale: 'en',
        externalId: 'external-2',
      },
    },
    { op: 'remove', path: 'externalId' },
    { op: 'remove', path: 'locale' },
  ]);
  expect(next).toEqual({
    ...user,
    userName: 'NEXT@EXAMPLE.INVALID',
    email: 'next@example.invalid',
    active: false,
    displayName: 'Next synthetic',
    externalId: null,
    locale: null,
  });
  expect(user.email).toBe('synthetic@example.invalid');
});

it('supports schema-qualified paths and explicitly minimizes non-stored attributes', () => {
  const next = applyUserPatch(user, [
    {
      op: 'replace',
      path: 'urn:ietf:params:scim:schemas:core:2.0:User:displayName',
      value: 'Qualified',
    },
    { op: 'replace', path: `${ENTERPRISE_USER_SCHEMA}:department`, value: 'ignored' },
    { op: 'add', path: 'name', value: {} },
    { op: 'replace', path: 'name', value: null },
    { op: 'replace', path: 'userName', value: 'opaque-provider-id' },
    ...[
      'name.givenName',
      'name.familyName',
      'title',
      'phoneNumbers',
      'addresses',
      'preferredLanguage',
      'nickName',
      'userType',
    ].map((path) => ({ op: 'replace' as const, path, value: 'ignored' })),
    ...[
      'name',
      'name.givenName',
      'name.familyName',
      'name.formatted',
      'title',
      'phoneNumbers',
      'addresses',
    ].map((path) => ({ op: 'remove' as const, path })),
  ]);
  expect(next).toEqual({ ...user, displayName: 'Qualified', userName: 'opaque-provider-id' });
});

it.each([
  [{ value: 'first@example.invalid' }, { value: 'PRIMARY@EXAMPLE.INVALID', primary: true }],
  [{ value: 'first@example.invalid' }, { value: 'PRIMARY@EXAMPLE.INVALID', primary: 'True' }],
  [{ value: 'PRIMARY@EXAMPLE.INVALID' }],
  'PRIMARY@EXAMPLE.INVALID',
])('selects and normalizes a provider email value: %j', (value) => {
  expect(applyUserPatch(user, [{ op: 'replace', path: 'emails', value }]).email).toBe(
    'primary@example.invalid',
  );
});

it.each(['emails[type eq "work"].value', 'emails[primary eq true].value', 'name.formatted'])(
  'supports provider subattribute path %s',
  (path) => {
    const next = applyUserPatch(user, [{ op: 'replace', path, value: 'NEXT@EXAMPLE.INVALID' }]);
    expect(path === 'name.formatted' ? next.displayName : next.email).toBe(
      path === 'name.formatted' ? 'NEXT@EXAMPLE.INVALID' : 'next@example.invalid',
    );
  },
);

it.each([
  [{ op: 'remove' }, 'noTarget'],
  [{ op: 'add', value: null }, 'invalidValue'],
  [{ op: 'replace', value: [] }, 'invalidValue'],
  [{ op: 'add', value: 'invalid' }, 'invalidValue'],
  [{ op: 'remove', path: 'active' }, 'mutability'],
  [{ op: 'replace', path: 'active', value: 'perhaps' }, 'invalidValue'],
  [{ op: 'replace', path: 'displayName', value: 42 }, 'invalidValue'],
  [{ op: 'replace', path: 'displayName', value: 'x'.repeat(257) }, 'invalidValue'],
  [{ op: 'replace', path: 'emails', value: [] }, 'invalidValue'],
  [{ op: 'replace', path: 'emails', value: [null] }, 'invalidValue'],
  [{ op: 'replace', path: 'emails', value: [undefined] }, 'invalidValue'],
  [{ op: 'replace', path: 'emails', value: ['synthetic@example.invalid'] }, 'invalidValue'],
  [{ op: 'replace', path: 'emails', value: [[]] }, 'invalidValue'],
  [{ op: 'replace', path: 'emails', value: 'invalid' }, 'invalidValue'],
  [{ op: 'replace', path: 'password', value: 'synthetic' }, 'invalidPath'],
] as const)('rejects unsafe user patch %j with %s', (operation, scimType) => {
  expect(() => applyUserPatch(user, [operation])).toThrow(
    expect.objectContaining({ status: 400, scimType }),
  );
  expect(user.active).toBe(true);
});

it('adds and removes specific group members without mutating the source membership', () => {
  const current = group();
  const next = applyGroupPatch(current, [
    {
      op: 'add',
      value: {
        displayName: 'Updated',
        externalId: 'external-2',
        members: [{ value: 'four' }, { value: 'four' }],
      },
    },
    { op: 'remove', path: 'members[value eq "one" or value eq "two"]' },
    { op: 'remove', path: 'members', value: { value: 'missing' } },
    { op: 'remove', path: 'externalId' },
  ]);
  expect(next).toEqual({
    displayName: 'Updated',
    externalId: null,
    members: new Set(['three', 'four']),
  });
  expect(current.members).toEqual(new Set(['one', 'two', 'three']));
});

it('replaces the entire group membership and supports a subsequent clear', () => {
  const current = group();
  const replaced = applyGroupPatch(current, [
    { op: 'replace', value: { members: { value: 'next' } } },
    {
      op: 'replace',
      path: 'urn:ietf:params:scim:schemas:core:2.0:Group:displayName',
      value: 'Qualified',
    },
    { op: 'replace', path: 'externalId', value: 'new' },
    { op: 'add', path: 'members', value: [{ value: 'added' }] },
    { op: 'remove', path: 'members', value: [{ value: 'next' }] },
  ]);
  expect(replaced.members).toEqual(new Set(['added']));
  expect(replaced.displayName).toBe('Qualified');
  expect(
    applyGroupPatch(replaced, [
      { op: 'replace', path: 'members', value: [{ value: 'last' }] },
      { op: 'remove', path: 'members' },
    ]).members.size,
  ).toBe(0);
  expect(applyGroupPatch(current, [{ op: 'add', value: {} }])).toEqual(current);
});

it.each([
  [{ op: 'remove' }, 'noTarget'],
  [{ op: 'add', value: null }, 'invalidValue'],
  [{ op: 'replace', value: [] }, 'invalidValue'],
  [{ op: 'replace', value: 'invalid' }, 'invalidValue'],
  [{ op: 'remove', path: 'displayName' }, 'mutability'],
  [{ op: 'add', path: 'members', value: null }, 'invalidValue'],
  [{ op: 'add', path: 'members', value: 'one' }, 'invalidValue'],
  [{ op: 'add', path: 'members', value: {} }, 'invalidValue'],
  [{ op: 'add', path: 'members', value: { value: 'x'.repeat(65) } }, 'invalidValue'],
  [{ op: 'add', path: 'members[value eq "one"]', value: { value: 'two' } }, 'invalidPath'],
  [{ op: 'remove', path: 'members[value eq "one"' }, 'invalidPath'],
  [{ op: 'remove', path: 'members[malformed]' }, 'invalidFilter'],
  [{ op: 'remove', path: 'members[value ne "one"]' }, 'invalidFilter'],
  [{ op: 'remove', path: 'members[displayName eq "one"]' }, 'invalidFilter'],
  [{ op: 'remove', path: 'members[value eq 3]' }, 'invalidFilter'],
  [{ op: 'remove', path: 'members[value eq "one" and value eq "two"]' }, 'invalidFilter'],
  [{ op: 'replace', path: 'unknown', value: 'invalid' }, 'invalidPath'],
] as const)('rejects unsafe group patch %j with %s', (operation, scimType) => {
  const current = group();
  expect(() => applyGroupPatch(current, [operation])).toThrow(
    expect.objectContaining({ status: 400, scimType }),
  );
  expect(current.members).toEqual(new Set(['one', 'two', 'three']));
});
