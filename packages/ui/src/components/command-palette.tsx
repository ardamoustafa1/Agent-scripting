import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
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
  onSelect: () => void;
}
export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly CommandItem[];
  enableShortcut?: boolean;
}
export function CommandPalette({
  open,
  onOpenChange,
  items,
  enableShortcut = true,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const searchInput = useRef<HTMLInputElement>(null);
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
  const groups = [...new Set(items.map((item) => item.group ?? ''))];
  return (
    <Dialog
      initialFocus={searchInput}
      open={open}
      onOpenChange={onOpenChange}
      title={t('ui.command')}
      description={t('ui.search')}
    >
      <Command label={t('ui.command')}>
        <div className="vb-command-search">
          <Search size={18} aria-hidden />
          <Command.Input
            ref={searchInput}
            className="vb-command-input"
            aria-label={t('ui.command')}
            placeholder={t('ui.search')}
          />
        </div>
        <Command.List className="vb-command-list">
          <Command.Empty className="vb-command-empty">{t('ui.noResults')}</Command.Empty>
          {groups.map((group) => (
            <Command.Group key={group} heading={group || undefined}>
              {items
                .filter((item) => (item.group ?? '') === group)
                .map((item) => (
                  <Command.Item
                    key={item.id}
                    value={item.id}
                    keywords={[item.label]}
                    disabled={item.disabled === true}
                    onSelect={() => {
                      item.onSelect();
                      onOpenChange(false);
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </Dialog>
  );
}
