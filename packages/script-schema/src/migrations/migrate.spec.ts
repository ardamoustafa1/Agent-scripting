import { describe, expect, it } from 'vitest';

import { legacyDraftScript } from '../fixtures/legacy-draft.js';
import { ScriptDocumentSchema } from '../schema/document.js';
import { SCRIPT_SCHEMA_VERSION } from '../version.js';

import { assertMigrationRegistry, canMigrate, migrate, MIGRATIONS } from './migrate.js';
import { compareSemver } from './semver.js';
import { MigrationError, type Migration } from './types.js';

const step = (from: string, to: string, tag: string): Migration => ({
  from,
  to,
  description: tag,
  up: (doc) => ({ ...doc, trail: [...((doc['trail'] as string[] | undefined) ?? []), tag] }),
});
const chain = [
  step('0.1.0', '0.2.0', 'a'),
  step('0.2.0', '0.5.0', 'b'),
  step('0.5.0', '1.0.0', 'c'),
];

describe('compareSemver', () => {
  it('compares numerically per component', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('0.9.0', '1.0.0')).toBeLessThan(0);
    expect(compareSemver('2.0.1', '2.0.1')).toBe(0);
  });

  it('rejects malformed versions', () => {
    expect(() => compareSemver('1.0', '1.0.0')).toThrow(TypeError);
  });
});

describe('migrate', () => {
  it('runs a multi-step chain in order and stamps the version', () => {
    const result = migrate(
      { schemaVersion: '0.1.0' },
      { migrations: chain, targetVersion: '1.0.0' },
    );
    expect(result).toEqual({
      document: { schemaVersion: '1.0.0', trail: ['a', 'b', 'c'] },
      fromVersion: '0.1.0',
      toVersion: '1.0.0',
      applied: ['0.1.0→0.2.0', '0.2.0→0.5.0', '0.5.0→1.0.0'],
    });
  });

  it('starts mid-chain and stops at an intermediate target', () => {
    expect(
      migrate({ schemaVersion: '0.2.0' }, { migrations: chain, targetVersion: '1.0.0' }).applied,
    ).toEqual(['0.2.0→0.5.0', '0.5.0→1.0.0']);
    expect(
      migrate({ schemaVersion: '0.1.0' }, { migrations: chain, targetVersion: '0.5.0' }).document[
        'trail'
      ],
    ).toEqual(['a', 'b']);
  });

  it('is a no-op for current documents and never mutates the input', () => {
    const input = { schemaVersion: SCRIPT_SCHEMA_VERSION, nested: { a: 1 } };
    const result = migrate(input);
    expect(result.applied).toEqual([]);
    expect(result.document).toEqual(input);
    expect(result.document).not.toBe(input);
    const legacy = structuredClone(legacyDraftScript);
    migrate(legacy);
    expect(legacy).toEqual(legacyDraftScript);
  });

  it.each([
    ['not an object', 'x', 'SCHEMA_VERSION_MISSING'],
    ['array', [], 'SCHEMA_VERSION_MISSING'],
    ['missing version', {}, 'SCHEMA_VERSION_MISSING'],
    ['malformed version', { schemaVersion: 'v1' }, 'SCHEMA_VERSION_MISSING'],
    ['future version', { schemaVersion: '1.0.1' }, 'SCHEMA_VERSION_UNSUPPORTED'],
    ['no path', { schemaVersion: '0.3.0' }, 'SCHEMA_VERSION_UNSUPPORTED'],
  ])('rejects %s', (_label, input, code) => {
    expect(() => migrate(input, { migrations: chain, targetVersion: '1.0.0' })).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it('refuses to overshoot the target', () => {
    expect(() =>
      migrate({ schemaVersion: '0.2.0' }, { migrations: chain, targetVersion: '0.3.0' }),
    ).toThrow(expect.objectContaining({ code: 'SCHEMA_VERSION_UNSUPPORTED', version: '0.2.0' }));
  });

  it('wraps step failures with the cause', () => {
    const broken: Migration = {
      ...step('0.9.0', '1.0.0', 'x'),
      up: () => {
        throw new RangeError('bad');
      },
    };
    let error: unknown;
    try {
      migrate({ schemaVersion: '0.9.0' }, { migrations: [broken] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({
      code: 'MIGRATION_FAILED',
      name: 'MigrationError',
      version: '0.9.0',
    });
    expect((error as Error).cause).toBeInstanceOf(RangeError);
  });
});

describe('assertMigrationRegistry', () => {
  it('accepts the shipped registry', () => {
    expect(() => {
      assertMigrationRegistry(MIGRATIONS);
    }).not.toThrow();
    expect(MIGRATIONS.at(-1)?.to).toBe(SCRIPT_SCHEMA_VERSION);
  });

  it.each([
    ['invalid version', [step('1', '2.0.0', 'x')]],
    ['backwards step', [step('1.0.0', '0.9.0', 'x')]],
    ['no-op step', [step('1.0.0', '1.0.0', 'x')]],
    ['ambiguous source', [step('0.1.0', '0.2.0', 'x'), step('0.1.0', '0.3.0', 'y')]],
  ])('rejects %s', (_label, migrations) => {
    expect(() => {
      assertMigrationRegistry(migrations);
    }).toThrow(expect.objectContaining({ code: 'MIGRATION_REGISTRY_INVALID' }));
  });
});

describe('canMigrate', () => {
  it('follows the chain', () => {
    expect(canMigrate('1.0.0')).toBe(true);
    expect(canMigrate('0.9.0')).toBe(true);
    expect(canMigrate('0.8.0')).toBe(false);
    expect(canMigrate('0.1.0', { migrations: chain, targetVersion: '0.5.0' })).toBe(true);
    expect(
      canMigrate('0.1.0', {
        migrations: [step('0.1.0', '0.2.0', 'a'), step('0.2.0', '0.1.0', 'loop')],
      }),
    ).toBe(false);
  });
});

describe('0.9.0 → current', () => {
  const migrated = migrate(legacyDraftScript).document;

  it('produces a schema-valid v1 document', () => {
    expect(ScriptDocumentSchema.safeParse(migrated).success).toBe(true);
  });

  it('restructures i18n and drops draft meta fields', () => {
    expect(migrated['meta']).toEqual({ name: 'Eski Karşılama' });
    expect(migrated['i18n']).toEqual({ defaultLocale: 'tr', messages: legacyDraftScript.i18n });
  });

  it('renames scopes and actions everywhere, including nested lists', () => {
    const doc = ScriptDocumentSchema.parse(migrated);
    expect(doc.variables[0]?.scope).toBe('page');
    expect(doc.pages[0]?.onEnter[0]?.type).toBe('showToast');
    expect(doc.pages[0]?.timers[0]?.onElapsed[0]).toEqual({
      type: 'showToast',
      messageKey: 'welcome.hello',
      tone: 'warning',
    });
    const conditional = doc.pages[0]?.layout.children?.[1]?.events['onPress']?.[0];
    expect(conditional).toMatchObject({
      type: 'conditional',
      then: [{ type: 'openModal', page: 'help' }],
      else: [{ type: 'runSubflow', flow: 'farewell' }],
    });
    expect(doc.pages[1]?.layout.children?.[0]?.events['onPress']).toEqual([{ type: 'closeModal' }]);
    expect(doc.rules[0]?.then).toEqual([
      { type: 'showToast', messageKey: 'welcome.hello', tone: 'info' },
    ]);
  });

  it('is defensive about malformed input', () => {
    const up = MIGRATIONS[0]!.up;
    expect(
      up({
        meta: 'x',
        i18n: null,
        variables: 'x',
        pages: [1, { layout: 2, timers: [3], events: 4 }],
        rules: [5, { else: [{ type: 'next' }] }],
      }),
    ).toEqual({
      meta: {},
      i18n: { defaultLocale: 'tr', messages: {} },
      variables: 'x',
      pages: [1, { layout: 2, timers: [3], events: 4 }],
      rules: [5, { else: [{ type: 'next' }] }],
    });
    expect(
      up({
        i18n: { defaultLocale: 'en', messages: {} },
        pages: [
          {
            layout: { children: [7], events: { onPress: [{ action: 'sequence', actions: [8] }] } },
          },
        ],
      }),
    ).toEqual({
      meta: {},
      i18n: { defaultLocale: 'en', messages: {} },
      pages: [
        { layout: { children: [7], events: { onPress: [{ type: 'sequence', actions: [8] }] } } },
      ],
    });
  });
});

describe('1.0.0 → 1.1.0', () => {
  it('retains the old entry node and all semantic content without mutation', () => {
    const current = ScriptDocumentSchema.parse(migrate(legacyDraftScript).document);
    const old = { ...current, schemaVersion: '1.0.0' };
    const snapshot = structuredClone(old);
    const result = migrate(old);
    expect(result.applied).toEqual(['1.0.0→1.1.0']);
    expect(result.document).toEqual(current);
    expect(old).toEqual(snapshot);
  });
});
