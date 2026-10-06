import { startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { act, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { ExpressionEditor } from './expression.js';

function geometry() {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
}
it('synchronizes documents and emits real CodeMirror changes with accessible labels', async () => {
  geometry();
  const change = vi.fn();
  const f = await mountDesigner(
    <ExpressionEditor
      value="vars.amount + 1"
      onChange={change}
      variables={['amount']}
      label="Synthetic expression"
    />,
  );
  const element = screen.getByLabelText('Synthetic expression').closest<HTMLElement>('.cm-editor')!;
  const view = EditorView.findFromDOM(element)!;
  expect(view.state.doc.toString()).toBe('vars.amount + 1');
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'true && vars.amount > 2' },
    });
  });
  expect(change).toHaveBeenCalledWith('true && vars.amount > 2');
  f.ui.unmount();
  expect(element.isConnected).toBe(false);
});
it('offers variable/function completion using the real editor context', async () => {
  geometry();
  await mountDesigner(
    <ExpressionEditor
      value="vars.a"
      onChange={() => undefined}
      variables={['amount']}
      label="Synthetic completion"
    />,
  );
  const element = screen.getByLabelText('Synthetic completion').closest<HTMLElement>('.cm-editor')!;
  const view = EditorView.findFromDOM(element)!;
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
  });
  expect(await screen.findByRole('option', { name: 'vars.amount' })).toBeTruthy();
});
it('lints invalid expressions and respects disabled parent fieldsets', async () => {
  geometry();
  await mountDesigner(
    <fieldset disabled>
      <ExpressionEditor
        value="vars."
        onChange={() => undefined}
        variables={[]}
        label="Synthetic invalid expression"
      />
    </fieldset>,
  );
  const content = screen.getByLabelText('Synthetic invalid expression');
  const view = EditorView.findFromDOM(content.closest<HTMLElement>('.cm-editor')!)!;
  expect(content.getAttribute('contenteditable')).toBe('false');
  await waitFor(() => {
    expect(view.state.doc.toString()).toBe('vars.');
  });
  await waitFor(
    () => {
      expect(content.querySelector('.cm-lintRange-error')).toBeTruthy();
    },
    {
      timeout: 2000,
    },
  );
});
