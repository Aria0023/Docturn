/* DocTurn web-app UI kit — developer console: Platform (scope "*") and one
   organization's configuration (scope = org code).

   Only what the server holds and enforces:
   - An organization's Rules are THAT org's own values on the server
     (assignment timeout and rotation mode on the organization row,
     auto-reassign and auto-clean as org settings —
     /api/dev/organizations/:id[/settings]). A refused write is rolled back
     with the reason (api-bridge.js setOrgRule).
   - Platform → Security → "Sign out all" really ends every other session
     (POST /api/dev/sessions/revoke-all).
   - Integrations are server-backed (/api/integrations); Compliance shows the
     server's audit trail, read-only and read fresh when the tab opens — the
     platform org's (GET /api/audit) or the org's
     (GET /api/dev/organizations/:id/audit) — with the trail's TRUE size from
     the server (never the length of a 100-row page, A.CON developer #14) and
     never a row made up in this browser (#12).
   Removed because the server has no such thing (A.CON org-admin #11–#16):
   "enterprise defaults" that orgs inherit (there is no inheritance — new orgs
   get fixed defaults and the auto-clean sweep its own 24 h), per-role
   permission switches (authorization is the fixed role check in
   server/rbac.ts), the platform "mobile / messaging / security" toggles (the
   real per-org switches are the Feature modules on the Organizations page and
   the retention setting), the routing-only-on-call / active-only switches the
   router never read, and "Clear logs" (audit trails are kept by the server
   and must not be clearable), and the "Open incidents" tile (nothing records
   security incidents — A.CON developer #13). */

function OCToggle({ on, onChange, label }) {
  // 44×44 tap target around the 42×24 track.
  return (
    <button type="button" onClick={() => onChange(!on)} role="switch" aria-checked={!!on} aria-label={label}
      style={{ width: 52, height: 44, minWidth: 44, border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      <span style={{ display: "block", width: 42, height: 24, borderRadius: 99, padding: 2, background: on ? "var(--primary)" : "#CBD5E1", transition: "background .15s" }}>
        <span style={{ display: "block", width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transform: on ? "translateX(18px)" : "none", transition: "transform .15s" }} />
      </span>
    </button>
  );
}

function RuleRow({ icon, title, desc, control, note }) {
  // Wraps on phones: the text keeps ≥180px and the control drops to a second
  // line (right-aligned) instead of squeezing the title.
  return (
    <div data-rule-row={title} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--secondary)", color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={icon} size={16} /></span>
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>{desc}</div>
        {note && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 3, fontWeight: 600 }}>{note}</div>}
      </div>
      <div style={{ flex: "none", marginLeft: "auto" }}>{control}</div>
    </div>
  );
}

function OCNumber({ value, onChange, suffix, label, placeholder, min, max }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input type="number" inputMode="numeric" aria-label={label} value={value == null ? "" : value} placeholder={placeholder} min={min} max={max}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ width: 76, height: 44, textAlign: "center", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 16, fontFamily: "inherit", color: "var(--foreground)" }} />
      {suffix && <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{suffix}</span>}
    </div>
  );
}

// Platform default of the hourly auto-clean sweep when an org has no value
// (server/services/expiry.ts startAutoCleanLoop).
const AUTOCLEAN_PLATFORM_DEFAULT_H = 24;

function OrgConfig({ scope, org }) {
  const isEnt = scope === "*";
  const [tab, setTab] = React.useState(isEnt ? "security" : "rules");
  // { rows, count } from the server, null while loading, { error } on failure.
  const [trail, setTrail] = React.useState(null);
  const [signingOut, setSigningOut] = React.useState(false);
  const st = useStore();
  const a = useActions();
  const mobile = useIsMobile();
  // The server's trail, read when the Compliance tab opens: the platform org's
  // (operator actions filed there) or this tenant's own.
  const orgId = org && org.id != null ? org.id : null;
  React.useEffect(() => {
    if (tab !== "compliance" || !a.loadAuditTrail) return;
    if (!isEnt && orgId == null) return;
    let alive = true;
    setTrail(null);
    a.loadAuditTrail(isEnt ? null : orgId)
      .then((d) => { if (alive) setTrail(d); })
      .catch(() => { if (alive) setTrail({ error: true }); });
    return () => { alive = false; };
  }, [tab, scope, orgId]);

  const cfg = (st.orgConfigs || {})[scope] || null;
  const rules = (cfg && cfg.rules) || null;
  const setRule = (k, v) => a.setOrgRule(scope, k, v);

  const title = isEnt ? "Platform" : (org ? org.name : scope);
  const sub = isEnt
    ? "Operations that span every organization. Each organization's own rules are set on its own page (Organization config); per-organization feature switches are under Feature modules on the Organizations page."
    : "This organization's own settings, as the server holds them. Changes apply to this organization only.";

  // Actor names from the developer's cross-tenant user list when known.
  const nameOf = {};
  (st.devUsers || []).forEach((u) => { nameOf[u.id] = u; });
  const trailOrg = isEnt ? ((st.platformOrg && st.platformOrg.code) || "Platform") : scope;
  const rows = trail && trail.rows
    ? trail.rows.map((r) => {
        const u = r.userId != null ? nameOf[r.userId] : null;
        return {
          id: r.id, at: new Date(r.createdAt || 0).getTime(),
          actor: u ? u.name : (r.userId ? "User " + r.userId : "System"), role: u ? (u.role || "") : "",
          action: r.action || "", resource: r.resourceType ? (r.resourceType + (r.resourceId != null ? " #" + r.resourceId : "")) : "",
          org: trailOrg, risk: r.riskLevel || "low",
        };
      })
    : [];
  const count = trail && typeof trail.count === "number" ? trail.count : null;

  const TABS = isEnt
    ? [["security", "Security", "lock"], ["integrations", "Integrations", "plug"], ["compliance", "Compliance", "shield-check"]]
    : [["rules", "Rules", "sliders-horizontal"], ["integrations", "Integrations", "plug"], ["compliance", "Compliance", "shield-check"]];

  const signOutAll = () => {
    if (signingOut) return;
    if (!window.confirm("Sign every other session on every organization out now? Everyone else must sign in again; your own session stays open.")) return;
    setSigningOut(true);
    Promise.resolve(a.revokeAllSessions()).finally(() => setSigningOut(false));
  };

  return (
    <PageWrap>
      {/* Header — wraps so the "Manage full portal" button lands under the
          title on phones instead of past the viewport edge */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ width: 42, height: 42, borderRadius: "var(--radius-md)", background: isEnt ? "#1E293B" : "#DBEAFE", color: isEnt ? "#7DD3FC" : "var(--primary-ink, #1D4ED8)", fontWeight: 700, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          {isEnt ? <Icon name="globe" size={20} /> : (scope || "").slice(0, 2)}
        </span>
        <div style={{ flex: "1 1 180px", minWidth: 0 }}>
          <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: "-.01em" }}>{title}</h2>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{isEnt ? "Every organization" : <span className="ds-mono">{scope}</span>}</div>
        </div>
        {!isEnt && <Button size="sm" icon="log-in" onClick={() => a.manageOrg(scope)}>Manage full portal</Button>}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5, marginBottom: 16, maxWidth: 720 }}>{sub}</div>

      {/* Tabs — one non-wrapping strip that scrolls sideways within the viewport. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid var(--border)", flexWrap: "nowrap", overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch", maxWidth: "100%" }}>
        {TABS.map(([id, label, icon]) => {
          const on = tab === id;
          return (
            <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={on}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", minHeight: mobile ? 44 : undefined, flex: "none", whiteSpace: "nowrap", border: "none", borderBottom: on ? "2px solid var(--primary)" : "2px solid transparent", background: "transparent", cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: on ? "var(--primary)" : "var(--muted-foreground)", fontFamily: "var(--font-sans)" }}>
              <Icon name={icon} size={15} />{label}
            </button>
          );
        })}
      </div>

      {tab === "rules" && !isEnt && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>Assignment &amp; routing</div>
          {!rules && <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)", fontSize: 13, color: "var(--muted-foreground)" }}>Loading this organization's settings…</div>}
          {rules && <React.Fragment>
            <RuleRow icon="rotate-cw" title="Auto-reassign on decline" desc="When a hospitalist declines, the request goes straight to the next provider in rotation instead of waiting for a manual reassignment."
              control={<OCToggle label="Auto-reassign on decline" on={!!rules.autoReassign} onChange={(v) => setRule("autoReassign", v)} />} />
            <RuleRow icon="timer" title="Assignment timeout" desc="How long a pending assignment waits before it expires and is re-paged to the next provider (1–120 minutes)."
              control={<OCNumber label="Assignment timeout in minutes" value={rules.timeout} min={1} max={120} onChange={(v) => setRule("timeout", v)} suffix="min" />} />
            <RuleRow icon="git-branch" title="Rotation mode" desc="How the next hospitalist is chosen for round-robin routing."
              control={
                <select aria-label="Rotation mode" value={rules.rotationMode} onChange={(e) => setRule("rotationMode", e.target.value)}
                  style={{ height: 44, padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 16, fontFamily: "inherit", background: "#fff", cursor: "pointer", maxWidth: "100%" }}>
                  <option value="lowest_census">Lowest census first</option>
                  <option value="sequential">Sequential order</option>
                </select>
              } />
            <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)", borderTop: "1px solid var(--border)" }}>Data retention</div>
            <RuleRow icon="trash-2" title="Auto-clean old patients"
              desc={"Every hour, patients (and their assignments and consults) older than this many hours are purged for this organization. 0 keeps them indefinitely. Empty uses the platform's " + AUTOCLEAN_PLATFORM_DEFAULT_H + " hours."}
              note={rules.autoCleanHours == null ? "Not set — the platform's " + AUTOCLEAN_PLATFORM_DEFAULT_H + " hours apply." : rules.autoCleanHours === 0 ? "0 — patients are kept indefinitely." : null}
              control={<OCNumber label="Auto-clean after hours" value={rules.autoCleanHours} placeholder={String(AUTOCLEAN_PLATFORM_DEFAULT_H)} min={0} max={8760} onChange={(v) => setRule("autoCleanHours", v)} suffix="hrs" />} />
          </React.Fragment>}
        </Card>
      )}

      {tab === "security" && isEnt && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>Sessions</div>
          <RuleRow icon="log-out" title="Sign out all"
            desc="Ends every other session on every organization now: open browsers and phones must sign in again (other server instances follow within seconds). Your own session stays open. Recorded in the audit trail."
            control={<Button size="sm" variant="outline" icon="power" onClick={signOutAll}>{signingOut ? "Signing out…" : "Sign out all"}</Button>} />
        </Card>
      )}

      {tab === "integrations" && isEnt && typeof IntegrationsOverview === "function" && <IntegrationsOverview />}
      {tab === "integrations" && !isEnt && typeof IntegrationsPanel === "function" && (
        org && org.id != null
          ? <IntegrationsPanel orgId={org.id} />
          : <Card style={{ padding: 18, fontSize: 13, color: "var(--muted-foreground)" }}>Pick an organization first.</Card>
      )}

      {tab === "compliance" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex" }}>
            <StatTile label="Audit events" value={count == null ? "—" : count} icon="scroll-text" tint="slate"
              sub={count == null ? (trail && trail.error ? "The server didn't answer." : "Loading…") : "All recorded " + (isEnt ? "in the platform organization" : "for this organization") + ", kept by the server"} />
          </div>
          <div>
            <SectionTitle>{isEnt ? "Platform audit trail" : "Audit trail · " + title}</SectionTitle>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: -6, marginBottom: 10, lineHeight: 1.45 }}>
              {isEnt
                ? "Operator actions filed in the platform organization (" + trailOrg + "): cross-tenant lists, sign-ins, sign-out-all, tenant deletions. An action on one organization is filed in that organization's own trail (its Organization config → Compliance)."
                : "Everything recorded for this organization, including every developer read and change."}
            </div>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {!trail && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading the server's audit trail…</div>}
              {trail && trail.error && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--destructive)" }}>The server didn't return the audit trail. Open the tab again to retry.</div>}
              {trail && !trail.error && rows.length === 0 && <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No audit activity recorded{isEnt ? "" : " for this organization"} yet.</div>}
              {rows.slice(0, 40).map((r, i) => (
                <div key={r.id || i} data-audit-id={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: r.risk === "high" ? "var(--status-rejected)" : r.risk === "medium" ? "var(--status-pending)" : "var(--status-neutral)", flex: "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{String(r.action || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}{r.resource ? " — " + r.resource : ""}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{r.actor || "System"}{r.role ? " · " + r.role : ""}{r.at ? " · " + (window.dtFmt && window.dtFmt.stamp ? window.dtFmt.stamp(r.at) : new Date(r.at).toLocaleString()) : ""}</div>
                  </div>
                </div>
              ))}
            </Card>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.45 }}>
              {count != null && rows.length ? "Showing the latest " + Math.min(40, rows.length) + " of " + count + ". " : ""}The audit trail is kept by the server and can't be cleared from here.
            </div>
          </div>
        </div>
      )}
    </PageWrap>
  );
}

Object.assign(window, { OrgConfig });
