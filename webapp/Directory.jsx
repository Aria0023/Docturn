/* DocTurn web-app UI kit — provider directory (compact single-row list) */

function Directory({ providers, onMessage }) {
  const [q, setQ] = React.useState("");
  const list = providers.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.specialty.toLowerCase().includes(q.toLowerCase()));
  return (
    <PageWrap>
      <SectionTitle action={<div style={{ width: 240 }}><Field icon="search" placeholder="Search name or specialty…" value={q} onChange={setQ} /></div>}>
        Provider directory
      </SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {list.map((p, i) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <div style={{ position: "relative", flex: "none" }}>
              <Avatar initials={p.avatar} size={34} tint={p.working ? "emerald" : "slate"} />
              <span style={{ position: "absolute", bottom: -1, right: -1, border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={p.working ? "online" : "offline"} pulse={p.working} /></span>
            </div>
            <div style={{ minWidth: 0, width: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.specialty}</div>
            </div>
            <Badge status={p.working ? "online" : "offline"}>{p.working ? "On shift" : "Off shift"}</Badge>
            <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="users" size={13} /> {p.census}/{p.cap}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Button size="icon" variant="outline" icon="message-square" onClick={() => onMessage && onMessage({ name: p.name, role: p.specialty, specialty: p.specialty, avatar: p.avatar, working: p.working, tint: p.working ? "emerald" : "slate" })} />
              <Button size="icon" variant="ghost" icon="phone" onClick={() => window.DT.actions.toast({ tone: "sent", title: "Calling " + p.name, msg: "Connecting on the secure line…" })} />
            </div>
          </div>
        ))}
        {list.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--muted-foreground)", fontSize: 13 }}>No providers match "{q}".</div>}
      </Card>
    </PageWrap>
  );
}

// Directory + Access & people, combined. For directors/ER directors the
// Directory tab carries People and Roles & permissions as sub-tabs so there's
// a single place for "everyone in the org" — provider directory and the access
// management that used to live under its own nav item.
function DirectoryHub({ providers, onMessage, scopeOrg, domainRoles, domainPortals, roles, onCreate, onUpdate, onDelete }) {
  const [tab, setTab] = React.useState("directory");
  const tabs = [["directory", "Directory", "contact"], ["people", "People", "users-round"], ["roles", "Roles & permissions", "shield-half"]];
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
      {tab === "directory"
        ? <Directory providers={providers} onMessage={onMessage} />
        : tab === "people"
          ? <PeopleManager scopeOrg={scopeOrg} domainRoles={domainRoles} />
          : <RoleManagement roles={roles} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete} domainPortals={domainPortals} />}
    </React.Fragment>
  );
}

Object.assign(window, { Directory, DirectoryHub });
