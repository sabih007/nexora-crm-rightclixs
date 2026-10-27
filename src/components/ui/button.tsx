'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md',
    'text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform]',
    'duration-150 select-none',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:translate-y-px',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-brand-500 text-white shadow-xs hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500/40',
        secondary:
          'border border-line bg-surface text-ink shadow-xs hover:bg-surface-hover hover:border-line-strong',
        ghost: 'text-ink-muted hover:bg-surface-hover hover:text-ink',
        subtle: 'bg-surface-sunken text-ink hover:bg-surface-hover',
        danger: 'bg-danger text-white shadow-xs hover:brightness-110',
        'danger-outline': 'border border-danger/40 bg-transparent text-danger hover:bg-danger-soft',
        link: 'text-brand-500 underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4',
        lg: 'h-11 px-6 text-[15px]',
        icon: 'size-9 p-0',
        'icon-sm': 'size-8 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and blocks interaction. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          <span>{children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
});

export { buttonVariants };
