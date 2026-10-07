import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { minimalScript, surveyScript } from '@verbis/script-schema/fixtures';

import { draftNote, summarizeChanges } from './change-summary.js';

const base = ScriptDocumentSchema.parse(surveyScript);
const clone = () => structuredClone(base);
const keyOf = (lines: ReturnType<typeof summarizeChanges>) => lines.map((l) => l.key);

describe('summarizeChanges', () => {
  it('is empty for identical documents and for position-only flow edits', () => {
    expect(summarizeChanges(base, clone())).toEqual([]);
    const moved = clone();
    for (const node of moved.flow.nodes) node.position = { x: 9999, y: 9999 };
    expect(summarizeChanges(base, moved)).toEqual([]);
  });
  it('reports added, removed and changed pages by name, sorted', () => {
    const next = clone();
    const first = next.pages[0];
    if (!first) throw new Error('fixture');
    first.name = 'Renamed page';
    next.pages.push({ ...structuredClone(first), id: 'extra-page', name: 'Extra' });
    const line = summarizeChanges(base, next).find((l) => l.key === 'pages');
    expect(line).toMatchObject({ added: ['Extra'], removed: [], changed: ['Renamed page'] });
  });
  it('flags a variable that became sensitive, with its previous and new class', () => {
    const next = clone();
    const variable = next.variables.find((v) => !v.pii && v.classification !== 'pci');
    if (!variable) throw new Error('fixture needs a plain variable');
    variable.classification = 'pci';
    const lines = summarizeChanges(base, next);
    expect(lines).toContainEqual({
      key: 'sensitive',
      variable: variable.key,
      from: base.variables.find((v) => v.key === variable.key)?.classification ?? 'public',
      to: 'pci',
    });
  });
  it('counts variables, rules, data sources, scenarios and per-locale message changes', () => {
    const next = clone();
    next.variables.push({ key: 'newVar', type: 'string', scope: 'session' } as never);
    next.variables = next.variables.filter((v) => v.key !== base.variables[0]?.key);
    const locale = Object.keys(next.i18n.messages)[0] ?? 'tr';
    next.i18n.messages[locale] = { ...next.i18n.messages[locale], 'common.next': 'Changed' };
    const lines = summarizeChanges(base, next);
    expect(keyOf(lines)).toEqual(expect.arrayContaining(['variables', 'messages']));
    expect(lines.find((l) => l.key === 'variables')).toMatchObject({
      added: ['newVar'],
      removed: [base.variables[0]?.key],
    });
    expect(lines.find((l) => l.key === 'messages')).toMatchObject({ locale, count: 1 });
  });
  it('never exposes message texts or values in any line', () => {
    const next = clone();
    const locale = Object.keys(next.i18n.messages)[0] ?? 'tr';
    next.i18n.messages[locale] = {
      ...next.i18n.messages[locale],
      'secret.key': 'CUSTOMER-NAME-12345',
    };
    expect(JSON.stringify(summarizeChanges(base, next))).not.toContain('CUSTOMER-NAME-12345');
  });
  it('works across unrelated documents without throwing', () => {
    const other = ScriptDocumentSchema.parse(minimalScript());
    expect(() => summarizeChanges(base, other)).not.toThrow();
    expect(summarizeChanges(base, other).length).toBeGreaterThan(0);
  });
});

describe('draftNote', () => {
  it('renders one bullet per line using the supplied localiser', () => {
    const text = draftNote(
      [
        { key: 'scenarios', added: 2, removed: 0 },
        { key: 'flow', nodes: 1, edges: 3 },
      ],
      (line) => line.key,
    );
    expect(text).toBe('- scenarios\n- flow');
    expect(draftNote([], () => 'x')).toBe('');
  });
});
