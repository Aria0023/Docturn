/* DocTurn web-app UI kit — Consult services management (Director & ER Director).
   The menu behind the ER intake's "Consult services" multi-select: add / rename
   / remove services and set the on-call consultant per service. The ER
   physician's quick PA/NP add stays untouched — this just curates the list. */

function ConsultServices() {
  const st = useStore();
  const a = useActions();
  const services = st.consultServices || [];
  const directory = st.directory || [];
  const [name, setName] = React.useState("");

  // Everyone who reaches this surface can add / rename / set on-call. Deleting a
  // service is more destructive, so it's reserved for the Hospitalist Director
  // and the developer (NOT the ER director).
  const role = (st.session || {}).role;
  const canDelete = role === "director" || role === "developer";

  // Provider options for "on-call" — registered people, prefer those whose
  // specialty matches the service; everyone is selectable as a manual override.
  const providerOpts = directory.map((d) => ({ name: d.name, avatar: d.avatar, specialty: d.specialty }));

  const add = () => { if (name.trim()) { a.addConsultService(name); setName(""); } };

  return (
    <PageWrap>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Consult services</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Curate the services ER physicians can request, and set who's on call. The ER intake's quick add is unchanged.</div>
        </div>
      </div>

      {/* add a service */}
      <Card style={{ padding: 14, margin: "14px 0" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Field label="Add a consult service" icon="stethoscope" value={name} onChange={setName} placeholder="e.g. Hematology, Orthopedics" />
          </div>
          <Button icon="plus" onClick={add}>Add service</Button>
        </div>
      </Card>

      {/* service list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {services.length === 0 && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No consult services yet — add one above.</Card>}
        {services.map((s) => {
          const onCallVal = s.onCall && s.onCall.name ? s.onCall.name : "";
          return (
            <Card key={s.id} style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
                <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "#DBEAFE", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Icon name="stethoscope" size={17} />
                </span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <EditableText value={s.name} onSave={(v) => a.renameConsultService(s.id, v)} size={14} weight={700} />
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1 }}>
                    {onCallVal ? "On call: " + onCallVal : "On call: auto (live registered roster)"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>On-call</span>
                  <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                    <select value={onCallVal}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) { a.setConsultOnCall(s.id, null); return; }
                        const p = providerOpts.find((x) => x.name === v);
                        a.setConsultOnCall(s.id, { name: v, avatar: (p && p.avatar) || v.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() });
                      }}
                      style={{ appearance: "none", WebkitAppearance: "none", height: 32, padding: "0 26px 0 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: 12.5, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-sans)", cursor: "pointer", maxWidth: 240 }}>
                      <option value="">Auto (live roster)</option>
                      {providerOpts.map((p, i) => <option key={i} value={p.name}>{p.name}{p.specialty ? " · " + p.specialty : ""}</option>)}
                    </select>
                    <Icon name="chevron-down" size={13} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
                  </div>
                  {canDelete
                    ? <button onClick={() => a.removeConsultService(s.id)} title="Remove service"
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                        style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="trash-2" size={16} /></button>
                    : <span title="Only the Hospitalist Director or developer can remove a service" style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--border)", flex: "none" }}><Icon name="lock" size={14} /></span>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 12, fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
        <Icon name="info" size={13} style={{ marginTop: 1, flex: "none" }} />
        These services appear in the ER physician's intake "Consult services" picker. "Auto" uses the registered on-call provider for that specialty; pick a name to pin a specific consultant.
      </div>
    </PageWrap>
  );
}

Object.assign(window, { ConsultServices });
