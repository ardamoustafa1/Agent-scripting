import { describe, expect, it } from 'vitest';

import { BUILTIN_COMPONENT_TYPES, CORE_PRIMITIVE_TYPES } from './components.js';
import { IdentifierSchema, ScriptIdSchema } from './ids.js';
import { cloneJson, utf8ByteLength } from './json.js';
import { fromPointer, toPointer } from './pointer.js';

describe('JSON Pointer', () => {
  it('escapes and round-trips (RFC 6901)', () => {
    const segments = ['pages', 0, 'a/b', 'c~d', ''];
    const pointer = toPointer(segments);
    expect(pointer).toBe('/pages/0/a~1b/c~0d/');
    expect(fromPointer(pointer)).toEqual(['pages', '0', 'a/b', 'c~d', '']);
    expect(toPointer([])).toBe('');
    expect(fromPointer('')).toEqual([]);
  });

  it('rejects pointers without a leading slash', () => {
    expect(() => fromPointer('pages/0')).toThrow('Invalid JSON Pointer');
  });
});

describe('json helpers', () => {
  it('deep-clones JSON', () => {
    const value = { a: [1, { b: 'c' }] };
    const copy = cloneJson(value);
    expect(copy).toEqual(value);
    expect(copy.a).not.toBe(value.a);
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('ş')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

describe('ids', () => {
  it('validates identifiers and UUIDv7 script ids', () => {
    expect(IdentifierSchema.safeParse('customerName').success).toBe(true);
    expect(IdentifierSchema.safeParse('customer-name').success).toBe(false);
    expect(ScriptIdSchema.safeParse('01928f3a-0000-7000-8000-000000000001').success).toBe(true);
    expect(ScriptIdSchema.safeParse('7c9e6679-7425-40de-944b-e07fc1f90ae7').success).toBe(false);
  });
});

describe('components', () => {
  it('includes the core primitives', () => {
    expect(BUILTIN_COMPONENT_TYPES).toEqual(expect.arrayContaining([...CORE_PRIMITIVE_TYPES]));
  });
});
