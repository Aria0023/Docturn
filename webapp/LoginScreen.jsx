/* DocTurn web-app UI kit — auth / login screen */

function LoginScreen({ onLogin, appName }) {
  const brand = appName || "DocTurn";
  const mobile = useIsMobile();
  const loginError = (typeof useStore === "function") ? useStore().loginError : null;
  const [org, setOrg] = React.useState("ISPN");
  const [user, setUser] = React.useState("chen");
  const [pass, setPass] = React.useState("••••••••");
  const [role, setRole] = React.useState("hospitalist");

  const roles = [
    { id: "hospitalist", label: "Hospitalist", icon: "stethoscope" },
    { id: "er_doctor", label: "ER physician", icon: "ambulance" },
    { id: "er_director", label: "ER director", icon: "siren" },
    { id: "director", label: "Hospitalist director", icon: "clipboard-list" },
    { id: "developer", label: "Developer", icon: "terminal" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--background)" }}>
      {/* Left: form */}
      <div style={{ flex: mobile ? "1 1 100%" : "1 1 50%", display: "flex", alignItems: "center", justifyContent: "center", padding: mobile ? "24px 18px" : 32 }}>
        <div style={{ width: "100%", maxWidth: 360 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 34, height: 34, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>{brand.charAt(0).toUpperCase()}</span>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>{brand}</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "28px 0 6px" }}>Sign in</h1>
          <p style={{ fontSize: 14, color: "var(--muted-foreground)", margin: "0 0 24px" }}>
            Secure access to your hospital workspace.
          </p>

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
              Demo — pick a role and sign in. Org <b style={{ color: "var(--foreground)", fontWeight: 600 }}>ISPN</b> · any password.
            </div>
          </div>
        </div>
      </div>

      {/* Right: brand panel — hidden on phones */}
      {!mobile && (
      <div style={{ flex: "1 1 50%", background: "var(--marketing-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 48, position: "relative", overflow: "hidden" }}>
        <div style={{ maxWidth: 380, position: "relative", zIndex: 2 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.7)", padding: "5px 12px", borderRadius: "99px", fontSize: 12, fontWeight: 600, color: "var(--sky-700)" }}>
            <Icon name="route" size={14} /> Patient assignment, automated
          </div>
          <h2 style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.02em", color: "#0f172a", margin: "18px 0 12px" }}>
            Every admit reaches the right hospitalist — in seconds.
          </h2>
          <p style={{ fontSize: 15, color: "#475569", lineHeight: 1.55, margin: 0 }}>
            Round‑robin routing, real‑time notifications across push and SMS, and HIPAA‑compliant messaging for your whole care team.
          </p>
          <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              ["bell-ring", "Notified instantly", "WebSocket → push → SMS cascade"],
              ["repeat", "Fair rotation", "Lowest‑census provider goes next"],
              ["lock", "PHI stays protected", "Initials only, full audit trail"],
            ].map(([ic, t, d]) => (
              <div key={t} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "#fff", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
                  <Icon name={ic} size={18} />
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>{t}</div>
                  <div style={{ fontSize: 12.5, color: "#64748b" }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,.25), transparent 70%)", top: -80, right: -60 }} />
        <div style={{ position: "absolute", width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,228,230,.6), transparent 70%)", bottom: -70, left: -50 }} />
      </div>
      )}
    </div>
  );
}

Object.assign(window, { LoginScreen });
