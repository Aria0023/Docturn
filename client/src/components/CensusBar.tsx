import { cn } from '@/lib/utils';

export function CensusBar({ census, capacity }: { census: number; capacity: number }) {
  const safeCap = capacity > 0 ? capacity : 1;
  const pct = Math.min(100, Math.round((census / safeCap) * 100));
  const tone =
    pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-[#2563EB]';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">
          {census} / {capacity}
        </span>
        <span className="text-slate-500">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
