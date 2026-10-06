/**
 * Conservative reference scanner for expression source text. It does not parse or evaluate
 * (ADR-0007); it only finds `vars.<key>` and `ds.<id>[.<field>]` member chains outside string
 * literals so the validator can check them. The step-13 parser will supply AST-based references.
 */
export interface ExpressionReferences {
  readonly variables: readonly string[];
  readonly dataSources: readonly { readonly id: string; readonly field?: string }[];
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

function stripStrings(source: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (quote !== null) {
      if (char === '\\') i += 1;
      else if (char === quote) {
        quote = null;
        out += ' ';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

/** Splits source into member chains like `["vars","customer","name"]`. */
function memberChains(source: string): string[][] {
  const text = stripStrings(source);
  const chains: string[][] = [];
  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);
    // Skip number literals so `1.5` is not read as a chain; skip `.x` continuing a non-identifier.
    if (/[0-9]/.test(char)) {
      while (i < text.length && /[0-9.eE]/.test(text.charAt(i))) i += 1;
      continue;
    }
    if (!IDENT_START.test(char) || (i > 0 && text.charAt(i - 1) === '.')) {
      i += 1;
      continue;
    }
    const chain: string[] = [];
    let segment = '';
    while (i < text.length) {
      const current = text.charAt(i);
      if (IDENT_PART.test(current)) {
        segment += current;
        i += 1;
      } else if (current === '.' && segment !== '' && IDENT_START.test(text.charAt(i + 1))) {
        chain.push(segment);
        segment = '';
        i += 1;
      } else break;
    }
    if (segment !== '') chain.push(segment);
    chains.push(chain);
  }
  return chains;
}

export function scanExpression(source: string): ExpressionReferences {
  const variables = new Set<string>();
  const dataSources = new Map<string, { id: string; field?: string }>();
  for (const [root, first, second] of memberChains(source)) {
    if (first === undefined) continue;
    if (root === 'vars') variables.add(first);
    if (root === 'ds') {
      const ref = second === undefined ? { id: first } : { id: first, field: second };
      dataSources.set(`${first}.${second ?? ''}`, ref);
    }
  }
  return { variables: [...variables], dataSources: [...dataSources.values()] };
}

/** Scans a rule fact path (`vars.segment`, `ds.lookup.balance`). */
export function scanFactPath(fact: string): ExpressionReferences {
  return scanExpression(fact);
}
