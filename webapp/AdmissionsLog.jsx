/* DocTurn web-app UI kit — Admissions log.
   The full, append-only record of every patient routed to a team. The main
   dashboard shows a rolling count since the director's last reset; this screen
   always shows the complete history (newest first). */

function alWhen(at) {
  const d = new Date(at);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const y = new Date(today.getTime() - 86400000);
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  if (d.getTime() >= today.getTime()) return "Today · " + hm;
  if (d.getTime() >= y.getTime()) return "Yesterday · " + hm;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + hm;
}

function AdmissionsLog({ admissions, resetAt, bare, onPurge }) {
  const log = (admissions || []).slice().sort((a, b) => b.at - a.at);
  const sinceReset = log.filter((a) => a.at >= (resetAt || 0)).length;
  const last24h = log.filter((a) => a.at >= Date.now() - 86400000).length;

  const statusTint = (s) => s === "accepted" ? "accepted" : (s === "rejected" || s === "declined") ? "rejected" : "pending";

  const Wrap = bare ? React.Fragment : PageWrap;
  return (
    <Wrap>
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Card style={{ padding: "14px 18px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>Total logged</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{log.length}</div>
        </Card>
        <Card style={{ padding: "14px 18px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>Last 24 hours</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{last24h}</div>
        </Card>
        <Card style={{ padding: "14px 18px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>Since last reset</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{sinceReset}</div>
        </Card>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="scroll-text" size={17} color="var(--primary)" />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Admissions log</h3>
          <Badge variant="secondary">{log.length}</Badge>
          {onPurge ? (
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Button size="sm" variant="outline" icon="clock" onClick={() => onPurge(24)}>Clear 24h+</Button>
              <Button size="sm" variant="outline" icon="trash-2" onClick={() => { if (window.confirm("Delete ALL patients and admission history? This can't be undone.")) onPurge(0); }}>Clear all</Button>
            </span>
          ) : (
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>Newest first · full history</span>
          )}
        </div>

        {log.length === 0 ? (
          <div style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No admissions logged yet.</div>
        ) : (
          <div style={{ maxHeight: "62vh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "#fff" }}>
                  {["When", "Patient", "Room", "Assigned to", "Specialty", "Route", "Status"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "9px 16px", fontSize: 11, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.map((a, i) => (
                  <tr key={a.id || i} style={{ borderBottom: i < log.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <td style={{ padding: "10px 16px", whiteSpace: "nowrap", color: "var(--muted-foreground)" }}>{alWhen(a.at)}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                        <Avatar initials={a.initials} size={26} tint="slate" />
                        <b style={{ fontWeight: 600 }}>{a.initials}</b>
                      </span>
                    </td>
                    <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>{a.room || "—"}</td>
                    <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>{a.provider}</td>
                    <td style={{ padding: "10px 16px", whiteSpace: "nowrap", color: "var(--muted-foreground)" }}>{a.specialty || "—"}</td>
                    <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: a.via === "Manual" ? "var(--status-pending)" : "var(--primary)" }}>{a.via || "—"}</span>
                    </td>
                    <td style={{ padding: "10px 16px" }}><Badge status={statusTint(a.status)}>{a.status || "sent"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Wrap>
  );
}

Object.assign(window, { AdmissionsLog });
