/* DocTurn web-app UI kit — ER physician dashboard (intake + assign + reassign).
   Routes a patient to a primary hospitalist (round-robin or manual) and can add
   one or more consult services. Recently-sent keeps a 2-day history, including
   accepted hand-offs, and lets the ER provider reassign at any time. */

const CONSULT_OPTIONS = ["Hospital Medicine", "Cardiology", "GI", "Pulmonology", "Nephrology", "Endocrine", "Infectious Disease", "Neurology"];

// On-call provider per consult service (the group's current attending of record).
const CONSULT_ROSTER = {
  "Hospital Medicine":  { name: "Dr. Amir Patel",   avatar: "AP", onCall: true },
  "Cardiology":         { name: "Dr. Sarah Chen",   avatar: "SC", onCall: true },
  "GI":                 { name: "Dr. Ruth Kim",     avatar: "RK", onCall: true },
  "Pulmonology":        { name: "Dr. Maria Lopez",  avatar: "ML", onCall: true },
  "Nephrology":         { name: "Dr. James Liu",    avatar: "JL", onCall: false },
  "Endocrine":          { name: "Dr. Nadia Farouk", avatar: "NF", onCall: true },
  "Infectious Disease": { name: "Dr. Omar Haddad",  avatar: "OH", onCall: true },
  "Neurology":          { name: "Dr. Lena Ortiz",   avatar: "LO", onCall: true },
};
// Midlevels (NP/PA) the ER can add onto a consult.
const MIDLEVEL_POOL = [
  { id: "ml1", name: "Priya Shah, NP",   avatar: "PS", role: "NP" },
  { id: "ml2", name: "Marcus Bell, PA-C", avatar: "MB", role: "PA" },
  { id: "ml3", name: "Jordan Wu, PA-C",   avatar: "JW", role: "PA" },
  { id: "ml4", name: "Nina Roy, NP",      avatar: "NR", role: "NP" },
];

function ChannelPill({ on, icon, label, onClick }) {
  return (
    <button onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", transition: "all .12s", whiteSpace: "nowrap",
        border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "var(--primary-tint, #EFF6FF)" : "#fff", color: on ? "var(--primary)" : "var(--muted-foreground)" }}>
      <Icon name={icon} size={12} />{label}
    </button>
  );
}

function ConsultRowLabel({ children }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".05em", width: 58, flex: "none", paddingTop: 5 }}>{children}</span>;
}

function ConsultPanel({ service, roster, pool, members, channels, onAddMember, onRemoveMember, onToggleChannel, onRemoveService }) {
  const [adding, setAdding] = React.useState(false);
  const r = roster || { name: "On-call provider", avatar: "?", onCall: true };
  const addable = pool.filter((m) => !members.some((x) => x.id === m.id));
  const noChannel = !channels.app && !channels.text;
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "#fff", overflow: "hidden" }}>
      {/* header band: service + on-call provider */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", background: "#DBEAFE", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name="stethoscope" size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>{service}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            <StatusDot status={r.onCall ? "online" : "offline"} pulse={r.onCall} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name} · {r.onCall ? "on call" : "covering provider paged"}</span>
          </div>
        </div>
        <Avatar initials={r.avatar} size={30} tint="blue" />
        <button onClick={onRemoveService} title="Remove consult"
          onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
          style={{ width: 26, height: 26, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="x" size={15} /></button>
      </div>

      {/* body: two aligned labeled rows */}
      <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 11 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <ConsultRowLabel>Unit</ConsultRowLabel>
          <div style={{ flex: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            {members.length === 0 && <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", paddingTop: 3 }}>Provider only</span>}
            {members.map((m) => (
              <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--secondary)", borderRadius: "var(--radius-full)", padding: "3px 8px 3px 4px" }}>
                <Avatar initials={m.avatar} size={20} tint={(window.TEAM_ROLE[m.role] || {}).tint || "slate"} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{m.name.split(",")[0]}</span>
                <RolePill role={m.role} />
                <button onClick={() => onRemoveMember(m.id)} style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", color: "var(--muted-foreground)", padding: 0 }}><Icon name="x" size={12} /></button>
              </span>
            ))}
            {addable.length > 0 && (
              <button onClick={() => setAdding(!adding)}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", border: "1px dashed var(--border)", background: "#fff", color: "var(--primary)" }}>
                <Icon name={adding ? "x" : "plus"} size={12} />{adding ? "Close" : "Add PA / NP"}
              </button>
            )}
          </div>
        </div>

        {adding && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)", padding: 6, marginLeft: 68 }}>
            {addable.map((m) => (
              <button key={m.id} onClick={() => { onAddMember(m); if (addable.length === 1) setAdding(false); }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#fff"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", border: "none", borderRadius: "var(--radius-md)", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                <Avatar initials={m.avatar} size={26} tint={(window.TEAM_ROLE[m.role] || {}).tint || "slate"} />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{m.name}<RolePill role={m.role} /></span>
                <Icon name="plus" size={14} color="var(--primary)" />
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ConsultRowLabel>Notify</ConsultRowLabel>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", paddingTop: 0 }}>
            <ChannelPill on={channels.app} icon="smartphone" label="App push" onClick={() => onToggleChannel("app")} />
            <ChannelPill on={channels.text} icon="message-square" label="Text / SMS" onClick={() => onToggleChannel("text")} />
            {noChannel && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--status-pending)", fontWeight: 600 }}><Icon name="alert-triangle" size={12} />Won't be paged</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReassignSelect({ providers, onPick }) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <Icon name="repeat" size={13} color="var(--muted-foreground)" style={{ position: "absolute", left: 10, pointerEvents: "none" }} />
      <select value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
        style={{ appearance: "none", WebkitAppearance: "none", height: 32, padding: "0 26px 0 28px", borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)", background: "#fff", fontSize: 12.5, fontWeight: 600, color: "var(--foreground)",
          fontFamily: "var(--font-sans)", cursor: "pointer" }}>
        <option value="">Reassign…</option>
        {providers.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
      </select>
      <Icon name="chevron-down" size={13} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
    </div>
  );
}

// Intake + routing panel — the ER physician's primary action (write the note,
// extract, route, send). Self-contained (no PageWrap) so it can be a draggable
// dashboard widget.
function IntakeRoutingPanel({ providers, onSend }) {
  const [note, setNote] = React.useState("");
  const [extracted, setExtracted] = React.useState(false);
  const [fields, setFields] = React.useState({ initials: "", room: "", complaint: "", specialty: "" });
  const [mode, setMode] = React.useState("quick"); // quick | manual
  const [manual, setManual] = React.useState(""); // selected provider id (empty until chosen)
  const [consults, setConsults] = React.useState([]);
  const [consultMembers, setConsultMembers] = React.useState({});
  const [consultChannels, setConsultChannels] = React.useState({});
  const chOf = (s) => consultChannels[s] || { app: true, text: true };

  const runExtract = () => {
    const r = window.extractIntake(note);
    if (r.empty) {
      setFields({ initials: "SC", room: "412", complaint: "Chest pain, SOB on exertion", specialty: "Cardiology" });
      setConsults(["Cardiology"]);
    } else {
      setFields({ initials: r.initials, room: r.room, complaint: r.complaint, specialty: r.specialty });
      setConsults(r.consults);
    }
    setExtracted(true);
  };
  const reset = () => { setNote(""); setExtracted(false); setConsults([]); setConsultMembers({}); setConsultChannels({}); setFields({ initials: "", room: "", complaint: "", specialty: "" }); };
  const toggleConsult = (s) => setConsults((c) => {
    if (c.includes(s)) {
      setConsultMembers((cm) => { const n = Object.assign({}, cm); delete n[s]; return n; });
      setConsultChannels((cc) => { const n = Object.assign({}, cc); delete n[s]; return n; });
      return c.filter((x) => x !== s);
    }
    return [...c, s];
  });
  const addConsultMember = (s, m) => setConsultMembers((cm) => Object.assign({}, cm, { [s]: [...(cm[s] || []), m] }));
  const removeConsultMember = (s, id) => setConsultMembers((cm) => Object.assign({}, cm, { [s]: (cm[s] || []).filter((x) => x.id !== id) }));
  const toggleChannel = (s, ch) => setConsultChannels((cc) => Object.assign({}, cc, { [s]: Object.assign({}, chOf(s), { [ch]: !chOf(s)[ch] }) }));

  // Providers may be empty on a cold load (before the rotation pool hydrates),
  // so derive defensively and never index into an empty array.
  const list = providers || [];
  const nextUp = list[0];
  const manualId = manual || (nextUp && nextUp.id);
  const target = mode === "quick" ? nextUp : (list.find((p) => p.id === manualId) || nextUp);

  const canSend = !!(fields.initials && fields.room && target);
  const doSend = () => {
    if (!canSend) return;
    onSend(target, fields, consults);
    reset();
  };

  if (!nextUp) {
    return (
      <Card style={{ padding: 24 }}>
        <SectionTitle>Route assignment</SectionTitle>
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start", marginTop: 8 }}>
          <Icon name="users-round" size={18} color="var(--muted-foreground)" style={{ marginTop: 1 }} />
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            No hospitalist providers are available yet. Once providers are added to the rotation (or imported from a schedule sync), you can route patients here.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <React.Fragment>
      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Intake */}
        <Card style={{ padding: 18 }}>
          <SectionTitle>New patient intake</SectionTitle>
          <Field textarea rows={4} label="Intake note" placeholder="Paste or type free‑text notes — AI extracts structured fields…"
            value={note} onChange={setNote} help="No real PHI — synthetic examples only (e.g. initials)." />
          <div style={{ display: "flex", gap: 8, margin: "12px 0 4px" }}>
            <Button variant="secondary" size="sm" icon="sparkles" onClick={runExtract}>Extract with AI</Button>
            {(extracted || fields.initials || fields.room || fields.complaint) && <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={reset}>Clear</Button>}
          </div>

          {/* Patient details — always editable; AI extract just fills them in. */}
          <div style={{ marginTop: 14, paddingTop: 16, borderTop: "1px dashed var(--border)", display: "flex", flexDirection: "column", gap: 14 }}>
            {extracted && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--status-accepted)", fontWeight: 600 }}>
                <Icon name="sparkles" size={13} /> Extracted from note · review &amp; edit before sending
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Patient initials" icon="user" value={fields.initials} onChange={(v) => setFields({ ...fields, initials: v.toUpperCase().slice(0, 3) })} placeholder="e.g. JS" />
              <Field label="Room / location" icon="door-open" value={fields.room} onChange={(v) => setFields({ ...fields, room: v })} placeholder="e.g. 412, Hall, Bay A, Disaster" />
            </div>
            <Field label="Chief complaint" icon="clipboard-list" value={fields.complaint} onChange={(v) => setFields({ ...fields, complaint: v })} placeholder="Reason for admission" />
          </div>
        </Card>

        {/* Routing */}
        <Card style={{ padding: 18 }}>
          <SectionTitle>Route assignment</SectionTitle>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setMode("quick")} style={tabStyle(mode === "quick")}>
              <Icon name="zap" size={15} /> Quick (round‑robin)
            </button>
            <button onClick={() => setMode("manual")} style={tabStyle(mode === "manual")}>
              <Icon name="user-check" size={15} /> Manual
            </button>
          </div>

          {mode === "quick" ? (
            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "var(--radius-md)", padding: 14, display: "flex", gap: 11, alignItems: "flex-start" }}>
              <Icon name="route" size={18} color="var(--primary)" />
              <div style={{ fontSize: 13, color: "#1e3a8a", lineHeight: 1.5 }}>
                Routes to the <b>lowest‑census</b> eligible hospitalist on shift. Next up:{" "}
                <b>{nextUp.name}</b> ({nextUp.census}/{nextUp.cap}).
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {providers.map((p) => (
                <button key={p.id} onClick={() => setManual(p.id)}
                  style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: "var(--radius-md)", cursor: "pointer", textAlign: "left",
                    border: `1px solid ${manualId === p.id ? "var(--primary)" : "var(--border)"}`, background: manualId === p.id ? "#EFF6FF" : "#fff" }}>
                  <Avatar initials={p.avatar} size={32} tint={p.working ? "emerald" : "slate"} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{p.specialty} · {p.census}/{p.cap}</div>
                  </div>
                  <StatusDot status={p.working ? "online" : "offline"} />
                </button>
              ))}
            </div>
          )}

          {/* Consult services — multi-select */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px dashed var(--border)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 10 }}>
              <Icon name="users-round" size={15} color="var(--muted-foreground)" style={{ alignSelf: "center" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Consult services</span>
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>optional · select multiple</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {CONSULT_OPTIONS.map((s) => {
                const on = consults.includes(s);
                return (
                  <button key={s} onClick={() => toggleConsult(s)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: "var(--radius-full)",
                      fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
                      border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`, background: on ? "#EFF6FF" : "#fff",
                      color: on ? "var(--primary)" : "var(--foreground)" }}>
                    <Icon name={on ? "check" : "plus"} size={12} /> {s}
                  </button>
                );
              })}
            </div>

            {consults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                {consults.map((s) => (
                  <ConsultPanel key={s} service={s} roster={CONSULT_ROSTER[s]} pool={MIDLEVEL_POOL}
                    members={consultMembers[s] || []} channels={chOf(s)}
                    onAddMember={(m) => addConsultMember(s, m)} onRemoveMember={(id) => removeConsultMember(s, id)}
                    onToggleChannel={(ch) => toggleChannel(s, ch)} onRemoveService={() => toggleConsult(s)} />
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            <Button full icon="send" onClick={doSend} style={{ opacity: canSend ? 1 : 0.5, pointerEvents: canSend ? "auto" : "none" }}>
              Send assignment{consults.length ? ` + ${consults.length} consult${consults.length > 1 ? "s" : ""}` : ""}
            </Button>
            {!canSend && <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8, textAlign: "center" }}>Add patient initials &amp; room to send.</div>}
          </div>
        </Card>
      </div>
    </React.Fragment>
  );

  function tabStyle(active) {
    return { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 10px",
      borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13, fontWeight: 500,
      border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
      background: active ? "#EFF6FF" : "#fff", color: active ? "var(--primary)" : "var(--foreground)" };
  }
}

// Patient board panel — the running log of patients this ER provider routed and
// their acceptance status. Self-contained (no PageWrap) for use as a widget.
function RoutedBoardPanel({ sent, providers, onReassign }) {
  const dayOrder = ["Today", "Yesterday"];
  const grouped = {};
  (sent || []).forEach((s, idx) => { (grouped[s.day] = grouped[s.day] || []).push({ ...s, idx }); });
  const dayKeys = [...dayOrder.filter((d) => grouped[d]), ...Object.keys(grouped).filter((d) => !dayOrder.includes(d))];
  return (
    <div>
      <SectionTitle action={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)", fontWeight: 500 }}><Icon name="history" size={13} /> Kept 2 days · accepted included</span>}>
        Patient board
      </SectionTitle>
      {(!sent || sent.length === 0) && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No patients yet — admit one above to route it to a hospitalist.</Card>}
      {dayKeys.map((day) => (
        <div key={day} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".04em", margin: "0 2px 8px" }}>{day}</div>
          <Card style={{ padding: 0, overflow: "visible" }}>
            {grouped[day].map((s, i) => (
              <div key={s.idx} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                <Avatar initials={s.initials} size={32} tint={s.status === "accepted" ? "emerald" : "blue"} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Patient {s.initials} → {s.provider}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{s.complaint || "—"} · {s.time}</span>
                    {(s.consultants || []).map((c) => (
                      <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: "var(--radius-full)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 11, fontWeight: 600 }}>
                        <Icon name="stethoscope" size={10} /> {c}
                      </span>
                    ))}
                  </div>
                </div>
                <ReassignSelect providers={providers} onPick={(name) => onReassign(s.id, name)} />
                <Badge status={s.status}>{STATUS[s.status].label}</Badge>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}

// Thin wrapper — the two panels stacked in a page frame (non-customizable use).
function ErDoctorDashboard({ providers, onSend, onReassign, sent }) {
  return (
    <PageWrap>
      <IntakeRoutingPanel providers={providers} onSend={onSend} />
      <div style={{ marginTop: 26 }}>
        <RoutedBoardPanel sent={sent} providers={providers} onReassign={onReassign} />
      </div>
    </PageWrap>
  );
}

Object.assign(window, { ErDoctorDashboard, IntakeRoutingPanel, RoutedBoardPanel });
