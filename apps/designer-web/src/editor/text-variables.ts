import type { Node, ScriptDocument, Value } from '@verbis/script-schema';

/**
 * Variables inside script text. Messages use ICU placeholders (`Merhaba {musteriAdi}`); the
 * runtime fills them from the component's `params` binding (`{ musteriAdi: vars.musteriAdi }`)
 * or an action's `params` value map. Authors only insert a variable; the plumbing follows.
 */
const PLACEHOLDER = /\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}/g;

/** Simple `{name}` placeholders in the order they appear, without duplicates. */
export function messageTokens(...texts: readonly (string | undefined)[]): string[] {
  const found: string[] = [];
  for (const text of texts)
    for (const match of (text ?? '').matchAll(PLACEHOLDER)) {
      const name = match[1];
      if (name && !found.includes(name)) found.push(name);
    }
  return found;
}

/** Inserts `{key}` at the caret, adding a space where the token would touch a word. */
export function insertToken(
  text: string,
  key: string,
  start = text.length,
  end = start,
): { text: string; caret: number } {
  const before = text.slice(0, start),
    after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '';
  const token = `${lead}{${key}}${trail}`;
  return { text: before + token + after, caret: before.length + token.length };
}

/** Value map for action params (`showToast`): every token that names a variable. */
export function paramsValueMap(
  tokens: readonly string[],
  variables: readonly string[],
): Record<string, Value> | undefined {
  const entries = tokens
    .filter((token) => variables.includes(token))
    .map((token) => [token, { $expr: `vars.${token}` }] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

const PAIR = /^\s*([A-Za-z][A-Za-z0-9]*)\s*:\s*([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)*)\s*$/;
/**
 * Reads a params binding written as a flat object literal (`{ name: vars.customerName }`).
 * Anything richer (calls, arithmetic, nesting) returns null and is left for the author.
 */
export function parseParamsExpression(source: string): Map<string, string> | null {
  const body = /^\s*\{([\s\S]*)\}\s*$/.exec(source)?.[1];
  if (body === undefined) return null;
  const pairs = new Map<string, string>();
  for (const part of body.split(',')) {
    if (!part.trim()) continue;
    const match = PAIR.exec(part);
    if (!match?.[1] || !match[2]) return null;
    pairs.set(match[1], match[2]);
  }
  return pairs;
}
export function paramsExpression(pairs: ReadonlyMap<string, string>): string {
  return `{ ${[...pairs].map(([name, path]) => `${name}: ${path}`).join(', ')} }`;
}

/**
 * The params binding a component needs for the placeholders in its texts. Author-written pairs
 * (`name: vars.customerName`, `agent: agent.firstName`) are kept; pairs this editor generated
 * (`token: vars.token`) follow the text, so removing a token from the text removes its pair.
 * Returns `undefined` to drop the binding, or `null` when a custom expression must stay as is.
 */
export function syncParamsBinding(
  node: Pick<Node, 'bindings'>,
  tokens: readonly string[],
  variables: readonly string[],
): Node['bindings'][number] | undefined | null {
  const current = node.bindings.find((b) => b.prop === 'params');
  let pairs = new Map<string, string>();
  if (current) {
    if (!('expression' in current)) return null;
    const parsed = parseParamsExpression(current.expression);
    if (!parsed) return null;
    pairs = parsed;
  }
  for (const [name, path] of [...pairs])
    if (path === `vars.${name}` && !tokens.includes(name)) pairs.delete(name);
  for (const token of tokens)
    if (!pairs.has(token) && variables.includes(token)) pairs.set(token, `vars.${token}`);
  return pairs.size ? { prop: 'params', expression: paramsExpression(pairs) } : undefined;
}

/** Every message text a node shows: its top-level text keys and its rich text blocks. */
export function nodeTexts(document: ScriptDocument, node: Pick<Node, 'props'>): string[] {
  const keys = Object.values(node.props).filter(
    (value): value is string => typeof value === 'string',
  );
  const blocks = node.props['blocks'];
  if (Array.isArray(blocks))
    for (const block of blocks)
      if (block !== null && typeof block === 'object' && !Array.isArray(block)) {
        const key = block['textKey'];
        if (typeof key === 'string') keys.push(key);
      }
  const catalogs = Object.values(document.i18n.messages);
  return keys.flatMap((key) => catalogs.flatMap((catalog) => catalog[key] ?? []));
}

/**
 * Re-derives a node's params binding from the placeholders in its texts, inside the caller's
 * document edit. Components without a bindable `params` prop are left untouched.
 */
export function applyParamsSync(document: ScriptDocument, node: Node, bindable: boolean): void {
  if (!bindable) return;
  const params = syncParamsBinding(
    node,
    messageTokens(...nodeTexts(document, node)),
    document.variables.map((v) => v.key),
  );
  if (params === null) return;
  node.bindings = node.bindings.filter((b) => b.prop !== 'params');
  if (params) node.bindings.push(params);
}
