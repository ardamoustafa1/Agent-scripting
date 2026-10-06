import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';

import IntegrationEditor from './editor.js';

const clientId = '01990000-0000-7000-8000-000000000001';
async function setup() {
  const f = await mountDesigner(
    <IntegrationEditor />,
    { 'POST /v1/data-sources': {} },
    { route: '/integrations/:id', path: '/integrations/new' },
  );
  await screen.findByRole('heading', { name: f.label('integrations.create') });
  return f;
}
const change = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
async function chooseSql(f: Awaited<ReturnType<typeof setup>>) {
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('integrations.tabs.request') }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('combobox', { name: f.label('integrations.protocol') }));
  fireEvent.click(await screen.findByRole('option', { name: 'SQL' }));
}
it('authors a named read-only query with ordered parameters and no SQL text field', async () => {
  const f = await setup();
  await chooseSql(f);
  expect(screen.getByText(f.label('integrations.sql.catalogNotice'))).toBeTruthy();
  expect(screen.queryByLabelText(f.label('integrations.baseUrl'))).toBeNull();
  expect(screen.queryByLabelText(f.label('integrations.sql.queryText'))).toBeNull();
  change(f.label('integrations.key'), 'sql-lookup');
  change(f.label('integrations.sql.clientId'), clientId);
  change(f.label('integrations.sql.target'), 'crm-readonly');
  change(f.label('integrations.sql.queryKey'), 'customer-by-id');
  for (const path of ['customer.id', 'region']) {
    fireEvent.click(screen.getByRole('button', { name: f.label('integrations.sql.addParameter') }));
    const inputs = screen.getAllByLabelText(/^Input path for parameter/);
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: path } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Move parameter 1 down' }));
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.save') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST')).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toMatchObject({
    protocol: 'sql',
    definition: {
      privateGateway: { clientId, target: 'crm-readonly' },
      sql: { queryKey: 'customer-by-id', parameters: ['region', 'customer.id'] },
      auth: { type: 'none' },
    },
  });
});
it('shows field errors for injection-shaped values and blocks save', async () => {
  const f = await setup();
  await chooseSql(f);
  change(f.label('integrations.key'), 'sql-lookup');
  change(f.label('integrations.sql.queryKey'), "x'; DROP TABLE t; --");
  expect(await screen.findByText(f.label('integrations.sql.error.invalid'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('integrations.save') }));
  await screen.findByText(f.label('integrations.saveError'));
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
});
