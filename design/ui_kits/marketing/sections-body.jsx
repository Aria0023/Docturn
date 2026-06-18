/* DoctorHeidi marketing landing — features, how-it-works, security, pricing, footer */

function Logos() {
  const names = ["Mercy General", "St. Anne's", "Lakeside Health", "Northwind ER", "Cedar Valley"];
  return (
    <div className="m-wrap" style={{ padding: "8px 0 56px" }}>
      <p style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#94a3b8", margin: "0 0 22px" }}>
        Coordinating care at hospitals nationwide
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "20px 44px", opacity: .7 }}>
        {names.map((n) => (
          <span key={n} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 700, color: "#64748b" }}>
            <MIcon name="hospital" size={18} color="#94a3b8" />{n}
          </span>
        ))}
      </div>
    </div>
  );
}

function Features() {
  const items = [
    ["route", "Automatic round-robin", "Every admit routes to the next eligible hospitalist by lowest census — no phone tag, no guesswork.", "sky"],
    ["bell-ring", "Notifications that land", "WebSocket → push → SMS cascade means the right provider always gets the alert, on any device.", "blue"],
    ["messages-square", "Secure messaging", "Direct, group, and emergency-broadcast conversations with delivery and read receipts — fully audited.", "emerald"],
    ["sparkles", "AI-assisted intake", "Paste free-text notes; DocTurn extracts structured fields and suggests the right specialty.", "amber"],
    ["timer", "Smart expiry & reassign", "Unanswered requests re-route automatically so no patient waits on a busy provider.", "rose"],
    ["lock", "HIPAA by default", "Initials-only PHI, full audit trail, MFA, and 15-minute sessions — compliant out of the box.", "slate"],
  ];
  const tints = {
    sky: ["#E0F2FE", "var(--sky-700)"], blue: ["#DBEAFE", "var(--primary)"], emerald: ["#D1FAE5", "#059669"],
    amber: ["#FEF3C7", "#D97706"], rose: ["#FFE4E6", "#E11D48"], slate: ["#F1F5F9", "#475569"],
  };
  return (
    <section style={{ background: "#fff", padding: "84px 0" }}>
      <div className="m-wrap">
        <SectionHead eyebrow="Why DocTurn" title="The whole hand-off, in one calm system" sub="From ER intake to hospitalist acceptance — automated routing, multi-channel alerts, and messaging that keeps your team in sync." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 48 }} className="m-feature-grid">
          {items.map(([ic, t, d, tint]) => (
            <div key={t} className="m-card-hover" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-2xl)", padding: 24, background: "linear-gradient(180deg,#fff,#FBFDFF)", transition: "transform .25s ease, box-shadow .25s ease" }}>
              <span style={{ width: 46, height: 46, borderRadius: 13, background: tints[tint][0], color: tints[tint][1], display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MIcon name={ic} size={22} />
              </span>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "16px 0 6px" }}>{t}</h3>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#64748b", margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, sub, center = true }) {
  return (
    <div style={{ textAlign: center ? "center" : "left", maxWidth: center ? 640 : "none", margin: center ? "0 auto" : 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--sky-600, #0284c7)" }}>{eyebrow}</div>
      <h2 style={{ fontSize: 38, lineHeight: 1.12, letterSpacing: "-0.02em", fontWeight: 700, color: "#0f172a", margin: "12px 0 0" }}>{title}</h2>
      {sub && <p style={{ fontSize: 17, lineHeight: 1.55, color: "#64748b", margin: "16px 0 0" }}>{sub}</p>}
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["clipboard-plus", "ER admits", "An ER physician submits a patient — pasting notes for AI to structure if they like."],
    ["route", "DocTurn routes", "Round-robin picks the next eligible hospitalist; or the physician assigns manually."],
    ["bell-ring", "Provider is notified", "Push, SMS, and in-app alerts fire instantly. They accept or decline in a tap."],
    ["check-circle-2", "Hand-off complete", "Census updates, the care team can message, and every step is audit-logged."],
  ];
  return (
    <section style={{ background: "var(--marketing-bg)", padding: "84px 0", position: "relative", overflow: "hidden" }}>
      <div className="m-wrap" style={{ position: "relative", zIndex: 2 }}>
        <SectionHead eyebrow="How it works" title="Four steps, zero phone tag" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18, marginTop: 48 }} className="m-steps">
          {steps.map(([ic, t, d], i) => (
            <div key={t} style={{ background: "rgba(255,255,255,.8)", backdropFilter: "blur(6px)", borderRadius: "var(--radius-2xl)", padding: 22, border: "1px solid hsl(214 32% 91% / .8)", boxShadow: "var(--shadow-sm)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--sky-gradient)", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                <MIcon name={ic} size={20} color="var(--sky-700)" />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>{t}</h3>
              <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "#64748b", margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Security() {
  const points = ["Full HIPAA audit trail & PHI access logs", "MFA (TOTP + SMS) with backup codes", "Multi-tenant isolation by organization", "15-minute sessions, encryption in transit", "Initials-only PHI — never full names", "Role-based access control on every route"];
  return (
    <section style={{ background: "#fff", padding: "84px 0" }}>
      <div className="m-wrap" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }} className="m-sec-grid">
        <div>
          <SectionHead center={false} eyebrow="Security & compliance" title="Built for PHI from the first line of code" sub="DocTurn isn't compliant as an afterthought — tenancy, auditing, and least-privilege access are the architecture." />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px", marginTop: 28 }}>
            {points.map((p) => (
              <div key={p} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 14, color: "#334155", lineHeight: 1.45 }}>
                <MIcon name="shield-check" size={17} color="#059669" style={{ marginTop: 1 }} />{p}
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: "var(--marketing-bg)", borderRadius: "var(--radius-2xl)", padding: 30, border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ width: 52, height: 52, borderRadius: 15, background: "#fff", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}><MIcon name="lock-keyhole" size={26} /></span>
            <div><div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>HIPAA + SOC 2</div><div style={{ fontSize: 13, color: "#64748b" }}>Independently assessed</div></div>
          </div>
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 12 }}>
            {[["fingerprint", "Every PHI access logged"], ["server", "Tenant data isolated by org"], ["bell-off", "Push payloads carry no PHI"]].map(([i, t]) => (
              <div key={t} style={{ display: "flex", gap: 11, alignItems: "center", background: "rgba(255,255,255,.75)", borderRadius: "var(--radius-lg)", padding: "12px 14px" }}>
                <MIcon name={i} size={18} color="var(--sky-700)" /><span style={{ fontSize: 13.5, fontWeight: 500, color: "#0f172a" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = [
    { name: "Department", price: "$0", note: "free to start", desc: "For a single ER or hospitalist group getting started.", features: ["Round-robin routing", "Push + SMS alerts", "Secure messaging", "Up to 25 providers"], cta: "Get started free", hi: false },
    { name: "Hospital", price: "$8", note: "/ provider / mo", desc: "For a full hospital with multiple departments.", features: ["Everything in Department", "AI-assisted intake", "Amion schedule sync", "Custom round-robin rules", "Priority support"], cta: "Start free trial", hi: true },
    { name: "Network", price: "Custom", note: "", desc: "For multi-hospital systems and IDNs.", features: ["Everything in Hospital", "Multi-tenant admin", "SSO / OIDC", "Dedicated success manager", "BAA + custom DPA"], cta: "Talk to sales", hi: false },
  ];
  return (
    <section style={{ background: "var(--marketing-bg)", padding: "84px 0" }}>
      <div className="m-wrap">
        <SectionHead eyebrow="Pricing" title="Simple, per-provider pricing" sub="Start free. Upgrade when your whole hospital is on board." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 48, alignItems: "stretch" }} className="m-price-grid">
          {plans.map((p) => (
            <div key={p.name} style={{ background: "#fff", borderRadius: "var(--radius-2xl)", padding: 28, border: p.hi ? "2px solid var(--primary)" : "1px solid var(--border)", boxShadow: p.hi ? "var(--shadow-xl)" : "var(--shadow-sm)", position: "relative", display: "flex", flexDirection: "column" }}>
              {p.hi && <span style={{ position: "absolute", top: -12, left: 28, background: "var(--sky-gradient)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 99, boxShadow: "var(--shadow-glow)", whiteSpace: "nowrap" }}>Most popular</span>}
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{p.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "12px 0 4px" }}>
                <span style={{ fontSize: 42, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>{p.price}</span>
                <span style={{ fontSize: 14, color: "#64748b" }}>{p.note}</span>
              </div>
              <p style={{ fontSize: 13.5, color: "#64748b", margin: "0 0 18px", lineHeight: 1.5 }}>{p.desc}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                {p.features.map((f) => (
                  <div key={f} style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13.5, color: "#334155" }}>
                    <MIcon name="check" size={16} color="#059669" />{f}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 24 }}>
                <CTA variant={p.hi ? "primary" : "secondary"} size="sm">{p.cta}</CTA>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section style={{ background: "#fff", padding: "40px 0 84px" }}>
      <div className="m-wrap">
        <div style={{ background: "linear-gradient(135deg,#0EA5E9,#0369A1)", borderRadius: "var(--radius-2xl)", padding: "56px 40px", textAlign: "center", position: "relative", overflow: "hidden", boxShadow: "var(--shadow-2xl)" }}>
          <h2 style={{ fontSize: 38, fontWeight: 700, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>Get your ER and hospitalists in sync.</h2>
          <p style={{ fontSize: 17, color: "rgba(255,255,255,.85)", margin: "14px auto 0", maxWidth: 480 }}>Set up DocTurn for your hospital in under a day — no IT project required.</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 30, flexWrap: "wrap" }}>
            <button style={{ height: 52, padding: "0 30px", borderRadius: "var(--radius-md)", border: "none", background: "#fff", color: "var(--sky-700)", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9 }}>Get started free <MIcon name="arrow-right" size={18} /></button>
            <button style={{ height: 52, padding: "0 26px", borderRadius: "var(--radius-md)", border: "1px solid rgba(255,255,255,.5)", background: "transparent", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>Book a demo</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = {
    Product: ["Patient assignment", "Secure messaging", "AI intake", "Mobile app"],
    Company: ["About", "Customers", "Careers", "Contact"],
    Resources: ["Documentation", "Security", "HIPAA", "Status"],
  };
  return (
    <footer style={{ background: "#0f172a", color: "#cbd5e1", padding: "56px 0 32px" }}>
      <div className="m-wrap" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", gap: 32 }} className="m-foot-grid">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="assets/docturn-glyph-sky.svg" alt="" style={{ width: 36, height: 36, borderRadius: 9 }} />
            <span style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>DocTurn</span>
          </div>
          <p style={{ fontSize: 13.5, color: "#94a3b8", margin: "16px 0 0", maxWidth: 260, lineHeight: 1.55 }}>HIPAA-compliant patient assignment and secure messaging for hospitals.</p>
        </div>
        {Object.entries(cols).map(([h, links]) => (
          <div key={h}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 14 }}>{h}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {links.map((l) => <a key={l} href="#" style={{ fontSize: 13.5, color: "#94a3b8", textDecoration: "none" }}>{l}</a>)}
            </div>
          </div>
        ))}
      </div>
      <div className="m-wrap" style={{ borderTop: "1px solid #1e293b", marginTop: 40, paddingTop: 22, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, fontSize: 12.5, color: "#64748b" }}>
        <span>© 2026 DocTurn Health, Inc. All rights reserved.</span>
        <div style={{ display: "flex", gap: 22 }}><a href="#" style={{ color: "#64748b", textDecoration: "none" }}>Privacy</a><a href="#" style={{ color: "#64748b", textDecoration: "none" }}>Terms</a><a href="#" style={{ color: "#64748b", textDecoration: "none" }}>BAA</a></div>
      </div>
    </footer>
  );
}

Object.assign(window, { Logos, Features, HowItWorks, Security, Pricing, FinalCTA, Footer, SectionHead });
