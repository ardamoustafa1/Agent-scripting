import { describe, expect, it } from 'vitest';

import {
  CORE_PRIMITIVES,
  isCorePrimitive,
  isValidNodeId,
  PRIMITIVE_DESCRIPTORS,
} from './primitives.js';

describe('core primitives', () => {
  it('exposes exactly Box, Button and WebService', () => {
    expect(CORE_PRIMITIVES).toEqual(['box', 'button', 'webService']);
  });

  it('recognizes primitives', () => {
    expect(isCorePrimitive('box')).toBe(true);
    expect(isCorePrimitive('textInput')).toBe(false);
  });

  it('has a descriptor per primitive; only box is a container', () => {
    for (const type of CORE_PRIMITIVES) {
      expect(PRIMITIVE_DESCRIPTORS[type].type).toBe(type);
    }
    expect(CORE_PRIMITIVES.filter((t) => PRIMITIVE_DESCRIPTORS[t].container)).toEqual(['box']);
  });

  it('validates node ids via script-schema', () => {
    expect(isValidNodeId('btn-submit')).toBe(true);
    expect(isValidNodeId('Btn Submit')).toBe(false);
  });
});
