import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';

import { createAbility } from '@verbis/authz';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { Branches } from './branches.js';

const base = `/v1/scripts/${scriptId}/branches`;
const admin = createAbility([{ action: 'manage', subject: 'all' }]);
const branch = (name: string, mergedInto: number | null = null) => ({
  name,
  versionNumber: 4,
  parentNumber: 2,
  state: 'draft',
  createdAt: '2026-10-07T10:00:00.000Z',
  createdBy: 'user:me',
  mergedInto,
});
const mount = (responses: Record<string, unknown>, mainline = [3, 2, 1]) =>
  mountDesigner(<Branches scriptId={scriptId} mainline={mainline} />, responses, {
    ability: admin,
  });

it('lists branches and creates one from a chosen mainline version', async () => {
  const f = await mount({
    [base]: [branch('november'), branch('old', 6)],
    [`POST ${base}`]: branch('december'),
  });
  expect(await screen.findByText('november')).toBeTruthy();
  expect(screen.getByText(f.label('branches.open'))).toBeTruthy();
  // Merged branches offer no merge button; open ones do.
  expect(screen.getAllByRole('button', { name: f.label('branches.merge') })).toHaveLength(1);
  const create = screen.getByRole<HTMLButtonElement>('button', {
    name: f.label('branches.create'),
  });
  expect(create.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('branches.name')), {
    target: { value: 'Not Valid' },
  });
  expect(screen.getByText(f.label('branches.problem.invalid'))).toBeTruthy();
  expect(create.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(f.label('branches.name')), {
    target: { value: 'december' },
  });
  expect(create.disabled).toBe(false);
  fireEvent.click(create);
  await waitFor(() => {
    expect(f.requests.some((r) => r.method === 'POST' && r.path === base)).toBe(true);
  });
  expect(f.requests.find((r) => r.method === 'POST')?.body).toEqual({
    name: 'december',
    fromNumber: 3,
  });
});

it('tells the user when a branch name is taken', async () => {
  const f = await mount({
    [base]: [],
    [`POST ${base}`]: Response.json({ code: 'VERBIS_BRANCH_EXISTS' }, { status: 409 }),
  });
  fireEvent.change(await screen.findByLabelText(f.label('branches.name')), {
    target: { value: 'taken' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('branches.create') }));
  expect(await screen.findByText(f.label('branches.problem.exists'))).toBeTruthy();
});

it('shows both versions of every conflict and merges only after each one has a chosen side', async () => {
  const f = await mount({
    [base]: [branch('november')],
    [`${base}/november/merge-preview`]: {
      branch: 'november',
      baseNumber: 2,
      mainlineNumber: 5,
      branchNumber: 4,
      conflicts: [
        {
          path: '/pages/home/name',
          kind: 'both-changed',
          base: '"Home"',
          ours: '"Mainline name"',
          theirs: '"Branch name"',
        },
        {
          path: '/rules/r1',
          kind: 'deleted-vs-changed',
          base: '{"id":"r1"}',
          ours: null,
          theirs: '{"id":"r1","x":1}',
        },
      ],
      issues: [],
      canMerge: true,
    },
    [`POST ${base}/november/merge`]: { number: 6 },
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('branches.merge') }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('/pages/home/name')).toBeTruthy();
  const merge = within(dialog).getByRole<HTMLButtonElement>('button', {
    name: f.label('branches.mergeConfirm'),
  });
  expect(merge.disabled).toBe(true);
  // Both versions of the first conflict, and the absent side of the second, are shown.
  fireEvent.click(
    within(dialog).getByRole('radio', {
      name: new RegExp(`${f.label('branches.branchSide')}: "Branch name"`),
    }),
  );
  expect(merge.disabled).toBe(true);
  expect(
    within(dialog).getByRole('radio', {
      name: new RegExp(`${f.label('branches.mainlineSide')}: "Mainline name"`),
    }),
  ).toBeTruthy();
  fireEvent.click(
    within(dialog).getByRole('radio', {
      name: new RegExp(
        `${f.label('branches.mainlineSide')}: \\${f.label('branches.absent').slice(0, 1)}`,
      ),
    }),
  );
  await waitFor(() => {
    expect(merge.disabled).toBe(false);
  });
  fireEvent.click(merge);
  await screen.findByRole('link', { name: f.label('branches.openMerged') });
  expect(f.requests.find((r) => r.path.endsWith('/merge'))?.body).toEqual({
    resolutions: { '/pages/home/name': 'theirs', '/rules/r1': 'ours' },
  });
});

it('merges a clean branch and links to the new mainline draft', async () => {
  const f = await mount({
    [base]: [branch('november')],
    [`${base}/november/merge-preview`]: {
      branch: 'november',
      baseNumber: 2,
      mainlineNumber: 5,
      branchNumber: 4,
      conflicts: [],
      issues: [],
      canMerge: true,
    },
    [`POST ${base}/november/merge`]: { number: 6 },
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('branches.merge') }));
  const confirm = await screen.findByRole('button', { name: f.label('branches.mergeConfirm') });
  await waitFor(() => {
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });
  fireEvent.click(confirm);
  const link = await screen.findByRole('link', { name: f.label('branches.openMerged') });
  expect(link.getAttribute('href')).toBe(`/scripts/${scriptId}/versions/6/edit`);
  expect(f.requests.find((r) => r.path.endsWith('/merge'))?.body).toEqual({ resolutions: {} });
});

it('hides creation and merge from users who cannot edit the script', async () => {
  const f = await mountDesigner(
    <Branches scriptId={scriptId} mainline={[1]} />,
    { [base]: [branch('november')] },
    { ability: createAbility([{ action: 'read', subject: 'Script' }]) },
  );
  expect(await screen.findByText('november')).toBeTruthy();
  expect(screen.queryByRole('button', { name: f.label('branches.merge') })).toBeNull();
  expect(screen.queryByRole('button', { name: f.label('branches.create') })).toBeNull();
});
