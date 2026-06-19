import { useQuery } from "@tanstack/react-query";
import { Card, EmptyCard, Icon, PageWrap, SectionTitle, StatTile } from "@/components/kit";

interface AuditRow {
  id: number;
  action: string;
  resourceType: string | null;
  resourceId: number | null;
  riskLevel: string;
  createdAt: string;
}
interface PhiRow {
  id: number;
  resource: string;
  method: string;
  createdAt: string;
}
interface AuditResponse {
  audit: AuditRow[];
  phiAccess: PhiRow[];
  phiAccessCount: number;
}

const RISK_COLOR: Record<string, string> = {
  low: "var(--status-neutral)",
  medium: "var(--status-pending)",
  high: "var(--status-rejected)",
};

export function Compliance() {
  const { data } = useQuery<AuditResponse>({ queryKey: ["/api/audit"] });
  const audit = data?.audit ?? [];
  const phi = data?.phiAccess ?? [];
  const highRisk = audit.filter((a) => a.riskLevel === "high").length;

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
        <StatTile label="Audit events" value={audit.length} icon="scroll-text" tint="blue" />
        <StatTile label="PHI accesses" value={data?.phiAccessCount ?? 0} icon="file-lock-2" tint="amber" />
        <StatTile label="High-risk events" value={highRisk} icon="shield-alert" tint="slate" />
      </div>

      <SectionTitle>Audit trail</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        {audit.length === 0 && <EmptyCard icon="scroll-text" title="No audit events yet" />}
        {audit.map((a, i) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none", fontSize: 13 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: RISK_COLOR[a.riskLevel], flex: "none" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{a.action}</span>
            <span style={{ color: "var(--muted-foreground)" }}>
              {a.resourceType}{a.resourceId ? ` #${a.resourceId}` : ""}
            </span>
            <span style={{ marginLeft: "auto", color: "var(--muted-foreground)", fontSize: 12 }}>
              {new Date(a.createdAt).toLocaleString()}
            </span>
          </div>
        ))}
      </Card>

      <SectionTitle>PHI access log</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {phi.length === 0 && <EmptyCard icon="file-lock-2" title="No PHI access recorded" />}
        {phi.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none", fontSize: 13 }}>
            <Icon name="file-lock-2" size={14} color="var(--muted-foreground)" />
            <span style={{ fontWeight: 600 }}>{p.resource}</span>
            <span style={{ color: "var(--muted-foreground)" }}>{p.method}</span>
            <span style={{ marginLeft: "auto", color: "var(--muted-foreground)", fontSize: 12 }}>
              {new Date(p.createdAt).toLocaleString()}
            </span>
          </div>
        ))}
      </Card>
    </PageWrap>
  );
}
