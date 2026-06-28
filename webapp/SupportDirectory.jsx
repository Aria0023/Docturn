/* DocTurn web-app UI kit — developer "Users by organization" support portal.
   A tech-support view: every individual user grouped under their organization,
   searchable, with quick role/specialty context and a one-tap "open portal"
   (impersonate) to help that user in place. */

function userInitialsSD(name) {
  return String(name || "?").replace(/\(root\)/i, "").replace(/^Dr\.?\s*/, "").trim().split(/[\s,]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function SupportDirectory({ users = [], organizations = [], roleColors = {}, onImpersonate }) {
  const [q, setQ] = React.useState("");
  const [collapsed, setCollapsed] = React.useState({});
  const ROLE_LABEL = { hospitalist: "Hospitalist", er_doctor: "ER physician", er_director: "ER director", director: "Director", developer: "Developer" };
  const orgName = (code) => (organizations.find((o) => o.code === code) || {}).name || code;

  const filtered = (users || []).filter((u) =>
    !q || (u.name || "").toLowerCase().includes(q.toLowerCase())
      || (u.org || "").toLowerCase().includes(q.toLowerCase())
      || (u.specialty || "").toLowerCase().includes(q.toLowerCase())
      || (ROLE_LABEL[u.role] || u.role || "").toLowerCase().includes(q.toLowerCase()));

  const byOrg = {};
  filtered.forEach((u) => { const k = u.org === "*" ? "Platform (root)" : (u.org || "—"); (byOrg[k] = byOrg[k] || []).push(u); });
  const keys = Object.keys(byOrg).sort();

  return (
    <PageWrap>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 16, borderRadius: "var(--radius-md)", background: "#1E293B", color: "#fff" }}>
        <Icon name="life-buoy" size={16} color="#7DD3FC" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Users by organization</span>
        <span style={{ fontSize: 12, color: "#94A3B8" }}>Tech-support directory — find a user in their tenant and open their portal to help in place.</span>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
        <StatTile label="Users" value={(users || []).length} icon="users" tint="blue" />
        <StatTile label="Organizations" value={keys.filter((k) => k !== "Platform (root)").length} icon="building-2" tint="emerald" />
        <StatTile label="Shown" value={filtered.length} icon="search" tint="slate" />
      </div>

      <div style={{ marginBottom: 12, maxWidth: 380 }}>
        <Field icon="search" value={q} onChange={setQ} placeholder="Search by name, role, specialty or org…" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {keys.map((code) => {
          const isOpen = !collapsed[code];
          const members = byOrg[code];
          return (
            <Card key={code} style={{ padding: 0, overflow: "hidden" }}>
              <button onClick={() => setCollapsed((c) => Object.assign({}, c, { [code]: !c[code] }))}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", border: "none", background: isOpen ? "var(--secondary)" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)" }}>
                <Icon name="chevron-right" size={16} color="var(--muted-foreground)" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s", flex: "none" }} />
                <span style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", fontWeight: 700, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{code === "Platform (root)" ? "★" : code.slice(0, 2)}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{code === "Platform (root)" ? code : orgName(code)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{code === "Platform (root)" ? "spans all organizations" : <span className="ds-mono">{code}</span>}</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>{members.length} user{members.length === 1 ? "" : "s"}</span>
              </button>
              {isOpen && members.map((u, i) => (
                <div key={u.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
                  <Avatar initials={userInitialsSD(u.name)} size={32} tint="blue" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.name}{u.credential ? <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: 6 }}>{u.credential}</span> : null}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{u.specialty ? u.specialty + " · " : ""}{ROLE_LABEL[u.role] || u.role}</div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, color: roleColors[u.role] || "#888", background: (roleColors[u.role] || "#888") + "18", border: "1px solid " + (roleColors[u.role] || "#888") + "33", whiteSpace: "nowrap" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: roleColors[u.role] || "#888", flex: "none" }} />{ROLE_LABEL[u.role] || u.role}
                  </span>
                  {onImpersonate && u.role !== "developer" && (
                    <Button size="sm" variant="outline" icon="log-in" onClick={() => onImpersonate(u)}>Open portal</Button>
                  )}
                </div>
              ))}
            </Card>
          );
        })}
        {keys.length === 0 && (
          <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No users match.</Card>
        )}
      </div>
    </PageWrap>
  );
}

Object.assign(window, { SupportDirectory });
