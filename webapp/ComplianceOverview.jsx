/* DocTurn web-app UI kit — developer cross-tenant compliance overview.
   Separates compliance by organization so the platform operator sees each
   tenant's audit / PHI / high-risk activity at a glance, then drills into one
   org for its full trail. Compliance itself is per-organization; this is the
   cross-org roll-up for the developer only. */

function ComplianceOverview({ onOpenOrg }) {
  const [rows, setRows] = React.useState(null);
  const [q, setQ] = React.useState("");
  React.useEffect(() => {
    let alive = true;
    fetch("/api/dev/compliance-overview", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (alive) setRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  const list = (rows || []).filter((o) =>
    !q || o.name.toLowerCase().includes(q.toLowerCase()) || (o.code || "").toLowerCase().includes(q.toLowerCase()));
  const totalAudit = (rows || []).reduce((a, o) => a + (o.auditCount || 0), 0);
  const totalPhi = (rows || []).reduce((a, o) => a + (o.phiCount || 0), 0);
  const totalRisk = (rows || []).reduce((a, o) => a + (o.highRisk || 0), 0);

  const clock = (at) => { try { return window.dtFmt ? window.dtFmt.hhmm(new Date(at).getTime()) : ""; } catch (e) { return ""; } };

  return (
    <PageWrap>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 16, borderRadius: "var(--radius-md)", background: "#1E293B", color: "#fff" }}>
        <Icon name="shield-check" size={16} color="#7DD3FC" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Compliance by organization</span>
        <span style={{ fontSize: 12, color: "#94A3B8" }}>Each tenant's audit trail is isolated — open one for the full HIPAA log.</span>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
        <StatTile label="Organizations" value={(rows || []).length} icon="building-2" tint="blue" />
        <StatTile label="Audit events (all orgs)" value={totalAudit} icon="scroll-text" tint="slate" />
        <StatTile label="PHI accesses (all orgs)" value={totalPhi} icon="file-lock-2" tint="emerald" />
        <StatTile label="High-risk (recent)" value={totalRisk} icon="alert-triangle" tint="amber" />
      </div>

      <div style={{ marginBottom: 12, maxWidth: 360 }}>
        <Field icon="search" value={q} onChange={setQ} placeholder="Search organizations…" />
      </div>

      {rows === null && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading compliance…</Card>}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {list.map((o) => (
          <Card key={o.code} style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: o.recent && o.recent.length ? "1px solid var(--border)" : "none" }}>
              <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "#DBEAFE", color: "var(--primary)", fontWeight: 700, fontSize: 12.5, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{(o.code || "").slice(0, 2)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{o.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}><span className="ds-mono">{o.code}</span></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginRight: 6 }}>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{o.auditCount}</div><div style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>audit</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{o.phiCount}</div><div style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>PHI</div></div>
                {o.highRisk > 0 && <Badge status="rejected" icon="alert-triangle">{o.highRisk} high-risk</Badge>}
              </div>
              <Button size="sm" variant="outline" icon="arrow-right" onClick={() => onOpenOrg && onOpenOrg(o.code)}>Open</Button>
            </div>
            {(o.recent || []).slice(0, 4).map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 8px 62px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: r.riskLevel === "high" ? "var(--status-rejected)" : r.riskLevel === "medium" ? "var(--status-pending)" : "var(--status-neutral)", flex: "none" }} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{String(r.action || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</span>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{r.resourceType || ""}</span>
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>{clock(r.createdAt)}</span>
              </div>
            ))}
            {(!o.recent || o.recent.length === 0) && rows !== null && (
              <div style={{ padding: "10px 16px 10px 62px", fontSize: 12.5, color: "var(--muted-foreground)" }}>No recorded activity yet.</div>
            )}
          </Card>
        ))}
        {rows !== null && list.length === 0 && (
          <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No organizations match.</Card>
        )}
      </div>
    </PageWrap>
  );
}

Object.assign(window, { ComplianceOverview });
