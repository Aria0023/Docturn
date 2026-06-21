/* DocTurn web-app UI kit — Hospitalist dashboard (census + accept/decline) */

function ExpiryBadge({ expiresAt }) {
  useClock();
  const remain = expiresAt - Date.now();
  const urgent = remain <= 60000;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, lineHeight: 1.6, fontVariantNumeric: "tabular-nums",
      background: urgent ? "var(--status-rejected-bg)" : "var(--status-pending-bg)", color: urgent ? "var(--status-rejected)" : "var(--status-pending)" }}>
      <Icon name={urgent ? "alarm-clock" : "clock"} size={11} />Expires in {dtFmt.mmss(remain)}
    </span>
  );
}

function HospitalistDashboard({ pending, onAccept, onDecline, myPatients, acceptedToday = 0, unit = [], onOpenTeam, onMessage, providers = [], meName, rotationMode = "lowest_census" }) {
  // Where this hospitalist stands in the round-robin among everyone rounding.
  const rot = (providers || []).filter((p) => p.working && p.inRotation);
  const ordered = rotationMode === "sequential"
    ? rot.slice()
    : rot.slice().sort((a, b) => a.census - b.census);
  const myPos = ordered.findIndex((p) => meName && p.name === meName); // 0-based; -1 if not in pool

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
        <StatTile label="Current census" value={myPatients.length} icon="users" tint="blue" />
        <StatTile label="Patient cap" value={"" + myPatients.length + "/12"} icon="gauge" tint="slate" />
        <StatTile label="Pending" value={pending.length} icon="clock" tint="amber" />
        <StatTile label="Accepted today" value={acceptedToday} icon="check-circle-2" tint="emerald" />
      </div>

      {/* On-call unit banner — requests reach everyone linked here */}
      <div onClick={onOpenTeam} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", marginBottom: 18, borderRadius: "var(--radius-md)", background: "#EFF6FF", border: "1px solid #BFDBFE", cursor: onOpenTeam ? "pointer" : "default" }}>
        <Icon name="link" size={16} color="var(--primary)" />
        {unit.length === 0 ? (
          <span style={{ fontSize: 13, color: "#1E3A5F" }}>You're taking requests solo. <span style={{ fontWeight: 600, textDecoration: "underline" }}>Add a midlevel or partner</span> to share your on-call load.</span>
        ) : (
          <>
            <span style={{ fontSize: 13, color: "#1E3A5F", whiteSpace: "nowrap" }}>Requests are shared with your on-call unit:</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {unit.map((m) => (
                <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-full)", padding: "2px 8px 2px 3px" }}>
                  <Avatar initials={m.avatar} size={18} tint={(window.TEAM_ROLE[m.role] || {}).tint || "slate"} />
                  <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{m.name.split(",")[0]}</span>
                  <RolePill role={m.role} />
                </span>
              ))}
            </div>
            <Icon name="chevron-right" size={15} color="var(--muted-foreground)" style={{ marginLeft: "auto" }} />
          </>
        )}
      </div>

      {/* Where you stand in the round-robin — read-only FYI for the hospitalist */}
      {ordered.length > 0 && (
        <Card style={{ padding: 18, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Icon name="route" size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Your round-robin standing</h3>
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)" }}>{rotationMode === "sequential" ? "Sequential order" : "Lowest census first"}</span>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 12px" }}>
            {myPos === 0
              ? "You're next up — the next admission routes to you."
              : myPos > 0
                ? "You're #" + (myPos + 1) + " of " + ordered.length + " rounding · " + myPos + " ahead of you."
                : "You're not in the rotation pool right now."}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {ordered.map((p, i) => {
              const isNext = i === 0;
              const isMe = meName && p.name === meName;
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 11px", borderRadius: "var(--radius-md)",
                  border: "1px solid " + (isMe ? "var(--primary)" : (isNext ? "#BFDBFE" : "var(--border)")),
                  background: isMe ? "#EFF6FF" : (isNext ? "#F5F9FF" : "#fff") }}>
                  <span style={{ width: 22, height: 22, borderRadius: 99, background: isNext ? "var(--primary)" : "var(--secondary)", color: isNext ? "#fff" : "var(--muted-foreground)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{i + 1}</span>
                  <Avatar initials={p.avatar} size={28} tint={isMe ? "blue" : (isNext ? "emerald" : "slate")} />
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}{isMe && <span style={{ marginLeft: 7 }}><Badge status="active">You</Badge></span>}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{p.specialty}</span>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums", width: 52, textAlign: "right" }}>{p.census}/{p.cap}</span>
                  {isNext && <Badge status="sent">Next</Badge>}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <SectionTitle action={<Badge status="pending">{pending.length} awaiting</Badge>}>Incoming assignment requests</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        {pending.length === 0 && (
          <Card style={{ padding: 36, textAlign: "center" }}>
            <Icon name="inbox" size={26} color="var(--muted-foreground)" />
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No pending assignments</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>You're all caught up.</div>
          </Card>
        )}
        {pending.map((p) => (
          <Card key={p.id} style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <Avatar initials={p.initials} size={42} tint="amber" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap" }}>Patient {p.initials}</span>
                  <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>· Room {p.room}</span>
                  {p.expiresAt ? <ExpiryBadge expiresAt={p.expiresAt} /> : <Badge status="pending">Pending</Badge>}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--foreground)", marginTop: 4 }}>{p.complaint}</div>
                <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12.5, color: "var(--muted-foreground)" }}>
                  <span style={{ display: "flex", gap: 5, alignItems: "center" }}><Icon name="ambulance" size={13} />from {p.from}</span>
                  <span style={{ display: "flex", gap: 5, alignItems: "center" }}><Icon name="stethoscope" size={13} />{p.specialty}</span>
                  <span style={{ display: "flex", gap: 5, alignItems: "center" }}><Icon name="route" size={13} />{p.via}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flex: "none" }}>
                <Button variant="outline" size="sm" icon="x" onClick={() => onDecline(p.id)}>Decline</Button>
                <Button size="sm" icon="check" onClick={() => onAccept(p.id)}>Accept</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>My patients</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {myPatients.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={p.initials} size={34} tint="blue" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Patient {p.initials} · Room {p.room}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p.complaint}</div>
            </div>
            <Badge status="accepted">Accepted</Badge>
            <Button variant="ghost" size="sm" icon="message-square" onClick={() => onMessage && onMessage({ name: `Patient ${p.initials} \u00b7 care`, role: `Room ${p.room}`, avatar: p.initials, tint: "blue" })}>Message</Button>
          </div>
        ))}
      </Card>
    </PageWrap>
  );
}

Object.assign(window, { HospitalistDashboard });
