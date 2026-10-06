import { z } from 'zod';

import { children, parseExpression } from './parser.js';
import { createDefaultRegistry, type FunctionRegistry } from './registry.js';
import { Budget } from './runtime.js';
import { valueType, type Ast, type ValueType } from './types.js';

export interface SchemaField {
  type: ValueType;
  nullable?: boolean | undefined;
  properties?: Record<string, SchemaField> | undefined;
  items?: SchemaField | undefined;
  description?: string | undefined;
}
export const SchemaFieldSchema: z.ZodType<SchemaField> = z.lazy(() =>
  z.strictObject({
    type: z.enum(['null', 'boolean', 'number', 'string', 'array', 'object', 'unknown']),
    nullable: z.boolean().optional(),
    properties: z.record(z.string(), SchemaFieldSchema).optional(),
    items: SchemaFieldSchema.optional(),
    description: z.string().max(256).optional(),
  }),
);
export const ContextSchema = z.record(z.string(), SchemaFieldSchema);
export type ContextShape = Record<string, SchemaField>;
export interface Diagnostic {
  code: string;
  position: number;
  expected?: ValueType;
  actual?: ValueType;
}
export interface Analysis {
  ast: Ast;
  dependencies: string[];
  type: ValueType;
  diagnostics: Diagnostic[];
}
export function accessPath(node: Ast): string | undefined {
  if (node.kind === 'identifier') return node.name;
  if (
    node.kind === 'member' &&
    node.property.kind === 'literal' &&
    (typeof node.property.value === 'string' || typeof node.property.value === 'number')
  ) {
    const parent = accessPath(node.object);
    return parent === undefined ? undefined : `${parent}.${String(node.property.value)}`;
  }
  return undefined;
}
export function analyzeExpression(
  source: string,
  inputSchema: ContextShape = {},
  registry: FunctionRegistry = createDefaultRegistry(),
): Analysis {
  const schema = ContextSchema.parse(new Budget().snapshot(inputSchema));
  const ast = parseExpression(source);
  const dependencies = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  const infer = (
    node: Ast,
    locals: ReadonlyMap<string, SchemaField>,
    track = true,
  ): SchemaField => {
    const issue = (code: string, expected?: ValueType, actual?: ValueType) =>
      diagnostics.push({
        code,
        position: node.position,
        ...(expected ? { expected } : {}),
        ...(actual ? { actual } : {}),
      });
    const requireType = (actual: ValueType, expected: ValueType) => {
      if (actual !== 'unknown' && expected !== 'unknown' && actual !== expected)
        issue('TYPE_MISMATCH', expected, actual);
    };
    const run = (child: Ast) => infer(child, locals);
    switch (node.kind) {
      case 'literal':
        return { type: valueType(node.value) };
      case 'identifier': {
        const local = locals.get(node.name);
        if (local) return local;
        if (track) dependencies.add(node.name);
        const field = schema[node.name];
        if (!field) issue('UNKNOWN_IDENTIFIER');
        return field ?? { type: 'unknown' };
      }
      case 'member': {
        const path = accessPath(node);
        const base = infer(node.object, locals, track && accessPath(node.object) === undefined);
        if (path && !locals.has(path.split('.')[0] ?? '')) {
          if (track) dependencies.add(path);
        } else if (track) {
          const dynamic = accessPath(node.object);
          if (dynamic && !locals.has(dynamic.split('.')[0] ?? '')) dependencies.add(`${dynamic}.*`);
          run(node.property);
        }
        if (node.property.kind !== 'literal') return base.items ?? { type: 'unknown' };
        if (typeof node.property.value !== 'string' && typeof node.property.value !== 'number') {
          issue('PROPERTY_INVALID');
          return { type: 'unknown' };
        }
        const name = String(node.property.value);
        if (name === 'length' && ['array', 'string'].includes(base.type)) return { type: 'number' };
        if (base.type === 'array') return base.items ?? { type: 'unknown' };
        if (base.type === 'string') return { type: 'string' };
        const field = base.properties?.[name];
        if (!field && base.type !== 'unknown') issue('UNKNOWN_PROPERTY');
        return field ?? { type: 'unknown' };
      }
      case 'array': {
        const items = node.items.map(run);
        const first = items[0];
        return {
          type: 'array',
          items:
            first && items.every((item) => item.type === first.type) ? first : { type: 'unknown' },
        };
      }
      case 'object':
        return {
          type: 'object',
          properties: Object.fromEntries(
            node.entries.map((entry) => [entry.key, run(entry.value)]),
          ),
        };
      case 'lambda':
        return infer(node.body, new Map(locals).set(node.parameter, { type: 'unknown' }));
      case 'unary': {
        const type = run(node.operand).type;
        if (node.operator !== '!') requireType(type, 'number');
        return { type: node.operator === '!' ? 'boolean' : 'number' };
      }
      case 'conditional': {
        requireType(run(node.condition).type, 'boolean');
        const yes = run(node.yes);
        const no = run(node.no);
        return yes.type === no.type ? yes : { type: 'unknown' };
      }
      case 'binary': {
        const left = run(node.left);
        const right = run(node.right);
        if (['==', '!=', '===', '!==', '<', '>', '<=', '>=', 'in'].includes(node.operator)) {
          if (node.operator === 'in') requireType(right.type, 'array');
          else if (
            left.type !== right.type &&
            left.type !== 'null' &&
            right.type !== 'null' &&
            left.type !== 'unknown' &&
            right.type !== 'unknown'
          )
            issue('TYPE_MISMATCH', left.type, right.type);
          return { type: 'boolean' };
        }
        if (['&&', '||'].includes(node.operator)) {
          requireType(left.type, 'boolean');
          requireType(right.type, 'boolean');
          return { type: 'boolean' };
        }
        if (node.operator === '??') return left.type === 'null' ? right : left;
        if (node.operator === '+' && left.type === 'string' && right.type === 'string')
          return { type: 'string' };
        requireType(left.type, 'number');
        requireType(right.type, 'number');
        return { type: 'number' };
      }
      case 'call': {
        let fn;
        try {
          fn = registry.get(node.name);
        } catch {
          issue('UNKNOWN_FUNCTION');
          node.args.forEach(run);
          return { type: 'unknown' };
        }
        if (node.args.length < fn.minArgs || node.args.length > fn.maxArgs) issue('ARGUMENT_COUNT');
        let collection: SchemaField | undefined;
        for (let i = 0; i < node.args.length; i++) {
          const arg = node.args[i];
          if (!arg) continue;
          if (arg.kind === 'lambda') {
            if (!fn.lambdaAt?.includes(i)) issue('LAMBDA_NOT_ALLOWED');
            const result = infer(
              arg.body,
              new Map(locals).set(arg.parameter, collection?.items ?? { type: 'unknown' }),
            );
            if (['filter', 'find', 'any', 'all'].includes(node.name))
              requireType(result.type, 'boolean');
            if (node.name === 'sum') requireType(result.type, 'number');
            if (node.name === 'map') return { type: 'array', items: result };
          } else {
            const actual = run(arg);
            if (i === 0) collection = actual;
            requireType(actual.type, fn.parameters[i] ?? 'unknown');
          }
        }
        if (node.name === 'filter') return collection ?? { type: 'array' };
        if (node.name === 'find') return collection?.items ?? { type: 'unknown' };
        if (node.name === 'if') {
          const yes = node.args[1];
          const no = node.args[2];
          if (yes && no) {
            const y = run(yes);
            const n = run(no);
            return y.type === n.type ? y : { type: 'unknown' };
          }
        }
        return { type: fn.returns };
      }
    }
  };
  const type = infer(ast, new Map()).type;
  return { ast, type, dependencies: [...dependencies].sort(), diagnostics };
}
/** Dependency extraction can run without a designer schema. */
export const extractDependencies = (source: string): string[] =>
  analyzeExpression(source).dependencies;
export interface Completion {
  label: string;
  insertText: string;
  type: ValueType;
  kind: 'variable' | 'function';
  description?: string;
}
export function completions(
  schema: ContextShape,
  prefix = '',
  registry: FunctionRegistry = createDefaultRegistry(),
): Completion[] {
  const parsed = ContextSchema.parse(new Budget().snapshot(schema));
  const result: Completion[] = [];
  const walk = (fields: ContextShape, parent: string) => {
    for (const [name, field] of Object.entries(fields)) {
      const path = parent ? `${parent}.${name}` : name;
      if (path.startsWith(prefix))
        result.push({
          label: path,
          insertText: path,
          type: field.type,
          kind: 'variable',
          ...(field.description ? { description: field.description } : {}),
        });
      if (field.properties) walk(field.properties, path);
    }
  };
  walk(parsed, '');
  for (const fn of registry.list())
    if (fn.name.startsWith(prefix))
      result.push({
        label: fn.name,
        insertText: `${fn.name}()`,
        type: fn.returns,
        kind: 'function',
      });
  return result.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}
export const analyze = analyzeExpression;
export { children };
