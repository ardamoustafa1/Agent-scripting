import { X } from 'lucide-react';
import { Dialog as RadixDialog, Popover as RadixPopover, Tooltip as RadixTooltip } from 'radix-ui';
import { useRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { usePortalContainer } from '../provider.js';

import { IconButton } from './button.js';

export interface DialogProps {
  trigger?: ReactElement;
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  footer?: ReactNode;
  initialFocus?: RefObject<HTMLElement>;
  className?: string;
}
export function Dialog({
  trigger,
  title,
  description,
  children,
  footer,
  initialFocus,
  className = '',
  ...root
}: DialogProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const portal = usePortalContainer();
  const { t } = useTranslation();
  return (
    <RadixDialog.Root {...root}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal {...(portal === null ? {} : { container: portal })}>
        <RadixDialog.Overlay className="vb-overlay" />
        <RadixDialog.Content
          className={`vb-dialog ${className}`}
          onOpenAutoFocus={(event) => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (initialFocus?.current) {
              event.preventDefault();
              initialFocus.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (!trigger && previousFocus.current?.isConnected) {
              event.preventDefault();
              previousFocus.current.focus();
            }
          }}
        >
          <header className="vb-dialog-heading">
            <div>
              <RadixDialog.Title className="vb-dialog-title">{title}</RadixDialog.Title>
              <RadixDialog.Description className="vb-description">
                {description}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close asChild>
              <IconButton label={t('ui.close')}>
                <X size={18} />
              </IconButton>
            </RadixDialog.Close>
          </header>
          <div className="vb-dialog-body">{children}</div>
          {footer && <footer className="vb-dialog-footer">{footer}</footer>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
export interface SheetProps extends DialogProps {
  side?: 'start' | 'end';
}
export function Sheet({
  trigger,
  title,
  description,
  children,
  footer,
  initialFocus,
  side = 'end',
  className = '',
  ...root
}: SheetProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const portal = usePortalContainer();
  const { t } = useTranslation();
  return (
    <RadixDialog.Root {...root}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal {...(portal === null ? {} : { container: portal })}>
        <RadixDialog.Overlay className="vb-overlay" />
        <RadixDialog.Content
          className={`vb-sheet ${className}`}
          data-side={side}
          onOpenAutoFocus={(event) => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (initialFocus?.current) {
              event.preventDefault();
              initialFocus.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (!trigger && previousFocus.current?.isConnected) {
              event.preventDefault();
              previousFocus.current.focus();
            }
          }}
        >
          <header className="vb-dialog-heading">
            <div>
              <RadixDialog.Title className="vb-dialog-title">{title}</RadixDialog.Title>
              <RadixDialog.Description className="vb-description">
                {description}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close asChild>
              <IconButton label={t('ui.close')}>
                <X size={18} />
              </IconButton>
            </RadixDialog.Close>
          </header>
          <div className="vb-dialog-body">{children}</div>
          {footer && <footer className="vb-dialog-footer">{footer}</footer>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
export const Drawer = Sheet;
export interface PopoverProps {
  trigger: ReactElement;
  label: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
export function Popover({ trigger, label, children, ...root }: PopoverProps) {
  const portal = usePortalContainer();
  const { t } = useTranslation();
  return (
    <RadixPopover.Root {...root}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal {...(portal === null ? {} : { container: portal })}>
        <RadixPopover.Content className="vb-floating vb-popover" aria-label={label} sideOffset={8}>
          <div className="vb-popover-heading">
            <span>{label}</span>
            <RadixPopover.Close asChild>
              <IconButton size="sm" label={t('ui.close')}>
                <X size={14} />
              </IconButton>
            </RadixPopover.Close>
          </div>
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
export interface TooltipProps {
  children: ReactElement;
  content: string;
}
export function Tooltip({ children, content }: TooltipProps) {
  const portal = usePortalContainer();
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal {...(portal === null ? {} : { container: portal })}>
        <RadixTooltip.Content className="vb-tooltip" sideOffset={8}>
          {content}
          <RadixTooltip.Arrow className="vb-tooltip-arrow" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
