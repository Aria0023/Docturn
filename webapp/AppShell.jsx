/* DocTurn web-app UI kit — app shell: sidebar + topbar */

// Reactive viewport check so layouts can switch to a phone-friendly form.
// A phone stays a phone in landscape (A.CON-MIN-10): a touch-only device whose
// viewport is short (≤500px tall — iPhone 14 landscape is 844×390) keeps the
// bottom-tab shell even though its width exceeds the breakpoint; a desktop
// window of the same width (mouse, tall) still gets the sidebar.
function useIsMobile(bp) {
  var q = "(max-width: " + (bp || 760) + "px), ((hover: none) and (pointer: coarse) and (max-height: 500px))";
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

// `fill`: inside the phone drawer the sidebar fills its scroll container
// (min-height 100%) instead of being a sticky 100vh column, so the account
// actions in its footer are on screen without scrolling the drawer.
function Sidebar({ role, nav, active, onNav, me, onLogout, compact, appName, fill }) {
  const who = me || { name: "Dr. Jordan Chen", avatar: "JC" };
  const name = appName || "DocTurn";
  return (
    <aside style={{ width: fill ? "100%" : (compact ? 68 : 232), flex: "none", background: "var(--card)", borderRight: fill ? "none" : "1px solid var(--border)", display: "flex", flexDirection: "column", height: fill ? "auto" : "100vh", minHeight: fill ? "100%" : undefined, position: fill ? "static" : "sticky", top: 0, transition: "width .2s" }}>
      <div style={{ padding: compact ? "18px 0 14px" : "18px 18px 14px", display: "flex", alignItems: "center", justifyContent: compact ? "center" : "flex-start", gap: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "var(--primary-foreground)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, flex: "none" }}>{name.charAt(0).toUpperCase()}</span>
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
                background: on ? "var(--primary-tint)" : "transparent", color: on ? "var(--primary-ink)" : "var(--foreground)" }}>
              <Icon name={item.icon} size={18} />
              {!compact && <span style={{ flex: 1 }}>{item.label}</span>}
              {!compact && item.badge ? <Badge status="pending">{item.badge}</Badge> : null}
              {compact && item.badge ? <span style={{ position: "absolute", top: 5, right: 12, width: 7, height: 7, borderRadius: 99, background: "var(--destructive)" }} /> : null}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
        {/* Identity on one row, the four account actions on their own row below:
            the actions are 44×44 tap targets on touch devices (index.html
            coarse-pointer rule, A.CON-SHO-52), which no longer fit beside the
            name in a 232px sidebar or the 264px phone drawer. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: compact ? 0 : "6px 6px 2px", justifyContent: compact ? "center" : "flex-start" }}>
          <Avatar initials={who.avatar} size={34} />
          {!compact && <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden" }}>
              {/* The account's name as the server holds it — not editable here
                  (no self-rename on the server, A.CON comms-account #2). */}
              <span style={{ fontWeight: 600 }}>{who.name}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{role.replace("_", " ")}</div>
          </div>}
        </div>
        {!compact && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, marginTop: 6 }}>
            {onNav ? <button type="button" onClick={() => onNav("account")} title="Settings" aria-label="Settings"
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
              <Icon name="settings" size={16} />
            </button> : <span />}
            <DndButton />
            <ChangePasswordButton />
            <button type="button" onClick={onLogout} title="Sign out" aria-label="Sign out"
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
              <Icon name="log-out" size={16} />
            </button>
          </div>
        )}
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
  // Each step is the server's first (setMyPref resolves true only once
  // PATCH /api/settings/me stored it); the button, the Settings row and the
  // toast follow what was stored. A failed save already said "Setting not
  // saved" and leaves the server's state on screen (A.CON comms-account #15).
  const [busy, setBusy] = React.useState(false);
  function enable(coverId) {
    if (busy) return;
    setBusy(true);
    const covered = coverId != null || prefs.coveringUserId != null;
    Promise.resolve(coverId != null ? a.setMyPref("coveringUserId", coverId) : true)
      .then((ok) => (ok ? a.setMyPref("dnd", true) : false))
      .then((ok) => {
        setBusy(false);
        if (!ok) return;
        setOpen(false);
        a.toast({ tone: "accepted", title: "Do not disturb on", msg: covered ? "Messages forward to your covering provider." : "No covering provider set — on-call roles you hold will be unreachable." });
      }, () => setBusy(false));
  }
  function disable() {
    if (busy) return;
    setBusy(true);
    Promise.resolve(a.setMyPref("dnd", false)).then((ok) => {
      setBusy(false);
      if (ok) a.toast({ tone: "accepted", title: "Do not disturb off", msg: "You're receiving messages directly again." });
    }, () => setBusy(false));
  }
  return (
    <React.Fragment>
      <button type="button" data-dnd-button onClick={() => (busy ? null : prefs.dnd ? disable() : setOpen(true))} aria-busy={busy ? "true" : undefined} title={prefs.dnd ? "DND on — tap to turn off" + (coveringName ? " (covering: " + coveringName + ")" : "") : "Do not disturb"} aria-label={prefs.dnd ? "Do not disturb is on — turn off" : "Do not disturb"} aria-pressed={!!prefs.dnd}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = prefs.dnd ? "var(--status-pending-bg)" : "transparent"}
        style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", border: "none", background: prefs.dnd ? "var(--status-pending-bg)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: prefs.dnd ? "var(--status-pending-fg)" : "var(--muted-foreground)" }}>
        <Icon name="moon" size={16} />
      </button>
      {open && (
        <Modal title="Do not disturb" subtitle="Pick who covers for you — your messages and on-call roles route to them while you're away." icon="moon" onClose={() => setOpen(false)}
          children={
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {window.DndAwayMessageField && <DndAwayMessageField />}
              <Field icon="search" value={q} onChange={setQ} placeholder="Search colleagues…" />
              <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {people.map((d) => (
                  <button key={d.id} onClick={() => enable(d.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: "var(--radius-md)", border: "1px solid " + (prefs.coveringUserId === d.id ? "var(--primary)" : "var(--border)"), background: prefs.coveringUserId === d.id ? "var(--primary-tint)" : "var(--card)", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
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
      <button type="button" onClick={() => setOpen(true)} title="Change password" aria-label="Change password"
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
        <Icon name="key-round" size={16} />
      </button>
      {open && (
        <Modal title="Change password" subtitle="Set a new password for your account." icon="key-round" onClose={() => setOpen(false)}
          children={
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Current password" icon="lock" type="password" value={cur} onChange={setCur} placeholder="Current password" name="current-password" autoComplete="current-password" />
              <Field label="New password" icon="key-round" type="password" value={next} onChange={setNext} placeholder="At least 8 characters" name="new-password" autoComplete="new-password" />
              <Field label="Confirm new password" icon="key-round" type="password" value={confirm} onChange={setConfirm} placeholder="Re-enter new password" name="confirm-password" autoComplete="new-password" />
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
  // A phone gets the same warning in one line: the two-line version cost a
  // tenth of the screen above every page.
  const mobile = useIsMobile();
  if (!on) return null;
  return (
    <div role="status" className="dt-synthetic-banner" style={{
      flex: "none", zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: "#7C2D12", textAlign: "center",
      background: "repeating-linear-gradient(45deg, #FEF3C7, #FEF3C7 14px, #FDE68A 14px, #FDE68A 28px)",
      borderBottom: "1px solid #F59E0B", letterSpacing: ".01em",
    }}>
      <Icon name="flask-conical" size={14} color="var(--status-pending)" />
      {mobile
        ? <span title="Testing only. Do not enter real patient information (PHI).">SYNTHETIC DATA — no real patient info</span>
        : "SYNTHETIC DATA — testing only. Do not enter real patient information (PHI)."}
    </div>
  );
}

function Topbar({ title, subtitle, working, onToggleWorking, right, onBell, notifCount = 0, onLock }) {
  return (
    // minHeight (not a fixed height) + wrap: a long title or the demo-mode
    // controls in `right` wrap onto a second line instead of spilling over the
    // content at 800–1000px windows (A.CON-MIN-10).
    <header style={{ minHeight: 64, borderBottom: "1px solid var(--border)", background: "var(--topbar-bg)", backdropFilter: "blur(6px)", position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px 14px", padding: "8px 28px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{subtitle}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, maxWidth: "100%" }}>
        {right}
        {onToggleWorking && (
          <button type="button" onClick={onToggleWorking} aria-pressed={!!working} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", flex: "none" }}>
            <StatusDot status={working ? "online" : "offline"} pulse={working} />
            {working ? "On shift" : "Off shift"}
          </button>
        )}
        {/* The bell only when the caller has a real notification feed to open
            (the live app has none — A.CON developer #23). */}
        {onBell && (
        <button type="button" onClick={onBell} title="Notifications" aria-label={notifCount > 0 ? "Notifications (" + notifCount + " unread)" : "Notifications"}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "var(--card)"}
          style={{ position: "relative", width: 38, height: 38, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Icon name="bell" size={18} color="var(--foreground)" />
          {notifCount > 0 && <span style={{ position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 99, background: "var(--destructive)", color: "var(--destructive-foreground)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid var(--card)" }}>{notifCount}</span>}
        </button>
        )}
        {onLock && (
          <button type="button" onClick={onLock} title="Lock app" aria-label="Lock app"
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "var(--card)"}
            style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "4px 0 14px" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, minWidth: 0 }}>{children}</h2>
      {/* the count / control keeps its shape; the heading is what wraps */}
      {action ? <span style={{ flex: "none", whiteSpace: "nowrap", display: "inline-flex" }}>{action}</span> : null}
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

// Color-scheme presets ("palettes"). The first three soften the whole CANVAS
// (page background, borders, ink) while cards stay white and float — the
// classic low-glare look that's easier on the eyes for long shifts. `night`
// and `contrast` invert it: a dark canvas with cards that float ABOVE it, and
// every status family restated in dark tints with light ink.
//
// Values are raw HSL channels; because tokens.css composes every semantic
// token from its "-ch" channel (e.g. --background: hsl(var(--background-ch))),
// overriding the channel recolors the whole app, and removing it restores the
// shipped default. "classic" === the current product look (null → no override).
//
// WHO CHOOSES WHAT: the ORGANIZATION picks appName, accent, radius, sidebar,
// content width and its own palette (classic | calm | warm) for everyone; a
// PERSON picks one of these presets for themselves plus a text size, and the
// preset "org" is not a palette at all — it means "whatever my organization
// chose". So a palette map here is the union of the surface channels, the
// status families and the on-fill ink that preset restates; PALETTE_KEYS is
// computed from the maps so a key added to one preset is cleared for the rest.
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
    // The shipped amber (var(--status-pending)) read 4.15:1 on this softer canvas — a pair
    // the new per-preset contrast check caught. Four points darker clears AA
    // here and reads better on its own tint too; the tint and the -fg shade are
    // the kit's, so the family still looks like the same amber.
    "--status-pending": "hsl(31 92% 31%)",
  },
  warm: { // warm paper — lowest blue-light, sepia-adjacent
    "--background-ch": "40 30% 96%",
    "--foreground-ch": "28 22% 18%",
    "--secondary-ch": "40 26% 91%",
    "--muted-ch": "40 26% 91%",
    "--accent-ch": "40 26% 91%",
    // 38%, not 42%: the muted ink read 4.31:1 on this canvas (per-preset
    // contrast check); the amber below read 4.19:1 on it.
    "--muted-foreground-ch": "30 12% 38%",
    "--border-ch": "38 22% 85%",
    "--input-ch": "38 22% 85%",
    "--status-pending": "hsl(31 92% 31%)",
  },
  // True dark. The canvas is the darkest surface, a card floats above it and a
  // chip / segmented track is recessed below it, so the three keep the same
  // relationship they have in the light presets (A.CON-SHO-53 applies to all
  // of them, which scripts/contrast-check.mjs now verifies per preset).
  night: {
    "--background-ch": "222 24% 8%",
    "--card-ch": "222 20% 15%",
    "--foreground-ch": "210 32% 96%",
    "--secondary-ch": "222 20% 11%",
    "--muted-ch": "222 20% 11%",
    "--accent-ch": "222 20% 11%",
    "--muted-foreground-ch": "213 24% 74%",
    "--border-ch": "220 14% 30%",
    "--input-ch": "220 14% 30%",
    "--border-strong-ch": "220 12% 45%",
    // The deliberately dark panels go DARKER than a card so they still read as
    // a panel rather than dissolving into it.
    "--inverse-ch": "222 32% 5%",
    "--inverse-foreground-ch": "210 32% 97%",
    "--inverse-muted-ch": "213 20% 75%",
    "--inverse-accent-ch": "199 95% 76%",
    // Status families: dark tints, light ink. `-fg` stays the stronger of the
    // two (badge text), `-rim` the line around a tinted banner.
    "--status-pending": "hsl(43 96% 68%)",
    "--status-pending-fg": "hsl(45 98% 80%)",
    "--status-pending-bg": "hsl(32 55% 16%)",
    "--status-pending-rim": "hsl(36 50% 34%)",
    "--status-accepted": "hsl(158 64% 62%)",
    "--status-accepted-fg": "hsl(154 70% 76%)",
    "--status-accepted-bg": "hsl(166 50% 13%)",
    "--status-accepted-rim": "hsl(162 40% 30%)",
    "--status-rejected": "hsl(0 90% 76%)",
    "--status-rejected-fg": "hsl(0 95% 84%)",
    "--status-rejected-bg": "hsl(0 45% 18%)",
    "--status-rejected-rim": "hsl(0 45% 38%)",
    "--status-neutral": "hsl(213 22% 76%)",
    "--status-neutral-fg": "hsl(213 26% 84%)",
    "--status-neutral-bg": "hsl(220 18% 18%)",
    "--status-neutral-rim": "hsl(220 14% 36%)",
    // Those fills are LIGHT here, so the ink on a solid one is near-black.
    "--on-status": "#0B1220",
  },
  // High contrast: a black canvas, white ink, lines you can see across a ward,
  // and every text pair at 7:1 or better (AAA for body text, AA+ everywhere).
  contrast: {
    "--background-ch": "0 0% 0%",
    "--card-ch": "0 0% 11%",
    "--foreground-ch": "0 0% 100%",
    "--secondary-ch": "0 0% 5%",
    "--muted-ch": "0 0% 5%",
    "--accent-ch": "0 0% 5%",
    "--muted-foreground-ch": "0 0% 90%",
    "--border-ch": "0 0% 62%",
    "--input-ch": "0 0% 62%",
    "--border-strong-ch": "0 0% 80%",
    "--inverse-ch": "0 0% 0%",
    "--inverse-foreground-ch": "0 0% 100%",
    "--inverse-muted-ch": "0 0% 90%",
    "--inverse-accent-ch": "196 100% 80%",
    "--status-pending": "hsl(45 100% 76%)",
    "--status-pending-fg": "hsl(48 100% 86%)",
    "--status-pending-bg": "hsl(32 60% 12%)",
    "--status-pending-rim": "hsl(44 80% 60%)",
    "--status-accepted": "hsl(152 76% 72%)",
    "--status-accepted-fg": "hsl(150 80% 84%)",
    "--status-accepted-bg": "hsl(164 60% 10%)",
    "--status-accepted-rim": "hsl(156 60% 56%)",
    "--status-rejected": "hsl(0 100% 82%)",
    "--status-rejected-fg": "hsl(0 100% 88%)",
    "--status-rejected-bg": "hsl(0 55% 14%)",
    "--status-rejected-rim": "hsl(0 85% 66%)",
    "--status-neutral": "hsl(0 0% 88%)",
    "--status-neutral-fg": "hsl(0 0% 94%)",
    "--status-neutral-bg": "hsl(0 0% 14%)",
    "--status-neutral-rim": "hsl(0 0% 70%)",
    "--on-status": "#000000",
  },
};
// Every key any preset sets — so switching preset CLEARS what the previous one
// set instead of leaving half of it behind.
var PALETTE_KEYS = (function () {
  var seen = {};
  Object.keys(PALETTES).forEach(function (k) {
    if (PALETTES[k]) Object.keys(PALETTES[k]).forEach(function (v) { seen[v] = 1; });
  });
  return Object.keys(seen);
})();
// The presets whose canvas is dark. Used for color-scheme, the status ink and
// the direction every derived accent shade is fitted in.
var DARK_PRESETS = { night: 1, contrast: 1 };
// Text that must clear 7:1 rather than 4.5:1 in the high-contrast preset.
var PRESET_MIN = { contrast: 7.1 };

// WCAG relative luminance / contrast for the theme's derived shades
// (A.CON-SHO-53): the accent is operator-chosen and the canvas is
// person-chosen, so the text-on-surface colours are COMPUTED to meet AA on the
// surfaces they actually land on rather than assumed.
function hslToRgb255(h, s, l) {
  s /= 100; l /= 100;
  var k = function (n) { return (n + h / 30) % 12; };
  var a = s * Math.min(l, 1 - l);
  var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
  return [f(0), f(8), f(4)].map(function (v) { return Math.round(v * 255); });
}
function relLum(rgb) {
  var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrastRatio(a, b) {
  var l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
// "H S% L%" (a tokens.css channel) → rgb triple.
function chToRgb255(ch) {
  var m = String(ch).match(/(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  return m ? hslToRgb255(+m[1], +m[2], +m[3]) : [255, 255, 255];
}
// Walk lightness from `startL` by `dir` until H S% L% reads `min` against `bg`.
// Returns the first lightness that does, or the end of the scale.
function fitLightness(h, s, startL, bg, dir, min) {
  var l = startL;
  for (var i = 0; i < 200; i++) {
    if (contrastRatio(hslToRgb255(h, s, l), bg) >= min) break;
    l += dir;
    if (l <= 2 || l >= 98) break;
  }
  return Math.max(2, Math.min(98, Math.round(l * 10) / 10));
}
// The light blue the kit used to hard-code behind icon/initial tiles — now
// --status-active-bg, which this function restates for a dark canvas.
var TILE_BLUE = [219, 234, 254];
var AA = 4.6; // 4.5:1 plus a margin for sub-pixel rounding in the browser

/**
 * PURE (no DOM): every token derived from the org's accent for ONE preset's
 * surfaces. scripts/contrast-check.mjs evaluates this very function out of this
 * file, so the static check and the browser agree on each derived shade — there
 * is one implementation of the contrast maths, not two.
 *
 *   accentHex  the organization's accent (operator-chosen, any hex)
 *   cardCh     the preset's "--card-ch" channel (the surface text lands on)
 *   bgCh       the preset's "--background-ch" channel
 *   min        the contrast floor for this preset (AA, or 7.1 for contrast)
 */
function accentTokens(accentHex, cardCh, bgCh, min) {
  var aa = min || AA;
  var hsl = hexToHsl(accentHex || "#2563EB");
  var card = chToRgb255(cardCh);
  var bg = chToRgb255(bgCh);
  var dark = relLum(card) < 0.18;
  var dir = dark ? 1 : -1;      // on a dark card every ink shade goes LIGHTER
  var out = {};

  // --primary is both a FILL (ink sits on it) and TEXT (links, active labels,
  // card heads) on the card AND on the canvas. On a light canvas the accent is
  // used exactly as the operator chose it; on a dark one it is lightened until
  // it reads on both surfaces, because an unlightened #2563EB is ~3.4:1 there.
  var pl = hsl.l;
  if (dark) {
    pl = fitLightness(hsl.h, hsl.s, pl, card, 1, aa);
    pl = fitLightness(hsl.h, hsl.s, pl, bg, 1, aa);
  }
  var ch = hsl.h + " " + hsl.s + "% " + pl + "%";
  var fill = hslToRgb255(hsl.h, hsl.s, pl);
  out["--primary-ch"] = ch;
  out["--ring-ch"] = ch;
  out["--primary"] = "hsl(" + ch + ")";
  out["--ring"] = "hsl(" + ch + ")";
  // Ink on the solid accent fill: whichever end of the scale reads better on
  // it. A lightened accent takes near-black, the shipped blue takes white.
  out["--primary-foreground"] = contrastRatio([255, 255, 255], fill) >= contrastRatio([11, 18, 32], fill) ? "#ffffff" : "#0B1220";

  // --primary-tint: the soft accent surface under an active nav item, a
  // selected chip, a "Rotation" tag. --primary must read AA as TEXT on it.
  var tintS = Math.min(hsl.s, 90);
  var tintL = fitLightness(hsl.h, tintS, dark ? 20 : 95, fill, dark ? -1 : 1, aa);
  var tintRgb = hslToRgb255(hsl.h, tintS, tintL);
  out["--primary-tint"] = "hsl(" + hsl.h + " " + tintS + "% " + tintL + "%)";
  out["--primary-tint-2"] = "hsl(" + hsl.h + " " + tintS + "% " + (dark ? Math.min(tintL + 9, 40) : 90) + "%)";

  // --status-active-bg: the light-blue tile behind initials and icons. Fixed
  // in the light presets (the kit's #DBEAFE); a dark accent tint otherwise.
  var tileL = dark ? Math.max(tintL - 3, 8) : null;
  var tile = dark ? hslToRgb255(hsl.h, tintS, tileL) : TILE_BLUE;
  if (dark) out["--status-active-bg"] = "hsl(" + hsl.h + " " + tintS + "% " + tileL + "%)";

  // --primary-ink: the ONE accent shade used as TEXT — the active nav label,
  // initials on a tile, a selected chip, a card head, a link. It is fitted
  // against every surface that text lands on: the card, the canvas, the accent
  // tint and the tile. --primary stays exactly the colour the operator chose
  // and is used for FILLS only (an accent such as #EA580C reads 3.56:1 as text
  // on white — the two jobs cannot share one value, A.CON-SHO-53).
  var inkL = pl;
  [tile, tintRgb, card, bg].forEach(function (surface) {
    inkL = fitLightness(hsl.h, hsl.s, inkL, surface, dir, aa);
  });
  out["--primary-ink"] = "hsl(" + hsl.h + " " + hsl.s + "% " + inkL + "%)";

  // The "active" status family follows the accent: text / dots on the tile.
  var actL = fitLightness(hsl.h, hsl.s, dark ? pl : Math.min(hsl.l, 46), tile, dir, aa);
  out["--status-active"] = "hsl(" + hsl.h + " " + hsl.s + "% " + actL + "%)";
  out["--status-active-fg"] = "hsl(" + hsl.h + " " + hsl.s + "% " + fitLightness(hsl.h, hsl.s, actL, tile, dir, Math.max(aa + 1.5, 6)) + "%)";

  // --destructive is the same double act as --primary (a red fill with ink on
  // it, and red TEXT for errors), so it is fitted the same way.
  var dHsl = { h: 0, s: 72, l: 51 };
  var dl = fitLightness(dHsl.h, dHsl.s, dHsl.l, card, dir, aa);
  dl = fitLightness(dHsl.h, dHsl.s, dl, bg, dir, aa);
  var dFill = hslToRgb255(dHsl.h, dHsl.s, dl);
  out["--destructive-ch"] = dHsl.h + " " + dHsl.s + "% " + dl + "%";
  out["--destructive"] = "hsl(" + out["--destructive-ch"] + ")";
  out["--destructive-foreground"] = contrastRatio([255, 255, 255], dFill) >= contrastRatio([11, 18, 32], dFill) ? "#ffffff" : "#0B1220";
  return out;
}
var ACCENT_KEYS = Object.keys(accentTokens("#2563EB", "0 0% 100%", "0 0% 100%"))
  .concat(["--status-active-bg"]);

/**
 * Fit an operator-chosen colour so it reads as TEXT in whatever preset is
 * active — a role swatch or another tenant's accent (webapp/store.js
 * roleColors, DeveloperDashboard ORG_PALETTE). Those are free-form hexes a
 * person picked for identity, not theme tokens, so they cannot be restated per
 * preset; they are FITTED instead, with the same maths as the theme's own
 * accent (A.CON-SHO-53).
 *
 * `tintPct` is the alpha the colour is laid over the surface with (the role
 * chips use 9%), so the ink is fitted against the tint it actually lands on.
 * Memoised per colour + surface, because a support directory draws one of
 * these for every person on screen.
 */
var inkCache = {};
function readableInk(hex, tintPct) {
  if (!hex || String(hex).charAt(0) !== "#") return hex;
  var cardCh = "0 0% 100%";
  try { cardCh = (getComputedStyle(document.documentElement).getPropertyValue("--card-ch") || cardCh).trim() || cardCh; } catch (e) { /* no document */ }
  var key = hex + "|" + cardCh + "|" + (tintPct || 0);
  if (inkCache[key]) return inkCache[key];
  var hsl = hexToHsl(hex);
  var surface = chToRgb255(cardCh);
  var raw = hslToRgb255(hsl.h, hsl.s, hsl.l);
  var pct = tintPct || 0;
  var tint = [0, 1, 2].map(function (i) { return Math.round(raw[i] * pct + surface[i] * (1 - pct)); });
  var dir = relLum(tint) < 0.18 ? 1 : -1;
  var l = fitLightness(hsl.h, hsl.s, hsl.l, tint, dir, AA);
  inkCache[key] = "hsl(" + hsl.h + " " + hsl.s + "% " + l + "%)";
  return inkCache[key];
}

/**
 * The preset actually in force, given the org's theme, the person's preference
 * and the device. "org" means "my organization's palette"; followDevice applies
 * to the two presets that have both a light and a dark reading, so a person on
 * `night` + follow device gets their org's light palette while the phone is in
 * light mode, and a person on `org` + follow device gets night after dark.
 */
function effectivePreset(theme, user) {
  var orgPalette = (theme && theme.palette) || "classic";
  var chosen = (user && user.preset) || "org";
  if (!PALETTES.hasOwnProperty(chosen) && chosen !== "org") chosen = "org";
  var follows = !!(user && user.followDevice) && (chosen === "org" || chosen === "night");
  if (follows) {
    var deviceDark = false;
    try { deviceDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) { deviceDark = false; }
    return deviceDark ? "night" : orgPalette;
  }
  return chosen === "org" ? orgPalette : chosen;
}

// Imperatively apply the theme to :root CSS variables (whole-app recolor).
// `theme` is the ORGANIZATION's (appName / accent / radius / sidebar /
// contentWidth / palette); `user` is this person's own { preset, textSize,
// followDevice } and layers on top of it.
function applyTheme(theme, user) {
  if (!theme) return;
  var root = document.documentElement.style;
  var preset = effectivePreset(theme, user);
  var palette = PALETTES[preset] || null;
  // Palette: override or clear every channel ANY preset may set. Clearing
  // (classic) falls back to the shipped tokens.css defaults — the "return to
  // the current look" a person can always get back to.
  PALETTE_KEYS.forEach(function (k) {
    if (palette && palette[k]) root.setProperty(k, palette[k]);
    else root.removeProperty(k);
  });
  var dark = !!DARK_PRESETS[preset];
  // Native form controls, scrollbars and the UA's own surfaces.
  root.setProperty("color-scheme", dark ? "dark" : "light");
  var cardCh = (palette && palette["--card-ch"]) || "0 0% 100%";
  var bgCh = (palette && palette["--background-ch"]) || "0 0% 100%";
  var derived = accentTokens(theme.accent || "#2563EB", cardCh, bgCh, PRESET_MIN[preset]);
  ACCENT_KEYS.forEach(function (k) {
    if (derived[k]) root.setProperty(k, derived[k]);
    else root.removeProperty(k);
  });
  root.setProperty("--radius", ((theme.radius != null ? theme.radius : 8) / 16) + "rem");
  root.setProperty("--content-max", theme.contentWidth === "wide" ? "1280px" : (theme.contentWidth === "full" ? "100%" : "1040px"));
  // Text size. The kit sizes its type in pixels inline, so raising the root
  // font alone changes nothing a clinician can see; zooming :root scales the
  // type, the 44px tap targets and the 16px inputs together. --dt-zoom is
  // published so anything sized in viewport units can divide by it (otherwise
  // a 100dvh shell is exactly one zoom factor too tall).
  inkCache = {}; // the surfaces moved, so every fitted ink is re-derived
  var large = !!(user && user.textSize === "large");
  root.setProperty("--dt-zoom", large ? "1.125" : "1");
  root.setProperty("zoom", large ? "1.125" : "1");
  applyThemeColor(dark, preset, derived);
}

// The installed / native shell's chrome follows the active theme: the native
// shell paints the top safe-area inset with <meta name="theme-color"> and picks
// its status-bar icons by that colour's luminance (docs/MOBILE.md), and the
// manifest carries the splash colours. The manifest is a static file fetched
// without the session, so the href names the PRESET and the server answers with
// that preset's colours (server/webapp-static.ts).
function applyThemeColor(dark, preset, derived) {
  try {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var cs = getComputedStyle(document.documentElement);
      var top = dark ? (cs.getPropertyValue("--card") || "").trim() : (derived["--primary"] || "").trim();
      // A HEX, not the hsl() the tokens are composed from: the native shell
      // parses this value itself to choose light or dark status-bar icons
      // (docs/MOBILE.md), and a hex is what every parser understands.
      top = hslStringToHex(top) || top;
      if (/^#[0-9A-Fa-f]{6}$/.test(top)) meta.setAttribute("content", top);
    }
    var bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (bar) bar.setAttribute("content", dark ? "black-translucent" : "default");
    var link = document.querySelector('link[rel="manifest"]');
    if (link) {
      var href = "/manifest.webmanifest" + (preset && preset !== "classic" ? "?theme=" + preset : "");
      if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    }
  } catch (e) { /* a document without the metas (a test harness) is fine */ }
}

// "hsl(H S% L%)" → "#RRGGBB" (null for anything else, e.g. an already-hex value).
function hslStringToHex(v) {
  var m = String(v || "").match(/^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (!m) return null;
  return "#" + hslToRgb255(+m[1], +m[2], +m[3]).map(function (n) {
    return ("0" + Math.max(0, Math.min(255, n)).toString(16)).slice(-2);
  }).join("").toUpperCase();
}

function ThemeStyle({ theme, userTheme }) {
  var u = userTheme || null;
  React.useEffect(function () { applyTheme(theme, u); },
    [theme && theme.accent, theme && theme.radius, theme && theme.contentWidth, theme && theme.palette,
     u && u.preset, u && u.textSize, u && u.followDevice]);
  // While a person follows the device, the OS switching to dark must switch the
  // app with it — without a reload and without touching their stored choice.
  React.useEffect(function () {
    if (!(u && u.followDevice)) return;
    var mq;
    try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch (e) { return; }
    var on = function () { applyTheme(theme, u); };
    if (mq.addEventListener) mq.addEventListener("change", on); else if (mq.addListener) mq.addListener(on);
    return function () { if (mq.removeEventListener) mq.removeEventListener("change", on); else if (mq.removeListener) mq.removeListener(on); };
  }, [theme && theme.accent, theme && theme.palette, u && u.preset, u && u.followDevice]);
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
  // The Appearance tab carries two things: the ORG's theme (PATCH
  // /api/org/preferences, refused while platform.appearance is off) and THIS
  // PERSON's own preset (PUT /api/me/theme, refused while platform.userThemes
  // is off). Either module on keeps the tab — the card whose module is off
  // says so — and the tab disappears only when both are off.
  var moduleOn = function (id) { return !window.DT || !window.DT.moduleOn || window.DT.moduleOn(id); };
  var appearanceOn = moduleOn("platform.appearance") || moduleOn("platform.userThemes");
  // Billing (module `billing`, default OFF): the tab appears only once the
  // DocTurn operator has switched billing on for this hospital, so no existing
  // tenant's Settings changes. Directors only — an ER director never sees it,
  // which is the same rule the server's route enforces (403).
  var billingOn = moduleOn("billing") && role === "director";
  var tabs = [["settings", "Organization", "sliders-horizontal"]]
    .concat(appearanceOn ? [["appearance", "Appearance", "palette"]] : [])
    .concat(billingOn ? [["billing", "Billing", "receipt"]] : [])
    .concat([["compliance", "Compliance", "shield-check"], ["compliance-monitor", "Compliance monitor", "activity"]]);
  return (
    <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--secondary)", borderRadius: "var(--radius-md)", marginBottom: 18, maxWidth: "100%", overflowX: "auto" }}>
      {tabs.map(function (t) {
        var id = t[0], label = t[1], icon = t[2], on = nav === id;
        return (
          // flex "none": the strip scrolls sideways instead of squashing the
          // tabs. Under the touch-screen `button { min-width: 44px }` rule a
          // shrinkable tab narrowed to 74-99px at 375px and drew its label
          // 44-50px over the next one ("OrganizaⓅoAppea", A.CON-SHO-50).
          <button key={id} onClick={function () { a.setNav(id); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", flex: "none",
              background: on ? "var(--card)" : "transparent", color: on ? "var(--primary-ink)" : "var(--muted-foreground)", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
            <Icon name={icon} size={15} />{label}
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, { Sidebar, Topbar, PageWrap, SectionTitle, SettingsTabs, applyTheme, ThemeStyle, hexToHsl, useIsMobile, PALETTES, effectivePreset, accentTokens, contrastRatio, readableInk });
