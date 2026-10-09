/* DocTurn web-app UI kit — Organization Settings.
   Spec: Req FR-2.2/2.3/2.4 (org config: timeout, round-robin rules, custom shift
   types) + Eng §9 (integrations). Director surface.
   Every switch on this page is the SERVER's: the STAT SMS fallback is an org
   setting (PATCH /api/settings/org), the assignment timeout is the org's
   config (PATCH /api/org/config), and Integrations (Integrations.jsx) are the
   org's gating modules + encrypted hospital credentials (/api/integrations).
   The old "Feature toggles" card and the "On-call only" / "Active only" rows
   were browser-only booleans nothing enforced; they are gone. */

function Toggle({ on, onClick, label }) {
  // 44×44 tap target around the 44×26 track.
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} onClick={onClick}
      style={{ width: 52, height: 44, minWidth: 44, padding: 0, border: "none", background: "transparent", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      <span style={{ position: "relative", display: "block", width: 44, height: 26, borderRadius: 99, background: on ? "var(--status-accepted)" : "#CBD5E1", transition: "background .2s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
      </span>
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
      <Toggle on={on} onClick={onToggle} label={title} />
    </div>
  );
}

function OrgSettings() {
  const st = useStore();
  const a = useActions();
  const s = st.settings;
  const org = st.orgs.find((o) => o.code === st.selectedOrg) || st.orgs[0];
  const smsOn = !window.DT || !window.DT.moduleOn || window.DT.moduleOn("integration.sms");

  return (
    <PageWrap>
      <SettingsTabs />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <span style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: org.active ? "#DBEAFE" : "var(--status-neutral-bg)", color: org.active ? "var(--primary-ink, #1D4ED8)" : "var(--status-neutral)", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{org.code.slice(0, 2)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, lineHeight: 1.3 }}><EditableText value={org.name} onSave={(v) => a.updateOrg(org.code, { name: v })} size={17} weight={700} /></div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.4, display: "flex", gap: 8, alignItems: "center" }}>
            <EditableText value={org.code} onSave={(v) => a.updateOrg(org.code, { code: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) })} size={12.5} weight={600} mono color="var(--muted-foreground)" /><span>·</span><EditableText value={org.timezone} onSave={(v) => a.updateOrg(org.code, { timezone: v })} size={12.5} weight={400} color="var(--muted-foreground)" />
          </div>
        </div>
        {!org.active && <Badge status="offline">Suspended</Badge>}
      </div>

      <ScheduleSync org={org} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Assignment & round-robin rules */}
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Icon name="route" size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Assignment &amp; rotation</h3>
          </div>
          <Field label="Assignment timeout (minutes)" icon="timer" value={String(s.timeout)} onChange={(v) => a.setSetting("timeout", parseInt(v.replace(/[^0-9]/g, ""), 10) || 0)} help="If a provider doesn't answer within this many minutes, the request is re-paged to the next provider in rotation (1–120, default 15). Saved to the server." inputMode="numeric" />
          <div style={{ marginTop: 14 }}>
            <FlagRow icon="message-circle" title="STAT SMS fallback" desc={"If a STAT message stays unacknowledged after escalation, send a PHI-free text nudge as a last resort." + (smsOn ? " Needs Twilio SMS to be active under Integrations." : " Twilio SMS is switched off for this organization under Integrations, so no text is sent.")} on={s.statSmsFallback !== false} onToggle={() => a.setSetting("statSmsFallback", !(s.statSmsFallback !== false))} last />
          </div>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "10px 0 0", lineHeight: 1.45 }}>
            Rotation includes hospitalists who are on shift with a routable shift type and under their patient cap — the same rule the server's router applies.
          </p>
          {/* Resetting the index only affects SEQUENTIAL rotation; in lowest-census
              mode next-up is census-driven, so the button would be a no-op. */}
          {s.rotationMode === "sequential" && (
            <div style={{ marginTop: 14 }}>
              <Button variant="outline" size="sm" full icon="rotate-ccw" onClick={a.resetRotation}>Reset rotation index</Button>
            </div>
          )}
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

        {/* Message retention (server-enforced purge, audited) */}
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Icon name="clock" size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Message retention</h3>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 10px" }}>Messages older than this are permanently deleted by an hourly, audited purge. "Keep everything" disables it.</p>
          <select value={st.orgRetentionDays || 0} onChange={(e) => a.setOrgRetention(Number(e.target.value))}
            style={{ height: 36, padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 13.5, fontFamily: "inherit", background: "#fff", cursor: "pointer" }}>
            <option value={0}>Keep everything</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>1 year</option>
          </select>
        </Card>

        {/* EHR deep links (Epic Haiku/Canto, Hyperspace, Cerner PowerChart) */}
        <EhrDeepLinkCard />
      </div>

      {/* Integrations — real, server-backed cards (Integrations.jsx). Full width:
          each card carries purpose, PHI/BAA, live status, switch, test, set-up. */}
      <div id="integrations" style={{ marginTop: 18 }}>
        <IntegrationsPanel />
      </div>

      {/* Danger zone — platform operators only, bottom of settings (standard
          pattern: type the org name to confirm an irreversible delete). */}
      {st.session && st.session.role === "developer" && (
        <OrgDangerZone org={org} onDeleted={() => a.setNav("dashboard")} />
      )}
    </PageWrap>
  );
}

// "Open in EHR" configuration: vendor + URL template with {ehrId}. Presets are
// STARTING templates — the exact scheme/host/parameters come from the health
// system's Epic or Cerner team, so a preset still carrying a YOUR-…-HOST
// placeholder stays inactive until edited. Director surface; server validates.
function EhrDeepLinkCard() {
  const st = useStore();
  const a = useActions();
  const cfg = st.ehrConfig;
  const [vendor, setVendor] = React.useState("epic");
  const [template, setTemplate] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (a.loadEhrConfig) a.loadEhrConfig(); }, []);
  React.useEffect(() => { if (cfg && !dirty) { setVendor(cfg.vendor || "epic"); setTemplate(cfg.template || ""); } }, [cfg]);
  const presets = (cfg && cfg.presets) || {};
  const moduleOn = window.DT && window.DT.moduleOn ? window.DT.moduleOn("ehr.deepLinks") : true;
  const applyPreset = (key) => { const p = presets[key]; if (!p) return; setVendor(p.vendor); setTemplate(p.template); setDirty(true); };
  const save = () => {
    if (!a.saveEhrConfig) return;
    setSaving(true);
    Promise.resolve(a.saveEhrConfig(vendor, template.trim())).then(() => setDirty(false)).catch(() => {}).finally(() => setSaving(false));
  };
  const preview = template ? template.replace(/\{ehrId\}/g, "12345678") : "";
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon name="external-link" size={18} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Open in EHR</h3>
        {cfg && cfg.configured && moduleOn && <Badge status="accepted" icon="circle">Active</Badge>}
        {cfg && !moduleOn && <Badge status="offline">Module off</Badge>}
      </div>
      <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 12px", lineHeight: 1.45 }}>Adds an "Open in EHR" button to patient rows that deep-links the patient (by MRN/CSN) into Epic Haiku/Canto, Hyperspace or Cerner PowerChart. The template uses <code>{"{ehrId}"}</code>; the id is resolved server-side per audited click and never sent in notifications.</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {Object.keys(presets).map((k) => (
          <button key={k} onClick={() => applyPreset(k)} title={presets[k].note}
            style={{ padding: "5px 10px", borderRadius: "var(--radius-md)", border: "1px solid " + (template === presets[k].template ? "var(--primary)" : "var(--border)"), background: template === presets[k].template ? "#EFF6FF" : "#fff", color: template === presets[k].template ? "var(--primary)" : "var(--foreground)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)" }}>{presets[k].label}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "end" }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Vendor</label>
          <select value={vendor} onChange={(e) => { setVendor(e.target.value); setDirty(true); }}
            style={{ height: 40, width: "100%", padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 13.5, fontFamily: "inherit", background: "#fff", cursor: "pointer" }}>
            <option value="epic">Epic</option>
            <option value="cerner">Cerner</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <Field label="Launch URL template" icon="link" value={template} onChange={(v) => { setTemplate(v); setDirty(true); }} placeholder="epichaiku://launch?mrn={ehrId}" />
      </div>
      {(() => {
        const sel = Object.keys(presets).find((k) => presets[k].template === template);
        const note = sel ? presets[sel].note : null;
        const placeholder = /YOUR-[A-Z0-9-]*HOST/i.test(template);
        return (
          <div style={{ marginTop: 8, fontSize: 11.5, color: placeholder ? "#92400E" : "var(--muted-foreground)", lineHeight: 1.45 }}>
            {placeholder ? "Replace the YOUR-…-HOST placeholder with the launch URL your EHR team provides — the button stays hidden until you do. " : ""}
            {note || "The exact URL scheme and parameters are issued by your health system's Epic / Cerner team."}
            {preview && <div style={{ marginTop: 4, fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>Preview: {preview}</div>}
          </div>
        );
      })()}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <Button size="sm" icon="save" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</Button>
        {template && <Button size="sm" variant="ghost" onClick={() => { setTemplate(""); setDirty(true); }}>Clear</Button>}
        {!moduleOn && <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Saved settings apply once a developer switches on the "Open in EHR" module.</span>}
      </div>
    </Card>
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
