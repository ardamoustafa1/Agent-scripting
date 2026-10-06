import { ChevronRight, Inbox } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

export interface BreadcrumbProps {
  items: readonly { label: string; href?: string }[];
  label?: string;
}
export function Breadcrumb({ items, label }: BreadcrumbProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label={label ?? t('ui.breadcrumb')} className="vb-breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index > 0 && <ChevronRight className="vb-direction-icon" size={14} aria-hidden />}
            {index === items.length - 1 ? (
              <span aria-current="page">{item.label}</span>
            ) : item.href ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
export interface EmptyStateProps {
  headingLevel?: 2 | 3;
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}
export function EmptyState({
  title,
  description,
  action,
  icon,
  headingLevel = 3,
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="vb-empty">
      <div className="vb-empty-icon" aria-hidden>
        {icon ?? <Inbox size={24} />}
      </div>
      <Heading>{title}</Heading>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="vb-kbd">{children}</kbd>;
}
export interface SplitPaneProps {
  label: string;
  first: ReactNode;
  second: ReactNode;
  direction?: 'horizontal' | 'vertical';
  defaultSize?: number;
  minSize?: number;
}
export function SplitPane({
  label,
  first,
  second,
  direction = 'horizontal',
  defaultSize = 35,
  minSize = 15,
}: SplitPaneProps) {
  const { t } = useTranslation();
  return (
    <div className="vb-split" role="group" aria-label={label}>
      <PanelGroup direction={direction}>
        <Panel defaultSize={defaultSize} minSize={minSize}>
          <div className="vb-split-content">{first}</div>
        </Panel>
        <PanelResizeHandle className="vb-resize-handle" aria-label={t('ui.resizePane')} />
        <Panel minSize={minSize}>
          <div className="vb-split-content">{second}</div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
