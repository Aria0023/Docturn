import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Assignment, ExtractResult, Patient, RiskLevel } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { AssignmentBadge, PatientStatusBadge, RiskBadge } from '@/components/StatusBadge';
import { Sparkles, UserPlus } from 'lucide-react';

const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high'];

export function ERDoctorDashboard() {
  const qc = useQueryClient();

  const [rawText, setRawText] = useState('');
  const [initials, setInitials] = useState('');
  const [room, setRoom] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('low');
  const [formError, setFormError] = useState<string | null>(null);

  const patientsQuery = useQuery({
    queryKey: ['patients'],
    queryFn: () => api.get<Patient[]>('/api/patients'),
  });

  const pendingQuery = useQuery({
    queryKey: ['assignments', 'pending'],
    queryFn: () => api.get<Assignment[]>('/api/assignments/pending'),
  });

  const extract = useMutation({
    mutationFn: () =>
      api.post<ExtractResult>('/api/patients/extract', {
        text: rawText,
        initials: initials || undefined,
        room: room || undefined,
      }),
    onSuccess: (data) => {
      setInitials(data.initials || initials);
      setRoom(data.room || room);
      setChiefComplaint(data.chiefComplaint || '');
      setDiagnosis(data.diagnosis || '');
      if (data.riskLevel) setRiskLevel(data.riskLevel);
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Extraction failed'),
  });

  const createPatient = useMutation({
    mutationFn: () =>
      api.post<Patient>('/api/patients', {
        initials,
        room: room || undefined,
        chiefComplaint: chiefComplaint || undefined,
        diagnosis: diagnosis || undefined,
        riskLevel,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      setRawText('');
      setInitials('');
      setRoom('');
      setChiefComplaint('');
      setDiagnosis('');
      setRiskLevel('low');
      setFormError(null);
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Could not create patient'),
  });

  const assign = useMutation({
    mutationFn: (patientId: number) =>
      api.post<Assignment>('/api/assignments', { patientId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assignments'] });
      qc.invalidateQueries({ queryKey: ['patients'] });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!initials.trim()) {
      setFormError('Patient initials are required.');
      return;
    }
    createPatient.mutate();
  };

  const patients = patientsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">ER Intake</h1>
        <p className="text-sm text-slate-500">Capture patients and assign them to hospitalists</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New Patient Intake</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="raw">Clinical note</Label>
                <Textarea
                  id="raw"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Paste or type the intake note, then extract structured fields…"
                  rows={4}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => extract.mutate()}
                  disabled={!rawText.trim() || extract.isPending}
                >
                  <Sparkles className="h-4 w-4" />
                  {extract.isPending ? 'Extracting…' : 'Extract fields'}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="initials">Initials</Label>
                  <Input
                    id="initials"
                    value={initials}
                    onChange={(e) => setInitials(e.target.value)}
                    placeholder="J.D."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="room">Room</Label>
                  <Input
                    id="room"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    placeholder="ER-12"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cc">Chief complaint</Label>
                <Input
                  id="cc"
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  placeholder="Chest pain"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dx">Diagnosis</Label>
                <Input
                  id="dx"
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="Working diagnosis"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="risk">Risk level</Label>
                <select
                  id="risk"
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
                  className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  {RISK_LEVELS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {formError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={createPatient.isPending}>
                {createPatient.isPending ? 'Saving…' : 'Add patient'}
              </Button>
            </form>
          </CardContent>
        </Card>

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
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 p-3"
                >
                  <span className="text-sm font-medium text-slate-800">
                    {patient ? patient.initials : `Patient #${a.patientId}`}
                  </span>
                  <AssignmentBadge status={a.status} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Patients</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {patientsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {!patientsQuery.isLoading && patients.length === 0 && (
            <p className="text-sm text-slate-500">No patients yet.</p>
          )}
          {patients.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {p.initials}
                    {p.room ? ` · Room ${p.room}` : ''}
                  </p>
                  <p className="text-sm text-slate-500">
                    {p.chiefComplaint ?? 'No chief complaint'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <RiskBadge level={p.riskLevel} />
                <PatientStatusBadge status={p.status} />
                {p.status === 'waiting' && (
                  <Button
                    size="sm"
                    onClick={() => assign.mutate(p.id)}
                    disabled={assign.isPending}
                  >
                    <UserPlus className="h-4 w-4" /> Assign
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
