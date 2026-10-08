import { describe, expect, it } from 'vitest';

import { ScriptDocumentSchema } from '@verbis/script-schema';
import { surveyScript } from '@verbis/script-schema/fixtures';

import { complianceChecklist, pendingCount, type ChecklistStore } from './checklist.js';

const base = ScriptDocumentSchema.parse(surveyScript);
const first = base.pages[0];
if (!first) throw new Error('fixture needs a page');
const firstPage: (typeof base.pages)[number] = first;
const notice = (id: string, extra: object = {}, bindings: object[] = []) => ({
  id,
  type: 'scriptText',
  props: { mustRead: true, titleKey: `msg.${id}`, ...extra },
  bindings,
  events: {},
  children: [],
});
function withNodes(...nodes: object[]) {
  return ScriptDocumentSchema.parse({
    ...surveyScript,
    pages: [
      {
        ...firstPage,
        layout: {
          ...firstPage.layout,
          children: [...(firstPage.layout.children ?? []), ...nodes],
        },
      },
      ...base.pages.slice(1),
    ],
    variables: [
      ...(surveyScript.variables ?? []),
      { key: 'consent', type: 'boolean', scope: 'session' },
    ],
  });
}
const store = (read: string[] = [], variables: Record<string, unknown> = {}): ChecklistStore => ({
  get: (path) => (read.some((id) => path === `runtime.read.${id}`) ? true : undefined),
  variable: (key) => variables[key],
});
const message = (key: string) => `T(${key})`;

describe('complianceChecklist', () => {
  it('lists mustRead notices in document order and ignores everything else', () => {
    const doc = withNodes(notice('kvkk'), { ...notice('other'), props: { titleKey: 'x' } });
    const items = complianceChecklist(doc, store(), message);
    expect(items.map((i) => i.id)).toEqual(['kvkk']);
    expect(items[0]).toMatchObject({ label: 'T(msg.kvkk)', done: false, pageId: firstPage.id });
    expect(pendingCount(items)).toBe(1);
  });
  it('mirrors every acknowledgement path used by the runtime guard', () => {
    const doc = withNodes(
      notice('via-runtime'),
      notice('via-prop', { acknowledged: true }),
      notice('via-variable', {}, [{ prop: 'acknowledged', variable: 'consent' }]),
      notice('open'),
    );
    const items = complianceChecklist(doc, store(['via-runtime'], { consent: true }), message);
    expect(Object.fromEntries(items.map((i) => [i.id, i.done]))).toEqual({
      'via-runtime': true,
      'via-prop': true,
      'via-variable': true,
      open: false,
    });
    expect(pendingCount(items)).toBe(1);
  });
  it('treats a non-true variable value as pending and falls back to the node id as the label', () => {
    const doc = withNodes(
      notice('plain', { titleKey: '' }, [{ prop: 'acknowledged', variable: 'consent' }]),
    );
    const [item] = complianceChecklist(doc, store([], { consent: 'yes' }), message);
    expect(item).toMatchObject({ id: 'plain', label: 'plain', done: false });
  });
  it('is empty for a script without required notices', () => {
    expect(complianceChecklist(base, store(), message)).toEqual([]);
  });
});
