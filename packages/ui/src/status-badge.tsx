export type Status = 'up' | 'down' | 'unknown';

const ICONS: Record<Status, string> = { up: '✓', down: '✕', unknown: '…' };

export interface StatusBadgeProps {
  status: Status;
  label: string;
  statusText: string;
}

/** Status indicator that never relies on color alone (WCAG 1.4.1): icon + text. */
export function StatusBadge({ status, label, statusText }: StatusBadgeProps) {
  return (
    <span className="vb-status" data-status={status} role="status" aria-live="polite">
      <span className="vb-status__icon" aria-hidden="true">
        {ICONS[status]}
      </span>
      <span>
        {label}: {statusText}
      </span>
    </span>
  );
}
