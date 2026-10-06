import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import type { Runtime } from '@verbis/core-runtime';
import { createI18n, type I18nInstance } from '@verbis/i18n';
import { UiProvider } from '@verbis/ui';

import { DataComponent } from './data.js';
import { createFixtureRuntime, syntheticRendererProps } from './test-fixtures.js';

let i18n: I18nInstance;
const engines: Runtime[] = [];
beforeAll(async () => {
  i18n = await createI18n();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  engines.splice(0).forEach((runtime) => {
    runtime.dispose();
  });
  vi.restoreAllMocks();
});
function mount(type: string, props: Record<string, unknown>) {
  const runtime = createFixtureRuntime(type);
  engines.push(runtime);
  const component = syntheticRendererProps(runtime, type),
    write = vi.fn(),
    emit = vi.fn().mockResolvedValue(undefined);
  const execute = vi.spyOn(runtime.executor, 'execute').mockResolvedValue(undefined);
  const view = render(
    <UiProvider i18n={i18n}>
      <DataComponent
        {...component}
        props={{ ...component.props, ...props }}
        node={{ ...component.node, bindings: [{ prop: 'value', variable: 'field' }] }}
        write={write}
        emit={emit}
      />
    </UiProvider>,
  );
  return { runtime, write, emit, execute, view };
}
it.each(['keyValueList', 'customerCard', 'table', 'dataGrid'])(
  'formats populated %s data without exposing malformed dates',
  (type) => {
    const f = mount(type, {
      rows: [
        {
          id: 'synthetic',
          name: 'Synthetic customer',
          amount: 1234.5,
          count: 1234.5,
          date: '2026-10-03T12:00:00Z',
          invalid: 'not-a-date',
          obj: { key: 'value' },
          flag: true,
          missing: null,
        },
      ],
      columns: [
        { field: 'name', labelKey: 'components.category' },
        { field: 'amount', labelKey: 'components.value', format: 'currency' },
        { field: 'count', labelKey: 'components.value', format: 'number' },
        { field: 'date', labelKey: 'components.date', format: 'date' },
        { field: 'invalid', labelKey: 'components.invalid', format: 'date' },
        { field: 'obj', labelKey: 'components.field' },
        { field: 'flag', labelKey: 'components.field' },
        { field: 'missing', labelKey: 'components.field' },
      ],
    });
    if (type === 'table' || type === 'dataGrid')
      fireEvent.click(screen.getByRole('button', { name: i18n.t('ui.showAllRows') }));
    expect(screen.getByText('Synthetic customer')).toBeDefined();
    const content = f.view.container.textContent;
    expect(content).toContain(
      new Intl.NumberFormat(f.runtime.store.locale, { style: 'currency', currency: 'TRY' }).format(
        1234.5,
      ),
    );
    expect(content).toContain(new Intl.NumberFormat(f.runtime.store.locale).format(1234.5));
    expect(content).toContain(
      new Intl.DateTimeFormat(f.runtime.store.locale).format(new Date('2026-10-03T12:00:00Z')),
    );
    expect(content).not.toContain('not-a-date');
  },
);
it('renders chronological descriptions, including rows without an identifier', () => {
  mount('timeline', {
    rows: [
      { name: 'First synthetic event', date: '2026-10-03', description: 'Synthetic details' },
      { id: 'second', name: 'Second event', description: 'Follow-up' },
    ],
  });
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('Synthetic details')).toBeDefined();
  expect(document.querySelector('time')?.textContent).toBe('2026-10-03');
});
it.each(['bar', 'line'])(
  'renders accessible %s charts with bounded values and a readable data table',
  (chartType) => {
    const f = mount('chart', {
      chartType,
      rows: [
        { name: 'Positive', amount: 10 },
        { name: 'Negative', amount: -5 },
        { name: 'Missing' },
        { name: 'Invalid', amount: 'text' },
      ],
    });
    expect(screen.getByRole('img')).toBeDefined();
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getByRole('rowheader', { name: 'Negative' })).toBeDefined();
    if (chartType === 'bar')
      expect(
        [...f.view.container.querySelectorAll('rect')].map((rect) => rect.getAttribute('width')),
      ).toEqual(['600', '0', '0', '0']);
    else
      expect(f.view.container.querySelector('polyline')?.getAttribute('points')).toBe(
        '0,20 200,206 400,144 600,144',
      );
  },
);
it('refreshes empty manual data through the runtime action executor', async () => {
  const f = mount('keyValueList', { rows: [] });
  expect(screen.getByText(i18n.t('components.empty'))).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('components.refresh') }));
  await waitFor(() => {
    expect(f.execute).toHaveBeenCalledWith(
      [{ type: 'callDataSource', dataSource: 'lookup' }],
      f.runtime.signal,
      'ui:sample',
    );
  });
});
it('updates the autocomplete query variable while preserving selected values', async () => {
  const f = mount('autoComplete', {
    rows: [{ id: 'first', name: 'Synthetic result' }, { name: 'Missing identifier' }],
  });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'search term' } });
  expect(f.runtime.store.variable('query')).toBe('search term');
  await act(async () => {
    await Promise.resolve();
  });
  expect(f.write).not.toHaveBeenCalled();
  expect(f.runtime.store.variable('field')).toBe('');
});

it.each(['loading', 'error', 'idle'])('does not show empty results during %s', (status) => {
  const f = mount('customerCard', { ds: 'customers' });
  act(() => {
    f.runtime.store.set('ds.customers', { status, loading: status === 'loading' });
  });
  expect(screen.queryByText(i18n.t('components.empty'))).toBeNull();
});
