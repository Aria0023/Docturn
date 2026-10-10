/* DocTurn web-app UI kit — Organization Settings.
   Spec: Req FR-2.2/2.3/2.4 (org config: timeout, round-robin rules, custom shift
   types) + Eng §9 (integrations). Director surface.
   Every switch on this page is the SERVER's: the STAT SMS fallback is an org
   setting (PATCH /api/settings/org), the assignment timeout is the org's
   config (PATCH /api/org/config), and Integrations (Integrations.jsx) are the
   org's gating modules + encrypted hospital credentials (/api/integrations).
   The old "Feature toggles" card and the "On-call only" / "Active only" rows
   were browser-only booleans nothing enforced; they are gone. So is the old
   local list of named shift types (Rounding / Swing / Nocturnist) nothing
   read: "Shift types" now shows the server's shift types (Day, Swing, Night)
   and which of them admissions rotate to — organizations.round_robin_shift_types,
   PATCH /api/org/config (director only).
   Who may change what is the server's rule: org-wide settings are
   director/developer (PATCH /api/settings/org, /api/org/config,
   /api/integrations writes). An ER director sees the same values read-only,
   and the header shows the signed-in organization as the SERVER knows it
   (GET /api/org/config) — name, code and time zone are edited only by the
   DocTurn operator (developer). */

function Toggle({ on, onClick, label, disabled }) {
  // 44×44 tap target around the 44×26 track.
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} onClick={() => { if (!disabled) onClick(); }} disabled={disabled}
      style={{ width: 52, height: 44, minWidth: 44, padding: 0, border: "none", background: "transparent", cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", opacity: disabled ? 0.5 : 1 }}>
      <span style={{ position: "relative", display: "block", width: 44, height: 26, borderRadius: 99, background: on ? "var(--status-accepted)" : "#CBD5E1", transition: "background .2s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
      </span>
    </button>
  );
}

function FlagRow({ icon, title, desc, on, onToggle, last, disabled, note }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Icon name={icon} size={17} color="var(--muted-foreground)" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{desc}</div>
        {note && <div data-readonly-note style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3, fontWeight: 600 }}>{note}</div>}
      </div>
      <Toggle on={on} onClick={onToggle} label={title} disabled={disabled} />
    </div>
  );
}

const DIRECTOR_ONLY_NOTE = "Only a director can change this.";

function OrgSettings() {
  const st = useStore();
  const a = useActions();
  const s = st.settings;
  const role = st.session && st.session.role;
  const isDev = role === "developer";
  // The same roles the server's write routes allow.
  const canEdit = role === "director" || role === "developer";
  const smsOn = !window.DT || !window.DT.moduleOn || window.DT.moduleOn("integration.sms");
  React.useEffect(() => { if (!isDev && a.loadOrgIdentity) a.loadOrgIdentity(); }, [isDev]);
  // Developer: the org picked in the console (a real list from
  // /api/dev/organizations, editable through PATCH /api/dev/organizations).
  // Everyone else: their own org as the server reports it.
  const devOrg = st.orgs.find((o) => o.code === st.selectedOrg) || st.orgs[0];
  const sessionCode = (st.session && st.session.org) || "";
  // Org codes are case-insensitive (the sign-in form keeps what was typed).
  const ident = st.orgIdentity && String(st.orgIdentity.code).toUpperCase() === sessionCode.toUpperCase() ? st.orgIdentity : null;
  const org = isDev ? devOrg : { code: ident ? ident.code : sessionCode, name: ident ? ident.name : "", timezone: ident ? ident.timezone : "", active: true };

  return (
    <PageWrap>
      <SettingsTabs />
      <div data-org-header={org.code} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <span style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: org.active ? "#DBEAFE" : "var(--status-neutral-bg)", color: org.active ? "var(--primary-ink, #1D4ED8)" : "var(--status-neutral)", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{(org.code || "").slice(0, 2)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {isDev ? (
            <React.Fragment>
              <div style={{ fontSize: 17, lineHeight: 1.3 }}><EditableText value={org.name} onSave={(v) => a.updateOrg(org.code, { name: v })} size={17} weight={700} /></div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.4, display: "flex", gap: 8, alignItems: "center" }}>
                <EditableText value={org.code} onSave={(v) => a.updateOrg(org.code, { code: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) })} size={12.5} weight={600} mono color="var(--muted-foreground)" /><span>·</span><EditableText value={org.timezone} onSave={(v) => a.updateOrg(org.code, { timezone: v })} size={12.5} weight={400} color="var(--muted-foreground)" />
              </div>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div data-org-name style={{ fontSize: 17, lineHeight: 1.3, fontWeight: 700, overflowWrap: "anywhere" }}>{org.name || org.code}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>{org.code}</span>
                {org.timezone && <React.Fragment><span>·</span><span>{org.timezone}</span></React.Fragment>}
                <span>· name, code and time zone are set by the DocTurn operator</span>
              </div>
            </React.Fragment>
          )}
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
          <Field label="Assignment timeout (minutes)" icon="timer" value={String(s.timeout)} disabled={!canEdit} onChange={(v) => a.setSetting("timeout", parseInt(v.replace(/[^0-9]/g, ""), 10) || 0)}
            help={canEdit ? "If a provider doesn't answer within this many minutes, the request is re-paged to the next provider in rotation (1–120, default 15). Saved to the server." : "If a provider doesn't answer within this many minutes, the request is re-paged to the next provider in rotation. " + DIRECTOR_ONLY_NOTE} inputMode="numeric" />
          <div style={{ marginTop: 14 }}>
            <FlagRow icon="message-circle" title="STAT SMS fallback" desc={"If a STAT message stays unacknowledged after escalation, send a PHI-free text nudge as a last resort." + (smsOn ? " Needs Twilio SMS to be active under Integrations." : " Twilio SMS is switched off for this organization under Integrations, so no text is sent.")} on={s.statSmsFallback !== false} onToggle={() => a.setSetting("statSmsFallback", !(s.statSmsFallback !== false))} disabled={!canEdit} note={canEdit ? null : DIRECTOR_ONLY_NOTE} last />
          </div>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "10px 0 0", lineHeight: 1.45 }}>
            Rotation includes hospitalists who are on shift with a routable shift type and under their patient cap — the same rule the server's router applies.
          </p>
          {/* Resetting the index only affects SEQUENTIAL rotation; in lowest-census
              mode next-up is census-driven, so the button would be a no-op. */}
          {s.rotationMode === "sequential" && canEdit && (
            <div style={{ marginTop: 14 }}>
              <Button variant="outline" size="sm" full icon="rotate-ccw" onClick={a.resetRotation}>Reset rotation index</Button>
            </div>
          )}
        </Card>

        {/* Shift types = the server's shift enum and the org's routable set */}
        <ShiftTypesCard canEdit={canEdit} />

        {/* Message retention (server-enforced purge, audited) */}
        <Card style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Icon name="clock" size={18} color="var(--primary)" />
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Message retention</h3>
          </div>
          <MessageRetentionBody st={st} a={a} canEdit={canEdit} />
        </Card>

        {/* EHR deep links (Epic Haiku/Canto, Hyperspace, Cerner PowerChart) */}
        <EhrDeepLinkCard canEdit={canEdit} />
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

// Settings → Shift types. DocTurn's shift types are fixed (Day, Swing, Night —
// shared/schema.ts SHIFT_TYPE); each hospitalist works one of them. What the
// organization chooses is which shifts NEW ADMISSIONS ROTATE TO
// (organizations.round_robin_shift_types, read by the router in
// server/services/rotation.ts). The switches read and write exactly that; the
// last routable shift can't be switched off (the server refuses an empty set).
const SERVER_SHIFTS = [
  ["day", "Day", "sun"],
  ["swing", "Swing", "sunset"],
  ["night", "Night", "moon"],
];
function ShiftTypesCard({ canEdit }) {
  const st = useStore();
  const a = useActions();
  const sess = st.session || {};
  const isDev = sess.role === "developer";
  const ident = st.orgIdentity && (isDev || String(st.orgIdentity.code).toUpperCase() === String(sess.org || "").toUpperCase()) ? st.orgIdentity : null;
  const routable = ident && Array.isArray(ident.roundRobinShiftTypes) ? ident.roundRobinShiftTypes : null;
  const providers = st.providers || [];
  const toggle = (id) => {
    if (!routable || !canEdit) return;
    const on = routable.indexOf(id) >= 0;
    if (on && routable.length === 1) { a.toast({ tone: "rejected", title: "Not saved", msg: "At least one shift must stay in rotation." }); return; }
    const next = SERVER_SHIFTS.map((x) => x[0]).filter((x) => (x === id ? !on : routable.indexOf(x) >= 0));
    a.setRotationShiftTypes(next);
  };
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon name="clock" size={18} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Shift types</h3>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 4px", lineHeight: 1.45 }}>
        Every hospitalist works a Day, Swing or Night shift. New admissions rotate only to hospitalists on a shift switched on here.{canEdit ? "" : <span data-readonly-note style={{ fontWeight: 600 }}> {DIRECTOR_ONLY_NOTE}</span>}
      </p>
      {!routable && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "10px 0" }}>Loading…</div>}
      {routable && SERVER_SHIFTS.map(([id, label, icon], i) => {
        const on = routable.indexOf(id) >= 0;
        const n = providers.filter((p) => p.shift === id).length;
        const last = on && routable.length === 1;
        return (
          <div key={id} data-shift-type={id} data-routable={on ? "yes" : "no"}>
            <FlagRow icon={icon} title={label + " shift"}
              desc={(n ? n + " hospitalist" + (n === 1 ? "" : "s") + " on this shift · " : "") + (on ? "in rotation — receives new admissions" : "not in rotation")}
              on={on} onToggle={() => toggle(id)} disabled={!canEdit || last}
              note={canEdit && last ? "The only shift in rotation — switch another on first." : null}
              last={i === SERVER_SHIFTS.length - 1} />
          </div>
        );
      })}
    </Card>
  );
}

// "Open in EHR" configuration: vendor + URL template with {ehrId}. Presets are
// STARTING templates — the exact scheme/host/parameters come from the health
// system's Epic or Cerner team, so a preset still carrying a YOUR-…-HOST
// placeholder stays inactive until edited. Director surface; server validates.
function EhrDeepLinkCard({ canEdit = true }) {
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
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        {canEdit ? <Button size="sm" icon="save" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</Button>
          : <span data-readonly-note style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>{DIRECTOR_ONLY_NOTE}</span>}
        {template && canEdit && <Button size="sm" variant="ghost" onClick={() => { setTemplate(""); setDirty(true); }}>Clear</Button>}
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

/* Settings → Organization "Message retention" (A.CON-SHO-23 / A.CON-SHO-37).
   Says what the hourly purge ACTUALLY does for this org, never just what the
   dropdown holds:
   - ops.retention off (the platform operator's switch): nothing is deleted.
     The card says so; the server refuses a new window (404 module_disabled),
     so the only choice offered is clearing a saved one ("Keep everything").
   - A window under the 7-day floor (only settable through the API) is shown
     as itself — never as "Keep everything" because no option matched — and
     flagged, as the compliance monitor does.
   Module state comes from the live module map (re-read every minute and right
   after a refusal); before it loads, from GET /api/settings' messageRetention.
   Changing it is director/developer only (PATCH /api/settings/org): an ER
   director sees the same state with the control disabled and says so. */
const RETENTION_PRESETS = [0, 30, 90, 180, 365];
function retentionLabel(d) {
  if (!d) return "Keep everything";
  if (d === 365) return "1 year";
  return d + (d === 1 ? " day" : " days");
}
function MessageRetentionBody({ st, a, canEdit = true }) {
  const info = st.orgRetention || null;
  const days = st.orgRetentionDays || 0;
  const moduleOn = st.modules ? st.modules["ops.retention"] !== false : !(info && info.moduleEnabled === false);
  const floor = (info && info.minimumRecommendedDays) || 7;
  const selectStyle = { height: 36, padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 13.5, fontFamily: "inherit", background: "#fff", cursor: canEdit ? "pointer" : "not-allowed", maxWidth: "100%" };
  const readOnly = canEdit ? null : <span data-readonly-note style={{ fontWeight: 600 }}> {DIRECTOR_ONLY_NOTE}</span>;
  const note = { fontSize: 12, lineHeight: 1.45, margin: "10px 0 0", display: "flex", gap: 7, alignItems: "flex-start" };

  if (!moduleOn) {
    return (
      <div data-retention-state="off">
        <div role="status" style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--status-pending-fg, var(--foreground))", background: "var(--status-pending-bg)", border: "1px solid var(--status-pending)", borderRadius: "var(--radius-md)", padding: "9px 11px", margin: "0 0 10px", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ flex: "none", marginTop: 1 }}><Icon name="info" size={15} /></span>
          <span>
            <b>The retention purge is switched off</b> for this organization by the platform operator. Nothing is deleted — messages are kept indefinitely.
            {days > 0 ? " A " + (days === 365 ? "1-year" : days + "-day") + " window is saved but NOT enforced; it would take effect if the purge were switched back on." + (canEdit ? " Choose “Keep everything” to clear it." : "") : " A retention window can be set once the purge is switched on."}
            {readOnly}
          </span>
        </div>
        <select aria-label="Message retention" value={days} disabled={!days || !canEdit}
          onChange={(e) => a.setOrgRetention(Number(e.target.value))}
          style={Object.assign({}, selectStyle, days && canEdit ? null : { cursor: "not-allowed", opacity: 0.7 })}>
          {days > 0 && <option value={days}>{retentionLabel(days)} — saved, not enforced</option>}
          <option value={0}>Keep everything</option>
        </select>
      </div>
    );
  }

  const options = RETENTION_PRESETS.indexOf(days) >= 0 ? RETENTION_PRESETS : RETENTION_PRESETS.concat([days]).sort((x, y) => x - y);
  const belowFloor = days > 0 && days < floor;
  return (
    <div data-retention-state="on">
      <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 10px" }}>Messages older than this are permanently deleted, with their attachments, by an hourly, audited purge. "Keep everything" disables it.{readOnly}</p>
      <select aria-label="Message retention" value={days} onChange={(e) => a.setOrgRetention(Number(e.target.value))} disabled={!canEdit} style={selectStyle}>
        {options.map((d) => (
          <option key={d} value={d}>{retentionLabel(d)}{RETENTION_PRESETS.indexOf(d) < 0 ? " (set through the API)" : ""}</option>
        ))}
      </select>
      {belowFloor && (
        <p role="status" style={Object.assign({}, note, { color: "var(--status-rejected-fg, var(--destructive))" })}>
          <span style={{ flex: "none", marginTop: 1 }}><Icon name="alert-triangle" size={14} /></span>
          <span>{retentionLabel(days)} is below the {floor}-day minimum: messages are permanently deleted before an incident review or legal hold can reach them. The compliance monitor flags this.</span>
        </p>
      )}
    </div>
  );
}

Object.assign(window, { OrgSettings });
