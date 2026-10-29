/* DocTurn web-app UI kit — On-call schedule sync (Settings).

   Everything here is the SERVER's state; nothing is "connected" in the browser:
     • Amion   — the hospital's OCS feed, saved encrypted under Integrations →
                 Amion (or the operator's AMION_OCS_URL for one org). Status,
                 the last pulled grid and "Sync now" are /api/amion/*.
     • Epic    — the hospital's Epic backend app (Integrations → Epic);
                 status + "Sync now" are /api/oncall/sources + epic/sync-now.
     • Manual  — the director-maintained list on the On-call board.
   The source the on-call board reads is the server's choice
   (PATCH /api/oncall/source) and the picker offers ONLY those three. Vendors
   DocTurn has no connector for (QGenda, Tangier / Spok, ShiftAdmin, Word / PDF
   documents, web pages) are named as information, never as a selectable
   "source": picking one used to change only this browser's label and the
   dashboard badge, and "Not configured" claimed the org had no source while
   the board read the manual list (A.CON schedule #2/#3).
   Credentials are never typed or pre-filled here. Director surface; an ER
   director sees it read-only (the server refuses their writes). */

// Amion hours → the shift label shown for the pulled grid (the server maps the
// same tokens to day / swing / night on each provider: services/amion.ts).
const SS_HRS = { "7a-7p": ["Day call", "amber"], "2p-10p": ["Swing", "blue"], "4p-12a": ["Swing", "blue"], "7p-7a": ["Nights", "slate"], "11p-7a": ["Night X-cover", "slate"] };
// "Last, First" → "First Last"; initials from both.
function ssName(prov) { const [last, first] = String(prov).split(", "); return ((first || "") + " " + last).trim(); }
function ssInit(prov) { const [last, first] = String(prov).split(", "); return ((first || " ")[0] + (last || " ")[0]).toUpperCase(); }

// Amion hours → DocTurn shift type (same table as server/services/amion.ts).
const SS_SHIFT = { "7a-7p": "day", "2p-10p": "swing", "4p-12a": "swing", "7p-7a": "night", "11p-7a": "night" };

// Relative "synced X ago" label.
function ssAgo(iso) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}

// The schedule sources the SERVER has (services/schedule-sources: amion / epic /
// manual) — the only values PATCH /api/oncall/source accepts.
const SS_SOURCES = {
  amion:  { label: "Amion",       module: "amion", blurb: "amion.com on-call grid (OCS feed)" },
  epic:   { label: "Epic (FHIR)", module: "epic",  blurb: "PractitionerRole + Schedule/Slot via FHIR R4" },
  manual: { label: "Manual list", module: null,    blurb: "Director-maintained on-call slots in DocTurn" },
};
const SS_SOURCE_KEYS = ["amion", "epic", "manual"];
// Named for information only: DocTurn has no connector for these.
const SS_NO_CONNECTOR = "QGenda, Tangier / Spok, ShiftAdmin, Word or PDF documents and web pages";

function ShiftChip({ shift, tint }) {
  const c = { amber: ["var(--status-pending-bg)", "var(--status-pending)"], blue: ["var(--status-active-bg)", "var(--status-active)"], slate: ["var(--status-neutral-bg)", "var(--status-neutral)"] }[tint] || ["var(--secondary)", "var(--muted-foreground)"];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: "var(--radius-full)", background: c[0], color: c[1], whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: 99, background: c[1], flex: "none" }} />{shift}</span>;
}

function ssGoToIntegrations() {
  try { const el = document.getElementById("integrations"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
}

function SSInfo({ icon, children, tone, dataAttr }) {
  const warn = tone === "warn";
  const props = dataAttr ? { [dataAttr]: "" } : {};
  return (
    <div {...props} style={{ display: "flex", gap: 9, alignItems: "flex-start", flexWrap: "wrap", marginTop: 14, background: warn ? "#FEF3C7" : "var(--secondary)", border: "1px solid " + (warn ? "#FCD34D" : "var(--border)"), borderRadius: "var(--radius-md)", padding: "11px 13px", fontSize: 12.5, color: warn ? "#92400E" : "var(--muted-foreground)", lineHeight: 1.5 }}>
      <Icon name={icon} size={15} style={{ marginTop: 1, flex: "none" }} />
      {children}
    </div>
  );
}

function ScheduleSync({ org }) {
  const a = useActions();
  const st = useStore();
  const role = st.session && st.session.role;
  // The server's rule for PATCH /api/oncall/source, POST /api/amion/sync-now
  // and POST /api/oncall/epic/sync-now.
  const canEdit = role === "director" || role === "developer";
  const orgCode = (org && org.code) || (st.session && st.session.org) || "";
  const orgLabel = (org && org.name) || orgCode;
  const [busy, setBusy] = React.useState(false);

  // Live Amion feed status + the last pulled grid (/api/amion/status).
  const [amion, setAmion] = React.useState(null);
  const loadAmion = () => { if (!a.amionStatus) return; Promise.resolve(a.amionStatus()).then((s) => { if (s) setAmion(s); }).catch(() => {}); };
  React.useEffect(loadAmion, []);
  // Board sources (amion / epic / manual): status + which one the board reads.
  const [boardSources, setBoardSources] = React.useState(null);
  const loadBoardSources = () => { if (!a.loadOnCallSources) return; Promise.resolve(a.loadOnCallSources()).then((r) => { if (r) setBoardSources(r); }).catch(() => {}); };
  React.useEffect(loadBoardSources, []);

  // The source shown is ALWAYS the server's (GET /api/oncall/sources); null
  // until it answers — never a per-browser guess.
  const serverKey = boardSources && SS_SOURCES[boardSources.selected] ? boardSources.selected : null;
  const srcKey = serverKey;
  const src = srcKey ? SS_SOURCES[srcKey] : null;
  const modulesOn = (boardSources && boardSources.modules) || {};
  const overridden = boardSources && boardSources.overridden;

  const [picking, setPicking] = React.useState(false);
  const pickSource = (key) => {
    if (!canEdit || !SS_SOURCES[key] || key === serverKey || !a.setOnCallSource) return;
    // The board's source is the server's: change it there, then show what it says.
    setPicking(true);
    Promise.resolve(a.setOnCallSource(key))
      .then(() => loadBoardSources(), () => loadBoardSources())
      .finally(() => setPicking(false));
  };

  const epicStatus = boardSources && boardSources.sources && boardSources.sources.epic;
  const epicModuleOn = !boardSources || !boardSources.modules || boardSources.modules.epic !== false;
  const [epicBusy, setEpicBusy] = React.useState(false);
  const epicSync = () => { if (!a.epicSyncNow || epicBusy) return; setEpicBusy(true); Promise.resolve(a.epicSyncNow()).then(loadBoardSources).finally(() => setEpicBusy(false)); };

  const amionConnected = !!(amion && amion.configured);
  const epicConnected = !!(epicStatus && epicStatus.configured);
  // "Connected" only ever comes from the server, for the source shown.
  const connected = (srcKey === "amion" && amionConnected) || (srcKey === "epic" && epicConnected);
  const connLabel = srcKey === "epic" ? "FHIR" : "Feed";

  // The last pulled grid (server-parsed). Nothing is shown that the server did not pull.
  const rows = React.useMemo(() => {
    if (!amionConnected || !Array.isArray(amion.providers)) return [];
    return amion.providers.map((p) => ({ slot: p.slot, hrs: p.hrs, prov: p.name, grp: p.group, secure: !!p.secure }));
  }, [amion]);
  const liveOk = amionConnected && amion.lastStatus === "ok" && rows.length > 0;
  const liveErr = amionConnected && amion.lastStatus === "error";
  const neverPulled = amionConnected && !amion.lastSyncAt;
  const people = React.useMemo(() => {
    const byName = new Map();
    rows.forEach((r) => {
      const name = ssName(r.prov);
      if (!byName.has(name)) byName.set(name, { name, raw: r.prov, group: r.grp, secure: r.secure, shift: SS_SHIFT[r.hrs] || "day", slots: [r.slot] });
      else byName.get(name).slots.push(r.slot);
    });
    return [...byName.values()];
  }, [rows]);
  const shiftTypes = React.useMemo(() => {
    const seen = new Map();
    rows.forEach((r) => { if (!seen.has(r.hrs)) seen.set(r.hrs, { code: r.hrs, name: (SS_HRS[r.hrs] || [r.hrs])[0], shift: SS_SHIFT[r.hrs] || "day" }); });
    return [...seen.values()];
  }, [rows]);

  const amionSync = () => {
    if (!a.amionSyncNow || busy) return;
    setBusy(true);
    Promise.resolve(a.amionSyncNow())
      .then((s) => { if (s) setAmion(s); })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <Card style={{ padding: 18, marginBottom: 18, minWidth: 0 }}>
      <div data-schedule-sync={srcKey} style={{ minWidth: 0 }}>
      {/* Feed banner — only for a real Amion connection. */}
      {srcKey === "amion" && liveOk && (
        <div data-amion-banner="ok" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 14, borderRadius: "var(--radius-md)", background: "#D1FAE5", border: "1px solid #6EE7B7", flexWrap: "wrap" }}>
          <Icon name="circle-check-big" size={15} color="#065F46" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#065F46" }}>Live Amion feed · synced {ssAgo(amion.lastSyncAt)} · {amion.rowCount} slots</span>
        </div>
      )}
      {srcKey === "amion" && liveErr && (
        <div data-amion-banner="error" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 14, borderRadius: "var(--radius-md)", background: "#FEF3C7", border: "1px solid #FCD34D", flexWrap: "wrap" }}>
          <Icon name="triangle-alert" size={15} color="#92400E" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#92400E" }}>The last Amion pull failed ({ssAgo(amion.lastSyncAt)}){amion.lastError ? ": " + amion.lastError : ""}{rows.length ? " — showing the last good pull." : "."}</span>
        </div>
      )}
      {srcKey === "amion" && amionConnected && neverPulled && (
        <div data-amion-banner="pending" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 14, borderRadius: "var(--radius-md)", background: "var(--secondary)", border: "1px solid var(--border)", flexWrap: "wrap" }}>
          <Icon name="clock" size={15} color="var(--muted-foreground)" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted-foreground)" }}>Amion is connected; the first pull hasn't run yet{canEdit ? " — press Sync now, or wait for the scheduled pull." : "."}</span>
        </div>
      )}

      {/* header — wraps on phones: the Source picker and Sync now drop below the title. */}
      <div data-ss-header style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 4, flexWrap: "wrap", minWidth: 0 }}>
        <span style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", background: "#DBEAFE", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="calendar-clock" size={19} color="var(--primary)" /></span>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>On-call schedule sync</h3>
            {src && <Badge variant="secondary">{src.label}</Badge>}
            {connected && <span data-ss-connected style={{ whiteSpace: "nowrap" }}><Badge status="accepted" icon="circle">Connected · {connLabel}</Badge></span>}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "2px 0 0" }}>
            Where <b style={{ color: "var(--foreground)", fontWeight: 600 }}>{orgLabel}</b>'s on-call schedule comes from.
            {serverKey ? <React.Fragment> The on-call board reads <b data-ss-board-source={serverKey} style={{ color: "var(--foreground)", fontWeight: 600 }}>{SS_SOURCES[serverKey].label}</b>.</React.Fragment> : null}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 1 auto", minWidth: 0, flexWrap: "wrap", marginLeft: "auto" }}>
          <label htmlFor="ss-source" style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>Source</label>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", minWidth: 0 }}>
            <select id="ss-source" value={srcKey || ""} onChange={(e) => pickSource(e.target.value)} disabled={!canEdit || picking || !srcKey}
              style={{ appearance: "none", WebkitAppearance: "none", minHeight: 44, maxWidth: "100%", padding: "0 26px 0 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: 16, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-sans)", cursor: canEdit ? "pointer" : "not-allowed", opacity: canEdit ? 1 : 0.6 }}>
              {!srcKey && <option value="">Loading…</option>}
              {SS_SOURCE_KEYS.map((k) => {
                const off = SS_SOURCES[k].module && modulesOn[SS_SOURCES[k].module] === false;
                return <option key={k} value={k} disabled={off}>{SS_SOURCES[k].label}{off ? " — switched off" : ""}</option>;
              })}
            </select>
            <Icon name="chevron-down" size={12} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
          </div>
          {srcKey === "amion" && amionConnected && canEdit && (
            <Button size="sm" variant="outline" icon="rotate-ccw" onClick={amionSync} disabled={busy}>{busy ? "Syncing…" : "Sync now"}</Button>
          )}
        </div>
      </div>
      {!canEdit && <div data-readonly-note style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 6, fontWeight: 600 }}>Only a director can change the source or run a sync.</div>}

      {!srcKey && (
        <div data-ss-loading style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 12 }}>Loading the schedule source from the server…</div>
      )}

      {overridden && SS_SOURCES[overridden.source] && (
        <SSInfo icon="triangle-alert" tone="warn">
          <span style={{ flex: "1 1 220px", minWidth: 0 }}>{SS_SOURCES[overridden.source].label} is chosen but switched off for this organization, so the on-call board reads the Manual list until it is switched back on.</span>
        </SSInfo>
      )}

      {/* Epic (FHIR R4, SMART Backend Services) — the hospital's own app. */}
      {srcKey === "epic" && (
        !epicModuleOn ? (
          <SSInfo icon="triangle-alert" tone="warn">
            <span style={{ flex: "1 1 220px", minWidth: 0 }}>Epic on-call is switched off for this organization. A director switches it on under <b>Integrations → Epic on-call (FHIR)</b> once it is set up.</span>
          </SSInfo>
        ) : epicConnected ? (
          <div data-ss-epic="connected" style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 14, background: epicStatus.lastStatus === "error" ? "#FEF3C7" : "#D1FAE5", border: "1px solid " + (epicStatus.lastStatus === "error" ? "#FCD34D" : "#6EE7B7"), borderRadius: "var(--radius-md)", padding: "9px 13px", fontSize: 12.5, color: epicStatus.lastStatus === "error" ? "#92400E" : "#065F46", flexWrap: "wrap" }}>
            <Icon name={epicStatus.lastStatus === "error" ? "triangle-alert" : "circle-check-big"} size={15} />
            <span style={{ fontWeight: 600, minWidth: 0 }}>Epic FHIR connected · {epicStatus.lastStatus === "error" ? "last sync failed" : epicStatus.lastSyncAt ? "synced " + ssAgo(epicStatus.lastSyncAt) : "not synced yet"} · {epicStatus.rowCount} on-call rows</span>
            {epicStatus.error && <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, overflowWrap: "anywhere" }}>{epicStatus.error}</span>}
            {canEdit && <span style={{ marginLeft: "auto" }}><Button size="sm" variant="outline" icon="rotate-ccw" onClick={epicSync} disabled={epicBusy}>{epicBusy ? "Syncing…" : "Sync now"}</Button></span>}
          </div>
        ) : (
          <SSInfo icon="info">
            <span style={{ flex: "1 1 220px", minWidth: 0 }}>
              <b style={{ color: "var(--foreground)" }}>Epic isn't connected for {orgLabel}.</b> DocTurn reads on-call from Epic over FHIR R4 (PractitionerRole, Practitioner, Schedule/Slot) with a backend app your Epic team registers for DocTurn: its client ID, RS384 private key and your FHIR base URL. Enter them under <b style={{ color: "var(--foreground)" }}>Integrations → Epic on-call (FHIR) → Set up</b> (stored encrypted), then switch it on. Nothing is shown until they work.
              {epicStatus && epicStatus.message ? <span style={{ display: "block", marginTop: 6, fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>{epicStatus.message}</span> : null}
            </span>
          </SSInfo>
        )
      )}

      {srcKey === "manual" && (
        <SSInfo icon="pencil">
          <span style={{ flex: "1 1 220px", minWidth: 0 }}>On-call slots are maintained by hand on the <b style={{ color: "var(--foreground)" }}>On call</b> board. <button onClick={() => a.setNav && a.setNav("oncall")} style={{ border: "none", background: "transparent", color: "var(--primary)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12.5, padding: 0, minHeight: 44 }}>Open the board →</button></span>
        </SSInfo>
      )}

      {/* Amion is a REAL connection: the hospital's OCS feed, saved encrypted
          under Integrations → Amion → Set up. No browser-side "connect". */}
      {srcKey === "amion" && amion && !amionConnected && (
        <SSInfo icon="plug-zap" dataAttr="data-amion-connect">
          <span style={{ flex: "1 1 220px", minWidth: 0 }}>
            <b style={{ color: "var(--foreground)" }}>Amion isn't connected for {orgLabel}.</b> Add your schedule's OCS feed link under <b style={{ color: "var(--foreground)" }}>Integrations → Amion → Set up</b> (below). It is stored encrypted on the server; DocTurn then pulls the grid automatically and this panel shows it.
          </span>
          <button type="button" onClick={ssGoToIntegrations}
            style={{ minHeight: 44, padding: "0 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", color: "var(--primary)", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Go to Integrations</button>
        </SSInfo>
      )}

      {/* The last grid the server pulled from this org's Amion feed. */}
      {srcKey === "amion" && amionConnected && rows.length > 0 && (
        <div data-amion-grid style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 16, alignItems: "start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
              <Icon name="calendar-clock" size={13} color="var(--muted-foreground)" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Last pull · {ssAgo(amion.lastSyncAt)}</span>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#fff" }}>
              <div style={{ maxHeight: 300, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
                  <thead><tr>
                    <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--muted-foreground)", fontWeight: 600, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "#fff" }}>Assignment</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted-foreground)", fontWeight: 600, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "#fff" }}>Provider</th>
                    <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--muted-foreground)", fontWeight: 600, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "#fff" }} title="Secure-message ready in Amion">Sec</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ padding: "5px 10px", borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none", whiteSpace: "nowrap" }}>{r.slot}<span style={{ color: "var(--muted-foreground)", marginLeft: 5 }}>{r.hrs}</span></td>
                        <td style={{ padding: "5px 8px", borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none", whiteSpace: "nowrap" }}>{r.prov}</td>
                        <td style={{ padding: "5px 8px", borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none", textAlign: "center" }}>
                          <Icon name={r.secure ? "check" : "x"} size={12} color={r.secure ? "var(--status-accepted)" : "var(--status-rejected)"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ marginTop: 11 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 7 }}>Hours in this pull</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {shiftTypes.map((t) => (
                  <div key={t.code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                    <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, background: "var(--secondary)", padding: "1px 6px", borderRadius: 5, minWidth: 46, textAlign: "center" }}>{t.code}</code>
                    <Icon name="arrow-right" size={12} color="var(--muted-foreground)" />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</span>
                    <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>({t.shift} shift)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7, flexWrap: "wrap" }}>
              <Icon name="users-round" size={14} color="var(--status-accepted)" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>People on this pull</span>
              <Badge status="accepted">{people.length} people</Badge>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", maxHeight: 360, overflowY: "auto" }}>
              {people.map((p, i) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 13px", borderTop: i ? "1px solid var(--border)" : "none", minWidth: 0 }}>
                  <Avatar initials={ssInit(p.raw)} size={30} tint="slate" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.group} · {p.slots.length} slot{p.slots.length > 1 ? "s" : ""}</div>
                  </div>
                  <ShiftChip shift={p.shift === "day" ? "Day" : p.shift === "swing" ? "Swing" : "Night"} tint={p.shift === "day" ? "amber" : p.shift === "swing" ? "blue" : "slate"} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 9, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
              <Icon name="info" size={13} style={{ marginTop: 1, flex: "none" }} />
              <span>Each sync marks everyone on the grid as working with their shift, and creates a hospitalist account for anyone new — locked until a director issues a one-time password (People → Reset password). Nobody is removed. The server pulls on its own schedule (every 4 hours unless the operator changed it).</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 11, fontSize: 12, color: "var(--muted-foreground)", flexWrap: "wrap" }}>
              <Icon name="shield-check" size={13} color="var(--status-accepted)" />Read-only · the feed link is stored encrypted and never shown · every sync is in the audit trail.
              {canEdit && <button type="button" onClick={ssGoToIntegrations} style={{ border: "none", background: "transparent", color: "var(--primary)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, padding: 0, minHeight: 44 }}>Change or remove it under Integrations →</button>}
            </div>
          </div>
        </div>
      )}

      {/* Information, not a choice: vendors DocTurn cannot read. */}
      <div data-ss-no-connector style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 14, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
        <Icon name="info" size={13} style={{ marginTop: 2, flex: "none" }} />
        <span>DocTurn imports on-call schedules from Amion and Epic only. There is no connector for {SS_NO_CONNECTOR} — keep those schedules on the Manual list.</span>
      </div>
      </div>
    </Card>
  );
}

Object.assign(window, { ScheduleSync });
