import { describe, expect, it } from 'vitest';

import { surveyScript } from '../fixtures/index.js';
import { ScriptDocumentSchema, type ScriptDocument } from '../schema/document.js';

import { completionBypasses } from './completion.js';

/** start → a → b(mandatory) → done; a → skip → done-skip. */
function doc(skipCompletion?: 'early', skipOutcome: string | null = 'SKIPPED'): ScriptDocument {
  const base = ScriptDocumentSchema.parse(surveyScript);
  const page = (id: string, mandatory = false) => ({
    ...structuredClone(base.pages[0]),
    id,
    name: id,
    mandatory,
    layout: { id: `${id}-root`, type: 'box', props: {}, bindings: [], events: {} },
  });
  return ScriptDocumentSchema.parse({
    ...base,
    pages: [page('a'), page('b', true)],
    flow: {
      id: 'main',
      start: 'f-a',
      nodes: [
        { id: 'f-a', type: 'page', page: 'a' },
        { id: 'f-b', type: 'page', page: 'b' },
        { id: 'f-done', type: 'end', outcome: 'DONE' },
        {
          id: 'f-skip',
          type: 'end',
          ...(skipOutcome ? { outcome: skipOutcome } : {}),
          ...(skipCompletion ? { completion: skipCompletion } : {}),
        },
      ],
      edges: [
        { id: 'e1', from: 'f-a', to: 'f-b' },
        { id: 'e2', from: 'f-b', to: 'f-done' },
        { id: 'e3', from: 'f-a', to: 'f-skip' },
      ],
    },
    subflows: [],
  });
}

describe('completionBypasses', () => {
  it('flags a completing outcome reachable without the mandatory page', () => {
    expect(completionBypasses(doc())).toEqual([
      { node: 'f-skip', pointer: '/flow/nodes/3', page: 'b' },
    ]);
  });
  it('accepts the same route when the ending is an explicit early exit', () => {
    expect(completionBypasses(doc('early'))).toEqual([]);
  });
  it('ignores endings without an outcome and routes that always pass the page', () => {
    expect(completionBypasses(doc(undefined, null))).toEqual([]);
    const strict = doc();
    strict.flow.edges = strict.flow.edges.filter((e) => e.id !== 'e3');
    expect(completionBypasses(strict)).toEqual([]);
  });
  it('is silent for scripts without mandatory pages', () => {
    const plain = doc();
    for (const p of plain.pages) p.mandatory = false;
    expect(completionBypasses(plain)).toEqual([]);
  });

  it('handles a mandatory page that is not on the main flow and a blocked start', () => {
    const detached = doc();
    detached.flow.nodes = detached.flow.nodes.filter((n) => n.id !== 'f-b');
    detached.flow.edges = detached.flow.edges.filter((e) => e.id === 'e3');
    expect(completionBypasses(detached)).toEqual([]);
    const startsOnMandatory = doc();
    startsOnMandatory.flow.start = 'f-b';
    expect(completionBypasses(startsOnMandatory)).toEqual([]);
  });
  it('reports each (ending, page) pair once', () => {
    const twice = doc();
    twice.pages.push({ ...structuredClone(twice.pages[1]!), id: 'c', name: 'c', mandatory: true });
    twice.flow.nodes.push({ id: 'f-c', type: 'page', page: 'c' } as never);
    twice.flow.edges.push(
      { id: 'e4', from: 'f-a', to: 'f-c' },
      { id: 'e5', from: 'f-c', to: 'f-done' },
    );
    const found = completionBypasses(twice);
    expect(
      found
        .filter((f) => f.node === 'f-skip')
        .map((f) => f.page)
        .sort(),
    ).toEqual(['b', 'c']);
    expect(new Set(found.map((f) => `${f.node}:${f.page}`)).size).toBe(found.length);
  });
});
