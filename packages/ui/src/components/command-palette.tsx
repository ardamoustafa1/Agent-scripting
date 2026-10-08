import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { Kbd } from './layout.js';
import { Dialog } from './overlays.js';

export interface CommandItem {
  id: string;
  label: string;
  group?: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  /** Extra searchable words (synonyms, the page a component lives on, translated text). */
  keywords?: readonly string[];
  onSelect: () => void;
}
export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly CommandItem[];
  enableShortcut?: boolean;
  /** Lets the host compute query-dependent items (e.g. matching components) lazily. */
  onQueryChange?: (query: string) => void;
  /** Ids of recently run commands, shown first while the query is empty. */
  recent?: readonly string[];
  onItemRun?: (id: string) => void;
}

/** Case, diacritic and dotted/dotless-i insensitive text for matching. */
export function commandSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('ı', 'i').trim();
}

/**
 * Ranks a command for a query: whole-label prefix > word prefix > every term contained >
 * in-order subsequence. 0 hides it. Turkish users can type "saglik" for "Sağlık".
 */
export function scoreCommand(text: string, query: string): number {
  const needle = commandSearchText(query);
  if (!needle) return 1;
  const haystack = commandSearchText(text);
  if (haystack.startsWith(needle)) return 1;
  const words = haystack.split(/[\s·›/:,.()-]+/);
  if (words.some((word) => word.startsWith(needle))) return 0.8;
  const terms = needle.split(/\s+/);
  if (terms.every((term) => haystack.includes(term))) return 0.6;
  // Loose in-order matching is noise for one or two characters.
  if (needle.replaceAll(' ', '').length < 3) return 0;
  let at = 0;
  for (const char of needle.replaceAll(' ', '')) {
    at = haystack.indexOf(char, at);
    if (at < 0) return 0;
    at += 1;
  }
  return 0.2;
}

/**
 * Groups of matching commands. Without a query: declared order. With one: items by score
 * (stable within ties) and groups by their best item, so the top hit is always first.
 */
export function rankCommands(
  items: readonly CommandItem[],
  query: string,
): { group: string; items: CommandItem[] }[] {
  const scored = items
    .map((item, index) => ({
      item,
      index,
      score: scoreCommand([item.label, ...(item.keywords ?? [])].join(' '), query),
    }))
    .filter((entry) => entry.score > 0);
  const groups = new Map<string, { best: number; order: number; entries: typeof scored }>();
  for (const entry of scored) {
    const key = entry.item.group ?? '';
    const group = groups.get(key) ?? { best: 0, order: groups.size, entries: [] };
    group.best = Math.max(group.best, entry.score);
    group.entries.push(entry);
    groups.set(key, group);
  }
  const searching = commandSearchText(query) !== '';
  return [...groups.entries()]
    .sort(([, a], [, b]) => (searching ? b.best - a.best : 0) || a.order - b.order)
    .map(([group, { entries }]) => ({
      group,
      items: entries
        .sort((a, b) => (searching ? b.score - a.score : 0) || a.index - b.index)
        .map((entry) => entry.item),
    }));
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  enableShortcut = true,
  onQueryChange,
  recent = [],
  onItemRun,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const searchInput = useRef<HTMLInputElement>(null);
  // The chosen command runs after the palette has closed and focus is restored, so commands
  // that move focus (go to a component, open a panel) are not undone by the restore.
  const pending = useRef<CommandItem | null>(null);
  useEffect(() => {
    if (!enableShortcut) return undefined;
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [enableShortcut, open, onOpenChange]);
  return (
    <Dialog
      initialFocus={searchInput}
      open={open}
      onOpenChange={onOpenChange}
      title={t('ui.command')}
      description={t('ui.search')}
      onCloseAutoFocus={() => {
        const item = pending.current;
        pending.current = null;
        if (item)
          queueMicrotask(() => {
            item.onSelect();
          });
      }}
    >
      <PaletteBody
        searchInput={searchInput}
        items={items}
        recent={recent}
        {...(onQueryChange ? { onQueryChange } : {})}
        run={(item) => {
          pending.current = item;
          onItemRun?.(item.id);
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every opening starts from an empty query. */
function PaletteBody({
  searchInput,
  items,
  recent,
  onQueryChange,
  run,
}: {
  searchInput: RefObject<HTMLInputElement>;
  items: readonly CommandItem[];
  recent: readonly string[];
  onQueryChange?: (query: string) => void;
  run: (item: CommandItem) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const listener = useRef(onQueryChange);
  useEffect(() => {
    listener.current = onQueryChange;
  }, [onQueryChange]);
  useEffect(
    () => () => {
      listener.current?.('');
    },
    [],
  );
  const render = (item: CommandItem, value: string) => (
    <Command.Item
      key={value}
      value={value}
      keywords={[item.label, ...(item.keywords ?? [])]}
      disabled={item.disabled === true}
      onSelect={() => {
        run(item);
      }}
    >
      {item.icon}
      <span>{item.label}</span>
      {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
    </Command.Item>
  );
  const recentItems = query
    ? []
    : recent.flatMap((id) => items.filter((item) => item.id === id && item.disabled !== true));
  const ranked = rankCommands(items, query);
  return (
    <Command
      label={t('ui.command')}
      // Ranking is ours (rankCommands): deterministic, Turkish-aware, best group first.
      shouldFilter={false}
    >
      <div className="vb-command-search">
        <Search size={18} aria-hidden />
        <Command.Input
          ref={searchInput}
          className="vb-command-input"
          aria-label={t('ui.command')}
          placeholder={t('ui.search')}
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            onQueryChange?.(value);
          }}
        />
      </div>
      <Command.List className="vb-command-list">
        <Command.Empty className="vb-command-empty">{t('ui.noResults')}</Command.Empty>
        {recentItems.length > 0 && (
          <Command.Group heading={t('ui.recent')}>
            {recentItems.map((item) => render(item, `recent:${item.id}`))}
          </Command.Group>
        )}
        {ranked.map(({ group, items: members }) => (
          <Command.Group key={group} heading={group || undefined}>
            {members.map((item) => render(item, item.id))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  );
}
