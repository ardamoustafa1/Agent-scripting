import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';
import { ScriptDocumentSchema } from '@verbis/script-schema';

import { editorFixture } from '../editor/fixtures.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptFixture, scriptId, sessionFixture } from '../test-fixtures.js';

import ScriptPage from './script.js';
import Settings from './settings.js';

const base = `/v1/scripts/${scriptId}`;
const authorId = '01928f3a-0000-7000-8000-0000000000a1';
const version = {
  id: editorFixture().id,
  number: 1,
  state: 'published',
  createdAt: 'synthetic',
  createdBy: `user:${authorId}`,
};
async function setup(
  extra: Record<string, unknown> = {},
  path = '',
  allowed = true,
  state?: unknown,
) {
  return mountDesigner(
    <ScriptPage />,
    {
      [base]: scriptFixture,
      [`${base}/versions?limit=100&sort=-number`]: { data: [version], page: { nextCursor: null } },
      [`${base}/versions/1/team-members`]: [{ id: authorId, name: 'Synthetic author' }],
      [`${base}/versions/1`]: {
        document: {
          variables: [
            { key: 'syntheticValue', type: 'string', scope: 'session', classification: 'internal' },
          ],
        },
      },
      ...extra,
    },
    {
      route: '/scripts/:id/*',
      path: `/scripts/${scriptId}${path}`,
      ...(allowed ? {} : { ability: createAbility([{ action: 'read', subject: 'Script' }]) }),
      ...(state === undefined ? {} : { state }),
    },
  );
}
it('opens the latest editor and links review, assignments and package management', async () => {
  const f = await setup();
  await screen.findByRole('heading', { name: scriptFixture.name });
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
  expect(
    screen.getByRole('link', { name: f.label('lifecycle.reviewRelease') }).getAttribute('href'),
  ).toBe(`${base.slice(3)}/versions/1/release`);
  expect(screen.getByText('Synthetic author')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: f.label('lifecycle.assignments') }).getAttribute('href'),
  ).toBe(`/scripts/${scriptId}/assignments`);
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.title') }));
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}/versions/1/edit`);
  });
});
it('names version authors instead of showing actor references', async () => {
  const rows = [
    { ...version, number: 4, createdBy: `user:${sessionFixture.user.id}` },
    { ...version, number: 3, createdBy: 'service:template-gallery' },
    { ...version, number: 2, createdBy: 'user:01928f3a-0000-7000-8000-0000000000ff' },
    { ...version, number: 1 },
  ];
  const f = await setup({
    [`${base}/versions?limit=100&sort=-number`]: { data: rows, page: { nextCursor: null } },
    [`${base}/versions/4/team-members`]: [{ id: authorId, name: 'Synthetic author' }],
  });
  await screen.findByRole('heading', { name: scriptFixture.name });
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
  expect(await screen.findByText('Synthetic author')).toBeTruthy();
  expect(screen.getByText(f.label('workspace.you'))).toBeTruthy();
  expect(screen.getByText(f.label('workspace.owners.system'))).toBeTruthy();
  expect(screen.getByText(f.label('workspace.owners.former'))).toBeTruthy();
  expect(document.body.textContent).not.toContain('user:');
});
it('shows the latest variable inventory and hides mutation controls from readers', async () => {
  const f = await setup({}, '/variables', false);
  await screen.findByRole('heading', { name: scriptFixture.name });
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
  expect(await screen.findByText('syntheticValue')).toBeTruthy();
  expect(screen.queryByRole('button', { name: f.label('editor.title') })).toBeNull();
  fireEvent.mouseDown(screen.getByRole('tab', { name: f.label('workspace.nav.releases') }), {
    button: 0,
  });
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}/releases`);
  });
});
it('creates a valid first draft with CSRF and a reusable idempotency key after a failure', async () => {
  const f = await setup({
    [`${base}/versions?limit=100&sort=-number`]: { data: [], page: { nextCursor: null } },
    [`POST ${base}/versions`]: Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 }),
  });
  fireEvent.click(
    await screen.findByRole('button', { name: f.label('workspace.createFirstDraft') }),
  );
  await screen.findByRole('button', { name: f.label('workspace.retry') });
  const first = f.requests.find((r) => r.method === 'POST')!;
  expect(new Headers(first.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
  expect(
    ScriptDocumentSchema.safeParse((first.body as { document: unknown }).document).success,
  ).toBe(true);
  f.responses[`POST ${base}/versions`] = { number: 2 };
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.retry') }));
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}/versions/2/edit`);
  });
  const posts = f.requests.filter((r) => r.method === 'POST');
  expect(new Headers(posts[1]!.init?.headers).get('idempotency-key')).toBe(
    new Headers(first.init?.headers).get('idempotency-key'),
  );
  expect(new Headers(first.init?.headers).get('idempotency-key')).toBeTruthy();
});
it('creates an editable next draft from a published version without losing its document or linked screens', async () => {
  const source = {
    ...editorFixture(),
    state: 'published',
    screens: [{ sharedScreenId: scriptId, versionNumber: 3, mode: 'linked', pageIds: ['home'] }],
  };
  const f = await setup({
    [`${base}/versions/1`]: source,
    [`POST ${base}/versions`]: { number: 2 },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: f.label('workspace.createNextDraft') }),
  );
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}/versions/2/edit`);
  });
  expect(f.requests.find((r) => r.method === 'POST')?.body).toEqual({
    document: source.document,
    screens: [{ sharedScreenId: scriptId, versionNumber: 3, mode: 'linked' }],
  });
});
it('recovers a failed script fetch', async () => {
  const f = await setup({
    [base]: Response.json({ code: 'VERBIS_HTTP_UNAVAILABLE' }, { status: 503 }),
  });
  const retry = await screen.findByRole('button', { name: f.label('workspace.retry') });
  f.responses[base] = scriptFixture;
  fireEvent.click(retry);
  expect(await screen.findByRole('heading', { name: scriptFixture.name })).toBeTruthy();
});
it('shows empty variable inventories when no version exists', async () => {
  const f = await setup(
    { [`${base}/versions?limit=100&sort=-number`]: { data: [], page: { nextCursor: null } } },
    '/variables',
    false,
  );
  expect(await screen.findByText(f.label('workspace.noVersions'))).toBeTruthy();
  expect(f.requests.some((r) => r.path === `${base}/versions/1`)).toBe(false);
});
it('displays the session tenant and selected deployment environment', async () => {
  const f = await mountDesigner(<Settings />, {}, { environment: 'prod' });
  expect(screen.getByText(sessionFixture.user.tenantId)).toBeTruthy();
  expect(screen.getByText(f.label('workspace.env.prod'))).toBeTruthy();
  expect(screen.getByText(f.label('workspace.ssoManaged'))).toBeTruthy();
});

it('guides the first draft without showing an empty version table', async () => {
  const f = await setup({
    [`${base}/versions?limit=100&sort=-number`]: { data: [], page: { nextCursor: null } },
  });
  expect(await screen.findByText(f.label('workspace.firstDraftHint'))).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('button', { name: f.label('workspace.createFirstDraft') })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: f.label('workspace.scriptActions') })).toBeTruthy();
});

it('opens regression outside table cells in an accessible dialog and returns focus on close', async () => {
  const f = await setup();
  await screen.findByRole('heading', { name: scriptFixture.name });
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
  expect(screen.queryByRole('region', { name: f.label('preview.regression') })).toBeNull();
  const trigger = screen.getByRole('button', { name: f.label('preview.regression') });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: f.label('preview.regression') });
  expect(dialog.closest('td')).toBeNull();
  expect(screen.getByRole('button', { name: f.label('preview.runScenarios') })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('explains missing access instead of a loading skeleton when the versions are forbidden', async () => {
  const f = await setup({
    [`${base}/versions?limit=100&sort=-number`]: Response.json(
      {
        type: 'https://errors.verbis.io/authz/forbidden',
        title: 'Forbidden',
        status: 403,
        code: 'VERBIS_AUTHZ_FORBIDDEN',
      },
      { status: 403 },
    ),
  });
  expect(await screen.findByText(f.label('workspace.denied'))).toBeTruthy();
  expect(screen.queryByLabelText(f.label('workspace.loading'))).toBeNull();
});

it('opens a script created from "New script" straight in the editor with its first draft', async () => {
  const f = await setup(
    {
      [`${base}/versions?limit=100&sort=-number`]: { data: [], page: { nextCursor: null } },
      [`POST ${base}/versions`]: { number: 1 },
    },
    '',
    true,
    { openEditor: true },
  );
  await waitFor(() => {
    expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}/versions/1/edit`);
  });
  const posts = f.requests.filter((r) => r.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(new Headers(posts[0]!.init?.headers).get('idempotency-key')).toBeTruthy();
  expect(
    ScriptDocumentSchema.safeParse((posts[0]!.body as { document: unknown }).document).success,
  ).toBe(true);
});
it('does not create a draft by itself when the script already has versions', async () => {
  const f = await setup({}, '', true, { openEditor: true });
  await screen.findByRole('heading', { name: scriptFixture.name });
  fireEvent.click(await screen.findByRole('button', { name: /show all rows/i }));
  expect(screen.getByText('Synthetic author')).toBeTruthy();
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
  expect(f.router.state.location.pathname).toBe(`/scripts/${scriptId}`);
});
it('does not create a draft by itself for a user who cannot create scripts', async () => {
  const f = await setup(
    { [`${base}/versions?limit=100&sort=-number`]: { data: [], page: { nextCursor: null } } },
    '',
    false,
    { openEditor: true },
  );
  expect(await screen.findByText(f.label('workspace.firstDraftHint'))).toBeTruthy();
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
});

it('archives a script after confirmation and restores it as a draft', async () => {
  const f = await setup({
    [base]: { ...scriptFixture, version: 3 },
    [`PATCH ${base}`]: { ...scriptFixture, version: 4, status: 'archived' },
  });
  await screen.findByRole('heading', { name: scriptFixture.name });
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.archive') }));
  const dialog = await screen.findByRole('dialog', {
    name: f.i18n.t('designer.workspace.archiveTitle', { name: scriptFixture.name }),
  });
  expect(f.requests.some((r) => r.method === 'PATCH')).toBe(false);
  fireEvent.click(
    within(dialog).getByRole('button', { name: f.label('workspace.archiveConfirm') }),
  );
  await waitFor(() => {
    expect(f.requests.find((r) => r.method === 'PATCH')).toMatchObject({
      path: base,
      body: { status: 'archived' },
    });
  });
  const patch = f.requests.find((r) => r.method === 'PATCH')!;
  expect(new Headers(patch.init?.headers).get('if-match')).toBe('"3"');
  expect(new Headers(patch.init?.headers).get('x-csrf-token')).toBe(sessionFixture.csrfToken);
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('shows an archived script as archived and restores it as a draft without a published version', async () => {
  const f = await setup({
    [base]: { ...scriptFixture, version: 5, status: 'archived' },
    [`PATCH ${base}`]: { ...scriptFixture, version: 6, status: 'draft' },
  });
  expect(await screen.findByText(f.label('workspace.archivedNotice'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('workspace.unarchive') }));
  await waitFor(() => {
    expect(f.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ status: 'draft' });
  });
});

it('offers no archive action to readers', async () => {
  const f = await setup({ [base]: { ...scriptFixture, version: 3 } }, '', false);
  await screen.findByRole('heading', { name: scriptFixture.name });
  expect(screen.queryByRole('button', { name: f.label('workspace.archive') })).toBeNull();
});
