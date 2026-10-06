import { type ReactNode } from 'react';

export interface AppShellProps {
  productName: string;
  appName: string;
  skipLinkLabel: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Application frame with landmarks and a skip link (WCAG 2.4.1). */
export function AppShell({
  productName,
  appName,
  skipLinkLabel,
  actions,
  children,
}: AppShellProps) {
  return (
    <div className="vb-shell">
      <a className="vb-skip-link" href="#main-content" tabIndex={0}>
        {skipLinkLabel}
      </a>
      <header className="vb-shell__header vb-brand-surface">
        <div className="vb-shell__brand">
          <span>{productName}</span>
          <span className="vb-shell__app">{appName}</span>
        </div>
        {actions !== undefined && <div className="vb-shell__actions">{actions}</div>}
      </header>
      <main id="main-content" className="vb-shell__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
