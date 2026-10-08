import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { editorFixture } from '../editor/fixtures.js';
import { useSuggestionMark } from '../editor/suggest-marks.js';
import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { Suggestions } from './suggestions.js';

const path = `/v1/scripts/${scriptId}/versions/1/suggestions`;
const suggestion = (id: string, state: string, extra: object = {}) => ({
  id,
  scriptId,
  versionNumber: 1,
  title: `Suggestion ${id}`,
  note: null,
  operations: [{ op: 'replace', path: '/pages/0/name', value: 'New' }],
  state,
  createdAt: '2026-10-07T10:00:00.000Z',
  createdBy: 'user:reviewer',
  decidedAt: null,
  decidedBy: null,
  decisionReason: null,
  ...extra,
});
const open = '01928f3a-0000-7000-8000-0000000000a1',
  stale = '01928f3a-0000-7000-8000-0000000000a2',
  done = '01928f3a-0000-7000-8000-0000000000a3';

it('lists suggestions with their state and operations, and only offers decisions that make sense', async () => {
  const f = await mountDesigner(<Suggestions scriptId={scriptId} number={1} />, {
    [path]: [
      suggestion(open, 'open', { note: 'Clearer wording' }),
      suggestion(stale, 'stale'),
      suggestion(done, 'accepted', { decisionReason: 'Thanks' }),
    ],
  });
  await screen.findByText(`Suggestion ${open}`);
  expect(screen.getByText('Clearer wording')).toBeTruthy();
  expect(
    screen.getAllByText(new RegExp(`${f.label('suggest.op.replace')} /pages/0/name`)),
  ).toHaveLength(3);
  expect(screen.getByText(f.label('suggest.state.open'))).toBeTruthy();
  expect(screen.getByText(f.label('suggest.state.stale'))).toBeTruthy();
  expect(screen.getByText(f.label('suggest.staleHint'))).toBeTruthy();
  // Accept exists only for the open one; the accepted one offers nothing.
  expect(screen.getAllByRole('button', { name: f.label('suggest.accept') })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: f.label('suggest.reject') })).toHaveLength(2);
  expect(screen.getByText('Thanks')).toBeTruthy();
});

it('applies a suggestion and tells the editor the draft changed', async () => {
  const onAccepted = vi.fn();
  const f = await mountDesigner(
    <Suggestions scriptId={scriptId} number={1} onAccepted={onAccepted} />,
    {
      [path]: [suggestion(open, 'open')],
      [`POST ${path}/${open}/accept`]: suggestion(open, 'accepted'),
    },
  );
  fireEvent.click(await screen.findByRole('button', { name: f.label('suggest.accept') }));
  await waitFor(() => {
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });
  expect(f.requests.find((r) => r.path.endsWith('/accept'))?.body).toEqual({});
});

it('rejects with an optional reason', async () => {
  const f = await mountDesigner(<Suggestions scriptId={scriptId} number={1} />, {
    [path]: [suggestion(open, 'open')],
    [`POST ${path}/${open}/reject`]: suggestion(open, 'rejected'),
  });
  fireEvent.change(await screen.findByLabelText(f.label('suggest.rejectReason')), {
    target: { value: ' Not now ' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('suggest.reject') }));
  await waitFor(() => {
    expect(f.requests.some((r) => r.path.endsWith('/reject'))).toBe(true);
  });
  expect(f.requests.find((r) => r.path.endsWith('/reject'))?.body).toEqual({ reason: 'Not now' });
});

it('explains a conflict and does not report the draft as changed', async () => {
  const onAccepted = vi.fn();
  const f = await mountDesigner(
    <Suggestions scriptId={scriptId} number={1} onAccepted={onAccepted} />,
    {
      [path]: [suggestion(open, 'open')],
      [`POST ${path}/${open}/accept`]: Response.json(
        { code: 'VERBIS_SUGGESTION_STALE' },
        { status: 409 },
      ),
    },
  );
  fireEvent.click(await screen.findByRole('button', { name: f.label('suggest.accept') }));
  expect(await screen.findByText(f.label('suggest.decideProblem.conflict'))).toBeTruthy();
  expect(onAccepted).not.toHaveBeenCalled();
});

it('shows an empty state and a loading failure', async () => {
  const f = await mountDesigner(<Suggestions scriptId={scriptId} number={1} />, { [path]: [] });
  expect(await screen.findByText(f.label('suggest.empty'))).toBeTruthy();
});
it('reports a loading failure', async () => {
  await mountDesigner(<Suggestions scriptId={scriptId} number={1} />, {
    [path]: Response.json({}, { status: 500 }),
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
});

function Mark({ id }: { id: string }) {
  return <p>{useSuggestionMark(id) ? `${id}:marked` : `${id}:plain`}</p>;
}
it('shows an open suggestion on the canvas and clears the marks when hidden or unmounted', async () => {
  const document = editorFixture().document;
  const node = 'btn-next';
  expect(document.pages[0]?.layout.children?.[0]).toMatchObject({ id: node });
  const f = await mountDesigner(
    <>
      <Mark id={node} />
      <Suggestions scriptId={scriptId} number={1} document={document} />
    </>,
    {
      [path]: [
        suggestion(open, 'open', {
          operations: [
            { op: 'replace', path: '/pages/0/layout/children/0/props/labelKey', value: 'x' },
          ],
        }),
        suggestion(done, 'accepted'),
      ],
    },
  );
  expect(await screen.findByText(`${node}:plain`)).toBeTruthy();
  // Only open suggestions can be shown.
  const show = await screen.findAllByRole('button', { name: f.label('suggest.showOnCanvas') });
  expect(show).toHaveLength(1);
  fireEvent.click(show[0]!);
  expect(await screen.findByText(`${node}:marked`)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: f.label('suggest.hideOnCanvas') }));
  expect(await screen.findByText(`${node}:plain`)).toBeTruthy();
});
it('offers no canvas view without a document to show it on', async () => {
  const f = await mountDesigner(<Suggestions scriptId={scriptId} number={1} />, {
    [path]: [suggestion(open, 'open')],
  });
  await screen.findByText(`Suggestion ${open}`);
  expect(screen.queryByRole('button', { name: f.label('suggest.showOnCanvas') })).toBeNull();
});
