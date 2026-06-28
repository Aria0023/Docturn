/* DocTurn web-app UI kit — "My hospitalist work" panel for the Hospitalist
   Director. Gives a director the same core hospitalist functionality (accept
   incoming admissions, carry a census, request consults, message) when they're
   also seeing patients. Opt-in: a director starts taking patients with one tap,
   which gives them a rotation profile so admissions can route to them. */

function HospitalistWork({ pending = [], myAdmissions = [], hasProfile, onBecome, onAccept, onDecline, onConsult, onConsultRespond, consultServices, onMessage }) {
  const [busy, setBusy] = React.useState(false);
  const incoming = pending || [];
  const since = (function () { const d = new Date(); d.setHours(7, 0, 0, 0); if (Date.now() < d.getTime()) d.setDate(d.getDate() - 1); return d.getTime(); })();
  const mine = (myAdmissions || []).slice().sort((a, b) => b.at - a.at);

  if (!hasProfile) {
    return (
      <Card style={{ padding: 28, textAlign: "center" }}>
        <span style={{ width: 46, height: 46, borderRadius: "var(--radius-md)", background: "#DBEAFE", color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="stethoscope" size={22} /></span>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 12 }}>Take patients as a hospitalist</div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "6px auto 16px", maxWidth: 420, lineHeight: 1.5 }}>
          Start taking patients to join the rotation and get the full hospitalist workflow — accept incoming admissions, carry a census, request consults and message the care team.
        </div>
        <Button icon="play" onClick={() => { setBusy(true); Promise.resolve(onBecome && onBecome()).finally(() => setBusy(false)); }} style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>{busy ? "Starting…" : "Start taking patients"}</Button>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Incoming admissions to accept */}
      <div>
        <SectionTitle action={<Badge variant="secondary">{incoming.length}</Badge>}>Incoming admissions</SectionTitle>
        <Card style={{ padding: 0, overflow: "visible" }}>
          {incoming.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No incoming admissions right now.</div>}
          {incoming.map((p, i) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <Avatar initials={p.initials} size={34} tint="amber" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>Patient {p.initials} · Room {p.room}{p.acuity ? <AcuityChip level={p.acuity} size="sm" /> : null}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{p.complaint} · from {p.from}</div>
              </div>
              <Button variant="outline" size="sm" icon="x" onClick={() => onDecline && onDecline(p.id)}>Decline</Button>
              <Button size="sm" icon="check" onClick={() => onAccept && onAccept(p.id)}>Accept</Button>
            </div>
          ))}
        </Card>
      </div>

      {/* My census */}
      <div>
        <SectionTitle>My patients</SectionTitle>
        <Card style={{ padding: 0, overflow: "visible" }}>
          {mine.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No patients accepted yet this shift.</div>}
          {mine.map((p, i) => (
            <div key={p.id} style={{ padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar initials={p.initials} size={34} tint="blue" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Patient {p.initials} · Room {p.room}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span>{p.complaint}</span>
                    {(!p.consultDetails || !p.consultDetails.length) && (p.consultants || []).map((c) => <SpecialtyTag key={c} name={c} size="sm" />)}
                  </div>
                </div>
                {onConsult && p.patientId != null && <ConsultAdd services={consultServices} onPick={(spec) => onConsult(p.patientId, spec)} />}
                <Button variant="ghost" size="sm" icon="message-square" onClick={() => onMessage && onMessage({ name: "Patient " + p.initials + " · care", role: "Room " + p.room, avatar: p.initials, tint: "blue" })}>Message</Button>
              </div>
              {p.consultDetails && p.consultDetails.length ? <div style={{ marginTop: 8, marginLeft: 46, maxWidth: 420 }}><ConsultRoster details={p.consultDetails} onRespond={onConsultRespond} /></div> : null}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { HospitalistWork });
