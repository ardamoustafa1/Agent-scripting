import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { mountDesigner } from '../fixtures.spec.helpers.js';
import { scriptId } from '../test-fixtures.js';

import EditorPage from './editor.js';
import { editorFixture } from './fixtures.js';

const path = `/v1/scripts/${scriptId}/versions/1`;
it('waits for the fresh server revision before reopening a cached editor', async () => {
  function Page() {
    return useLocation().pathname.endsWith('/edit') ? <EditorPage /> : <div>Library</div>;
  }
  const route = `/scripts/${scriptId}/versions/1/edit`;
  const f = await mountDesigner(
    <Page />,
    { [path]: editorFixture(), [`PUT ${path}/document`]: { version: 8 } },
    { path: route, route: '/scripts/:id/versions/:number/*' },
  );
  await screen.findByRole('heading', { name: 'Minimal' });
  await act(() => f.router.navigate(`/scripts/${scriptId}/versions/1/list`));
  const fetcher = f.fetcher.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  f.fetcher.mockImplementation((url, init) =>
    (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith(
      '/versions/1',
    )
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : fetcher(url, init),
  );
  await act(() => f.router.navigate(route));
  expect(screen.queryByRole('heading', { name: 'Minimal' })).toBeNull();
  act(() => {
    resolve(Response.json({ ...editorFixture(), version: 7 }));
  });
  await screen.findByRole('heading', { name: 'Minimal' });
  const palette = screen.getByRole('complementary', { name: f.label('editor.components') });
  fireEvent.click(
    within(palette)
      .getAllByRole('button', { name: f.label('editor.componentNames.heading') })
      .at(-1)!,
  );
  await waitFor(
    () => {
      const save = f.requests.find((r) => r.method === 'PUT');
      expect(new Headers(save?.init?.headers).get('if-match')).toBe('"7"');
    },
    { timeout: 3000 },
  );
});
async function setup(extra: Record<string, unknown> = {}) {
  const f = await mountDesigner(
    <EditorPage />,
    { [path]: editorFixture(), [`PUT ${path}/document`]: { version: 2 }, ...extra },
    { route: '/scripts/:id/versions/:number/edit', path: `/scripts/${scriptId}/versions/1/edit` },
  );
  await screen.findByRole('heading', { name: editorFixture().document.meta.name });
  return f;
}
function tool(f: Awaited<ReturnType<typeof setup>>, mode: string) {
  const navigation = screen.getByRole('navigation', { name: f.label('flow.tool') });
  fireEvent.click(within(navigation).getByRole('button', { name: f.label(`flow.tools.${mode}`) }));
}
it('inserts a real component, autosaves with version and CSRF, and supports undo/redo', async () => {
  const f = await setup();
  const palette = screen.getByRole('complementary', { name: f.label('editor.components') });
  fireEvent.change(within(palette).getByLabelText(f.label('editor.search')), {
    target: { value: 'text' },
  });
  const insert = within(palette)
    .getAllByRole('button', { name: f.label('editor.componentNames.text') })
    .find((button) => button.classList.contains('vb-button'))!;
  fireEvent.click(insert);
  await waitFor(
    () => {
      expect(f.requests.some((r) => r.method === 'PUT')).toBe(true);
    },
    {
      timeout: 3000,
    },
  );
  const request = f.requests.find((r) => r.method === 'PUT')!;
  expect(new Headers(request.init?.headers).get('if-match')).toBe('"1"');
  expect(new Headers(request.init?.headers).get('x-csrf-token')).toBe('synthetic-csrf-only');
  expect(
    (request.body as { document: { pages: { layout: { children: unknown[] } }[] } }).document
      .pages[0]!.layout.children,
  ).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.undo') }));
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.redo') }));
  fireEvent.keyDown(document.body, { key: '?' });
  expect(await screen.findByRole('dialog')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
});
it('switches to pages, adds a page and prevents unload while edits are unsaved', async () => {
  const f = await setup();
  const palette = screen.getByRole('complementary', { name: f.label('editor.components') });
  fireEvent.mouseDown(within(palette).getByRole('tab', { name: f.label('editor.pages') }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('button', { name: f.label('editor.addPage') }));
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  await waitFor(
    () => {
      const cleanUnload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(cleanUnload);
      expect(cleanUnload.defaultPrevented).toBe(false);
    },
    { timeout: 3000 },
  );
});
it('switches rules, variables, flow and preview without losing the document', async () => {
  const f = await setup();
  tool(f, 'rules');
  expect(await screen.findByRole('heading', { name: f.label('rules.title') })).toBeTruthy();
  tool(f, 'variables');
  expect(await screen.findByRole('heading', { name: f.label('variables.title') })).toBeTruthy();
  tool(f, 'flow');
  expect(await screen.findByRole('button', { name: f.label('flow.layout') })).toBeTruthy();
  tool(f, 'preview');
  expect(await screen.findByRole('button', { name: f.label('preview.restart') })).toBeTruthy();
  tool(f, 'screen');
  expect(document.querySelector('[data-editor-node="btn-next"]')).toBeTruthy();
  expect(f.requests.some((request) => request.method === 'PUT')).toBe(false);
});
it('disables unavailable selection commands and enables paste only after copying', async () => {
  const f = await setup();
  for (const action of ['copy', 'paste', 'duplicate', 'delete', 'group', 'ungroup'])
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: f.label(`editor.${action}`) }).disabled,
    ).toBe(true);
  const palette = screen.getByRole('complementary', { name: f.label('editor.components') });
  fireEvent.click(
    within(palette)
      .getAllByRole('button', { name: f.label('editor.componentNames.text') })
      .find((node) => node.classList.contains('vb-button'))!,
  );
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: f.label('editor.copy') }).disabled,
  ).toBe(false);
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: f.label('editor.ungroup') }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: f.label('editor.copy') }));
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: f.label('editor.paste') }).disabled,
  ).toBe(false);
});
it('reports failed document loading and retries', async () => {
  const f = await mountDesigner(
    <EditorPage />,
    { [path]: Response.json({}, { status: 503 }) },
    { route: '/scripts/:id/versions/:number/edit', path: `/scripts/${scriptId}/versions/1/edit` },
  );
  const retry = await screen.findByRole('button', { name: f.label('workspace.retry') });
  f.responses[path] = editorFixture();
  fireEvent.click(retry);
  expect(
    await screen.findByRole('heading', { name: editorFixture().document.meta.name }),
  ).toBeTruthy();
});
it('supports copy, paste, duplicate, delete, undo and zoom keyboard shortcuts', async () => {
  const f = await setup();
  const palette = screen.getByRole('complementary', { name: f.label('editor.components') });
  fireEvent.change(within(palette).getByLabelText(f.label('editor.search')), {
    target: { value: 'text' },
  });
  fireEvent.click(
    within(palette)
      .getAllByRole('button', { name: f.label('editor.componentNames.text') })
      .find((node) => node.classList.contains('vb-button'))!,
  );
  const count = () => document.querySelectorAll('.ed-runtime [data-editor-node]').length;
  const baseline = count();
  fireEvent.keyDown(document.body, { key: 'c', ctrlKey: true });
  fireEvent.keyDown(document.body, { key: 'v', ctrlKey: true });
  expect(count()).toBe(baseline + 1);
  fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true });
  expect(count()).toBe(baseline + 2);
  fireEvent.keyDown(document.body, { key: 'Backspace' });
  expect(count()).toBe(baseline + 1);
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  expect(count()).toBe(baseline + 2);
  fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
  expect(count()).toBe(baseline + 1);
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
  expect(count()).toBe(baseline + 1);
  fireEvent.keyDown(document.body, { key: '+', ctrlKey: true });
  expect(document.querySelector<HTMLElement>('.ed-paper')!.style.transform).toBe('scale(1.25)');
  fireEvent.keyDown(document.body, { key: '-', ctrlKey: true });
  expect(document.querySelector<HTMLElement>('.ed-paper')!.style.transform).toBe('scale(1)');
  fireEvent.keyDown(document.body, { key: 'Escape' });
  fireEvent.keyDown(document.body, { key: 'g', ctrlKey: true });
  fireEvent.keyDown(document.body, { key: 'g', ctrlKey: true, shiftKey: true });
});
it.each([409, 412, 503])('preserves a dirty draft after autosave HTTP %s', async (status) => {
  const f = await setup({
    [`PUT ${path}/document`]: Response.json({ code: 'VERBIS_SYNTHETIC' }, { status }),
  });
  const palette = screen.getByRole('complementary', { name: f.label('editor.components') });
  fireEvent.change(within(palette).getByLabelText(f.label('editor.search')), {
    target: { value: 'text' },
  });
  fireEvent.click(
    within(palette)
      .getAllByRole('button', { name: f.label('editor.componentNames.text') })
      .find((node) => node.classList.contains('vb-button'))!,
  );
  expect(
    await screen.findAllByText(
      f.label(status === 503 ? 'editor.saveFailed' : 'editor.conflict'),
      {},
      { timeout: 3000 },
    ),
  ).toBeTruthy();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  expect(document.querySelectorAll('.ed-runtime [data-editor-node]')).toHaveLength(3);
});

it('inserts a component through keyboard drag and drop into the live canvas', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.closest('.ed-palette-item')) return new DOMRect(0, 0, 100, 40);
    if (this.closest('.ed-canvas-area')) return new DOMRect(150, 0, 375, 600);
    return new DOMRect(0, 0, 100, 40);
  });
  const f = await setup();
  const palette = screen.getByRole('complementary', { name: f.label('editor.components') });
  fireEvent.change(within(palette).getByLabelText(f.label('editor.search')), {
    target: { value: 'text' },
  });
  const handle = within(palette).getByRole('button', {
    name: f.label('editor.componentNames.text'),
  });
  handle.focus();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', shiftKey: true });
  await waitFor(() => {
    expect(document.querySelector('.ed-drag-ghost')).toBeTruthy();
  });
  for (let i = 0; i < 7; i++) {
    fireEvent.keyDown(handle, { key: 'ArrowRight', code: 'ArrowRight' });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  }
  fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
  await waitFor(() => {
    expect(document.querySelectorAll('.ed-runtime [data-editor-node]')).toHaveLength(3);
  });
});

// D-04: a keyboard drop lands right after the selected sibling and the position is announced.
it('inserts a keyboard-dropped component after the selected sibling and announces its position', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.closest('.ed-canvas-area')) return new DOMRect(150, 0, 375, 600);
    return new DOMRect(0, 0, 100, 40);
  });
  const f = await setup({ [path]: editorFixture(2) });
  const canvas = screen.getByRole('group', { name: f.label('editor.canvas') });
  fireEvent.keyDown(canvas, { key: 'ArrowDown' });
  fireEvent.keyDown(canvas, { key: 'ArrowDown' });
  const palette = screen.getByRole('complementary', { name: f.label('editor.components') });
  fireEvent.change(within(palette).getByLabelText(f.label('editor.search')), {
    target: { value: 'text' },
  });
  const handle = within(palette).getByRole('button', {
    name: f.label('editor.componentNames.text'),
  });
  handle.focus();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', shiftKey: true });
  await waitFor(() => {
    expect(document.querySelector('.ed-drag-ghost')).toBeTruthy();
  });
  for (let i = 0; i < 7; i++) {
    fireEvent.keyDown(handle, { key: 'ArrowRight', code: 'ArrowRight' });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  }
  fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
  await waitFor(() => {
    expect(document.querySelectorAll('.ed-runtime [data-editor-node]')).toHaveLength(4);
  });
  const order = [...document.querySelectorAll('.ed-runtime [data-editor-node]')].map((el) =>
    el.getAttribute('data-editor-node'),
  );
  expect(order[1]).toBe('btn-next');
  expect(order[2]).not.toBe('fixture-0');
  expect(
    screen.getByText(
      f
        .label('editor.dnd.placed')
        .replace('{{name}}', f.label('editor.componentNames.text'))
        .replace('{{position}}', '2')
        .replace('{{count}}', '3')
        .replace('{{target}}', f.label('editor.componentNames.box')),
    ),
  ).toBeTruthy();
});
it.each([200, 503])(
  'attaches a pinned shared screen with version protection, handling HTTP %s',
  async (status) => {
    const shared = '01990000-0000-7000-8000-000000000088';
    const f = await setup({
      '/v1/shared-screens': [
        { id: shared, name: 'Synthetic reusable screen', latest: { number: 3 } },
      ],
      [`PUT ${path}/document`]: status === 200 ? { version: 2 } : Response.json({}, { status }),
    });
    fireEvent.click(screen.getByRole('button', { name: f.label('editor.reuse') }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox', { name: f.label('editor.linked') }));
    fireEvent.click(await screen.findByRole('option', { name: 'Synthetic reusable screen' }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: f.label('editor.attach') }));
    await waitFor(() => {
      expect(f.requests.some((r) => r.method === 'PUT')).toBe(true);
    });
    const sent = f.requests.find((r) => r.method === 'PUT')!;
    expect(new Headers(sent.init?.headers).get('if-match')).toBe('"1"');
    expect(sent.body).toMatchObject({
      screens: [{ sharedScreenId: shared, versionNumber: 3, mode: 'linked' }],
    });
    if (status === 503)
      expect(await screen.findByText(f.label('editor.operationFailed'))).toBeTruthy();
    else
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
  },
);
// D-07: dnd-kit's default English instructions were read in the Turkish editor.
it('describes keyboard dragging with localized instructions that mention the add buttons', async () => {
  const f = await setup();
  const instructions = [...document.querySelectorAll('[id^="DndDescribedBy"]')].map(
    (element) => element.textContent,
  );
  expect(instructions).toContain(f.label('editor.dnd.instructions'));
  expect(instructions.join(' ')).not.toMatch(/To pick up a draggable item/);
});
