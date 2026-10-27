'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Form field primitives.
 *
 * `Field` wires a label, control, hint and error message together with the
 * right `id` / `aria-describedby` / `aria-invalid` relationships so screen
 * readers announce validation failures without any per-form wiring.
 */

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(function Label({ className, children, required, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('text-[13px] font-medium text-ink leading-none', className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="ml-0.5 text-danger" aria-hidden>
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
});

const inputBase = [
  'w-full rounded-md border border-line bg-surface px-3 text-sm text-ink',
  'placeholder:text-ink-subtle shadow-xs transition-colors',
  'hover:border-line-strong',
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/25',
].join(' ');

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = 'text', ...props }, ref) {
    return <input ref={ref} type={type} className={cn(inputBase, 'h-9', className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea ref={ref} rows={rows} className={cn(inputBase, 'py-2 resize-y', className)} {...props} />
  );
});

/**
 * Native select. Used wherever a plain list of options is enough — it is
 * faster, fully keyboard/screen-reader native, and works on mobile.
 * `EntitySelect` (searchable, Radix-based) covers the richer cases.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(inputBase, 'h-9 appearance-none pr-8 cursor-pointer', className)}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
      >
        <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
});

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | string[] | undefined;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
  const generatedId = React.useId();
  const id = htmlFor ?? generatedId;
  const errorText = Array.isArray(error) ? error[0] : error;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [errorText ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  const child = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': errorText ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })
    : children;

  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      ) : null}
      {child}
      {hint && !errorText ? (
        <p id={hintId} className="text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
      {errorText ? (
        <p id={errorId} role="alert" className="flex items-start gap-1 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{errorText}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Groups fields into a titled section inside a form. */
export function FieldSet({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('space-y-4', className)}>
      <legend className="sr-only">{title}</legend>
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-ink-subtle">{description}</p> : null}
      </div>
      {children}
    </fieldset>
  );
}
