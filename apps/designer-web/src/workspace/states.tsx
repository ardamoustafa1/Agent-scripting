import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, Button, EmptyState, Skeleton } from '@verbis/ui';

export function Loading() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="dw-loading"
      aria-busy="true"
      aria-label={t('designer.workspace.loading')}
    >
      <Skeleton height={36} width="40%" />
      <Skeleton height={18} width="60%" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} height={62} />
      ))}
    </div>
  );
}
export function Failure({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="dw-state">
      <Alert title={t('designer.workspace.error')} tone="danger">
        {t('designer.workspace.errorDetail')}
      </Alert>
      <Button onClick={retry}>{t('designer.workspace.retry')}</Button>
    </div>
  );
}
export function Forbidden() {
  const { t } = useTranslation();
  return (
    <EmptyState
      title={t('designer.workspace.denied')}
      description={t('designer.workspace.deniedDetail')}
    />
  );
}
export class PageBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
