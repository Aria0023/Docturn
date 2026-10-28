/* DocTurn web-app UI kit — App lock screen (real re-authentication).

   This screen used to accept ANY 4-digit PIN and had a "Face ID" button that
   unlocked unconditionally — a cosmetic overlay presented as a security
   control. It now performs a genuine server-side re-authentication: the user
   must re-enter their account password, which is verified by the server
   (POST /api/login with the locked session's org + username) before the app
   unlocks. A wrong password does not unlock, and repeated attempts hit the
   same auth rate limiter as the login screen.

   The unlock goes through DT.actions.login (api-bridge.js), i.e. it IS a sign-in:
   it re-establishes the server session (which may have idled out while the app
   sat locked — polling pauses while locked, see api-bridge.js), re-fetches every
   clinical slice, and an MFA-enrolled account is routed through its second
   factor exactly as at sign-in. The identity to re-authenticate (org, username)
   comes from the persisted lock flag (window.__dtLock), so the lock survives a
   page reload and this screen works before the session restore completes.
   (A.CON-SHO-7)

   The lock itself is the SERVER's: the shell's lockNow calls
   POST /api/session/lock, after which every data route answers 423 and
   GET /api/user reports locked, so this screen comes back on a reload even if
   the browser flag is deleted, and only the sign-in above unlocks.

   PIN unlock (PerfectServe parity #7, module security.pin, default off): when
   the SERVER says this locked session may use a PIN (GET /api/user →
   pinUnlock — asked each time this screen opens, never remembered), the
   screen offers it first. POST /api/session/unlock-pin lifts the server's
   lock on this same session; it is not a sign-in. Five wrong PINs disable it
   for this session and the screen falls back to the password, as it does
   when the session has ended. Nothing about the PIN is stored in the browser. */

function LockScreen({ me, appName, reason, onUnlock, onSignOut, identity }) {
  const st = (typeof useStore === "function") ? useStore() : {};
  const session = identity || st.session || {};
  const who = me || { name: session.name || "Signed in", avatar: (session.name || "?").charAt(0), role: session.role };
  const [pass, setPass] = React.useState("");
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState("password"); // "password" | "pin"
  const [pinOffered, setPinOffered] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const inputRef = React.useRef(null);
  const pinRef = React.useRef(null);

  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  // Ask the server whether this locked session may be re-opened with a PIN.
  React.useEffect(() => {
    const A = window.DT && window.DT.actions;
    if (!A || !A.pinUnlockAvailable) return;
    let live = true;
    Promise.resolve(A.pinUnlockAvailable()).then((ok) => {
      if (!live || !ok) return;
      setPinOffered(true); setMode("pin");
      setTimeout(() => { if (pinRef.current) pinRef.current.focus(); }, 0);
    });
    return () => { live = false; };
  }, []);
  const toPassword = (msg) => {
    setMode("password"); setPin(""); setErr(msg || null);
    setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 0);
  };

  function unlockPin(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!pin || busy) return;
    const A = window.DT && window.DT.actions;
    if (!A || !A.unlockWithPin) { toPassword(null); return; }
    setBusy(true); setErr(null);
    Promise.resolve(A.unlockWithPin(pin)).then((r) => {
      if (r && r.ok) { setPin(""); onUnlock(); return; }
      setPin("");
      const why = (r && r.error) || "";
      if (why === "wrong_pin") setErr("Incorrect PIN — " + r.attemptsLeft + (r.attemptsLeft === 1 ? " attempt" : " attempts") + " left before the password is required.");
      else if (why === "pin_disabled") { setPinOffered(false); toPassword("Too many wrong PINs — enter your password."); }
      else if (why === "signed_out") { setPinOffered(false); toPassword("Your session has ended — enter your password to sign in again."); }
      else if (why === "rate_limited") setErr("Too many attempts — wait a minute and try again.");
      else if (why === "network") setErr("Couldn't reach the server — check your connection.");
      else { setPinOffered(false); toPassword("PIN unlock is not available — enter your password."); }
    }).finally(() => setBusy(false));
  }

  function unlock(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!pass || busy) return;
    // Re-verify the password against the server. We deliberately do NOT trust
    // any client-side check — the server is the only authority on the password.
    setBusy(true); setErr(null);
    const A = window.DT && window.DT.actions;
    const done = () => { setPass(""); onUnlock(); };
    const fail = (status, msg) => {
      if (status === 429 || /too many/i.test(msg)) setErr("Too many attempts — wait a minute and try again.");
      else if (/reach the server|connection|network/i.test(msg)) setErr("Couldn't reach the server — check your connection.");
      else setErr("Incorrect password.");
    };
    if (A && A.login && window.DT.set && window.DT.getState) {
      // Full sign-in via api-bridge: sets the session, boots the data, and
      // leaves a loginError in the store when the server refuses.
      window.DT.set(function (s) { s.loginError = null; return s; });
      Promise.resolve(A.login(session.role, session.org, session.user, pass))
        .then(() => {
          const s = window.DT.getState();
          if (s.loginError) { fail(0, String(s.loginError)); return Promise.resolve(); }
          // Second factor pending: the server answered 202, the MFA screen takes over.
          if (s.mfaChallenge) { done(); return Promise.resolve(); }
          // Only the SERVER's word unlocks. (In synthetic-data mode api-bridge
          // falls back to local demo data when the server is unreachable; that
          // must never count as a successful re-authentication.)
          return fetch("/api/user", { credentials: "same-origin", cache: "no-store" })
            .then((r) => r.ok ? r.json() : null)
            .then((u) => { if (u && u.id != null && String(u.username || "").toLowerCase() === String(session.user || "").toLowerCase()) done(); else fail(0, "connection"); })
            .catch(() => fail(0, "connection"));
        })
        .catch((e2) => fail(e2 && e2.status, String((e2 && e2.message) || "")))
        .finally(() => setBusy(false));
      return;
    }
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ orgCode: session.org, username: session.user, password: pass }),
    })
      .then((r) => { if (r.ok) { done(); return; } fail(r.status, ""); })
      .catch(() => fail(0, "connection"))
      .finally(() => setBusy(false));
  }

  function signOut() {
    // Leaving the device: end the session outright rather than sitting locked.
    try { if (window.DT && window.DT.actions && window.DT.actions.logout) window.DT.actions.logout(); } catch (e) { /* fall through */ }
    (onSignOut || onUnlock)();
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="dt-lock-title" style={{ position: "fixed", inset: 0, zIndex: 80, background: "linear-gradient(160deg,#0b1220 0%,#172033 60%,#1e293b 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "max(20px, var(--sai-top, 0px)) max(20px, var(--sai-right, 0px)) max(20px, var(--sai-bottom, 0px)) max(20px, var(--sai-left, 0px))", animation: "dt-toast-in .2s ease" }}>
      <form onSubmit={mode === "pin" ? unlockPin : unlock} noValidate data-lock-mode={mode} style={{ width: 320, maxWidth: "100%", textAlign: "center", color: "#fff" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 22 }}>
          <span style={{ width: 56, height: 56, borderRadius: 16, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(37,99,235,.4)" }}><Icon name="lock" size={26} color="#fff" /></span>
          <div>
            <div id="dt-lock-title" style={{ fontSize: 18, fontWeight: 700 }}>{appName || "DocTurn"} locked</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)", marginTop: 3 }}>{mode === "pin" ? "Enter your PIN to continue" : (reason || "Enter your password to continue")}</div>
          </div>
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 14px 6px 6px", borderRadius: 99, background: "rgba(255,255,255,.08)", marginBottom: 18 }}>
          <span style={{ width: 30, height: 30, borderRadius: 99, background: "rgba(255,255,255,.16)", color: "#fff", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{who.avatar}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{who.name}</span>
        </div>

        {mode === "pin" ? (
          <input ref={pinRef} type="password" name="pin" value={pin} inputMode="numeric" pattern="[0-9]*" autoComplete="off" enterKeyHint="go" aria-label="PIN" maxLength={8} data-lock-pin
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); if (err) setErr(null); }}
            placeholder="PIN"
            style={{ width: "100%", height: 46, borderRadius: "var(--radius-md)", border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.10)", color: "#fff", padding: "0 14px", fontSize: 16, letterSpacing: 4, textAlign: "center", fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }} />
        ) : (
          <React.Fragment>
          {/* The username travels with the form (hidden) so password managers can
              match the saved credential for this account. */}
          <input type="text" name="username" autoComplete="username" value={session.user || ""} readOnly tabIndex={-1} aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
          <input ref={inputRef} type="password" name="password" value={pass} autoComplete="current-password" enterKeyHint="go" aria-label="Password"
            onChange={(e) => { setPass(e.target.value); if (err) setErr(null); }}
            placeholder="Password"
            style={{ width: "100%", height: 46, borderRadius: "var(--radius-md)", border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.10)", color: "#fff", padding: "0 14px", fontSize: 16, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }} />
          </React.Fragment>
        )}

        {err && (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center", padding: "8px 10px", marginBottom: 10, borderRadius: "var(--radius-md)", background: "rgba(185,28,28,.25)", border: "1px solid rgba(248,113,113,.5)", color: "#FCA5A5", fontSize: 12.5 }}>
            <Icon name="alert-triangle" size={14} color="#FCA5A5" />{err}
          </div>
        )}

        {(() => { const empty = mode === "pin" ? pin.length < 4 : !pass; return (
        <button type="submit" disabled={busy || empty}
          style={{ width: "100%", height: 46, borderRadius: "var(--radius-md)", border: "none", background: (busy || empty) ? "rgba(37,99,235,.45)" : "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: (busy || empty) ? "default" : "pointer" }}>
          {busy ? "Verifying…" : "Unlock"}
        </button>
        ); })()}

        {pinOffered && (
          <button type="button" data-lock-switch onClick={() => (mode === "pin" ? toPassword(null) : (setMode("pin"), setErr(null), setTimeout(() => { if (pinRef.current) pinRef.current.focus(); }, 0)))}
            style={{ marginTop: 8, minHeight: 44, padding: "10px 16px", border: "none", background: "transparent", color: "#93C5FD", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "block", width: "100%" }}>
            {mode === "pin" ? "Use password instead" : "Use PIN instead"}
          </button>
        )}

        <button type="button" onClick={signOut}
          style={{ marginTop: 8, minHeight: 44, padding: "10px 16px", border: "none", background: "transparent", color: "rgba(255,255,255,.75)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          Sign out instead
        </button>

        <div style={{ marginTop: 14, fontSize: 12, color: "rgba(255,255,255,.55)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="shield-check" size={13} color="rgba(255,255,255,.55)" />{mode === "pin" ? "PIN verified by the server · 5 wrong PINs require the password" : "Locks after 15 min idle · password verified by the server"}
        </div>
      </form>
    </div>
  );
}

Object.assign(window, { LockScreen });
