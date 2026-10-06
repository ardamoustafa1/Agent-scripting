import { z } from 'zod';

import {
  IntegrationDefinitionSchema,
  IntegrationPolicySchema,
  IntegrationSaveSchema,
  type IntegrationDefinition,
} from '@verbis/shared-types';

export function defaults() {
  return {
    key: '',
    protocol: 'rest' as const,
    definition: {
      ...z
        .strictObject({ ...IntegrationSaveSchema.shape.definition.shape, baseUrl: z.string() })
        .parse({ baseUrl: '', endpoint: '/', mock: { enabled: false, response: {} } }),
      baseUrl: '',
    },
    policy: IntegrationPolicySchema.parse({}),
  };
}
function endpoint(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new Error('IMPORT_URL');
  return {
    baseUrl: url.origin,
    endpoint: url.pathname,
    query: Object.fromEntries(url.searchParams),
  };
}
/** Tokenizes a bounded curl command; never executes shell or expands substitutions. */
export function importCurl(source: string): Partial<IntegrationDefinition> {
  if (source.length > 65536 || /[`]|\$\(|\$\{|\n\s*(?!\\)/.test(source))
    throw new Error('IMPORT_SHELL');
  const tokens =
    source
      .match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g)
      ?.map((v) => v.replace(/^(['"])(.*)\1$/, '$2')) ?? [];
  if (tokens.shift() !== 'curl') throw new Error('IMPORT_CURL');
  let url = '',
    method = 'GET',
    body: unknown;
  const headers: Record<string, string> = {};
  while (tokens.length) {
    const token = tokens.shift();
    if (token === '-X' || token === '--request') method = tokens.shift() ?? '';
    else if (token === '-H' || token === '--header') {
      const value = tokens.shift() ?? '',
        colon = value.indexOf(':');
      if (colon < 1) throw new Error('IMPORT_HEADER');
      const key = value.slice(0, colon),
        header = value.slice(colon + 1).trim();
      if (/authorization|cookie|token|secret|api.?key|password/i.test(key))
        throw new Error('IMPORT_CREDENTIAL');
      headers[key] = header;
    } else if (token === '-d' || token === '--data' || token === '--data-raw') {
      const value = tokens.shift() ?? '';
      if (value.startsWith('@')) throw new Error('IMPORT_FILE');
      body = JSON.parse(value) as unknown;
      if (method === 'GET') method = 'POST';
    } else if (token === '--url') url = tokens.shift() ?? '';
    else if (token?.startsWith('http')) url = token;
    else if (token !== '\\') throw new Error('IMPORT_OPTION');
  }
  const parsed = IntegrationDefinitionSchema.parse({
    ...defaults().definition,
    ...endpoint(url),
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  if (Object.keys(parsed.query).some((key) => /token|secret|api.?key|password/i.test(key)))
    throw new Error('IMPORT_CREDENTIAL');
  return parsed;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('IMPORT_OBJECT');
  return value as Record<string, unknown>;
}
export interface Operation {
  key: string;
  label: string;
  definition: Partial<IntegrationDefinition>;
}
function localSchema(value: unknown, document: Record<string, unknown>, depth = 0): unknown {
  if (depth > 16) throw new Error('IMPORT_REF_DEPTH');
  if (Array.isArray(value)) return value.map((v: unknown) => localSchema(v, document, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  if (typeof source['$ref'] === 'string') {
    if (!source['$ref'].startsWith('#/')) throw new Error('IMPORT_REMOTE_REF');
    let result: unknown = document;
    for (const part of source['$ref'].slice(2).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      const owner = record(result);
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(owner, key))
        throw new Error('IMPORT_REF');
      result = owner[key];
    }
    return localSchema(result, document, depth + 1);
  }
  return Object.fromEntries(
    Object.entries(source).map(([key, v]) => [key, localSchema(v, document, depth + 1)]),
  );
}
export function openApiOperations(input: unknown): Operation[] {
  const doc = record(input),
    paths = record(doc['paths']),
    operations: Operation[] = [];
  const server = Array.isArray(doc['servers']) ? record(doc['servers'][0])['url'] : undefined;
  for (const [path, methods] of Object.entries(paths))
    for (const [method, raw] of Object.entries(record(methods))) {
      if (!['get', 'head', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const operation = record(raw);
      const responses = operation['responses'] ? record(operation['responses']) : {};
      const response = responses['200'] ?? responses['201'] ?? responses['default'];
      const responseContent = response && record(response)['content'];
      const responseMedia = responseContent && record(responseContent)['application/json'];
      const outputSchema = responseMedia
        ? record(localSchema(record(responseMedia)['schema'] ?? {}, doc))
        : {};
      const parameters = Array.isArray(operation['parameters'])
        ? (operation['parameters'] as unknown[])
        : [];
      const properties: Record<string, unknown> = {};
      for (const value of parameters) {
        const param = record(localSchema(value, doc));
        if (typeof param['name'] === 'string')
          properties[param['name']] = param['schema'] ?? { type: 'string' };
      }
      const body = operation['requestBody']
        ? record(localSchema(operation['requestBody'], doc))
        : {};
      const media = body['content'] && record(body['content'])['application/json'];
      if (media) properties['body'] = record(media)['schema'] ?? {};

      operations.push({
        key: `${method}:${path}`,
        label: `${method.toUpperCase()} ${path}`,
        definition: {
          ...(typeof server === 'string' ? endpoint(server) : {}),
          endpoint: path.replace(/\{([^}]+)\}/g, '{{input.$1}}'),
          method: method.toUpperCase() as IntegrationDefinition['method'],
          inputSchema: { type: 'object', properties },
          outputSchema,
          ...(media ? { body: '{{input.body}}' } : {}),
          auth: { type: 'none' },
        },
      });
      if (operation['requestBody'] && JSON.stringify(operation['requestBody']).length > 1048576)
        throw new Error('IMPORT_SIZE');
    }
  if (operations.length > 1000) throw new Error('IMPORT_SIZE');
  return operations;
}
export function inferSchema(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 16) throw new Error('SCHEMA_DEPTH');
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return { type: 'array', items: first === undefined ? {} : inferSchema(first, depth + 1) };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 1000) throw new Error('SCHEMA_SIZE');
    return {
      type: 'object',
      properties: Object.fromEntries(
        entries.map(([key, child]) => [key, inferSchema(child, depth + 1)]),
      ),
      required: entries.map(([key]) => key),
      additionalProperties: false,
    };
  }
  return { type: typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value };
}
export function fields(value: unknown, prefix = '', depth = 0): string[] {
  if (depth > 12 || !value || typeof value !== 'object' || Array.isArray(value))
    return prefix ? [prefix] : [];
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 200)
    .flatMap(([key, child]) => fields(child, prefix ? `${prefix}.${key}` : key, depth + 1));
}
/** A generated JSONata projection restricts both field names and path syntax. */
export function projection(mapping: Record<string, string>): string {
  return `{${Object.entries(mapping)
    .map(([target, path]) => {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target) ||
        !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path)
      )
        throw new Error('MAPPING_PATH');
      return `${JSON.stringify(target)}: ${path}`;
    })
    .join(', ')}}`;
}

/** Decode only the visual mapper's literal-field/dotted-path format; never execute expressions. */
export function projectionFields(value: string): Record<string, string> | null {
  const source = value.trim();
  if (!source || source === '{}') return {};
  if (source.length > 8192 || !source.startsWith('{') || !source.endsWith('}')) return null;
  const entries: [string, string][] = [];
  for (const part of source.slice(1, -1).split(',')) {
    const match =
      /^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*$/.exec(
        part,
      );
    if (!match?.[1] || !match[2] || entries.some(([field]) => field === match[1])) return null;
    entries.push([match[1], match[2]]);
  }
  return Object.fromEntries(entries);
}
