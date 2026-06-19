/* DocTurn web-app UI kit — My Care Team (on-call pairing).
   New capability: any clinician links their own midlevels (NP, PA) or partner
   doctors into an on-call unit. Paired + on-call members receive assignment
   requests together and appear on every assignment thread. */

const TEAM_ROLE = {
  MD: { label: "MD", tint: "blue",    fg: "var(--primary)" },
  DO: { label: "DO", tint: "blue",    fg: "var(--primary)" },
  PA: { label: "PA", tint: "emerald", fg: "var(--status-accepted)" },
  NP: { label: "NP", tint: "amber",   fg: "var(--status-pending)" },
  RN: { label: "RN", tint: "slate",   fg: "var(--status-neutral)" },
};
function RolePill({ role }) {
  const r = TEAM_ROLE[role] || TEAM_ROLE.MD;
  return <span style={{ padding: "1px 7px", borderRadius: "var(--radius-full)", fontSize: 11, fontWeight: 700, letterSpacing: ".02em",
    background: { blue: "#DBEAFE", emerald: "var(--status-accepted-bg)", amber: "var(--status-pending-bg)", slate: "var(--status-neutral-bg)" }[r.tint], color: r.fg }}>{r.label}</span>;
}

function CareTeam({ me, team, candidates, onAdd, onRemove, onToggleCall }) {
  const [adding, setAdding] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const onCall = team.filter((m) => m.onCall);
  const pool = candidates.filter((c) =>
    !team.some((t) => t.id === c.id) &&
    (c.name.toLowerCase().includes(query.toLowerCase()) || c.specialty.toLowerCase().includes(query.toLowerCase())));

  return (
    <PageWrap>
      {/* Explainer */}
      <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "13px 15px", marginBottom: 20, borderRadius: "var(--radius-md)", background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
        <Icon name="link" size={17} color="var(--primary)" style={{ marginTop: 1 }} />
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "#1E3A5F" }}>
          <strong>Anyone on your on-call unit is connected to you.</strong> When you and a team member are both on call,
          new assignment requests reach both of you, and they appear on every assignment thread — so nothing waits on one person.
        </div>
      </div>

      {/* Connected on-call unit */}
      <SectionTitle>Your on-call unit</SectionTitle>
      <Card style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, width: 96 }}>
            <Avatar initials={me.avatar} size={52} tint="blue" />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{me.name.split(" ").slice(-1)}</div>
              <div style={{ marginTop: 3 }}><RolePill role={me.role} /></div>
            </div>
          </div>

          {onCall.length === 0 ? (
            <div style={{ flex: 1, padding: "0 20px", fontSize: 13, color: "var(--muted-foreground)" }}>
              No one else on call yet. Add a midlevel or partner below to share incoming requests.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--status-accepted)", padding: "0 6px" }}>
                <span style={{ width: 30, height: 2, background: "var(--status-accepted)", borderRadius: 2 }} />
                <Icon name="link-2" size={16} />
                <span style={{ width: 30, height: 2, background: "var(--status-accepted)", borderRadius: 2 }} />
              </div>
              {onCall.map((m) => (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, width: 96 }}>
                  <Avatar initials={m.avatar} size={52} tint={TEAM_ROLE[m.role].tint} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{m.name.split(",")[0].split(" ").slice(-1)}</div>
                    <div style={{ marginTop: 3 }}><RolePill role={m.role} /></div>
                  </div>
                </div>
              ))}
              <div style={{ flex: 1, minWidth: 160, paddingLeft: 18 }}>
                <Badge status="accepted" icon="circle">Connected · {onCall.length + 1} on call</Badge>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 7, lineHeight: 1.45 }}>
                  Requests and threads are shared across everyone shown here.
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Team management */}
      <SectionTitle action={
        <Button size="sm" variant={adding ? "secondary" : "outline"} icon={adding ? "x" : "user-plus"} onClick={() => setAdding(!adding)}>
          {adding ? "Close" : "Add member"}
        </Button>
      }>Care team members</SectionTitle>

      {adding && (
        <Card style={{ padding: 14, marginBottom: 14, background: "var(--secondary)" }}>
          <Field icon="search" value={query} onChange={setQuery} placeholder="Search providers and midlevels to link…" />
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflow: "auto" }}>
            {pool.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "6px 4px" }}>No matches.</div>}
            {pool.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 10px", background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                <Avatar initials={c.avatar} size={32} tint={TEAM_ROLE[c.role].tint} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>{c.name}<RolePill role={c.role} /></div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{c.specialty}</div>
                </div>
                <Button size="sm" icon="plus" onClick={() => onAdd(c.id)}>Link</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {team.length === 0 && (
          <div style={{ padding: 32, textAlign: "center" }}>
            <Icon name="users" size={24} color="var(--muted-foreground)" />
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>No team members yet</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>Add a midlevel or partner to share your on-call load.</div>
          </div>
        )}
        {team.map((m, i) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={m.avatar} size={38} tint={TEAM_ROLE[m.role].tint} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>{m.name}<RolePill role={m.role} /></div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{m.specialty}</div>
            </div>
            <button onClick={() => onToggleCall(m.id)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}>
              <StatusDot status={m.onCall ? "online" : "offline"} pulse={m.onCall} />
              {m.onCall ? "On call" : "Off call"}
            </button>
            <button onClick={() => onRemove(m.id)} title="Remove from team"
              style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
              <Icon name="user-minus" size={16} />
            </button>
          </div>
        ))}
      </Card>
    </PageWrap>
  );
}

Object.assign(window, { CareTeam, RolePill, TEAM_ROLE });
