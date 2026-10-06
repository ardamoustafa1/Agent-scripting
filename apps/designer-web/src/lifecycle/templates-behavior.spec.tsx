import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId, scriptFixture } from '../test-fixtures.js';

import TemplateGallery from './templates.js';

const rows = [
  {
    id: 'tenant-template',
    name: 'Synthetic template',
    category: 'service',
    description: 'Synthetic description',
    tags: ['banking'],
    builtIn: false,
  },
  {
    id: 'banking',
    name: 'Unused built-in name',
    category: 'sales',
    description: null,
    tags: ['telecom'],
    builtIn: true,
  },
];
async function setup(extra: Record<string, unknown> = {}) {
  const f = await mountDesigner(<TemplateGallery />, {
    '/v1/templates': rows,
    '/v1/scripts?limit=100': { data: [scriptFixture], page: { nextCursor: null } },
    [`/v1/scripts/${scriptId}/versions?limit=100&sort=-number`]: {
      data: [{ id: campaignId, number: 3, state: 'published', createdAt: 'synthetic' }],
      page: { nextCursor: null },
    },
    'POST /v1/templates': { id: 'synthetic-created' },
    '/v1/templates/tenant-template/instantiate': {
      script: { id: scriptId },
      version: { number: 4 },
    },
    ...extra,
  });
  await screen.findByRole('heading', { name: 'Synthetic template' });
  return f;
}
async function choose(label: string, name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name }));
}
it('filters templates by name, industry and source', async () => {
  const f = await setup();
  fireEvent.change(screen.getByLabelText(f.label('workspace.search')), {
    target: { value: 'absent' },
  });
  expect(screen.queryByRole('heading', { name: 'Synthetic template' })).toBeNull();
  fireEvent.change(screen.getByLabelText(f.label('workspace.search')), { target: { value: '' } });
  await choose(f.label('lifecycle.industry'), f.label('lifecycle.industries.banking'));
  expect(screen.getAllByRole('button', { name: f.label('lifecycle.useTemplate') })).toHaveLength(1);
  await choose(f.label('lifecycle.templateSource'), f.label('lifecycle.sources.builtin'));
  expect(screen.queryByRole('button', { name: f.label('lifecycle.useTemplate') })).toBeNull();
});
it('instantiates a selected template as a named draft and navigates to the new version', async () => {
  const f = await setup();
  const article = screen.getByRole('heading', { name: 'Synthetic template' }).closest('article')!;
  fireEvent.click(within(article).getByRole('button', { name: f.label('lifecycle.useTemplate') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(f.label('workspace.name')), {
    target: { value: 'Synthetic copied script' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('lifecycle.save') }));
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}/versions/4/edit`);
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    name: 'Synthetic copied script',
  });
});
it('creates a tenant template from a pinned script version', async () => {
  const f = await setup();
  await choose(f.label('lifecycle.industry'), f.label('lifecycle.industries.banking'));
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.createTemplate') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(f.label('workspace.name')), {
    target: { value: 'Synthetic created template' },
  });
  await choose(f.label('workspace.nav.scripts'), scriptFixture.name);
  await choose(f.label('workspace.version'), 'v3');
  await choose(f.label('lifecycle.category'), f.label('lifecycle.categories.sales'));
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('lifecycle.save') }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    name: 'Synthetic created template',
    scriptId,
    versionNumber: 3,
    category: 'sales',
    tags: ['banking'],
  });
});
it('keeps template input after failure and permits closing the dialog', async () => {
  const f = await setup({
    '/v1/templates/tenant-template/instantiate': Response.json({}, { status: 500 }),
  });
  fireEvent.click(
    within(
      screen.getByRole('heading', { name: 'Synthetic template' }).closest('article')!,
    ).getByRole('button', { name: f.label('lifecycle.useTemplate') }),
  );
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: f.label('lifecycle.save') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(within(dialog).getByLabelText<HTMLInputElement>(f.label('workspace.name')).value).toBe(
    'Synthetic template',
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
it('shows gallery failure and retries', async () => {
  const f = await mountDesigner(<TemplateGallery />, {
    '/v1/templates': Response.json({}, { status: 500 }),
  });
  const retry = await screen.findByRole('button', { name: f.label('workspace.retry') });
  f.responses['/v1/templates'] = rows;
  fireEvent.click(retry);
  expect(await screen.findByRole('heading', { name: 'Synthetic template' })).toBeTruthy();
});
it('renders templates for readers without allowing create or instantiate', async () => {
  const f = await mountDesigner(
    <TemplateGallery />,
    { '/v1/templates': rows },
    { ability: createAbility([]) },
  );
  await screen.findByRole('heading', { name: 'Synthetic template' });
  expect(screen.queryByRole('button', { name: f.label('lifecycle.createTemplate') })).toBeNull();
  expect(
    screen
      .getAllByRole('button', { name: f.label('lifecycle.useTemplate') })
      .every((b) => b.hasAttribute('disabled')),
  ).toBe(true);
});
