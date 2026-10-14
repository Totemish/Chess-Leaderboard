import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-soft',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-square-alt',
  quiet: 'text-ink-soft hover:bg-square-alt hover:text-ink',
  danger: 'border border-loss/40 text-loss hover:bg-loss/10',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
};

/** Class names for a button-styled <button> or <Link>. */
export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-semibold transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className
  );
}
