import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import Compliance from './compliance-page.js';
import { mountAdmin } from './fixtures.spec.helpers.js';

const row = (extra: object = {}) => ({
  scriptId: '01928f3a-0000-7000-8000-000000000001',
  scriptName: 'Card sales',
  versionNumber: 3,
  variable: 'pan',
  classification: 'pci',
  origins: 'agentInput:pan-input',
  destinations: 'platform:/pages/0/a; platform:/pages/0/b; integration:fraud',
  persisted: false,
  attention: true,
  ...extra,
});
const record = (rows: object[], extra: object = {}) => ({
  generatedAt: '2026-10-08T09:00:00Z',
  scripts: 2,
  unreadable: 0,
  truncated: false,
  rows,
  ...extra,
});
const path = '/v1/compliance/processing-record?format=json';
const showRows = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
};

it('does nothing until asked, because generating the record is an audited export', async () => {
  const f = await mountAdmin(<Compliance />, { [path]: record([row()]) });
  expect(await screen.findByText(f.label('processing.audited'))).toBeTruthy();
  expect(f.requests).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: f.label('processing.generate') }));
  expect(await screen.findByText(f.label('processing.resultTitle'))).toBeTruthy();
  expect(f.requests.map((r) => r.path)).toEqual([path]);
});

it('shows readable origins and destinations, deduplicated, without raw pointers or codes', async () => {
  const f = await mountAdmin(<Compliance />, {
    [path]: record([
      row(),
      row({
        variable: 'email',
        classification: 'pii',
        attention: false,
        persisted: true,
        origins: 'context:interaction.email; script',
        destinations: 'screen:/pages/0/x',
      }),
    ]),
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('processing.generate') }));
  await showRows();
  const table = await screen.findByRole('table');
  expect(within(table).getAllByText(/Contact-center platform/)).toHaveLength(1);
  expect(within(table).getByText(/External service: fraud/)).toBeTruthy();
  expect(within(table).getByText(/Customer data: interaction.email, Script logic/)).toBeTruthy();
  expect(table.textContent).not.toContain('/pages/0');
  expect(table.textContent).not.toContain('agentInput:');
  expect(within(table).getByText(f.label('enum.classification.pci'))).toBeTruthy();
  expect(screen.getByText(f.label('processing.attentionHint'))).toBeTruthy();
});

it('filters by classification, by "to review" and by text, and says when nothing matches', async () => {
  const f = await mountAdmin(<Compliance />, {
    [path]: record([row(), row({ variable: 'email', classification: 'pii', attention: false })]),
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('processing.generate') }));
  await showRows();
  const table = () => screen.getByRole('table');
  expect(within(table()).getAllByRole('row')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText(f.label('processing.classification')), {
    target: { value: 'pii' },
  });
  await waitFor(() => {
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
  });
  fireEvent.change(screen.getByLabelText(f.label('processing.classification')), {
    target: { value: 'all' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: f.label('processing.attentionOnly') }));
  await waitFor(() => {
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
  });
  fireEvent.change(screen.getByLabelText(f.label('processing.search')), {
    target: { value: 'zzz' },
  });
  expect(await screen.findByText(f.label('processing.noMatch'))).toBeTruthy();
});

it('warns about unreadable scripts and a truncated record, and has an empty state', async () => {
  const f = await mountAdmin(<Compliance />, {
    [path]: record([], { unreadable: 2, truncated: true }),
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('processing.generate') }));
  expect(
    await screen.findByText(f.i18n.t('adminWorkspace.processing.unreadable', { count: 2 })),
  ).toBeTruthy();
  expect(screen.getByText(f.label('processing.truncated'))).toBeTruthy();
  expect(screen.getByText(f.label('processing.empty'))).toBeTruthy();
});

it('downloads CSV and JSON as separate audited requests', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn().mockReturnValue('blob:x'),
      revokeObjectURL: vi.fn(),
    }),
  );
  const f = await mountAdmin(<Compliance />, {
    [path]: record([row()]),
    '/v1/compliance/processing-record?format=csv': new Response('a,b', {
      headers: { 'content-type': 'text/csv' },
    }),
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('processing.generate') }));
  fireEvent.click(await screen.findByRole('button', { name: f.label('processing.csv') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.endsWith('format=csv'))).toBe(true);
  });
  await waitFor(() => {
    expect(click).toHaveBeenCalled();
  });
});

it('reports a failure without showing a partial record', async () => {
  const f = await mountAdmin(<Compliance />, {
    [path]: Response.json({ code: 'VERBIS_AUTHZ_FORBIDDEN' }, { status: 403 }),
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('processing.generate') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(f.label('processing.resultTitle'))).toBeNull();
});
