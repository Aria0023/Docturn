/* DocTurn web-app UI kit — ER Director dashboard.
   DISTINCT from the Hospitalist Director: the ER director owns the ER side —
   intake throughput, ER-physician staffing, routing/acceptance performance,
   and diversion status. Every panel is the SERVER's (A.CON clinical #1-#3):
     • diversion: GET / PUT /api/er/diversion — org-wide, audited, broadcast
       to everyone in the org; DocTurn has no EMS integration and says so;
     • ER physicians: GET /api/er/roster — the org's er_doctor accounts, with
       on/off shift and shift kept on the server (PATCH /api/er/roster/:id);
       accounts are added / removed in People;
     • throughput: GET /api/reports/er — "—" until the server answers, never a
       constant.
   Spec: Eng §10.1 (ER director portal), Req FR-6 (broadcasts/diversion). */

// Minutes from the server (one decimal) → "2m 36s"; null/undefined → "—".
function fmtMinutes(min) {
  if (min == null || !isFinite(min)) return "—";
  const sec = Math.round(min * 60);
  return Math.floor(sec / 60) + "m " + String(sec % 60).padStart(2, "0") + "s";
}
function fmtDuration(sec) {
  if (sec == null || !isFinite(sec)) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + "m " + String(s).padStart(2, "0") + "s";
}
// Why a server read is missing, in words.
function erReadWhy(err) {
  return err === "module_disabled" ? "switched off for your organization"
    : err === "forbidden" ? "not available to your role"
    : err === "offline" ? "no connection"
    : err ? "couldn't load from the server" : "loading…";
}

function ErStat({ label, value, icon, tint, sub }) {
  const tints = { blue: ["#DBEAFE", "var(--primary)"], emerald: ["var(--status-accepted-bg)", "var(--status-accepted)"], amber: ["var(--status-pending-bg)", "var(--status-pending)"], slate: ["var(--status-neutral-bg)", "var(--status-neutral)"] };
  const [bg, fg] = tints[tint] || tints.blue;
  return (
    <Card style={{ padding: 16, flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name={icon} size={16} />
        </span>
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 5 }}>{sub}</div>}
    </Card>
  );
}

function ErShiftSelect({ shifts, value, onChange, mobile }) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ appearance: "none", WebkitAppearance: "none", height: mobile ? 44 : 28, maxWidth: "100%", padding: "0 24px 0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: mobile ? 16 : 12, fontWeight: 600, color: "var(--muted-foreground)", fontFamily: "var(--font-sans)", cursor: "pointer" }}>
        {shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <Icon name="chevron-down" size={12} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
    </div>
  );
}

// ── ER director dashboard, split into self-contained panels (no PageWrap) so
// each can be a draggable / removable / addable widget. ────────────────────

function ErDiversionPanel({ diversion, error, busy, onSetDiversion }) {
  const loaded = !!diversion;
  const on = !!(diversion && diversion.active);
  const since = on && diversion.since ? (window.dtFmt && window.dtFmt.stamp ? window.dtFmt.stamp(new Date(diversion.since).getTime()) : diversion.since) : null;
  const toggle = () => {
    if (!loaded || busy || !onSetDiversion) return;
    if (!on && !window.confirm("Declare ER diversion? Everyone in your organization gets a critical broadcast. DocTurn does not notify EMS — you still tell them directly.")) return;
    onSetDiversion(!on);
  };
  const tone = !loaded ? "neutral" : on ? "rejected" : "accepted";
  const fg = { neutral: "var(--muted-foreground)", rejected: "var(--status-rejected)", accepted: "var(--status-accepted)" }[tone];
  const bg = { neutral: "var(--secondary)", rejected: "var(--status-rejected-bg)", accepted: "var(--status-accepted-bg)" }[tone];
  return (
    <div data-diversion={!loaded ? (error ? "error" : "loading") : on ? "on" : "off"} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 16px", borderRadius: "var(--radius-md)",
      background: bg, border: `1px solid ${tone === "neutral" ? "var(--border)" : fg}` }}>
      <Icon name={!loaded ? "loader" : on ? "octagon-alert" : "circle-check-big"} size={20} color={fg} />
      {/* flex-basis 200px: on a phone the button wraps under the text instead of squeezing it */}
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div data-diversion-title style={{ fontSize: 14, fontWeight: 700, color: fg }}>{!loaded ? "ER diversion status" : on ? "ER is on diversion" : "ER is accepting patients"}</div>
        <div data-diversion-line style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
          {!loaded ? "Diversion status: " + erReadWhy(error) + "."
            : on ? "Declared" + (diversion.by && diversion.by.name ? " by " + diversion.by.name : "") + (since ? " · " + since : "") + ". Everyone in your organization was sent a broadcast. DocTurn does not notify EMS — tell them through your usual channel."
            : "No diversion declared for your organization."}
        </div>
      </div>
      {loaded && onSetDiversion && (
        <Button variant={on ? "default" : "outline"} size="sm" icon={on ? "circle-check-big" : "octagon-alert"} onClick={toggle} style={busy ? { opacity: .6, pointerEvents: "none" } : null}>
          {busy ? "Saving…" : on ? "Lift diversion" : "Declare diversion"}
        </Button>
      )}
    </div>
  );
}

// Throughput tiles: the server's numbers (GET /api/reports/er, org-wide for
// the ER director) and the ER board rows the server sent (GET
// /api/assignments/sent). "—" where there is nothing to compute from.
function ErStatsPanel({ report, reportError, sent, board }) {
  const r = report || null;
  const a = (r && r.assignments) || null;
  const admits = r ? r.admits24h : "—";
  const tta = a ? fmtMinutes(a.timeToAcceptMinAvg) : "—";
  const todaySent = (sent || []).filter((s) => s.day === "Today");
  const accepted = (sent || []).filter((s) => s.status === "accepted").length;
  const declined = (sent || []).filter((s) => s.status === "declined" || s.status === "rejected").length;
  const acceptRate = (accepted + declined) ? Math.round((accepted / (accepted + declined)) * 100) + "%" : "—";
  const pendingER = (board || []).filter((b) => b.status === "pending").length;
  const why = !r && reportError ? " · " + erReadWhy(reportError) : "";
  const statMetrics = [
    { key: "admits", label: "Admits (24 h)", value: admits },
    { key: "routed", label: "Routed via DocTurn", value: todaySent.length },
    { key: "ttaccept", label: "Avg time-to-accept", value: tta },
    { key: "acceptrate", label: "Acceptance rate", value: acceptRate },
    { key: "accepted", label: "Accepted", value: accepted },
    { key: "declined", label: "Declined", value: declined },
    { key: "pending", label: "Pending in ER", value: pendingER },
  ];
  return (
    <CustomizableStats statKey="er_director:stats" metrics={statMetrics} stats={[
      { id: "admits", label: "Admits (24 h)", value: admits, icon: "clipboard-plus", tint: "blue", sub: todaySent.length + " routed via DocTurn today" + why },
      { id: "ttaccept", label: "Avg time-to-accept", value: tta, icon: "timer", tint: "amber", sub: a && a.timeToAcceptMinAvg == null ? "no accepted admissions yet" : "hospitalist response, all time" + why },
      { id: "acceptrate", label: "Acceptance rate", value: acceptRate, icon: "check-check", tint: "emerald", sub: accepted + " accepted · " + declined + " declined" },
      { id: "pending", label: "Pending in ER", value: pendingER, icon: "loader", tint: "slate", sub: "awaiting hospitalist accept" },
    ]} />
  );
}

// The org's ER physician accounts (GET /api/er/roster) — on/off shift and
// shift saved on the server. Accounts themselves are added and removed in
// People (onManagePeople), not here.
function ErRosterPanel({ roster, error, shifts, onSetOnShift, onSetShift, onManagePeople }) {
  const mobile = useIsMobile();
  const list = (roster && roster.physicians) || [];
  const shiftOpts = (shifts && shifts.length ? shifts : (window.DT && window.DT.defaultShifts ? window.DT.defaultShifts() : []));
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <Icon name="ambulance" size={18} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>ER physicians</h3>
        <span data-er-roster-count style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{roster ? "· " + roster.onShift + " of " + list.length + " on shift" : "· " + erReadWhy(error)}</span>
        {onManagePeople && <span style={{ marginLeft: "auto" }}><Button size="sm" variant="outline" icon="users" onClick={onManagePeople}>Manage in People</Button></span>}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.45 }}>Your organization's ER physician accounts. On/Off and shift are saved for everyone; add or remove physicians in People.</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
        {roster && list.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "6px 0" }}>No ER physician accounts yet — add them in People.</div>}
        {list.map((p) => {
          const avatar = (window.dtFmt && window.dtFmt.initialsOf) ? window.dtFmt.initialsOf(p.displayName) : p.displayName.slice(0, 2).toUpperCase();
          const controls = (
            <React.Fragment>
              <ErShiftSelect shifts={[{ id: "", label: "Shift not set" }].concat(shiftOpts)} value={p.shiftType || ""} onChange={(sid) => { if (sid) onSetShift(p.userId, sid); }} mobile={mobile} />
              <button onClick={() => onSetOnShift(p.userId, !p.onShift)} title={p.onShift ? "End shift" : "Start shift"} aria-pressed={p.onShift}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: mobile ? "0 14px" : "5px 11px", minHeight: mobile ? 44 : undefined, borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-sans)",
                  border: "1px solid var(--border)", background: p.onShift ? "var(--status-accepted-bg)" : "#fff", color: p.onShift ? "var(--status-accepted)" : "var(--muted-foreground)" }}>
                <Icon name={p.onShift ? "toggle-right" : "toggle-left"} size={13} />{p.onShift ? "On shift" : "Off"}
              </button>
            </React.Fragment>
          );
          return (
          // Off-shift rows are marked by the slate avatar, the offline dot, the
          // "Off" state and a grey surface — not by fading the row, which took
          // its text to 2.6:1 (A.CON-SHO-53).
          <div key={p.userId} data-er-physician={p.userId} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "11px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: p.onShift ? "#fff" : "var(--secondary)" }}>
            <div style={{ position: "relative", flex: "none" }}>
              <Avatar initials={avatar} size={38} tint={p.onShift ? "blue" : "slate"} />
              {/* display:flex so the dot sits on the avatar rim, not 10px up in a line box */}
              <span style={{ position: "absolute", bottom: -1, right: -1, display: "flex", border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={p.onShift ? "online" : "offline"} /></span>
            </div>
            <div style={{ flex: "1 1 0", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="clipboard-plus" size={12} />{p.admits24h} admit{p.admits24h === 1 ? "" : "s"} in 24 h
              </div>
            </div>
            {mobile
              ? <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{controls}</div>
              : controls}
          </div>
          );
        })}
      </div>
    </Card>
  );
}

function ErRecentIntakesPanel({ sent }) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Icon name="activity" size={17} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Recent intakes</h3>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {(sent || []).slice(0, 6).map((s) => {
          const st = { accepted: ["accepted", "Accepted"], sent: ["sent", "Routing"], declined: ["declined", "Declined"], rerouted: ["rerouted", "Re-routed"], expired: ["expired", "Expired"], rejected: ["declined", "Declined"] }[s.status] || ["sent", "Routing"];
          const tint = { accepted: "emerald", declined: "slate", sent: "blue" }[s.status] || "slate";
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar initials={s.initials} size={30} tint={tint} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.complaint}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{s.status === "declined" ? "✗ declined by" : "→"} {s.provider} · {s.time}</div>
              </div>
              <Badge status={st[0]}>{st[1]}</Badge>
            </div>
          );
        })}
        {(!sent || sent.length === 0) && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "6px 0" }}>No intakes yet.</div>}
      </div>
    </Card>
  );
}

function ErOpsPanel({ onBroadcasts }) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon name="megaphone" size={17} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>ER operations</h3>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 12px" }}>Send a targeted alert or review acknowledgement tracking.</p>
      <Button full variant="outline" icon="megaphone" onClick={onBroadcasts}>Open broadcasts</Button>
    </Card>
  );
}

// Thin wrapper: all panels stacked (non-customizable use / fallback).
function ErDirectorDashboard({ diversion, diversionError, diversionBusy, onSetDiversion, report, reportError, roster, rosterError, shifts, sent, board, onSetOnShift, onSetShift, onManagePeople, onBroadcasts }) {
  return (
    <PageWrap>
      <div style={{ marginBottom: 18 }}><ErDiversionPanel diversion={diversion} error={diversionError} busy={diversionBusy} onSetDiversion={onSetDiversion} /></div>
      <div style={{ marginBottom: 16 }}><ErStatsPanel report={report} reportError={reportError} sent={sent} board={board} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr .9fr", gap: 16, alignItems: "start" }}>
        <ErRosterPanel roster={roster} error={rosterError} shifts={shifts} onSetOnShift={onSetOnShift} onSetShift={onSetShift} onManagePeople={onManagePeople} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ErRecentIntakesPanel sent={sent} />
          <ErOpsPanel onBroadcasts={onBroadcasts} />
        </div>
      </div>
    </PageWrap>
  );
}

Object.assign(window, { ErDirectorDashboard, ErDiversionPanel, ErStatsPanel, ErRosterPanel, ErRecentIntakesPanel, ErOpsPanel, ErStat, fmtDuration, fmtMinutes, erReadWhy });
