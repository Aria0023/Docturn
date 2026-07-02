/* DocTurn mobile — role-specific home screens for the all-roles gallery.
   Reuses shared primitives from screens.jsx (MI, MBadge, MAvatar, Dot).
   Each role gets a home screen + its own bottom tab set. */

function RHeader({ title, action, sub }) {
  return (
    <div style={{ padding: "56px 20px 12px", background: "#fff", position: "sticky", top: 0, zIndex: 5, borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{title}</h1>
        {action}
      </div>
      {sub && <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MiniTile({ label, value, icon, color }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 13, boxShadow: "var(--shadow-sm)" }}>
      <MI name={icon} size={16} color={color || "var(--primary)"} />
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, letterSpacing: "-.02em" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.2 }}>{label}</div>
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "2px 2px 10px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{children}</h2>
      {right}
    </div>
  );
}

/* ───────────── ER physician — Intake ───────────── */
const ER_SERVICES = [
  { svc: "Hospital Medicine", who: "Dr. Amir Patel", initials: "AP", rr: true },
  { svc: "Cardiology", who: "Dr. Sarah Chen", initials: "SC" },
  { svc: "Pulmonology", who: "Dr. Maria Lopez", initials: "ML" },
  { svc: "Nephrology", who: "Dr. James Liu", initials: "JL" },
  { svc: "Endocrine", who: "Dr. Nadia Farouk", initials: "NF" },
  { svc: "Neurology", who: "Dr. Lena Ortiz", initials: "LO" },
  { svc: "GI", who: "Dr. Ruth Kim", initials: "RK" },
  { svc: "Infectious Disease", who: "Dr. Omar Haddad", initials: "OH" },
];

function ERIntakeScreen() {
  const [sent, setSent] = React.useState([
    { initials: "MJ", who: "Dr. Amir Patel", svc: "Hospital Medicine", consults: ["Cardiology"], issue: "NSTEMI, troponin trending", time: "08:41", status: "accepted" },
    { initials: "RV", who: "Dr. Maria Lopez", svc: "Pulmonology", consults: [], issue: "COPD exacerbation", time: "07:55", status: "sent" },
    { initials: "DK", who: "Dr. Sarah Chen", svc: "Cardiology", consults: [], issue: "Syncope workup", time: "Yest", status: "accepted" },
  ]);
  const [note, setNote] = React.useState("Pt A.B., room 412, chest pain with SOB on exertion");
  const [service, setService] = React.useState("Hospital Medicine"); // primary service to route to
  const [consults, setConsults] = React.useState([]);                // additional specialists
  const ST = { accepted: ["accepted", "Accepted"], sent: ["pending", "Routing"], rejected: ["rejected", "Re-routed"] };

  const toggleConsult = (svc) => setConsults((cs) => cs.includes(svc) ? cs.filter((c) => c !== svc) : [...cs, svc]);

  const route = () => {
    var text = note.trim(); if (!text) { window.__mtoast("Add a patient note first"); return; }
    var im = text.match(/\b([A-Z])\.?\s?([A-Z])\b/);
    var initials = im ? (im[1] + im[2]) : (text.match(/\b[A-Z][a-z]+\b/g) || ["A", "B"]).slice(0, 2).map(function (w) { return w[0]; }).join("");
    var issue = text.split(/[,.—;]/).slice(1).join(", ").trim() || text;
    var svcDef = ER_SERVICES.find((s) => s.svc === service) || ER_SERVICES[0];
    setSent(function (s) { return [{ initials: initials.toUpperCase().slice(0, 2), who: svcDef.who, svc: service, consults: consults.slice(), issue: issue.charAt(0).toUpperCase() + issue.slice(1), time: "now", status: "sent" }].concat(s); });
    setNote(""); setConsults([]);
    window.__mtoast("Routed to " + svcDef.who + " · " + service + (consults.length ? " (+" + consults.length + " consult" + (consults.length > 1 ? "s" : "") + ")" : ""));
  };

  const primary = ER_SERVICES.find((s) => s.svc === service) || ER_SERVICES[0];

  return (
    <div>
      <RHeader title="Intake" action={
        <button onClick={route} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 99, border: "none", background: "var(--primary)", color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}><MI name="plus" size={16} color="#fff" />Admit</button>} />
      <div style={{ padding: 16 }}>
        {/* AI intake card */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 15, boxShadow: "var(--shadow-sm)", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <MI name="sparkles" size={15} color="var(--primary)" />
            <span style={{ fontSize: 14, fontWeight: 700 }}>New admission</span>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type the admission note…"
            style={{ width: "100%", minHeight: 56, background: "var(--secondary)", borderRadius: 11, padding: "10px 12px", fontSize: 13.5, color: "var(--foreground)", lineHeight: 1.4, border: "none", outline: "none", resize: "none", fontFamily: "inherit", boxSizing: "border-box" }} />

          {/* Route to — primary service / provider type */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Route to</span>
              {primary.rr && <MBadge status="sent" icon="route">Round-robin</MBadge>}
            </div>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2, margin: "0 -2px" }}>
              {ER_SERVICES.map((s) => {
                const on = s.svc === service;
                return (
                  <button key={s.svc} onClick={() => setService(s.svc)} style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 99, cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
                    border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "var(--primary)" : "#fff", color: on ? "#fff" : "var(--foreground)" }}>
                    {s.svc}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, padding: "8px 10px", background: "var(--secondary)", borderRadius: 10 }}>
              <MAvatar initials={primary.initials} size={28} tint="blue" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>{primary.rr ? "Next up · " + primary.who : primary.who}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{service}{primary.rr ? " · lowest census" : " · on call"}</div>
              </div>
            </div>
          </div>

          {/* Add consults — multiple specialists */}
          <div style={{ marginTop: 13 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Add consults</span>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 7 }}>
              {ER_SERVICES.filter((s) => s.svc !== service).map((s) => {
                const on = consults.includes(s.svc);
                return (
                  <button key={s.svc} onClick={() => toggleConsult(s.svc)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 99, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                    border: on ? "1px solid var(--status-accepted)" : "1px solid var(--border)", background: on ? "var(--status-accepted-bg)" : "#fff", color: on ? "var(--status-accepted)" : "var(--muted-foreground)" }}>
                    <MI name={on ? "check" : "plus"} size={12} color={on ? "var(--status-accepted)" : "var(--muted-foreground)"} />{s.svc}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={route} style={{ width: "100%", marginTop: 14, height: 44, borderRadius: 12, border: "none", background: "var(--primary)", color: "#fff", fontSize: 14.5, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer" }}>
            <MI name="wand-sparkles" size={16} color="#fff" />Extract &amp; route to {service}
          </button>
        </div>

        <SectionLabel right={<MBadge status="sent">{sent.length} today</MBadge>}>Recently sent</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sent.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 13, boxShadow: "var(--shadow-sm)" }}>
              <MAvatar initials={s.initials} size={40} tint="slate" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.issue}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>→ {s.who} · {s.svc} · {s.time}</div>
                {s.consults && s.consults.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
                    {s.consults.map((c) => <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 99, background: "var(--status-active-bg)", color: "var(--status-active)" }}><MI name="stethoscope" size={9} />{c}</span>)}
                  </div>
                )}
              </div>
              <MBadge status={ST[s.status][0]}>{ST[s.status][1]}</MBadge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── ER director — ER operations ───────────── */
function ERDirectorScreen() {
  const [divert, setDivert] = React.useState(false);
  const docs = [
    { initials: "RO", name: "Dr. Ruth Osei", admits: 6, working: true },
    { initials: "PO", name: "Dr. Paul Okafor", admits: 4, working: true },
    { initials: "DR", name: "Dr. Dana Reyes", admits: 5, working: true },
    { initials: "SI", name: "Dr. Sam Iyer", admits: 0, working: false },
  ];
  return (
    <div>
      <RHeader title="ER ops" />
      <div style={{ padding: 16 }}>
        {/* diversion banner */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", borderRadius: 14, marginBottom: 16,
          background: divert ? "var(--status-rejected-bg)" : "var(--status-accepted-bg)", border: `1px solid ${divert ? "var(--status-rejected)" : "var(--status-accepted)"}` }}>
          <MI name={divert ? "octagon-alert" : "circle-check-big"} size={20} color={divert ? "var(--status-rejected)" : "var(--status-accepted)"} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: divert ? "var(--status-rejected)" : "var(--status-accepted)" }}>{divert ? "On diversion" : "Accepting patients"}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{divert ? "Ambulances diverted" : "Normal operations"}</div>
          </div>
          <button onClick={() => setDivert(!divert)} style={{ width: 46, height: 28, borderRadius: 99, border: "none", position: "relative", background: divert ? "var(--status-rejected)" : "var(--status-neutral-bg)", flex: "none" }}>
            <span style={{ position: "absolute", top: 3, left: divert ? 21 : 3, width: 22, height: 22, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <MiniTile label="Admits today" value="15" icon="clipboard-plus" />
          <MiniTile label="Avg accept" value="4m" icon="timer" color="var(--status-pending)" />
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <MiniTile label="Accept rate" value="92%" icon="check-check" color="var(--status-accepted)" />
          <MiniTile label="Pending" value="1" icon="loader" color="var(--status-neutral)" />
        </div>

        <SectionLabel right={<span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>3 on shift</span>}>ER physicians</SectionLabel>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          {docs.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 14px", borderTop: i ? "1px solid var(--border)" : "none", opacity: d.working ? 1 : 0.6 }}>
              <div style={{ position: "relative" }}>
                <MAvatar initials={d.initials} size={38} tint={d.working ? "blue" : "slate"} />
                <span style={{ position: "absolute", bottom: 0, right: 0, border: "2px solid #fff", borderRadius: 99 }}><Dot status={d.working ? "accepted" : "offline"} /></span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{d.admits} admit{d.admits === 1 ? "" : "s"} today</div>
              </div>
              <MBadge status={d.working ? "accepted" : "offline"}>{d.working ? "On" : "Off"}</MBadge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Hospitalist director — Overview ─────────────
   Full parity with the web director dashboard: shift providers on/off,
   take them in/out of round-robin, adjust census/cap, bulk on/off, add
   provider — with a live "next up = lowest-census eligible" queue. */

// Compact ± stepper for census / cap.
function MStepper({ label, value, onDec, onInc, min = 0 }) {
  const btn = (dis) => ({ width: 26, height: 26, borderRadius: 8, border: "1px solid var(--border)", background: dis ? "var(--secondary)" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: dis ? "default" : "pointer", opacity: dis ? 0.45 : 1 });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button onClick={() => value > min && onDec()} style={btn(value <= min)}><MI name="minus" size={13} color="var(--foreground)" /></button>
        <span style={{ fontSize: 15, fontWeight: 700, minWidth: 18, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <button onClick={onInc} style={btn(false)}><MI name="plus" size={13} color="var(--foreground)" /></button>
      </div>
    </div>
  );
}

// On/off pill toggle.
function MToggle({ on, onClick, color = "var(--status-accepted)" }) {
  return (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 99, border: "none", position: "relative", flex: "none", cursor: "pointer", background: on ? color : "var(--status-neutral-bg)", transition: "background .2s" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
    </button>
  );
}

const DIRECTOR_SEED = [
  { id: "p1", initials: "SC", name: "Dr. Sarah Chen", specialty: "Cardiology", census: 3, cap: 12, working: true, inRotation: true, shift: "Day call" },
  { id: "p2", initials: "AP", name: "Dr. Amir Patel", specialty: "Hospital Medicine", census: 5, cap: 12, working: true, inRotation: true, shift: "Day call" },
  { id: "p3", initials: "ML", name: "Dr. Maria Lopez", specialty: "Pulmonology", census: 7, cap: 10, working: true, inRotation: true, shift: "Swing" },
  { id: "p4", initials: "OH", name: "Dr. Omar Haddad", specialty: "Infectious Disease", census: 4, cap: 10, working: true, inRotation: false, shift: "Day call" },
  { id: "p5", initials: "LO", name: "Dr. Lena Ortiz", specialty: "Neurology", census: 6, cap: 12, working: true, inRotation: true, shift: "Nights" },
  { id: "p6", initials: "JL", name: "Dr. James Liu", specialty: "Nephrology", census: 2, cap: 8, working: false, inRotation: false, shift: "Off" },
];

function DirectorScreen() {
  const [providers, setProviders] = React.useState(DIRECTOR_SEED);
  const [syncLabel, setSyncLabel] = React.useState("2m ago");
  const [syncing, setSyncing] = React.useState(false);
  const syncNow = () => {
    setSyncing(true);
    setTimeout(() => { setSyncing(false); setSyncLabel("just now"); window.__mtoast && window.__mtoast("On-call schedule synced from Amion"); }, 900);
  };

  const update = (id, patch) => setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const adjust = (id, key, delta) => setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, [key]: Math.max(0, p[key] + delta) } : p)));
  const toggleWorking = (id) => setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, working: !p.working, inRotation: !p.working ? p.inRotation : false } : p)));
  const toggleRotation = (id) => setProviders((ps) => ps.map((p) => (p.id === id && p.working ? { ...p, inRotation: !p.inRotation } : p)));
  const bulk = (val) => setProviders((ps) => ps.map((p) => ({ ...p, working: val, inRotation: val ? p.inRotation : false })));

  const onShift = providers.filter((p) => p.working);
  const eligible = providers.filter((p) => p.working && p.inRotation);
  // Round-robin: lowest census on shift & in rotation is next; ties broken by roster order.
  const queue = [...eligible].sort((a, b) => a.census - b.census || providers.indexOf(a) - providers.indexOf(b));
  const nextUp = queue[0];
  const totalCensus = providers.reduce((a, p) => a + p.census, 0);
  const totalCap = providers.reduce((a, p) => a + p.cap, 0);
  const allOn = providers.length > 0 && onShift.length === providers.length;
  const allOff = onShift.length === 0;

  return (
    <div>
      <RHeader title="Overview" sub="Hospitalist group · Mayo General" action={
        <button onClick={() => window.__mtoast("Add provider")} style={{ width: 38, height: 38, borderRadius: 99, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flex: "none" }}>
          <MI name="user-plus" size={17} color="var(--primary)" />
        </button>} />
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <MiniTile label="On shift" value={onShift.length} icon="activity" color="var(--status-accepted)" />
          <MiniTile label="In rotation" value={eligible.length} icon="route" color="var(--status-pending)" />
          <MiniTile label="Census" value={totalCensus + "/" + totalCap} icon="bed-double" color="var(--status-neutral)" />
        </div>

        {/* on-call schedule — synced from Amion via API */}
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name="calendar-clock" size={18} color="var(--primary)" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>On-call schedule
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "var(--status-accepted)", background: "var(--status-accepted-bg)", padding: "2px 7px", borderRadius: 99 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--status-accepted)", flex: "none" }} />Amion</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Synced via API · {syncLabel}</div>
            </div>
            <button onClick={syncNow} disabled={syncing} style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 11px", borderRadius: 99, border: "1px solid var(--border)", background: "#fff", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: syncing ? "default" : "pointer", flex: "none", color: "var(--foreground)", opacity: syncing ? 0.6 : 1 }}>
              <span style={{ display: "inline-flex", animation: syncing ? "dt-spin .9s linear infinite" : "none" }}><MI name="refresh-cw" size={13} color="var(--primary)" /></span>{syncing ? "Syncing" : "Sync"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            {[["Day call", "amber"], ["Swing", "blue"], ["Nights", "slate"]].map(([label, tint]) => {
              const c = { amber: "var(--status-pending)", blue: "var(--primary)", slate: "var(--status-neutral)" }[tint];
              const n = providers.filter((p) => p.shift === label).length;
              return (
                <div key={label} style={{ flex: 1, borderRadius: 11, border: "1px solid var(--border)", padding: "9px 10px", background: "var(--secondary)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: c, flex: "none" }} /><span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{n}</span></div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>{label}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 11, fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
            <MI name="info" size={13} color="var(--muted-foreground)" style={{ marginTop: 1 }} />Rotation pool follows the live schedule. Toggle a provider below to override locally for this shift.
          </div>
        </div>

        {/* bulk shift controls */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button onClick={() => bulk(true)} disabled={allOn} style={{ flex: 1, height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: allOn ? "default" : "pointer", opacity: allOn ? 0.45 : 1, color: "var(--foreground)" }}>
            <MI name="toggle-right" size={16} color="var(--status-accepted)" />All on shift
          </button>
          <button onClick={() => bulk(false)} disabled={allOff} style={{ flex: 1, height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: allOff ? "default" : "pointer", opacity: allOff ? 0.45 : 1, color: "var(--foreground)" }}>
            <MI name="toggle-left" size={16} color="var(--status-neutral)" />All off
          </button>
        </div>

        {/* round-robin queue */}
        <SectionLabel right={<MBadge status="sent">{queue.length} in queue</MBadge>}>Round-robin order</SectionLabel>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", padding: 14, marginBottom: 20 }}>
          {nextUp ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 12, color: "var(--muted-foreground)" }}>
                <MI name="info" size={13} color="var(--muted-foreground)" />Next admit → lowest-census eligible provider
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {queue.map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: i === 0 ? "9px 11px" : "5px 11px 5px 0",
                    borderRadius: 11, background: i === 0 ? "var(--primary-tint, #EFF6FF)" : "transparent", border: i === 0 ? "1px solid var(--primary)" : "1px solid transparent" }}>
                    <span style={{ width: 22, fontSize: 13, fontWeight: 700, color: i === 0 ? "var(--primary)" : "var(--muted-foreground)", textAlign: "center", flex: "none" }}>{i + 1}</span>
                    <MAvatar initials={p.initials} size={i === 0 ? 38 : 32} tint={i === 0 ? "blue" : "slate"} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>{p.name}{i === 0 && <MBadge status="sent">Next</MBadge>}</div>
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{p.specialty} · {p.census}/{p.cap}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "10px 0", color: "var(--muted-foreground)" }}>
              <MI name="route-off" size={20} color="var(--muted-foreground)" />
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>No one in rotation</div>
              <div style={{ fontSize: 12 }}>Put a provider on shift &amp; in rotation.</div>
            </div>
          )}
        </div>

        {/* full roster — editable */}
        <SectionLabel right={<span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{providers.length} providers</span>}>Providers</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {providers.map((p) => {
            const isNext = nextUp && p.id === nextUp.id;
            return (
              <div key={p.id} style={{ background: "#fff", borderRadius: 14, border: `1px solid ${isNext ? "var(--primary)" : "var(--border)"}`, boxShadow: "var(--shadow-sm)", padding: 12, opacity: p.working ? 1 : 0.62 }}>
                <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
                  <div style={{ position: "relative", flex: "none" }}>
                    <MAvatar initials={p.initials} size={38} tint={p.working ? "emerald" : "slate"} />
                    <span style={{ position: "absolute", bottom: 0, right: 0, border: "2px solid #fff", borderRadius: 99 }}><Dot status={p.working ? "accepted" : "offline"} pulse={p.working} /></span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>{p.name}{isNext && <MBadge status="sent">Next</MBadge>}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6 }}>{p.specialty}{p.shift && p.shift !== "Off" && <><span style={{ opacity: 0.5 }}>·</span><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><MI name="calendar-clock" size={10} color="var(--muted-foreground)" />{p.shift}</span></>}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: "none" }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Shift</span>
                    <MToggle on={p.working} onClick={() => toggleWorking(p.id)} />
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
                  <MStepper label="Census" value={p.census} onDec={() => adjust(p.id, "census", -1)} onInc={() => adjust(p.id, "census", 1)} />
                  <MStepper label="Cap" value={p.cap} onDec={() => adjust(p.id, "cap", -1)} onInc={() => adjust(p.id, "cap", 1)} min={1} />
                  <button onClick={() => toggleRotation(p.id)} disabled={!p.working} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 99, cursor: p.working ? "pointer" : "default", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                    border: `1px solid ${p.inRotation ? "var(--primary)" : "var(--border)"}`, background: p.inRotation ? "var(--primary-tint, #EFF6FF)" : "#fff", color: p.inRotation ? "var(--primary)" : "var(--muted-foreground)", opacity: p.working ? 1 : 0.6 }}>
                    <MI name={p.inRotation ? "route" : "route-off"} size={13} color={p.inRotation ? "var(--primary)" : "var(--muted-foreground)"} />{p.inRotation ? "In rotation" : "Off rotation"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Developer — impersonation (mirror a user's portal) ───────────── */
const IMPERSONATE_TARGETS = [
  { role: "hospitalist", name: "Dr. Jordan Chen", initials: "JC", sub: "Hospitalist · Mayo General", tint: "blue" },
  { role: "er_doctor", name: "Dr. Ruth Osei", initials: "RO", sub: "ER physician · St. Jude", tint: "amber" },
  { role: "director", name: "Karen Vance", initials: "KV", sub: "Hospitalist director · Mayo", tint: "emerald" },
];

function ImpersonationView({ target, onExit }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* dev banner — always visible while mirroring */}
      <div style={{ background: "#0F766E", color: "#fff", padding: "52px 14px 11px", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 30 }}>
        <MI name="eye" size={17} color="#fff" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Viewing as {target.name}</div>
          <div style={{ fontSize: 11.5, opacity: 0.85 }}>Read-only mirror · audited</div>
        </div>
        <button onClick={onExit} style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 13px", borderRadius: 99, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", flex: "none" }}><MI name="x" size={14} color="#fff" />Exit</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", background: "#F2F4F8", pointerEvents: "none" }}>{roleHome(target.role)}</div>
    </div>
  );
}

/* ───────────── Developer — incidents / on-call paging ─────────────
   The dev's comms surface — not clinical messaging. System & security incidents
   they get paged on, with acknowledge / resolve. */
function DevIncidentsScreen() {
  const SEV = { sev1: ["rejected", "SEV-1"], sev2: ["pending", "SEV-2"], sev3: ["sent", "SEV-3"] };
  const [items, setItems] = React.useState([
    { id: "i1", sev: "sev1", title: "WebSocket reconnect storm", detail: "Cleveland Care · push fan-out degraded", time: "3m", state: "open" },
    { id: "i2", sev: "sev2", title: "DB pool saturation 88%", detail: "Primary · approaching connection cap", time: "21m", state: "ack" },
    { id: "i3", sev: "sev3", title: "Push delivery failures → SMS", detail: "Pinecrest · FCM token churn", time: "54m", state: "open" },
    { id: "i4", sev: "sev2", title: "Elevated 5xx on /api/assignments", detail: "Mayo General · 0.4% error rate", time: "1h", state: "ack" },
  ]);
  const [resolved, setResolved] = React.useState([
    { id: "r1", sev: "sev3", title: "Cron lag on rotation recompute", detail: "St. Jude · cleared", time: "2h" },
  ]);
  const open = items.filter((i) => i.state === "open");
  const ack = (id) => setItems((xs) => xs.map((i) => (i.id === id ? { ...i, state: "ack" } : i)));
  const resolve = (id) => setItems((xs) => { const it = xs.find((i) => i.id === id); if (it) setResolved((r) => [{ ...it, detail: it.detail.split(" · ")[0] + " · cleared", time: "now" }, ...r]); return xs.filter((i) => i.id !== id); });
  return (
    <div>
      <RHeader title="Incidents" sub="Platform paging · cross-tenant" action={<MBadge status={open.length ? "rejected" : "accepted"} icon={open.length ? "siren" : "circle-check-big"}>{open.length ? open.length + " open" : "All clear"}</MBadge>} />
      <div style={{ padding: 16 }}>
        <SectionLabel right={<span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{items.length} active</span>}>Active</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {items.map((it) => (
            <div key={it.id} style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", padding: 13, borderLeft: `3px solid ${it.sev === "sev1" ? "var(--status-rejected)" : it.sev === "sev2" ? "var(--status-pending)" : "var(--status-active)"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <MBadge status={SEV[it.sev][0]}>{SEV[it.sev][1]}</MBadge>
                {it.state === "ack" && <MBadge status="offline" icon="eye">Acked</MBadge>}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted-foreground)", display: "inline-flex", alignItems: "center", gap: 3 }}><MI name="clock" size={11} />{it.time}</span>
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>{it.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 1 }}>{it.detail}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                {it.state === "open" && <button onClick={() => ack(it.id)} style={{ flex: 1, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", color: "var(--foreground)" }}><MI name="eye" size={14} />Acknowledge</button>}
                <button onClick={() => resolve(it.id)} style={{ flex: 1, height: 36, borderRadius: 10, border: "none", background: "var(--primary)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer" }}><MI name="check" size={14} color="#fff" />Resolve</button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid var(--border)", padding: 26, textAlign: "center" }}>
              <MI name="circle-check-big" size={24} color="var(--status-accepted)" />
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>All clear</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No active incidents across tenants.</div>
            </div>
          )}
        </div>

        <SectionLabel right={<span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{resolved.length}</span>}>Recently resolved</SectionLabel>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          {resolved.map((it, i) => (
            <div key={it.id} style={{ display: "flex", gap: 11, alignItems: "center", padding: "11px 14px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <span style={{ width: 30, height: 30, borderRadius: 99, background: "var(--status-accepted-bg)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name="check" size={15} color="var(--status-accepted)" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{it.detail}</div>
              </div>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)", flex: "none" }}>{it.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Developer — diagnostics & audit logs ───────────── */
function DevLogsScreen() {
  const FILTERS = ["All", "Audit", "PHI", "Errors"];
  const [filter, setFilter] = React.useState("All");
  const logs = [
    { kind: "PHI", icon: "file-lock-2", color: "var(--status-pending)", action: "PHI access · patient 4182", who: "Alex Kim (dev)", org: "MAYO", time: "12:04:51" },
    { kind: "Errors", icon: "triangle-alert", color: "var(--status-rejected)", action: "WS reconnect storm", who: "system", org: "CLEVE", time: "11:58:20" },
    { kind: "Audit", icon: "shield-check", color: "var(--status-accepted)", action: "Reassign override", who: "Karen Vance", org: "MAYO", time: "11:46:09" },
    { kind: "Audit", icon: "log-in", color: "var(--primary)", action: "Login · TOTP + SMS", who: "Dr. Ruth Osei", org: "STJUDE", time: "11:31:55" },
    { kind: "PHI", icon: "file-lock-2", color: "var(--status-pending)", action: "Chart export", who: "Dr. Amir Patel", org: "MAYO", time: "11:12:33" },
    { kind: "Errors", icon: "triangle-alert", color: "var(--status-rejected)", action: "Push delivery failed → SMS", who: "system", org: "PINE", time: "10:59:01" },
    { kind: "Audit", icon: "route", color: "var(--primary)", action: "Round-robin config changed", who: "Karen Vance", org: "MAYO", time: "10:40:18" },
  ];
  const list = filter === "All" ? logs : logs.filter((l) => l.kind === filter);
  return (
    <div>
      <RHeader title="Logs" sub="Diagnostics · audit · PHI access" />
      <div style={{ padding: "12px 16px 16px" }}>
        <div style={{ display: "flex", gap: 7, marginBottom: 14, overflowX: "auto" }}>
          {FILTERS.map((f) => {
            const on = f === filter;
            return <button key={f} onClick={() => setFilter(f)} style={{ padding: "6px 14px", borderRadius: 99, border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "var(--primary)" : "#fff", color: on ? "#fff" : "var(--foreground)", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer", flex: "none" }}>{f}</button>;
          })}
        </div>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          {list.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 11, alignItems: "center", padding: "11px 14px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MI name={l.icon} size={16} color={l.color} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.action}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{l.who} · {l.org}</div>
              </div>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums", flex: "none" }}>{l.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Developer — Platform ───────────── */
function DeveloperScreen() {
  const [impersonating, setImpersonating] = React.useState(null);
  const orgs = [
    { code: "MA", name: "Mayo General", users: 142, active: true, tint: "blue" },
    { code: "ST", name: "St. Jude Medical", users: 96, active: true, tint: "emerald" },
    { code: "CL", name: "Cleveland Care", users: 211, active: true, tint: "amber" },
    { code: "PI", name: "Pinecrest Regional", users: 38, active: false, tint: "slate" },
  ];
  const health = [["API latency", 78, "var(--status-accepted)"], ["WebSocket", 64, "var(--primary)"], ["DB pool", 88, "var(--status-pending)"]];
  if (impersonating) return <ImpersonationView target={impersonating} onExit={() => setImpersonating(null)} />;
  return (
    <div>
      <RHeader title="Platform" sub="Cross-tenant operations" />
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <MiniTile label="Tenants" value="5" icon="building-2" />
          <MiniTile label="Users" value="554" icon="users" color="var(--status-accepted)" />
          <MiniTile label="Uptime" value="99.9%" icon="activity" color="var(--status-neutral)" />
        </div>

        <SectionLabel>System health</SectionLabel>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", padding: 14, boxShadow: "var(--shadow-sm)", marginBottom: 18, display: "flex", flexDirection: "column", gap: 11 }}>
          {health.map(([l, v, c], i) => (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                <span style={{ color: "var(--muted-foreground)" }}>{l}</span><span style={{ fontWeight: 600 }}>{v}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: "var(--secondary)", overflow: "hidden" }}>
                <div style={{ width: `${v}%`, height: "100%", background: c }} />
              </div>
            </div>
          ))}
        </div>

        <SectionLabel right={<span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>5 orgs</span>}>Organizations</SectionLabel>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "var(--shadow-sm)", marginBottom: 20 }}>
          {orgs.map((o, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 14px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <MAvatar initials={o.code} size={36} tint={o.tint} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{o.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{o.users} users</div>
              </div>
              <MBadge status={o.active ? "accepted" : "offline"}>{o.active ? "Active" : "Off"}</MBadge>
            </div>
          ))}
        </div>

        {/* impersonation — mirror a user's portal for troubleshooting */}
        <SectionLabel right={<MBadge status="pending" icon="shield">Audited</MBadge>}>Impersonate</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 2px 10px", fontSize: 12, color: "var(--muted-foreground)" }}>
          <MI name="info" size={13} color="var(--muted-foreground)" />Open a user's portal read-only to reproduce an issue.
        </div>
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          {IMPERSONATE_TARGETS.map((t, i) => (
            <button key={t.role} onClick={() => setImpersonating(t)} style={{ width: "100%", textAlign: "left", display: "flex", gap: 12, alignItems: "center", padding: "11px 14px", borderTop: i ? "1px solid var(--border)" : "none", background: "transparent", border: "none", borderTopColor: "var(--border)", cursor: "pointer", fontFamily: "var(--font-sans)" }}>
              <MAvatar initials={t.initials} size={36} tint={t.tint} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{t.sub}</div>
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: "#0F766E", flex: "none" }}><MI name="eye" size={14} color="#0F766E" />View as</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* role → { home screen, tab set }. Every role shares Messages / On-call / Directory /
   Profile (condensed, mirrors the web app); only the home tab differs. */
const SHARED_TABS = [["messages", "Messages", "message-square"], ["team", "On call", "users"], ["directory", "Directory", "contact"], ["profile", "Profile", "user"]];
const ROLE_CONFIG = {
  hospitalist: { label: "Hospitalist", tint: "#2563EB", tabs: [["home", "Dashboard", "layout-dashboard"]].concat(SHARED_TABS) },
  er_doctor:   { label: "ER physician", tint: "#D97706", tabs: [["home", "Intake", "clipboard-plus"]].concat(SHARED_TABS) },
  er_director: { label: "ER director", tint: "#DC2626", tabs: [["home", "ER ops", "ambulance"]].concat(SHARED_TABS) },
  director:    { label: "Hospitalist director", tint: "#7C3AED", tabs: [["home", "Overview", "layout-dashboard"]].concat(SHARED_TABS) },
  // Developer has no clinical shift, directory, or person-to-person messaging.
  // Their surface is operational: Platform (orgs/health/impersonate), Incidents
  // (paging), Logs (audit/diagnostics), Profile.
  developer:   { label: "Developer", tint: "#0F766E", tabs: [["home", "Platform", "building-2"], ["incidents", "Incidents", "siren"], ["logs", "Logs", "scroll-text"], ["profile", "Profile", "user"]] },
};

const GALLERY_CONVOS = [
  { id: 1, name: "Dr. Sarah Chen", initials: "SC", status: "accepted", preview: "Accepting the 412 hand-off now.", time: "2m", unread: 2, tint: "emerald" },
  { id: 2, name: "ICU Care Team", initials: "IC", status: "accepted", preview: "Bed 3 is open for the next admit.", time: "14m", unread: 0, tint: "blue", group: true },
  { id: 3, name: "Dr. Amir Patel", initials: "AP", status: "pending", preview: "On my way up — give me 5.", time: "1h", unread: 0, tint: "amber" },
  { id: 4, name: "Emergency broadcast", initials: "!", status: "rejected", preview: "Mass casualty drill at 14:00.", time: "3h", unread: 0, tint: "slate", group: true },
];

const ROLE_PROFILE = {
  hospitalist: { name: "Dr. Jordan Chen", role: "Hospitalist · Cardiology", initials: "JC", org: "Mercy General · MERCY" },
  er_doctor:   { name: "Dr. Ruth Osei", role: "ER physician", initials: "RO", org: "St. Jude Medical · STJUDE" },
  er_director: { name: "Dr. Paul Okafor", role: "ER director", initials: "PO", org: "Cleveland Care · CLEVE" },
  director:    { name: "Karen Vance", role: "Hospitalist director", initials: "KV", org: "Mayo General · MAYO" },
  developer:   { name: "Alex Kim", role: "Platform developer", initials: "AK", org: "All organizations" },
};

function HospitalistHome() {
  const [pending, setPending] = React.useState([
    { id: "a1", initials: "RM", room: "318", complaint: "Acute abdominal pain", via: "Round-robin", specialty: "General Med", expires: "4:32" },
    { id: "a2", initials: "TK", room: "205", complaint: "Diabetic ketoacidosis", via: "Manual", specialty: "Endocrine", expires: "7:10" },
  ]);
  const [census, setCensus] = React.useState(3);
  const [working, setWorking] = React.useState(true);
  const accept = (id) => { setPending((ps) => ps.filter((p) => p.id !== id)); setCensus((c) => c + 1); };
  const decline = (id) => setPending((ps) => ps.filter((p) => p.id !== id));
  return <DashboardScreen pending={pending} onAccept={accept} onDecline={decline} working={working} setWorking={setWorking} census={census} />;
}

function roleTab(role, tab) {
  if (tab === "messages") return <MessagesScreen convos={GALLERY_CONVOS} />;
  if (tab === "incidents") return <DevIncidentsScreen />;
  if (tab === "logs") return <DevLogsScreen />;
  if (tab === "team") return <TeamScreen providers={[]} />;
  if (tab === "directory") return <DirectoryScreen providers={[]} />;
  if (tab === "profile") return <ProfileScreen profile={ROLE_PROFILE[role]} />;
  return roleHome(role);
}

function RoleTabBar({ tabs, active, onTab, badge }) {
  return (
    <div style={{ position: "sticky", bottom: 0, zIndex: 10, display: "flex", background: "rgba(255,255,255,.94)", backdropFilter: "blur(12px)", borderTop: "1px solid var(--border)", padding: "8px 6px 26px" }}>
      {tabs.map(([id, label, icon]) => {
        const on = active === id;
        return (
          <button key={id} onClick={() => onTab && onTab(id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "4px 0", position: "relative", border: "none", background: "transparent", cursor: "pointer" }}>
            <span style={{ position: "relative" }}>
              <MI name={icon} size={23} color={on ? "var(--primary)" : "var(--status-neutral)"} strokeWidth={on ? 2.4 : 2} />
              {id === "messages" && badge > 0 && <span style={{ position: "absolute", top: -4, right: -7, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 99, background: "var(--destructive)", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: on ? "var(--primary)" : "var(--status-neutral)" }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function roleHome(role) {
  if (role === "er_doctor") return <ERIntakeScreen />;
  if (role === "er_director") return <ERDirectorScreen />;
  if (role === "director") return <DirectorScreen />;
  if (role === "developer") return <DeveloperScreen />;
  return <HospitalistHome />;
}

Object.assign(window, { ERIntakeScreen, ERDirectorScreen, DirectorScreen, DeveloperScreen, DevLogsScreen, DevIncidentsScreen, ImpersonationView, ROLE_CONFIG, RoleTabBar, roleHome, roleTab, RHeader });
