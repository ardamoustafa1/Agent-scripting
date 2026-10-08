import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import { EditorStore } from '../editor/store.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';

import { RuleManager } from './manager.js';

it('invites the designer to create the first rule and then shows the rule picker', async () => {
  const store = new EditorStore(minimalScript());
  const f = await mountDesigner(<RuleManager store={store} />);
  expect(screen.getByText(f.label('rules.emptyTitle'))).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: f.label('rules.title') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: f.label('rules.add') }));
  expect(await screen.findByRole('combobox', { name: f.label('rules.title') })).toBeTruthy();
  expect(screen.queryByText(f.label('rules.emptyTitle'))).toBeNull();
});
