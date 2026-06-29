import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface Organization {
  id: number;
  name: string;
  timezone?: string;
}

export function DeveloperDashboard() {
  const orgsQuery = useQuery({
    queryKey: ['dev', 'organizations'],
    queryFn: () => api.get<Organization[]>('/api/dev/organizations'),
    retry: false,
  });

  const forbidden =
    orgsQuery.error instanceof ApiError && orgsQuery.error.status === 403;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Developer</h1>
        <p className="text-sm text-slate-500">Platform diagnostics</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {orgsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {forbidden && (
            <p className="text-sm text-slate-500">
              Organization listing is not available for this account.
            </p>
          )}
          {orgsQuery.isError && !forbidden && (
            <p className="text-sm text-slate-500">Unable to load organizations.</p>
          )}
          {orgsQuery.data?.map((org) => (
            <div
              key={org.id}
              className="flex items-center justify-between rounded-md border border-slate-200 p-3"
            >
              <span className="font-medium text-slate-900">{org.name}</span>
              <span className="text-xs text-slate-500">
                #{org.id}
                {org.timezone ? ` · ${org.timezone}` : ''}
              </span>
            </div>
          ))}
          {orgsQuery.data && orgsQuery.data.length === 0 && (
            <p className="text-sm text-slate-500">No organizations.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
