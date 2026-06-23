/* DocTurn web-app UI kit — Consult services management (Director, ER Director, Developer).
   The menu behind the ER intake's "Consult services" multi-select.

   Two kinds of on-call:
   • Specialist consult call lists (Cardiology, GI, …) are MAINTAINED BY HAND —
     not everyone is on Amion — so on-call consultants and their PA/NPs can be
     typed in manually (as well as picked from registered people).
   • The Hospitalist ("Hospital Medicine") on-call is SYNCED from the imported
     on-call schedule (the live registered/working roster) — leave it on "Auto".

   Delete is reserved for the Hospitalist Director and developer. The ER
   physician's intake quick-add is unchanged. */

function initialsFrom(nm) {
  return String(nm || "").replace(/^Dr\.?\s*/i, "").trim().split(/[\s,]+/).map(function (w) { return w[0]; }).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

function ConsultServiceRow({ s, providerOpts, midlevelOpts, canDelete, a }) {
  const [customOn, setCustomOn] = React.useState(false);
  const [customName, setCustomName] = React.useState("");
  const [mlName, setMlName] = React.useState("");
  const [mlRole, setMlRole] = React.useState("NP");

  const onCallVal = s.onCall && s.onCall.name ? s.onCall.name : "";
  const members = s.members || [];
  const addable = midlevelOpts.filter((m) => !members.some((x) => x.name === m.name));

  const pickOnCall = (v) => {
    if (v === "__custom__") { setCustomOn(true); return; }
    if (!v) { a.setConsultOnCall(s.id, null); return; }
    const p = providerOpts.find((x) => x.name === v);
    a.setConsultOnCall(s.id, { name: v, avatar: (p && p.avatar) || initialsFrom(v) });
  };
  const saveCustomOn = () => { if (customName.trim()) { a.setConsultOnCall(s.id, { name: customName.trim(), avatar: initialsFrom(customName) }); setCustomName(""); setCustomOn(false); } };
  const addManualMl = () => { if (mlName.trim()) { a.addConsultMember(s.id, { id: "cm" + Date.now(), name: mlName.trim(), avatar: initialsFrom(mlName), role: mlRole }); setMlName(""); } };

  return (
    <Card style={{ padding: 14 }}>
      {/* top row: service name, on-call consultant, delete */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
        <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "#DBEAFE", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name="stethoscope" size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 160 }}>
          <EditableText value={s.name} onSave={(v) => a.renameConsultService(s.id, v)} size={14} weight={700} />
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1 }}>
            {onCallVal ? "On call: " + onCallVal : "On call: synced from on-call schedule"} · {members.length} PA/NP
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>On-call</span>
          {customOn ? (
            <React.Fragment>
              <Field value={customName} onChange={setCustomName} placeholder="Type consultant name" icon="user" />
              <Button size="sm" icon="check" onClick={saveCustomOn}>Save</Button>
              <Button size="sm" variant="ghost" icon="x" onClick={() => { setCustomOn(false); setCustomName(""); }} />
            </React.Fragment>
          ) : (
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <select value={onCallVal} onChange={(e) => pickOnCall(e.target.value)}
                style={{ appearance: "none", WebkitAppearance: "none", height: 32, padding: "0 26px 0 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: 12.5, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-sans)", cursor: "pointer", maxWidth: 240 }}>
                <option value="">Auto — synced from schedule</option>
                {providerOpts.map((p, i) => <option key={i} value={p.name}>{p.name}{p.specialty ? " · " + p.specialty : ""}</option>)}
                <option value="__custom__">✎ Enter name manually…</option>
              </select>
              <Icon name="chevron-down" size={13} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
            </div>
          )}
          {canDelete
            ? <button onClick={() => a.removeConsultService(s.id)} title="Remove service"
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="trash-2" size={16} /></button>
            : <span title="Only the Hospitalist Director or developer can remove a service" style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--border)", flex: "none" }}><Icon name="lock" size={14} /></span>}
        </div>
      </div>

      {/* PA / NP midlevels under this service — pick a registered one OR type any */}
      <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)", marginRight: 2 }}>PA / NP</span>
          {members.length === 0 && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>None assigned</span>}
          {members.map((m) => (
            <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--secondary)", borderRadius: "var(--radius-full)", padding: "3px 8px 3px 4px" }}>
              <Avatar initials={m.avatar || initialsFrom(m.name)} size={20} tint="slate" />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{m.name.split(",")[0]}</span>
              <RolePill role={m.role} />
              <button onClick={() => a.removeConsultMember(s.id, m.id)} title="Remove" style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", color: "var(--muted-foreground)", padding: 0 }}><Icon name="x" size={12} /></button>
            </span>
          ))}
          {addable.length > 0 && (
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <select value="" onChange={(e) => { const m = addable.find((x) => x.id === e.target.value); if (m) a.addConsultMember(s.id, m); }}
                style={{ appearance: "none", WebkitAppearance: "none", height: 28, padding: "0 24px 0 10px", borderRadius: "var(--radius-full)", border: "1px dashed var(--border)", background: "#fff", fontSize: 12, fontWeight: 600, color: "var(--primary)", fontFamily: "var(--font-sans)", cursor: "pointer" }}>
                <option value="">+ Registered PA / NP</option>
                {addable.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
              <Icon name="chevron-down" size={12} color="var(--primary)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
            </div>
          )}
        </div>
        {/* manual add — for people not in the system / not on Amion */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 9 }}>
          <div style={{ flex: 1, maxWidth: 280 }}><Field value={mlName} onChange={setMlName} placeholder="Add PA/NP by name (manual)" icon="user-plus" /></div>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <select value={mlRole} onChange={(e) => setMlRole(e.target.value)}
              style={{ appearance: "none", WebkitAppearance: "none", height: 40, padding: "0 26px 0 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--input)", background: "#fff", fontSize: 13, fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-sans)", cursor: "pointer" }}>
              <option value="NP">NP</option><option value="PA">PA</option><option value="RN">RN</option>
            </select>
            <Icon name="chevron-down" size={13} color="var(--muted-foreground)" style={{ position: "absolute", right: 8, pointerEvents: "none" }} />
          </div>
          <Button size="sm" icon="plus" onClick={addManualMl}>Add</Button>
        </div>
      </div>
    </Card>
  );
}

function ConsultServices() {
  const st = useStore();
  const a = useActions();
  const services = st.consultServices || [];
  const directory = st.directory || [];
  const [name, setName] = React.useState("");

  const role = (st.session || {}).role;
  const canDelete = role === "director" || role === "developer";

  const providerOpts = directory.map((d) => ({ name: d.name, avatar: d.avatar, specialty: d.specialty }));
  const midlevelOpts = directory.filter((d) => /^(PA|NP|RN)$/.test(d.credential)).map((d) => ({ id: "ml" + d.id, name: d.name, avatar: d.avatar, role: d.credential }));

  const add = () => { if (name.trim()) { a.addConsultService(name); setName(""); } };

  return (
    <PageWrap>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Consult services</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Curate the services ER physicians can request. Specialist call lists are maintained by hand; the Hospital Medicine on-call syncs from the imported schedule.</div>
      </div>

      <Card style={{ padding: 14, margin: "14px 0" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Field label="Add a consult service" icon="stethoscope" value={name} onChange={setName} placeholder="e.g. Hematology, Orthopedics" />
          </div>
          <Button icon="plus" onClick={add}>Add service</Button>
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {services.length === 0 && <Card style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No consult services yet — add one above.</Card>}
        {services.map((s) => <ConsultServiceRow key={s.id} s={s} providerOpts={providerOpts} midlevelOpts={midlevelOpts} canDelete={canDelete} a={a} />)}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 12, fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
        <Icon name="info" size={13} style={{ marginTop: 1, flex: "none" }} />
        These services appear in the ER physician's intake "Consult services" picker. Pin a consultant (registered or typed in manually), or leave "Auto" to track the imported on-call schedule. PA/NPs can be picked from registered people or typed in by hand.
      </div>
    </PageWrap>
  );
}

Object.assign(window, { ConsultServices });
