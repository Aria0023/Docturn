/* DocTurn web-app UI kit — Customizable dashboard.
   Renders a role's dashboard from a list of widget panels and lets the user
   drag to reorder, remove, and re-add them. Layout persists per role in the
   store (dashLayout). Each widget is { id, label, icon, node } — the node is a
   plain panel WITHOUT its own PageWrap (this component supplies the page frame).
   Used by the ER physician and ER director dashboards. */

function CustomizableDashboard({ role, widgets }) {
  const a = useActions();
  useStore(); // subscribe so layout changes re-render
  const allIds = widgets.map((w) => w.id);
  const layout = DT.dashLayout(role, allIds);
  const byId = {};
  widgets.forEach((w) => { byId[w.id] = w; });

  const [editing, setEditing] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);

  const hidden = layout.hidden;
  const visible = layout.order.filter((id) => hidden.indexOf(id) < 0 && byId[id]);
  const hiddenWidgets = allIds.filter((id) => hidden.indexOf(id) >= 0 && byId[id]);

  function move(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const order = layout.order.slice();
    const from = order.indexOf(dragId), to = order.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return; }
    order.splice(from, 1);
    order.splice(to, 0, dragId);
    a.setDashOrder(role, order);
    setDragId(null); setOverId(null);
  }

  return (
    <PageWrap>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        {editing && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted-foreground)" }}>
            <Icon name="grip-vertical" size={14} />Drag panels to reorder · remove or add them
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {editing && hiddenWidgets.length > 0 && (
            <div style={{ position: "relative" }}>
              <Button size="sm" variant="outline" icon="plus" onClick={() => setAdding((v) => !v)}>Add panel ({hiddenWidgets.length})</Button>
              {adding && (
                <React.Fragment>
                  <div onClick={() => setAdding(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, width: 260, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", padding: 6 }}>
                    {hiddenWidgets.map((id) => (
                      <button key={id} onClick={() => { a.toggleDashWidget(role, id); setAdding(false); }}
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
          {editing && <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={() => a.resetDashLayout(role)}>Reset</Button>}
          <Button size="sm" variant={editing ? "default" : "outline"} icon={editing ? "check" : "layout-dashboard"} onClick={() => { setEditing((v) => !v); setAdding(false); }}>
            {editing ? "Done" : "Customize layout"}
          </Button>
        </div>
      </div>

      {visible.length === 0 && (
        <Card style={{ padding: 28, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>
          All panels are hidden. {editing ? "Use “Add panel” above to bring them back." : "Click “Customize layout”, then “Add panel”."}
        </Card>
      )}

      {visible.map((id) => {
        const w = byId[id];
        const isOver = overId === id && dragId && dragId !== id;
        return (
          <div key={id}
            draggable={editing}
            onDragStart={editing ? () => setDragId(id) : undefined}
            onDragOver={editing ? (e) => { e.preventDefault(); setOverId(id); } : undefined}
            onDragEnd={editing ? () => { setDragId(null); setOverId(null); } : undefined}
            onDrop={editing ? (e) => { e.preventDefault(); move(id); } : undefined}
            style={{ marginBottom: 18, borderRadius: "var(--radius-lg)", outline: isOver ? "2px dashed var(--primary)" : "none", outlineOffset: 4, opacity: dragId === id ? 0.5 : 1 }}>
            {editing && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", marginBottom: 8, background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", cursor: "grab" }}>
                <Icon name="grip-vertical" size={15} color="var(--muted-foreground)" />
                <Icon name={w.icon || "square"} size={15} color="var(--primary)" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{w.label}</span>
                <button onClick={() => a.toggleDashWidget(role, id)} title="Remove panel"
                  onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                  style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)" }}>
                  <Icon name="eye-off" size={13} />Remove
                </button>
              </div>
            )}
            {/* In edit mode, block inner interactions so dragging is clean. */}
            <div style={{ pointerEvents: editing ? "none" : "auto" }}>{w.node}</div>
          </div>
        );
      })}
    </PageWrap>
  );
}

Object.assign(window, { CustomizableDashboard });
