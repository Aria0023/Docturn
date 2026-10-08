/* DocTurn web-app UI kit — provider directory (compact single-row list) */

// "On call right now" — the live roster of addressable roles / consult services
// resolved to whoever holds each one this minute (DND already redirected to the
// covering provider by the server). Both TigerConnect and PerfectServe sell this
// at-a-glance "who's on call" view. Read-only; one tap opens a thread addressed
// to the role. Hidden when nothing is resolvable.
function OnCallNow() {
  const st = useStore();
  const a = useActions();
  const targets = st.onCallTargets || [];
  React.useEffect(() => { if (a.listOnCallTargets) a.listOnCallTargets(); }, []);
  if (!targets.length) return null;
  const KIND_ICON = { consult_service: "stethoscope", next_hospitalist: "repeat", care_team: "users" };
  const openRole = (t) => { if (!a.startRoleConversation) return; Promise.resolve(a.startRoleConversation(t)).then(() => a.setNav && a.setNav("messages")); };
  return (
    <div style={{ marginBottom: 18 }}>
      <SectionTitle>On call right now</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {targets.map((t, i) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--primary-tint, #EFF6FF)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <Icon name={KIND_ICON[t.kind] || "user"} size={17} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</div>
              {t.holder ? <div style={{ fontSize: 12, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.holder}</div> : null}
            </div>
            <Button size="sm" variant="outline" icon="message-square" onClick={() => openRole(t)}>Message</Button>
          </div>
        ))}
      </Card>
    </div>
  );
}

// Presence dot pinned to the avatar's bottom-right rim. display:flex (not an
// inline line box) is what makes the 9px dot actually sit at bottom:-1/right:-1
// instead of ~10px high inside a 23px text line.
function PresenceAvatar({ initials, size, working }) {
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <Avatar initials={initials} size={size} tint={working ? "emerald" : "slate"} />
      <span style={{ position: "absolute", bottom: -1, right: -1, display: "flex", border: "2px solid #fff", borderRadius: 99 }}><StatusDot status={working ? "online" : "offline"} pulse={working} /></span>
    </div>
  );
}

function Directory({ providers, onMessage }) {
  const [q, setQ] = React.useState("");
  // Phone rows: name / specialty / (On shift · census) stacked so the name is
  // not clipped to ~12 characters and the pill never wraps to two lines.
  const mobile = useIsMobile();
  const list = providers.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.specialty.toLowerCase().includes(q.toLowerCase()));
  const search = <Field icon="search" placeholder="Search name or specialty…" value={q} onChange={setQ} />;
  return (
    <PageWrap>
      <OnCallNow />
      <SectionTitle action={!mobile && <div style={{ width: 240 }}>{search}</div>}>
        Provider directory
      </SectionTitle>
      {mobile && <div style={{ marginBottom: 12 }}>{search}</div>}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {list.map((p, i) => {
          const pill = <span style={{ flex: "none", display: "inline-flex", whiteSpace: "nowrap" }}><Badge status={p.working ? "online" : "offline"}>{p.working ? "On shift" : "Off shift"}</Badge></span>;
          const census = (
            <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
              <Icon name="users" size={13} /> {p.census}/{p.cap}
            </span>
          );
          const message = <Button size="icon" variant="outline" icon="message-square" title={"Message " + p.name} style={mobile ? { width: 44, height: 44 } : null} onClick={() => onMessage && onMessage({ name: p.name, role: p.specialty, specialty: p.specialty, avatar: p.avatar, working: p.working, tint: p.working ? "emerald" : "slate" })} />;
          return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <PresenceAvatar initials={p.avatar} size={34} working={p.working} />
            <div style={mobile ? { minWidth: 0, flex: 1 } : { minWidth: 0, width: 220 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.specialty}</div>
              {mobile && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>{pill}{census}</div>}
            </div>
            {!mobile && pill}
            {!mobile && census}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, flex: "none" }}>
              {message}
            </div>
          </div>
          );
        })}
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
  const mobile = useIsMobile();
  const tabs = [["directory", "Directory", "contact"], ["people", "People", "users-round"], ["consult", "Consult services", "stethoscope"], ["roles", "Roles & permissions", "shield-half"]];
  return (
    <React.Fragment>
      {/* Same mobile padding as PageWrap; the strip scrolls sideways within the
          viewport (like SettingsTabs) instead of pushing the page 80px wider. */}
      <div style={{ padding: mobile ? "16px 14px 0" : "22px 28px 0", maxWidth: "var(--content-max, 1040px)", margin: "0 auto" }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)", maxWidth: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {tabs.map(([id, label, icon]) => {
            const on = tab === id;
            return (
              <button key={id} onClick={() => setTab(id)}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", minHeight: mobile ? 44 : undefined, borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", flex: "none",
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
          : tab === "consult"
            ? <ConsultServices />
            : <RoleManagement roles={roles} onCreate={onCreate} onUpdate={onUpdate} onDelete={onDelete} domainPortals={domainPortals} />}
    </React.Fragment>
  );
}

Object.assign(window, { Directory, DirectoryHub });
