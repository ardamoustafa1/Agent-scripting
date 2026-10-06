import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EnvValidationError, envSchemas, parseEnv } from './env.js';

const schema = z.object({
  NODE_ENV: envSchemas.nodeEnv,
  PORT: envSchemas.port,
  DATABASE_URL: envSchemas.url,
  FEATURE_X: envSchemas.boolean.default(false),
});

describe('parseEnv', () => {
  it('parses and coerces valid input', () => {
    const env = parseEnv(schema, {
      PORT: '4000',
      DATABASE_URL: 'postgresql://h:5432/db',
      FEATURE_X: '1',
    });
    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: 'postgresql://h:5432/db',
      FEATURE_X: true,
    });
  });

  it('reports every invalid variable without echoing values', () => {
    let caught: unknown;
    try {
      parseEnv(schema, { PORT: '99999', DATABASE_URL: 's3cr3t-not-a-url' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const err = caught as EnvValidationError;
    expect(err.issues.map((i) => i.split(':')[0])).toEqual(['PORT', 'DATABASE_URL']);
    expect(err.message).not.toContain('s3cr3t');
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('parses explicit boolean %s', (value, expected) => {
    expect(envSchemas.boolean.parse(value)).toBe(expected);
  });

  it('reports root validation without echoing the input', () => {
    expect(() => parseEnv(z.never(), { SECRET: 'synthetic-private' })).toThrow('(root)');
  });

  it('rejects ambiguous booleans', () => {
    expect(() =>
      parseEnv(schema, { PORT: '1', DATABASE_URL: 'http://x', FEATURE_X: 'yes' }),
    ).toThrow(EnvValidationError);
  });

  it('reads process.env by default', () => {
    expect(() => parseEnv(z.object({ PATH: z.string() }))).not.toThrow();
  });
});
