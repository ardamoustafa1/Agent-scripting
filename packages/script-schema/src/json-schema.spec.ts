import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SCRIPT_DOCUMENT_JSON_SCHEMA_ID, scriptDocumentJsonSchema } from './json-schema.js';

describe('scriptDocumentJsonSchema', () => {
  const schema = scriptDocumentJsonSchema();

  it('targets draft 2020-12 with a stable $id', () => {
    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema['$id']).toBe(SCRIPT_DOCUMENT_JSON_SCHEMA_ID);
  });

  it('exposes named definitions for the main model types', () => {
    expect(Object.keys(schema['$defs'] as object)).toEqual(
      expect.arrayContaining([
        'ScriptDocument',
        'Page',
        'Node',
        'Action',
        'Binding',
        'Variable',
        'DataSourceRef',
        'Flow',
        'FlowNode',
        'FlowEdge',
        'Rule',
        'Predicate',
      ]),
    );
  });

  it('keeps objects closed (no unknown keys)', () => {
    const defs = schema['$defs'] as Record<string, { additionalProperties?: unknown }>;
    expect(defs['Node']?.additionalProperties).toBe(false);
    expect(defs['Page']?.additionalProperties).toBe(false);
  });

  it('matches the committed schema file (run `pnpm generate:json-schema` after a schema change)', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../schema/script-document.schema.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(schema);
  });
});
