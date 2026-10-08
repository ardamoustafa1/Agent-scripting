import { describe, expect, it } from 'vitest';

import { runScenario } from '@verbis/core-runtime';
import { dataMap, TestScenarioSchema, validateSemantics, walkNodes } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { previewLint } from '../preview/lint.js';

import { BLOCK_IDS, type BlockId } from './blocks.js';
import { hygieneIssues, scriptHealth } from './health.js';
import { EditorStore, editorRegistry } from './store.js';

function withBlock(block: BlockId) {
  const store = new EditorStore(minimalScript());
  store.addBlock(block, 'Block page');
  return store;
}

describe.each(BLOCK_IDS)('building block %s', (block) => {
  it('inserts without errors, opens the new page and wires it before the end', () => {
    const store = withBlock(block);
    const { document, pageId } = store.getSnapshot();
    expect(document.pages.at(-1)?.id).toBe(pageId);
    expect(validateSemantics(document).filter((issue) => issue.severity === 'error')).toEqual([]);
    const issues = [...previewLint(document, store.issues()), ...hygieneIssues(document)];
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(scriptHealth(issues).errors).toBe(0);
    const node = document.flow.nodes.find((n) => n.type === 'page' && n.page === pageId);
    expect(document.flow.edges.some((e) => e.from === 'n-home' && e.to === node?.id)).toBe(true);
    expect(document.flow.edges.some((e) => e.from === node?.id && e.to === 'n-end')).toBe(true);
  });

  it('runs through to the end on the real runtime', async () => {
    const { document, pageId } = withBlock(block).getSnapshot();
    const result = await runScenario(
      document,
      editorRegistry,
      TestScenarioSchema.parse({
        id: 'throughBlock',
        name: 'Through block',
        synthetic: true,
        context: {},
        steps: [
          { type: 'event', node: 'btn-next', event: 'onPress' },
          { type: 'event', node: `${pageId}-next`, event: 'onPress' },
        ],
        expected: { ended: true },
      }),
    );
    expect(result.code).toBeUndefined();
    expect(result.passed).toBe(true);
  });

  it('never overwrites existing translations and renames colliding variables', () => {
    const store = new EditorStore(minimalScript());
    store.addBlock(block, 'First');
    const before = store.getSnapshot().document;
    const firstKeys = before.variables.map((v) => v.key);
    store.edit((doc) => {
      const [key] = Object.keys(doc.i18n.messages['en'] ?? {}).filter((k) =>
        k.startsWith('blocks.'),
      );
      if (key && doc.i18n.messages['en']) doc.i18n.messages['en'][key] = 'Edited by designer';
    });
    store.addBlock(block, 'Second');
    const after = store.getSnapshot().document;
    expect(new Set(after.variables.map((v) => v.key)).size).toBe(after.variables.length);
    expect(after.variables.length).toBe(firstKeys.length * 2);
    expect(Object.values(after.i18n.messages['en'] ?? {})).toContain('Edited by designer');
  });
});

describe('building block classification', () => {
  it('marks identity data as personal so it shows in the data map', () => {
    const { document } = withBlock('identityCheck').getSnapshot();
    expect(dataMap(document).map((entry) => [entry.variable, entry.classification])).toEqual([
      ['customerTckn', 'pii'],
      ['customerBirthDate', 'pii'],
    ]);
  });

  it('never preselects consent', () => {
    const { document } = withBlock('privacyConsent').getSnapshot();
    let consentValue: unknown = 'missing';
    walkNodes(document, ({ node }) => {
      if (node.type === 'explicitConsent') consentValue = node.props['value'];
      return true;
    });
    expect(consentValue).toBe(false);
    expect(document.variables.find((v) => v.key === 'marketingConsent')?.default).toBe(false);
  });

  it('refuses to add a block when every page is a read-only linked screen', () => {
    const store = new EditorStore(minimalScript(), new Set(['home']));
    expect(() => {
      store.addBlock('callback', 'Blocked');
    }).toThrow('VERBIS_READONLY');
  });
});
