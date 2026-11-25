/* DocTurn web-app UI kit — Admissions tracker (the staff home screen).
   For a charge nurse: every patient on the board, who was asked to take them,
   and whether that hospitalist has accepted. Rows are the server's patient
   board (GET /api/patient-board) — the same rows physicians see — and this
   screen changes nothing on them. It can message the person being waited on. */

function sdAgo(ms, now) {
  if (!ms) return "";
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60);
  return h + " h " + (m % 60) + " min ago";
}
function sdIn(ms, now) {
  const m = Math.round((ms - now) / 60000);
  return m <= 0 ? "lapsing now" : "lapses in " + m + " min";
}

/* The charge nurse's one action on an admission: the bed is ready, and where. */
function StaffBed({ r }) {
  const [unit, setUnit] = React.useState(r.bedUnit || "");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setUnit(r.bedUnit || ""); }, [r.bedUnit]);
  const set = (ready) => {
    setBusy(true);
    window.DT.actions.setBedReady(r.patientId, ready, unit).catch(() => window.DT.set((s) => { s.__toast = { tone: "rejected", title: "Couldn't update the bed", msg: "The server did not accept that. Nothing changed." }; return s; })).then(() => setBusy(false));
  };
  if (r.bedReadyAt) return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <BedReadyChip p={r} />
      <Button size="sm" variant="ghost" onClick={() => set(false)} disabled={busy}>Undo</Button>
    </span>
  );
  return (
    <span data-staff-bed style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input aria-label={"Unit or bed for patient " + r.initials} value={unit} maxLength={30} placeholder="Unit / bed" onChange={(e) => setUnit(e.target.value)}
        style={{ height: 34, width: 120, padding: "0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--font-sans)", fontSize: 13 }} />
      <Button size="sm" icon="bed" onClick={() => set(true)} disabled={busy}>Bed ready</Button>
    </span>
  );
}

function StaffDashboard({ board, boardLoaded, boardError, onMessage, myUserId }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const rows = (board || []).filter((r) => r.status !== "discharged");
  const accepted = rows.filter((r) => r.status === "assigned");
  const open = rows.filter((r) => r.status !== "assigned")
    .sort((x, y) => (x.enteredAt || 0) - (y.enteredAt || 0)); // longest wait first
  const longest = open.length && open[0].enteredAt ? Math.round((now - open[0].enteredAt) / 60000) : null;

  // What is holding each open admission up, in words.
  const state = (r) => {
    const q = r.request, who = q && q.to ? q.to.name : "a hospitalist";
    if (!q) return { key: "unrouted", tone: "pending", label: "Not sent yet", text: "No hospitalist has been asked." };
    if (q.status === "pending") return { key: "pending", tone: "pending", label: "Waiting", text: "Sent to " + who + " " + sdAgo(q.sentAt, now) + (q.expiresAt ? " · " + sdIn(q.expiresAt, now) : "") };
    if (q.status === "rejected") return { key: "declined", tone: "rejected", label: "Declined", text: who + " declined " + sdAgo(q.resolvedAt, now) + ". It needs sending to someone else." };
    if (q.status === "expired") return { key: "expired", tone: "rejected", label: "No answer", text: who + " did not answer in time. It needs sending again." };
    return { key: "unrouted", tone: "pending", label: "Not sent", text: "The last request was cancelled. Nobody is being asked right now." };
  };
  const tile = (key, label, value, sub) => (
    <Card style={{ padding: "14px 18px", flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>{label}</div>
      <div data-staff-tile={key} style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{sub}</div>}
    </Card>
  );
  const patientCell = (r) => (
    <div style={{ flex: "1 1 180px", minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>Patient {r.initials}{r.room && r.room !== "—" ? " · " + r.room : ""}</div>
      <PatientIdentity p={r} />
      {r.issue && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.issue}</div>}
    </div>
  );
  const rowStyle = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 18px", borderBottom: "1px solid var(--border)" };

  if (boardError && !boardLoaded) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13 }}><div data-staff-error role="alert">Admissions could not be loaded from the server.</div></Card></PageWrap>;
  if (!boardLoaded) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}><div data-staff-loading>Loading admissions…</div></Card></PageWrap>;
  return (
    <PageWrap>
      {boardError && <div data-staff-stale role="alert" style={{ padding: "10px 14px", marginBottom: 14, borderRadius: "var(--radius-md)", background: "var(--status-rejected-bg)", color: "var(--status-rejected-fg)", fontSize: 13, fontWeight: 600 }}>The latest update did not load. What you see may be out of date.</div>}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        {tile("open", "Not accepted yet", open.length, open.length ? "longest " + (longest == null ? "—" : longest + " min") : "nothing waiting")}
        {tile("accepted", "Accepted", accepted.length, "still on the board")}
      </div>

      <SectionTitle>Not accepted yet</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 22 }}>
        {open.length === 0 && <div data-staff-open-empty style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Every patient on the board has a hospitalist.</div>}
        {open.map((r) => {
          const s = state(r), to = r.request && r.request.to;
          return (
            <div key={r.id} data-staff-open={s.key} style={rowStyle}>
              <Badge status={s.tone}>{s.label}</Badge>
              {patientCell(r)}
              <div style={{ flex: "2 1 240px", minWidth: 0, fontSize: 13 }}>{s.text}</div>
              {to && to.userId !== myUserId && onMessage && <Button size="sm" variant="outline" icon="message-square" onClick={() => onMessage({ userId: to.userId, id: to.userId, name: to.name })}>Message</Button>}
            </div>
          );
        })}
      </Card>

      <SectionTitle>Accepted</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {accepted.length === 0 && <div data-staff-accepted-empty style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No accepted patients on the board.</div>}
        {accepted.map((r) => (
          <div key={r.id} data-staff-accepted style={rowStyle}>
            <Badge status="accepted">Accepted</Badge>
            {patientCell(r)}
            <div style={{ flex: "2 1 200px", minWidth: 0, fontSize: 13 }}>
              {(r.attending && r.attending.name) || "A hospitalist"}{r.request && r.request.resolvedAt ? " · " + sdAgo(r.request.resolvedAt, now) : ""}
            </div>
            <StaffBed r={r} />
          </div>
        ))}
      </Card>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.45 }}>Updates as hospitalists answer. Sending and re-sending admissions is done by the ER physician or a director.</div>
    </PageWrap>
  );
}
window.StaffDashboard = StaffDashboard;
