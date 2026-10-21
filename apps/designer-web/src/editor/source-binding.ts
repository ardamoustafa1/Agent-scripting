import { IdentifierSchema, type Value, type VariableType } from '@verbis/script-schema';

/**
 * Data source binding without JSON: the integration's input/output JSON Schemas become rows the
 * author fills ("tracking number ← trackingNo", "status → shipmentStatus").
 */
export interface SchemaField {
  /** JSONPath under the response (`$.data.status`) or the input name for inputs. */
  readonly path: string;
  /** Last segment, shown to the author. */
  readonly name: string;
  readonly type: VariableType;
  readonly required: boolean;
}
const MAX_DEPTH = 3;

function typeOf(schema: unknown): VariableType {
  const type: unknown =
    schema !== null && typeof schema === 'object' ? Reflect.get(schema, 'type') : undefined;
  const value: unknown = Array.isArray(type) ? type.find((t: unknown) => t !== 'null') : type;
  switch (value) {
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return schema !== null &&
        typeof schema === 'object' &&
        Reflect.get(schema, 'format') === 'date'
        ? 'date'
        : 'string';
  }
}
function properties(schema: unknown): [string, unknown][] {
  if (schema === null || typeof schema !== 'object') return [];
  const props: unknown = Reflect.get(schema, 'properties');
  return props !== null && typeof props === 'object'
    ? Object.entries(props as Record<string, unknown>)
    : [];
}
function requiredOf(schema: unknown): string[] {
  const required: unknown =
    schema !== null && typeof schema === 'object' ? Reflect.get(schema, 'required') : [];
  return Array.isArray(required)
    ? required.filter((v: unknown): v is string => typeof v === 'string')
    : [];
}
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Response fields, nested objects flattened to dotted JSONPaths (three levels deep). */
export function responseFields(schema: unknown, base = '$', depth = 0): SchemaField[] {
  const required = requiredOf(schema);
  return properties(schema).flatMap(([name, child]) => {
    if (!SEGMENT.test(name)) return [];
    const path = `${base}.${name}`;
    const type = typeOf(child);
    if (type === 'object' && depth + 1 < MAX_DEPTH && properties(child).length)
      return responseFields(child, path, depth + 1);
    return [{ path, name, type, required: required.includes(name) }];
  });
}
/** Inputs the integration declares; only identifier names can be bound by a script. */
export function inputFields(schema: unknown): SchemaField[] {
  const required = requiredOf(schema);
  return properties(schema).flatMap(([name, child]) =>
    IdentifierSchema.safeParse(name).success
      ? [{ path: name, name, type: typeOf(child), required: required.includes(name) }]
      : [],
  );
}

const normalize = (value: string) => value.toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
/** A variable whose name matches the input (`trackingNo` ↔ `tracking_no`), as a binding. */
export function suggestInput(name: string, variables: readonly string[]): Value | undefined {
  const match = variables.find((key) => normalize(key) === normalize(name));
  return match ? { $expr: `vars.${match}` } : undefined;
}

/** Output id for a response path: its last segment in camelCase, unique among `taken`. */
export function outputId(path: string, taken: Iterable<string>): string {
  const last = path.split('.').at(-1) ?? 'value';
  const words = last.split(/_+/).filter(Boolean);
  let base = words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('')
    .replace(/[^A-Za-z0-9]/g, '');
  if (!/^[a-z]/.test(base)) base = `field${base}`;
  const used = new Set(taken);
  let id = base,
    n = 2;
  while (used.has(id)) id = `${base}${String(n++)}`;
  return id;
}
