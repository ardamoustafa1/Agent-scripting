import { describe, expect, it } from 'vitest';

import { scriptDocumentJsonSchema } from '../json-schema.js';
import { ACTION_TYPES } from '../schema/actions.js';
import { validateScriptDocument } from '../validation/validate.js';

import { BROKEN_FIXTURES, VALID_FIXTURES } from './index.js';

describe('valid fixtures (acceptance)', () => {
  it.each(Object.entries(VALID_FIXTURES))(
    '%s validates with no issues at all',
    (_name, document) => {
      const result = validateScriptDocument(document);
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );

  it('cover every action type between them', () => {
    const used = new Set(
      JSON.stringify(Object.values(VALID_FIXTURES))
        .match(/"type":"[a-zA-Z]+"/g)
        ?.map((m) => m.slice(8, -1)),
    );
    expect(ACTION_TYPES.filter((type) => !used.has(type))).toEqual([]);
  });

  it('use distinct script ids', () => {
    const ids = Object.values(VALID_FIXTURES).map((doc) => doc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contain no realistic PII (phone numbers, national ids, card numbers, e-mails)', () => {
    const text = JSON.stringify(VALID_FIXTURES).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      'uuid',
    );
    expect(text).not.toMatch(/\b0?5\d{9}\b/); // TR mobile
    expect(text).not.toMatch(/\b[1-9]\d{10}\b/); // TCKN
    expect(text).not.toMatch(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/); // PAN
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // e-mail
  });
});

describe('broken fixtures (acceptance)', () => {
  it.each(BROKEN_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    '%s yields exactly its expected codes',
    (_name, fixture) => {
      const result = validateScriptDocument(fixture.document);
      // Warning-only problems (e.g. PAGE_UNREACHABLE) keep `ok: true`; everything else must fail.
      expect(result.ok).toBe(result.issues.every((issue) => issue.severity !== 'error'));
      expect([...new Set(result.issues.map((issue) => issue.code))].sort()).toEqual(
        [...fixture.expectedCodes].sort(),
      );
    },
  );

  it('every issue carries a JSON Pointer and an i18n message key', () => {
    for (const fixture of BROKEN_FIXTURES) {
      for (const issue of validateScriptDocument(fixture.document).issues) {
        expect(issue.path === '' || issue.path.startsWith('/')).toBe(true);
        expect(issue.messageKey).toMatch(/^script\.validation\.[a-zA-Z0-9]+$/);
      }
    }
  });
});

describe('JSON Schema export of fixtures', () => {
  it('describes every top-level field the fixtures use', () => {
    const properties = Object.keys(
      (scriptDocumentJsonSchema()['$defs'] as Record<string, { properties: object }>)[
        'ScriptDocument'
      ]!.properties,
    );
    for (const doc of Object.values(VALID_FIXTURES)) {
      for (const key of Object.keys(doc)) expect(properties).toContain(key);
    }
  });
});
