/* DocTurn marketing site — shared primitives, nav, footer, compliance strip */

/* ----- Lucide icon ----- */
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

/* ----- Scroll reveal (honors reduced motion) ----- */
function Reveal({ children, delay = 0, y = 18, as = "div", className, style }) {
  const ref = React.useRef(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(true); return; }
    // Already in (or above) the viewport on mount → reveal right away, no wait.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.95) { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    // Safety net: never leave content hidden.
    const t = setTimeout(() => setShown(true), 1400);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);
  const Tag = as;
  return (
    <Tag ref={ref} className={className} style={{
      ...style,
      opacity: shown ? 1 : 0,
      transform: shown ? "none" : `translateY(${y}px)`,
      transition: `opacity .6s cubic-bezier(.16,.84,.44,1) ${delay}ms, transform .6s cubic-bezier(.16,.84,.44,1) ${delay}ms`,
    }}>{children}</Tag>
  );
}

/* ----- CTA button ----- */
function CTA({ children, variant = "primary", size = "lg", icon, iconLeft, onClick, full }) {
  const sz = size === "lg" ? { height: 52, padding: "0 28px", fontSize: 16 } : { height: 44, padding: "0 20px", fontSize: 14.5 };
  const styles = variant === "primary"
    ? { background: "var(--sky-gradient)", color: "#fff", boxShadow: "var(--shadow-glow)", border: "1px solid transparent" }
    : variant === "ghost"
    ? { background: "transparent", color: "#0f172a", border: "1px solid var(--border)" }
    : { background: "#fff", color: "#0f172a", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" };
  return (
    <button onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
      style={{ ...sz, ...styles, width: full ? "100%" : "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: "var(--radius-md)", fontWeight: 600, cursor: "pointer", transition: "transform .2s ease, box-shadow .2s ease", fontFamily: "var(--font-sans)", whiteSpace: "nowrap" }}>
      {iconLeft && <MIcon name={iconLeft} size={18} />}{children}{icon && <MIcon name={icon} size={18} />}
    </button>
  );
}

/* ----- Eyebrow + heading block ----- */
function SectionHead({ eyebrow, title, sub, center = true, light = false, maxW = 660 }) {
  return (
    <div style={{ textAlign: center ? "center" : "left", maxWidth: center ? maxW : "none", margin: center ? "0 auto" : 0 }}>
      {eyebrow && <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: light ? "var(--sky-400)" : "#0284c7" }}>{eyebrow}</div>}
      <h2 style={{ fontSize: 40, lineHeight: 1.1, letterSpacing: "-0.025em", fontWeight: 700, color: light ? "#fff" : "#0f172a", margin: "12px 0 0", textWrap: "balance" }}>{title}</h2>
      {sub && <p style={{ fontSize: 17.5, lineHeight: 1.55, color: light ? "rgba(255,255,255,.78)" : "#64748b", margin: "16px 0 0", textWrap: "pretty" }}>{sub}</p>}
    </div>
  );
}

/* ----- Status pill (mirrors the product's status language) ----- */
function StatusPill({ status, label, icon, size = "sm" }) {
  const pad = size === "sm" ? "2px 8px" : "4px 11px";
  const fs = size === "sm" ? 11.5 : 12.5;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: fs, fontWeight: 600, padding: pad, borderRadius: 99, background: `var(--status-${status}-bg)`, color: `var(--status-${status})` }}>
      {icon && <MIcon name={icon} size={fs} />}{label}
    </span>
  );
}

/* ----- Browser-chrome wrapper for product mockups ----- */
function AppFrame({ children, url = "app.docturn.health", style, maxWidth }) {
  return (
    <div style={{ background: "#fff", borderRadius: "var(--radius-2xl)", boxShadow: "var(--shadow-2xl)", border: "1px solid hsl(214 32% 91% / .85)", overflow: "hidden", maxWidth, margin: maxWidth ? "0 auto" : undefined, ...style }}>
      <div style={{ height: 42, background: "#F8FAFC", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 7, padding: "0 16px" }}>
        <span style={{ width: 11, height: 11, borderRadius: 99, background: "#FB7185" }} />
        <span style={{ width: 11, height: 11, borderRadius: 99, background: "#FBBF24" }} />
        <span style={{ width: 11, height: 11, borderRadius: 99, background: "#34D399" }} />
        <span style={{ marginLeft: 12, fontSize: 12, color: "#94a3b8", fontFamily: "var(--font-mono)" }}>{url}</span>
      </div>
      {children}
    </div>
  );
}

/* ----- Nav ----- */
function Nav() {
  const links = [["The problem", "#problem"], ["How it works", "#how"], ["Security", "#security"], ["Pricing", "#pricing"]];
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 40, background: scrolled ? "rgba(255,255,255,.82)" : "rgba(255,255,255,.55)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", borderBottom: scrolled ? "1px solid hsl(214 32% 91% / .8)" : "1px solid transparent", transition: "background .25s ease, border-color .25s ease" }}>
      <div className="m-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 68 }}>
        <a href="#top" style={{ display: "inline-flex" }}><img src="assets/docturn-wordmark-marketing.svg" alt="DocTurn" style={{ height: 30 }} /></a>
        <nav style={{ display: "flex", gap: 30 }} className="m-navlinks">
          {links.map(([l, href]) => <a key={l} href={href} style={{ fontSize: 14.5, fontWeight: 500, color: "#475569", textDecoration: "none" }}>{l}</a>)}
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="#" style={{ fontSize: 14.5, fontWeight: 500, color: "#0f172a", textDecoration: "none" }} className="m-signin">Sign in</a>
          <CTA size="sm">Get started free</CTA>
        </div>
      </div>
    </header>
  );
}

/* ----- Compliance trust strip — HIPAA / SOC 2 front and center ----- */
function ComplianceStrip() {
  const items = [
    ["shield-check", "HIPAA compliant"],
    ["badge-check", "SOC 2 Type II"],
    ["lock", "Encrypted in transit & at rest"],
    ["fingerprint", "Full PHI audit trail"],
    ["key-round", "MFA on every account"],
  ];
  return (
    <div style={{ borderTop: "1px solid hsl(214 32% 91% / .7)", borderBottom: "1px solid hsl(214 32% 91% / .7)", background: "rgba(255,255,255,.6)", backdropFilter: "blur(6px)" }}>
      <div className="m-wrap" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "14px 28px", padding: "18px 24px" }}>
        {items.map(([ic, t]) => (
          <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 13.5, fontWeight: 600, color: "#334155" }}>
            <MIcon name={ic} size={17} color="#059669" />{t}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ----- Footer ----- */
function Footer() {
  const cols = {
    Product: ["Patient assignment", "Secure messaging", "AI intake", "Mobile app", "Integrations"],
    Company: ["About", "Customers", "Careers", "Contact"],
    Resources: ["Documentation", "Security", "HIPAA & BAA", "System status"],
  };
  return (
    <footer style={{ background: "#0f172a", color: "#cbd5e1", padding: "60px 0 32px" }}>
      <div className="m-wrap" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 1fr", gap: 32 }} className="m-foot-grid">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <img src="assets/docturn-glyph-sky.svg" alt="" style={{ width: 38, height: 38, borderRadius: 10 }} />
            <span style={{ fontSize: 21, fontWeight: 700, color: "#fff" }}>DocTurn</span>
          </div>
          <p style={{ fontSize: 13.5, color: "#94a3b8", margin: "18px 0 0", maxWidth: 280, lineHeight: 1.6 }}>HIPAA-compliant patient assignment and secure messaging — built for the ER-to-hospitalist hand-off.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#94a3b8", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 10px" }}><MIcon name="shield-check" size={14} color="#34D399" />HIPAA</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#94a3b8", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 10px" }}><MIcon name="badge-check" size={14} color="#34D399" />SOC 2</span>
          </div>
        </div>
        {Object.entries(cols).map(([h, links]) => (
          <div key={h}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 14 }}>{h}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {links.map((l) => <a key={l} href="#" style={{ fontSize: 13.5, color: "#94a3b8", textDecoration: "none" }}>{l}</a>)}
            </div>
          </div>
        ))}
      </div>
      <div className="m-wrap" style={{ borderTop: "1px solid #1e293b", marginTop: 44, paddingTop: 22, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, fontSize: 12.5, color: "#64748b" }}>
        <span>© 2026 DocTurn Health, Inc. All rights reserved.</span>
        <div style={{ display: "flex", gap: 22 }}>
          <a href="#" style={{ color: "#64748b", textDecoration: "none" }}>Privacy</a>
          <a href="#" style={{ color: "#64748b", textDecoration: "none" }}>Terms</a>
          <a href="#" style={{ color: "#64748b", textDecoration: "none" }}>BAA</a>
        </div>
      </div>
    </footer>
  );
}

Object.assign(window, { MIcon, Reveal, CTA, SectionHead, StatusPill, AppFrame, Nav, ComplianceStrip, Footer });
