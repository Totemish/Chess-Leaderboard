import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { buttonStyles } from './button';

/** A failed load: what happened, plus a way to try again. */
export function ErrorMessage({
  title,
  detail,
  onRetry,
  className,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('rounded-lg border border-loss/40 bg-surface px-5 py-6', className)}>
      <p className="font-semibold text-ink">{title}</p>
      {detail && <p className="mt-1 text-sm text-ink-soft">{detail}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'mt-4' })}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Nothing to show yet: say why, and what to do about it. */
export function EmptyMessage({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-dashed border-line-strong px-5 py-8', className)}>
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}
