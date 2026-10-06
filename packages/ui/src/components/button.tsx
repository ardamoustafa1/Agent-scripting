import { LoaderCircle } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    children,
    className = '',
    startIcon,
    endIcon,
    type = 'button',
    ...props
  },
  ref,
) {
  const { t } = useTranslation();
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={`vb-button ${className}`}
      data-variant={variant}
      data-size={size}
      disabled={loading ? true : disabled}
      aria-busy={loading ? true : undefined}
    >
      {loading ? <LoaderCircle className="vb-spin" aria-hidden size={16} /> : startIcon}
      {children}
      {!loading && endIcon}
      {loading && <span className="vb-sr-only">{t('ui.loading')}</span>}
    </button>
  );
});
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'aria-label'> {
  label: string;
  children: ReactNode;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, className = '', variant = 'ghost', ...props },
  ref,
) {
  return (
    <Button
      {...props}
      ref={ref}
      variant={variant}
      className={`vb-icon-button ${className}`}
      aria-label={label}
    >
      <span aria-hidden>{children}</span>
    </Button>
  );
});
