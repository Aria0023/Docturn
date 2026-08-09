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
          {!compact && <DndButton />}
          {!compact && <ChangePasswordButton />}
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

// Do-not-disturb with covering-provider forwarding. DND alone is clinically
// unsafe, so enabling it asks who covers: messages to you forward to them, and
// on-call roles you hold resolve to them while you're away.
function DndButton() {
  const st = useStore();
  const a = useActions();
  const prefs = st.myPrefs || { dnd: false, coveringUserId: null };
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const people = (st.directory || []).filter((d) => d.id !== (st.me && st.me.id) &&
    (!q || (d.name || "").toLowerCase().includes(q.toLowerCase()) || (d.specialty || "").toLowerCase().includes(q.toLowerCase())));
  const coveringName = (() => { const c = (st.directory || []).find((d) => d.id === prefs.coveringUserId); return c ? c.name : null; })();
  function enable(coverId) {
    if (coverId != null) a.setMyPref("coveringUserId", coverId);
    a.setMyPref("dnd", true);
    setOpen(false);
    a.toast({ tone: "accepted", title: "Do not disturb on", msg: coverId != null || prefs.coveringUserId != null ? "Messages forward to your covering provider." : "No covering provider set — on-call roles you hold will be unreachable." });
  }
  function disable() { a.setMyPref("dnd", false); a.toast({ tone: "accepted", title: "Do not disturb off", msg: "You're receiving messages directly again." }); }
  return (
    <React.Fragment>
      <button onClick={() => (prefs.dnd ? disable() : setOpen(true))} title={prefs.dnd ? "DND on — tap to turn off" + (coveringName ? " (covering: " + coveringName + ")" : "") : "Do not disturb"}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = prefs.dnd ? "#FEF3C7" : "transparent"}
        style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", border: "none", background: prefs.dnd ? "#FEF3C7" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: prefs.dnd ? "#B45309" : "var(--muted-foreground)" }}>
        <Icon name="moon" size={16} />
      </button>
      {open && (
        <Modal title="Do not disturb" subtitle="Pick who covers for you — your messages and on-call roles route to them while you're away." icon="moon" onClose={() => setOpen(false)}
          children={
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Field icon="search" value={q} onChange={setQ} placeholder="Search colleagues…" />
              <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {people.map((d) => (
                  <button key={d.id} onClick={() => enable(d.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: "var(--radius-md)", border: "1px solid " + (prefs.coveringUserId === d.id ? "var(--primary)" : "var(--border)"), background: prefs.coveringUserId === d.id ? "#EFF6FF" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                    <Avatar initials={(d.avatar) || (d.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()} size={30} tint={d.working ? "emerald" : "slate"} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{d.name}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--muted-foreground)" }}>{d.specialty || "Provider"}{d.working ? " · on shift" : ""}</span>
                    </span>
                  </button>
                ))}
                {people.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: "var(--muted-foreground)", textAlign: "center" }}>No colleagues found.</div>}
              </div>
              <Button variant="outline" size="sm" icon="moon" onClick={() => enable(null)}>Turn on without covering (not recommended)</Button>
            </div>
          } />
      )}
    </React.Fragment>
  );
}

// Self-service password change — a key button in the sidebar footer that opens a
// small modal. Lets every user move off the shared demo password for real use.
function ChangePasswordButton() {
  const [open, setOpen] = React.useState(false);
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const err = next && next.length < 8 ? "At least 8 characters." : (confirm && next !== confirm ? "Passwords don't match." : "");
  const canSave = cur && next.length >= 8 && next === confirm && !busy;
  function submit() {
    if (!canSave) return;
    setBusy(true);
    Promise.resolve(window.DT.actions.changePassword(cur, next)).then((r) => {
      setBusy(false);
      if (r && r.ok) { setOpen(false); setCur(""); setNext(""); setConfirm(""); }
    });
  }
  return (
    <React.Fragment>
      <button onClick={() => setOpen(true)} title="Change password"
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
        <Icon name="key-round" size={16} />
      </button>
      {open && (
        <Modal title="Change password" subtitle="Set a new password for your account." icon="key-round" onClose={() => setOpen(false)}
          children={
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Current password" icon="lock" type="password" value={cur} onChange={setCur} placeholder="Current password" />
              <Field label="New password" icon="key-round" type="password" value={next} onChange={setNext} placeholder="At least 8 characters" />
              <Field label="Confirm new password" icon="key-round" type="password" value={confirm} onChange={setConfirm} placeholder="Re-enter new password" />
              {err && <div style={{ fontSize: 12.5, color: "var(--destructive)" }}>{err}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button size="sm" icon="check" onClick={submit} style={{ opacity: canSave ? 1 : 0.5, pointerEvents: canSave ? "auto" : "none" }}>{busy ? "Saving…" : "Update password"}</Button>
              </div>
            </div>
          } />
      )}
    </React.Fragment>
  );
}

// Unmistakable test-only marker shown on every screen (incl. login) whenever the
// instance is in synthetic-data mode, so no one mistakes a pilot for real PHI.
function SyntheticBanner({ on }) {
  if (!on) return null;
  return (
    <div role="status" style={{
      flex: "none", zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: "#7C2D12", textAlign: "center",
      background: "repeating-linear-gradient(45deg, #FEF3C7, #FEF3C7 14px, #FDE68A 14px, #FDE68A 28px)",
      borderBottom: "1px solid #F59E0B", letterSpacing: ".01em",
    }}>
      <Icon name="flask-conical" size={14} color="#B45309" />
      SYNTHETIC DATA — testing only. Do not enter real patient information (PHI).
    </div>
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

// Color-scheme presets ("palettes"). These soften the whole CANVAS (page
// background, borders, ink) while cards stay white and float — the classic
// low-glare look (Linear/Notion/Stripe) that's easier on the eyes for long
// shifts. Values are raw HSL channels; because tokens.css composes every
// semantic token from its "-ch" channel (e.g. --background: hsl(var(--background-ch))),
// overriding the channel recolors the whole app, and removing it restores the
// shipped default. "classic" === the current product look (null → no override).
var PALETTES = {
  classic: null,
  calm: { // cool, soft slate — matches the blue accent
    "--background-ch": "215 28% 96%",
    "--foreground-ch": "217 33% 18%",
    "--secondary-ch": "215 28% 92%",
    "--muted-ch": "215 28% 92%",
    "--accent-ch": "215 28% 92%",
    "--muted-foreground-ch": "215 18% 42%",
    "--border-ch": "214 24% 87%",
    "--input-ch": "214 24% 87%",
  },
  warm: { // warm paper — lowest blue-light, sepia-adjacent
    "--background-ch": "40 30% 96%",
    "--foreground-ch": "28 22% 18%",
    "--secondary-ch": "40 26% 91%",
    "--muted-ch": "40 26% 91%",
    "--accent-ch": "40 26% 91%",
    "--muted-foreground-ch": "30 12% 42%",
    "--border-ch": "38 22% 85%",
    "--input-ch": "38 22% 85%",
  },
};
var PALETTE_KEYS = ["--background-ch", "--foreground-ch", "--secondary-ch", "--muted-ch", "--accent-ch", "--muted-foreground-ch", "--border-ch", "--input-ch"];

// Imperatively apply the theme to :root CSS variables (whole-app recolor).
function applyTheme(theme) {
  if (!theme) return;
  var root = document.documentElement.style;
  // Palette (color scheme): override or clear the surface channels. Clearing
  // (classic) falls back to the shipped tokens.css defaults — the "return to
  // current state" the operator can always get back to.
  var palette = PALETTES[theme.palette || "classic"];
  PALETTE_KEYS.forEach(function (k) {
    if (palette && palette[k]) root.setProperty(k, palette[k]);
    else root.removeProperty(k);
  });
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
  React.useEffect(function () { applyTheme(theme); }, [theme && theme.accent, theme && theme.radius, theme && theme.contentWidth, theme && theme.palette]);
  return null;
}

// Shared sub-nav for the consolidated Settings area. Compliance & Appearance
// were pulled OUT of the sidebar (declutter) and now live as tabs alongside the
// organization settings, reusing the existing nav ids. Only rendered for the
// roles whose sidebar carried all three (director / ER director); other roles
// still reach Compliance from their own sidebar item, so this renders nothing.
function SettingsTabs() {
  var st = useStore();
  var a = useActions();
  var role = st.session && st.session.role;
  if (role !== "director" && role !== "er_director") return null;
  var nav = (st.ui && st.ui.nav) || "settings";
  var tabs = [["settings", "Organization", "sliders-horizontal"], ["appearance", "Appearance", "palette"], ["compliance", "Compliance", "shield-check"], ["compliance-monitor", "Compliance monitor", "activity"]];
  return (
    <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)", marginBottom: 18, maxWidth: "100%", overflowX: "auto" }}>
      {tabs.map(function (t) {
        var id = t[0], label = t[1], icon = t[2], on = nav === id;
        return (
          <button key={id} onClick={function () { a.setNav(id); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
              background: on ? "#fff" : "transparent", color: on ? "var(--primary)" : "var(--muted-foreground)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
            <Icon name={icon} size={15} />{label}
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, { Sidebar, Topbar, PageWrap, SectionTitle, SettingsTabs, applyTheme, ThemeStyle, hexToHsl, useIsMobile });
