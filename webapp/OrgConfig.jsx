/* DocTurn web-app UI kit — developer per-organization configuration.
   One consolidated page that individualizes a tenant's Rules, Permissions and
   Compliance, OR (scope "*") edits the Enterprise defaults every org inherits.
   Each org-scoped value shows whether it's inherited from enterprise or has
   been overridden, with a one-tap reset back to the enterprise default. */

const PERM_CATALOG = [
  ["view_census", "View census"],
  ["assign_patients", "Assign patients"],
  ["manage_assignments", "Manage assignments"],
  ["request_consult", "Request consults"],
  ["message", "Message care team"],
  ["view_reports", "View reports"],
  ["manage_staff", "Manage staff"],
  ["approve_users", "Approve registrations"],
  ["system_settings", "System settings"],
];
const OC_ROLES = [
  ["hospitalist", "Hospitalist"],
  ["er_doctor", "ER physician"],
  ["er_director", "ER director"],
  ["director", "Hospitalist director"],
  ["developer", "Developer"],
];

function OCToggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on}
      style={{ width: 42, height: 24, borderRadius: 99, border: "none", cursor: "pointer", padding: 2, background: on ? "var(--primary)" : "var(--secondary)", transition: "background .15s", flex: "none" }}>
      <span style={{ display: "block", width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transform: on ? "translateX(18px)" : "none", transition: "transform .15s" }} />
    </button>
  );
}

function InheritTag({ overridden, onReset }) {
  if (!overridden) return <Badge variant="secondary">Inherited</Badge>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: 11.5, fontWeight: 700, color: "var(--primary)", background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
        <Icon name="pencil" size={10} />Custom
      </span>
      {onReset && <button onClick={onReset} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", fontFamily: "var(--font-sans)", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="rotate-ccw" size={12} />Reset</button>}
    </span>
  );
}

function RuleRow({ icon, title, desc, control, scope, overridden, onReset }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--secondary)", color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={icon} size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{desc}</div>
      </div>
      {scope !== "*" && <InheritTag overridden={overridden} onReset={onReset} />}
      <div style={{ flex: "none" }}>{control}</div>
    </div>
  );
}

function OCNumber({ value, onChange, suffix, width }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        style={{ width: width || 64, height: 34, textAlign: "center", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 14, fontFamily: "inherit", color: "var(--foreground)" }} />
      {suffix && <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{suffix}</span>}
    </div>
  );
}

function OrgConfig({ scope, org, audit = [], incidents = [], onClearCompliance }) {
  const [tab, setTab] = React.useState("rules");
  const [liveAudit, setLiveAudit] = React.useState(null);
  const DT = window.DT, a = DT.actions;
  // For a specific org, pull that tenant's REAL audit trail from the backend so
  // compliance is genuinely individualized (not the developer's platform log).
  React.useEffect(() => {
    if (tab !== "compliance" || scope === "*" || !org || org.id == null) return;
    let alive = true;
    fetch("/api/dev/organizations/" + org.id + "/audit", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (alive) setLiveAudit(Array.isArray(d.audit) ? d.audit : []); })
      .catch(() => { if (alive) setLiveAudit([]); });
    return () => { alive = false; };
  }, [tab, scope, org && org.id]);
  const cfg = DT.orgConfig(scope);
  const isEnt = scope === "*";
  const rules = cfg.rules;
  const ruleOver = (k) => cfg.overridden.rules.indexOf(k) >= 0;
  const setRule = (k, v) => isEnt ? a.setEnterpriseRule(k, v) : a.setOrgRule(scope, k, v);
  const resetRule = (k) => a.resetOrgRule(scope, k);

  const title = isEnt ? "Enterprise defaults" : (org ? org.name : scope);
  const sub = isEnt
    ? "Platform-wide defaults. Every organization inherits these unless it overrides a value on its own page."
    : "Settings here apply to this organization only. Unset values inherit the enterprise defaults.";

  // Prefer the live per-org audit (real backend rows) for a specific org;
  // fall back to the in-store audit (enterprise/platform view).
  const scopedAudit = (!isEnt && liveAudit)
    ? liveAudit.map((r) => ({
        id: r.id, at: new Date(r.createdAt || Date.now()).getTime(),
        actor: r.userId ? "User " + r.userId : "System", role: "",
        action: r.action || "", resource: r.resourceType ? (r.resourceType + (r.resourceId != null ? " #" + r.resourceId : "")) : "",
        org: scope, risk: r.riskLevel || "low",
      }))
    : (isEnt ? audit : (audit || []).filter((r) => !r.org || r.org === scope));
  const scopedInc = isEnt ? incidents : (incidents || []).filter((r) => !r.org || r.org === scope);

  const TABS = isEnt
    ? [["rules", "Rules", "sliders-horizontal"], ["perms", "Permissions", "shield-half"], ["platform", "Platform & mobile", "smartphone"], ["compliance", "Compliance", "shield-check"]]
    : [["rules", "Rules", "sliders-horizontal"], ["perms", "Permissions", "shield-half"], ["compliance", "Compliance", "shield-check"]];
  const plat = (DT.getState().enterprise || {}).platform || {};
  const setPlat = (sec, k, v) => a.setEnterprisePlatform(sec, k, v);

  return (
    <PageWrap>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ width: 42, height: 42, borderRadius: "var(--radius-md)", background: isEnt ? "#1E293B" : "#DBEAFE", color: isEnt ? "#7DD3FC" : "var(--primary)", fontWeight: 700, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          {isEnt ? <Icon name="globe" size={20} /> : (scope || "").slice(0, 2)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: "-.01em" }}>{title}</h2>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{isEnt ? "Applies to all tenants" : <span className="ds-mono">{scope}</span>} · individualized configuration</div>
        </div>
        {!isEnt && <Badge variant="secondary" icon="layers">Overrides enterprise</Badge>}
        {!isEnt && <Button size="sm" icon="log-in" onClick={() => window.DT.actions.manageOrg(scope)}>Manage full portal</Button>}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5, marginBottom: 16, maxWidth: 720 }}>{sub}</div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(([id, label, icon]) => {
          const on = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", border: "none", borderBottom: on ? "2px solid var(--primary)" : "2px solid transparent", background: "transparent", cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: on ? "var(--primary)" : "var(--muted-foreground)", fontFamily: "var(--font-sans)", marginBottom: -1 }}>
              <Icon name={icon} size={15} />{label}
            </button>
          );
        })}
      </div>

      {tab === "rules" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>Assignment &amp; routing</div>
          <RuleRow icon="rotate-cw" title="Auto-reassign on decline" desc="When a hospitalist declines, immediately reroute to the next provider instead of leaving it for manual reassignment."
            scope={scope} overridden={ruleOver("autoReassign")} onReset={() => resetRule("autoReassign")}
            control={<OCToggle on={!!rules.autoReassign} onChange={(v) => setRule("autoReassign", v)} />} />
          <RuleRow icon="timer" title="Assignment timeout" desc="How long a pending assignment waits before it expires and reroutes."
            scope={scope} overridden={ruleOver("timeout")} onReset={() => resetRule("timeout")}
            control={<OCNumber value={rules.timeout} onChange={(v) => setRule("timeout", v)} suffix="min" />} />
          <RuleRow icon="git-branch" title="Rotation mode" desc="How the next hospitalist is chosen for round-robin routing."
            scope={scope} overridden={ruleOver("rotationMode")} onReset={() => resetRule("rotationMode")}
            control={
              <select value={rules.rotationMode} onChange={(e) => setRule("rotationMode", e.target.value)}
                style={{ height: 34, padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 13.5, fontFamily: "inherit", background: "#fff", cursor: "pointer" }}>
                <option value="lowest_census">Lowest census first</option>
                <option value="sequential">Sequential order</option>
              </select>
            } />
          <RuleRow icon="user-check" title="On-call providers only" desc="Restrict routing to providers currently on the on-call schedule."
            scope={scope} overridden={ruleOver("onCallOnly")} onReset={() => resetRule("onCallOnly")}
            control={<OCToggle on={!!rules.onCallOnly} onChange={(v) => setRule("onCallOnly", v)} />} />
          <RuleRow icon="activity" title="Active (working) only" desc="Only route to providers marked on-shift."
            scope={scope} overridden={ruleOver("activeOnly")} onReset={() => resetRule("activeOnly")}
            control={<OCToggle on={!!rules.activeOnly} onChange={(v) => setRule("activeOnly", v)} />} />
          <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)", borderTop: "1px solid var(--border)" }}>Data retention</div>
          <RuleRow icon="trash-2" title="Auto-clean old patients" desc="Automatically purge patients (and their logs) older than this. Set 0 to retain indefinitely."
            scope={scope} overridden={ruleOver("autoCleanHours")} onReset={() => resetRule("autoCleanHours")}
            control={<OCNumber value={rules.autoCleanHours} onChange={(v) => setRule("autoCleanHours", v)} suffix="hrs" />} />
        </Card>
      )}

      {tab === "perms" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Toggle what each role can do{isEnt ? " across the platform" : " in this organization"}. {isEnt ? "" : "Roles you don't customize inherit the enterprise defaults."}</div>
          {OC_ROLES.map(([rid, label]) => {
            const granted = cfg.permissions[rid] || [];
            const over = !isEnt && cfg.overridden.permissions.indexOf(rid) >= 0;
            return (
              <Card key={rid} style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: (DT.getState().roleColors || {})[rid] || "#888", flex: "none" }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span>
                  <span style={{ marginLeft: "auto" }}>{scope !== "*" && <InheritTag overridden={over} onReset={over ? () => a.resetOrgPerms(scope, rid) : null} />}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {PERM_CATALOG.map(([pid, plabel]) => {
                    const on = granted.indexOf(pid) >= 0;
                    return (
                      <button key={pid} onClick={() => a.setRolePerm(scope, rid, pid, !on)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)",
                          border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "#EFF6FF" : "#fff", color: on ? "var(--primary)" : "var(--muted-foreground)" }}>
                        <Icon name={on ? "check" : "plus"} size={12} />{plabel}
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "platform" && isEnt && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Platform-wide controls the operator manages centrally for every tenant — mobile apps, secure-messaging policy, access &amp; security, and integrations.</div>

          {/* Mobile apps */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, margin: "0 0 6px 2px", display: "flex", alignItems: "center", gap: 7 }}><Icon name="smartphone" size={15} color="var(--primary)" />Mobile apps</div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <RuleRow icon="apple" title="iOS app" desc="Allow the DocTurn iPhone/iPad app to connect." scope="*"
                control={<OCToggle on={!!(plat.mobile || {}).ios} onChange={(v) => setPlat("mobile", "ios", v)} />} />
              <RuleRow icon="smartphone" title="Android app" desc="Allow the DocTurn Android app to connect." scope="*"
                control={<OCToggle on={!!(plat.mobile || {}).android} onChange={(v) => setPlat("mobile", "android", v)} />} />
              <RuleRow icon="git-commit-horizontal" title="Minimum app version" desc="Devices below this build are prompted (or forced) to update." scope="*"
                control={<input value={(plat.mobile || {}).minVersion || ""} onChange={(e) => setPlat("mobile", "minVersion", e.target.value)} style={{ width: 92, height: 34, textAlign: "center", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 13.5, fontFamily: "inherit" }} />} />
              <RuleRow icon="download" title="Force update below minimum" desc="Block sign-in on out-of-date builds until updated." scope="*"
                control={<OCToggle on={!!(plat.mobile || {}).forceUpdate} onChange={(v) => setPlat("mobile", "forceUpdate", v)} />} />
              <RuleRow icon="shield" title="Managed deployment (MDM)" desc="Require enrollment via your MDM (Intune/Jamf) to run the app." scope="*"
                control={<OCToggle on={!!(plat.mobile || {}).mdm} onChange={(v) => setPlat("mobile", "mdm", v)} />} />
              <RuleRow icon="fingerprint" title="Biometric unlock" desc="Allow Face ID / fingerprint to unlock the app." scope="*"
                control={<OCToggle on={!!(plat.mobile || {}).biometric} onChange={(v) => setPlat("mobile", "biometric", v)} />} />
              <RuleRow icon="log-out" title="Remote sign-out" desc="Sign every device out of every tenant immediately." scope="*"
                control={<Button size="sm" variant="outline" icon="power" onClick={() => window.DT.actions.toast({ tone: "rejected", title: "Remote sign-out queued", msg: "All devices will be signed out." })}>Sign out all</Button>} />
            </Card>
          </div>

          {/* Secure messaging */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, margin: "0 0 6px 2px", display: "flex", alignItems: "center", gap: 7 }}><Icon name="message-square-lock" size={15} color="var(--primary)" />Secure messaging policy</div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <RuleRow icon="clock" title="Message retention" desc="How long secure messages are kept before purge." scope="*"
                control={
                  <select value={(plat.messaging || {}).retentionDays} onChange={(e) => setPlat("messaging", "retentionDays", Number(e.target.value))}
                    style={{ height: 34, padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 13.5, fontFamily: "inherit", background: "#fff", cursor: "pointer" }}>
                    {[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                } />
              <RuleRow icon="undo-2" title="Message recall" desc="Let senders delete/recall a message after sending." scope="*"
                control={<OCToggle on={!!(plat.messaging || {}).recall} onChange={(v) => setPlat("messaging", "recall", v)} />} />
              <RuleRow icon="check-check" title="Read receipts" desc="Show when a message has been read." scope="*"
                control={<OCToggle on={!!(plat.messaging || {}).readReceipts} onChange={(v) => setPlat("messaging", "readReceipts", v)} />} />
              <RuleRow icon="paperclip" title="Attachments" desc="Allow images/files in secure messages." scope="*"
                control={<OCToggle on={!!(plat.messaging || {}).attachments} onChange={(v) => setPlat("messaging", "attachments", v)} />} />
              <RuleRow icon="siren" title="Priority / STAT messages" desc="Enable escalating high-priority alerts with repeat tones." scope="*"
                control={<OCToggle on={!!(plat.messaging || {}).priority} onChange={(v) => setPlat("messaging", "priority", v)} />} />
            </Card>
          </div>

          {/* Access & security */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, margin: "0 0 6px 2px", display: "flex", alignItems: "center", gap: 7 }}><Icon name="lock" size={15} color="var(--primary)" />Access &amp; security</div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <RuleRow icon="key-round" title="Single sign-on (SSO / SAML)" desc="Authenticate users through your identity provider." scope="*"
                control={<OCToggle on={!!(plat.security || {}).sso} onChange={(v) => setPlat("security", "sso", v)} />} />
              <RuleRow icon="shield-check" title="Enforce two-factor" desc="Require 2FA for every account across all tenants." scope="*"
                control={<OCToggle on={!!(plat.security || {}).enforce2fa} onChange={(v) => setPlat("security", "enforce2fa", v)} />} />
              <RuleRow icon="timer" title="Session timeout" desc="Auto sign-out after this period of inactivity." scope="*"
                control={
                  <select value={(plat.security || {}).sessionTimeoutMin} onChange={(e) => setPlat("security", "sessionTimeoutMin", Number(e.target.value))}
                    style={{ height: 34, padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 13.5, fontFamily: "inherit", background: "#fff", cursor: "pointer" }}>
                    {[5, 15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                } />
              <RuleRow icon="lock" title="Auto-lock on background" desc="Lock the app when it goes to the background." scope="*"
                control={<OCToggle on={!!(plat.security || {}).autoLock} onChange={(v) => setPlat("security", "autoLock", v)} />} />
            </Card>
          </div>

          {/* Integrations */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, margin: "0 0 6px 2px", display: "flex", alignItems: "center", gap: 7 }}><Icon name="plug" size={15} color="var(--primary)" />Integrations</div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <RuleRow icon="message-square" title="SMS (Twilio)" desc="Escalate to SMS when a push isn't acknowledged." scope="*"
                control={<OCToggle on={!!(plat.integrations || {}).sms} onChange={(v) => setPlat("integrations", "sms", v)} />} />
              <RuleRow icon="bell" title="Push notifications (APNs / FCM)" desc="Deliver alerts to the mobile apps." scope="*"
                control={<OCToggle on={!!(plat.integrations || {}).push} onChange={(v) => setPlat("integrations", "push", v)} />} />
              <RuleRow icon="activity" title="EHR / FHIR sync" desc="Pull census/ADT from the EHR (Epic/Cerner via FHIR)." scope="*"
                control={<OCToggle on={!!(plat.integrations || {}).fhir} onChange={(v) => setPlat("integrations", "fhir", v)} />} />
              <RuleRow icon="radio" title="Paging bridge" desc="Bridge legacy pagers into secure messaging." scope="*"
                control={<OCToggle on={!!(plat.integrations || {}).paging} onChange={(v) => setPlat("integrations", "paging", v)} />} />
            </Card>
          </div>
        </div>
      )}

      {tab === "compliance" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 14 }}>
            <StatTile label="Audit events" value={scopedAudit.length} icon="scroll-text" tint="slate" />
            <StatTile label="Open incidents" value={scopedInc.filter((i) => !i.resolved).length} icon="alert-triangle" tint="amber" />
          </div>
          <div>
            <SectionTitle action={onClearCompliance ? <Button size="sm" variant="outline" icon="trash-2" onClick={() => { if (window.confirm("Clear compliance logs for " + (isEnt ? "all organizations" : title) + "?")) onClearCompliance(); }}>Clear logs</Button> : null}>
              {isEnt ? "Platform audit trail" : "Audit trail · " + title}
            </SectionTitle>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {scopedAudit.length === 0 && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No audit activity recorded{isEnt ? "" : " for this organization"} yet.</div>}
              {scopedAudit.slice(0, 40).map((r, i) => (
                <div key={r.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: r.risk === "high" ? "var(--status-rejected)" : r.risk === "medium" ? "var(--status-pending)" : "var(--status-neutral)", flex: "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{String(r.action || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}{r.resource ? " — " + r.resource : ""}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{r.actor || "System"} · {r.role || ""}{r.org ? " · " + r.org : ""}</div>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </PageWrap>
  );
}

Object.assign(window, { OrgConfig });
