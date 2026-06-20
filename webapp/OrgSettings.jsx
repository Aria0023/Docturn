/* DocTurn web-app UI kit — Organization Settings.
   Spec: Req FR-2.2/2.3/2.4 (org config: timeout, round-robin rules, custom shift
   types, per-portal feature toggles) + Eng §9 (integrations). Director surface.
   Store-backed: reflects the selected tenant and persists every change. */

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick}
      style={{ width: 44, height: 26, borderRadius: 99, border: "none", cursor: "pointer", position: "relative", flex: "none",
        background: on ? "var(--status-accepted)" : "var(--status-neutral-bg)", transition: "background .2s" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
    </button>
  );
}

function FlagRow({ icon, title, desc, on, onToggle, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Icon name={icon} size={17} color="var(--muted-foreground)" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{desc}</div>
      </div>
      <Toggle on={on} onClick={onToggle} />
    </div>
  );
}

function OrgSettings() {
  const st = useStore();
  const a = useActions();
  const s = st.settings;
  const org = st.orgs.find((o) => o.code === st.selectedOrg) || st.orgs[0];

  const INTEGRATIONS = [
    { key: "twilio", name: "Twilio", desc: "SMS notifications & 2FA", icon: "message-circle" },
    { key: "firebase", name: "Firebase", desc: "Push notifications (FCM)", icon: "bell" },
    { key: "openai", name: "OpenAI", desc: "AI intake extraction", icon: "sparkles" },
    { key: "amion", name: "Amion", desc: "Provider schedule sync", icon: "calendar-clock" },
  ];

  return (
    <PageWrap>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <span style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: org.active ? "#DBEAFE" : "var(--status-neutral-bg)", color: org.active ? "var(--primary)" : "var(--status-neutral)", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>{org.code.slice(0, 2)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, lineHeight: 1.3 }}><EditableText value={org.name} onSave={(v) => a.updateOrg(org.code, { name: v })} size={17} weight={700} /></div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.4, display: "flex", gap: 8, alignItems: "center" }}>
            <EditableText value={org.code} onSave={(v) => a.updateOrg(org.code, { code: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) })} size={12.5} weight={600} mono color="var(--muted-foreground)" /><span>·</span><EditableText value={org.timezone} onSave={(v) => a.updateOrg(org.code, { timezone: v })} size={12.5} weight={400} color="var(--muted-foreground)" />
          </div>
        </div>
        {!org.active && <Badge status="offline">Suspended</Badge>}
      </div>

      <ScheduleSync />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Assignment & round-robin rules */}
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Icon name="route" size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Assignment &amp; rotation</h3>
          </div>
          <Field label="Assignment timeout (minutes)" icon="timer" value={String(s.timeout)} onChange={(v) => a.setSetting("timeout", parseInt(v.replace(/[^0-9]/g, ""), 10) || 0)} help="Unanswered requests re-route after this." />
          <div style={{ marginTop: 14 }}>
            <FlagRow icon="phone-call" title="On-call providers only" desc="Restrict rotation to on-call hospitalists." on={s.onCallOnly} onToggle={() => a.setSetting("onCallOnly", !s.onCallOnly)} />
            <FlagRow icon="activity" title="Active (on-shift) only" desc="Skip providers not working today." on={s.activeOnly} onToggle={() => a.setSetting("activeOnly", !s.activeOnly)} last />
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="outline" size="sm" full icon="rotate-ccw" onClick={a.resetRotation}>Reset rotation index</Button>
          </div>
        </Card>

        {/* Custom shift types */}
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Icon name="clock" size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Shift types</h3>
            <span style={{ marginLeft: "auto" }}><Button size="sm" variant="ghost" icon="plus" onClick={a.addShiftType}>Add</Button></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {s.shiftTypes.map((sh) => (
              <div key={sh.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 99, background: sh.color, flex: "none" }} />
                <span style={{ flex: 1, minWidth: 0 }}><EditableText value={sh.name} onSave={(v) => a.updateShiftType(sh.id, { name: v })} size={13.5} weight={600} /></span>
                <span style={{ flex: "none" }}><EditableText value={sh.time} onSave={(v) => a.updateShiftType(sh.id, { time: v })} size={12.5} weight={400} mono color="var(--muted-foreground)" /></span>
                <button onClick={() => a.removeShiftType(sh.id)} title="Remove shift type"
                  onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                  style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="trash-2" size={14} /></button>
              </div>
            ))}
          </div>
        </Card>

        {/* Feature flags */}
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Icon name="toggle-right" size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Feature toggles</h3>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 6px" }}>Per-portal availability for this tenant.</p>
          <FlagRow icon="message-circle" title="SMS notifications" desc="Twilio assignment alerts & fallback." on={s.flags.sms} onToggle={() => a.toggleFlag("sms")} />
          <FlagRow icon="bell" title="Push notifications" desc="Firebase Cloud Messaging." on={s.flags.push} onToggle={() => a.toggleFlag("push")} />
          <FlagRow icon="sparkles" title="AI intake assistant" desc="OpenAI free-text extraction." on={s.flags.ai} onToggle={() => a.toggleFlag("ai")} />
          <FlagRow icon="megaphone" title="Emergency broadcasts" desc="Org-wide urgent messaging." on={s.flags.broadcasts} onToggle={() => a.toggleFlag("broadcasts")} />
          <FlagRow icon="calendar-clock" title="Amion schedule sync" desc="External on-call import." on={s.flags.amion} onToggle={() => a.toggleFlag("amion")} last />
        </Card>

        {/* Integrations */}
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Icon name="plug" size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Integrations</h3>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {INTEGRATIONS.map((it) => {
              const on = s.integrations[it.key];
              return (
                <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
                  <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                    <Icon name={it.icon} size={17} color={on ? "var(--primary)" : "var(--muted-foreground)"} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{it.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{it.desc}</div>
                  </div>
                  {on
                    ? <button onClick={() => a.toggleIntegration(it.key)} title="Disconnect" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0 }}><Badge status="accepted" icon="circle">Connected</Badge></button>
                    : <Button size="sm" variant="outline" onClick={() => a.toggleIntegration(it.key)}>Connect</Button>}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 13, display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--muted-foreground)" }}>
            <Icon name="lock" size={13} />Credentials are stored server-side, never exposed to clients.
          </div>
        </Card>
      </div>

      {/* Danger zone — platform operators only, bottom of settings (standard
          pattern: type the org name to confirm an irreversible delete). */}
      {st.session && st.session.role === "developer" && (
        <OrgDangerZone org={org} onDeleted={() => a.setNav("dashboard")} />
      )}
    </PageWrap>
  );
}

function OrgDangerZone({ org, onDeleted }) {
  const [confirm, setConfirm] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [status, setStatus] = React.useState(null); // null | "deleting" | error
  const match = typed.trim().toLowerCase() === (org.name || "").trim().toLowerCase();

  function doDelete() {
    if (!match || status === "deleting") return;
    setStatus("deleting");
    window.DT.actions.deleteTenant(org)
      .then(function () { onDeleted(); })
      .catch(function (e) { setStatus((e && e.message) || "Delete failed."); });
  }

  return (
    <Card style={{ padding: 18, marginTop: 18, border: "1px solid var(--destructive)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon name="alert-triangle" size={18} color="var(--destructive)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--destructive)" }}>Danger zone</h3>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 12px" }}>
        Deleting an organization is permanent and cannot be undone. The organization must have no users.
      </p>
      {!confirm ? (
        <Button variant="outline" size="sm" icon="trash-2"
          style={{ color: "var(--destructive)", borderColor: "var(--destructive)" }}
          onClick={() => setConfirm(true)}>
          Delete this organization
        </Button>
      ) : (
        <div style={{ background: "var(--status-rejected-bg)", border: "1px solid var(--destructive)", borderRadius: "var(--radius-md)", padding: 14 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            Type <b>{org.name}</b> to confirm deletion.
          </div>
          <Field value={typed} onChange={(v) => { setTyped(v); setStatus(null); }} placeholder={org.name} icon="building-2" />
          {status && status !== "deleting" && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--destructive)", display: "flex", gap: 5, alignItems: "center" }}>
              <Icon name="alert-circle" size={13} />{status}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button variant="outline" size="sm" onClick={() => { setConfirm(false); setTyped(""); setStatus(null); }}>Cancel</Button>
            <Button variant="destructive" size="sm" icon="trash-2"
              style={{ opacity: match && status !== "deleting" ? 1 : 0.5, cursor: match ? "pointer" : "not-allowed" }}
              onClick={doDelete}>
              {status === "deleting" ? "Deleting…" : "Permanently delete"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

Object.assign(window, { OrgSettings });
