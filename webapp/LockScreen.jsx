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
   the browser flag is deleted, and only the sign-in above unlocks. */

function LockScreen({ me, appName, reason, onUnlock, onSignOut, identity }) {
  const st = (typeof useStore === "function") ? useStore() : {};
  const session = identity || st.session || {};
  const who = me || { name: session.name || "Signed in", avatar: (session.name || "?").charAt(0), role: session.role };
  const [pass, setPass] = React.useState("");
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef(null);

  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

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
      <form onSubmit={unlock} noValidate style={{ width: 320, maxWidth: "100%", textAlign: "center", color: "#fff" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 22 }}>
          <span style={{ width: 56, height: 56, borderRadius: 16, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(37,99,235,.4)" }}><Icon name="lock" size={26} color="#fff" /></span>
          <div>
            <div id="dt-lock-title" style={{ fontSize: 18, fontWeight: 700 }}>{appName || "DocTurn"} locked</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.7)", marginTop: 3 }}>{reason || "Enter your password to continue"}</div>
          </div>
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 14px 6px 6px", borderRadius: 99, background: "rgba(255,255,255,.08)", marginBottom: 18 }}>
          <span style={{ width: 30, height: 30, borderRadius: 99, background: "rgba(255,255,255,.16)", color: "#fff", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{who.avatar}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{who.name}</span>
        </div>

        {/* The username travels with the form (hidden) so password managers can
            match the saved credential for this account. */}
        <input type="text" name="username" autoComplete="username" value={session.user || ""} readOnly tabIndex={-1} aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
        <input ref={inputRef} type="password" name="password" value={pass} autoComplete="current-password" enterKeyHint="go" aria-label="Password"
          onChange={(e) => { setPass(e.target.value); if (err) setErr(null); }}
          placeholder="Password"
          style={{ width: "100%", height: 46, borderRadius: "var(--radius-md)", border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.10)", color: "#fff", padding: "0 14px", fontSize: 16, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }} />

        {err && (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center", padding: "8px 10px", marginBottom: 10, borderRadius: "var(--radius-md)", background: "rgba(185,28,28,.25)", border: "1px solid rgba(248,113,113,.5)", color: "#FCA5A5", fontSize: 12.5 }}>
            <Icon name="alert-triangle" size={14} color="#FCA5A5" />{err}
          </div>
        )}

        <button type="submit" disabled={busy || !pass}
          style={{ width: "100%", height: 46, borderRadius: "var(--radius-md)", border: "none", background: (busy || !pass) ? "rgba(37,99,235,.45)" : "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: (busy || !pass) ? "default" : "pointer" }}>
          {busy ? "Verifying…" : "Unlock"}
        </button>

        <button type="button" onClick={signOut}
          style={{ marginTop: 8, minHeight: 44, padding: "10px 16px", border: "none", background: "transparent", color: "rgba(255,255,255,.75)", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          Sign out instead
        </button>

        <div style={{ marginTop: 14, fontSize: 12, color: "rgba(255,255,255,.55)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="shield-check" size={13} color="rgba(255,255,255,.55)" />Locks after 15 min idle · password verified by the server
        </div>
      </form>
    </div>
  );
}

Object.assign(window, { LockScreen });
