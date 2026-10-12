/* DocTurn web-app UI kit — Emergency Broadcasts.
   Spec: Req FR-6.5 (emergency broadcasts to targeted roles, ack tracking).
   Director surface. Everything is the server's (A.CON comms-account
   #10-#12): the audience is stored with the broadcast and only those people
   get it; the levels are the server's three; the ack rule follows the level. */

function Broadcasts({ onSend, broadcasts = [] }) {
  const [severity, setSeverity] = React.useState("warning");
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [audience, setAudience] = React.useState(["all"]);
  const [sending, setSending] = React.useState(false);

  // The server's three levels (info / urgent / critical); "Warning" is the
  // kit's name for urgent. There is no fourth "Emergency" level on the
  // server, so none is offered (A.CON comms-account #12).
  const SEV = [
    ["info", "Info", "info", "var(--status-active)", "var(--status-active-bg)"],
    ["warning", "Warning", "alert-triangle", "var(--status-pending)", "var(--status-pending-bg)"],
    ["critical", "Critical", "alert-octagon", "var(--status-rejected)", "var(--status-rejected-bg)"],
  ];
  // Roles the server can address (BROADCAST_AUDIENCE) — or everyone.
  const ROLES = [["hospitalist", "Hospitalists"], ["er_doctor", "ER physicians"], ["er_director", "ER directors"], ["director", "Directors"], ["all", "Everyone"]];
  const ROLE_LABEL = { hospitalist: "Hospitalists", er_doctor: "ER physicians", er_director: "ER directors", director: "Directors" };

  // "Everyone" stands alone; picking a role replaces it, and vice versa.
  const toggleAud = (r) => setAudience((a) => {
    if (r === "all") return ["all"];
    const roles = a.filter((x) => x !== "all");
    return roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];
  });

  const sevMeta = (id) => SEV.find((s) => s[0] === id) || SEV[1];
  const role = (window.DT && window.DT.getState().session || {}).role;
  const isDirector = role === "director" || role === "er_director" || role === "developer";
  // The server decides acknowledgement from the level: Warning and Critical
  // ask every recipient to confirm, Info does not. Stated, not switchable
  // (A.CON comms-account #11).
  const ackRequired = severity !== "info";

  const send = () => {
    if (sending) return;
    if (!title.trim()) { window.DT.actions.toast({ tone: "rejected", title: "Title required", msg: "Add a short, scannable headline." }); return; }
    if (!audience.length) { window.DT.actions.toast({ tone: "rejected", title: "Pick an audience", msg: "Select at least one group to notify." }); return; }
    if (!onSend) return;
    setSending(true);
    // The draft is cleared only when the server says it went out.
    Promise.resolve(onSend({ title: title, message: message, severity: severity, audience: audience })).then((ok) => {
      setSending(false);
      if (ok !== false) { setTitle(""); setMessage(""); }
    }, () => setSending(false));
  };

  return (
    <PageWrap>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Composer */}
        <div>
          <SectionTitle>Compose broadcast</SectionTitle>
          <Card style={{ padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Severity</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 16 }}>
              {SEV.map(([id, label, icon, fg, bg]) => {
                const on = severity === id;
                return (
                  <button key={id} onClick={() => setSeverity(id)} data-broadcast-severity={id} aria-pressed={on}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, padding: "8px 6px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13.5, fontWeight: 600, minWidth: 0,
                      border: on ? `1.5px solid ${fg}` : "1px solid var(--border)",
                      background: on ? bg : "#fff", color: on ? fg : "var(--foreground)" }}>
                    <Icon name={icon} size={16} />{label}
                  </button>
                );
              })}
            </div>

            <div style={{ marginBottom: 14 }}>
              <Field label="Title" icon="megaphone" value={title} onChange={setTitle} placeholder="Short, scannable headline" />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Field label="Message" value={message} onChange={setMessage} textarea rows={3} placeholder="Plain, calm, action-oriented. No PHI." help="Avoid patient-identifying details. Use initials only if needed." />
            </div>

            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Target audience</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
              {ROLES.map(([id, label]) => {
                const on = audience.includes(id);
                return (
                  <button key={id} onClick={() => toggleAud(id)} data-broadcast-audience={id} aria-pressed={on}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "6px 14px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 13, fontWeight: 500,
                      border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "#EFF6FF" : "#fff", color: on ? "var(--primary)" : "var(--foreground)" }}>
                    {on && <Icon name="check" size={13} />}{label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 16 }}>
              {audience.includes("all") || !audience.length
                ? "Everyone in your organization except you."
                : "Only the active accounts holding these roles when you send it; nobody else is alerted or can see it (directors see it without being asked to acknowledge)."}
            </div>

            <div data-broadcast-ack-rule={ackRequired ? "required" : "none"} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
              <Icon name={ackRequired ? "check-check" : "bell-off"} size={16} color="var(--muted-foreground)" style={{ marginTop: 2, flex: "none" }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{ackRequired ? "Acknowledgement required" : "No acknowledgement"}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  {ackRequired ? "Warning and Critical broadcasts ask every recipient to confirm receipt; you see who has." : "Info broadcasts are not acknowledged. Pick Warning or Critical to require it."}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <Button full icon="send" onClick={send} style={{ opacity: sending ? 0.6 : 1 }}>{sending ? "Sending…" : "Send broadcast"}</Button>
            </div>
          </Card>
        </div>

        {/* Recent + ack tracking */}
        <div>
          <SectionTitle>Recent broadcasts</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {broadcasts.length === 0 && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No broadcasts sent yet.</Card>}
            {broadcasts.map((b, i) => {
              const sm = sevMeta(b.sev);
              const pct = b.total ? Math.round((b.acked / b.total) * 100) : 0;
              // A live (server) broadcast carries senderId; mine = I sent it.
              // Recipients of an ack-required broadcast (the server says who:
              // b.recipient) get an Acknowledge button; the sender / directors
              // see the tally.
              const live = b.senderId != null;
              const recipient = live && !b.mine && b.recipient !== false;
              const to = Array.isArray(b.audience) && b.audience.length ? b.audience.map((r) => ROLE_LABEL[r] || r).join(", ") : "everyone";
              const showTally = b.ackReq && (!live || b.mine || isDirector);
              return (
                <Card key={b.id || i} style={{ padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: sm[4], color: sm[3] === "#fff" ? "#fff" : sm[3], display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      <Icon name={sm[2]} size={18} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{b.title}</div>
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{sm[1]} · sent {dtFmt.ago(b.at)}{b.senderName ? " · " + (b.mine ? "you" : b.senderName) : ""}</div>
                      {live && <div data-broadcast-to style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>To: {to}</div>}
                    </div>
                  </div>
                  {recipient && b.ackReq && (
                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                      {b.ackedByMe
                        ? <Badge status="accepted" icon="check-check">Acknowledged{b.ackedAt ? " · " + dtFmt.ago(b.ackedAt) : ""}</Badge>
                        : <Button size="sm" icon="check" data-broadcast-ack={b.id} onClick={() => window.DT.actions.ackBroadcast && window.DT.actions.ackBroadcast(b.id)}>Acknowledge</Button>}
                      {!b.ackedByMe && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Acknowledgement required.</span>}
                    </div>
                  )}
                  {showTally ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                        <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>Acknowledged</span>
                        <span data-ack-tally style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{b.acked}/{b.total} · {pct}%</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 99, background: "var(--secondary)", overflow: "hidden" }}>
                        <div style={{ width: pct + "%", height: "100%", borderRadius: 99, background: pct === 100 ? "var(--status-accepted)" : "var(--status-pending)" }} />
                      </div>
                      {(b.ackedBy || []).length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted-foreground)" }}>
                          {b.ackedBy.map((p) => p.displayName).filter(Boolean).slice(0, 6).join(", ")}{b.ackedBy.length > 6 ? " +" + (b.ackedBy.length - 6) + " more" : ""}
                        </div>
                      )}
                    </div>
                  ) : (!b.ackReq && (
                    <div style={{ marginTop: 10 }}><Badge variant="secondary" icon="bell-off">No acknowledgement required</Badge></div>
                  ))}
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </PageWrap>
  );
}

Object.assign(window, { Broadcasts });
