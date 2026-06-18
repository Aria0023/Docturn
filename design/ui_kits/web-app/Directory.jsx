/* DocTurn web-app UI kit — provider directory (compact single-row list) */

function Directory({ providers, onMessage }) {
  const [q, setQ] = React.useState("");
  const list = providers.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.specialty.toLowerCase().includes(q.toLowerCase()));
  return (
    <PageWrap>
      <SectionTitle action={<div style={{ width: 240 }}><Field icon="search" placeholder="Search name or specialty…" value={q} onChange={setQ} /></div>}>
        Provider directory
      </SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {list.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <div style={{ position: "relative", flex: "none" }}>
              <Avatar initials={p.avatar} size={34} tint={p.working ? "emerald" : "slate"} />
              <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={p.working ? "online" : "offline"} pulse={p.working} /></span>
            </div>
            <div style={{ minWidth: 0, width: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.specialty}</div>
            </div>
            <Badge status={p.working ? "online" : "offline"}>{p.working ? "On shift" : "Off shift"}</Badge>
            <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="users" size={13} /> {p.census}/{p.cap}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Button size="icon" variant="outline" icon="message-square" onClick={() => onMessage && onMessage({ name: p.name, role: p.specialty, specialty: p.specialty, avatar: p.avatar, working: p.working, tint: p.working ? "emerald" : "slate" })} />
              <Button size="icon" variant="ghost" icon="phone" onClick={() => window.DT.actions.toast({ tone: "sent", title: "Calling " + p.name, msg: "Connecting on the secure line…" })} />
            </div>
          </div>
        ))}
        {list.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--muted-foreground)", fontSize: 13 }}>No providers match "{q}".</div>}
      </Card>
    </PageWrap>
  );
}

Object.assign(window, { Directory });
