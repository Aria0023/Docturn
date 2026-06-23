/* DocTurn web-app UI kit — app shell: sidebar + topbar */

// Reactive viewport check so layouts can switch to a phone-friendly form.
function useIsMobile(bp) {
  var q = "(max-width: " + (bp || 760) + "px)";
  var read = function () { try { return window.matchMedia(q).matches; } catch (e) { return false; } };
  var ref = React.useState(read);
  var m = ref[0], setM = ref[1];
  React.useEffect(function () {
    var mq = window.matchMedia(q);
    var on = function () { setM(mq.matches); };
    if (mq.addEventListener) mq.addEventListener("change", on); else mq.addListener(on);
    on();
    return function () { if (mq.removeEventListener) mq.removeEventListener("change", on); else mq.removeListener(on); };
  }, [q]);
  return m;
}

function Sidebar({ role, nav, active, onNav, me, onLogout, onRenameMe, compact, appName }) {
  const who = me || { name: "Dr. Jordan Chen", avatar: "JC" };
  const name = appName || "DocTurn";
  return (
    <aside style={{ width: compact ? 68 : 232, flex: "none", background: "#fff", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0, transition: "width .2s" }}>
      <div style={{ padding: compact ? "18px 0 14px" : "18px 18px 14px", display: "flex", alignItems: "center", justifyContent: compact ? "center" : "flex-start", gap: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, flex: "none" }}>{name.charAt(0).toUpperCase()}</span>
        {!compact && <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em" }}>{name}</span>}
      </div>
      <nav style={{ padding: compact ? "6px 10px" : "6px 12px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {nav.map((item) => {
          const on = active === item.id;
          return (
            <button key={item.id} onClick={() => onNav(item.id)} title={compact ? item.label : undefined}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--secondary)"; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
              style={{ display: "flex", alignItems: "center", gap: 11, padding: compact ? "10px 0" : "9px 12px", justifyContent: compact ? "center" : "flex-start", borderRadius: "var(--radius-md)",
                border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500, textAlign: "left", position: "relative",
                background: on ? "var(--primary-tint, #EFF6FF)" : "transparent", color: on ? "var(--primary)" : "var(--foreground)" }}>
              <Icon name={item.icon} size={18} />
              {!compact && <span style={{ flex: 1 }}>{item.label}</span>}
              {!compact && item.badge ? <Badge status="pending">{item.badge}</Badge> : null}
              {compact && item.badge ? <span style={{ position: "absolute", top: 5, right: 12, width: 7, height: 7, borderRadius: 99, background: "var(--destructive)" }} /> : null}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: compact ? 0 : "8px 10px", justifyContent: compact ? "center" : "flex-start", borderRadius: "var(--radius-md)" }}>
          <Avatar initials={who.avatar} size={34} />
          {!compact && <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden" }}>
              {onRenameMe ? <EditableText value={who.name} onSave={onRenameMe} size={13} weight={600} /> : <span style={{ fontWeight: 600 }}>{who.name}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{role.replace("_", " ")}</div>
          </div>}
          {!compact && <button onClick={onLogout} title="Sign out"
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
            <Icon name="log-out" size={16} />
          </button>}
        </div>
      </div>
    </aside>
  );
}

function Topbar({ title, subtitle, working, onToggleWorking, right, onBell, notifCount = 0, onLock }) {
  return (
    <header style={{ height: 64, borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,.85)", backdropFilter: "blur(6px)", position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px" }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{subtitle}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {right}
        {onToggleWorking && (
          <button onClick={onToggleWorking} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
            <StatusDot status={working ? "online" : "offline"} pulse={working} />
            {working ? "On shift" : "Off shift"}
          </button>
        )}
        <button onClick={onBell} title="Notifications"
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
          style={{ position: "relative", width: 38, height: 38, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="bell" size={18} color="var(--foreground)" />
          {notifCount > 0 && <span style={{ position: "absolute", top: -5, right: -5, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 99, background: "var(--destructive)", color: "#fff", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff" }}>{notifCount}</span>}
        </button>
        {onLock && (
          <button onClick={onLock} title="Lock app"
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
            style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="lock" size={17} color="var(--foreground)" />
          </button>
        )}
      </div>
    </header>
  );
}

function PageWrap({ children }) {
  var mobile = useIsMobile();
  return <div style={{ padding: mobile ? "16px 14px" : 28, maxWidth: "var(--content-max, 1040px)", margin: "0 auto" }}>{children}</div>;
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 14px" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{children}</h2>
      {action}
    </div>
  );
}

function hexToHsl(hex) {
  var m = (hex || "").replace("#", "");
  if (m.length === 3) m = m.split("").map(function (c) { return c + c; }).join("");
  var r = parseInt(m.slice(0, 2), 16) / 255, g = parseInt(m.slice(2, 4), 16) / 255, b = parseInt(m.slice(4, 6), 16) / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0, l = (max + min) / 2, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Imperatively apply the theme to :root CSS variables (whole-app recolor).
function applyTheme(theme) {
  if (!theme) return;
  var root = document.documentElement.style;
  var hsl = hexToHsl(theme.accent || "#2563EB");
  var ch = hsl.h + " " + hsl.s + "% " + hsl.l + "%";
  root.setProperty("--primary-ch", ch);
  root.setProperty("--ring-ch", ch);
  root.setProperty("--primary", "hsl(" + ch + ")");
  root.setProperty("--ring", "hsl(" + ch + ")");
  root.setProperty("--status-active", theme.accent || "#2563EB");
  // soft + faint accent tints used for active surfaces
  root.setProperty("--primary-tint", "hsl(" + hsl.h + " " + Math.min(hsl.s, 90) + "% 95%)");
  root.setProperty("--primary-tint-2", "hsl(" + hsl.h + " " + Math.min(hsl.s, 90) + "% 90%)");
  root.setProperty("--radius", ((theme.radius != null ? theme.radius : 8) / 16) + "rem");
  root.setProperty("--content-max", theme.contentWidth === "wide" ? "1280px" : (theme.contentWidth === "full" ? "100%" : "1040px"));
}

function ThemeStyle({ theme }) {
  React.useEffect(function () { applyTheme(theme); }, [theme && theme.accent, theme && theme.radius, theme && theme.contentWidth]);
  return null;
}

Object.assign(window, { Sidebar, Topbar, PageWrap, SectionTitle, applyTheme, ThemeStyle, hexToHsl, useIsMobile });
