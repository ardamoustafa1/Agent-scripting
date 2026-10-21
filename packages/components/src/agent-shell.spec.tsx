import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@verbis/i18n';
import { ScriptDocumentSchema, walkNodes, type Node } from '@verbis/script-schema';
import { minimalScript, surveyScript } from '@verbis/script-schema/fixtures';
import { UiProvider } from '@verbis/ui';

import {
  ComplianceList,
  PageProgress,
  StepHeader,
  checklistPaths,
  complianceChecklist,
  noticeShown,
  pageTitle,
  pendingCount,
  stepTrail,
  type ChecklistStore,
} from './agent-shell.js';

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

describe('checklistPaths', () => {
  it('lists the store paths the checklist reads, for precise subscriptions', () => {
    const doc = withNodes(
      notice('read'),
      notice('bound', {}, [{ prop: 'acknowledged', variable: 'consent' }]),
    );
    expect(checklistPaths(doc)).toEqual([
      'runtime.read.read',
      'runtime.read.bound',
      'vars.consent',
    ]);
  });
});

describe('steps', () => {
  const document = ScriptDocumentSchema.parse(minimalScript());
  document.pages.push({ ...document.pages[0]!, id: 'offer', name: 'offer', titleKey: 'p.offer' });
  const titles = (key: string) => (key === 'p.offer' ? 'Special offer' : key);

  it('prefers the customer-facing title key over the page name', () => {
    expect(pageTitle(document, 'offer', titles)).toBe('Special offer');
    expect(pageTitle(document, 'home', titles)).toBe('Home');
    expect(pageTitle(document, 'missing', titles)).toBe('missing');
  });

  it('lists completed steps without the current page, bounded to the most recent', () => {
    expect(stepTrail(document, ['home', 'offer', 'home'], 'offer', titles)).toEqual([
      { id: 'home', title: 'Home' },
      { id: 'home', title: 'Home' },
    ]);
    expect(stepTrail(document, Array(20).fill('home') as string[], null, titles, 3)).toHaveLength(
      3,
    );
  });
});

describe('shell views', () => {
  // Stubs and restores only matchMedia: the shared setup's ResizeObserver stub must survive.
  const matchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  });
  afterAll(() => {
    if (matchMedia) Object.defineProperty(window, 'matchMedia', matchMedia);
    else Reflect.deleteProperty(window, 'matchMedia');
  });
  it('shows the step, its title, the trail, progress and checklist status in words', async () => {
    const i18n = await createI18n('en');
    render(
      <UiProvider i18n={i18n}>
        <StepHeader
          step={3}
          title="Offer"
          trail={[
            { id: 'a', title: 'Welcome' },
            { id: 'b', title: 'Identity' },
          ]}
          actions={<button type="button">Feedback</button>}
        />
        <PageProgress current={3} total={0} />
        <ComplianceList
          items={[
            { id: 'kvkk', pageId: 'a', page: 'Welcome', label: 'Privacy notice', done: true },
            { id: 'terms', pageId: 'b', page: 'Identity', label: 'Terms', done: false },
          ]}
          probablySaid={['terms']}
        />
      </UiProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Offer' })).toBeTruthy();
    expect(screen.getByText(i18n.t('agent.desktop.step', { number: 3 }))).toBeTruthy();
    expect(screen.getByText(i18n.t('agent.desktop.trail', { count: 2 }))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Feedback' })).toBeTruthy();
    // An empty script does not divide by zero.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(
      screen.getByText(i18n.t('agent.desktop.complianceProgress', { done: 1, total: 2 })),
    ).toBeTruthy();
    expect(screen.getByText(i18n.t('agent.desktop.probablySaid'))).toBeTruthy();
    expect(screen.getAllByText(i18n.t('agent.desktop.compliancePending'))).toHaveLength(1);
  });
});

describe('notices shown on this call', () => {
  const doc = withNodes(notice('always'), {
    ...notice('returns'),
    visibleWhen: { $expr: 'vars.consent == true' },
  });
  it('leaves out notices hidden on this call and still lists the others', () => {
    const items = complianceChecklist(doc, store(), message, (node) => node.id !== 'returns');
    expect(items.map((item) => item.id)).toEqual(['always']);
  });
  it('asks the runtime and keeps a notice whose condition cannot be evaluated', () => {
    const runtime = {
      condition: (condition: unknown) => {
        if (condition === undefined) return true;
        throw new Error('synthetic');
      },
      expressions: {
        source: () => 'vars.consent == true',
        dependenciesOf: () => ['vars.consent'],
      },
    } as unknown as Parameters<typeof noticeShown>[0];
    const shown = noticeShown(runtime);
    const notices: Node[] = [];
    walkNodes(doc, ({ node }) => {
      if (node.props['mustRead'] === true) notices.push(node);
      return true;
    });
    expect(notices.map((node) => shown(node))).toEqual([true, true]);
    // Subscribes to what decides visibility as well as to the read state.
    expect(checklistPaths(doc, runtime)).toEqual([
      'runtime.read.always',
      'runtime.read.returns',
      'vars.consent',
    ]);
  });
});
