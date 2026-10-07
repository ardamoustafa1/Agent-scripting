import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { editorFixture } from '../editor/fixtures.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { campaignId, scriptId, scriptFixture } from '../test-fixtures.js';

import ReleasePage from './release.js';

const base = `/v1/scripts/${scriptId}/versions/2`;
async function setup(
  state: 'draft' | 'in_review' | 'approved' | 'published',
  extra: Record<string, unknown> = {},
) {
  const version = { ...editorFixture(), state, number: 2 };
  const f = await mountDesigner(
    <ReleasePage />,
    {
      [base]: version,
      [`/v1/scripts/${scriptId}/versions/1`]: { ...editorFixture(), state: 'published' },
      [`/v1/scripts/${scriptId}/versions?limit=100&sort=-number`]: {
        data: [
          { id: version.id, number: 2, state, createdAt: 'synthetic' },
          { id: campaignId, number: 1, state: 'published', createdAt: 'synthetic' },
        ],
        page: { nextCursor: null },
      },
      [`/v1/scripts/${scriptId}`]: { ...scriptFixture, currentVersionId: version.id },
      [`/v1/scripts/${scriptId}/versions/1/diff/2`]: {
        patch: [{ op: 'replace', path: '/meta/name', value: 'Synthetic change' }],
      },
      [`${base}/schedules`]: [
        { id: campaignId, state: 'pending', runAt: '2026-10-05T10:00:00Z', completedAt: null },
      ],
      [`${base}/reviews`]: [
        {
          id: 'synthetic-review',
          reviewer: 'Synthetic reviewer',
          decision: 'commented',
          comment: null,
          reason: 'Synthetic reason',
          createdAt: 'synthetic',
        },
      ],
      [`${base}/comments`]: [],
      ...extra,
    },
    {
      route: '/scripts/:id/versions/:number/release',
      path: `/scripts/${scriptId}/versions/2/release`,
    },
  );
  await screen.findByText('Synthetic reviewer');
  return f;
}
it('requires valid semver and a note before submitting a draft for review', async () => {
  const f = await setup('draft');
  const submit = screen.getByRole('button', { name: f.label('lifecycle.submit') });
  expect(submit.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.semver')), {
    target: { value: '2.1.0-beta.1' },
  });
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.changeNote')), {
    target: { value: 'Synthetic change note' },
  });
  fireEvent.click(submit);
  await screen.findByText(f.label('lifecycle.done'));
  expect(f.requests.find((r) => r.path === `${base}/submit`)!.body).toEqual({
    semver: '2.1.0-beta.1',
    changeNote: 'Synthetic change note',
  });
});
it('drafts the change note from the real structural differences and never overwrites typed text', async () => {
  const baseline = editorFixture();
  const next = structuredClone(baseline);
  next.document.variables.push({ key: 'extraVariable', type: 'string', scope: 'session' } as never);
  const f = await setup('draft', {
    [base]: { ...next, state: 'draft', number: 2 },
    [`/v1/scripts/${scriptId}/versions/1`]: { ...baseline, state: 'published' },
  });
  const note = screen.getByLabelText<HTMLTextAreaElement>(f.label('lifecycle.changeNote'));
  fireEvent.change(note, { target: { value: 'Typed by a person' } });
  const draft = await screen.findByRole('button', { name: f.label('lifecycle.draftFromChanges') });
  await waitFor(() => {
    expect(draft.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(draft);
  expect(note.value.startsWith('Typed by a person\n- ')).toBe(true);
  expect(note.value).toContain('extraVariable');
  expect(note.value.length).toBeLessThanOrEqual(4000);
});
it('keeps the draft button disabled when nothing changed against the baseline', async () => {
  const same = editorFixture();
  const f = await setup('draft', {
    [base]: { ...same, state: 'draft', number: 2 },
    [`/v1/scripts/${scriptId}/versions/1`]: { ...same, state: 'published' },
  });
  const draft = await screen.findByRole('button', { name: f.label('lifecycle.draftFromChanges') });
  expect(draft.hasAttribute('disabled')).toBe(true);
});
it('rejects and comments with review text, and allows withdrawal', async () => {
  const f = await setup('in_review');
  const reject = screen.getByRole('button', { name: f.label('lifecycle.reject') });
  expect(reject.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.reviewComment')), {
    target: { value: 'Synthetic review comment' },
  });
  fireEvent.click(reject);
  await screen.findByText(f.label('lifecycle.done'));
  expect(f.requests.find((r) => r.method === 'POST')!.body).toEqual({
    decision: 'rejected',
    reason: 'Synthetic review comment',
    comment: 'Synthetic review comment',
  });
  const comment = screen.getByRole('button', { name: f.label('lifecycle.comment') });
  await waitFor(() => {
    expect(comment.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(comment);
  await waitFor(() => {
    expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(2);
  });
  expect(f.requests.filter((r) => r.method === 'POST')[1]!.body).toEqual({
    decision: 'commented',
    comment: 'Synthetic review comment',
  });
  const withdraw = screen.getByRole('button', { name: f.label('lifecycle.withdraw') });
  await waitFor(() => {
    expect(withdraw.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(withdraw);
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === `${base}/withdraw`)).toBe(true);
  });
});
it('schedules approved releases and rolls back using the expected current head', async () => {
  const f = await setup('approved');
  fireEvent.change(screen.getByLabelText(f.label('lifecycle.scheduleAt')), {
    target: { value: '2026-10-05T12:30' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.schedule') }));
  await screen.findByText(f.label('lifecycle.done'));
  expect(f.requests.find((r) => r.path === `${base}/schedule`)!.body).toEqual({
    at: new Date('2026-10-05T12:30').toISOString(),
  });
  const rollback = screen.getByRole('button', {
    name: f.i18n.t('designer.lifecycle.rollback', { number: 1 }),
  });
  await waitFor(() => {
    expect(rollback.hasAttribute('disabled')).toBe(false);
  });
  fireEvent.click(rollback);
  expect(f.requests.some((r) => r.path.endsWith('/rollback'))).toBe(false);
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain(f.label('lifecycle.rollbackImpact'));
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.confirmRollback') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path === `/v1/scripts/${scriptId}/rollback`)).toBe(true);
  });
  expect(f.requests.find((r) => r.path.endsWith('/rollback'))!.body).toEqual({
    targetNumber: 1,
    expectedCurrentVersionId: editorFixture().id,
  });
});
it('reports release command failures without claiming success', async () => {
  const f = await setup('in_review', {
    [`POST ${base}/withdraw`]: Response.json({}, { status: 500 }),
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.withdraw') }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(f.label('lifecycle.done'))).toBeNull();
});
it('renders JSON patch details and switches baseline versions', async () => {
  const f = await setup('published');
  fireEvent.mouseDown(await screen.findByRole('tab', { name: f.label('lifecycle.jsonDiff') }), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findByText('/meta/name')).toBeTruthy();
  fireEvent.click(screen.getByRole('combobox', { name: f.label('lifecycle.baseline') }));
  fireEvent.click(await screen.findByRole('option', { name: 'v2' }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.endsWith('/2/diff/2'))).toBe(true);
  });
});
it('shows loading failures and can retry the release', async () => {
  const f = await mountDesigner(
    <ReleasePage />,
    { [base]: Response.json({}, { status: 500 }) },
    {
      route: '/scripts/:id/versions/:number/release',
      path: `/scripts/${scriptId}/versions/2/release`,
    },
  );
  const retry = await screen.findByRole('button', { name: f.label('workspace.retry') });
  expect(retry).toBeTruthy();
  expect(f.requests.some((r) => r.path === base)).toBe(true);
});
it('hides review and publish actions from readers', async () => {
  const f = await mountDesigner(
    <ReleasePage />,
    { [base]: { ...editorFixture(), number: 2, state: 'in_review' } },
    {
      route: '/scripts/:id/versions/:number/release',
      path: `/scripts/${scriptId}/versions/2/release`,
      ability: createAbility([{ action: 'read', subject: 'Script' }]),
    },
  );
  await screen.findByRole('heading', { name: /Minimal/ });
  expect(screen.queryByRole('button', { name: f.label('lifecycle.reject') })).toBeNull();
  expect(screen.queryByRole('button', { name: f.label('lifecycle.withdraw') })).toBeNull();
  expect(screen.queryByRole('button', { name: f.label('preview.approve') })).toBeNull();
});

it('marks the current production head and cancels rollback without posting', async () => {
  const f = await setup('published');
  expect(await screen.findByText(f.label('lifecycle.activeVersion'))).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: f.i18n.t('designer.lifecycle.rollback', { number: 1 }) }),
  );
  fireEvent.click(screen.getByRole('button', { name: f.label('lifecycle.cancelRollback') }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(f.requests.some((r) => r.path.endsWith('/rollback'))).toBe(false);
});
