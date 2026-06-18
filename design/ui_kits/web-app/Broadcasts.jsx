/* DocTurn web-app UI kit — Emergency Broadcasts.
   Spec: Req FR-6.5 (emergency broadcasts to targeted roles/departments,
   optional ack required, ack tracking). Director surface. */

function Broadcasts({ onSend, broadcasts = [] }) {
  const [severity, setSeverity] = React.useState("warning");
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [requireAck, setRequireAck] = React.useState(true);
  const [audience, setAudience] = React.useState(["hospitalist"]);

  const SEV = [
    ["info", "Info", "info", "var(--status-active)", "var(--status-active-bg)"],
    ["warning", "Warning", "alert-triangle", "var(--status-pending)", "var(--status-pending-bg)"],
    ["critical", "Critical", "alert-octagon", "var(--status-rejected)", "var(--status-rejected-bg)"],
    ["emergency", "Emergency", "siren", "#fff", "var(--status-rejected)"],
  ];
  const ROLES = [["hospitalist", "Hospitalists"], ["er_doctor", "ER physicians"], ["director", "Directors"], ["all", "Everyone"]];

  const toggleAud = (r) => setAudience((a) => a.includes(r) ? a.filter((x) => x !== r) : [...a, r]);

  const sevMeta = (id) => SEV.find((s) => s[0] === id) || SEV[0];

  const send = () => {
    if (!title.trim()) { window.DT.actions.toast({ tone: "rejected", title: "Title required", msg: "Add a short, scannable headline." }); return; }
    if (!audience.length) { window.DT.actions.toast({ tone: "rejected", title: "Pick an audience", msg: "Select at least one group to notify." }); return; }
    onSend && onSend({ title: title, message: message, severity: severity, ackReq: requireAck, audience: audience });
    setTitle(""); setMessage("");
  };

  return (
    <PageWrap>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Composer */}
        <div>
          <SectionTitle>Compose broadcast</SectionTitle>
          <Card style={{ padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Severity</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              {SEV.map(([id, label, icon, fg, bg]) => {
                const on = severity === id;
                return (
                  <button key={id} onClick={() => setSeverity(id)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                      border: on ? `1.5px solid ${fg === "#fff" ? bg : fg}` : "1px solid var(--border)",
                      background: on ? bg : "#fff", color: on ? (fg === "#fff" ? "#fff" : fg) : "var(--foreground)" }}>
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {ROLES.map(([id, label]) => {
                const on = audience.includes(id);
                return (
                  <button key={id} onClick={() => toggleAud(id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 13, fontWeight: 500,
                      border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "#EFF6FF" : "#fff", color: on ? "var(--primary)" : "var(--foreground)" }}>
                    {on && <Icon name="check" size={13} />}{label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>Require acknowledgement</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Recipients must confirm receipt.</div>
              </div>
              <button onClick={() => setRequireAck(!requireAck)}
                style={{ width: 44, height: 26, borderRadius: 99, border: "none", cursor: "pointer", position: "relative",
                  background: requireAck ? "var(--status-accepted)" : "var(--status-neutral-bg)", transition: "background .2s" }}>
                <span style={{ position: "absolute", top: 3, left: requireAck ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
              </button>
            </div>

            <div style={{ marginTop: 8 }}>
              <Button full icon="send" onClick={send}>Send broadcast</Button>
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
              return (
                <Card key={b.id || i} style={{ padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: sm[4], color: sm[3] === "#fff" ? "#fff" : sm[3], display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                      <Icon name={sm[2]} size={18} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{b.title}</div>
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{sm[1]} · sent {dtFmt.ago(b.at)}</div>
                    </div>
                  </div>
                  {b.ackReq ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                        <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>Acknowledged</span>
                        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{b.acked}/{b.total} · {pct}%</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 99, background: "var(--secondary)", overflow: "hidden" }}>
                        <div style={{ width: pct + "%", height: "100%", borderRadius: 99, background: pct === 100 ? "var(--status-accepted)" : "var(--status-pending)" }} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 10 }}><Badge variant="secondary" icon="bell-off">No acknowledgement required</Badge></div>
                  )}
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
