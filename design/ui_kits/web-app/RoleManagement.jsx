/* DocTurn web-app UI kit — Role Management (Director & Developer).
   Create and manage user roles with specific permissions and portal access.
   Store-backed: roles persist; built-in roles are protected from deletion.
   Spec: Req FR-2 (org config / RBAC), Eng §10 (admin portals). */

const PORTALS = [
  ["hospitalist",  "Hospitalist Portal",          "stethoscope"],
  ["hosp_director","Hospitalist Director Portal", "clipboard-list"],
  ["er_physician", "ER Physician Portal",         "ambulance"],
  ["er_director",  "ER Director Portal",          "siren"],
  ["admin",        "Admin Portal",                "shield"],
  ["developer",    "Developer Portal",            "terminal"],
];
const PERMS = [
  ["view_census",        "View Census",        "View patient census and occupancy data"],
  ["assign_patients",    "Assign Patients",    "Assign patients to hospitalists and residents"],
  ["manage_assignments", "Manage Assignments", "Edit and modify existing patient assignments"],
  ["view_reports",       "View Reports",       "Access reporting features and analytics"],
  ["manage_staff",       "Manage Staff",       "Add, edit, and manage staff members"],
  ["system_settings",    "System Settings",    "Access and modify system configuration"],
];
const FEATURES = [
  ["ai_chatbot",          "AI Chatbot Access",   "bot"],
  ["portal_customization","Portal Customization","palette"],
];
const PORTAL_LABEL = Object.fromEntries(PORTALS.map((p) => [p[0], p[1]]));
const PERM_LABEL = Object.fromEntries(PERMS.map((p) => [p[0], p[1]]));

function CheckRow({ checked, onToggle, title, desc, icon }) {
  return (
    <button onClick={onToggle}
      style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 12px", width: "100%", textAlign: "left", cursor: "pointer",
        border: checked ? "1px solid var(--primary)" : "1px solid var(--border)", background: checked ? "#EFF6FF" : "#fff", borderRadius: "var(--radius-md)", fontFamily: "var(--font-sans)" }}>
      <span style={{ width: 19, height: 19, borderRadius: 5, flex: "none", marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center",
        border: checked ? "none" : "1.5px solid var(--border)", background: checked ? "var(--primary)" : "#fff" }}>
        {checked && <Icon name="check" size={13} color="#fff" />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: "var(--foreground)" }}>
          {icon && <Icon name={icon} size={14} color={checked ? "var(--primary)" : "var(--muted-foreground)"} />}{title}
        </span>
        {desc && <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, lineHeight: 1.4 }}>{desc}</span>}
      </span>
    </button>
  );
}

function emptyDraft() { return { name: "", desc: "", portals: [], perms: [], features: [] }; }

function RoleEditor({ initial, onSave, onCancel, isNew, portalList }) {
  const PL = portalList || PORTALS;
  const [d, setD] = React.useState(initial);
  const toggle = (key, val) => setD((p) => {
    const arr = p[key];
    return Object.assign({}, p, { [key]: arr.includes(val) ? arr.filter((x) => x !== val) : arr.concat([val]) });
  });
  const Section = ({ title, sub, children }) => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 2 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 10 }}>{sub}</div>}
      {children}
    </div>
  );
  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18 }}>
        <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "#DBEAFE", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name={isNew ? "shield-plus" : "shield-half"} size={18} />
        </span>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{isNew ? "Create new role" : "Edit role"}</h3>
        {initial.system && <Badge status="offline" icon="lock">Built-in</Badge>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14, marginBottom: 4 }}>
        <Field label="Role name" icon="tag" value={d.name} onChange={(v) => setD(Object.assign({}, d, { name: v }))} placeholder="e.g. Chief, ICU, Technician" />
        <Field label="Description" icon="text" value={d.desc} onChange={(v) => setD(Object.assign({}, d, { desc: v }))} placeholder="Brief description of role responsibilities" />
      </div>
      <div style={{ height: 1, background: "var(--border)", margin: "16px 0 18px" }} />

      <Section title="Portal access permissions" sub="Select which portals this role can access">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {PL.map(([id, label, icon]) => <CheckRow key={id} checked={d.portals.includes(id)} onToggle={() => toggle("portals", id)} title={label} icon={icon} />)}
        </div>
      </Section>

      <Section title="Access permissions" sub="Define what actions this role can perform">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {PERMS.map(([id, label, desc]) => <CheckRow key={id} checked={d.perms.includes(id)} onToggle={() => toggle("perms", id)} title={label} desc={desc} />)}
        </div>
      </Section>

      <Section title="Special features">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {FEATURES.map(([id, label, icon]) => <CheckRow key={id} checked={d.features.includes(id)} onToggle={() => toggle("features", id)} title={label} icon={icon} />)}
        </div>
      </Section>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button icon={isNew ? "plus" : "check"} onClick={() => onSave(d)}>{isNew ? "Create role" : "Save changes"}</Button>
      </div>
    </Card>
  );
}

function RoleCard({ role, onEdit, onDelete }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", background: "var(--secondary)", color: role.system ? "var(--muted-foreground)" : "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name="shield-half" size={19} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{role.name}</span>
            {role.system ? <Badge status="offline" icon="lock">Built-in</Badge> : <Badge status="accepted">Custom</Badge>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2, lineHeight: 1.45 }}>{role.desc || "No description."}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flex: "none" }}>
          <Button size="icon" variant="outline" icon="pencil" onClick={() => onEdit(role)} />
          <Button size="icon" variant="ghost" icon="trash-2" onClick={() => onDelete(role)} style={role.system ? { opacity: .4, cursor: "not-allowed" } : null} />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 13, paddingTop: 13, borderTop: "1px solid var(--border)" }}>
        <Meta icon="users" label={role.users + " user" + (role.users === 1 ? "" : "s")} />
        <Meta icon="layout-grid" label={role.portals.length + " portal" + (role.portals.length === 1 ? "" : "s")} />
        <Meta icon="key-round" label={role.perms.length + " permission" + (role.perms.length === 1 ? "" : "s")} />
        {role.features.length > 0 && <Meta icon="sparkles" label={role.features.length + " feature" + (role.features.length === 1 ? "" : "s")} />}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
        {role.portals.map((p) => <Tag key={p} tone="slate">{PORTAL_LABEL[p] ? PORTAL_LABEL[p].replace(" Portal", "") : p}</Tag>)}
      </div>
    </Card>
  );
}

function Meta({ icon, label }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted-foreground)", fontWeight: 500 }}><Icon name={icon} size={14} />{label}</span>;
}
function Tag({ children, tone }) {
  const map = { blue: ["#EFF6FF", "var(--primary)"], slate: ["var(--secondary)", "var(--muted-foreground)"] };
  const [bg, fg] = map[tone] || map.slate;
  return <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: "var(--radius-full)", background: bg, color: fg }}>{children}</span>;
}

function RoleManagement({ roles, onCreate, onUpdate, onDelete, domainPortals }) {
  const [editing, setEditing] = React.useState(null); // null | "new" | roleObject
  const portalList = domainPortals ? PORTALS.filter((p) => domainPortals.includes(p[0])) : PORTALS;
  const shownRoles = domainPortals ? roles.filter((r) => r.portals.some((p) => domainPortals.includes(p))) : roles;
  const totalUsers = shownRoles.reduce((a, r) => a + r.users, 0);
  const customCount = shownRoles.filter((r) => !r.system).length;

  const save = (d) => {
    if (!d.name.trim()) { window.DT.actions.toast({ tone: "rejected", title: "Role name required", msg: "Give the role a name." }); return; }
    if (editing === "new") onCreate(d); else onUpdate(editing.id, d);
    setEditing(null);
  };
  const del = (r) => { if (!r.system) onDelete(r.id); else window.DT.actions.toast({ tone: "rejected", title: "Protected role", msg: "Built-in roles can't be deleted." }); };

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
        <StatTile label="Roles defined" value={shownRoles.length} icon="shield-half" tint="slate" />
        <StatTile label="Custom roles" value={customCount} icon="shield-plus" tint="slate" />
        <StatTile label="Users assigned" value={totalUsers} icon="users" tint="slate" />
      </div>

      {editing ? (
        <RoleEditor
          isNew={editing === "new"}
          portalList={portalList}
          initial={editing === "new" ? Object.assign(emptyDraft(), { portals: domainPortals ? domainPortals.slice() : [] }) : { name: editing.name, desc: editing.desc, portals: [...editing.portals], perms: [...editing.perms], features: [...editing.features], system: editing.system }}
          onSave={save} onCancel={() => setEditing(null)} />
      ) : (
        <React.Fragment>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Roles &amp; permissions</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Create and manage user roles with specific permissions and portal access.</div>
            </div>
            <Button icon="plus" onClick={() => setEditing("new")}>Create new role</Button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {shownRoles.map((r) => <RoleCard key={r.id} role={r} onEdit={setEditing} onDelete={del} />)}
          </div>

          {/* permission reference */}
          <Card style={{ padding: 18, marginTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Icon name="info" size={16} color="var(--muted-foreground)" />
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Permission details</h3>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 28px" }}>
              {PERMS.concat([["portal_customization", "Portal Customization", "Customize portal appearance and features"]]).map(([id, label, desc]) => (
                <div key={id} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 700 }}>{label}:</span> <span style={{ color: "var(--muted-foreground)" }}>{desc}</span>
                </div>
              ))}
            </div>
          </Card>
        </React.Fragment>
      )}
    </PageWrap>
  );
}

Object.assign(window, { RoleManagement });
