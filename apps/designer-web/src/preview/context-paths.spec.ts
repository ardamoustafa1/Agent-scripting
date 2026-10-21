import { expect, it } from 'vitest';

import { PreviewContextSchema, ScriptDocumentSchema, VariableSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import {
  expectedFields,
  formatScalar,
  isFlatRecord,
  parseScalar,
  readPath,
  writePath,
} from './context-paths.js';

it('lists variables filled from call data with their path, type and sensitivity', () => {
  const doc = ScriptDocumentSchema.parse(minimalScript());
  doc.variables.push(
    VariableSchema.parse({
      key: 'ani',
      type: 'string',
      scope: 'session',
      source: 'interaction.ani',
    }),
    VariableSchema.parse({
      key: 'tckn',
      type: 'string',
      scope: 'session',
      classification: 'pii',
      source: 'interaction.attributes.tckn',
    }),
    VariableSchema.parse({ key: 'plain', type: 'number', scope: 'session', default: 0 }),
  );
  expect(expectedFields(doc)).toEqual([
    { variable: 'ani', path: 'interaction.ani', type: 'string', sensitive: false },
    { variable: 'tckn', path: 'interaction.attributes.tckn', type: 'string', sensitive: true },
  ]);
});
it('reads and writes nested paths without touching the original context', () => {
  const context = PreviewContextSchema.parse({ interaction: { channel: 'voice' } });
  const next = writePath(context, 'interaction.attributes.customerNo', 'C-1');
  expect(readPath(next, 'interaction.attributes.customerNo')).toBe('C-1');
  expect(readPath(next, 'interaction.channel')).toBe('voice');
  expect(readPath(context, 'interaction.attributes.customerNo')).toBeUndefined();
  expect(readPath(next, 'interaction.channel.deeper')).toBeUndefined();
});
it('recognizes flat records that fit a field/value editor', () => {
  expect(isFlatRecord({ a: '1', b: 2, c: true, d: null })).toBe(true);
  expect(isFlatRecord({ nested: { a: 1 } })).toBe(false);
  expect(isFlatRecord(['a'])).toBe(false);
  expect(isFlatRecord(undefined)).toBe(false);
});

it('types untyped mock values as written and round-trips them through the field text', () => {
  expect(parseScalar('720')).toBe(720);
  expect(parseScalar('-12.5')).toBe(-12.5);
  expect(parseScalar('0')).toBe(0);
  expect(parseScalar('false')).toBe(false);
  // Identifiers with leading zeros, partial numbers and quoted digits stay text.
  expect(parseScalar('00123')).toBe('00123');
  expect(parseScalar('1.')).toBe('1.');
  expect(parseScalar('"720"')).toBe('720');
  expect(parseScalar('""')).toBe('');
  expect(parseScalar('Gold')).toBe('Gold');
  expect(parseScalar('')).toBeNull();
  for (const value of [720, -12.5, '720', '00123', 'Gold', '"', '"x', true, 'true'])
    expect(parseScalar(formatScalar(value))).toEqual(value);
  expect(formatScalar('720')).toBe('"720"');
  expect(formatScalar(null)).toBe('');
  expect(formatScalar({ nested: 1 })).toBe('');
});
