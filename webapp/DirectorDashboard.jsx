/* DocTurn web-app UI kit — Director dashboard.
   Director controls the hospitalist group: mass-set the daily census limit (cap),
   edit each provider's census/cap, move providers between Day / Swing / Night,
   and manage the round-robin — including taking a provider off rotation even
   while they are on shift.

   Everything here is the SERVER's (A.CON schedule #1-#7):
     • the on-call schedule panel reads GET /api/oncall/sources — the org's
       selected source and its real last sync (never "Amion · 2m ago");
     • shift names and published hours are the org's (PATCH /api/org/shifts/:id,
       director only, audited) — reference hours: nothing switches anyone on or
       off shift by the clock;
     • the admissions counter and its Reset are GET /api/admissions /
       POST /api/admissions/reset (org-wide, audited);
     • a provider's name and specialty are PATCH /api/hospitalists/:id/profile
       and Remove is DELETE /api/physicians/:id — a refusal (e.g. a pending
       admission request) is said and the row stays (A.CON clinical #11/#12). */

function Stepper({ label, value, onDec, onInc, mobile }) {
  // Phones: 40×44 buttons so the −/+ are real tap targets.
  const btn = { width: mobile ? 40 : 24, height: mobile ? 44 : 24, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", fontWeight: 500 }}>{label}</span>
      <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "#fff", overflow: "hidden" }}>
        <button style={btn} onClick={onDec} onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"} title={`Decrease ${label}`}><Icon name="minus" size={13} /></button>
        <span style={{ minWidth: 22, textAlign: "center", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <button style={btn} onClick={onInc} onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"} title={`Increase ${label}`}><Icon name="plus" size={13} /></button>
      </div>
    </div>
  );
}

function ShiftSelect({ shifts, value, onChange, mobile }) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ appearance: "none", WebkitAppearance: "none", height: mobile ? 44 : 28, maxWidth: "100%", padding: "0 24px 0 10px", borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)", background: "var(--secondary)", fontSize: mobile ? 16 : 12, fontWeight: 600, color: "var(--foreground)",
          fontFamily: "var(--font-sans)", cursor: "pointer" }}>
        {shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <Icon name="chevron-down" size={12} color="var(--muted-foreground)" style={{ position: "absolute", right: 7, pointerEvents: "none" }} />
    </div>
  );
}

// "synced 4 min ago" from a server timestamp (ISO / ms); null → null.
function ddAgo(at) {
  if (!at) return null;
  const t = typeof at === "number" ? at : new Date(at).getTime();
  if (!isFinite(t)) return null;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return Math.floor(s / 86400) + " d ago";
}
function ddClock(ms) {
  if (!ms) return "";
  if (window.dtFmt && window.dtFmt.stamp) return window.dtFmt.stamp(ms);
  return new Date(ms).toLocaleString();
}

// The org's name for one shift (PATCH /api/org/shifts/:id { label }). Phones
// get a real 44px "Rename" button and a 16px field; desktop keeps the inline
// click-to-edit text.
function ShiftName({ shift, onRename, mobile }) {
  const [editing, setEditing] = React.useState(false);
  const [v, setV] = React.useState(shift.label);
  React.useEffect(() => { if (!editing) setV(shift.label); }, [shift.label, editing]);
  if (!mobile) return <span data-shift-label={shift.id}><EditableText value={shift.label} onSave={(val) => onRename(shift.id, val)} size={14} weight={700} /></span>;
  const commit = () => { setEditing(false); const t = (v || "").trim(); if (t && t !== shift.label) onRename(shift.id, t); else setV(shift.label); };
  if (editing) {
    return (
      <input data-shift-label-input={shift.id} aria-label={"Name for the " + shift.id + " shift"} value={v} autoFocus maxLength={40}
        onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setV(shift.label); setEditing(false); } }}
        style={{ height: 44, fontSize: 16, fontWeight: 700, padding: "0 10px", border: "1px solid var(--ring)", borderRadius: "var(--radius-md)", minWidth: 0, width: 180, maxWidth: "100%", fontFamily: "var(--font-sans)" }} />
    );
  }
  return (
    <span data-shift-label={shift.id} style={{ display: "inline-flex", alignItems: "center", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shift.label}</span>
      <button type="button" onClick={() => setEditing(true)} aria-label={"Rename the " + shift.label + " shift"} title="Rename"
        style={{ width: 44, height: 44, flex: "none", border: "none", background: "transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
        <Icon name="pencil" size={14} />
      </button>
    </span>
  );
}

// The org's published hours for one shift ("HH:MM", or unset). Saved on blur
// (PATCH /api/org/shifts/:id { start | end }); a refused save puts back what
// the server holds. Reference only — DocTurn does not switch anyone on or off
// shift by these hours.
function ShiftHours({ shift, onSave, mobile }) {
  const [start, setStart] = React.useState(shift.start || "");
  const [end, setEnd] = React.useState(shift.end || "");
  React.useEffect(() => { setStart(shift.start || ""); }, [shift.start]);
  React.useEffect(() => { setEnd(shift.end || ""); }, [shift.end]);
  const commit = (key, val, reset) => {
    if ((val || "") === (shift[key] || "")) return;
    Promise.resolve(onSave(shift.id, { [key]: val || null })).then((ok) => { if (ok === false) reset(shift[key] || ""); });
  };
  const st = mobile ? { ...timeStyle, height: 44, fontSize: 16, padding: "0 8px" } : timeStyle;
  return (
    <div data-shift-hours={shift.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2, flexWrap: "wrap" }}>
      <Icon name="clock" size={13} color="var(--muted-foreground)" />
      <input type="time" aria-label={shift.label + " start"} value={start} onChange={(e) => setStart(e.target.value)} onBlur={(e) => commit("start", e.target.value, setStart)} style={st} />
      <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>–</span>
      <input type="time" aria-label={shift.label + " end"} value={end} onChange={(e) => setEnd(e.target.value)} onBlur={(e) => commit("end", e.target.value, setEnd)} style={st} />
      {!shift.start && !shift.end && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>hours not set</span>}
    </div>
  );
}

function DirectorDashboard({ bare, providers, shifts, settings, onToggleWorking, onAdjustCensus, onAdjustCap, onBulkWorking, onReorder, onToggleRotation, onSetAllCap, onUpdateShift, onSetShift, onAddProvider, onResetRotation, onSetTimeout, onToggleAutoReassign, onUpdateProvider, onRemoveProvider, onRenameShift, onOpenSchedule, admissions, admissionsResetAt, admissionsInfo, onResetAdmissions, onOpenAdmissions, myHospWork, admissionsLog }) {
  // Live ops report (org-scoped, server-computed): assignment latency, consult
  // response and message volume. Hydrated on login for directors; the strip's
  // comms KPIs read from it so nothing is duplicated across two sources.
  const opsReport = useStore().opsReport;
  // Phone layout: provider rows become two lines (identity, then controls) so
  // Census/Cap/Rotation/On-Off/Remove are reachable instead of clipped by the
  // roster Card's overflow:hidden; header/bulk rows wrap instead of overflowing.
  const mobile = useIsMobile();

  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  const [capInput, setCapInput] = React.useState("12");
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", specialty: "Hospital Medicine", cap: "12", shift: "day", role: "hospitalist" });
  const ROLE_OPTIONS = [
    { id: "hospitalist", label: "Hospitalist" },
    { id: "er_doctor", label: "ER Doctor" },
    { id: "er_director", label: "ER Director" },
    { id: "director", label: "Director" },
  ];
  const working = providers.filter((p) => p.working);
  const rotation = providers.filter((p) => p.working && p.inRotation);
  const totalCensus = providers.reduce((a, p) => a + p.census, 0);
  const totalCap = providers.reduce((a, p) => a + p.cap, 0);
  const allOn = providers.length > 0 && working.length === providers.length;
  const allOff = working.length === 0;

  // Who's actually next: the routing planner's answer (GET /api/rotation/next
  // via DT.nextUp) — round-robin shift, census below cap, cap relief and the
  // sequential cursor applied — never "lowest census among everyone working",
  // which named at-cap and swing-shift providers (A.CON-SHO-29).
  const DTx = (typeof window !== "undefined" && window.DT) || null;
  const rrStatus = (DTx && DTx.rotationStatus) ? DTx.rotationStatus() : { source: "local", capRelief: false, mode: (settings && settings.rotationMode) || "lowest_census" };
  const rotMode = rrStatus.mode || (settings && settings.rotationMode) || "lowest_census";
  const nextProvider = DTx && DTx.nextUp ? DTx.nextUp() : null;
  // Rotation position per provider (1-based): the planner's own pick order
  // (DT.rotationQueue = GET /api/rotation/next `order`), so the numbers are
  // who gets the next round-robin patients, in turn — census order or the
  // sequential cursor applied, and nobody at cap, off shift, off rotation or
  // on a non-round-robin shift. Not "everyone working, in list order".
  const rrQueue = DTx && DTx.rotationQueue ? DTx.rotationQueue() : [];
  const rotIndex = {};
  rrQueue.forEach((p, i) => { rotIndex[p.id] = i + 1; });
  const rrShifts = (rrStatus.shiftTypes && rrStatus.shiftTypes.length) ? rrStatus.shiftTypes : ["day", "night"];
  // Why a row has no position (tooltip + screen-reader label).
  const noPosReason = (p) => !p.working ? "Off shift — not in round-robin"
    : !p.inRotation ? "Off rotation — not in round-robin"
    : rrShifts.indexOf(p.shift) < 0 ? "Not on a round-robin shift"
    : p.census >= p.cap ? "At cap — skipped until a bed frees up"
    : (rrStatus.source === "server" ? "Not in the round-robin queue" : "Round-robin position unknown");

  // Admissions since the org's last counter reset — the SERVER's count
  // (GET /api/admissions). "—" until it answers; the offline kit (no
  // admissionsInfo prop) counts its own demo log.
  const admInfo = admissionsInfo === undefined ? undefined : admissionsInfo;
  const admSinceReset = admInfo === undefined
    ? (admissions || []).filter((a) => a.at >= (admissionsResetAt || 0)).length
    : (admInfo && admInfo.loaded ? admInfo.sinceReset : "—");
  const admError = admInfo && admInfo.error;
  const admReady = admInfo === undefined || !!(admInfo && admInfo.loaded);
  const admResetLine = admInfo === undefined ? "Every admission routed to a team is kept in the log. Reset clears this count only."
    : admError === "module_disabled" ? "Admission routing is switched off for this organization."
    : !admInfo || !admInfo.loaded ? (admError ? "Couldn't load the count from the server." : "Loading the count…")
    : (admInfo.resetAt ? "Counting since " + ddClock(admInfo.resetAt) + (admInfo.resetBy ? " (reset by " + admInfo.resetBy + ")" : "") + "." : "Never reset — this counts every admission on record.") + " Reset restarts the count for everyone at your organization; the log keeps every admission.";

  const handleDrop = (targetId) => { if (dragId && dragId !== targetId) onReorder(dragId, targetId); setDragId(null); setOverId(null); };

  const SHIFT_TINT = { day: "amber", swing: "blue", night: "slate" };

  // On-call schedule panel: the org's source as the SERVER reports it
  // (GET /api/oncall/sources — selected source, configured, lastSyncAt,
  // lastStatus). Re-read on mount and every minute; nothing here is a
  // browser-side guess (A.CON schedule #1).
  const st = useStore();
  const act = useActions();
  const oncallOn = !window.DT || !window.DT.moduleOn || window.DT.moduleOn("oncall.board");
  React.useEffect(() => {
    if (!oncallOn || !act.loadOnCallSources) return undefined;
    act.loadOnCallSources();
    const t = setInterval(() => act.loadOnCallSources(), 60000);
    return () => clearInterval(t);
  }, [oncallOn]);
  const srcInfo = st.onCallSources || null;
  const srcErr = st.onCallSourcesError || null;
  const SRC_NAME = { amion: "Amion", epic: "Epic (FHIR)", manual: "Manual list" };
  const schedKey = srcInfo && srcInfo.selected;
  const schedStatus = schedKey && srcInfo.sources ? srcInfo.sources[schedKey] : null;
  const overridden = srcInfo && srcInfo.overridden ? srcInfo.overridden : null;

  // One source of truth per metric: the comms KPIs come from the ops report
  // (median/avg in minutes), not the separate commsMetrics feed, so the strip
  // shows each metric exactly once. "—" until the report hydrates.
  const rpt = opsReport;
  const fmtMin = (v) => (v != null ? v + " min" : "—");
  const censusVal = totalCensus + " / " + totalCap;
  const bedsOpen = totalCap - totalCensus;
  const ttaMedian = rpt ? fmtMin(rpt.assignments.timeToAcceptMinMedian) : "—";
  const ttaAvg = rpt ? fmtMin(rpt.assignments.timeToAcceptMinAvg) : "—";
  const consultResp = rpt ? fmtMin(rpt.consults.responseMinAvg) : "—";
  const msgs7d = rpt ? rpt.messaging.last7d : "—";
  const statAck = rpt ? fmtMin(rpt.messaging.statAckMinAvg) : "—";
  const asgTotal = rpt ? rpt.assignments.total : "—";
  const acceptedCt = rpt && rpt.assignments.byStatus ? (rpt.assignments.byStatus.accepted || 0) : null;
  const acceptPct = rpt && rpt.assignments.total ? Math.round((acceptedCt / rpt.assignments.total) * 100) + "%" : "—";

  // Live-metric catalog the "+ New stat" builder offers on this dashboard.
  const statMetrics = [
    { key: "providers", label: "Total providers", value: providers.length },
    { key: "active", label: "Active (on shift)", value: working.length },
    { key: "rotation", label: "In rotation", value: rotation.length },
    { key: "census", label: "Total census", value: censusVal },
    { key: "beds_open", label: "Beds open", value: bedsOpen },
    { key: "tta_median", label: "Time to accept (median)", value: ttaMedian },
    { key: "tta_avg", label: "Time to accept (avg)", value: ttaAvg },
    { key: "consult_response", label: "Consult response (avg)", value: consultResp },
    { key: "messages_7d", label: "Messages (7 days)", value: msgs7d },
    { key: "stat_ack", label: "STAT ack (avg)", value: statAck },
    { key: "assignments_total", label: "Assignments (total)", value: asgTotal },
    { key: "accept_rate", label: "Acceptance rate", value: acceptPct },
  ];

  // The stat strip stays pinned at the top (it has its own tile-level
  // "Customize"); only the panels below become reorderable / hideable widgets,
  // driven by the shared CustomizableDashboard. Each widget node is a panel
  // WITHOUT its own outer margin — CustomizableDashboard supplies the spacing.
  // `bare` lets a caller supply the page frame instead of PageWrap.
  const Wrap = bare ? React.Fragment : PageWrap;

  // What the panel says, case by case — each line is something the server reported.
  let schedTitle, schedBadge = null, schedLine;
  const switchesLine = "The rotation follows the On/Off, Rotation and shift controls below — changes apply to everyone at once.";
  if (!oncallOn) {
    schedTitle = "On-call schedule";
    schedLine = "The on-call board is switched off for this organization, so no schedule source is read.";
  } else if (!srcInfo) {
    schedTitle = "On-call schedule";
    schedLine = srcErr ? "Couldn't load the schedule source from the server." : "Loading the schedule source…";
  } else if (schedKey === "manual") {
    schedTitle = "On-call schedule: Manual list";
    const n = schedStatus ? schedStatus.rowCount : 0;
    schedBadge = <Badge status={n ? "accepted" : "pending"} icon="circle">{n ? n + " slot" + (n === 1 ? "" : "s") + (schedStatus.lastSyncAt ? " · edited " + ddAgo(schedStatus.lastSyncAt) : "") : "No slots yet"}</Badge>;
    schedLine = (overridden ? (SRC_NAME[overridden.source] || overridden.source) + " is switched off for this organization, so the On call board reads the manual list. " : "Directors keep the on-call list by hand on the On call board; no feed updates it. ") + switchesLine;
  } else {
    const name = SRC_NAME[schedKey] || schedKey;
    const configured = !!(schedStatus && schedStatus.configured);
    const ago = schedStatus && ddAgo(schedStatus.lastSyncAt);
    if (!configured) {
      schedTitle = "On-call schedule: " + name + " not connected";
      schedBadge = <Badge status="pending" icon="circle">Not connected</Badge>;
      schedLine = "Connect it under Settings → Integrations. Until then nothing is imported from " + name + ". " + switchesLine;
    } else if (schedStatus.lastStatus === "error") {
      schedTitle = "On-call schedule: " + name;
      schedBadge = <Badge status="rejected" icon="circle">{"Last sync failed" + (ago ? " · " + ago : "")}</Badge>;
      schedLine = (schedKey === "amion" ? "The board keeps the last good Amion pull. " : "The board keeps the last good Epic sync. ") + switchesLine;
    } else if (!schedStatus.lastSyncAt) {
      schedTitle = "On-call schedule: " + name;
      schedBadge = <Badge status="pending" icon="circle">Not synced yet</Badge>;
      schedLine = "Connected; the first sync hasn't run. " + switchesLine;
    } else {
      schedTitle = "On-call schedule synced from " + name;
      schedBadge = <Badge status="accepted" icon="circle">{"Synced " + ago + " · " + schedStatus.rowCount + " slot" + (schedStatus.rowCount === 1 ? "" : "s")}</Badge>;
      schedLine = schedKey === "amion"
        ? "Each Amion pull puts everyone on the grid on shift with the grid's shift, so changes below last until the next pull."
        : "Epic feeds the On call board only; it does not change who is on shift. " + switchesLine;
    }
  }
  const scheduleNode = (
    /* Schedule source — the server's selected source and its real sync state */
    <Card style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "#DBEAFE", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="calendar-clock" size={17} color="var(--primary)" /></span>
      <div data-schedule-panel={schedKey || (srcErr ? "error" : "loading")} style={{ minWidth: 0, flex: "1 1 200px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span data-schedule-title>{schedTitle}</span>{schedBadge && <span data-schedule-badge style={{ whiteSpace: "nowrap" }}>{schedBadge}</span>}</div>
        <div data-schedule-line style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{schedLine}</div>
      </div>
      <Button size="sm" variant="outline" icon="settings" onClick={onOpenSchedule}>Schedule settings</Button>
    </Card>
  );

  const admissionsNode = (
    /* Admissions counter — rolling count since last reset; full history in the log */
    <Card style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="scroll-text" size={17} color="var(--status-accepted)" /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>Admissions since last reset: <span data-admissions-since style={{ fontVariantNumeric: "tabular-nums" }}>{admSinceReset}</span></div>
        <div data-admissions-reset-line style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{admResetLine}</div>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {onOpenAdmissions && <Button size="sm" variant="outline" icon="scroll-text" onClick={onOpenAdmissions}>View log</Button>}
        {onResetAdmissions && <Button size="sm" variant="outline" icon="rotate-ccw" onClick={() => { if (admReady) onResetAdmissions(); }} style={admReady ? null : { opacity: .5 }}>Reset count</Button>}
      </div>
    </Card>
  );

  const bulkNode = (
    /* Bulk controls bar */
    <Card style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Icon name="layers" size={16} color="var(--primary)" />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Mass set daily census limit</span>
        <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#fff" }}>
          <input value={capInput} onChange={(e) => setCapInput(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
            style={{ width: 52, height: 34, border: "none", outline: "none", textAlign: "center", fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-sans)" }} />
        </div>
        <Button size="sm" variant="default" icon="check" onClick={() => { const n = parseInt(capInput, 10); if (n > 0) onSetAllCap(n); }}>Apply to all</Button>
      </div>
      {/* vertical divider only makes sense when everything sits on one line */}
      {!mobile && <div style={{ width: 1, height: 28, background: "var(--border)" }} />}
      {/* wraps on a phone: the three buttons keep their labels (they no
          longer shrink) and need ~378px, more than a 375-390px Card row */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginLeft: "auto", minWidth: 0, maxWidth: "100%" }}>
        <Button size="sm" variant="outline" icon="toggle-left" onClick={() => onBulkWorking(false)} style={allOff ? { opacity: .5 } : null}>All off shift</Button>
        <Button size="sm" variant="outline" icon="toggle-right" onClick={() => onBulkWorking(true)} style={allOn ? { opacity: .5 } : null}>All on shift</Button>
        <Button size="sm" variant="default" icon="user-plus" onClick={() => setAdding(true)}>Add provider</Button>
      </div>
    </Card>
  );

  // When the server says nobody can take a round-robin patient (or routing is
  // off / the preview failed), the card says so instead of disappearing or
  // guessing a name.
  const noNextMsg = rrStatus.source === "disabled" ? "Admission routing is switched off for this organization."
    : rrStatus.source === "unavailable" ? "Couldn't load who's next — the server picks when an admission is sent."
    : rrStatus.source === "loading" ? "Checking who's next…"
    : providers.length ? "Nobody on a round-robin shift has room under their cap — the next round-robin admission can't be routed."
    : null;
  const nextUpNode = (nextProvider || noNextMsg) && (
    /* Next up — who receives the next round-robin admission (server's pick) */
    <Card style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: "linear-gradient(180deg,#EFF6FF,#fff)", border: "1px solid var(--primary)" }}>
      {nextProvider ? <Avatar initials={nextProvider.avatar} size={40} tint="emerald" /> : <Icon name="user-x" size={22} color="var(--muted-foreground)" />}
      <div style={{ minWidth: 0, flex: "1 1 180px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <Badge status="sent">Next up</Badge>
          <span style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nextProvider ? nextProvider.name : (rrStatus.source === "loading" ? "…" : "No eligible hospitalist")}</span>
        </div>
        {nextProvider
          ? <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{nextProvider.specialty || "Hospital Medicine"} · census {nextProvider.census}/{nextProvider.cap} · {rotMode === "lowest_census" ? "lowest census first" : "sequential"}{rrStatus.capRelief ? " · everyone eligible is at cap: the next round-robin admission raises each round-robin cap by 1" : ""}</div>
          : <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{noNextMsg}</div>}
      </div>
      {/* "Reset rotation" only means something in SEQUENTIAL mode (it zeroes the
          rotation index). In lowest-census mode next-up is driven purely by
          census, so the index — and this button — do nothing; hide it. */}
      {rotMode === "sequential" && (
        <Button variant="outline" size="sm" icon="rotate-ccw" onClick={onResetRotation}>Reset rotation</Button>
      )}
    </Card>
  );

  const providersNode = (
    /* Provider management grouped by shift — each in-rotation row is also its
       rotation-order item (drag handle + position + next-up highlight). */
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div data-shift-note style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
        <Icon name="info" size={13} style={{ marginTop: 2, flex: "none" }} />
        <span>Shift names and hours are your organization's — saved for everyone. Hours are for reference: DocTurn doesn't switch anyone on or off shift by the clock; the On/Off switch does{schedKey === "amion" ? ", and each Amion pull" : ""}.</span>
      </div>
      {shifts.map((shift) => {
          const group = providers.filter((p) => p.shift === shift.id);
          return (
            <div key={shift.id}>
              {/* wraps on phones: label + hours + "N providers" exceed 362px otherwise (page wobble) */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, rowGap: 6, marginBottom: 8, padding: "0 2px", flexWrap: "wrap" }}>
                <Avatar initials="" size={10} tint={SHIFT_TINT[shift.id]} />
                <ShiftName shift={shift} onRename={onRenameShift} mobile={mobile} />
                <ShiftHours shift={shift} onSave={onUpdateShift} mobile={mobile} />
                <span style={{ fontSize: 12, color: "var(--muted-foreground)", marginLeft: "auto", fontWeight: 600 }}>{group.length} provider{group.length === 1 ? "" : "s"}</span>
              </div>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {group.length === 0 && <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--muted-foreground)" }}>No providers on this shift.</div>}
                {group.map((p, i) => {
                  const inRot = p.working && p.inRotation;
                  const isNext = nextProvider && p.id === nextProvider.id;
                  return (
                  <div key={p.id}
                    draggable={inRot}
                    onDragStart={inRot ? () => setDragId(p.id) : undefined}
                    onDragEnd={inRot ? () => { setDragId(null); setOverId(null); } : undefined}
                    onDragOver={inRot ? (e) => { e.preventDefault(); if (overId !== p.id) setOverId(p.id); } : undefined}
                    onDrop={inRot ? (e) => { e.preventDefault(); handleDrop(p.id); } : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", borderTop: i ? "1px solid var(--border)" : "none",
                      background: dragId === p.id ? "var(--secondary)" : (isNext ? "#EFF6FF" : "transparent"),
                      borderLeft: isNext ? "3px solid var(--primary)" : "3px solid transparent",
                      opacity: dragId === p.id ? 0.5 : 1, cursor: inRot ? "grab" : "default", transition: "background .12s, opacity .12s" }}>
                    {/* round-robin position (the planner's pick order) */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, width: 40, flex: "none" }}>
                      {inRot && <Icon name="grip-vertical" size={14} color="var(--muted-foreground)" />}
                      {rotIndex[p.id] ? (
                        <span data-testid="rr-pos" data-provider={p.id} aria-label={"Round-robin position " + rotIndex[p.id]} title={"Round-robin position " + rotIndex[p.id]}
                          style={{ width: 20, height: 20, borderRadius: 99, background: isNext ? "var(--primary)" : "var(--secondary)", color: isNext ? "#fff" : "var(--muted-foreground)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{rotIndex[p.id]}</span>
                      ) : (
                        <span data-testid="rr-pos" data-provider={p.id} aria-label={noPosReason(p)} title={noPosReason(p)} style={{ color: "var(--muted-foreground)", fontSize: 13, paddingLeft: inRot ? 0 : 6 }}>—</span>
                      )}
                    </span>
                    <Avatar initials={p.avatar} size={34} tint={p.working ? "emerald" : "slate"} />
                    {/* Desktop keeps the fixed 170px name column so the shift selects
                        line up across rows; phones give the name the rest of line 1. */}
                    <div style={mobile ? { flex: "1 1 0", minWidth: 0 } : { width: 170, flex: "none", minWidth: 0 }}>
                      <EditableText value={p.name} onSave={(val) => onUpdateProvider(p.id, { name: val })} size={13.5} weight={600} />
                      <div><EditableText value={p.specialty} onSave={(val) => onUpdateProvider(p.id, { specialty: val })} size={12} weight={400} color="var(--muted-foreground)" placeholder="Add specialty" /></div>
                    </div>
                    {!mobile && <ShiftSelect shifts={shifts} value={p.shift} onChange={(sid) => onSetShift(p.id, sid)} />}
                    {/* Controls: inline at the right on desktop; a wrapping second
                        line (full row width) on phones. */}
                    <div style={mobile
                      ? { flexBasis: "100%", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }
                      : { marginLeft: "auto", display: "flex", alignItems: "center", gap: 18 }}>
                      {mobile && <ShiftSelect shifts={shifts} value={p.shift} onChange={(sid) => onSetShift(p.id, sid)} mobile />}
                      <Stepper label="Census" value={p.census} onDec={() => onAdjustCensus(p.id, -1)} onInc={() => onAdjustCensus(p.id, 1)} mobile={mobile} />
                      <Stepper label="Cap" value={p.cap} onDec={() => onAdjustCap(p.id, -1)} onInc={() => onAdjustCap(p.id, 1)} mobile={mobile} />
                      {!mobile && <div style={{ width: 1, height: 24, background: "var(--border)" }} />}
                      <button onClick={() => onToggleRotation(p.id)} title={p.inRotation ? "In round-robin — click to remove" : "Off rotation — click to add"}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: mobile ? "0 14px" : "5px 10px", minHeight: mobile ? 44 : undefined, borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-sans)",
                          border: `1px solid ${p.inRotation ? "var(--primary)" : "var(--border)"}`, background: p.inRotation ? "var(--primary-tint, #EFF6FF)" : "#fff", color: p.inRotation ? "var(--primary)" : "var(--muted-foreground)" }}>
                        <Icon name={p.inRotation ? "route" : "route-off"} size={12} />{p.inRotation ? "Rotation" : "Off"}
                      </button>
                      <button onClick={() => onToggleWorking(p.id)} title="Toggle shift"
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: "none", background: "transparent", fontFamily: "var(--font-sans)", minHeight: mobile ? 44 : undefined, padding: mobile ? "0 4px" : undefined }}>
                        <span style={{ width: 40, height: 24, borderRadius: 99, position: "relative", flex: "none", background: p.working ? "var(--status-accepted)" : "var(--status-neutral-bg)", transition: "background .2s" }}>
                          <span style={{ position: "absolute", top: 3, left: p.working ? 19 : 3, width: 18, height: 18, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
                        </span>
                        <span style={{ fontSize: 11, width: 38, textAlign: "left", color: p.working ? "var(--status-accepted)" : "var(--muted-foreground)", fontWeight: 600 }}>{p.working ? "On" : "Off"}</span>
                      </button>
                      <button onClick={() => { if (window.confirm("Remove " + p.name + " from the rotation? Their account stays (manage it in People).")) onRemoveProvider(p.id); }} title="Remove from rotation" aria-label={"Remove " + p.name + " from the rotation"}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                        style={{ width: mobile ? 44 : 28, height: mobile ? 44 : 28, flex: "none", marginLeft: mobile ? "auto" : undefined, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}><Icon name="trash-2" size={15} /></button>
                    </div>
                  </div>
                ); })}
              </Card>
            </div>
          );
        })}
      </div>
  );

  const roundRobinNode = (
    /* Round-robin config (the order itself lives in the provider rows above) */
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon name="route" size={18} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Round-robin config</h3>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)" }}>{rotMode === "lowest_census" ? "Lowest census first" : "Sequential"} · {rotation.length} in rotation</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 14px" }}>The numbers in the provider rows above are who gets the next round-robin patients, in turn (— = at cap, off shift, off rotation or not on a round-robin shift); the next provider is highlighted. Drag any in-rotation row to change the rotation order.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        <Field label="Assignment timeout (min)" icon="timer" value={String((settings && settings.timeout) != null ? settings.timeout : 15)} onChange={(v) => onSetTimeout && onSetTimeout(parseInt(v.replace(/[^0-9]/g, ""), 10) || 0)} help="Unanswered requests re-page the next provider after this." />
        <div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Auto-reassign declined patients</div>
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{(settings && settings.autoReassign) ? "A decline routes straight to the next provider." : "Off: a declined patient waits for the ER / director to reassign it."}</div>
            </div>
            <button onClick={onToggleAutoReassign} title="Auto-reassign on decline"
              style={{ width: 44, height: 26, borderRadius: 99, border: "none", cursor: "pointer", position: "relative", flex: "none",
                background: (settings && settings.autoReassign) ? "var(--status-accepted)" : "var(--status-neutral-bg)", transition: "background .2s" }}>
              <span style={{ position: "absolute", top: 3, left: (settings && settings.autoReassign) ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
            </button>
          </div>
          {rotMode === "sequential"
            ? <Button variant="outline" size="sm" full icon="rotate-ccw" onClick={onResetRotation}>Reset rotation index</Button>
            : <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", display: "flex", alignItems: "flex-start", gap: 6, padding: "2px 2px" }}>
                <Icon name="info" size={13} style={{ marginTop: 1, flex: "none" }} />
                <span>Next-up follows live census — no rotation index to reset. Switch to sequential rotation to control order manually.</span>
              </div>}
        </div>
      </div>
      {working.length > rotation.length && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border)", fontSize: 12, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="route-off" size={13} />
          {working.length - rotation.length} on shift but off rotation
        </div>
      )}
    </Card>
  );

  // Panels below the stat strip, each a hide/reorder/add-back widget. Default
  // layout = all visible, in this order; "Next up" only exists when someone is
  // in rotation. My-hospitalist-work / admissions-log are optional caller nodes.
  const panelWidgets = [
    { id: "schedule", label: "On-call schedule", icon: "calendar-clock", node: scheduleNode },
    { id: "admissions", label: "Admissions counter", icon: "scroll-text", node: admissionsNode },
    { id: "bulk", label: "Bulk controls", icon: "layers", node: bulkNode },
  ];
  if (nextUpNode) panelWidgets.push({ id: "nextup", label: "Next up", icon: "user-check", node: nextUpNode });
  panelWidgets.push(
    { id: "providers", label: "Provider management", icon: "users-round", node: providersNode },
    { id: "roundrobin", label: "Round-robin config", icon: "route", node: roundRobinNode },
  );
  if (myHospWork) panelWidgets.push({ id: "myhosp", label: "My hospitalist work", icon: "stethoscope", node: myHospWork });
  if (admissionsLog) panelWidgets.push({ id: "admissionslog", label: "Admissions log", icon: "scroll-text", node: admissionsLog });

  return (
    <Wrap>
      <CustomizableStats statKey="director:stats" metrics={statMetrics} stats={[
        { id: "providers", label: "Total providers", value: providers.length, icon: "users", tint: "blue" },
        { id: "active", label: "Active (on shift)", value: working.length, icon: "activity", tint: "emerald" },
        { id: "rotation", label: "In rotation", value: rotation.length, icon: "route", tint: "amber" },
        { id: "census", label: "Total census", value: censusVal, icon: "bed-double", tint: "slate" },
        { id: "tta_median", label: "Time to accept (median)", value: ttaMedian, icon: "timer", tint: "blue" },
        { id: "consult_response", label: "Consult response (avg)", value: consultResp, icon: "stethoscope", tint: "emerald" },
        { id: "messages_7d", label: "Messages (7 days)", value: msgs7d, icon: "message-square", tint: "amber" },
        { id: "stat_ack", label: "STAT ack (avg)", value: statAck, icon: "siren", tint: "slate" },
      ]} />
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 18, fontSize: 12, color: "var(--muted-foreground)" }}>
        <Icon name="info" size={13} />
        <span><b style={{ fontWeight: 600, color: "var(--foreground)" }}>{totalCensus}</b> patients across {providers.length} providers · {totalCap - totalCensus} beds open. Census is entered manually for now — automatic <span style={{ fontWeight: 600 }}>EPIC (FHIR)</span> sync is planned.</span>
      </div>
      <CustomizableDashboard role="director" bare widgets={panelWidgets} />
      {adding && (
        <Modal title="Add provider" subtitle="They join the rotation on the selected shift." icon="user-plus" onClose={() => setAdding(false)}
          children={
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Full name" icon="user" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Dr. Jane Smith / Priya Shah, NP" />
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Role</label>
                {/* 4 across in the 460px modal, 2×2 on a phone: four equal
                    flex shares (66px at 375) drew "Hospitalist" past its box */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 6 }}>
                  {ROLE_OPTIONS.map((r) => (
                    <button key={r.id} onClick={() => setForm({ ...form, role: r.id })}
                      style={{ flex: 1, padding: "9px 8px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                        border: form.role === r.id ? "1px solid var(--primary)" : "1px solid var(--border)", background: form.role === r.id ? "#EFF6FF" : "#fff", color: form.role === r.id ? "var(--primary)" : "var(--foreground)" }}>{r.label}</button>
                  ))}
                </div>
              </div>
              {form.role === "hospitalist" && (
                <>
                  <Field label="Specialty" icon="stethoscope" value={form.specialty} onChange={(v) => setForm({ ...form, specialty: v })} placeholder="e.g. Cardiology" />
                  {/* Shift drops below Patient cap when the row is too narrow
                      for three readable shift choices (phones) */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ width: 120 }}><Field label="Patient cap" icon="gauge" value={form.cap} onChange={(v) => setForm({ ...form, cap: v.replace(/[^0-9]/g, "") })} /></div>
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Shift</label>
                      <div style={{ display: "flex", gap: 6 }}>
                        {shifts.map((s) => (
                          <button key={s.id} onClick={() => setForm({ ...form, shift: s.id })}
                            style={{ flex: 1, padding: "9px 8px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 12.5, fontWeight: 600, overflowWrap: "anywhere",
                              border: form.shift === s.id ? "1px solid var(--primary)" : "1px solid var(--border)", background: form.shift === s.id ? "#EFF6FF" : "#fff", color: form.shift === s.id ? "var(--primary)" : "var(--foreground)" }}>{s.label}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" icon="check" onClick={() => { if (form.name.trim()) { onAddProvider(form); setForm({ name: "", specialty: "Hospital Medicine", cap: "12", shift: "day", role: "hospitalist" }); setAdding(false); } else window.DT.actions.toast({ tone: "rejected", title: "Name required", msg: "Enter the provider's name." }); }}>Add provider</Button>
              </div>
            </div>
          } />
      )}
    </Wrap>
  );
}

const timeStyle = { height: 24, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "#fff", fontSize: 11.5, fontFamily: "var(--font-sans)", color: "var(--foreground)", padding: "0 4px", fontVariantNumeric: "tabular-nums" };

Object.assign(window, { DirectorDashboard });
