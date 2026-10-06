import { describe, expect, it } from 'vitest';

import { defaults, importCurl, inferSchema, openApiOperations, projection } from './importers.js';

describe('integration authoring imports', () => {
  it('extracts method, origin, encoded query and JSON body without executing shell', () => {
    const value = importCurl(
      `curl -X POST 'https://api.example.com/v1/search?q=test' -H 'Content-Type: application/json' -d '{"query":"{{input.query}}"}'`,
    );
    expect(value.method).toBe('POST');
    expect(value.baseUrl).toBe('https://api.example.com');
    expect(value.query).toEqual({ q: 'test' });
    expect(value.body).toEqual({ query: '{{input.query}}' });
  });
  it.each([
    `curl https://api.example.com -H 'Authorization: Bearer synthetic'`,
    `curl https://api.example.com -u synthetic:fixture`,
    `curl https://api.example.com?api_key=synthetic`,
    'curl $(command)',
    `curl https://api.example.com -d @/file`,
  ])('rejects credential and shell imports: %s', (value) => {
    expect(() => importCurl(value)).toThrow();
  });
  it('lists OpenAPI operations and converts path parameters to input references', () => {
    const value = openApiOperations({
      openapi: '3.0.3',
      servers: [{ url: 'https://api.example.com' }],
      paths: { '/customers/{id}': { get: { operationId: 'customer' } } },
    });
    expect(value[0]?.definition.endpoint).toBe('/customers/{{input.id}}');
    expect(value[0]?.definition.method).toBe('GET');
  });
  it('resolves local OpenAPI response schemas and refuses remote references', () => {
    const spec = {
      openapi: '3.0.3',
      paths: {
        '/customer': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Customer' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: { Customer: { type: 'object', properties: { name: { type: 'string' } } } },
      },
    };
    expect(openApiOperations(spec)[0]?.definition.outputSchema).toMatchObject({ type: 'object' });
    spec.paths['/customer'].get.responses['200'].content['application/json'].schema.$ref =
      'https://remote.example.com/schema.json';
    expect(() => openApiOperations(spec)).toThrow('IMPORT_REMOTE_REF');
  });
  it('infers nested schemas and guards deeply nested input', () => {
    expect(inferSchema({ customer: { active: true }, balance: 4 })).toMatchObject({
      type: 'object',
      properties: { customer: { type: 'object' }, balance: { type: 'integer' } },
    });
    expect(() => inferSchema({}, 17)).toThrow();
  });
  it('restricts generated JSONata to validated fields and paths', () => {
    expect(projection({ customer: 'data.customer.name' })).toBe('{"customer": data.customer.name}');
    expect(() => projection({ customer: '$eval("unsafe")' })).toThrow();
    expect(defaults().policy.containsPii).toBe(true);
  });
});
