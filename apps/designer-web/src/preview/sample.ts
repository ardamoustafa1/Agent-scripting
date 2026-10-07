import type { JsonValue } from '@verbis/script-schema';

/**
 * Deterministic synthetic sample of a JSON Schema (DIFFERENTIATORS B4): the schema's own example,
 * default, const or first enum value when it has one, otherwise a typed placeholder. Values are
 * obviously synthetic (example.com, fixed dates) and never resemble real personal data.
 */
export function sampleFromSchema(schema: unknown, depth = 0): JsonValue {
  if (depth > 6 || schema === null || typeof schema !== 'object' || Array.isArray(schema))
    return null;
  const node = schema as Record<string, unknown>;
  for (const key of ['const', 'example', 'default'] as const)
    if (key in node) return clean(node[key]);
  if (Array.isArray(node['examples']) && node['examples'].length > 0)
    return clean(node['examples'][0]);
  if (Array.isArray(node['enum']) && node['enum'].length > 0) return clean(node['enum'][0]);
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const options = node[key];
    if (Array.isArray(options) && options.length > 0) {
      if (key !== 'allOf') return sampleFromSchema(options[0], depth + 1);
      return Object.assign(
        {},
        ...options.map((option) => {
          const part = sampleFromSchema(option, depth + 1);
          return part && typeof part === 'object' && !Array.isArray(part) ? part : {};
        }),
      ) as JsonValue;
    }
  }
  const type = Array.isArray(node['type'])
    ? (node['type'] as unknown[]).find((candidate) => candidate !== 'null')
    : node['type'];
  switch (type ?? (node['properties'] ? 'object' : node['items'] ? 'array' : undefined)) {
    case 'object': {
      const properties =
        node['properties'] && typeof node['properties'] === 'object'
          ? (node['properties'] as Record<string, unknown>)
          : {};
      return Object.fromEntries(
        Object.entries(properties).map(([name, child]) => [
          name,
          sampleFromSchema(child, depth + 1),
        ]),
      );
    }
    case 'array':
      return [sampleFromSchema(node['items'], depth + 1)];
    case 'integer':
    case 'number': {
      const minimum = typeof node['minimum'] === 'number' ? node['minimum'] : undefined;
      const maximum = typeof node['maximum'] === 'number' ? node['maximum'] : undefined;
      const value = minimum ?? (maximum !== undefined ? Math.min(1, maximum) : 1);
      return type === 'integer' ? Math.ceil(value) : value;
    }
    case 'boolean':
      return true;
    case 'string':
      switch (node['format']) {
        case 'email':
          return 'customer@example.com';
        case 'date':
          return '2026-01-15';
        case 'date-time':
          return '2026-01-15T09:00:00Z';
        case 'uuid':
          return '00000000-0000-4000-8000-000000000000';
        case 'uri':
        case 'url':
          return 'https://example.com/';
        default:
          return 'sample';
      }
    default:
      return null;
  }
}

function clean(value: unknown): JsonValue {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as JsonValue);
}
