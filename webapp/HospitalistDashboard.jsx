/* DocTurn web-app UI kit — Hospitalist dashboard.
   Focused on incoming assignment requests for the current shift (resets 7am),
   with a slim round-robin position indicator. Full history lives in its own tab. */

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

// Start of the current 7a–7p shift day: 7am today, or 7am yesterday if before 7am.
function shiftStart() {
  const d = new Date();
  const s = new Date(d); s.setHours(7, 0, 0, 0);
  return d.getTime() >= s.getTime() ? s.getTime() : s.getTime() - 86400000;
}
function hhmm(at) { return (window.dtFmt && window.dtFmt.hhmm) ? window.dtFmt.hhmm(at) : new Date(at).toTimeString().slice(0, 5); }
// "Dr. Jordan Chen" -> "Chen"; "Jordan Wu, PA-C" -> "Wu"
function shortName(name) { return String(name || "").split(",")[0].replace(/^Dr\.\s*/i, "").trim().split(/\s+/).slice(-1)[0] || name; }

function HospitalistDashboard({ pending, onAccept, onDecline, myAdmissions = [], providers = [], meName, rotationMode = "lowest_census", onMessage, onOpenHistory, onConsult, consultServices }) {
  // Accepted during THIS shift (since 7am); resets each morning.
  const since = shiftStart();
  const shiftAdmits = (myAdmissions || []).filter((a) => a.at >= since).sort((a, b) => b.at - a.at);

  // Sort incoming requests by acuity (ESI 1 = most urgent first), then by how
  // soon each expires — so when several land at once the sickest is on top.
  const sortedPending = (pending || []).slice().sort((a, b) =>
    ((a.acuity || 3) - (b.acuity || 3)) || ((a.expiresAt || 0) - (b.expiresAt || 0)));

  // Slim round-robin position: where this hospitalist stands among everyone rounding.
  const rot = (providers || []).filter((p) => p.working && p.inRotation);
  const ordered = rotationMode === "sequential" ? rot.slice() : rot.slice().sort((a, b) => a.census - b.census);
  const myPos = ordered.findIndex((p) => meName && p.name === meName);
  const rrLabel = myPos === 0 ? "You're next up"
    : myPos > 0 ? "#" + (myPos + 1) + " of " + ordered.length + " · " + myPos + " ahead of you"
    : "Not in rotation";

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
        <StatTile label="Pending requests" value={pending.length} icon="inbox" tint="amber" />
        <StatTile label="Accepted this shift" value={shiftAdmits.length} icon="check-circle-2" tint="emerald" />
        <StatTile label="Current census" value={shiftAdmits.length} icon="users" tint="blue" />
      </div>

      {/* Compact round-robin strip — small colored circles in order (next + you highlighted) */}
      {ordered.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
            <Icon name="route" size={13} color="var(--muted-foreground)" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Round-robin</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: myPos === 0 ? "var(--status-accepted)" : "var(--muted-foreground)" }}>· {rrLabel}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9, maxHeight: 116, overflow: "hidden" }}>
            {ordered.map((p, i) => {
              const isNext = i === 0;
              const isMe = meName && p.name === meName;
              const ring = isNext ? "var(--status-accepted)" : (isMe ? "var(--primary)" : "transparent");
              return (
                <div key={p.id} title={p.name + " · census " + p.census + "/" + p.cap} style={{ width: 48, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <div style={{ position: "relative", padding: 2 }}>
                    <span style={{ position: "absolute", inset: 0, borderRadius: 99, border: "2px solid " + ring }} />
                    <Avatar initials={p.avatar} size={30} tint={isMe ? "blue" : (isNext ? "emerald" : "slate")} />
                    <span style={{ position: "absolute", top: -3, left: -3, width: 15, height: 15, borderRadius: 99, background: isNext ? "var(--status-accepted)" : "var(--secondary)", color: isNext ? "#fff" : "var(--muted-foreground)", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid #fff" }}>{i + 1}</span>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: isMe ? "var(--primary)" : "var(--foreground)", maxWidth: 48, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isMe ? "You" : shortName(p.name)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <SectionTitle action={<Badge status="pending">{pending.length} awaiting</Badge>}>Incoming assignment requests</SectionTitle>
      {pending.length > 1 && (
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "-6px 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="arrow-down-narrow-wide" size={13} /> Sorted by triage acuity — most urgent first
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        {pending.length === 0 && (
          <Card style={{ padding: 36, textAlign: "center" }}>
            <Icon name="inbox" size={26} color="var(--muted-foreground)" />
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No pending assignments</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>You're all caught up.</div>
          </Card>
        )}
        {sortedPending.map((p) => (
          <Card key={p.id} style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <Avatar initials={p.initials} size={42} tint="amber" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 700, whiteSpace: "nowrap" }}>Patient {p.initials}</span>
                  {p.acuity ? <AcuityChip level={p.acuity} /> : null}
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

      <SectionTitle action={onOpenHistory && <Button size="sm" variant="ghost" icon="history" onClick={onOpenHistory}>3-day history</Button>}>
        Accepted this shift
      </SectionTitle>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "-6px 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="clock" size={13} /> Shift list (7am–7pm) · resets at 7am · older admissions move to the history tab
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {shiftAdmits.length === 0 && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Nothing accepted yet this shift.</div>}
        {shiftAdmits.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={p.initials} size={34} tint="blue" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Patient {p.initials} · Room {p.room}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span>{p.complaint}</span>
                {(p.consultants || []).map((c) => <SpecialtyTag key={c} name={c} size="sm" />)}
              </div>
            </div>
            {onConsult && p.patientId != null && <ConsultAdd services={consultServices} onPick={(spec) => onConsult(p.patientId, spec)} />}
            <span style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{hhmm(p.at)}</span>
            <Button variant="ghost" size="sm" icon="message-square" onClick={() => onMessage && onMessage({ name: "Patient " + p.initials + " · care", role: "Room " + p.room, avatar: p.initials, tint: "blue" })}>Message</Button>
          </div>
        ))}
      </Card>
    </PageWrap>
  );
}

Object.assign(window, { HospitalistDashboard });
