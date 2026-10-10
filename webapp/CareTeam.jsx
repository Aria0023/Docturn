/* DocTurn web-app UI kit — My Care Team (on-call pairing).
   Any clinician links their own midlevels (NP, PA) or partner doctors into an
   on-call unit. It is the SERVER's (A.CON clinical #4): GET /api/care-team and
   POST / PATCH / DELETE /api/care-team/members/:id. A member marked On call
   receives the owner's new assignment requests too (the routing fan-out) and
   may accept them. The people to link are the org's real, active accounts. */

const TEAM_ROLE = {
  MD: { label: "MD", tint: "blue",    fg: "var(--primary-ink, #1D4ED8)" },
  DO: { label: "DO", tint: "blue",    fg: "var(--primary-ink, #1D4ED8)" },
  PA: { label: "PA", tint: "emerald", fg: "var(--status-accepted)" },
  NP: { label: "NP", tint: "amber",   fg: "var(--status-pending)" },
  RN: { label: "RN", tint: "slate",   fg: "var(--status-neutral)" },
};
// A credential pill (MD/DO/PA/NP/RN); someone without a credential shows
// their role label instead of a guessed "MD".
function RolePill({ role, label }) {
  const r = TEAM_ROLE[role];
  if (!r) return label ? <span style={{ padding: "1px 7px", borderRadius: "var(--radius-full)", fontSize: 11, fontWeight: 700, background: "var(--status-neutral-bg)", color: "var(--status-neutral)" }}>{label}</span> : null;
  return <span style={{ padding: "1px 7px", borderRadius: "var(--radius-full)", fontSize: 11, fontWeight: 700, letterSpacing: ".02em",
    background: { blue: "#DBEAFE", emerald: "var(--status-accepted-bg)", amber: "var(--status-pending-bg)", slate: "var(--status-neutral-bg)" }[r.tint], color: r.fg }}>{r.label}</span>;
}
const teamTint = (role) => (TEAM_ROLE[role] || {}).tint || "slate";

function CareTeam({ me, team, candidates, onAdd, onRemove, onToggleCall, providers = [], consultants = [], onMessage }) {
  const [adding, setAdding] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(null);
  const mobile = useIsMobile();
  const loaded = Array.isArray(team);
  const members = team || [];
  const onCall = members.filter((m) => m.onCall);
  // Doctors on service (rounding), and the consult specialties currently active.
  const doctors = (providers || []).slice().sort((a, b) => (b.working === a.working) ? 0 : (b.working ? 1 : -1));
  const q = query.toLowerCase();
  const pool = (candidates || []).filter((c) =>
    !members.some((t) => t.id === c.id) &&
    (c.name.toLowerCase().includes(q) || String(c.specialty || c.roleLabel || "").toLowerCase().includes(q)));
  // One write at a time per person; the screen follows the server's answer.
  const run = (key, fn) => { if (busy) return; setBusy(key); Promise.resolve(fn()).then(() => setBusy(null), () => setBusy(null)); };

  return (
    <PageWrap>
      {/* Explainer */}
      <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "13px 15px", marginBottom: 20, borderRadius: "var(--radius-md)", background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
        <Icon name="link" size={17} color="var(--primary)" style={{ marginTop: 1 }} />
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "#1E3A5F" }}>
          <strong>Members you mark On call share your new admission requests.</strong> Each request routed to you also
          reaches them, and any of them can accept it — so nothing waits on one person. Changes are saved for everyone.
        </div>
      </div>

      {/* Connected on-call unit */}
      <SectionTitle>Your on-call unit</SectionTitle>
      <Card style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, width: 96 }}>
            <Avatar initials={me.avatar} size={52} tint="blue" />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{String(me.name || "").split(",")[0].split(" ").slice(-1)}</div>
              <div style={{ marginTop: 3 }}><RolePill role={me.role} /></div>
            </div>
          </div>

          {onCall.length === 0 ? (
            <div style={{ flex: "1 1 180px", minWidth: 0, padding: "0 12px", fontSize: 13, color: "var(--muted-foreground)" }}>
              {loaded ? "No one else on call with you. Add a midlevel or partner below to share incoming requests." : "Loading your unit from the server…"}
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
                  <Avatar initials={m.avatar} size={52} tint={teamTint(m.role)} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{m.name.split(",")[0].split(" ").slice(-1)}</div>
                    <div style={{ marginTop: 3 }}><RolePill role={m.role} label={m.roleLabel} /></div>
                  </div>
                </div>
              ))}
              <div style={{ flex: 1, minWidth: 160, paddingLeft: 18 }}>
                <Badge status="accepted" icon="circle">{onCall.length} on call with you</Badge>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 7, lineHeight: 1.45 }}>
                  Your new admission requests also reach everyone shown here.
                </div>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Doctors on service */}
      <SectionTitle>Doctors on service</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        {doctors.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No hospitalists on service.</div>}
        {doctors.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <div style={{ position: "relative", flex: "none" }}>
              <Avatar initials={p.avatar} size={36} tint={p.working ? "emerald" : "slate"} />
              <span style={{ position: "absolute", bottom: -1, right: -1, display: "flex", border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={p.working ? "online" : "offline"} pulse={p.working} /></span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p.specialty} · {p.working ? "on shift" : "off shift"}</div>
            </div>
            <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="users" size={13} />{p.census}/{p.cap}</span>
            {onMessage && <Button size="icon" variant="outline" icon="message-square" onClick={() => onMessage({ name: p.name, role: p.specialty, specialty: p.specialty, avatar: p.avatar, working: p.working, tint: p.working ? "emerald" : "slate" })} />}
          </div>
        ))}
      </Card>

      {/* Active consultants (specialties consulting on current patients) */}
      <SectionTitle>Active consultants</SectionTitle>
      <Card style={{ padding: consultants.length ? 14 : 0, marginBottom: 24 }}>
        {consultants.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No active consults right now.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            {consultants.map((c) => (
              <span key={c.spec} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: "var(--radius-full)", background: "var(--secondary)", border: "1px solid var(--border)" }}>
                <Icon name="stethoscope" size={14} color="var(--primary)" />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{c.spec}</span>
                <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{c.count} patient{c.count === 1 ? "" : "s"}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Team management */}
      <SectionTitle action={
        <Button size="sm" variant={adding ? "secondary" : "outline"} icon={adding ? "x" : "user-plus"} onClick={() => setAdding(!adding)}>
          {adding ? "Close" : "Add member"}
        </Button>
      }>Care team members</SectionTitle>

      {adding && (
        <Card style={{ padding: 14, marginBottom: 14, background: "var(--secondary)" }}>
          <Field icon="search" value={query} onChange={setQuery} placeholder="Search people in your organization…" />
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflow: "auto" }}>
            {pool.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "6px 4px" }}>{(candidates || []).length ? "No matches." : "No one else in your organization to link."}</div>}
            {pool.map((c) => (
              <div key={c.id} data-candidate={c.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 10px", background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                <Avatar initials={c.avatar} size={32} tint={teamTint(c.role)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>{c.name}<RolePill role={c.role} /></div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{c.roleLabel || c.specialty}</div>
                </div>
                <Button size="sm" icon="plus" onClick={() => run("add" + c.id, () => onAdd(c.id))} style={busy ? { opacity: .6 } : null}>{busy === "add" + c.id ? "Linking…" : "Link"}</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {loaded && members.length === 0 && (
          <div style={{ padding: 32, textAlign: "center" }}>
            <Icon name="users" size={24} color="var(--muted-foreground)" />
            <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>No team members yet</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>Add a midlevel or partner to share your on-call load.</div>
          </div>
        )}
        {!loaded && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading your care team from the server…</div>}
        {members.map((m, i) => (
          <div key={m.id} data-team-member={m.id} style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", padding: "13px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={m.avatar} size={38} tint={teamTint(m.role)} />
            <div style={{ flex: "1 1 140px", minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{m.name}<RolePill role={m.role} label={m.roleLabel} /></div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{m.active === false ? "Account deactivated" : m.onCall ? "Gets your new admission requests" : "Not getting your requests"}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
              <button onClick={() => run("call" + m.id, () => onToggleCall(m.id))} aria-pressed={!!m.onCall}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px", minHeight: mobile ? 44 : 34, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 500, opacity: busy ? .6 : 1 }}>
                <StatusDot status={m.onCall ? "online" : "offline"} pulse={m.onCall} />
                {busy === "call" + m.id ? "Saving…" : m.onCall ? "On call" : "Off call"}
              </button>
              <button onClick={() => { if (window.confirm("Remove " + m.name + " from your on-call unit? They stop getting your admission requests.")) run("rm" + m.id, () => onRemove(m.id)); }} title="Remove from team" aria-label={"Remove " + m.name + " from your unit"}
                style={{ width: mobile ? 44 : 34, height: mobile ? 44 : 34, flex: "none", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
                <Icon name="user-minus" size={16} />
              </button>
            </div>
          </div>
        ))}
      </Card>
    </PageWrap>
  );
}

Object.assign(window, { CareTeam, RolePill, TEAM_ROLE });
