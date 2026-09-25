/* DocTurn web-app UI kit — App lock screen (real re-authentication).

   This screen used to accept ANY 4-digit PIN and had a "Face ID" button that
   unlocked unconditionally — a cosmetic overlay presented as a security
   control. It now performs a genuine server-side re-authentication: the user
   must re-enter their account password, which is verified by the server
   (POST /api/login with the current session's org + username) before the app
   unlocks. A wrong password does not unlock, and repeated attempts hit the
   same auth rate limiter as the login screen.

   Note the real control here is the SERVER's 15-minute rolling idle expiry;
   this screen is the client-side companion to it, not a substitute. */

function LockScreen({ me, appName, reason, onUnlock }) {
  const st = (typeof useStore === "function") ? useStore() : {};
  const session = st.session || {};
  const who = me || { name: session.name || "Signed in", avatar: (session.name || "?").charAt(0), role: session.role };
  const [pass, setPass] = React.useState("");
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef(null);

  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  function unlock() {
    if (!pass || busy) return;
    // Re-verify the password against the server. We deliberately do NOT trust
    // any client-side check — the server is the only authority on the password.
    setBusy(true); setErr(null);
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ orgCode: session.org, username: session.user, password: pass }),
    })
      .then((r) => {
        if (r.ok) { setPass(""); onUnlock(); return; }
        if (r.status === 429) { setErr("Too many attempts — wait a minute and try again."); return; }
        setErr("Incorrect password.");
      })
      .catch(() => setErr("Couldn't reach the server — check your connection."))
      .finally(() => setBusy(false));
  }

  function signOut() {
    // Leaving the device: end the session outright rather than sitting locked.
    try { if (window.DT && window.DT.actions && window.DT.actions.logout) window.DT.actions.logout(); } catch (e) { /* fall through */ }
    onUnlock();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "linear-gradient(160deg,#0b1220 0%,#172033 60%,#1e293b 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "dt-toast-in .2s ease" }}>
      <div style={{ width: 320, maxWidth: "100%", textAlign: "center", color: "#fff" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginBottom: 22 }}>
          <span style={{ width: 56, height: 56, borderRadius: 16, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(37,99,235,.4)" }}><Icon name="lock" size={26} color="#fff" /></span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{appName || "DocTurn"} locked</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)", marginTop: 3 }}>{reason || "Enter your password to continue"}</div>
          </div>
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "6px 14px 6px 6px", borderRadius: 99, background: "rgba(255,255,255,.08)", marginBottom: 18 }}>
          <span style={{ width: 30, height: 30, borderRadius: 99, background: "rgba(255,255,255,.16)", color: "#fff", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{who.avatar}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{who.name}</span>
        </div>

        <input ref={inputRef} type="password" value={pass} autoComplete="current-password"
          onChange={(e) => { setPass(e.target.value); if (err) setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") unlock(); }}
          placeholder="Password"
          style={{ width: "100%", height: 46, borderRadius: "var(--radius-md)", border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.10)", color: "#fff", padding: "0 14px", fontSize: 16, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }} />

        {err && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center", padding: "8px 10px", marginBottom: 10, borderRadius: "var(--radius-md)", background: "rgba(185,28,28,.25)", border: "1px solid rgba(248,113,113,.5)", color: "#FCA5A5", fontSize: 12.5 }}>
            <Icon name="alert-triangle" size={14} color="#FCA5A5" />{err}
          </div>
        )}

        <button onClick={unlock} disabled={busy || !pass}
          style={{ width: "100%", height: 46, borderRadius: "var(--radius-md)", border: "none", background: (busy || !pass) ? "rgba(37,99,235,.45)" : "var(--primary)", color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: (busy || !pass) ? "default" : "pointer" }}>
          {busy ? "Verifying…" : "Unlock"}
        </button>

        <button onClick={signOut}
          style={{ marginTop: 12, border: "none", background: "transparent", color: "rgba(255,255,255,.65)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          Sign out instead
        </button>

        <div style={{ marginTop: 20, fontSize: 11.5, color: "rgba(255,255,255,.45)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="shield-check" size={13} color="rgba(255,255,255,.45)" />Locks after 15 min idle · password verified by the server
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LockScreen });
