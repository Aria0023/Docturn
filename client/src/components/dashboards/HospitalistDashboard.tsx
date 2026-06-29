import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Assignment, Hospitalist, Patient, User } from '@/lib/types';
import { userQueryKey } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AssignmentBadge } from '@/components/StatusBadge';
import { CensusBar } from '@/components/CensusBar';
import { CheckCircle2, XCircle } from 'lucide-react';

export function HospitalistDashboard() {
  const qc = useQueryClient();
  const user = qc.getQueryData<User>(userQueryKey);

  const assignmentsQuery = useQuery({
    queryKey: ['assignments', 'my'],
    queryFn: () => api.get<Assignment[]>('/api/assignments/my'),
  });

  const hospitalistsQuery = useQuery({
    queryKey: ['hospitalists'],
    queryFn: () => api.get<Hospitalist[]>('/api/hospitalists'),
  });

  const patientsQuery = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.get<Patient[]>('/api/patients'),
  });

  const me = hospitalistsQuery.data?.find((h) => h.userId === user?.id);

  const accept = useMutation({
    mutationFn: (id: number) => api.patch(`/api/assignments/${id}/accept`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments'] });
      qc.invalidateQueries({ queryKey: ['hospitalists'] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: number) => api.patch(`/api/assignments/${id}/reject`, { reason: 'Declined' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assignments'] }),
  });

  const patientById = (id: number) => patientsQuery.data?.find((p) => p.id === id);

  const assignments = assignmentsQuery.data ?? [];
  const pending = assignments.filter((a) => a.status === 'pending');
  const others = assignments.filter((a) => a.status !== 'pending');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">My Dashboard</h1>
        <p className="text-sm text-slate-500">Review and respond to patient assignments</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Census</CardTitle>
          </CardHeader>
          <CardContent>
            {me ? (
              <CensusBar census={me.census} capacity={me.capacity} />
            ) : (
              <p className="text-sm text-slate-500">No provider record found.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700">
              {me?.isWorking ? 'On shift' : 'Off shift'}
              {me?.shiftType ? ` · ${me.shiftType}` : ''}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-600">{pending.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {assignmentsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {!assignmentsQuery.isLoading && pending.length === 0 && (
            <p className="text-sm text-slate-500">No pending assignments.</p>
          )}
          {pending.map((a) => {
            const patient = patientById(a.patientId);
            return (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md border border-slate-200 p-3"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {patient ? patient.initials : `Patient #${a.patientId}`}
                    {patient?.room ? ` · Room ${patient.room}` : ''}
                  </p>
                  <p className="text-sm text-slate-500">
                    {patient?.chiefComplaint ?? 'No chief complaint'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => accept.mutate(a.id)}
                    disabled={accept.isPending || reject.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => reject.mutate(a.id)}
                    disabled={accept.isPending || reject.isPending}
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assignment History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {others.length === 0 && (
            <p className="text-sm text-slate-500">No past assignments.</p>
          )}
          {others.map((a) => {
            const patient = patientById(a.patientId);
            return (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-md border border-slate-200 p-3"
              >
                <div>
                  <p className="font-medium text-slate-900">
                    {patient ? patient.initials : `Patient #${a.patientId}`}
                  </p>
                  <p className="text-sm text-slate-500">
                    {patient?.chiefComplaint ?? '—'}
                  </p>
                </div>
                <AssignmentBadge status={a.status} />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
