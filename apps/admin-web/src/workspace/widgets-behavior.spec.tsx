import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

import { mountAdmin } from './fixtures.spec.helpers.js';
import { Action, DiffView, Field, Check, Picker, ResourceList, SaveForm } from './widgets.js';

it('requires explicit confirmation for dangerous operations, supports cancellation, and reports completion', async () => {
  const run = vi.fn().mockResolvedValue(undefined),
    f = await mountAdmin(<Action label="Delete synthetic item" danger run={run} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete synthetic item' }));
  expect(run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: f.label('cancel') }));
  expect(screen.queryByRole('group')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Delete synthetic item' }));
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await screen.findByText(f.label('saved'));
  expect(run).toHaveBeenCalledOnce();
  expect(screen.queryByRole('group')).toBeNull();
});
it('reports failed actions and clears their error on a successful retry', async () => {
  const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('VERBIS_CONFLICT'))
      .mockResolvedValue(undefined),
    f = await mountAdmin(<Action label="Synthetic action" run={run} />);
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic action' }));
  expect((await screen.findByRole('alert')).textContent).toContain('VERBIS_CONFLICT');
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic action' }));
  await screen.findByText(f.label('saved'));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('keeps disabled actions inert and does not double-submit a pending form', async () => {
  let finish: (() => void) | undefined;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const f = await mountAdmin(
    <>
      <Action label="Denied action" disabled run={vi.fn()} />
      <SaveForm onSave={save}>
        <Field label="Synthetic name" value="Synthetic" onChange={vi.fn()} required />
      </SaveForm>
    </>,
  );
  expect(
    screen.getByRole('button', { name: 'Denied action' }).getAttribute('disabled'),
  ).not.toBeNull();
  const form = f.ui.container.querySelector('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => {
    expect(save).toHaveBeenCalledOnce();
  });
  finish?.();
  await screen.findByText(f.label('saved'));
});
it('validates form failure recovery without losing field contents', async () => {
  const save = vi
      .fn()
      .mockRejectedValueOnce('invalid synthetic value')
      .mockResolvedValue(undefined),
    f = await mountAdmin(
      <SaveForm onSave={save}>
        <Field label="Synthetic name" value="Synthetic" onChange={vi.fn()} />
      </SaveForm>,
    );
  fireEvent.submit(f.ui.container.querySelector('form')!);
  expect((await screen.findByRole('alert')).textContent).toContain(f.label('invalid'));
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Synthetic name' }).value).toBe(
    'Synthetic',
  );
  fireEvent.submit(f.ui.container.querySelector('form')!);
  await screen.findByText(f.label('saved'));
});
it('does not submit a disabled form through its submit event', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const f = await mountAdmin(
    <SaveForm disabled onSave={save}>
      <Field label="Synthetic name" value="Synthetic" onChange={vi.fn()} />
    </SaveForm>,
  );
  fireEvent.submit(f.ui.container.querySelector('form')!);
  await Promise.resolve();
  expect(save).not.toHaveBeenCalled();
});
it('clears the resource cursor when the resource path changes', async () => {
  function SwitchList() {
    const [path, setPath] = useState('/v1/first');
    return (
      <>
        <button
          onClick={() => {
            setPath('/v1/second');
          }}
        >
          Switch list
        </button>
        <ResourceList path={path} title="Synthetic list" columns={['name']} />
      </>
    );
  }
  const f = await mountAdmin(<SwitchList />, {
    '/v1/first': { data: [{ id: 'first', name: 'First' }], page: { nextCursor: 'first-cursor' } },
    '/v1/first?cursor=first-cursor': { data: [], page: { nextCursor: null } },
    '/v1/second': { data: [{ id: 'second', name: 'Second' }], page: { nextCursor: null } },
  });
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: f.label('next') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === '/v1/first?cursor=first-cursor')).toBe(true);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Switch list' }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === '/v1/second')).toBe(true);
  });
  expect(f.requests.some((r) => r.path === '/v1/second?cursor=first-cursor')).toBe(false);
});
it('renders form input variants and forwards typed change events', async () => {
  const text = vi.fn(),
    choice = vi.fn(),
    checked = vi.fn();
  await mountAdmin(
    <>
      <Field label="Synthetic textarea" type="textarea" value="" onChange={text} />
      <Field
        label="Synthetic choice"
        value="first"
        options={['first', 'second']}
        onChange={choice}
      />
      <Check label="Synthetic approval" checked={false} onChange={checked} />
    </>,
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Synthetic text' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'second' } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(text).toHaveBeenCalledWith('Synthetic text');
  expect(choice).toHaveBeenCalledWith('second');
  expect(checked).toHaveBeenCalledWith(true);
});
it('loads, selects and paginates resource rows with URL-encoded keyset cursors', async () => {
  const select = vi.fn(),
    f = await mountAdmin(
      <ResourceList
        path="/v1/synthetic?limit=1"
        title="Synthetic list"
        columns={['name']}
        onSelect={select}
      />,
      {
        '/v1/synthetic?limit=1': {
          data: [{ id: 'first', name: 'First synthetic' }],
          page: { nextCursor: 'cursor+/=' },
        },
        '/v1/synthetic?limit=1&cursor=cursor%2B%2F%3D': {
          data: [{ id: 'second', name: 'Second synthetic' }],
          page: { nextCursor: null },
        },
      },
    );
  await screen.findByRole('table', { name: 'Synthetic list' });
  const allRows = screen.queryByRole('button', { name: /show all rows/i });
  if (allRows) fireEvent.click(allRows);
  fireEvent.click(await screen.findByRole('button', { name: f.label('details') }));
  expect(select).toHaveBeenCalledWith({ id: 'first', name: 'First synthetic' });
  fireEvent.click(screen.getByRole('button', { name: f.label('next') }));
  await screen.findByRole('table', { name: 'Synthetic list' });
  const secondRows = screen.queryByRole('button', { name: /show all rows/i });
  if (secondRows) fireEvent.click(secondRows);
  await screen.findByText('Second synthetic');
  expect(f.requests.at(-1)?.path).toBe('/v1/synthetic?limit=1&cursor=cursor%2B%2F%3D');
  fireEvent.click(screen.getByRole('button', { name: f.label('first') }));
  await screen.findByRole('table', { name: 'Synthetic list' });
  const firstRows = screen.queryByRole('button', { name: /show all rows/i });
  if (firstRows) fireEvent.click(firstRows);
  await screen.findByText('First synthetic');
});
it('recovers failed list loading through retry and distinguishes an empty successful page', async () => {
  const f = await mountAdmin(
    <ResourceList path="/v1/synthetic" title="Synthetic list" columns={['name']} />,
    { '/v1/synthetic': Response.json({ code: 'VERBIS_FORBIDDEN' }, { status: 403 }) },
  );
  await screen.findByRole('alert');
  f.responses['/v1/synthetic'] = [];
  fireEvent.click(screen.getByRole('button', { name: f.label('retry') }));
  await screen.findAllByText(f.label('empty'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.getByRole('button', { name: f.label('next') }).getAttribute('disabled'),
  ).not.toBeNull();
});
it('uses display name, name, email and ID picker fallbacks without changing the bound row identity', async () => {
  const change = vi.fn();
  await mountAdmin(
    <Picker path="/v1/synthetic" label="Synthetic picker" value="" onChange={change} />,
    {
      '/v1/synthetic': [
        { id: 'first', displayName: 'Display synthetic' },
        { id: 'second', name: 'Name synthetic' },
        { id: 'third', email: 'synthetic@example.test' },
        { id: 'fourth' },
      ],
    },
  );
  await screen.findByRole('option', { name: 'Display synthetic' });
  expect(screen.getByRole('option', { name: 'Name synthetic' })).toBeDefined();
  expect(screen.getByRole('option', { name: 'synthetic@example.test' })).toBeDefined();
  expect(screen.getByRole('option', { name: 'fourth' })).toBeDefined();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'third' } });
  expect(change).toHaveBeenCalledWith('third');
});
it.each([
  null,
  { mode: 'snapshot', before: { name: 'Before' }, after: { name: 'After' } },
  { mode: 'patch', ops: [{ op: 'replace', path: '/name', value: 'Synthetic replacement' }] },
  { other: 'Synthetic fallback' },
])('renders structured audit diffs without evaluating embedded content', async (value) => {
  const f = await mountAdmin(<DiffView value={value} />);
  if (value === null) expect(screen.getByText(f.label('empty'))).toBeDefined();
  else expect(within(f.ui.container).getAllByRole('textbox').length).toBeGreaterThan(0);
});

it('blocks a dangerous confirmation when its action becomes disabled', async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  function ChangingPermission() {
    const [disabled, setDisabled] = useState(false);
    return (
      <>
        <button
          onClick={() => {
            setDisabled(true);
          }}
        >
          Revoke action
        </button>
        <Action label="Dangerous action" danger disabled={disabled} run={run} />
      </>
    );
  }
  const f = await mountAdmin(<ChangingPermission />);
  fireEvent.click(screen.getByRole('button', { name: 'Dangerous action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revoke action' }));
  fireEvent.click(screen.getByRole('button', { name: f.label('confirm') }));
  await Promise.resolve();
  expect(run).not.toHaveBeenCalled();
});
