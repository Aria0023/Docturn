import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DirectoryUser, Presence, Role } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { BadgeTone } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const ROLE_LABELS: Record<Role, string> = {
  director: 'Director',
  er_director: 'ER Director',
  er_doctor: 'ER Doctor',
  hospitalist: 'Hospitalist',
  developer: 'Developer',
};

const ROLE_TONE: Record<Role, BadgeTone> = {
  director: 'info',
  er_director: 'info',
  er_doctor: 'accepted',
  hospitalist: 'pending',
  developer: 'neutral',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function DirectoryPage() {
  const usersQuery = useQuery({
    queryKey: ['directory'],
    queryFn: () => api.get<DirectoryUser[]>('/api/directory'),
  });

  const presenceQuery = useQuery({
    queryKey: ['presence'],
    queryFn: () => api.get<Presence>('/api/presence'),
    refetchInterval: 30_000,
  });

  const onlineIds = new Set(presenceQuery.data?.online ?? []);
  const users = usersQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Directory</h1>
        <p className="text-sm text-slate-500">Staff across your organization</p>
      </div>

      {usersQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {!usersQuery.isLoading && users.length === 0 && (
        <p className="text-sm text-slate-500">No staff found.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {users.map((u) => {
          const online = onlineIds.has(u.id);
          return (
            <Card key={u.id}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="relative">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 font-semibold text-[#2563EB]">
                    {initials(u.fullName)}
                  </div>
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white',
                      online ? 'bg-emerald-500' : 'bg-slate-400',
                    )}
                    title={online ? 'Online' : 'Offline'}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{u.fullName}</p>
                  <p className="truncate text-sm text-slate-500">@{u.username}</p>
                  <div className="mt-1">
                    <Badge tone={ROLE_TONE[u.role] ?? 'neutral'}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
