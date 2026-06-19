import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Assignment, CareTeam, Hospitalist, Patient } from "@/lib/types";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyCard,
  Icon,
  PageWrap,
  SectionTitle,
  StatTile,
} from "@/components/kit";

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const remain = new Date(expiresAt).getTime() - Date.now();
  const urgent = remain <= 60000;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, lineHeight: 1.6, fontVariantNumeric: "tabular-nums", background: urgent ? "var(--status-rejected-bg)" : "var(--status-pending-bg)", color: urgent ? "var(--status-rejected)" : "var(--status-pending)" }}>
      <Icon name={urgent ? "alarm-clock" : "clock"} size={11} />
      {remain > 0 ? `Expires in ${mmss(remain)}` : "Expired"}
    </span>
  );
}

export function HospitalistDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: pending = [] } = useQuery<Assignment[]>({ queryKey: ["/api/assignments/pending"] });
  const { data: mine = [] } = useQuery<Assignment[]>({ queryKey: ["/api/assignments/my"] });
  const { data: hospitalists = [] } = useQuery<Hospitalist[]>({ queryKey: ["/api/hospitalists"] });
  const { data: patients = [] } = useQuery<Patient[]>({ queryKey: ["/api/patients"] });
  const { data: team } = useQuery<CareTeam>({ queryKey: ["/api/care-team"] });

  const me = hospitalists.find((h) => h.userId === user?.id);
  const byId = new Map(patients.map((p) => [p.id, p]));
  const onCall = team?.members.filter((m) => m.onCall) ?? [];

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "accept" | "reject" }) =>
      api.patch(`/api/assignments/${id}/${action}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/assignments/pending"] });
      qc.invalidateQueries({ queryKey: ["/api/assignments/my"] });
      qc.invalidateQueries({ queryKey: ["/api/hospitalists"] });
    },
  });

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
        <StatTile label="Current census" value={me?.currentPatientCount ?? mine.length} icon="users" tint="blue" />
        <StatTile label="Patient cap" value={`${me?.currentPatientCount ?? 0}/${me?.patientCap ?? 12}`} icon="gauge" tint="slate" />
        <StatTile label="Pending" value={pending.length} icon="clock" tint="amber" />
        <StatTile label="Accepted" value={mine.length} icon="check-circle-2" tint="emerald" />
      </div>

      {/* On-call unit banner */}
      <Link href="/team">
        <a style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", marginBottom: 18, borderRadius: "var(--radius-md)", background: "#EFF6FF", border: "1px solid #BFDBFE", textDecoration: "none" }}>
          <Icon name="link" size={16} color="var(--primary)" />
          {onCall.length === 0 ? (
            <span style={{ fontSize: 13, color: "#1E3A5F" }}>
              You're taking requests solo. <span style={{ fontWeight: 600, textDecoration: "underline" }}>Add a midlevel or partner</span> to share your on-call load.
            </span>
          ) : (
            <>
              <span style={{ fontSize: 13, color: "#1E3A5F", whiteSpace: "nowrap" }}>Requests are shared with your on-call unit:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {onCall.map((m) => (
                  <span key={m.userId} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-full)", padding: "2px 8px 2px 3px" }}>
                    <Avatar initials={initialsOf(m.displayName)} size={18} tint="slate" />
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{m.displayName.split(",")[0]}</span>
                    {m.credential && <Badge variant="secondary">{m.credential}</Badge>}
                  </span>
                ))}
              </div>
              <Icon name="chevron-right" size={15} color="var(--muted-foreground)" style={{ marginLeft: "auto" }} />
            </>
          )}
        </a>
      </Link>

      <SectionTitle action={<Badge status="pending">{pending.length} awaiting</Badge>}>
        Incoming assignment requests
      </SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        {pending.length === 0 && (
          <EmptyCard icon="inbox" title="No pending assignments" subtitle="You're all caught up." />
        )}
        {pending.map((a) => {
          const p = byId.get(a.patientId);
          return (
            <Card key={a.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                <Avatar initials={p?.initials ?? "??"} size={42} tint="amber" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap" }}>Patient {p?.initials}</span>
                    {p?.roomNumber && <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>· Room {p.roomNumber}</span>}
                    <ExpiryBadge expiresAt={a.expiresAt} />
                  </div>
                  <div style={{ fontSize: 13.5, marginTop: 4 }}>{p?.issueSummary}</div>
                  <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12.5, color: "var(--muted-foreground)" }}>
                    {p?.specialty && <span style={{ display: "flex", gap: 5, alignItems: "center" }}><Icon name="stethoscope" size={13} />{p.specialty}</span>}
                    <span style={{ display: "flex", gap: 5, alignItems: "center" }}><Icon name="route" size={13} />{a.via.replace("_", " ")}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flex: "none" }}>
                  <Button variant="outline" size="sm" icon="x" onClick={() => respond.mutate({ id: a.id, action: "reject" })}>Decline</Button>
                  <Button size="sm" icon="check" onClick={() => respond.mutate({ id: a.id, action: "accept" })}>Accept</Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <SectionTitle>My patients</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {mine.length === 0 && <EmptyCard icon="user" title="No accepted patients yet" />}
        {mine.map((a, i) => {
          const p = byId.get(a.patientId);
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <Avatar initials={p?.initials ?? "??"} size={34} tint="blue" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Patient {p?.initials}{p?.roomNumber ? ` · Room ${p.roomNumber}` : ""}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p?.issueSummary}</div>
              </div>
              <Badge status="accepted">Accepted</Badge>
            </div>
          );
        })}
      </Card>
    </PageWrap>
  );
}

function initialsOf(name: string): string {
  return name.replace(/,.*$/, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
