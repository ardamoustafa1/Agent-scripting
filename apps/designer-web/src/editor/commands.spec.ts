import { describe, expect, it, vi } from 'vitest';

import { minimalScript } from '@verbis/script-schema/fixtures';

import {
  COMPONENT_RESULTS,
  EDIT_ACTIONS,
  editorCommands,
  shortcutLabel,
  type EditorCommandContext,
} from './commands.js';
import { editorFixture } from './fixtures.js';
import { EditorStore } from './store.js';

function context(overrides: Partial<EditorCommandContext> = {}): EditorCommandContext {
  return {
    t: (key, options) => (options ? `${key} ${JSON.stringify(options)}` : key),
    store: new EditorStore(minimalScript()),
    locale: 'tr',
    apple: true,
    mode: 'screen',
    setMode: vi.fn(),
    editable: true,
    actionDisabled: (action) => action === 'redo',
    runAction: vi.fn(),
    insert: vi.fn(),
    addBlock: vi.fn(),
    goTo: vi.fn(),
    live: false,
    toggleLive: vi.fn(),
    expanded: false,
    toggleExpanded: vi.fn(),
    openHealth: vi.fn(),
    openShortcuts: vi.fn(),
    ...overrides,
  };
}
const byId = (items: ReturnType<typeof editorCommands>, id: string) => {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing ${id}`);
  return item;
};

describe('shortcutLabel', () => {
  it('uses symbols on Apple platforms and words elsewhere', () => {
    expect(shortcutLabel(['shift', 'mod', 'Z'], true)).toBe('⇧⌘Z');
    expect(shortcutLabel(['shift', 'mod', 'Z'], false)).toBe('Shift+Ctrl+Z');
    expect(shortcutLabel(['delete'], true)).toBe('⌫');
  });
});

describe('editorCommands', () => {
  it('switches modes, disabling the current one', () => {
    const ctx = context({ mode: 'flow' });
    const items = editorCommands(ctx, '');
    expect(byId(items, 'editor.mode.flow').disabled).toBe(true);
    byId(items, 'editor.mode.rules').onSelect();
    expect(ctx.setMode).toHaveBeenCalledWith('rules');
  });

  it('mirrors the toolbar for edit actions, with platform shortcuts', () => {
    const ctx = context({ apple: false });
    const items = editorCommands(ctx, '');
    for (const action of EDIT_ACTIONS)
      expect(byId(items, `editor.action.${action}`).disabled).toBe(action === 'redo');
    expect(byId(items, 'editor.action.undo').shortcut).toBe('Ctrl+Z');
    byId(items, 'editor.action.duplicate').onSelect();
    expect(ctx.runAction).toHaveBeenCalledWith('duplicate');
  });

  it('opens script health, the agent view, fullscreen and shortcuts', () => {
    const ctx = context({ live: true, expanded: true });
    const items = editorCommands(ctx, '');
    expect(byId(items, 'editor.live').label).toBe('designer.commands.liveOff');
    expect(byId(items, 'editor.fullscreen').label).toBe('designer.editor.exitFullscreen');
    for (const id of ['editor.health', 'editor.live', 'editor.fullscreen', 'editor.shortcuts'])
      byId(items, id).onSelect();
    expect(ctx.openHealth).toHaveBeenCalledOnce();
    expect(ctx.toggleLive).toHaveBeenCalledOnce();
    expect(ctx.toggleExpanded).toHaveBeenCalledOnce();
    expect(ctx.openShortcuts).toHaveBeenCalledOnce();
  });

  it('goes to every page', () => {
    const ctx = context();
    byId(editorCommands(ctx, ''), 'editor.page.home').onSelect();
    expect(ctx.goTo).toHaveBeenCalledWith({ mode: 'screen', pageId: 'home' });
  });

  it('finds components by translated text only once the query has two characters', () => {
    const ctx = context();
    expect(editorCommands(ctx, 'i').some((item) => item.id.startsWith('editor.node.'))).toBe(false);
    const node = byId(editorCommands(ctx, 'ileri'), 'editor.node.btn-next');
    node.onSelect();
    expect(ctx.goTo).toHaveBeenCalledWith({ mode: 'screen', pageId: 'home', nodeId: 'btn-next' });
  });

  it('caps component results so large scripts stay fast', () => {
    const ctx = context({ store: new EditorStore(editorFixture(60).document) });
    const nodes = editorCommands(ctx, 'box').filter((item) => item.id.startsWith('editor.node.'));
    expect(nodes).toHaveLength(COMPONENT_RESULTS);
  });

  it('offers insertable components only when the draft is editable', () => {
    expect(
      editorCommands(context({ editable: false }), '').some((item) =>
        item.id.startsWith('editor.insert.'),
      ),
    ).toBe(false);
    const ctx = context({ mode: 'flow' });
    byId(editorCommands(ctx, ''), 'editor.insert.button').onSelect();
    expect(ctx.setMode).toHaveBeenCalledWith('screen');
    expect(ctx.insert).toHaveBeenCalledWith('button');
  });

  it('adds building blocks only when the draft is editable', () => {
    expect(
      editorCommands(context({ editable: false }), '').some((item) =>
        item.id.startsWith('editor.block.'),
      ),
    ).toBe(false);
    const ctx = context({ mode: 'rules' });
    byId(editorCommands(ctx, ''), 'editor.block.identityCheck').onSelect();
    expect(ctx.setMode).toHaveBeenCalledWith('screen');
    expect(ctx.addBlock).toHaveBeenCalledWith(
      'identityCheck',
      'designer.blocks.items.identityCheck.name',
    );
  });

  it('changes zoom and preview width within limits', () => {
    const ctx = context();
    const items = editorCommands(ctx, '');
    expect(byId(items, 'editor.zoom.reset').disabled).toBe(true);
    byId(items, 'editor.zoom.in').onSelect();
    expect(ctx.store.getSnapshot().zoom).toBe(1.25);
    byId(items, 'editor.viewport.lg').onSelect();
    expect(ctx.store.getSnapshot().breakpoint).toBe('lg');
    expect(byId(editorCommands(ctx, ''), 'editor.viewport.lg').disabled).toBe(true);
  });

  it('gives every command a unique id', () => {
    const ids = editorCommands(context(), 'ileri').map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
