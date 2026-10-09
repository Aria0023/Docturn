/* DocTurn web-app UI kit — auth / login screen */

// True while the viewport is SHORT — an iPhone SE (375×667) or any phone in
// Safari with its toolbars showing (390×664 visible on a 390×844 iPhone).
function useShortViewport(maxHeight) {
  const q = "(max-height: " + maxHeight + "px)";
  const get = () => { try { return window.matchMedia(q).matches; } catch (e) { return false; } };
  const [short, setShort] = React.useState(get);
  React.useEffect(() => {
    let mql; try { mql = window.matchMedia(q); } catch (e) { return undefined; }
    const on = () => setShort(mql.matches);
    if (mql.addEventListener) mql.addEventListener("change", on); else if (mql.addListener) mql.addListener(on);
    on();
    return () => { if (mql.removeEventListener) mql.removeEventListener("change", on); else if (mql.removeListener) mql.removeListener(on); };
  }, [q]);
  return short;
}

function LoginScreen({ onLogin, appName }) {
  const brand = appName || "DocTurn";
  const mobile = useIsMobile();
  // On a short phone screen the demo role picker is one native <select> row
  // instead of a 3-row grid, and the header tightens, so "Sign in" stays
  // above the fold at 375×667 and in Safari's 390×664 (A.CON-MIN-12).
  const short = useShortViewport(760) && mobile;
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
  // Only the roles the server accepts from a stranger (SELF_REGISTRABLE_ROLES in
  // shared/schema.ts): POST /api/register answers 400 role_not_self_registrable
  // for director / ER director / developer, which an administrator provisions.
  const regRoles = roles.filter((r) => r.id === "hospitalist" || r.id === "er_doctor");
  // Same floor the server enforces (MIN_PASSWORD_LENGTH + isForbiddenPassword in
  // server/auth.ts); the demo/default-password refusal is the server's to make.
  const REG_MIN_PASSWORD = 8;

  // The server answers an unknown org code exactly like a real one (201, then
  // 409 on a re-send) so the form cannot be used to discover which codes
  // exist (A.CON-SHO-11). The success text therefore only promises a review
  // IF the code is right, and says what to do when nothing happens.
  const REG_SENT = "Request sent. If the organization code is right, a director there will review it — you can sign in once it's approved. No answer after a day or two? Check the code with your hospital.";

  // Every answer POST /api/register can give (docs/consult-registration.md),
  // in words the requester can act on — matched on the exact status + code.
  function registerErrorText(e) {
    var code = String((e && e.message) || "");
    var status = e && e.status;
    if (!status && /Failed to fetch|NetworkError|Load failed|fetch failed|ERR_NETWORK/i.test(code)) return "Can't reach the server. Check your connection and try again.";
    if (status === 400 && code === "weak_password") return "Choose a stronger password: at least " + REG_MIN_PASSWORD + " characters, and not a demo or default password.";
    if (status === 400 && code === "role_not_self_registrable") return "Director, ER director and developer accounts are set up by an administrator. Request a Hospitalist or ER physician account.";
    if (status === 400 && code === "validation_error") return "Check the form: an org code, your name, a username (3+ characters) and a password (" + REG_MIN_PASSWORD + "+ characters).";
    if (status === 409 && code === "request_pending") return "A request for that username is already waiting for a director's approval. You'll be able to sign in once it's approved.";
    if (status === 429 || code === "rate_limited") return "Too many requests from this device. Wait a few minutes and try again.";
    return "Couldn't send the request — please try again.";
  }

  function submitRegister() {
    if (regBusy) return;
    setRegErr(null); setRegMsg(null);
    if (!regRoles.some((r) => r.id === reg.role)) { setRegErr(registerErrorText({ status: 400, message: "role_not_self_registrable" })); return; }
    if (!reg.org.trim() || !reg.name.trim() || reg.user.trim().length < 3 || reg.pass.length < REG_MIN_PASSWORD) {
      setRegErr("Enter an org code, your name, a username (3+ characters) and a password (" + REG_MIN_PASSWORD + "+ characters).");
      return;
    }
    setRegBusy(true);
    Promise.resolve(window.DT.actions.register({ orgCode: reg.org.trim(), displayName: reg.name.trim(), username: reg.user.trim(), password: reg.pass, role: reg.role }))
      .then(function () { setRegMsg(REG_SENT); setReg(Object.assign({}, reg, { name: "", user: "", pass: "" })); })
      .catch(function (e) { setRegErr(registerErrorText(e)); })
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
            background: current === r.id ? "var(--primary-tint, #EFF6FF)" : "#fff", color: current === r.id ? "var(--primary-ink, #1D4ED8)" : "var(--foreground)" }}>
          <Icon name={r.icon} size={18} />
          {r.label}
        </button>
      ))}
    </div>
  );

  // Compact demo picker for short phone screens: same choices, same pre-fill,
  // one 44px row (the native iOS picker opens on tap).
  const roleSelect = (list, current, onPick) => (
    <div style={{ position: "relative" }}>
      <select id="dt-demo-role" value={current} onChange={(e) => onPick(e.target.value)}
        style={{ width: "100%", height: 44, appearance: "none", WebkitAppearance: "none", padding: "0 36px 0 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", color: "var(--foreground)", fontSize: 16, fontFamily: "inherit", cursor: "pointer" }}>
        {list.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <Icon name="chevron-down" size={16} color="var(--muted-foreground)" style={{ position: "absolute", right: 12, top: 14, pointerEvents: "none" }} />
    </div>
  );

  // Inline text link rendered as a 44px-tall tap target (A.CON-SHO-52): the
  // padding gives the hit area, the matching negative margins keep the line
  // box the height of the surrounding text.
  const linkBtn = (label, onClick) => (
    <button type="button" onClick={onClick} style={{ display: "inline-block", border: "none", background: "transparent", color: "var(--primary)", fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12, lineHeight: "18px", padding: "13px 6px", margin: "-13px -6px", minHeight: 44, verticalAlign: "baseline" }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, var(--secondary), var(--background))", padding: short ? "10px 12px" : mobile ? "16px 14px" : 28, paddingTop: mobile ? "max(" + (short ? 10 : 16) + "px, var(--sai-top, 0px))" : 28, paddingLeft: mobile ? "max(" + (short ? 12 : 14) + "px, var(--sai-left, 0px))" : 28, paddingRight: mobile ? "max(" + (short ? 12 : 14) + "px, var(--sai-right, 0px))" : 28 }}>
      {/* Single sleek card — no split graphics panel */}
      <div style={{ width: "100%", maxWidth: 400, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", padding: short ? "16px 16px" : mobile ? "22px 18px" : "32px 30px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 19 }}>{brand.charAt(0).toUpperCase()}</span>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{brand}</span>
          </div>
          <h1 style={{ fontSize: short ? 20 : 22, fontWeight: 700, margin: short ? "10px 0 2px" : mobile ? "16px 0 4px" : "22px 0 5px", textAlign: "center" }}>{mode === "register" ? "Create an account" : "Sign in"}</h1>
          <p style={{ fontSize: 13.5, color: "var(--muted-foreground)", margin: short ? "0 0 10px" : mobile ? "0 0 16px" : "0 0 22px", textAlign: "center" }}>
            {mode === "register" ? "Request access with your organization's code — a director approves it." : "Secure access to your hospital workspace."}
          </p>

          {mode === "signin" ? (
          <form onSubmit={onSubmitSignin} noValidate autoComplete="on" style={{ display: "flex", flexDirection: "column", gap: short ? 10 : mobile ? 13 : 16 }}>
            <Field label="Organization code" icon="building-2" value={org} onChange={typed(setOrg)} help={mobile ? undefined : "Your hospital's short code."} placeholder="e.g. ISPN" {...ORG_PROPS} />
            <Field label="Username" icon="user" value={user} onChange={typed(setUser)} {...USER_PROPS} />
            <Field label="Password" icon="lock" type="password" value={pass} onChange={typed(setPass)} name="password" autoComplete="current-password" enterKeyHint="go" />

            {demoMode && (
            <div>
              <label htmlFor={short ? "dt-demo-role" : undefined} style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: short ? 6 : 8 }}>Demo as role</label>
              {short ? roleSelect(roles, role, pickRole) : roleGrid(roles, role, pickRole)}
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
            <Field label="Password" icon="lock" type="password" value={reg.pass} onChange={(v) => setReg(Object.assign({}, reg, { pass: v }))} help={"At least " + REG_MIN_PASSWORD + " characters, not a demo or default password."} name="new-password" autoComplete="new-password" enterKeyHint="done" />
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
