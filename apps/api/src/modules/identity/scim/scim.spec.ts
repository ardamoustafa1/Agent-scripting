import { describe, expect, it } from 'vitest';

import {
  compileScimFilter,
  dateAttribute,
  parseScimFilter,
  ScimFilterError,
  stringAttribute,
  type AttributeMap,
} from './scim-filter.js';
import { applyGroupPatch, applyUserPatch, PatchRequestSchema } from './scim-patch.js';
import { ScimError } from './scim.errors.js';
import {
  PATCH_SCHEMA,
  ScimUserInputSchema,
  userStateFromInput,
  type UserState,
} from './scim.resources.js';

describe('parseScimFilter', () => {
  it('parses RFC 7644 examples', () => {
    expect(parseScimFilter('userName eq "bjensen"')).toEqual({
      kind: 'compare',
      attr: 'userName',
      op: 'eq',
      value: 'bjensen',
    });
    expect(
      parseScimFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName sw "J"'),
    ).toMatchObject({
      attr: 'userName',
      op: 'sw',
    });
    expect(parseScimFilter('title pr')).toEqual({ kind: 'present', attr: 'title' });
    expect(parseScimFilter('meta.lastModified gt "2011-05-13T04:42:34Z"')).toMatchObject({
      attr: 'meta.lastModified',
      op: 'gt',
    });
    const complex = parseScimFilter(
      'userType eq "Employee" and (emails co "example.com" or emails.value co "example.org")',
    );
    expect(complex.kind).toBe('and');
    expect(parseScimFilter('emails[type eq "work" and value co "@example.com"]')).toMatchObject({
      kind: 'valuePath',
      attr: 'emails',
    });
    expect(parseScimFilter('not (active eq false)')).toMatchObject({ kind: 'not' });
    expect(parseScimFilter('userName EQ "a\\"b"')).toMatchObject({ value: 'a"b' });
    expect(parseScimFilter('x eq 12.5')).toMatchObject({ value: 12.5 });
    expect(parseScimFilter('x eq null')).toMatchObject({ value: null });
  });

  it('binds and tighter than or', () => {
    const node = parseScimFilter('a eq "1" or b eq "2" and c eq "3"');
    expect(node).toMatchObject({ kind: 'or', right: { kind: 'and' } });
  });

  it.each([
    '',
    'userName',
    'userName eq',
    'userName xx "a"',
    'userName eq "unterminated',
    '(userName eq "a"',
    'userName eq "a")',
    'not userName eq "a"',
    'emails[type eq "work"',
    'userName eq "a" junk',
    "userName eq 'single'",
    'a.b.c eq "x"',
    'userName eq "\\x"',
    'userName eq bareword',
    `${'('.repeat(20)}a eq "1"${')'.repeat(20)}`,
    `userName eq "${'x'.repeat(1000)}"`,
  ])('rejects %j', (filter) => {
    expect(() => parseScimFilter(filter)).toThrow(ScimFilterError);
  });

  it('never throws anything but ScimFilterError on random input (fuzz)', () => {
    const alphabet = [
      'a',
      'eq',
      ' ',
      '"',
      '(',
      ')',
      '[',
      ']',
      'and',
      'or',
      'not',
      'pr',
      '\\',
      '.',
      '1',
      'true',
      ':',
    ];
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let i = 0; i < 2000; i += 1) {
      const input = Array.from(
        { length: Math.floor(random() * 12) },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join(' ');
      try {
        parseScimFilter(input);
      } catch (error) {
        expect(error).toBeInstanceOf(ScimFilterError);
      }
    }
  });
});

describe('compileScimFilter', () => {
  const attributes: AttributeMap = {
    userName: stringAttribute('email'),
    externalId: stringAttribute('externalId', { caseExact: true }),
    'emails.value': stringAttribute('email'),
    emails: stringAttribute('email'),
    'emails.type': { compare: () => ({}) },
    active: {
      compare: (op, value) =>
        op === 'eq' && typeof value === 'boolean'
          ? { status: value ? 'active' : { not: 'active' } }
          : undefined,
    },
    'meta.created': dateAttribute('createdAt'),
  };

  it('compiles to Prisma conditions through the attribute map only', () => {
    expect(compileScimFilter(parseScimFilter('userName eq "Ada@Acme.test"'), attributes)).toEqual({
      email: { equals: 'Ada@Acme.test', mode: 'insensitive' },
    });
    expect(compileScimFilter(parseScimFilter('externalId eq "X"'), attributes)).toEqual({
      externalId: { equals: 'X' },
    });
    expect(
      compileScimFilter(parseScimFilter('active eq true and not (userName sw "x")'), attributes),
    ).toEqual({
      AND: [{ status: 'active' }, { NOT: { email: { startsWith: 'x', mode: 'insensitive' } } }],
    });
    expect(
      compileScimFilter(
        parseScimFilter('emails[type eq "work" and value ew "@acme.test"]'),
        attributes,
      ),
    ).toEqual({
      AND: [{}, { email: { endsWith: '@acme.test', mode: 'insensitive' } }],
    });
    expect(
      compileScimFilter(parseScimFilter('meta.created ge "2026-01-01T00:00:00Z"'), attributes),
    ).toEqual({
      createdAt: { gte: new Date('2026-01-01T00:00:00Z') },
    });
    expect(compileScimFilter(parseScimFilter('userName ne "a"'), attributes)).toEqual({
      NOT: { email: { equals: 'a', mode: 'insensitive' } },
    });
  });

  it('rejects unmapped attributes and unsupported operators', () => {
    expect(() => compileScimFilter(parseScimFilter('password eq "x"'), attributes)).toThrow(
      /unsupported attribute/,
    );
    expect(() => compileScimFilter(parseScimFilter('active gt true'), attributes)).toThrow(
      ScimFilterError,
    );
    expect(() => compileScimFilter(parseScimFilter('userName eq 5'), attributes)).toThrow(
      ScimFilterError,
    );
    expect(() => compileScimFilter(parseScimFilter('active pr'), attributes)).toThrow(
      /pr not supported/,
    );
  });
});

describe('SCIM user input', () => {
  it('derives email and display name', () => {
    const state = userStateFromInput(
      ScimUserInputSchema.parse({
        userName: 'ADA@acme.test',
        name: { givenName: 'Ada', familyName: 'L' },
        active: 'False',
      }),
    );
    expect(state).toMatchObject({ email: 'ada@acme.test', displayName: 'Ada L', active: false });
    expect(() => userStateFromInput(ScimUserInputSchema.parse({ userName: 'noemail' }))).toThrow(
      ScimError,
    );
    expect(
      userStateFromInput(
        ScimUserInputSchema.parse({
          userName: 'u1',
          emails: [{ value: 'x@acme.test', primary: true }],
        }),
      ).email,
    ).toBe('x@acme.test');
  });
});

describe('PATCH', () => {
  const user: UserState = {
    userName: 'ada@acme.test',
    email: 'ada@acme.test',
    externalId: 'e1',
    displayName: 'Ada',
    active: true,
    locale: null,
  };
  const patch = (ops: unknown[]) =>
    PatchRequestSchema.parse({ schemas: [PATCH_SCHEMA], Operations: ops }).Operations;

  it('applies Entra ID and Okta style user operations', () => {
    expect(
      applyUserPatch(user, patch([{ op: 'Replace', path: 'active', value: 'False' }])).active,
    ).toBe(false);
    expect(
      applyUserPatch(
        user,
        patch([
          { op: 'replace', value: { active: false, displayName: 'Ada L', 'name.givenName': 'x' } },
        ]),
      ),
    ).toMatchObject({ active: false, displayName: 'Ada L' });
    expect(
      applyUserPatch(
        user,
        patch([{ op: 'replace', path: 'emails[type eq "work"].value', value: 'NEW@acme.test' }]),
      ).email,
    ).toBe('new@acme.test');
    expect(
      applyUserPatch(user, patch([{ op: 'remove', path: 'externalId' }])).externalId,
    ).toBeNull();
    expect(
      applyUserPatch(
        user,
        patch([
          {
            op: 'add',
            path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
            value: 'x',
          },
        ]),
      ),
    ).toEqual(user);
    expect(user.active).toBe(true);
  });

  it('rejects invalid user operations', () => {
    expect(() =>
      applyUserPatch(user, patch([{ op: 'replace', path: 'roles', value: 'admin' }])),
    ).toThrow(ScimError);
    expect(() =>
      applyUserPatch(user, patch([{ op: 'replace', path: 'active', value: 'maybe' }])),
    ).toThrow(ScimError);
    expect(() => applyUserPatch(user, patch([{ op: 'remove', path: 'userName' }]))).toThrow(
      ScimError,
    );
    expect(() => applyUserPatch(user, patch([{ op: 'remove' }]))).toThrow(ScimError);
    expect(() =>
      PatchRequestSchema.parse({ schemas: ['x'], Operations: [{ op: 'add' }] }),
    ).toThrow();
    expect(() =>
      PatchRequestSchema.parse({ schemas: [PATCH_SCHEMA], Operations: [{ op: 'move' }] }),
    ).toThrow();
  });

  it('applies group member operations', () => {
    const group = { displayName: 'g', externalId: null, members: new Set(['u1', 'u2']) };
    expect([
      ...applyGroupPatch(group, patch([{ op: 'add', path: 'members', value: [{ value: 'u3' }] }]))
        .members,
    ]).toEqual(['u1', 'u2', 'u3']);
    expect([
      ...applyGroupPatch(group, patch([{ op: 'remove', path: 'members[value eq "u1"]' }])).members,
    ]).toEqual(['u2']);
    expect([
      ...applyGroupPatch(
        group,
        patch([{ op: 'remove', path: 'members', value: [{ value: 'u2' }] }]),
      ).members,
    ]).toEqual(['u1']);
    expect([
      ...applyGroupPatch(
        group,
        patch([{ op: 'replace', path: 'members', value: [{ value: 'u9' }] }]),
      ).members,
    ]).toEqual(['u9']);
    expect(applyGroupPatch(group, patch([{ op: 'remove', path: 'members' }])).members.size).toBe(0);
    expect(
      applyGroupPatch(
        group,
        patch([{ op: 'replace', value: { displayName: 'new', externalId: 'x' } }]),
      ),
    ).toMatchObject({
      displayName: 'new',
      externalId: 'x',
    });
    expect(group.members.size).toBe(2);
    expect(() =>
      applyGroupPatch(group, patch([{ op: 'remove', path: 'members[display eq "x"]' }])),
    ).toThrow(ScimError);
    expect(() => applyGroupPatch(group, patch([{ op: 'remove', path: 'displayName' }]))).toThrow(
      ScimError,
    );
    expect(() =>
      applyGroupPatch(group, patch([{ op: 'add', path: 'owners', value: 'x' }])),
    ).toThrow(ScimError);
  });
});
