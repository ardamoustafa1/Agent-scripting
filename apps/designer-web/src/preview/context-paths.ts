import type {
  JsonValue,
  PreviewContextSchema,
  ScriptDocument,
  VariableType,
} from '@verbis/script-schema';

export type PreviewContext = ReturnType<typeof PreviewContextSchema.parse>;

/** A call-data field the script reads: a variable pre-filled from `interaction.*`, `agent.*`… */
export interface ExpectedField {
  readonly variable: string;
  readonly path: string;
  readonly type: VariableType;
  readonly sensitive: boolean;
}
const ROOTS = new Set(['interaction', 'agent', 'campaign']);

/** Fields to offer in the preview so authors fill test call data without writing JSON. */
export function expectedFields(document: ScriptDocument): ExpectedField[] {
  return document.variables.flatMap((variable) => {
    const root = variable.source?.split('.')[0];
    return variable.source && root && ROOTS.has(root)
      ? [
          {
            variable: variable.key,
            path: variable.source,
            type: variable.type,
            sensitive:
              variable.pii ||
              variable.classification === 'pii' ||
              variable.classification === 'pci',
          },
        ]
      : [];
  });
}

export function readPath(context: PreviewContext, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = context;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = current[part];
  }
  return current;
}

/** Copy of `context` with `value` at the dotted path; missing objects along the way are created. */
export function writePath(context: PreviewContext, path: string, value: JsonValue): PreviewContext {
  const next = structuredClone(context) as unknown as Record<string, JsonValue>;
  const parts = path.split('.');
  let current: Record<string, JsonValue> = next;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) current[part] = {};
    current = current[part] as Record<string, JsonValue>;
  }
  const last = parts.at(-1);
  if (last) current[last] = value;
  return next as unknown as PreviewContext;
}

/** True when an object holds only text/number/boolean values, i.e. fits a key–value editor. */
export function isFlatRecord(
  value: JsonValue | undefined,
): value is Record<string, string | number | boolean | null> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => item === null || typeof item !== 'object')
  );
}

/**
 * Untyped mock values (an output no variable receives) are typed as written: a plain number
 * such as `720` is a number, so `ds.score.value >= 650` works in the preview as it would with
 * the real service, and `true`/`false` are yes/no. Leading zeros (`00123`) stay text; quotes
 * force text (`"720"`).
 */
export function parseScalar(text: string): JsonValue {
  const quoted = /^"(.*)"$/s.exec(text);
  if (quoted) return quoted[1] ?? '';
  if (text === '') return null;
  if (text === 'true' || text === 'false') return text === 'true';
  return /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(text) ? Number(text) : text;
}
/** The text an untyped mock field shows for a value, so that parsing it again is lossless. */
export function formatScalar(value: JsonValue | undefined): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return '';
  return parseScalar(value) === value ? value : `"${value}"`;
}
