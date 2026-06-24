/* DocTurn web-app UI kit — ER Director dashboard.
   DISTINCT from the Hospitalist Director: the ER director owns the ER side —
   intake throughput, ER-physician staffing, routing/acceptance performance,
   and diversion status. Store-backed; metrics derive from live intake data.
   Spec: Eng §10.1 (ER director portal), Req FR-6 (broadcasts/diversion). */

function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + "m " + String(s).padStart(2, "0") + "s";
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

function ErShiftSelect({ shifts, value, onChange }) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ appearance: "none", WebkitAppearance: "none", height: 28, padding: "0 24px 0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", fontFamily: "var(--font-sans)", cursor: "pointer" }}>
        {shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <Icon name="chevron-down" size={12} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
    </div>
  );
}

// ── ER director dashboard, split into self-contained panels (no PageWrap) so
// each can be a draggable / removable / addable widget. ────────────────────

function ErDiversionPanel({ diversion, onToggleDiversion }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: "var(--radius-md)",
      background: diversion ? "var(--status-rejected-bg)" : "var(--status-accepted-bg)", border: `1px solid ${diversion ? "var(--status-rejected)" : "var(--status-accepted)"}` }}>
      <Icon name={diversion ? "octagon-alert" : "circle-check-big"} size={20} color={diversion ? "var(--status-rejected)" : "var(--status-accepted)"} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: diversion ? "var(--status-rejected)" : "var(--status-accepted)" }}>{diversion ? "ER is on diversion" : "ER is accepting patients"}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{diversion ? "Incoming ambulances are being diverted. EMS and all providers were notified." : "Normal operations — incoming transfers and walk-ins are accepted."}</div>
      </div>
      <Button variant={diversion ? "default" : "outline"} size="sm" icon={diversion ? "circle-check-big" : "octagon-alert"} onClick={onToggleDiversion}>
        {diversion ? "Lift diversion" : "Declare diversion"}
      </Button>
    </div>
  );
}

function ErStatsPanel({ erPhysicians, sent, board, avgAcceptSec }) {
  const admitsToday = (erPhysicians || []).reduce((a, p) => a + (p.admitsToday || 0), 0);
  const todaySent = (sent || []).filter((s) => s.day === "Today");
  const accepted = (sent || []).filter((s) => s.status === "accepted").length;
  const rejected = (sent || []).filter((s) => s.status === "rejected").length;
  const acceptRate = (accepted + rejected) ? Math.round((accepted / (accepted + rejected)) * 100) : 100;
  const pendingER = (board || []).filter((b) => b.status === "pending").length;
  return (
    <div style={{ display: "flex", gap: 14 }}>
      <ErStat label="Admits today" value={admitsToday} icon="clipboard-plus" tint="blue" sub={todaySent.length + " routed via DocTurn"} />
      <ErStat label="Avg time-to-accept" value={fmtDuration(avgAcceptSec)} icon="timer" tint="amber" sub="across hospitalist groups" />
      <ErStat label="Acceptance rate" value={acceptRate + "%"} icon="check-check" tint="emerald" sub={accepted + " accepted · " + rejected + " re-routed"} />
      <ErStat label="Pending in ER" value={pendingER} icon="loader" tint="slate" sub="awaiting hospitalist accept" />
    </div>
  );
}

function ErRosterPanel({ erPhysicians, shifts, onToggle, onUpdate, onSetShift, onAdd, onRemove }) {
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shift, setShift] = React.useState("day");
  const onShift = (erPhysicians || []).filter((p) => p.working);
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon name="ambulance" size={18} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>ER physicians</h3>
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>· {onShift.length} of {erPhysicians.length} on shift</span>
        <span style={{ marginLeft: "auto" }}><Button size="sm" variant={adding ? "secondary" : "default"} icon={adding ? "x" : "user-plus"} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add"}</Button></span>
      </div>

      {adding && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", margin: "12px 0 6px", padding: 12, background: "var(--secondary)", borderRadius: "var(--radius-md)" }}>
          <div style={{ flex: 1 }}><Field label="Physician name" icon="user" value={name} onChange={setName} placeholder="Dr. Jane Smith" /></div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Shift</label>
            <ErShiftSelect shifts={shifts} value={shift} onChange={setShift} />
          </div>
          <Button size="sm" icon="check" onClick={() => { if (name.trim()) { onAdd({ name, shift }); setName(""); setAdding(false); } }}>Add</Button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
        {(erPhysicians || []).map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", opacity: p.working ? 1 : 0.62 }}>
            <div style={{ position: "relative", flex: "none" }}>
              <Avatar initials={p.avatar} size={38} tint={p.working ? "blue" : "slate"} />
              <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={p.working ? "online" : "offline"} /></span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <EditableText value={p.name} onSave={(v) => onUpdate(p.id, { name: v })} size={14} weight={600} />
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="clipboard-plus" size={12} />{p.admitsToday} admit{p.admitsToday === 1 ? "" : "s"} today
              </div>
            </div>
            <ErShiftSelect shifts={shifts} value={p.shift} onChange={(sid) => onSetShift(p.id, sid)} />
            <button onClick={() => onToggle(p.id)} title={p.working ? "End shift" : "Start shift"}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-sans)",
                border: "1px solid var(--border)", background: p.working ? "var(--status-accepted-bg)" : "#fff", color: p.working ? "var(--status-accepted)" : "var(--muted-foreground)" }}>
              <Icon name={p.working ? "toggle-right" : "toggle-left"} size={13} />{p.working ? "On shift" : "Off"}
            </button>
            <button onClick={() => onRemove(p.id)} title="Remove"
              onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
              style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="trash-2" size={15} /></button>
          </div>
        ))}
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
        {(sent || []).slice(0, 5).map((s) => {
          const st = { accepted: ["accepted", "Accepted"], sent: ["pending", "Routing"], rejected: ["rejected", "Re-routed"] }[s.status] || ["pending", "Routing"];
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar initials={s.initials} size={30} tint="slate" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.complaint}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>→ {s.provider} · {s.time}</div>
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
function ErDirectorDashboard({ erPhysicians, shifts, sent, board, diversion, avgAcceptSec, onToggle, onUpdate, onSetShift, onAdd, onRemove, onToggleDiversion, onBroadcasts }) {
  return (
    <PageWrap>
      <div style={{ marginBottom: 18 }}><ErDiversionPanel diversion={diversion} onToggleDiversion={onToggleDiversion} /></div>
      <div style={{ marginBottom: 16 }}><ErStatsPanel erPhysicians={erPhysicians} sent={sent} board={board} avgAcceptSec={avgAcceptSec} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr .9fr", gap: 16, alignItems: "start" }}>
        <ErRosterPanel erPhysicians={erPhysicians} shifts={shifts} onToggle={onToggle} onUpdate={onUpdate} onSetShift={onSetShift} onAdd={onAdd} onRemove={onRemove} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ErRecentIntakesPanel sent={sent} />
          <ErOpsPanel onBroadcasts={onBroadcasts} />
        </div>
      </div>
    </PageWrap>
  );
}

Object.assign(window, { ErDirectorDashboard, ErDiversionPanel, ErStatsPanel, ErRosterPanel, ErRecentIntakesPanel, ErOpsPanel, ErStat, fmtDuration });
