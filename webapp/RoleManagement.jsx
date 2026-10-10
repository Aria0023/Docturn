/* DocTurn web-app UI kit — Roles (Hospitalist Director & ER Director).
   READ-ONLY, and only what the server enforces. DocTurn's roles are fixed
   (shared/schema.ts ROLES; every API route checks them with requireRole in
   server/rbac.ts): there are no custom roles and no per-role permission
   switches, so this screen offers none. It lists each role, what the server
   lets it do, and how many accounts in YOUR organization hold it — counted
   from the same GET /api/accounts list the People tab shows. A role is given
   to a person when they are added (People → Add person). */

const ORG_ROLES = [
  { id: "hospitalist", name: "Hospitalist", icon: "stethoscope",
    does: "Takes admissions from the rotation: accepts or declines hand-offs, keeps a census, answers consults and messages the care team." },
  { id: "consultant", name: "PA / NP", icon: "user-round", sub: "a hospitalist account with a PA or NP credential",
    does: "The same access as a hospitalist; listed apart so midlevels are easy to find and can be linked into a care team." },
  { id: "er_doctor", name: "ER physician", icon: "ambulance",
    does: "Admits patients and routes them to the next hospitalist, requests consults and messages the care team." },
  { id: "er_director", name: "ER director", icon: "siren",
    does: "ER operations: intake, the patient board, broadcasts, registration approvals and analytics. Adds ER physicians and manages their accounts." },
  { id: "director", name: "Hospitalist director", icon: "clipboard-list",
    does: "Runs the hospitalist group: rotation, shifts and caps, consult services and organization settings. Adds and manages every clinical account in the organization." },
];

// Org codes are case-insensitive (the sign-in form keeps what was typed).
function sameOrgCode(x, y) { return String(x || "").toUpperCase() === String(y || "").toUpperCase(); }

function RoleRow({ role, count, removed, loaded, last }) {
  return (
    <div data-org-role={role.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--secondary)", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Icon name={role.icon} size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>{role.name}</span>
          <span data-role-accounts style={{ fontSize: 12.5, color: "var(--muted-foreground)", fontWeight: 600 }}>
            {loaded ? count + " active " + (count === 1 ? "account" : "accounts") + (removed ? " · " + removed + " access removed" : "") : "…"}
          </span>
        </div>
        {role.sub && <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{role.sub}</div>}
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 3, lineHeight: 1.45 }}>{role.does}</div>
      </div>
    </div>
  );
}

function RoleManagement() {
  const st = useStore();
  const a = useActions();
  const sess = st.session || {};
  React.useEffect(() => {
    if (a.loadAccounts) a.loadAccounts();
    if (a.loadOrgIdentity && !(st.orgIdentity && sameOrgCode(st.orgIdentity.code, sess.org))) a.loadOrgIdentity();
  }, [sess.org, sess.user]);
  const loaded = Array.isArray(st.accounts) && st.accountsOrg === sess.org;
  const accounts = loaded ? st.accounts : [];
  const cat = typeof personCategory === "function" ? personCategory : (u) => u.role;
  const orgName = st.orgIdentity && sameOrgCode(st.orgIdentity.code, sess.org) ? st.orgIdentity.name : (sess.org || "your organization");
  const active = accounts.filter((u) => !u.disabled && u.role !== "developer");
  const removed = accounts.filter((u) => u.disabled && u.role !== "developer");

  return (
    <PageWrap>
      <div data-keep-cols="2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 }}>
        <StatTile label="Roles (fixed)" value={ORG_ROLES.length - 1} icon="shield-half" tint="slate" />
        <StatTile label="Active accounts" value={loaded ? active.length : "–"} icon="users" tint="slate" />
        <StatTile label="Access removed" value={loaded ? removed.length : "–"} icon="user-x" tint="slate" />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Roles in {orgName}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          DocTurn's roles are fixed and checked by the server on every request — they can't be created or edited. A person's role is set when they're added under People.
        </div>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {!loaded && st.accountsError && (
          <div style={{ padding: 16, fontSize: 13, color: "var(--muted-foreground)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{st.accountsError}</span>
            <Button size="sm" variant="outline" icon="refresh-cw" onClick={() => a.loadAccounts()}>Try again</Button>
          </div>
        )}
        {ORG_ROLES.map((r, i) => (
          <RoleRow key={r.id} role={r} loaded={loaded} last={i === ORG_ROLES.length - 1}
            count={active.filter((u) => cat(u) === r.id).length}
            removed={removed.filter((u) => cat(u) === r.id).length} />
        ))}
      </Card>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 12, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
        <Icon name="info" size={14} style={{ marginTop: 2, flex: "none" }} />
        <span>The DocTurn operator's own accounts live outside your organization and aren't listed. Two-factor enrolment for directors can be required by the operator.</span>
      </div>
    </PageWrap>
  );
}

Object.assign(window, { RoleManagement });
