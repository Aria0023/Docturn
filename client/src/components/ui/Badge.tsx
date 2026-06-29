import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'offline'
  | 'online'
  | 'neutral'
  | 'info'
  | 'high'
  | 'medium'
  | 'low';

const tones: Record<BadgeTone, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  accepted: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  online: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-red-100 text-red-800 border-red-200',
  offline: 'bg-slate-100 text-slate-700 border-slate-200',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
