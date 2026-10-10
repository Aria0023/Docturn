/* DocTurn web-app UI kit — People (Hospitalist Director & ER Director).
   The organization's workforce list — the HIPAA account-lifecycle surface —
   exactly as the SERVER holds it:
   - the roster is GET /api/accounts for the signed-in org (DT.actions.
     loadAccounts), never the kit's demo users or its demo "selected org";
   - Add person is POST /api/director/hospitalists (DT.actions.addPerson): the
     server mints a one-time password, shown once;
   - Reset password / Reset two-factor / Remove or Restore access are
     /api/accounts/:id/* — immediate and audited.
   Who may do what is the server's rule (server/routes/accounts.ts,
   providers.ts), mirrored here so no control is offered that it refuses:
     director     adds and manages every clinical account in the org
     er_director  adds and manages ER physicians only
   nobody acts on their own account here (Settings → My settings). */

const PEOPLE_ROLES = [
  ["hospitalist", "Hospitalist", "stethoscope"],
  ["consultant", "PA / NP", "user-round"],
  ["er_doctor", "ER physician", "ambulance"],
  ["er_director", "ER director", "siren"],
  ["director", "Hospitalist director", "clipboard-list"],
];
const PEOPLE_ROLE_LABEL = Object.fromEntries(PEOPLE_ROLES.map((r) => [r[0], r[1]]));

// A PA / NP (or RN) is a clinical (hospitalist) account carrying that
// credential; it is listed as its own group so directors see midlevels apart
// from attending physicians.
const MIDLEVEL_CREDS = { PA: 1, NP: 1, RN: 1 };
function personCategory(u) { return u.role === "hospitalist" && MIDLEVEL_CREDS[u.credential] ? "consultant" : u.role; }

// The server's rules (server/routes/accounts.ts reachableTarget, providers.ts).
function peopleCanManage(myRole, u) {
  if (!u || u.self || u.role === "developer") return false;
  if (myRole === "director") return true;
  if (myRole === "er_director") return u.role === "er_doctor";
  return false;
}
function peopleAddableRoles(myRole) {
  if (myRole === "director") return ["hospitalist", "consultant", "er_doctor", "er_director", "director"];
  if (myRole === "er_director") return ["er_doctor"];
  return [];
}
// Org codes are case-insensitive (the sign-in form keeps what was typed).
function peopleSameOrg(x, y) { return String(x || "").toUpperCase() === String(y || "").toUpperCase(); }
function suggestUsername(name) {
  return String(name || "").replace(/^Dr\.?\s+/i, "").replace(/,.*$/, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 24);
}

function peopleInitials(name) {
  return String(name || "").replace(/\(root\)/i, "").replace(/^Dr\.?\s*/, "").trim().split(/[\s,]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function PeopleIconButton({ title, icon, hoverColor, onClick }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      onMouseEnter={(e) => e.currentTarget.style.color = hoverColor} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
      style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}>
      <Icon name={icon} size={16} />
    </button>
  );
}

function PeopleManager({ domainRoles }) {
  const st = useStore();
  const a = useActions();
  const mobile = useIsMobile();
  const sess = st.session || {};
  const myRole = sess.role;
  const roleColors = st.roleColors || {};
  React.useEffect(() => {
    if (a.loadAccounts) a.loadAccounts();
    if (a.loadOrgIdentity && !(st.orgIdentity && peopleSameOrg(st.orgIdentity.code, sess.org))) a.loadOrgIdentity();
  }, [sess.org, sess.user]);
  const ident = st.orgIdentity && peopleSameOrg(st.orgIdentity.code, sess.org) ? st.orgIdentity : null;
  const orgName = ident ? ident.name : (sess.org || "your organization");

  const allowed = (domainRoles && domainRoles.length) ? domainRoles : PEOPLE_ROLES.map((r) => r[0]);
  const domainList = PEOPLE_ROLES.filter((r) => allowed.includes(r[0]));
  const addable = peopleAddableRoles(myRole);
  const addList = PEOPLE_ROLES.filter((r) => addable.includes(r[0]));

  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [roleFilter, setRoleFilter] = React.useState("ALL");
  const [collapsed, setCollapsed] = React.useState({});
  const blank = { name: "", username: "", usernameTouched: false, role: addable[0] || "", specialty: "Hospital Medicine", credential: "NP" };
  const [form, setForm] = React.useState(blank);
  const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  const setName = (v) => setForm((f) => Object.assign({}, f, { name: v }, f.usernameTouched ? {} : { username: suggestUsername(v) }));

  // Only the session org's rows, and only once the server has answered.
  const loaded = Array.isArray(st.accounts) && st.accountsOrg === sess.org;
  const all = loaded ? st.accounts : [];
  const inDomain = all.filter((u) => allowed.includes(personCategory(u)));
  const users = inDomain.filter((u) => roleFilter === "ALL" || personCategory(u) === roleFilter);
  const byRole = {};
  users.forEach((u) => { const c = personCategory(u); (byRole[c] = byRole[c] || []).push(u); });
  const orderedRoles = domainList.map((r) => r[0]).filter((rid) => byRole[rid]);

  const submit = () => {
    if (busy) return;
    if (!form.name.trim()) { a.toast({ tone: "rejected", title: "Name required", msg: "Enter the person's full name." }); return; }
    if (form.username.trim().length < 3) { a.toast({ tone: "rejected", title: "Username required", msg: "Enter a sign-in username of at least 3 characters." }); return; }
    setBusy(true);
    Promise.resolve(a.addPerson(form)).then((ok) => {
      if (ok) { setForm(blank); setOpen(false); }
    }).finally(() => setBusy(false));
  };

  const sub = myRole === "er_director"
    ? "ER staff in " + orgName + ". You can add ER physicians and manage their access; other accounts are managed by a hospitalist director."
    : "Everyone in " + orgName + ". Adding people and changing their access happens on the server, immediately, and is audited.";

  return (
    <PageWrap>
      <div data-people-header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>People</div>
          <div data-people-sub style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>{sub}</div>
        </div>
        {addList.length > 0 && <Button size="sm" variant={open ? "secondary" : "default"} icon={open ? "x" : "user-plus"} onClick={() => setOpen(!open)}>{open ? "Close" : "Add person"}</Button>}
      </div>

      {/* active accounts per role, from the server's list */}
      <div data-keep-cols="2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, margin: "16px 0" }}>
        {domainList.map(([rid, label, icon]) => {
          const n = inDomain.filter((u) => personCategory(u) === rid && !u.disabled).length;
          return (
            <Card key={rid} style={{ padding: 14, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", background: "var(--secondary)", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={icon} size={15} /></span>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 500, lineHeight: 1.2 }}>{label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: roleColors[rid], flex: "none" }} />
                <span data-role-count={rid} style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>{loaded ? n : "–"}</span>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>active</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* add form — only the roles the server lets this administrator create */}
      {open && addList.length > 0 && (
        <Card style={{ padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Role</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {addList.map(([id, label, icon]) => {
              const on = form.role === id;
              return (
                <button key={id} type="button" onClick={() => set("role", id)} aria-pressed={on}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", minHeight: 44, borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)",
                    border: on ? "1px solid var(--primary)" : "1px solid var(--border)", background: on ? "var(--primary-tint, #EFF6FF)" : "#fff", color: on ? "var(--primary-ink, var(--primary))" : "var(--foreground)" }}>
                  <Icon name={icon} size={15} />{label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", gap: 14, marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}><Field label="Full name" icon="user" value={form.name} onChange={setName} placeholder={form.role === "consultant" ? "Jane Smith, NP" : "Dr. Jane Smith"} autoComplete="off" /></div>
            <div style={{ flex: 1, minWidth: 0 }}><Field label="Username (for sign-in)" icon="at-sign" value={form.username} onChange={(v) => setForm((f) => Object.assign({}, f, { username: v, usernameTouched: true }))} placeholder="jane.smith" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" /></div>
          </div>
          {form.role === "hospitalist" && (
            <div style={{ marginBottom: 16 }}><Field label="Specialty" icon="stethoscope" value={form.specialty} onChange={(v) => set("specialty", v)} placeholder="e.g. Hospital Medicine" /></div>
          )}
          {form.role === "consultant" && (
            <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", gap: 14, marginBottom: 16, alignItems: mobile ? "stretch" : "flex-end" }}>
              <div style={{ width: mobile ? "100%" : 200 }}>
                <DSelect label="Credential" icon="badge-check" value={form.credential} onChange={(v) => set("credential", v)}
                  options={[{ value: "NP", label: "NP — Nurse Practitioner" }, { value: "PA", label: "PA — Physician Assistant" }]} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}><Field label="Specialty / service" icon="stethoscope" value={form.specialty} onChange={(v) => set("specialty", v)} placeholder="e.g. Hospital Medicine" /></div>
            </div>
          )}
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 12px", lineHeight: 1.45 }}>
            DocTurn creates the account with a one-time password and shows it to you once — hand it over in person or by phone. They choose their own password at first sign-in.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" icon="check" onClick={submit}>{busy ? "Adding…" : "Add person"}</Button>
          </div>
        </Card>
      )}

      {/* role filter */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ width: mobile ? "100%" : 220 }}>
          <DSelect label="Filter by role" icon="shield-half" value={roleFilter} onChange={setRoleFilter}
            options={[{ value: "ALL", label: "All roles" }].concat(domainList.map(([id, label]) => ({ value: id, label })))} />
        </div>
        <div data-people-count style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--muted-foreground)", paddingBottom: 8 }}>{loaded ? users.length + " " + (users.length === 1 ? "person" : "people") : ""}</div>
      </div>

      {/* role groups */}
      <div data-people-list style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!loaded && !st.accountsError && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>Loading people…</Card>}
        {!loaded && st.accountsError && (
          <Card style={{ padding: 22, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>
            <div style={{ marginBottom: 10 }}>{st.accountsError}</div>
            <Button size="sm" variant="outline" icon="refresh-cw" onClick={() => a.loadAccounts()}>Try again</Button>
          </Card>
        )}
        {loaded && orderedRoles.map((rid) => {
          const accent = roleColors[rid];
          const isOpen = !collapsed[rid];
          const list = byRole[rid];
          return (
            <Card key={rid} style={{ padding: 0, overflow: "hidden" }}>
              <button type="button" onClick={() => setCollapsed((c) => Object.assign({}, c, { [rid]: !c[rid] }))} aria-expanded={isOpen}
                style={{ width: "100%", minHeight: 44, display: "flex", alignItems: "center", gap: 11, padding: "12px 16px", border: "none", background: isOpen ? "var(--secondary)" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)" }}>
                <Icon name="chevron-right" size={16} color="var(--muted-foreground)" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", flex: "none" }} />
                <span style={{ width: 8, height: 8, borderRadius: 99, background: accent, flex: "none" }} />
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{PEOPLE_ROLE_LABEL[rid]}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>{list.length} {list.length === 1 ? "person" : "people"}</span>
              </button>
              {isOpen && list.map((u) => {
                const manage = peopleCanManage(myRole, u);
                return (
                  <div key={u.id} data-person={u.username} style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 16px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                    <Avatar initials={peopleInitials(u.name)} size={34} tint="slate" />
                    <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ opacity: u.disabled ? 0.55 : 1, overflowWrap: "anywhere" }}>{u.name}</span>
                        {u.self && <Badge variant="secondary">You</Badge>}
                        {u.disabled && <Badge status="rejected">Access removed</Badge>}
                        {!u.disabled && u.mustChangePassword && <Badge status="pending">Awaiting first sign-in</Badge>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)", overflowWrap: "anywhere" }}>{u.credential && MIDLEVEL_CREDS[u.credential] ? u.credential + (u.specialty ? " · " + u.specialty : "") : (u.specialty || PEOPLE_ROLE_LABEL[u.role] || u.role)}{u.username ? " · @" + u.username : ""}</div>
                      {!manage && !u.self && <div data-managed-elsewhere style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Managed by a hospitalist director</div>}
                    </div>
                    {/* Account lifecycle: one-time password; second factor; remove
                        or restore access (HIPAA workforce termination — immediate,
                        audited). Offered only where the server allows it. */}
                    {manage && (
                      <div style={{ display: "flex", marginLeft: "auto", flex: "none" }}>
                        <PeopleIconButton title={"Reset password for " + u.name + " (issues a one-time password)"} icon="key-round" hoverColor="var(--primary)" onClick={() => { if (window.confirm("Reset " + u.name + "'s password? Their current sessions end and you'll be shown a one-time password to hand over.")) a.resetUserPassword(u.id, u.name); }} />
                        <PeopleIconButton title={"Reset two-factor for " + u.name} icon="shield-off" hoverColor="var(--primary)" onClick={() => { if (window.confirm("Clear " + u.name + "'s two-factor authentication? They will sign in with their password and set it up again.")) a.resetUserMfa(u.id, u.name); }} />
                        {u.disabled
                          ? <PeopleIconButton title={"Restore access for " + u.name} icon="user-check" hoverColor="var(--status-accepted)" onClick={() => a.reactivateUser(u.id)} />
                          : <PeopleIconButton title={"Remove access for " + u.name} icon="user-x" hoverColor="var(--destructive)" onClick={() => { if (window.confirm("Remove " + u.name + "'s access? They are signed out now and cannot sign in until restored.")) a.deactivateUser(u.id); }} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          );
        })}
        {loaded && orderedRoles.length === 0 && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No people match this filter.</Card>}
      </div>
    </PageWrap>
  );
}

function AccessPeople({ domainRoles }) {
  const [tab, setTab] = React.useState("people");
  const mobile = useIsMobile();
  const tabs = [["people", "People", "users-round"], ["roles", "Roles", "shield-half"]];
  return (
    <React.Fragment>
      <div style={{ padding: mobile ? "16px 14px 0" : "22px 28px 0", maxWidth: "var(--content-max, 1040px)", margin: "0 auto" }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)", maxWidth: "100%", overflowX: "auto" }}>
          {tabs.map(([id, label, icon]) => {
            const on = tab === id;
            return (
              <button key={id} type="button" onClick={() => setTab(id)}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", minHeight: mobile ? 44 : undefined, borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", flex: "none",
                  background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--muted-foreground)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
                <Icon name={icon} size={15} />{label}
              </button>
            );
          })}
        </div>
      </div>
      {tab === "people" ? <PeopleManager domainRoles={domainRoles} /> : <RoleManagement />}
    </React.Fragment>
  );
}

Object.assign(window, { PeopleManager, AccessPeople, personCategory, PEOPLE_ROLE_LABEL });
