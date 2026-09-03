/* DocTurn web-app UI kit — two-factor authentication screens.

   MfaEnrollScreen — shown full-screen (no sidebar, no navigation) whenever
   /api/user reports `mfaEnrollmentRequired`: the organization has switched on
   "Require MFA for privileged roles" and this director / ER director /
   developer has not enrolled yet. The SERVER answers every other API route 403
   until enrolment completes, so this screen is the only thing the user can do.
   It drives the existing TOTP flow:
     POST /api/mfa/enroll → { secret, otpauthUrl }
     POST /api/mfa/verify → { activated, backupCodes[] }   (shown ONCE)

   MfaChallengeScreen — the second factor at sign-in for an already-enrolled
   account: POST /api/login answered 202 { twoFactorRequired } and the session
   is held until POST /api/2fa/complete-login succeeds (TOTP, SMS code or a
   backup code all go through the same field). */

function dtGroupSecret(secret) {
  return String(secret || "").replace(/(.{4})/g, "$1 ").trim();
}

function MfaShell({ appName, children }) {
  const brand = appName || "DocTurn";
  const mobile = useIsMobile();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, var(--secondary), var(--background))", padding: mobile ? "20px 14px" : 28 }}>
      <div style={{ width: "100%", maxWidth: 440, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", padding: mobile ? "24px 18px" : "30px 30px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 18 }}>
          <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 19 }}>{brand.charAt(0).toUpperCase()}</span>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{brand}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function MfaErrorBox({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-rejected-bg)", border: "1px solid var(--status-rejected)", color: "var(--status-rejected)", fontSize: 12.5, lineHeight: 1.45 }}>
      <Icon name="alert-triangle" size={15} style={{ marginTop: 1, flex: "none" }} /><span>{children}</span>
    </div>
  );
}

function MfaEnrollScreen({ me, appName, onDone, onSignOut }) {
  const [setup, setSetup] = React.useState(null);        // { secret, otpauthUrl }
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [backupCodes, setBackupCodes] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const actions = (window.DT && window.DT.actions) || {};
  const who = me || {};

  React.useEffect(() => {
    let alive = true;
    if (!actions.mfaBeginEnrollment) { setErr("Two-factor setup needs the live backend — reload and try again."); return; }
    Promise.resolve(actions.mfaBeginEnrollment())
      .then((r) => { if (alive) setSetup(r || null); })
      .catch(() => { if (alive) setErr("Couldn't start enrolment — check your connection and reload."); });
    return () => { alive = false; };
  }, []);

  function verify() {
    const clean = code.replace(/\s+/g, "");
    if (busy || clean.length < 6) return;
    setBusy(true); setErr(null);
    Promise.resolve(actions.mfaVerifyEnrollment(clean))
      .then((r) => { setBackupCodes((r && r.backupCodes) || []); })
      .catch((e) => {
        const m = String((e && e.message) || "");
        setErr(m === "invalid_code" ? "That code didn't match. Wait for a fresh code in your authenticator and try again."
          : m === "not_enrolled" ? "Setup expired — reload this page to get a new key."
          : "Verification failed — try again.");
      })
      .finally(() => setBusy(false));
  }
  function copySecret() {
    try { navigator.clipboard.writeText(setup.secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); } catch (e) { /* clipboard unavailable */ }
  }
  function finish() {
    setBusy(true); setErr(null);
    Promise.resolve(onDone && onDone())
      .catch(() => setErr("Still waiting for the server to confirm enrolment — try again in a moment."))
      .finally(() => setBusy(false));
  }

  return (
    <MfaShell appName={appName}>
      {/* The banner that explains why the user is here, not on their dashboard. */}
      <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 13px", borderRadius: "var(--radius-md)", background: "var(--primary-tint, #EFF6FF)", border: "1px solid var(--primary)", color: "var(--primary)", marginBottom: 18 }}>
        <Icon name="shield-check" size={18} style={{ flex: "none", marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Your role requires two-factor authentication</div>
          <div style={{ fontSize: 12.5, marginTop: 2, color: "var(--foreground)" }}>
            {who.name ? who.name + " — " : ""}your organization requires directors and administrators to protect their account with an authenticator app before they can continue. This takes about a minute.
          </div>
        </div>
      </div>

      {backupCodes ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--status-accepted)", fontWeight: 700, fontSize: 15 }}>
            <Icon name="circle-check-big" size={18} />Two-factor authentication is on
          </div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
            Save these <b>backup codes</b> somewhere safe. Each one signs you in once if you lose your phone. They are shown <b>only now</b>.
          </p>
          <div data-testid="mfa-backup-codes" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, padding: 12, borderRadius: "var(--radius-md)", background: "var(--secondary)", border: "1px solid var(--border)", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", fontSize: 13.5, letterSpacing: ".04em" }}>
            {backupCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          {err && <MfaErrorBox>{err}</MfaErrorBox>}
          <Button full size="lg" icon="check" onClick={finish} style={{ opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>{busy ? "Opening your workspace…" : "I've saved my codes — continue"}</Button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>1. Add {appName || "DocTurn"} to your authenticator app</div>
            <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              Open Google Authenticator, Microsoft Authenticator, 1Password or any TOTP app and add an account with this key{setup && setup.otpauthUrl ? " (on your phone, the button below opens it directly)" : ""}.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--secondary)", border: "1px solid var(--border)" }}>
              <Icon name="key-round" size={16} color="var(--muted-foreground)" />
              <code data-testid="mfa-secret" style={{ flex: 1, fontSize: 14, letterSpacing: ".08em", wordBreak: "break-all", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)" }}>{setup ? dtGroupSecret(setup.secret) : (err ? "—" : "Generating key…")}</code>
              {setup && <button onClick={copySecret} title="Copy key" style={{ border: "1px solid var(--border)", background: "#fff", borderRadius: "var(--radius-md)", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--foreground)" }}><Icon name={copied ? "check" : "copy"} size={15} /></button>}
            </div>
            {setup && setup.otpauthUrl && (
              <a href={setup.otpauthUrl} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12.5, fontWeight: 600, color: "var(--primary)", textDecoration: "none" }}>
                <Icon name="smartphone" size={14} />Open in authenticator app
              </a>
            )}
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>2. Enter the 6-digit code it shows</div>
            <Field icon="shield-check" value={code} onChange={(v) => { setCode(v); if (err) setErr(null); }} placeholder="123 456" />
          </div>

          {err && <MfaErrorBox>{err}</MfaErrorBox>}
          <Button full size="lg" icon="check" onClick={verify} style={{ opacity: (busy || !setup || code.replace(/\s+/g, "").length < 6) ? 0.55 : 1, pointerEvents: (busy || !setup) ? "none" : "auto" }}>{busy ? "Verifying…" : "Turn on two-factor authentication"}</Button>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, color: "var(--muted-foreground)" }}>
            <Icon name="lock" size={13} />Nothing else in {appName || "DocTurn"} is available until this is done.
          </div>
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--muted-foreground)" }}>
            Not now? <button onClick={onSignOut} style={{ border: "none", background: "transparent", color: "var(--primary)", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11.5, padding: 0 }}>Sign out</button>.
          </div>
        </div>
      )}
    </MfaShell>
  );
}

function MfaChallengeScreen({ appName, challenge, onCancel }) {
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [smsNote, setSmsNote] = React.useState(null);
  const actions = (window.DT && window.DT.actions) || {};
  const ch = challenge || {};
  const inputRef = React.useRef(null);
  React.useEffect(() => { if (inputRef.current && inputRef.current.focus) inputRef.current.focus(); }, []);

  function submit() {
    const clean = code.replace(/\s+/g, "");
    if (busy || clean.length < 6) return;
    setBusy(true); setErr(null);
    Promise.resolve(actions.mfaCompleteLogin && actions.mfaCompleteLogin(clean))
      .catch((e) => {
        const m = String((e && e.message) || "");
        setErr(m === "invalid_code" ? "That code didn't match. Try the newest code from your authenticator, or a backup code."
          : m === "no_pending_login" ? "This sign-in expired — go back and sign in again."
          : /429|Too many/i.test(m) ? "Too many attempts — wait a minute and try again."
          : "Couldn't verify the code — try again.");
      })
      .finally(() => setBusy(false));
  }
  function sms() {
    setSmsNote(null);
    Promise.resolve(actions.mfaRequestSms && actions.mfaRequestSms())
      .then((r) => setSmsNote(r && r.sent ? "Text sent — enter the code above." : "No phone number is on file for this account — use your authenticator or a backup code."))
      .catch(() => setSmsNote("Couldn't send a text right now."));
  }

  return (
    <MfaShell appName={appName}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 5px", textAlign: "center" }}>Two-factor authentication</h1>
      <p style={{ fontSize: 13.5, color: "var(--muted-foreground)", margin: "0 0 18px", textAlign: "center" }}>
        {ch.username ? <span>Signing in as <b style={{ color: "var(--foreground)" }}>{ch.username}</b>{ch.org ? " · " + ch.org : ""}. </span> : null}
        Enter the code from your authenticator app, a text-message code, or one of your backup codes.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div onKeyDown={(e) => { if (e.key === "Enter") submit(); }}>
          <Field icon="shield-check" value={code} onChange={(v) => { setCode(v); if (err) setErr(null); }} placeholder="123 456" />
        </div>
        {err && <MfaErrorBox>{err}</MfaErrorBox>}
        {smsNote && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{smsNote}</div>}
        <Button full size="lg" icon="log-in" onClick={submit} style={{ opacity: (busy || code.replace(/\s+/g, "").length < 6) ? 0.55 : 1, pointerEvents: busy ? "none" : "auto" }}>{busy ? "Verifying…" : "Verify and sign in"}</Button>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--muted-foreground)" }}>
          <button onClick={sms} style={{ border: "none", background: "transparent", color: "var(--primary)", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11.5, padding: 0 }}>Text me a code instead</button>
          <button onClick={onCancel} style={{ border: "none", background: "transparent", color: "var(--muted-foreground)", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11.5, padding: 0 }}>Back to sign in</button>
        </div>
      </div>
    </MfaShell>
  );
}

Object.assign(window, { MfaEnrollScreen, MfaChallengeScreen });
