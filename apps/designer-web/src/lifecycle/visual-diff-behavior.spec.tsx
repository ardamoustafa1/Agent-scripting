import { fireEvent, screen } from '@testing-library/react';
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
        { op: 'add', path: '/synthetic-added', value: true },
        { op: 'remove', path: '/synthetic-removed' },
        { op: 'replace', path: '/synthetic-changed', value: 'new' },
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
  expect(screen.getByText('"old"', { exact: false })).toBeTruthy();
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
  expect(screen.getByText('/synthetic-added')).toBeTruthy();
  expect(screen.getByText('/synthetic-removed')).toBeTruthy();
  expect(screen.getByText('/synthetic-changed')).toBeTruthy();
});
