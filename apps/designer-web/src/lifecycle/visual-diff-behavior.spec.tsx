import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { VariableSchema } from '@verbis/script-schema';

import { editorFixture } from '../editor/fixtures.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';

import { VisualDiff } from './visual-diff.js';

it('decorates changed, removed and added components and compares variables and flow', async () => {
  const before = editorFixture(2).document;
  const after = structuredClone(before);
  after.pages[0]!.layout.children![0]!['props'] = { labelKey: 'common.next', disabled: true };
  after.pages[0]!.layout.children!.splice(1, 1, {
    id: 'synthetic-added',
    type: 'box',
    props: {},
    bindings: [],
    events: {},
    style: { base: {} },
  });
  before.variables = [
    VariableSchema.parse({
      key: 'changed',
      type: 'string',
      scope: 'session',
      classification: 'public',
      persist: false,
      default: 'old',
    }),
    VariableSchema.parse({
      key: 'removed',
      type: 'string',
      scope: 'session',
      classification: 'public',
      persist: false,
      default: '',
    }),
  ];
  after.variables = [
    { ...before.variables[0]!, default: 'new' },
    { ...before.variables[1]!, key: 'added' },
  ];
  after.flow.nodes[1]!.position = { x: 220, y: 140 };
  const f = await mountDesigner(
    <VisualDiff
      before={before}
      after={after}
      patch={[
        { op: 'add', path: '/variables/1', value: after.variables[1] },
        { op: 'remove', path: '/variables/1' },
        { op: 'replace', path: '/variables/0/default', value: 'new' },
        { op: 'replace', path: '/pages/0/name', value: 'Synthetic page' },
      ]}
    />,
  );
  expect(document.querySelector('.lc-diff-node.lc-changed')).toBeTruthy();
  expect(document.querySelector('.lc-diff-node.lc-removed')).toBeTruthy();
  expect(document.querySelector('.lc-diff-node.lc-added')).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('workspace.nav.variables') }), {
    button: 0,
  });
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
  expect(screen.getByRole('cell', { name: 'changed' })).toBeTruthy();
  expect(screen.getByRole('cell', { name: 'removed' })).toBeTruthy();
  expect(screen.getByRole('cell', { name: 'added' })).toBeTruthy();
  expect(
    screen.getByText(
      (_, element) =>
        element?.tagName === 'LI' &&
        element.textContent === `${f.label('lifecycle.diffText.fields.default')}: “old” → “new”`,
    ),
  ).toBeTruthy();
  expect(screen.getAllByText(f.label('lifecycle.diffText.added')).length).toBeGreaterThan(0);
  expect(screen.queryByText(/\{/)).toBeNull();
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('lifecycle.flowDiff') }), {
    button: 0,
  });
  expect(await screen.findByRole('region', { name: f.label('lifecycle.before') })).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('lifecycle.sourceDiff') }), {
    button: 0,
  });
  expect(screen.getByRole('table')).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('lifecycle.jsonDiff') }), {
    button: 0,
  });
  const changes = within(document.querySelector<HTMLElement>('.lc-change-list')!);
  const variable = (name: string) =>
    f.label('lifecycle.diffText.variable').replace('{{name}}', name);
  expect(changes.getByText(new RegExp(`${variable('added')} · `))).toBeTruthy();
  expect(changes.getByText(variable('removed'))).toBeTruthy();
  expect(
    changes.getByText(
      `${variable('changed')} › ${f.label('lifecycle.diffText.fields.default')} · “new”`,
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/^\/variables/)).toBeNull();
  expect(screen.getByText(f.label('lifecycle.diffText.technical'))).toBeTruthy();
});
