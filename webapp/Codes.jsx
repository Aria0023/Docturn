/* DocTurn web-app UI kit — Codes (Code Stroke, Code STEMI, …).
   Everything here is the server's (GET /api/codes): the hospital's protocols,
   the codes in progress and the recent ones. Calling a code alerts whoever
   holds each team role right now; a role nobody on DocTurn holds is shown as
   NOT ALERTED so the team knows who still has to be called. The board can
   name a patient, so it lives in memory only (DT.actions.codes), never in the
   store or on the device. Clocks tick locally; every state change is re-read. */

const cdSel = {
  height: 36, padding: "0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
  background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--font-sans)", fontSize: 13, maxWidth: "100%",
};
const cdLabel = { fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6 };
const CD_RED = "var(--destructive)";

function useCodes() {
  const api = window.DT.actions.codes;
  const [snap, setSnap] = React.useState(api.get());
  React.useEffect(() => {
    const off = api.subscribe(setSnap);
    api.refresh();
    return off;
  }, []);
  const anyActive = !!(snap.data && snap.data.activations.some((a) => a.status === "active"));
  // Live frames drive updates; this is the safety net while a code is running.
  React.useEffect(() => {
    if (!anyActive) return undefined;
    const t = setInterval(() => api.refresh(), 30000);
    return () => clearInterval(t);
  }, [anyActive]);
  return snap;
}

// One shared one-second tick for every running clock on screen.
function useNow(running) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now;
}
function cdClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(r).padStart(2, "0");
}
const cdMin = (n) => (n == null ? "" : (n < 10 ? n.toFixed(1) : String(Math.round(n))) + " min");
function cdToastFail(title) {
  return (e) => window.DT.set((s) => {
    const code = String((e && e.message) || "");
    s.__toast = { tone: "rejected", title, msg: code === "code_closed" ? "This code has already been closed." : code === "not_on_team" ? "Only the code's team can do that." : "The server did not accept that. Nothing changed." };
    return s;
  });
}

/* The bar across the top of the app while a code I am on is running. */
function CodeBanner({ nav, onOpen }) {
  const snap = useCodes();
  const mine = snap.data ? snap.data.activations.filter((a) => a.status === "active" && a.onTeam) : [];
  const now = useNow(mine.length > 0);
  if (!mine.length) return null;
  const api = window.DT.actions.codes;
  return (
    <div data-code-banner>
      {mine.map((a) => {
        const me = a.members.find((m) => m.me);
        const waiting = me && !me.acknowledgedAt;
        return (
          <div key={a.id} role={waiting ? "alert" : "status"} data-code-banner-item={a.id}
            style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 12px", padding: "10px 16px", color: "#fff",
              background: waiting ? CD_RED : "var(--foreground)", borderBottom: "1px solid rgba(255,255,255,.25)" }}>
            <Icon name="siren" size={18} color="#fff" />
            <strong style={{ fontSize: 14 }}>{a.protocolName}</strong>
            <span style={{ fontSize: 13 }}>{a.location}</span>
            <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{cdClock(now - Date.parse(a.activatedAt))}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              {waiting && <Button size="sm" variant="secondary" icon="check" onClick={() => api.ack(a.id).catch(cdToastFail("Couldn't acknowledge"))}>Acknowledge</Button>}
              {nav !== "codes" && <Button size="sm" variant="secondary" icon="arrow-right" onClick={onOpen}>Open</Button>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CodeMemberRow({ a, m }) {
  const state = !m.alerted ? "none" : m.arrivedAt ? "arrived" : m.acknowledgedAt ? "acked" : "waiting";
  const tone = { none: ["var(--secondary)", "var(--muted-foreground)", "phone-off", "Not alerted"], waiting: ["var(--status-rejected-bg, #fee2e2)", CD_RED, "bell-ring", "Alerted"],
    acked: ["var(--status-pending-bg, #fef3c7)", "var(--foreground)", "check", "Acknowledged"], arrived: ["var(--status-accepted-bg, #dcfce7)", "var(--foreground)", "map-pin", "Arrived"] }[state];
  const who = m.alerted ? m.name || "Unknown" : m.holderName ? m.holderName + " is not on DocTurn" : "Nobody holds this role";
  return (
    <div data-code-member={state} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: tone[0], color: tone[1], whiteSpace: "nowrap" }}>
        <Icon name={tone[2]} size={12} />{tone[3]}
      </span>
      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}{m.me ? " · you" : ""}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
          {who}{m.coveringFor ? " (covering " + m.coveringFor + ")" : ""}{!m.alerted ? " — call them" : ""}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", textAlign: "right", whiteSpace: "nowrap" }}>
        {state === "waiting" && a.status === "active" ? "alerted " + m.alertCount + "×" + (m.textedAt ? " · texted" : "") : m.ackMin != null ? "answered in " + cdMin(m.ackMin) : ""}
      </div>
    </div>
  );
}

function CodeCard({ a, now }) {
  const api = window.DT.actions.codes;
  const active = a.status === "active";
  const me = a.members.find((m) => m.me);
  const elapsedMin = (now - Date.parse(a.activatedAt)) / 60000;
  const answered = a.members.filter((m) => m.acknowledgedAt).length, alerted = a.members.filter((m) => m.alerted).length;
  const close = (outcome) => {
    const q = outcome === "completed" ? "Mark this " + a.protocolName + " complete?" : "Stand down this " + a.protocolName + "? The team is told it is cancelled.";
    if (window.confirm(q)) api.close(a.id, outcome).catch(cdToastFail("Couldn't close the code"));
  };
  return (
    <div data-code-card={a.id} data-code-status={a.status} style={{ marginBottom: 16 }}>
      <Card style={{ padding: 0, overflow: "hidden", border: active ? "2px solid " + CD_RED : undefined }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 12px", padding: "14px 18px", borderBottom: "1px solid var(--border)", background: active ? "var(--status-rejected-bg, #fee2e2)" : "transparent" }}>
          <Icon name="siren" size={18} color={active ? CD_RED : "var(--muted-foreground)"} />
          <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{a.protocolName}</h3>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{a.location}</span>
          {a.patient && <Badge variant="outline">Patient {a.patient.initials}{a.patient.room ? " · " + a.patient.room : ""}</Badge>}
          <span data-code-clock style={{ marginLeft: "auto", fontSize: active ? 22 : 14, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: active ? CD_RED : "var(--foreground)" }}>
            {active ? cdClock(now - Date.parse(a.activatedAt)) : (a.status === "completed" ? "Completed" : "Stood down") + (a.durationMin != null ? " · " + cdMin(a.durationMin) : "")}
          </span>
        </div>
        <div style={{ padding: "8px 18px", fontSize: 12.5, color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
          Called by {a.activatedByName || "someone"} · {window.dtFmt && window.dtFmt.stamp ? window.dtFmt.stamp(Date.parse(a.activatedAt)) : new Date(a.activatedAt).toLocaleString()}
          {a.closedAt ? " · closed by " + (a.closedByName || "someone") : ""}{a.note ? " · " + a.note : ""}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 300px", minWidth: 0, padding: "12px 18px" }}>
            <div style={cdLabel}>Team · <span data-code-tally>{answered} of {alerted} answered</span>{a.members.length > alerted ? " · " + (a.members.length - alerted) + " not alerted" : ""}</div>
            {a.members.map((m) => <CodeMemberRow key={m.id} a={a} m={m} />)}
          </div>
          {a.steps.length > 0 && (
            <div style={{ flex: "1 1 300px", minWidth: 0, padding: "12px 18px", borderLeft: "1px solid var(--border)" }}>
              <div style={cdLabel}>Steps</div>
              {a.steps.map((s) => {
                const late = s.targetMin != null && (s.doneAt ? s.doneMin > s.targetMin : active && elapsedMin > s.targetMin);
                return (
                  <label key={s.id} data-code-step={s.doneAt ? "done" : late ? "late" : "open"} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)", cursor: a.canAct ? "pointer" : "default" }}>
                    <input type="checkbox" checked={!!s.doneAt} disabled={!a.canAct} style={{ marginTop: 3, width: 18, height: 18 }}
                      onChange={(e) => api.step(a.id, s.id, e.target.checked).catch(cdToastFail("Couldn't update the step"))} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, display: "block" }}>{s.label}</span>
                      <span style={{ fontSize: 12.5, color: late ? CD_RED : "var(--muted-foreground)", fontWeight: late ? 700 : 400 }}>
                        {s.doneAt ? "Done at " + cdMin(s.doneMin) + (s.doneByName ? " · " + s.doneByName : "") : s.targetMin != null ? "Target " + s.targetMin + " min" : "No target"}
                        {s.targetMin != null && s.doneAt ? (late ? " · " + cdMin(s.doneMin - s.targetMin) + " over target" : " · within target") : ""}
                        {!s.doneAt && late ? " · overdue" : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        {active && (a.canAct || me) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 18px", borderTop: "1px solid var(--border)" }}>
            {me && !me.acknowledgedAt && <Button icon="check" onClick={() => api.ack(a.id).catch(cdToastFail("Couldn't acknowledge"))}>Acknowledge</Button>}
            {me && !me.arrivedAt && <Button variant={me.acknowledgedAt ? "default" : "outline"} icon="map-pin" onClick={() => api.arrived(a.id).catch(cdToastFail("Couldn't update"))}>I'm here</Button>}
            {a.canAct && <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="outline" icon="x" onClick={() => close("stood_down")}>Stand down</Button>
              <Button variant="outline" icon="check-check" onClick={() => close("completed")}>Complete</Button>
            </span>}
          </div>
        )}
      </Card>
    </div>
  );
}

function CodeActivate({ protocol, onClose }) {
  const api = window.DT.actions.codes;
  const [location, setLocation] = React.useState("");
  const [note, setNote] = React.useState("");
  const [patientId, setPatientId] = React.useState("");
  const [team, setTeam] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // The patients this account's board already shows (the server's rows).
  const patients = (window.DT.getState().board || []).filter((p) => p && p.patientId).map((p) => ({ id: p.patientId, initials: p.initials, room: p.room && p.room !== "—" ? p.room : "" }));
  React.useEffect(() => { api.previewTeam(protocol.id).then(setTeam).catch(() => setTeam("error")); }, []);
  const go = () => {
    if (!location.trim()) { setError("Say where the team should go."); return; }
    setBusy(true); setError("");
    api.activate({ protocolId: protocol.id, location: location.trim(), note: note.trim(), patientId: patientId ? Number(patientId) : null })
      .then(onClose).catch(() => { setBusy(false); setError("The server did not start the code. Nobody was alerted."); });
  };
  const reach = Array.isArray(team) ? team.filter((m) => m.userId != null) : [];
  return (
    <Modal title={"Call " + protocol.name} subtitle={protocol.description || "Alerts the team now"} icon="siren" onClose={onClose} width={520}>
      <div data-code-activate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Where" value={location} onChange={setLocation} placeholder="e.g. ED 4, 5 West room 512" inputProps={{ maxLength: 80, "data-code-location": true, autoFocus: true }} />
        {patients.length > 0 && (
          <div>
            <div style={cdLabel}>Patient (optional)</div>
            <select data-code-patient style={Object.assign({}, cdSel, { width: "100%" })} value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">Not linked</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.initials}{p.room ? " · " + p.room : ""}</option>)}
            </select>
          </div>
        )}
        <Field label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. last known well 14:10" inputProps={{ maxLength: 300 }} />
        <div>
          <div style={cdLabel}>Who is alerted right now</div>
          {team === null ? <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Checking who is on call…</div>
            : team === "error" ? <div style={{ fontSize: 13, color: CD_RED }}>Couldn't check who is on call. You can still call the code.</div>
            : team.map((m, i) => (
              <div key={i} data-code-preview={m.userId != null ? "alerted" : "not"} style={{ display: "flex", gap: 8, fontSize: 13, padding: "5px 0", alignItems: "baseline" }}>
                <Icon name={m.userId != null ? "bell-ring" : "phone-off"} size={13} color={m.userId != null ? "var(--primary-ink)" : CD_RED} />
                <span style={{ fontWeight: 600 }}>{m.label}</span>
                <span style={{ color: m.userId != null ? "var(--muted-foreground)" : CD_RED }}>
                  {m.userId != null ? m.name + (m.coveringFor ? " (covering " + m.coveringFor + ")" : "")
                    : m.problem === "no_account" ? (m.holderName ? m.holderName + " is not on DocTurn — call them" : "That person is no longer on DocTurn — call them")
                    : m.problem === "not_assigned" ? "No role or person set for this — call them" : "Nobody is on call for this — call them"}
                </span>
              </div>
            ))}
          {Array.isArray(team) && reach.length === 0 && <div style={{ fontSize: 13, color: CD_RED, fontWeight: 700, marginTop: 6 }}>Nobody on this team can be alerted through DocTurn right now.</div>}
        </div>
        {error && <div role="alert" data-code-activate-error style={{ fontSize: 13, color: CD_RED }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" icon="siren" onClick={go} disabled={busy}>Call {protocol.name}</Button>
        </div>
      </div>
    </Modal>
  );
}

function CodeProtocolEditor({ initial, onClose }) {
  const api = window.DT.actions.codes;
  const [name, setName] = React.useState(initial.name || "");
  const [description, setDescription] = React.useState(initial.description || "");
  const [team, setTeam] = React.useState((initial.team || []).map((t) => Object.assign({}, t)));
  const [steps, setSteps] = React.useState((initial.steps || []).map((s) => Object.assign({}, s)));
  const [enabled, setEnabled] = React.useState(initial.enabled !== false);
  const [opts, setOpts] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => { api.teamOptions().then(setOpts).catch(() => setOpts({ roles: [], people: [], failed: true })); }, []);
  const upTeam = (i, patch) => setTeam(team.map((t, j) => (j === i ? Object.assign({}, t, patch) : t)));
  const upStep = (i, patch) => setSteps(steps.map((s, j) => (j === i ? Object.assign({}, s, patch) : s)));
  const valOf = (t) => (t.ref ? t.kind + ":" + t.ref : "");
  const save = () => {
    if (!name.trim()) { setError("Give the protocol a name."); return; }
    if (!team.length || team.some((t) => !t.label.trim())) { setError("Every team member needs a title, and a team needs at least one member."); return; }
    if (steps.some((s) => !s.label.trim())) { setError("Every step needs a name."); return; }
    setBusy(true); setError("");
    api.saveProtocol(initial.id, {
      name: name.trim(), description: description.trim(), enabled,
      team: team.map((t) => ({ id: t.id, label: t.label.trim(), kind: t.kind, ref: t.ref || "" })),
      steps: steps.map((s) => ({ id: s.id, label: s.label.trim(), targetMin: s.targetMin ? Math.max(1, Math.min(1440, Math.round(Number(s.targetMin)))) : null })),
    }).then(onClose).catch((e) => {
      setBusy(false);
      setError(String(e.message) === "name_taken" ? "Another protocol already has that name." : "The server did not save this protocol.");
    });
  };
  const unassigned = team.filter((t) => !t.ref).length;
  return (
    <Modal title={initial.id ? "Edit protocol" : "New protocol"} subtitle="Who is on the team and which steps are timed" icon="siren" onClose={onClose} width={640}>
      <div data-code-editor style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Name" value={name} onChange={setName} placeholder="e.g. Code Stroke" inputProps={{ maxLength: 60, "data-code-name": true }} />
        <Field label="When it is called (optional)" value={description} onChange={setDescription} inputProps={{ maxLength: 300 }} />
        <div>
          <div style={cdLabel}>Team — each member is an on-call role or a person</div>
          {team.map((t, i) => (
            <div key={i} data-code-team-row style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
              <input aria-label="Team member title" value={t.label} maxLength={60} placeholder="Title, e.g. Neurologist on call" onChange={(e) => upTeam(i, { label: e.target.value })} style={Object.assign({}, cdSel, { flex: "1 1 170px", minWidth: 0 })} />
              <select aria-label="Who holds it" data-code-team-ref value={valOf(t)} onChange={(e) => { const v = e.target.value; const k = v.indexOf(":"); upTeam(i, v ? { kind: v.slice(0, k), ref: v.slice(k + 1) } : { kind: "oncall", ref: "" }); }}
                style={Object.assign({}, cdSel, { flex: "1 1 190px", minWidth: 0, borderColor: t.ref ? "var(--border)" : CD_RED })}>
                <option value="">Not set — nobody is alerted</option>
                {opts && opts.roles.length > 0 && <optgroup label="Whoever is on call for">{opts.roles.map((r) => <option key={r} value={"oncall:" + r}>{r}</option>)}</optgroup>}
                {opts && opts.people.length > 0 && <optgroup label="Always this person">{opts.people.map((p) => <option key={p.id} value={"user:" + p.id}>{p.name}</option>)}</optgroup>}
                {t.ref && opts && !(t.kind === "oncall" ? opts.roles.includes(t.ref) : opts.people.some((p) => String(p.id) === t.ref)) && <option value={valOf(t)}>{t.kind === "oncall" ? t.ref + " (no longer on the on-call board)" : "A person no longer on DocTurn"}</option>}
              </select>
              <Button size="sm" variant="ghost" icon="x" aria-label="Remove team member" onClick={() => setTeam(team.filter((_, j) => j !== i))} />
            </div>
          ))}
          {team.length < 20 && <Button size="sm" variant="outline" icon="plus" onClick={() => setTeam(team.concat([{ label: "", kind: "oncall", ref: "" }]))}>Add a team member</Button>}
          {unassigned > 0 && <div data-code-unassigned style={{ fontSize: 12.5, color: CD_RED, marginTop: 8, lineHeight: 1.45 }}>{unassigned} team member{unassigned === 1 ? " has" : "s have"} nobody set. Until you choose an on-call role or a person, a code will show them as not alerted.</div>}
          {opts && opts.failed && <div style={{ fontSize: 12.5, color: CD_RED, marginTop: 8 }}>Couldn't load the on-call roles and people.</div>}
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.45 }}>On-call roles come from the Who's on call board and consult services. Only people with a DocTurn account can be alerted.</div>
        </div>
        <div>
          <div style={cdLabel}>Timed steps — minutes are counted from when the code is called</div>
          {steps.map((s, i) => (
            <div key={i} data-code-step-row style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
              <input aria-label="Step" value={s.label} maxLength={80} placeholder="Step, e.g. CT head started" onChange={(e) => upStep(i, { label: e.target.value })} style={Object.assign({}, cdSel, { flex: "1 1 220px", minWidth: 0 })} />
              <input aria-label="Target minutes" type="number" min="1" max="1440" value={s.targetMin == null ? "" : s.targetMin} placeholder="min" onChange={(e) => upStep(i, { targetMin: e.target.value === "" ? null : e.target.value })} style={Object.assign({}, cdSel, { width: 84 })} />
              <Button size="sm" variant="ghost" icon="x" aria-label="Remove step" onClick={() => setSteps(steps.filter((_, j) => j !== i))} />
            </div>
          ))}
          {steps.length < 15 && <Button size="sm" variant="outline" icon="plus" onClick={() => setSteps(steps.concat([{ label: "", targetMin: null }]))}>Add a step</Button>}
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" data-code-enabled checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Clinicians can call this code
        </label>
        {error && <div role="alert" data-code-editor-error style={{ fontSize: 13, color: CD_RED }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon="save" onClick={save} disabled={busy}>{initial.id ? "Save changes" : "Save protocol"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Codes() {
  const api = window.DT.actions.codes;
  const snap = useCodes();
  const [calling, setCalling] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const data = snap.data;
  const activeCodes = data ? data.activations.filter((a) => a.status === "active") : [];
  const now = useNow(activeCodes.length > 0);
  if (!snap.loaded) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading codes…</Card></PageWrap>;
  if (!data) return <PageWrap><Card style={{ padding: 36, textAlign: "center" }}><div data-codes-unavailable role="alert" style={{ fontSize: 14, fontWeight: 700 }}>Codes could not be loaded from the server.</div><div style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "6px 0 14px" }}>This screen is not showing whether a code is running. Call codes the way your hospital does without DocTurn until it loads.</div><Button variant="outline" icon="refresh-cw" onClick={() => api.refresh()}>Try again</Button></Card></PageWrap>;

  const closed = data.activations.filter((a) => a.status !== "active");
  const callable = data.protocols.filter((p) => p.enabled);
  const fromTemplate = (t) => setEditing({ name: t.name, description: t.description, enabled: true,
    team: t.team.map((label) => ({ label, kind: "oncall", ref: "" })), steps: t.steps.map((s) => ({ label: s[0], targetMin: s[1] })) });
  const remove = (p) => {
    if (window.confirm("Delete the protocol “" + p.name + "”? Codes already called with it stay in the history.")) api.removeProtocol(p.id).catch(cdToastFail("Couldn't delete the protocol"));
  };
  return (
    <PageWrap>
      <SectionTitle>Call a code</SectionTitle>
      {callable.length ? (
        <div data-code-call style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
          {callable.map((p) => (
            <button key={p.id} type="button" data-code-call-btn={p.id} onClick={() => setCalling(p)}
              style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "14px 20px", minHeight: 52, borderRadius: "var(--radius-md)", border: "2px solid " + CD_RED, background: "var(--card)", color: CD_RED, fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
              <Icon name="siren" size={18} color={CD_RED} />{p.name}
            </button>
          ))}
        </div>
      ) : (
        <Card style={{ padding: 22, marginBottom: 22, fontSize: 13, color: "var(--muted-foreground)" }}>
          <div data-code-none>{data.canManage ? "No protocols yet. Add one below, starting from a common one or from blank." : "Your hospital has not set up any code protocols in DocTurn yet. A director adds them here."}</div>
        </Card>
      )}

      <SectionTitle>In progress</SectionTitle>
      {activeCodes.length ? activeCodes.map((a) => <CodeCard key={a.id} a={a} now={now} />)
        : <Card style={{ padding: 22, marginBottom: 22, fontSize: 13, color: "var(--muted-foreground)" }}><div data-code-idle>No code is running.</div></Card>}

      {closed.length > 0 && <React.Fragment><SectionTitle>Recent</SectionTitle>{closed.map((a) => <CodeCard key={a.id} a={a} now={now} />)}</React.Fragment>}

      {data.canManage && (
        <React.Fragment>
          <SectionTitle action={<Button size="sm" icon="plus" onClick={() => setEditing({ name: "", description: "", team: [{ label: "", kind: "oncall", ref: "" }], steps: [], enabled: true })}>New protocol</Button>}>Protocols</SectionTitle>
          <Card style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
            {data.protocols.length === 0 && <div style={{ padding: 18, fontSize: 13, color: "var(--muted-foreground)" }}>None yet.</div>}
            {data.protocols.map((p) => {
              const unset = p.team.filter((t) => !t.ref).length;
              return (
                <div key={p.id} data-code-protocol={p.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name} {!p.enabled && <Badge variant="secondary">Off</Badge>}</div>
                    <div style={{ fontSize: 12.5, color: unset ? CD_RED : "var(--muted-foreground)" }}>
                      {p.team.length} on the team · {p.steps.length} timed step{p.steps.length === 1 ? "" : "s"}{unset ? " · " + unset + " team member" + (unset === 1 ? "" : "s") + " not set" : ""}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" icon="pencil" onClick={() => setEditing(p)}>Edit</Button>
                  <Button size="sm" variant="outline" icon="trash-2" onClick={() => remove(p)}>Delete</Button>
                </div>
              );
            })}
          </Card>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "var(--muted-foreground)" }}>
            Start from a common one:
            {data.templates.filter((t) => !data.protocols.some((p) => p.name.toLowerCase() === t.name.toLowerCase())).map((t) => (
              <Button key={t.key} size="sm" variant="outline" onClick={() => fromTemplate(t)}>{t.name}</Button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.45 }}>The starting teams and target times are common ones. Set each to your hospital's own protocol before clinicians rely on it.</div>
        </React.Fragment>
      )}

      {calling && <CodeActivate protocol={calling} onClose={() => setCalling(null)} />}
      {editing && <CodeProtocolEditor initial={editing} onClose={() => setEditing(null)} />}
    </PageWrap>
  );
}

window.Codes = Codes;
window.CodeBanner = CodeBanner;
