/* DocTurn web-app UI kit — Demo access (platform operator).
   The demo is by invitation (server/demo-gate.ts). This screen makes a link
   for one person, shows it ONCE, and lists every invitation with when it was
   last used. All of it is the server's; the link itself is never stored. */

function DemoAccess() {
  const act = window.DT.actions.demoInvites;
  const [data, setData] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [days, setDays] = React.useState("7");
  const [made, setMade] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const load = () => act.list().then((d) => { setData(d); setFailed(false); }).catch(() => setFailed(true));
  React.useEffect(() => { load(); }, []);
  const when = (t) => (t ? (window.dtFmt && window.dtFmt.stamp ? window.dtFmt.stamp(Date.parse(t)) : new Date(t).toLocaleString()) : "—");
  const create = () => {
    if (!label.trim()) { setError("Say who the link is for."); return; }
    setBusy(true); setError("");
    act.create(label.trim(), Number(days)).then((r) => { setMade({ label: r.invite.label, link: window.location.origin + r.path, expiresAt: r.invite.expiresAt }); setLabel(""); load(); })
      .catch((e) => setError(String(e && e.message) === "demo_gate_off" ? "The gate is off, so there is nothing for a link to open. Set DEMO_ACCESS_KEY on the server first." : "The server did not create the link.")).then(() => setBusy(false));
  };
  const revoke = (i) => { if (window.confirm("Revoke the link for " + i.label + "? It stops working within 20 seconds.")) act.revoke(i.id).then(load).catch(() => setError("The server did not revoke that link.")); };
  const copy = () => { try { navigator.clipboard.writeText(made.link); window.DT.set((s) => { s.__toast = { tone: "accepted", title: "Link copied", msg: made.label }; return s; }); } catch (e) {} };

  if (failed && !data) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13 }}><div role="alert" data-demo-access-error>Demo access could not be loaded from the server.</div></Card></PageWrap>;
  if (!data) return <PageWrap><Card style={{ padding: 36, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading…</Card></PageWrap>;
  const th = { textAlign: "left", padding: "9px 14px", fontSize: 11.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: ".04em", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
  const td = { padding: "9px 14px", fontSize: 13, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  return (
    <PageWrap>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div data-demo-gate={data.gateOn ? "on" : "off"} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <Icon name="lock-keyhole" size={17} color="var(--primary-ink)" />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>The demo is {data.gateOn ? "by invitation" : "open to anyone"}</h3>
          <Badge status={data.gateOn ? "accepted" : "rejected"}>{data.gateOn ? "Gate on" : "Gate off"}</Badge>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          {data.gateOn
            ? "Nobody can open the app or download its code without a link from this page. The public website stays open. Your own way in is the link made from the access key set on the server."
            : !data.synthetic ? "This instance holds real accounts, so the invitation gate does not apply: people sign in with their own accounts."
            : "Anyone with the demo sign-in can open the app. To close it, set DEMO_ACCESS_KEY (24 characters or more) on the server; links made here start working as the only way in."}
        </div>
      </Card>

      <Card style={{ padding: 18, marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>Invite someone</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "2 1 240px", minWidth: 0 }}><Field label="Who is it for" value={label} onChange={setLabel} placeholder="e.g. Dr. Lee, Riverside General" inputProps={{ maxLength: 80, "data-demo-label": true }} /></div>
          <div>
            <label htmlFor="demo-days" style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Lasts</label>
            <select id="demo-days" data-demo-days value={days} onChange={(e) => setDays(e.target.value)} style={{ height: 44, padding: "0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--input)", background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--font-sans)", fontSize: 14 }}>
              {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
            </select>
          </div>
          <Button icon="link" onClick={create} disabled={busy}>Create link</Button>
        </div>
        {error && <div role="alert" style={{ fontSize: 13, color: "var(--destructive)", marginTop: 10 }}>{error}</div>}
        {made && (
          <div data-demo-made style={{ marginTop: 14, padding: 12, borderRadius: "var(--radius-md)", background: "var(--status-pending-bg)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Link for {made.label} — copy it now. It is not shown again. Ends {when(made.expiresAt)}.</div>
            <code data-demo-link style={{ fontSize: 12.5, overflowWrap: "anywhere", userSelect: "all" }}>{made.link}</code>
            <div style={{ marginTop: 10 }}><Button size="sm" variant="outline" icon="copy" onClick={copy}>Copy link</Button></div>
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 12, lineHeight: 1.45 }}>A link keeps working until its end date even if this server restarts and loses its records; it then shows below as made before the last restart. On a server without a permanent database a revocation is also lost at a restart, so to end every link for certain, change the access key. One link per person, so you can see who looked and revoke one without affecting the others. An invitation making more than {data.rateLimit} requests in five minutes is slowed down.</div>
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, borderBottom: "1px solid var(--border)" }}>Invitations</div>
        {data.invites.length === 0 ? <div data-demo-empty style={{ padding: 24, fontSize: 13, color: "var(--muted-foreground)" }}>No invitations yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table data-demo-table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["For", "Status", "Ends", "First opened", "Last seen", "Times opened", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
              <tbody>{data.invites.map((i) => (
                <tr key={i.id} data-demo-invite={i.state}>
                  <td style={Object.assign({}, td, { fontWeight: 600, whiteSpace: "normal" })}>{i.restored ? "A link made before the last restart" : i.label}</td>
                  <td style={td}><Badge status={i.state === "active" ? "accepted" : i.state === "revoked" ? "rejected" : "expired"}>{i.state === "active" ? "Active" : i.state === "revoked" ? "Revoked" : "Ended"}</Badge></td>
                  <td style={td}>{when(i.expiresAt)}</td><td style={td}>{when(i.firstUsedAt)}</td><td style={td}>{when(i.lastSeenAt)}</td><td style={td}>{i.visits}</td>
                  <td style={td}>{i.state === "active" && <Button size="sm" variant="outline" icon="ban" onClick={() => revoke(i)}>Revoke</Button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </PageWrap>
  );
}
window.DemoAccess = DemoAccess;
