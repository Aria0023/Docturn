/* DocTurn web-app UI kit — Hand-off notes.
   For each of my patients: how sick, a summary, what to watch — for the
   physician who takes over. Notes handed to me are listed with Acknowledge.
   Everything is the server's (GET /api/handoffs) and lives in this screen's
   state only: clinical text is never put in the store or on the device. */

const HO_SEV = {
  stable: { label: "Stable", bg: "var(--status-accepted-bg)", fg: "var(--status-accepted-fg)" },
  watcher: { label: "Watch closely", bg: "var(--status-pending-bg)", fg: "var(--status-pending-fg)" },
  unstable: { label: "Unstable", bg: "var(--status-rejected-bg)", fg: "var(--status-rejected-fg)" },
};
const hoArea = { width: "100%", minHeight: 64, padding: "8px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.45, resize: "vertical", boxSizing: "border-box" };
const hoSel = { height: 36, padding: "0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--font-sans)", fontSize: 13, maxWidth: "100%" };
const hoWhen = (t) => (t ? (window.dtFmt && window.dtFmt.stamp ? window.dtFmt.stamp(Date.parse(t)) : new Date(t).toLocaleString()) : "");
function HoSeverity({ v }) {
  const s = HO_SEV[v] || HO_SEV.stable;
  return <span data-handoff-sev={v} style={{ padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>{s.label}</span>;
}
function HoPatient({ p }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>Patient {p.initials}{p.room ? " · " + p.room : ""}</div>
      <PatientIdentity p={{ fullName: p.fullName, dob: p.dateOfBirth, mrn: p.mrn }} />
      {p.issue && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p.issue}</div>}
    </div>
  );
}

function HandoffEditor({ item, colleagues, onSaved }) {
  const n = item.note;
  const [severity, setSeverity] = React.useState(n ? n.severity : "stable");
  const [summary, setSummary] = React.useState(n ? n.summary : "");
  const [todo, setTodo] = React.useState(n ? n.todo : "");
  const [to, setTo] = React.useState(n && n.toUserId ? String(n.toUserId) : "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const changed = !n || severity !== n.severity || summary !== n.summary || todo !== n.todo || to !== (n.toUserId ? String(n.toUserId) : "");
  const save = () => {
    if (!summary.trim() && !todo.trim()) { setError("Write a summary or what to watch."); return; }
    setBusy(true); setError("");
    window.DT.actions.handoffs.save(item.patient.id, { severity, summary: summary.trim(), todo: todo.trim(), toUserId: to ? Number(to) : null })
      .then(onSaved).catch(() => setError("The server did not save this note.")).then(() => setBusy(false));
  };
  return (
    <div data-handoff-mine={item.patient.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}><HoPatient p={item.patient} /></div>
        {n ? <span data-handoff-state style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
          {n.toName ? (n.acknowledgedAt ? "Acknowledged by " + n.toName + " · " + hoWhen(n.acknowledgedAt) : "Given to " + n.toName + " · not acknowledged yet") : "Saved · not given to anyone yet"}
        </span> : <span data-handoff-state style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No note yet</span>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }} role="radiogroup" aria-label="How sick">
        {Object.keys(HO_SEV).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={severity === k} data-handoff-sev-pick={k} onClick={() => setSeverity(k)}
            style={{ padding: "6px 12px", minHeight: 34, borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 700,
              border: "2px solid " + (severity === k ? HO_SEV[k].fg : "var(--border)"), background: severity === k ? HO_SEV[k].bg : "var(--card)", color: severity === k ? HO_SEV[k].fg : "var(--muted-foreground)" }}>{HO_SEV[k].label}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        <textarea aria-label={"Summary for patient " + item.patient.initials} data-handoff-summary maxLength={600} placeholder="Summary: why they are here, what has been done" value={summary} onChange={(e) => setSummary(e.target.value)} style={hoArea} />
        <textarea aria-label={"What to watch for patient " + item.patient.initials} data-handoff-todo maxLength={600} placeholder="To watch or do: pending results, if-then plans" value={todo} onChange={(e) => setTodo(e.target.value)} style={hoArea} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <select aria-label="Give this note to" data-handoff-to style={Object.assign({}, hoSel, { flex: "1 1 200px", minWidth: 0 })} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Not given to anyone yet (goes to your covering provider when you end your shift)</option>
          {colleagues.map((c) => <option key={c.id} value={c.id}>Give to {c.name}</option>)}
        </select>
        <Button size="sm" icon="save" onClick={save} disabled={busy || !changed}>{n ? "Save changes" : "Save note"}</Button>
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--destructive)", marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function Handoffs() {
  const act = window.DT.actions.handoffs;
  const [data, setData] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  const load = () => act.load().then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true));
  React.useEffect(() => { load(); return act.subscribe(load); }, []);
  if (failed && !data) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13 }}><div data-handoff-error role="alert">Hand-off notes could not be loaded from the server.</div></Card></PageWrap>;
  if (!data) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading hand-off notes…</Card></PageWrap>;
  const waiting = data.incoming.filter((i) => !i.note.acknowledgedAt);
  const ack = (id) => act.ack(id).then(load).catch(() => window.DT.set((s) => { s.__toast = { tone: "rejected", title: "Couldn't acknowledge", msg: "The server did not accept that." }; return s; }));
  return (
    <PageWrap>
      <SectionTitle>Handed to me{waiting.length ? " · " + waiting.length + " to acknowledge" : ""}</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 22 }}>
        {data.incoming.length === 0 && <div data-handoff-incoming-empty style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Nobody has handed a patient to you.</div>}
        {data.incoming.map((i) => (
          <div key={i.note.id} data-handoff-incoming={i.note.acknowledgedAt ? "acked" : "waiting"} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}><HoPatient p={i.patient} /></div>
              <HoSeverity v={i.note.severity} />
              {i.note.acknowledgedAt ? <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Acknowledged {hoWhen(i.note.acknowledgedAt)}</span>
                : <Button size="sm" icon="check" onClick={() => ack(i.note.id)}>Acknowledge</Button>}
            </div>
            {i.note.summary && <div style={{ fontSize: 13, marginTop: 10, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{i.note.summary}</div>}
            {i.note.todo && <div style={{ fontSize: 13, marginTop: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>To watch or do: </strong>{i.note.todo}</div>}
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8 }}>From {i.note.fromName || "a colleague"} · {hoWhen(i.note.createdAt)}</div>
          </div>
        ))}
      </Card>

      <SectionTitle>My patients</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {data.mine.length === 0 && <div data-handoff-mine-empty style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>You have no accepted patients on the board.</div>}
        {data.mine.map((m) => <HandoffEditor key={m.patient.id + ":" + (m.note ? m.note.id : 0)} item={m} colleagues={data.colleagues} onSaved={load} />)}
      </Card>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.45 }}>A note stays with the patient and is removed with them. Alerts about a note never contain what it says.</div>
    </PageWrap>
  );
}
window.Handoffs = Handoffs;
