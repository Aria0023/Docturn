import { forwardRef } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm',
          'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-[#2563EB] focus-visible:border-[#2563EB] disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm',
        'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-[#2563EB] focus-visible:border-[#2563EB] disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';
