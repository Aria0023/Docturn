import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { Assignment, DirectoryEntry, Patient } from "@/lib/types";
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
  StatusDot,
} from "@/components/kit";

function isToday(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.toDateString() === n.toDateString();
}

export function ErDirectorDashboard() {
  const { data: assignments = [] } = useQuery<Assignment[]>({ queryKey: ["/api/assignments"] });
  const { data: patients = [] } = useQuery<Patient[]>({ queryKey: ["/api/patients"] });
  const { data: directory = [] } = useQuery<DirectoryEntry[]>({ queryKey: ["/api/physicians/directory"] });

  const admittedToday = patients.filter((p) => isToday(p.createdAt)).length;
  const pending = assignments.filter((a) => a.status === "pending").length;
  const acceptedToday = assignments.filter((a) => a.status === "accepted" && a.resolvedAt && isToday(a.resolvedAt));

  // Average accept latency (createdAt → resolvedAt) over accepted assignments.
  const latencies = acceptedToday
    .map((a) => (new Date(a.resolvedAt!).getTime() - new Date(a.createdAt).getTime()) / 1000)
    .filter((s) => s >= 0);
  const avgAccept = latencies.length
    ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length)
    : null;
  const avgLabel = avgAccept == null ? "—" : avgAccept < 90 ? `${avgAccept}s` : `${Math.round(avgAccept / 60)}m`;

  const waiting = patients.filter((p) => p.status === "waiting");
  const onShift = directory.filter((d) => d.working).length;

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
        <StatTile label="Admitted today" value={admittedToday} icon="clipboard-plus" tint="blue" />
        <StatTile label="Awaiting acceptance" value={pending} icon="clock" tint="amber" />
        <StatTile label="Accepted today" value={acceptedToday.length} icon="check-circle-2" tint="emerald" />
        <StatTile label="Avg accept time" value={avgLabel} icon="timer" tint="slate" />
      </div>

      <div style={{ display: "flex", gap: 11, padding: "11px 14px", marginBottom: 18, borderRadius: "var(--radius-md)", background: "#EFF6FF", border: "1px solid #BFDBFE", alignItems: "center" }}>
        <Icon name="users-round" size={16} color="var(--primary)" />
        <span style={{ fontSize: 13, color: "#1E3A5F" }}>
          <span style={{ fontWeight: 600 }}>{onShift}</span> provider{onShift === 1 ? "" : "s"} on shift and accepting hand-offs.
        </span>
        <Link href="/broadcasts">
          <a style={{ marginLeft: "auto", textDecoration: "none" }}>
            <Button variant="outline" size="sm" icon="megaphone">Broadcast</Button>
          </a>
        </Link>
      </div>

      <SectionTitle action={<Badge status="pending">{waiting.length} waiting</Badge>}>
        Patients awaiting capacity
      </SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        {waiting.length === 0 && <EmptyCard icon="check-circle-2" title="No patients waiting" subtitle="Every admit has been routed." />}
        {waiting.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={p.initials} size={34} tint="amber" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Patient {p.initials}{p.roomNumber ? ` · Room ${p.roomNumber}` : ""}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p.issueSummary}</div>
            </div>
            <Badge status="waiting">Waiting</Badge>
          </div>
        ))}
      </Card>

      <SectionTitle>Provider availability</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {directory.map((d, i) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <StatusDot status={d.working ? "online" : "offline"} pulse={d.working} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{d.displayName}</span>
            {d.credential && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{d.credential}</span>}
            <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted-foreground)" }}>{d.specialty} · {d.shiftType}</span>
          </div>
        ))}
      </Card>
    </PageWrap>
  );
}
