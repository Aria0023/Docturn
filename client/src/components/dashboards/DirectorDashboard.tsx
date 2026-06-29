import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Assignment, Broadcast, Hospitalist, Patient, Severity } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { AssignmentBadge } from '@/components/StatusBadge';
import { CensusBar } from '@/components/CensusBar';
import { Megaphone } from 'lucide-react';

const SEVERITIES: Severity[] = ['low', 'medium', 'high'];

export function DirectorDashboard() {
  const qc = useQueryClient();

  const hospitalistsQuery = useQuery({
    queryKey: ['hospitalists'],
    queryFn: () => api.get<Hospitalist[]>('/api/hospitalists'),
  });

  const pendingQuery = useQuery({
    queryKey: ['assignments', 'pending'],
    queryFn: () => api.get<Assignment[]>('/api/assignments/pending'),
  });

  const patientsQuery = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.get<Patient[]>('/api/patients'),
  });

  const toggleWorking = useMutation({
    mutationFn: ({ id, isWorking }: { id: number; isWorking: boolean }) =>
      api.patch<Hospitalist>(`/api/hospitalists/${id}/working-status`, { isWorking }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hospitalists'] }),
  });

  const updateCapacity = useMutation({
    mutationFn: ({ id, capacity }: { id: number; capacity: number }) =>
      api.patch<Hospitalist>(`/api/hospitalists/${id}/capacity`, { capacity }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hospitalists'] }),
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<Severity>('low');
  const [broadcastMsg, setBroadcastMsg] = useState<string | null>(null);

  const broadcast = useMutation({
    mutationFn: () => api.post<Broadcast>('/api/broadcasts', { title, body, severity }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setSeverity('low');
      setBroadcastMsg('Broadcast sent.');
    },
    onError: (err) =>
      setBroadcastMsg(err instanceof Error ? err.message : 'Failed to send broadcast.'),
  });

  const hospitalists = hospitalistsQuery.data ?? [];
  const patients = patientsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Director Dashboard</h1>
        <p className="text-sm text-slate-500">Manage providers, assignments and broadcasts</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hospitalists</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {hospitalistsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {!hospitalistsQuery.isLoading && hospitalists.length === 0 && (
            <p className="text-sm text-slate-500">No hospitalists found.</p>
          )}
          {hospitalists.map((h) => (
            <div key={h.id} className="rounded-md border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{h.user.fullName}</p>
                  <p className="text-sm text-slate-500">
                    {h.specialty ?? 'General'} · {h.shiftType} shift
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={h.isWorking ? 'online' : 'offline'}>
                    {h.isWorking ? 'Working' : 'Off'}
                  </Badge>
                  <Button
                    size="sm"
                    variant={h.isWorking ? 'outline' : 'success'}
                    onClick={() =>
                      toggleWorking.mutate({ id: h.id, isWorking: !h.isWorking })
                    }
                    disabled={toggleWorking.isPending}
                  >
                    {h.isWorking ? 'Set off shift' : 'Set on shift'}
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <div className="min-w-[180px] flex-1">
                  <CensusBar census={h.census} capacity={h.capacity} />
                </div>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`cap-${h.id}`} className="text-xs">
                      Capacity
                    </Label>
                    <Input
                      id={`cap-${h.id}`}
                      type="number"
                      min={0}
                      defaultValue={h.capacity}
                      className="h-8 w-20"
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (!Number.isNaN(val) && val !== h.capacity) {
                          updateCapacity.mutate({ id: h.id, capacity: val });
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pending Assignments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {!pendingQuery.isLoading && (pendingQuery.data?.length ?? 0) === 0 && (
              <p className="text-sm text-slate-500">No pending assignments.</p>
            )}
            {pendingQuery.data?.map((a) => {
              const patient = patients.find((p) => p.id === a.patientId);
              const hosp = hospitalists.find((h) => h.id === a.hospitalistId);
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {patient ? patient.initials : `Patient #${a.patientId}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      {hosp ? `→ ${hosp.user.fullName}` : 'Unassigned'}
                    </p>
                  </div>
                  <AssignmentBadge status={a.status} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Broadcast</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setBroadcastMsg(null);
                if (title.trim() && body.trim()) broadcast.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="b-title">Title</Label>
                <Input
                  id="b-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Code update"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-body">Message</Label>
                <Textarea
                  id="b-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Message to all staff…"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="b-sev">Severity</Label>
                <select
                  id="b-sev"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as Severity)}
                  className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              {broadcastMsg && (
                <p className="text-sm text-slate-600">{broadcastMsg}</p>
              )}
              <Button type="submit" className="w-full" disabled={broadcast.isPending}>
                <Megaphone className="h-4 w-4" />
                {broadcast.isPending ? 'Sending…' : 'Send broadcast'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
