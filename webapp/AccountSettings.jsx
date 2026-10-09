/* DocTurn web-app UI kit — Account settings ("Settings" for every role).
   Personal settings that previously lived only as unlabeled icons in the sidebar
   footer (and were unreachable on a phone): profile, availability (DND +
   covering + away message), on-shift, notifications, security (password,
   two-factor), lock, sign out. Directors additionally get shortcuts to the
   organization-level settings. Live-wired through DT.actions. */

function SettingsRow({ icon, title, sub, right, onClick, wrapSub, rowProps }) {
  const clickable = typeof onClick === "function";
  return (
    <div onClick={onClick} role={clickable ? "button" : undefined} {...(rowProps || {})}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: "1px solid var(--border)", cursor: clickable ? "pointer" : "default", background: "#fff" }}>
      <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Icon name={icon} size={16} color="var(--muted-foreground)" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        {sub && <div data-settings-sub style={wrapSub
          ? { fontSize: 12, color: "var(--muted-foreground)", marginTop: 1, lineHeight: 1.4, overflowWrap: "anywhere" }
          : { fontSize: 12, color: "var(--muted-foreground)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
      </div>
      {right !== undefined ? <div style={{ flex: "none" }}>{right}</div> : clickable ? <Icon name="chevron-right" size={16} color="var(--muted-foreground)" /> : null}
    </div>
  );
}

function SettingsGroup({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted-foreground)", margin: "0 4px 6px" }}>{title}</div>
      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "#fff" }}>
        <div style={{ marginTop: -1 }}>{children}</div>
      </div>
    </div>
  );
}

function Switch({ on, onChange, label }) {
  return (
    <button type="button" aria-label={label} aria-pressed={!!on} onClick={() => onChange && onChange(!on)}
      style={{ width: 44, height: 26, borderRadius: 99, border: "none", cursor: "pointer", position: "relative", background: on ? "var(--primary)" : "#CBD5E1", transition: "background .15s" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .15s" }} />
    </button>
  );
}

/* Self-contained two-factor enrolment (TOTP) so Settings does not depend on the
   sign-in-time enrolment screen's props. Uses the same server routes. */
function TwoFactorSetup({ enrolled, onDone, onCancel }) {
  const a = useActions();
  // Already enrolled → "manage" (re-enrol / new backup codes / turn off), each a
  // server-verified step-up: current password + a valid current code. The live
  // authenticator keeps working until a NEW one is verified.
  const [step, setStep] = React.useState(enrolled ? "manage" : "start");
  const [data, setData] = React.useState(null);
  const [code, setCode] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [stepCode, setStepCode] = React.useState("");
  const [doneTitle, setDoneTitle] = React.useState("Two-factor is on.");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const stepUpErr = (e) => {
    const m = String((e && e.message) || "");
    return m === "wrong_password" ? "That password is wrong." : m === "invalid_code" ? "That code didn't match — use a fresh code from your authenticator (or an unused backup code)." : m === "step_up_required" ? "Enter your password and a current code." : "Request failed — try again.";
  };
  const canStepUp = pw.length > 0 && stepCode.replace(/\s+/g, "").length >= 6 && !busy;
  const begin = () => {
    setBusy(true); setErr("");
    const stepUp = enrolled ? { currentPassword: pw, code: stepCode } : undefined;
    Promise.resolve(a.mfaBeginEnrollment && a.mfaBeginEnrollment(stepUp)).then((d) => { setData(d || {}); setStep("code"); }, (e) => setErr(enrolled ? stepUpErr(e) : String((e && e.message) || "Could not start enrolment."))).finally(() => setBusy(false));
  };
  const regenerate = () => {
    setBusy(true); setErr("");
    Promise.resolve(a.mfaRegenerateBackupCodes(pw, stepCode)).then((r) => { setData(r || {}); setDoneTitle("New backup codes issued — every previous code is now invalid."); setStep("done"); }, (e) => setErr(stepUpErr(e))).finally(() => setBusy(false));
  };
  const disable = () => {
    if (!window.confirm("Turn off two-factor authentication? Your account will be protected by your password alone.")) return;
    setBusy(true); setErr("");
    Promise.resolve(a.mfaDisable(pw, stepCode)).then(() => { a.toast && a.toast({ tone: "accepted", title: "Two-factor turned off", msg: "Your password alone now protects this account." }); onDone(); }, (e) => setErr(stepUpErr(e))).finally(() => setBusy(false));
  };
  const verify = () => {
    setBusy(true); setErr("");
    Promise.resolve(a.mfaVerifyEnrollment && a.mfaVerifyEnrollment(code)).then((r) => { setData(Object.assign({}, data, r || {})); setStep("done"); }, (e) => setErr(String((e && e.message) || "That code didn't match."))).finally(() => setBusy(false));
  };
  const secret = data && (data.secret || data.manualEntryKey || "");
  const otpauth = data && (data.otpauthUrl || data.otpauth || data.uri || "");
  const backup = (data && (data.backupCodes || data.recoveryCodes)) || [];
  return (
    <Modal title="Two-factor authentication" subtitle="Protect your account with a code from an authenticator app." icon="shield-check" onClose={onCancel}
      children={
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {step === "manage" && (
            <React.Fragment>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--status-accepted)", fontWeight: 600, fontSize: 13 }}><Icon name="shield-check" size={16} />Two-factor is on for this account.</div>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: 0 }}>Changing it requires your password and a current code — so a stolen session alone can never weaken it. Your existing authenticator keeps working until a new one is verified.</p>
              <Field label="Current password" icon="lock" type="password" value={pw} onChange={setPw} inputProps={{ autoComplete: "current-password" }} />
              <Field label="Current 6-digit code (or a backup code)" icon="key-round" value={stepCode} onChange={setStepCode} placeholder="123456" inputProps={{ inputMode: "numeric", autoComplete: "one-time-code", autoCapitalize: "characters" }} />
              <Button full onClick={begin} disabled={!canStepUp} style={{ opacity: canStepUp ? 1 : 0.55 }}>{busy ? "Working…" : "Set up a new authenticator"}</Button>
              <Button full variant="outline" onClick={regenerate} disabled={!canStepUp} style={{ opacity: canStepUp ? 1 : 0.55 }}>New backup codes</Button>
              <Button full variant="outline" onClick={disable} disabled={!canStepUp} style={{ opacity: canStepUp ? 1 : 0.55, color: "var(--destructive)" }}>Turn off two-factor</Button>
            </React.Fragment>
          )}
          {step === "start" && (
            <React.Fragment>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: 0 }}>You'll scan a key into Google Authenticator, Microsoft Authenticator, 1Password or any TOTP app, then confirm with a 6-digit code.</p>
              <Button full onClick={begin} disabled={busy}>{busy ? "Starting…" : "Start setup"}</Button>
            </React.Fragment>
          )}
          {step === "code" && (
            <React.Fragment>
              <div style={{ fontSize: 13 }}>Add this key to your authenticator app:</div>
              <code style={{ display: "block", padding: "10px 12px", background: "var(--secondary)", borderRadius: "var(--radius-md)", fontSize: 14, letterSpacing: ".08em", wordBreak: "break-all" }}>{secret || "(key unavailable)"}</code>
              {otpauth && <a href={otpauth} style={{ fontSize: 12.5, color: "var(--primary)" }}>Open in authenticator app</a>}
              <label style={{ fontSize: 13, fontWeight: 500 }}>6-digit code</label>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                style={{ height: 42, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "0 12px", fontSize: 18, letterSpacing: ".2em", fontFamily: "var(--font-sans)" }} />
              <Button full onClick={verify} disabled={busy || code.length < 6}>{busy ? "Checking…" : "Turn on two-factor"}</Button>
            </React.Fragment>
          )}
          {step === "done" && (
            <React.Fragment>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--status-accepted)", fontWeight: 600 }}><Icon name="check-check" size={16} />{doneTitle}</div>
              {backup.length > 0 && (
                <React.Fragment>
                  <div style={{ fontSize: 13 }}>Save these one-time backup codes somewhere safe — each works once if you lose your phone:</div>
                  <code style={{ display: "block", padding: "10px 12px", background: "var(--secondary)", borderRadius: "var(--radius-md)", fontSize: 13, lineHeight: 1.7 }}>{backup.join("   ")}</code>
                </React.Fragment>
              )}
              <Button full onClick={onDone}>Done</Button>
            </React.Fragment>
          )}
          {err && <div style={{ fontSize: 12.5, color: "var(--destructive)" }}>{err}</div>}
        </div>
      } />
  );
}

// This device's Web Push state (DT.pushStatus): granted / default / denied /
// ios-home-screen (iPhone Safari tab — push needs the Home Screen app) /
// ios-update / unsupported.
function dtReadPush() {
  try { return window.DT && DT.pushStatus ? DT.pushStatus() : ((typeof Notification !== "undefined" && Notification.permission) || "unsupported"); } catch (e) { return "unsupported"; }
}

// ---- one-time "Turn on alerts" card (A.CON-SHO-62 / A.CON-NEE-1) -----------
// The app never asks for notification permission by itself. Instead, signed in
// on a device that CAN take Web Push but has not been asked yet, this card
// offers it once; its button calls a.enablePush() synchronously inside the tap
// (what WebKit requires for the prompt to appear, and what keeps Chrome from
// auto-blocking an unprompted request). Dismissed, answered (allowed or
// blocked) or turned on, it never shows again on this device — Settings →
// Push notifications remains. In an iPhone/iPad Safari TAB (no Web Push until
// DocTurn is on the Home Screen) it explains Add to Home Screen instead, once
// the install banner (which says the same) is out of the way.
const ALERTS_CARD_KEY = "dt_alerts_card_done";
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: shows again next time */ } }
function EnableAlertsCard() {
  const st = useStore();
  const a = useActions();
  const [status, setStatus] = React.useState(dtReadPush);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(() => lsGet(ALERTS_CARD_KEY) === "1");
  const [flash, setFlash] = React.useState(null); // short confirmation after "Turn on"
  React.useEffect(() => {
    // Permission can change in system settings while the app is backgrounded.
    const on = () => { if (document.visibilityState === "visible") setStatus(dtReadPush()); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  React.useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);
  const role = st.session && st.session.role;
  if (!role || role === "developer") return null; // platform operators get no clinical alerts
  // Push switched off for the org (Settings → Integrations): the server refuses
  // device registration, so never offer it.
  if (window.DT && DT.moduleOn && !DT.moduleOn("integration.push")) return null;
  const finish = () => { lsSet(ALERTS_CARD_KEY, "1"); setDone(true); };
  if (flash) {
    return (
      <div data-alerts-card="done" role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#ECFDF5", borderBottom: "1px solid #A7F3D0", color: "#065F46", fontSize: 13, fontWeight: 600 }}>
        <Icon name="bell-ring" size={18} color="#065F46" />{flash}
      </div>
    );
  }
  if (done) return null;
  const iosTab = status === "ios-home-screen" && lsGet("dt_install_dismissed") === "1";
  if (status !== "default" && status !== "error" && !iosTab) return null;
  const turnOn = () => {
    if (!a.enablePush || busy) return;
    const pending = a.enablePush(); // first thing in the tap — no await before it
    setBusy(true);
    Promise.resolve(pending).then((res) => {
      const now = res || dtReadPush();
      setStatus(now);
      if (now === "granted") { finish(); setFlash("Alerts are on for this device."); }
      else if (now === "denied") finish(); // answered; Settings explains how to allow it later
    }, () => setStatus("error")).finally(() => setBusy(false));
  };
  const title = iosTab ? "STAT alerts need the Home Screen app" : status === "error" ? "Couldn't turn alerts on" : "Turn on STAT alerts";
  const sub = iosTab
    ? "Share → Add to Home Screen (iOS 16.4+), open DocTurn from there, then turn alerts on."
    : status === "error" ? "Check your connection and try again." : "Even when DocTurn is closed.";
  return (
    <div data-alerts-card={iosTab ? "ios" : "offer"} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 16px", background: "#EFF6FF", borderBottom: "1px solid #BFDBFE", color: "#1E3A8A" }}>
      <Icon name="bell-ring" size={18} color="#1D4ED8" />
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{sub}</div>
      </div>
      {!iosTab && (
        <button type="button" data-alerts-enable onClick={turnOn} disabled={busy}
          style={{ flex: "none", minHeight: 44, padding: "0 14px", borderRadius: "var(--radius-md)", border: "none", background: "#1D4ED8", color: "#fff", fontWeight: 700, fontSize: 13, cursor: busy ? "default" : "pointer", fontFamily: "var(--font-sans)", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Turning on…" : "Turn on"}
        </button>
      )}
      <button type="button" data-alerts-dismiss onClick={finish} title="Dismiss" aria-label="Dismiss alerts suggestion"
        style={{ flex: "none", width: 44, height: 44, borderRadius: "var(--radius-md)", border: "none", background: "transparent", color: "#1E3A8A", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="x" size={16} color="#1E3A8A" />
      </button>
    </div>
  );
}

function AccountSettings({ onLock }) {
  const st = useStore();
  const a = useActions();
  const role = (st.session && st.session.role) || "";
  const me = st.me || {};
  const [user, setUser] = React.useState(null);      // fresh /api/user (2FA state, org)
  const [mfaOpen, setMfaOpen] = React.useState(false);
  // This device's Web Push state (DT.pushStatus): granted / default / denied /
  // ios-home-screen (iPhone Safari tab — push needs the Home Screen app) /
  // unsupported; "error" after a failed attempt.
  const readPush = dtReadPush;
  const [pushState, setPushState] = React.useState(readPush);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [standalone] = React.useState(() => { try { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; } catch (e) { return false; } });
  const on = (id) => (window.DT && DT.moduleOn ? DT.moduleOn(id) : true);

  const refreshUser = React.useCallback(() => {
    try { fetch("/api/user", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((u) => { if (u) setUser(u); }).catch(() => {}); } catch (e) {}
  }, []);
  React.useEffect(() => { refreshUser(); }, [refreshUser]);

  const prefs = st.myPrefs || {};
  const dnd = !!(prefs.dnd);
  const coveringId = prefs.coveringUserId != null ? prefs.coveringUserId : null;
  const coveringPerson = coveringId == null ? null
    : [].concat(st.directory || [], st.providers || [], st.people || []).find((p) => p && (p.userId === coveringId || p.id === coveringId));
  const covering = coveringId == null ? null : (coveringPerson && coveringPerson.name) || "set";
  const isDirector = role === "director" || role === "er_director";
  const isClinical = role === "hospitalist" || role === "er_doctor";

  // The ONLY place the app asks for notification permission (A.CON-SHO-62 /
  // A.CON-NEE-1): a.enablePush() runs synchronously inside this tap, which is
  // what WebKit requires for the prompt to appear.
  const enablePush = () => {
    if (!a.enablePush || pushBusy) return;
    const pending = a.enablePush();
    setPushBusy(true);
    Promise.resolve(pending).then((st) => setPushState(st || readPush()), () => setPushState("error")).finally(() => setPushBusy(false));
  };
  const PUSH_SUB = {
    granted: "On for this device — STAT and new-message alerts arrive even when the app is closed",
    default: "Get alerted when the app is closed",
    denied: "Blocked for this site — allow notifications for DocTurn in your browser or device settings, then come back",
    "ios-home-screen": "On iPhone and iPad, alerts work only in the Home Screen app (iOS 16.4+): tap Share → Add to Home Screen, open DocTurn from your Home Screen, then turn alerts on here",
    "ios-update": "Alerts for Home Screen apps need iOS 16.4 or later — update iOS in Settings → General → Software Update",
    unsupported: "Not supported by this browser",
    error: "Couldn't turn alerts on — check your connection and try again",
  };
  const pushOff = !on("integration.push");
  const pushRight = pushOff ? <Badge status="offline">Off</Badge>
    : pushState === "granted" ? <Badge status="accepted">On</Badge>
    : pushState === "default" || pushState === "error" ? <Button size="sm" onClick={enablePush} style={{ opacity: pushBusy ? 0.6 : 1 }}>{pushBusy ? "Turning on…" : "Turn on"}</Button>
    : null;

  return (
    <div style={{ maxWidth: 640 }}>
      {/* profile card */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", marginBottom: 18 }}>
        <Avatar initials={me.avatar} size={48} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {a.renameMe ? <EditableText value={me.name || ""} onSave={a.renameMe} size={16} weight={700} /> : (me.name || "")}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", textTransform: "capitalize" }}>
            {role.replace(/_/g, " ")}{st.session && st.session.org ? " · " + st.session.org : ""}{user && user.username ? " · @" + user.username : ""}
          </div>
        </div>
      </div>

      {on("messaging.dnd") && (
        <SettingsGroup title="Availability">
          <SettingsRow icon="moon" title="Do not disturb" sub={dnd ? ("On" + (covering ? " · covering: " + covering : " · no covering provider set")) : "Off — you receive messages and on-call routing"}
            right={typeof DndButton === "function" ? <DndButton /> : null} />
          {typeof DndAwayMessageField === "function" && (
            <div style={{ padding: "10px 14px 12px", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 6 }}>Away message senders see while you're unavailable</div>
              <DndAwayMessageField />
            </div>
          )}
          {role === "hospitalist" && a.toggleOnShift && (
            <SettingsRow icon="activity" title="On shift" sub={st.ui && st.ui.onShift ? "Receiving admissions in the rotation" : "Off shift — not in the rotation"}
              right={<Switch on={!!(st.ui && st.ui.onShift)} onChange={() => a.toggleOnShift()} label="On shift" />} />
          )}
        </SettingsGroup>
      )}

      <SettingsGroup title="Notifications">
        <SettingsRow icon="bell" title="Push notifications" wrapSub rowProps={{ "data-push-row": pushState }}
          sub={pushOff ? "Switched off for your organization — a director can turn push notifications back on in Settings → Integrations" : (PUSH_SUB[pushState] || PUSH_SUB.default)}
          right={pushRight} />
        <SettingsRow icon="smartphone" title={standalone ? "Installed on this device" : "Install as an app"}
          sub={standalone ? "Running as a home-screen app" : "iPhone: Share → Add to Home Screen · Android: Install app"} />
      </SettingsGroup>

      <SettingsGroup title="Security">
        <SettingsRow icon="key-round" title="Change password" sub="Choose a new password for your account" right={typeof ChangePasswordButton === "function" ? <ChangePasswordButton /> : null} />
        <SettingsRow icon="shield-check" title="Two-factor authentication"
          sub={user ? (user.twoFactorEnabled ? "On — authenticator app" : "Off — recommended for every clinical account") : "Checking…"}
          right={user && user.twoFactorEnabled
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Badge status="accepted">On</Badge><Button size="sm" variant="outline" onClick={() => setMfaOpen(true)}>Manage</Button></span>
            : <Button size="sm" variant="outline" onClick={() => setMfaOpen(true)}>Set up</Button>} />
        {onLock && <SettingsRow icon="lock" title="Lock app now" sub="Require your password to continue" onClick={onLock} />}
      </SettingsGroup>

      {isDirector && (
        <SettingsGroup title="Organization">
          <SettingsRow icon="sliders-horizontal" title="Organization settings" sub="Rotation, timeouts, retention, consult services" onClick={() => a.setNav("settings")} />
          {on("platform.appearance") && <SettingsRow icon="palette" title="Appearance" sub="Colours, branding, navigation" onClick={() => a.setNav("appearance")} />}
          <SettingsRow icon="shield-check" title="Compliance monitor" sub="Live control checks and evidence" onClick={() => a.setNav("compliance-monitor")} />
        </SettingsGroup>
      )}
      {isClinical && (
        <SettingsGroup title="More">
          <SettingsRow icon="shield-check" title="Audit & compliance" sub="Your PHI access trail" onClick={() => a.setNav("compliance")} />
        </SettingsGroup>
      )}

      <SettingsGroup title="Session">
        <SettingsRow icon="log-out" title="Sign out" sub="Ends this session on this device" onClick={() => a.logout && a.logout()} />
      </SettingsGroup>

      {mfaOpen && <TwoFactorSetup enrolled={!!(user && user.twoFactorEnabled)} onDone={() => { setMfaOpen(false); refreshUser(); }} onCancel={() => setMfaOpen(false)} />}
    </div>
  );
}

Object.assign(window, { AccountSettings, EnableAlertsCard });
