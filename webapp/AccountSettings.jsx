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

// A 44px-tall tap target around the 44x26 track. `busy`: the server has not
// answered yet — the switch shows the last confirmed state and ignores taps.
function Switch({ on, onChange, label, busy }) {
  return (
    <button type="button" aria-label={label} aria-pressed={!!on} aria-busy={busy ? "true" : undefined} disabled={!!busy} onClick={() => !busy && onChange && onChange(!on)}
      style={{ width: 44, height: 44, padding: 0, border: "none", background: "transparent", cursor: busy ? "progress" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: busy ? 0.6 : 1 }}>
      <span style={{ display: "block", width: 44, height: 26, borderRadius: 99, position: "relative", background: on ? "var(--primary)" : "#CBD5E1", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 99, background: "#fff", boxShadow: "var(--shadow-sm)", transition: "left .15s" }} />
      </span>
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

// A 44px action button that carries data-* hooks (Button does not forward them).
function ShiftBtn({ primary, onClick, disabled, children, ...rest }) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} aria-disabled={disabled ? "true" : undefined} {...rest}
      style={{ minHeight: 44, padding: "0 16px", borderRadius: "var(--radius-md)", fontSize: 14, fontWeight: 600, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", flex: "none",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        border: primary ? "1px solid var(--primary)" : "1px solid var(--border)", background: primary ? "var(--primary)" : "#fff", color: primary ? "#fff" : "var(--foreground)" }}>
      {children}
    </button>
  );
}

// End shift confirm (PerfectServe parity #4, module shift.handoff). States the
// server's rule before the one POST /api/shift/end: accepted patients stay
// with you (never re-routed); pending requests go to the covering provider you
// pick — required while any are pending, and they must be on shift. DND and
// the away message are offered only while messaging.dnd is on.
function EndShiftDialog({ status, onClose }) {
  const st = useStore();
  const a = useActions();
  const on = (id) => (window.DT && DT.moduleOn ? DT.moduleOn(id) : true);
  const pending = (status && status.pendingCount) || 0;
  const accepted = (status && status.acceptedCount) || 0;
  const meId = st.me && st.me.id;
  const [cover, setCover] = React.useState(status && status.coveringUserId != null ? status.coveringUserId : null);
  const [dnd, setDnd] = React.useState(false);
  const [away, setAway] = React.useState((status && status.awayMessage) || "");
  const [q, setQ] = React.useState("");
  const dndOn = on("messaging.dnd");
  // Pending requests can only be handed to someone in the rotation who is on
  // shift (the server refuses anyone else); with none pending, any colleague.
  const people = (st.directory || []).filter((d) => d.id !== meId && (!pending || d.working) &&
    (!q || (d.name || "").toLowerCase().includes(q.toLowerCase())));
  const coverValid = cover == null || people.some((d) => d.id === cover) || !pending;
  const canEnd = !st.shiftSaving && (!pending || (cover != null && coverValid));
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  function submit() {
    if (!canEnd) return;
    Promise.resolve(a.endShift({ coveringUserId: cover, dnd: dndOn && dnd, awayMessage: dndOn ? away : undefined }))
      .then((r) => { if (r && r.ok) onClose(); });
  }
  return (
    <Modal title="End shift" subtitle="Takes you off shift — round-robin stops sending you new admissions." icon="log-out" onClose={onClose}
      children={
        <div data-end-shift-dialog style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div data-shift-rule style={{ fontSize: 13.5, lineHeight: 1.45, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--secondary)" }}>
            <b>Accepted patients stay with you</b> — ending a shift never re-routes them{accepted ? " (" + plural(accepted, "accepted patient") + " on your census)" : ""}.
            {pending
              ? <span> You have <b data-shift-pending>{plural(pending, "pending request")}</b>: {pending === 1 ? "it goes" : "they go"} to the covering provider you choose, who must be on shift.</span>
              : <span> You have no pending requests.</span>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Covering provider{pending ? " (required)" : " (optional)"}</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colleagues…" aria-label="Search colleagues"
            style={{ fontSize: 16, minHeight: 44, padding: "0 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {people.map((d) => (
              <button key={d.id} type="button" data-shift-cover={d.id} aria-pressed={cover === d.id} onClick={() => setCover(cover === d.id && !pending ? null : d.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "6px 10px", borderRadius: "var(--radius-md)", border: "1px solid " + (cover === d.id ? "var(--primary)" : "var(--border)"), background: cover === d.id ? "#EFF6FF" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{d.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground)" }}>{d.specialty || "Provider"}{d.working ? " · on shift" : " · off shift"}</span>
                </span>
                {cover === d.id && <Icon name="check" size={16} color="var(--primary)" />}
              </button>
            ))}
            {people.length === 0 && <div data-shift-no-cover style={{ padding: 12, fontSize: 13, color: "var(--muted-foreground)", textAlign: "center" }}>{pending ? "Nobody else in the rotation is on shift, so your pending requests cannot be handed over yet." : "No colleagues found."}</div>}
          </div>
          {dndOn && (
            <React.Fragment>
              <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 14, cursor: "pointer" }}>
                <input type="checkbox" data-shift-dnd checked={dnd} onChange={(e) => setDnd(e.target.checked)} style={{ width: 22, height: 22 }} />
                Turn on do not disturb{cover != null ? " — messages forward to your covering provider" : ""}
              </label>
              <input value={away} onChange={(e) => setAway(e.target.value.slice(0, 280))} placeholder="Away message (optional)" aria-label="Away message" data-shift-away
                style={{ fontSize: 16, minHeight: 44, padding: "0 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            </React.Fragment>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <ShiftBtn onClick={onClose}>Cancel</ShiftBtn>
            <ShiftBtn primary onClick={submit} disabled={!canEnd} data-shift-confirm>{st.shiftSaving ? "Ending…" : "End shift"}</ShiftBtn>
          </div>
        </div>
      } />
  );
}

// PIN unlock (PerfectServe parity #7, module security.pin). Set / change is
// ONE PUT /api/security/pin with the account password re-entered — the server
// checks it and stores a scrypt hash; nothing about the PIN is kept here.
function PinDialog({ changing, onClose }) {
  const a = useActions();
  const [pw, setPw] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [pin2, setPin2] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const digits = (v) => v.replace(/\D/g, "").slice(0, 8);
  const mismatch = pin2.length > 0 && pin !== pin2;
  const ok = pw && pin.length >= 4 && pin === pin2 && !busy;
  function submit() {
    if (!ok) return;
    setBusy(true);
    Promise.resolve(a.setPin(pw, pin)).then((done) => { if (done) onClose(); else setPw(""); }).finally(() => setBusy(false));
  }
  const pinInput = { type: "password", inputMode: "numeric", pattern: "[0-9]*", autoComplete: "off", maxLength: 8 };
  return (
    <Modal title={changing ? "Change PIN" : "Set a PIN"} subtitle="A PIN re-opens this account after you lock it. It is not a sign-in." icon="key-round" onClose={onClose}
      children={
        <div data-pin-dialog style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.45, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--secondary)" }}>
            4–8 digits, not one repeated digit or a straight run like 1234. Checked by the DocTurn server; <b>five wrong PINs and the password is required</b>. The idle auto-lock still signs you out — the PIN only re-opens a lock you started, within 15 minutes.
          </div>
          <Field label="Your password" type="password" value={pw} onChange={setPw} autoComplete="current-password" inputProps={{ "data-pin-password": "" }} />
          <Field label={changing ? "New PIN" : "PIN"} value={pin} onChange={(v) => setPin(digits(v))} inputProps={{ ...pinInput, "data-pin-new": "" }} />
          <Field label="PIN again" value={pin2} onChange={(v) => setPin2(digits(v))} error={mismatch ? "The PINs do not match." : undefined} inputProps={{ ...pinInput, "data-pin-confirm": "" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <ShiftBtn onClick={onClose}>Cancel</ShiftBtn>
            <ShiftBtn primary onClick={submit} disabled={!ok} data-pin-save>{busy ? "Saving…" : changing ? "Change PIN" : "Set PIN"}</ShiftBtn>
          </div>
        </div>
      } />
  );
}

// Quick responses (PerfectServe parity #6, module messaging.templates). The
// user's PERSONAL templates — the same rows the composer's Templates picker
// and phone chips insert — managed here; there is no second store. Every
// write is one server call followed by a re-read, so the list is the
// server's. The organization's templates are shown read-only (directors
// manage those from the composer's Templates picker).
const QR_PRIORITY = { routine: ["Routine", "var(--muted-foreground)"], urgent: ["Urgent", "#B45309"], stat: ["STAT", "#B91C1C"] };
function QuickResponses() {
  const st = useStore();
  const a = useActions();
  const on = (id) => (window.DT && DT.moduleOn ? DT.moduleOn(id) : true);
  const modOn = on("messaging.templates");
  const prioOn = on("messaging.priority");
  const [loaded, setLoaded] = React.useState(false);
  const [editing, setEditing] = React.useState(null); // null | "new" | template id
  const [form, setForm] = React.useState({ title: "", body: "", priority: "routine" });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!modOn || !a.listTemplates) return;
    Promise.resolve(a.listTemplates()).finally(() => setLoaded(true));
  }, [modOn]);
  const all = st.templates || [];
  const mine = all.filter((t) => t.scope === "mine");
  const org = all.filter((t) => t.scope !== "mine");
  const startNew = () => { setForm({ title: "", body: "", priority: "routine" }); setEditing("new"); };
  const startEdit = (t) => { setForm({ title: t.title, body: t.body, priority: t.priority || "routine" }); setEditing(t.id); };
  const save = () => {
    const title = form.title.trim(), body = form.body.trim();
    if (!title || !body || busy) return;
    setBusy(true);
    const priority = prioOn ? form.priority : "routine";
    const p = editing === "new"
      ? a.createTemplate({ title, body, priority, scope: "mine" })
      : a.updateTemplate(editing, { title, body, priority });
    Promise.resolve(p).then((r) => { if (r) setEditing(null); }).finally(() => setBusy(false));
  };
  const remove = (t) => {
    if (busy || !window.confirm('Delete the quick response "' + t.title + '"?')) return;
    setBusy(true);
    Promise.resolve(a.deleteTemplate(t.id)).finally(() => setBusy(false));
  };
  const pill = (pr) => <span style={{ fontSize: 12, fontWeight: 700, padding: "1px 7px", borderRadius: 4, color: QR_PRIORITY[pr] ? QR_PRIORITY[pr][1] : "var(--muted-foreground)", border: "1px solid var(--border)", flex: "none" }}>{QR_PRIORITY[pr] ? QR_PRIORITY[pr][0] : pr}</span>;
  const back = <ShiftBtn data-qr-back onClick={() => a.setNav("account")}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="arrow-left" size={15} />Settings</span></ShiftBtn>;
  if (!modOn) {
    return (
      <div data-quick-responses-page="off" style={{ maxWidth: 640 }}>
        <div style={{ marginBottom: 14 }}>{back}</div>
        <SettingsGroup title="Quick responses">
          <SettingsRow icon="message-square-text" title="Switched off for your organization" wrapSub sub="Message templates and quick responses are switched off by the DocTurn operator for your organization." />
        </SettingsGroup>
      </div>
    );
  }
  const row = (t, editable) => (
    <div key={t.id} data-qr-item={t.id} data-qr-scope={t.scope} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "#fff", minWidth: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{t.title}</span>
          {pill(t.priority || "routine")}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2, overflowWrap: "anywhere" }}>{t.body}</div>
      </div>
      {editable && (
        <span style={{ display: "inline-flex", gap: 6, flex: "none" }}>
          <ShiftBtn data-qr-edit={t.id} aria-label={"Edit " + t.title} disabled={busy} onClick={() => startEdit(t)}><Icon name="pencil" size={15} /></ShiftBtn>
          <ShiftBtn data-qr-delete={t.id} aria-label={"Delete " + t.title} disabled={busy} onClick={() => remove(t)}><Icon name="trash-2" size={15} /></ShiftBtn>
        </span>
      )}
    </div>
  );
  return (
    <div data-quick-responses-page="on" style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 14 }}>{back}</div>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 14, lineHeight: 1.45 }}>
        Tap one above the message box (on a phone) or pick it from Templates to insert it into your message. Stored on the DocTurn server for your account — the same as your personal templates. Keep patient details out of them.
      </div>
      <SettingsGroup title="My quick responses">
        {!loaded && mine.length === 0 && <SettingsRow icon="loader" title="Loading…" />}
        {loaded && mine.length === 0 && editing !== "new" && <SettingsRow icon="message-square-text" title="None yet" wrapSub sub="Add the replies you send most — e.g. “On my way”, “Call me back”." />}
        {mine.map((t) => (editing === t.id ? null : row(t, true)))}
        {editing != null && (
          <div data-qr-form={editing === "new" ? "new" : editing} style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Shown on the chip, e.g. On my way" inputProps={{ maxLength: 120, "data-qr-title": "" }} />
            <Field label="Message" textarea rows={2} value={form.body} onChange={(v) => setForm({ ...form, body: v })} placeholder="The text inserted into your message. No patient details." inputProps={{ maxLength: 2000, "data-qr-body": "" }} />
            {prioOn && (
              <div role="radiogroup" aria-label="Priority" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--muted-foreground)", marginRight: 2 }}>Sets priority</span>
                {Object.keys(QR_PRIORITY).map((id) => (
                  <button key={id} type="button" role="radio" aria-checked={form.priority === id} data-qr-priority={id} onClick={() => setForm({ ...form, priority: id })}
                    style={{ minHeight: 44, minWidth: 44, padding: "0 12px", borderRadius: 99, cursor: "pointer", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                      color: form.priority === id ? "#fff" : QR_PRIORITY[id][1], background: form.priority === id ? QR_PRIORITY[id][1] : "transparent", border: "1px solid " + (form.priority === id ? QR_PRIORITY[id][1] : "var(--border)") }}>{QR_PRIORITY[id][0]}</button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <ShiftBtn data-qr-cancel disabled={busy} onClick={() => setEditing(null)}>Cancel</ShiftBtn>
              <ShiftBtn primary data-qr-save disabled={busy || !form.title.trim() || !form.body.trim()} onClick={save}>{busy ? "Saving…" : editing === "new" ? "Add" : "Save"}</ShiftBtn>
            </div>
          </div>
        )}
        {editing == null && (
          <SettingsRow icon="plus" title="Add quick response" rowProps={{ "data-qr-add": "" }} onClick={startNew} />
        )}
      </SettingsGroup>
      {org.length > 0 && (
        <SettingsGroup title="From your organization">
          {org.map((t) => row(t, false))}
        </SettingsGroup>
      )}
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
  const myProv = st.myProvider || null;
  const shiftOn = on("shift.handoff");
  const shift = st.shiftStatus || null;
  const [endOpen, setEndOpen] = React.useState(false);
  // My shift truth (pending / accepted counts) from the server, re-read when
  // my On shift changes.
  React.useEffect(() => { if (shiftOn && myProv && a.loadShift) a.loadShift(); }, [shiftOn, !!myProv, myProv && myProv.working]);
  const reminderOn = on("messaging.unreadReminder");
  const reminder = st.reminderPrefs || null;
  React.useEffect(() => { if (reminderOn && a.loadReminderPrefs) a.loadReminderPrefs(); }, [reminderOn]);
  const pinOn = on("security.pin");
  const pinStatus = st.pinStatus || null;
  const [pinOpen, setPinOpen] = React.useState(false);
  const [pinBusy, setPinBusy] = React.useState(false);
  React.useEffect(() => { if (pinOn && a.loadPin) a.loadPin(); }, [pinOn]);
  const removePin = () => {
    if (pinBusy || !window.confirm("Remove your PIN? Unlocking will need your password.")) return;
    setPinBusy(true);
    Promise.resolve(a.removePin()).finally(() => setPinBusy(false));
  };

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
          {/* Read-only: a clinician's name is identity data the organization
              manages (People / the director's provider edit) — there is no
              self-rename on the server (A.CON comms-account #2). */}
          <div data-profile-name style={{ fontSize: 16, fontWeight: 700, overflowWrap: "anywhere" }}>{me.name || ""}</div>
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
        </SettingsGroup>
      )}

      {/* On shift = MY rotation profile's working flag on the server, the one
          round-robin reads (A.CON comms-account #1). The switch moves when
          the server answers. A hospitalist with no rotation profile (e.g. a
          PA on a care team) is told so instead of being given a switch. */}
      {/* End shift / Start shift (module shift.handoff) replaces the bare
          switch for anyone with a rotation profile — hospitalist or a
          director who takes patients: one server action that hands pending
          requests to a covering provider and never re-routes accepted ones. */}
      {shiftOn && myProv && (
        <SettingsGroup title="Rotation">
          <SettingsRow icon={myProv.working ? "log-out" : "log-in"} title={myProv.working ? "End shift" : "Start shift"} wrapSub
            rowProps={{ "data-shift-row": myProv.working ? "on" : "off" }}
            sub={myProv.working
              ? "On shift" + (shift && shift.pendingCount ? " · " + shift.pendingCount + " pending request" + (shift.pendingCount === 1 ? "" : "s") + " — a covering provider takes them when you end" : "") + ". Accepted patients stay with you."
              : "Off shift — round-robin skips you" + (prefs.dnd ? " · do not disturb is on (Start shift turns it off)" : "")}
            right={myProv.working
              ? <ShiftBtn data-shift-action="end" disabled={!!st.shiftSaving} onClick={() => { a.loadShift(); setEndOpen(true); }}>End shift</ShiftBtn>
              : <ShiftBtn primary data-shift-action="start" disabled={!!st.shiftSaving} onClick={() => a.startShift()}>{st.shiftSaving ? "Starting…" : "Start shift"}</ShiftBtn>} />
        </SettingsGroup>
      )}
      {endOpen && <EndShiftDialog status={shift} onClose={() => setEndOpen(false)} />}
      {!(shiftOn && myProv) && (role === "hospitalist" || myProv) && (myProv || st.isProvider === false) && (
        <SettingsGroup title="Rotation">
          {myProv
            ? <SettingsRow icon="activity" title="On shift" wrapSub rowProps={{ "data-onshift-row": myProv.working ? "on" : "off" }}
                sub={myProv.working
                  ? (myProv.inRotation ? "On shift — round-robin can send you new admissions" : "On shift — but a director has taken you out of the round-robin, so it skips you")
                  : "Off shift — round-robin skips you"}
                right={<Switch on={!!myProv.working} busy={!!st.myProviderSaving} onChange={() => a.toggleOnShift()} label="On shift" />} />
            : <SettingsRow icon="activity" title="Not in the rotation" wrapSub rowProps={{ "data-onshift-row": "none" }}
                sub="You have no rotation profile, so round-robin never sends you admissions. A director adds you to the rotation." />}
        </SettingsGroup>
      )}

      <SettingsGroup title="Notifications">
        <SettingsRow icon="bell" title="Push notifications" wrapSub rowProps={{ "data-push-row": pushState }}
          sub={pushOff ? "Switched off for your organization — a director can turn push notifications back on in Settings → Integrations" : (PUSH_SUB[pushState] || PUSH_SUB.default)}
          right={pushRight} />
        {/* Unread-message reminder (module messaging.unreadReminder): stored
            on the server, sent by the server's sweep — content-free, never
            while DND. The row says when a push could not reach this device. */}
        {on("messaging.unreadReminder") && reminder && (
          <React.Fragment>
            <SettingsRow icon="bell-ring" title="Unread-message reminder" wrapSub rowProps={{ "data-reminder-row": reminder.enabled ? "on" : "off" }}
              sub={(reminder.enabled
                  ? "On — a push every " + reminder.intervalMin + " min while messages stay unread (not while do not disturb is on). The push says only that you have unread messages."
                  : "Off — no reminders. Turn on to get a content-free push while messages stay unread.") +
                (pushOff ? " Push is switched off for your organization, so no reminder can reach you." : reminder.enabled && pushState !== "granted" ? " Push is not on for this device — turn on Push notifications above to receive it here." : "")}
              right={<Switch on={!!reminder.enabled} busy={!!st.reminderSaving} onChange={() => a.setReminderPrefs(!reminder.enabled, reminder.intervalMin)} label="Unread-message reminder" />} />
            {reminder.enabled && (
              <div data-reminder-intervals style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 14px 12px 60px", borderTop: "1px solid var(--border)" }}>
                <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginRight: 4 }}>Remind every</span>
                {(reminder.intervals || [5, 10, 15, 30]).map((n) => (
                  <button key={n} type="button" data-reminder-interval={n} aria-pressed={reminder.intervalMin === n}
                    onClick={() => (st.reminderSaving || reminder.intervalMin === n ? null : a.setReminderPrefs(true, n))}
                    style={{ minWidth: 44, minHeight: 44, padding: "0 12px", borderRadius: "var(--radius-md)", fontSize: 14, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
                      border: "1px solid " + (reminder.intervalMin === n ? "var(--primary)" : "var(--border)"), background: reminder.intervalMin === n ? "#EFF6FF" : "#fff", color: reminder.intervalMin === n ? "var(--primary)" : "var(--foreground)" }}>
                    {n} min
                  </button>
                ))}
              </div>
            )}
          </React.Fragment>
        )}
        {/* Quick responses = my personal message templates (messaging.templates). */}
        {on("messaging.templates") && (
          <SettingsRow icon="message-square-text" title="Quick responses" wrapSub rowProps={{ "data-qr-row": "" }}
            sub="Your saved replies — one tap inserts them above the message box"
            onClick={() => a.setNav("quick-responses")} />
        )}
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
        {pinOn && (
          <SettingsRow icon="key-round" title="PIN unlock" wrapSub rowProps={{ "data-pin-row": pinStatus ? (pinStatus.set ? "set" : "unset") : "loading" }}
            sub={!pinStatus ? "Checking…" : pinStatus.set ? "On — your PIN re-opens a locked session; 5 wrong PINs require the password" : "Off — set a 4–8 digit PIN to re-open a locked session"}
            right={pinStatus && (pinStatus.set
              ? <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}><ShiftBtn data-pin-change onClick={() => setPinOpen(true)}>Change</ShiftBtn><ShiftBtn data-pin-remove disabled={pinBusy} onClick={removePin}>Remove</ShiftBtn></span>
              : <ShiftBtn data-pin-set onClick={() => setPinOpen(true)}>Set PIN</ShiftBtn>)} />
        )}
        {onLock && <SettingsRow icon="lock" title="Lock app now" sub={pinOn && pinStatus && pinStatus.set ? "Require your PIN or password to continue" : "Require your password to continue"} onClick={onLock} />}
      </SettingsGroup>
      {pinOpen && <PinDialog changing={!!(pinStatus && pinStatus.set)} onClose={() => setPinOpen(false)} />}

      {isDirector && (
        <SettingsGroup title="Organization">
          <SettingsRow icon="sliders-horizontal" title="Organization settings" sub="Rotation, timeouts, retention, consult services" onClick={() => a.setNav("settings")} />
          {on("platform.appearance") && <SettingsRow icon="palette" title="Appearance" sub="Colours, branding, navigation" onClick={() => a.setNav("appearance")} />}
          <SettingsRow icon="shield-check" title="Compliance monitor" sub="Live control checks and evidence" onClick={() => a.setNav("compliance-monitor")} />
        </SettingsGroup>
      )}
      {isClinical && (
        <SettingsGroup title="More">
          <SettingsRow icon="shield-check" title="My audit trail" sub="What you did and which records you opened, from the server" onClick={() => a.setNav("compliance")} />
        </SettingsGroup>
      )}

      <SettingsGroup title="Session">
        <SettingsRow icon="log-out" title="Sign out" sub="Ends this session on this device" onClick={() => a.logout && a.logout()} />
      </SettingsGroup>

      {mfaOpen && <TwoFactorSetup enrolled={!!(user && user.twoFactorEnabled)} onDone={() => { setMfaOpen(false); refreshUser(); }} onCancel={() => setMfaOpen(false)} />}
    </div>
  );
}

Object.assign(window, { AccountSettings, EnableAlertsCard, QuickResponses });
