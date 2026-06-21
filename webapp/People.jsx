/* DocTurn web-app UI kit — People management (Hospitalist Director & ER Director).
   The org-scoped counterpart to the Developer's cross-tenant panel: a tidy,
   color-coded roster of everyone in the director's organization, grouped by
   role with collapsible sections, dropdown filters, and add/remove. */

const PEOPLE_ROLES = [
  ["hospitalist", "Hospitalist", "stethoscope"],
  ["consultant", "Consultant (PA/NP)", "user-round"],
  ["er_doctor", "ER physician", "ambulance"],
  ["er_director", "ER director", "siren"],
  ["director", "Hospitalist director", "clipboard-list"],
];
const PEOPLE_ROLE_LABEL = Object.fromEntries(PEOPLE_ROLES.map((r) => [r[0], r[1]]));

// Midlevels (PA/NP/RN) are real users with a clinical role + a credential; we
// surface them as their own "consultant" category so directors can add and see
// them apart from the attending physicians.
const MIDLEVEL_CREDS = { PA: 1, NP: 1, RN: 1 };
function personCategory(u) { return MIDLEVEL_CREDS[u.credential] ? "consultant" : u.role; }

function peopleInitials(name) {
  return name.replace(/\(root\)/i, "").replace(/^Dr\.?\s*/, "").trim().split(/[\s,]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function PersonRoleChip({ role, color }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 8px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, color: color, background: (color || "#888") + "18", border: "1px solid " + (color || "#888") + "33", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flex: "none" }} />{PEOPLE_ROLE_LABEL[role] || role}
    </span>
  );
}

function PeopleManager({ scopeOrg, domainRoles }) {
  const st = useStore();
  const a = useActions();
  const roleColors = st.roleColors;
  const orgName = (st.orgs.find((o) => o.code === scopeOrg) || {}).name || scopeOrg;

  // Which roles this director may see & add. Hospitalist director → hospitalist
  // group; ER director → ER group. Falls back to everything.
  const allowed = (domainRoles && domainRoles.length) ? domainRoles : PEOPLE_ROLES.map((r) => r[0]);
  const domainList = PEOPLE_ROLES.filter((r) => allowed.includes(r[0]));

  const [open, setOpen] = React.useState(false);
  const [roleFilter, setRoleFilter] = React.useState("ALL");
  const [collapsed, setCollapsed] = React.useState({});
  const [form, setForm] = React.useState({ name: "", email: "", role: allowed[0], specialty: "Hospital Medicine", credential: "NP", org: scopeOrg, scope: "local" });
  const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));

  const users = st.devUsers.filter((u) => u.org === scopeOrg && allowed.includes(personCategory(u)) && (roleFilter === "ALL" || personCategory(u) === roleFilter));
  const byRole = {};
  users.forEach((u) => { const c = personCategory(u); (byRole[c] = byRole[c] || []).push(u); });
  const orderedRoles = domainList.map((r) => r[0]).filter((rid) => byRole[rid]);

  const submit = () => {
    if (!form.name.trim()) { a.toast({ tone: "rejected", title: "Name required", msg: "Enter the person's full name." }); return; }
    // A consultant is a midlevel: a clinical (hospitalist) account distinguished
    // by its PA/NP credential rather than a separate role.
    const payload = form.role === "consultant"
      ? Object.assign({}, form, { role: "hospitalist", credential: form.credential, specialty: form.specialty || form.credential })
      : Object.assign({}, form, { credential: "" });
    a.addUser(Object.assign({}, payload, { org: scopeOrg }));
    setForm((f) => Object.assign({}, f, { name: "", email: "" }));
    setOpen(false);
  };

  return (
    <PageWrap>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>People</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Manage everyone in {orgName} with role-based access control.</div>
        </div>
        <Button size="sm" variant={open ? "secondary" : "default"} icon={open ? "x" : "user-plus"} onClick={() => setOpen(!open)}>{open ? "Close" : "Add person"}</Button>
      </div>

      {/* stat row — calm: neutral tiles, single accent dot */}
      <div style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        {domainList.map(([rid, label, icon]) => {
          const n = st.devUsers.filter((u) => u.org === scopeOrg && personCategory(u) === rid).length;
          return (
            <Card key={rid} style={{ padding: 14, flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", background: "var(--secondary)", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={icon} size={15} /></span>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 500, lineHeight: 1.2 }}>{label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: roleColors[rid], flex: "none" }} />
                <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>{n}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* add form */}
      {open && (
        <Card style={{ padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Role</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {domainList.map(([id, label, icon]) => {
              const on = form.role === id;
              return (
                <button key={id} onClick={() => set("role", id)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)",
                    border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "var(--primary-tint, #EFF6FF)" : "#fff", color: on ? "var(--primary)" : "var(--foreground)" }}>
                  <Icon name={icon} size={15} />{label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
            <div style={{ flex: 1 }}><Field label="Full name" icon="user" value={form.name} onChange={(v) => set("name", v)} placeholder="Dr. Jane Smith" /></div>
            <div style={{ flex: 1 }}><Field label="Email" icon="mail" value={form.email} onChange={(v) => set("email", v)} placeholder="jane@hospital.com" /></div>
          </div>
          {form.role === "hospitalist" && (
            <div style={{ marginBottom: 16 }}><Field label="Specialty" icon="stethoscope" value={form.specialty} onChange={(v) => set("specialty", v)} placeholder="e.g. Cardiology" /></div>
          )}
          {form.role === "consultant" && (
            <div style={{ display: "flex", gap: 14, marginBottom: 16, alignItems: "flex-end" }}>
              <div style={{ width: 160 }}>
                <DSelect label="Credential" icon="badge-check" value={form.credential} onChange={(v) => set("credential", v)}
                  options={[{ value: "NP", label: "NP — Nurse Practitioner" }, { value: "PA", label: "PA — Physician Assistant" }, { value: "RN", label: "RN — Registered Nurse" }]} />
              </div>
              <div style={{ flex: 1 }}><Field label="Specialty / service" icon="stethoscope" value={form.specialty} onChange={(v) => set("specialty", v)} placeholder="e.g. Hospital Medicine" /></div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" icon="check" onClick={submit}>Add person</Button>
          </div>
        </Card>
      )}

      {/* role filter dropdown */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 220 }}>
          <DSelect label="Filter by role" icon="shield-half" value={roleFilter} onChange={setRoleFilter}
            options={[{ value: "ALL", label: "All roles" }].concat(domainList.map(([id, label]) => ({ value: id, label })))} />
        </div>
        <div style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted-foreground)", paddingBottom: 8 }}>{users.length} {users.length === 1 ? "person" : "people"}</div>
      </div>

      {/* collapsible, colored role groups */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {orderedRoles.map((rid) => {
          const accent = roleColors[rid];
          const isOpen = !collapsed[rid];
          const list = byRole[rid];
          return (
            <Card key={rid} style={{ padding: 0, overflow: "hidden" }}>
              <button onClick={() => setCollapsed((c) => Object.assign({}, c, { [rid]: !c[rid] }))}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 16px", border: "none", background: isOpen ? "var(--secondary)" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)" }}>
                <Icon name="chevron-right" size={16} color="var(--muted-foreground)" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", flex: "none" }} />
                <span style={{ width: 8, height: 8, borderRadius: 99, background: accent, flex: "none" }} />
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{PEOPLE_ROLE_LABEL[rid]}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>{list.length} {list.length === 1 ? "person" : "people"}</span>
              </button>
              {isOpen && list.map((u, i) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 16px", borderTop: "1px solid var(--border)" }}>
                  <Avatar initials={peopleInitials(u.name)} size={34} tint="slate" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{u.credential ? u.credential + (u.specialty ? " · " + u.specialty : "") : (u.specialty || PEOPLE_ROLE_LABEL[u.role])}</div>
                  </div>
                  <button onClick={() => a.removeUser(u.id)} title="Remove"
                    onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                    style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="trash-2" size={15} /></button>
                </div>
              ))}
            </Card>
          );
        })}
        {orderedRoles.length === 0 && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No people match this filter.</Card>}
      </div>
    </PageWrap>
  );
}

Object.assign(window, { PeopleManager });

function AccessPeople({ scopeOrg, domainRoles, domainPortals, roles, onCreate, onUpdate, onDelete }) {
  const [tab, setTab] = React.useState("people");
  const tabs = [["people", "People", "users-round"], ["roles", "Roles & permissions", "shield-half"]];
  return (
    <React.Fragment>
      <div style={{ padding: "22px 28px 0", maxWidth: "var(--content-max, 1040px)", margin: "0 auto" }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)" }}>
          {tabs.map(([id, label, icon]) => {
            const on = tab === id;
            return (
              <button key={id} onClick={() => setTab(id)}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)",
                  background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--muted-foreground)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
                <Icon name={icon} size={15} />{label}
              </button>
            );
          })}
        </div>
      </div>
      {tab === "people"
        ? <PeopleManager scopeOrg={scopeOrg} domainRoles={domainRoles} />
        : <RoleManagement roles={roles} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete} domainPortals={domainPortals} />}
    </React.Fragment>
  );
}

Object.assign(window, { PeopleManager, AccessPeople });
