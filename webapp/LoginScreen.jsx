/* DocTurn web-app UI kit — auth / login screen */

function LoginScreen({ onLogin, appName }) {
  const brand = appName || "DocTurn";
  const mobile = useIsMobile();
  const loginError = (typeof useStore === "function") ? useStore().loginError : null;
  const [org, setOrg] = React.useState("ISPN");
  const [user, setUser] = React.useState("chen");
  const [pass, setPass] = React.useState("••••••••");
  const [role, setRole] = React.useState("hospitalist");

  // Registration mode: request an account with the org code → pending approval.
  const [mode, setMode] = React.useState("signin"); // "signin" | "register"
  const [reg, setReg] = React.useState({ org: "ISPN", name: "", user: "", pass: "", role: "hospitalist" });
  const [regBusy, setRegBusy] = React.useState(false);
  const [regMsg, setRegMsg] = React.useState(null);
  const [regErr, setRegErr] = React.useState(null);

  const roles = [
    { id: "hospitalist", label: "Hospitalist", icon: "stethoscope" },
    { id: "er_doctor", label: "ER physician", icon: "ambulance" },
    { id: "er_director", label: "ER director", icon: "siren" },
    { id: "director", label: "Hospitalist director", icon: "clipboard-list" },
    { id: "developer", label: "Developer", icon: "terminal" },
  ];
  const regRoles = roles.filter((r) => r.id !== "developer"); // no self-register as root

  function submitRegister() {
    setRegErr(null); setRegMsg(null);
    if (!reg.org.trim() || !reg.name.trim() || reg.user.trim().length < 3 || reg.pass.length < 6) {
      setRegErr("Enter an org code, your name, a username (3+ chars) and a password (6+ chars).");
      return;
    }
    setRegBusy(true);
    Promise.resolve(window.DT.actions.register({ orgCode: reg.org.trim(), displayName: reg.name.trim(), username: reg.user.trim(), password: reg.pass, role: reg.role }))
      .then(function () { setRegMsg("Request sent — a director will review and approve your account. You can sign in once approved."); setReg(Object.assign({}, reg, { name: "", user: "", pass: "" })); })
      .catch(function (e) {
        var m = String((e && e.message) || "");
        setRegErr(/organization/i.test(m) ? "That organization code wasn't found." : /taken/i.test(m) ? "That username is already taken." : "Couldn't send the request — please try again.");
      })
      .finally(function () { setRegBusy(false); });
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, var(--secondary), var(--background))", padding: mobile ? "20px 14px" : 28 }}>
      {/* Single sleek card — no split graphics panel */}
      <div style={{ width: "100%", maxWidth: 400, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", padding: mobile ? "26px 20px" : "32px 30px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 19 }}>{brand.charAt(0).toUpperCase()}</span>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{brand}</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "22px 0 5px", textAlign: "center" }}>{mode === "register" ? "Create an account" : "Sign in"}</h1>
          <p style={{ fontSize: 13.5, color: "var(--muted-foreground)", margin: "0 0 22px", textAlign: "center" }}>
            {mode === "register" ? "Request access with your organization's code — a director approves it." : "Secure access to your hospital workspace."}
          </p>

          {mode === "signin" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Organization code" icon="building-2" value={org} onChange={setOrg} help="Your hospital's short code." />
            <Field label="Username" icon="user" value={user} onChange={setUser} />
            <Field label="Password" icon="lock" type="password" value={pass} onChange={setPass} />

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Demo as role</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                {roles.map((r) => (
                  <button key={r.id} onClick={() => setRole(r.id)}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "11px 6px",
                      borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 12, fontWeight: 500,
                      border: `1px solid ${role === r.id ? "var(--primary)" : "var(--border)"}`,
                      background: role === r.id ? "var(--primary-tint, #EFF6FF)" : "#fff", color: role === r.id ? "var(--primary)" : "var(--foreground)" }}>
                    <Icon name={r.icon} size={18} />
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {loginError && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-rejected-bg)", border: "1px solid var(--status-rejected)", color: "var(--status-rejected)", fontSize: 12.5, lineHeight: 1.45 }}>
                <Icon name="alert-triangle" size={15} style={{ marginTop: 1, flex: "none" }} />
                <span>{loginError}</span>
              </div>
            )}
            <Button full size="lg" onClick={() => onLogin(role, org, user)}>Sign in</Button>

            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted-foreground)", justifyContent: "center" }}>
              <Icon name="shield-check" size={14} color="var(--status-accepted)" />
              HIPAA‑compliant · MFA enabled · 15‑min sessions
            </div>
            <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--muted-foreground)" }}>
              Demo — pick a role and sign in. Org <b style={{ color: "var(--foreground)", fontWeight: 600 }}>ISPN</b> · any password. New here? <button onClick={() => { setMode("register"); setRegMsg(null); setRegErr(null); }} style={{ border: "none", background: "transparent", color: "var(--primary)", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11.5, padding: 0 }}>Create an account</button>.
            </div>
          </div>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Organization code" icon="building-2" value={reg.org} onChange={(v) => setReg(Object.assign({}, reg, { org: v }))} help="The code your hospital gave you (e.g. ISPN)." />
            <Field label="Full name" icon="user" value={reg.name} onChange={(v) => setReg(Object.assign({}, reg, { name: v }))} placeholder="Dr. Jane Smith" />
            <Field label="Username" icon="at-sign" value={reg.user} onChange={(v) => setReg(Object.assign({}, reg, { user: v }))} placeholder="jsmith" />
            <Field label="Password" icon="lock" type="password" value={reg.pass} onChange={(v) => setReg(Object.assign({}, reg, { pass: v }))} help="At least 6 characters." />
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>I'm a…</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                {regRoles.map((r) => (
                  <button key={r.id} onClick={() => setReg(Object.assign({}, reg, { role: r.id }))}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "11px 6px",
                      borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 12, fontWeight: 500,
                      border: `1px solid ${reg.role === r.id ? "var(--primary)" : "var(--border)"}`,
                      background: reg.role === r.id ? "var(--primary-tint, #EFF6FF)" : "#fff", color: reg.role === r.id ? "var(--primary)" : "var(--foreground)" }}>
                    <Icon name={r.icon} size={18} />
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {regMsg && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-accepted-bg)", border: "1px solid var(--status-accepted)", color: "var(--status-accepted)", fontSize: 12.5, lineHeight: 1.45 }}>
                <Icon name="circle-check-big" size={15} style={{ marginTop: 1, flex: "none" }} /><span>{regMsg}</span>
              </div>
            )}
            {regErr && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-rejected-bg)", border: "1px solid var(--status-rejected)", color: "var(--status-rejected)", fontSize: 12.5, lineHeight: 1.45 }}>
                <Icon name="alert-triangle" size={15} style={{ marginTop: 1, flex: "none" }} /><span>{regErr}</span>
              </div>
            )}
            <Button full size="lg" onClick={submitRegister} style={{ opacity: regBusy ? 0.6 : 1, pointerEvents: regBusy ? "none" : "auto" }}>{regBusy ? "Sending request…" : "Request account"}</Button>
            <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--muted-foreground)" }}>
              Already have an account? <button onClick={() => { setMode("signin"); setRegErr(null); }} style={{ border: "none", background: "transparent", color: "var(--primary)", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 11.5, padding: 0 }}>Back to sign in</button>.
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen });
