/* DocTurn web-app UI kit — Director dashboard.
   Director controls the hospitalist group: mass-set the daily census limit (cap),
   edit each provider's census/cap, move providers between defined shifts
   (Day call / Swing / Nights) with editable hours, and manage the round-robin —
   including taking a provider off rotation even while they are on shift. */

function Stepper({ label, value, onDec, onInc }) {
  const btn = { width: 24, height: 24, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", fontWeight: 500 }}>{label}</span>
      <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "#fff", overflow: "hidden" }}>
        <button style={btn} onClick={onDec} onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"} title={`Decrease ${label}`}><Icon name="minus" size={13} /></button>
        <span style={{ minWidth: 22, textAlign: "center", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <button style={btn} onClick={onInc} onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"} title={`Increase ${label}`}><Icon name="plus" size={13} /></button>
      </div>
    </div>
  );
}

function ShiftSelect({ shifts, value, onChange }) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ appearance: "none", WebkitAppearance: "none", height: 28, padding: "0 24px 0 10px", borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)", background: "var(--secondary)", fontSize: 12, fontWeight: 600, color: "var(--foreground)",
          fontFamily: "var(--font-sans)", cursor: "pointer" }}>
        {shifts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <Icon name="chevron-down" size={12} color="var(--muted-foreground)" style={{ position: "absolute", right: 7, pointerEvents: "none" }} />
    </div>
  );
}

function DirectorDashboard({ providers, shifts, settings, onToggleWorking, onAdjustCensus, onAdjustCap, onBulkWorking, onReorder, onToggleRotation, onSetAllCap, onUpdateShift, onSetShift, onAddProvider, onResetRotation, onSetTimeout, onToggleAutoReassign, onUpdateProvider, onRemoveProvider, onRenameShift, onOpenSchedule }) {
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  const [capInput, setCapInput] = React.useState("12");
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", specialty: "Hospital Medicine", cap: "12", shift: "day" });
  const working = providers.filter((p) => p.working);
  const rotation = providers.filter((p) => p.working && p.inRotation);
  const totalCensus = providers.reduce((a, p) => a + p.census, 0);
  const totalCap = providers.reduce((a, p) => a + p.cap, 0);
  const allOn = providers.length > 0 && working.length === providers.length;
  const allOff = working.length === 0;

  const handleDrop = (targetId) => { if (dragId && dragId !== targetId) onReorder(dragId, targetId); setDragId(null); setOverId(null); };

  const SHIFT_TINT = { day: "amber", swing: "blue", night: "slate" };

  return (
    <PageWrap>
      <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
        <StatTile label="Total providers" value={providers.length} icon="users" tint="blue" />
        <StatTile label="Active (on shift)" value={working.length} icon="activity" tint="emerald" />
        <StatTile label="In rotation" value={rotation.length} icon="route" tint="amber" />
        <StatTile label="Total census" value={totalCensus + " / " + totalCap} icon="bed-double" tint="slate" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 18, fontSize: 12, color: "var(--muted-foreground)" }}>
        <Icon name="info" size={13} />
        <span><b style={{ fontWeight: 600, color: "var(--foreground)" }}>{totalCensus}</b> patients across {providers.length} providers · {totalCap - totalCensus} beds open. Census is entered manually for now — automatic <span style={{ fontWeight: 600 }}>EPIC (FHIR)</span> sync is planned.</span>
      </div>

      {/* Schedule source — rotation pool follows the synced on-call grid */}
      <Card style={{ padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "#DBEAFE", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="calendar-clock" size={17} color="var(--primary)" /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span style={{ whiteSpace: "nowrap" }}>On-call schedule synced</span><Badge status="accepted" icon="circle">Amion · 2m ago</Badge></div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>The rotation pool follows the live on-call grid. Toggles below override locally for this shift.</div>
        </div>
        <Button size="sm" variant="outline" icon="settings" onClick={onOpenSchedule}>Manage sync</Button>
      </Card>

      {/* Bulk controls bar */}
      <Card style={{ padding: "14px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="layers" size={16} color="var(--primary)" />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Mass set daily census limit</span>
          <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "#fff" }}>
            <input value={capInput} onChange={(e) => setCapInput(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric"
              style={{ width: 52, height: 34, border: "none", outline: "none", textAlign: "center", fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-sans)" }} />
          </div>
          <Button size="sm" variant="default" icon="check" onClick={() => { const n = parseInt(capInput, 10); if (n > 0) onSetAllCap(n); }}>Apply to all</Button>
        </div>
        <div style={{ width: 1, height: 28, background: "var(--border)" }} />
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <Button size="sm" variant="outline" icon="toggle-left" onClick={() => onBulkWorking(false)} style={allOff ? { opacity: .5 } : null}>All off shift</Button>
          <Button size="sm" variant="outline" icon="toggle-right" onClick={() => onBulkWorking(true)} style={allOn ? { opacity: .5 } : null}>All on shift</Button>
          <Button size="sm" variant="default" icon="user-plus" onClick={() => setAdding(true)}>Add provider</Button>
        </div>
      </Card>

      {/* Provider management grouped by shift — full width, compact rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 18 }}>
        {shifts.map((shift) => {
          const group = providers.filter((p) => p.shift === shift.id);
          return (
            <div key={shift.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, padding: "0 2px" }}>
                <Avatar initials="" size={10} tint={SHIFT_TINT[shift.id]} />
                <EditableText value={shift.label} onSave={(val) => onRenameShift(shift.id, val)} size={14} weight={700} />
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2 }}>
                  <Icon name="clock" size={13} color="var(--muted-foreground)" />
                  <input type="time" value={shift.start} onChange={(e) => onUpdateShift(shift.id, { start: e.target.value })} style={timeStyle} />
                  <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>–</span>
                  <input type="time" value={shift.end} onChange={(e) => onUpdateShift(shift.id, { end: e.target.value })} style={timeStyle} />
                </div>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)", marginLeft: "auto", fontWeight: 600 }}>{group.length} provider{group.length === 1 ? "" : "s"}</span>
              </div>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {group.length === 0 && <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--muted-foreground)" }}>No providers on this shift.</div>}
                {group.map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                    <Avatar initials={p.avatar} size={34} tint={p.working ? "emerald" : "slate"} />
                    <div style={{ width: 188, flex: "none", minWidth: 0 }}>
                      <EditableText value={p.name} onSave={(val) => onUpdateProvider(p.id, { name: val })} size={13.5} weight={600} />
                      <div><EditableText value={p.specialty} onSave={(val) => onUpdateProvider(p.id, { specialty: val })} size={12} weight={400} color="var(--muted-foreground)" placeholder="Add specialty" /></div>
                    </div>
                    <ShiftSelect shifts={shifts} value={p.shift} onChange={(sid) => onSetShift(p.id, sid)} />
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 18 }}>
                      <Stepper label="Census" value={p.census} onDec={() => onAdjustCensus(p.id, -1)} onInc={() => onAdjustCensus(p.id, 1)} />
                      <Stepper label="Cap" value={p.cap} onDec={() => onAdjustCap(p.id, -1)} onInc={() => onAdjustCap(p.id, 1)} />
                      <div style={{ width: 1, height: 24, background: "var(--border)" }} />
                      <button onClick={() => onToggleRotation(p.id)} title={p.inRotation ? "In round-robin — click to remove" : "Off rotation — click to add"}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-sans)",
                          border: `1px solid ${p.inRotation ? "var(--primary)" : "var(--border)"}`, background: p.inRotation ? "var(--primary-tint, #EFF6FF)" : "#fff", color: p.inRotation ? "var(--primary)" : "var(--muted-foreground)" }}>
                        <Icon name={p.inRotation ? "route" : "route-off"} size={12} />{p.inRotation ? "Rotation" : "Off"}
                      </button>
                      <button onClick={() => onToggleWorking(p.id)} title="Toggle shift"
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: "none", background: "transparent", fontFamily: "var(--font-sans)" }}>
                        <span style={{ width: 40, height: 24, borderRadius: 99, position: "relative", flex: "none", background: p.working ? "var(--status-accepted)" : "var(--status-neutral-bg)", transition: "background .2s" }}>
                          <span style={{ position: "absolute", top: 3, left: p.working ? 19 : 3, width: 18, height: 18, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
                        </span>
                        <span style={{ fontSize: 11, width: 38, textAlign: "left", color: p.working ? "var(--status-accepted)" : "var(--muted-foreground)", fontWeight: 600 }}>{p.working ? "On" : "Off"}</span>
                      </button>
                      <button onClick={() => onRemoveProvider(p.id)} title="Remove provider"
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                        style={{ width: 28, height: 28, flex: "none", borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}><Icon name="trash-2" size={15} /></button>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          );
        })}
      </div>

      {/* Round-robin config + drag-and-drop order */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
          <Card style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Icon name="route" size={18} color="var(--primary)" />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Round-robin config</h3>
            </div>
            <Field label="Assignment timeout (min)" icon="timer" value={String((settings && settings.timeout) != null ? settings.timeout : 10)} onChange={(v) => onSetTimeout && onSetTimeout(parseInt(v.replace(/[^0-9]/g, ""), 10) || 0)} help="Unanswered requests re-route after this." />
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Auto-reassign on expiry</div>
              <button onClick={onToggleAutoReassign}
                style={{ width: 44, height: 26, borderRadius: 99, border: "none", cursor: "pointer", position: "relative",
                  background: (settings && settings.autoReassign) ? "var(--status-accepted)" : "var(--status-neutral-bg)", transition: "background .2s" }}>
                <span style={{ position: "absolute", top: 3, left: (settings && settings.autoReassign) ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .2s" }} />
              </button>
            </div>
            <div style={{ marginTop: 16 }}>
              <Button variant="outline" size="sm" full icon="rotate-ccw" onClick={onResetRotation}>Reset rotation index</Button>
            </div>
          </Card>

          <Card style={{ padding: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>Rotation order</h3>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 12px" }}>On-shift providers in rotation. Drag to reorder; toggle a provider off rotation in their row at left.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rotation.length === 0 && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "6px 2px" }}>No providers in rotation.</div>}
              {rotation.map((p, i) => (
                <div key={p.id}
                  draggable
                  onDragStart={() => setDragId(p.id)}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  onDragOver={(e) => { e.preventDefault(); if (overId !== p.id) setOverId(p.id); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(p.id); }}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", border: `1px solid ${overId === p.id && dragId !== p.id ? "var(--primary)" : "var(--border)"}`, borderRadius: "var(--radius-md)",
                    background: dragId === p.id ? "var(--secondary)" : (i === 0 ? "#EFF6FF" : "#fff"),
                    opacity: dragId === p.id ? 0.5 : 1, cursor: "grab", transition: "border-color .12s, background .12s" }}>
                  <Icon name="grip-vertical" size={15} color="var(--muted-foreground)" />
                  <span style={{ width: 20, height: 20, borderRadius: 99, background: i === 0 ? "var(--primary)" : "var(--secondary)", color: i === 0 ? "#fff" : "var(--muted-foreground)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>{p.census}/{p.cap}</span>
                  {i === 0 && <Badge status="sent">Next up</Badge>}
                </div>
              ))}
            </div>
            {working.length > rotation.length && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border)", fontSize: 12, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="route-off" size={13} />
                {working.length - rotation.length} on shift but off rotation
              </div>
            )}
          </Card>
      </div>
      {adding && (
        <Modal title="Add provider" subtitle="They join the rotation on the selected shift." icon="user-plus" onClose={() => setAdding(false)}
          children={
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Full name" icon="user" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Dr. Jane Smith / Priya Shah, NP" />
              <Field label="Specialty" icon="stethoscope" value={form.specialty} onChange={(v) => setForm({ ...form, specialty: v })} placeholder="e.g. Cardiology" />
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ width: 120 }}><Field label="Patient cap" icon="gauge" value={form.cap} onChange={(v) => setForm({ ...form, cap: v.replace(/[^0-9]/g, "") })} /></div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Shift</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {shifts.map((s) => (
                      <button key={s.id} onClick={() => setForm({ ...form, shift: s.id })}
                        style={{ flex: 1, padding: "9px 8px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                          border: form.shift === s.id ? "1px solid var(--primary)" : "1px solid var(--border)", background: form.shift === s.id ? "#EFF6FF" : "#fff", color: form.shift === s.id ? "var(--primary)" : "var(--foreground)" }}>{s.label}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" icon="check" onClick={() => { if (form.name.trim()) { onAddProvider(form); setForm({ name: "", specialty: "Hospital Medicine", cap: "12", shift: "day" }); setAdding(false); } else window.DT.actions.toast({ tone: "rejected", title: "Name required", msg: "Enter the provider's name." }); }}>Add provider</Button>
              </div>
            </div>
          } />
      )}
    </PageWrap>
  );
}

const timeStyle = { height: 24, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "#fff", fontSize: 11.5, fontFamily: "var(--font-sans)", color: "var(--foreground)", padding: "0 4px", fontVariantNumeric: "tabular-nums" };

Object.assign(window, { DirectorDashboard });
