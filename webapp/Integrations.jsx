/* DocTurn web-app UI kit — Settings → Integrations (REAL, server-backed).

   Every card is the server's answer from GET /api/integrations
   (server/integrations/registry.ts): status computed from live configuration,
   the on/off switch = the org's gating module (PATCH, refused with a reason
   when the integration is not configured or has no BAA), "Test connection" =
   a real, harmless call made by the server, and "Set up" = write-only fields
   for the hospital's own credentials (Amion, Epic) or the exact server
   settings the DocTurn operator must add (Twilio, push, OpenAI). Nothing here
   is decided or remembered in the browser. */

const INT_STATUS = {
  active:         { label: "Active",         bg: "var(--status-accepted-bg)", fg: "var(--status-accepted-fg)", icon: "circle-check-big" },
  off:            { label: "Off",            bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral-fg)",  icon: "circle-pause" },
  not_configured: { label: "Not set up",     bg: "var(--status-pending-bg)",  fg: "var(--status-pending-fg)",  icon: "plug-zap" },
  needs_baa:      { label: "Needs BAA",      bg: "var(--status-rejected-bg)", fg: "var(--status-rejected-fg)", icon: "file-warning" },
  error:          { label: "Error",          bg: "var(--status-rejected-bg)", fg: "var(--status-rejected-fg)", icon: "triangle-alert" },
  // Developer overview, platform header: the operator's keys are set and no
  // test against them has failed — each org's own row says whether it is Active.
  configured:     { label: "Set on server",  bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral-fg)",  icon: "server" },
};

const INT_READONLY_NOTE = "A director manages this.";

function IntStatusBadge({ status }) {
  const s = INT_STATUS[status] || INT_STATUS.not_configured;
  return (
    <span data-int-badge={status} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 700, lineHeight: 1.6, background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>
      <Icon name={s.icon} size={12} />{s.label}
    </span>
  );
}

// 44×44 tap target around a 44×26 track (the phone stylesheet floors every
// button at 44px; the visible track stays a switch).
function IntSwitch({ on, disabled, busy, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled || busy}
      data-int-switch={on ? "on" : "off"}
      onClick={() => { if (!disabled && !busy) onChange(!on); }}
      style={{ width: 52, height: 44, minWidth: 44, padding: 0, border: "none", background: "transparent", cursor: disabled ? "not-allowed" : busy ? "progress" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", opacity: disabled ? 0.45 : 1 }}>
      <span style={{ position: "relative", display: "block", width: 44, height: 26, borderRadius: 99, background: on ? "var(--status-accepted)" : "#CBD5E1", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .15s" }} />
      </span>
    </button>
  );
}

function IntButton({ children, icon, onClick, disabled, title, primary, danger, dataAttr }) {
  const props = dataAttr ? { [dataAttr]: "" } : {};
  return (
    <button type="button" onClick={() => { if (!disabled) onClick(); }} disabled={disabled} title={title} aria-label={title || undefined} {...props}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, padding: "0 14px", borderRadius: "var(--radius-md)", fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
        border: primary ? "1px solid var(--primary)" : danger ? "1px solid var(--destructive)" : "1px solid var(--border)",
        background: primary ? "var(--primary)" : "#fff", color: primary ? "#fff" : danger ? "var(--destructive)" : "var(--foreground)" }}>
      {icon && <Icon name={icon} size={15} />}{children}
    </button>
  );
}

function intAgo(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  try { return window.dtFmt && window.dtFmt.ago ? window.dtFmt.ago(t) : new Date(t).toLocaleString(); } catch (e) { return ""; }
}
function intStamp(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return "";
  try { return t.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return t.toISOString(); }
}

function IntCode({ children }) {
  return <code style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, padding: "1px 6px", borderRadius: 4, background: "var(--secondary)", color: "var(--foreground)", overflowWrap: "anywhere", wordBreak: "break-word" }}>{children}</code>;
}

function IntegrationCard({ card, orgName, busy, result, onToggle, onTest, onSetup, readOnly }) {
  const canTest = !readOnly && (card.canEnable || card.status === "needs_baa");
  const switchBlocked = !card.enabled && !card.canEnable;
  const last = card.lastCheck;
  const lastText = last
    ? (last.kind === "test" ? (last.ok ? "Last test passed" : "Last test failed") : (last.ok ? "Last sync succeeded" : "Last sync failed")) + " · " + intAgo(last.at)
    : (card.canEnable ? "Not tested since the server started" : null);
  return (
    <div data-integration={card.id} data-status={card.status} data-enabled={card.enabled ? "1" : "0"}
      style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 14, background: "#fff", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
        <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name={card.icon || "plug"} size={18} color={card.status === "active" ? "var(--primary)" : "var(--muted-foreground)"} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>{card.name}</span>
            <IntStatusBadge status={card.status} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
            {card.vendor} · {card.scope === "platform" ? "DocTurn operator's account (server settings)" : "Your hospital's own account"}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 13, lineHeight: 1.5, margin: "10px 0 8px", color: "var(--foreground)" }}>{card.purpose}</p>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.45, padding: "8px 10px", borderRadius: "var(--radius-md)", background: card.phi ? "var(--status-rejected-bg)" : "var(--secondary)", color: card.phi ? "var(--status-rejected-fg)" : "var(--muted-foreground)" }}>
        <Icon name={card.phi ? "shield-alert" : "shield-check"} size={14} style={{ flex: "none", marginTop: 2 }} />
        <span><b>{card.phi ? "Receives PHI — BAA required. " : "No PHI. "}</b>{card.phiNote}</span>
      </div>

      <div data-int-status-text style={{ fontSize: 13, lineHeight: 1.5, marginTop: 10, color: card.status === "active" ? "var(--status-accepted-fg)" : card.status === "off" ? "var(--muted-foreground)" : "var(--status-pending-fg)" }}>
        {card.statusText}
      </div>
      {(card.missing.length > 0 || card.invalid.length > 0) && card.scope === "platform" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {card.missing.map((n) => <IntCode key={"m" + n}>{n}</IntCode>)}
          {card.invalid.map((n) => <IntCode key={"i" + n}>{n} (invalid)</IntCode>)}
        </div>
      )}
      {card.note && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.45 }}>{card.note}</div>}
      {lastText && <div style={{ fontSize: 12, color: last && !last.ok ? "var(--status-rejected-fg)" : "var(--muted-foreground)", marginTop: 6 }}>{lastText}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <IntSwitch on={card.enabled} disabled={switchBlocked || readOnly} busy={busy === "toggle"} onChange={onToggle}
          label={(card.enabled ? "Switch off " : "Switch on ") + card.name + " for " + orgName} />
        <span style={{ fontSize: 12.5, fontWeight: 600, marginRight: "auto", minWidth: 0 }}>
          {!card.enabled ? "Off for " + orgName
            : card.canEnable ? "On for " + orgName
            : "Allowed for " + orgName + " — does nothing until " + (card.status === "needs_baa" ? "the BAA is attested" : "it is set up")}
        </span>
        <IntButton icon="activity" onClick={onTest} disabled={!canTest || busy === "test"} dataAttr="data-int-test"
          title={readOnly ? INT_READONLY_NOTE : canTest ? "Test connection" : "Nothing to test until it is set up"}>{busy === "test" ? "Testing…" : "Test connection"}</IntButton>
        <IntButton icon="settings-2" onClick={onSetup} disabled={readOnly} dataAttr="data-int-setup" title={readOnly ? INT_READONLY_NOTE : "Set up " + card.name}>Set up</IntButton>
      </div>
      {readOnly ? (
        <div data-int-readonly style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 6, fontWeight: 600 }}>{INT_READONLY_NOTE} You can see its status; switching, testing and setting it up are for a director.</div>
      ) : switchBlocked && (
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 6 }}>The switch unlocks once this integration is set up{card.status === "needs_baa" ? " and the BAA is attested" : ""}.</div>
      )}
      {result && (
        <div role="status" data-int-result={result.ok ? "ok" : "fail"} style={{ marginTop: 8, padding: "8px 10px", borderRadius: "var(--radius-md)", fontSize: 12.5, lineHeight: 1.45, background: result.ok ? "var(--status-accepted-bg)" : "var(--status-rejected-bg)", color: result.ok ? "var(--status-accepted-fg)" : "var(--status-rejected-fg)" }}>
          <b>{result.ok ? "Test passed: " : "Test failed: "}</b>{result.message}{result.detail ? " " + result.detail : ""}
        </div>
      )}
    </div>
  );
}

function IntStepList({ title, steps }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {steps.map((s, i) => (
          <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, overflowWrap: "anywhere", wordBreak: "break-word" }}>
            {/^(aws |REGION=|sudo )/.test(s) ? <IntCode>{s}</IntCode> : s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function IntegrationSetupSheet({ card, orgId, orgName, storage, onClose, onUpdated }) {
  const a = useActions();
  const isOrg = card.setup && card.setup.kind === "credentials";
  const [values, setValues] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [where, setWhere] = React.useState("render");
  const setup = card.setup || {};
  const current = isOrg ? setup.current : null;
  const save = () => {
    if (saving) return;
    setSaving(true); setError(null);
    Promise.resolve(a.saveIntegrationCredentials(card.id, values, orgId))
      .then((r) => { setValues({}); if (r && r.integration) onUpdated(r.integration); })
      .catch((e) => setError({ field: e && e.field, message: (e && e.detail) || (e && e.message) || "Not saved." }))
      .finally(() => setSaving(false));
  };
  const clear = () => {
    if (!window.confirm("Remove " + card.name + " credentials for " + orgName + "? The connection stops until they are entered again.")) return;
    Promise.resolve(a.clearIntegrationCredentials(card.id, orgId)).then((r) => { if (r && r.integration) onUpdated(r.integration); }).catch(() => {});
  };
  return (
    <Modal title={"Set up " + card.name} subtitle={card.scope === "platform" ? "Server settings — the DocTurn operator adds these" : "Your hospital's own " + card.vendor + " account · " + orgName} icon={card.icon || "plug"} onClose={onClose} width={560}>
      <div data-int-sheet={card.id} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {!isOrg && (
          <React.Fragment>
            <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
              {card.name} uses the DocTurn operator's {card.vendor} account, so its keys live in the <b>server's settings</b> (Render dashboard or AWS Parameter Store) — never in this screen and never in the browser. Once the server restarts with valid values, every row below shows a tick and the card leaves "Not set up"; then press <b>Test connection</b>.
            </p>
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              {setup.variables.map((v, i) => {
                // "set" only when the server ACCEPTED the value; present-but-rejected is "invalid".
                const state = v.state || (v.set ? "set" : "missing");
                const icon = state === "set" ? "circle-check" : state === "invalid" ? "triangle-alert" : "circle-dashed";
                const color = state === "set" ? "var(--status-accepted)" : state === "invalid" ? "var(--status-rejected-fg)" : "var(--muted-foreground)";
                return (
                <div key={v.name} data-int-var={v.name} data-state={state} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <Icon name={icon} size={16} color={color} style={{ flex: "none", marginTop: 2 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <IntCode>{v.name}</IntCode>
                      <span style={{ fontSize: 11.5, color: state === "invalid" ? "var(--status-rejected-fg)" : "var(--muted-foreground)", fontWeight: state === "invalid" ? 600 : 400 }}>
                        {state === "set" ? "set" : state === "invalid" ? "set but not accepted — see the card" : v.required ? "missing" : "optional, not set"}{v.secret ? " · secret" : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 3, lineHeight: 1.45 }}>{v.description}</div>
                    {v.caution && <div style={{ fontSize: 12.5, color: "var(--status-rejected-fg)", marginTop: 3, lineHeight: 1.45, fontWeight: 600 }}>{v.caution}</div>}
                  </div>
                </div>
                );
              })}
            </div>
            <div role="tablist" style={{ display: "flex", gap: 6 }}>
              {[["render", "On Render"], ["aws", "On AWS"]].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={where === k} onClick={() => setWhere(k)}
                  style={{ minHeight: 44, padding: "0 14px", borderRadius: "var(--radius-md)", border: "1px solid " + (where === k ? "var(--primary)" : "var(--border)"), background: where === k ? "#EFF6FF" : "#fff", color: where === k ? "var(--primary)" : "var(--foreground)", fontWeight: 600, fontSize: 13.5, cursor: "pointer", fontFamily: "var(--font-sans)" }}>{l}</button>
              ))}
            </div>
            <IntStepList title={where === "render" ? "Render dashboard" : "AWS (SSM Parameter Store)"} steps={where === "render" ? setup.steps.render : setup.steps.aws} />
          </React.Fragment>
        )}
        {isOrg && (
          <React.Fragment>
            {current && current.set && (
              <div data-int-current style={{ fontSize: 12.5, lineHeight: 1.5, padding: "8px 10px", borderRadius: "var(--radius-md)", background: current.readable ? "var(--status-accepted-bg)" : "var(--status-pending-bg)", color: current.readable ? "var(--status-accepted-fg)" : "var(--status-pending-fg)" }}>
                <b>Saved</b> · updated by {current.updatedByName || "unknown"} · {intStamp(current.updatedAt)}
                {Object.keys(current.summary || {}).map((k) => <span key={k}> · {k.replace(/Host$/, " host").replace(/^host$/, "host")}: <IntCode>{current.summary[k]}</IntCode></span>)}
                {!current.readable && <div style={{ marginTop: 4 }}>{card.statusText}</div>}
              </div>
            )}
            {!storage.available ? (
              <div style={{ fontSize: 13, lineHeight: 1.5, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-pending-bg)", color: "var(--status-pending-fg)" }}>
                <b>Saving is switched off on this server.</b> {storage.message}
              </div>
            ) : (
              <React.Fragment>
                <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: 0, lineHeight: 1.5 }}>
                  Write-only: saved values are encrypted on the server (AES-256-GCM) and never shown again — not even to you. Leave a secret field empty to keep what is saved.
                </p>
                {setup.fields.map((f) => (
                  <Field key={f.name} label={f.label + (f.required ? "" : "")} value={values[f.name] || ""}
                    onChange={(v) => setValues(Object.assign({}, values, { [f.name]: v }))}
                    placeholder={current && Array.isArray(current.fieldsSet) && current.fieldsSet.indexOf(f.name) >= 0 ? "•••••• saved — type to replace" : f.placeholder}
                    type={f.secret && !f.multiline ? "password" : "text"} textarea={!!f.multiline} rows={f.multiline ? 5 : undefined}
                    autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    help={f.help} error={error && error.field === f.name ? error.message : null} />
                ))}
                {error && !error.field && <div role="alert" style={{ fontSize: 12.5, color: "var(--destructive)" }}>{error.message}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <IntButton primary icon="lock" onClick={save} disabled={saving} dataAttr="data-int-save">{saving ? "Saving…" : "Save encrypted"}</IntButton>
                  {current && current.set && <IntButton danger icon="trash-2" onClick={clear} dataAttr="data-int-clear">Remove</IntButton>}
                </div>
              </React.Fragment>
            )}
            {setup.operatorFallback && setup.operatorFallback.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Alternatively the DocTurn operator can connect ONE organization on the server with {setup.operatorFallback.map((v, i) => <React.Fragment key={v.name}>{i ? ", " : ""}<IntCode>{v.name}</IntCode></React.Fragment>)}. A hospital's own saved credentials always take priority.
              </div>
            )}
          </React.Fragment>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <IntButton onClick={onClose} dataAttr="data-int-close">Done</IntButton>
        </div>
      </div>
    </Modal>
  );
}

/** The real Integrations panel for one org (own org by default; a developer may pass orgId). */
function IntegrationsPanel({ orgId, embedded }) {
  const a = useActions();
  const [data, setData] = React.useState(null);
  const [failed, setFailed] = React.useState(null);
  const [busy, setBusy] = React.useState({});
  const [results, setResults] = React.useState({});
  const [sheet, setSheet] = React.useState(null);
  const load = React.useCallback(() => {
    if (!a.loadIntegrations) return;
    Promise.resolve(a.loadIntegrations(orgId)).then((r) => { if (r) { setData(r); setFailed(null); } }).catch((e) => setFailed(String((e && e.message) || "unavailable")));
  }, [orgId]);
  React.useEffect(() => { setData(null); setResults({}); load(); }, [load]);

  const replace = (card) => setData((d) => d ? Object.assign({}, d, { integrations: d.integrations.map((c) => (c.id === card.id ? card : c)) }) : d);
  const mark = (id, v) => setBusy((b) => Object.assign({}, b, { [id]: v }));
  const toggle = (card, on) => {
    mark(card.id, "toggle");
    Promise.resolve(a.setIntegrationEnabled(card.id, on, orgId))
      .then((r) => { if (r && r.integration) replace(r.integration); })
      .catch(() => load())
      .finally(() => mark(card.id, null));
  };
  const test = (card) => {
    mark(card.id, "test");
    Promise.resolve(a.testIntegration(card.id, orgId))
      .then((r) => { if (r) { setResults((m) => Object.assign({}, m, { [card.id]: r })); if (r.integration) replace(r.integration); } })
      .catch(() => {})
      .finally(() => mark(card.id, null));
  };

  const orgName = (data && data.orgName) || "this organization";
  const cards = (data && data.integrations) || [];
  // The server says whether THIS user may switch / test / set up (an ER
  // director reads the cards; the write routes refuse them).
  const readOnly = !!(data && data.canManage === false);
  const open = sheet ? cards.find((c) => c.id === sheet) : null;
  const body = (
    <div data-integrations-panel={data ? data.orgId : ""}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <Icon name="plug" size={18} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Integrations</h3>
        {data && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{cards.filter((c) => c.status === "active").length} of {cards.length} active for {orgName}</span>}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", margin: "0 0 12px", lineHeight: 1.5 }}>
        Each card shows what the server reports right now. Switches change this organization only and are enforced by the server; a connection can only be switched on once it is set up.
        {readOnly ? " " + INT_READONLY_NOTE + " You can see every status here." : ""}
      </p>
      {failed && !data && <div role="alert" style={{ fontSize: 13, color: "var(--destructive)", padding: "8px 0" }}>Couldn't load integrations ({failed}). <button type="button" onClick={load} style={{ border: "none", background: "transparent", color: "var(--primary)", fontWeight: 600, cursor: "pointer", minHeight: 44, fontFamily: "var(--font-sans)" }}>Retry</button></div>}
      {!data && !failed && <div style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "8px 0" }}>Loading from the server…</div>}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {cards.map((c) => (
            <IntegrationCard key={c.id} card={c} orgName={orgName} busy={busy[c.id]} result={results[c.id]} readOnly={readOnly}
              onToggle={(on) => toggle(c, on)} onTest={() => test(c)} onSetup={() => { if (!readOnly) setSheet(c.id); }} />
          ))}
        </div>
      )}
      {data && !data.credentialStorage.available && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted-foreground)", display: "flex", gap: 6, alignItems: "flex-start", lineHeight: 1.45 }}>
          <Icon name="lock" size={13} style={{ flex: "none", marginTop: 2 }} />{data.credentialStorage.message}
        </div>
      )}
      {open && !readOnly && (
        <IntegrationSetupSheet card={open} orgId={orgId} orgName={orgName} storage={data.credentialStorage}
          onClose={() => setSheet(null)} onUpdated={(c) => replace(c)} />
      )}
    </div>
  );
  return embedded ? body : <Card style={{ padding: 18, minWidth: 0 }}>{body}</Card>;
}

/** Developer: every org × integration, plus the operator's own server settings. */
function IntegrationsOverview() {
  const a = useActions();
  const [data, setData] = React.useState(null);
  const [failed, setFailed] = React.useState(null);
  React.useEffect(() => {
    if (!a.loadIntegrationsOverview) return;
    Promise.resolve(a.loadIntegrationsOverview()).then((r) => { if (r) setData(r); }).catch((e) => setFailed(String((e && e.message) || "unavailable")));
  }, []);
  if (failed) return <Card style={{ padding: 18, fontSize: 13, color: "var(--destructive)" }}>Couldn't load the integrations overview ({failed}).</Card>;
  if (!data) return <Card style={{ padding: 18, fontSize: 13, color: "var(--muted-foreground)" }}>Loading from the server…</Card>;
  return (
    <div data-integrations-overview style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
        Live from the server. Platform connections (Twilio, push, OpenAI) use the operator's server settings and are the same for every organization; each organization switches them on or off for itself. Amion and Epic use each hospital's own credentials (Organization config → Integrations, or the director's Settings).
      </div>
      {!data.credentialStorage.available && (
        <Card style={{ padding: 12, fontSize: 12.5, lineHeight: 1.5, background: "var(--status-pending-bg)", color: "var(--status-pending-fg)" }}><b>Hospital credential storage is off.</b> {data.credentialStorage.message}</Card>
      )}
      {data.integrations.map((it) => (
        <Card key={it.id} style={{ padding: 0, overflow: "hidden", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "11px 14px", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{it.name}</span>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{it.vendor} · {it.scope === "platform" ? "platform (server settings)" : "per hospital"}{it.phi ? " · PHI → BAA required" : ""}</span>
            {it.platform && (
              <span style={{ marginLeft: "auto" }} data-overview-platform={it.id} data-status={it.platform.status}>
                {/* The server's word for the operator's keys — never "Active":
                    whether each org is active is its own row below. */}
                <IntStatusBadge status={it.platform.status || (it.platform.needsBaa ? "needs_baa" : it.platform.configured ? "configured" : "not_configured")} />
              </span>
            )}
          </div>
          {it.platform && (it.platform.missing.length > 0 || it.platform.invalid.length > 0) && (
            <div style={{ padding: "8px 14px", fontSize: 12.5, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", borderBottom: "1px solid var(--border)" }}>
              Server needs: {it.platform.missing.map((n) => <IntCode key={n}>{n}</IntCode>)}{it.platform.invalid.map((n) => <IntCode key={"i" + n}>{n} (invalid)</IntCode>)}
            </div>
          )}
          {data.orgs.map((o, i) => (
            <div key={o.orgId} data-overview-row={o.code + ":" + it.id} data-status={o.statuses[it.id]} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderTop: i ? "1px solid var(--border)" : "none", minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{o.name} <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>({o.code})</span></span>
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{o.enabled[it.id] ? "on" : "off"}</span>
              <IntStatusBadge status={o.statuses[it.id]} />
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

Object.assign(window, { IntegrationsPanel, IntegrationsOverview, IntStatusBadge });
