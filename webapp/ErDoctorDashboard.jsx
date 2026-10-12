/* DocTurn web-app UI kit — ER physician dashboard (intake + assign + reassign).
   Routes a patient to a primary hospitalist (round-robin or manual) and can add
   one or more consult services. Recently-sent keeps a 2-day history, including
   accepted hand-offs, and lets the ER provider reassign at any time.

   Everything here is the SERVER's (A.CON clinical #3, #17-#22):
     • "Extract fields" asks POST /api/patients/extract — the org's extractor
       (its OpenAI integration when switched on, else DocTurn's keyword rules)
       and says which ran; an empty note extracts nothing;
     • each ticked consult is POST /api/patients/:id/consults after the
       admission is routed, naming the on-call + the PA/NPs listed under it;
       the PA/NP picker offers only the org's real PA/NP/RN accounts;
     • who gets alerted is the server's decision (people with a DocTurn
       account, in-app + push) — there is no per-consult paging channel;
     • "My shift" time-to-accept is GET /api/reports/er (scope: mine). */

// Generic specialty picker for an org that has not curated a consult-service
// catalog (Directory → Consult services). Names only — nobody is implied to be
// on call for them.
const CONSULT_OPTIONS = ["Hospital Medicine", "Cardiology", "GI", "Pulmonology", "Nephrology", "Endocrine", "Infectious Disease", "Neurology"];

function ConsultRowLabel({ children }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".05em", width: 58, flex: "none", paddingTop: 5 }}>{children}</span>;
}

// Who the server will alert for this consult: everyone named here who has a
// DocTurn account (in-app + content-free push). Names without an account are
// recorded on the consult, not paged. With no names at all the server fans the
// request out to the org's hospitalists of that specialty, if any.
function consultAlertLine(roster, members) {
  const named = [].concat(roster && roster.name ? [roster] : [], members || []);
  if (!named.length) return "No one is named — DocTurn alerts the hospitalists listed under this specialty, if any; otherwise the request is only recorded.";
  const withAcct = named.filter((m) => typeof m.userId === "number");
  const without = named.filter((m) => typeof m.userId !== "number");
  if (!withAcct.length) return "Recorded by name only — no one listed has a DocTurn account, so nobody is alerted. Call the service directly.";
  return "Alerted in DocTurn: " + withAcct.map((m) => m.name).join(", ") + (without.length ? " · recorded only: " + without.map((m) => m.name).join(", ") : "");
}

function ConsultPanel({ service, roster, pool, members, onAddMember, onRemoveMember, onRemoveService }) {
  const [adding, setAdding] = React.useState(false);
  const mobile = useIsMobile();
  const hasRoster = !!(roster && roster.name);
  const r = roster || {};
  const addable = (pool || []).filter((m) => !members.some((x) => x.id === m.id || (m.userId && x.userId === m.userId)));
  return (
    <div data-consult-panel={service} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "#fff", overflow: "hidden" }}>
      {/* header band: service + on-call provider — tinted by specialty */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", background: (window.specialtyColor(service) || {}).bg || "var(--secondary)", borderBottom: "1px solid var(--border)", borderLeft: `3px solid ${(window.specialtyColor(service) || {}).color || "var(--primary)"}` }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", background: (window.specialtyColor(service) || {}).color || "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name="stethoscope" size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 }}>{service}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            <StatusDot status={hasRoster && r.onCall ? "online" : "offline"} pulse={hasRoster && r.onCall} />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hasRoster ? (r.name + " · " + (r.onCall ? ("on call" + (r.shift ? " · " + r.shift + " shift" : "")) : "listed on-call")) : "No on-call assigned — set in Consult services"}</span>
          </div>
        </div>
        <Avatar initials={hasRoster ? r.avatar : "—"} size={30} tint={hasRoster ? "blue" : "slate"} />
        <button onClick={onRemoveService} title="Remove consult" aria-label={"Remove the " + service + " consult"}
          onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
          style={{ width: mobile ? 44 : 26, height: mobile ? 44 : 26, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="x" size={15} /></button>
      </div>

      {/* body: two aligned labeled rows */}
      <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 11 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <ConsultRowLabel>Unit</ConsultRowLabel>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            {members.length === 0 && <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", paddingTop: 3 }}>Provider only</span>}
            {members.map((m) => (
              <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--secondary)", borderRadius: "var(--radius-full)", padding: "3px 8px 3px 4px", maxWidth: "100%" }}>
                <Avatar initials={m.avatar} size={20} tint={(window.TEAM_ROLE[m.role] || {}).tint || "slate"} />
                <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name.split(",")[0]}</span>
                <RolePill role={m.role} />
                <button onClick={() => onRemoveMember(m.id)} aria-label={"Remove " + m.name} style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", padding: 0, minWidth: mobile ? 44 : undefined, minHeight: mobile ? 44 : undefined }}><Icon name="x" size={12} /></button>
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
          <div data-midlevel-picker style={{ display: "flex", flexDirection: "column", gap: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)", padding: 6, marginLeft: mobile ? 0 : 68 }}>
            {addable.map((m) => (
              <button key={m.id} onClick={() => { onAddMember(m); if (addable.length === 1) setAdding(false); }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#fff"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", border: "none", borderRadius: "var(--radius-md)", background: "transparent", cursor: "pointer", textAlign: "left" }}>
                <Avatar initials={m.avatar} size={26} tint={(window.TEAM_ROLE[m.role] || {}).tint || "slate"} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{m.name}<RolePill role={m.role} /></span>
                <Icon name="plus" size={14} color="var(--primary)" />
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <ConsultRowLabel>Alerts</ConsultRowLabel>
          <div data-consult-alerts style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.45, paddingTop: 4 }}>{consultAlertLine(roster, members)}</div>
        </div>
      </div>
    </div>
  );
}

function ReassignSelect({ providers, onPick, mobile }) {
  // Clamped to its container (a select sizes itself to its WIDEST option, so a
  // long provider name must not push it off a phone screen); 44px tall on phones.
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
      <Icon name="repeat" size={13} color="var(--muted-foreground)" style={{ position: "absolute", left: 10, pointerEvents: "none" }} />
      <select value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
        style={{ appearance: "none", WebkitAppearance: "none", height: mobile ? 44 : 32, maxWidth: "100%", minWidth: 0, padding: "0 26px 0 28px", borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)", background: "#fff", fontSize: mobile ? 16 : 12.5, fontWeight: 600, color: "var(--foreground)",
          fontFamily: "var(--font-sans)", cursor: "pointer" }}>
        <option value="">Reassign…</option>
        {providers.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
      </select>
      <Icon name="chevron-down" size={13} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
    </div>
  );
}

// My metrics — the ER director's throughput stats, but scoped to THIS physician:
// the rows this provider routed (GET /api/assignments/sent) and the server's
// own time-to-accept for them (GET /api/reports/er, scope "mine") — "—"
// until it answers or when nothing was accepted yet, never a constant.
function ErMyMetricsPanel({ sent, meName, report, reportError }) {
  const mine = sent || [];
  const today = mine.filter((s) => s.day === "Today");
  const accepted = mine.filter((s) => s.status === "accepted").length;
  const declined = mine.filter((s) => s.status === "declined" || s.status === "rejected").length;
  const pending = mine.filter((s) => s.status === "sent").length;
  const acceptRate = (accepted + declined) ? Math.round((accepted / (accepted + declined)) * 100) + "%" : "—";
  const a = report && report.assignments;
  const tta = a ? window.fmtMinutes(a.timeToAcceptMinAvg) : "—";
  const ttaSub = a ? (a.timeToAcceptMinAvg == null ? "none of yours accepted yet" : "your admissions, all time") : (reportError ? window.erReadWhy(reportError) : "loading…");
  const statMetrics = [
    { key: "admits", label: "My admits today", value: today.length },
    { key: "routed_all", label: "Routed in all", value: mine.length },
    { key: "ttaccept", label: "Avg time-to-accept", value: tta },
    { key: "acceptrate", label: "My acceptance rate", value: acceptRate },
    { key: "accepted", label: "Accepted", value: accepted },
    { key: "declined", label: "Declined", value: declined },
    { key: "awaiting", label: "Awaiting accept", value: pending },
  ];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 2px 10px", flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>My shift</h3>
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{meName ? meName + " · " : ""}patients you routed</span>
      </div>
      <CustomizableStats statKey="er_doctor:stats" metrics={statMetrics} stats={[
        { id: "admits", label: "My admits today", value: today.length, icon: "clipboard-plus", tint: "blue", sub: mine.length + " routed in all" },
        { id: "ttaccept", label: "Avg time-to-accept", value: tta, icon: "timer", tint: "amber", sub: ttaSub },
        { id: "acceptrate", label: "My acceptance rate", value: acceptRate, icon: "check-check", tint: "emerald", sub: accepted + " accepted · " + declined + " declined" },
        { id: "awaiting", label: "Awaiting accept", value: pending, icon: "loader", tint: "slate", sub: "still routing" },
      ]} />
    </div>
  );
}

// Intake + routing panel — the ER physician's primary action (write the note,
// extract, route, send). Self-contained (no PageWrap) so it can be a draggable
// dashboard widget.
function IntakeRoutingPanel({ providers, onSend, consultConfig, midlevels, services, hiddenServices, onToggleService, onAddService }) {
  const mobile = useIsMobile();
  const [mgmt, setMgmt] = React.useState(false);
  const [newSvc, setNewSvc] = React.useState("");
  const hidden = hiddenServices || [];
  // Per-service config from the director's Consult services tab: the on-call
  // consultant (explicit pin OR live registered roster — no fake fallback) and
  // the PA/NPs assigned under that service.
  const cfgFor = (s) => (consultConfig && consultConfig[s]) || null;
  const rosterFor = (s) => { const c = cfgFor(s); return c ? c.onCall : null; };
  const membersFor = (s) => { const c = cfgFor(s); return (c && c.members) || []; };
  // PA/NP/RN pool for the ER physician's quick-add: the org's REAL PA/NP/RN
  // accounts (each with its userId, so the server can alert them). No demo
  // fallback: an org without such accounts offers no picker (A.CON clinical #20).
  const pool = midlevels || [];
  // Service menu is director-curated when provided; else the built-in list.
  const allServices = (services && services.length) ? services : CONSULT_OPTIONS;
  // The picker shows everything except specialties hidden for this view.
  const serviceList = allServices.filter((s) => hidden.indexOf(s) < 0);
  const [note, setNote] = React.useState("");
  // { engine: "openai" | "local" | "external" } once the server extracted.
  const [extracted, setExtracted] = React.useState(null);
  const [extracting, setExtracting] = React.useState(false);
  const [fields, setFields] = React.useState({ initials: "", room: "", complaint: "", specialty: "", acuity: 3 });
  const [mode, setMode] = React.useState("quick"); // quick | manual
  const [manual, setManual] = React.useState(""); // selected provider id (empty until chosen)
  const [consults, setConsults] = React.useState([]);
  const [consultMembers, setConsultMembers] = React.useState({});

  // The SERVER's extractor (POST /api/patients/extract): the org's OpenAI
  // integration when it is on, else DocTurn's keyword rules — the label says
  // which. An empty note extracts nothing; fields it can't find stay empty.
  const toast = (t) => window.DT && window.DT.actions && window.DT.actions.toast && window.DT.actions.toast(t);
  const runExtract = () => {
    if (extracting) return;
    const text = (note || "").trim();
    if (!text) { toast({ tone: "rejected", title: "Nothing to extract", msg: "Type or paste the intake note first." }); return; }
    const act = window.DT && window.DT.actions && window.DT.actions.extractIntake;
    if (!act) return;
    setExtracting(true);
    Promise.resolve(act(text)).then((r) => {
      const spec = r && r.specialty && r.specialty !== "General" ? r.specialty : "";
      // ESI: DocTurn's keyword rules suggest one from the note; the
      // physician confirms it (labelled as such, not as AI).
      const acuity = window.DT && window.DT.suggestAcuity ? window.DT.suggestAcuity(text) : 3;
      setFields({ initials: String((r && r.initials) || "").toUpperCase().slice(0, 3), room: (r && r.roomNumber) || "", complaint: (r && r.issueSummary) || "", specialty: spec, acuity: acuity });
      setExtracted({ engine: (r && r.engine) || "local" });
    }, (e) => {
      toast({ tone: "rejected", title: "Couldn't extract", msg: (e && /network|fetch|connection/i.test(String(e.message))) ? "No connection — fill in the fields by hand." : "The server didn't extract anything — fill in the fields by hand." });
    }).then(() => setExtracting(false));
  };
  const reset = () => { setNote(""); setExtracted(null); setConsults([]); setConsultMembers({}); setFields({ initials: "", room: "", complaint: "", specialty: "", acuity: 3 }); };
  const toggleConsult = (s) => setConsults((c) => {
    if (c.includes(s)) {
      setConsultMembers((cm) => { const n = Object.assign({}, cm); delete n[s]; return n; });
      return c.filter((x) => x !== s);
    }
    // Pre-populate with the service's configured PA/NPs; the ER can add more.
    setConsultMembers((cm) => Object.assign({}, cm, { [s]: (membersFor(s) || []).slice() }));
    return [...c, s];
  });
  const addConsultMember = (s, m) => setConsultMembers((cm) => Object.assign({}, cm, { [s]: [...(cm[s] || []), m] }));
  const removeConsultMember = (s, id) => setConsultMembers((cm) => Object.assign({}, cm, { [s]: (cm[s] || []).filter((x) => x.id !== id) }));
  // Who each ticked consult names on the server: its on-call + the PA/NPs
  // shown under it (with their account ids when they have one).
  const consultTeams = () => {
    const out = {};
    consults.forEach((s) => {
      const team = [];
      const r = rosterFor(s);
      if (r && r.name) team.push({ name: r.name, userId: typeof r.userId === "number" ? r.userId : undefined });
      (consultMembers[s] || []).forEach((m) => { if (m && m.name) team.push({ name: m.name, userId: typeof m.userId === "number" ? m.userId : undefined }); });
      out[s] = team;
    });
    return out;
  };

  // Providers may be empty on a cold load (before the rotation pool hydrates),
  // so derive defensively and never index into an empty array.
  const list = providers || [];
  // "Next up" is the routing planner's answer (GET /api/rotation/next via
  // DT.nextUp), never this list's order: the list is sorted by census over
  // EVERYONE, including at-cap and swing/off-shift providers who never get a
  // round-robin patient (A.CON-SHO-29).
  const DTx = (typeof window !== "undefined" && window.DT) || null;
  const rrNext = DTx && DTx.nextUp ? DTx.nextUp() : null;
  const rrStatus = (DTx && DTx.rotationStatus) ? DTx.rotationStatus() : { source: "local", capRelief: false, mode: "lowest_census" };
  // The patient's specialty is a routing preference, so it can change who is
  // next: ask the server for exactly that preview.
  const specialty = fields.specialty || "";
  const [specPreview, setSpecPreview] = React.useState(null);
  // Re-ask whenever anything the pick depends on changes: the roster (census,
  // cap, on/off shift, rotation membership, shift, specialty) or the general
  // preview itself (cursor reset, mode, order — a ROTATION_UPDATED re-read).
  const rot = DTx && DTx.getState ? DTx.getState().rotation : null;
  const rotSig = rot ? (rot.source || "") + ":" + (rot.mode || "") + ":" + (rot.order || []).join(".") + (rot.capRelief ? "!" : "") : "-";
  const rosterKey = list.map((p) => p.id + ":" + p.census + "/" + p.cap + (p.working ? "w" : "") + (p.inRotation ? "r" : "") + (p.shift || "") + "~" + (p.specialty || "")).join(",") + "|" + (rrNext ? rrNext.id : "-") + "|" + rotSig;
  React.useEffect(() => {
    if (!specialty || !DTx || !DTx.previewRotation) { setSpecPreview(null); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      DTx.previewRotation(specialty).then((r) => { if (live) setSpecPreview(r); }, () => { if (live) setSpecPreview(null); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [specialty, rosterKey]);
  const specPending = !!specialty && !(specPreview && specPreview.specialty === specialty);
  const preview = (specialty && specPreview && specPreview.specialty === specialty)
    ? specPreview
    : { source: rrStatus.source, next: rrNext, capRelief: rrStatus.capRelief };
  const nextUp = preview.next;
  const routingOff = preview.source === "disabled" || rrStatus.source === "disabled";
  // Server unreachable for the preview → it still decides at send time.
  const quickOk = !!nextUp || preview.source === "unavailable" || preview.source === "loading";
  const manualId = manual || (nextUp && nextUp.id) || (list[0] && list[0].id);
  const manualTarget = list.find((p) => p.id === manualId) || null;

  const hasPatient = !!(fields.initials && fields.room);
  const canSend = hasPatient && !routingOff && (mode === "quick" ? quickOk : !!manualTarget);
  const doSend = () => {
    if (!canSend) return;
    // The tab decides the mode — round-robin lets the SERVER pick.
    onSend(mode === "quick" ? nextUp : manualTarget, fields, consults, mode, consultTeams());
    reset();
  };
  const sendHint = !hasPatient ? "Add patient initials & room to send."
    : routingOff ? "Admission routing is switched off for this organization."
    : (mode === "quick" && !quickOk) ? "Nobody can take a round-robin patient right now — use Manual."
    : "";

  if (!list.length) {
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
        <Card style={{ padding: 18, minWidth: 0 }}>
          <SectionTitle>New patient intake</SectionTitle>
          <Field textarea rows={4} label="Intake note" placeholder="Paste or type the intake note, then Extract to fill the fields below…"
            value={note} onChange={setNote} help="No real PHI — synthetic examples only (e.g. initials)." />
          <div style={{ display: "flex", gap: 8, margin: "12px 0 4px", flexWrap: "wrap" }}>
            <Button variant="secondary" size="sm" icon="sparkles" onClick={runExtract} style={extracting ? { opacity: .6, pointerEvents: "none" } : null}>{extracting ? "Extracting…" : "Extract fields"}</Button>
            {(extracted || fields.initials || fields.room || fields.complaint) && <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={reset}>Clear</Button>}
          </div>

          {/* Patient details — always editable; Extract just fills them in. */}
          <div style={{ marginTop: 14, paddingTop: 16, borderTop: "1px dashed var(--border)", display: "flex", flexDirection: "column", gap: 14 }}>
            {extracted && (
              <div data-extracted-by={extracted.engine} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--status-accepted)", fontWeight: 600 }}>
                <Icon name="sparkles" size={13} /> {extracted.engine === "openai" ? "Extracted by OpenAI" : extracted.engine === "local" ? "Filled by DocTurn's keyword rules (no AI)" : "Extracted on the server"} · review &amp; edit before sending
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Patient initials" icon="user" value={fields.initials} onChange={(v) => setFields({ ...fields, initials: v.toUpperCase().slice(0, 3) })} placeholder="e.g. JS" />
              <Field label="Room / location" icon="door-open" value={fields.room} onChange={(v) => setFields({ ...fields, room: v })} placeholder="e.g. 412, Hall, Bay A, Disaster" />
            </div>
            <Field label="Chief complaint" icon="clipboard-list" value={fields.complaint} onChange={(v) => setFields({ ...fields, complaint: v })} placeholder="Reason for admission" />
            {/* Triage / acuity (ESI 1–5) — sets urgency so multiple admissions
                are prioritized. AI suggests; the physician confirms. */}
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                <Icon name="activity" size={14} color="var(--muted-foreground)" />Triage level (ESI)
                {extracted && <span style={{ fontSize: 11, color: "var(--status-accepted)", fontWeight: 600 }}>· suggested from note keywords — confirm</span>}
              </label>
              {/* Phones: the shell's 12px legibility floor (A.CON-MIN-11) makes
                  "Resuscitation" ~92px — wider than a fifth of a phone card —
                  so the names would force the card past the viewport. Phones
                  get a numbered 5-up segmented row (44px) and the selected
                  level's full name underneath; desktop keeps names in-button. */}
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = fields.acuity === n;
                  const e = window.ESI[n];
                  return (
                    <button key={n} type="button" onClick={() => setFields({ ...fields, acuity: n })}
                      title={"ESI " + n + " · " + e.name} aria-label={"ESI " + n + " · " + e.name} aria-pressed={on}
                      style={{ flex: 1, minWidth: mobile ? 0 : undefined, minHeight: mobile ? 44 : undefined, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: mobile ? "center" : undefined, gap: 2, padding: "7px 4px", borderRadius: "var(--radius-md)", cursor: "pointer", fontFamily: "var(--font-sans)",
                        border: `1px solid ${on ? e.dot : "var(--border)"}`, background: on ? e.bg : "#fff", color: on ? e.fg : "var(--muted-foreground)" }}>
                      <span style={{ fontSize: mobile ? 16 : 14, fontWeight: 800 }}>{n}</span>
                      {!mobile && <span style={{ fontSize: 9.5, fontWeight: 600, lineHeight: 1.1, textAlign: "center" }}>{e.name}</span>}
                    </button>
                  );
                })}
              </div>
              {mobile && window.ESI[fields.acuity] && (
                <div aria-live="polite" style={{ marginTop: 8 }}>
                  <AcuityChip level={fields.acuity} showName />
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Routing */}
        <Card style={{ padding: 18, minWidth: 0 }}>
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
              <div style={{ fontSize: 13, color: "#1e3a8a", lineHeight: 1.5 }} data-testid="rr-hint">
                {rrStatus.mode === "sequential"
                  ? <React.Fragment>Routes <b>in rotation order</b> to the next hospitalist on a round‑robin shift with room under their cap{specialty ? <React.Fragment> (preferring {specialty})</React.Fragment> : null}.</React.Fragment>
                  : <React.Fragment>Routes to the <b>lowest‑census</b> hospitalist on a round‑robin shift with room under their cap{specialty ? <React.Fragment> (preferring {specialty})</React.Fragment> : null}.</React.Fragment>}{" "}
                {routingOff ? <span>Admission routing is switched off for this organization.</span>
                  : specPending ? <span>Checking who's next for {specialty}…</span>
                  : preview.source === "loading" ? <span>Checking who's next…</span>
                  : nextUp ? <React.Fragment>Next up: <b>{nextUp.name}</b> ({nextUp.census}/{nextUp.cap}).{preview.capRelief ? " Everyone eligible is at cap — sending raises each round‑robin provider's cap by 1." : ""}</React.Fragment>
                  : preview.source === "unavailable" ? <span>Couldn't load who's next — the server picks the eligible hospitalist when you send.</span>
                  : <b>Nobody on a round‑robin shift can take this patient right now — use Manual.</b>}
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
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, flexWrap: "wrap" }}>
              <Icon name="users-round" size={15} color="var(--muted-foreground)" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Consult services</span>
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>optional · select multiple</span>
              {onToggleService && <button onClick={() => setMgmt((v) => !v)} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--border)", background: mgmt ? "var(--secondary)" : "#fff", borderRadius: "var(--radius-md)", padding: "4px 9px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", color: "var(--foreground)" }}><Icon name={mgmt ? "check" : "sliders-horizontal"} size={12} />{mgmt ? "Done" : "Customize"}</button>}
            </div>

            {mgmt && (
              <div style={{ marginBottom: 12, padding: 12, background: "var(--secondary)", borderRadius: "var(--radius-md)" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Show in picker</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {allServices.map((s) => {
                    const shown = hidden.indexOf(s) < 0;
                    const c = window.specialtyColor(s);
                    return (
                      <button key={s} onClick={() => onToggleService(s)} title={shown ? "Hide from picker" : "Show in picker"}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "var(--font-sans)",
                          border: `1px solid ${shown ? c.color : "var(--border)"}`, background: shown ? c.bg : "#fff", color: shown ? c.color : "var(--muted-foreground)", opacity: shown ? 1 : 0.6 }}>
                        <Icon name={shown ? "eye" : "eye-off"} size={11} />{s}
                      </button>
                    );
                  })}
                </div>
                {onAddService && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={newSvc} onChange={(e) => setNewSvc(e.target.value)} placeholder="Add a specialty…" onKeyDown={(e) => { if (e.key === "Enter" && newSvc.trim()) { onAddService(newSvc.trim()); setNewSvc(""); } }}
                      style={{ flex: 1, height: 32, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0 10px", fontSize: 13, fontFamily: "var(--font-sans)", outline: "none" }} />
                    <Button size="sm" icon="plus" onClick={() => { if (newSvc.trim()) { onAddService(newSvc.trim()); setNewSvc(""); } }}>Add</Button>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {serviceList.map((s) => {
                const on = consults.includes(s);
                const c = window.specialtyColor(s);
                return (
                  <button key={s} onClick={() => toggleConsult(s)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: "var(--radius-full)",
                      fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", whiteSpace: "nowrap", transition: "all .12s",
                      border: `1px solid ${c.color}`, background: on ? c.color : c.bg,
                      color: on ? "#fff" : c.color, boxShadow: on ? "var(--shadow-sm)" : "none" }}>
                    {on ? <Icon name="check" size={12} /> : <span style={{ width: 7, height: 7, borderRadius: 99, background: c.color, flex: "none" }} />} {s}
                  </button>
                );
              })}
            </div>

            {consults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                {consults.map((s) => (
                  <ConsultPanel key={s} service={s} roster={rosterFor(s)} pool={pool}
                    members={consultMembers[s] || []}
                    onAddMember={(m) => addConsultMember(s, m)} onRemoveMember={(id) => removeConsultMember(s, id)}
                    onRemoveService={() => toggleConsult(s)} />
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            <Button full icon="send" onClick={doSend} style={{ opacity: canSend ? 1 : 0.5, pointerEvents: canSend ? "auto" : "none" }}>
              Send assignment{consults.length ? ` + ${consults.length} consult${consults.length > 1 ? "s" : ""}` : ""}
            </Button>
            {!canSend && sendHint && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8, textAlign: "center" }}>{sendHint}</div>}
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
function RoutedBoardPanel({ sent, providers, onReassign, onAddConsult, onRespondConsult, consultServices }) {
  // Phone rows are two lines — avatar + title + status badge, then the
  // "+ Consult" chip and Reassign select — so the title column keeps its width
  // and the badge never leaves the viewport.
  const mobile = useIsMobile();
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
            {grouped[day].map((s, i) => {
              const ACCENT = { accepted: "var(--status-accepted)", declined: "var(--status-rejected)", sent: "var(--status-active)", rerouted: "var(--status-pending)", expired: "var(--status-neutral)" };
              const TINT = { accepted: "emerald", declined: "slate", sent: "blue", rerouted: "amber", expired: "slate" };
              const accent = ACCENT[s.status] || "transparent";
              const accepted = s.status === "accepted", declined = s.status === "declined";
              const consultAdd = onAddConsult && s.patientId != null && <ConsultAdd services={consultServices} onPick={(spec) => onAddConsult(s.patientId, spec)} />;
              const reassign = <ReassignSelect providers={providers} onPick={(name) => onReassign(s.id, name)} mobile={mobile} />;
              return (
              <div key={s.idx} style={{ padding: "12px 16px 12px 13px", borderTop: i ? "1px solid var(--border)" : "none", borderLeft: `3px solid ${accent}`, background: accepted ? "var(--status-accepted-bg)" : declined ? "var(--status-rejected-bg)" : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Avatar initials={s.initials} size={32} tint={TINT[s.status] || "blue"} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>Patient {s.initials} {declined ? "✗ declined by" : "→"} {s.provider}{s.acuity ? <AcuityChip level={s.acuity} size="sm" /> : null}</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span>{s.complaint || "—"} · {s.time}</span>
                      {(!s.consultDetails || !s.consultDetails.length) && (s.consultants || []).map((c) => (
                        <SpecialtyTag key={c} name={c} size="sm" />
                      ))}
                    </div>
                  </div>
                  {!mobile && consultAdd}
                  {!mobile && reassign}
                  {/* flex:none + nowrap: the status pill never shrinks or wraps */}
                  <span style={{ flex: "none", display: "inline-flex", whiteSpace: "nowrap" }}><Badge status={s.status}>{(STATUS[s.status] || {}).label || s.status}</Badge></span>
                </div>
                {mobile && (consultAdd || reassign) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8, marginLeft: 46 }}>
                    {consultAdd}
                    {reassign}
                  </div>
                )}
                {s.consultDetails && s.consultDetails.length ? <div style={{ marginTop: 8, marginLeft: 46, maxWidth: 440 }}><ConsultRoster details={s.consultDetails} onRespond={onRespondConsult} /></div> : null}
              </div>
              );
            })}
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

Object.assign(window, { ErDoctorDashboard, IntakeRoutingPanel, RoutedBoardPanel, ErMyMetricsPanel });
