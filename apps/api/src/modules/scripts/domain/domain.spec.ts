import { generateKeyPairSync } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Hex } from '../../../common/crypto/canonical-json.js';

import {
  approvalReached,
  ApprovalPolicySchema,
  eligibility,
  isEditable,
  nextState,
  TRANSITIONS,
  VERSION_STATES,
  type LifecycleAction,
  type VersionState,
} from './lifecycle.js';
import {
  buildPackage,
  PackageKeys,
  PackageVerificationError,
  verifyPackage,
  type PackagePayload,
} from './package-format.js';
import { composeDocument, extractFragment } from './screen-composition.js';
import { bumpSemver, compareSemver, isSemver, maxSemver } from './semver.js';
import { applyPatch, jsonPatch, summarizeDiff } from './version-diff.js';

describe('shared screen migration boundary', () => {
  it('preserves an uncomposed legacy document for schema migration without mutating it', () => {
    const legacy = { schemaVersion: '0.9.0', i18n: { tr: { greeting: 'Synthetic' } }, pages: [] };
    const composed = composeDocument(legacy, []);
    expect(composed.document).toEqual(legacy);
    expect(composed.document).not.toBe(legacy);
    expect(composed.conflicts).toEqual([]);
  });
});

describe('semver', () => {
  it.each([
    '0.0.0',
    '1.2.3',
    '10.20.30',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-0.3.7',
    '1.0.0-x.7.z.92',
  ])('valid %s', (v) => {
    expect(isSemver(v)).toBe(true);
  });
  it.each(['1', '1.2', '01.2.3', '1.02.3', '1.2.3-', '1.2.3-01', 'v1.2.3', '1.2.3+build', ''])(
    'invalid %s',
    (v) => {
      expect(isSemver(v)).toBe(false);
    },
  );
  it('orders by SemVer precedence (spec §11 example chain)', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ];
    for (let i = 0; i + 1 < chain.length; i += 1) {
      expect(compareSemver(chain[i]!, chain[i + 1]!)).toBe(-1);
      expect(compareSemver(chain[i + 1]!, chain[i]!)).toBe(1);
    }
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(maxSemver(['1.0.0', '2.0.0-rc.1', '1.9.9'])).toBe('2.0.0-rc.1');
    expect(() => compareSemver('x', '1.0.0')).toThrow();
  });
  it('bumps', () => {
    expect(bumpSemver(undefined, 'minor')).toBe('0.1.0');
    expect(bumpSemver('1.4.2', 'major')).toBe('2.0.0');
    expect(bumpSemver('1.4.2', 'minor')).toBe('1.5.0');
    expect(bumpSemver('1.4.2', 'patch')).toBe('1.4.3');
  });
});

describe('lifecycle state machine', () => {
  const EXPECTED: Record<VersionState, Partial<Record<LifecycleAction, VersionState>>> = {
    draft: { submit: 'in_review' },
    in_review: { withdraw: 'draft', approve: 'approved', reject: 'draft' },
    approved: { publish: 'published', reopen: 'draft' },
    published: { retire: 'retired' },
    retired: {},
  };
  const cases = VERSION_STATES.flatMap((state) =>
    (Object.keys(TRANSITIONS) as LifecycleAction[]).map(
      (action) => [state, action, EXPECTED[state][action]] as const,
    ),
  );
  it.each(cases)('%s --%s--> %s', (state, action, expected) => {
    expect(nextState(state, action)).toBe(expected);
  });
  it('only drafts are editable; nothing leaves published except retire', () => {
    expect(VERSION_STATES.filter(isEditable)).toEqual(['draft']);
    expect(
      (Object.keys(TRANSITIONS) as LifecycleAction[])
        .map((a) => nextState('published', a))
        .filter(Boolean),
    ).toEqual(['retired']);
  });
});

describe('approval policy', () => {
  const policy = ApprovalPolicySchema.parse({
    requiredApprovals: 2,
    approverRoles: ['script_approver'],
  });
  const approver = (id: string, roles = ['script_approver']) => ({ id, roles });

  it('SoD: an author can never approve when enabled', () => {
    expect(eligibility(policy, approver('u-1'), ['user:u-1'], [], 1, true)).toEqual(['author']);
    expect(eligibility(policy, approver('user:u-1'), ['u-1'], [], 1, true)).toEqual(['author']);
    expect(eligibility(policy, approver('u-1'), ['u-1'], [], 1, false)).toEqual([]);
  });
  it('requires a listed user / approver role and one vote per round', () => {
    expect(eligibility(policy, approver('u-2', ['agent']), ['u-1'], [], 1, true)).toEqual([
      'missing_approver_role',
    ]);
    const listed = ApprovalPolicySchema.parse({ approverUserIds: ['user:u-9'] });
    expect(eligibility(listed, approver('u-2'), [], [], 1, true)).toEqual(['not_listed_approver']);
    expect(eligibility(listed, approver('u-9'), [], [], 1, true)).toEqual([]);
    const voted = [{ reviewer: 'user:u-2', round: 1, decision: 'approved' as const }];
    expect(eligibility(policy, approver('user:u-2'), [], voted, 1, true)).toEqual([
      'already_voted',
    ]);
    expect(eligibility(policy, approver('user:u-2'), [], voted, 2, true)).toEqual([]);
    expect(
      eligibility(
        policy,
        approver('user:u-2'),
        [],
        [{ reviewer: 'user:u-2', round: 1, decision: 'commented' }],
        1,
        true,
      ),
    ).toEqual([]);
  });
  it('counts distinct approvals of the current round; a rejection blocks', () => {
    const r = (reviewer: string, decision: 'approved' | 'rejected' | 'commented', round = 2) => ({
      reviewer,
      round,
      decision,
    });
    expect(approvalReached(policy, [r('a', 'approved')], 2)).toBe(false);
    expect(approvalReached(policy, [r('a', 'approved'), r('user:a', 'approved')], 2)).toBe(false);
    expect(approvalReached(policy, [r('a', 'approved'), r('b', 'approved')], 2)).toBe(true);
    expect(approvalReached(policy, [r('a', 'approved', 1), r('b', 'approved')], 2)).toBe(false);
    expect(
      approvalReached(policy, [r('a', 'approved'), r('b', 'approved'), r('c', 'rejected')], 2),
    ).toBe(false);
    expect(
      approvalReached(policy, [r('a', 'approved'), r('b', 'approved'), r('c', 'commented')], 2),
    ).toBe(true);
  });
  it('defaults are strict but usable', () => {
    expect(ApprovalPolicySchema.parse({})).toEqual({
      requiredApprovals: 1,
      approverUserIds: [],
      approverRoles: [],
      rejectionReturnsToDraft: true,
    });
    expect(ApprovalPolicySchema.safeParse({ requiredApprovals: 0 }).success).toBe(false);
  });
});

describe('version diff', () => {
  const v1 = {
    meta: { name: 'Card sales' },
    pages: [
      {
        id: 'p-intro',
        name: 'Intro',
        layout: {
          id: 'root',
          type: 'box',
          children: [{ id: 'txt-hello', type: 'text', props: { k: 1 } }],
        },
      },
    ],
    variables: [{ id: 'customerName', type: 'string' }],
    dataSources: [],
    flow: {
      start: 'n1',
      nodes: [{ id: 'n1', type: 'page', page: 'p-intro', position: { x: 0, y: 0 } }],
      edges: [],
    },
    i18n: { defaultLocale: 'tr', messages: { tr: { 'intro.title': 'Merhaba' } } },
  };
  const v2 = {
    ...v1,
    pages: [
      {
        id: 'p-intro',
        name: 'Giriş',
        layout: {
          id: 'root',
          type: 'box',
          children: [
            { id: 'txt-hello', type: 'text', props: { k: 2 } },
            { id: 'btn-next', type: 'button' },
          ],
        },
      },
      { id: 'p-offer', name: 'Offer', layout: { id: 'root2', type: 'box' } },
    ],
    variables: [],
    flow: {
      start: 'n1',
      nodes: [{ id: 'n1', type: 'page', page: 'p-intro', position: { x: 50, y: 9 } }],
      edges: [{ id: 'e1', from: 'n1', to: 'n1' }],
    },
    i18n: {
      defaultLocale: 'tr',
      messages: { tr: { 'intro.title': 'Selam' }, en: { 'intro.title': 'Hi' } },
    },
  };

  it('summarizes semantic changes by stable id (positions are not changes)', () => {
    const s = summarizeDiff(v1, v2);
    expect(s.pages).toEqual({ added: ['p-offer'], removed: [], changed: ['p-intro'] });
    expect(s.nodes).toEqual({ added: ['btn-next', 'root2'], removed: [], changed: ['txt-hello'] });
    expect(s.variables).toEqual({ added: [], removed: ['customerName'], changed: [] });
    expect(s.flowNodes.changed).toEqual([]);
    expect(s.flowEdges.added).toEqual(['e1']);
    expect(s.translations).toEqual({
      added: ['en:intro.title'],
      removed: [],
      changed: ['tr:intro.title'],
    });
    expect(s.lines).toContain('+ page "p-offer" added');
    expect(s.lines).toContain('- variable "customerName" removed');
    expect(s.totalChanges).toBe(s.lines.length);
    expect(summarizeDiff(v1, v1).totalChanges).toBe(0);
  });

  it('produces an RFC 6902 patch that transforms v1 into v2', () => {
    const patch = jsonPatch(v1, v2);
    expect(patch.length).toBeGreaterThan(0);
    expect(applyPatch(v1, patch)).toEqual(v2);
    expect(jsonPatch(v1, structuredClone(v1))).toEqual([]);
    expect(jsonPatch({ 'a/b': 1, 't~x': 1 }, { 'a/b': 2, 't~x': 2 }).map((o) => o.path)).toEqual([
      '/a~1b',
      '/t~0x',
    ]);
  });

  it('property: applyPatch(a, jsonPatch(a, b)) equals b', () => {
    const json = fc.letrec((tie) => ({
      value: fc.oneof(
        { depthSize: 'small' },
        fc.integer(),
        fc.string({ maxLength: 4 }),
        fc.boolean(),
        fc.constant(null),
        fc.array(tie('value'), { maxLength: 4 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), tie('value'), { maxKeys: 4 }),
      ),
    })).value;
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), json, { maxKeys: 5 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), json, { maxKeys: 5 }),
        (a, b) => {
          expect(applyPatch(a, jsonPatch(a, b))).toEqual(b);
        },
      ),
      { numRuns: 400, seed: 2026 },
    );
  });
});

describe('screen composition', () => {
  const fragment = {
    pages: [{ id: 'p-kyc', name: 'KYC', layout: { id: 'kyc-root', type: 'box' } }],
    variables: [{ id: 'nationalIdVerified', type: 'boolean' }],
    dataSources: [],
    messages: { tr: { 'kyc.title': 'Kimlik doğrulama' } },
  };
  const doc = {
    pages: [{ id: 'p-intro', name: 'Intro', layout: { id: 'root', type: 'box' } }],
    variables: [],
    dataSources: [],
    i18n: { defaultLocale: 'tr', messages: { tr: {} } },
  };

  it('linked: adds pages, variables and messages; re-materializes on change', () => {
    const first = composeDocument(doc, [{ sharedScreenKey: 'kyc', mode: 'linked', fragment }]);
    expect(first.conflicts).toEqual([]);
    expect((first.document['pages'] as { id: string }[]).map((p) => p.id)).toEqual([
      'p-intro',
      'p-kyc',
    ]);
    expect(first.pageIds.get('kyc')).toEqual(['p-kyc']);
    expect(
      (first.document['i18n'] as { messages: Record<string, Record<string, string>> }).messages[
        'tr'
      ],
    ).toEqual({ 'kyc.title': 'Kimlik doğrulama' });
    // The designer edited the linked page; the next composition restores the shared version.
    const edited = {
      ...first.document,
      pages: [
        (first.document['pages'] as object[])[0],
        { id: 'p-kyc', name: 'hacked', layout: {} },
      ],
    };
    const again = composeDocument(edited, [{ sharedScreenKey: 'kyc', mode: 'linked', fragment }]);
    expect((again.document['pages'] as { id: string; name: string }[])[1]?.name).toBe('KYC');
  });

  it('detached: copies once; afterwards the script copy wins', () => {
    const edited = { ...doc, pages: [...doc.pages, { id: 'p-kyc', name: 'mine', layout: {} }] };
    const result = composeDocument(edited, [
      { sharedScreenKey: 'kyc', mode: 'detached', fragment },
    ]);
    expect((result.document['pages'] as { name: string }[])[1]?.name).toBe('mine');
  });

  it('reports conflicts: differing variable, two screens claiming one page, linked translation clash', () => {
    const clash = {
      ...doc,
      variables: [{ id: 'nationalIdVerified', type: 'string' }],
      i18n: { defaultLocale: 'tr', messages: { tr: { 'kyc.title': 'other' } } },
    };
    const result = composeDocument(clash, [
      { sharedScreenKey: 'kyc', mode: 'linked', fragment },
      {
        sharedScreenKey: 'kyc2',
        mode: 'linked',
        fragment: { ...fragment, variables: [], messages: {} },
      },
    ]);
    expect(result.conflicts.map((c) => `${c.kind}:${c.id}:${c.sharedScreenKey}`).sort()).toEqual([
      'page:p-kyc:kyc2',
      'translation:tr:kyc.title:kyc',
      'variable:nationalIdVerified:kyc',
    ]);
  });

  it('does not mutate its input and extracts fragments back', () => {
    const copy = structuredClone(doc);
    const composed = composeDocument(doc, [{ sharedScreenKey: 'kyc', mode: 'linked', fragment }]);
    expect(doc).toEqual(copy);
    const extracted = extractFragment(
      {
        ...composed.document,
        pages: [{ ...fragment.pages[0], ref: 'vars.nationalIdVerified', label: 'kyc.title' }],
      },
      ['p-kyc'],
    );
    expect(extracted.variables.map((v) => v['id'])).toEqual(['nationalIdVerified']);
    expect(extracted.messages['tr']).toEqual({ 'kyc.title': 'Kimlik doğrulama' });
    expect(() => extractFragment(doc, ['nope'])).toThrow();
  });
});

// Loose JSON shape for tamper tests (fields are mutated by path).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only mutation of parsed JSON
type Mutable = any;

describe('.verbis packages', () => {
  const key = (kid: string) => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
      priv: JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid }),
      pub: { ...publicKey.export({ format: 'jwk' }), kid },
    };
  };
  const dev = key('dev');
  const prod = key('prod');
  const checksum = (_kind: string, content: Record<string, unknown>) =>
    sha256Hex(canonicalJson(content));
  const payload: PackagePayload = {
    scripts: [
      {
        name: 'Card sales',
        description: null,
        tags: [],
        semver: '1.2.0',
        changeNote: 'offer page',
        document: { a: 1 },
        checksum: sha256Hex(canonicalJson({ a: 1 })),
        sharedScreens: [],
      },
    ],
    sharedScreens: [],
  };
  const manifest = {
    packageId: 'pkg-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'user:u',
    sourceEnvironment: 'dev',
    targetEnvironments: ['test', 'prod'],
  };
  const devKeys = PackageKeys.from(dev.priv, undefined);
  const prodTrustsDev = PackageKeys.from(prod.priv, JSON.stringify({ keys: [dev.pub] }));

  it('round-trips between environments that trust each other', () => {
    const pkg = buildPackage(manifest, payload, devKeys);
    expect(pkg.manifest.items).toEqual([
      {
        kind: 'script',
        name: 'Card sales',
        semver: '1.2.0',
        checksum: payload.scripts[0]!.checksum,
      },
    ]);
    const verified = verifyPackage(
      JSON.parse(JSON.stringify(pkg)),
      prodTrustsDev,
      checksum,
      'prod',
    );
    expect(verified.payload).toEqual(payload);
  });

  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- mutating parsed JSON */
  const tamperCases: [
    string,
    (p: Record<string, Mutable>) => void,
    PackageVerificationError['reason'],
  ][] = [
    [
      'document edited',
      (p) => {
        p['payload'].scripts[0].document.a = 2;
      },
      'checksum',
    ],
    [
      'document + its checksum edited',
      (p) => {
        p['payload'].scripts[0].document.a = 2;
        p['payload'].scripts[0].checksum = sha256Hex(canonicalJson({ a: 2 }));
      },
      'checksum',
    ],
    [
      'manifest edited',
      (p) => {
        p['manifest'].sourceEnvironment = 'prod';
      },
      'signature',
    ],
    [
      'payload checksum recomputed',
      (p) => {
        p['payload'].scripts[0].semver = '9.9.9';
        p['checksums'].payload = sha256Hex(canonicalJson(p['payload']));
      },
      'signature',
    ],
    [
      'signature replaced',
      (p) => {
        p['signature'].value = p['signature'].value.replace(/^./, (c: string) =>
          c === 'A' ? 'B' : 'A',
        );
      },
      'signature',
    ],
    [
      'unknown signer',
      (p) => {
        p['signature'].kid = 'evil';
      },
      'untrusted_key',
    ],
    [
      'not a package',
      (p) => {
        p['format'] = 'zip';
      },
      'format',
    ],
  ];
  /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
  it.each(tamperCases)('rejects: %s', (_name, mutate, reason) => {
    const pkg = JSON.parse(JSON.stringify(buildPackage(manifest, payload, devKeys))) as Record<
      string,
      Mutable
    >;
    mutate(pkg);
    try {
      verifyPackage(pkg, prodTrustsDev, checksum, 'prod');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PackageVerificationError);
      expect((error as PackageVerificationError).reason).toBe(reason);
    }
  });

  it('rejects packages from untrusted environments and for other targets', () => {
    const pkg = buildPackage(manifest, payload, devKeys);
    expect(() => verifyPackage(pkg, PackageKeys.from(prod.priv, undefined), checksum)).toThrow(
      /untrusted/,
    );
    expect(() => verifyPackage(pkg, prodTrustsDev, checksum, 'staging')).toThrow(
      /not meant for staging/,
    );
    expect(() => PackageKeys.from(JSON.stringify(dev.pub), undefined)).toThrow(/private/);
    expect(() => buildPackage(manifest, payload, PackageKeys.from(undefined, undefined))).toThrow(
      /no package signing key/,
    );
  });
});
