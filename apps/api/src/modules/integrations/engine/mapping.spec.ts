import { expect, it } from 'vitest';

import {
  containsSensitiveSchema,
  mapValue,
  redact,
  scalarText,
  scrubSecrets,
  template,
  validateSchema,
} from './mapping.js';

it('maps typed request values without changing the source and enforces response schemas', async () => {
  const input = { customer: { id: 7 }, items: [2, 3] };
  expect(await mapValue(undefined, input)).toBe(input);
  expect(await mapValue('{"id": customer.id, "total": $sum(items)}', input)).toEqual({
    id: 7,
    total: 5,
  });
  const schema = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', classification: 'public' } },
    additionalProperties: false,
  };
  validateSchema(schema, { id: 7 });
  validateSchema(schema, { id: 8 });
  expect(() => {
    validateSchema(schema, { id: '7' });
  }).toThrow('SCHEMA_INVALID');
  expect(() => {
    validateSchema(schema, { id: 7, secret: 'synthetic' });
  }).toThrow('SCHEMA_INVALID');
  expect(input).toEqual({ customer: { id: 7 }, items: [2, 3] });
});

it('rejects oversized mapping output before it can become a connector response', async () => {
  await expect(mapValue('$', 'x'.repeat(1024 * 1024))).rejects.toThrow('MAPPING_BUDGET');
});

it('templates preserve JSON types and treat missing values consistently', () => {
  const input = {
    count: 3,
    enabled: false,
    profile: { public: 'visible' },
    list: [1],
    empty: null,
  };
  expect(
    template(
      {
        body: '{{profile}}',
        count: '{{count}}',
        flags: ['{{enabled}}'],
        missing: '{{missing}}',
        label: 'count={{count}}, empty={{empty}}, missing={{missing}}',
      },
      input,
    ),
  ).toEqual({
    body: input.profile,
    count: 3,
    flags: [false],
    missing: null,
    label: 'count=3, empty=, missing=',
  });
  expect(template(17, input)).toBe(17);
  expect(template('{{list.0}}', input)).toBe(1);
  expect(() => template('prefix={{profile}}', input)).toThrow('TEMPLATE_SCALAR_REQUIRED');
});

it.each(['__proto__.secret', 'constructor.name', 'profile.prototype', 'profile.constructor'])(
  'blocks prototype traversal through %s',
  (path) => {
    expect(() => template(`{{${path}}}`, { profile: {} })).toThrow('TEMPLATE_INVALID');
  },
);

it('does not resolve inherited properties or alter source objects', () => {
  const input: object = Object.create({ hidden: 'synthetic-secret' }) as object;
  expect(template('{{hidden}}', input)).toBeNull();
  expect(template('{{missing.deep}}', null)).toBeNull();
});

it('redacts classified nested paths, credential keys, email addresses and literal secrets', () => {
  const source = {
    public: 'visible',
    email: 'synthetic@example.invalid',
    items: [{ public: 'synthetic-key', detail: 42 }],
    nested: { authorization: 'Bearer synthetic-key', message: 'Contact synthetic@example.invalid' },
  };
  expect(redact(source, ['items.0.detail'], ['synthetic-key', ''])).toEqual({
    public: 'visible',
    email: '[REDACTED]',
    items: [{ public: '[REDACTED]', detail: '[REDACTED]' }],
    nested: { authorization: '[REDACTED]', message: 'Contact [REDACTED]' },
  });
  expect(
    redact({ value: 42, missing: undefined, empty: null, flags: [false] }, [], [], '', true),
  ).toEqual({ value: '[REDACTED]', missing: undefined, empty: null, flags: ['[REDACTED]'] });
  expect(source.items[0]?.detail).toBe(42);
});

it('scrubs connector credentials while retaining non-secret response types', () => {
  expect(
    scrubSecrets(
      {
        accessToken: 'hidden',
        email: 'public@example.invalid',
        items: ['contains key-123 twice key-123', 3, null, { password: 'hidden', enabled: false }],
      },
      ['key-123', ''],
    ),
  ).toEqual({
    accessToken: '[REDACTED]',
    email: 'public@example.invalid',
    items: [
      'contains [REDACTED] twice [REDACTED]',
      3,
      null,
      { password: '[REDACTED]', enabled: false },
    ],
  });
});

it.each(['pii', 'pci', 'secret', 'sensitive'])(
  'finds nested %s classification before console disclosure',
  (classification) => {
    expect(
      containsSensitiveSchema({ properties: { field: { 'x-classification': classification } } }),
    ).toBe(true);
  },
);

it('recognizes credential field names but permits public scalar schemas', () => {
  expect(containsSensitiveSchema({ properties: { api_key: { type: 'string' } } })).toBe(true);
  expect(containsSensitiveSchema({ type: 'string', classification: 'public' })).toBe(false);
  expect(containsSensitiveSchema(null)).toBe(false);
  expect(containsSensitiveSchema('public')).toBe(false);
  expect([null, undefined, false, 3, 'visible'].map(scalarText)).toEqual([
    '',
    '',
    'false',
    '3',
    'visible',
  ]);
  expect(() => scalarText([])).toThrow('TEMPLATE_SCALAR_REQUIRED');
});
