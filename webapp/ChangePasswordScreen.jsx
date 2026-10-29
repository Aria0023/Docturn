/* DocTurn web-app UI kit — forced password change + one-time credential reveal.

   ChangePasswordScreen: shown instead of the app whenever the server says the
   account still carries a one-time (provisioned / admin-reset) password
   (/api/user.mustChangePassword, or a 403 password_change_required). The user
   must set their own password before anything else loads. Mirrors the MFA
   enrolment hold in MfaScreen.jsx.

   CredentialReveal: the modal an administrator sees once after creating an
   account or resetting a password. The temporary password lives only in React
   state until dismissed — never persisted, never toasted. */

function ChangePasswordScreen({ me, appName, onDone, onSignOut }) {
  const brand = appName || "DocTurn";
  const mobile = useIsMobile();
  const actions = (window.DT && window.DT.actions) || {};
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const weak = next && (next.length < 8 || /^(docturn|password)$/i.test(next));
  const mismatch = confirm && next !== confirm;
  const canSave = cur && next.length >= 8 && !weak && next === confirm && !busy;

  function submit() {
    if (!canSave) return;
    setBusy(true); setErr(null);
    Promise.resolve(actions.changePassword(cur, next))
      .then((r) => {
        if (!(r && r.ok)) throw new Error("rejected");
        return actions.passwordChangeDone ? actions.passwordChangeDone() : null;
      })
      .then(() => { if (onDone) onDone(); })
      .catch((e) => {
        const m = String((e && e.message) || "");
        setErr(m === "wrong_password" ? "That isn't the temporary password you were given."
          : m === "weak_password" ? "Choose a different password: at least 8 characters, not the demo password, and not the same as the temporary one."
          : "Couldn't update the password — try again.");
      })
      .finally(() => setBusy(false));
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, var(--secondary), var(--background))", padding: mobile ? "20px 14px" : 28 }}>
      <div style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", padding: mobile ? "26px 20px" : "32px 30px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="key-round" size={18} color="#fff" /></span>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{brand}</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "22px 0 6px", textAlign: "center" }}>Set your password</h1>
        <p style={{ fontSize: 13.5, color: "var(--muted-foreground)", margin: "0 0 20px", textAlign: "center", lineHeight: 1.5 }}>
          {me && me.name ? <b style={{ color: "var(--foreground)" }}>{me.name}</b> : "Your account"} was set up with a one-time password. Choose your own before continuing — nobody else will know it.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Temporary password" icon="lock" type="password" value={cur} onChange={setCur} placeholder="The password you were given" inputProps={{ autoComplete: "current-password", name: "current" }} />
          <Field label="New password" icon="key-round" type="password" value={next} onChange={setNext} placeholder="At least 8 characters" error={weak ? "At least 8 characters, and not a demo or default password." : ""} inputProps={{ autoComplete: "new-password", name: "new" }} />
          <Field label="Confirm new password" icon="key-round" type="password" value={confirm} onChange={setConfirm} placeholder="Re-enter it" error={mismatch ? "Passwords don't match." : ""} inputProps={{ autoComplete: "new-password", name: "confirm", onKeyDown: (e) => { if (e.key === "Enter") submit(); } }} />
          {err && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-rejected-bg)", border: "1px solid var(--status-rejected)", color: "var(--status-rejected)", fontSize: 12.5, lineHeight: 1.45 }}>
              <Icon name="alert-triangle" size={15} style={{ marginTop: 1, flex: "none" }} /><span>{err}</span>
            </div>
          )}
          <Button full size="lg" onClick={submit} style={{ opacity: canSave ? 1 : 0.55, pointerEvents: canSave ? "auto" : "none" }}>{busy ? "Saving…" : "Save and continue"}</Button>
          <button onClick={onSignOut} style={{ border: "none", background: "transparent", color: "var(--muted-foreground)", fontSize: 12.5, cursor: "pointer", fontFamily: "var(--font-sans)", padding: 6 }}>Sign out instead</button>
        </div>
      </div>
    </div>
  );
}

function CredentialReveal() {
  const st = (typeof useStore === "function") ? useStore() : {};
  const c = st.__credentialReveal;
  const [copied, setCopied] = React.useState(false);
  if (!c) return null;
  const a = (window.DT && window.DT.actions) || {};
  const text = (c.username ? "Username: " + c.username + "\n" : "") + "Temporary password: " + (c.temporaryPassword || "");
  function copy() {
    try { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); } catch (e) { /* clipboard unavailable */ }
  }
  return (
    <Modal title={c.title || "One-time password"} subtitle={(c.name ? c.name + " — " : "") + "shown once; it is not stored anywhere."} icon="key-round" onClose={() => a.dismissCredentialReveal && a.dismissCredentialReveal()}
      children={
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {c.username && <div style={{ fontSize: 13 }}><span style={{ color: "var(--muted-foreground)" }}>Username</span> <code style={{ fontSize: 14, fontWeight: 700, marginLeft: 8 }}>{c.username}</code></div>}
          <div style={{ padding: "14px 16px", borderRadius: "var(--radius-md)", background: "var(--secondary)", border: "1px dashed var(--border)", textAlign: "center" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 6 }}>Temporary password</div>
            <code style={{ fontSize: 22, fontWeight: 800, letterSpacing: ".06em", wordBreak: "break-all" }}>{c.temporaryPassword || "—"}</code>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Give this to the person <b>out of band</b> (in person or by phone — not in a chat or email). They must replace it the first time they sign in. If it's lost, use <b>Reset password</b> to issue a new one.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="outline" size="sm" icon={copied ? "check" : "copy"} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
            <Button size="sm" onClick={() => a.dismissCredentialReveal && a.dismissCredentialReveal()}>Done</Button>
          </div>
        </div>
      } />
  );
}

Object.assign(window, { ChangePasswordScreen, CredentialReveal });
