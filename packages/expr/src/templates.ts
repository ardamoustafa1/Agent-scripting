import { evaluateWithBudget, type EngineOptions } from './interpreter.js';
import { Budget, display } from './runtime.js';
import { ExpressionError } from './types.js';

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
export function renderTemplate(
  template: string,
  context: unknown,
  options: EngineOptions = {},
): string {
  const budget = new Budget(options);
  const now = options.now?.() ?? 0;
  if (template.length > budget.limits.maxStringLength) throw new ExpressionError('STRING_LIMIT');
  let cursor = 0;
  let output = '';
  let count = 0;
  while (cursor < template.length) {
    budget.tick();
    const start = template.indexOf('{{', cursor);
    if (start < 0) {
      output += escapeHtml(template.slice(cursor));
      break;
    }
    output += escapeHtml(template.slice(cursor, start));
    // Find closing delimiter outside quoted strings and nested object/array literals.
    let i = start + 2;
    let quote = '';
    let nesting = 0;
    let closed = false;
    for (; i < template.length; i++) {
      const char = template[i] ?? '';
      if (quote) {
        if (char === '\\') i++;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (!nesting && template.startsWith('}}', i)) {
        closed = true;
        break;
      }
      if (char === '{' || char === '[' || char === '(') nesting++;
      if (char === '}' || char === ']' || char === ')') nesting--;
    }
    if (!closed || ++count > 32) throw new ExpressionError('TEMPLATE_INVALID', start);
    // One shared remaining step/time budget across placeholders, including context traversal.
    const value = evaluateWithBudget(
      template.slice(start + 2, i),
      context,
      { ...options, now: () => now },
      budget,
    );
    output += escapeHtml(display(value));
    cursor = i + 2;
    if (output.length > budget.limits.maxStringLength) throw new ExpressionError('STRING_LIMIT');
  }
  budget.output(output);
  return output;
}
