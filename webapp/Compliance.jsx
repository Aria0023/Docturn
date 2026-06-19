/* DocTurn web-app UI kit — Audit & Compliance viewer.
   Spec: Req FR-11 (audit trail, PHI access logs, security incidents), NFR-2 (HIPAA).
   Live: the audit and PHI trails are fed by real actions taken across the app
   (accept/send/reassign/login/broadcast/…); incidents can be resolved. */

function ComplianceTabs({ tab, setTab }) {
  const tabs = [
    ["audit", "Audit log", "scroll-text"],
    ["phi", "PHI access", "file-lock-2"],
    ["incidents", "Security incidents", "shield-alert"],
    ["logs", "System logs", "terminal"],
  ];
  return (
    <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)", width: "fit-content", marginBottom: 18 }}>
      {tabs.map(([id, label, icon]) => {
        const on = tab === id;
        return (
          <button key={id} onClick={() => setTab(id)}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
              background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--muted-foreground)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
            <Icon name={icon} size={15} />{label}
          </button>
        );
      })}
    </div>
  );
}

const RISK = {
  low:      { label: "Low",      bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral)" },
  medium:   { label: "Medium",   bg: "var(--status-pending-bg)",  fg: "var(--status-pending)" },
  high:     { label: "High",     bg: "var(--status-rejected-bg)", fg: "var(--status-rejected)" },
  critical: { label: "Critical", bg: "var(--status-rejected)",    fg: "#fff" },
};
function RiskPill({ level }) {
  const r = RISK[level] || RISK.low;
  return <span style={{ padding: "2px 9px", borderRadius: "var(--radius-full)", background: r.bg, color: r.fg, fontSize: 11.5, fontWeight: 700 }}>{r.label}</span>;
}
function clockSec(at) {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
function csvDownload(name, rows) {
  const csv = rows.map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  window.DT.actions.toast({ tone: "accepted", title: "Export started", msg: name + " downloaded." });
}

const LOG_LEVEL = {
  info:  { c: "var(--status-active)",   bg: "var(--status-active-bg)",   ic: "info" },
  warn:  { c: "var(--status-pending)",  bg: "var(--status-pending-bg)",  ic: "alert-triangle" },
  error: { c: "var(--status-rejected)", bg: "var(--status-rejected-bg)", ic: "x-octagon" },
  audit: { c: "var(--status-neutral)",  bg: "var(--status-neutral-bg)",  ic: "shield" },
};
function logLevelFor(r) { return r.risk === "high" ? "error" : r.risk === "medium" ? "warn" : (/login|logout|access|impersonat|audit/.test(r.action) ? "audit" : "info"); }

function Compliance({ audit = [], phiLog = [], incidents = [], onResolve }) {
  const [tab, setTab] = React.useState("audit");
  const openCount = incidents.filter((r) => r.status === "open" || r.status === "investigating").length;
  const deniedCount = phiLog.filter((r) => !r.ok).length;
  const logs = audit.slice(0, 30).map((r) => ({ t: clockSec(r.at), level: logLevelFor(r), org: r.org || "—", msg: r.action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) + " — " + r.resource, risk: r.risk }));

  const headRow = (cols) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", background: "var(--secondary)", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>
      {cols}
    </div>
  );

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
        <StatTile label="Audit events" value={audit.length} icon="scroll-text" tint="blue" />
        <StatTile label="PHI accesses" value={phiLog.length} icon="file-lock-2" tint="emerald" />
        <StatTile label="Open incidents" value={openCount} icon="shield-alert" tint="amber" />
        <StatTile label="Denied access" value={deniedCount} icon="ban" tint="slate" />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <ComplianceTabs tab={tab} setTab={setTab} />
        <Button size="sm" variant="ghost" icon="download" onClick={() => {
          if (tab === "audit") csvDownload("docturn-audit.csv", [["time", "actor", "role", "action", "resource", "ip", "risk"]].concat(audit.map((r) => [clockSec(r.at), r.actor, r.role, r.action, r.resource, r.ip, r.risk])));
          else if (tab === "phi") csvDownload("docturn-phi-access.csv", [["time", "actor", "patient", "access", "fields", "purpose", "result"]].concat(phiLog.map((r) => [clockSec(r.at), r.actor, r.patient, r.access, r.fields, r.purpose, r.ok ? "allowed" : "denied"])));
          else if (tab === "incidents") csvDownload("docturn-incidents.csv", [["type", "severity", "description", "status"]].concat(incidents.map((r) => [r.type, r.sev, r.desc, r.status])));
          else csvDownload("docturn-logs.csv", [["time", "level", "org", "message", "risk"]].concat(logs.map((l) => [l.t, l.level, l.org, l.msg, l.risk])));
        }}>Export</Button>
      </div>

      {tab === "audit" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {headRow(<>
            <span style={{ width: 72, flex: "none" }}>Time</span>
            <span style={{ flex: 1 }}>Actor</span>
            <span style={{ flex: 1.4 }}>Action</span>
            <span style={{ width: 120, flex: "none" }}>IP</span>
            <span style={{ width: 70, flex: "none", textAlign: "right" }}>Risk</span>
          </>)}
          {audit.map((r, i) => (
            <div key={r.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <span className="ds-mono" style={{ fontSize: 12, color: "var(--muted-foreground)", width: 72, flex: "none" }}>{clockSec(r.at)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.actor}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{(r.role || "").replace("_", " ")}</div>
              </div>
              <div style={{ flex: 1.4, minWidth: 0 }}>
                <div className="ds-mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary)" }}>{r.action}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{r.resource}</div>
              </div>
              <span className="ds-mono" style={{ fontSize: 12, color: "var(--muted-foreground)", width: 120, flex: "none" }}>{r.ip}</span>
              <span style={{ width: 70, flex: "none", textAlign: "right" }}><RiskPill level={r.risk} /></span>
            </div>
          ))}
        </Card>
      )}

      {tab === "phi" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {headRow(<>
            <span style={{ width: 72, flex: "none" }}>Time</span>
            <span style={{ flex: 1 }}>Accessor</span>
            <span style={{ width: 54, flex: "none" }}>Pt</span>
            <span style={{ flex: 1.5 }}>Fields / purpose</span>
            <span style={{ width: 80, flex: "none", textAlign: "right" }}>Result</span>
          </>)}
          {phiLog.map((r, i) => (
            <div key={r.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none", background: r.ok ? "transparent" : "var(--status-rejected-bg)" }}>
              <span className="ds-mono" style={{ fontSize: 12, color: "var(--muted-foreground)", width: 72, flex: "none" }}>{clockSec(r.at)}</span>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{r.actor}</span>
              <span style={{ width: 54, flex: "none" }}><Avatar initials={r.patient} size={28} tint="slate" /></span>
              <div style={{ flex: 1.5, minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span style={{ textTransform: "capitalize", fontWeight: 600 }}>{r.access}</span>
                  <span style={{ color: "var(--muted-foreground)" }}> · {r.fields}</span>
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--muted-foreground)" }}>Purpose: {r.purpose}</div>
              </div>
              <span style={{ width: 80, flex: "none", textAlign: "right" }}>
                {r.ok ? <Badge status="accepted">Allowed</Badge> : <Badge status="rejected">Denied</Badge>}
              </span>
            </div>
          ))}
        </Card>
      )}

      {tab === "incidents" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {incidents.map((r, i) => {
            const stat = { open: "rejected", investigating: "pending", resolved: "accepted", false_positive: "offline" }[r.status];
            const canResolve = r.status === "open" || r.status === "investigating";
            return (
              <Card key={r.id || i} style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: RISK[r.sev].bg, color: RISK[r.sev].fg, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Icon name="shield-alert" size={19} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="ds-mono" style={{ fontSize: 13, fontWeight: 700, textTransform: "capitalize", whiteSpace: "nowrap" }}>{r.type.replace(/_/g, " ")}</span>
                    <RiskPill level={r.sev} />
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.4, color: "var(--muted-foreground)", marginTop: 2 }}>{r.desc}</div>
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <Badge status={stat}>{r.status.replace("_", " ")}</Badge>
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{dtFmt.ago(r.at)}</span>
                  {canResolve && <Button size="sm" variant="outline" icon="check" onClick={() => onResolve && onResolve(r.id)}>Resolve</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "logs" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {headRow(<>
            <span style={{ width: 72, flex: "none" }}>Time</span>
            <span style={{ width: 74, flex: "none" }}>Level</span>
            <span style={{ width: 60, flex: "none" }}>Org</span>
            <span style={{ flex: 1 }}>Event</span>
          </>)}
          {logs.map((l, i) => {
            const lv = LOG_LEVEL[l.level] || LOG_LEVEL.info;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                <span className="ds-mono" style={{ fontSize: 12, color: "var(--muted-foreground)", flex: "none", width: 72 }}>{l.t}</span>
                <span style={{ width: 74, flex: "none" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: "var(--radius-full)", background: lv.bg, color: lv.c, fontSize: 11, fontWeight: 700 }}>
                    <Icon name={lv.ic} size={11} />{l.level}
                  </span>
                </span>
                <span className="ds-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", flex: "none", width: 60 }}>{l.org}</span>
                <span className="ds-mono" style={{ flex: 1, fontSize: 12.5, color: "var(--foreground)", minWidth: 0 }}>{l.msg}</span>
              </div>
            );
          })}
          {logs.length === 0 && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No system events yet.</div>}
        </Card>
      )}
    </PageWrap>
  );
}

Object.assign(window, { Compliance });
