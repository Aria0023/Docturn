/* DocTurn web-app UI kit — Patient Board (hospital-wide distribution).
   Shows every distributed patient: who is responsible (attending + on-call unit),
   consultants, and the admitting source. Works two ways:
     • EHR connected (FHIR) — census auto-syncs from the hospital system.
     • Manual — admissions are added, edited, reassigned and removed by hand.
   Lists admissions given + their acceptance status; directors can fully edit. */

function BoardWrap({ children }) {
  return <div style={{ padding: 28, maxWidth: 1220, margin: "0 auto" }}>{children}</div>;
}

function AvatarStack({ lead, unit }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <Avatar initials={lead.avatar} size={30} tint="blue" />
      {unit && unit.map((u, i) => (
        <span key={i} style={{ marginLeft: -8, border: "2px solid #fff", borderRadius: "99px", display: "inline-flex" }}>
          <Avatar initials={u.avatar} size={26} tint={(window.TEAM_ROLE[u.role] || {}).tint || "slate"} />
        </span>
      ))}
    </div>
  );
}

const BOARD_STATUS = {
  admitted:    { status: "accepted", label: "Admitted" },
  observation: { status: "active",   label: "Observation" },
  pending:     { status: "pending",  label: "Awaiting accept" },
  transfer:    { status: "offline",  label: "Transfer" },
};

function BoardReassign({ providers, onPick, label }) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", marginTop: 2 }}>
      <Icon name="repeat" size={11} color="var(--primary)" style={{ position: "absolute", left: 8, pointerEvents: "none" }} />
      <select value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
        style={{ appearance: "none", WebkitAppearance: "none", height: 26, padding: "0 22px 0 24px", borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)", background: "#fff", fontSize: 11.5, fontWeight: 600, color: "var(--primary)", fontFamily: "var(--font-sans)", cursor: "pointer" }}>
        <option value="">{label}</option>
        {providers.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
      </select>
      <Icon name="chevron-down" size={11} color="var(--muted-foreground)" style={{ position: "absolute", right: 7, pointerEvents: "none" }} />
    </div>
  );
}

function BoardStatusSelect({ value, onChange }) {
  const opts = [["admitted", "Admitted"], ["observation", "Observation"], ["pending", "Awaiting accept"], ["transfer", "Transfer"]];
  const bs = BOARD_STATUS[value] || BOARD_STATUS.admitted;
  const pal = (window.STATUS[bs.status] || {});
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ appearance: "none", WebkitAppearance: "none", height: 26, padding: "0 22px 0 10px", borderRadius: "var(--radius-full)",
          border: "none", background: pal.bg, color: pal.fg, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Icon name="chevron-down" size={11} color={pal.fg} style={{ position: "absolute", right: 7, pointerEvents: "none" }} />
    </div>
  );
}

function DataSourceBanner({ fhir, canEdit, onConnect, onDisconnect, onSync }) {
  const connected = fhir && fhir.connected;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 16px", marginBottom: 18, borderRadius: "var(--radius-lg)",
      background: connected ? "var(--status-accepted-bg)" : "var(--secondary)", border: `1px solid ${connected ? "var(--status-accepted)" : "var(--border)"}` }}>
      <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
        background: connected ? "var(--status-accepted)" : "#fff", color: connected ? "#fff" : "var(--muted-foreground)", border: connected ? "none" : "1px solid var(--border)" }}>
        <Icon name={connected ? "cloud" : "cloud-off"} size={19} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          {connected ? `Live · synced from ${fhir.source}` : "Manual census entry"}
          {connected && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><StatusDot status="online" pulse />{" "}</span>}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          {connected
            ? <>Admissions pull automatically via FHIR · last sync {fhir.lastSync ? dtFmt.ago(fhir.lastSync) : "just now"} · <span className="ds-mono">{fhir.endpoint}</span></>
            : "No EHR connection — add and manage admissions by hand, or connect a FHIR endpoint to auto-sync."}
        </div>
      </div>
      {connected ? (
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          <Button size="sm" variant="outline" icon="refresh-cw" onClick={onSync}>Sync now</Button>
          {canEdit && <Button size="sm" variant="ghost" icon="unplug" onClick={onDisconnect}>Disconnect</Button>}
        </div>
      ) : (
        canEdit && <Button size="sm" icon="plug" onClick={onConnect}>Connect EHR (FHIR)</Button>
      )}
    </div>
  );
}

const DEPT_OPTS = ["MED", "ICU", "TELE", "ER", "SURG"];

function AddAdmissionModal({ providers, onClose, onAdd }) {
  const [f, setF] = React.useState({ initials: "", room: "", dept: "MED", issue: "", attending: "", er: "" });
  const set = (k, v) => setF((p) => Object.assign({}, p, { [k]: v }));
  return (
    <Modal title="Add admission" subtitle="Record a new patient on the board. Leave the attending blank to queue for acceptance." icon="clipboard-plus" onClose={onClose} width={520}
      children={
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 120 }}><Field label="Initials" icon="user" value={f.initials} onChange={(v) => set("initials", v.toUpperCase().slice(0, 3))} placeholder="A.B." /></div>
            <div style={{ width: 110 }}><Field label="Room" icon="door-open" value={f.room} onChange={(v) => set("room", v)} placeholder="318" /></div>
            <DSelect label="Unit" icon="building" value={f.dept} onChange={(v) => set("dept", v)} options={DEPT_OPTS.map((d) => ({ value: d, label: d }))} />
          </div>
          <Field label="Presenting issue" icon="clipboard-list" value={f.issue} onChange={(v) => set("issue", v)} placeholder="e.g. CHF exacerbation" />
          <div style={{ display: "flex", gap: 12 }}>
            <DSelect label="Attending (optional)" icon="stethoscope" value={f.attending} onChange={(v) => set("attending", v)}
              options={[{ value: "", label: "— Queue for acceptance —" }].concat(providers.map((p) => ({ value: p.name, label: p.name })))} />
            <div style={{ flex: 1 }}><Field label="Admitted by" icon="ambulance" value={f.er} onChange={(v) => set("er", v)} placeholder="ER physician / source" /></div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" icon="check" onClick={() => { if (f.initials.trim()) { onAdd(f); onClose(); } else window.DT.actions.toast({ tone: "rejected", title: "Initials required", msg: "Enter the patient's initials." }); }}>Add admission</Button>
          </div>
        </div>
      } />
  );
}

// The board's optional sections. The census table and the tiles/banner that
// summarize it need a live EHR feed, so they carry a "needs EHR/FHIR" note and
// can be switched off until that's wired up.
const BOARD_MODULES = [
  ["admissions",  "Admissions tile", null],
  ["accepted",    "Accepted tile", null],
  ["awaiting",    "Awaiting-acceptance tile", "Needs live census (EHR/FHIR)"],
  ["consultants", "With-consultants tile", "Needs live census (EHR/FHIR)"],
  ["dataSource",  "EHR / FHIR data-source bar", "Needs EHR/FHIR"],
  ["census",      "Patient census table", "Needs live census (EHR/FHIR)"],
];

function BoardCustomize({ modules, onSetModule, onClose }) {
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, width: 300, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", overflow: "hidden" }}>
        <div style={{ padding: "11px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Customize board</div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Show only the sections you use today.</div>
        </div>
        <div style={{ padding: 6 }}>
          {BOARD_MODULES.map(([key, label, note]) => {
            const on = !!modules[key];
            return (
              <button key={key} onClick={() => onSetModule(key, !on)}
                style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", padding: "9px 10px", border: "none", borderRadius: "var(--radius-md)", background: "transparent", cursor: "pointer", fontFamily: "var(--font-sans)" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                <span style={{ width: 18, height: 18, flex: "none", borderRadius: 5, border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`, background: on ? "var(--primary)" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {on && <Icon name="check" size={13} color="#fff" />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{label}</span>
                  {note && <span style={{ display: "block", fontSize: 11, color: "var(--status-pending)", marginTop: 1 }}>{note}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </React.Fragment>
  );
}

function PatientBoard({ patients, role, providers = [], fhir, modules, canCustomize, onSetModule, onReassign, onUpdate, onAdd, onRemove, onConnectFhir, onDisconnectFhir, onSyncFhir, onPurge }) {
  const [query, setQuery] = React.useState("");
  const [dept, setDept] = React.useState("ALL");
  const [adding, setAdding] = React.useState(false);
  const [customizing, setCustomizing] = React.useState(false);
  const M = modules || { admissions: true, accepted: true, awaiting: true, consultants: true, dataSource: true, census: true };
  const DEPTS = ["ALL", "ER", "ICU", "MED", "TELE"];
  const canEdit = (role === "director" || role === "er_director") && onUpdate;

  const rows = patients.filter((p) =>
    (dept === "ALL" || p.dept === dept) &&
    (p.initials.toLowerCase().includes(query.toLowerCase()) ||
     p.issue.toLowerCase().includes(query.toLowerCase()) ||
     p.attending.name.toLowerCase().includes(query.toLowerCase()) ||
     (p.consultants || []).join(" ").toLowerCase().includes(query.toLowerCase())));

  const accepted = patients.filter((p) => p.status === "admitted" || p.status === "observation").length;
  const awaiting = patients.filter((p) => p.status === "pending").length;
  const withConsult = patients.filter((p) => (p.consultants || []).length).length;

  const Th = ({ children, w, grow }) => (
    <span style={{ width: w, flex: grow ? grow + " 1 0" : (w ? "none" : 1), fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)" }}>{children}</span>
  );

  const tiles = [
    ["admissions",  "Admissions", patients.length, "layout-list", "blue"],
    ["accepted",    "Accepted", accepted, "check-circle-2", "emerald"],
    ["awaiting",    "Awaiting acceptance", awaiting, "clock", "amber"],
    ["consultants", "With consultants", withConsult, "users-round", "slate"],
  ].filter((t) => M[t[0]]);

  return (
    <BoardWrap>
      {(canCustomize || onPurge) && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12, position: "relative" }}>
          {onPurge && <Button size="sm" variant="outline" icon="clock" onClick={() => onPurge(24)}>Clear 24h+</Button>}
          {onPurge && <Button size="sm" variant="outline" icon="trash-2" onClick={() => { if (window.confirm("Delete ALL patients on the board? This can't be undone.")) onPurge(0); }}>Clear all</Button>}
          {canCustomize && <Button size="sm" variant="outline" icon="sliders-horizontal" onClick={() => setCustomizing((v) => !v)}>Customize board</Button>}
          {customizing && <BoardCustomize modules={M} onSetModule={onSetModule} onClose={() => setCustomizing(false)} />}
        </div>
      )}

      {M.dataSource && <DataSourceBanner fhir={fhir} canEdit={canEdit} onConnect={onConnectFhir} onDisconnect={onDisconnectFhir} onSync={onSyncFhir} />}

      {tiles.length > 0 && (
        <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
          {tiles.map(([key, label, value, icon, tint]) => <StatTile key={key} label={label} value={value} icon={icon} tint={tint} />)}
        </div>
      )}

      {!M.census && (
        <Card style={{ padding: 22, textAlign: "center", color: "var(--muted-foreground)" }}>
          <Icon name="layout-list" size={22} color="var(--muted-foreground)" />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--foreground)", marginTop: 8 }}>Census table is hidden</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>The live patient census needs an EHR/FHIR connection.{canCustomize ? " Turn it on from “Customize board” once that's wired up." : ""}</div>
        </Card>
      )}

      {M.census && <React.Fragment>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220, maxWidth: 320 }}>
          <Field icon="search" value={query} onChange={setQuery} placeholder="Search patient, attending, issue…" />
        </div>
        <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)" }}>
          {DEPTS.map((d) => {
            const on = dept === d;
            return (
              <button key={d} onClick={() => setDept(d)}
                style={{ padding: "6px 13px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                  background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--muted-foreground)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
                {d === "ALL" ? "All units" : d}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="users" size={15} color="var(--muted-foreground)" />
          <span style={{ fontSize: 13, color: "var(--muted-foreground)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
            {rows.length === patients.length
              ? <><b style={{ color: "var(--foreground)" }}>{patients.length}</b> total</>
              : <><b style={{ color: "var(--foreground)" }}>{rows.length}</b> of {patients.length}</>}
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canEdit && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add admission</Button>}
          {canEdit && <Button size="sm" variant="outline" icon="download" onClick={() => {
            const out = [["patient", "room", "dept", "issue", "status", "attending", "consultants", "admitted_by"]].concat(
              patients.map((p) => [p.initials, p.room, p.dept, p.issue, p.status, p.attending.name || "—", (p.consultants || []).join("; "), p.er.name]));
            const csv = out.map((r) => r.map((c) => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            const link = document.createElement("a"); link.href = url; link.download = "docturn-census.csv"; document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            window.DT.actions.toast({ tone: "accepted", title: "Census exported", msg: patients.length + " patients · docturn-census.csv" });
          }}>Export</Button>}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", borderRadius: "var(--radius-lg)" }}>
      <Card style={{ padding: 0, overflow: "hidden", minWidth: 1080 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>
          <Th w={150}>Patient</Th>
          <Th grow={1.5}>Issue</Th>
          <Th grow={1.4}>Responsible</Th>
          <Th grow={1.2}>Consultants</Th>
          <Th grow={1}>Admitted by</Th>
          <Th w={132}>Status</Th>
          {canEdit && <span style={{ width: 32, flex: "none" }} />}
        </div>

        {rows.map((p, i) => {
          const bs = BOARD_STATUS[p.status] || BOARD_STATUS.admitted;
          return (
            <div key={p.id || i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              {/* Patient */}
              <div style={{ width: 150, flex: "none", display: "flex", alignItems: "center", gap: 11 }}>
                <Avatar initials={p.initials} size={36} tint={p.status === "pending" ? "amber" : "slate"} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    {p.initials}
                    {p.acuity ? <AcuityChip level={p.acuity} size="sm" /> : null}
                    {p.synced && <Icon name="cloud" size={12} color="var(--status-accepted)" title="Synced from EHR" />}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 3 }}>
                    Rm {canEdit ? <EditableText value={p.room} onSave={(v) => onUpdate(p.id, { room: v })} size={11.5} weight={400} color="var(--muted-foreground)" /> : p.room} · {p.dept}
                  </div>
                </div>
              </div>
              {/* Issue */}
              <span style={{ flex: "1.5 1 0", fontSize: 13, color: "var(--foreground)", minWidth: 0, paddingRight: 8 }}>{canEdit ? <EditableText value={p.issue} onSave={(v) => onUpdate(p.id, { issue: v })} size={13} weight={400} multiline /> : p.issue}</span>
              {/* Responsible */}
              <div style={{ flex: "1.4 1 0", minWidth: 0 }}>
                {(p.status === "pending" || p.status === "waiting" || p.status === "rejected" || p.status === "declined" || p.status === "expired" || p.status === "cancelled" || p.status === "unrouted") ? (
                  (function () {
                    const declined = p.status === "rejected" || p.status === "declined" || p.status === "expired" || p.status === "cancelled";
                    const color = declined ? "var(--status-rejected)" : "var(--status-pending)";
                    return canEdit && onReassign ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        {declined && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: color }}><Icon name="x" size={13} />Declined</span>}
                        <BoardReassign providers={providers} onPick={(name) => onReassign(p.id, name)} label={declined ? "Assign…" : "Assign…"} />
                      </div>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: color, fontWeight: 600 }}>
                        <Icon name={declined ? "x" : "loader"} size={14} />{declined ? "Declined — awaiting reassignment" : "Routing…"}
                      </span>
                    );
                  })()
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <AvatarStack lead={p.attending} unit={p.unit} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.attending.name}</div>
                      {canEdit && onReassign
                        ? <BoardReassign providers={providers} onPick={(name) => onReassign(p.id, name)} label="Reassign…" />
                        : <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{p.unit && p.unit.length ? `+ ${p.unit.map((u) => u.role).join(", ")} on unit` : "Solo"}</div>}
                    </div>
                  </div>
                )}
              </div>
              {/* Consultants */}
              <div style={{ flex: "1.2 1 0", minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
                {(p.consultants || []).length === 0
                  ? <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>—</span>
                  : p.consultants.map((c) => {
                    const nm = typeof c === "string" ? c : (c.specialty || c.name || "");
                    return <SpecialtyTag key={nm} name={nm} size="sm" />;
                  })}
              </div>
              {/* Admitted by */}
              <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar initials={p.er.avatar} size={26} tint="slate" />
                <span style={{ fontSize: 12.5, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.er.name}</span>
              </div>
              {/* Status */}
              <span style={{ width: 132, flex: "none" }}>{canEdit ? <BoardStatusSelect value={p.status} onChange={(v) => onUpdate(p.id, { status: v })} /> : <Badge status={bs.status}>{bs.label}</Badge>}</span>
              {/* Remove */}
              {canEdit && (
                <button onClick={() => onRemove(p.id)} title="Remove admission"
                  onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                  style={{ width: 32, height: 32, flex: "none", borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}><Icon name="trash-2" size={16} /></button>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No patients match your filter.</div>
        )}
      </Card>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12, fontSize: 11.5, color: "var(--muted-foreground)" }}>
        <Icon name="lock" size={13} />Patients shown by initials only · access is logged to the PHI audit trail.
      </div>

      {adding && <AddAdmissionModal providers={providers} onAdd={onAdd} onClose={() => setAdding(false)} />}
      </React.Fragment>}
    </BoardWrap>
  );
}

Object.assign(window, { PatientBoard });
