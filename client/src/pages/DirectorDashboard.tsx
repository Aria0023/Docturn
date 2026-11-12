import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Assignment, Hospitalist, Patient, User } from "@/lib/types";
import {
  Avatar,
  Button,
  Card,
  Field,
  Icon,
  PageWrap,
  SectionTitle,
  StatTile,
  StatusDot,
} from "@/components/kit";

interface OrgConfig {
  assignmentTimeoutMin: number;
  rotationMode: string;
}

export function DirectorDashboard() {
  const qc = useQueryClient();
  const { data: hospitalists = [] } = useQuery<Hospitalist[]>({ queryKey: ["/api/hospitalists"] });
  const { data: users = [] } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: config } = useQuery<OrgConfig>({ queryKey: ["/api/org/config"] });
  const { data: assignments = [] } = useQuery<Assignment[]>({ queryKey: ["/api/assignments"] });
  const { data: patients = [] } = useQuery<Patient[]>({ queryKey: ["/api/patients"] });
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [np, setNp] = useState({ username: "", displayName: "", specialty: "General", role: "hospitalist" });

  const userById = new Map(users.map((u) => [u.id, u]));
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const hById = new Map(hospitalists.map((h) => [h.id, h]));
  const pendingAssignments = assignments.filter((a) => a.status === "pending");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/hospitalists"] });
  const invalidateAssignments = () => {
    qc.invalidateQueries({ queryKey: ["/api/assignments"] });
    qc.invalidateQueries({ queryKey: ["/api/hospitalists"] });
  };

  const reassign = useMutation({
    mutationFn: (id: number) => api.patch(`/api/assignments/${id}/reassign`, {}),
    onSuccess: invalidateAssignments,
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api.patch(`/api/assignments/${id}/cancel`, {}),
    onSuccess: invalidateAssignments,
  });
  const addProvider = useMutation({
    mutationFn: () =>
      api.post("/api/director/hospitalists", {
        username: np.username,
        password: "docturn",
        displayName: np.displayName,
        role: np.role,
        ...(np.role === "hospitalist" ? { specialty: np.specialty } : {}),
      }),
    onSuccess: () => {
      setShowAdd(false);
      setNp({ username: "", displayName: "", specialty: "General", role: "hospitalist" });
      qc.invalidateQueries({ queryKey: ["/api/hospitalists"] });
      qc.invalidateQueries({ queryKey: ["/api/users"] });
    },
  });

  const toggle = useMutation({ mutationFn: ({ id, working }: { id: number; working: boolean }) => api.patch(`/api/hospitalists/${id}/working-status`, { working }), onSuccess: invalidate });
  const bulk = useMutation({ mutationFn: (working: boolean) => api.patch(`/api/hospitalists/0/working-status`, { all: working }), onSuccess: invalidate });
  const setCap = useMutation({ mutationFn: ({ id, patientCap }: { id: number; patientCap: number }) => api.patch(`/api/physicians/${id}/capacity`, { patientCap }), onSuccess: invalidate });
  const resetRotation = useMutation({ mutationFn: () => api.post("/api/round-robin/reset") });
  const setTimeout_ = useMutation({ mutationFn: (assignmentTimeoutMin: number) => api.patch("/api/org/config", { assignmentTimeoutMin }), onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/org/config"] }) });
  const broadcast = useMutation({ mutationFn: (severity: "urgent" | "critical") => api.post("/api/broadcasts", { message: broadcastMsg, severity }), onSuccess: () => setBroadcastMsg("") });

  const working = hospitalists.filter((h) => h.working).length;
  const totalCensus = hospitalists.reduce((s, h) => s + h.currentPatientCount, 0);

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
        <StatTile label="Providers" value={hospitalists.length} icon="users" tint="blue" />
        <StatTile label="On shift" value={working} icon="user-check" tint="emerald" />
        <StatTile label="Total census" value={totalCensus} icon="activity" tint="slate" />
        <StatTile label="Timeout" value={`${config?.assignmentTimeoutMin ?? "—"}m`} icon="timer" tint="amber" />
      </div>

      <Card style={{ padding: 16, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Icon name="megaphone" size={18} color="var(--status-pending)" />
          <div style={{ flex: 1 }}>
            <Field value={broadcastMsg} onChange={setBroadcastMsg} placeholder="Emergency broadcast to all staff…" />
          </div>
          <Button variant="secondary" disabled={!broadcastMsg} onClick={() => broadcast.mutate("urgent")}>Urgent</Button>
          <Button variant="destructive" disabled={!broadcastMsg} onClick={() => broadcast.mutate("critical")}>Critical</Button>
        </div>
      </Card>

      {pendingAssignments.length > 0 && (
        <>
          <SectionTitle>Pending assignments</SectionTitle>
          <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
            {pendingAssignments.map((a, i) => {
              const p = patientById.get(a.patientId);
              const h = hById.get(a.hospitalistId);
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <Avatar initials={p?.initials ?? "??"} size={34} tint="amber" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Patient {p?.initials}{p?.roomNumber ? ` · Room ${p.roomNumber}` : ""}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
                      → {userById.get(h?.userId ?? -1)?.displayName ?? `provider #${a.hospitalistId}`} · {a.via.replace("_", " ")}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" icon="route" onClick={() => reassign.mutate(a.id)}>Reassign</Button>
                  <Button variant="ghost" size="sm" icon="x" onClick={() => cancel.mutate(a.id)} style={{ color: "var(--destructive)" }}>Cancel</Button>
                </div>
              );
            })}
          </Card>
        </>
      )}

      <SectionTitle action={
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="outline" size="sm" icon="user-plus" onClick={() => setShowAdd((v) => !v)}>Add provider</Button>
          <Button variant="outline" size="sm" onClick={() => bulk.mutate(true)}>All on</Button>
          <Button variant="outline" size="sm" onClick={() => bulk.mutate(false)}>All off</Button>
        </div>
      }>Providers</SectionTitle>

      {showAdd && (
        <Card style={{ padding: 16, marginBottom: 12, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}><Field label="Username" value={np.username} onChange={(v) => setNp({ ...np, username: v })} /></div>
          <div style={{ flex: 1, minWidth: 140 }}><Field label="Display name" value={np.displayName} onChange={(v) => setNp({ ...np, displayName: v })} /></div>
          <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12.5, fontWeight: 500, color: "var(--muted-foreground)" }}>Role</label>
            <select value={np.role} onChange={(e) => setNp({ ...np, role: e.target.value })}
              style={{ height: 40, borderRadius: "var(--radius-md)", border: "1px solid var(--input)", padding: "0 12px", fontSize: 14, background: "#fff" }}>
              <option value="hospitalist">Hospitalist</option>
              <option value="er_doctor">ER Doctor</option>
              <option value="er_director">ER Director</option>
              <option value="director">Director</option>
            </select>
          </div>
          {np.role === "hospitalist" && (
            <div style={{ flex: 1, minWidth: 140 }}><Field label="Specialty" value={np.specialty} onChange={(v) => setNp({ ...np, specialty: v })} /></div>
          )}
          <Button disabled={!np.username || !np.displayName || addProvider.isPending} onClick={() => addProvider.mutate()}>Create</Button>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        {hospitalists.map((h, i) => (
          <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={initialsOf(userById.get(h.userId)?.displayName ?? "?")} size={36} tint={h.working ? "emerald" : "slate"} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{userById.get(h.userId)?.displayName ?? `#${h.id}`}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{h.specialty} · {h.shiftType}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{h.currentPatientCount}</span>
              <span style={{ color: "var(--muted-foreground)" }}>/</span>
              <Stepper onDec={() => setCap.mutate({ id: h.id, patientCap: Math.max(1, h.patientCap - 1) })} onInc={() => setCap.mutate({ id: h.id, patientCap: h.patientCap + 1 })} value={h.patientCap} />
            </div>
            <button onClick={() => toggle.mutate({ id: h.id, working: !h.working })} title="Toggle working"
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 500, width: 110, justifyContent: "center" }}>
              <StatusDot status={h.working ? "online" : "offline"} />
              {h.working ? "On shift" : "Off shift"}
            </button>
          </div>
        ))}
      </Card>

      <SectionTitle>Round-robin configuration</SectionTitle>
      <Card style={{ padding: 20, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>Timeout (min)</label>
        <input type="number" min={1} max={120} defaultValue={config?.assignmentTimeoutMin}
          onBlur={(e) => setTimeout_.mutate(Number(e.target.value))}
          style={{ height: 40, width: 90, borderRadius: "var(--radius-md)", border: "1px solid var(--input)", padding: "0 12px", fontSize: 14 }} />
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Mode: <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{config?.rotationMode}</span></span>
        <div style={{ marginLeft: "auto" }}>
          <Button variant="outline" icon="rotate-ccw" onClick={() => resetRotation.mutate()}>Reset rotation cursor</Button>
        </div>
      </Card>
    </PageWrap>
  );
}

function Stepper({ value, onInc, onDec }: { value: number; onInc: () => void; onDec: () => void }) {
  const btn = { width: 26, height: 26, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" } as const;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button style={btn} onClick={onDec}><Icon name="minus" size={13} /></button>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 16, textAlign: "center" }}>{value}</span>
      <button style={btn} onClick={onInc}><Icon name="plus" size={13} /></button>
    </span>
  );
}

function initialsOf(name: string): string {
  return name.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
