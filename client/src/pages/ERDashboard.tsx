import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Hospitalist, Patient } from "@/lib/types";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyCard,
  Field,
  Icon,
  PageWrap,
  SectionTitle,
} from "@/components/kit";

interface Extracted {
  initials: string;
  roomNumber: string;
  issueSummary: string;
  specialty: string;
}

export function ERDashboard() {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [form, setForm] = useState<Extracted>({ initials: "", roomNumber: "", issueSummary: "", specialty: "" });
  const [mode, setMode] = useState<"round_robin" | "manual">("round_robin");
  const [manualId, setManualId] = useState<number | "">("");

  const { data: working = [] } = useQuery<Hospitalist[]>({ queryKey: ["/api/hospitalists/working"] });
  const { data: patients = [] } = useQuery<Patient[]>({ queryKey: ["/api/patients"] });

  const extract = useMutation({
    mutationFn: () => api.post<Extracted>("/api/patients/extract", { note }),
    onSuccess: (d) => setForm(d),
  });
  const createAndRoute = useMutation({
    mutationFn: async () => {
      const patient = await api.post<Patient>("/api/patients", {
        initials: form.initials, roomNumber: form.roomNumber, issueSummary: form.issueSummary, specialty: form.specialty,
      });
      return api.post("/api/assignments", {
        patientId: patient.id, mode, hospitalistId: mode === "manual" ? Number(manualId) : undefined,
      });
    },
    onSuccess: () => {
      setNote("");
      setForm({ initials: "", roomNumber: "", issueSummary: "", specialty: "" });
      qc.invalidateQueries({ queryKey: ["/api/patients"] });
    },
  });

  const next = [...working].sort((a, b) => a.currentPatientCount - b.currentPatientCount)[0];

  return (
    <PageWrap>
      <Card style={{ padding: 0, marginBottom: 24, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>New patient intake</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Paste a note, extract with AI, then route.</div>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <Field textarea rows={3} icon="clipboard-plus" value={note} onChange={setNote}
            placeholder="e.g. Patient S.C. in room 204 with chest pain, possible cardiac event…" />
          <div>
            <Button variant="secondary" icon="sparkles" disabled={!note || extract.isPending} onClick={() => extract.mutate()}>
              {extract.isPending ? "Extracting…" : "Extract with AI"}
            </Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            <Field label="Initials" value={form.initials} onChange={(v) => setForm({ ...form, initials: v.toUpperCase() })} />
            <Field label="Room" value={form.roomNumber} onChange={(v) => setForm({ ...form, roomNumber: v })} />
            <Field label="Specialty" value={form.specialty} onChange={(v) => setForm({ ...form, specialty: v })} />
            <Field label="Summary" value={form.issueSummary} onChange={(v) => setForm({ ...form, issueSummary: v })} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}
              style={{ height: 40, borderRadius: "var(--radius-md)", border: "1px solid var(--input)", padding: "0 12px", fontSize: 14, background: "#fff" }}>
              <option value="round_robin">Quick (round-robin)</option>
              <option value="manual">Manual</option>
            </select>
            {mode === "round_robin" ? (
              <span style={{ fontSize: 13, color: "var(--muted-foreground)", display: "flex", gap: 6, alignItems: "center" }}>
                <Icon name="route" size={14} /> Next:{" "}
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>
                  {next ? `${next.specialty} · census ${next.currentPatientCount}` : "no provider available"}
                </span>
              </span>
            ) : (
              <select value={manualId} onChange={(e) => setManualId(Number(e.target.value))}
                style={{ height: 40, borderRadius: "var(--radius-md)", border: "1px solid var(--input)", padding: "0 12px", fontSize: 14, background: "#fff" }}>
                <option value="">Choose provider…</option>
                {working.map((h) => (
                  <option key={h.id} value={h.id}>#{h.id} · {h.specialty} · census {h.currentPatientCount}</option>
                ))}
              </select>
            )}
            <div style={{ marginLeft: "auto" }}>
              <Button icon="send" disabled={!form.initials || createAndRoute.isPending} onClick={() => createAndRoute.mutate()}>
                {createAndRoute.isPending ? "Sending…" : "Create & route"}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <SectionTitle>Recently admitted</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {patients.length === 0 && <EmptyCard icon="clipboard-list" title="No patients yet" />}
        {patients.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={p.initials} size={34} tint="blue" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Patient {p.initials}{p.roomNumber ? ` · Room ${p.roomNumber}` : ""}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p.issueSummary}</div>
            </div>
            <Badge status={p.status}>{p.status}</Badge>
          </div>
        ))}
      </Card>
    </PageWrap>
  );
}
