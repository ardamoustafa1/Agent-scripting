/**
 * JSON Schema ↔ field rows for the integration editor. Authors list fields ("status · text ·
 * required"); nested objects use dotted names (`courier.name`). Leaf details the rows do not
 * show (items, enum, description…) are kept, so a round trip never loses information. Schemas the
 * rows cannot represent (oneOf, additionalProperties…) return `null` and stay in the JSON view.
 */
export type FieldKind =
  'string' | 'number' | 'integer' | 'boolean' | 'date' | 'array' | 'object' | 'any';
export interface SchemaRow {
  name: string;
  kind: FieldKind;
  required: boolean;
  /** The original leaf schema, so unknown keywords survive editing. */
  schema?: Record<string, unknown>;
}
type Json = Record<string, unknown>;
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OBJECT_KEYS = new Set([
  'type',
  'properties',
  'required',
  'title',
  'description',
  'additionalProperties',
]);
export const FIELD_KINDS: readonly FieldKind[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'array',
  'object',
];

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function kindOf(schema: Json): FieldKind {
  const type = schema['type'];
  if (type === 'string') return schema['format'] === 'date' ? 'date' : 'string';
  if (
    type === 'number' ||
    type === 'integer' ||
    type === 'boolean' ||
    type === 'array' ||
    type === 'object'
  )
    return type;
  return 'any';
}
function isPlainObject(schema: Json): boolean {
  return (
    schema['type'] === 'object' &&
    isObject(schema['properties']) &&
    Object.keys(schema).every((key) => OBJECT_KEYS.has(key))
  );
}

export function rowsFromSchema(schema: unknown): SchemaRow[] | null {
  if (!isObject(schema)) return null;
  if (Object.keys(schema).length === 0) return [];
  if (!isPlainObject(schema)) return null;
  const rows: SchemaRow[] = [];
  const walk = (node: Json, prefix: string): boolean => {
    const required = Array.isArray(node['required']) ? node['required'] : [];
    for (const [name, child] of Object.entries(node['properties'] as Json)) {
      if (!SEGMENT.test(name) || !isObject(child)) return false;
      const path = `${prefix}${name}`;
      if (isPlainObject(child) && Object.keys(child['properties'] as Json).length > 0) {
        if (!walk(child, `${path}.`)) return false;
      } else
        rows.push({
          name: path,
          kind: kindOf(child),
          required: required.includes(name),
          schema: child,
        });
    }
    return true;
  };
  return walk(schema, '') ? rows : null;
}

function leafSchema(row: SchemaRow): Json {
  const base: Json = { ...row.schema };
  if (row.kind === 'any') return base;
  if (row.kind === 'date') return { ...base, type: 'string', format: 'date' };
  Reflect.deleteProperty(base, 'format');
  if (row.kind !== 'array') Reflect.deleteProperty(base, 'items');
  if (row.kind !== 'object') Reflect.deleteProperty(base, 'properties');
  return { ...base, type: row.kind };
}

/**
 * Builds the object schema for `rows`. Object-level keywords of `original` (additionalProperties,
 * titles, required nested objects) are carried over so editing a field never drops them.
 */
export function schemaFromRows(rows: readonly SchemaRow[], original?: unknown): Json {
  const root: Json = { type: 'object', properties: {} };
  for (const row of rows) {
    const parts = row.name.split('.').filter(Boolean);
    if (!parts.length || parts.some((part) => !SEGMENT.test(part))) continue;
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const properties = node['properties'] as Json;
      const existing = properties[part];
      if (!isObject(existing) || existing['type'] !== 'object')
        properties[part] = { type: 'object', properties: {} };
      node = properties[part] as Json;
    }
    const leaf = parts.at(-1);
    if (!leaf) continue;
    (node['properties'] as Json)[leaf] = leafSchema(row);
    if (row.required)
      node['required'] = [
        ...new Set([...((node['required'] as string[] | undefined) ?? []), leaf]),
      ];
  }
  restoreObjectKeywords(root, original);
  return root;
}
function restoreObjectKeywords(built: Json, original: unknown) {
  if (!isObject(original)) return;
  for (const [key, value] of Object.entries(original))
    if (key !== 'type' && key !== 'properties' && key !== 'required') built[key] = value;
  const properties = built['properties'] as Json;
  const originalProperties = isObject(original['properties']) ? original['properties'] : {};
  const nested = Object.keys(properties).filter((name) => {
    const child = properties[name];
    return isObject(child) && child['type'] === 'object' && isObject(child['properties']);
  });
  const originalRequired = Array.isArray(original['required']) ? original['required'] : [];
  const required = [
    ...((built['required'] as string[] | undefined) ?? []),
    ...nested.filter((name) => originalRequired.includes(name)),
  ];
  if (required.length) built['required'] = [...new Set(required)];
  for (const name of nested)
    restoreObjectKeywords(properties[name] as Json, originalProperties[name]);
}

/** A row name is a dotted path of identifiers (`status`, `courier.full_name`). */
export function validFieldName(name: string): boolean {
  return name.split('.').every((part) => SEGMENT.test(part));
}

/** Example data that satisfies a schema, for mock responses and test inputs. */
export function sampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!isObject(schema) || depth > 8) return null;
  if (Array.isArray(schema['enum']) && schema['enum'].length) return schema['enum'][0];
  switch (kindOf(schema)) {
    case 'string':
      return 'örnek';
    case 'date':
      return '2026-01-01';
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return [sampleFromSchema(schema['items'], depth + 1)].filter((item) => item !== null);
    case 'object':
      return Object.fromEntries(
        Object.entries(isObject(schema['properties']) ? schema['properties'] : {}).map(
          ([key, child]) => [key, sampleFromSchema(child, depth + 1)],
        ),
      );
    default:
      return null;
  }
}
