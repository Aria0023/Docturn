/* DocTurn web-app UI kit — Customizable stat-tile strip.
   A reusable KPI row that lets the user show/hide, drag-reorder and reset the
   individual stat tiles — the tile-level analog of CustomizableDashboard's panel
   customization. Layout persists per string key in the store (statLayout).
   `stats` = [{ id, label, value, icon, tint, sub }] (value already formatted).
   Users can also BUILD their own tiles ("+ New stat") — either mirroring a live
   metric from `metrics` (the dashboard's catalog) or showing a value they type.
   Custom tiles persist per key in the store (customStats) and can be deleted.
   The "Customize" affordance is deliberately subtle so it doesn't clutter the
   dashboard for people who never touch it. */

// Icon / color choices offered in the "+ New stat" builder.
const CUSTOM_STAT_ICONS = ["activity", "users", "bed-double", "timer", "stethoscope", "message-square", "siren", "gauge", "bar-chart-2", "percent"];
const CUSTOM_STAT_TINTS = [
  { id: "blue", label: "Blue" },
  { id: "emerald", label: "Green" },
  { id: "amber", label: "Amber" },
  { id: "slate", label: "Slate" },
];
const CUSTOM_SELECT_STYLE = {
  appearance: "none", WebkitAppearance: "none", width: "100%", height: 36, padding: "0 28px 0 10px",
  borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: 13,
  fontWeight: 600, color: "var(--foreground)", fontFamily: "var(--font-sans)", cursor: "pointer",
};

function CustomStatSelect({ value, onChange, children }) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={CUSTOM_SELECT_STYLE}>{children}</select>
      <Icon name="chevron-down" size={13} color="var(--muted-foreground)" style={{ position: "absolute", right: 9, pointerEvents: "none" }} />
    </div>
  );
}

function CustomizableStats({ statKey, stats, metrics }) {
  const a = useActions();
  useStore(); // subscribe so layout + custom-stat changes re-render
  const catalog = metrics || [];

  // Merge predefined tiles with the user's custom tiles into one render list —
  // every tile (custom ids like "custom:cs_…" included) flows through the same
  // statLayout order/hidden machinery below.
  const predefined = (stats || []).map((s) => Object.assign({}, s, { custom: false }));
  const custom = DT.customStats(statKey).map((c) => {
    let value;
    if (c.source === "metric") {
      const hit = catalog.filter((m) => m.key === c.metricKey)[0];
      value = hit ? hit.value : "—";
    } else {
      value = c.manualValue;
    }
    return { id: c.id, label: c.label, value: value, icon: c.icon || "activity", tint: c.tint || "blue", sub: undefined, custom: true };
  });
  const allStats = predefined.concat(custom);
  const allIds = allStats.map((s) => s.id);
  const layout = DT.statLayout(statKey, allIds);
  const byId = {};
  allStats.forEach((s) => { byId[s.id] = s; });

  const [editing, setEditing] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [building, setBuilding] = React.useState(false);
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);

  // "+ New stat" builder form. Default the source to the first catalog metric,
  // or "manual" when this dashboard offers no catalog.
  const blankForm = () => ({ label: "", source: catalog.length ? catalog[0].key : "__manual", manualValue: "", icon: "activity", tint: "blue" });
  const [form, setForm] = React.useState(blankForm);
  const isManual = form.source === "__manual";
  const canCreate = form.label.trim().length > 0 && (isManual ? form.manualValue.trim().length > 0 : catalog.length > 0);

  function submitCustom() {
    if (!canCreate) return;
    const def = isManual
      ? { label: form.label.trim(), source: "manual", metricKey: null, manualValue: form.manualValue.trim(), icon: form.icon, tint: form.tint }
      : { label: form.label.trim(), source: "metric", metricKey: form.source, manualValue: "", icon: form.icon, tint: form.tint };
    a.addCustomStat(statKey, def);
    setForm(blankForm());
    setBuilding(false);
  }

  const hidden = layout.hidden;
  const visible = layout.order.filter((id) => hidden.indexOf(id) < 0 && byId[id]);
  const hiddenStats = allIds.filter((id) => hidden.indexOf(id) >= 0 && byId[id]);

  function move(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const order = layout.order.slice();
    const from = order.indexOf(dragId), to = order.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return; }
    order.splice(from, 1);
    order.splice(to, 0, dragId);
    a.setStatOrder(statKey, order);
    setDragId(null); setOverId(null);
  }

  return (
    <div>
      {/* subtle control row above the tiles */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {editing && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted-foreground)" }}>
            <Icon name="grip-vertical" size={13} />Drag to reorder · remove, add or build stats
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {editing && (
            <div style={{ position: "relative" }}>
              <Button size="sm" variant="outline" icon="plus" onClick={() => { setBuilding((v) => !v); setAdding(false); }}>New stat</Button>
              {building && (
                <React.Fragment>
                  <div onClick={() => setBuilding(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, width: 300, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", padding: 14 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12 }}>Build a stat box</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 5 }}>Label</label>
                        <input value={form.label} onChange={(e) => setForm(Object.assign({}, form, { label: e.target.value }))} placeholder="e.g. Beds open"
                          style={{ width: "100%", height: 36, padding: "0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontFamily: "var(--font-sans)", color: "var(--foreground)", outline: "none" }} />
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 5 }}>Show</label>
                        <CustomStatSelect value={form.source} onChange={(v) => setForm(Object.assign({}, form, { source: v }))}>
                          {catalog.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                          <option value="__manual">Manual value…</option>
                        </CustomStatSelect>
                      </div>
                      {isManual && (
                        <div>
                          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 5 }}>Value</label>
                          <input value={form.manualValue} onChange={(e) => setForm(Object.assign({}, form, { manualValue: e.target.value }))} placeholder="e.g. 42 or “On track”"
                            style={{ width: "100%", height: 36, padding: "0 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", fontSize: 13, fontFamily: "var(--font-sans)", color: "var(--foreground)", outline: "none" }} />
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 5 }}>Icon</label>
                          <CustomStatSelect value={form.icon} onChange={(v) => setForm(Object.assign({}, form, { icon: v }))}>
                            {CUSTOM_STAT_ICONS.map((n) => <option key={n} value={n}>{n}</option>)}
                          </CustomStatSelect>
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 5 }}>Color</label>
                          <CustomStatSelect value={form.tint} onChange={(v) => setForm(Object.assign({}, form, { tint: v }))}>
                            {CUSTOM_STAT_TINTS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </CustomStatSelect>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
                        <Button size="sm" variant="outline" onClick={() => setBuilding(false)}>Cancel</Button>
                        <Button size="sm" icon="check" onClick={submitCustom} style={canCreate ? null : { opacity: 0.5, pointerEvents: "none" }}>Create</Button>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              )}
            </div>
          )}
          {editing && hiddenStats.length > 0 && (
            <div style={{ position: "relative" }}>
              <Button size="sm" variant="outline" icon="plus" onClick={() => { setAdding((v) => !v); setBuilding(false); }}>Add stat ({hiddenStats.length})</Button>
              {adding && (
                <React.Fragment>
                  <div onClick={() => setAdding(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, width: 260, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", padding: 6 }}>
                    {hiddenStats.map((id) => (
                      <button key={id} onClick={() => { a.toggleStat(statKey, id); setAdding(false); }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "9px 10px", border: "none", borderRadius: "var(--radius-md)", background: "transparent", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600 }}>
                        <Icon name={byId[id].icon || "square"} size={15} color="var(--muted-foreground)" />
                        <span style={{ flex: 1, minWidth: 0 }}>{byId[id].label}</span>
                        <Icon name="plus" size={14} color="var(--primary)" />
                      </button>
                    ))}
                  </div>
                </React.Fragment>
              )}
            </div>
          )}
          {editing && <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={() => a.resetStatLayout(statKey)}>Reset</Button>}
          <Button size="sm" variant={editing ? "default" : "ghost"} icon={editing ? "check" : "sliders-horizontal"} onClick={() => { setEditing((v) => !v); setAdding(false); setBuilding(false); }}>
            {editing ? "Done" : "Customize"}
          </Button>
        </div>
      </div>

      {visible.length === 0 && (
        <Card style={{ padding: 16, textAlign: "center", color: "var(--muted-foreground)", fontSize: 12.5, marginBottom: 18 }}>
          All stats hidden — {editing ? "“Add stat” to bring them back." : "“Customize”, then “Add stat” to bring them back."}
        </Card>
      )}

      {visible.length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
          {visible.map((id) => {
            const s = byId[id];
            const isOver = overId === id && dragId && dragId !== id;
            return (
              <div key={id}
                draggable={editing}
                onDragStart={editing ? () => setDragId(id) : undefined}
                onDragOver={editing ? (e) => { e.preventDefault(); setOverId(id); } : undefined}
                onDragEnd={editing ? () => { setDragId(null); setOverId(null); } : undefined}
                onDrop={editing ? (e) => { e.preventDefault(); move(id); } : undefined}
                style={{ position: "relative", flex: 1, minWidth: 180, display: "flex", borderRadius: "var(--radius-lg)", outline: isOver ? "2px dashed var(--primary)" : "none", outlineOffset: 3, opacity: dragId === id ? 0.5 : 1, cursor: editing ? "grab" : "default" }}>
                {editing && s.custom && (
                  <button onClick={() => a.removeCustomStat(statKey, id)} title="Delete custom stat"
                    onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                    style={{ position: "absolute", top: 6, right: 6, zIndex: 2, width: 24, height: 24, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
                    <Icon name="trash-2" size={13} />
                  </button>
                )}
                {editing && !s.custom && (
                  <button onClick={() => a.toggleStat(statKey, id)} title="Hide stat"
                    onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                    style={{ position: "absolute", top: 6, right: 6, zIndex: 2, width: 24, height: 24, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
                    <Icon name="eye-off" size={13} />
                  </button>
                )}
                {/* In edit mode, block inner interactions so dragging is clean. */}
                <div style={{ pointerEvents: editing ? "none" : "auto", display: "flex", flex: 1, minWidth: 0 }}>
                  <StatTile label={s.label} value={s.value} icon={s.icon} tint={s.tint} sub={s.sub} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { CustomizableStats });
