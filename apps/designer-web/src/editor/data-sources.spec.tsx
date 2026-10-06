import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { DataSourceRefSchema } from '@verbis/script-schema';
import { minimalScript } from '@verbis/script-schema/fixtures';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import { DataSources } from './data-sources.js';
import { EditorStore } from './store.js';

const first = {
  id: '01928f3a-0000-7000-8000-000000000031',
  key: 'customer-profile',
  version: 3,
  protocol: 'rest',
};
const second = {
  ...first,
  id: '01928f3a-0000-7000-8000-000000000032',
  key: 'lookup-two',
  version: 7,
};
async function setup(store = new EditorStore(minimalScript()), fail = false) {
  const f = await mountDesigner(<DataSources store={store} />, {
    '/v1/data-sources?limit=100': fail
      ? Response.json({}, { status: 500 })
      : { data: [first], page: { nextCursor: 'synthetic next' } },
    '/v1/data-sources?limit=100&cursor=synthetic%20next': {
      data: [second],
      page: { nextCursor: null },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.manageSources') }));
  const dialog = within(await screen.findByRole('dialog'));
  return { ...f, store, dialog };
}
async function choose(f: Awaited<ReturnType<typeof setup>>, name = 'customer-profile · v3') {
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === '/v1/data-sources?limit=100')).toBe(true);
  });
  fireEvent.click(f.dialog.getByRole('combobox', { name: f.label('editor.tenantIntegration') }));
  fireEvent.click(await screen.findByRole('option', { name }));
}
it('loads tenant pages and saves a version pin and JSON mappings; unused bindings can be removed', async () => {
  const f = await setup();
  fireEvent.click(await screen.findByRole('button', { name: f.label('workspace.loadMore') }));
  await choose(f, 'lookup-two · v7');
  fireEvent.change(f.dialog.getByLabelText(f.label('editor.sourceInputs')), {
    target: { value: '{"id":"synthetic"}' },
  });
  fireEvent.change(f.dialog.getByLabelText(f.label('editor.sourceOutputs')), {
    target: { value: '{"name":{"path":"$.customer.name"}}' },
  });
  fireEvent.change(f.dialog.getByLabelText(f.label('editor.sourceTimeout')), {
    target: { value: '6000' },
  });
  fireEvent.click(
    f.dialog.getByRole<HTMLButtonElement>('button', { name: f.label('editor.addSource') }),
  );
  expect(f.store.getSnapshot().document.dataSources).toHaveLength(1);
  expect(f.store.getSnapshot().document.dataSources[0]).toMatchObject({
    id: 'lookupTwo',
    ref: 'tenant-datasource:lookup-two',
    version: 7,
    inputs: { id: 'synthetic' },
    outputs: { name: { path: '$.customer.name' } },
    policy: { timeoutMs: 6000 },
  });
  fireEvent.click(f.dialog.getByRole('button', { name: f.label('editor.delete') }));
  expect(f.store.getSnapshot().document.dataSources).toHaveLength(0);
});
it('preserves execution policy while editing and protects a binding referenced by a component', async () => {
  const doc = minimalScript();
  doc.dataSources = [
    DataSourceRefSchema.parse({
      id: 'customerProfile',
      ref: 'tenant-datasource:customer-profile',
      version: 1,
      policy: { timeoutMs: 4000, trigger: 'onEnter', onFailure: 'manual', cacheTtlSec: 60 },
    }),
  ];
  doc.pages[0]!.layout.children!.push({
    id: 'lookup',
    type: 'webService',
    props: { ds: 'customerProfile' },
  });
  const f = await setup(new EditorStore(doc));
  await choose(f);
  const row = within(f.dialog.getByRole('listitem'));
  expect(
    row.getByRole<HTMLButtonElement>('button', { name: f.label('editor.delete') }).disabled,
  ).toBe(true);
  fireEvent.click(row.getByRole('button', { name: f.label('editor.apply') }));
  fireEvent.change(f.dialog.getByLabelText(f.label('editor.sourceTimeout')), {
    target: { value: '8000' },
  });
  fireEvent.click(f.dialog.getAllByRole('button', { name: f.label('editor.apply') }).at(-1)!);
  expect(f.store.getSnapshot().document.dataSources[0]).toMatchObject({
    version: 3,
    policy: { trigger: 'onEnter', onFailure: 'manual', cacheTtlSec: 60, timeoutMs: 8000 },
  });
  fireEvent.click(row.getByRole('button', { name: f.label('editor.apply') }));
  fireEvent.click(f.dialog.getByRole('button', { name: f.label('editor.cancel') }));
  await choose(f);
  fireEvent.click(
    f.dialog.getByRole<HTMLButtonElement>('button', { name: f.label('editor.addSource') }),
  );
  expect(await screen.findByText(f.label('editor.sourceInvalid'))).toBeTruthy();
  expect(f.store.getSnapshot().document.dataSources).toHaveLength(1);
});
it('rejects invalid JSON, mappings and timeout without changing the document and suspends writes', async () => {
  const f = await setup();
  await choose(f);
  const add = f.dialog.getByRole<HTMLButtonElement>('button', {
    name: f.label('editor.addSource'),
  });
  for (const value of ['{', '{"name":{"path":"not-a-jsonpath"}}']) {
    fireEvent.change(f.dialog.getByLabelText(f.label('editor.sourceOutputs')), {
      target: { value },
    });
    fireEvent.click(add);
    expect(f.store.getSnapshot().document.dataSources).toHaveLength(0);
  }
  fireEvent.change(f.dialog.getByLabelText(f.label('editor.sourceOutputs')), {
    target: { value: '{}' },
  });
  fireEvent.change(f.dialog.getByLabelText(f.label('editor.sourceTimeout')), {
    target: { value: '1' },
  });
  fireEvent.click(add);
  expect(f.store.getSnapshot().document.dataSources).toHaveLength(0);
  act(() => {
    f.store.setWriteSuspended(true);
  });
  expect(add.disabled).toBe(true);
});
it('reports catalog failure and does not offer a writable binding', async () => {
  const f = await setup(undefined, true);
  expect(await screen.findByText(f.label('editor.sourceLoadFailed'))).toBeTruthy();
  expect(
    f.dialog.getByRole<HTMLButtonElement>('button', { name: f.label('editor.addSource') }).disabled,
  ).toBe(true);
});
