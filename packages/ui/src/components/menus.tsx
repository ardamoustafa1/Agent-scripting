import { DropdownMenu as RadixDropdown, ContextMenu as RadixContext } from 'radix-ui';
import { type ReactElement, type ReactNode } from 'react';

import { usePortalContainer } from '../provider.js';

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  shortcut?: string;
}
export interface DropdownMenuProps {
  trigger: ReactElement;
  items: readonly MenuItem[];
  label: string;
}
export function DropdownMenu({ trigger, items, label }: DropdownMenuProps) {
  const portal = usePortalContainer();
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal {...(portal === null ? {} : { container: portal })}>
        <RadixDropdown.Content className="vb-floating vb-menu" sideOffset={6} aria-label={label}>
          {items.map((item) => (
            <RadixDropdown.Item
              key={item.id}
              className="vb-menu-item"
              disabled={item.disabled === true}
              data-danger={item.danger ? true : undefined}
              onSelect={item.onSelect}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}
export interface ContextMenuProps {
  children: ReactNode;
  items: readonly MenuItem[];
  label: string;
}
export function ContextMenu({ children, items, label }: ContextMenuProps) {
  const portal = usePortalContainer();
  return (
    <RadixContext.Root>
      <RadixContext.Trigger
        className="vb-context-trigger"
        tabIndex={0}
        role="button"
        aria-haspopup="menu"
        aria-label={label}
        onKeyDown={(event) => {
          if (
            (event.shiftKey && event.key === 'F10') ||
            event.key === 'ContextMenu' ||
            event.key === 'Enter' ||
            event.key === ' '
          ) {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: bounds.x + 8,
                clientY: bounds.y + 8,
              }),
            );
          }
        }}
      >
        {children}
      </RadixContext.Trigger>
      <RadixContext.Portal {...(portal === null ? {} : { container: portal })}>
        <RadixContext.Content className="vb-floating vb-menu" aria-label={label}>
          {items.map((item) => (
            <RadixContext.Item
              key={item.id}
              className="vb-menu-item"
              disabled={item.disabled === true}
              data-danger={item.danger ? true : undefined}
              onSelect={item.onSelect}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </RadixContext.Item>
          ))}
        </RadixContext.Content>
      </RadixContext.Portal>
    </RadixContext.Root>
  );
}
