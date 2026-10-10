/* DocTurn web-app UI kit — Admissions log.
   Every patient routed to a hospitalist that the SERVER has on record
   (GET /api/admissions), newest first: one row per patient — a re-route is
   the same admission (the row says how many times it was routed). The tiles
   are the server's counts; "Since last reset" follows the org-wide counter
   reset (POST /api/admissions/reset). Clear 24h+ / Clear all delete the
   patients on the server and the log follows. Never demo rows, never rows
   this browser appended (A.CON schedule #7). `info` (the server's counts) is
   absent only in the offline kit, which counts its own demo log. */

// The app's one locale-aware day + clock format (window.dtFmt, A.CON-MIN-18).
function alWhen(at) {
  if (window.dtFmt && window.dtFmt.stamp) return window.dtFmt.stamp(at);
  return new Date(at).toLocaleString();
}

function AdmissionsLog({ admissions, resetAt, info, bare, onPurge }) {
  const log = (admissions || []).slice().sort((a, b) => b.at - a.at);
  const server = info !== undefined; // live: the server's counts
  const ready = !server || !!(info && info.loaded);
  const err = server && info && info.error;
  const total = server ? (ready ? info.total : "—") : log.length;
  const sinceReset = server ? (ready ? info.sinceReset : "—") : log.filter((a) => a.at >= (resetAt || 0)).length;
  const last24h = server ? (ready ? info.last24h : "—") : log.filter((a) => a.at >= Date.now() - 86400000).length;
  const resetNote = server && ready ? (info.resetAt ? "since " + alWhen(info.resetAt) : "never reset") : "";
  const capped = server && ready && info.total > log.length;

  const statusTint = (s) => s === "accepted" ? "accepted" : (s === "rejected" || s === "declined") ? "rejected" : "pending";

  const Wrap = bare ? React.Fragment : PageWrap;
  return (
    <Wrap>
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Card style={{ padding: "14px 18px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>Total logged</div>
          <div data-adm-tile="total" style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{total}</div>
        </Card>
        <Card style={{ padding: "14px 18px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>Last 24 hours</div>
          <div data-adm-tile="last24h" style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{last24h}</div>
        </Card>
        <Card style={{ padding: "14px 18px", flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>Since last reset</div>
          <div data-adm-tile="sinceReset" style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{sinceReset}</div>
          {resetNote && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{resetNote}</div>}
        </Card>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {/* The header wraps: on a phone the Clear buttons drop to their own
            line (still right-aligned) instead of being drawn past the Card's
            overflow:hidden edge ("Clea" at 375px, A.CON-SHO-49). */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 8, rowGap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="scroll-text" size={17} color="var(--primary)" />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Admissions log</h3>
          <Badge variant="secondary">{total}</Badge>
          {onPurge ? (
            <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
              <Button size="sm" variant="outline" icon="clock" onClick={() => onPurge(24)}>Clear 24h+</Button>
              <Button size="sm" variant="outline" icon="trash-2" onClick={() => { if (window.confirm("Delete ALL patients and admission history? This can't be undone.")) onPurge(0); }}>Clear all</Button>
            </span>
          ) : (
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>Newest first · every patient on record</span>
          )}
        </div>
        {capped && <div data-adm-capped style={{ padding: "8px 18px", fontSize: 12, color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>Showing the newest {log.length} of {info.total} admissions on record.</div>}

        {err === "module_disabled" ? (
          <div data-adm-empty style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Admission routing is switched off for this organization.</div>
        ) : !ready ? (
          <div data-adm-empty style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>{err ? "Couldn't load the admissions log from the server." : "Loading the admissions log…"}</div>
        ) : log.length === 0 ? (
          <div data-adm-empty style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No admissions on record.</div>
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
                  <tr key={a.id || i} data-adm-row={a.initials} style={{ borderBottom: i < log.length - 1 ? "1px solid var(--border)" : "none" }}>
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
                    <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}><Badge status={statusTint(a.status)}>{a.status || "sent"}</Badge>{a.routings > 1 ? <span style={{ fontSize: 12, color: "var(--muted-foreground)", marginLeft: 6 }}>routed {a.routings}×</span> : null}</td>
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
