/* DocTurn web-app UI kit — Developer portal (cross-tenant administration).
   Spec: Eng §10.2 (developer dashboard), Req FR-10.1/10.2, FR-9.2 (AI monitor).
   Full control: cross-tenant orgs, system health, logs, AND user/specialist
   provisioning into any tenant by role type. */

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 40, border: "1px solid var(--input)", borderRadius: "var(--radius-md)", background: "#fff" }}>
        {icon && <Icon name={icon} size={16} color="var(--muted-foreground)" />}
        <select value={value} onChange={(e) => onChange(e.target.value)}
          style={{ border: "none", outline: "none", background: "transparent", fontSize: 14, fontFamily: "inherit", width: "100%", color: "var(--foreground)", cursor: "pointer" }}>
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

function RoleChip({ role, color, scope }) {
  const isRoot = role === "developer" && scope === "root";
  const label = isRoot ? "Root Developer" : (role === "developer" ? "Local Developer" : ROLE_LABEL[role] || role);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 8px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, color: color, background: (color || "#888") + "18", border: "1px solid " + (color || "#888") + "33", whiteSpace: "nowrap" }}>
      {isRoot ? <Icon name="crown" size={11} color={color} /> : <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flex: "none" }} />}{label}
    </span>
  );
}

function RoleColorEditor({ roleColors, onSetRoleColor }) {
  const [openRole, setOpenRole] = React.useState(null);
  return (
    <Card style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon name="palette" size={16} color="var(--primary)" />
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Role colors</h3>
        <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>· customize how each role appears across portals</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
        {DEV_ROLES.map(([id, label]) => (
          <div key={id} style={{ position: "relative" }}>
            <button onClick={() => setOpenRole(openRole === id ? null : id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 11px", borderRadius: "var(--radius-md)", cursor: "pointer", border: "1px solid var(--border)", background: "#fff", fontFamily: "var(--font-sans)" }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: roleColors[id], flex: "none" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              <Icon name="chevron-down" size={13} color="var(--muted-foreground)" />
            </button>
            {openRole === id && (
              <React.Fragment>
                <div onClick={() => setOpenRole(null)} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 31, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", padding: 10, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7, width: 168 }}>
                  {ROLE_SWATCHES.map((c) => (
                    <button key={c} onClick={() => { onSetRoleColor(id, c); setOpenRole(null); }}
                      style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", background: c, cursor: "pointer", border: roleColors[id] === c ? "2px solid var(--foreground)" : "2px solid transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
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

function AddUserPanel({ organizations, devUsers = [], roleColors, onAddUser, onRemoveUser, onImpersonate }) {
  const [open, setOpen] = React.useState(false);
  const [orgFilter, setOrgFilter] = React.useState("ALL");
  const [roleFilter, setRoleFilter] = React.useState("ALL");
  const [collapsed, setCollapsed] = React.useState({});
  const [form, setForm] = React.useState({ org: (organizations[0] || {}).code || "", role: "hospitalist", name: "", email: "", specialty: "Hospital Medicine", cap: "15", shift: "rounding", scope: "local" });
  const set = (k, v) => setForm((f) => Object.assign({}, f, (function () { var o = {}; o[k] = v; return o; })()));
  const isClinical = form.role === "hospitalist";
  const isDev = form.role === "developer";
  const isRoot = isDev && form.scope === "root";

  const submit = () => {
    onAddUser(form);
    if (form.name.trim()) { setForm((f) => Object.assign({}, f, { name: "", email: "" })); setOpen(false); }
  };

  const visible = devUsers.filter((u) => (orgFilter === "ALL" || u.org === orgFilter || u.org === "*") && (roleFilter === "ALL" || u.role === roleFilter));
  const roots = visible.filter((u) => u.org === "*");
  const scoped = visible.filter((u) => u.org !== "*");
  const byOrg = {};
  scoped.forEach((u) => { (byOrg[u.org] = byOrg[u.org] || []).push(u); });
  const orgName = (code) => (organizations.find((o) => o.code === code) || {}).name || code;

  const UserRow = ({ u, last }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 16px", borderTop: last ? "none" : "1px solid var(--border)" }}>
      <Avatar initials={userInitials(u.name)} size={34} tint="blue" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.name}</div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          {u.specialty ? u.specialty + " · " : ""}<span className="ds-mono">{u.org === "*" ? "all orgs" : u.org}</span>
        </div>
      </div>
      <RoleChip role={u.role} color={roleColors[u.role]} scope={u.scope} />
      {onImpersonate && u.role !== "developer" && <button onClick={() => onImpersonate(u)} title={"Open " + u.name + "'s portal (root access)"}
        onMouseEnter={(e) => e.currentTarget.style.color = "var(--primary)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-sans)", flex: "none" }}><Icon name="log-in" size={13} />Open portal</button>}
      {onRemoveUser && <button onClick={() => onRemoveUser(u.id)} title="Remove user"
        onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
        style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="trash-2" size={15} /></button>}
    </div>
  );

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
          {/* Role type */}
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Account type</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {DEV_ROLES.map(([id, label]) => {
              const on = form.role === id;
              return (
                <button key={id} onClick={() => set("role", id)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13, fontWeight: 500,
                    border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "#EFF6FF" : "#fff", color: on ? "var(--primary)" : "var(--foreground)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: roleColors[id], flex: "none" }} />{label}
                </button>
              );
            })}
          </div>

          {isDev && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Developer scope</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["local", "Local developer", "key-round", "Scoped to one organization"], ["root", "Root developer", "crown", "Full access to all organizations"]].map(([id, label, icon, desc]) => {
                  const on = form.scope === id;
                  return (
                    <button key={id} onClick={() => set("scope", id)}
                      style={{ flex: 1, textAlign: "left", padding: "11px 13px", borderRadius: "var(--radius-md)", cursor: "pointer",
                        border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "#EFF6FF" : "#fff", fontFamily: "var(--font-sans)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600, color: on ? "var(--primary)" : "var(--foreground)" }}><Icon name={icon} size={14} />{label}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!isRoot && (
            <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <DSelect label="Organization" icon="building-2" value={form.org} onChange={(v) => set("org", v)}
                options={organizations.map((o) => ({ value: o.code, label: `${o.name} (${o.code})` }))} />
            </div>
          )}
          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <div style={{ flex: 1 }}><Field label="Full name" icon="user" value={form.name} onChange={(v) => set("name", v)} placeholder="Dr. Jane Smith" /></div>
            <div style={{ flex: 1 }}><Field label="Email" icon="mail" value={form.email} onChange={(v) => set("email", v)} placeholder="jane@hospital.com" /></div>
          </div>

          {isClinical && (
            <div style={{ display: "flex", gap: 14, marginBottom: 16, alignItems: "flex-end" }}>
              <div style={{ flex: 1.4 }}><Field label="Specialty" icon="stethoscope" value={form.specialty} onChange={(v) => set("specialty", v)} placeholder="e.g. Cardiology" /></div>
              <div style={{ width: 110 }}><Field label="Patient cap" icon="gauge" value={form.cap} onChange={(v) => set("cap", v)} /></div>
              <DSelect label="Shift type" icon="clock" value={form.shift} onChange={(v) => set("shift", v)}
                options={[{ value: "rounding", label: "Rounding" }, { value: "swing", label: "Swing" }, { value: "nocturnist", label: "Nocturnist" }]} />
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" icon="check" onClick={submit}>Create account</Button>
          </div>
        </Card>
      )}

      {/* Filters — dropdowns */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 240 }}>
          <DSelect label="Organization" icon="building-2" value={orgFilter} onChange={setOrgFilter}
            options={[{ value: "ALL", label: "All organizations" }].concat(organizations.map((o) => ({ value: o.code, label: `${o.name} (${o.code})` })))} />
        </div>
        <div style={{ width: 200 }}>
          <DSelect label="Role" icon="shield-half" value={roleFilter} onChange={setRoleFilter}
            options={[{ value: "ALL", label: "All roles" }].concat(DEV_ROLES.map(([id, label]) => ({ value: id, label })))} />
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted-foreground)", paddingBottom: 8 }}>
          {visible.length} user{visible.length === 1 ? "" : "s"} shown
        </div>
      </div>

      {/* Root developers — span all orgs */}
      {roots.length > 0 && (
        <Card style={{ padding: 0, overflow: "hidden", marginBottom: 12, border: "1px solid var(--primary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "var(--primary-tint, #EFF6FF)", borderBottom: "1px solid var(--border)" }}>
            <Icon name="crown" size={15} color="var(--primary)" />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--primary)" }}>Root developers</span>
            <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>· access every organization</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>{roots.length}</span>
          </div>
          {roots.map((u, i) => <UserRow key={u.id} u={u} last={i === roots.length - 1} />)}
        </Card>
      )}

      {/* Users grouped by organization — collapsible, color-coded */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Object.keys(byOrg).map((code) => {
          const org = organizations.find((o) => o.code === code) || { active: true };
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
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.2 }}>{orgName(code)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                    <span className="ds-mono">{code}</span>·{org.active ? <span style={{ color: "var(--status-accepted)", fontWeight: 600 }}>Active</span> : <span style={{ color: "var(--status-neutral)", fontWeight: 600 }}>Suspended</span>}
                  </div>
                </div>
                {/* colored per-role summary */}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7 }}>
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
        {Object.keys(byOrg).length === 0 && roots.length === 0 && (
          <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No users match these filters.</Card>
        )}
      </div>
    </div>
  );
}

function devClock(at) {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

// Auto-detect the hospital's location from the browser environment.
function detectLocation() {
  let tz = "America/New_York";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
  const city = tz.split("/").pop().replace(/_/g, " ");
  let offset = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
    const tzn = parts.find((p) => p.type === "timeZoneName");
    if (tzn) offset = tzn.value;
  } catch (e) {}
  return { timezone: tz, city: city, offset: offset };
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

function DeveloperDashboard({ organizations, devUsers, roleColors, diagnostics, audit = [], onSelectOrg, onManageOrg, onAddUser, onRemoveUser, onSetRoleColor, onAddTenant, onToggleTenant, onDeleteTenant, onDiagnostics, onImpersonate }) {
  const [query, setQuery] = React.useState("");
  const [newTenant, setNewTenant] = React.useState(false);
  const detected = React.useMemo(detectLocation, []);
  const [tform, setTform] = React.useState({ name: "", code: "", timezone: detected.timezone, autoLoc: true });
  const orgs = organizations.filter((o) =>
    o.name.toLowerCase().includes(query.toLowerCase()) || o.code.toLowerCase().includes(query.toLowerCase()));

  const totalUsers = organizations.reduce((a, o) => a + o.users, 0);
  const totalAssign = organizations.reduce((a, o) => a + o.assignments, 0);

  const LEVEL = {
    info:  { c: "var(--status-active)",   bg: "var(--status-active-bg)",   ic: "info" },
    warn:  { c: "var(--status-pending)",  bg: "var(--status-pending-bg)",  ic: "alert-triangle" },
    error: { c: "var(--status-rejected)", bg: "var(--status-rejected-bg)", ic: "x-octagon" },
    audit: { c: "var(--status-neutral)",  bg: "var(--status-neutral-bg)",  ic: "shield" },
  };
  const levelFor = (r) => r.risk === "high" ? "error" : r.risk === "medium" ? "warn" : (/login|logout|access|impersonat|audit/.test(r.action) ? "audit" : "info");
  const LOGS = audit.slice(0, 8).map((r) => ({ t: devClock(r.at), level: levelFor(r), org: r.org || "MAYO", msg: r.action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) + " — " + r.resource, risk: r.risk }));

  return (
    <PageWrap>
      {/* Cross-tenant banner */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 18, borderRadius: "var(--radius-md)", background: "#1E293B", color: "#fff" }}>
        <Icon name="globe" size={16} color="#7DD3FC" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Platform operator — full cross-tenant access</span>
        <span style={{ fontSize: 12, color: "#94A3B8" }}>Every action on this surface is audited.</span>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
        <StatTile label="Organizations" value={organizations.length} icon="building-2" tint="blue" />
        <StatTile label="Total users" value={totalUsers} icon="users" tint="emerald" />
        <StatTile label="Assignments / 24h" value={totalAssign} icon="clipboard-list" tint="amber" />
        <StatTile label="Uptime (30d)" value="99.98%" icon="activity" tint="slate" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Organizations table */}
        <div>
          <SectionTitle action={<Button size="sm" variant="default" icon="plus" onClick={() => setNewTenant(true)}>New tenant</Button>}>Organizations</SectionTitle>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
              <Field icon="search" value={query} onChange={setQuery} placeholder="Search by name or code…" />
            </div>
            {orgs.map((o, i) => (
              <div key={o.code}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 16px", borderTop: i ? "1px solid var(--border)" : "none", transition: "background .12s" }}>
                <span style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", background: o.active ? "#DBEAFE" : "var(--status-neutral-bg)", color: o.active ? "var(--primary)" : "var(--status-neutral)", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {o.code.slice(0, 2)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{o.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", display: "flex", gap: 8 }}>
                    <span className="ds-mono">{o.code}</span><span>·</span><span>{[o.city, o.state].filter(Boolean).join(", ") || o.timezone}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", marginRight: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{o.users}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>users</div>
                </div>
                {o.active ? <Badge status="accepted">Active</Badge> : <Badge status="offline">Suspended</Badge>}
                {/* Config = per-org rules/permissions; Manage = enter the org's full portal */}
                <Button size="sm" variant="outline" icon="sliders-horizontal" onClick={() => onSelectOrg && onSelectOrg(o)}>Config</Button>
                <Button size="sm" icon="log-in" onClick={() => onManageOrg && onManageOrg(o)}>Manage</Button>
              </div>
            ))}
          </Card>
        </div>

        {/* Right column: system health, AI monitor */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Card style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Icon name="server" size={18} color="var(--primary)" />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>System health</h3>
              <span style={{ marginLeft: "auto" }}><Badge status="accepted" icon="circle">Operational</Badge></span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <DevHealthBar label="API latency budget" value={142} max={500} tint="var(--status-accepted)" />
              <DevHealthBar label="WebSocket connections" value={1284} max={2000} tint="var(--primary)" />
              <DevHealthBar label="DB pool" value={36} max={50} tint="var(--status-pending)" />
            </div>
          </Card>

          <Card style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Icon name="sparkles" size={18} color="var(--medical-secondary)" />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>AI monitor</h3>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--foreground)", background: "var(--secondary)", borderRadius: "var(--radius-md)", padding: "11px 13px" }}>
              <span style={{ fontWeight: 600 }}>Insight:</span> {diagnostics ? diagnostics.text : "STJUDE assignment expiry rate up 18% this shift — likely the delayed Twilio queue. Suggest enabling push-first fallback."}
            </div>
            <div style={{ marginTop: 12 }}>
              <Button size="sm" variant="outline" full icon="stethoscope" onClick={onDiagnostics}>Run AI diagnostics</Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Organizations & user management */}
      <AddUserPanel organizations={organizations} devUsers={devUsers} roleColors={roleColors} onAddUser={onAddUser} onRemoveUser={onRemoveUser} onImpersonate={onImpersonate} />

      {/* System logs now live in the consolidated Compliance menu */}
      {newTenant && (
        <Modal title="New organization" subtitle="Provision a new hospital tenant. Data is isolated by organizationId." icon="building-2" onClose={() => setNewTenant(false)}
          children={
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <OrgAutocomplete value={tform.name}
                onText={(v) => setTform({ ...tform, name: v })}
                onPick={(it) => setTform({ ...tform, name: it.name, code: it.code || tform.code, timezone: it.timezone || tform.timezone, city: it.city, state: it.state, autoLoc: false })} />
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 150 }}><Field label="Short code" icon="hash" value={tform.code} onChange={(v) => setTform({ ...tform, code: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) })} placeholder="RIVER" help="A–Z, ≤6" /></div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                    Location
                    {tform.autoLoc && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: "var(--radius-full)", background: "var(--status-accepted-bg)", color: "var(--status-accepted)", fontSize: 11, fontWeight: 700 }}><Icon name="locate-fixed" size={11} />Auto-detected</span>}
                  </label>
                  {tform.autoLoc ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 40, padding: "0 12px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", background: "var(--secondary)" }}>
                      <Icon name="map-pin" size={15} color="var(--primary)" />
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{detected.city}<span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}>{detected.offset ? "  ·  " + detected.offset : ""}</span></span>
                      <button onClick={() => setTform({ ...tform, autoLoc: false })} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--primary)", fontFamily: "var(--font-sans)", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="pencil" size={12} />Change</button>
                    </div>
                  ) : (
                    <DSelect value={tform.timezone} onChange={(v) => setTform({ ...tform, timezone: v })} icon="globe"
                      options={[{ value: "America/New_York", label: "Eastern · America/New_York" }, { value: "America/Chicago", label: "Central · America/Chicago" }, { value: "America/Denver", label: "Mountain · America/Denver" }, { value: "America/Los_Angeles", label: "Pacific · America/Los_Angeles" }, { value: "America/Phoenix", label: "Arizona · America/Phoenix" }, { value: "America/Anchorage", label: "Alaska · America/Anchorage" }, { value: "Pacific/Honolulu", label: "Hawaii · Pacific/Honolulu" }]} />
                  )}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button variant="outline" size="sm" onClick={() => setNewTenant(false)}>Cancel</Button>
                <Button size="sm" icon="check" onClick={() => { if (tform.name.trim()) { onAddTenant(tform); setTform({ name: "", code: "", timezone: detected.timezone, autoLoc: true }); setNewTenant(false); } else window.DT.actions.toast({ tone: "rejected", title: "Name required", msg: "Enter a hospital name." }); }}>Create tenant</Button>
              </div>
            </div>
          } />
      )}
    </PageWrap>
  );
}

Object.assign(window, { DeveloperDashboard });
