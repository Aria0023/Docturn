/* DocTurn web-app UI kit — Hospitalist assignment history (rolling 3+ days).
   Everything you've accepted, grouped by day. The dashboard only shows the
   current shift; this keeps the trailing history. */

function hhDayLabel(at) {
  const d = new Date(at); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
function hhTime(at) { return (window.dtFmt && window.dtFmt.hhmm) ? window.dtFmt.hhmm(at) : new Date(at).toTimeString().slice(0, 5); }

function HospitalistHistory({ admissions = [], days = 3 }) {
  const cutoff = Date.now() - days * 86400000;
  const log = (admissions || []).filter((a) => a.at >= cutoff).sort((a, b) => b.at - a.at);

  // group by day label, preserving order
  const groups = [];
  const byLabel = {};
  log.forEach((a) => {
    const label = hhDayLabel(a.at);
    if (!byLabel[label]) { byLabel[label] = []; groups.push({ label, items: byLabel[label] }); }
    byLabel[label].push(a);
  });

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Card style={{ padding: "14px 18px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>Accepted (last {days} days)</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{log.length}</div>
        </Card>
        <Card style={{ padding: "14px 18px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>Days shown</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{groups.length}</div>
        </Card>
      </div>

      {log.length === 0 ? (
        <Card style={{ padding: 36, textAlign: "center" }}>
          <Icon name="history" size={26} color="var(--muted-foreground)" />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No history yet</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>Accepted assignments from the last {days} days will appear here.</div>
        </Card>
      ) : (
        groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 8px" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{g.label}</span>
              <Badge variant="secondary">{g.items.length}</Badge>
            </div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {g.items.map((p, i) => (
                <div key={p.id || i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <Avatar initials={p.initials} size={32} tint="slate" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>Patient {p.initials} · Room {p.room || "—"}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{p.complaint}</div>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{hhTime(p.at)}</span>
                </div>
              ))}
            </Card>
          </div>
        ))
      )}
    </PageWrap>
  );
}

Object.assign(window, { HospitalistHistory });
