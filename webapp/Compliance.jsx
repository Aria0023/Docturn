/* DocTurn web-app UI kit — Audit trail viewer.
   Spec: Req FR-11 (audit trail, PHI access logs), NFR-2 (HIPAA).
   Everything here is the SERVER's (A.CON comms-account #3-#9):
     - directors / ER directors see the organization's trail (GET /api/audit),
       every other role their OWN (GET /api/audit/mine);
     - the tiles are each trail's true size, the tables its newest page;
     - each row names its actor, username and role as the server resolved
       them, and the developer who acted through an impersonated session;
     - Export downloads the server's CSV of the WHOLE trail
       (GET /api/audit/export), with full UTC timestamps.
   The server records no security-incident feed, no separate system log and
   no PHI-access outcome or purpose, so none of those are shown. Nothing on
   this screen can clear or change a trail (HIPAA §164.316 retention). */

function ComplianceTabs({ tab, setTab }) {
  const tabs = [
    ["audit", "Audit log", "scroll-text"],
    ["phi", "PHI access", "file-lock-2"],
  ];
  return (
    <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)", maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      {tabs.map(([id, label, icon]) => {
        const on = tab === id;
        return (
          <button key={id} onClick={() => setTab(id)} data-compliance-tab={id} aria-pressed={on}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", flex: "none",
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
  return <span style={{ padding: "2px 9px", borderRadius: "var(--radius-full)", background: r.bg, color: r.fg, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>{r.label}</span>;
}
// Day + time with seconds, in the app's one locale-aware clock (A.CON-MIN-18):
// an audit row without its date is not a record.
function auditStamp(at) {
  const f = window.dtFmt;
  if (f && f.dayLabel && f.hhmmss) return f.dayLabel(at) + " · " + f.hhmmss(at);
  return new Date(at).toLocaleString();
}
const roleLabel = (r) => (r ? String(r).replace(/_/g, " ") : "");
const nf = (n) => (typeof n === "number" ? n.toLocaleString() : "—");

function Compliance({ audit = [], phiLog = [], auditCount = null, phiCount = null, scope = "org", error = null, onLoad, onExport }) {
  const [tab, setTab] = React.useState("audit");
  const [exporting, setExporting] = React.useState(false);
  // Phones get stacked rows: the desktop columns are too wide for 375px.
  const mobile = useIsMobile();
  const mine = scope === "mine";
  // Read the trail when the screen opens (a clinician's is only read here).
  React.useEffect(() => { if (onLoad) onLoad(); }, []);

  const rows = tab === "audit" ? audit : phiLog;
  const total = tab === "audit" ? auditCount : phiCount;
  const exportNow = () => {
    if (!onExport || exporting) return;
    setExporting(true);
    Promise.resolve(onExport(tab, mine ? "mine" : "org")).finally(() => setExporting(false));
  };

  const headRow = (cols) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", background: "var(--secondary)", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>
      {cols}
    </div>
  );
  const empty = (txt) => <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>{txt}</div>;
  const operatorNote = (r) => r.operator ? <span style={{ color: "var(--status-pending)", fontWeight: 600 }}>via {r.operator}</span> : null;

  return (
    <PageWrap>
      {!mine && <SettingsTabs />}
      {mine && (
        <div data-trail-scope="mine" style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 14, lineHeight: 1.45 }}>
          Your own trail: the actions you took and the patient records you opened, as the server recorded them. Your organization's directors can see the full trail.
        </div>
      )}
      <div data-keep-cols="2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: 22 }}>
        <StatTile label={mine ? "Your audit events" : "Audit events"} value={nf(auditCount)} icon="scroll-text" tint="blue" />
        <StatTile label={mine ? "Your PHI accesses" : "PHI accesses"} value={nf(phiCount)} icon="file-lock-2" tint="emerald" />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: 12, rowGap: 10, marginBottom: 10 }}>
        <ComplianceTabs tab={tab} setTab={setTab} />
        <span data-compliance-export style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flex: "none" }}>
          <Button size="sm" variant="ghost" icon="download" onClick={exportNow} style={{ opacity: exporting ? 0.6 : 1 }}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </span>
      </div>
      <div data-trail-window style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 12 }}>
        {error ? (error === "offline" ? "Couldn't reach the server — the trail could not be loaded." : "The server didn't return the trail.")
          : total == null ? "Loading the trail from the server…"
          : total === 0 ? "Nothing recorded yet."
          : "Showing the newest " + rows.length.toLocaleString() + " of " + total.toLocaleString() + ". Export downloads every row (times in UTC)."}
      </div>

      {tab === "audit" && (
        <div data-trail-table="audit"><Card style={{ padding: 0, overflow: "hidden" }}>
          {mobile ? headRow(<>
            <span style={{ flex: 1, minWidth: 0 }}>Event</span>
            <span style={{ flex: "none", textAlign: "right" }}>Risk</span>
          </>) : headRow(<>
            <span style={{ width: 150, flex: "none" }}>When</span>
            <span style={{ flex: 1 }}>Actor</span>
            <span style={{ flex: 1.4 }}>Action</span>
            <span style={{ width: 70, flex: "none", textAlign: "right" }}>Risk</span>
          </>)}
          {audit.map((r, i) => mobile ? (
            <div key={r.id || i} data-audit-row style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{r.actor}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", flexWrap: "wrap", columnGap: 6 }}>
                  {r.role && <span style={{ textTransform: "capitalize" }}>{roleLabel(r.role)}</span>}
                  <span className="ds-mono">{auditStamp(r.at)}</span>
                  {operatorNote(r)}
                </div>
                <div className="ds-mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary)", marginTop: 4, overflowWrap: "anywhere" }}>{r.action}</div>
                {r.resource && <div style={{ fontSize: 12, color: "var(--muted-foreground)", overflowWrap: "anywhere" }}>{r.resource}</div>}
              </div>
              <span style={{ flex: "none", textAlign: "right" }}><RiskPill level={r.risk} /></span>
            </div>
          ) : (
            <div key={r.id || i} data-audit-row style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <span className="ds-mono" style={{ fontSize: 12, color: "var(--muted-foreground)", width: 150, flex: "none" }}>{auditStamp(r.at)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{r.actor}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{roleLabel(r.role)}{r.username ? <span style={{ textTransform: "none" }}> · @{r.username}</span> : null}</div>
                {r.operator && <div style={{ fontSize: 11.5 }}>{operatorNote(r)}</div>}
              </div>
              <div style={{ flex: 1.4, minWidth: 0 }}>
                <div className="ds-mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary)", overflowWrap: "anywhere" }}>{r.action}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", overflowWrap: "anywhere" }}>{r.resource}</div>
              </div>
              <span style={{ width: 70, flex: "none", textAlign: "right" }}><RiskPill level={r.risk} /></span>
            </div>
          ))}
          {audit.length === 0 && empty(error ? "The trail could not be loaded." : auditCount == null ? "Loading…" : "No audit events recorded.")}
        </Card></div>
      )}

      {tab === "phi" && (
        <div data-trail-table="phi"><Card style={{ padding: 0, overflow: "hidden" }}>
          {mobile ? headRow(<span style={{ flex: 1, minWidth: 0 }}>Access</span>) : headRow(<>
            <span style={{ width: 150, flex: "none" }}>When</span>
            <span style={{ flex: 1 }}>Accessor</span>
            <span style={{ flex: 1.5 }}>Record read</span>
            <span style={{ width: 120, flex: "none" }}>IP</span>
          </>)}
          {phiLog.map((r, i) => mobile ? (
            <div key={r.id || i} data-phi-row style={{ display: "flex", padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{r.actor}</div>
              <div style={{ fontSize: 13, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                <span className="ds-mono" style={{ fontWeight: 600 }}>{r.access}</span>
                <span style={{ color: "var(--muted-foreground)" }}> · {r.resource}{r.patientId != null ? " · patient #" + r.patientId : ""}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", flexWrap: "wrap", columnGap: 6 }}>
                {r.role && <span style={{ textTransform: "capitalize" }}>{roleLabel(r.role)}</span>}
                <span className="ds-mono">{auditStamp(r.at)}</span>
                {r.ip && <span className="ds-mono" style={{ overflowWrap: "anywhere", minWidth: 0 }}>{r.ip}</span>}
                {operatorNote(r)}
              </div>
              </div>
            </div>
          ) : (
            <div key={r.id || i} data-phi-row style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <span className="ds-mono" style={{ fontSize: 12, color: "var(--muted-foreground)", width: 150, flex: "none" }}>{auditStamp(r.at)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{r.actor}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{roleLabel(r.role)}</div>
                {r.operator && <div style={{ fontSize: 11.5 }}>{operatorNote(r)}</div>}
              </div>
              <div style={{ flex: 1.5, minWidth: 0, fontSize: 13, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                <span className="ds-mono" style={{ fontWeight: 600 }}>{r.access}</span>
                <span style={{ color: "var(--muted-foreground)" }}> · {r.resource}{r.patientId != null ? " · patient #" + r.patientId : ""}</span>
              </div>
              <span className="ds-mono" style={{ fontSize: 12, color: "var(--muted-foreground)", width: 120, flex: "none", overflowWrap: "anywhere" }}>{r.ip || "—"}</span>
            </div>
          ))}
          {phiLog.length === 0 && empty(error ? "The trail could not be loaded." : phiCount == null ? "Loading…" : "No PHI access recorded.")}
        </Card></div>
      )}
    </PageWrap>
  );
}

Object.assign(window, { Compliance });
