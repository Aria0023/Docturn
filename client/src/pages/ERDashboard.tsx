import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Assignment, Hospitalist, Patient } from "@/lib/types";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  StatusBadge,
  Textarea,
} from "@/components/ui";

interface Extracted {
  initials: string;
  roomNumber: string;
  issueSummary: string;
  specialty: string;
}

export function ERDashboard() {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [form, setForm] = useState<Extracted>({
    initials: "",
    roomNumber: "",
    issueSummary: "",
    specialty: "",
  });
  const [mode, setMode] = useState<"round_robin" | "manual">("round_robin");
  const [manualId, setManualId] = useState<number | "">("");

  const { data: working = [] } = useQuery<Hospitalist[]>({
    queryKey: ["/api/hospitalists/working"],
  });
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
  });

  const extract = useMutation({
    mutationFn: () => api.post<Extracted>("/api/patients/extract", { note }),
    onSuccess: (data) => setForm(data),
  });

  const createAndRoute = useMutation({
    mutationFn: async () => {
      const patient = await api.post<Patient>("/api/patients", {
        initials: form.initials,
        roomNumber: form.roomNumber,
        issueSummary: form.issueSummary,
        specialty: form.specialty,
      });
      return api.post<Assignment>("/api/assignments", {
        patientId: patient.id,
        mode,
        hospitalistId: mode === "manual" ? Number(manualId) : undefined,
      });
    },
    onSuccess: () => {
      setNote("");
      setForm({ initials: "", roomNumber: "", issueSummary: "", specialty: "" });
      qc.invalidateQueries({ queryKey: ["/api/patients"] });
    },
  });

  // Next round-robin provider preview = lowest census among working.
  const nextProvider = [...working].sort(
    (a, b) => a.currentPatientCount - b.currentPatientCount,
  )[0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Patient intake</h1>

      <Card>
        <CardHeader title="New patient" subtitle="Paste a note, extract, route" />
        <div className="space-y-4 p-6">
          <Textarea
            rows={3}
            placeholder="e.g. Patient S.C. in room 204 with chest pain, possible cardiac event…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!note || extract.isPending}
            onClick={() => extract.mutate()}
          >
            {extract.isPending ? "Extracting…" : "Extract with AI"}
          </Button>

          <div className="grid grid-cols-4 gap-3">
            <Labeled label="Initials">
              <Input
                value={form.initials}
                onChange={(e) =>
                  setForm({ ...form, initials: e.target.value.toUpperCase() })
                }
              />
            </Labeled>
            <Labeled label="Room">
              <Input
                value={form.roomNumber}
                onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
              />
            </Labeled>
            <Labeled label="Specialty">
              <Input
                value={form.specialty}
                onChange={(e) => setForm({ ...form, specialty: e.target.value })}
              />
            </Labeled>
            <Labeled label="Summary">
              <Input
                value={form.issueSummary}
                onChange={(e) =>
                  setForm({ ...form, issueSummary: e.target.value })
                }
              />
            </Labeled>
          </div>

          <div className="flex items-center gap-3 border-t border-border pt-4">
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="round_robin">Quick (round-robin)</option>
              <option value="manual">Manual</option>
            </select>

            {mode === "round_robin" ? (
              <span className="text-sm text-muted-foreground">
                Next:{" "}
                <span className="font-semibold text-foreground">
                  {nextProvider
                    ? `#${nextProvider.id} (${nextProvider.specialty}, census ${nextProvider.currentPatientCount})`
                    : "no provider available"}
                </span>
              </span>
            ) : (
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={manualId}
                onChange={(e) => setManualId(Number(e.target.value))}
              >
                <option value="">Choose provider…</option>
                {working.map((h) => (
                  <option key={h.id} value={h.id}>
                    #{h.id} · {h.specialty} · census {h.currentPatientCount}
                  </option>
                ))}
              </select>
            )}

            <Button
              className="ml-auto"
              disabled={!form.initials || createAndRoute.isPending}
              onClick={() => createAndRoute.mutate()}
            >
              {createAndRoute.isPending ? "Sending…" : "Create & route"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Recently sent" subtitle="Patients you admitted" />
        {patients.length === 0 ? (
          <EmptyState message="No patients yet." />
        ) : (
          <ul className="divide-y divide-border">
            {patients.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-6 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-bold">
                  {p.initials}
                </div>
                <div className="flex-1">
                  <div className="font-semibold">
                    {p.initials}
                    {p.roomNumber && (
                      <span className="text-muted-foreground">
                        {" "}
                        · Room {p.roomNumber}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {p.issueSummary}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
