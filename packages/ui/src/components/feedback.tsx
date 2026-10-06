import { CircleCheck, Info, TriangleAlert, CircleX, X } from 'lucide-react';
import { Avatar as RadixAvatar, Progress as RadixProgress, Toast as RadixToast } from 'radix-ui';
import { type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { IconButton } from './button.js';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const icons = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};
export interface AlertProps {
  title: string;
  children?: ReactNode;
  tone?: Tone;
}
export function Alert({ title, children, tone = 'info' }: AlertProps) {
  const Icon = icons[tone];
  return (
    <div className="vb-alert" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div>
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}
export function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return <span {...props} className={`vb-badge ${className}`} data-tone={tone} />;
}
export interface AvatarProps {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
}
export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  return (
    <RadixAvatar.Root className="vb-avatar" data-size={size}>
      {src && <RadixAvatar.Image className="vb-avatar-image" src={src} alt={name} />}
      <RadixAvatar.Fallback className="vb-avatar-fallback" role="img" aria-label={name}>
        {name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join('')
          .toLocaleUpperCase()}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
export interface SkeletonProps {
  label?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
}
export function Skeleton({ label, width = '100%', height = 20, circle = false }: SkeletonProps) {
  const { t } = useTranslation();
  return (
    <span
      className="vb-skeleton"
      role="status"
      aria-label={label ?? t('ui.loading')}
      style={{
        inlineSize: width,
        blockSize: height,
        borderRadius: circle ? 'var(--vb-radius-full)' : 'var(--vb-radius-sm)',
      }}
    />
  );
}
export interface ProgressProps {
  label: string;
  value?: number;
}
export function Progress({ label, value }: ProgressProps) {
  const progress = value === undefined ? null : Math.max(0, Math.min(100, value));
  return (
    <RadixProgress.Root className="vb-progress" aria-label={label} value={progress}>
      <RadixProgress.Indicator
        className="vb-progress-bar"
        style={{ inlineSize: progress === null ? '40%' : `${progress}%` }}
      />
    </RadixProgress.Root>
  );
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <RadixToast.Provider swipeDirection="right">
      {children}
      <RadixToast.Viewport className="vb-toast-viewport" label={t('ui.notifications')} />
    </RadixToast.Provider>
  );
}
export interface ToastProps {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action?: ReactNode;
  duration?: number;
}
export function Toast({ title, description, action, ...props }: ToastProps) {
  const { t } = useTranslation();
  return (
    <RadixToast.Root {...props} className="vb-toast">
      <div>
        <RadixToast.Title className="vb-toast-title">{title}</RadixToast.Title>
        {description && (
          <RadixToast.Description className="vb-description">{description}</RadixToast.Description>
        )}
      </div>
      {action}
      <RadixToast.Close asChild>
        <IconButton size="sm" label={t('ui.close')}>
          <X size={16} />
        </IconButton>
      </RadixToast.Close>
    </RadixToast.Root>
  );
}
export const ToastAction = RadixToast.Action;
