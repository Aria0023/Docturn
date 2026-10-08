/* DocTurn web-app UI kit — auth / login screen */

function LoginScreen({ onLogin, appName }) {
  const brand = appName || "DocTurn";
  const mobile = useIsMobile();
  const _st = (typeof useStore === "function") ? useStore() : {};
  const loginError = _st.loginError || null;
  // Demo affordances (role picker, "any password" hint) exist ONLY in
  // synthetic-data mode — a real deployment shows a plain username/password form.
  const demoMode = _st.syntheticData !== false;
  // The form submits EXACTLY what is in these fields. In synthetic-data mode the
  // role picker pre-fills a seeded demo account as a convenience; on a real
  // deployment the fields start empty and there is no picker.
  const [org, setOrg] = React.useState("");
  const [user, setUser] = React.useState("");
  const [pass, setPass] = React.useState("");
  const [role, setRole] = React.useState("hospitalist");
  const touched = React.useRef(false);
  const demoFor = (r) => (window.DT && window.DT.demoAccount) ? window.DT.demoAccount(r) : { org: "ISPN", user: "chen", pass: "docturn" };
  const fill = (d) => { setOrg(d.org); setUser(d.user); setPass(d.pass); };
  const pickRole = (r) => { setRole(r); if (demoMode) fill(demoFor(r)); };
  // Pre-fill once when we learn this is a synthetic instance (the flag arrives
  // from /api/config) and the user hasn't started typing.
  React.useEffect(() => { if (demoMode && !touched.current && !org && !user && !pass) fill(demoFor(role)); }, [demoMode]);
  const typed = (setter) => (v) => { touched.current = true; setter(v); };
  const submit = () => onLogin(role, org, user, pass);
  // Both modes are real <form>s: Enter / the iOS "Go" key submits, and Safari's
  // password AutoFill + save heuristics recognise the username/password pair.
  // iOS Safari autocapitalises and autocorrects text inputs by default — fatal
  // for usernames/org codes — so every identifier field switches that off and
  // declares its autocomplete role (A.CON-SHO-12/57).
  const onSubmitSignin = (e) => { e.preventDefault(); submit(); };
  const ORG_PROPS = { name: "organization", autoComplete: "organization", autoCapitalize: "characters", autoCorrect: "off", spellCheck: false, inputMode: "text", enterKeyHint: "next" };
  const USER_PROPS = { name: "username", autoComplete: "username", autoCapitalize: "none", autoCorrect: "off", spellCheck: false, inputMode: "text", enterKeyHint: "next" };

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
    if (regBusy) return;
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
        setRegErr(/organization/i.test(m) ? "That organization code wasn't found." : /taken/i.test(m) ? "That username is already taken." : /pending/i.test(m) ? "A request for that username is already awaiting approval." : "Couldn't send the request — please try again.");
      })
      .finally(function () { setRegBusy(false); });
  }
  const onSubmitRegister = (e) => { e.preventDefault(); submitRegister(); };

  // Role picker: 2 columns even on phones (index.html collapses every other
  // inline grid to one column; data-keep-cols opts this one out) so "Sign in"
  // stays above the fold on a 390×844 screen (A.CON-MIN-12).
  const roleGrid = (list, current, onPick) => (
    <div data-keep-cols="2" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
      {list.map((r) => (
        <button key={r.id} type="button" onClick={() => onPick(r.id)} aria-pressed={current === r.id}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, padding: mobile ? "9px 6px" : "11px 6px", minHeight: 44,
            borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 12, fontWeight: 500, fontFamily: "inherit",
            border: `1px solid ${current === r.id ? "var(--primary)" : "var(--border)"}`,
            background: current === r.id ? "var(--primary-tint, #EFF6FF)" : "#fff", color: current === r.id ? "var(--primary)" : "var(--foreground)" }}>
          <Icon name={r.icon} size={18} />
          {r.label}
        </button>
      ))}
    </div>
  );

  // Inline text link rendered as a 44px-tall tap target (A.CON-SHO-52): the
  // padding gives the hit area, the matching negative margins keep the line
  // box the height of the surrounding text.
  const linkBtn = (label, onClick) => (
    <button type="button" onClick={onClick} style={{ display: "inline-block", border: "none", background: "transparent", color: "var(--primary)", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, lineHeight: "18px", padding: "13px 6px", margin: "-13px -6px", minHeight: 44, verticalAlign: "baseline" }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, var(--secondary), var(--background))", padding: mobile ? "16px 14px" : 28, paddingLeft: mobile ? "max(14px, var(--sai-left, 0px))" : 28, paddingRight: mobile ? "max(14px, var(--sai-right, 0px))" : 28 }}>
      {/* Single sleek card — no split graphics panel */}
      <div style={{ width: "100%", maxWidth: 400, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", padding: mobile ? "22px 18px" : "32px 30px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 19 }}>{brand.charAt(0).toUpperCase()}</span>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{brand}</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: mobile ? "16px 0 4px" : "22px 0 5px", textAlign: "center" }}>{mode === "register" ? "Create an account" : "Sign in"}</h1>
          <p style={{ fontSize: 13.5, color: "var(--muted-foreground)", margin: mobile ? "0 0 16px" : "0 0 22px", textAlign: "center" }}>
            {mode === "register" ? "Request access with your organization's code — a director approves it." : "Secure access to your hospital workspace."}
          </p>

          {mode === "signin" ? (
          <form onSubmit={onSubmitSignin} noValidate autoComplete="on" style={{ display: "flex", flexDirection: "column", gap: mobile ? 13 : 16 }}>
            <Field label="Organization code" icon="building-2" value={org} onChange={typed(setOrg)} help={mobile ? undefined : "Your hospital's short code."} placeholder="e.g. ISPN" {...ORG_PROPS} />
            <Field label="Username" icon="user" value={user} onChange={typed(setUser)} {...USER_PROPS} />
            <Field label="Password" icon="lock" type="password" value={pass} onChange={typed(setPass)} name="password" autoComplete="current-password" enterKeyHint="go" />

            {demoMode && (
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Demo as role</label>
              {roleGrid(roles, role, pickRole)}
            </div>
            )}

            {loginError && (
              <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-rejected-bg)", border: "1px solid var(--status-rejected)", color: "var(--status-rejected-fg)", fontSize: 12.5, lineHeight: 1.45 }}>
                <Icon name="alert-triangle" size={15} style={{ marginTop: 1, flex: "none" }} />
                <span>{loginError}</span>
              </div>
            )}
            <Button type="submit" full size="lg">Sign in</Button>

            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted-foreground)", justifyContent: "center", textAlign: "center" }}>
              <Icon name="shield-check" size={14} color="var(--status-accepted)" />
              Encrypted in transit · 15-min idle timeout · server-enforced roles
            </div>
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              {demoMode && <React.Fragment>Demo — pick a role (the form pre-fills that seeded account; password <b style={{ color: "var(--foreground)", fontWeight: 600 }}>docturn</b>) and sign in. </React.Fragment>}
              New here? {linkBtn("Create an account", () => { setMode("register"); setRegMsg(null); setRegErr(null); })}.
            </div>
          </form>
          ) : (
          <form onSubmit={onSubmitRegister} noValidate autoComplete="on" style={{ display: "flex", flexDirection: "column", gap: mobile ? 13 : 16 }}>
            <Field label="Organization code" icon="building-2" value={reg.org} onChange={(v) => setReg(Object.assign({}, reg, { org: v }))} help="The code your hospital gave you (e.g. ISPN)." {...ORG_PROPS} />
            <Field label="Full name" icon="user" value={reg.name} onChange={(v) => setReg(Object.assign({}, reg, { name: v }))} placeholder="Dr. Jane Smith" name="name" autoComplete="name" autoCapitalize="words" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
            <Field label="Username" icon="at-sign" value={reg.user} onChange={(v) => setReg(Object.assign({}, reg, { user: v }))} placeholder="jsmith" {...USER_PROPS} />
            <Field label="Password" icon="lock" type="password" value={reg.pass} onChange={(v) => setReg(Object.assign({}, reg, { pass: v }))} help="At least 6 characters." name="new-password" autoComplete="new-password" enterKeyHint="done" />
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>I'm a…</label>
              {roleGrid(regRoles, reg.role, (id) => setReg(Object.assign({}, reg, { role: id })))}
            </div>

            {regMsg && (
              <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-accepted-bg)", border: "1px solid var(--status-accepted)", color: "var(--status-accepted-fg)", fontSize: 12.5, lineHeight: 1.45 }}>
                <Icon name="circle-check-big" size={15} style={{ marginTop: 1, flex: "none" }} /><span>{regMsg}</span>
              </div>
            )}
            {regErr && (
              <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--status-rejected-bg)", border: "1px solid var(--status-rejected)", color: "var(--status-rejected-fg)", fontSize: 12.5, lineHeight: 1.45 }}>
                <Icon name="alert-triangle" size={15} style={{ marginTop: 1, flex: "none" }} /><span>{regErr}</span>
              </div>
            )}
            <Button type="submit" full size="lg" style={{ opacity: regBusy ? 0.6 : 1, pointerEvents: regBusy ? "none" : "auto" }}>{regBusy ? "Sending request…" : "Request account"}</Button>
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              Already have an account? {linkBtn("Back to sign in", () => { setMode("signin"); setRegErr(null); })}.
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen });
