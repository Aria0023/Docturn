/* DocTurn marketing site — product showcase, security, social proof, pricing, final CTA */

/* ---- Showcase row 1: secure messaging ---- */
function MessagingShowcase() {
  return (
    <section style={{ background: "#fff", padding: "40px 0 0" }}>
      <div className="m-wrap" style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 56, alignItems: "center" }} className="m-sec-grid">
        <Reveal>
          <div>
            <SectionHead center={false} eyebrow="Secure messaging" title="Talk to the care team without leaving compliance behind"
              sub="Every conversation — direct, group, or emergency broadcast — lives inside DocTurn with delivery and read receipts. No texting PHI on a personal phone, ever." />
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginTop: 26 }}>
              {[["check-check", "Delivery + read receipts on every message"], ["shield", "Initials-only PHI, fully audit-logged"], ["radio", "Emergency broadcast to a whole unit at once"]].map(([ic, t]) => (
                <div key={t} style={{ display: "flex", gap: 11, alignItems: "center", fontSize: 14.5, color: "#334155" }}>
                  <MIcon name={ic} size={18} color="var(--sky-600, #0284c7)" />{t}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
        <Reveal delay={100} y={24}><MessagingMock /></Reveal>
      </div>
    </section>
  );
}

function MessagingMock() {
  const msgs = [
    { me: false, who: "Dr. Chen", text: "Accepting SC in 412 — can you send the latest tele strip?", time: "2:14" },
    { me: true, text: "Sent. BP stable, troponin pending.", time: "2:15" },
    { me: false, who: "Dr. Chen", text: "Got it. I'll round in 10.", time: "2:15", read: true },
  ];
  return (
    <AppFrame url="app.docturn.health/messages" maxWidth={520}>
      <div style={{ display: "flex", flexDirection: "column", height: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ position: "relative", width: 36, height: 36, borderRadius: 99, background: "var(--sky-gradient)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
            DC<span style={{ position: "absolute", right: -1, bottom: -1, width: 10, height: 10, borderRadius: 99, background: "var(--status-accepted)", border: "2px solid #fff" }} />
          </span>
          <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Dr. Chen</div><div style={{ fontSize: 11.5, color: "var(--status-accepted)", fontWeight: 600 }}>Online</div></div>
          <MIcon name="shield-check" size={17} color="#059669" />
        </div>
        <div style={{ flex: 1, padding: "16px", display: "flex", flexDirection: "column", gap: 10, background: "linear-gradient(180deg,#F8FAFC,#fff)", overflow: "hidden" }}>
          <div style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>Re: SC · Rm 412 — chest pain</div>
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.me ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "78%" }}>
                <div style={{ background: m.me ? "var(--primary)" : "#fff", color: m.me ? "#fff" : "#0f172a", border: m.me ? "none" : "1px solid var(--border)", borderRadius: m.me ? "14px 14px 4px 14px" : "14px 14px 14px 4px", padding: "9px 13px", fontSize: 13.5, lineHeight: 1.45, boxShadow: "var(--shadow-sm)" }}>{m.text}</div>
                <div style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: m.me ? "flex-end" : "flex-start", marginTop: 4, fontSize: 10.5, color: "#94a3b8" }}>
                  {m.time}{m.me && <MIcon name="check-check" size={13} color="var(--status-accepted)" />}{m.read && <span>Read</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ flex: 1, height: 38, borderRadius: 99, border: "1px solid var(--border)", background: "#F8FAFC", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 13, color: "#94a3b8" }}>Message…</div>
          <span style={{ width: 38, height: 38, borderRadius: 99, background: "var(--sky-gradient)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><MIcon name="send" size={16} /></span>
        </div>
      </div>
    </AppFrame>
  );
}

/* ---- Showcase row 2: notifications that land ---- */
function NotifyShowcase() {
  return (
    <section style={{ background: "#fff", padding: "84px 0" }}>
      <div className="m-wrap" style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 56, alignItems: "center" }} className="m-sec-grid m-reverse">
        <Reveal delay={100} y={24} className="m-order-2"><NotifyMock /></Reveal>
        <Reveal className="m-order-1">
          <div>
            <SectionHead center={false} eyebrow="Notifications that land" title="Accept the hand-off from your lock screen"
              sub="DocTurn cascades from in-app to push to SMS until the assigned provider responds. One tap to accept or decline — no app-opening, no PHI in the notification." />
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginTop: 26 }}>
              {[["smartphone", "Push, SMS, and in-app — whatever reaches you first"], ["timer-reset", "Auto re-routes if no response in time"], ["eye-off", "Alerts carry zero PHI — only that you have an assignment"]].map(([ic, t]) => (
                <div key={t} style={{ display: "flex", gap: 11, alignItems: "center", fontSize: 14.5, color: "#334155" }}>
                  <MIcon name={ic} size={18} color="var(--sky-600, #0284c7)" />{t}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function NotifyMock() {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ width: 300, borderRadius: 40, background: "#0f172a", padding: 10, boxShadow: "var(--shadow-2xl)" }}>
        <div style={{ borderRadius: 32, overflow: "hidden", background: "linear-gradient(170deg,#0c4a6e,#0369A1 45%,#0EA5E9)", height: 480, position: "relative", display: "flex", flexDirection: "column" }}>
          <div style={{ height: 28, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 8 }}><div style={{ width: 110, height: 22, borderRadius: 99, background: "#0f172a" }} /></div>
          <div style={{ textAlign: "center", color: "#fff", marginTop: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 500, opacity: .85 }}>Tuesday, June 5</div>
            <div style={{ fontSize: 58, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>2:14</div>
          </div>
          <div className="m-float" style={{ margin: "auto 14px 22px", background: "rgba(255,255,255,.96)", backdropFilter: "blur(8px)", borderRadius: 20, padding: 14, boxShadow: "var(--shadow-2xl)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
              <img src="assets/docturn-glyph-sky.svg" alt="" style={{ width: 22, height: 22, borderRadius: 6 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>DOCTURN</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>now</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>New assignment · Rm 318</div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 3, lineHeight: 1.4 }}>Internal medicine admit routed to you. Respond to confirm.</div>
            <div style={{ display: "flex", gap: 9, marginTop: 13 }}>
              <div style={{ flex: 1, height: 38, borderRadius: 11, background: "var(--sky-gradient)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13.5, fontWeight: 700 }}><MIcon name="check" size={15} />Accept</div>
              <div style={{ flex: 1, height: 38, borderRadius: 11, background: "#F1F5F9", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 13.5, fontWeight: 700 }}>Decline</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Security deep-dive ---- */
function Security() {
  const points = ["Full HIPAA audit trail & PHI access logs", "MFA (TOTP + SMS) with backup codes", "Multi-tenant isolation by organization", "15-minute sessions, encryption in transit & at rest", "Initials-only PHI — never full names", "Role-based access control on every route"];
  return (
    <section id="security" style={{ background: "var(--marketing-bg)", padding: "92px 0" }}>
      <div className="m-wrap" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }} className="m-sec-grid">
        <Reveal>
          <div>
            <SectionHead center={false} eyebrow="Security & compliance" title="Built for PHI from the first line of code"
              sub="DocTurn isn't compliant as an afterthought — tenancy, auditing, and least-privilege access are the architecture, not a checkbox." />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "13px 22px", marginTop: 28 }}>
              {points.map((p) => (
                <div key={p} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 14, color: "#334155", lineHeight: 1.45 }}>
                  <MIcon name="shield-check" size={17} color="#059669" style={{ marginTop: 1 }} />{p}
                </div>
              ))}
            </div>
          </div>
        </Reveal>
        <Reveal delay={100} y={24}>
          <div style={{ background: "#fff", borderRadius: "var(--radius-2xl)", padding: 30, border: "1px solid var(--border)", boxShadow: "var(--shadow-xl)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ width: 52, height: 52, borderRadius: 15, background: "#D1FAE5", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center" }}><MIcon name="lock-keyhole" size={26} /></span>
              <div><div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>HIPAA + SOC 2 Type II</div><div style={{ fontSize: 13, color: "#64748b" }}>Independently assessed, BAA included</div></div>
            </div>
            <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 11 }}>
              {[["fingerprint", "Every PHI access logged", "Immutable audit trail"], ["server", "Tenant data isolated by org", "Row-level scoping"], ["bell-off", "Push payloads carry no PHI", "Safe on any device"]].map(([i, t, s]) => (
                <div key={t} style={{ display: "flex", gap: 12, alignItems: "center", background: "#F8FAFC", borderRadius: "var(--radius-lg)", padding: "13px 15px", border: "1px solid var(--border)" }}>
                  <MIcon name={i} size={19} color="var(--sky-700)" />
                  <div><div style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a" }}>{t}</div><div style={{ fontSize: 12, color: "#94a3b8" }}>{s}</div></div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---- Social proof: stats + testimonial ---- */
function SocialProof() {
  const stats = [["< 30s", "median time to accept"], ["94%", "first-alert acceptance"], ["1 day", "to go live"], ["0", "PHI in notifications"]];
  return (
    <section style={{ background: "#fff", padding: "92px 0" }}>
      <div className="m-wrap">
        <Reveal>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20, marginBottom: 56 }} className="m-stat-grid">
            {stats.map(([n, l], i) => (
              <div key={l} style={{ textAlign: "center", borderRight: i < 3 ? "1px solid var(--border)" : "none", padding: "4px 8px" }} className="m-stat">
                <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: "-0.03em", background: "var(--sky-gradient)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{n}</div>
                <div style={{ fontSize: 13.5, color: "#64748b", marginTop: 6 }}>{l}</div>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={80}>
          <figure style={{ margin: 0, maxWidth: 860, marginInline: "auto", textAlign: "center" }}>
            <MIcon name="quote" size={34} color="var(--sky-400)" style={{ justifyContent: "center" }} />
            <blockquote style={{ fontSize: 27, lineHeight: 1.4, fontWeight: 600, color: "#0f172a", letterSpacing: "-0.01em", margin: "16px 0 0", textWrap: "balance" }}>
              "We went from a whiteboard and a stack of phone calls to one queue everyone trusts. The 2 a.m. scramble is just… gone."
            </blockquote>
            <figcaption style={{ display: "inline-flex", alignItems: "center", gap: 12, marginTop: 26 }}>
              <span style={{ width: 46, height: 46, borderRadius: 99, background: "var(--sky-gradient)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700 }}>JM</span>
              <div style={{ textAlign: "left" }}><div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>Dr. Jordan Mercer</div><div style={{ fontSize: 13.5, color: "#64748b" }}>Hospitalist lead · Mercy General</div></div>
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}

/* ---- Pricing ---- */
function Pricing() {
  const plans = [
    { name: "Department", price: "$0", note: "free to start", desc: "For a single ER or hospitalist group getting started.", features: ["Round-robin routing", "Push + SMS alerts", "Secure messaging", "Up to 25 providers"], cta: "Get started free", hi: false },
    { name: "Hospital", price: "$8", note: "/ provider / mo", desc: "For a full hospital with multiple departments.", features: ["Everything in Department", "AI-assisted intake", "Amion schedule sync", "Custom round-robin rules", "Priority support"], cta: "Start free trial", hi: true },
    { name: "Network", price: "Custom", note: "", desc: "For multi-hospital systems and IDNs.", features: ["Everything in Hospital", "Multi-tenant admin", "SSO / OIDC", "Dedicated success manager", "BAA + custom DPA"], cta: "Talk to sales", hi: false },
  ];
  return (
    <section id="pricing" style={{ background: "var(--marketing-bg)", padding: "92px 0" }}>
      <div className="m-wrap">
        <Reveal>
          <SectionHead eyebrow="Pricing" title="Simple, per-provider pricing" sub="Start free. Upgrade when your whole hospital is on board — no per-message fees, no surprises." />
        </Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 48, alignItems: "stretch" }} className="m-price-grid">
          {plans.map((p, i) => (
            <Reveal key={p.name} delay={i * 90}>
              <div style={{ background: "#fff", borderRadius: "var(--radius-2xl)", padding: 28, height: "100%", border: p.hi ? "2px solid var(--primary)" : "1px solid var(--border)", boxShadow: p.hi ? "var(--shadow-xl)" : "var(--shadow-sm)", position: "relative", display: "flex", flexDirection: "column" }}>
                {p.hi && <span style={{ position: "absolute", top: -12, left: 28, background: "var(--sky-gradient)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 99, boxShadow: "var(--shadow-glow)", whiteSpace: "nowrap" }}>Most popular</span>}
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{p.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "12px 0 4px" }}>
                  <span style={{ fontSize: 42, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>{p.price}</span>
                  <span style={{ fontSize: 14, color: "#64748b" }}>{p.note}</span>
                </div>
                <p style={{ fontSize: 13.5, color: "#64748b", margin: "0 0 18px", lineHeight: 1.5 }}>{p.desc}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 11, flex: 1 }}>
                  {p.features.map((f) => (
                    <div key={f} style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13.5, color: "#334155" }}>
                      <MIcon name="check" size={16} color="#059669" />{f}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 24 }}><CTA variant={p.hi ? "primary" : "secondary"} size="sm" full>{p.cta}</CTA></div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- Final CTA ---- */
function FinalCTA() {
  return (
    <section style={{ background: "#fff", padding: "84px 0" }}>
      <div className="m-wrap">
        <Reveal y={24}>
          <div style={{ background: "linear-gradient(135deg,#0EA5E9,#0369A1)", borderRadius: "var(--radius-2xl)", padding: "60px 40px", textAlign: "center", position: "relative", overflow: "hidden", boxShadow: "var(--shadow-2xl)" }}>
            <div style={{ position: "absolute", width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,.5), transparent 70%)", top: -120, right: -80 }} />
            <div style={{ position: "relative", zIndex: 2 }}>
              <h2 style={{ fontSize: 42, fontWeight: 700, color: "#fff", margin: 0, letterSpacing: "-0.025em", textWrap: "balance" }}>Get your ER and hospitalists in sync.</h2>
              <p style={{ fontSize: 17.5, color: "rgba(255,255,255,.88)", margin: "16px auto 0", maxWidth: 500 }}>Set up DocTurn for your hospital in under a day — no IT project required.</p>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 32, flexWrap: "wrap" }}>
                <button style={{ height: 52, padding: "0 30px", borderRadius: "var(--radius-md)", border: "none", background: "#fff", color: "var(--sky-700)", fontSize: 16, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9 }}>Get started free <MIcon name="arrow-right" size={18} /></button>
                <button style={{ height: 52, padding: "0 26px", borderRadius: "var(--radius-md)", border: "1px solid rgba(255,255,255,.55)", background: "transparent", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>Book a demo</button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

Object.assign(window, { MessagingShowcase, NotifyShowcase, Security, SocialProof, Pricing, FinalCTA });
