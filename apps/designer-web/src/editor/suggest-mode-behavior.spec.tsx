import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import { editorFixture } from './fixtures.js';
import { EditorStore } from './store.js';
import { SuggestMode } from './suggest-mode.js';

const path = `/v1/scripts/${scriptId}/versions/1/suggestions`;

function Harness({
  store,
  canEnter = true,
  onRestored,
}: {
  store: EditorStore;
  canEnter?: boolean;
  onRestored: () => void;
}) {
  const [suggesting, setSuggesting] = useState(false);
  return (
    <SuggestMode
      scriptId={scriptId}
      number={1}
      store={store}
      suggesting={suggesting}
      canEnter={canEnter}
      onSuggestingChange={setSuggesting}
      onRestored={onRestored}
    />
  );
}
const rename = (store: EditorStore, name: string) => {
  act(() => {
    store.execute(() => {
      store.edit((draft) => {
        const page = draft.pages[0];
        if (page) page.name = name;
      });
    });
  });
};

it('stays out of the way until entered and cannot start on unsaved edits', async () => {
  const store = new EditorStore(editorFixture().document);
  const f = await mountDesigner(
    <Harness store={store} canEnter={false} onRestored={() => undefined} />,
    {},
  );
  const toggle = await screen.findByRole('button', { name: f.label('suggest.toggle') });
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
});

it('sends only what changed as a suggestion, then restores the saved draft', async () => {
  const store = new EditorStore(editorFixture().document);
  const original = store.getSnapshot().document.pages[0]?.name;
  const onRestored = vi.fn();
  const f = await mountDesigner(<Harness store={store} onRestored={onRestored} />, {
    [`POST ${path}`]: {
      id: '01928f3a-0000-7000-8000-0000000000a1',
      scriptId,
      versionNumber: 1,
      title: 'Better name',
      note: null,
      operations: [{ op: 'replace', path: '/pages/0/name', value: 'Proposed name' }],
      state: 'open',
      createdAt: '2026-10-07T10:00:00.000Z',
      createdBy: 'user:me',
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('suggest.toggle') }));
  expect(await screen.findByText(f.label('suggest.active'))).toBeTruthy();
  rename(store, 'Proposed name');
  fireEvent.click(screen.getByRole('button', { name: f.label('suggest.propose') }));
  fireEvent.change(await screen.findByLabelText(f.label('suggest.titleLabel')), {
    target: { value: ' Better name ' },
  });
  fireEvent.change(screen.getByLabelText(f.label('suggest.noteLabel')), {
    target: { value: 'Shorter' },
  });
  expect(screen.getByText(/1$/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: f.label('suggest.send') }));
  await waitFor(() => {
    expect(onRestored).toHaveBeenCalled();
  });
  expect(f.requests.find((r) => r.method === 'POST')?.body).toEqual({
    title: 'Better name',
    note: 'Shorter',
    operations: [{ op: 'replace', path: '/pages/0/name', value: 'Proposed name' }],
  });
  // The local edits never became the draft.
  expect(store.getSnapshot().document.pages[0]?.name).toBe(original);
  expect(await screen.findByText(f.label('suggest.sent'))).toBeTruthy();
});

it('cannot send an empty suggestion and discard restores the draft without a request', async () => {
  const store = new EditorStore(editorFixture().document);
  const original = store.getSnapshot().document.pages[0]?.name;
  const onRestored = vi.fn();
  const f = await mountDesigner(<Harness store={store} onRestored={onRestored} />, {});
  fireEvent.click(await screen.findByRole('button', { name: f.label('suggest.toggle') }));
  fireEvent.click(await screen.findByRole('button', { name: f.label('suggest.propose') }));
  fireEvent.change(await screen.findByLabelText(f.label('suggest.titleLabel')), {
    target: { value: 'Nothing' },
  });
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: f.label('suggest.send') }).disabled,
  ).toBe(true);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  rename(store, 'Throwaway');
  fireEvent.click(screen.getByRole('button', { name: f.label('suggest.discard') }));
  expect(store.getSnapshot().document.pages[0]?.name).toBe(original);
  expect(onRestored).toHaveBeenCalled();
  expect(f.requests.some((r) => r.method === 'POST')).toBe(false);
  expect(await screen.findByRole('button', { name: f.label('suggest.toggle') })).toBeTruthy();
});

it('keeps the edits and shows a message when the server refuses the suggestion', async () => {
  const store = new EditorStore(editorFixture().document);
  const f = await mountDesigner(<Harness store={store} onRestored={() => undefined} />, {
    [`POST ${path}`]: Response.json({ code: 'VERBIS_SUGGESTION_INVALID' }, { status: 422 }),
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('suggest.toggle') }));
  rename(store, 'Proposed name');
  fireEvent.click(await screen.findByRole('button', { name: f.label('suggest.propose') }));
  fireEvent.change(await screen.findByLabelText(f.label('suggest.titleLabel')), {
    target: { value: 'Rename' },
  });
  fireEvent.click(screen.getByRole('button', { name: f.label('suggest.send') }));
  expect(await screen.findByText(f.label('suggest.problem.invalid'))).toBeTruthy();
  expect(store.getSnapshot().document.pages[0]?.name).toBe('Proposed name');
});
