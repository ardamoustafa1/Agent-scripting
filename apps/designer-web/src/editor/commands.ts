import type { CommandItem } from '@verbis/ui';

import { BLOCK_IDS, type BlockId } from './blocks.js';
import { findComponents } from './search.js';
import { editorRegistry, type EditorStore } from './store.js';

import type { IssueTarget } from './health.js';

export const EDIT_ACTIONS = [
  'undo',
  'redo',
  'copy',
  'paste',
  'duplicate',
  'delete',
  'group',
  'ungroup',
] as const;
export type EditAction = (typeof EDIT_ACTIONS)[number];
export const EDITOR_MODES = ['screen', 'flow', 'rules', 'variables', 'preview'] as const;
const VIEWPORTS = ['base', 'sm', 'md', 'lg', 'xl'] as const;

const SHORTCUTS: Record<EditAction, readonly string[]> = {
  undo: ['mod', 'Z'],
  redo: ['shift', 'mod', 'Z'],
  copy: ['mod', 'C'],
  paste: ['mod', 'V'],
  duplicate: ['mod', 'D'],
  delete: ['delete'],
  group: ['mod', 'G'],
  ungroup: ['shift', 'mod', 'G'],
};
/** Platform-appropriate shortcut text: ⇧⌘Z on Apple devices, Ctrl+Shift+Z elsewhere. */
export function shortcutLabel(keys: readonly string[], apple: boolean): string {
  const names: Readonly<Record<string, string>> = apple
    ? { mod: '⌘', shift: '⇧', delete: '⌫' }
    : { mod: 'Ctrl', shift: 'Shift', delete: 'Delete' };
  const parts = keys.map((key) => names[key] ?? key);
  return apple ? parts.join('') : parts.join('+');
}
export const isApplePlatform = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Components matching a palette query, computed on demand; the list is capped for speed. */
export const COMPONENT_RESULTS = 20;

export interface EditorCommandContext {
  t: (key: string, options?: Record<string, unknown>) => string;
  store: EditorStore;
  locale: string;
  apple: boolean;
  mode: string;
  setMode: (mode: string) => void;
  /** Draft, writable and the user may update scripts. */
  editable: boolean;
  actionDisabled: (action: EditAction) => boolean;
  runAction: (action: EditAction) => void;
  insert: (type: string) => void;
  addBlock: (block: BlockId, name: string) => void;
  goTo: (target: IssueTarget) => void;
  live: boolean;
  toggleLive: () => void;
  expanded: boolean;
  toggleExpanded: () => void;
  openHealth: () => void;
  openShortcuts: () => void;
}

/**
 * Every editor action as a palette command (DIFFERENTIATORS A2): modes, edits with their
 * shortcuts, pages, components found by the query, insertable components and view settings.
 */
export function editorCommands(ctx: EditorCommandContext, query: string): CommandItem[] {
  const { t, store } = ctx;
  const { document, zoom, breakpoint } = store.getSnapshot();
  const group = (key: string) => t(`designer.commands.groups.${key}`);
  const componentName = (type: string) =>
    t(`designer.editor.componentNames.${type}`, { defaultValue: type });
  const items: CommandItem[] = [];

  for (const mode of EDITOR_MODES)
    items.push({
      id: `editor.mode.${mode}`,
      label: t('designer.commands.switchMode', { mode: t(`designer.flow.tools.${mode}`) }),
      group: group('script'),
      keywords: [mode],
      disabled: ctx.mode === mode,
      onSelect: () => {
        ctx.setMode(mode);
      },
    });
  items.push(
    {
      id: 'editor.health',
      label: t('designer.commands.health'),
      group: group('script'),
      keywords: [t('designer.health.title'), t('designer.editor.issues')],
      onSelect: ctx.openHealth,
    },
    {
      id: 'editor.live',
      label: t(ctx.live ? 'designer.commands.liveOff' : 'designer.commands.liveOn'),
      group: group('script'),
      keywords: [t('designer.live.title')],
      onSelect: ctx.toggleLive,
    },
    {
      id: 'editor.fullscreen',
      label: t(ctx.expanded ? 'designer.editor.exitFullscreen' : 'designer.editor.fullscreen'),
      group: group('script'),
      onSelect: ctx.toggleExpanded,
    },
    {
      id: 'editor.shortcuts',
      label: t('designer.editor.shortcuts'),
      group: group('script'),
      shortcut: '?',
      onSelect: ctx.openShortcuts,
    },
  );

  for (const action of EDIT_ACTIONS)
    items.push({
      id: `editor.action.${action}`,
      label: t(`designer.editor.${action}`),
      group: group('edit'),
      shortcut: shortcutLabel(SHORTCUTS[action], ctx.apple),
      disabled: ctx.actionDisabled(action),
      onSelect: () => {
        ctx.runAction(action);
      },
    });

  for (const page of document.pages)
    items.push({
      id: `editor.page.${page.id}`,
      label: t('designer.commands.goToPage', { page: page.name }),
      group: group('pages'),
      keywords: [page.id],
      onSelect: () => {
        ctx.goTo({ mode: 'screen', pageId: page.id });
      },
    });

  if (query.trim().length >= 2)
    for (const match of findComponents(document, query, ctx.locale, componentName).slice(
      0,
      COMPONENT_RESULTS,
    ))
      items.push({
        id: `editor.node.${match.id}`,
        label: t('designer.commands.goToNode', { component: match.type, page: match.pageName }),
        group: group('components'),
        // Already matched on translated text and props; keep it through the palette filter.
        keywords: [query, match.id],
        onSelect: () => {
          ctx.goTo({ mode: 'screen', pageId: match.pageId, nodeId: match.id });
        },
      });

  if (ctx.editable)
    for (const block of BLOCK_IDS)
      items.push({
        id: `editor.block.${block}`,
        label: t('designer.blocks.add', { block: t(`designer.blocks.items.${block}.name`) }),
        group: group('blocks'),
        keywords: [t(`designer.blocks.items.${block}.description`)],
        onSelect: () => {
          ctx.setMode('screen');
          ctx.addBlock(block, t(`designer.blocks.items.${block}.name`));
        },
      });
  if (ctx.editable)
    for (const definition of editorRegistry.list())
      if (definition.designerMeta.draggable)
        items.push({
          id: `editor.insert.${definition.type}`,
          label: t('designer.commands.insert', { component: componentName(definition.type) }),
          group: group('insert'),
          keywords: [definition.type],
          onSelect: () => {
            ctx.setMode('screen');
            ctx.insert(definition.type);
          },
        });

  items.push(
    {
      id: 'editor.zoom.in',
      label: t('designer.commands.zoomIn'),
      group: group('view'),
      shortcut: shortcutLabel(['mod', '+'], ctx.apple),
      disabled: zoom >= 2,
      onSelect: () => {
        store.setView({ zoom: Math.min(2, zoom + 0.25) });
      },
    },
    {
      id: 'editor.zoom.out',
      label: t('designer.commands.zoomOut'),
      group: group('view'),
      shortcut: shortcutLabel(['mod', '-'], ctx.apple),
      disabled: zoom <= 0.25,
      onSelect: () => {
        store.setView({ zoom: Math.max(0.25, zoom - 0.25) });
      },
    },
    {
      id: 'editor.zoom.reset',
      label: t('designer.commands.zoomReset'),
      group: group('view'),
      disabled: zoom === 1,
      onSelect: () => {
        store.setView({ zoom: 1 });
      },
    },
    ...VIEWPORTS.map((viewport) => ({
      id: `editor.viewport.${viewport}`,
      label: t('designer.commands.viewport', {
        viewport: t(`designer.editor.viewportNames.${viewport}`),
      }),
      group: group('view'),
      disabled: breakpoint === viewport,
      onSelect: () => {
        store.setView({ breakpoint: viewport });
      },
    })),
  );
  return items;
}
