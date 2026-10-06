import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, expect, it } from 'vitest';

import { createI18n, type I18nInstance } from '@verbis/i18n';

import { UiProvider } from '../provider.js';

import { DataTable } from './data-table.js';

let i18n: I18nInstance;
beforeAll(async () => {
  i18n = await createI18n('en');
});
const rows = [
  { id: 'b', name: 'Beta', count: 2 },
  { id: 'a', name: 'Alpha', count: 1 },
];
const columns = [
  { id: 'name', header: 'Name', accessor: (row: (typeof rows)[number]) => row.name, size: 160 },
  {
    id: 'count',
    header: 'Count',
    accessor: (row: (typeof rows)[number]) => row.count,
    sortable: false,
    cell: (row: (typeof rows)[number]) => <strong>{row.count}</strong>,
  },
];
it.each(['ltr', 'rtl'] as const)(
  'sorts, filters and resizes columns with the %s keyboard',
  (direction) => {
    render(
      <UiProvider i18n={i18n}>
        <DataTable
          label="Records"
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          virtualized={false}
          direction={direction}
        />
      </UiProvider>,
    );
    const table = screen.getByRole('table'),
      sort = screen.getByRole('button', { name: 'Sort by Name' });
    fireEvent.click(sort);
    expect(within(table).getAllByRole('row')[1]?.textContent).toBe('Alpha1');
    expect(within(table).getAllByRole('columnheader')[0]?.getAttribute('aria-sort')).toBe(
      'ascending',
    );
    fireEvent.click(sort);
    expect(within(table).getAllByRole('row')[1]?.textContent).toBe('Beta2');
    expect(within(table).getAllByRole('columnheader')[0]?.getAttribute('aria-sort')).toBe(
      'descending',
    );
    fireEvent.click(sort);
    expect(within(table).getAllByRole('columnheader')[0]?.getAttribute('aria-sort')).toBe('none');
    const resize = screen.getByRole('slider', { name: 'Resize Name column' });
    fireEvent.keyDown(resize, { key: 'ArrowRight' });
    expect(resize.getAttribute('aria-valuenow')).toBe(direction === 'ltr' ? '176' : '144');
    fireEvent.keyDown(resize, { key: 'ArrowLeft' });
    expect(resize.getAttribute('aria-valuenow')).toBe('160');
    fireEvent.keyDown(resize, { key: 'Home' });
    expect(resize.getAttribute('aria-valuenow')).toBe('160');
    fireEvent.keyDown(resize, { key: 'F1' });
    fireEvent.doubleClick(resize);
    expect(resize.getAttribute('aria-valuenow')).toBe('160');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alpha' } });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText(i18n.t('ui.tableEmpty'))).toBeDefined();
  },
);
it('toggles accessible all-row mode for virtual data and supports missing cell values', () => {
  const data = [
    { id: 'one', value: null },
    { id: 'two', value: true },
    { id: 'three', value: { nested: 1 } },
  ];
  render(
    <UiProvider i18n={i18n}>
      <DataTable
        label="Values"
        data={data}
        columns={[
          { id: 'value', header: 'Value', accessor: (row) => row.value as unknown as string },
        ]}
        getRowId={(row) => row.id}
      />
    </UiProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: i18n.t('ui.showAllRows') }));
  expect(screen.getByText('true')).toBeDefined();
  expect(screen.getByText('{"nested":1}')).toBeDefined();
  expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe('4');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('ui.virtualRows') }));
  expect(
    screen.getByRole('button', { name: i18n.t('ui.showAllRows') }).getAttribute('aria-pressed'),
  ).toBe('false');
});

it('filters Turkish dotted and dotless letters using the active locale', async () => {
  const turkish = await createI18n('tr');
  const data = [
    { id: 'customer', name: 'Müşteri karşılama' },
    { id: 'call', name: 'Çağrı akışı' },
  ];
  render(
    <UiProvider i18n={turkish}>
      <DataTable
        label="Scriptler"
        data={data}
        columns={[{ id: 'name', header: 'Ad', accessor: (row) => row.name }]}
        getRowId={(row) => row.id}
        virtualized={false}
      />
    </UiProvider>,
  );
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'MÜŞTERİ' } });
  expect(screen.getByText('Müşteri karşılama')).toBeDefined();
  expect(screen.queryByText('Çağrı akışı')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ÇAĞRI' } });
  expect(screen.getByText('Çağrı akışı')).toBeDefined();
  expect(screen.queryByText('Müşteri karşılama')).toBeNull();
});
