/* DocTurn marketing site — hero + problem narrative */

function Hero() {
  return (
    <section id="top" style={{ position: "relative", overflow: "hidden" }}>
      <div className="m-wrap" style={{ paddingTop: 64, paddingBottom: 40, position: "relative", zIndex: 2 }}>
        <Reveal as="div" delay={0}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", boxShadow: "var(--shadow-sm)", padding: "6px 14px", borderRadius: 99, fontSize: 13, fontWeight: 600, color: "var(--sky-700)", whiteSpace: "nowrap" }}>
            <MIcon name="activity" size={14} /> Built for the ER → hospitalist hand-off
          </div>
        </Reveal>
        <Reveal delay={60}>
          <h1 style={{ fontSize: 62, lineHeight: 1.04, letterSpacing: "-0.035em", fontWeight: 700, color: "#0f172a", margin: "22px 0 0", maxWidth: 860, textWrap: "balance" }} className="m-hero-h1">
            Patient hand-offs,<br />without the phone tag.
          </h1>
        </Reveal>
        <Reveal delay={120}>
          <p style={{ fontSize: 19.5, lineHeight: 1.55, color: "#475569", margin: "24px 0 0", maxWidth: 580, textWrap: "pretty" }}>
            DocTurn routes every ER admit to the next available hospitalist by census — fair, instant,
            and fully tracked. The right patient reaches the right provider, on any device, every time.
          </p>
        </Reveal>
        <Reveal delay={180}>
          <div style={{ display: "flex", gap: 14, marginTop: 34, flexWrap: "wrap" }}>
            <CTA icon="arrow-right">Get started free</CTA>
            <CTA variant="secondary" iconLeft="play">Watch the 2-min demo</CTA>
          </div>
        </Reveal>
        <Reveal delay={240}>
          <div style={{ display: "flex", gap: 26, marginTop: 30, flexWrap: "wrap", color: "#64748b", fontSize: 13.5 }}>
            {[["zap", "Live in a day"], ["users", "Unlimited providers"], ["credit-card", "Free to start"]].map(([i, t]) => (
              <span key={t} style={{ display: "flex", gap: 7, alignItems: "center" }}><MIcon name={i} size={15} color="var(--sky-500)" />{t}</span>
            ))}
          </div>
        </Reveal>
      </div>

      <div className="m-wrap" style={{ position: "relative", zIndex: 2, paddingBottom: 72 }}>
        <Reveal delay={120} y={28}>
          <div className="m-float"><HeroPreview /></div>
        </Reveal>
      </div>

      {/* decorative blobs */}
      <div style={{ position: "absolute", width: 560, height: 560, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,.22), transparent 68%)", top: -160, right: -140, zIndex: 1 }} />
      <div style={{ position: "absolute", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,228,230,.6), transparent 68%)", bottom: 20, left: -180, zIndex: 1 }} />
    </section>
  );
}

/* Rich assignment-queue product mockup */
function HeroPreview() {
  const nav = [["layout-dashboard", "Dashboard", true], ["inbox", "Assignments", false], ["messages-square", "Messages", false], ["users", "Directory", false]];
  const rows = [
    { init: "RM", room: "Rm 318", note: "Acute abdominal pain", to: "Routing…", st: "pending", stLabel: "Pending", ic: "clock", time: "0:42 left" },
    { init: "SC", room: "Rm 412", note: "Chest pain — telemetry", to: "Dr. Chen", st: "accepted", stLabel: "Accepted", ic: "check", time: "2m ago" },
    { init: "TK", room: "Rm 205", note: "Post-op observation", to: "Dr. Okafor", st: "active", stLabel: "Sent", ic: "send", time: "just now" },
    { init: "JL", room: "Rm 109", note: "CHF exacerbation", to: "Dr. Reyes", st: "accepted", stLabel: "Accepted", ic: "check", time: "8m ago" },
  ];
  return (
    <AppFrame maxWidth={980}>
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", minHeight: 408 }} className="m-hero-grid">
        {/* sidebar */}
        <div style={{ background: "#F8FAFC", borderRight: "1px solid var(--border)", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4 }} className="m-hero-side">
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 14px" }}>
            <img src="assets/docturn-glyph.svg" alt="" style={{ width: 26, height: 26, borderRadius: 7 }} />
            <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>DocTurn</span>
          </div>
          {nav.map(([ic, label, active]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: "var(--radius-md)", fontSize: 13.5, fontWeight: active ? 600 : 500, color: active ? "var(--primary)" : "#64748b", background: active ? "#fff" : "transparent", boxShadow: active ? "var(--shadow-sm)" : "none" }}>
              <MIcon name={ic} size={17} />{label}
            </div>
          ))}
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
            <span style={{ position: "relative", width: 30, height: 30, borderRadius: 99, background: "var(--sky-gradient)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
              MA
              <span style={{ position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: 99, background: "var(--status-accepted)", border: "2px solid #F8FAFC" }} />
            </span>
            <div style={{ lineHeight: 1.2 }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "#0f172a" }}>Dr. Alvarez</div><div style={{ fontSize: 11, color: "#94a3b8" }}>Hospitalist</div></div>
          </div>
        </div>
        {/* main */}
        <div style={{ padding: "18px 20px", background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Assignment queue</div>
              <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 2 }}>Mercy General · 4 active</div>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--status-accepted)", background: "var(--status-accepted-bg)", padding: "5px 10px", borderRadius: 99 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--status-accepted)" }} className="m-pulse" />Live
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {rows.map((r) => (
              <div key={r.init + r.room} style={{ display: "flex", alignItems: "center", gap: 13, border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "11px 13px", boxShadow: "var(--shadow-sm)" }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "#F1F5F9", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flex: "none" }}>{r.init}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>{r.init} · {r.room}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</div>
                </div>
                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", flex: "none" }}>
                  <StatusPill status={r.st} label={r.stLabel} icon={r.ic} />
                  <span style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 5 }}>
                    {r.to !== "Routing…" && <span>→ {r.to}</span>}{r.to === "Routing…" && <span style={{ color: "var(--status-pending)", fontWeight: 600 }}>{r.time}</span>}{r.to !== "Routing…" && r.time}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

/* The problem — narrative storytelling */
function Problem() {
  const pains = [
    ["phone-off", "Phone tag at 2 a.m.", "Calling down a list to find who's covering — voicemail after voicemail while a patient waits in the ER."],
    ["scale", "Unfair, uneven load", "No shared view of census, so the same few hospitalists get overloaded and hand-offs stall."],
    ["file-question", "Nothing is tracked", "Who accepted? When? On a sticky note or a text thread — impossible to audit, easy to lose."],
  ];
  return (
    <section id="problem" style={{ background: "#fff", padding: "92px 0 84px" }}>
      <div className="m-wrap">
        <Reveal>
          <SectionHead center={false} maxW={720} eyebrow="The problem"
            title="The 2 a.m. hand-off is held together by phone calls."
            sub="An ER admit means tracking down whoever's covering, hoping they pick up, and trusting that someone wrote it down. It's slow, it's uneven, and when seconds matter it's the patient who waits." />
        </Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 44 }} className="m-feature-grid">
          {pains.map(([ic, t, d], i) => (
            <Reveal key={t} delay={i * 90}>
              <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-2xl)", padding: 24, height: "100%", background: "linear-gradient(180deg,#fff,#FBFCFE)" }}>
                <span style={{ width: 46, height: 46, borderRadius: 13, background: "#FEE2E2", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MIcon name={ic} size={22} />
                </span>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "16px 0 6px" }}>{t}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "#64748b", margin: 0 }}>{d}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={120}>
          <div style={{ marginTop: 28, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap", textAlign: "center" }}>
            <span style={{ fontSize: 16, color: "#334155", fontWeight: 500 }}>DocTurn replaces all of it with one calm, automatic queue.</span>
            <a href="#how" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, color: "var(--sky-700)", textDecoration: "none" }}>See how it works <MIcon name="arrow-down" size={16} /></a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

Object.assign(window, { Hero, HeroPreview, Problem });
