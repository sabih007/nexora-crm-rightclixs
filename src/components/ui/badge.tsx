import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-sunken text-ink-muted',
        brand: 'border-brand-500/25 bg-brand-500/10 text-brand-600 dark:text-brand-300',
        success: 'border-success/25 bg-success-soft text-success',
        warning: 'border-warning/25 bg-warning-soft text-warning',
        danger: 'border-danger/25 bg-danger-soft text-danger',
        info: 'border-info/25 bg-info-soft text-info',
        outline: 'border-line-strong bg-transparent text-ink-muted',
      },
      size: {
        sm: 'px-1.5 py-0 text-[10px]',
        md: '',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Renders a small filled dot before the label. */
  dot?: boolean;
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

export { badgeVariants };
