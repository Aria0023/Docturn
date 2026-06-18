/* DocTurn web-app UI kit — Appearance & Layout customization.
   Brand name, accent color, corner radius, sidebar style, content width, and
   per-role navigation structure (show/hide + reorder). Store-backed & live:
   every change applies to the whole app immediately and persists. */

const ACCENTS = [
  ["#2563EB", "Blue"], ["#0F766E", "Teal"], ["#7C3AED", "Violet"],
  ["#DB2777", "Pink"], ["#DC2626", "Red"], ["#EA580C", "Orange"],
  ["#0891B2", "Cyan"], ["#475569", "Slate"],
];
const RADII = [["Sharp", 4], ["Rounded", 8], ["Soft", 14]];
const WIDTHS = [["Standard", "standard"], ["Wide", "wide"], ["Full", "full"]];
const SIDEBARS = [["Expanded", "expanded", "panel-left"], ["Compact", "compact", "panel-left-close"]];

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)" }}>
      {options.map((o) => {
        const [label, val, icon] = Array.isArray(o) ? o : [o, o];
        const on = value === val;
        return (
          <button key={val} onClick={() => onChange(val)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)",
              background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--muted-foreground)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
            {icon && <Icon name={icon} size={15} />}{label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, sub, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "15px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ flex: "none" }}>{children}</div>
    </div>
  );
}

function CardHead({ icon, title, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
      <Icon name={icon} size={17} color="var(--primary)" />
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
      {sub && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>· {sub}</span>}
    </div>
  );
}

function Appearance({ theme, role, master, navHidden, navOrder, onSetTheme, onToggleNav, onMoveNav, onReset }) {
  // build ordered, annotated nav list for the structure editor
  const items = navOrder.map((id) => master.find((m) => m.id === id)).filter(Boolean);
  const hiddenItems = master.filter((m) => navHidden.includes(m.id) && m.id !== "dashboard");

  return (
    <PageWrap>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Appearance &amp; layout</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>Customize branding, theme and how the workspace is structured. Changes apply instantly.</div>
        </div>
        <Button variant="outline" size="sm" icon="rotate-ccw" onClick={onReset}>Reset to defaults</Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: 16, alignItems: "start" }}>
        {/* LEFT: controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card style={{ padding: 18 }}>
            <CardHead icon="palette" title="Brand & theme" />
            <Row label="Workspace name" sub="Shown in the sidebar and on login.">
              <div style={{ width: 200 }}><Field icon="type" value={theme.appName} onChange={(v) => onSetTheme({ appName: v || "DocTurn" })} placeholder="DocTurn" /></div>
            </Row>
            <Row label="Accent color" sub="Drives buttons, links and highlights.">
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 220 }}>
                {ACCENTS.map(([hex, name]) => (
                  <button key={hex} title={name} onClick={() => onSetTheme({ accent: hex })}
                    style={{ width: 28, height: 28, borderRadius: "var(--radius-md)", background: hex, cursor: "pointer", border: theme.accent === hex ? "2px solid var(--foreground)" : "2px solid transparent", boxShadow: "0 0 0 1px var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {theme.accent === hex && <Icon name="check" size={15} color="#fff" />}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Corner radius" sub="Roundness of cards, buttons and inputs.">
              <Seg options={RADII} value={theme.radius} onChange={(v) => onSetTheme({ radius: v })} />
            </Row>
          </Card>

          <Card style={{ padding: 18 }}>
            <CardHead icon="layout-dashboard" title="Layout" />
            <Row label="Sidebar" sub="Full labels, or a compact icon rail.">
              <Seg options={SIDEBARS} value={theme.sidebar} onChange={(v) => onSetTheme({ sidebar: v })} />
            </Row>
            <Row label="Content width" sub="Maximum width of page content.">
              <Seg options={WIDTHS} value={theme.contentWidth} onChange={(v) => onSetTheme({ contentWidth: v })} />
            </Row>
          </Card>

          <Card style={{ padding: 18 }}>
            <CardHead icon="list-tree" title="Navigation structure" sub="show, hide & reorder for this role" />
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
              {items.map((it, i) => {
                const locked = it.id === "dashboard";
                return (
                  <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "#fff" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <button onClick={() => onMoveNav(role, navOrder, it.id, -1)} disabled={i === 0}
                        style={{ border: "none", background: "transparent", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "var(--border)" : "var(--muted-foreground)", padding: 0, lineHeight: 0 }}><Icon name="chevron-up" size={15} /></button>
                      <button onClick={() => onMoveNav(role, navOrder, it.id, 1)} disabled={i === items.length - 1}
                        style={{ border: "none", background: "transparent", cursor: i === items.length - 1 ? "default" : "pointer", color: i === items.length - 1 ? "var(--border)" : "var(--muted-foreground)", padding: 0, lineHeight: 0 }}><Icon name="chevron-down" size={15} /></button>
                    </div>
                    <Icon name={it.icon} size={17} color="var(--muted-foreground)" />
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{it.label}</span>
                    {locked
                      ? <span style={{ fontSize: 11, color: "var(--muted-foreground)", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="lock" size={12} />Home</span>
                      : <button onClick={() => onToggleNav(role, it.id)} title="Hide from navigation"
                          style={{ border: "1px solid var(--border)", background: "#fff", borderRadius: "var(--radius-md)", cursor: "pointer", padding: "4px 8px", fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="eye" size={13} />Visible</button>}
                  </div>
                );
              })}
            </div>
            {hiddenItems.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)", marginBottom: 8 }}>Hidden</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {hiddenItems.map((it) => (
                    <button key={it.id} onClick={() => onToggleNav(role, it.id)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", border: "1px dashed var(--border)", borderRadius: "var(--radius-full)", background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--muted-foreground)", fontFamily: "var(--font-sans)" }}>
                      <Icon name="plus" size={13} color="var(--primary)" />{it.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT: live preview */}
        <div style={{ position: "sticky", top: 84 }}>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 7 }}>
              <Icon name="eye" size={15} color="var(--muted-foreground)" />
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Live preview</span>
            </div>
            <div style={{ display: "flex", height: 320, background: "var(--secondary)" }}>
              {/* mini sidebar */}
              <div style={{ width: theme.sidebar === "compact" ? 52 : 128, flex: "none", background: "#fff", borderRight: "1px solid var(--border)", padding: theme.sidebar === "compact" ? "12px 0" : 12, display: "flex", flexDirection: "column", gap: 6, alignItems: theme.sidebar === "compact" ? "center" : "stretch", transition: "width .2s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, justifyContent: theme.sidebar === "compact" ? "center" : "flex-start" }}>
                  <span style={{ width: 22, height: 22, borderRadius: "var(--radius-sm)", background: "var(--primary)", color: "#fff", fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{(theme.appName || "D").charAt(0).toUpperCase()}</span>
                  {theme.sidebar !== "compact" && <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "-.02em", whiteSpace: "nowrap", overflow: "hidden" }}>{theme.appName}</span>}
                </div>
                {items.slice(0, 5).map((it, i) => (
                  <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: theme.sidebar === "compact" ? "7px 0" : "7px 9px", justifyContent: theme.sidebar === "compact" ? "center" : "flex-start", borderRadius: "var(--radius-md)", background: i === 0 ? "var(--primary-tint, #EFF6FF)" : "transparent", color: i === 0 ? "var(--primary)" : "var(--muted-foreground)" }}>
                    <Icon name={it.icon} size={15} />
                    {theme.sidebar !== "compact" && <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>{it.label}</span>}
                  </div>
                ))}
              </div>
              {/* mini content */}
              <div style={{ flex: 1, padding: 14, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <div style={{ flex: 1, height: 44, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }} />
                  <div style={{ flex: 1, height: 44, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }} />
                </div>
                <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 12, marginBottom: 12 }}>
                  <div style={{ width: "55%", height: 9, background: "var(--secondary)", borderRadius: 99, marginBottom: 8 }} />
                  <div style={{ width: "85%", height: 7, background: "var(--secondary)", borderRadius: 99, marginBottom: 6 }} />
                  <div style={{ width: "70%", height: 7, background: "var(--secondary)", borderRadius: 99 }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ padding: "7px 14px", borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 600 }}>Primary</span>
                  <span style={{ padding: "7px 14px", borderRadius: "var(--radius-md)", background: "#fff", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, fontWeight: 600 }}>Secondary</span>
                  <span style={{ padding: "5px 11px", borderRadius: "var(--radius-full)", background: "var(--primary-tint, #EFF6FF)", color: "var(--primary)", fontSize: 11.5, fontWeight: 700, alignSelf: "center" }}>Badge</span>
                </div>
              </div>
            </div>
          </Card>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 12, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            <Icon name="info" size={14} style={{ marginTop: 1, flex: "none" }} />
            <span>Branding, theme and content width apply across every portal. Navigation structure is saved per role.</span>
          </div>
        </div>
      </div>
    </PageWrap>
  );
}

Object.assign(window, { Appearance });
