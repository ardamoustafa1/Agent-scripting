import { describe, expect, it } from 'vitest';

import { legacyDraftScript } from '../fixtures/legacy-draft.js';
import { minimalScript } from '../fixtures/minimal.js';

import {
  fromZodIssues,
  loadScriptDocument,
  parseScriptDocument,
  validateScriptDocument,
} from './validate.js';

import type { Migration } from '../migrations/types.js';

describe('parseScriptDocument', () => {
  it('returns the parsed document', () => {
    const result = parseScriptDocument(minimalScript());
    expect(result.ok).toBe(true);
    expect(result.document?.variables).toEqual([]);
  });

  it.each([
    [null, 'SCHEMA_VERSION_MISSING'],
    [{}, 'SCHEMA_VERSION_MISSING'],
    [{ schemaVersion: '0.9.0' }, 'SCHEMA_VERSION_UNSUPPORTED'],
    [{ schemaVersion: 2 }, 'SCHEMA_VERSION_UNSUPPORTED'],
  ])('checks the version first: %j → %s', (input, code) => {
    expect(parseScriptDocument(input).issues).toEqual([
      expect.objectContaining({ code, path: '/schemaVersion' }),
    ]);
  });

  it('maps zod issues to SCHEMA_INVALID with JSON Pointers and no zod prose', () => {
    const input = { ...minimalScript(), meta: { name: '' }, extra: true };
    const { issues } = parseScriptDocument(input);
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          severity: 'error',
          code: 'SCHEMA_INVALID',
          path: '/meta/name',
          messageKey: 'script.validation.schemaInvalid',
          params: { reason: 'too_small' },
        },
        expect.objectContaining({ path: '', params: { reason: 'unrecognized_keys' } }),
      ]),
    );
  });

  it('stringifies symbol path segments', () => {
    const symbol = Symbol('s');
    expect(
      fromZodIssues([{ code: 'custom', path: ['a', symbol, 0], message: 'x', input: undefined }])[0]
        ?.path,
    ).toBe('/a/Symbol(s)/0');
  });
});

describe('validateScriptDocument', () => {
  it('is ok with warnings only', () => {
    const doc = minimalScript();
    doc.pages.push({ id: 'spare', name: 'Spare', layout: { id: 'spare-root', type: 'box' } });
    const result = validateScriptDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual(['PAGE_UNREACHABLE']);
  });

  it('fails on semantic errors but still returns the document', () => {
    const doc = minimalScript();
    doc.flow.start = 'missing';
    const result = validateScriptDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.document).toBeDefined();
  });

  it('passes schema failures through', () => {
    expect(validateScriptDocument({ schemaVersion: '1.0.0' }).ok).toBe(false);
  });
});

describe('loadScriptDocument', () => {
  it('migrates and validates legacy documents', () => {
    const result = loadScriptDocument(legacyDraftScript);
    expect(result).toMatchObject({
      ok: true,
      migrated: ['0.9.0→1.0.0', '1.0.0→1.1.0'],
      issues: [],
    });
  });

  it('loads current documents without migrating', () => {
    expect(loadScriptDocument(minimalScript())).toMatchObject({ ok: true, migrated: [] });
  });

  it.each([
    [[1, 2], 'SCHEMA_VERSION_MISSING', undefined],
    [{ schemaVersion: '9.0.0' }, 'SCHEMA_VERSION_UNSUPPORTED', { version: '9.0.0' }],
    [{ schemaVersion: '0.1.0' }, 'SCHEMA_VERSION_UNSUPPORTED', { version: '0.1.0' }],
  ])('turns migration errors into issues: %j', (input, code, params) => {
    const [issue] = loadScriptDocument(input).issues;
    expect(issue).toMatchObject({ code, path: '/schemaVersion' });
    expect(issue?.params).toEqual(params);
  });

  it('reports failing migrations and invalid registries as MIGRATION_FAILED', () => {
    const failing: Migration = {
      from: '0.9.0',
      to: '1.0.0',
      description: 'boom',
      up: () => {
        throw new Error('boom');
      },
    };
    expect(loadScriptDocument(legacyDraftScript, { migrations: [failing] }).issues[0]?.code).toBe(
      'MIGRATION_FAILED',
    );
    expect(
      loadScriptDocument(legacyDraftScript, { migrations: [failing, failing] }).issues[0]?.code,
    ).toBe('MIGRATION_FAILED');
  });

  it('rethrows unexpected errors', () => {
    const trap = new Proxy(
      {},
      {
        get() {
          throw new TypeError('trap');
        },
      },
    );
    expect(() => loadScriptDocument(trap)).toThrow(TypeError);
  });
});
