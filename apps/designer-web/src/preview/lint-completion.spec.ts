import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { surveyScript } from '@verbis/script-schema/fixtures';

import { previewLint } from './lint.js';

/** One mandatory page that an ending with an outcome can skip. */
function skipping(completion?: 'early') {
  const base = ScriptDocumentSchema.parse(surveyScript);
  const page = (id: string, mandatory: boolean) => ({
    ...structuredClone(base.pages[0]),
    id,
    name: id,
    mandatory,
    layout: { id: `${id}-root`, type: 'box', props: {}, bindings: [], events: {} },
  });
  return ScriptDocumentSchema.parse({
    ...base,
    pages: [page('a', false), page('b', true)],
    flow: {
      id: 'main',
      start: 'f-a',
      nodes: [
        { id: 'f-a', type: 'page', page: 'a' },
        { id: 'f-b', type: 'page', page: 'b' },
        { id: 'f-done', type: 'end', outcome: 'DONE' },
        { id: 'f-skip', type: 'end', outcome: 'SKIPPED', ...(completion ? { completion } : {}) },
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

describe('previewLint completion bypass (ADR-0047)', () => {
  it('surfaces as a blocking flow error until the ending is an explicit early exit', () => {
    expect(previewLint(skipping(), [])).toContainEqual({
      severity: 'error',
      code: 'VERBIS_LINT_COMPLETION_BYPASS',
      path: '/flow/nodes/3',
      messageKey: 'designer.preview.lintCompletionBypass',
    });
    expect(
      previewLint(skipping('early'), []).some((i) => i.code === 'VERBIS_LINT_COMPLETION_BYPASS'),
    ).toBe(false);
  });
});
