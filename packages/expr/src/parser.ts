import { resolveLimits, type ExpressionLimits } from './limits.js';
import { assertKey, ExpressionError, type Ast } from './types.js';

interface Token {
  text: string;
  kind: 'number' | 'string' | 'identifier' | 'symbol' | 'end';
  position: number;
  value?: string | number;
}
const operators = ['===', '!==', '=>', '?.', '??', '&&', '||', '==', '!=', '<=', '>=', '**'];
const precedence: Readonly<Record<string, number>> = {
  '??': 1,
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '===': 4,
  '!==': 4,
  '<': 5,
  '>': 5,
  '<=': 5,
  '>=': 5,
  in: 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
  '**': 8,
};
function tokenize(source: string, limits: ExpressionLimits): Token[] {
  if (!source.trim() || source.length > limits.maxSourceLength)
    throw new ExpressionError('SOURCE_LIMIT');
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const position = i;
    if (char === '"' || char === "'") {
      const quote = char;
      i++;
      let value = '';
      let closed = false;
      while (i < source.length) {
        const c = source[i++] ?? '';
        if (c === quote) {
          closed = true;
          break;
        }
        if (c === '\n' || c === '\r') throw new ExpressionError('STRING_INVALID', position);
        if (c !== '\\') {
          value += c;
          continue;
        }
        const escaped = source[i++] ?? '';
        const escapes: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          '\\': '\\',
          '"': '"',
          "'": "'",
          '/': '/',
        };
        if (escaped === 'u') {
          const hex = source.slice(i, i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ExpressionError('STRING_INVALID', position);
          value += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else if (Object.hasOwn(escapes, escaped)) value += escapes[escaped] ?? '';
        else throw new ExpressionError('STRING_INVALID', position);
      }
      if (!closed || value.length > limits.maxStringLength)
        throw new ExpressionError('STRING_INVALID', position);
      tokens.push({ text: value, kind: 'string', value, position });
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new ExpressionError('NUMBER_INVALID', i);
      tokens.push({ text: number[0], kind: 'number', value, position });
      i += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i));
    if (identifier) {
      tokens.push({ text: identifier[0], kind: 'identifier', position });
      i += identifier[0].length;
      continue;
    }
    const op = operators.find((item) => source.startsWith(item, i)) ?? char;
    if (!operators.includes(op) && !'()[]{}.,?:+-*/%!<>'.includes(op))
      throw new ExpressionError('TOKEN_INVALID', i);
    tokens.push({ text: op, kind: 'symbol', position });
    i += op.length;
  }
  tokens.push({ text: '', kind: 'end', position: source.length });
  return tokens;
}
export function parseExpression(source: string, overrides: Partial<ExpressionLimits> = {}): Ast {
  const limits = resolveLimits(overrides);
  const tokens = tokenize(source, limits);
  let cursor = 0;
  let depth = 0;
  const peek = () => tokens[cursor] ?? { text: '', kind: 'end' as const, position: source.length };
  const take = () => {
    const token = peek();
    cursor++;
    return token;
  };
  const match = (text: string) => {
    if (peek().kind !== 'symbol' || peek().text !== text) return false;
    take();
    return true;
  };
  const expect = (text: string) => {
    if (!match(text)) throw new ExpressionError('EXPECTED_TOKEN', peek().position);
  };
  const expression = (minimum = 0): Ast => {
    if (++depth > limits.maxAstDepth) throw new ExpressionError('DEPTH_LIMIT', peek().position);
    try {
      const token = take();
      let left: Ast;
      if (token.kind === 'number' || token.kind === 'string')
        left = { kind: 'literal', value: token.value ?? null, position: token.position };
      else if (['true', 'false', 'null'].includes(token.text))
        left = {
          kind: 'literal',
          value: token.text === 'null' ? null : token.text === 'true',
          position: token.position,
        };
      else if (token.text === '(') {
        left = expression();
        expect(')');
      } else if (['!', '+', '-'].includes(token.text))
        left = {
          kind: 'unary',
          operator: token.text,
          operand: expression(8),
          position: token.position,
        };
      else if (token.text === '[') {
        const items: Ast[] = [];
        if (!match(']')) {
          do {
            if (peek().kind === 'symbol' && peek().text === ']') break;
            items.push(expression());
          } while (match(','));
          expect(']');
        }
        left = { kind: 'array', items, position: token.position };
      } else if (token.text === '{') {
        const entries: { key: string; value: Ast }[] = [];
        if (!match('}')) {
          do {
            if (peek().kind === 'symbol' && peek().text === '}') break;
            const key = take();
            if (!['identifier', 'string'].includes(key.kind))
              throw new ExpressionError('OBJECT_KEY_INVALID', key.position);
            assertKey(key.text);
            if (entries.some((entry) => entry.key === key.text))
              throw new ExpressionError('DUPLICATE_KEY', key.position);
            expect(':');
            entries.push({ key: key.text, value: expression() });
          } while (match(','));
          expect('}');
        }
        left = { kind: 'object', entries, position: token.position };
      } else if (token.kind === 'identifier') {
        assertKey(token.text);
        if (match('=>'))
          left = {
            kind: 'lambda',
            parameter: token.text,
            body: expression(),
            position: token.position,
          };
        else left = { kind: 'identifier', name: token.text, position: token.position };
      } else throw new ExpressionError('EXPRESSION_INVALID', token.position);
      for (;;) {
        if (
          peek().kind === 'symbol' &&
          (peek().text === '.' || peek().text === '?.' || peek().text === '[')
        ) {
          const access = take();
          let property: Ast;
          if (access.text === '[' || (access.text === '?.' && match('['))) {
            property = expression();
            expect(']');
          } else {
            const key = take();
            if (key.kind !== 'identifier')
              throw new ExpressionError('PROPERTY_INVALID', key.position);
            assertKey(key.text);
            property = { kind: 'literal', value: key.text, position: key.position };
          }
          left = {
            kind: 'member',
            object: left,
            property,
            optional: access.text === '?.',
            position: access.position,
          };
          continue;
        }
        if (match('(')) {
          if (left.kind !== 'identifier')
            throw new ExpressionError('CALL_NOT_ALLOWED', left.position);
          const args: Ast[] = [];
          if (!match(')')) {
            do {
              args.push(expression());
            } while (match(','));
            expect(')');
          }
          left = { kind: 'call', name: left.name, args, position: left.position };
          continue;
        }
        const op = peek();
        const binding =
          op.kind === 'symbol' || (op.kind === 'identifier' && op.text === 'in')
            ? precedence[op.text]
            : undefined;
        if (binding === undefined || binding < minimum) break;
        take();
        const right = expression(binding + (op.text === '**' ? 0 : 1));
        left = { kind: 'binary', operator: op.text, left, right, position: op.position };
      }
      if (minimum === 0 && match('?')) {
        const yes = expression();
        expect(':');
        left = {
          kind: 'conditional',
          condition: left,
          yes,
          no: expression(),
          position: left.position,
        };
      }
      return left;
    } finally {
      depth--;
    }
  };
  const ast = expression();
  if (peek().kind !== 'end') throw new ExpressionError('TRAILING_TOKEN', peek().position);
  // Left-associated chains can be deep even when Pratt recursion is shallow.
  const check = (node: Ast, level: number, lambdaAllowed = false): void => {
    if (level > limits.maxAstDepth) throw new ExpressionError('DEPTH_LIMIT', node.position);
    if (node.kind === 'lambda' && !lambdaAllowed)
      throw new ExpressionError('LAMBDA_NOT_ALLOWED', node.position);
    for (const child of children(node))
      check(
        child,
        level + 1,
        node.kind === 'call' && ['filter', 'map', 'find', 'any', 'all', 'sum'].includes(node.name),
      );
  };
  check(ast, 1);
  return ast;
}
export function children(node: Ast): readonly Ast[] {
  switch (node.kind) {
    case 'literal':
    case 'identifier':
      return [];
    case 'array':
      return node.items;
    case 'object':
      return node.entries.map((entry) => entry.value);
    case 'unary':
      return [node.operand];
    case 'binary':
      return [node.left, node.right];
    case 'conditional':
      return [node.condition, node.yes, node.no];
    case 'member':
      return [node.object, node.property];
    case 'call':
      return node.args;
    case 'lambda':
      return [node.body];
  }
}
