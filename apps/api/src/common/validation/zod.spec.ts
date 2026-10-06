import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ValidationError } from '../errors/domain-errors.js';

import { issuePointer, ZodValidationPipe } from './zod.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.strictObject({ name: z.string().min(1), tags: z.array(z.string()) }),
    'body',
  );

  it('returns parsed output', () => {
    expect(pipe.transform({ name: 'x', tags: [] })).toEqual({ name: 'x', tags: [] });
  });

  it('maps issues to JSON Pointers with stable codes', () => {
    try {
      pipe.transform({ name: '', tags: [1], extra: true });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const errors = (error as ValidationError).errors ?? [];
      expect(errors.map((issue) => [issue.path, issue.code])).toEqual(
        expect.arrayContaining([
          ['/body/name', 'too_small'],
          ['/body/tags/0', 'invalid_type'],
          ['/body', 'unrecognized_keys'],
        ]),
      );
    }
  });

  it('escapes pointer segments', () => {
    expect(issuePointer(['a/b', 'c~d', 0])).toBe('/a~1b/c~0d/0');
  });
});
