/**
 * SCIM 2.0 filter parser (RFC 7644 §3.4.2.2). Strict: unknown tokens, attributes and operators
 * are rejected (`invalidFilter`), input length and nesting are bounded. The AST is compiled to a
 * Prisma `where` through an explicit attribute map, so a filter can only touch mapped columns.
 */
export type CompareOp = 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'gt' | 'ge' | 'lt' | 'le';
export type ScimValue = string | number | boolean | null;

export type FilterNode =
  | { readonly kind: 'and' | 'or'; readonly left: FilterNode; readonly right: FilterNode }
  | { readonly kind: 'not'; readonly expr: FilterNode }
  | {
      readonly kind: 'compare';
      readonly attr: string;
      readonly op: CompareOp;
      readonly value: ScimValue;
    }
  | { readonly kind: 'present'; readonly attr: string }
  | { readonly kind: 'valuePath'; readonly attr: string; readonly filter: FilterNode };

export class ScimFilterError extends Error {
  override readonly name = 'ScimFilterError';
}

export const MAX_FILTER_LENGTH = 1000;
const MAX_DEPTH = 10;
const COMPARE_OPS = new Set<string>(['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le']);
const CORE_SCHEMA = /^urn:ietf:params:scim:schemas:core:2\.0:(User|Group):/i;

type Token =
  | { type: 'word'; value: string }
  | { type: 'string'; value: string }
  | { type: '(' | ')' | '[' | ']' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i] ?? '';
    if (char === ' ' || char === '\t') {
      i += 1;
    } else if (char === '(' || char === ')' || char === '[' || char === ']') {
      tokens.push({ type: char });
      i += 1;
    } else if (char === '"') {
      let j = i + 1;
      let raw = '"';
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\') {
          raw += input.slice(j, j + 2);
          j += 2;
        } else {
          raw += input[j] ?? '';
          j += 1;
        }
      }
      if (j >= input.length) throw new ScimFilterError('unterminated string');
      raw += '"';
      try {
        tokens.push({ type: 'string', value: JSON.parse(raw) as string });
      } catch {
        throw new ScimFilterError('invalid string escape');
      }
      i = j + 1;
    } else {
      const match = /^[A-Za-z0-9:._$-]+/.exec(input.slice(i));
      if (match === null) throw new ScimFilterError(`unexpected character at ${String(i)}`);
      tokens.push({ type: 'word', value: match[0] });
      i += match[0].length;
    }
  }
  return tokens;
}

const ATTR_PATH = /^[A-Za-z][A-Za-z0-9_$-]*(\.[A-Za-z][A-Za-z0-9_$-]*)?$/;

function normalizeAttr(raw: string): string {
  const stripped = raw.replace(CORE_SCHEMA, '');
  if (!ATTR_PATH.test(stripped)) throw new ScimFilterError(`invalid attribute: ${raw}`);
  return stripped;
}

class Parser {
  #pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): FilterNode {
    const node = this.or(0);
    if (this.#pos !== this.tokens.length) throw new ScimFilterError('unexpected trailing input');
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.#pos];
  }

  private isWord(value: string): boolean {
    const token = this.peek();
    return token?.type === 'word' && token.value.toLowerCase() === value;
  }

  private or(depth: number): FilterNode {
    let left = this.and(depth);
    while (this.isWord('or')) {
      this.#pos += 1;
      left = { kind: 'or', left, right: this.and(depth) };
    }
    return left;
  }

  private and(depth: number): FilterNode {
    let left = this.unary(depth);
    while (this.isWord('and')) {
      this.#pos += 1;
      left = { kind: 'and', left, right: this.unary(depth) };
    }
    return left;
  }

  private unary(depth: number): FilterNode {
    if (depth > MAX_DEPTH) throw new ScimFilterError('filter nested too deeply');
    if (this.isWord('not')) {
      this.#pos += 1;
      if (this.peek()?.type !== '(') throw new ScimFilterError('not must be followed by (');
      return { kind: 'not', expr: this.group(depth + 1) };
    }
    if (this.peek()?.type === '(') return this.group(depth + 1);
    return this.attrExpression(depth);
  }

  private group(depth: number): FilterNode {
    this.#pos += 1;
    const node = this.or(depth);
    if (this.peek()?.type !== ')') throw new ScimFilterError('missing )');
    this.#pos += 1;
    return node;
  }

  private attrExpression(depth: number): FilterNode {
    const token = this.peek();
    if (token?.type !== 'word') throw new ScimFilterError('attribute expected');
    this.#pos += 1;
    const attr = normalizeAttr(token.value);
    if (this.peek()?.type === '[') {
      this.#pos += 1;
      const filter = this.or(depth + 1);
      if (this.peek()?.type !== ']') throw new ScimFilterError('missing ]');
      this.#pos += 1;
      return { kind: 'valuePath', attr, filter };
    }
    const opToken = this.peek();
    if (opToken?.type !== 'word') throw new ScimFilterError('operator expected');
    const op = opToken.value.toLowerCase();
    this.#pos += 1;
    if (op === 'pr') return { kind: 'present', attr };
    if (!COMPARE_OPS.has(op)) throw new ScimFilterError(`unknown operator: ${opToken.value}`);
    return { kind: 'compare', attr, op: op as CompareOp, value: this.value() };
  }

  private value(): ScimValue {
    const token = this.peek();
    this.#pos += 1;
    if (token?.type === 'string') return token.value;
    if (token?.type === 'word') {
      const lower = token.value.toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      if (lower === 'null') return null;
      if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token.value)) return Number(token.value);
    }
    throw new ScimFilterError('value expected');
  }
}

export function parseScimFilter(input: string): FilterNode {
  if (input.length > MAX_FILTER_LENGTH) throw new ScimFilterError('filter too long');
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new ScimFilterError('empty filter');
  return new Parser(tokens).parse();
}

// ─── Compilation to Prisma `where` ──────────────────────────────────────────────

export type Where = Record<string, unknown>;

export interface AttributeSpec {
  /** Builds the condition for a comparison; return undefined for unsupported operators. */
  readonly compare?: (op: CompareOp, value: ScimValue) => Where | undefined;
  readonly present?: () => Where;
}

export type AttributeMap = Readonly<Record<string, AttributeSpec>>;

const STRING_OPS: Partial<Record<CompareOp, string>> = {
  eq: 'equals',
  co: 'contains',
  sw: 'startsWith',
  ew: 'endsWith',
  gt: 'gt',
  ge: 'gte',
  lt: 'lt',
  le: 'lte',
};

/** Case-insensitive (`caseExact: false`) or exact string attribute on a column. */
export function stringAttribute(
  column: string,
  options: { caseExact?: boolean; wrap?: (inner: Where) => Where } = {},
): AttributeSpec {
  const wrap = options.wrap ?? ((inner: Where) => inner);
  return {
    compare: (op, value) => {
      if (typeof value !== 'string') return undefined;
      const mode = options.caseExact === true ? {} : { mode: 'insensitive' };
      if (op === 'ne') return { NOT: wrap({ [column]: { equals: value, ...mode } }) };
      const prismaOp = STRING_OPS[op];
      return prismaOp === undefined
        ? undefined
        : wrap({ [column]: { [prismaOp]: value, ...mode } });
    },
    present: () => wrap({ [column]: { not: null } }),
  };
}

export function dateAttribute(column: string): AttributeSpec {
  return {
    compare: (op, value) => {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
      const date = new Date(value);
      const map: Partial<Record<CompareOp, string>> = {
        eq: 'equals',
        gt: 'gt',
        ge: 'gte',
        lt: 'lt',
        le: 'lte',
      };
      if (op === 'ne') return { NOT: { [column]: { equals: date } } };
      const prismaOp = map[op];
      return prismaOp === undefined ? undefined : { [column]: { [prismaOp]: date } };
    },
    present: () => ({ [column]: { not: null } }),
  };
}

export function compileScimFilter(node: FilterNode, attributes: AttributeMap, prefix = ''): Where {
  switch (node.kind) {
    case 'and':
      return {
        AND: [
          compileScimFilter(node.left, attributes, prefix),
          compileScimFilter(node.right, attributes, prefix),
        ],
      };
    case 'or':
      return {
        OR: [
          compileScimFilter(node.left, attributes, prefix),
          compileScimFilter(node.right, attributes, prefix),
        ],
      };
    case 'not':
      return { NOT: compileScimFilter(node.expr, attributes, prefix) };
    case 'valuePath':
      // `emails[type eq "work" and value co "@x"]` → sub-attributes resolved as `emails.type`, `emails.value`.
      return compileScimFilter(node.filter, attributes, `${node.attr}.`);
    case 'present': {
      const spec = lookup(attributes, `${prefix}${node.attr}`);
      if (spec.present === undefined)
        throw new ScimFilterError(`pr not supported for ${node.attr}`);
      return spec.present();
    }
    case 'compare': {
      const spec = lookup(attributes, `${prefix}${node.attr}`);
      const where = spec.compare?.(node.op, node.value);
      if (where === undefined)
        throw new ScimFilterError(`${node.op} not supported for ${node.attr}`);
      return where;
    }
  }
}

function lookup(attributes: AttributeMap, attr: string): AttributeSpec {
  const key = Object.keys(attributes).find((name) => name.toLowerCase() === attr.toLowerCase());
  if (key === undefined) throw new ScimFilterError(`unsupported attribute: ${attr}`);
  const spec = attributes[key];
  if (spec === undefined) throw new ScimFilterError(`unsupported attribute: ${attr}`);
  return spec;
}
