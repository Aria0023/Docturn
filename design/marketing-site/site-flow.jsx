/* DocTurn marketing site — how it works (with routing mockup) + features */

function HowItWorks() {
  const steps = [
    ["clipboard-plus", "ER admits", "An ER physician submits the patient. Paste free-text notes and AI structures the fields for you."],
    ["route", "DocTurn routes", "Round-robin picks the next eligible hospitalist by lowest census — or assign manually in a tap."],
    ["bell-ring", "Provider is notified", "In-app, push, and SMS fire instantly. Accept or decline from the lock screen."],
    ["circle-check-big", "Hand-off complete", "Census updates, the care team can message, and every step is audit-logged."],
  ];
  return (
    <section id="how" style={{ background: "var(--marketing-bg)", padding: "92px 0", position: "relative", overflow: "hidden" }}>
      <div className="m-wrap" style={{ position: "relative", zIndex: 2 }}>
        <Reveal>
          <SectionHead eyebrow="How it works" title="Four steps, zero phone tag"
            sub="From ER intake to hospitalist acceptance — fully automated, fully tracked, and fast enough to matter." />
        </Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18, marginTop: 48 }} className="m-steps">
          {steps.map(([ic, t, d], i) => (
            <Reveal key={t} delay={i * 80}>
              <div style={{ background: "rgba(255,255,255,.82)", backdropFilter: "blur(6px)", borderRadius: "var(--radius-2xl)", padding: 22, border: "1px solid hsl(214 32% 91% / .8)", boxShadow: "var(--shadow-sm)", height: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--sky-gradient)", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                  <MIcon name={ic} size={20} color="var(--sky-700)" />
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>{t}</h3>
                <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#64748b", margin: 0 }}>{d}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Routing visualization mockup */}
        <Reveal delay={120} y={26}>
          <div style={{ marginTop: 40 }}><RoutingMock /></div>
        </Reveal>
      </div>
    </section>
  );
}

function RoutingMock() {
  const docs = [
    { name: "Dr. Chen", spec: "Internal medicine", census: 6, cap: 12, st: "next" },
    { name: "Dr. Okafor", spec: "Hospitalist", census: 8, cap: 12, st: "online" },
    { name: "Dr. Reyes", spec: "Internal medicine", census: 9, cap: 12, st: "online" },
    { name: "Dr. Patel", spec: "Hospitalist", census: 12, cap: 12, st: "full" },
  ];
  return (
    <AppFrame url="app.docturn.health/assign" maxWidth={980}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 0, minHeight: 320 }} className="m-route-grid">
        {/* left: incoming patient */}
        <div style={{ padding: "24px 26px", borderRight: "1px solid var(--border)", background: "linear-gradient(180deg,#fff,#F8FAFC)", display: "flex", flexDirection: "column" }} className="m-route-left">
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#94a3b8" }}>Incoming admit</div>
          <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, boxShadow: "var(--shadow-sm)", background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 44, height: 44, borderRadius: 11, background: "#F1F5F9", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>RM</span>
              <div><div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>RM · Rm 318</div><div style={{ fontSize: 12.5, color: "#64748b" }}>Acute abdominal pain</div></div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
              {["Internal medicine", "Telemetry", "Age 54"].map((t) => (
                <span key={t} style={{ fontSize: 11.5, fontWeight: 600, color: "#475569", background: "#F1F5F9", padding: "3px 9px", borderRadius: 99 }}>{t}</span>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 18, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--sky-700)" }}>
            <MIcon name="route" size={16} /> Round-robin · lowest census first
          </div>
          <div style={{ marginTop: "auto", paddingTop: 18 }}>
            <CTA size="sm" icon="arrow-right" full>Send assignment</CTA>
          </div>
        </div>
        {/* right: rotation */}
        <div style={{ padding: "24px 26px", background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#94a3b8" }}>On-call rotation</div>
            <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Census / cap</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {docs.map((d) => {
              const next = d.st === "next", full = d.st === "full";
              return (
                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: "var(--radius-lg)", border: next ? "1.5px solid var(--primary)" : "1px solid var(--border)", background: next ? "var(--status-active-bg)" : "#fff", boxShadow: next ? "var(--shadow-md)" : "none", opacity: full ? 0.6 : 1 }}>
                  <span style={{ position: "relative", width: 34, height: 34, borderRadius: 99, background: "#E2E8F0", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flex: "none" }}>
                    {d.name.split(" ")[1][0]}{d.name.split(" ")[1][1]}
                    <span style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: 99, background: full ? "var(--status-neutral)" : "var(--status-accepted)", border: "2px solid #fff" }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>{d.name}</div>
                    <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{d.spec}</div>
                  </div>
                  {/* census bar */}
                  <div style={{ width: 64, flex: "none" }}>
                    <div style={{ height: 6, borderRadius: 99, background: "#F1F5F9", overflow: "hidden" }}>
                      <div style={{ width: `${(d.census / d.cap) * 100}%`, height: "100%", background: full ? "var(--status-rejected)" : next ? "var(--primary)" : "var(--status-accepted)" }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, textAlign: "right", fontFamily: "var(--font-mono)" }}>{d.census}/{d.cap}</div>
                  </div>
                  {next ? <StatusPill status="active" label="Next up" icon="arrow-right" /> : full ? <StatusPill status="neutral" label="At cap" icon="ban" /> : <span style={{ width: 64 }} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function Features() {
  const items = [
    ["route", "Automatic round-robin", "Every admit routes to the next eligible hospitalist by lowest census — no phone tag, no guesswork, no favorites.", "sky"],
    ["bell-ring", "Notifications that land", "WebSocket → push → SMS cascade means the right provider always gets the alert, on whatever device is in their hand.", "blue"],
    ["messages-square", "Secure messaging", "Direct, group, and emergency-broadcast threads with delivery and read receipts — fully audited, PHI-safe.", "emerald"],
    ["sparkles", "AI-assisted intake", "Paste your free-text notes; DocTurn extracts structured fields and suggests the right specialty in seconds.", "amber"],
    ["timer", "Smart expiry & reassign", "Unanswered requests re-route automatically, so no patient ever waits on a provider who stepped away.", "rose"],
    ["gauge", "Fair by census", "Live census and per-provider caps keep the load balanced — the next admit goes to whoever's lightest.", "slate"],
  ];
  const tints = {
    sky: ["#E0F2FE", "var(--sky-700)"], blue: ["#DBEAFE", "var(--primary)"], emerald: ["#D1FAE5", "#059669"],
    amber: ["#FEF3C7", "#D97706"], rose: ["#FFE4E6", "#E11D48"], slate: ["#F1F5F9", "#475569"],
  };
  return (
    <section style={{ background: "#fff", padding: "92px 0" }}>
      <div className="m-wrap">
        <Reveal>
          <SectionHead eyebrow="Why DocTurn" title="The whole hand-off, in one calm system"
            sub="From ER intake to hospitalist acceptance — automated routing, alerts that actually arrive, and messaging that keeps your team in sync." />
        </Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 48 }} className="m-feature-grid">
          {items.map(([ic, t, d, tint], i) => (
            <Reveal key={t} delay={(i % 3) * 80}>
              <div className="m-card-hover" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-2xl)", padding: 24, height: "100%", background: "linear-gradient(180deg,#fff,#FBFDFF)", transition: "transform .25s ease, box-shadow .25s ease" }}>
                <span style={{ width: 46, height: 46, borderRadius: 13, background: tints[tint][0], color: tints[tint][1], display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MIcon name={ic} size={22} />
                </span>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "16px 0 6px" }}>{t}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "#64748b", margin: 0 }}>{d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { HowItWorks, RoutingMock, Features });
