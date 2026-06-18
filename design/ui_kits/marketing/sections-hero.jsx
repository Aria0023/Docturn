/* DoctorHeidi marketing landing — section components */

function MIcon({ name, size = 16, color, strokeWidth = 2, style }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = `<i data-lucide="${name}"></i>`;
    window.lucide.createIcons({ attrs: { width: size, height: size, "stroke-width": strokeWidth }, root: host });
  });
  return <span ref={ref} style={{ display: "inline-flex", alignItems: "center", color, flex: "none", ...style }} />;
}

function CTA({ children, variant = "primary", size = "lg", icon, onClick }) {
  const sz = size === "lg" ? { height: 52, padding: "0 28px", fontSize: 16 } : { height: 44, padding: "0 20px", fontSize: 15 };
  const styles = variant === "primary"
    ? { background: "var(--sky-gradient)", color: "#fff", boxShadow: "var(--shadow-glow)" }
    : { background: "#fff", color: "#0f172a", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" };
  return (
    <button onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
      style={{ ...sz, ...styles, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: "var(--radius-md)", border: styles.border || "1px solid transparent", fontWeight: 600, cursor: "pointer", transition: "transform .2s ease, box-shadow .2s ease", fontFamily: "var(--font-sans)", whiteSpace: "nowrap" }}>
      {children}{icon && <MIcon name={icon} size={18} />}
    </button>
  );
}

function Nav() {
  const links = ["Product", "How it works", "Security", "Pricing"];
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(255,255,255,.72)", backdropFilter: "blur(12px)", borderBottom: "1px solid hsl(214 32% 91% / .7)" }}>
      <div className="m-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 68 }}>
        <img src="assets/docturn-wordmark-marketing.svg" alt="DocTurn" style={{ height: 30 }} />
        <nav style={{ display: "flex", gap: 30 }} className="m-navlinks">
          {links.map((l) => <a key={l} href="#" style={{ fontSize: 14.5, fontWeight: 500, color: "#475569", textDecoration: "none" }}>{l}</a>)}
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="#" style={{ fontSize: 14.5, fontWeight: 500, color: "#0f172a", textDecoration: "none" }} className="m-signin">Sign in</a>
          <CTA size="sm">Get started free</CTA>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section style={{ position: "relative", overflow: "hidden" }}>
      <div className="m-wrap" style={{ paddingTop: 72, paddingBottom: 72, position: "relative", zIndex: 2 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", boxShadow: "var(--shadow-sm)", padding: "6px 14px", borderRadius: 99, fontSize: 13, fontWeight: 600, color: "var(--sky-700)" }}>
          <MIcon name="sparkles" size={14} /> HIPAA-compliant · trusted in the ER
        </div>
        <h1 style={{ fontSize: 60, lineHeight: 1.05, letterSpacing: "-0.03em", fontWeight: 700, color: "#0f172a", margin: "22px 0 0", maxWidth: 820 }} className="m-hero-h1">
          Patient hand-offs,<br />handled in seconds.
        </h1>
        <p style={{ fontSize: 19, lineHeight: 1.55, color: "#475569", margin: "22px 0 0", maxWidth: 560 }}>
          DocTurn routes every ER admit to the right hospitalist automatically — with real-time
          notifications and secure messaging your whole care team can trust.
        </p>
        <div style={{ display: "flex", gap: 14, marginTop: 32, flexWrap: "wrap" }}>
          <CTA icon="arrow-right">Get started free</CTA>
          <CTA variant="secondary" icon="play">Watch the 2-min demo</CTA>
        </div>
        <div style={{ display: "flex", gap: 26, marginTop: 30, flexWrap: "wrap", color: "#64748b", fontSize: 13.5 }}>
          {[["shield-check", "SOC 2 + HIPAA"], ["zap", "Live in a day"], ["users", "Unlimited providers"]].map(([i, t]) => (
            <span key={t} style={{ display: "flex", gap: 7, alignItems: "center" }}><MIcon name={i} size={15} color="var(--sky-500)" />{t}</span>
          ))}
        </div>
      </div>

      {/* floating product preview */}
      <div className="m-wrap" style={{ position: "relative", zIndex: 2, paddingBottom: 80 }}>
        <HeroPreview />
      </div>

      {/* decorative blobs */}
      <div style={{ position: "absolute", width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,.22), transparent 68%)", top: -140, right: -120, zIndex: 1 }} />
      <div style={{ position: "absolute", width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,228,230,.6), transparent 68%)", bottom: 40, left: -160, zIndex: 1 }} />
    </section>
  );
}

function HeroPreview() {
  return (
    <div className="m-float" style={{ background: "#fff", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-2xl)", border: "1px solid hsl(214 32% 91% / .8)", overflow: "hidden", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ height: 42, background: "#F8FAFC", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 7, padding: "0 16px" }}>
        <span style={{ width: 11, height: 11, borderRadius: 99, background: "#FB7185" }} />
        <span style={{ width: 11, height: 11, borderRadius: 99, background: "#FBBF24" }} />
        <span style={{ width: 11, height: 11, borderRadius: 99, background: "#34D399" }} />
        <span style={{ marginLeft: 12, fontSize: 12, color: "#94a3b8" }}>app.docturn.health</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, padding: 22, background: "linear-gradient(180deg,#fff,#F8FAFC)" }}>
        {[
          ["Pending", "RM · Rm 318", "Acute abdominal pain", "pending", "clock"],
          ["Accepted", "SC · Rm 412", "Chest pain — Dr. Chen", "accepted", "check"],
          ["Sent", "TK · Rm 205", "Routed via round-robin", "active", "send"],
        ].map(([badge, name, sub, st, ic]) => (
          <div key={name} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 14, boxShadow: "var(--shadow-sm)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
              background: `var(--status-${st}-bg)`, color: `var(--status-${st})` }}>
              <MIcon name={ic} size={11} />{badge}
            </span>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10 }}>{name}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { MIcon, CTA, Nav, Hero });
