import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import { ActionSchema, type Action } from '@verbis/script-schema';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { ActionFields } from './actions.js';

function Harness({ initial }: { initial: Action }) {
  const [action, change] = useState(initial);
  return (
    <>
      <ActionFields action={action} onChange={change} variables={['amount']} />
      <output data-testid="action">{JSON.stringify(action)}</output>
    </>
  );
}
function action(): unknown {
  return JSON.parse(screen.getByTestId('action').textContent) as unknown;
}
it('edits action string and JSON parameters without accepting invalid JSON', async () => {
  const f = await mountDesigner(
    <Harness initial={ActionSchema.parse({ type: 'setVariable', variable: 'amount', value: 1 })} />,
  );
  fireEvent.change(screen.getByLabelText('variable'), { target: { value: 'total' } });
  const input = screen.getByLabelText('value');
  fireEvent.change(input, { target: { value: '{' } });
  fireEvent.blur(input);
  expect(await screen.findByText(f.label('editor.actionInvalid'))).toBeTruthy();
  expect(action()).toEqual({ type: 'setVariable', variable: 'total', value: 1 });
  fireEvent.change(input, { target: { value: '12' } });
  fireEvent.blur(input);
  expect(action()).toEqual({ type: 'setVariable', variable: 'total', value: 12 });
  expect(screen.queryByText(f.label('editor.actionInvalid'))).toBeNull();
});
it('requires valid parameters when changing the action type', async () => {
  const f = await mountDesigner(<Harness initial={{ type: 'next' }} />);
  fireEvent.click(screen.getByRole('combobox', { name: f.label('editor.actionType') }));
  fireEvent.click(await screen.findByRole('option', { name: 'setVariable' }));
  const input = screen.getByLabelText(f.label('editor.actionParameters'));
  fireEvent.change(input, { target: { value: '{' } });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  expect(screen.getByText(f.label('editor.actionInvalid'))).toBeTruthy();
  expect(action()).toEqual({ type: 'next' });
  fireEvent.change(input, {
    target: { value: '{"type":"setVariable","variable":"amount","value":2}' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.apply') }));
  expect(action()).toEqual({ type: 'setVariable', variable: 'amount', value: 2 });
  expect(screen.queryByText(f.label('editor.actionInvalid'))).toBeNull();
});
it('adds and edits nested action lists and rejects invalid identifiers', async () => {
  const f = await mountDesigner(
    <Harness
      initial={ActionSchema.parse({
        type: 'sequence',
        actions: [{ type: 'setVariable', variable: 'amount', value: 1 }],
      })}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.addAction') }));
  expect((action() as { actions: unknown[] }).actions).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('variable'), { target: { value: 'invalid identifier' } });
  expect(await screen.findByText(f.label('editor.actionInvalid'))).toBeTruthy();
  expect((action() as { actions: { variable?: string }[] }).actions[0]?.variable).toBe('amount');
  fireEvent.change(screen.getByLabelText('variable'), { target: { value: 'total' } });
  expect((action() as { actions: { variable?: string }[] }).actions[0]?.variable).toBe('total');
});
