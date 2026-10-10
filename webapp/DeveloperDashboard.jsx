/* DocTurn web-app UI kit — Developer portal (cross-tenant administration).
   Spec: Eng §10.2 (developer dashboard), Req FR-10.1/10.2, FR-9.2 (AI monitor).
   Full control: cross-tenant orgs, system health, logs, AND user/specialist
   provisioning into any tenant by role type.

   Every number and option here is the server's (A.CON developer #1–#24):
   - Tiles: organizations / users / assignments created in the last 24 h from
     GET /api/dev/organizations; "Server uptime" is this instance's process
     uptime from GET /api/dev/platform-health (no invented 30-day percentage).
   - System health: that endpoint's MEASURED numbers — API p50/p95 over the
     last 5 minutes of real requests, live WebSocket connections, database
     round trip (and pool use on Postgres). "—" until it answers.
   - AI monitor: says nothing until "Run AI diagnostics" asks the server.
   - Organizations carry no Active/Suspended badge (the server has no
     suspension). Developer accounts are platform-wide (cross-tenant root) —
     there is no single-organization developer, so none is offered.
   - Add user sends the typed username (no e-mail is stored); New tenant's time
     zone is labelled as this browser's default, never a "detected location".
   - Role colors are this browser's preference and say so.
   - Live: nothing is shown before the server answers — never the kit's demo
     tenants or staff. */

function DevHealthBar({ label, value, max, tint }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
        <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}/{max}</span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: "var(--secondary)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", borderRadius: 99, background: tint }} />
      </div>
    </div>
  );
}

function DSelect({ label, icon, value, onChange, options }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {label && <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", background: "#fff" }}>
        {icon && <Icon name={icon} size={16} color="var(--muted-foreground)" />}
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label || undefined}
          style={{ border: "none", outline: "none", background: "transparent", fontSize: 16, minHeight: 44, fontFamily: "inherit", width: "100%", minWidth: 0, color: "var(--foreground)", cursor: "pointer" }}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

const DEV_ROLES = [
  ["hospitalist", "Hospitalist"],
  ["er_doctor", "ER physician"],
  ["er_director", "ER director"],
  ["director", "Director"],
  ["developer", "Developer"],
];
const ROLE_LABEL = Object.fromEntries(DEV_ROLES.map((r) => [r[0], r[1]]));
// Curated SOFT swatch options for role-color customization — muted, distinct,
// and readable as both text and dots.
const ROLE_SWATCHES = ["#4666C4", "#2C8C92", "#7A60C0", "#C07A33", "#C25A6B", "#B05C9A", "#3E7CA8", "#5E6A78"];
// Stable accent color per organization (by position, falling back to a hash).
const ORG_PALETTE = ["#2563EB", "#0F766E", "#7C3AED", "#DB2777", "#EA580C", "#0891B2", "#CA8A04", "#475569"];
function orgColor(code, organizations) {
  const i = organizations.findIndex((o) => o.code === code);
  const idx = i >= 0 ? i : (code ? code.charCodeAt(0) : 0);
  return ORG_PALETTE[idx % ORG_PALETTE.length];
}
function tintFor(hex) { return hex + "16"; }  // ~9% alpha tint

function userInitials(name) {
  return name.replace(/\(root\)/i, "").replace(/^Dr\.?\s*/, "").trim().split(/[\s,]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// Every developer account is platform-wide (requireRole("developer") with no
// org check on every /api/dev route) — so the chip says exactly that.
function RoleChip({ role, color }) {
  const isDev = role === "developer";
  const label = isDev ? "Developer · all orgs" : ROLE_LABEL[role] || role;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 8px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, color: color, background: (color || "#888") + "18", border: "1px solid " + (color || "#888") + "33", whiteSpace: "nowrap" }}>
      {isDev ? <Icon name="crown" size={11} color={color} /> : <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flex: "none" }} />}{label}
    </span>
  );
}

// A per-BROWSER preference (localStorage): other devices and other people keep
// the default colors, and nothing is sent to the server (A.CON developer #20).
function RoleColorEditor({ roleColors, onSetRoleColor }) {
  const [openRole, setOpenRole] = React.useState(null);
  return (
    <Card style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <Icon name="palette" size={16} color="var(--primary)" />
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Role colors</h3>
        <span data-role-colors-scope style={{ fontSize: 12, color: "var(--muted-foreground)" }}>· on this browser only — other devices and people keep the default colors</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
        {DEV_ROLES.map(([id, label]) => (
          <div key={id} style={{ position: "relative" }}>
            <button onClick={() => setOpenRole(openRole === id ? null : id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 11px", minHeight: 44, borderRadius: "var(--radius-md)", cursor: "pointer", border: "1px solid var(--border)", background: "#fff", fontFamily: "var(--font-sans)" }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: roleColors[id], flex: "none" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              <Icon name="chevron-down" size={13} color="var(--muted-foreground)" />
            </button>
            {openRole === id && (
              <React.Fragment>
                <div onClick={() => setOpenRole(null)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
                <div data-keep-cols="4" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 31, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", padding: 10, display: "grid", gridTemplateColumns: "repeat(4, 44px)", gap: 7, width: 225 }}>
                  {ROLE_SWATCHES.map((c) => (
                    <button key={c} onClick={() => { onSetRoleColor(id, c); setOpenRole(null); }} aria-label={"Use " + c + " for " + label}
                      style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: c, cursor: "pointer", border: roleColors[id] === c ? "2px solid var(--foreground)" : "2px solid transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {roleColors[id] === c && <Icon name="check" size={14} color="#fff" />}
                    </button>
                  ))}
                </div>
              </React.Fragment>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AddUserPanel({ organizations, devUsers = [], devUsersLoaded = true, roleColors, onAddUser, onRemoveUser, onImpersonate }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [orgFilter, setOrgFilter] = React.useState("ALL");
  const [roleFilter, setRoleFilter] = React.useState("ALL");
  const [collapsed, setCollapsed] = React.useState({});
  const [form, setForm] = React.useState({ org: (organizations[0] || {}).code || "", role: "hospitalist", name: "", username: "", specialty: "Hospital Medicine", cap: "15", shift: "day" });
  // Phones: user rows are two lines (identity, then role chip + actions) and
  // the filter/form rows wrap instead of overflowing the 362px content width.
  const mobile = useIsMobile();
  const set = (k, v) => setForm((f) => Object.assign({}, f, (function () { var o = {}; o[k] = v; return o; })()));
  const isClinical = form.role === "hospitalist";
  const isDev = form.role === "developer";
  // The org list arrives after the first render: default the picker to the
  // first real tenant once it does.
  React.useEffect(() => {
    if (!form.org && organizations.length) set("org", organizations[0].code);
  }, [organizations.length]);

  // The form closes only once the SERVER created the account (the one-time
  // password is then shown); a refusal keeps it open with the toast's reason.
  const submit = () => {
    if (busy) return;
    setBusy(true);
    Promise.resolve(onAddUser(form)).then((ok) => {
      setBusy(false);
      if (ok) { setForm((f) => Object.assign({}, f, { name: "", username: "" })); setOpen(false); }
    }, () => setBusy(false));
  };

  // Developers are platform-wide: always shown, under their own heading.
  const visible = devUsers.filter((u) => (orgFilter === "ALL" || u.org === orgFilter || u.role === "developer") && (roleFilter === "ALL" || u.role === roleFilter));
  const roots = visible.filter((u) => u.role === "developer");
  const scoped = visible.filter((u) => u.role !== "developer");
  const byOrg = {};
  scoped.forEach((u) => { (byOrg[u.org] = byOrg[u.org] || []).push(u); });
  const orgName = (code) => (organizations.find((o) => o.code === code) || {}).name || code;

  const UserRow = ({ u, last }) => {
    const controls = (
      <React.Fragment>
        <RoleChip role={u.role} color={roleColors[u.role]} />
        {onImpersonate && u.role !== "developer" && <button onClick={() => onImpersonate(u)} title={"Open " + u.name + "'s portal (root access)"}
          onMouseEnter={(e) => e.currentTarget.style.color = "var(--primary)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: mobile ? "0 12px" : "5px 10px", minHeight: mobile ? 44 : undefined, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-sans)", flex: "none" }}><Icon name="log-in" size={13} />Open portal</button>}
        {onRemoveUser && <button onClick={() => onRemoveUser(u.id)} title="Remove user"
          onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
          style={{ width: mobile ? 44 : 28, height: mobile ? 44 : 28, marginLeft: mobile ? "auto" : undefined, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="trash-2" size={15} /></button>}
      </React.Fragment>
    );
    return (
    <div data-user-row={u.username || u.name} style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", padding: "11px 16px", borderTop: last ? "none" : "1px solid var(--border)" }}>
      <Avatar initials={userInitials(u.name)} size={34} tint="blue" />
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.name}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          {u.specialty ? u.specialty + " · " : ""}<span className="ds-mono">{u.org}</span>{u.username ? <span> · <span className="ds-mono">{u.username}</span></span> : null}
        </div>
      </div>
      {mobile
        ? <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{controls}</div>
        : controls}
    </div>
    );
  };

  return (
    <div style={{ marginTop: 24 }}>
      <SectionTitle action={
        <Button size="sm" variant={open ? "secondary" : "default"} icon={open ? "x" : "user-plus"} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Add user / provider"}
        </Button>
      }>Organizations &amp; user management</SectionTitle>
      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: -8, marginBottom: 12 }}>Manage organizations and their users with role-based access control.</div>

      <RoleColorEditor roleColors={roleColors} onSetRoleColor={window.DT.actions.setRoleColor} />

      {open && (
        <Card style={{ padding: 18, marginBottom: 14 }}>
          <div data-add-user-form>
          {/* Role type */}
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Account type</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {DEV_ROLES.map(([id, label]) => {
              const on = form.role === id;
              return (
                <button key={id} type="button" onClick={() => set("role", id)} aria-pressed={on}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", minHeight: 44, borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13, fontWeight: 500,
                    border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "#EFF6FF" : "#fff", color: on ? "var(--primary)" : "var(--foreground)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: roleColors[id], flex: "none" }} />{label}
                </button>
              );
            })}
          </div>

          {/* There is no single-organization developer: the server gives every
              developer account cross-tenant root (A.CON developer #1). */}
          {isDev ? (
            <div data-developer-scope style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 13px", marginBottom: 14, borderRadius: "var(--radius-md)", border: "1px solid var(--status-pending)", background: "var(--status-pending-bg)", fontSize: 12.5, lineHeight: 1.5 }}>
              <Icon name="crown" size={15} color="var(--status-pending)" style={{ marginTop: 2, flex: "none" }} />
              <span><b>Full access to every organization.</b> A developer account is a platform operator: it can read and change every tenant's settings and people, read each tenant's audit and PHI-access trail, and open any user's portal. There is no developer limited to one organization. The account is created in the platform organization.</span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <DSelect label="Organization" icon="building-2" value={form.org} onChange={(v) => set("org", v)}
                options={organizations.map((o) => ({ value: o.code, label: `${o.name} (${o.code})` }))} />
            </div>
          )}
          <div style={{ display: "flex", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px", minWidth: 0 }}><Field label="Full name" icon="user" value={form.name} onChange={(v) => set("name", v)} placeholder="Dr. Jane Smith" /></div>
            <div style={{ flex: "1 1 160px", minWidth: 0 }}><Field label="Username" icon="at-sign" value={form.username} onChange={(v) => set("username", v)} placeholder="jane.smith"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
              help="What they sign in with (3+ characters). A one-time password is shown once after creating." /></div>
          </div>

          {isClinical && (
            <div style={{ display: "flex", gap: 14, marginBottom: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1.4 1 160px", minWidth: 0 }}><Field label="Specialty" icon="stethoscope" value={form.specialty} onChange={(v) => set("specialty", v)} placeholder="e.g. Cardiology" /></div>
              <div style={{ width: 110 }}><Field label="Patient cap" icon="gauge" value={form.cap} onChange={(v) => set("cap", v)} inputMode="numeric" /></div>
              <DSelect label="Shift type" icon="clock" value={form.shift} onChange={(v) => set("shift", v)}
                options={[{ value: "day", label: "Day" }, { value: "swing", label: "Swing" }, { value: "night", label: "Night" }]} />
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" icon="check" onClick={submit}>{busy ? "Creating…" : isDev ? "Create developer" : "Create account"}</Button>
          </div>
          </div>
        </Card>
      )}

      {/* Filters — dropdowns (wrap on phones; 240 + 200 + count exceed 362px) */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ flex: mobile ? "1 1 150px" : "none", width: mobile ? undefined : 240, minWidth: 0 }}>
          <DSelect label="Organization" icon="building-2" value={orgFilter} onChange={setOrgFilter}
            options={[{ value: "ALL", label: "All organizations" }].concat(organizations.map((o) => ({ value: o.code, label: `${o.name} (${o.code})` })))} />
        </div>
        <div style={{ flex: mobile ? "1 1 130px" : "none", width: mobile ? undefined : 200, minWidth: 0 }}>
          <DSelect label="Role" icon="shield-half" value={roleFilter} onChange={setRoleFilter}
            options={[{ value: "ALL", label: "All roles" }].concat(DEV_ROLES.map(([id, label]) => ({ value: id, label })))} />
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted-foreground)", paddingBottom: 8 }}>
          {visible.length} user{visible.length === 1 ? "" : "s"} shown
        </div>
      </div>

      {devUsersLoaded !== true && (
        <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)", marginBottom: 12 }}>
          {devUsersLoaded === "error" ? "The server didn't return the user list. Reload to try again." : "Loading users…"}
        </Card>
      )}

      {/* Developers — every developer account spans all organizations */}
      {roots.length > 0 && (
        <div data-developers>
        <Card style={{ padding: 0, overflow: "hidden", marginBottom: 12, border: "1px solid var(--primary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 16px", background: "var(--primary-tint, #EFF6FF)", borderBottom: "1px solid var(--border)" }}>
            <Icon name="crown" size={15} color="var(--primary)" />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--primary)" }}>Developers</span>
            <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>· every developer account accesses every organization</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>{roots.length}</span>
          </div>
          {roots.map((u, i) => <UserRow key={u.id} u={u} last={i === roots.length - 1} />)}
        </Card>
        </div>
      )}

      {/* Users grouped by organization — collapsible, color-coded */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Object.keys(byOrg).map((code) => {
          const org = organizations.find((o) => o.code === code) || {};
          const accent = orgColor(code, organizations);
          const isOpen = !collapsed[code];
          const counts = {};
          byOrg[code].forEach((u) => { counts[u.role] = (counts[u.role] || 0) + 1; });
          return (
            <Card key={code} style={{ padding: 0, overflow: "hidden" }}>
              <button onClick={() => setCollapsed((c) => Object.assign({}, c, { [code]: !c[code] }))}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 16px 11px 13px", border: "none", borderLeft: `3px solid ${accent}`, background: isOpen ? tintFor(accent) : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)" }}>
                <Icon name="chevron-right" size={16} color="var(--muted-foreground)" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", flex: "none" }} />
                <span style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", background: accent, color: "#fff", fontWeight: 700, fontSize: 11.5, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{code.slice(0, 2)}</span>
                <div style={{ minWidth: 0, flex: "1 1 0" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.2 }}>{orgName(code)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                    <span className="ds-mono">{code}</span>{org.timezone ? <span>· {org.timezone}</span> : null}
                  </div>
                </div>
                {/* colored per-role summary */}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", justifyContent: "flex-end", flex: "0 1 auto", minWidth: 0 }}>
                  {Object.keys(counts).map((rid) => (
                    <span key={rid} title={ROLE_LABEL[rid]} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: roleColors[rid], flex: "none" }} />{counts[rid]}
                    </span>
                  ))}
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", borderLeft: "1px solid var(--border)", paddingLeft: 9, marginLeft: 2 }}>{byOrg[code].length} user{byOrg[code].length === 1 ? "" : "s"}</span>
                </div>
              </button>
              {isOpen && (() => {
                const sub = {};
                byOrg[code].forEach((u) => { (sub[u.role] = sub[u.role] || []).push(u); });
                const order = DEV_ROLES.map((r) => r[0]).filter((rid) => sub[rid]);
                return order.map((rid) => (
                  <div key={rid}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px 7px 18px", background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: roleColors[rid], flex: "none" }} />
                      <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>{ROLE_LABEL[rid]}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted-foreground)" }}>{sub[rid].length}</span>
                    </div>
                    {sub[rid].map((u, i) => <UserRow key={u.id} u={u} last={i === 0} />)}
                  </div>
                ));
              })()}
            </Card>
          );
        })}
        {devUsersLoaded === true && Object.keys(byOrg).length === 0 && roots.length === 0 && (
          <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No users match these filters.</Card>
        )}
      </div>
    </div>
  );
}

// ---- Feature modules: add / remove product functions per organization ------
// Registry (labels, groups, blurbs, requires) comes from the server; a toggle
// calls DT.actions.setModule → PATCH /api/dev/modules/:orgId. The server's
// moduleGate enforces the switch — this panel is only the control surface.
function ModToggle({ on, disabled, onChange, label }) {
  // 44×44 tap target around the 42×24 track.
  return (
    <button type="button" onClick={() => !disabled && onChange(!on)} role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      style={{ width: 52, height: 44, minWidth: 44, border: "none", background: "transparent", cursor: disabled ? "not-allowed" : "pointer", padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : 1, flex: "none" }}>
      <span style={{ display: "block", width: 42, height: 24, borderRadius: 99, padding: 2, background: on ? "var(--primary)" : "#CBD5E1", transition: "background .15s" }}>
        <span style={{ display: "block", width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transform: on ? "translateX(18px)" : "none", transition: "transform .15s" }} />
      </span>
    </button>
  );
}

function ModulesPanel({ organizations }) {
  const DT = window.DT;
  const st = (DT && DT.getState && DT.getState()) || {};
  const registry = st.moduleRegistry || [];
  const [orgCode, setOrgCode] = React.useState((organizations[0] || {}).code || "");
  const [busy, setBusy] = React.useState({});
  const org = organizations.find((o) => o.code === orgCode) || organizations[0];
  const orgId = org ? org.id : null;
  const map = (st.orgModules || {})[orgId] || null;

  React.useEffect(() => {
    if (!org && organizations.length) setOrgCode(organizations[0].code);
  }, [organizations.length]);
  React.useEffect(() => {
    if (orgId != null && DT && DT.actions.loadOrgModules) DT.actions.loadOrgModules(orgId).catch(() => {});
  }, [orgId]);

  const labelOf = (id) => (registry.find((m) => m.id === id) || {}).label || id;
  const flip = (id, enabled) => {
    if (orgId == null || busy[id]) return;
    setBusy((b) => Object.assign({}, b, { [id]: true }));
    Promise.resolve(DT.actions.setModule(orgId, id, enabled))
      .then(() => DT.actions.toast && DT.actions.toast({ tone: enabled ? "accepted" : "sent", title: (enabled ? "Enabled " : "Disabled ") + labelOf(id), msg: (org && org.name) || orgCode }))
      .catch(() => {})
      .then(() => setBusy((b) => { const n = Object.assign({}, b); delete n[id]; return n; }));
  };

  const groups = [];
  registry.forEach((m) => { let g = groups.find((x) => x.name === m.group); if (!g) { g = { name: m.group, items: [] }; groups.push(g); } g.items.push(m); });
  const onCount = map ? registry.filter((m) => map[m.id] !== false).length : 0;
  const mobile = useIsMobile();
  const orgPicker = (
    <div style={{ width: mobile ? "100%" : 280 }}>
      <DSelect icon="building-2" value={orgCode} onChange={setOrgCode}
        options={organizations.map((o) => ({ value: o.code, label: `${o.name} (${o.code})` }))} />
    </div>
  );

  return (
    <div style={{ marginTop: 24 }}>
      {/* the 280px org picker sits beside the title on desktop, under it on phones */}
      <SectionTitle action={!mobile && orgPicker}>Modules</SectionTitle>
      {mobile && <div style={{ marginBottom: 12 }}>{orgPicker}</div>}
      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: -8, marginBottom: 12 }}>
        Add or remove product functions for one organization with a click. The server enforces every switch — a disabled module's API answers <span className="ds-mono">404 module_disabled</span> and its navigation disappears.
        {map && <span> · <b>{onCount}</b> of {registry.length} on for <span className="ds-mono">{orgCode}</span></span>}
      </div>
      {!registry.length && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading module registry…</Card>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
        {groups.map((g) => (
          <Card key={g.name} style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>{g.name}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted-foreground)" }}>{map ? g.items.filter((m) => map[m.id] !== false).length : "–"}/{g.items.length}</span>
            </div>
            {g.items.map((m, i) => {
              const on = map ? map[m.id] !== false : m.default;
              const missing = (m.requires || []).filter((r) => map && map[r] === false);
              const blocked = missing.length > 0;
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none", opacity: blocked ? 0.6 : 1 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600 }}>
                      {m.label}
                      {on && !blocked ? <Badge status="accepted">On</Badge> : <Badge status="offline">Off</Badge>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, lineHeight: 1.45 }}>{m.blurb}</div>
                    {m.requires && m.requires.length > 0 && (
                      <div style={{ fontSize: 11.5, marginTop: 4, color: blocked ? "var(--status-pending)" : "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 4 }}>
                        <Icon name={blocked ? "alert-triangle" : "link"} size={11} />
                        Requires {m.requires.map(labelOf).join(", ")}{blocked ? " — turn that on first" : ""}
                      </div>
                    )}
                    <div style={{ fontSize: 10.5, marginTop: 3 }} className="ds-mono">{m.id}</div>
                  </div>
                  <ModToggle label={m.label} on={on && !blocked} disabled={!map || blocked || !!busy[m.id]} onChange={(v) => flip(m.id, v)} />
                </div>
              );
            })}
          </Card>
        ))}
      </div>
    </div>
  );
}

// Same locale-aware clock as the rest of the app (A.CON-MIN-18).
function devClock(at) {
  if (window.dtFmt && window.dtFmt.hhmmss) return window.dtFmt.hhmmss(at);
  return new Date(at).toLocaleTimeString();
}

// The default time zone for a new tenant: THIS BROWSER's (the operator's
// device), labelled as such — it says nothing about where the hospital is, and
// no city is derived from it (A.CON developer #22).
function browserTimeZone() {
  let tz = "America/New_York";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
  return tz;
}
function tzOffset(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
    const tzn = parts.find((p) => p.type === "timeZoneName");
    return tzn ? tzn.value : "";
  } catch (e) { return ""; }
}
const TZ_OPTIONS = [["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"]];
function tzSelectOptions(current) {
  const opts = TZ_OPTIONS.map(([v, l]) => ({ value: v, label: l + " · " + v }));
  if (current && !TZ_OPTIONS.some(([v]) => v === current)) opts.unshift({ value: current, label: current });
  return opts;
}

// Process uptime of the instance that answered, e.g. "3d 4h", "2h 14m", "45s".
function fmtUptime(sec) {
  if (sec == null || !isFinite(sec)) return "—";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return d + "d " + h + "h";
  if (h) return h + "h " + m + "m";
  if (m) return m + "m";
  return Math.floor(sec) + "s";
}
// The instance's uptime, ticking from the server's own figure (uptimeSec at
// the moment it answered + the time since, on this device's monotonic clock —
// no server/device clock skew). Only this text re-renders each second.
function LiveUptime({ health }) {
  if (typeof useClock === "function") useClock();
  const extra = health.receivedAt ? Math.max(0, (Date.now() - health.receivedAt) / 1000) : 0;
  return <span data-uptime-sec={Math.floor(health.instance.uptimeSec + extra)}>{fmtUptime(health.instance.uptimeSec + extra)}</span>;
}
const STORAGE_LABEL = { postgres: "PostgreSQL", "pglite-disk": "PGlite (embedded, on disk)", "pglite-memory": "PGlite (embedded, in memory)" };

// System health from GET /api/dev/platform-health — measured on the instance
// that answered; nothing is shown that the server did not report.
function SystemHealthCard({ health, onRefresh }) {
  const mobile = useIsMobile();
  const h = health && !health.error ? health : null;
  const badge = !health ? <Badge status="offline">Checking…</Badge>
    : health.error ? <Badge status="rejected">Unavailable</Badge>
    : h.status === "operational" ? <Badge status="accepted" icon="circle">Operational</Badge>
    : <Badge status="pending" icon="alert-triangle">Degraded</Badge>;
  const row = (label, value, key) => (
    <div data-health={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 12.5, flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>{label}</span>
      <span data-health-value style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{value}</span>
    </div>
  );
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <Icon name="server" size={18} color="var(--primary)" />
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>System health</h3>
        <span data-health-status style={{ marginLeft: "auto" }}>{badge}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 14 }}>
        Measured on the server instance that answered{h ? " · " + devClock(Date.parse(h.checkedAt)) : ""}.
      </div>
      {health && health.error && <div style={{ fontSize: 12.5, color: "var(--destructive)", marginBottom: 10 }}>{health.error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {row("API response time, last 5 min (p50 / p95)", !h ? "—" : h.api.requests ? h.api.p50Ms + " ms / " + h.api.p95Ms + " ms · " + h.api.requests + " req" : "No API requests yet", "api")}
        {h && h.api.serverErrors > 0 && row("Server errors (5xx), last 5 min", h.api.serverErrors, "errors")}
        {row("Live WebSocket connections", !h ? "—" : h.websocket ? h.websocket.connections + " (" + h.websocket.users + " " + (h.websocket.users === 1 ? "person" : "people") + ")" : "Not available on this instance", "ws")}
        {row("Database round trip", !h ? "—" : h.database.ok ? h.database.roundTripMs + " ms · " + (STORAGE_LABEL[h.database.storage] || h.database.storage) : "Unreachable", "db")}
        {h && h.database.pool && <DevHealthBar label={"DB pool in use" + (h.database.pool.waiting ? " · " + h.database.pool.waiting + " waiting" : "")} value={h.database.pool.total - h.database.pool.idle} max={h.database.pool.max} tint={h.database.pool.waiting ? "var(--status-pending)" : "var(--status-accepted)"} />}
        {h && h.issues && h.issues.length > 0 && (
          <div data-health-issues style={{ fontSize: 12.5, color: "var(--status-pending)", lineHeight: 1.45 }}>{h.issues.join(" · ")}</div>
        )}
      </div>
      <div style={{ marginTop: 14 }}>
        <Button size="sm" variant="outline" full icon="refresh-cw" onClick={onRefresh} style={mobile ? { minHeight: 44 } : undefined}>Refresh</Button>
      </div>
    </Card>
  );
}

// Web-powered hospital autocomplete (DocTurn live): type a fragment, get the
// official name + city/state/timezone + a suggested code from /api/dev/org-lookup.
function OrgAutocomplete({ value, onText, onPick }) {
  const [items, setItems] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef(null);
  function change(v) {
    onText(v);
    clearTimeout(timer.current);
    if (!v || v.trim().length < 2) { setItems([]); setOpen(false); return; }
    timer.current = setTimeout(function () {
      fetch("/api/dev/org-lookup?q=" + encodeURIComponent(v), { credentials: "include" })
        .then(function (r) { return r.json(); })
        .then(function (d) { setItems(Array.isArray(d) ? d : []); setOpen(true); })
        .catch(function () { setItems([]); });
    }, 250);
  }
  return (
    <div style={{ position: "relative" }}>
      <Field label="Hospital name" icon="building-2" value={value} onChange={change}
        placeholder="Start typing — e.g. Cedars Sinai"
        help="Auto-completes the official name + location from the web." />
      {open && items.length > 0 && (
        <div style={{ position: "absolute", zIndex: 70, left: 0, right: 0, top: 72, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)", maxHeight: 240, overflowY: "auto" }}>
          {items.map(function (it, i) {
            return (
              <button key={i} type="button" onClick={function () { onPick(it); setOpen(false); }}
                style={{ display: "flex", width: "100%", textAlign: "left", gap: 10, alignItems: "center", padding: "9px 12px", border: "none", borderTop: i ? "1px solid var(--border)" : "none", background: "#fff", cursor: "pointer" }}>
                <Icon name="building-2" size={15} color="var(--primary)" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{it.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)" }}>{[it.city, it.state].filter(Boolean).join(", ")}{it.code ? " · " + it.code : ""}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Irreversible-delete guard: the operator types the org name to confirm before
// the tenant (and all its cascaded data) is removed. Same safety pattern as the
// per-org Settings danger zone, surfaced here on the Organizations list so a
// developer can actually delete a tenant from where they see them.
function DeleteOrgModal({ org, onClose, onConfirm }) {
  const [typed, setTyped] = React.useState("");
  const [status, setStatus] = React.useState(null); // null | "deleting" | error string
  const match = typed.trim().toLowerCase() === (org.name || "").trim().toLowerCase();
  function doDelete() {
    if (!match || status === "deleting") return;
    setStatus("deleting");
    Promise.resolve(onConfirm(org))
      .then(function () { onClose(); })
      .catch(function (e) { setStatus((e && e.message) || "Delete failed."); });
  }
  return (
    <Modal title="Delete organization" subtitle={"Permanently remove " + org.name + " and everything in it."} icon="alert-triangle" width={480} onClose={onClose}
      children={
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "var(--status-rejected-bg)", border: "1px solid var(--destructive)", borderRadius: "var(--radius-md)", padding: 13, fontSize: 12.5, lineHeight: 1.5, color: "var(--foreground)" }}>
            This permanently deletes every user, patient, message and assignment in <b>{org.name}</b> (<span className="ds-mono">{org.code}</span>). It cannot be undone.
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Type the organization name to confirm</label>
            <Field icon="building-2" value={typed} onChange={setTyped} placeholder={org.name} />
          </div>
          {typeof status === "string" && status !== "deleting" && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-rejected-bg)", border: "1px solid var(--destructive)", color: "var(--destructive)", fontSize: 12.5 }}>
              <Icon name="alert-triangle" size={15} style={{ marginTop: 1, flex: "none" }} /><span>{status}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" icon="trash-2" onClick={doDelete}
              style={{ background: "var(--destructive)", borderColor: "var(--destructive)", opacity: match && status !== "deleting" ? 1 : 0.5, pointerEvents: match && status !== "deleting" ? "auto" : "none" }}>
              {status === "deleting" ? "Deleting…" : "Delete organization"}
            </Button>
          </div>
        </div>
      } />
  );
}

function DeveloperDashboard({ organizations, devUsers, roleColors, diagnostics, onSelectOrg, onManageOrg, onAddUser, onRemoveUser, onSetRoleColor, onAddTenant, onDeleteTenant, onDiagnostics, onImpersonate }) {
  const st = useStore();
  const [query, setQuery] = React.useState("");
  const [newTenant, setNewTenant] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [delOrg, setDelOrg] = React.useState(null); // org pending type-to-confirm delete
  const browserTz = React.useMemo(browserTimeZone, []);
  // tzSource: "browser" (this device's default), "lookup" (the hospital
  // lookup's), "manual" (picked). city/state only ever come from the lookup.
  const blankTenant = () => ({ name: "", code: "", timezone: browserTz, tzSource: "browser", city: null, state: null });
  const [tform, setTform] = React.useState(blankTenant);
  const orgsLoaded = st.orgsLoaded;
  const health = st.platformHealth;
  const loadHealth = () => { if (window.DT && window.DT.actions.loadPlatformHealth) window.DT.actions.loadPlatformHealth(); };
  React.useEffect(() => { loadHealth(); }, []);
  // Phone layout: KPI tiles 2-up, grid columns allowed to shrink (minWidth 0),
  // and each organization row is two lines (identity, then status + actions)
  // so Config/Manage/Delete stay inside the viewport.
  const mobile = useIsMobile();
  // The developer's own tenant can't be deleted (it holds their session); the
  // server refuses it too. Hide the action for that row.
  const myOrgCode = String((((window.DT && window.DT.getState()) || {}).session || {}).org || "").toUpperCase();
  const orgs = organizations.filter((o) =>
    o.name.toLowerCase().includes(query.toLowerCase()) || o.code.toLowerCase().includes(query.toLowerCase()));

  const loaded = orgsLoaded === true;
  const totalUsers = organizations.reduce((a, o) => a + (o.users || 0), 0);
  const assignKnown = loaded && organizations.every((o) => typeof o.assignments === "number");
  const totalAssign = organizations.reduce((a, o) => a + (o.assignments || 0), 0);
  const hOk = health && !health.error ? health : null;
  const TILES = [
    ["Organizations", loaded ? organizations.length : "—", "building-2", "blue", null],
    ["Total users", loaded ? totalUsers : "—", "users", "emerald", null],
    ["Assignments / 24h", assignKnown ? totalAssign : "—", "clipboard-list", "amber", "created, all organizations"],
    ["Server uptime", hOk ? <LiveUptime health={hOk} /> : "—", "activity", "slate", "this instance, since it started"],
  ];

  return (
    <PageWrap>
      {/* Cross-tenant banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 18, borderRadius: "var(--radius-md)", background: "#1E293B", color: "#fff" }}>
        <Icon name="globe" size={16} color="#7DD3FC" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Platform operator — full cross-tenant access</span>
        <span style={{ fontSize: 12, color: "#94A3B8" }}>Changes made here, and every read of a tenant's data, are recorded in the server's audit trail.</span>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
        {TILES.map(([label, value, icon, tint, sub]) => (
          // Phones: 2-up tiles; desktop: one row.
          <div key={label} data-tile={label} style={mobile ? { flex: "1 1 calc(50% - 7px)", minWidth: 0, display: "flex" } : { flex: 1, minWidth: 0, display: "flex" }}>
            <StatTile label={label} value={value} icon={icon} tint={tint} sub={sub} />
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Organizations table — minWidth:0 lets the 1fr column actually shrink on phones */}
        <div style={{ minWidth: 0 }}>
          <SectionTitle action={<Button size="sm" variant="default" icon="plus" onClick={() => setNewTenant(true)}>New tenant</Button>}>Organizations</SectionTitle>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
              <Field icon="search" value={query} onChange={setQuery} placeholder="Search by name or code…" />
            </div>
            {!loaded && (
              <div data-orgs-state style={{ padding: 24, textAlign: "center", fontSize: 13, color: orgsLoaded === "error" ? "var(--destructive)" : "var(--muted-foreground)" }}>
                {orgsLoaded === "error" ? "The server didn't return the organization list. Reload to try again." : "Loading organizations…"}
              </div>
            )}
            {loaded && orgs.length === 0 && (
              <div data-orgs-state style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>{organizations.length ? "No organization matches." : "No organizations yet — create the first tenant."}</div>
            )}
            {orgs.map((o, i) => {
              const actions = (
                <React.Fragment>
                  {/* Config = per-org rules; Manage = enter the org's full portal */}
                  <Button size="sm" variant="outline" icon="sliders-horizontal" onClick={() => onSelectOrg && onSelectOrg(o)}>Config</Button>
                  <Button size="sm" icon="log-in" onClick={() => onManageOrg && onManageOrg(o)}>Manage</Button>
                  {onDeleteTenant && o.code.toUpperCase() !== myOrgCode && (
                    <Button size="sm" variant="ghost" icon="trash-2" title={"Delete " + o.name}
                      style={{ color: "var(--destructive)", marginLeft: mobile ? "auto" : undefined }} onClick={() => setDelOrg(o)} />
                  )}
                </React.Fragment>
              );
              return (
              <div key={o.code} data-org-row={o.code}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", padding: "13px 16px", borderTop: i ? "1px solid var(--border)" : "none", transition: "background .12s" }}>
                <span style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", background: "#DBEAFE", color: "var(--primary-ink, #1D4ED8)", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {o.code.slice(0, 2)}
                </span>
                <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{o.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="ds-mono">{o.code}</span><span>·</span><span>{[o.city, o.state].filter(Boolean).join(", ") || o.timezone}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", marginRight: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{o.users}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>users</div>
                </div>
                {/* Desktop: status + actions inline. Phone: a wrapping second line. */}
                {mobile
                  ? <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{actions}</div>
                  : actions}
              </div>
              );
            })}
          </Card>
        </div>

        {/* Right column: system health, AI monitor */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <SystemHealthCard health={health} onRefresh={loadHealth} />

          <Card style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Icon name="sparkles" size={18} color="var(--medical-secondary)" />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>AI monitor</h3>
            </div>
            {/* Nothing is claimed until the server has been asked (A.CON developer #17). */}
            <div data-ai-monitor style={{ fontSize: 13, lineHeight: 1.55, color: "var(--foreground)", background: "var(--secondary)", borderRadius: "var(--radius-md)", padding: "11px 13px" }}>
              {diagnostics
                ? <span><span style={{ fontWeight: 600 }}>Last check{diagnostics.at ? " (" + devClock(diagnostics.at) + ")" : ""}:</span> {diagnostics.text}</span>
                : <span style={{ color: "var(--muted-foreground)" }}>Not checked yet. Diagnostics run the AI intake extractor on this server with a built-in sample note and report which extractor answered.</span>}
            </div>
            <div style={{ marginTop: 12 }}>
              <Button size="sm" variant="outline" full icon="stethoscope" onClick={onDiagnostics}>Run AI diagnostics</Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Feature modules — add/remove functions per org with a click */}
      <ModulesPanel organizations={organizations} />

      {/* Organizations & user management */}
      <AddUserPanel organizations={organizations} devUsers={devUsers} devUsersLoaded={st.devUsersLoaded} roleColors={roleColors} onAddUser={onAddUser} onRemoveUser={onRemoveUser} onImpersonate={onImpersonate} />

      {/* System logs now live in the consolidated Compliance menu */}
      {delOrg && <DeleteOrgModal org={delOrg} onClose={() => setDelOrg(null)} onConfirm={onDeleteTenant} />}
      {newTenant && (
        <Modal title="New organization" subtitle="Provision a new hospital tenant. Data is isolated by organizationId." icon="building-2" onClose={() => setNewTenant(false)}
          children={
            <div data-new-tenant style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <OrgAutocomplete value={tform.name}
                onText={(v) => setTform({ ...tform, name: v, city: null, state: null, tzSource: tform.tzSource === "lookup" ? "browser" : tform.tzSource, timezone: tform.tzSource === "lookup" ? browserTz : tform.timezone })}
                onPick={(it) => setTform({ ...tform, name: it.name, code: it.code || tform.code, timezone: it.timezone || tform.timezone, tzSource: it.timezone ? "lookup" : tform.tzSource, city: it.city || null, state: it.state || null })} />
              {(tform.city || tform.state) && (
                <div data-tenant-location style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted-foreground)" }}>
                  <Icon name="map-pin" size={14} color="var(--primary)" />
                  <span>Location from the hospital lookup: <b style={{ color: "var(--foreground)" }}>{[tform.city, tform.state].filter(Boolean).join(", ")}</b> — saved with the organization.</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ width: 150 }}><Field label="Short code" icon="hash" value={tform.code} onChange={(v) => setTform({ ...tform, code: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) })} placeholder="RIVER" help="A–Z, ≤6" /></div>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <DSelect label="Time zone" icon="globe" value={tform.timezone} onChange={(v) => setTform({ ...tform, timezone: v, tzSource: "manual" })} options={tzSelectOptions(tform.timezone)} />
                  <div data-tz-source style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 5 }}>
                    {tform.tzSource === "browser" ? "This browser's time zone" + (tzOffset(tform.timezone) ? " (" + tzOffset(tform.timezone) + ")" : "") + " — change it if the hospital is elsewhere."
                      : tform.tzSource === "lookup" ? "From the hospital lookup."
                      : "Chosen by you."}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button variant="outline" size="sm" onClick={() => setNewTenant(false)}>Cancel</Button>
                <Button size="sm" icon="check" onClick={() => {
                  if (creating) return;
                  if (!tform.name.trim()) { window.DT.actions.toast({ tone: "rejected", title: "Name required", msg: "Enter a hospital name." }); return; }
                  setCreating(true);
                  // Closes only once the server created the tenant.
                  Promise.resolve(onAddTenant(tform)).then((ok) => { setCreating(false); if (ok !== false) { setTform(blankTenant()); setNewTenant(false); } }, () => setCreating(false));
                }}>{creating ? "Creating…" : "Create tenant"}</Button>
              </div>
            </div>
          } />
      )}
    </PageWrap>
  );
}

Object.assign(window, { DeveloperDashboard });
