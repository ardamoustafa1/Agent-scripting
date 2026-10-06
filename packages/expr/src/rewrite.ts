import { parseExpression, children } from './parser.js';
import { ExpressionError, type Ast } from './types.js';

export interface SourceEdit {
  from: number;
  to: number;
  insert: string;
}
/** Edits parsed member tokens only: literals and lambda-local variables remain untouched. */
export function renameVariableExpression(source: string, from: string, to: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) throw new ExpressionError('RENAME_IDENTIFIER');
  const ast = parseExpression(source),
    edits: SourceEdit[] = [];
  const walk = (node: Ast, locals: ReadonlySet<string>): void => {
    if (node.kind === 'lambda') {
      walk(node.body, new Set([...locals, node.parameter]));
      return;
    }
    if (
      node.kind === 'member' &&
      node.object.kind === 'identifier' &&
      node.object.name === 'vars' &&
      !locals.has('vars')
    ) {
      if (node.property.kind !== 'literal')
        throw new ExpressionError('RENAME_DYNAMIC_VARIABLE', node.position);
      if (node.property.value === from) {
        const start = node.property.position;
        const quote = source[start];
        if (quote === '"' || quote === "'") {
          let end = start + 1;
          while (end < source.length) {
            if (source[end] === '\\') {
              end += 2;
              continue;
            }
            if (source[end] === quote) {
              end++;
              break;
            }
            end++;
          }
          edits.push({ from: start, to: end, insert: JSON.stringify(to) });
        } else edits.push({ from: start, to: start + from.length, insert: to });
      }
    }
    for (const child of children(node)) walk(child, locals);
  };
  walk(ast, new Set());
  let result = source;
  for (const edit of edits.sort((a, b) => b.from - a.from))
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  parseExpression(result);
  return result;
}
