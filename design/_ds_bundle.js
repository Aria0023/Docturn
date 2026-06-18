/* @ds-bundle: {"format":3,"namespace":"DocTurnDesignSystem_207f10","components":[],"sourceHashes":{"marketing-site/site-core.jsx":"43d4053d545d","marketing-site/site-flow.jsx":"4e3aaa1f8822","marketing-site/site-hero.jsx":"3c71661874c2","marketing-site/site-trust.jsx":"9e75f3a4dfa9","pitch-deck/deck-stage.js":"9436a2deeb46","ui_kits/marketing/sections-body.jsx":"1b23030b0ef7","ui_kits/marketing/sections-hero.jsx":"0ce305bc4e92","ui_kits/mobile/ios-frame.jsx":"be3343be4b51","ui_kits/mobile/roles.jsx":"d17c09d21fd1","ui_kits/mobile/screens.jsx":"db62dd754422","ui_kits/web-app/AppShell.jsx":"c387ea7f1a2a","ui_kits/web-app/Appearance.jsx":"eb77af218578","ui_kits/web-app/Broadcasts.jsx":"ebc3363b0d3a","ui_kits/web-app/CareTeam.jsx":"ffe08b3aa841","ui_kits/web-app/Compliance.jsx":"a1523fe0311d","ui_kits/web-app/DeveloperDashboard.jsx":"e7bc57c75c47","ui_kits/web-app/DirectorDashboard.jsx":"22773aa9b1fb","ui_kits/web-app/Directory.jsx":"ed305f64ac44","ui_kits/web-app/ErDirectorDashboard.jsx":"51dc886174ec","ui_kits/web-app/ErDoctorDashboard.jsx":"2aa10994716f","ui_kits/web-app/HospitalistDashboard.jsx":"85b7b6c0740e","ui_kits/web-app/LockScreen.jsx":"b34aaea90354","ui_kits/web-app/LoginScreen.jsx":"b7ae0512d40f","ui_kits/web-app/Messaging.jsx":"2f586d7d8d91","ui_kits/web-app/OrgSettings.jsx":"4beca1d2ec50","ui_kits/web-app/PatientBoard.jsx":"115604cb9e2b","ui_kits/web-app/People.jsx":"08752d97d110","ui_kits/web-app/RoleManagement.jsx":"97b91d074c66","ui_kits/web-app/ScheduleSync.jsx":"5969f7e459be","ui_kits/web-app/components.jsx":"7caf1ee76751","ui_kits/web-app/store.js":"da8aa4c1b4d2"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DocTurnDesignSystem_207f10 = window.DocTurnDesignSystem_207f10 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// marketing-site/site-core.jsx
try { (() => {
/* DocTurn marketing site — shared primitives, nav, footer, compliance strip */

/* ----- Lucide icon ----- */
function MIcon({
  name,
  size = 16,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = `<i data-lucide="${name}"></i>`;
    window.lucide.createIcons({
      attrs: {
        width: size,
        height: size,
        "stroke-width": strokeWidth
      },
      root: host
    });
  });
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      display: "inline-flex",
      alignItems: "center",
      color,
      flex: "none",
      ...style
    }
  });
}

/* ----- Scroll reveal (honors reduced motion) ----- */
function Reveal({
  children,
  delay = 0,
  y = 18,
  as = "div",
  className,
  style
}) {
  const ref = React.useRef(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    // Already in (or above) the viewport on mount → reveal right away, no wait.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.95) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: "0px 0px -8% 0px"
    });
    io.observe(el);
    // Safety net: never leave content hidden.
    const t = setTimeout(() => setShown(true), 1400);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, []);
  const Tag = as;
  return /*#__PURE__*/React.createElement(Tag, {
    ref: ref,
    className: className,
    style: {
      ...style,
      opacity: shown ? 1 : 0,
      transform: shown ? "none" : `translateY(${y}px)`,
      transition: `opacity .6s cubic-bezier(.16,.84,.44,1) ${delay}ms, transform .6s cubic-bezier(.16,.84,.44,1) ${delay}ms`
    }
  }, children);
}

/* ----- CTA button ----- */
function CTA({
  children,
  variant = "primary",
  size = "lg",
  icon,
  iconLeft,
  onClick,
  full
}) {
  const sz = size === "lg" ? {
    height: 52,
    padding: "0 28px",
    fontSize: 16
  } : {
    height: 44,
    padding: "0 20px",
    fontSize: 14.5
  };
  const styles = variant === "primary" ? {
    background: "var(--sky-gradient)",
    color: "#fff",
    boxShadow: "var(--shadow-glow)",
    border: "1px solid transparent"
  } : variant === "ghost" ? {
    background: "transparent",
    color: "#0f172a",
    border: "1px solid var(--border)"
  } : {
    background: "#fff",
    color: "#0f172a",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-sm)"
  };
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: e => {
      e.currentTarget.style.transform = "translateY(-2px)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = "none";
    },
    style: {
      ...sz,
      ...styles,
      width: full ? "100%" : "auto",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      borderRadius: "var(--radius-md)",
      fontWeight: 600,
      cursor: "pointer",
      transition: "transform .2s ease, box-shadow .2s ease",
      fontFamily: "var(--font-sans)",
      whiteSpace: "nowrap"
    }
  }, iconLeft && /*#__PURE__*/React.createElement(MIcon, {
    name: iconLeft,
    size: 18
  }), children, icon && /*#__PURE__*/React.createElement(MIcon, {
    name: icon,
    size: 18
  }));
}

/* ----- Eyebrow + heading block ----- */
function SectionHead({
  eyebrow,
  title,
  sub,
  center = true,
  light = false,
  maxW = 660
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: center ? "center" : "left",
      maxWidth: center ? maxW : "none",
      margin: center ? "0 auto" : 0
    }
  }, eyebrow && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: ".07em",
      textTransform: "uppercase",
      color: light ? "var(--sky-400)" : "#0284c7"
    }
  }, eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 40,
      lineHeight: 1.1,
      letterSpacing: "-0.025em",
      fontWeight: 700,
      color: light ? "#fff" : "#0f172a",
      margin: "12px 0 0",
      textWrap: "balance"
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 17.5,
      lineHeight: 1.55,
      color: light ? "rgba(255,255,255,.78)" : "#64748b",
      margin: "16px 0 0",
      textWrap: "pretty"
    }
  }, sub));
}

/* ----- Status pill (mirrors the product's status language) ----- */
function StatusPill({
  status,
  label,
  icon,
  size = "sm"
}) {
  const pad = size === "sm" ? "2px 8px" : "4px 11px";
  const fs = size === "sm" ? 11.5 : 12.5;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: fs,
      fontWeight: 600,
      padding: pad,
      borderRadius: 99,
      background: `var(--status-${status}-bg)`,
      color: `var(--status-${status})`
    }
  }, icon && /*#__PURE__*/React.createElement(MIcon, {
    name: icon,
    size: fs
  }), label);
}

/* ----- Browser-chrome wrapper for product mockups ----- */
function AppFrame({
  children,
  url = "app.docturn.health",
  style,
  maxWidth
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: "var(--radius-2xl)",
      boxShadow: "var(--shadow-2xl)",
      border: "1px solid hsl(214 32% 91% / .85)",
      overflow: "hidden",
      maxWidth,
      margin: maxWidth ? "0 auto" : undefined,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 42,
      background: "#F8FAFC",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 7,
      padding: "0 16px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: 99,
      background: "#FB7185"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: 99,
      background: "#FBBF24"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: 99,
      background: "#34D399"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 12,
      fontSize: 12,
      color: "#94a3b8",
      fontFamily: "var(--font-mono)"
    }
  }, url)), children);
}

/* ----- Nav ----- */
function Nav() {
  const links = [["The problem", "#problem"], ["How it works", "#how"], ["Security", "#security"], ["Pricing", "#pricing"]];
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, {
      passive: true
    });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 40,
      background: scrolled ? "rgba(255,255,255,.82)" : "rgba(255,255,255,.55)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      borderBottom: scrolled ? "1px solid hsl(214 32% 91% / .8)" : "1px solid transparent",
      transition: "background .25s ease, border-color .25s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: 68
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#top",
    style: {
      display: "inline-flex"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "assets/docturn-wordmark-marketing.svg",
    alt: "DocTurn",
    style: {
      height: 30
    }
  })), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      gap: 30
    },
    className: "m-navlinks"
  }, links.map(([l, href]) => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: href,
    style: {
      fontSize: 14.5,
      fontWeight: 500,
      color: "#475569",
      textDecoration: "none"
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontSize: 14.5,
      fontWeight: 500,
      color: "#0f172a",
      textDecoration: "none"
    },
    className: "m-signin"
  }, "Sign in"), /*#__PURE__*/React.createElement(CTA, {
    size: "sm"
  }, "Get started free"))));
}

/* ----- Compliance trust strip — HIPAA / SOC 2 front and center ----- */
function ComplianceStrip() {
  const items = [["shield-check", "HIPAA compliant"], ["badge-check", "SOC 2 Type II"], ["lock", "Encrypted in transit & at rest"], ["fingerprint", "Full PHI audit trail"], ["key-round", "MFA on every account"]];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid hsl(214 32% 91% / .7)",
      borderBottom: "1px solid hsl(214 32% 91% / .7)",
      background: "rgba(255,255,255,.6)",
      backdropFilter: "blur(6px)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "14px 28px",
      padding: "18px 24px"
    }
  }, items.map(([ic, t]) => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 9,
      fontSize: 13.5,
      fontWeight: 600,
      color: "#334155"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 17,
    color: "#059669"
  }), t))));
}

/* ----- Footer ----- */
function Footer() {
  const cols = {
    Product: ["Patient assignment", "Secure messaging", "AI intake", "Mobile app", "Integrations"],
    Company: ["About", "Customers", "Careers", "Contact"],
    Resources: ["Documentation", "Security", "HIPAA & BAA", "System status"]
  };
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: "#0f172a",
      color: "#cbd5e1",
      padding: "60px 0 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "grid",
      gridTemplateColumns: "1.7fr 1fr 1fr 1fr",
      gap: 32
    },
    className: "m-foot-grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "assets/docturn-glyph-sky.svg",
    alt: "",
    style: {
      width: 38,
      height: 38,
      borderRadius: 10
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 21,
      fontWeight: 700,
      color: "#fff"
    }
  }, "DocTurn")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      color: "#94a3b8",
      margin: "18px 0 0",
      maxWidth: 280,
      lineHeight: 1.6
    }
  }, "HIPAA-compliant patient assignment and secure messaging \u2014 built for the ER-to-hospitalist hand-off."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginTop: 20
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      color: "#94a3b8",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: "6px 10px"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "shield-check",
    size: 14,
    color: "#34D399"
  }), "HIPAA"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      color: "#94a3b8",
      border: "1px solid #1e293b",
      borderRadius: 8,
      padding: "6px 10px"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "badge-check",
    size: 14,
    color: "#34D399"
  }), "SOC 2"))), Object.entries(cols).map(([h, links]) => /*#__PURE__*/React.createElement("div", {
    key: h
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: "#fff",
      marginBottom: 14
    }
  }, h), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 11
    }
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      fontSize: 13.5,
      color: "#94a3b8",
      textDecoration: "none"
    }
  }, l)))))), /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      borderTop: "1px solid #1e293b",
      marginTop: 44,
      paddingTop: 22,
      display: "flex",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 12,
      fontSize: 12.5,
      color: "#64748b"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 DocTurn Health, Inc. All rights reserved."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 22
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "#64748b",
      textDecoration: "none"
    }
  }, "Privacy"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "#64748b",
      textDecoration: "none"
    }
  }, "Terms"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "#64748b",
      textDecoration: "none"
    }
  }, "BAA"))));
}
Object.assign(window, {
  MIcon,
  Reveal,
  CTA,
  SectionHead,
  StatusPill,
  AppFrame,
  Nav,
  ComplianceStrip,
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "marketing-site/site-core.jsx", error: String((e && e.message) || e) }); }

// marketing-site/site-flow.jsx
try { (() => {
/* DocTurn marketing site — how it works (with routing mockup) + features */

function HowItWorks() {
  const steps = [["clipboard-plus", "ER admits", "An ER physician submits the patient. Paste free-text notes and AI structures the fields for you."], ["route", "DocTurn routes", "Round-robin picks the next eligible hospitalist by lowest census — or assign manually in a tap."], ["bell-ring", "Provider is notified", "In-app, push, and SMS fire instantly. Accept or decline from the lock screen."], ["circle-check-big", "Hand-off complete", "Census updates, the care team can message, and every step is audit-logged."]];
  return /*#__PURE__*/React.createElement("section", {
    id: "how",
    style: {
      background: "var(--marketing-bg)",
      padding: "92px 0",
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      position: "relative",
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "How it works",
    title: "Four steps, zero phone tag",
    sub: "From ER intake to hospitalist acceptance \u2014 fully automated, fully tracked, and fast enough to matter."
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 18,
      marginTop: 48
    },
    className: "m-steps"
  }, steps.map(([ic, t, d], i) => /*#__PURE__*/React.createElement(Reveal, {
    key: t,
    delay: i * 80
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "rgba(255,255,255,.82)",
      backdropFilter: "blur(6px)",
      borderRadius: "var(--radius-2xl)",
      padding: 22,
      border: "1px solid hsl(214 32% 91% / .8)",
      boxShadow: "var(--shadow-sm)",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 99,
      background: "var(--sky-gradient)",
      color: "#fff",
      fontSize: 13,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, i + 1), /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 20,
    color: "var(--sky-700)"
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      color: "#0f172a",
      margin: "0 0 6px"
    }
  }, t), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      lineHeight: 1.55,
      color: "#64748b",
      margin: 0
    }
  }, d))))), /*#__PURE__*/React.createElement(Reveal, {
    delay: 120,
    y: 26
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 40
    }
  }, /*#__PURE__*/React.createElement(RoutingMock, null)))));
}
function RoutingMock() {
  const docs = [{
    name: "Dr. Chen",
    spec: "Internal medicine",
    census: 6,
    cap: 12,
    st: "next"
  }, {
    name: "Dr. Okafor",
    spec: "Hospitalist",
    census: 8,
    cap: 12,
    st: "online"
  }, {
    name: "Dr. Reyes",
    spec: "Internal medicine",
    census: 9,
    cap: 12,
    st: "online"
  }, {
    name: "Dr. Patel",
    spec: "Hospitalist",
    census: 12,
    cap: 12,
    st: "full"
  }];
  return /*#__PURE__*/React.createElement(AppFrame, {
    url: "app.docturn.health/assign",
    maxWidth: 980
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1.25fr",
      gap: 0,
      minHeight: 320
    },
    className: "m-route-grid"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "24px 26px",
      borderRight: "1px solid var(--border)",
      background: "linear-gradient(180deg,#fff,#F8FAFC)",
      display: "flex",
      flexDirection: "column"
    },
    className: "m-route-left"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: ".06em",
      textTransform: "uppercase",
      color: "#94a3b8"
    }
  }, "Incoming admit"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: 16,
      boxShadow: "var(--shadow-sm)",
      background: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44,
      height: 44,
      borderRadius: 11,
      background: "#F1F5F9",
      color: "#475569",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 15,
      fontWeight: 700
    }
  }, "RM"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, "RM \xB7 Rm 318"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "#64748b"
    }
  }, "Acute abdominal pain"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: 14,
      flexWrap: "wrap"
    }
  }, ["Internal medicine", "Telemetry", "Age 54"].map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: "#475569",
      background: "#F1F5F9",
      padding: "3px 9px",
      borderRadius: 99
    }
  }, t)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      fontSize: 13,
      fontWeight: 600,
      color: "var(--sky-700)"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "route",
    size: 16
  }), " Round-robin \xB7 lowest census first"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      paddingTop: 18
    }
  }, /*#__PURE__*/React.createElement(CTA, {
    size: "sm",
    icon: "arrow-right",
    full: true
  }, "Send assignment"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "24px 26px",
      background: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: ".06em",
      textTransform: "uppercase",
      color: "#94a3b8"
    }
  }, "On-call rotation"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "#94a3b8"
    }
  }, "Census / cap")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, docs.map(d => {
    const next = d.st === "next",
      full = d.st === "full";
    return /*#__PURE__*/React.createElement("div", {
      key: d.name,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 13px",
        borderRadius: "var(--radius-lg)",
        border: next ? "1.5px solid var(--primary)" : "1px solid var(--border)",
        background: next ? "var(--status-active-bg)" : "#fff",
        boxShadow: next ? "var(--shadow-md)" : "none",
        opacity: full ? 0.6 : 1
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "relative",
        width: 34,
        height: 34,
        borderRadius: 99,
        background: "#E2E8F0",
        color: "#475569",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        flex: "none"
      }
    }, d.name.split(" ")[1][0], d.name.split(" ")[1][1], /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        right: -1,
        bottom: -1,
        width: 9,
        height: 9,
        borderRadius: 99,
        background: full ? "var(--status-neutral)" : "var(--status-accepted)",
        border: "2px solid #fff"
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13.5,
        fontWeight: 700,
        color: "#0f172a"
      }
    }, d.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: "#94a3b8"
      }
    }, d.spec)), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 64,
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        height: 6,
        borderRadius: 99,
        background: "#F1F5F9",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: `${d.census / d.cap * 100}%`,
        height: "100%",
        background: full ? "var(--status-rejected)" : next ? "var(--primary)" : "var(--status-accepted)"
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "#94a3b8",
        marginTop: 4,
        textAlign: "right",
        fontFamily: "var(--font-mono)"
      }
    }, d.census, "/", d.cap)), next ? /*#__PURE__*/React.createElement(StatusPill, {
      status: "active",
      label: "Next up",
      icon: "arrow-right"
    }) : full ? /*#__PURE__*/React.createElement(StatusPill, {
      status: "neutral",
      label: "At cap",
      icon: "ban"
    }) : /*#__PURE__*/React.createElement("span", {
      style: {
        width: 64
      }
    }));
  })))));
}
function Features() {
  const items = [["route", "Automatic round-robin", "Every admit routes to the next eligible hospitalist by lowest census — no phone tag, no guesswork, no favorites.", "sky"], ["bell-ring", "Notifications that land", "WebSocket → push → SMS cascade means the right provider always gets the alert, on whatever device is in their hand.", "blue"], ["messages-square", "Secure messaging", "Direct, group, and emergency-broadcast threads with delivery and read receipts — fully audited, PHI-safe.", "emerald"], ["sparkles", "AI-assisted intake", "Paste your free-text notes; DocTurn extracts structured fields and suggests the right specialty in seconds.", "amber"], ["timer", "Smart expiry & reassign", "Unanswered requests re-route automatically, so no patient ever waits on a provider who stepped away.", "rose"], ["gauge", "Fair by census", "Live census and per-provider caps keep the load balanced — the next admit goes to whoever's lightest.", "slate"]];
  const tints = {
    sky: ["#E0F2FE", "var(--sky-700)"],
    blue: ["#DBEAFE", "var(--primary)"],
    emerald: ["#D1FAE5", "#059669"],
    amber: ["#FEF3C7", "#D97706"],
    rose: ["#FFE4E6", "#E11D48"],
    slate: ["#F1F5F9", "#475569"]
  };
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#fff",
      padding: "92px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "Why DocTurn",
    title: "The whole hand-off, in one calm system",
    sub: "From ER intake to hospitalist acceptance \u2014 automated routing, alerts that actually arrive, and messaging that keeps your team in sync."
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 20,
      marginTop: 48
    },
    className: "m-feature-grid"
  }, items.map(([ic, t, d, tint], i) => /*#__PURE__*/React.createElement(Reveal, {
    key: t,
    delay: i % 3 * 80
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-card-hover",
    style: {
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-2xl)",
      padding: 24,
      height: "100%",
      background: "linear-gradient(180deg,#fff,#FBFDFF)",
      transition: "transform .25s ease, box-shadow .25s ease"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 46,
      height: 46,
      borderRadius: 13,
      background: tints[tint][0],
      color: tints[tint][1],
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 22
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#0f172a",
      margin: "16px 0 6px"
    }
  }, t), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.6,
      color: "#64748b",
      margin: 0
    }
  }, d)))))));
}
Object.assign(window, {
  HowItWorks,
  RoutingMock,
  Features
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "marketing-site/site-flow.jsx", error: String((e && e.message) || e) }); }

// marketing-site/site-hero.jsx
try { (() => {
/* DocTurn marketing site — hero + problem narrative */

function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    id: "top",
    style: {
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      paddingTop: 64,
      paddingBottom: 40,
      position: "relative",
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(Reveal, {
    as: "div",
    delay: 0
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      padding: "6px 14px",
      borderRadius: 99,
      fontSize: 13,
      fontWeight: 600,
      color: "var(--sky-700)",
      whiteSpace: "nowrap"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "activity",
    size: 14
  }), " Built for the ER \u2192 hospitalist hand-off")), /*#__PURE__*/React.createElement(Reveal, {
    delay: 60
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 62,
      lineHeight: 1.04,
      letterSpacing: "-0.035em",
      fontWeight: 700,
      color: "#0f172a",
      margin: "22px 0 0",
      maxWidth: 860,
      textWrap: "balance"
    },
    className: "m-hero-h1"
  }, "Patient hand-offs,", /*#__PURE__*/React.createElement("br", null), "without the phone tag.")), /*#__PURE__*/React.createElement(Reveal, {
    delay: 120
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 19.5,
      lineHeight: 1.55,
      color: "#475569",
      margin: "24px 0 0",
      maxWidth: 580,
      textWrap: "pretty"
    }
  }, "DocTurn routes every ER admit to the next available hospitalist by census \u2014 fair, instant, and fully tracked. The right patient reaches the right provider, on any device, every time.")), /*#__PURE__*/React.createElement(Reveal, {
    delay: 180
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginTop: 34,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(CTA, {
    icon: "arrow-right"
  }, "Get started free"), /*#__PURE__*/React.createElement(CTA, {
    variant: "secondary",
    iconLeft: "play"
  }, "Watch the 2-min demo"))), /*#__PURE__*/React.createElement(Reveal, {
    delay: 240
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 26,
      marginTop: 30,
      flexWrap: "wrap",
      color: "#64748b",
      fontSize: 13.5
    }
  }, [["zap", "Live in a day"], ["users", "Unlimited providers"], ["credit-card", "Free to start"]].map(([i, t]) => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: "flex",
      gap: 7,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: i,
    size: 15,
    color: "var(--sky-500)"
  }), t))))), /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      position: "relative",
      zIndex: 2,
      paddingBottom: 72
    }
  }, /*#__PURE__*/React.createElement(Reveal, {
    delay: 120,
    y: 28
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-float"
  }, /*#__PURE__*/React.createElement(HeroPreview, null)))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 560,
      height: 560,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(56,189,248,.22), transparent 68%)",
      top: -160,
      right: -140,
      zIndex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 480,
      height: 480,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(255,228,230,.6), transparent 68%)",
      bottom: 20,
      left: -180,
      zIndex: 1
    }
  }));
}

/* Rich assignment-queue product mockup */
function HeroPreview() {
  const nav = [["layout-dashboard", "Dashboard", true], ["inbox", "Assignments", false], ["messages-square", "Messages", false], ["users", "Directory", false]];
  const rows = [{
    init: "RM",
    room: "Rm 318",
    note: "Acute abdominal pain",
    to: "Routing…",
    st: "pending",
    stLabel: "Pending",
    ic: "clock",
    time: "0:42 left"
  }, {
    init: "SC",
    room: "Rm 412",
    note: "Chest pain — telemetry",
    to: "Dr. Chen",
    st: "accepted",
    stLabel: "Accepted",
    ic: "check",
    time: "2m ago"
  }, {
    init: "TK",
    room: "Rm 205",
    note: "Post-op observation",
    to: "Dr. Okafor",
    st: "active",
    stLabel: "Sent",
    ic: "send",
    time: "just now"
  }, {
    init: "JL",
    room: "Rm 109",
    note: "CHF exacerbation",
    to: "Dr. Reyes",
    st: "accepted",
    stLabel: "Accepted",
    ic: "check",
    time: "8m ago"
  }];
  return /*#__PURE__*/React.createElement(AppFrame, {
    maxWidth: 980
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "200px 1fr",
      minHeight: 408
    },
    className: "m-hero-grid"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#F8FAFC",
      borderRight: "1px solid var(--border)",
      padding: "16px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 4
    },
    className: "m-hero-side"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 8px 14px"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "assets/docturn-glyph.svg",
    alt: "",
    style: {
      width: 26,
      height: 26,
      borderRadius: 7
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: 15,
      color: "#0f172a"
    }
  }, "DocTurn")), nav.map(([ic, label, active]) => /*#__PURE__*/React.createElement("div", {
    key: label,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: "var(--radius-md)",
      fontSize: 13.5,
      fontWeight: active ? 600 : 500,
      color: active ? "var(--primary)" : "#64748b",
      background: active ? "#fff" : "transparent",
      boxShadow: active ? "var(--shadow-sm)" : "none"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 17
  }), label)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "8px 10px",
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      width: 30,
      height: 30,
      borderRadius: 99,
      background: "var(--sky-gradient)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      fontWeight: 700
    }
  }, "MA", /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: -1,
      bottom: -1,
      width: 9,
      height: 9,
      borderRadius: 99,
      background: "var(--status-accepted)",
      border: "2px solid #F8FAFC"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      lineHeight: 1.2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      color: "#0f172a"
    }
  }, "Dr. Alvarez"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "#94a3b8"
    }
  }, "Hospitalist")))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "18px 20px",
      background: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, "Assignment queue"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "#94a3b8",
      marginTop: 2
    }
  }, "Mercy General \xB7 4 active")), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      color: "var(--status-accepted)",
      background: "var(--status-accepted-bg)",
      padding: "5px 10px",
      borderRadius: 99
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 99,
      background: "var(--status-accepted)"
    },
    className: "m-pulse"
  }), "Live")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      marginTop: 16
    }
  }, rows.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.init + r.room,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: "11px 13px",
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 10,
      background: "#F1F5F9",
      color: "#475569",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      fontWeight: 700,
      flex: "none"
    }
  }, r.init), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, r.init, " \xB7 ", r.room)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "#64748b",
      marginTop: 2,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, r.note)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right",
      display: "flex",
      flexDirection: "column",
      gap: 5,
      alignItems: "flex-end",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(StatusPill, {
    status: r.st,
    label: r.stLabel,
    icon: r.ic
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "#94a3b8",
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, r.to !== "Routing…" && /*#__PURE__*/React.createElement("span", null, "\u2192 ", r.to), r.to === "Routing…" && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--status-pending)",
      fontWeight: 600
    }
  }, r.time), r.to !== "Routing…" && r.time))))))));
}

/* The problem — narrative storytelling */
function Problem() {
  const pains = [["phone-off", "Phone tag at 2 a.m.", "Calling down a list to find who's covering — voicemail after voicemail while a patient waits in the ER."], ["scale", "Unfair, uneven load", "No shared view of census, so the same few hospitalists get overloaded and hand-offs stall."], ["file-question", "Nothing is tracked", "Who accepted? When? On a sticky note or a text thread — impossible to audit, easy to lose."]];
  return /*#__PURE__*/React.createElement("section", {
    id: "problem",
    style: {
      background: "#fff",
      padding: "92px 0 84px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement(SectionHead, {
    center: false,
    maxW: 720,
    eyebrow: "The problem",
    title: "The 2 a.m. hand-off is held together by phone calls.",
    sub: "An ER admit means tracking down whoever's covering, hoping they pick up, and trusting that someone wrote it down. It's slow, it's uneven, and when seconds matter it's the patient who waits."
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 20,
      marginTop: 44
    },
    className: "m-feature-grid"
  }, pains.map(([ic, t, d], i) => /*#__PURE__*/React.createElement(Reveal, {
    key: t,
    delay: i * 90
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-2xl)",
      padding: 24,
      height: "100%",
      background: "linear-gradient(180deg,#fff,#FBFCFE)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 46,
      height: 46,
      borderRadius: 13,
      background: "#FEE2E2",
      color: "#DC2626",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 22
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#0f172a",
      margin: "16px 0 6px"
    }
  }, t), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.6,
      color: "#64748b",
      margin: 0
    }
  }, d))))), /*#__PURE__*/React.createElement(Reveal, {
    delay: 120
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 28,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      flexWrap: "wrap",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      color: "#334155",
      fontWeight: 500
    }
  }, "DocTurn replaces all of it with one calm, automatic queue."), /*#__PURE__*/React.createElement("a", {
    href: "#how",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 15,
      fontWeight: 600,
      color: "var(--sky-700)",
      textDecoration: "none"
    }
  }, "See how it works ", /*#__PURE__*/React.createElement(MIcon, {
    name: "arrow-down",
    size: 16
  }))))));
}
Object.assign(window, {
  Hero,
  HeroPreview,
  Problem
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "marketing-site/site-hero.jsx", error: String((e && e.message) || e) }); }

// marketing-site/site-trust.jsx
try { (() => {
/* DocTurn marketing site — product showcase, security, social proof, pricing, final CTA */

/* ---- Showcase row 1: secure messaging ---- */
function MessagingShowcase() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#fff",
      padding: "40px 0 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1.15fr",
      gap: 56,
      alignItems: "center"
    },
    className: "m-sec-grid"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionHead, {
    center: false,
    eyebrow: "Secure messaging",
    title: "Talk to the care team without leaving compliance behind",
    sub: "Every conversation \u2014 direct, group, or emergency broadcast \u2014 lives inside DocTurn with delivery and read receipts. No texting PHI on a personal phone, ever."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 13,
      marginTop: 26
    }
  }, [["check-check", "Delivery + read receipts on every message"], ["shield", "Initials-only PHI, fully audit-logged"], ["radio", "Emergency broadcast to a whole unit at once"]].map(([ic, t]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: "flex",
      gap: 11,
      alignItems: "center",
      fontSize: 14.5,
      color: "#334155"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 18,
    color: "var(--sky-600, #0284c7)"
  }), t))))), /*#__PURE__*/React.createElement(Reveal, {
    delay: 100,
    y: 24
  }, /*#__PURE__*/React.createElement(MessagingMock, null))));
}
function MessagingMock() {
  const msgs = [{
    me: false,
    who: "Dr. Chen",
    text: "Accepting SC in 412 — can you send the latest tele strip?",
    time: "2:14"
  }, {
    me: true,
    text: "Sent. BP stable, troponin pending.",
    time: "2:15"
  }, {
    me: false,
    who: "Dr. Chen",
    text: "Got it. I'll round in 10.",
    time: "2:15",
    read: true
  }];
  return /*#__PURE__*/React.createElement(AppFrame, {
    url: "app.docturn.health/messages",
    maxWidth: 520
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: 360
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "13px 16px",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      width: 36,
      height: 36,
      borderRadius: 99,
      background: "var(--sky-gradient)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      fontWeight: 700
    }
  }, "DC", /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: -1,
      bottom: -1,
      width: 10,
      height: 10,
      borderRadius: 99,
      background: "var(--status-accepted)",
      border: "2px solid #fff"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, "Dr. Chen"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--status-accepted)",
      fontWeight: 600
    }
  }, "Online")), /*#__PURE__*/React.createElement(MIcon, {
    name: "shield-check",
    size: 17,
    color: "#059669"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      background: "linear-gradient(180deg,#F8FAFC,#fff)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      fontSize: 11,
      color: "#94a3b8",
      marginBottom: 2
    }
  }, "Re: SC \xB7 Rm 412 \u2014 chest pain"), msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      justifyContent: m.me ? "flex-end" : "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "78%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: m.me ? "var(--primary)" : "#fff",
      color: m.me ? "#fff" : "#0f172a",
      border: m.me ? "none" : "1px solid var(--border)",
      borderRadius: m.me ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
      padding: "9px 13px",
      fontSize: 13.5,
      lineHeight: 1.45,
      boxShadow: "var(--shadow-sm)"
    }
  }, m.text), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      alignItems: "center",
      justifyContent: m.me ? "flex-end" : "flex-start",
      marginTop: 4,
      fontSize: 10.5,
      color: "#94a3b8"
    }
  }, m.time, m.me && /*#__PURE__*/React.createElement(MIcon, {
    name: "check-check",
    size: 13,
    color: "var(--status-accepted)"
  }), m.read && /*#__PURE__*/React.createElement("span", null, "Read")))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "12px 14px",
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 38,
      borderRadius: 99,
      border: "1px solid var(--border)",
      background: "#F8FAFC",
      display: "flex",
      alignItems: "center",
      padding: "0 14px",
      fontSize: 13,
      color: "#94a3b8"
    }
  }, "Message\u2026"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 99,
      background: "var(--sky-gradient)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "send",
    size: 16
  })))));
}

/* ---- Showcase row 2: notifications that land ---- */
function NotifyShowcase() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#fff",
      padding: "84px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "grid",
      gridTemplateColumns: "1.15fr 1fr",
      gap: 56,
      alignItems: "center"
    },
    className: "m-sec-grid m-reverse"
  }, /*#__PURE__*/React.createElement(Reveal, {
    delay: 100,
    y: 24,
    className: "m-order-2"
  }, /*#__PURE__*/React.createElement(NotifyMock, null)), /*#__PURE__*/React.createElement(Reveal, {
    className: "m-order-1"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionHead, {
    center: false,
    eyebrow: "Notifications that land",
    title: "Accept the hand-off from your lock screen",
    sub: "DocTurn cascades from in-app to push to SMS until the assigned provider responds. One tap to accept or decline \u2014 no app-opening, no PHI in the notification."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 13,
      marginTop: 26
    }
  }, [["smartphone", "Push, SMS, and in-app — whatever reaches you first"], ["timer-reset", "Auto re-routes if no response in time"], ["eye-off", "Alerts carry zero PHI — only that you have an assignment"]].map(([ic, t]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: "flex",
      gap: 11,
      alignItems: "center",
      fontSize: 14.5,
      color: "#334155"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 18,
    color: "var(--sky-600, #0284c7)"
  }), t)))))));
}
function NotifyMock() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 300,
      borderRadius: 40,
      background: "#0f172a",
      padding: 10,
      boxShadow: "var(--shadow-2xl)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 32,
      overflow: "hidden",
      background: "linear-gradient(170deg,#0c4a6e,#0369A1 45%,#0EA5E9)",
      height: 480,
      position: "relative",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 28,
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-start",
      paddingTop: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 110,
      height: 22,
      borderRadius: 99,
      background: "#0f172a"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      color: "#fff",
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      opacity: .85
    }
  }, "Tuesday, June 5"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 58,
      fontWeight: 700,
      letterSpacing: "-0.02em",
      lineHeight: 1.1
    }
  }, "2:14")), /*#__PURE__*/React.createElement("div", {
    className: "m-float",
    style: {
      margin: "auto 14px 22px",
      background: "rgba(255,255,255,.96)",
      backdropFilter: "blur(8px)",
      borderRadius: 20,
      padding: 14,
      boxShadow: "var(--shadow-2xl)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "assets/docturn-glyph-sky.svg",
    alt: "",
    style: {
      width: 22,
      height: 22,
      borderRadius: 6
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: "#475569"
    }
  }, "DOCTURN"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "#94a3b8"
    }
  }, "now")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, "New assignment \xB7 Rm 318"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#475569",
      marginTop: 3,
      lineHeight: 1.4
    }
  }, "Internal medicine admit routed to you. Respond to confirm."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 9,
      marginTop: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 38,
      borderRadius: 11,
      background: "var(--sky-gradient)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      fontSize: 13.5,
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "check",
    size: 15
  }), "Accept"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 38,
      borderRadius: 11,
      background: "#F1F5F9",
      color: "#475569",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      fontSize: 13.5,
      fontWeight: 700
    }
  }, "Decline"))))));
}

/* ---- Security deep-dive ---- */
function Security() {
  const points = ["Full HIPAA audit trail & PHI access logs", "MFA (TOTP + SMS) with backup codes", "Multi-tenant isolation by organization", "15-minute sessions, encryption in transit & at rest", "Initials-only PHI — never full names", "Role-based access control on every route"];
  return /*#__PURE__*/React.createElement("section", {
    id: "security",
    style: {
      background: "var(--marketing-bg)",
      padding: "92px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 56,
      alignItems: "center"
    },
    className: "m-sec-grid"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionHead, {
    center: false,
    eyebrow: "Security & compliance",
    title: "Built for PHI from the first line of code",
    sub: "DocTurn isn't compliant as an afterthought \u2014 tenancy, auditing, and least-privilege access are the architecture, not a checkbox."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "13px 22px",
      marginTop: 28
    }
  }, points.map(p => /*#__PURE__*/React.createElement("div", {
    key: p,
    style: {
      display: "flex",
      gap: 9,
      alignItems: "flex-start",
      fontSize: 14,
      color: "#334155",
      lineHeight: 1.45
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "shield-check",
    size: 17,
    color: "#059669",
    style: {
      marginTop: 1
    }
  }), p))))), /*#__PURE__*/React.createElement(Reveal, {
    delay: 100,
    y: 24
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: "var(--radius-2xl)",
      padding: 30,
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow-xl)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 52,
      height: 52,
      borderRadius: 15,
      background: "#D1FAE5",
      color: "#059669",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "lock-keyhole",
    size: 26
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, "HIPAA + SOC 2 Type II"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#64748b"
    }
  }, "Independently assessed, BAA included"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 22,
      display: "flex",
      flexDirection: "column",
      gap: 11
    }
  }, [["fingerprint", "Every PHI access logged", "Immutable audit trail"], ["server", "Tenant data isolated by org", "Row-level scoping"], ["bell-off", "Push payloads carry no PHI", "Safe on any device"]].map(([i, t, s]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      background: "#F8FAFC",
      borderRadius: "var(--radius-lg)",
      padding: "13px 15px",
      border: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: i,
    size: 19,
    color: "var(--sky-700)"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      color: "#0f172a"
    }
  }, t), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#94a3b8"
    }
  }, s)))))))));
}

/* ---- Social proof: stats + testimonial ---- */
function SocialProof() {
  const stats = [["< 30s", "median time to accept"], ["94%", "first-alert acceptance"], ["1 day", "to go live"], ["0", "PHI in notifications"]];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#fff",
      padding: "92px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 20,
      marginBottom: 56
    },
    className: "m-stat-grid"
  }, stats.map(([n, l], i) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      textAlign: "center",
      borderRight: i < 3 ? "1px solid var(--border)" : "none",
      padding: "4px 8px"
    },
    className: "m-stat"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 46,
      fontWeight: 700,
      letterSpacing: "-0.03em",
      background: "var(--sky-gradient)",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent"
    }
  }, n), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "#64748b",
      marginTop: 6
    }
  }, l))))), /*#__PURE__*/React.createElement(Reveal, {
    delay: 80
  }, /*#__PURE__*/React.createElement("figure", {
    style: {
      margin: 0,
      maxWidth: 860,
      marginInline: "auto",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "quote",
    size: 34,
    color: "var(--sky-400)",
    style: {
      justifyContent: "center"
    }
  }), /*#__PURE__*/React.createElement("blockquote", {
    style: {
      fontSize: 27,
      lineHeight: 1.4,
      fontWeight: 600,
      color: "#0f172a",
      letterSpacing: "-0.01em",
      margin: "16px 0 0",
      textWrap: "balance"
    }
  }, "\"We went from a whiteboard and a stack of phone calls to one queue everyone trusts. The 2 a.m. scramble is just\u2026 gone.\""), /*#__PURE__*/React.createElement("figcaption", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      marginTop: 26
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 46,
      height: 46,
      borderRadius: 99,
      background: "var(--sky-gradient)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 15,
      fontWeight: 700
    }
  }, "JM"), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, "Dr. Jordan Mercer"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "#64748b"
    }
  }, "Hospitalist lead \xB7 Mercy General")))))));
}

/* ---- Pricing ---- */
function Pricing() {
  const plans = [{
    name: "Department",
    price: "$0",
    note: "free to start",
    desc: "For a single ER or hospitalist group getting started.",
    features: ["Round-robin routing", "Push + SMS alerts", "Secure messaging", "Up to 25 providers"],
    cta: "Get started free",
    hi: false
  }, {
    name: "Hospital",
    price: "$8",
    note: "/ provider / mo",
    desc: "For a full hospital with multiple departments.",
    features: ["Everything in Department", "AI-assisted intake", "Amion schedule sync", "Custom round-robin rules", "Priority support"],
    cta: "Start free trial",
    hi: true
  }, {
    name: "Network",
    price: "Custom",
    note: "",
    desc: "For multi-hospital systems and IDNs.",
    features: ["Everything in Hospital", "Multi-tenant admin", "SSO / OIDC", "Dedicated success manager", "BAA + custom DPA"],
    cta: "Talk to sales",
    hi: false
  }];
  return /*#__PURE__*/React.createElement("section", {
    id: "pricing",
    style: {
      background: "var(--marketing-bg)",
      padding: "92px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap"
  }, /*#__PURE__*/React.createElement(Reveal, null, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "Pricing",
    title: "Simple, per-provider pricing",
    sub: "Start free. Upgrade when your whole hospital is on board \u2014 no per-message fees, no surprises."
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 20,
      marginTop: 48,
      alignItems: "stretch"
    },
    className: "m-price-grid"
  }, plans.map((p, i) => /*#__PURE__*/React.createElement(Reveal, {
    key: p.name,
    delay: i * 90
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: "var(--radius-2xl)",
      padding: 28,
      height: "100%",
      border: p.hi ? "2px solid var(--primary)" : "1px solid var(--border)",
      boxShadow: p.hi ? "var(--shadow-xl)" : "var(--shadow-sm)",
      position: "relative",
      display: "flex",
      flexDirection: "column"
    }
  }, p.hi && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: -12,
      left: 28,
      background: "var(--sky-gradient)",
      color: "#fff",
      fontSize: 12,
      fontWeight: 700,
      padding: "4px 12px",
      borderRadius: 99,
      boxShadow: "var(--shadow-glow)",
      whiteSpace: "nowrap"
    }
  }, "Most popular"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 6,
      margin: "12px 0 4px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 42,
      fontWeight: 700,
      color: "#0f172a",
      letterSpacing: "-0.02em"
    }
  }, p.price), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "#64748b"
    }
  }, p.note)), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      color: "#64748b",
      margin: "0 0 18px",
      lineHeight: 1.5
    }
  }, p.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 11,
      flex: 1
    }
  }, p.features.map(f => /*#__PURE__*/React.createElement("div", {
    key: f,
    style: {
      display: "flex",
      gap: 9,
      alignItems: "center",
      fontSize: 13.5,
      color: "#334155"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "check",
    size: 16,
    color: "#059669"
  }), f))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement(CTA, {
    variant: p.hi ? "primary" : "secondary",
    size: "sm",
    full: true
  }, p.cta))))))));
}

/* ---- Final CTA ---- */
function FinalCTA() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#fff",
      padding: "84px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap"
  }, /*#__PURE__*/React.createElement(Reveal, {
    y: 24
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#0EA5E9,#0369A1)",
      borderRadius: "var(--radius-2xl)",
      padding: "60px 40px",
      textAlign: "center",
      position: "relative",
      overflow: "hidden",
      boxShadow: "var(--shadow-2xl)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 360,
      height: 360,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(56,189,248,.5), transparent 70%)",
      top: -120,
      right: -80
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 42,
      fontWeight: 700,
      color: "#fff",
      margin: 0,
      letterSpacing: "-0.025em",
      textWrap: "balance"
    }
  }, "Get your ER and hospitalists in sync."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 17.5,
      color: "rgba(255,255,255,.88)",
      margin: "16px auto 0",
      maxWidth: 500
    }
  }, "Set up DocTurn for your hospital in under a day \u2014 no IT project required."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      justifyContent: "center",
      marginTop: 32,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      height: 52,
      padding: "0 30px",
      borderRadius: "var(--radius-md)",
      border: "none",
      background: "#fff",
      color: "var(--sky-700)",
      fontSize: 16,
      fontWeight: 700,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: 9
    }
  }, "Get started free ", /*#__PURE__*/React.createElement(MIcon, {
    name: "arrow-right",
    size: 18
  })), /*#__PURE__*/React.createElement("button", {
    style: {
      height: 52,
      padding: "0 26px",
      borderRadius: "var(--radius-md)",
      border: "1px solid rgba(255,255,255,.55)",
      background: "transparent",
      color: "#fff",
      fontSize: 16,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, "Book a demo")))))));
}
Object.assign(window, {
  MessagingShowcase,
  NotifyShowcase,
  Security,
  SocialProof,
  Pricing,
  FinalCTA
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "marketing-site/site-trust.jsx", error: String((e && e.message) || e) }); }

// pitch-deck/deck-stage.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
/* BEGIN USAGE */
/**
 * <deck-stage> — reusable web component for HTML decks.
 *
 * Handles:
 *  (a) speaker notes — reads <script type="application/json" id="speaker-notes">
 *      and posts {slideIndexChanged: N} to the parent window on nav.
 *  (b) keyboard navigation — ←/→, PgUp/PgDn, Space, Home/End, number keys.
 *      On touch devices, tapping the left/right half of the stage goes
 *      prev/next — taps on links, buttons and other interactive slide
 *      content are left alone.
 *  (c) press R to reset to slide 0 (with a tasteful keyboard hint).
 *  (d) bottom-center overlay showing slide count + hints, fades out on idle.
 *  (e) auto-scaling — inner canvas is a fixed design size (default 1920×1080)
 *      scaled with `transform: scale()` to fit the viewport, letterboxed.
 *      Set the `noscale` attribute to render at authored size (1:1) — the
 *      PPTX exporter sets this so its DOM capture sees unscaled geometry.
 *  (f) print — `@media print` lays every slide out as its own page at the
 *      design size, so the browser's Print → Save as PDF produces a clean
 *      one-page-per-slide PDF with no extra setup.
 *  (g) thumbnail rail — resizable left-hand column of per-slide thumbnails
 *      (static clones). Click to navigate; ↑/↓ with a thumbnail focused to
 *      step between slides; drag to reorder; right-click for
 *      Skip / Move up / Move down / Duplicate / Delete (Delete opens a
 *      Cancel/Delete confirm dialog). Drag the rail's right edge to resize;
 *      width persists to
 *      localStorage. Skipped slides carry `data-deck-skip`, are dimmed in
 *      the rail, omitted from prev/next navigation, and hidden at print.
 *      The rail is suppressed in presenting mode, in the host's Preview
 *      mode (ViewerMode='none'), on `noscale`, on narrow viewports
 *      (≤640px), and via the `no-rail` attribute. Rail mutations dispatch
 *      a `deckchange`
 *      CustomEvent on the element: detail = {action, from, to, slide}.
 *
 * Slides are HIDDEN, not unmounted. Non-active slides stay in the DOM with
 * `visibility: hidden` + `opacity: 0`, so their state (videos, iframes,
 * form inputs, React trees) is preserved across navigation.
 *
 * Lifecycle event — the component dispatches a `slidechange` CustomEvent on
 * itself whenever the active slide changes (including the initial mount).
 * The event bubbles and composes out of shadow DOM, so you can listen on
 * the <deck-stage> element or on document:
 *
 *   document.querySelector('deck-stage').addEventListener('slidechange', (e) => {
 *     e.detail.index         // new 0-based index
 *     e.detail.previousIndex // previous index, or -1 on init
 *     e.detail.total         // total slide count
 *     e.detail.slide         // the new active slide element
 *     e.detail.previousSlide // the prior slide element, or null on init
 *     e.detail.reason        // 'init' | 'keyboard' | 'click' | 'tap' | 'api'
 *   });
 *
 * Persistence: none at the deck level. The host app keeps the current slide
 * in its own URL (?slide=) and re-delivers it via location.hash on load, so a
 * bare load with no hash always starts at slide 1.
 *
 * Usage:
 *   <style>deck-stage:not(:defined){visibility:hidden}</style>
 *   <deck-stage width="1920" height="1080">
 *     <section data-label="Title">...</section>
 *     <section data-label="Agenda">...</section>
 *   </deck-stage>
 *   <script src="deck-stage.js"></script>
 *
 * The :not(:defined) rule prevents a flash of the first slide at its
 * authored styles before this script runs and attaches the shadow root.
 *
 * Slides are the direct element children of <deck-stage>. Each slide is
 * automatically tagged with:
 *   - data-screen-label="NN Label"   (1-indexed, for comment flow)
 *   - data-om-validate="no_overflowing_text,no_overlapping_text,slide_sized_text"
 *
 * Speaker notes stay in sync because the component posts {slideIndexChanged: N}
 * to the parent — just include the #speaker-notes script tag if asked for notes.
 *
 * Authoring guidance:
 *   - Write slide bodies as static HTML inside <deck-stage>, with sizing via
 *     CSS custom properties in a <style> block rather than JS constants.
 *     Static slide markup is what lets the user click a heading in edit mode
 *     and retype it directly; a slide rendered through <script type="text/babel">,
 *     React, or a loop over a JS array has to round-trip every tweak through a
 *     chat message instead. Reach for script-generated slides only when the
 *     content genuinely needs interactive behaviour static HTML can't express.
 *   - Do NOT set position/inset/width/height on the slide <section> elements —
 *     the component absolutely positions every slotted child for you.
 *   - Entrance animations: make the visible end-state the base style and
 *     animate *from* hidden, so print and reduced-motion show content.
 *     Gate the animation on [data-deck-active] and the motion query, e.g.
 *     `@media (prefers-reduced-motion:no-preference){ [data-deck-active] .x{animation:fade-in .5s both} }`.
 *     Avoid infinite decorative loops on slide content.
 */
/* END USAGE */

(() => {
  const DESIGN_W_DEFAULT = 1920;
  const DESIGN_H_DEFAULT = 1080;
  const OVERLAY_HIDE_MS = 1800;
  const VALIDATE_ATTR = 'no_overflowing_text,no_overlapping_text,slide_sized_text';
  const FINE_POINTER_MQ = matchMedia('(hover: hover) and (pointer: fine)');
  const NARROW_MQ = matchMedia('(max-width: 640px)');
  // Slide-authored controls that should keep a tap instead of it navigating.
  const INTERACTIVE_SEL = 'a[href], button, input, select, textarea, summary, label, video[controls], audio[controls], [role="button"], [onclick], [tabindex]:not([tabindex^="-"]), [contenteditable]:not([contenteditable="false" i])';
  const pad2 = n => String(n).padStart(2, '0');

  // Label precedence: data-label → data-screen-label (number stripped) → first heading → "Slide".
  const getSlideLabel = el => {
    const explicit = el.getAttribute('data-label');
    if (explicit) return explicit;
    const existing = el.getAttribute('data-screen-label');
    if (existing) return existing.replace(/^\s*\d+\s*/, '').trim() || existing;
    const h = el.querySelector('h1, h2, h3, [data-title]');
    const t = h && (h.textContent || '').trim().slice(0, 40);
    if (t) return t;
    return 'Slide';
  };
  const stylesheet = `
    :host {
      position: fixed;
      inset: 0;
      display: block;
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
      overflow: hidden;
      -webkit-tap-highlight-color: transparent;
    }
    /* connectedCallback holds this until document.fonts.ready (capped 2s) so
     * the first visible paint has the deck's real typography + final rail
     * layout. opacity (not visibility) so the active slide can't un-hide
     * itself via the ::slotted([data-deck-active]) visibility:visible rule.
     * Only the stage/rail hide — the black :host background stays, so the
     * iframe doesn't flash the page's default white. */
    :host([data-fonts-pending]) .stage,
    :host([data-fonts-pending]) .rail { opacity: 0; pointer-events: none; }

    .stage {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .canvas {
      position: relative;
      transform-origin: center center;
      flex-shrink: 0;
      background: #fff;
      will-change: transform;
    }

    /* Slides live in light DOM (via <slot>) so authored CSS still applies.
       We absolutely position each slotted child to stack them. */
    ::slotted(*) {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      box-sizing: border-box !important;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
    }
    ::slotted([data-deck-active]) {
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
    }

    .overlay {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translate(-50%, 6px) scale(0.92);
      filter: blur(6px);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: #000;
      color: #fff;
      border-radius: 999px;
      font-size: 12px;
      font-feature-settings: "tnum" 1;
      letter-spacing: 0.01em;
      opacity: 0;
      pointer-events: none;
      transition: opacity 260ms ease, transform 260ms cubic-bezier(.2,.8,.2,1), filter 260ms ease;
      transform-origin: center bottom;
      z-index: 2147483000;
      user-select: none;
    }
    .overlay[data-visible] {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, 0) scale(1);
      filter: blur(0);
    }

    .btn {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      margin: 0;
      padding: 0;
      color: inherit;
      font: inherit;
      cursor: default;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 28px;
      min-width: 28px;
      border-radius: 999px;
      color: rgba(255,255,255,0.72);
      transition: background 140ms ease, color 140ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .btn:active { background: rgba(255,255,255,0.18); }
    .btn:focus { outline: none; }
    .btn:focus-visible { outline: none; }
    .btn::-moz-focus-inner { border: 0; }
    .btn svg { width: 14px; height: 14px; display: block; }
    .btn.reset {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      padding: 0 10px 0 12px;
      gap: 6px;
      color: rgba(255,255,255,0.72);
    }
    .btn.reset .kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 10px;
      line-height: 1;
      color: rgba(255,255,255,0.88);
      background: rgba(255,255,255,0.12);
      border-radius: 4px;
    }

    .count {
      font-variant-numeric: tabular-nums;
      color: #fff;
      font-weight: 500;
      padding: 0 8px;
      min-width: 42px;
      text-align: center;
      font-size: 12px;
    }
    .count .sep { color: rgba(255,255,255,0.45); margin: 0 3px; font-weight: 400; }
    .count .total { color: rgba(255,255,255,0.55); }

    .divider {
      width: 1px;
      height: 14px;
      background: rgba(255,255,255,0.18);
      margin: 0 2px;
    }

    /* ── Thumbnail rail ──────────────────────────────────────────────────
       Fixed column on the left; each thumbnail is a static deep-clone of
       the light-DOM slide scaled into a 16:9 (or design-aspect) frame. The
       stage re-fits around it (see _fit); hidden during present / noscale
       / print so capture geometry and fullscreen output are unchanged. */
    .rail {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--deck-rail-w, 188px);
      background: #141414;
      border-right: 1px solid rgba(255,255,255,0.08);
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px 10px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 2147482500;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.18) transparent;
    }
    .rail::-webkit-scrollbar { width: 8px; }
    .rail::-webkit-scrollbar-track { background: transparent; margin: 2px; }
    .rail::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.18);
      border-radius: 4px;
      border: 2px solid transparent;
      background-clip: content-box;
    }
    .rail::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.28);
      border: 2px solid transparent;
      background-clip: content-box;
    }
    :host([no-rail]) .rail,
    :host([noscale]) .rail { display: none; }
    .rail[data-presenting] { display: none; }
    @media (max-width: 640px) {
      .rail, .rail-resize { display: none; }
    }
    /* User-driven show/hide (the TweaksPanel toggle) slides instead of
       popping. Transitions are gated on :host([data-rail-anim]) — set only
       for the 200ms around the toggle — so window-resize and rail-width
       drag (which also call _fit) don't lag behind the cursor. */
    .rail[data-user-hidden] { transform: translateX(-100%); }
    :host([data-rail-anim]) .rail { transition: transform 200ms cubic-bezier(.3,.7,.4,1); }
    :host([data-rail-anim]) .stage { transition: left 200ms cubic-bezier(.3,.7,.4,1); }
    :host([data-rail-anim]) .canvas { transition: transform 200ms cubic-bezier(.3,.7,.4,1); }
    /* transition shorthand replaces rather than merges — repeat the base
       .overlay opacity/transform/filter transitions so visibility changes
       during the 200ms toggle window still fade instead of popping. */
    :host([data-rail-anim]) .overlay {
      transition: margin-left 200ms cubic-bezier(.3,.7,.4,1),
                  opacity 260ms ease,
                  transform 260ms cubic-bezier(.2,.8,.2,1),
                  filter 260ms ease;
    }

    .thumb {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .thumb .num {
      width: 16px;
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 500;
      text-align: right;
      color: rgba(255,255,255,0.55);
      padding-top: 2px;
      font-variant-numeric: tabular-nums;
    }
    .thumb .frame {
      position: relative;
      flex: 1;
      min-width: 0;
      aspect-ratio: var(--deck-aspect);
      background: #fff;
      border-radius: 4px;
      outline: 2px solid transparent;
      outline-offset: 0;
      overflow: hidden;
      transition: outline-color 120ms ease;
    }
    .thumb:hover .frame { outline-color: rgba(255,255,255,0.25); }
    .thumb { outline: none; }
    .thumb:focus-visible .frame { outline-color: rgba(255,255,255,0.5); }
    .thumb[data-current] .num { color: #fff; }
    .thumb[data-current] .frame { outline-color: #D97757; }
    .thumb[data-dragging] { opacity: 0.35; }
    .thumb::before {
      content: '';
      position: absolute;
      left: 24px;
      right: 0;
      height: 3px;
      border-radius: 2px;
      background: #D97757;
      opacity: 0;
      pointer-events: none;
    }
    .thumb[data-drop="before"]::before { top: -8px; opacity: 1; }
    .thumb[data-drop="after"]::before { bottom: -8px; opacity: 1; }
    .thumb[data-skip] .frame { opacity: 0.35; }
    .thumb[data-skip] .frame::after {
      content: 'Skipped';
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.45);
      color: #fff;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.04em;
    }

    .ctxmenu {
      position: fixed;
      min-width: 150px;
      padding: 4px;
      background: #242424;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 7px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      z-index: 2147483100;
      display: none;
      font-size: 12px;
    }
    .ctxmenu[data-open] { display: block; }
    .ctxmenu button {
      display: block;
      width: 100%;
      appearance: none;
      border: 0;
      background: transparent;
      color: #e8e8e8;
      font: inherit;
      text-align: left;
      padding: 6px 10px;
      border-radius: 4px;
      cursor: pointer;
    }
    .ctxmenu button:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
    .ctxmenu button:disabled { opacity: 0.35; cursor: default; }
    .ctxmenu hr {
      border: 0;
      border-top: 1px solid rgba(255,255,255,0.1);
      margin: 4px 2px;
    }

    .rail-resize {
      position: fixed;
      left: calc(var(--deck-rail-w, 188px) - 3px);
      top: 0;
      bottom: 0;
      width: 6px;
      cursor: col-resize;
      z-index: 2147482600;
      touch-action: none;
    }
    .rail-resize:hover,
    .rail-resize[data-dragging] { background: rgba(255,255,255,0.12); }
    :host([no-rail]) .rail-resize,
    :host([noscale]) .rail-resize,
    .rail[data-presenting] + .rail-resize,
    .rail[data-user-hidden] + .rail-resize { display: none; }

    /* Delete-confirm popup — matches the SPA's ConfirmDialog layout
       (title + message body, depressed footer with Cancel / Delete). */
    .confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 2147483200;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .confirm-backdrop[data-open] { display: flex; }
    .confirm {
      width: 320px;
      max-width: calc(100vw - 32px);
      background: #2a2a2a;
      color: #e8e8e8;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
      overflow: hidden;
      font-family: inherit;
      animation: deck-confirm-in 0.18s ease;
    }
    @keyframes deck-confirm-in {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }
    .confirm .body { padding: 20px 20px 16px; }
    .confirm .title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .confirm .msg { font-size: 13px; line-height: 1.5; color: rgba(255,255,255,0.65); }
    .confirm .footer {
      padding: 14px 20px;
      background: #1f1f1f;
      border-top: 1px solid rgba(255,255,255,0.08);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .confirm button {
      appearance: none;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
    }
    .confirm .cancel {
      background: transparent;
      border: 0;
      color: rgba(255,255,255,0.8);
    }
    .confirm .cancel:hover { background: rgba(255,255,255,0.08); }
    .confirm .danger {
      background: #c96442;
      border: 1px solid rgba(0,0,0,0.15);
      color: #fff;
      box-shadow: 0 1px 3px rgba(166,50,68,0.3), 0 2px 6px rgba(166,50,68,0.18);
    }
    .confirm .danger:hover { background: #b5563a; }

    /* ── Print: one page per slide, no chrome ────────────────────────────
       The screen layout stacks every slide at inset:0 inside a scaled
       canvas; for print we want them in document flow at the authored
       design size so the browser paginates one slide per sheet. The
       @page size is set from the width/height attributes via the inline
       <style id="deck-stage-print-page"> that connectedCallback injects
       into <head> (the @page at-rule has no effect inside shadow DOM). */
    @media print {
      :host {
        position: static;
        inset: auto;
        background: none;
        overflow: visible;
        color: inherit;
      }
      .stage { position: static; display: block; }
      .canvas {
        transform: none !important;
        width: auto !important;
        height: auto !important;
        background: none;
        will-change: auto;
      }
      ::slotted(*) {
        position: relative !important;
        inset: auto !important;
        width: var(--deck-design-w) !important;
        height: var(--deck-design-h) !important;
        box-sizing: border-box !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto;
        break-after: page;
        page-break-after: always;
        break-inside: avoid;
        overflow: hidden;
      }
      /* :last-child alone isn't enough once data-deck-skip hides the
         trailing slide(s) — the last *visible* slide still carries
         break-after:page and prints a blank sheet. _markLastVisible()
         maintains data-deck-last-visible on the last non-skipped slide. */
      ::slotted(*:last-child),
      ::slotted([data-deck-last-visible]) {
        break-after: auto;
        page-break-after: auto;
      }
      ::slotted([data-deck-skip]) { display: none !important; }
      .overlay, .rail, .rail-resize, .ctxmenu, .confirm-backdrop { display: none !important; }
    }
  `;
  class DeckStage extends HTMLElement {
    static get observedAttributes() {
      return ['width', 'height', 'noscale', 'no-rail'];
    }
    constructor() {
      super();
      this._root = this.attachShadow({
        mode: 'open'
      });
      this._index = 0;
      this._slides = [];
      this._notes = [];
      this._hideTimer = null;
      this._mouseIdleTimer = null;
      this._menuIndex = -1;
      this._onKey = this._onKey.bind(this);
      this._onResize = this._onResize.bind(this);
      this._onSlotChange = this._onSlotChange.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onTap = this._onTap.bind(this);
      this._onMessage = this._onMessage.bind(this);
      // Capture-phase close so a click anywhere dismisses the menu, but
      // ignore clicks that land inside the menu itself — otherwise the
      // capture handler runs before the menu's own (bubble) handler and
      // clears _menuIndex out from under it.
      this._onDocClick = e => {
        if (this._menu && e.composedPath && e.composedPath().includes(this._menu)) return;
        this._closeMenu();
      };
    }
    get designWidth() {
      return parseInt(this.getAttribute('width'), 10) || DESIGN_W_DEFAULT;
    }
    get designHeight() {
      return parseInt(this.getAttribute('height'), 10) || DESIGN_H_DEFAULT;
    }
    connectedCallback() {
      // Presenter-view popup loads deckUrl?_snthumb=...#N for its prev/cur/
      // next thumbnails — the rail has no business rendering inside those
      // (wrong scale, and it offsets the stage so the thumb shows a gutter).
      if (/[?&]_snthumb=/.test(location.search)) this.setAttribute('no-rail', '');
      this._render();
      this._loadNotes();
      this._syncPrintPageRule();
      window.addEventListener('keydown', this._onKey);
      window.addEventListener('resize', this._onResize);
      window.addEventListener('mousemove', this._onMouseMove, {
        passive: true
      });
      window.addEventListener('message', this._onMessage);
      window.addEventListener('click', this._onDocClick, true);
      this.addEventListener('click', this._onTap);
      // Print lays every slide out as its own page, so [data-deck-active]-
      // gated entrance styles need the attribute on every slide (not just
      // the current one) or their content prints at the hidden base style.
      // The transient freeze style lands BEFORE the attributes so any
      // attribute-keyed transition fires at 0s (changing transition-
      // duration after a transition has started doesn't affect it).
      this._onBeforePrint = () => {
        if (this._freezeStyle) this._freezeStyle.remove();
        this._freezeStyle = document.createElement('style');
        this._freezeStyle.textContent = '*,*::before,*::after{transition-duration:0s !important}';
        document.head.appendChild(this._freezeStyle);
        this._slides.forEach(s => s.setAttribute('data-deck-active', ''));
      };
      this._onAfterPrint = () => {
        this._applyIndex({
          showOverlay: false,
          broadcast: false
        });
        if (this._freezeStyle) {
          this._freezeStyle.remove();
          this._freezeStyle = null;
        }
      };
      window.addEventListener('beforeprint', this._onBeforePrint);
      window.addEventListener('afterprint', this._onAfterPrint);
      // Initial collection + layout happens via slotchange, which fires on mount.
      this._enableRail();
      // Hold the stage hidden until webfonts are ready so the first visible
      // paint has the deck's real typography — the :not(:defined) guard in
      // the page HTML only covers custom-element upgrade, not font load.
      // Capped so a 404'd font URL can't blank the deck indefinitely.
      this.setAttribute('data-fonts-pending', '');
      const reveal = () => this.removeAttribute('data-fonts-pending');
      // rAF first: fonts.ready is a pre-resolved promise until layout has
      // resolved the slotted text's font-family and pushed a FontFace into
      // 'loading'. Reading it here in connectedCallback (parse-time) would
      // settle the race in a microtask before any font fetch starts.
      requestAnimationFrame(() => {
        Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 2000))]).then(reveal, reveal);
      });
    }
    _enableRail() {
      // Idempotent — older host builds still post __omelette_rail_enabled.
      // no-rail guard keeps the observers/stylesheet walk off the cheap path
      // for presenter-popup thumbnail iframes (up to 9 per view).
      if (this._railEnabled || this.hasAttribute('no-rail')) return;
      this._railEnabled = true;
      // Per-viewer preference — restored alongside rail width. Default on;
      // only a stored '0' (from the TweaksPanel toggle) hides it.
      this._railVisible = true;
      try {
        if (localStorage.getItem('deck-stage.railVisible') === '0') this._railVisible = false;
      } catch (e) {}
      // Live thumbnail updates: watch the light-DOM slides for content
      // edits and re-clone just the affected thumb(s), debounced. Ignore
      // the data-deck-* / data-screen-label / data-om-validate attributes
      // this component itself writes so nav and skip don't trigger
      // spurious refreshes.
      const OWN_ATTRS = /^data-(deck-|screen-label$|om-validate$)/;
      this._liveDirty = new Set();
      this._liveObserver = new MutationObserver(records => {
        for (const r of records) {
          if (r.type === 'attributes' && OWN_ATTRS.test(r.attributeName || '')) continue;
          let n = r.target;
          while (n && n.parentElement !== this) n = n.parentElement;
          if (n && this._slideSet && this._slideSet.has(n)) this._liveDirty.add(n);
        }
        if (this._liveDirty.size && !this._liveTimer) {
          this._liveTimer = setTimeout(() => {
            this._liveTimer = null;
            this._liveDirty.forEach(s => this._refreshThumb(s));
            this._liveDirty.clear();
          }, 200);
        }
      });
      this._liveObserver.observe(this, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
      // Lazy thumbnail materialization — clone the slide only when its
      // frame scrolls into (or near) the rail viewport. rootMargin gives
      // ~4 thumbs of pre-load so fast scrolling doesn't flash blanks.
      this._railObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting && e.target.__deckThumb) {
            this._materialize(e.target.__deckThumb);
          }
        });
      }, {
        root: this._rail,
        rootMargin: '400px 0px'
      });
      // Tweaks typically change CSS vars / attrs OUTSIDE <deck-stage>
      // (on <html>, <body>, a wrapper div, or a <style> tag), which
      // _liveObserver can't see. Re-snapshot author CSS (constructable
      // sheet is shared by reference, so one replaceSync updates every
      // thumb shadow root) and re-sync each thumb host's attrs + custom
      // properties. In-slide DOM mutations are _liveObserver's job.
      // Debounced so slider drags don't thrash.
      this._onTweakChange = () => {
        clearTimeout(this._tweakTimer);
        this._tweakTimer = setTimeout(() => {
          this._snapshotAuthorCss();
          // One getComputedStyle for the whole batch — each
          // getPropertyValue read below reuses the same computed style
          // as long as nothing invalidates layout between thumbs.
          const cs = getComputedStyle(this);
          (this._thumbs || []).forEach(t => {
            if (t.host) this._syncThumbHostAttrs(t.host, cs);
          });
        }, 120);
      };
      window.addEventListener('tweakchange', this._onTweakChange);
      this._snapshotAuthorCss();
      // Build the rail now that it's enabled — slotchange already fired,
      // so _renderRail's early-return skipped the initial build.
      this._syncRailHidden();
      this._renderRail();
      this._fit();
    }

    /** Snapshot document stylesheets into a constructable sheet that each
     *  thumbnail's nested shadow root adopts — so author CSS styles the
     *  cloned slide content without touching this component's chrome.
     *  Cross-origin sheets throw on .cssRules — skip them. Re-callable:
     *  the existing constructable sheet is reused via replaceSync so every
     *  already-adopted shadow root picks up the fresh CSS without re-adopt. */
    _snapshotAuthorCss() {
      // :root in an adopted sheet inside a shadow root matches nothing
      // (only the document root qualifies), so author rules like
      // `:root[data-voice="modern"] .serif` never reach the clones.
      // Rewrite :root → :host and mirror <html>'s data-*/class/lang onto
      // each thumb host (see _syncThumbHostAttrs) so the same selectors
      // match inside the thumbnail's shadow tree.
      const authorCss = Array.from(document.styleSheets).map(sh => {
        try {
          return Array.from(sh.cssRules).map(r => r.cssText).join('\n');
        } catch (e) {
          return '';
        }
      }).join('\n')
      // The shadow host is featureless outside the functional :host(...)
      // form, so any compound on :root — [attr], .class, #id, :pseudo —
      // must become :host(<compound>) not :host<compound>. Same for the
      // html type selector (Tailwind class-strategy dark mode emits
      // html.dark; Pico uses html[data-theme]), which has nothing to
      // match inside the thumb's shadow tree.
      .replace(/:root((?:\[[^\]]*\]|[.#][-\w]+|:[-\w]+(?:\([^)]*\))?)+)/g, ':host($1)').replace(/:root\b/g, ':host').replace(/(^|[\s,>~+(}])html((?:\[[^\]]*\]|[.#][-\w]+|:[-\w]+(?:\([^)]*\))?)+)(?![-\w])/g, '$1:host($2)').replace(/(^|[\s,>~+(}])html(?![-\w])/g, '$1:host');
      // Every custom property the author references. _syncThumbHostAttrs
      // mirrors each one's *computed* value at <deck-stage> onto the
      // thumb host so the live value wins over the :host default above
      // regardless of which ancestor the tweak wrote to (<html>, <body>,
      // a wrapper div, or the deck-stage element itself all inherit
      // down to getComputedStyle(this)).
      this._authorVars = new Set(authorCss.match(/--[\w-]+/g) || []);
      try {
        if (!this._adoptedSheet) this._adoptedSheet = new CSSStyleSheet();
        this._adoptedSheet.replaceSync(authorCss);
      } catch (e) {
        this._adoptedSheet = null;
        this._authorCss = authorCss;
      }
    }
    _syncThumbHostAttrs(host, cs) {
      const de = document.documentElement;
      // setAttribute overwrites but can't delete — an attr removed from
      // <html> (toggleAttribute off, classList emptied) would linger on
      // the host and :host([data-*]) / :host(.foo) rules would keep
      // matching. Remove stale mirrored attrs first; iterate backward
      // because removeAttribute mutates the live NamedNodeMap.
      for (let i = host.attributes.length - 1; i >= 0; i--) {
        const n = host.attributes[i].name;
        if ((n.startsWith('data-') || n === 'class' || n === 'lang') && !de.hasAttribute(n)) {
          host.removeAttribute(n);
        }
      }
      for (const a of de.attributes) {
        if (a.name.startsWith('data-') || a.name === 'class' || a.name === 'lang') {
          host.setAttribute(a.name, a.value);
        }
      }
      // The :root→:host rewrite in _snapshotAuthorCss pins each custom
      // property to its stylesheet default on the thumb host, shadowing
      // the live value that would otherwise inherit. Tweaks can write the
      // live value on any ancestor — <html>, <body>, a wrapper div, the
      // deck-stage element — so read it as the *computed* value at
      // <deck-stage> (which sees the whole inheritance chain) rather than
      // trying to guess which element the author wrote to. Inline on the
      // host beats the :host{} rule. remove-stale covers vars dropped
      // from the stylesheet between snapshots.
      const vars = this._authorVars || new Set();
      for (let i = host.style.length - 1; i >= 0; i--) {
        const p = host.style[i];
        if (p.startsWith('--') && !vars.has(p)) host.style.removeProperty(p);
      }
      const live = cs || getComputedStyle(this);
      vars.forEach(p => {
        const v = live.getPropertyValue(p);
        if (v) host.style.setProperty(p, v.trim());else host.style.removeProperty(p);
      });
    }
    disconnectedCallback() {
      window.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('message', this._onMessage);
      window.removeEventListener('click', this._onDocClick, true);
      window.removeEventListener('beforeprint', this._onBeforePrint);
      window.removeEventListener('afterprint', this._onAfterPrint);
      if (this._freezeStyle) {
        this._freezeStyle.remove();
        this._freezeStyle = null;
      }
      this.removeEventListener('click', this._onTap);
      if (this._hideTimer) clearTimeout(this._hideTimer);
      if (this._mouseIdleTimer) clearTimeout(this._mouseIdleTimer);
      if (this._liveTimer) clearTimeout(this._liveTimer);
      if (this._tweakTimer) clearTimeout(this._tweakTimer);
      if (this._railAnimTimer) clearTimeout(this._railAnimTimer);
      if (this._scaleRaf) cancelAnimationFrame(this._scaleRaf);
      if (this._liveObserver) this._liveObserver.disconnect();
      if (this._railObserver) this._railObserver.disconnect();
      if (this._onTweakChange) window.removeEventListener('tweakchange', this._onTweakChange);
    }
    attributeChangedCallback() {
      if (this._canvas) {
        this._canvas.style.width = this.designWidth + 'px';
        this._canvas.style.height = this.designHeight + 'px';
        this._canvas.style.setProperty('--deck-design-w', this.designWidth + 'px');
        this._canvas.style.setProperty('--deck-design-h', this.designHeight + 'px');
        if (this._rail) {
          this._rail.style.setProperty('--deck-aspect', this.designWidth + '/' + this.designHeight);
        }
        this._fit();
        this._scaleThumbs();
        this._syncPrintPageRule();
      }
    }
    _render() {
      const style = document.createElement('style');
      style.textContent = stylesheet;
      const stage = document.createElement('div');
      stage.className = 'stage';
      const canvas = document.createElement('div');
      canvas.className = 'canvas';
      canvas.style.width = this.designWidth + 'px';
      canvas.style.height = this.designHeight + 'px';
      canvas.style.setProperty('--deck-design-w', this.designWidth + 'px');
      canvas.style.setProperty('--deck-design-h', this.designHeight + 'px');
      const slot = document.createElement('slot');
      slot.addEventListener('slotchange', this._onSlotChange);
      canvas.appendChild(slot);
      stage.appendChild(canvas);

      // Overlay: compact, solid black, with clickable controls.
      const overlay = document.createElement('div');
      overlay.className = 'overlay export-hidden';
      overlay.setAttribute('role', 'toolbar');
      overlay.setAttribute('aria-label', 'Deck controls');
      overlay.setAttribute('data-omelette-chrome', '');
      overlay.innerHTML = `
        <button class="btn prev" type="button" aria-label="Previous slide" title="Previous (←)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>
        </button>
        <span class="count" aria-live="polite"><span class="current">1</span><span class="sep">/</span><span class="total">1</span></span>
        <button class="btn next" type="button" aria-label="Next slide" title="Next (→)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>
        </button>
        <span class="divider"></span>
        <button class="btn reset" type="button" aria-label="Reset to first slide" title="Reset (R)">Reset<span class="kbd">R</span></button>
      `;
      overlay.querySelector('.prev').addEventListener('click', () => this._advance(-1, 'click'));
      overlay.querySelector('.next').addEventListener('click', () => this._advance(1, 'click'));
      overlay.querySelector('.reset').addEventListener('click', () => this._go(0, 'click'));

      // Thumbnail rail + context menu. Thumbnails are populated in
      // _renderRail() after _collectSlides().
      const rail = document.createElement('div');
      rail.className = 'rail export-hidden';
      rail.setAttribute('data-omelette-chrome', '');
      rail.style.setProperty('--deck-aspect', this.designWidth + '/' + this.designHeight);
      // Edge auto-scroll while dragging a thumb near the rail's top/bottom
      // so off-screen drop targets are reachable. Native dragover fires
      // continuously while the pointer is stationary, so a per-event nudge
      // (ramped by edge proximity) is enough — no rAF loop needed.
      rail.addEventListener('dragover', e => {
        if (this._dragFrom == null) return;
        const r = rail.getBoundingClientRect();
        const EDGE = 40;
        const dt = e.clientY - r.top;
        const db = r.bottom - e.clientY;
        if (dt < EDGE) rail.scrollTop -= Math.ceil((EDGE - dt) / 3);else if (db < EDGE) rail.scrollTop += Math.ceil((EDGE - db) / 3);
      });
      const menu = document.createElement('div');
      menu.className = 'ctxmenu export-hidden';
      menu.setAttribute('data-omelette-chrome', '');
      menu.innerHTML = `
        <button type="button" data-act="skip">Skip slide</button>
        <button type="button" data-act="up">Move up</button>
        <button type="button" data-act="down">Move down</button>
        <button type="button" data-act="duplicate">Duplicate slide</button>
        <hr>
        <button type="button" data-act="delete">Delete slide</button>
      `;
      menu.addEventListener('click', e => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        const i = this._menuIndex;
        this._closeMenu();
        if (act === 'skip') this._toggleSkip(i);else if (act === 'up') this._moveSlide(i, i - 1);else if (act === 'down') this._moveSlide(i, i + 1);else if (act === 'duplicate') this._duplicateSlide(i);else if (act === 'delete') this._openConfirm(i);
      });
      menu.addEventListener('contextmenu', e => e.preventDefault());

      // Rail resize handle — drag to set --deck-rail-w, persisted to
      // localStorage so the width survives reloads.
      const resize = document.createElement('div');
      resize.className = 'rail-resize export-hidden';
      resize.setAttribute('data-omelette-chrome', '');
      resize.addEventListener('pointerdown', e => {
        e.preventDefault();
        resize.setPointerCapture(e.pointerId);
        resize.setAttribute('data-dragging', '');
        const move = ev => this._setRailWidth(ev.clientX);
        const up = () => {
          resize.removeEventListener('pointermove', move);
          resize.removeEventListener('pointerup', up);
          resize.removeEventListener('pointercancel', up);
          resize.removeAttribute('data-dragging');
          try {
            localStorage.setItem('deck-stage.railWidth', String(this._railPx));
          } catch (err) {}
        };
        resize.addEventListener('pointermove', move);
        resize.addEventListener('pointerup', up);
        resize.addEventListener('pointercancel', up);
      });

      // Delete-confirm dialog — mirrors the SPA's ConfirmDialog layout.
      const confirm = document.createElement('div');
      confirm.className = 'confirm-backdrop export-hidden';
      confirm.setAttribute('data-omelette-chrome', '');
      confirm.innerHTML = `
        <div class="confirm" role="dialog" aria-modal="true">
          <div class="body">
            <div class="title">Delete slide?</div>
            <div class="msg">This slide will be removed from the deck.</div>
          </div>
          <div class="footer">
            <button type="button" class="cancel">Cancel</button>
            <button type="button" class="danger">Delete</button>
          </div>
        </div>
      `;
      confirm.addEventListener('click', e => {
        if (e.target === confirm) this._closeConfirm();
      });
      confirm.querySelector('.cancel').addEventListener('click', () => this._closeConfirm());
      confirm.querySelector('.danger').addEventListener('click', () => {
        const i = this._confirmIndex;
        this._closeConfirm();
        this._deleteSlide(i);
      });
      this._root.append(style, rail, resize, stage, overlay, menu, confirm);
      this._canvas = canvas;
      this._stage = stage;
      this._slot = slot;
      this._overlay = overlay;
      this._rail = rail;
      this._resize = resize;
      this._menu = menu;
      this._confirm = confirm;
      this._countEl = overlay.querySelector('.current');
      this._totalEl = overlay.querySelector('.total');

      // Restore persisted rail width.
      let rw = 188;
      try {
        const s = localStorage.getItem('deck-stage.railWidth');
        if (s) rw = parseInt(s, 10) || rw;
      } catch (err) {}
      this._setRailWidth(rw);
      this._syncRailHidden();
    }
    _setRailWidth(px) {
      const w = Math.max(120, Math.min(360, Math.round(px)));
      this._railPx = w;
      this.style.setProperty('--deck-rail-w', w + 'px');
      this._fit();
      // _scaleThumbs forces a sync layout (frame.offsetWidth) then writes
      // N transforms. During a resize drag this runs per-pointermove;
      // coalesce to one per frame.
      if (!this._scaleRaf) {
        this._scaleRaf = requestAnimationFrame(() => {
          this._scaleRaf = null;
          this._scaleThumbs();
        });
      }
    }

    /** @page must live in the document stylesheet — it's a no-op inside
     *  shadow DOM. Inject/update a single <head> style tag so the print
     *  sheet matches the design size and Save-as-PDF yields one slide per
     *  page with no margins. */
    _syncPrintPageRule() {
      const id = 'deck-stage-print-page';
      let tag = document.getElementById(id);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
        document.head.appendChild(tag);
      }
      tag.textContent = '@page { size: ' + this.designWidth + 'px ' + this.designHeight + 'px; margin: 0; } ' + '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; overflow: visible !important; height: auto !important; } ' + '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; } ' +
      // Jump authored animations/transitions to their end state so print
      // never captures mid-entrance — pairs with the beforeprint handler
      // in connectedCallback that sets data-deck-active on every slide.
      '*, *::before, *::after { animation-delay: -99s !important; animation-duration: .001s !important; ' + 'animation-iteration-count: 1 !important; animation-fill-mode: both !important; ' + 'animation-play-state: running !important; transition-duration: 0s !important; } }';
    }
    _onSlotChange() {
      // Rail mutations (delete/move/duplicate) already reconcile synchronously and
      // emit slidechange with reason 'api'; skip the async slotchange that
      // would otherwise re-broadcast with reason 'init'.
      if (this._squelchSlotChange) {
        this._squelchSlotChange = false;
        return;
      }
      this._collectSlides();
      this._restoreIndex();
      this._applyIndex({
        showOverlay: false,
        broadcast: true,
        reason: 'init'
      });
      this._fit();
    }
    _collectSlides() {
      const assigned = this._slot.assignedElements({
        flatten: true
      });
      this._slides = assigned.filter(el => {
        // Skip template/style/script nodes even if someone slots them.
        const tag = el.tagName;
        return tag !== 'TEMPLATE' && tag !== 'SCRIPT' && tag !== 'STYLE';
      });
      this._slideSet = new Set(this._slides);
      this._slides.forEach((slide, i) => {
        const n = i + 1;
        slide.setAttribute('data-screen-label', `${pad2(n)} ${getSlideLabel(slide)}`);

        // Validation attribute for comment flow / auto-checks.
        if (!slide.hasAttribute('data-om-validate')) {
          slide.setAttribute('data-om-validate', VALIDATE_ATTR);
        }
        slide.setAttribute('data-deck-slide', String(i));
      });
      if (this._totalEl) this._totalEl.textContent = String(this._slides.length || 1);
      if (this._index >= this._slides.length) this._index = Math.max(0, this._slides.length - 1);
      this._markLastVisible();
      this._renderRail();
    }

    /** Tag the last non-skipped slide so print CSS can drop its
     *  break-after (see the @media print comment above — :last-child
     *  alone matches a hidden skipped slide). */
    _markLastVisible() {
      let last = null;
      this._slides.forEach(s => {
        s.removeAttribute('data-deck-last-visible');
        if (!s.hasAttribute('data-deck-skip')) last = s;
      });
      if (last) last.setAttribute('data-deck-last-visible', '');
    }
    _loadNotes() {
      const tag = document.getElementById('speaker-notes');
      if (!tag) {
        this._notes = [];
        return;
      }
      try {
        const parsed = JSON.parse(tag.textContent || '[]');
        if (Array.isArray(parsed)) this._notes = parsed;
      } catch (e) {
        console.warn('[deck-stage] Failed to parse #speaker-notes JSON:', e);
        this._notes = [];
      }
    }
    _restoreIndex() {
      // The host's ?slide= param is delivered as a #<int> hash (1-indexed) on
      // the iframe src. No hash → slide 1; the deck itself keeps no position
      // state across loads.
      const h = (location.hash || '').match(/^#(\d+)$/);
      if (h) {
        const n = parseInt(h[1], 10) - 1;
        if (n >= 0 && n < this._slides.length) this._index = n;
      }
    }
    _applyIndex({
      showOverlay = true,
      broadcast = true,
      reason = 'init'
    } = {}) {
      if (!this._slides.length) return;
      const prev = this._prevIndex == null ? -1 : this._prevIndex;
      const curr = this._index;
      // Keep the iframe's own hash in sync so an in-iframe location.reload()
      // (reload banner path in viewer-handle.ts) lands on the current slide,
      // not the stale deep-link hash from initial load.
      try {
        history.replaceState(null, '', '#' + (curr + 1));
      } catch (e) {}
      this._slides.forEach((s, i) => {
        if (i === curr) s.setAttribute('data-deck-active', '');else s.removeAttribute('data-deck-active');
      });
      if (this._countEl) this._countEl.textContent = String(curr + 1);
      // Follow-scroll on every navigation (init deep-link, keyboard, click,
      // tap, external goTo) — the only time we *don't* want the rail to
      // track current is after a rail-internal mutation, where _renderRail
      // has already restored the user's scroll position and yanking back to
      // current would undo it.
      this._syncRail(reason !== 'mutation');
      if (broadcast) {
        // (1) Legacy: host-window postMessage for speaker-notes renderers.
        try {
          window.postMessage({
            slideIndexChanged: curr,
            deckTotal: this._slides.length,
            deckSkipped: this._skippedIndices()
          }, '*');
        } catch (e) {}

        // (2) In-page CustomEvent on the <deck-stage> element itself.
        //     Bubbles and composes out of shadow DOM so slide code can listen:
        //       document.querySelector('deck-stage').addEventListener('slidechange', e => {
        //         e.detail.index, e.detail.previousIndex, e.detail.total, e.detail.slide, e.detail.reason
        //       });
        const detail = {
          index: curr,
          previousIndex: prev,
          total: this._slides.length,
          slide: this._slides[curr] || null,
          previousSlide: prev >= 0 ? this._slides[prev] || null : null,
          reason: reason // 'init' | 'keyboard' | 'click' | 'tap' | 'api'
        };
        this.dispatchEvent(new CustomEvent('slidechange', {
          detail,
          bubbles: true,
          composed: true
        }));
      }
      this._prevIndex = curr;
      if (showOverlay) this._flashOverlay();
    }
    _flashOverlay() {
      // Host posts __omelette_presenting while in fullscreen/tab presentation
      // mode — suppress the nav footer entirely (both hover and slide-change
      // flash) so the audience sees clean slides.
      if (!this._overlay || this._presenting) return;
      this._overlay.setAttribute('data-visible', '');
      if (this._hideTimer) clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        this._overlay.removeAttribute('data-visible');
      }, OVERLAY_HIDE_MS);
    }
    _railWidth() {
      // State-based, no offsetWidth: the first _fit() can run before the
      // rail has had layout on some load paths, and a 0 there paints the
      // slide full-width for one frame before the post-slotchange _fit()
      // corrects it.
      if (!this._railEnabled || !this._railVisible || this.hasAttribute('no-rail') || this.hasAttribute('noscale') || this._presenting || this._previewMode || NARROW_MQ.matches) return 0;
      return this._railPx || 0;
    }
    _fit() {
      if (!this._canvas) return;
      const stage = this._canvas.parentElement;
      // PPTX export sets noscale so the DOM capture sees authored-size
      // geometry — the scaled canvas is in shadow DOM, so the exporter's
      // resetTransformSelector can't reach .canvas.style.transform directly.
      if (this.hasAttribute('noscale')) {
        this._canvas.style.transform = 'none';
        if (stage) stage.style.left = '0';
        if (this._overlay) this._overlay.style.marginLeft = '0';
        return;
      }
      const rw = this._railWidth();
      if (stage) stage.style.left = rw + 'px';
      // Overlay is centred on the viewport via left:50% + translate(-50%);
      // marginLeft shifts the centre by rw/2 so it lands in the middle of
      // the [rw, innerWidth] stage region.
      if (this._overlay) this._overlay.style.marginLeft = rw / 2 + 'px';
      const vw = window.innerWidth - rw;
      const vh = window.innerHeight;
      const s = Math.min(vw / this.designWidth, vh / this.designHeight);
      this._canvas.style.transform = `scale(${s})`;
    }
    _onResize() {
      this._fit();
      // Crossing the narrow-viewport breakpoint reveals the rail — rerun the
      // thumbnail scale the same way _setRailWidth does.
      if (!this._scaleRaf) {
        this._scaleRaf = requestAnimationFrame(() => {
          this._scaleRaf = null;
          this._scaleThumbs();
        });
      }
    }
    _onMouseMove() {
      // Keep overlay visible while mouse moves; hide after idle.
      this._flashOverlay();
    }
    _onMessage(e) {
      const d = e.data;
      if (d && typeof d.__omelette_presenting === 'boolean') {
        this._presenting = d.__omelette_presenting;
        if (this._presenting && this._overlay) {
          this._overlay.removeAttribute('data-visible');
          if (this._hideTimer) clearTimeout(this._hideTimer);
        }
        this._syncRailHidden();
        this._closeMenu();
        this._closeConfirm();
        this._fit();
        this._scaleThumbs();
      }
      // Host's Preview segment (ViewerMode='none'): the rail's drag-reorder /
      // right-click skip-delete affordances are editing chrome, so hide it
      // while the user is just looking at the deck. Same hard-hide path as
      // presenting; independent of the user's _railVisible preference so
      // returning to Edit restores whatever they had.
      if (d && typeof d.__omelette_preview_mode === 'boolean') {
        if (d.__omelette_preview_mode === this._previewMode) return;
        this._previewMode = d.__omelette_preview_mode;
        this._syncRailHidden();
        this._closeMenu();
        this._closeConfirm();
        this._fit();
        this._scaleThumbs();
      }
      // Per-viewer show/hide, driven by the TweaksPanel's auto-injected
      // "Thumbnail rail" toggle (or any author script). Independent of
      // whether the Tweaks panel itself is open — closing the panel
      // doesn't change rail visibility. Persists alongside rail width.
      if (d && d.type === '__deck_rail_visible' && typeof d.on === 'boolean') {
        if (d.on === this._railVisible) return;
        this._railVisible = d.on;
        try {
          localStorage.setItem('deck-stage.railVisible', d.on ? '1' : '0');
        } catch (e) {}
        // Arm the transition, commit it, then flip state — otherwise the
        // browser coalesces both writes and nothing animates on show.
        this.setAttribute('data-rail-anim', '');
        void (this._rail && this._rail.offsetHeight);
        this._syncRailHidden();
        this._fit();
        this._scaleThumbs();
        clearTimeout(this._railAnimTimer);
        this._railAnimTimer = setTimeout(() => this.removeAttribute('data-rail-anim'), 220);
      }
      if (d && d.type === '__omelette_rail_enabled') this._enableRail();
    }
    _syncRailHidden() {
      if (!this._rail) return;
      // data-presenting is the hard hide (display:none) for flag-off,
      // presentation mode, and the host's Preview segment — instant, no
      // transition. data-user-hidden is the soft hide (translateX(-100%))
      // for the viewer's rail toggle, so show/hide slides under
      // :host([data-rail-anim]).
      const hard = !this._railEnabled || this._presenting || this._previewMode;
      if (hard) this._rail.setAttribute('data-presenting', '');else this._rail.removeAttribute('data-presenting');
      if (!this._railVisible) this._rail.setAttribute('data-user-hidden', '');else this._rail.removeAttribute('data-user-hidden');
      // translateX hide leaves thumbs (tabIndex=0) in the tab order —
      // inert keeps them unfocusable while the rail is off-screen.
      this._rail.inert = hard || !this._railVisible;
    }
    _onTap(e) {
      // Touch-only — keyboard + the overlay toolbar cover nav on desktop.
      if (FINE_POINTER_MQ.matches) return;
      // Only taps that land on the stage (slide content or letterbox); the
      // overlay / rail / menus are siblings with their own click handlers.
      const path = e.composedPath();
      if (!this._stage || !path.includes(this._stage)) return;
      // Let interactive slide content keep the tap. composedPath (not
      // e.target.closest) so we see through open shadow roots — a <button>
      // inside a slide-authored custom element retargets e.target to the
      // host but still appears in the composed path.
      if (e.defaultPrevented) return;
      for (const n of path) {
        if (n === this._stage) break;
        if (n.matches && n.matches(INTERACTIVE_SEL)) return;
      }
      e.preventDefault();
      const rw = this._railWidth();
      const mid = rw + (window.innerWidth - rw) / 2;
      this._advance(e.clientX < mid ? -1 : 1, 'tap');
    }
    _onKey(e) {
      // Ignore when the user is typing.
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // Confirm dialog swallows nav keys while open; Escape cancels. Enter
      // is left to the focused button's native activation so Tab→Cancel
      // →Enter activates Cancel, not the window-level confirm path.
      if (this._confirm && this._confirm.hasAttribute('data-open')) {
        if (e.key === 'Escape') {
          this._closeConfirm();
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Escape' && this._menu && this._menu.hasAttribute('data-open')) {
        this._closeMenu();
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      let handled = true;
      if (key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'Spacebar') {
        this._advance(1, 'keyboard');
      } else if (key === 'ArrowLeft' || key === 'PageUp') {
        this._advance(-1, 'keyboard');
      } else if (key === 'Home') {
        this._go(0, 'keyboard');
      } else if (key === 'End') {
        this._go(this._slides.length - 1, 'keyboard');
      } else if (key === 'r' || key === 'R') {
        this._go(0, 'keyboard');
      } else if (/^[0-9]$/.test(key)) {
        // 1..9 jump to that slide; 0 jumps to 10.
        const n = key === '0' ? 9 : parseInt(key, 10) - 1;
        if (n < this._slides.length) this._go(n, 'keyboard');
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        this._flashOverlay();
      }
    }
    _go(i, reason = 'api') {
      if (!this._slides.length) return;
      const clamped = Math.max(0, Math.min(this._slides.length - 1, i));
      if (clamped === this._index) {
        this._flashOverlay();
        return;
      }
      this._index = clamped;
      this._applyIndex({
        showOverlay: true,
        broadcast: true,
        reason
      });
    }

    /** Step forward/back skipping any slide marked data-deck-skip. Falls
     *  back to _go's clamp-at-ends behaviour (flash overlay) when there's
     *  nothing further in that direction. */
    _advance(dir, reason) {
      if (!this._slides.length) return;
      let i = this._index + dir;
      while (i >= 0 && i < this._slides.length && this._slides[i].hasAttribute('data-deck-skip')) {
        i += dir;
      }
      if (i < 0 || i >= this._slides.length) {
        this._flashOverlay();
        return;
      }
      this._go(i, reason);
    }

    // ── Thumbnail rail ────────────────────────────────────────────────────
    //
    // Thumbs are keyed by slide element and reused across _renderRail()
    // calls, so a reorder/delete is an O(changed) DOM shuffle instead of an
    // O(N) teardown-and-re-clone. Each thumb starts as a lightweight shell
    // (num + empty frame); the clone is materialized lazily by an
    // IntersectionObserver when the frame scrolls into (or near) view, so
    // only visible-ish slides pay the clone + image-decode cost.

    _renderRail() {
      if (!this._rail || !this._railEnabled) {
        this._thumbs = [];
        return;
      }
      // FLIP: record each *materialized* thumb's top before the reconcile.
      // Off-screen (non-materialized) thumbs don't need the animation and
      // skipping their getBoundingClientRect saves a forced layout per
      // off-screen thumb on large decks.
      const prevTops = new Map();
      (this._thumbs || []).forEach(({
        thumb,
        slide,
        host
      }) => {
        if (host) prevTops.set(slide, thumb.getBoundingClientRect().top);
      });
      const st = this._rail.scrollTop;

      // Reconcile: reuse thumbs that already exist for a slide, create
      // shells for new slides, drop thumbs for removed slides.
      const bySlide = new Map();
      (this._thumbs || []).forEach(t => bySlide.set(t.slide, t));
      const next = [];
      this._slides.forEach(slide => {
        let t = bySlide.get(slide);
        if (t) bySlide.delete(slide);else t = this._makeThumb(slide);
        next.push(t);
      });
      // Orphans — slides removed since last render.
      bySlide.forEach(t => {
        if (this._railObserver) this._railObserver.unobserve(t.frame);
        t.thumb.remove();
      });
      // Put thumbs into document order to match _slides. insertBefore on
      // an already-correctly-placed node is a no-op, so this is cheap
      // when nothing moved.
      next.forEach((t, i) => {
        const want = t.thumb;
        const at = this._rail.children[i];
        if (at !== want) this._rail.insertBefore(want, at || null);
        t.i = i;
        t.num.textContent = String(i + 1);
        if (t.slide.hasAttribute('data-deck-skip')) t.thumb.setAttribute('data-skip', '');else t.thumb.removeAttribute('data-skip');
      });
      this._thumbs = next;
      this._rail.scrollTop = st;
      if (prevTops.size) {
        const moved = [];
        this._thumbs.forEach(({
          thumb,
          slide
        }) => {
          const old = prevTops.get(slide);
          if (old == null) return;
          const dy = old - thumb.getBoundingClientRect().top;
          if (Math.abs(dy) < 1) return;
          thumb.style.transition = 'none';
          thumb.style.transform = `translateY(${dy}px)`;
          moved.push(thumb);
        });
        if (moved.length) {
          // Commit the inverted positions before flipping the transition
          // on — otherwise the browser coalesces both style writes and
          // nothing animates.
          void this._rail.offsetHeight;
          moved.forEach(t => {
            t.style.transition = 'transform 180ms cubic-bezier(.2,.7,.3,1)';
            t.style.transform = '';
          });
          setTimeout(() => moved.forEach(t => {
            t.style.transition = '';
          }), 220);
        }
      }
      requestAnimationFrame(() => this._scaleThumbs());
      this._syncRail(false);
    }

    /** Create a lightweight thumb shell for one slide. The clone is
     *  materialized later by the IntersectionObserver. Event handlers
     *  look up the thumb's *current* index (via _thumbs.indexOf) so the
     *  same element can be reused across reorders. */
    _makeThumb(slide) {
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.tabIndex = 0;
      const num = document.createElement('div');
      num.className = 'num';
      const frame = document.createElement('div');
      frame.className = 'frame';
      thumb.append(num, frame);
      const entry = {
        thumb,
        num,
        frame,
        slide,
        clone: null,
        host: null,
        i: -1
      };
      // entry.i is refreshed on every _renderRail reconcile pass, so
      // handlers read the thumb's current position without an O(N) scan.
      const idx = () => entry.i;
      thumb.addEventListener('click', () => this._go(idx(), 'click'));
      // ↑/↓ step through the rail when a thumb has focus. _go clamps at the
      // ends and _applyIndex→_syncRail scrolls the new current thumb into
      // view; we move focus to it (preventScroll — _syncRail already
      // scrolled) so a held key walks the whole list. stopPropagation keeps
      // this out of the window-level _onKey nav handler.
      thumb.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        this._go(idx() + (e.key === 'ArrowDown' ? 1 : -1), 'keyboard');
        const cur = this._thumbs && this._thumbs[this._index];
        if (cur) cur.thumb.focus({
          preventScroll: true
        });
      });
      thumb.addEventListener('contextmenu', e => {
        e.preventDefault();
        this._openMenu(idx(), e.clientX, e.clientY);
      });
      thumb.draggable = true;
      thumb.addEventListener('dragstart', e => {
        this._dragFrom = idx();
        thumb.setAttribute('data-dragging', '');
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', String(this._dragFrom));
        } catch (err) {}
      });
      thumb.addEventListener('dragend', () => {
        thumb.removeAttribute('data-dragging');
        this._clearDrop();
        this._dragFrom = null;
      });
      thumb.addEventListener('dragover', e => {
        if (this._dragFrom == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = thumb.getBoundingClientRect();
        this._setDrop(idx(), e.clientY < r.top + r.height / 2 ? 'before' : 'after');
      });
      thumb.addEventListener('drop', e => {
        if (this._dragFrom == null) return;
        e.preventDefault();
        const i = idx();
        const r = thumb.getBoundingClientRect();
        let to = e.clientY >= r.top + r.height / 2 ? i + 1 : i;
        if (this._dragFrom < to) to--;
        const from = this._dragFrom;
        this._clearDrop();
        this._dragFrom = null;
        if (to !== from) this._moveSlide(from, to);
      });
      if (this._railObserver) this._railObserver.observe(frame);
      frame.__deckThumb = entry;
      return entry;
    }

    /** Lazily build the clone for a thumb that has scrolled into view. */
    _materialize(entry) {
      if (entry.host) return;
      const dw = this.designWidth,
        dh = this.designHeight;
      let clone = entry.slide.cloneNode(true);
      clone.removeAttribute('id');
      clone.removeAttribute('data-deck-active');
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      // Neuter heavy media; replace <video> with its poster so the box
      // keeps a visual. <iframe>/<audio> become empty placeholders.
      clone.querySelectorAll('iframe, audio, object, embed').forEach(el => {
        el.removeAttribute('src');
        el.removeAttribute('srcdoc');
        el.removeAttribute('data');
        el.innerHTML = '';
      });
      clone.querySelectorAll('video').forEach(el => {
        if (!el.poster) {
          el.removeAttribute('src');
          el.innerHTML = '';
          return;
        }
        const img = document.createElement('img');
        img.src = el.poster;
        img.alt = '';
        img.style.cssText = el.style.cssText + ';object-fit:cover;width:100%;height:100%;';
        img.className = el.className;
        el.replaceWith(img);
      });
      // Images: defer decode and let the browser pick the smallest
      // srcset candidate for the ~140px thumb. Same-URL clones reuse the
      // slide's decoded bitmap (URL-keyed cache), so the remaining cost
      // is paint/composite — lazy+async keeps that off the main thread.
      clone.querySelectorAll('img').forEach(el => {
        el.loading = 'lazy';
        el.decoding = 'async';
        if (el.srcset) el.sizes = (this._railPx || 188) + 'px';
      });
      // Custom elements inside the slide would have their
      // connectedCallback fire when the clone is appended. Replace them
      // with inert boxes so a component-heavy deck doesn't run N copies
      // of each component's mount logic in the rail. Children are
      // preserved so layout-wrapper elements (<my-column><h2>…</h2>)
      // still show their authored content; the querySelectorAll NodeList
      // is static, so nested custom elements in the moved subtree are
      // still visited on later iterations.
      const neuter = el => {
        const box = document.createElement('div');
        box.style.cssText = (el.getAttribute('style') || '') + ';background:rgba(0,0,0,0.06);border:1px dashed rgba(0,0,0,0.15);';
        box.className = el.className;
        // Preserve theming/i18n hooks so [data-*] / :lang() / [dir]
        // descendant selectors still match the neutered root.
        for (const a of el.attributes) {
          const n = a.name;
          if (n.startsWith('data-') || n.startsWith('aria-') || n === 'lang' || n === 'dir' || n === 'role' || n === 'title') {
            box.setAttribute(n, a.value);
          }
        }
        while (el.firstChild) box.appendChild(el.firstChild);
        return box;
      };
      // querySelectorAll('*') returns descendants only — a custom-element
      // slide root (<my-slide>…</my-slide>) would slip through and upgrade
      // on append. Swap the root first.
      if (clone.tagName.includes('-')) clone = neuter(clone);
      clone.querySelectorAll('*').forEach(el => {
        if (el.tagName.includes('-')) el.replaceWith(neuter(el));
      });
      clone.style.cssText += ';position:absolute;top:0;left:0;transform-origin:0 0;' + 'pointer-events:none;width:' + dw + 'px;height:' + dh + 'px;' + 'box-sizing:border-box;overflow:hidden;visibility:visible;opacity:1;';
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;inset:0;';
      this._syncThumbHostAttrs(host);
      const sr = host.attachShadow({
        mode: 'open'
      });
      if (this._adoptedSheet) sr.adoptedStyleSheets = [this._adoptedSheet];else {
        const st = document.createElement('style');
        st.textContent = this._authorCss || '';
        sr.appendChild(st);
      }
      sr.appendChild(clone);
      entry.frame.appendChild(host);
      entry.host = host;
      entry.clone = clone;
      if (this._thumbScale) clone.style.transform = 'scale(' + this._thumbScale + ')';
      // Once materialized the IO callback is a no-op early-return —
      // unobserve so scroll doesn't keep firing it.
      if (this._railObserver) this._railObserver.unobserve(entry.frame);
    }

    /** Re-clone a single thumb (live-update path). No-op if the thumb
     *  hasn't been materialized yet — it'll pick up current content when
     *  it scrolls into view. */
    _refreshThumb(slide) {
      const entry = (this._thumbs || []).find(t => t.slide === slide);
      if (!entry || !entry.host) return;
      entry.host.remove();
      entry.host = entry.clone = null;
      this._materialize(entry);
    }
    _scaleThumbs() {
      if (!this._thumbs || !this._thumbs.length) return;
      // Every frame is the same width; if it reads 0 the rail is
      // display:none (noscale / no-rail / presenting / print) — leave the
      // clones as-is and re-run when the rail is revealed.
      const fw = this._thumbs[0].frame.offsetWidth;
      if (!fw) return;
      this._thumbScale = fw / this.designWidth;
      this._thumbs.forEach(({
        clone
      }) => {
        if (clone) clone.style.transform = 'scale(' + this._thumbScale + ')';
      });
    }
    _setDrop(i, where) {
      // dragover fires at pointer-event rate; touch only the previous
      // and new target rather than sweeping all N thumbs.
      const t = this._thumbs && this._thumbs[i];
      if (this._dropOn && this._dropOn !== t) {
        this._dropOn.thumb.removeAttribute('data-drop');
      }
      if (t) t.thumb.setAttribute('data-drop', where);
      this._dropOn = t || null;
    }
    _clearDrop() {
      if (this._dropOn) this._dropOn.thumb.removeAttribute('data-drop');
      this._dropOn = null;
    }
    _syncRail(follow) {
      if (!this._thumbs) return;
      this._thumbs.forEach(({
        thumb
      }, i) => {
        if (i === this._index) {
          thumb.setAttribute('data-current', '');
          if (follow && typeof thumb.scrollIntoView === 'function') {
            thumb.scrollIntoView({
              block: 'nearest'
            });
          }
        } else {
          thumb.removeAttribute('data-current');
        }
      });
    }
    _openMenu(i, x, y) {
      if (!this._menu) return;
      this._menuIndex = i;
      const slide = this._slides[i];
      const skip = slide && slide.hasAttribute('data-deck-skip');
      this._menu.querySelector('[data-act="skip"]').textContent = skip ? 'Unskip slide' : 'Skip slide';
      this._menu.querySelector('[data-act="up"]').disabled = i <= 0;
      this._menu.querySelector('[data-act="down"]').disabled = i >= this._slides.length - 1;
      this._menu.querySelector('[data-act="delete"]').disabled = this._slides.length <= 1;
      // Place, then clamp to viewport after it's measurable.
      this._menu.style.left = x + 'px';
      this._menu.style.top = y + 'px';
      this._menu.setAttribute('data-open', '');
      const r = this._menu.getBoundingClientRect();
      const nx = Math.min(x, window.innerWidth - r.width - 4);
      const ny = Math.min(y, window.innerHeight - r.height - 4);
      this._menu.style.left = Math.max(4, nx) + 'px';
      this._menu.style.top = Math.max(4, ny) + 'px';
    }
    _closeMenu() {
      if (this._menu) this._menu.removeAttribute('data-open');
      this._menuIndex = -1;
    }
    _openConfirm(i) {
      if (!this._confirm) return;
      this._confirmIndex = i;
      this._confirm.querySelector('.title').textContent = 'Delete slide ' + (i + 1) + '?';
      this._confirm.setAttribute('data-open', '');
      const btn = this._confirm.querySelector('.danger');
      if (btn && btn.focus) btn.focus();
    }
    _closeConfirm() {
      if (this._confirm) this._confirm.removeAttribute('data-open');
      this._confirmIndex = -1;
    }
    _emitDeckChange(detail) {
      this.dispatchEvent(new CustomEvent('deckchange', {
        detail,
        bubbles: true,
        composed: true
      }));
    }
    _deleteSlide(i) {
      const slide = this._slides[i];
      if (!slide || this._slides.length <= 1) return;
      const wasCurrent = i === this._index;
      if (i < this._index || wasCurrent && i === this._slides.length - 1) this._index--;
      this._squelchSlotChange = true;
      slide.remove();
      this._emitDeckChange({
        action: 'delete',
        from: i,
        slide
      });
      this._collectSlides();
      this._applyIndex({
        showOverlay: true,
        broadcast: true,
        reason: 'mutation'
      });
    }
    _duplicateSlide(i) {
      const slide = this._slides[i];
      if (!slide) return;
      const copy = slide.cloneNode(true);
      // Strip ids so the document stays valid (no duplicate-id collisions
      // with the original). Same treatment _materialize gives rail clones.
      copy.removeAttribute('id');
      copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      // Insert after the original and make the copy active so it's the one
      // on screen. _collectSlides re-derives data-screen-label / data-deck-*
      // attrs, so the cloned values are overwritten.
      this._index = i + 1;
      this._squelchSlotChange = true;
      this.insertBefore(copy, slide.nextSibling);
      this._emitDeckChange({
        action: 'duplicate',
        from: i,
        to: i + 1,
        slide: copy
      });
      this._collectSlides();
      this._applyIndex({
        showOverlay: true,
        broadcast: true,
        reason: 'mutation'
      });
    }
    _toggleSkip(i) {
      const slide = this._slides[i];
      if (!slide) return;
      const on = !slide.hasAttribute('data-deck-skip');
      if (on) slide.setAttribute('data-deck-skip', '');else slide.removeAttribute('data-deck-skip');
      if (this._thumbs && this._thumbs[i]) {
        if (on) this._thumbs[i].thumb.setAttribute('data-skip', '');else this._thumbs[i].thumb.removeAttribute('data-skip');
      }
      this._markLastVisible();
      this._emitDeckChange({
        action: on ? 'skip' : 'unskip',
        from: i,
        slide
      });
      // Re-broadcast so the presenter popup's prev/next thumbnails re-pick
      // the nearest non-skipped slide without waiting for a nav event.
      try {
        window.postMessage({
          slideIndexChanged: this._index,
          deckTotal: this._slides.length,
          deckSkipped: this._skippedIndices()
        }, '*');
      } catch (e) {}
    }
    _skippedIndices() {
      const out = [];
      for (let i = 0; i < this._slides.length; i++) {
        if (this._slides[i].hasAttribute('data-deck-skip')) out.push(i);
      }
      return out;
    }
    _moveSlide(i, j) {
      if (j < 0 || j >= this._slides.length || j === i) return;
      const slide = this._slides[i];
      const ref = j < i ? this._slides[j] : this._slides[j].nextSibling;
      // Track the active slide across the reorder so the same content
      // stays on screen.
      const cur = this._index;
      if (cur === i) this._index = j;else if (i < cur && j >= cur) this._index = cur - 1;else if (i > cur && j <= cur) this._index = cur + 1;
      this._squelchSlotChange = true;
      this.insertBefore(slide, ref);
      this._emitDeckChange({
        action: 'move',
        from: i,
        to: j,
        slide
      });
      this._collectSlides();
      this._applyIndex({
        showOverlay: false,
        broadcast: true,
        reason: 'mutation'
      });
    }

    // Public API ------------------------------------------------------------

    /** Current slide index (0-based). */
    get index() {
      return this._index;
    }
    /** Total slide count. */
    get length() {
      return this._slides.length;
    }
    /** Programmatically navigate. */
    goTo(i) {
      this._go(i, 'api');
    }
    next() {
      this._advance(1, 'api');
    }
    prev() {
      this._advance(-1, 'api');
    }
    reset() {
      this._go(0, 'api');
    }
  }
  if (!customElements.get('deck-stage')) {
    customElements.define('deck-stage', DeckStage);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "pitch-deck/deck-stage.js", error: String((e && e.message) || e) }); }

// ui_kits/marketing/sections-body.jsx
try { (() => {
/* DoctorHeidi marketing landing — features, how-it-works, security, pricing, footer */

function Logos() {
  const names = ["Mercy General", "St. Anne's", "Lakeside Health", "Northwind ER", "Cedar Valley"];
  return /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      padding: "8px 0 56px"
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: "center",
      fontSize: 12.5,
      fontWeight: 600,
      letterSpacing: ".08em",
      textTransform: "uppercase",
      color: "#94a3b8",
      margin: "0 0 22px"
    }
  }, "Coordinating care at hospitals nationwide"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: "20px 44px",
      opacity: .7
    }
  }, names.map(n => /*#__PURE__*/React.createElement("span", {
    key: n,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 17,
      fontWeight: 700,
      color: "#64748b"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "hospital",
    size: 18,
    color: "#94a3b8"
  }), n))));
}
function Features() {
  const items = [["route", "Automatic round-robin", "Every admit routes to the next eligible hospitalist by lowest census — no phone tag, no guesswork.", "sky"], ["bell-ring", "Notifications that land", "WebSocket → push → SMS cascade means the right provider always gets the alert, on any device.", "blue"], ["messages-square", "Secure messaging", "Direct, group, and emergency-broadcast conversations with delivery and read receipts — fully audited.", "emerald"], ["sparkles", "AI-assisted intake", "Paste free-text notes; DocTurn extracts structured fields and suggests the right specialty.", "amber"], ["timer", "Smart expiry & reassign", "Unanswered requests re-route automatically so no patient waits on a busy provider.", "rose"], ["lock", "HIPAA by default", "Initials-only PHI, full audit trail, MFA, and 15-minute sessions — compliant out of the box.", "slate"]];
  const tints = {
    sky: ["#E0F2FE", "var(--sky-700)"],
    blue: ["#DBEAFE", "var(--primary)"],
    emerald: ["#D1FAE5", "#059669"],
    amber: ["#FEF3C7", "#D97706"],
    rose: ["#FFE4E6", "#E11D48"],
    slate: ["#F1F5F9", "#475569"]
  };
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#fff",
      padding: "84px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap"
  }, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "Why DocTurn",
    title: "The whole hand-off, in one calm system",
    sub: "From ER intake to hospitalist acceptance \u2014 automated routing, multi-channel alerts, and messaging that keeps your team in sync."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 20,
      marginTop: 48
    },
    className: "m-feature-grid"
  }, items.map(([ic, t, d, tint]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    className: "m-card-hover",
    style: {
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-2xl)",
      padding: 24,
      background: "linear-gradient(180deg,#fff,#FBFDFF)",
      transition: "transform .25s ease, box-shadow .25s ease"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 46,
      height: 46,
      borderRadius: 13,
      background: tints[tint][0],
      color: tints[tint][1],
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 22
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#0f172a",
      margin: "16px 0 6px"
    }
  }, t), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.55,
      color: "#64748b",
      margin: 0
    }
  }, d))))));
}
function SectionHead({
  eyebrow,
  title,
  sub,
  center = true
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: center ? "center" : "left",
      maxWidth: center ? 640 : "none",
      margin: center ? "0 auto" : 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: ".06em",
      textTransform: "uppercase",
      color: "var(--sky-600, #0284c7)"
    }
  }, eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 38,
      lineHeight: 1.12,
      letterSpacing: "-0.02em",
      fontWeight: 700,
      color: "#0f172a",
      margin: "12px 0 0"
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 17,
      lineHeight: 1.55,
      color: "#64748b",
      margin: "16px 0 0"
    }
  }, sub));
}
function HowItWorks() {
  const steps = [["clipboard-plus", "ER admits", "An ER physician submits a patient — pasting notes for AI to structure if they like."], ["route", "DocTurn routes", "Round-robin picks the next eligible hospitalist; or the physician assigns manually."], ["bell-ring", "Provider is notified", "Push, SMS, and in-app alerts fire instantly. They accept or decline in a tap."], ["check-circle-2", "Hand-off complete", "Census updates, the care team can message, and every step is audit-logged."]];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--marketing-bg)",
      padding: "84px 0",
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      position: "relative",
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "How it works",
    title: "Four steps, zero phone tag"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 18,
      marginTop: 48
    },
    className: "m-steps"
  }, steps.map(([ic, t, d], i) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      background: "rgba(255,255,255,.8)",
      backdropFilter: "blur(6px)",
      borderRadius: "var(--radius-2xl)",
      padding: 22,
      border: "1px solid hsl(214 32% 91% / .8)",
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 99,
      background: "var(--sky-gradient)",
      color: "#fff",
      fontSize: 13,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, i + 1), /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 20,
    color: "var(--sky-700)"
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      color: "#0f172a",
      margin: "0 0 6px"
    }
  }, t), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      lineHeight: 1.5,
      color: "#64748b",
      margin: 0
    }
  }, d))))));
}
function Security() {
  const points = ["Full HIPAA audit trail & PHI access logs", "MFA (TOTP + SMS) with backup codes", "Multi-tenant isolation by organization", "15-minute sessions, encryption in transit", "Initials-only PHI — never full names", "Role-based access control on every route"];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#fff",
      padding: "84px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 56,
      alignItems: "center"
    },
    className: "m-sec-grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionHead, {
    center: false,
    eyebrow: "Security & compliance",
    title: "Built for PHI from the first line of code",
    sub: "DocTurn isn't compliant as an afterthought \u2014 tenancy, auditing, and least-privilege access are the architecture."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "12px 20px",
      marginTop: 28
    }
  }, points.map(p => /*#__PURE__*/React.createElement("div", {
    key: p,
    style: {
      display: "flex",
      gap: 9,
      alignItems: "flex-start",
      fontSize: 14,
      color: "#334155",
      lineHeight: 1.45
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "shield-check",
    size: 17,
    color: "#059669",
    style: {
      marginTop: 1
    }
  }), p)))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--marketing-bg)",
      borderRadius: "var(--radius-2xl)",
      padding: 30,
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow-lg)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 52,
      height: 52,
      borderRadius: 15,
      background: "#fff",
      color: "#059669",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "lock-keyhole",
    size: 26
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, "HIPAA + SOC 2"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#64748b"
    }
  }, "Independently assessed"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 22,
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, [["fingerprint", "Every PHI access logged"], ["server", "Tenant data isolated by org"], ["bell-off", "Push payloads carry no PHI"]].map(([i, t]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: "flex",
      gap: 11,
      alignItems: "center",
      background: "rgba(255,255,255,.75)",
      borderRadius: "var(--radius-lg)",
      padding: "12px 14px"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: i,
    size: 18,
    color: "var(--sky-700)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      fontWeight: 500,
      color: "#0f172a"
    }
  }, t)))))));
}
function Pricing() {
  const plans = [{
    name: "Department",
    price: "$0",
    note: "free to start",
    desc: "For a single ER or hospitalist group getting started.",
    features: ["Round-robin routing", "Push + SMS alerts", "Secure messaging", "Up to 25 providers"],
    cta: "Get started free",
    hi: false
  }, {
    name: "Hospital",
    price: "$8",
    note: "/ provider / mo",
    desc: "For a full hospital with multiple departments.",
    features: ["Everything in Department", "AI-assisted intake", "Amion schedule sync", "Custom round-robin rules", "Priority support"],
    cta: "Start free trial",
    hi: true
  }, {
    name: "Network",
    price: "Custom",
    note: "",
    desc: "For multi-hospital systems and IDNs.",
    features: ["Everything in Hospital", "Multi-tenant admin", "SSO / OIDC", "Dedicated success manager", "BAA + custom DPA"],
    cta: "Talk to sales",
    hi: false
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--marketing-bg)",
      padding: "84px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap"
  }, /*#__PURE__*/React.createElement(SectionHead, {
    eyebrow: "Pricing",
    title: "Simple, per-provider pricing",
    sub: "Start free. Upgrade when your whole hospital is on board."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 20,
      marginTop: 48,
      alignItems: "stretch"
    },
    className: "m-price-grid"
  }, plans.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    style: {
      background: "#fff",
      borderRadius: "var(--radius-2xl)",
      padding: 28,
      border: p.hi ? "2px solid var(--primary)" : "1px solid var(--border)",
      boxShadow: p.hi ? "var(--shadow-xl)" : "var(--shadow-sm)",
      position: "relative",
      display: "flex",
      flexDirection: "column"
    }
  }, p.hi && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: -12,
      left: 28,
      background: "var(--sky-gradient)",
      color: "#fff",
      fontSize: 12,
      fontWeight: 700,
      padding: "4px 12px",
      borderRadius: 99,
      boxShadow: "var(--shadow-glow)",
      whiteSpace: "nowrap"
    }
  }, "Most popular"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: "#0f172a"
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 6,
      margin: "12px 0 4px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 42,
      fontWeight: 700,
      color: "#0f172a",
      letterSpacing: "-0.02em"
    }
  }, p.price), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "#64748b"
    }
  }, p.note)), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      color: "#64748b",
      margin: "0 0 18px",
      lineHeight: 1.5
    }
  }, p.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      flex: 1
    }
  }, p.features.map(f => /*#__PURE__*/React.createElement("div", {
    key: f,
    style: {
      display: "flex",
      gap: 9,
      alignItems: "center",
      fontSize: 13.5,
      color: "#334155"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "check",
    size: 16,
    color: "#059669"
  }), f))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement(CTA, {
    variant: p.hi ? "primary" : "secondary",
    size: "sm"
  }, p.cta)))))));
}
function FinalCTA() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#fff",
      padding: "40px 0 84px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#0EA5E9,#0369A1)",
      borderRadius: "var(--radius-2xl)",
      padding: "56px 40px",
      textAlign: "center",
      position: "relative",
      overflow: "hidden",
      boxShadow: "var(--shadow-2xl)"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 38,
      fontWeight: 700,
      color: "#fff",
      margin: 0,
      letterSpacing: "-0.02em"
    }
  }, "Get your ER and hospitalists in sync."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 17,
      color: "rgba(255,255,255,.85)",
      margin: "14px auto 0",
      maxWidth: 480
    }
  }, "Set up DocTurn for your hospital in under a day \u2014 no IT project required."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      justifyContent: "center",
      marginTop: 30,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      height: 52,
      padding: "0 30px",
      borderRadius: "var(--radius-md)",
      border: "none",
      background: "#fff",
      color: "var(--sky-700)",
      fontSize: 16,
      fontWeight: 700,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: 9
    }
  }, "Get started free ", /*#__PURE__*/React.createElement(MIcon, {
    name: "arrow-right",
    size: 18
  })), /*#__PURE__*/React.createElement("button", {
    style: {
      height: 52,
      padding: "0 26px",
      borderRadius: "var(--radius-md)",
      border: "1px solid rgba(255,255,255,.5)",
      background: "transparent",
      color: "#fff",
      fontSize: 16,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, "Book a demo")))));
}
function Footer() {
  const cols = {
    Product: ["Patient assignment", "Secure messaging", "AI intake", "Mobile app"],
    Company: ["About", "Customers", "Careers", "Contact"],
    Resources: ["Documentation", "Security", "HIPAA", "Status"]
  };
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: "#0f172a",
      color: "#cbd5e1",
      padding: "56px 0 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "grid",
      gridTemplateColumns: "1.6fr 1fr 1fr 1fr",
      gap: 32
    },
    className: "m-foot-grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "assets/docturn-glyph-sky.svg",
    alt: "",
    style: {
      width: 36,
      height: 36,
      borderRadius: 9
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 20,
      fontWeight: 700,
      color: "#fff"
    }
  }, "DocTurn")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      color: "#94a3b8",
      margin: "16px 0 0",
      maxWidth: 260,
      lineHeight: 1.55
    }
  }, "HIPAA-compliant patient assignment and secure messaging for hospitals.")), Object.entries(cols).map(([h, links]) => /*#__PURE__*/React.createElement("div", {
    key: h
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: "#fff",
      marginBottom: 14
    }
  }, h), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      fontSize: 13.5,
      color: "#94a3b8",
      textDecoration: "none"
    }
  }, l)))))), /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      borderTop: "1px solid #1e293b",
      marginTop: 40,
      paddingTop: 22,
      display: "flex",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 12,
      fontSize: 12.5,
      color: "#64748b"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 DocTurn Health, Inc. All rights reserved."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 22
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "#64748b",
      textDecoration: "none"
    }
  }, "Privacy"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "#64748b",
      textDecoration: "none"
    }
  }, "Terms"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: "#64748b",
      textDecoration: "none"
    }
  }, "BAA"))));
}
Object.assign(window, {
  Logos,
  Features,
  HowItWorks,
  Security,
  Pricing,
  FinalCTA,
  Footer,
  SectionHead
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/sections-body.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/sections-hero.jsx
try { (() => {
/* DoctorHeidi marketing landing — section components */

function MIcon({
  name,
  size = 16,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = `<i data-lucide="${name}"></i>`;
    window.lucide.createIcons({
      attrs: {
        width: size,
        height: size,
        "stroke-width": strokeWidth
      },
      root: host
    });
  });
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      display: "inline-flex",
      alignItems: "center",
      color,
      flex: "none",
      ...style
    }
  });
}
function CTA({
  children,
  variant = "primary",
  size = "lg",
  icon,
  onClick
}) {
  const sz = size === "lg" ? {
    height: 52,
    padding: "0 28px",
    fontSize: 16
  } : {
    height: 44,
    padding: "0 20px",
    fontSize: 15
  };
  const styles = variant === "primary" ? {
    background: "var(--sky-gradient)",
    color: "#fff",
    boxShadow: "var(--shadow-glow)"
  } : {
    background: "#fff",
    color: "#0f172a",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-sm)"
  };
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: e => {
      e.currentTarget.style.transform = "translateY(-2px)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = "none";
    },
    style: {
      ...sz,
      ...styles,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
      borderRadius: "var(--radius-md)",
      border: styles.border || "1px solid transparent",
      fontWeight: 600,
      cursor: "pointer",
      transition: "transform .2s ease, box-shadow .2s ease",
      fontFamily: "var(--font-sans)",
      whiteSpace: "nowrap"
    }
  }, children, icon && /*#__PURE__*/React.createElement(MIcon, {
    name: icon,
    size: 18
  }));
}
function Nav() {
  const links = ["Product", "How it works", "Security", "Pricing"];
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 20,
      background: "rgba(255,255,255,.72)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid hsl(214 32% 91% / .7)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: 68
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "assets/docturn-wordmark-marketing.svg",
    alt: "DocTurn",
    style: {
      height: 30
    }
  }), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      gap: 30
    },
    className: "m-navlinks"
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      fontSize: 14.5,
      fontWeight: 500,
      color: "#475569",
      textDecoration: "none"
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontSize: 14.5,
      fontWeight: 500,
      color: "#0f172a",
      textDecoration: "none"
    },
    className: "m-signin"
  }, "Sign in"), /*#__PURE__*/React.createElement(CTA, {
    size: "sm"
  }, "Get started free"))));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      paddingTop: 72,
      paddingBottom: 72,
      position: "relative",
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      padding: "6px 14px",
      borderRadius: 99,
      fontSize: 13,
      fontWeight: 600,
      color: "var(--sky-700)"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: "sparkles",
    size: 14
  }), " HIPAA-compliant \xB7 trusted in the ER"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 60,
      lineHeight: 1.05,
      letterSpacing: "-0.03em",
      fontWeight: 700,
      color: "#0f172a",
      margin: "22px 0 0",
      maxWidth: 820
    },
    className: "m-hero-h1"
  }, "Patient hand-offs,", /*#__PURE__*/React.createElement("br", null), "handled in seconds."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 19,
      lineHeight: 1.55,
      color: "#475569",
      margin: "22px 0 0",
      maxWidth: 560
    }
  }, "DocTurn routes every ER admit to the right hospitalist automatically \u2014 with real-time notifications and secure messaging your whole care team can trust."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginTop: 32,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(CTA, {
    icon: "arrow-right"
  }, "Get started free"), /*#__PURE__*/React.createElement(CTA, {
    variant: "secondary",
    icon: "play"
  }, "Watch the 2-min demo")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 26,
      marginTop: 30,
      flexWrap: "wrap",
      color: "#64748b",
      fontSize: 13.5
    }
  }, [["shield-check", "SOC 2 + HIPAA"], ["zap", "Live in a day"], ["users", "Unlimited providers"]].map(([i, t]) => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: "flex",
      gap: 7,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: i,
    size: 15,
    color: "var(--sky-500)"
  }), t)))), /*#__PURE__*/React.createElement("div", {
    className: "m-wrap",
    style: {
      position: "relative",
      zIndex: 2,
      paddingBottom: 80
    }
  }, /*#__PURE__*/React.createElement(HeroPreview, null)), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 520,
      height: 520,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(56,189,248,.22), transparent 68%)",
      top: -140,
      right: -120,
      zIndex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 460,
      height: 460,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(255,228,230,.6), transparent 68%)",
      bottom: 40,
      left: -160,
      zIndex: 1
    }
  }));
}
function HeroPreview() {
  return /*#__PURE__*/React.createElement("div", {
    className: "m-float",
    style: {
      background: "#fff",
      borderRadius: "var(--radius-2xl)",
      boxShadow: "var(--shadow-2xl)",
      border: "1px solid hsl(214 32% 91% / .8)",
      overflow: "hidden",
      maxWidth: 960,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 42,
      background: "#F8FAFC",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 7,
      padding: "0 16px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: 99,
      background: "#FB7185"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: 99,
      background: "#FBBF24"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 11,
      height: 11,
      borderRadius: 99,
      background: "#34D399"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 12,
      fontSize: 12,
      color: "#94a3b8"
    }
  }, "app.docturn.health")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 14,
      padding: 22,
      background: "linear-gradient(180deg,#fff,#F8FAFC)"
    }
  }, [["Pending", "RM · Rm 318", "Acute abdominal pain", "pending", "clock"], ["Accepted", "SC · Rm 412", "Chest pain — Dr. Chen", "accepted", "check"], ["Sent", "TK · Rm 205", "Routed via round-robin", "active", "send"]].map(([badge, name, sub, st, ic]) => /*#__PURE__*/React.createElement("div", {
    key: name,
    style: {
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: 14,
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 11.5,
      fontWeight: 600,
      padding: "2px 8px",
      borderRadius: 99,
      background: `var(--status-${st}-bg)`,
      color: `var(--status-${st})`
    }
  }, /*#__PURE__*/React.createElement(MIcon, {
    name: ic,
    size: 11
  }), badge), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      marginTop: 10
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#64748b",
      marginTop: 2
    }
  }, sub)))));
}
Object.assign(window, {
  MIcon,
  CTA,
  Nav,
  Hero
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/sections-hero.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mobile/ios-frame.jsx
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)

/* BEGIN USAGE */
// iOS.jsx — Simplified iOS 26 (Liquid Glass) device frame
// Based on the iOS 26 UI Kit + Figma status bar spec. No assets, no deps.
// Exports (to window): IOSDevice, IOSStatusBar, IOSNavBar, IOSGlassPill, IOSList, IOSListRow, IOSKeyboard
//
// Usage — wrap your screen content in <IOSDevice> to get the bezel, status bar
// and home indicator (props: title, dark, keyboard):
//
//   <IOSDevice title="Settings">
//     ...your screen content...
//   </IOSDevice>
//   <IOSDevice dark title="Search" keyboard>…</IOSDevice>
/* END USAGE */

// ─────────────────────────────────────────────────────────────
// Status bar
// ─────────────────────────────────────────────────────────────
function IOSStatusBar({
  dark = false,
  time = '9:41'
}) {
  const c = dark ? '#fff' : '#000';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 154,
      alignItems: 'center',
      justifyContent: 'center',
      padding: '21px 24px 19px',
      boxSizing: 'border-box',
      position: 'relative',
      zIndex: 20,
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 22,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 1.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: '-apple-system, "SF Pro", system-ui',
      fontWeight: 590,
      fontSize: 17,
      lineHeight: '22px',
      color: c
    }
  }, time)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 22,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingTop: 1,
      paddingRight: 1
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "19",
    height: "12",
    viewBox: "0 0 19 12"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "0",
    y: "7.5",
    width: "3.2",
    height: "4.5",
    rx: "0.7",
    fill: c
  }), /*#__PURE__*/React.createElement("rect", {
    x: "4.8",
    y: "5",
    width: "3.2",
    height: "7",
    rx: "0.7",
    fill: c
  }), /*#__PURE__*/React.createElement("rect", {
    x: "9.6",
    y: "2.5",
    width: "3.2",
    height: "9.5",
    rx: "0.7",
    fill: c
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14.4",
    y: "0",
    width: "3.2",
    height: "12",
    rx: "0.7",
    fill: c
  })), /*#__PURE__*/React.createElement("svg", {
    width: "17",
    height: "12",
    viewBox: "0 0 17 12"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z",
    fill: c
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z",
    fill: c
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "8.5",
    cy: "10.5",
    r: "1.5",
    fill: c
  })), /*#__PURE__*/React.createElement("svg", {
    width: "27",
    height: "13",
    viewBox: "0 0 27 13"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "0.5",
    y: "0.5",
    width: "23",
    height: "12",
    rx: "3.5",
    stroke: c,
    strokeOpacity: "0.35",
    fill: "none"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "2",
    y: "2",
    width: "20",
    height: "9",
    rx: "2",
    fill: c
  }), /*#__PURE__*/React.createElement("path", {
    d: "M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z",
    fill: c,
    fillOpacity: "0.4"
  }))));
}

// ─────────────────────────────────────────────────────────────
// Liquid glass pill — blur + tint + shine
// ─────────────────────────────────────────────────────────────
function IOSGlassPill({
  children,
  dark = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      minWidth: 44,
      borderRadius: 9999,
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: dark ? '0 2px 6px rgba(0,0,0,0.35), 0 6px 16px rgba(0,0,0,0.2)' : '0 1px 3px rgba(0,0,0,0.07), 0 3px 10px rgba(0,0,0,0.06)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 9999,
      backdropFilter: 'blur(12px) saturate(180%)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
      background: dark ? 'rgba(120,120,128,0.28)' : 'rgba(255,255,255,0.5)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 9999,
      boxShadow: dark ? 'inset 1.5px 1.5px 1px rgba(255,255,255,0.15), inset -1px -1px 1px rgba(255,255,255,0.08)' : 'inset 1.5px 1.5px 1px rgba(255,255,255,0.7), inset -1px -1px 1px rgba(255,255,255,0.4)',
      border: dark ? '0.5px solid rgba(255,255,255,0.15)' : '0.5px solid rgba(0,0,0,0.06)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      alignItems: 'center',
      padding: '0 4px'
    }
  }, children));
}

// ─────────────────────────────────────────────────────────────
// Navigation bar — glass pills + large title
// ─────────────────────────────────────────────────────────────
function IOSNavBar({
  title = 'Title',
  dark = false,
  trailingIcon = true
}) {
  const muted = dark ? 'rgba(255,255,255,0.6)' : '#404040';
  const text = dark ? '#fff' : '#000';
  const pillIcon = content => /*#__PURE__*/React.createElement(IOSGlassPill, {
    dark: dark
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 36,
      height: 36,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, content));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      paddingTop: 62,
      paddingBottom: 10,
      position: 'relative',
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px'
    }
  }, pillIcon(/*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "20",
    viewBox: "0 0 12 20",
    fill: "none",
    style: {
      marginLeft: -1
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M10 2L2 10l8 8",
    stroke: muted,
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), trailingIcon && pillIcon(/*#__PURE__*/React.createElement("svg", {
    width: "22",
    height: "6",
    viewBox: "0 0 22 6"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "3",
    cy: "3",
    r: "2.5",
    fill: muted
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "3",
    r: "2.5",
    fill: muted
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "19",
    cy: "3",
    r: "2.5",
    fill: muted
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 16px',
      fontFamily: '-apple-system, system-ui',
      fontSize: 34,
      fontWeight: 700,
      lineHeight: '41px',
      color: text,
      letterSpacing: 0.4
    }
  }, title));
}

// ─────────────────────────────────────────────────────────────
// Grouped list (inset card, r:26) + row (52px)
// ─────────────────────────────────────────────────────────────
function IOSListRow({
  title,
  detail,
  icon,
  chevron = true,
  isLast = false,
  dark = false
}) {
  const text = dark ? '#fff' : '#000';
  const sec = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const ter = dark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)';
  const sep = dark ? 'rgba(84,84,88,0.65)' : 'rgba(60,60,67,0.12)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      minHeight: 52,
      padding: '0 16px',
      position: 'relative',
      fontFamily: '-apple-system, system-ui',
      fontSize: 17,
      letterSpacing: -0.43
    }
  }, icon && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 7,
      background: icon,
      marginRight: 12,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      color: text
    }
  }, title), detail && /*#__PURE__*/React.createElement("span", {
    style: {
      color: sec,
      marginRight: 6
    }
  }, detail), chevron && /*#__PURE__*/React.createElement("svg", {
    width: "8",
    height: "14",
    viewBox: "0 0 8 14",
    style: {
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M1 1l6 6-6 6",
    stroke: ter,
    strokeWidth: "2",
    fill: "none",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), !isLast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      left: icon ? 58 : 16,
      height: 0.5,
      background: sep
    }
  }));
}
function IOSList({
  header,
  children,
  dark = false
}) {
  const hc = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const bg = dark ? '#1C1C1E' : '#fff';
  return /*#__PURE__*/React.createElement("div", null, header && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: '-apple-system, system-ui',
      fontSize: 13,
      color: hc,
      textTransform: 'uppercase',
      padding: '8px 36px 6px',
      letterSpacing: -0.08
    }
  }, header), /*#__PURE__*/React.createElement("div", {
    style: {
      background: bg,
      borderRadius: 26,
      margin: '0 16px',
      overflow: 'hidden'
    }
  }, children));
}

// ─────────────────────────────────────────────────────────────
// Device frame
// ─────────────────────────────────────────────────────────────
function IOSDevice({
  children,
  width = 402,
  height = 874,
  dark = false,
  title,
  keyboard = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      height,
      borderRadius: 48,
      overflow: 'hidden',
      position: 'relative',
      background: dark ? '#000' : '#F2F2F7',
      boxShadow: '0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)',
      fontFamily: '-apple-system, system-ui, sans-serif',
      WebkitFontSmoothing: 'antialiased'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 11,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 126,
      height: 37,
      borderRadius: 24,
      background: '#000',
      zIndex: 50
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10
    }
  }, /*#__PURE__*/React.createElement(IOSStatusBar, {
    dark: dark
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }
  }, title !== undefined && /*#__PURE__*/React.createElement(IOSNavBar, {
    title: title,
    dark: dark
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'auto'
    }
  }, children), keyboard && /*#__PURE__*/React.createElement(IOSKeyboard, {
    dark: dark
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 60,
      height: 34,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingBottom: 8,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 139,
      height: 5,
      borderRadius: 100,
      background: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.25)'
    }
  })));
}

// ─────────────────────────────────────────────────────────────
// Keyboard — iOS 26 liquid glass
// ─────────────────────────────────────────────────────────────
function IOSKeyboard({
  dark = false
}) {
  const glyph = dark ? 'rgba(255,255,255,0.7)' : '#595959';
  const sugg = dark ? 'rgba(255,255,255,0.6)' : '#333';
  const keyBg = dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.85)';

  // special-key icons
  const icons = {
    shift: /*#__PURE__*/React.createElement("svg", {
      width: "19",
      height: "17",
      viewBox: "0 0 19 17"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M9.5 1L1 9.5h4.5V16h8V9.5H18L9.5 1z",
      fill: glyph
    })),
    del: /*#__PURE__*/React.createElement("svg", {
      width: "23",
      height: "17",
      viewBox: "0 0 23 17"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M7 1h13a2 2 0 012 2v11a2 2 0 01-2 2H7l-6-7.5L7 1z",
      fill: "none",
      stroke: glyph,
      strokeWidth: "1.6",
      strokeLinejoin: "round"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M10 5l7 7M17 5l-7 7",
      stroke: glyph,
      strokeWidth: "1.6",
      strokeLinecap: "round"
    })),
    ret: /*#__PURE__*/React.createElement("svg", {
      width: "20",
      height: "14",
      viewBox: "0 0 20 14"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M18 1v6H4m0 0l4-4M4 7l4 4",
      fill: "none",
      stroke: "#fff",
      strokeWidth: "1.8",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }))
  };
  const key = (content, {
    w,
    flex,
    ret,
    fs = 25,
    k
  } = {}) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      height: 42,
      borderRadius: 8.5,
      flex: flex ? 1 : undefined,
      width: w,
      minWidth: 0,
      background: ret ? '#08f' : keyBg,
      boxShadow: '0 1px 0 rgba(0,0,0,0.075)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, "SF Compact", system-ui',
      fontSize: fs,
      fontWeight: 458,
      color: ret ? '#fff' : glyph
    }
  }, content);
  const row = (keys, pad = 0) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6.5,
      justifyContent: 'center',
      padding: `0 ${pad}px`
    }
  }, keys.map(l => key(l, {
    flex: true,
    k: l
  })));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 15,
      borderRadius: 27,
      overflow: 'hidden',
      padding: '11px 0 2px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      boxShadow: dark ? '0 -2px 20px rgba(0,0,0,0.09)' : '0 -1px 6px rgba(0,0,0,0.018), 0 -3px 20px rgba(0,0,0,0.012)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 27,
      backdropFilter: 'blur(12px) saturate(180%)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
      background: dark ? 'rgba(120,120,128,0.14)' : 'rgba(255,255,255,0.25)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 27,
      boxShadow: dark ? 'inset 1.5px 1.5px 1px rgba(255,255,255,0.15)' : 'inset 1.5px 1.5px 1px rgba(255,255,255,0.7), inset -1px -1px 1px rgba(255,255,255,0.4)',
      border: dark ? '0.5px solid rgba(255,255,255,0.15)' : '0.5px solid rgba(0,0,0,0.06)',
      pointerEvents: 'none'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 20,
      alignItems: 'center',
      padding: '8px 22px 13px',
      width: '100%',
      boxSizing: 'border-box',
      position: 'relative'
    }
  }, ['"The"', 'the', 'to'].map((w, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 25,
      background: '#ccc',
      opacity: 0.3
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      textAlign: 'center',
      fontFamily: '-apple-system, system-ui',
      fontSize: 17,
      color: sugg,
      letterSpacing: -0.43,
      lineHeight: '22px'
    }
  }, w)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 13,
      padding: '0 6.5px',
      width: '100%',
      boxSizing: 'border-box',
      position: 'relative'
    }
  }, row(['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']), row(['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], 20), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14.25,
      alignItems: 'center'
    }
  }, key(icons.shift, {
    w: 45,
    k: 'shift'
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6.5,
      flex: 1
    }
  }, ['z', 'x', 'c', 'v', 'b', 'n', 'm'].map(l => key(l, {
    flex: true,
    k: l
  }))), key(icons.del, {
    w: 45,
    k: 'del'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      alignItems: 'center'
    }
  }, key('ABC', {
    w: 92.25,
    fs: 18,
    k: 'abc'
  }), key('', {
    flex: true,
    k: 'space'
  }), key(icons.ret, {
    w: 92.25,
    ret: true,
    k: 'ret'
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 56,
      width: '100%',
      position: 'relative'
    }
  }));
}
Object.assign(window, {
  IOSDevice,
  IOSStatusBar,
  IOSNavBar,
  IOSGlassPill,
  IOSList,
  IOSListRow,
  IOSKeyboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mobile/ios-frame.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mobile/roles.jsx
try { (() => {
/* DocTurn mobile — role-specific home screens for the all-roles gallery.
   Reuses shared primitives from screens.jsx (MI, MBadge, MAvatar, Dot).
   Each role gets a home screen + its own bottom tab set. */

function RHeader({
  title,
  action,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "56px 20px 12px",
      background: "#fff",
      position: "sticky",
      top: 0,
      zIndex: 5,
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 26,
      fontWeight: 700,
      margin: 0,
      letterSpacing: "-0.02em",
      whiteSpace: "nowrap"
    }
  }, title), action), sub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--muted-foreground)",
      marginTop: 2
    }
  }, sub));
}
function MiniTile({
  label,
  value,
  icon,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      padding: 13,
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: icon,
    size: 16,
    color: color || "var(--primary)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      fontWeight: 700,
      marginTop: 6,
      letterSpacing: "-.02em"
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      lineHeight: 1.2
    }
  }, label));
}
function SectionLabel({
  children,
  right
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      margin: "2px 2px 10px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      margin: 0
    }
  }, children), right);
}

/* ───────────── ER physician — Intake ───────────── */
const ER_SERVICES = [{
  svc: "Hospital Medicine",
  who: "Dr. Amir Patel",
  initials: "AP",
  rr: true
}, {
  svc: "Cardiology",
  who: "Dr. Sarah Chen",
  initials: "SC"
}, {
  svc: "Pulmonology",
  who: "Dr. Maria Lopez",
  initials: "ML"
}, {
  svc: "Nephrology",
  who: "Dr. James Liu",
  initials: "JL"
}, {
  svc: "Endocrine",
  who: "Dr. Nadia Farouk",
  initials: "NF"
}, {
  svc: "Neurology",
  who: "Dr. Lena Ortiz",
  initials: "LO"
}, {
  svc: "GI",
  who: "Dr. Ruth Kim",
  initials: "RK"
}, {
  svc: "Infectious Disease",
  who: "Dr. Omar Haddad",
  initials: "OH"
}];
function ERIntakeScreen() {
  const [sent, setSent] = React.useState([{
    initials: "MJ",
    who: "Dr. Amir Patel",
    svc: "Hospital Medicine",
    consults: ["Cardiology"],
    issue: "NSTEMI, troponin trending",
    time: "08:41",
    status: "accepted"
  }, {
    initials: "RV",
    who: "Dr. Maria Lopez",
    svc: "Pulmonology",
    consults: [],
    issue: "COPD exacerbation",
    time: "07:55",
    status: "sent"
  }, {
    initials: "DK",
    who: "Dr. Sarah Chen",
    svc: "Cardiology",
    consults: [],
    issue: "Syncope workup",
    time: "Yest",
    status: "accepted"
  }]);
  const [note, setNote] = React.useState("Pt A.B., room 412, chest pain with SOB on exertion");
  const [service, setService] = React.useState("Hospital Medicine"); // primary service to route to
  const [consults, setConsults] = React.useState([]); // additional specialists
  const ST = {
    accepted: ["accepted", "Accepted"],
    sent: ["pending", "Routing"],
    rejected: ["rejected", "Re-routed"]
  };
  const toggleConsult = svc => setConsults(cs => cs.includes(svc) ? cs.filter(c => c !== svc) : [...cs, svc]);
  const route = () => {
    var text = note.trim();
    if (!text) {
      window.__mtoast("Add a patient note first");
      return;
    }
    var im = text.match(/\b([A-Z])\.?\s?([A-Z])\b/);
    var initials = im ? im[1] + im[2] : (text.match(/\b[A-Z][a-z]+\b/g) || ["A", "B"]).slice(0, 2).map(function (w) {
      return w[0];
    }).join("");
    var issue = text.split(/[,.—;]/).slice(1).join(", ").trim() || text;
    var svcDef = ER_SERVICES.find(s => s.svc === service) || ER_SERVICES[0];
    setSent(function (s) {
      return [{
        initials: initials.toUpperCase().slice(0, 2),
        who: svcDef.who,
        svc: service,
        consults: consults.slice(),
        issue: issue.charAt(0).toUpperCase() + issue.slice(1),
        time: "now",
        status: "sent"
      }].concat(s);
    });
    setNote("");
    setConsults([]);
    window.__mtoast("Routed to " + svcDef.who + " · " + service + (consults.length ? " (+" + consults.length + " consult" + (consults.length > 1 ? "s" : "") + ")" : ""));
  };
  const primary = ER_SERVICES.find(s => s.svc === service) || ER_SERVICES[0];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(RHeader, {
    title: "Intake",
    action: /*#__PURE__*/React.createElement("button", {
      onClick: route,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 13px",
        borderRadius: 99,
        border: "none",
        background: "var(--primary)",
        color: "#fff",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: "plus",
      size: 16,
      color: "#fff"
    }), "Admit")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      padding: 15,
      boxShadow: "var(--shadow-sm)",
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "sparkles",
    size: 15,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 700
    }
  }, "New admission")), /*#__PURE__*/React.createElement("textarea", {
    value: note,
    onChange: e => setNote(e.target.value),
    placeholder: "Type the admission note\u2026",
    style: {
      width: "100%",
      minHeight: 56,
      background: "var(--secondary)",
      borderRadius: 11,
      padding: "10px 12px",
      fontSize: 13.5,
      color: "var(--foreground)",
      lineHeight: 1.4,
      border: "none",
      outline: "none",
      resize: "none",
      fontFamily: "inherit",
      boxSizing: "border-box"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: ".03em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, "Route to"), primary.rr && /*#__PURE__*/React.createElement(MBadge, {
    status: "sent",
    icon: "route"
  }, "Round-robin")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 7,
      overflowX: "auto",
      paddingBottom: 2,
      margin: "0 -2px"
    }
  }, ER_SERVICES.map(s => {
    const on = s.svc === service;
    return /*#__PURE__*/React.createElement("button", {
      key: s.svc,
      onClick: () => setService(s.svc),
      style: {
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 99,
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
        border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
        background: on ? "var(--primary)" : "#fff",
        color: on ? "#fff" : "var(--foreground)"
      }
    }, s.svc);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 9,
      padding: "8px 10px",
      background: "var(--secondary)",
      borderRadius: 10
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: primary.initials,
    size: 28,
    tint: "blue"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      whiteSpace: "nowrap"
    }
  }, primary.rr ? "Next up · " + primary.who : primary.who), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--muted-foreground)"
    }
  }, service, primary.rr ? " · lowest census" : " · on call")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: ".03em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, "Add consults"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 7,
      flexWrap: "wrap",
      marginTop: 7
    }
  }, ER_SERVICES.filter(s => s.svc !== service).map(s => {
    const on = consults.includes(s.svc);
    return /*#__PURE__*/React.createElement("button", {
      key: s.svc,
      onClick: () => toggleConsult(s.svc),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 11px",
        borderRadius: 99,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        border: on ? "1px solid var(--status-accepted)" : "1px solid var(--border)",
        background: on ? "var(--status-accepted-bg)" : "#fff",
        color: on ? "var(--status-accepted)" : "var(--muted-foreground)"
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: on ? "check" : "plus",
      size: 12,
      color: on ? "var(--status-accepted)" : "var(--muted-foreground)"
    }), s.svc);
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: route,
    style: {
      width: "100%",
      marginTop: 14,
      height: 44,
      borderRadius: 12,
      border: "none",
      background: "var(--primary)",
      color: "#fff",
      fontSize: 14.5,
      fontWeight: 600,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "wand-sparkles",
    size: 16,
    color: "#fff"
  }), "Extract & route to ", service)), /*#__PURE__*/React.createElement(SectionLabel, {
    right: /*#__PURE__*/React.createElement(MBadge, {
      status: "sent"
    }, sent.length, " today")
  }, "Recently sent"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, sent.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      background: "#fff",
      borderRadius: 14,
      border: "1px solid var(--border)",
      padding: 13,
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: s.initials,
    size: 40,
    tint: "slate"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 600,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, s.issue), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "\u2192 ", s.who, " \xB7 ", s.svc, " \xB7 ", s.time), s.consults && s.consults.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      flexWrap: "wrap",
      marginTop: 5
    }
  }, s.consults.map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      fontSize: 10.5,
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: 99,
      background: "var(--status-active-bg)",
      color: "var(--status-active)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "stethoscope",
    size: 9
  }), c)))), /*#__PURE__*/React.createElement(MBadge, {
    status: ST[s.status][0]
  }, ST[s.status][1]))))));
}

/* ───────────── ER director — ER operations ───────────── */
function ERDirectorScreen() {
  const [divert, setDivert] = React.useState(false);
  const docs = [{
    initials: "RO",
    name: "Dr. Ruth Osei",
    admits: 6,
    working: true
  }, {
    initials: "PO",
    name: "Dr. Paul Okafor",
    admits: 4,
    working: true
  }, {
    initials: "DR",
    name: "Dr. Dana Reyes",
    admits: 5,
    working: true
  }, {
    initials: "SI",
    name: "Dr. Sam Iyer",
    admits: 0,
    working: false
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(RHeader, {
    title: "ER ops"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "12px 13px",
      borderRadius: 14,
      marginBottom: 16,
      background: divert ? "var(--status-rejected-bg)" : "var(--status-accepted-bg)",
      border: `1px solid ${divert ? "var(--status-rejected)" : "var(--status-accepted)"}`
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: divert ? "octagon-alert" : "circle-check-big",
    size: 20,
    color: divert ? "var(--status-rejected)" : "var(--status-accepted)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      color: divert ? "var(--status-rejected)" : "var(--status-accepted)"
    }
  }, divert ? "On diversion" : "Accepting patients"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, divert ? "Ambulances diverted" : "Normal operations")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setDivert(!divert),
    style: {
      width: 46,
      height: 28,
      borderRadius: 99,
      border: "none",
      position: "relative",
      background: divert ? "var(--status-rejected)" : "var(--status-neutral-bg)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 3,
      left: divert ? 21 : 3,
      width: 22,
      height: 22,
      borderRadius: 99,
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      transition: "left .2s"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(MiniTile, {
    label: "Admits today",
    value: "15",
    icon: "clipboard-plus"
  }), /*#__PURE__*/React.createElement(MiniTile, {
    label: "Avg accept",
    value: "4m",
    icon: "timer",
    color: "var(--status-pending)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(MiniTile, {
    label: "Accept rate",
    value: "92%",
    icon: "check-check",
    color: "var(--status-accepted)"
  }), /*#__PURE__*/React.createElement(MiniTile, {
    label: "Pending",
    value: "1",
    icon: "loader",
    color: "var(--status-neutral)"
  })), /*#__PURE__*/React.createElement(SectionLabel, {
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "var(--muted-foreground)"
      }
    }, "3 on shift")
  }, "ER physicians"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      overflow: "hidden",
      boxShadow: "var(--shadow-sm)"
    }
  }, docs.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      padding: "11px 14px",
      borderTop: i ? "1px solid var(--border)" : "none",
      opacity: d.working ? 1 : 0.6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: d.initials,
    size: 38,
    tint: d.working ? "blue" : "slate"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      bottom: 0,
      right: 0,
      border: "2px solid #fff",
      borderRadius: 99
    }
  }, /*#__PURE__*/React.createElement(Dot, {
    status: d.working ? "accepted" : "offline"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 600
    }
  }, d.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, d.admits, " admit", d.admits === 1 ? "" : "s", " today")), /*#__PURE__*/React.createElement(MBadge, {
    status: d.working ? "accepted" : "offline"
  }, d.working ? "On" : "Off"))))));
}

/* ───────────── Hospitalist director — Overview ─────────────
   Full parity with the web director dashboard: shift providers on/off,
   take them in/out of round-robin, adjust census/cap, bulk on/off, add
   provider — with a live "next up = lowest-census eligible" queue. */

// Compact ± stepper for census / cap.
function MStepper({
  label,
  value,
  onDec,
  onInc,
  min = 0
}) {
  const btn = dis => ({
    width: 26,
    height: 26,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: dis ? "var(--secondary)" : "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    cursor: dis ? "default" : "pointer",
    opacity: dis ? 0.45 : 1
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9.5,
      fontWeight: 700,
      letterSpacing: ".05em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => value > min && onDec(),
    style: btn(value <= min)
  }, /*#__PURE__*/React.createElement(MI, {
    name: "minus",
    size: 13,
    color: "var(--foreground)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      minWidth: 18,
      textAlign: "center",
      fontVariantNumeric: "tabular-nums"
    }
  }, value), /*#__PURE__*/React.createElement("button", {
    onClick: onInc,
    style: btn(false)
  }, /*#__PURE__*/React.createElement(MI, {
    name: "plus",
    size: 13,
    color: "var(--foreground)"
  }))));
}

// On/off pill toggle.
function MToggle({
  on,
  onClick,
  color = "var(--status-accepted)"
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      width: 44,
      height: 26,
      borderRadius: 99,
      border: "none",
      position: "relative",
      flex: "none",
      cursor: "pointer",
      background: on ? color : "var(--status-neutral-bg)",
      transition: "background .2s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 3,
      left: on ? 21 : 3,
      width: 20,
      height: 20,
      borderRadius: 99,
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      transition: "left .2s"
    }
  }));
}
const DIRECTOR_SEED = [{
  id: "p1",
  initials: "SC",
  name: "Dr. Sarah Chen",
  specialty: "Cardiology",
  census: 3,
  cap: 12,
  working: true,
  inRotation: true,
  shift: "Day call"
}, {
  id: "p2",
  initials: "AP",
  name: "Dr. Amir Patel",
  specialty: "Hospital Medicine",
  census: 5,
  cap: 12,
  working: true,
  inRotation: true,
  shift: "Day call"
}, {
  id: "p3",
  initials: "ML",
  name: "Dr. Maria Lopez",
  specialty: "Pulmonology",
  census: 7,
  cap: 10,
  working: true,
  inRotation: true,
  shift: "Swing"
}, {
  id: "p4",
  initials: "OH",
  name: "Dr. Omar Haddad",
  specialty: "Infectious Disease",
  census: 4,
  cap: 10,
  working: true,
  inRotation: false,
  shift: "Day call"
}, {
  id: "p5",
  initials: "LO",
  name: "Dr. Lena Ortiz",
  specialty: "Neurology",
  census: 6,
  cap: 12,
  working: true,
  inRotation: true,
  shift: "Nights"
}, {
  id: "p6",
  initials: "JL",
  name: "Dr. James Liu",
  specialty: "Nephrology",
  census: 2,
  cap: 8,
  working: false,
  inRotation: false,
  shift: "Off"
}];
function DirectorScreen() {
  const [providers, setProviders] = React.useState(DIRECTOR_SEED);
  const [syncLabel, setSyncLabel] = React.useState("2m ago");
  const [syncing, setSyncing] = React.useState(false);
  const syncNow = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      setSyncLabel("just now");
      window.__mtoast && window.__mtoast("On-call schedule synced from Amion");
    }, 900);
  };
  const update = (id, patch) => setProviders(ps => ps.map(p => p.id === id ? {
    ...p,
    ...patch
  } : p));
  const adjust = (id, key, delta) => setProviders(ps => ps.map(p => p.id === id ? {
    ...p,
    [key]: Math.max(0, p[key] + delta)
  } : p));
  const toggleWorking = id => setProviders(ps => ps.map(p => p.id === id ? {
    ...p,
    working: !p.working,
    inRotation: !p.working ? p.inRotation : false
  } : p));
  const toggleRotation = id => setProviders(ps => ps.map(p => p.id === id && p.working ? {
    ...p,
    inRotation: !p.inRotation
  } : p));
  const bulk = val => setProviders(ps => ps.map(p => ({
    ...p,
    working: val,
    inRotation: val ? p.inRotation : false
  })));
  const onShift = providers.filter(p => p.working);
  const eligible = providers.filter(p => p.working && p.inRotation);
  // Round-robin: lowest census on shift & in rotation is next; ties broken by roster order.
  const queue = [...eligible].sort((a, b) => a.census - b.census || providers.indexOf(a) - providers.indexOf(b));
  const nextUp = queue[0];
  const totalCensus = providers.reduce((a, p) => a + p.census, 0);
  const totalCap = providers.reduce((a, p) => a + p.cap, 0);
  const allOn = providers.length > 0 && onShift.length === providers.length;
  const allOff = onShift.length === 0;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(RHeader, {
    title: "Overview",
    sub: "Hospitalist group \xB7 Mayo General",
    action: /*#__PURE__*/React.createElement("button", {
      onClick: () => window.__mtoast("Add provider"),
      style: {
        width: 38,
        height: 38,
        borderRadius: 99,
        border: "1px solid var(--border)",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: "user-plus",
      size: 17,
      color: "var(--primary)"
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(MiniTile, {
    label: "On shift",
    value: onShift.length,
    icon: "activity",
    color: "var(--status-accepted)"
  }), /*#__PURE__*/React.createElement(MiniTile, {
    label: "In rotation",
    value: eligible.length,
    icon: "route",
    color: "var(--status-pending)"
  }), /*#__PURE__*/React.createElement(MiniTile, {
    label: "Census",
    value: totalCensus + "/" + totalCap,
    icon: "bed-double",
    color: "var(--status-neutral)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow-sm)",
      padding: 14,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: 9,
      background: "var(--secondary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "calendar-clock",
    size: 18,
    color: "var(--primary)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, "On-call schedule", /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      fontSize: 10.5,
      fontWeight: 700,
      color: "var(--status-accepted)",
      background: "var(--status-accepted-bg)",
      padding: "2px 7px",
      borderRadius: 99
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 99,
      background: "var(--status-accepted)",
      flex: "none"
    }
  }), "Amion")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, "Synced via API \xB7 ", syncLabel)), /*#__PURE__*/React.createElement("button", {
    onClick: syncNow,
    disabled: syncing,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 5,
      padding: "7px 11px",
      borderRadius: 99,
      border: "1px solid var(--border)",
      background: "#fff",
      fontSize: 12,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      cursor: syncing ? "default" : "pointer",
      flex: "none",
      color: "var(--foreground)",
      opacity: syncing ? 0.6 : 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      animation: syncing ? "dt-spin .9s linear infinite" : "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "refresh-cw",
    size: 13,
    color: "var(--primary)"
  })), syncing ? "Syncing" : "Sync")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 7,
      marginTop: 12
    }
  }, [["Day call", "amber"], ["Swing", "blue"], ["Nights", "slate"]].map(([label, tint]) => {
    const c = {
      amber: "var(--status-pending)",
      blue: "var(--primary)",
      slate: "var(--status-neutral)"
    }[tint];
    const n = providers.filter(p => p.shift === label).length;
    return /*#__PURE__*/React.createElement("div", {
      key: label,
      style: {
        flex: 1,
        borderRadius: 11,
        border: "1px solid var(--border)",
        padding: "9px 10px",
        background: "var(--secondary)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 7,
        height: 7,
        borderRadius: 99,
        background: c,
        flex: "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 1
      }
    }, n)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--muted-foreground)",
        marginTop: 4
      }
    }, label));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 11,
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      lineHeight: 1.45
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "info",
    size: 13,
    color: "var(--muted-foreground)",
    style: {
      marginTop: 1
    }
  }), "Rotation pool follows the live schedule. Toggle a provider below to override locally for this shift.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => bulk(true),
    disabled: allOn,
    style: {
      flex: 1,
      height: 38,
      borderRadius: 10,
      border: "1px solid var(--border)",
      background: "#fff",
      fontSize: 13,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      cursor: allOn ? "default" : "pointer",
      opacity: allOn ? 0.45 : 1,
      color: "var(--foreground)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "toggle-right",
    size: 16,
    color: "var(--status-accepted)"
  }), "All on shift"), /*#__PURE__*/React.createElement("button", {
    onClick: () => bulk(false),
    disabled: allOff,
    style: {
      flex: 1,
      height: 38,
      borderRadius: 10,
      border: "1px solid var(--border)",
      background: "#fff",
      fontSize: 13,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      cursor: allOff ? "default" : "pointer",
      opacity: allOff ? 0.45 : 1,
      color: "var(--foreground)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "toggle-left",
    size: 16,
    color: "var(--status-neutral)"
  }), "All off")), /*#__PURE__*/React.createElement(SectionLabel, {
    right: /*#__PURE__*/React.createElement(MBadge, {
      status: "sent"
    }, queue.length, " in queue")
  }, "Round-robin order"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow-sm)",
      padding: 14,
      marginBottom: 20
    }
  }, nextUp ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      marginBottom: 12,
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "info",
    size: 13,
    color: "var(--muted-foreground)"
  }), "Next admit \u2192 lowest-census eligible provider"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, queue.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: i === 0 ? "9px 11px" : "5px 11px 5px 0",
      borderRadius: 11,
      background: i === 0 ? "var(--primary-tint, #EFF6FF)" : "transparent",
      border: i === 0 ? "1px solid var(--primary)" : "1px solid transparent"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 22,
      fontSize: 13,
      fontWeight: 700,
      color: i === 0 ? "var(--primary)" : "var(--muted-foreground)",
      textAlign: "center",
      flex: "none"
    }
  }, i + 1), /*#__PURE__*/React.createElement(MAvatar, {
    initials: p.initials,
    size: i === 0 ? 38 : 32,
    tint: i === 0 ? "blue" : "slate"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      display: "flex",
      alignItems: "center",
      gap: 7,
      whiteSpace: "nowrap"
    }
  }, p.name, i === 0 && /*#__PURE__*/React.createElement(MBadge, {
    status: "sent"
  }, "Next")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, p.specialty, " \xB7 ", p.census, "/", p.cap)))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      padding: "10px 0",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "route-off",
    size: 20,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      marginTop: 6
    }
  }, "No one in rotation"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12
    }
  }, "Put a provider on shift & in rotation."))), /*#__PURE__*/React.createElement(SectionLabel, {
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "var(--muted-foreground)"
      }
    }, providers.length, " providers")
  }, "Providers"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, providers.map(p => {
    const isNext = nextUp && p.id === nextUp.id;
    return /*#__PURE__*/React.createElement("div", {
      key: p.id,
      style: {
        background: "#fff",
        borderRadius: 14,
        border: `1px solid ${isNext ? "var(--primary)" : "var(--border)"}`,
        boxShadow: "var(--shadow-sm)",
        padding: 12,
        opacity: p.working ? 1 : 0.62
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 11,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(MAvatar, {
      initials: p.initials,
      size: 38,
      tint: p.working ? "emerald" : "slate"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        bottom: 0,
        right: 0,
        border: "2px solid #fff",
        borderRadius: 99
      }
    }, /*#__PURE__*/React.createElement(Dot, {
      status: p.working ? "accepted" : "offline",
      pulse: p.working
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14.5,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap"
      }
    }, p.name, isNext && /*#__PURE__*/React.createElement(MBadge, {
      status: "sent"
    }, "Next")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)",
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, p.specialty, p.shift && p.shift !== "Off" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      style: {
        opacity: 0.5
      }
    }, "\xB7"), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 3
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: "calendar-clock",
      size: 10,
      color: "var(--muted-foreground)"
    }), p.shift)))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        color: "var(--muted-foreground)"
      }
    }, "Shift"), /*#__PURE__*/React.createElement(MToggle, {
      on: p.working,
      onClick: () => toggleWorking(p.id)
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginTop: 11,
        paddingTop: 11,
        borderTop: "1px solid var(--border)"
      }
    }, /*#__PURE__*/React.createElement(MStepper, {
      label: "Census",
      value: p.census,
      onDec: () => adjust(p.id, "census", -1),
      onInc: () => adjust(p.id, "census", 1)
    }), /*#__PURE__*/React.createElement(MStepper, {
      label: "Cap",
      value: p.cap,
      onDec: () => adjust(p.id, "cap", -1),
      onInc: () => adjust(p.id, "cap", 1),
      min: 1
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => toggleRotation(p.id),
      disabled: !p.working,
      style: {
        marginLeft: "auto",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "7px 12px",
        borderRadius: 99,
        cursor: p.working ? "pointer" : "default",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        border: `1px solid ${p.inRotation ? "var(--primary)" : "var(--border)"}`,
        background: p.inRotation ? "var(--primary-tint, #EFF6FF)" : "#fff",
        color: p.inRotation ? "var(--primary)" : "var(--muted-foreground)",
        opacity: p.working ? 1 : 0.6
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: p.inRotation ? "route" : "route-off",
      size: 13,
      color: p.inRotation ? "var(--primary)" : "var(--muted-foreground)"
    }), p.inRotation ? "In rotation" : "Off rotation")));
  }))));
}

/* ───────────── Developer — impersonation (mirror a user's portal) ───────────── */
const IMPERSONATE_TARGETS = [{
  role: "hospitalist",
  name: "Dr. Jordan Chen",
  initials: "JC",
  sub: "Hospitalist · Mayo General",
  tint: "blue"
}, {
  role: "er_doctor",
  name: "Dr. Ruth Osei",
  initials: "RO",
  sub: "ER physician · St. Jude",
  tint: "amber"
}, {
  role: "director",
  name: "Karen Vance",
  initials: "KV",
  sub: "Hospitalist director · Mayo",
  tint: "emerald"
}];
function ImpersonationView({
  target,
  onExit
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0F766E",
      color: "#fff",
      padding: "52px 14px 11px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      position: "sticky",
      top: 0,
      zIndex: 30
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "eye",
    size: 17,
    color: "#fff"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "Viewing as ", target.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      opacity: 0.85
    }
  }, "Read-only mirror \xB7 audited")), /*#__PURE__*/React.createElement("button", {
    onClick: onExit,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 5,
      padding: "7px 13px",
      borderRadius: 99,
      border: "none",
      background: "rgba(255,255,255,.18)",
      color: "#fff",
      fontSize: 12.5,
      fontWeight: 700,
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "x",
    size: 14,
    color: "#fff"
  }), "Exit")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: "auto",
      background: "#F2F4F8",
      pointerEvents: "none"
    }
  }, roleHome(target.role)));
}

/* ───────────── Developer — incidents / on-call paging ─────────────
   The dev's comms surface — not clinical messaging. System & security incidents
   they get paged on, with acknowledge / resolve. */
function DevIncidentsScreen() {
  const SEV = {
    sev1: ["rejected", "SEV-1"],
    sev2: ["pending", "SEV-2"],
    sev3: ["sent", "SEV-3"]
  };
  const [items, setItems] = React.useState([{
    id: "i1",
    sev: "sev1",
    title: "WebSocket reconnect storm",
    detail: "Cleveland Care · push fan-out degraded",
    time: "3m",
    state: "open"
  }, {
    id: "i2",
    sev: "sev2",
    title: "DB pool saturation 88%",
    detail: "Primary · approaching connection cap",
    time: "21m",
    state: "ack"
  }, {
    id: "i3",
    sev: "sev3",
    title: "Push delivery failures → SMS",
    detail: "Pinecrest · FCM token churn",
    time: "54m",
    state: "open"
  }, {
    id: "i4",
    sev: "sev2",
    title: "Elevated 5xx on /api/assignments",
    detail: "Mayo General · 0.4% error rate",
    time: "1h",
    state: "ack"
  }]);
  const [resolved, setResolved] = React.useState([{
    id: "r1",
    sev: "sev3",
    title: "Cron lag on rotation recompute",
    detail: "St. Jude · cleared",
    time: "2h"
  }]);
  const open = items.filter(i => i.state === "open");
  const ack = id => setItems(xs => xs.map(i => i.id === id ? {
    ...i,
    state: "ack"
  } : i));
  const resolve = id => setItems(xs => {
    const it = xs.find(i => i.id === id);
    if (it) setResolved(r => [{
      ...it,
      detail: it.detail.split(" · ")[0] + " · cleared",
      time: "now"
    }, ...r]);
    return xs.filter(i => i.id !== id);
  });
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(RHeader, {
    title: "Incidents",
    sub: "Platform paging \xB7 cross-tenant",
    action: /*#__PURE__*/React.createElement(MBadge, {
      status: open.length ? "rejected" : "accepted",
      icon: open.length ? "siren" : "circle-check-big"
    }, open.length ? open.length + " open" : "All clear")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, {
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "var(--muted-foreground)"
      }
    }, items.length, " active")
  }, "Active"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      marginBottom: 20
    }
  }, items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      background: "#fff",
      borderRadius: 14,
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow-sm)",
      padding: 13,
      borderLeft: `3px solid ${it.sev === "sev1" ? "var(--status-rejected)" : it.sev === "sev2" ? "var(--status-pending)" : "var(--status-active)"}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 5
    }
  }, /*#__PURE__*/React.createElement(MBadge, {
    status: SEV[it.sev][0]
  }, SEV[it.sev][1]), it.state === "ack" && /*#__PURE__*/React.createElement(MBadge, {
    status: "offline",
    icon: "eye"
  }, "Acked"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      display: "inline-flex",
      alignItems: "center",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "clock",
    size: 11
  }), it.time)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 700
    }
  }, it.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      marginTop: 1
    }
  }, it.detail), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 11
    }
  }, it.state === "open" && /*#__PURE__*/React.createElement("button", {
    onClick: () => ack(it.id),
    style: {
      flex: 1,
      height: 36,
      borderRadius: 10,
      border: "1px solid var(--border)",
      background: "#fff",
      fontSize: 13,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      cursor: "pointer",
      color: "var(--foreground)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "eye",
    size: 14
  }), "Acknowledge"), /*#__PURE__*/React.createElement("button", {
    onClick: () => resolve(it.id),
    style: {
      flex: 1,
      height: 36,
      borderRadius: 10,
      border: "none",
      background: "var(--primary)",
      color: "#fff",
      fontSize: 13,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "check",
    size: 14,
    color: "#fff"
  }), "Resolve")))), items.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 14,
      border: "1px solid var(--border)",
      padding: 26,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "circle-check-big",
    size: 24,
    color: "var(--status-accepted)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      marginTop: 8
    }
  }, "All clear"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, "No active incidents across tenants."))), /*#__PURE__*/React.createElement(SectionLabel, {
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "var(--muted-foreground)"
      }
    }, resolved.length)
  }, "Recently resolved"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      overflow: "hidden",
      boxShadow: "var(--shadow-sm)"
    }
  }, resolved.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      display: "flex",
      gap: 11,
      alignItems: "center",
      padding: "11px 14px",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 99,
      background: "var(--status-accepted-bg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "check",
    size: 15,
    color: "var(--status-accepted)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, it.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, it.detail)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }, it.time))))));
}

/* ───────────── Developer — diagnostics & audit logs ───────────── */
function DevLogsScreen() {
  const FILTERS = ["All", "Audit", "PHI", "Errors"];
  const [filter, setFilter] = React.useState("All");
  const logs = [{
    kind: "PHI",
    icon: "file-lock-2",
    color: "var(--status-pending)",
    action: "PHI access · patient 4182",
    who: "Alex Kim (dev)",
    org: "MAYO",
    time: "12:04:51"
  }, {
    kind: "Errors",
    icon: "triangle-alert",
    color: "var(--status-rejected)",
    action: "WS reconnect storm",
    who: "system",
    org: "CLEVE",
    time: "11:58:20"
  }, {
    kind: "Audit",
    icon: "shield-check",
    color: "var(--status-accepted)",
    action: "Reassign override",
    who: "Karen Vance",
    org: "MAYO",
    time: "11:46:09"
  }, {
    kind: "Audit",
    icon: "log-in",
    color: "var(--primary)",
    action: "Login · TOTP + SMS",
    who: "Dr. Ruth Osei",
    org: "STJUDE",
    time: "11:31:55"
  }, {
    kind: "PHI",
    icon: "file-lock-2",
    color: "var(--status-pending)",
    action: "Chart export",
    who: "Dr. Amir Patel",
    org: "MAYO",
    time: "11:12:33"
  }, {
    kind: "Errors",
    icon: "triangle-alert",
    color: "var(--status-rejected)",
    action: "Push delivery failed → SMS",
    who: "system",
    org: "PINE",
    time: "10:59:01"
  }, {
    kind: "Audit",
    icon: "route",
    color: "var(--primary)",
    action: "Round-robin config changed",
    who: "Karen Vance",
    org: "MAYO",
    time: "10:40:18"
  }];
  const list = filter === "All" ? logs : logs.filter(l => l.kind === filter);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(RHeader, {
    title: "Logs",
    sub: "Diagnostics \xB7 audit \xB7 PHI access"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 16px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 7,
      marginBottom: 14,
      overflowX: "auto"
    }
  }, FILTERS.map(f => {
    const on = f === filter;
    return /*#__PURE__*/React.createElement("button", {
      key: f,
      onClick: () => setFilter(f),
      style: {
        padding: "6px 14px",
        borderRadius: 99,
        border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
        background: on ? "var(--primary)" : "#fff",
        color: on ? "#fff" : "var(--foreground)",
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        cursor: "pointer",
        flex: "none"
      }
    }, f);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      overflow: "hidden",
      boxShadow: "var(--shadow-sm)"
    }
  }, list.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 11,
      alignItems: "center",
      padding: "11px 14px",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 9,
      background: "var(--secondary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: l.icon,
    size: 16,
    color: l.color
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, l.action), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, l.who, " \xB7 ", l.org)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--muted-foreground)",
      fontVariantNumeric: "tabular-nums",
      flex: "none"
    }
  }, l.time))))));
}

/* ───────────── Developer — Platform ───────────── */
function DeveloperScreen() {
  const [impersonating, setImpersonating] = React.useState(null);
  const orgs = [{
    code: "MA",
    name: "Mayo General",
    users: 142,
    active: true,
    tint: "blue"
  }, {
    code: "ST",
    name: "St. Jude Medical",
    users: 96,
    active: true,
    tint: "emerald"
  }, {
    code: "CL",
    name: "Cleveland Care",
    users: 211,
    active: true,
    tint: "amber"
  }, {
    code: "PI",
    name: "Pinecrest Regional",
    users: 38,
    active: false,
    tint: "slate"
  }];
  const health = [["API latency", 78, "var(--status-accepted)"], ["WebSocket", 64, "var(--primary)"], ["DB pool", 88, "var(--status-pending)"]];
  if (impersonating) return /*#__PURE__*/React.createElement(ImpersonationView, {
    target: impersonating,
    onExit: () => setImpersonating(null)
  });
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(RHeader, {
    title: "Platform",
    sub: "Cross-tenant operations"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(MiniTile, {
    label: "Tenants",
    value: "5",
    icon: "building-2"
  }), /*#__PURE__*/React.createElement(MiniTile, {
    label: "Users",
    value: "554",
    icon: "users",
    color: "var(--status-accepted)"
  }), /*#__PURE__*/React.createElement(MiniTile, {
    label: "Uptime",
    value: "99.9%",
    icon: "activity",
    color: "var(--status-neutral)"
  })), /*#__PURE__*/React.createElement(SectionLabel, null, "System health"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      padding: 14,
      boxShadow: "var(--shadow-sm)",
      marginBottom: 18,
      display: "flex",
      flexDirection: "column",
      gap: 11
    }
  }, health.map(([l, v, c], i) => /*#__PURE__*/React.createElement("div", {
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 12.5,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--muted-foreground)"
    }
  }, l), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, v, "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      borderRadius: 99,
      background: "var(--secondary)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${v}%`,
      height: "100%",
      background: c
    }
  }))))), /*#__PURE__*/React.createElement(SectionLabel, {
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "var(--muted-foreground)"
      }
    }, "5 orgs")
  }, "Organizations"), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      overflow: "hidden",
      boxShadow: "var(--shadow-sm)",
      marginBottom: 20
    }
  }, orgs.map((o, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      padding: "11px 14px",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: o.code,
    size: 36,
    tint: o.tint
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 600
    }
  }, o.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, o.users, " users")), /*#__PURE__*/React.createElement(MBadge, {
    status: o.active ? "accepted" : "offline"
  }, o.active ? "Active" : "Off")))), /*#__PURE__*/React.createElement(SectionLabel, {
    right: /*#__PURE__*/React.createElement(MBadge, {
      status: "pending",
      icon: "shield"
    }, "Audited")
  }, "Impersonate"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      margin: "0 2px 10px",
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "info",
    size: 13,
    color: "var(--muted-foreground)"
  }), "Open a user's portal read-only to reproduce an issue."), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      overflow: "hidden",
      boxShadow: "var(--shadow-sm)"
    }
  }, IMPERSONATE_TARGETS.map((t, i) => /*#__PURE__*/React.createElement("button", {
    key: t.role,
    onClick: () => setImpersonating(t),
    style: {
      width: "100%",
      textAlign: "left",
      display: "flex",
      gap: 12,
      alignItems: "center",
      padding: "11px 14px",
      borderTop: i ? "1px solid var(--border)" : "none",
      background: "transparent",
      border: "none",
      borderTopColor: "var(--border)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: t.initials,
    size: 36,
    tint: t.tint
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 600
    }
  }, t.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, t.sub)), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 12.5,
      fontWeight: 600,
      color: "#0F766E",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "eye",
    size: 14,
    color: "#0F766E"
  }), "View as"))))));
}

/* role → { home screen, tab set }. Every role shares Messages / On-call / Directory /
   Profile (condensed, mirrors the web app); only the home tab differs. */
const SHARED_TABS = [["messages", "Messages", "message-square"], ["team", "On call", "users"], ["directory", "Directory", "contact"], ["profile", "Profile", "user"]];
const ROLE_CONFIG = {
  hospitalist: {
    label: "Hospitalist",
    tint: "#2563EB",
    tabs: [["home", "Dashboard", "layout-dashboard"]].concat(SHARED_TABS)
  },
  er_doctor: {
    label: "ER physician",
    tint: "#D97706",
    tabs: [["home", "Intake", "clipboard-plus"]].concat(SHARED_TABS)
  },
  er_director: {
    label: "ER director",
    tint: "#DC2626",
    tabs: [["home", "ER ops", "ambulance"]].concat(SHARED_TABS)
  },
  director: {
    label: "Hospitalist director",
    tint: "#7C3AED",
    tabs: [["home", "Overview", "layout-dashboard"]].concat(SHARED_TABS)
  },
  // Developer has no clinical shift, directory, or person-to-person messaging.
  // Their surface is operational: Platform (orgs/health/impersonate), Incidents
  // (paging), Logs (audit/diagnostics), Profile.
  developer: {
    label: "Developer",
    tint: "#0F766E",
    tabs: [["home", "Platform", "building-2"], ["incidents", "Incidents", "siren"], ["logs", "Logs", "scroll-text"], ["profile", "Profile", "user"]]
  }
};
const GALLERY_CONVOS = [{
  id: 1,
  name: "Dr. Sarah Chen",
  initials: "SC",
  status: "accepted",
  preview: "Accepting the 412 hand-off now.",
  time: "2m",
  unread: 2,
  tint: "emerald"
}, {
  id: 2,
  name: "ICU Care Team",
  initials: "IC",
  status: "accepted",
  preview: "Bed 3 is open for the next admit.",
  time: "14m",
  unread: 0,
  tint: "blue",
  group: true
}, {
  id: 3,
  name: "Dr. Amir Patel",
  initials: "AP",
  status: "pending",
  preview: "On my way up — give me 5.",
  time: "1h",
  unread: 0,
  tint: "amber"
}, {
  id: 4,
  name: "Emergency broadcast",
  initials: "!",
  status: "rejected",
  preview: "Mass casualty drill at 14:00.",
  time: "3h",
  unread: 0,
  tint: "slate",
  group: true
}];
const ROLE_PROFILE = {
  hospitalist: {
    name: "Dr. Jordan Chen",
    role: "Hospitalist · Cardiology",
    initials: "JC",
    org: "Mercy General · MERCY"
  },
  er_doctor: {
    name: "Dr. Ruth Osei",
    role: "ER physician",
    initials: "RO",
    org: "St. Jude Medical · STJUDE"
  },
  er_director: {
    name: "Dr. Paul Okafor",
    role: "ER director",
    initials: "PO",
    org: "Cleveland Care · CLEVE"
  },
  director: {
    name: "Karen Vance",
    role: "Hospitalist director",
    initials: "KV",
    org: "Mayo General · MAYO"
  },
  developer: {
    name: "Alex Kim",
    role: "Platform developer",
    initials: "AK",
    org: "All organizations"
  }
};
function HospitalistHome() {
  const [pending, setPending] = React.useState([{
    id: "a1",
    initials: "RM",
    room: "318",
    complaint: "Acute abdominal pain",
    via: "Round-robin",
    specialty: "General Med",
    expires: "4:32"
  }, {
    id: "a2",
    initials: "TK",
    room: "205",
    complaint: "Diabetic ketoacidosis",
    via: "Manual",
    specialty: "Endocrine",
    expires: "7:10"
  }]);
  const [census, setCensus] = React.useState(3);
  const [working, setWorking] = React.useState(true);
  const accept = id => {
    setPending(ps => ps.filter(p => p.id !== id));
    setCensus(c => c + 1);
  };
  const decline = id => setPending(ps => ps.filter(p => p.id !== id));
  return /*#__PURE__*/React.createElement(DashboardScreen, {
    pending: pending,
    onAccept: accept,
    onDecline: decline,
    working: working,
    setWorking: setWorking,
    census: census
  });
}
function roleTab(role, tab) {
  if (tab === "messages") return /*#__PURE__*/React.createElement(MessagesScreen, {
    convos: GALLERY_CONVOS
  });
  if (tab === "incidents") return /*#__PURE__*/React.createElement(DevIncidentsScreen, null);
  if (tab === "logs") return /*#__PURE__*/React.createElement(DevLogsScreen, null);
  if (tab === "team") return /*#__PURE__*/React.createElement(TeamScreen, {
    providers: []
  });
  if (tab === "directory") return /*#__PURE__*/React.createElement(DirectoryScreen, {
    providers: []
  });
  if (tab === "profile") return /*#__PURE__*/React.createElement(ProfileScreen, {
    profile: ROLE_PROFILE[role]
  });
  return roleHome(role);
}
function RoleTabBar({
  tabs,
  active,
  onTab,
  badge
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "sticky",
      bottom: 0,
      zIndex: 10,
      display: "flex",
      background: "rgba(255,255,255,.94)",
      backdropFilter: "blur(12px)",
      borderTop: "1px solid var(--border)",
      padding: "8px 6px 26px"
    }
  }, tabs.map(([id, label, icon]) => {
    const on = active === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => onTab && onTab(id),
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "4px 0",
        position: "relative",
        border: "none",
        background: "transparent",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "relative"
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: icon,
      size: 23,
      color: on ? "var(--primary)" : "var(--status-neutral)",
      strokeWidth: on ? 2.4 : 2
    }), id === "messages" && badge > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        top: -4,
        right: -7,
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        borderRadius: 99,
        background: "var(--destructive)",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, badge)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10.5,
        fontWeight: 600,
        color: on ? "var(--primary)" : "var(--status-neutral)"
      }
    }, label));
  }));
}
function roleHome(role) {
  if (role === "er_doctor") return /*#__PURE__*/React.createElement(ERIntakeScreen, null);
  if (role === "er_director") return /*#__PURE__*/React.createElement(ERDirectorScreen, null);
  if (role === "director") return /*#__PURE__*/React.createElement(DirectorScreen, null);
  if (role === "developer") return /*#__PURE__*/React.createElement(DeveloperScreen, null);
  return /*#__PURE__*/React.createElement(HospitalistHome, null);
}
Object.assign(window, {
  ERIntakeScreen,
  ERDirectorScreen,
  DirectorScreen,
  DeveloperScreen,
  DevLogsScreen,
  DevIncidentsScreen,
  ImpersonationView,
  ROLE_CONFIG,
  RoleTabBar,
  roleHome,
  roleTab,
  RHeader
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mobile/roles.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mobile/screens.jsx
try { (() => {
/* DocTurn mobile app (Expo / RN) — UI kit screens.
   Rendered inside the IOSDevice frame. Bottom-tab navigation. */

function MI({
  name,
  size = 20,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = `<i data-lucide="${name}"></i>`;
    window.lucide.createIcons({
      attrs: {
        width: size,
        height: size,
        "stroke-width": strokeWidth
      },
      root: host
    });
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      display: "inline-flex",
      alignItems: "center",
      color,
      flex: "none",
      ...style
    }
  });
}
const SB = {
  pending: ["var(--status-pending-bg)", "var(--status-pending)"],
  accepted: ["var(--status-accepted-bg)", "var(--status-accepted)"],
  sent: ["var(--status-active-bg)", "var(--status-active)"],
  rejected: ["var(--status-rejected-bg)", "var(--status-rejected)"],
  offline: ["var(--status-neutral-bg)", "var(--status-neutral)"]
};

// Lightweight in-device toast (vanilla DOM, works in any frame).
window.__mtoast = function (msg) {
  var host = document.body;
  var t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "position:fixed;left:50%;bottom:120px;transform:translateX(-50%) translateY(8px);z-index:9999;background:#1E293B;color:#fff;font-family:var(--font-sans);font-size:14px;font-weight:600;padding:11px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .2s, transform .2s;pointer-events:none;max-width:80vw;text-align:center;";
  host.appendChild(t);
  requestAnimationFrame(function () {
    t.style.opacity = "1";
    t.style.transform = "translateX(-50%) translateY(0)";
  });
  setTimeout(function () {
    t.style.opacity = "0";
    t.style.transform = "translateX(-50%) translateY(8px)";
    setTimeout(function () {
      t.remove();
    }, 250);
  }, 1700);
};
function MBadge({
  status,
  children,
  icon
}) {
  const [bg, fg] = SB[status] || SB.offline;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 9px",
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 600,
      background: bg,
      color: fg,
      whiteSpace: "nowrap"
    }
  }, icon && /*#__PURE__*/React.createElement(MI, {
    name: icon,
    size: 11
  }), children);
}
function MAvatar({
  initials,
  size = 44,
  tint = "blue"
}) {
  const t = {
    blue: ["#DBEAFE", "var(--primary)"],
    emerald: ["var(--status-accepted-bg)", "var(--status-accepted)"],
    amber: ["var(--status-pending-bg)", "var(--status-pending)"],
    slate: ["var(--status-neutral-bg)", "var(--status-neutral)"]
  }[tint];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: 99,
      background: t[0],
      color: t[1],
      fontWeight: 700,
      fontSize: size * 0.36,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, initials);
}
function Dot({
  status = "offline",
  pulse
}) {
  const fg = (SB[status] || SB.offline)[1];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      width: 10,
      height: 10,
      display: "inline-block",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: 99,
      background: fg
    }
  }), pulse && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: 99,
      background: fg,
      animation: "dt-pulse 1.5s infinite"
    }
  }));
}
function Header({
  title,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "56px 20px 12px",
      background: "#fff",
      position: "sticky",
      top: 0,
      zIndex: 5,
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 28,
      fontWeight: 700,
      margin: 0,
      letterSpacing: "-0.02em",
      whiteSpace: "nowrap"
    }
  }, title), action));
}

/* ---------- Screens ---------- */

function DashboardScreen({
  pending,
  onAccept,
  onDecline,
  working,
  setWorking,
  census,
  rotation
}) {
  const rot = rotation || [{
    initials: "SC",
    name: "Dr. Sarah Chen",
    census: 3
  }, {
    initials: "JC",
    name: "You",
    census: 4,
    me: true
  }, {
    initials: "AP",
    name: "Dr. Amir Patel",
    census: 5
  }, {
    initials: "OH",
    name: "Dr. Omar Haddad",
    census: 6
  }, {
    initials: "ML",
    name: "Dr. Maria Lopez",
    census: 7
  }];
  const meIdx = rot.findIndex(r => r.me);
  const nextUp = rot[0];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Header, {
    title: "Dashboard",
    action: /*#__PURE__*/React.createElement("button", {
      onClick: () => setWorking(!working),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 12px",
        borderRadius: 99,
        border: "1px solid var(--border)",
        background: "#fff",
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap"
      }
    }, /*#__PURE__*/React.createElement(Dot, {
      status: working ? "accepted" : "offline",
      pulse: working
    }), working ? "On shift" : "Off")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginBottom: 16
    }
  }, [["Census", census, "users", "blue"], ["Pending", pending.length, "clock", "amber"], ["Cap", "12", "gauge", "slate"]].map(([l, v, ic, t]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      flex: 1,
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      padding: 14,
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: ic,
    size: 16,
    color: {
      blue: "var(--primary)",
      amber: "var(--status-pending)",
      slate: "var(--status-neutral)"
    }[t]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      marginTop: 6
    }
  }, v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 16,
      border: "1px solid var(--border)",
      padding: 14,
      boxShadow: "var(--shadow-sm)",
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "route",
    size: 15,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      whiteSpace: "nowrap"
    }
  }, "Round-robin")), /*#__PURE__*/React.createElement(MBadge, {
    status: "sent"
  }, "#", meIdx + 1, " of ", rot.length)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, rot.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      paddingTop: i === 0 ? 6 : 0
    }
  }, i === 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: -4,
      left: "50%",
      transform: "translateX(-50%)",
      fontSize: 8.5,
      fontWeight: 800,
      color: "#fff",
      background: "var(--status-accepted)",
      borderRadius: 99,
      padding: "1px 5px",
      whiteSpace: "nowrap",
      zIndex: 2
    }
  }, "NEXT"), /*#__PURE__*/React.createElement(MAvatar, {
    initials: r.initials,
    size: r.me ? 40 : 36,
    tint: i === 0 ? "emerald" : r.me ? "blue" : "slate"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      color: r.me ? "var(--primary)" : "var(--muted-foreground)",
      whiteSpace: "nowrap"
    }
  }, r.me ? "You" : r.initials)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      paddingTop: 11,
      borderTop: "1px solid var(--border)",
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "arrow-right",
    size: 13,
    color: "var(--status-accepted)"
  }), "Next admit \u2192 ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--foreground)",
      fontWeight: 600
    }
  }, nextUp.name), " \xB7 lowest census")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      margin: "0 2px 8px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      margin: 0
    }
  }, "Incoming"), pending.length > 0 && /*#__PURE__*/React.createElement(MBadge, {
    status: "pending",
    icon: "clock"
  }, pending.length, " awaiting")), pending.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderRadius: 14,
      border: "1px solid var(--border)",
      padding: 24,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "inbox",
    size: 22,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      marginTop: 8
    }
  }, "No pending assignments"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, "You're all caught up.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, pending.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      background: "#fff",
      borderRadius: 14,
      border: "1px solid var(--border)",
      padding: 11,
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: p.initials,
    size: 36,
    tint: "amber"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      whiteSpace: "nowrap"
    }
  }, p.initials, " \xB7 Rm ", p.room), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      fontSize: 11.5,
      fontWeight: 600,
      color: "var(--status-pending)",
      marginLeft: "auto",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "clock",
    size: 11
  }), p.expires)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, p.complaint, " \xB7 ", p.via))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 9
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onDecline(p.id),
    style: btn("outline")
  }, /*#__PURE__*/React.createElement(MI, {
    name: "x",
    size: 15
  }), "Decline"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onAccept(p.id),
    style: btn("primary")
  }, /*#__PURE__*/React.createElement(MI, {
    name: "check",
    size: 15
  }), "Accept")))))));
}
function btn(variant) {
  const base = {
    flex: 1,
    height: 38,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--font-sans)"
  };
  if (variant === "primary") return {
    ...base,
    border: "none",
    background: "var(--primary)",
    color: "#fff"
  };
  return {
    ...base,
    border: "1px solid var(--border)",
    background: "#fff",
    color: "var(--foreground)"
  };
}
function ChatThread({
  convo,
  onBack
}) {
  const [msgs, setMsgs] = React.useState(convo.messages || [{
    me: false,
    text: convo.preview || "Hi there.",
    t: convo.time || "now"
  }]);
  const [draft, setDraft] = React.useState("");
  const [typing, setTyping] = React.useState(false);
  const endRef = React.useRef(null);
  React.useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({
      block: "end"
    });
  }, [msgs, typing]);
  const REPLIES = ["Copy — on it.", "Thanks for the heads up.", "Accepting now.", "On my way up.", "Understood, I'll update the chart."];
  const lastMeIdx = msgs.map(m => m.me).lastIndexOf(true);
  const send = () => {
    if (!draft.trim() || convo.broadcast) return;
    setMsgs(m => [...m, {
      me: true,
      text: draft.trim(),
      t: "now"
    }]);
    setDraft("");
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMsgs(m => [...m, {
        me: false,
        text: REPLIES[Math.floor(Math.random() * REPLIES.length)],
        t: "now"
      }]);
    }, 1400);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "#F2F4F8"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "52px 14px 11px",
      background: "#fff",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 11,
      position: "sticky",
      top: 0,
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      width: 34,
      height: 34,
      borderRadius: 99,
      border: "none",
      background: "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "chevron-left",
    size: 22,
    color: "var(--primary)"
  })), /*#__PURE__*/React.createElement(MAvatar, {
    initials: convo.initials,
    size: 36,
    tint: convo.tint
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, convo.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--status-accepted)"
    }
  }, convo.group ? convo.members ? convo.members.length + " members · " + sentenceMembers(convo) : "Group" : "Online")), /*#__PURE__*/React.createElement("button", {
    onClick: () => window.__mtoast && window.__mtoast("Calling " + convo.name + "…"),
    style: {
      width: 36,
      height: 36,
      borderRadius: 99,
      border: "1px solid var(--border)",
      background: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "phone",
    size: 16,
    color: "var(--primary)"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: "center",
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      background: "var(--secondary)",
      color: "var(--muted-foreground)",
      fontSize: 11,
      fontWeight: 600,
      padding: "5px 12px",
      borderRadius: 99,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "lock",
    size: 11,
    color: "var(--muted-foreground)"
  }), "End-to-end encrypted \xB7 auto-deletes in 30 days"), msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: m.me ? "flex-end" : "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "76%",
      padding: "9px 13px",
      borderRadius: 16,
      fontSize: 14,
      lineHeight: 1.4,
      background: m.me ? "var(--primary)" : "#fff",
      color: m.me ? "#fff" : "var(--foreground)",
      border: m.me ? "none" : "1px solid var(--border)",
      borderBottomRightRadius: m.me ? 5 : 16,
      borderBottomLeftRadius: m.me ? 16 : 5
    }
  }, m.text), m.me && i === lastMeIdx && !typing && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: "var(--muted-foreground)",
      marginTop: 3,
      display: "inline-flex",
      alignItems: "center",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "check-check",
    size: 12,
    color: "var(--status-accepted)"
  }), "Read"))), typing && /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: "flex-start",
      padding: "10px 14px",
      borderRadius: 16,
      borderBottomLeftRadius: 5,
      background: "#fff",
      border: "1px solid var(--border)",
      display: "flex",
      gap: 4
    }
  }, [0, 1, 2].map(d => /*#__PURE__*/React.createElement("span", {
    key: d,
    style: {
      width: 6,
      height: 6,
      borderRadius: 99,
      background: "var(--muted-foreground)",
      animation: "dt-pulse 1.2s infinite",
      animationDelay: d * 0.18 + "s"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    ref: endRef
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px 26px",
      background: "#fff",
      borderTop: "1px solid var(--border)",
      display: "flex",
      gap: 9,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: draft,
    onChange: e => setDraft(e.target.value),
    onKeyDown: e => e.key === "Enter" && send(),
    placeholder: convo.broadcast ? "Replies disabled" : "Message…",
    disabled: convo.broadcast,
    style: {
      flex: 1,
      height: 40,
      border: "1px solid var(--border)",
      borderRadius: 20,
      padding: "0 15px",
      fontSize: 14,
      outline: "none",
      fontFamily: "inherit",
      background: convo.broadcast ? "var(--secondary)" : "#fff"
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: send,
    style: {
      width: 40,
      height: 40,
      borderRadius: 99,
      border: "none",
      background: draft.trim() ? "var(--primary)" : "var(--secondary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "arrow-up",
    size: 18,
    color: draft.trim() ? "#fff" : "var(--muted-foreground)"
  }))));
}
const MSG_ROSTER = [{
  id: "u1",
  initials: "AP",
  name: "Dr. Amir Patel",
  sub: "Hospital Medicine",
  tint: "emerald"
}, {
  id: "u2",
  initials: "SC",
  name: "Dr. Sarah Chen",
  sub: "Cardiology",
  tint: "blue"
}, {
  id: "u3",
  initials: "ML",
  name: "Dr. Maria Lopez",
  sub: "Pulmonology",
  tint: "blue"
}, {
  id: "u4",
  initials: "RK",
  name: "Dr. Ruth Kim",
  sub: "GI",
  tint: "blue"
}, {
  id: "u5",
  initials: "NF",
  name: "Dr. Nadia Farouk",
  sub: "Endocrine",
  tint: "blue"
}, {
  id: "u6",
  initials: "OH",
  name: "Dr. Omar Haddad",
  sub: "Infectious Disease",
  tint: "blue"
}, {
  id: "u7",
  initials: "JL",
  name: "Dr. James Liu",
  sub: "Nephrology",
  tint: "blue"
}, {
  id: "u8",
  initials: "LO",
  name: "Dr. Lena Ortiz",
  sub: "Neurology",
  tint: "blue"
}, {
  id: "u9",
  initials: "PS",
  name: "Priya Shah, NP",
  sub: "Pulmonology · NP",
  tint: "slate"
}, {
  id: "u10",
  initials: "RO",
  name: "Dr. Ruth Osei",
  sub: "ER physician",
  tint: "amber"
}];
function ComposeScreen({
  onBack,
  onStart
}) {
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState([]);
  const toggle = u => setSel(s => s.find(x => x.id === u.id) ? s.filter(x => x.id !== u.id) : [...s, u]);
  const list = MSG_ROSTER.filter(u => u.name.toLowerCase().includes(q.toLowerCase()) || u.sub.toLowerCase().includes(q.toLowerCase()));
  const isGroup = sel.length > 1;
  const start = () => {
    if (sel.length === 0) return;
    const name = isGroup ? sel.map(s => s.name.replace(/^Dr\.\s/, "").split(/[ ,]/)[0]).join(", ") : sel[0].name;
    const convo = isGroup ? {
      id: "g" + Date.now(),
      name,
      initials: String(sel.length),
      tint: "blue",
      group: true,
      members: sel,
      status: "accepted",
      preview: "",
      messages: []
    } : {
      id: sel[0].id,
      name: sel[0].name,
      initials: sel[0].initials,
      tint: sel[0].tint,
      status: "accepted",
      preview: "",
      messages: []
    };
    onStart(convo);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "52px 14px 11px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 8,
      position: "sticky",
      top: 0,
      background: "#fff",
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      width: 34,
      height: 34,
      borderRadius: 99,
      border: "none",
      background: "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "x",
    size: 22,
    color: "var(--primary)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 700
    }
  }, "New message"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, sel.length === 0 ? "Pick one or more people" : isGroup ? sel.length + " people · group" : "Direct message")), /*#__PURE__*/React.createElement("button", {
    onClick: start,
    disabled: sel.length === 0,
    style: {
      padding: "8px 15px",
      borderRadius: 99,
      border: "none",
      background: sel.length ? "var(--primary)" : "var(--secondary)",
      color: sel.length ? "#fff" : "var(--muted-foreground)",
      fontSize: 13.5,
      fontWeight: 600,
      cursor: sel.length ? "pointer" : "default",
      fontFamily: "var(--font-sans)",
      flex: "none"
    }
  }, isGroup ? "Create group" : "Start")), sel.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 7,
      flexWrap: "wrap",
      padding: "11px 16px",
      borderBottom: "1px solid var(--border)"
    }
  }, sel.map(u => /*#__PURE__*/React.createElement("button", {
    key: u.id,
    onClick: () => toggle(u),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 8px 5px 5px",
      borderRadius: 99,
      border: "none",
      background: "var(--secondary)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: u.initials,
    size: 22,
    tint: u.tint
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      fontWeight: 600
    }
  }, u.name.replace(/^Dr\.\s/, "")), /*#__PURE__*/React.createElement(MI, {
    name: "x",
    size: 13,
    color: "var(--muted-foreground)"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 16px 8px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: 40,
      padding: "0 12px",
      background: "var(--secondary)",
      borderRadius: 12
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "search",
    size: 16,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("input", {
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "Search people or specialty",
    style: {
      border: "none",
      outline: "none",
      background: "transparent",
      fontSize: 14,
      width: "100%",
      fontFamily: "inherit"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto"
    }
  }, list.map((u, i) => {
    const on = !!sel.find(x => x.id === u.id);
    return /*#__PURE__*/React.createElement("button", {
      key: u.id,
      onClick: () => toggle(u),
      style: {
        width: "100%",
        textAlign: "left",
        display: "flex",
        gap: 12,
        padding: "10px 16px",
        borderTop: i ? "1px solid var(--border)" : "none",
        alignItems: "center",
        background: on ? "var(--secondary)" : "transparent",
        border: "none",
        borderTopColor: "var(--border)",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement(MAvatar, {
      initials: u.initials,
      size: 36,
      tint: u.tint
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 600
      }
    }, u.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)"
      }
    }, u.sub)), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 22,
        height: 22,
        borderRadius: 99,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: on ? "none" : "1.5px solid var(--border)",
        background: on ? "var(--primary)" : "transparent"
      }
    }, on && /*#__PURE__*/React.createElement(MI, {
      name: "check",
      size: 14,
      color: "#fff"
    })));
  })));
}
function sentenceMembers(c) {
  return (c.members || []).map(m => m.sub.split(" · ")[0]).join(", ");
}
function MessagesScreen({
  convos
}) {
  const [open, setOpen] = React.useState(null);
  const [q, setQ] = React.useState("");
  const [read, setRead] = React.useState({});
  const [composing, setComposing] = React.useState(false);
  const [extra, setExtra] = React.useState([]);
  if (composing) return /*#__PURE__*/React.createElement(ComposeScreen, {
    onBack: () => setComposing(false),
    onStart: c => {
      setExtra(e => [c, ...e.filter(x => x.id !== c.id)]);
      setComposing(false);
      setOpen(c);
    }
  });
  if (open) return /*#__PURE__*/React.createElement(ChatThread, {
    convo: open,
    onBack: () => {
      setRead(r => ({
        ...r,
        [open.id]: true
      }));
      setOpen(null);
    }
  });
  const all = [...extra, ...convos];
  const list = all.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || (c.preview || "").toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Header, {
    title: "Messages",
    action: /*#__PURE__*/React.createElement("button", {
      onClick: () => setComposing(true),
      style: {
        width: 40,
        height: 40,
        borderRadius: 99,
        border: "1px solid var(--border)",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: "pen-square",
      size: 18,
      color: "var(--primary)"
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: 40,
      padding: "0 12px",
      background: "var(--secondary)",
      borderRadius: 12,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "search",
    size: 16,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("input", {
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "Search",
    style: {
      border: "none",
      outline: "none",
      background: "transparent",
      fontSize: 14,
      width: "100%",
      fontFamily: "inherit"
    }
  }))), /*#__PURE__*/React.createElement("div", null, list.map((c, i) => {
    const unread = read[c.id] ? 0 : c.unread;
    return /*#__PURE__*/React.createElement("button", {
      key: c.id,
      onClick: () => setOpen(c),
      style: {
        width: "100%",
        textAlign: "left",
        display: "flex",
        gap: 13,
        padding: "12px 16px",
        borderTop: i ? "1px solid var(--border)" : "none",
        alignItems: "center",
        background: "transparent",
        border: "none",
        borderTopColor: "var(--border)",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative"
      }
    }, /*#__PURE__*/React.createElement(MAvatar, {
      initials: c.initials,
      tint: c.tint
    }), c.group ? /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        bottom: -2,
        right: -2,
        width: 18,
        height: 18,
        borderRadius: 99,
        background: "var(--primary)",
        border: "2px solid #fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: "users",
      size: 9,
      color: "#fff"
    })) : /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        bottom: 0,
        right: 0,
        border: "2px solid #fff",
        borderRadius: 99
      }
    }, /*#__PURE__*/React.createElement(Dot, {
      status: c.status
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 15,
        fontWeight: 600,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, c.name), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)",
        flex: "none",
        marginLeft: 8
      }
    }, c.time || "now")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        marginTop: 2,
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13.5,
        color: "var(--muted-foreground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, c.group && !c.preview ? sentenceMembers(c) : c.preview || "New conversation"), unread > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: "none",
        minWidth: 20,
        height: 20,
        padding: "0 6px",
        borderRadius: 99,
        background: "var(--primary)",
        color: "#fff",
        fontSize: 12,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, unread))));
  }), list.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      padding: 30,
      color: "var(--muted-foreground)",
      fontSize: 14
    }
  }, "No conversations match \"", q, "\".")));
}
function TeamScreen({
  providers
}) {
  // Who's on, condensed — hospitalists on shift, consult services on call, ER physicians on.
  const onCall = [{
    initials: "SC",
    name: "Dr. Sarah Chen",
    sub: "Hospitalist · Cardiology",
    tint: "emerald"
  }, {
    initials: "AP",
    name: "Dr. Amir Patel",
    sub: "Hospitalist · Hosp. Med",
    tint: "emerald"
  }, {
    initials: "ML",
    name: "Dr. Maria Lopez",
    sub: "Hospitalist · Pulmonology",
    tint: "emerald"
  }];
  const consults = [{
    initials: "SC",
    name: "Dr. Sarah Chen",
    sub: "Cardiology",
    tint: "blue"
  }, {
    initials: "RK",
    name: "Dr. Ruth Kim",
    sub: "GI",
    tint: "blue"
  }, {
    initials: "NF",
    name: "Dr. Nadia Farouk",
    sub: "Endocrine",
    tint: "blue"
  }, {
    initials: "OH",
    name: "Dr. Omar Haddad",
    sub: "Infectious Disease",
    tint: "blue"
  }];
  const erDocs = [{
    initials: "RO",
    name: "Dr. Ruth Osei",
    sub: "ER physician",
    tint: "amber"
  }, {
    initials: "PO",
    name: "Dr. Paul Okafor",
    sub: "ER physician",
    tint: "amber"
  }, {
    initials: "DR",
    name: "Dr. Dana Reyes",
    sub: "ER physician",
    tint: "amber"
  }];
  const Row = (p, i, arr) => /*#__PURE__*/React.createElement("div", {
    key: p.name + i,
    style: {
      display: "flex",
      gap: 11,
      padding: "9px 16px",
      alignItems: "center",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: p.initials,
    size: 34,
    tint: p.tint
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      bottom: -1,
      right: -1,
      border: "2px solid #fff",
      borderRadius: 99
    }
  }, /*#__PURE__*/React.createElement(Dot, {
    status: "accepted",
    pulse: true
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, p.sub)), /*#__PURE__*/React.createElement("button", {
    onClick: () => window.__mtoast("Messaging " + p.name + "…"),
    style: {
      width: 34,
      height: 34,
      borderRadius: 99,
      border: "1px solid var(--border)",
      background: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "message-square",
    size: 15,
    color: "var(--primary)"
  })));
  const Group = ({
    icon,
    label,
    count,
    items
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      padding: "0 18px 7px"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: icon,
    size: 13,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: ".04em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, count)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderTop: "1px solid var(--border)",
      borderBottom: "1px solid var(--border)"
    }
  }, items.map(Row)));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Header, {
    title: "On call",
    action: /*#__PURE__*/React.createElement(MBadge, {
      status: "accepted",
      icon: "circle"
    }, onCall.length + consults.length + erDocs.length, " on")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "14px 0"
    }
  }, /*#__PURE__*/React.createElement(Group, {
    icon: "stethoscope",
    label: "Hospitalists on shift",
    count: onCall.length,
    items: onCall
  }), /*#__PURE__*/React.createElement(Group, {
    icon: "activity",
    label: "Consults on call",
    count: consults.length,
    items: consults
  }), /*#__PURE__*/React.createElement(Group, {
    icon: "ambulance",
    label: "ER physicians",
    count: erDocs.length,
    items: erDocs
  })));
}
function Div() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--border)",
      marginLeft: 73
    }
  });
}
function SubHead({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 16px 7px",
      fontSize: 12.5,
      fontWeight: 700,
      letterSpacing: ".04em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, children);
}
function DirectoryScreen({
  providers
}) {
  const [q, setQ] = React.useState("");
  // Everyone — hospitalists, consults, ER docs, midlevels — one condensed list.
  const everyone = [{
    initials: "SC",
    name: "Dr. Sarah Chen",
    role: "Cardiology",
    on: true
  }, {
    initials: "AP",
    name: "Dr. Amir Patel",
    role: "Hospital Medicine",
    on: true
  }, {
    initials: "ML",
    name: "Dr. Maria Lopez",
    role: "Pulmonology",
    on: true
  }, {
    initials: "OH",
    name: "Dr. Omar Haddad",
    role: "Infectious Disease",
    on: true
  }, {
    initials: "RK",
    name: "Dr. Ruth Kim",
    role: "GI",
    on: true
  }, {
    initials: "NF",
    name: "Dr. Nadia Farouk",
    role: "Endocrine",
    on: true
  }, {
    initials: "JL",
    name: "Dr. James Liu",
    role: "Nephrology",
    on: false
  }, {
    initials: "LO",
    name: "Dr. Lena Ortiz",
    role: "Neurology",
    on: true
  }, {
    initials: "RO",
    name: "Dr. Ruth Osei",
    role: "ER physician",
    on: true
  }, {
    initials: "PO",
    name: "Dr. Paul Okafor",
    role: "ER physician",
    on: true
  }, {
    initials: "DR",
    name: "Dr. Dana Reyes",
    role: "ER physician",
    on: false
  }, {
    initials: "PS",
    name: "Priya Shah, NP",
    role: "Pulmonology · NP",
    on: true
  }, {
    initials: "MB",
    name: "Marcus Bell, PA-C",
    role: "General Med · PA",
    on: false
  }, {
    initials: "JW",
    name: "Jordan Wu, PA-C",
    role: "Hosp. Med · PA",
    on: true
  }];
  const list = everyone.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.role.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Header, {
    title: "Directory",
    action: /*#__PURE__*/React.createElement(MBadge, {
      status: "offline"
    }, everyone.length)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 16px 8px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: 40,
      padding: "0 12px",
      background: "var(--secondary)",
      borderRadius: 12
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "search",
    size: 16,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("input", {
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "Search everyone",
    style: {
      border: "none",
      outline: "none",
      background: "transparent",
      fontSize: 15,
      width: "100%",
      fontFamily: "inherit"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      borderTop: "1px solid var(--border)"
    }
  }, list.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    style: {
      display: "flex",
      gap: 11,
      padding: "8px 16px",
      alignItems: "center",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: p.initials,
    size: 32,
    tint: p.on ? "emerald" : "slate"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      bottom: -1,
      right: -1,
      border: "2px solid #fff",
      borderRadius: 99
    }
  }, /*#__PURE__*/React.createElement(Dot, {
    status: p.on ? "accepted" : "offline"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, p.role)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: p.on ? "var(--status-accepted)" : "var(--muted-foreground)",
      flex: "none"
    }
  }, p.on ? "On" : "Off"), /*#__PURE__*/React.createElement("button", {
    onClick: () => window.__mtoast("Calling " + p.name + "…"),
    style: {
      width: 32,
      height: 32,
      borderRadius: 99,
      border: "1px solid var(--border)",
      background: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "phone",
    size: 14,
    color: "var(--primary)"
  })))), list.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      padding: 30,
      color: "var(--muted-foreground)",
      fontSize: 14
    }
  }, "No matches for \"", q, "\".")));
}
function iconBtn() {
  return {
    width: 40,
    height: 40,
    borderRadius: 99,
    border: "1px solid var(--border)",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  };
}
function ProfileScreen({
  profile
}) {
  const p = profile || {
    name: "Dr. Jordan Chen",
    role: "Hospitalist · Cardiology",
    initials: "JC",
    org: "Mercy General · MERCY"
  };
  const [twoFA, setTwoFA] = React.useState(true);
  const [push, setPush] = React.useState(true);
  const [sms, setSms] = React.useState(true);
  const [available, setAvailable] = React.useState(true);
  const [appLock, setAppLock] = React.useState(true);
  const [autoDelete, setAutoDelete] = React.useState(true);
  const [signedOut, setSignedOut] = React.useState(false);
  const Toggle = ({
    on,
    set
  }) => /*#__PURE__*/React.createElement("button", {
    onClick: () => set(!on),
    style: {
      width: 44,
      height: 26,
      borderRadius: 99,
      border: "none",
      position: "relative",
      flex: "none",
      cursor: "pointer",
      background: on ? "var(--status-accepted)" : "var(--status-neutral-bg)",
      transition: "background .2s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 3,
      left: on ? 21 : 3,
      width: 20,
      height: 20,
      borderRadius: 99,
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      transition: "left .2s"
    }
  }));
  const SettingRow = ({
    icon,
    title,
    sub,
    control,
    last
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 13,
      alignItems: "center",
      padding: "13px 16px",
      borderTop: last ? "none" : "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: 9,
      background: "var(--secondary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: icon,
    size: 18,
    color: "var(--primary)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, sub)), control);
  if (signedOut) {
    return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Header, {
      title: "Profile"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 40,
        textAlign: "center"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 64,
        height: 64,
        borderRadius: 18,
        background: "var(--secondary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement(MI, {
      name: "log-out",
      size: 28,
      color: "var(--muted-foreground)"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 18,
        fontWeight: 700
      }
    }, "Signed out"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13.5,
        color: "var(--muted-foreground)",
        margin: "6px 0 20px"
      }
    }, "Your session on this device has ended."), /*#__PURE__*/React.createElement("button", {
      onClick: () => setSignedOut(false),
      style: {
        height: 46,
        padding: "0 26px",
        borderRadius: 12,
        border: "none",
        background: "var(--primary)",
        color: "#fff",
        fontSize: 15,
        fontWeight: 600
      }
    }, "Sign back in")));
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Header, {
    title: "Profile"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 15,
      alignItems: "center",
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: 18,
      padding: 18,
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement(MAvatar, {
    initials: p.initials,
    size: 58
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 19,
      fontWeight: 700
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--muted-foreground)"
    }
  }, p.role), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 7
    }
  }, /*#__PURE__*/React.createElement(MBadge, {
    status: available ? "accepted" : "offline",
    icon: "circle"
  }, available ? "Available" : "Away")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: 18,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement(SettingRow, {
    icon: "activity",
    title: "Available for assignments",
    sub: available ? "Receiving round-robin admits" : "Paused — not in rotation",
    control: /*#__PURE__*/React.createElement(Toggle, {
      on: available,
      set: setAvailable
    })
  }), /*#__PURE__*/React.createElement(SettingRow, {
    icon: "shield-check",
    title: "Two-factor auth",
    sub: twoFA ? "TOTP + SMS · on" : "Off — less secure",
    control: /*#__PURE__*/React.createElement(Toggle, {
      on: twoFA,
      set: setTwoFA
    })
  }), /*#__PURE__*/React.createElement(SettingRow, {
    icon: "bell",
    title: "Push notifications",
    sub: "Firebase Cloud Messaging",
    control: /*#__PURE__*/React.createElement(Toggle, {
      on: push,
      set: setPush
    })
  }), /*#__PURE__*/React.createElement(SettingRow, {
    icon: "message-circle",
    title: "SMS fallback",
    sub: "If push isn't delivered",
    control: /*#__PURE__*/React.createElement(Toggle, {
      on: sms,
      set: setSms
    }),
    last: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: 18,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "11px 16px 3px",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: ".05em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, "Security & compliance"), /*#__PURE__*/React.createElement(SettingRow, {
    icon: "scan-face",
    title: "App lock",
    sub: appLock ? "Face ID + PIN on launch" : "Off — not recommended",
    control: /*#__PURE__*/React.createElement(Toggle, {
      on: appLock,
      set: setAppLock
    })
  }), /*#__PURE__*/React.createElement(SettingRow, {
    icon: "timer",
    title: "Auto-delete messages",
    sub: autoDelete ? "After 30 days · HIPAA retention" : "Kept indefinitely",
    control: /*#__PURE__*/React.createElement(Toggle, {
      on: autoDelete,
      set: setAutoDelete
    })
  }), /*#__PURE__*/React.createElement(SettingRow, {
    icon: "lock",
    title: "Encryption",
    sub: "End-to-end \xB7 at rest & in transit",
    control: /*#__PURE__*/React.createElement(MBadge, {
      status: "accepted",
      icon: "check"
    }, "On"),
    last: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: 18,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement(SettingRow, {
    icon: "building-2",
    title: "Organization",
    sub: p.org,
    control: /*#__PURE__*/React.createElement(MI, {
      name: "chevron-right",
      size: 18,
      color: "var(--muted-foreground)"
    })
  }), /*#__PURE__*/React.createElement(SettingRow, {
    icon: "clock",
    title: "Session",
    sub: "15-min timeout",
    control: /*#__PURE__*/React.createElement(MI, {
      name: "chevron-right",
      size: 18,
      color: "var(--muted-foreground)"
    }),
    last: true
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSignedOut(true),
    style: {
      width: "100%",
      marginTop: 16,
      height: 46,
      borderRadius: 12,
      border: "1px solid var(--border)",
      background: "#fff",
      color: "var(--destructive)",
      fontSize: 15,
      fontWeight: 600,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      cursor: "pointer",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement(MI, {
    name: "log-out",
    size: 17
  }), "Sign out")));
}
Object.assign(window, {
  MI,
  MBadge,
  MAvatar,
  Dot,
  DashboardScreen,
  MessagesScreen,
  TeamScreen,
  DirectoryScreen,
  ProfileScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mobile/screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/AppShell.jsx
try { (() => {
/* DocTurn web-app UI kit — app shell: sidebar + topbar */

function Sidebar({
  role,
  nav,
  active,
  onNav,
  me,
  onLogout,
  onRenameMe,
  compact,
  appName
}) {
  const who = me || {
    name: "Dr. Jordan Chen",
    avatar: "JC"
  };
  const name = appName || "DocTurn";
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: compact ? 68 : 232,
      flex: "none",
      background: "#fff",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "sticky",
      top: 0,
      transition: "width .2s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: compact ? "18px 0 14px" : "18px 18px 14px",
      display: "flex",
      alignItems: "center",
      justifyContent: compact ? "center" : "flex-start",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: "var(--radius-md)",
      background: "var(--primary)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
      fontSize: 16,
      flex: "none"
    }
  }, name.charAt(0).toUpperCase()), !compact && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      letterSpacing: "-.02em"
    }
  }, name)), /*#__PURE__*/React.createElement("nav", {
    style: {
      padding: compact ? "6px 10px" : "6px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 2,
      flex: 1
    }
  }, nav.map(item => {
    const on = active === item.id;
    return /*#__PURE__*/React.createElement("button", {
      key: item.id,
      onClick: () => onNav(item.id),
      title: compact ? item.label : undefined,
      onMouseEnter: e => {
        if (!on) e.currentTarget.style.background = "var(--secondary)";
      },
      onMouseLeave: e => {
        if (!on) e.currentTarget.style.background = "transparent";
      },
      style: {
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: compact ? "10px 0" : "9px 12px",
        justifyContent: compact ? "center" : "flex-start",
        borderRadius: "var(--radius-md)",
        border: "none",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 500,
        textAlign: "left",
        position: "relative",
        background: on ? "var(--primary-tint, #EFF6FF)" : "transparent",
        color: on ? "var(--primary)" : "var(--foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: item.icon,
      size: 18
    }), !compact && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, item.label), !compact && item.badge ? /*#__PURE__*/React.createElement(Badge, {
      status: "pending"
    }, item.badge) : null, compact && item.badge ? /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        top: 5,
        right: 12,
        width: 7,
        height: 7,
        borderRadius: 99,
        background: "var(--destructive)"
      }
    }) : null);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: compact ? 0 : "8px 10px",
      justifyContent: compact ? "center" : "flex-start",
      borderRadius: "var(--radius-md)"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: who.avatar,
    size: 34
  }), !compact && /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      whiteSpace: "nowrap",
      overflow: "hidden"
    }
  }, onRenameMe ? /*#__PURE__*/React.createElement(EditableText, {
    value: who.name,
    onSave: onRenameMe,
    size: 13,
    weight: 600
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, who.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      textTransform: "capitalize"
    }
  }, role.replace("_", " "))), !compact && /*#__PURE__*/React.createElement("button", {
    onClick: onLogout,
    title: "Sign out",
    onMouseEnter: e => e.currentTarget.style.background = "var(--secondary)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    style: {
      width: 30,
      height: 30,
      borderRadius: "var(--radius-md)",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "log-out",
    size: 16
  })))));
}
function Topbar({
  title,
  subtitle,
  working,
  onToggleWorking,
  right,
  onBell,
  notifCount = 0,
  onLock
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 64,
      borderBottom: "1px solid var(--border)",
      background: "rgba(255,255,255,.85)",
      backdropFilter: "blur(6px)",
      position: "sticky",
      top: 0,
      zIndex: 5,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 28px"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      lineHeight: 1.2
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, subtitle)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, right, onToggleWorking && /*#__PURE__*/React.createElement("button", {
    onClick: onToggleWorking,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "7px 12px",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: working ? "online" : "offline",
    pulse: working
  }), working ? "On shift" : "Off shift"), /*#__PURE__*/React.createElement("button", {
    onClick: onBell,
    title: "Notifications",
    onMouseEnter: e => e.currentTarget.style.background = "var(--secondary)",
    onMouseLeave: e => e.currentTarget.style.background = "#fff",
    style: {
      position: "relative",
      width: 38,
      height: 38,
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 18,
    color: "var(--foreground)"
  }), notifCount > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: -5,
      right: -5,
      minWidth: 17,
      height: 17,
      padding: "0 4px",
      borderRadius: 99,
      background: "var(--destructive)",
      color: "#fff",
      fontSize: 10.5,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "2px solid #fff"
    }
  }, notifCount)), onLock && /*#__PURE__*/React.createElement("button", {
    onClick: onLock,
    title: "Lock app",
    onMouseEnter: e => e.currentTarget.style.background = "var(--secondary)",
    onMouseLeave: e => e.currentTarget.style.background = "#fff",
    style: {
      width: 38,
      height: 38,
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 17,
    color: "var(--foreground)"
  }))));
}
function PageWrap({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 28,
      maxWidth: "var(--content-max, 1040px)",
      margin: "0 auto"
    }
  }, children);
}
function SectionTitle({
  children,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      margin: "4px 0 14px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 700,
      margin: 0
    }
  }, children), action);
}
function hexToHsl(hex) {
  var m = (hex || "").replace("#", "");
  if (m.length === 3) m = m.split("").map(function (c) {
    return c + c;
  }).join("");
  var r = parseInt(m.slice(0, 2), 16) / 255,
    g = parseInt(m.slice(2, 4), 16) / 255,
    b = parseInt(m.slice(4, 6), 16) / 255;
  var max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    h = 0,
    l = (max + min) / 2,
    s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);else if (max === g) h = (b - r) / d + 2;else h = (r - g) / d + 4;
    h *= 60;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

// Imperatively apply the theme to :root CSS variables (whole-app recolor).
function applyTheme(theme) {
  if (!theme) return;
  var root = document.documentElement.style;
  var hsl = hexToHsl(theme.accent || "#2563EB");
  var ch = hsl.h + " " + hsl.s + "% " + hsl.l + "%";
  root.setProperty("--primary-ch", ch);
  root.setProperty("--ring-ch", ch);
  root.setProperty("--primary", "hsl(" + ch + ")");
  root.setProperty("--ring", "hsl(" + ch + ")");
  root.setProperty("--status-active", theme.accent || "#2563EB");
  // soft + faint accent tints used for active surfaces
  root.setProperty("--primary-tint", "hsl(" + hsl.h + " " + Math.min(hsl.s, 90) + "% 95%)");
  root.setProperty("--primary-tint-2", "hsl(" + hsl.h + " " + Math.min(hsl.s, 90) + "% 90%)");
  root.setProperty("--radius", (theme.radius != null ? theme.radius : 8) / 16 + "rem");
  root.setProperty("--content-max", theme.contentWidth === "wide" ? "1280px" : theme.contentWidth === "full" ? "100%" : "1040px");
}
function ThemeStyle({
  theme
}) {
  React.useEffect(function () {
    applyTheme(theme);
  }, [theme && theme.accent, theme && theme.radius, theme && theme.contentWidth]);
  return null;
}
Object.assign(window, {
  Sidebar,
  Topbar,
  PageWrap,
  SectionTitle,
  applyTheme,
  ThemeStyle,
  hexToHsl
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Appearance.jsx
try { (() => {
/* DocTurn web-app UI kit — Appearance & Layout customization.
   Brand name, accent color, corner radius, sidebar style, content width, and
   per-role navigation structure (show/hide + reorder). Store-backed & live:
   every change applies to the whole app immediately and persists. */

const ACCENTS = [["#2563EB", "Blue"], ["#0F766E", "Teal"], ["#7C3AED", "Violet"], ["#DB2777", "Pink"], ["#DC2626", "Red"], ["#EA580C", "Orange"], ["#0891B2", "Cyan"], ["#475569", "Slate"]];
const RADII = [["Sharp", 4], ["Rounded", 8], ["Soft", 14]];
const WIDTHS = [["Standard", "standard"], ["Wide", "wide"], ["Full", "full"]];
const SIDEBARS = [["Expanded", "expanded", "panel-left"], ["Compact", "compact", "panel-left-close"]];
function Seg({
  options,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      gap: 4,
      padding: 4,
      background: "var(--secondary)",
      borderRadius: "var(--radius-md)"
    }
  }, options.map(o => {
    const [label, val, icon] = Array.isArray(o) ? o : [o, o];
    const on = value === val;
    return /*#__PURE__*/React.createElement("button", {
      key: val,
      onClick: () => onChange(val),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 14px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        background: on ? "#fff" : "transparent",
        color: on ? "var(--primary)" : "var(--muted-foreground)",
        boxShadow: on ? "var(--shadow-sm)" : "none"
      }
    }, icon && /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 15
    }), label);
  }));
}
function Row({
  label,
  sub,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      padding: "15px 0",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600
    }
  }, label), sub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      marginTop: 1
    }
  }, sub)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none"
    }
  }, children));
}
function CardHead({
  icon,
  title,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 17,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, title), sub && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, "\xB7 ", sub));
}
function Appearance({
  theme,
  role,
  master,
  navHidden,
  navOrder,
  onSetTheme,
  onToggleNav,
  onMoveNav,
  onReset
}) {
  // build ordered, annotated nav list for the structure editor
  const items = navOrder.map(id => master.find(m => m.id === id)).filter(Boolean);
  const hiddenItems = master.filter(m => navHidden.includes(m.id) && m.id !== "dashboard");
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700
    }
  }, "Appearance & layout"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, "Customize branding, theme and how the workspace is structured. Changes apply instantly.")), /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm",
    icon: "rotate-ccw",
    onClick: onReset
  }, "Reset to defaults")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.15fr .85fr",
      gap: 16,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement(CardHead, {
    icon: "palette",
    title: "Brand & theme"
  }), /*#__PURE__*/React.createElement(Row, {
    label: "Workspace name",
    sub: "Shown in the sidebar and on login."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 200
    }
  }, /*#__PURE__*/React.createElement(Field, {
    icon: "type",
    value: theme.appName,
    onChange: v => onSetTheme({
      appName: v || "DocTurn"
    }),
    placeholder: "DocTurn"
  }))), /*#__PURE__*/React.createElement(Row, {
    label: "Accent color",
    sub: "Drives buttons, links and highlights."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 7,
      flexWrap: "wrap",
      justifyContent: "flex-end",
      maxWidth: 220
    }
  }, ACCENTS.map(([hex, name]) => /*#__PURE__*/React.createElement("button", {
    key: hex,
    title: name,
    onClick: () => onSetTheme({
      accent: hex
    }),
    style: {
      width: 28,
      height: 28,
      borderRadius: "var(--radius-md)",
      background: hex,
      cursor: "pointer",
      border: theme.accent === hex ? "2px solid var(--foreground)" : "2px solid transparent",
      boxShadow: "0 0 0 1px var(--border)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, theme.accent === hex && /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 15,
    color: "#fff"
  }))))), /*#__PURE__*/React.createElement(Row, {
    label: "Corner radius",
    sub: "Roundness of cards, buttons and inputs."
  }, /*#__PURE__*/React.createElement(Seg, {
    options: RADII,
    value: theme.radius,
    onChange: v => onSetTheme({
      radius: v
    })
  }))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement(CardHead, {
    icon: "layout-dashboard",
    title: "Layout"
  }), /*#__PURE__*/React.createElement(Row, {
    label: "Sidebar",
    sub: "Full labels, or a compact icon rail."
  }, /*#__PURE__*/React.createElement(Seg, {
    options: SIDEBARS,
    value: theme.sidebar,
    onChange: v => onSetTheme({
      sidebar: v
    })
  })), /*#__PURE__*/React.createElement(Row, {
    label: "Content width",
    sub: "Maximum width of page content."
  }, /*#__PURE__*/React.createElement(Seg, {
    options: WIDTHS,
    value: theme.contentWidth,
    onChange: v => onSetTheme({
      contentWidth: v
    })
  }))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement(CardHead, {
    icon: "list-tree",
    title: "Navigation structure",
    sub: "show, hide & reorder for this role"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 7,
      marginTop: 12
    }
  }, items.map((it, i) => {
    const locked = it.id === "dashboard";
    return /*#__PURE__*/React.createElement("div", {
      key: it.id,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 12px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "#fff"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 1
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => onMoveNav(role, navOrder, it.id, -1),
      disabled: i === 0,
      style: {
        border: "none",
        background: "transparent",
        cursor: i === 0 ? "default" : "pointer",
        color: i === 0 ? "var(--border)" : "var(--muted-foreground)",
        padding: 0,
        lineHeight: 0
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-up",
      size: 15
    })), /*#__PURE__*/React.createElement("button", {
      onClick: () => onMoveNav(role, navOrder, it.id, 1),
      disabled: i === items.length - 1,
      style: {
        border: "none",
        background: "transparent",
        cursor: i === items.length - 1 ? "default" : "pointer",
        color: i === items.length - 1 ? "var(--border)" : "var(--muted-foreground)",
        padding: 0,
        lineHeight: 0
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-down",
      size: 15
    }))), /*#__PURE__*/React.createElement(Icon, {
      name: it.icon,
      size: 17,
      color: "var(--muted-foreground)"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: 13.5,
        fontWeight: 600
      }
    }, it.label), locked ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--muted-foreground)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "lock",
      size: 12
    }), "Home") : /*#__PURE__*/React.createElement("button", {
      onClick: () => onToggleNav(role, it.id),
      title: "Hide from navigation",
      style: {
        border: "1px solid var(--border)",
        background: "#fff",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        padding: "4px 8px",
        fontSize: 11.5,
        fontWeight: 600,
        color: "var(--muted-foreground)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "eye",
      size: 13
    }), "Visible"));
  })), hiddenItems.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: ".04em",
      color: "var(--muted-foreground)",
      marginBottom: 8
    }
  }, "Hidden"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 7
    }
  }, hiddenItems.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.id,
    onClick: () => onToggleNav(role, it.id),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 11px",
      border: "1px dashed var(--border)",
      borderRadius: "var(--radius-full)",
      background: "#fff",
      cursor: "pointer",
      fontSize: 12.5,
      fontWeight: 600,
      color: "var(--muted-foreground)",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 13,
    color: "var(--primary)"
  }), it.label)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "sticky",
      top: 84
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "11px 16px",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "eye",
    size: 15,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      fontWeight: 700
    }
  }, "Live preview")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: 320,
      background: "var(--secondary)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: theme.sidebar === "compact" ? 52 : 128,
      flex: "none",
      background: "#fff",
      borderRight: "1px solid var(--border)",
      padding: theme.sidebar === "compact" ? "12px 0" : 12,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      alignItems: theme.sidebar === "compact" ? "center" : "stretch",
      transition: "width .2s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginBottom: 6,
      justifyContent: theme.sidebar === "compact" ? "center" : "flex-start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 22,
      height: 22,
      borderRadius: "var(--radius-sm)",
      background: "var(--primary)",
      color: "#fff",
      fontWeight: 800,
      fontSize: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, (theme.appName || "D").charAt(0).toUpperCase()), theme.sidebar !== "compact" && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      fontWeight: 800,
      letterSpacing: "-.02em",
      whiteSpace: "nowrap",
      overflow: "hidden"
    }
  }, theme.appName)), items.slice(0, 5).map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: theme.sidebar === "compact" ? "7px 0" : "7px 9px",
      justifyContent: theme.sidebar === "compact" ? "center" : "flex-start",
      borderRadius: "var(--radius-md)",
      background: i === 0 ? "var(--primary-tint, #EFF6FF)" : "transparent",
      color: i === 0 ? "var(--primary)" : "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: it.icon,
    size: 15
  }), theme.sidebar !== "compact" && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      whiteSpace: "nowrap"
    }
  }, it.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: 14,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 44,
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 44,
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "55%",
      height: 9,
      background: "var(--secondary)",
      borderRadius: 99,
      marginBottom: 8
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "85%",
      height: 7,
      background: "var(--secondary)",
      borderRadius: 99,
      marginBottom: 6
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "70%",
      height: 7,
      background: "var(--secondary)",
      borderRadius: 99
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      padding: "7px 14px",
      borderRadius: "var(--radius-md)",
      background: "var(--primary)",
      color: "#fff",
      fontSize: 12,
      fontWeight: 600
    }
  }, "Primary"), /*#__PURE__*/React.createElement("span", {
    style: {
      padding: "7px 14px",
      borderRadius: "var(--radius-md)",
      background: "#fff",
      border: "1px solid var(--border)",
      color: "var(--foreground)",
      fontSize: 12,
      fontWeight: 600
    }
  }, "Secondary"), /*#__PURE__*/React.createElement("span", {
    style: {
      padding: "5px 11px",
      borderRadius: "var(--radius-full)",
      background: "var(--primary-tint, #EFF6FF)",
      color: "var(--primary)",
      fontSize: 11.5,
      fontWeight: 700,
      alignSelf: "center"
    }
  }, "Badge"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 7,
      marginTop: 12,
      fontSize: 12,
      color: "var(--muted-foreground)",
      lineHeight: 1.5
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 14,
    style: {
      marginTop: 1,
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", null, "Branding, theme and content width apply across every portal. Navigation structure is saved per role.")))));
}
Object.assign(window, {
  Appearance
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Appearance.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Broadcasts.jsx
try { (() => {
/* DocTurn web-app UI kit — Emergency Broadcasts.
   Spec: Req FR-6.5 (emergency broadcasts to targeted roles/departments,
   optional ack required, ack tracking). Director surface. */

function Broadcasts({
  onSend,
  broadcasts = []
}) {
  const [severity, setSeverity] = React.useState("warning");
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [requireAck, setRequireAck] = React.useState(true);
  const [audience, setAudience] = React.useState(["hospitalist"]);
  const SEV = [["info", "Info", "info", "var(--status-active)", "var(--status-active-bg)"], ["warning", "Warning", "alert-triangle", "var(--status-pending)", "var(--status-pending-bg)"], ["critical", "Critical", "alert-octagon", "var(--status-rejected)", "var(--status-rejected-bg)"], ["emergency", "Emergency", "siren", "#fff", "var(--status-rejected)"]];
  const ROLES = [["hospitalist", "Hospitalists"], ["er_doctor", "ER physicians"], ["director", "Directors"], ["all", "Everyone"]];
  const toggleAud = r => setAudience(a => a.includes(r) ? a.filter(x => x !== r) : [...a, r]);
  const sevMeta = id => SEV.find(s => s[0] === id) || SEV[0];
  const send = () => {
    if (!title.trim()) {
      window.DT.actions.toast({
        tone: "rejected",
        title: "Title required",
        msg: "Add a short, scannable headline."
      });
      return;
    }
    if (!audience.length) {
      window.DT.actions.toast({
        tone: "rejected",
        title: "Pick an audience",
        msg: "Select at least one group to notify."
      });
      return;
    }
    onSend && onSend({
      title: title,
      message: message,
      severity: severity,
      ackReq: requireAck,
      audience: audience
    });
    setTitle("");
    setMessage("");
  };
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 18,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionTitle, null, "Compose broadcast"), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 8
    }
  }, "Severity"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      marginBottom: 16
    }
  }, SEV.map(([id, label, icon, fg, bg]) => {
    const on = severity === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => setSeverity(id),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        fontSize: 13.5,
        fontWeight: 600,
        border: on ? `1.5px solid ${fg === "#fff" ? bg : fg}` : "1px solid var(--border)",
        background: on ? bg : "#fff",
        color: on ? fg === "#fff" ? "#fff" : fg : "var(--foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 16
    }), label);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Title",
    icon: "megaphone",
    value: title,
    onChange: setTitle,
    placeholder: "Short, scannable headline"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Message",
    value: message,
    onChange: setMessage,
    textarea: true,
    rows: 3,
    placeholder: "Plain, calm, action-oriented. No PHI.",
    help: "Avoid patient-identifying details. Use initials only if needed."
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 8
    }
  }, "Target audience"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 16
    }
  }, ROLES.map(([id, label]) => {
    const on = audience.includes(id);
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => toggleAud(id),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: "var(--radius-full)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
        background: on ? "#EFF6FF" : "#fff",
        color: on ? "var(--primary)" : "var(--foreground)"
      }
    }, on && /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 13
    }), label);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 0",
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600
    }
  }, "Require acknowledgement"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, "Recipients must confirm receipt.")), /*#__PURE__*/React.createElement("button", {
    onClick: () => setRequireAck(!requireAck),
    style: {
      width: 44,
      height: 26,
      borderRadius: 99,
      border: "none",
      cursor: "pointer",
      position: "relative",
      background: requireAck ? "var(--status-accepted)" : "var(--status-neutral-bg)",
      transition: "background .2s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 3,
      left: requireAck ? 21 : 3,
      width: 20,
      height: 20,
      borderRadius: 99,
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      transition: "left .2s"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    full: true,
    icon: "send",
    onClick: send
  }, "Send broadcast")))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionTitle, null, "Recent broadcasts"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, broadcasts.length === 0 && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 28,
      textAlign: "center",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No broadcasts sent yet."), broadcasts.map((b, i) => {
    const sm = sevMeta(b.sev);
    const pct = b.total ? Math.round(b.acked / b.total * 100) : 0;
    return /*#__PURE__*/React.createElement(Card, {
      key: b.id || i,
      style: {
        padding: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 36,
        height: 36,
        borderRadius: "var(--radius-md)",
        background: sm[4],
        color: sm[3] === "#fff" ? "#fff" : sm[3],
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: sm[2],
      size: 18
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 600
      }
    }, b.title), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)",
        marginTop: 1
      }
    }, sm[1], " \xB7 sent ", dtFmt.ago(b.at)))), b.ackReq ? /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        marginBottom: 5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--muted-foreground)",
        fontWeight: 500
      }
    }, "Acknowledged"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums"
      }
    }, b.acked, "/", b.total, " \xB7 ", pct, "%")), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 7,
        borderRadius: 99,
        background: "var(--secondary)",
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: pct + "%",
        height: "100%",
        borderRadius: 99,
        background: pct === 100 ? "var(--status-accepted)" : "var(--status-pending)"
      }
    }))) : /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 10
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      variant: "secondary",
      icon: "bell-off"
    }, "No acknowledgement required")));
  })))));
}
Object.assign(window, {
  Broadcasts
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Broadcasts.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/CareTeam.jsx
try { (() => {
/* DocTurn web-app UI kit — My Care Team (on-call pairing).
   New capability: any clinician links their own midlevels (NP, PA) or partner
   doctors into an on-call unit. Paired + on-call members receive assignment
   requests together and appear on every assignment thread. */

const TEAM_ROLE = {
  MD: {
    label: "MD",
    tint: "blue",
    fg: "var(--primary)"
  },
  DO: {
    label: "DO",
    tint: "blue",
    fg: "var(--primary)"
  },
  PA: {
    label: "PA",
    tint: "emerald",
    fg: "var(--status-accepted)"
  },
  NP: {
    label: "NP",
    tint: "amber",
    fg: "var(--status-pending)"
  },
  RN: {
    label: "RN",
    tint: "slate",
    fg: "var(--status-neutral)"
  }
};
function RolePill({
  role
}) {
  const r = TEAM_ROLE[role] || TEAM_ROLE.MD;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      padding: "1px 7px",
      borderRadius: "var(--radius-full)",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: ".02em",
      background: {
        blue: "#DBEAFE",
        emerald: "var(--status-accepted-bg)",
        amber: "var(--status-pending-bg)",
        slate: "var(--status-neutral-bg)"
      }[r.tint],
      color: r.fg
    }
  }, r.label);
}
function CareTeam({
  me,
  team,
  candidates,
  onAdd,
  onRemove,
  onToggleCall
}) {
  const [adding, setAdding] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const onCall = team.filter(m => m.onCall);
  const pool = candidates.filter(c => !team.some(t => t.id === c.id) && (c.name.toLowerCase().includes(query.toLowerCase()) || c.specialty.toLowerCase().includes(query.toLowerCase())));
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 11,
      alignItems: "flex-start",
      padding: "13px 15px",
      marginBottom: 20,
      borderRadius: "var(--radius-md)",
      background: "#EFF6FF",
      border: "1px solid #BFDBFE"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 17,
    color: "var(--primary)",
    style: {
      marginTop: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.5,
      color: "#1E3A5F"
    }
  }, /*#__PURE__*/React.createElement("strong", null, "Anyone on your on-call unit is connected to you."), " When you and a team member are both on call, new assignment requests reach both of you, and they appear on every assignment thread \u2014 so nothing waits on one person.")), /*#__PURE__*/React.createElement(SectionTitle, null, "Your on-call unit"), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 20,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 7,
      width: 96
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: me.avatar,
    size: 52,
    tint: "blue"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      lineHeight: 1.2
    }
  }, me.name.split(" ").slice(-1)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 3
    }
  }, /*#__PURE__*/React.createElement(RolePill, {
    role: me.role
  })))), onCall.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: "0 20px",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No one else on call yet. Add a midlevel or partner below to share incoming requests.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      color: "var(--status-accepted)",
      padding: "0 6px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 2,
      background: "var(--status-accepted)",
      borderRadius: 2
    }
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "link-2",
    size: 16
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 2,
      background: "var(--status-accepted)",
      borderRadius: 2
    }
  })), onCall.map(m => /*#__PURE__*/React.createElement("div", {
    key: m.id,
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 7,
      width: 96
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: m.avatar,
    size: 52,
    tint: TEAM_ROLE[m.role].tint
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      lineHeight: 1.2
    }
  }, m.name.split(",")[0].split(" ").slice(-1)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 3
    }
  }, /*#__PURE__*/React.createElement(RolePill, {
    role: m.role
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 160,
      paddingLeft: 18
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    status: "accepted",
    icon: "circle"
  }, "Connected \xB7 ", onCall.length + 1, " on call"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      marginTop: 7,
      lineHeight: 1.45
    }
  }, "Requests and threads are shared across everyone shown here."))))), /*#__PURE__*/React.createElement(SectionTitle, {
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: adding ? "secondary" : "outline",
      icon: adding ? "x" : "user-plus",
      onClick: () => setAdding(!adding)
    }, adding ? "Close" : "Add member")
  }, "Care team members"), adding && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 14,
      marginBottom: 14,
      background: "var(--secondary)"
    }
  }, /*#__PURE__*/React.createElement(Field, {
    icon: "search",
    value: query,
    onChange: setQuery,
    placeholder: "Search providers and midlevels to link\u2026"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      maxHeight: 220,
      overflow: "auto"
    }
  }, pool.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      padding: "6px 4px"
    }
  }, "No matches."), pool.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "8px 10px",
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: c.avatar,
    size: 32,
    tint: TEAM_ROLE[c.role].tint
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, c.name, /*#__PURE__*/React.createElement(RolePill, {
    role: c.role
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, c.specialty)), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: "plus",
    onClick: () => onAdd(c.id)
  }, "Link"))))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, team.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 32,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 24,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      marginTop: 8
    }
  }, "No team members yet"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      marginTop: 2
    }
  }, "Add a midlevel or partner to share your on-call load.")), team.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: "13px 16px",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: m.avatar,
    size: 38,
    tint: TEAM_ROLE[m.role].tint
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, m.name, /*#__PURE__*/React.createElement(RolePill, {
    role: m.role
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, m.specialty)), /*#__PURE__*/React.createElement("button", {
    onClick: () => onToggleCall(m.id),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      padding: "6px 11px",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      cursor: "pointer",
      fontSize: 12.5,
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: m.onCall ? "online" : "offline",
    pulse: m.onCall
  }), m.onCall ? "On call" : "Off call"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onRemove(m.id),
    title: "Remove from team",
    style: {
      width: 34,
      height: 34,
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "user-minus",
    size: 16
  }))))));
}
Object.assign(window, {
  CareTeam,
  RolePill,
  TEAM_ROLE
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/CareTeam.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Compliance.jsx
try { (() => {
/* DocTurn web-app UI kit — Audit & Compliance viewer.
   Spec: Req FR-11 (audit trail, PHI access logs, security incidents), NFR-2 (HIPAA).
   Live: the audit and PHI trails are fed by real actions taken across the app
   (accept/send/reassign/login/broadcast/…); incidents can be resolved. */

function ComplianceTabs({
  tab,
  setTab
}) {
  const tabs = [["audit", "Audit log", "scroll-text"], ["phi", "PHI access", "file-lock-2"], ["incidents", "Security incidents", "shield-alert"], ["logs", "System logs", "terminal"]];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      padding: 4,
      background: "var(--secondary)",
      borderRadius: "var(--radius-md)",
      width: "fit-content",
      marginBottom: 18
    }
  }, tabs.map(([id, label, icon]) => {
    const on = tab === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => setTab(id),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 14px",
        borderRadius: 5,
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        background: on ? "#fff" : "transparent",
        color: on ? "var(--primary)" : "var(--muted-foreground)",
        boxShadow: on ? "var(--shadow-sm)" : "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 15
    }), label);
  }));
}
const RISK = {
  low: {
    label: "Low",
    bg: "var(--status-neutral-bg)",
    fg: "var(--status-neutral)"
  },
  medium: {
    label: "Medium",
    bg: "var(--status-pending-bg)",
    fg: "var(--status-pending)"
  },
  high: {
    label: "High",
    bg: "var(--status-rejected-bg)",
    fg: "var(--status-rejected)"
  },
  critical: {
    label: "Critical",
    bg: "var(--status-rejected)",
    fg: "#fff"
  }
};
function RiskPill({
  level
}) {
  const r = RISK[level] || RISK.low;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      padding: "2px 9px",
      borderRadius: "var(--radius-full)",
      background: r.bg,
      color: r.fg,
      fontSize: 11.5,
      fontWeight: 700
    }
  }, r.label);
}
function clockSec(at) {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
}
function csvDownload(name, rows) {
  const csv = rows.map(r => r.map(c => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], {
    type: "text/csv"
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  window.DT.actions.toast({
    tone: "accepted",
    title: "Export started",
    msg: name + " downloaded."
  });
}
const LOG_LEVEL = {
  info: {
    c: "var(--status-active)",
    bg: "var(--status-active-bg)",
    ic: "info"
  },
  warn: {
    c: "var(--status-pending)",
    bg: "var(--status-pending-bg)",
    ic: "alert-triangle"
  },
  error: {
    c: "var(--status-rejected)",
    bg: "var(--status-rejected-bg)",
    ic: "x-octagon"
  },
  audit: {
    c: "var(--status-neutral)",
    bg: "var(--status-neutral-bg)",
    ic: "shield"
  }
};
function logLevelFor(r) {
  return r.risk === "high" ? "error" : r.risk === "medium" ? "warn" : /login|logout|access|impersonat|audit/.test(r.action) ? "audit" : "info";
}
function Compliance({
  audit = [],
  phiLog = [],
  incidents = [],
  onResolve
}) {
  const [tab, setTab] = React.useState("audit");
  const openCount = incidents.filter(r => r.status === "open" || r.status === "investigating").length;
  const deniedCount = phiLog.filter(r => !r.ok).length;
  const logs = audit.slice(0, 30).map(r => ({
    t: clockSec(r.at),
    level: logLevelFor(r),
    org: r.org || "—",
    msg: r.action.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) + " — " + r.resource,
    risk: r.risk
  }));
  const headRow = cols => /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "9px 16px",
      background: "var(--secondary)",
      borderBottom: "1px solid var(--border)",
      fontSize: 11.5,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: ".04em",
      color: "var(--muted-foreground)"
    }
  }, cols);
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Audit events",
    value: audit.length,
    icon: "scroll-text",
    tint: "blue"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "PHI accesses",
    value: phiLog.length,
    icon: "file-lock-2",
    tint: "emerald"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Open incidents",
    value: openCount,
    icon: "shield-alert",
    tint: "amber"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Denied access",
    value: deniedCount,
    icon: "ban",
    tint: "slate"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement(ComplianceTabs, {
    tab: tab,
    setTab: setTab
  }), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    icon: "download",
    onClick: () => {
      if (tab === "audit") csvDownload("docturn-audit.csv", [["time", "actor", "role", "action", "resource", "ip", "risk"]].concat(audit.map(r => [clockSec(r.at), r.actor, r.role, r.action, r.resource, r.ip, r.risk])));else if (tab === "phi") csvDownload("docturn-phi-access.csv", [["time", "actor", "patient", "access", "fields", "purpose", "result"]].concat(phiLog.map(r => [clockSec(r.at), r.actor, r.patient, r.access, r.fields, r.purpose, r.ok ? "allowed" : "denied"])));else if (tab === "incidents") csvDownload("docturn-incidents.csv", [["type", "severity", "description", "status"]].concat(incidents.map(r => [r.type, r.sev, r.desc, r.status])));else csvDownload("docturn-logs.csv", [["time", "level", "org", "message", "risk"]].concat(logs.map(l => [l.t, l.level, l.org, l.msg, l.risk])));
    }
  }, "Export")), tab === "audit" && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, headRow(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 72,
      flex: "none"
    }
  }, "Time"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, "Actor"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1.4
    }
  }, "Action"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 120,
      flex: "none"
    }
  }, "IP"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 70,
      flex: "none",
      textAlign: "right"
    }
  }, "Risk"))), audit.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: r.id || i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 16px",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-mono",
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      width: 72,
      flex: "none"
    }
  }, clockSec(r.at)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600
    }
  }, r.actor), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      textTransform: "capitalize"
    }
  }, (r.role || "").replace("_", " "))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1.4,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ds-mono",
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      color: "var(--primary)"
    }
  }, r.action), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, r.resource)), /*#__PURE__*/React.createElement("span", {
    className: "ds-mono",
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      width: 120,
      flex: "none"
    }
  }, r.ip), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 70,
      flex: "none",
      textAlign: "right"
    }
  }, /*#__PURE__*/React.createElement(RiskPill, {
    level: r.risk
  }))))), tab === "phi" && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, headRow(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 72,
      flex: "none"
    }
  }, "Time"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, "Accessor"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 54,
      flex: "none"
    }
  }, "Pt"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1.5
    }
  }, "Fields / purpose"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 80,
      flex: "none",
      textAlign: "right"
    }
  }, "Result"))), phiLog.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: r.id || i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 16px",
      borderTop: i ? "1px solid var(--border)" : "none",
      background: r.ok ? "transparent" : "var(--status-rejected-bg)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-mono",
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      width: 72,
      flex: "none"
    }
  }, clockSec(r.at)), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13.5,
      fontWeight: 600
    }
  }, r.actor), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 54,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: r.patient,
    size: 28,
    tint: "slate"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1.5,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.4,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      textTransform: "capitalize",
      fontWeight: 600
    }
  }, r.access), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--muted-foreground)"
    }
  }, " \xB7 ", r.fields)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      lineHeight: 1.4,
      color: "var(--muted-foreground)"
    }
  }, "Purpose: ", r.purpose)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 80,
      flex: "none",
      textAlign: "right"
    }
  }, r.ok ? /*#__PURE__*/React.createElement(Badge, {
    status: "accepted"
  }, "Allowed") : /*#__PURE__*/React.createElement(Badge, {
    status: "rejected"
  }, "Denied"))))), tab === "incidents" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, incidents.map((r, i) => {
    const stat = {
      open: "rejected",
      investigating: "pending",
      resolved: "accepted",
      false_positive: "offline"
    }[r.status];
    const canResolve = r.status === "open" || r.status === "investigating";
    return /*#__PURE__*/React.createElement(Card, {
      key: r.id || i,
      style: {
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 40,
        height: 40,
        borderRadius: "var(--radius-md)",
        background: RISK[r.sev].bg,
        color: RISK[r.sev].fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "shield-alert",
      size: 19
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "ds-mono",
      style: {
        fontSize: 13,
        fontWeight: 700,
        textTransform: "capitalize",
        whiteSpace: "nowrap"
      }
    }, r.type.replace(/_/g, " ")), /*#__PURE__*/React.createElement(RiskPill, {
      level: r.sev
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        lineHeight: 1.4,
        color: "var(--muted-foreground)",
        marginTop: 2
      }
    }, r.desc)), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "right",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      status: stat
    }, r.status.replace("_", " ")), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11.5,
        color: "var(--muted-foreground)"
      }
    }, dtFmt.ago(r.at)), canResolve && /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "outline",
      icon: "check",
      onClick: () => onResolve && onResolve(r.id)
    }, "Resolve")));
  })), tab === "logs" && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, headRow(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 72,
      flex: "none"
    }
  }, "Time"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 74,
      flex: "none"
    }
  }, "Level"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 60,
      flex: "none"
    }
  }, "Org"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, "Event"))), logs.map((l, i) => {
    const lv = LOG_LEVEL[l.level] || LOG_LEVEL.info;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderTop: i ? "1px solid var(--border)" : "none"
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "ds-mono",
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)",
        flex: "none",
        width: 72
      }
    }, l.t), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 74,
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        background: lv.bg,
        color: lv.c,
        fontSize: 11,
        fontWeight: 700
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: lv.ic,
      size: 11
    }), l.level)), /*#__PURE__*/React.createElement("span", {
      className: "ds-mono",
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: "var(--muted-foreground)",
        flex: "none",
        width: 60
      }
    }, l.org), /*#__PURE__*/React.createElement("span", {
      className: "ds-mono",
      style: {
        flex: 1,
        fontSize: 12.5,
        color: "var(--foreground)",
        minWidth: 0
      }
    }, l.msg));
  }), logs.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 28,
      textAlign: "center",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No system events yet.")));
}
Object.assign(window, {
  Compliance
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Compliance.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/DeveloperDashboard.jsx
try { (() => {
/* DocTurn web-app UI kit — Developer portal (cross-tenant administration).
   Spec: Eng §10.2 (developer dashboard), Req FR-10.1/10.2, FR-9.2 (AI monitor).
   Full control: cross-tenant orgs, system health, logs, AND user/specialist
   provisioning into any tenant by role type. */

function DevHealthBar({
  label,
  value,
  max,
  tint
}) {
  const pct = Math.min(100, Math.round(value / max * 100));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 12,
      marginBottom: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--muted-foreground)",
      fontWeight: 500
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums"
    }
  }, value, "/", max)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 7,
      borderRadius: 99,
      background: "var(--secondary)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + "%",
      height: "100%",
      borderRadius: 99,
      background: tint
    }
  })));
}
function DSelect({
  label,
  icon,
  value,
  onChange,
  options
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    style: {
      display: "block",
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 6
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 12px",
      height: 40,
      border: "1px solid var(--input)",
      borderRadius: "var(--radius-md)",
      background: "#fff"
    }
  }, icon && /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 16,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: e => onChange(e.target.value),
    style: {
      border: "none",
      outline: "none",
      background: "transparent",
      fontSize: 14,
      fontFamily: "inherit",
      width: "100%",
      color: "var(--foreground)",
      cursor: "pointer"
    }
  }, options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)))));
}
const DEV_ROLES = [["hospitalist", "Hospitalist"], ["er_doctor", "ER physician"], ["er_director", "ER director"], ["director", "Director"], ["developer", "Developer"]];
const ROLE_LABEL = Object.fromEntries(DEV_ROLES.map(r => [r[0], r[1]]));
// Curated swatch options for role-color customization.
const ROLE_SWATCHES = ["#2563EB", "#0F766E", "#7C3AED", "#D97706", "#DC2626", "#DB2777", "#0891B2", "#475569"];
// Stable accent color per organization (by position, falling back to a hash).
const ORG_PALETTE = ["#2563EB", "#0F766E", "#7C3AED", "#DB2777", "#EA580C", "#0891B2", "#CA8A04", "#475569"];
function orgColor(code, organizations) {
  const i = organizations.findIndex(o => o.code === code);
  const idx = i >= 0 ? i : code ? code.charCodeAt(0) : 0;
  return ORG_PALETTE[idx % ORG_PALETTE.length];
}
function tintFor(hex) {
  return hex + "16";
} // ~9% alpha tint

function userInitials(name) {
  return name.replace(/\(root\)/i, "").replace(/^Dr\.?\s*/, "").trim().split(/[\s,]+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
function RoleChip({
  role,
  color,
  scope
}) {
  const isRoot = role === "developer" && scope === "root";
  const label = isRoot ? "Root Developer" : role === "developer" ? "Local Developer" : ROLE_LABEL[role] || role;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 10px 3px 8px",
      borderRadius: "var(--radius-full)",
      fontSize: 12,
      fontWeight: 600,
      color: color,
      background: (color || "#888") + "18",
      border: "1px solid " + (color || "#888") + "33",
      whiteSpace: "nowrap"
    }
  }, isRoot ? /*#__PURE__*/React.createElement(Icon, {
    name: "crown",
    size: 11,
    color: color
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 99,
      background: color,
      flex: "none"
    }
  }), label);
}
function RoleColorEditor({
  roleColors,
  onSetRoleColor
}) {
  const [openRole, setOpenRole] = React.useState(null);
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 16,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "palette",
    size: 16,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      margin: 0
    }
  }, "Role colors"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, "\xB7 customize how each role appears across portals")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 12
    }
  }, DEV_ROLES.map(([id, label]) => /*#__PURE__*/React.createElement("div", {
    key: id,
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpenRole(openRole === id ? null : id),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 11px",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      border: "1px solid var(--border)",
      background: "#fff",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      height: 16,
      borderRadius: 5,
      background: roleColors[id],
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, label), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 13,
    color: "var(--muted-foreground)"
  })), openRole === id && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onClick: () => setOpenRole(null),
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 30
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: "calc(100% + 6px)",
      left: 0,
      zIndex: 31,
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      boxShadow: "var(--shadow-xl)",
      padding: 10,
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 7,
      width: 168
    }
  }, ROLE_SWATCHES.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    onClick: () => {
      onSetRoleColor(id, c);
      setOpenRole(null);
    },
    style: {
      width: 30,
      height: 30,
      borderRadius: "var(--radius-md)",
      background: c,
      cursor: "pointer",
      border: roleColors[id] === c ? "2px solid var(--foreground)" : "2px solid transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, roleColors[id] === c && /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14,
    color: "#fff"
  })))))))));
}
function AddUserPanel({
  organizations,
  devUsers = [],
  roleColors,
  onAddUser,
  onRemoveUser
}) {
  const [open, setOpen] = React.useState(false);
  const [orgFilter, setOrgFilter] = React.useState("ALL");
  const [roleFilter, setRoleFilter] = React.useState("ALL");
  const [collapsed, setCollapsed] = React.useState({});
  const [form, setForm] = React.useState({
    org: (organizations[0] || {}).code || "",
    role: "hospitalist",
    name: "",
    email: "",
    specialty: "Hospital Medicine",
    cap: "15",
    shift: "rounding",
    scope: "local"
  });
  const set = (k, v) => setForm(f => Object.assign({}, f, function () {
    var o = {};
    o[k] = v;
    return o;
  }()));
  const isClinical = form.role === "hospitalist";
  const isDev = form.role === "developer";
  const isRoot = isDev && form.scope === "root";
  const submit = () => {
    onAddUser(form);
    if (form.name.trim()) {
      setForm(f => Object.assign({}, f, {
        name: "",
        email: ""
      }));
      setOpen(false);
    }
  };
  const visible = devUsers.filter(u => (orgFilter === "ALL" || u.org === orgFilter || u.org === "*") && (roleFilter === "ALL" || u.role === roleFilter));
  const roots = visible.filter(u => u.org === "*");
  const scoped = visible.filter(u => u.org !== "*");
  const byOrg = {};
  scoped.forEach(u => {
    (byOrg[u.org] = byOrg[u.org] || []).push(u);
  });
  const orgName = code => (organizations.find(o => o.code === code) || {}).name || code;
  const UserRow = ({
    u,
    last
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: "11px 16px",
      borderTop: last ? "none" : "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: userInitials(u.name),
    size: 34,
    tint: "blue"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600
    }
  }, u.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, u.specialty ? u.specialty + " · " : "", /*#__PURE__*/React.createElement("span", {
    className: "ds-mono"
  }, u.org === "*" ? "all orgs" : u.org))), /*#__PURE__*/React.createElement(RoleChip, {
    role: u.role,
    color: roleColors[u.role],
    scope: u.scope
  }), onRemoveUser && /*#__PURE__*/React.createElement("button", {
    onClick: () => onRemoveUser(u.id),
    title: "Remove user",
    onMouseEnter: e => e.currentTarget.style.color = "var(--destructive)",
    onMouseLeave: e => e.currentTarget.style.color = "var(--muted-foreground)",
    style: {
      width: 28,
      height: 28,
      borderRadius: "var(--radius-md)",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "trash-2",
    size: 15
  })));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, {
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: open ? "secondary" : "default",
      icon: open ? "x" : "user-plus",
      onClick: () => setOpen(!open)
    }, open ? "Close" : "Add user / provider")
  }, "Organizations & user management"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      marginTop: -8,
      marginBottom: 12
    }
  }, "Manage organizations and their users with role-based access control."), /*#__PURE__*/React.createElement(RoleColorEditor, {
    roleColors: roleColors,
    onSetRoleColor: window.DT.actions.setRoleColor
  }), open && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 8
    }
  }, "Account type"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 16
    }
  }, DEV_ROLES.map(([id, label]) => {
    const on = form.role === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => set("role", id),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 13px",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
        background: on ? "#EFF6FF" : "#fff",
        color: on ? "var(--primary)" : "var(--foreground)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 10,
        height: 10,
        borderRadius: 3,
        background: roleColors[id],
        flex: "none"
      }
    }), label);
  })), isDev && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 8
    }
  }, "Developer scope"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, [["local", "Local developer", "key-round", "Scoped to one organization"], ["root", "Root developer", "crown", "Full access to all organizations"]].map(([id, label, icon, desc]) => {
    const on = form.scope === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => set("scope", id),
      style: {
        flex: 1,
        textAlign: "left",
        padding: "11px 13px",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
        background: on ? "#EFF6FF" : "#fff",
        fontFamily: "var(--font-sans)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 13.5,
        fontWeight: 600,
        color: on ? "var(--primary)" : "var(--foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 14
    }), label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: "var(--muted-foreground)",
        marginTop: 2
      }
    }, desc));
  }))), !isRoot && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(DSelect, {
    label: "Organization",
    icon: "building-2",
    value: form.org,
    onChange: v => set("org", v),
    options: organizations.map(o => ({
      value: o.code,
      label: `${o.name} (${o.code})`
    }))
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Full name",
    icon: "user",
    value: form.name,
    onChange: v => set("name", v),
    placeholder: "Dr. Jane Smith"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Email",
    icon: "mail",
    value: form.email,
    onChange: v => set("email", v),
    placeholder: "jane@hospital.com"
  }))), isClinical && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 16,
      alignItems: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1.4
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Specialty",
    icon: "stethoscope",
    value: form.specialty,
    onChange: v => set("specialty", v),
    placeholder: "e.g. Cardiology"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 110
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Patient cap",
    icon: "gauge",
    value: form.cap,
    onChange: v => set("cap", v)
  })), /*#__PURE__*/React.createElement(DSelect, {
    label: "Shift type",
    icon: "clock",
    value: form.shift,
    onChange: v => set("shift", v),
    options: [{
      value: "rounding",
      label: "Rounding"
    }, {
      value: "swing",
      label: "Swing"
    }, {
      value: "nocturnist",
      label: "Nocturnist"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm",
    onClick: () => setOpen(false)
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: "check",
    onClick: submit
  }, "Create account"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: 12,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 240
    }
  }, /*#__PURE__*/React.createElement(DSelect, {
    label: "Organization",
    icon: "building-2",
    value: orgFilter,
    onChange: setOrgFilter,
    options: [{
      value: "ALL",
      label: "All organizations"
    }].concat(organizations.map(o => ({
      value: o.code,
      label: `${o.name} (${o.code})`
    })))
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 200
    }
  }, /*#__PURE__*/React.createElement(DSelect, {
    label: "Role",
    icon: "shield-half",
    value: roleFilter,
    onChange: setRoleFilter,
    options: [{
      value: "ALL",
      label: "All roles"
    }].concat(DEV_ROLES.map(([id, label]) => ({
      value: id,
      label
    })))
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      paddingBottom: 8
    }
  }, visible.length, " user", visible.length === 1 ? "" : "s", " shown")), roots.length > 0 && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden",
      marginBottom: 12,
      border: "1px solid var(--primary)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px 16px",
      background: "var(--primary-tint, #EFF6FF)",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "crown",
    size: 15,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      fontWeight: 700,
      color: "var(--primary)"
    }
  }, "Root developers"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, "\xB7 access every organization"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, roots.length)), roots.map((u, i) => /*#__PURE__*/React.createElement(UserRow, {
    key: u.id,
    u: u,
    last: i === roots.length - 1
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, Object.keys(byOrg).map(code => {
    const org = organizations.find(o => o.code === code) || {
      active: true
    };
    const accent = orgColor(code, organizations);
    const isOpen = !collapsed[code];
    const counts = {};
    byOrg[code].forEach(u => {
      counts[u.role] = (counts[u.role] || 0) + 1;
    });
    return /*#__PURE__*/React.createElement(Card, {
      key: code,
      style: {
        padding: 0,
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setCollapsed(c => Object.assign({}, c, {
        [code]: !c[code]
      })),
      style: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "11px 16px 11px 13px",
        border: "none",
        borderLeft: `3px solid ${accent}`,
        background: isOpen ? tintFor(accent) : "#fff",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-sans)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-right",
      size: 16,
      color: "var(--muted-foreground)",
      style: {
        transform: isOpen ? "rotate(90deg)" : "none",
        transition: "transform .15s",
        flex: "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 28,
        height: 28,
        borderRadius: "var(--radius-md)",
        background: accent,
        color: "#fff",
        fontWeight: 700,
        fontSize: 11.5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none"
      }
    }, code.slice(0, 2)), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13.5,
        fontWeight: 700,
        lineHeight: 1.2
      }
    }, orgName(code)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: "var(--muted-foreground)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 1
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "ds-mono"
    }, code), "\xB7", org.active ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--status-accepted)",
        fontWeight: 600
      }
    }, "Active") : /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--status-neutral)",
        fontWeight: 600
      }
    }, "Suspended"))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: 7
      }
    }, Object.keys(counts).map(rid => /*#__PURE__*/React.createElement("span", {
      key: rid,
      title: ROLE_LABEL[rid],
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--muted-foreground)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 9,
        height: 9,
        borderRadius: 3,
        background: roleColors[rid],
        flex: "none"
      }
    }), counts[rid])), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11.5,
        color: "var(--muted-foreground)",
        borderLeft: "1px solid var(--border)",
        paddingLeft: 9,
        marginLeft: 2
      }
    }, byOrg[code].length, " user", byOrg[code].length === 1 ? "" : "s"))), isOpen && (() => {
      const sub = {};
      byOrg[code].forEach(u => {
        (sub[u.role] = sub[u.role] || []).push(u);
      });
      const order = DEV_ROLES.map(r => r[0]).filter(rid => sub[rid]);
      return order.map(rid => /*#__PURE__*/React.createElement("div", {
        key: rid
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 16px 7px 18px",
          background: "var(--secondary)",
          borderTop: "1px solid var(--border)"
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          width: 8,
          height: 8,
          borderRadius: 99,
          background: roleColors[rid],
          flex: "none"
        }
      }), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "var(--muted-foreground)"
        }
      }, ROLE_LABEL[rid]), /*#__PURE__*/React.createElement("span", {
        style: {
          marginLeft: "auto",
          fontSize: 11,
          color: "var(--muted-foreground)"
        }
      }, sub[rid].length)), sub[rid].map((u, i) => /*#__PURE__*/React.createElement(UserRow, {
        key: u.id,
        u: u,
        last: i === 0
      }))));
    })());
  }), Object.keys(byOrg).length === 0 && roots.length === 0 && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 28,
      textAlign: "center",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No users match these filters.")));
}
function devClock(at) {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
}

// Auto-detect the hospital's location from the browser environment.
function detectLocation() {
  let tz = "America/New_York";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
  } catch (e) {}
  const city = tz.split("/").pop().replace(/_/g, " ");
  let offset = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset"
    }).formatToParts(new Date());
    const tzn = parts.find(p => p.type === "timeZoneName");
    if (tzn) offset = tzn.value;
  } catch (e) {}
  return {
    timezone: tz,
    city: city,
    offset: offset
  };
}
function DeveloperDashboard({
  organizations,
  devUsers,
  roleColors,
  diagnostics,
  audit = [],
  onSelectOrg,
  onAddUser,
  onRemoveUser,
  onSetRoleColor,
  onAddTenant,
  onToggleTenant,
  onDiagnostics
}) {
  const [query, setQuery] = React.useState("");
  const [newTenant, setNewTenant] = React.useState(false);
  const detected = React.useMemo(detectLocation, []);
  const [tform, setTform] = React.useState({
    name: "",
    code: "",
    timezone: detected.timezone,
    autoLoc: true
  });
  const orgs = organizations.filter(o => o.name.toLowerCase().includes(query.toLowerCase()) || o.code.toLowerCase().includes(query.toLowerCase()));
  const totalUsers = organizations.reduce((a, o) => a + o.users, 0);
  const totalAssign = organizations.reduce((a, o) => a + o.assignments, 0);
  const LEVEL = {
    info: {
      c: "var(--status-active)",
      bg: "var(--status-active-bg)",
      ic: "info"
    },
    warn: {
      c: "var(--status-pending)",
      bg: "var(--status-pending-bg)",
      ic: "alert-triangle"
    },
    error: {
      c: "var(--status-rejected)",
      bg: "var(--status-rejected-bg)",
      ic: "x-octagon"
    },
    audit: {
      c: "var(--status-neutral)",
      bg: "var(--status-neutral-bg)",
      ic: "shield"
    }
  };
  const levelFor = r => r.risk === "high" ? "error" : r.risk === "medium" ? "warn" : /login|logout|access|impersonat|audit/.test(r.action) ? "audit" : "info";
  const LOGS = audit.slice(0, 8).map(r => ({
    t: devClock(r.at),
    level: levelFor(r),
    org: r.org || "MAYO",
    msg: r.action.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) + " — " + r.resource,
    risk: r.risk
  }));
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
      padding: "10px 14px",
      marginBottom: 18,
      borderRadius: "var(--radius-md)",
      background: "#1E293B",
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "globe",
    size: 16,
    color: "#7DD3FC"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, "Platform operator \u2014 full cross-tenant access"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "#94A3B8"
    }
  }, "Every action on this surface is audited.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Organizations",
    value: organizations.length,
    icon: "building-2",
    tint: "blue"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Total users",
    value: totalUsers,
    icon: "users",
    tint: "emerald"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Assignments / 24h",
    value: totalAssign,
    icon: "clipboard-list",
    tint: "amber"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Uptime (30d)",
    value: "99.98%",
    icon: "activity",
    tint: "slate"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.55fr 1fr",
      gap: 18,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SectionTitle, {
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "default",
      icon: "plus",
      onClick: () => setNewTenant(true)
    }, "New tenant")
  }, "Organizations"), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(Field, {
    icon: "search",
    value: query,
    onChange: setQuery,
    placeholder: "Search by name or code\u2026"
  })), orgs.map((o, i) => /*#__PURE__*/React.createElement("div", {
    key: o.code,
    onClick: () => onSelectOrg && onSelectOrg(o),
    onMouseEnter: e => e.currentTarget.style.background = "var(--secondary)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: "13px 16px",
      borderTop: i ? "1px solid var(--border)" : "none",
      cursor: "pointer",
      transition: "background .12s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: "var(--radius-md)",
      background: o.active ? "#DBEAFE" : "var(--status-neutral-bg)",
      color: o.active ? "var(--primary)" : "var(--status-neutral)",
      fontWeight: 700,
      fontSize: 14,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, o.code.slice(0, 2)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, o.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ds-mono"
  }, o.code), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement("span", null, o.timezone))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right",
      marginRight: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      fontVariantNumeric: "tabular-nums"
    }
  }, o.users), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--muted-foreground)"
    }
  }, "users")), o.active ? /*#__PURE__*/React.createElement(Badge, {
    status: "accepted"
  }, "Active") : /*#__PURE__*/React.createElement(Badge, {
    status: "offline"
  }, "Suspended"), /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onToggleTenant(o.code);
    },
    title: o.active ? "Suspend tenant" : "Reactivate tenant",
    style: {
      width: 30,
      height: 30,
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: o.active ? "power-off" : "power",
    size: 14
  })), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16,
    color: "var(--muted-foreground)"
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "server",
    size: 18,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "System health"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    status: "accepted",
    icon: "circle"
  }, "Operational"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 13
    }
  }, /*#__PURE__*/React.createElement(DevHealthBar, {
    label: "API latency budget",
    value: 142,
    max: 500,
    tint: "var(--status-accepted)"
  }), /*#__PURE__*/React.createElement(DevHealthBar, {
    label: "WebSocket connections",
    value: 1284,
    max: 2000,
    tint: "var(--primary)"
  }), /*#__PURE__*/React.createElement(DevHealthBar, {
    label: "DB pool",
    value: 36,
    max: 50,
    tint: "var(--status-pending)"
  }))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 18,
    color: "var(--medical-secondary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "AI monitor")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.55,
      color: "var(--foreground)",
      background: "var(--secondary)",
      borderRadius: "var(--radius-md)",
      padding: "11px 13px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, "Insight:"), " ", diagnostics ? diagnostics.text : "STJUDE assignment expiry rate up 18% this shift — likely the delayed Twilio queue. Suggest enabling push-first fallback."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "outline",
    full: true,
    icon: "stethoscope",
    onClick: onDiagnostics
  }, "Run AI diagnostics"))))), /*#__PURE__*/React.createElement(AddUserPanel, {
    organizations: organizations,
    devUsers: devUsers,
    roleColors: roleColors,
    onAddUser: onAddUser,
    onRemoveUser: onRemoveUser
  }), newTenant && /*#__PURE__*/React.createElement(Modal, {
    title: "New organization",
    subtitle: "Provision a new hospital tenant. Data is isolated by organizationId.",
    icon: "building-2",
    onClose: () => setNewTenant(false),
    children: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Hospital name",
      icon: "building-2",
      value: tform.name,
      onChange: v => setTform({
        ...tform,
        name: v
      }),
      placeholder: "e.g. Riverside Memorial"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 150
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Short code",
      icon: "hash",
      value: tform.code,
      onChange: v => setTform({
        ...tform,
        code: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)
      }),
      placeholder: "RIVER",
      help: "A\u2013Z, \u22646"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 13,
        fontWeight: 500,
        marginBottom: 6
      }
    }, "Location", tform.autoLoc && /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: "var(--radius-full)",
        background: "var(--status-accepted-bg)",
        color: "var(--status-accepted)",
        fontSize: 11,
        fontWeight: 700
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "locate-fixed",
      size: 11
    }), "Auto-detected")), tform.autoLoc ? /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 40,
        padding: "0 12px",
        border: "1px solid var(--input)",
        borderRadius: "var(--radius-md)",
        background: "var(--secondary)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "map-pin",
      size: 15,
      color: "var(--primary)"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: 13.5,
        fontWeight: 600
      }
    }, detected.city, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 400,
        color: "var(--muted-foreground)"
      }
    }, detected.offset ? "  ·  " + detected.offset : "")), /*#__PURE__*/React.createElement("button", {
      onClick: () => setTform({
        ...tform,
        autoLoc: false
      }),
      style: {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--primary)",
        fontFamily: "var(--font-sans)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "pencil",
      size: 12
    }), "Change")) : /*#__PURE__*/React.createElement(DSelect, {
      value: tform.timezone,
      onChange: v => setTform({
        ...tform,
        timezone: v
      }),
      icon: "globe",
      options: [{
        value: "America/New_York",
        label: "Eastern · America/New_York"
      }, {
        value: "America/Chicago",
        label: "Central · America/Chicago"
      }, {
        value: "America/Denver",
        label: "Mountain · America/Denver"
      }, {
        value: "America/Los_Angeles",
        label: "Pacific · America/Los_Angeles"
      }, {
        value: "America/Phoenix",
        label: "Arizona · America/Phoenix"
      }, {
        value: "America/Anchorage",
        label: "Alaska · America/Anchorage"
      }, {
        value: "Pacific/Honolulu",
        label: "Hawaii · Pacific/Honolulu"
      }]
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 4
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      size: "sm",
      onClick: () => setNewTenant(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      icon: "check",
      onClick: () => {
        if (tform.name.trim()) {
          onAddTenant(tform);
          setTform({
            name: "",
            code: "",
            timezone: detected.timezone,
            autoLoc: true
          });
          setNewTenant(false);
        } else window.DT.actions.toast({
          tone: "rejected",
          title: "Name required",
          msg: "Enter a hospital name."
        });
      }
    }, "Create tenant")))
  }));
}
Object.assign(window, {
  DeveloperDashboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/DeveloperDashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/DirectorDashboard.jsx
try { (() => {
/* DocTurn web-app UI kit — Director dashboard.
   Director controls the hospitalist group: mass-set the daily census limit (cap),
   edit each provider's census/cap, move providers between defined shifts
   (Day call / Swing / Nights) with editable hours, and manage the round-robin —
   including taking a provider off rotation even while they are on shift. */

function Stepper({
  label,
  value,
  onDec,
  onInc
}) {
  const btn = {
    width: 24,
    height: 24,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--muted-foreground)"
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      fontWeight: 500
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      background: "#fff",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: btn,
    onClick: onDec,
    onMouseEnter: e => e.currentTarget.style.background = "var(--secondary)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    title: `Decrease ${label}`
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "minus",
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 22,
      textAlign: "center",
      fontSize: 13,
      fontWeight: 700,
      fontVariantNumeric: "tabular-nums"
    }
  }, value), /*#__PURE__*/React.createElement("button", {
    style: btn,
    onClick: onInc,
    onMouseEnter: e => e.currentTarget.style.background = "var(--secondary)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    title: `Increase ${label}`
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 13
  }))));
}
function ShiftSelect({
  shifts,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "inline-flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: e => onChange(e.target.value),
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      height: 28,
      padding: "0 24px 0 10px",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "var(--secondary)",
      fontSize: 12,
      fontWeight: 600,
      color: "var(--foreground)",
      fontFamily: "var(--font-sans)",
      cursor: "pointer"
    }
  }, shifts.map(s => /*#__PURE__*/React.createElement("option", {
    key: s.id,
    value: s.id
  }, s.label))), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 12,
    color: "var(--muted-foreground)",
    style: {
      position: "absolute",
      right: 7,
      pointerEvents: "none"
    }
  }));
}
function DirectorDashboard({
  providers,
  shifts,
  settings,
  onToggleWorking,
  onAdjustCensus,
  onAdjustCap,
  onBulkWorking,
  onReorder,
  onToggleRotation,
  onSetAllCap,
  onUpdateShift,
  onSetShift,
  onAddProvider,
  onResetRotation,
  onSetTimeout,
  onToggleAutoReassign,
  onUpdateProvider,
  onRemoveProvider,
  onRenameShift,
  onOpenSchedule
}) {
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  const [capInput, setCapInput] = React.useState("12");
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({
    name: "",
    specialty: "Hospital Medicine",
    cap: "12",
    shift: "day"
  });
  const working = providers.filter(p => p.working);
  const rotation = providers.filter(p => p.working && p.inRotation);
  const totalCensus = providers.reduce((a, p) => a + p.census, 0);
  const totalCap = providers.reduce((a, p) => a + p.cap, 0);
  const allOn = providers.length > 0 && working.length === providers.length;
  const allOff = working.length === 0;
  const handleDrop = targetId => {
    if (dragId && dragId !== targetId) onReorder(dragId, targetId);
    setDragId(null);
    setOverId(null);
  };
  const SHIFT_TINT = {
    day: "amber",
    swing: "blue",
    night: "slate"
  };
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Total providers",
    value: providers.length,
    icon: "users",
    tint: "blue"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Active (on shift)",
    value: working.length,
    icon: "activity",
    tint: "emerald"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "In rotation",
    value: rotation.length,
    icon: "route",
    tint: "amber"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Total census",
    value: totalCensus + " / " + totalCap,
    icon: "bed-double",
    tint: "slate"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginBottom: 18,
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 13
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontWeight: 600,
      color: "var(--foreground)"
    }
  }, totalCensus), " patients across ", providers.length, " providers \xB7 ", totalCap - totalCensus, " beds open. Census is entered manually for now \u2014 automatic ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, "EPIC (FHIR)"), " sync is planned.")), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: "12px 16px",
      marginBottom: 18,
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: "var(--radius-md)",
      background: "#DBEAFE",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar-clock",
    size: 17,
    color: "var(--primary)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: "nowrap"
    }
  }, "On-call schedule synced"), /*#__PURE__*/React.createElement(Badge, {
    status: "accepted",
    icon: "circle"
  }, "Amion \xB7 2m ago")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, "The rotation pool follows the live on-call grid. Toggles below override locally for this shift.")), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "outline",
    icon: "settings",
    onClick: onOpenSchedule
  }, "Manage sync")), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: "14px 16px",
      marginBottom: 18,
      display: "flex",
      alignItems: "center",
      gap: 18,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "layers",
    size: 16,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 700
    }
  }, "Mass set daily census limit"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      background: "#fff"
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: capInput,
    onChange: e => setCapInput(e.target.value.replace(/[^0-9]/g, "")),
    inputMode: "numeric",
    style: {
      width: 52,
      height: 34,
      border: "none",
      outline: "none",
      textAlign: "center",
      fontSize: 14,
      fontWeight: 700,
      fontVariantNumeric: "tabular-nums",
      fontFamily: "var(--font-sans)"
    }
  })), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "default",
    icon: "check",
    onClick: () => {
      const n = parseInt(capInput, 10);
      if (n > 0) onSetAllCap(n);
    }
  }, "Apply to all")), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 28,
      background: "var(--border)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "outline",
    icon: "toggle-left",
    onClick: () => onBulkWorking(false),
    style: allOff ? {
      opacity: .5
    } : null
  }, "All off shift"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "outline",
    icon: "toggle-right",
    onClick: () => onBulkWorking(true),
    style: allOn ? {
      opacity: .5
    } : null
  }, "All on shift"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "default",
    icon: "user-plus",
    onClick: () => setAdding(true)
  }, "Add provider"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16,
      marginBottom: 18
    }
  }, shifts.map(shift => {
    const group = providers.filter(p => p.shift === shift.id);
    return /*#__PURE__*/React.createElement("div", {
      key: shift.id
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
        padding: "0 2px"
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      initials: "",
      size: 10,
      tint: SHIFT_TINT[shift.id]
    }), /*#__PURE__*/React.createElement(EditableText, {
      value: shift.label,
      onSave: val => onRenameShift(shift.id, val),
      size: 14,
      weight: 700
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginLeft: 2
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "clock",
      size: 13,
      color: "var(--muted-foreground)"
    }), /*#__PURE__*/React.createElement("input", {
      type: "time",
      value: shift.start,
      onChange: e => onUpdateShift(shift.id, {
        start: e.target.value
      }),
      style: timeStyle
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--muted-foreground)",
        fontSize: 12
      }
    }, "\u2013"), /*#__PURE__*/React.createElement("input", {
      type: "time",
      value: shift.end,
      onChange: e => onUpdateShift(shift.id, {
        end: e.target.value
      }),
      style: timeStyle
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)",
        marginLeft: "auto",
        fontWeight: 600
      }
    }, group.length, " provider", group.length === 1 ? "" : "s")), /*#__PURE__*/React.createElement(Card, {
      style: {
        padding: 0,
        overflow: "hidden"
      }
    }, group.length === 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "14px 16px",
        fontSize: 12.5,
        color: "var(--muted-foreground)"
      }
    }, "No providers on this shift."), group.map((p, i) => /*#__PURE__*/React.createElement("div", {
      key: p.id,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderTop: i ? "1px solid var(--border)" : "none"
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      initials: p.avatar,
      size: 34,
      tint: p.working ? "emerald" : "slate"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 188,
        flex: "none",
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement(EditableText, {
      value: p.name,
      onSave: val => onUpdateProvider(p.id, {
        name: val
      }),
      size: 13.5,
      weight: 600
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(EditableText, {
      value: p.specialty,
      onSave: val => onUpdateProvider(p.id, {
        specialty: val
      }),
      size: 12,
      weight: 400,
      color: "var(--muted-foreground)",
      placeholder: "Add specialty"
    }))), /*#__PURE__*/React.createElement(ShiftSelect, {
      shifts: shifts,
      value: p.shift,
      onChange: sid => onSetShift(p.id, sid)
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: 18
      }
    }, /*#__PURE__*/React.createElement(Stepper, {
      label: "Census",
      value: p.census,
      onDec: () => onAdjustCensus(p.id, -1),
      onInc: () => onAdjustCensus(p.id, 1)
    }), /*#__PURE__*/React.createElement(Stepper, {
      label: "Cap",
      value: p.cap,
      onDec: () => onAdjustCap(p.id, -1),
      onInc: () => onAdjustCap(p.id, 1)
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 1,
        height: 24,
        background: "var(--border)"
      }
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => onToggleRotation(p.id),
      title: p.inRotation ? "In round-robin — click to remove" : "Off rotation — click to add",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        borderRadius: "var(--radius-full)",
        cursor: "pointer",
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        border: `1px solid ${p.inRotation ? "var(--primary)" : "var(--border)"}`,
        background: p.inRotation ? "var(--primary-tint, #EFF6FF)" : "#fff",
        color: p.inRotation ? "var(--primary)" : "var(--muted-foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: p.inRotation ? "route" : "route-off",
      size: 12
    }), p.inRotation ? "Rotation" : "Off"), /*#__PURE__*/React.createElement("button", {
      onClick: () => onToggleWorking(p.id),
      title: "Toggle shift",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
        border: "none",
        background: "transparent",
        fontFamily: "var(--font-sans)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 40,
        height: 24,
        borderRadius: 99,
        position: "relative",
        flex: "none",
        background: p.working ? "var(--status-accepted)" : "var(--status-neutral-bg)",
        transition: "background .2s"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        top: 3,
        left: p.working ? 19 : 3,
        width: 18,
        height: 18,
        borderRadius: 99,
        background: "#fff",
        boxShadow: "var(--shadow-sm)",
        transition: "left .2s"
      }
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        width: 38,
        textAlign: "left",
        color: p.working ? "var(--status-accepted)" : "var(--muted-foreground)",
        fontWeight: 600
      }
    }, p.working ? "On" : "Off")), /*#__PURE__*/React.createElement("button", {
      onClick: () => onRemoveProvider(p.id),
      title: "Remove provider",
      onMouseEnter: e => e.currentTarget.style.color = "var(--destructive)",
      onMouseLeave: e => e.currentTarget.style.color = "var(--muted-foreground)",
      style: {
        width: 28,
        height: 28,
        flex: "none",
        borderRadius: "var(--radius-md)",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted-foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "trash-2",
      size: 15
    })))))));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 18,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "route",
    size: 18,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "Round-robin config")), /*#__PURE__*/React.createElement(Field, {
    label: "Assignment timeout (min)",
    icon: "timer",
    value: String((settings && settings.timeout) != null ? settings.timeout : 10),
    onChange: v => onSetTimeout && onSetTimeout(parseInt(v.replace(/[^0-9]/g, ""), 10) || 0),
    help: "Unanswered requests re-route after this."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500
    }
  }, "Auto-reassign on expiry"), /*#__PURE__*/React.createElement("button", {
    onClick: onToggleAutoReassign,
    style: {
      width: 44,
      height: 26,
      borderRadius: 99,
      border: "none",
      cursor: "pointer",
      position: "relative",
      background: settings && settings.autoReassign ? "var(--status-accepted)" : "var(--status-neutral-bg)",
      transition: "background .2s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 3,
      left: settings && settings.autoReassign ? 21 : 3,
      width: 20,
      height: 20,
      borderRadius: 99,
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      transition: "left .2s"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm",
    full: true,
    icon: "rotate-ccw",
    onClick: onResetRotation
  }, "Reset rotation index"))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: "0 0 4px"
    }
  }, "Rotation order"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      margin: "0 0 12px"
    }
  }, "On-shift providers in rotation. Drag to reorder; toggle a provider off rotation in their row at left."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, rotation.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      padding: "6px 2px"
    }
  }, "No providers in rotation."), rotation.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    draggable: true,
    onDragStart: () => setDragId(p.id),
    onDragEnd: () => {
      setDragId(null);
      setOverId(null);
    },
    onDragOver: e => {
      e.preventDefault();
      if (overId !== p.id) setOverId(p.id);
    },
    onDrop: e => {
      e.preventDefault();
      handleDrop(p.id);
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 11px",
      border: `1px solid ${overId === p.id && dragId !== p.id ? "var(--primary)" : "var(--border)"}`,
      borderRadius: "var(--radius-md)",
      background: dragId === p.id ? "var(--secondary)" : i === 0 ? "#EFF6FF" : "#fff",
      opacity: dragId === p.id ? 0.5 : 1,
      cursor: "grab",
      transition: "border-color .12s, background .12s"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "grip-vertical",
    size: 15,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 20,
      height: 20,
      borderRadius: 99,
      background: i === 0 ? "var(--primary)" : "var(--secondary)",
      color: i === 0 ? "#fff" : "var(--muted-foreground)",
      fontSize: 11,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13.5,
      fontWeight: 600,
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, p.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      fontVariantNumeric: "tabular-nums"
    }
  }, p.census, "/", p.cap), i === 0 && /*#__PURE__*/React.createElement(Badge, {
    status: "sent"
  }, "Next up")))), working.length > rotation.length && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      paddingTop: 12,
      borderTop: "1px dashed var(--border)",
      fontSize: 12,
      color: "var(--muted-foreground)",
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "route-off",
    size: 13
  }), working.length - rotation.length, " on shift but off rotation"))), adding && /*#__PURE__*/React.createElement(Modal, {
    title: "Add provider",
    subtitle: "They join the rotation on the selected shift.",
    icon: "user-plus",
    onClose: () => setAdding(false),
    children: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Full name",
      icon: "user",
      value: form.name,
      onChange: v => setForm({
        ...form,
        name: v
      }),
      placeholder: "Dr. Jane Smith / Priya Shah, NP"
    }), /*#__PURE__*/React.createElement(Field, {
      label: "Specialty",
      icon: "stethoscope",
      value: form.specialty,
      onChange: v => setForm({
        ...form,
        specialty: v
      }),
      placeholder: "e.g. Cardiology"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 120
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Patient cap",
      icon: "gauge",
      value: form.cap,
      onChange: v => setForm({
        ...form,
        cap: v.replace(/[^0-9]/g, "")
      })
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        display: "block",
        fontSize: 13,
        fontWeight: 500,
        marginBottom: 6
      }
    }, "Shift"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6
      }
    }, shifts.map(s => /*#__PURE__*/React.createElement("button", {
      key: s.id,
      onClick: () => setForm({
        ...form,
        shift: s.id
      }),
      style: {
        flex: 1,
        padding: "9px 8px",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 600,
        border: form.shift === s.id ? "1px solid var(--primary)" : "1px solid var(--border)",
        background: form.shift === s.id ? "#EFF6FF" : "#fff",
        color: form.shift === s.id ? "var(--primary)" : "var(--foreground)"
      }
    }, s.label))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 4
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      size: "sm",
      onClick: () => setAdding(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      icon: "check",
      onClick: () => {
        if (form.name.trim()) {
          onAddProvider(form);
          setForm({
            name: "",
            specialty: "Hospital Medicine",
            cap: "12",
            shift: "day"
          });
          setAdding(false);
        } else window.DT.actions.toast({
          tone: "rejected",
          title: "Name required",
          msg: "Enter the provider's name."
        });
      }
    }, "Add provider")))
  }));
}
const timeStyle = {
  height: 24,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "#fff",
  fontSize: 11.5,
  fontFamily: "var(--font-sans)",
  color: "var(--foreground)",
  padding: "0 4px",
  fontVariantNumeric: "tabular-nums"
};
Object.assign(window, {
  DirectorDashboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/DirectorDashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Directory.jsx
try { (() => {
/* DocTurn web-app UI kit — provider directory (compact single-row list) */

function Directory({
  providers,
  onMessage
}) {
  const [q, setQ] = React.useState("");
  const list = providers.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.specialty.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement(SectionTitle, {
    action: /*#__PURE__*/React.createElement("div", {
      style: {
        width: 240
      }
    }, /*#__PURE__*/React.createElement(Field, {
      icon: "search",
      placeholder: "Search name or specialty\u2026",
      value: q,
      onChange: setQ
    }))
  }, "Provider directory"), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, list.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: "10px 16px",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: p.avatar,
    size: 34,
    tint: p.working ? "emerald" : "slate"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      bottom: -1,
      right: -1,
      border: "2px solid #fff",
      borderRadius: 99
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: p.working ? "online" : "offline",
    pulse: p.working
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      width: 220
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, p.specialty)), /*#__PURE__*/React.createElement(Badge, {
    status: p.working ? "online" : "offline"
  }, p.working ? "On shift" : "Off shift"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      fontVariantNumeric: "tabular-nums",
      display: "inline-flex",
      alignItems: "center",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 13
  }), " ", p.census, "/", p.cap), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "icon",
    variant: "outline",
    icon: "message-square",
    onClick: () => onMessage && onMessage({
      name: p.name,
      role: p.specialty,
      specialty: p.specialty,
      avatar: p.avatar,
      working: p.working,
      tint: p.working ? "emerald" : "slate"
    })
  }), /*#__PURE__*/React.createElement(Button, {
    size: "icon",
    variant: "ghost",
    icon: "phone",
    onClick: () => window.DT.actions.toast({
      tone: "sent",
      title: "Calling " + p.name,
      msg: "Connecting on the secure line…"
    })
  })))), list.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      padding: 40,
      color: "var(--muted-foreground)",
      fontSize: 13
    }
  }, "No providers match \"", q, "\".")));
}
Object.assign(window, {
  Directory
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Directory.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/ErDirectorDashboard.jsx
try { (() => {
/* DocTurn web-app UI kit — ER Director dashboard.
   DISTINCT from the Hospitalist Director: the ER director owns the ER side —
   intake throughput, ER-physician staffing, routing/acceptance performance,
   and diversion status. Store-backed; metrics derive from live intake data.
   Spec: Eng §10.1 (ER director portal), Req FR-6 (broadcasts/diversion). */

function fmtDuration(sec) {
  const m = Math.floor(sec / 60),
    s = sec % 60;
  return m + "m " + String(s).padStart(2, "0") + "s";
}
function ErStat({
  label,
  value,
  icon,
  tint,
  sub
}) {
  const tints = {
    blue: ["#DBEAFE", "var(--primary)"],
    emerald: ["var(--status-accepted-bg)", "var(--status-accepted)"],
    amber: ["var(--status-pending-bg)", "var(--status-pending)"],
    slate: ["var(--status-neutral-bg)", "var(--status-neutral)"]
  };
  const [bg, fg] = tints[tint] || tints.blue;
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 16,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: "var(--radius-md)",
      background: bg,
      color: fg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      fontWeight: 500
    }
  }, label)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 26,
      fontWeight: 800,
      letterSpacing: "-.02em",
      lineHeight: 1
    }
  }, value), sub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      marginTop: 5
    }
  }, sub));
}
function ErShiftSelect({
  shifts,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "inline-flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: e => onChange(e.target.value),
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      height: 28,
      padding: "0 24px 0 10px",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      fontSize: 12,
      fontWeight: 600,
      color: "var(--muted-foreground)",
      fontFamily: "var(--font-sans)",
      cursor: "pointer"
    }
  }, shifts.map(s => /*#__PURE__*/React.createElement("option", {
    key: s.id,
    value: s.id
  }, s.label))), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 12,
    color: "var(--muted-foreground)",
    style: {
      position: "absolute",
      right: 8,
      pointerEvents: "none"
    }
  }));
}
function ErDirectorDashboard({
  erPhysicians,
  shifts,
  sent,
  board,
  diversion,
  avgAcceptSec,
  onToggle,
  onUpdate,
  onSetShift,
  onAdd,
  onRemove,
  onToggleDiversion,
  onBroadcasts
}) {
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shift, setShift] = React.useState("day");
  const onShift = erPhysicians.filter(p => p.working);
  const admitsToday = erPhysicians.reduce((a, p) => a + (p.admitsToday || 0), 0);
  const todaySent = sent.filter(s => s.day === "Today");
  const accepted = sent.filter(s => s.status === "accepted").length;
  const rejected = sent.filter(s => s.status === "rejected").length;
  const acceptRate = accepted + rejected ? Math.round(accepted / (accepted + rejected) * 100) : 100;
  const pendingER = board.filter(b => b.status === "pending").length;
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 16px",
      marginBottom: 18,
      borderRadius: "var(--radius-md)",
      background: diversion ? "var(--status-rejected-bg)" : "var(--status-accepted-bg)",
      border: `1px solid ${diversion ? "var(--status-rejected)" : "var(--status-accepted)"}`
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: diversion ? "octagon-alert" : "circle-check-big",
    size: 20,
    color: diversion ? "var(--status-rejected)" : "var(--status-accepted)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: diversion ? "var(--status-rejected)" : "var(--status-accepted)"
    }
  }, diversion ? "ER is on diversion" : "ER is accepting patients"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, diversion ? "Incoming ambulances are being diverted. EMS and all providers were notified." : "Normal operations — incoming transfers and walk-ins are accepted.")), /*#__PURE__*/React.createElement(Button, {
    variant: diversion ? "default" : "outline",
    size: "sm",
    icon: diversion ? "circle-check-big" : "octagon-alert",
    onClick: onToggleDiversion
  }, diversion ? "Lift diversion" : "Declare diversion")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(ErStat, {
    label: "Admits today",
    value: admitsToday,
    icon: "clipboard-plus",
    tint: "blue",
    sub: todaySent.length + " routed via DocTurn"
  }), /*#__PURE__*/React.createElement(ErStat, {
    label: "Avg time-to-accept",
    value: fmtDuration(avgAcceptSec),
    icon: "timer",
    tint: "amber",
    sub: "across hospitalist groups"
  }), /*#__PURE__*/React.createElement(ErStat, {
    label: "Acceptance rate",
    value: acceptRate + "%",
    icon: "check-check",
    tint: "emerald",
    sub: accepted + " accepted · " + rejected + " re-routed"
  }), /*#__PURE__*/React.createElement(ErStat, {
    label: "Pending in ER",
    value: pendingER,
    icon: "loader",
    tint: "slate",
    sub: "awaiting hospitalist accept"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.3fr .9fr",
      gap: 16,
      alignItems: "start",
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "ambulance",
    size: 18,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "ER physicians"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, "\xB7 ", onShift.length, " of ", erPhysicians.length, " on shift"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: adding ? "secondary" : "default",
    icon: adding ? "x" : "user-plus",
    onClick: () => setAdding(!adding)
  }, adding ? "Cancel" : "Add"))), adding && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      alignItems: "flex-end",
      margin: "12px 0 6px",
      padding: 12,
      background: "var(--secondary)",
      borderRadius: "var(--radius-md)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Physician name",
    icon: "user",
    value: name,
    onChange: setName,
    placeholder: "Dr. Jane Smith"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      display: "block",
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 6
    }
  }, "Shift"), /*#__PURE__*/React.createElement(ErShiftSelect, {
    shifts: shifts,
    value: shift,
    onChange: setShift
  })), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: "check",
    onClick: () => {
      if (name.trim()) {
        onAdd({
          name,
          shift
        });
        setName("");
        setAdding(false);
      }
    }
  }, "Add")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9,
      marginTop: 12
    }
  }, erPhysicians.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 12px",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      opacity: p.working ? 1 : 0.62
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: p.avatar,
    size: 38,
    tint: p.working ? "blue" : "slate"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      bottom: -1,
      right: -1,
      border: "2px solid #fff",
      borderRadius: 99
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: p.working ? "online" : "offline"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(EditableText, {
    value: p.name,
    onSave: v => onUpdate(p.id, {
      name: v
    }),
    size: 14,
    weight: 600
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      marginTop: 2,
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clipboard-plus",
    size: 12
  }), p.admitsToday, " admit", p.admitsToday === 1 ? "" : "s", " today")), /*#__PURE__*/React.createElement(ErShiftSelect, {
    shifts: shifts,
    value: p.shift,
    onChange: sid => onSetShift(p.id, sid)
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => onToggle(p.id),
    title: p.working ? "End shift" : "Start shift",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "5px 11px",
      borderRadius: "var(--radius-full)",
      cursor: "pointer",
      fontSize: 11.5,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      border: "1px solid var(--border)",
      background: p.working ? "var(--status-accepted-bg)" : "#fff",
      color: p.working ? "var(--status-accepted)" : "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: p.working ? "toggle-right" : "toggle-left",
    size: 13
  }), p.working ? "On shift" : "Off"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onRemove(p.id),
    title: "Remove",
    onMouseEnter: e => e.currentTarget.style.color = "var(--destructive)",
    onMouseLeave: e => e.currentTarget.style.color = "var(--muted-foreground)",
    style: {
      width: 28,
      height: 28,
      borderRadius: "var(--radius-md)",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "trash-2",
    size: 15
  })))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "activity",
    size: 17,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "Recent intakes")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, sent.slice(0, 5).map(s => {
    const st = {
      accepted: ["accepted", "Accepted"],
      sent: ["pending", "Routing"],
      rejected: ["rejected", "Re-routed"]
    }[s.status] || ["pending", "Routing"];
    return /*#__PURE__*/React.createElement("div", {
      key: s.id,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      initials: s.initials,
      size: 30,
      tint: "slate"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, s.complaint), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: "var(--muted-foreground)"
      }
    }, "\u2192 ", s.provider, " \xB7 ", s.time)), /*#__PURE__*/React.createElement(Badge, {
      status: st[0]
    }, st[1]));
  }))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "megaphone",
    size: 17,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "ER operations")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      margin: "0 0 12px"
    }
  }, "Send a targeted alert or review acknowledgement tracking."), /*#__PURE__*/React.createElement(Button, {
    full: true,
    variant: "outline",
    icon: "megaphone",
    onClick: onBroadcasts
  }, "Open broadcasts")))));
}
Object.assign(window, {
  ErDirectorDashboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/ErDirectorDashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/ErDoctorDashboard.jsx
try { (() => {
/* DocTurn web-app UI kit — ER physician dashboard (intake + assign + reassign).
   Routes a patient to a primary hospitalist (round-robin or manual) and can add
   one or more consult services. Recently-sent keeps a 2-day history, including
   accepted hand-offs, and lets the ER provider reassign at any time. */

const CONSULT_OPTIONS = ["Hospital Medicine", "Cardiology", "GI", "Pulmonology", "Nephrology", "Endocrine", "Infectious Disease", "Neurology"];

// On-call provider per consult service (the group's current attending of record).
const CONSULT_ROSTER = {
  "Hospital Medicine": {
    name: "Dr. Amir Patel",
    avatar: "AP",
    onCall: true
  },
  "Cardiology": {
    name: "Dr. Sarah Chen",
    avatar: "SC",
    onCall: true
  },
  "GI": {
    name: "Dr. Ruth Kim",
    avatar: "RK",
    onCall: true
  },
  "Pulmonology": {
    name: "Dr. Maria Lopez",
    avatar: "ML",
    onCall: true
  },
  "Nephrology": {
    name: "Dr. James Liu",
    avatar: "JL",
    onCall: false
  },
  "Endocrine": {
    name: "Dr. Nadia Farouk",
    avatar: "NF",
    onCall: true
  },
  "Infectious Disease": {
    name: "Dr. Omar Haddad",
    avatar: "OH",
    onCall: true
  },
  "Neurology": {
    name: "Dr. Lena Ortiz",
    avatar: "LO",
    onCall: true
  }
};
// Midlevels (NP/PA) the ER can add onto a consult.
const MIDLEVEL_POOL = [{
  id: "ml1",
  name: "Priya Shah, NP",
  avatar: "PS",
  role: "NP"
}, {
  id: "ml2",
  name: "Marcus Bell, PA-C",
  avatar: "MB",
  role: "PA"
}, {
  id: "ml3",
  name: "Jordan Wu, PA-C",
  avatar: "JW",
  role: "PA"
}, {
  id: "ml4",
  name: "Nina Roy, NP",
  avatar: "NR",
  role: "NP"
}];
function ChannelPill({
  on,
  icon,
  label,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 11px",
      borderRadius: "var(--radius-full)",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      transition: "all .12s",
      whiteSpace: "nowrap",
      border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
      background: on ? "var(--primary-tint, #EFF6FF)" : "#fff",
      color: on ? "var(--primary)" : "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 12
  }), label);
}
function ConsultRowLabel({
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: "var(--muted-foreground)",
      textTransform: "uppercase",
      letterSpacing: ".05em",
      width: 58,
      flex: "none",
      paddingTop: 5
    }
  }, children);
}
function ConsultPanel({
  service,
  roster,
  pool,
  members,
  channels,
  onAddMember,
  onRemoveMember,
  onToggleChannel,
  onRemoveService
}) {
  const [adding, setAdding] = React.useState(false);
  const r = roster || {
    name: "On-call provider",
    avatar: "?",
    onCall: true
  };
  const addable = pool.filter(m => !members.some(x => x.id === m.id));
  const noChannel = !channels.app && !channels.text;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      background: "#fff",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "11px 13px",
      background: "var(--secondary)",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: "var(--radius-md)",
      background: "#DBEAFE",
      color: "var(--primary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "stethoscope",
    size: 15
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      lineHeight: 1.25
    }
  }, service), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      marginTop: 1,
      display: "flex",
      alignItems: "center",
      gap: 5,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: r.onCall ? "online" : "offline",
    pulse: r.onCall
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, r.name, " \xB7 ", r.onCall ? "on call" : "covering provider paged"))), /*#__PURE__*/React.createElement(Avatar, {
    initials: r.avatar,
    size: 30,
    tint: "blue"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onRemoveService,
    title: "Remove consult",
    onMouseEnter: e => e.currentTarget.style.color = "var(--destructive)",
    onMouseLeave: e => e.currentTarget.style.color = "var(--muted-foreground)",
    style: {
      width: 26,
      height: 26,
      borderRadius: "var(--radius-md)",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 15
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 13,
      display: "flex",
      flexDirection: "column",
      gap: 11
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(ConsultRowLabel, null, "Unit"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6
    }
  }, members.length === 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      paddingTop: 3
    }
  }, "Provider only"), members.map(m => /*#__PURE__*/React.createElement("span", {
    key: m.id,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      background: "var(--secondary)",
      borderRadius: "var(--radius-full)",
      padding: "3px 8px 3px 4px"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: m.avatar,
    size: 20,
    tint: (window.TEAM_ROLE[m.role] || {}).tint || "slate"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600
    }
  }, m.name.split(",")[0]), /*#__PURE__*/React.createElement(RolePill, {
    role: m.role
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => onRemoveMember(m.id),
    style: {
      border: "none",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      color: "var(--muted-foreground)",
      padding: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 12
  })))), addable.length > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setAdding(!adding),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "4px 10px",
      borderRadius: "var(--radius-full)",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      whiteSpace: "nowrap",
      border: "1px dashed var(--border)",
      background: "#fff",
      color: "var(--primary)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: adding ? "x" : "plus",
    size: 12
  }), adding ? "Close" : "Add PA / NP"))), adding && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4,
      background: "var(--secondary)",
      borderRadius: "var(--radius-md)",
      padding: 6,
      marginLeft: 68
    }
  }, addable.map(m => /*#__PURE__*/React.createElement("button", {
    key: m.id,
    onClick: () => {
      onAddMember(m);
      if (addable.length === 1) setAdding(false);
    },
    onMouseEnter: e => e.currentTarget.style.background = "#fff",
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "7px 9px",
      border: "none",
      borderRadius: "var(--radius-md)",
      background: "transparent",
      cursor: "pointer",
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: m.avatar,
    size: 26,
    tint: (window.TEAM_ROLE[m.role] || {}).tint || "slate"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 12.5,
      fontWeight: 600,
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, m.name, /*#__PURE__*/React.createElement(RolePill, {
    role: m.role
  })), /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14,
    color: "var(--primary)"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(ConsultRowLabel, null, "Notify"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: 7,
      flexWrap: "wrap",
      paddingTop: 0
    }
  }, /*#__PURE__*/React.createElement(ChannelPill, {
    on: channels.app,
    icon: "smartphone",
    label: "App push",
    onClick: () => onToggleChannel("app")
  }), /*#__PURE__*/React.createElement(ChannelPill, {
    on: channels.text,
    icon: "message-square",
    label: "Text / SMS",
    onClick: () => onToggleChannel("text")
  }), noChannel && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 11.5,
      color: "var(--status-pending)",
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert-triangle",
    size: 12
  }), "Won't be paged")))));
}
function ReassignSelect({
  providers,
  onPick
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "inline-flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "repeat",
    size: 13,
    color: "var(--muted-foreground)",
    style: {
      position: "absolute",
      left: 10,
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("select", {
    value: "",
    onChange: e => {
      if (e.target.value) onPick(e.target.value);
    },
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      height: 32,
      padding: "0 26px 0 28px",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      fontSize: 12.5,
      fontWeight: 600,
      color: "var(--foreground)",
      fontFamily: "var(--font-sans)",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "Reassign\u2026"), providers.map(p => /*#__PURE__*/React.createElement("option", {
    key: p.id,
    value: p.name
  }, p.name))), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 13,
    color: "var(--muted-foreground)",
    style: {
      position: "absolute",
      right: 8,
      pointerEvents: "none"
    }
  }));
}
function ErDoctorDashboard({
  providers,
  onSend,
  onReassign,
  sent
}) {
  const [note, setNote] = React.useState("");
  const [extracted, setExtracted] = React.useState(false);
  const [fields, setFields] = React.useState({
    initials: "",
    room: "",
    complaint: "",
    specialty: ""
  });
  const [mode, setMode] = React.useState("quick"); // quick | manual
  const [manual, setManual] = React.useState(providers[0].id);
  const [consults, setConsults] = React.useState([]);
  const [consultMembers, setConsultMembers] = React.useState({});
  const [consultChannels, setConsultChannels] = React.useState({});
  const chOf = s => consultChannels[s] || {
    app: true,
    text: true
  };
  const runExtract = () => {
    const r = window.extractIntake(note);
    if (r.empty) {
      setFields({
        initials: "SC",
        room: "412",
        complaint: "Chest pain, SOB on exertion",
        specialty: "Cardiology"
      });
      setConsults(["Cardiology"]);
    } else {
      setFields({
        initials: r.initials,
        room: r.room,
        complaint: r.complaint,
        specialty: r.specialty
      });
      setConsults(r.consults);
    }
    setExtracted(true);
  };
  const reset = () => {
    setNote("");
    setExtracted(false);
    setConsults([]);
    setConsultMembers({});
    setConsultChannels({});
    setFields({
      initials: "",
      room: "",
      complaint: "",
      specialty: ""
    });
  };
  const toggleConsult = s => setConsults(c => {
    if (c.includes(s)) {
      setConsultMembers(cm => {
        const n = Object.assign({}, cm);
        delete n[s];
        return n;
      });
      setConsultChannels(cc => {
        const n = Object.assign({}, cc);
        delete n[s];
        return n;
      });
      return c.filter(x => x !== s);
    }
    return [...c, s];
  });
  const addConsultMember = (s, m) => setConsultMembers(cm => Object.assign({}, cm, {
    [s]: [...(cm[s] || []), m]
  }));
  const removeConsultMember = (s, id) => setConsultMembers(cm => Object.assign({}, cm, {
    [s]: (cm[s] || []).filter(x => x.id !== id)
  }));
  const toggleChannel = (s, ch) => setConsultChannels(cc => Object.assign({}, cc, {
    [s]: Object.assign({}, chOf(s), {
      [ch]: !chOf(s)[ch]
    })
  }));
  const canSend = fields.initials && fields.room;
  const doSend = () => {
    if (!canSend) return;
    onSend(mode === "quick" ? providers[0] : providers.find(p => p.id === manual), fields, consults);
    reset();
  };

  // Group recently-sent by day (2-day retention), preserving original index for reassign.
  const dayOrder = ["Today", "Yesterday"];
  const grouped = {};
  sent.forEach((s, idx) => {
    (grouped[s.day] = grouped[s.day] || []).push({
      ...s,
      idx
    });
  });
  const dayKeys = [...dayOrder.filter(d => grouped[d]), ...Object.keys(grouped).filter(d => !dayOrder.includes(d))];
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.25fr 1fr",
      gap: 18,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "New patient intake"), /*#__PURE__*/React.createElement(Field, {
    textarea: true,
    rows: 4,
    label: "Intake note",
    placeholder: "Paste or type free\u2011text notes \u2014 AI extracts structured fields\u2026",
    value: note,
    onChange: setNote,
    help: "No real PHI \u2014 synthetic examples only (e.g. initials)."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      margin: "12px 0 4px"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "sparkles",
    onClick: runExtract
  }, "Extract with AI"), extracted && /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "rotate-ccw",
    onClick: reset
  }, "Clear")), extracted && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      paddingTop: 16,
      borderTop: "1px dashed var(--border)",
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      color: "var(--status-accepted)",
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 13
  }), " Extracted from note \xB7 review before sending"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Patient initials",
    icon: "user",
    value: fields.initials,
    onChange: v => setFields({
      ...fields,
      initials: v
    })
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Room",
    icon: "door-open",
    value: fields.room,
    onChange: v => setFields({
      ...fields,
      room: v
    })
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Chief complaint",
    icon: "clipboard-list",
    value: fields.complaint,
    onChange: v => setFields({
      ...fields,
      complaint: v
    })
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Suggested specialty",
    icon: "stethoscope",
    value: fields.specialty,
    onChange: v => setFields({
      ...fields,
      specialty: v
    }),
    help: "AI suggestion \u2014 editable."
  }))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "Route assignment"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMode("quick"),
    style: tabStyle(mode === "quick")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "zap",
    size: 15
  }), " Quick (round\u2011robin)"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setMode("manual"),
    style: tabStyle(mode === "manual")
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "user-check",
    size: 15
  }), " Manual")), mode === "quick" ? /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#EFF6FF",
      border: "1px solid #BFDBFE",
      borderRadius: "var(--radius-md)",
      padding: 14,
      display: "flex",
      gap: 11,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "route",
    size: 18,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#1e3a8a",
      lineHeight: 1.5
    }
  }, "Routes to the ", /*#__PURE__*/React.createElement("b", null, "lowest\u2011census"), " eligible hospitalist on shift. Next up:", " ", /*#__PURE__*/React.createElement("b", null, providers[0].name), " (", providers[0].census, "/", providers[0].cap, ").")) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, providers.map(p => /*#__PURE__*/React.createElement("button", {
    key: p.id,
    onClick: () => setManual(p.id),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "10px 12px",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      textAlign: "left",
      border: `1px solid ${manual === p.id ? "var(--primary)" : "var(--border)"}`,
      background: manual === p.id ? "#EFF6FF" : "#fff"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: p.avatar,
    size: 32,
    tint: p.working ? "emerald" : "slate"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, p.specialty, " \xB7 ", p.census, "/", p.cap)), /*#__PURE__*/React.createElement(StatusDot, {
    status: p.working ? "online" : "offline"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      paddingTop: 16,
      borderTop: "1px dashed var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 7,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users-round",
    size: 15,
    color: "var(--muted-foreground)",
    style: {
      alignSelf: "center"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, "Consult services"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, "optional \xB7 select multiple")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8
    }
  }, CONSULT_OPTIONS.map(s => {
    const on = consults.includes(s);
    return /*#__PURE__*/React.createElement("button", {
      key: s,
      onClick: () => toggleConsult(s),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: "var(--radius-full)",
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
        border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
        background: on ? "#EFF6FF" : "#fff",
        color: on ? "var(--primary)" : "var(--foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: on ? "check" : "plus",
      size: 12
    }), " ", s);
  })), consults.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      marginTop: 12
    }
  }, consults.map(s => /*#__PURE__*/React.createElement(ConsultPanel, {
    key: s,
    service: s,
    roster: CONSULT_ROSTER[s],
    pool: MIDLEVEL_POOL,
    members: consultMembers[s] || [],
    channels: chOf(s),
    onAddMember: m => addConsultMember(s, m),
    onRemoveMember: id => removeConsultMember(s, id),
    onToggleChannel: ch => toggleChannel(s, ch),
    onRemoveService: () => toggleConsult(s)
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Button, {
    full: true,
    icon: "send",
    onClick: doSend,
    style: {
      opacity: canSend ? 1 : 0.5,
      pointerEvents: canSend ? "auto" : "none"
    }
  }, "Send assignment", consults.length ? ` + ${consults.length} consult${consults.length > 1 ? "s" : ""}` : ""), !canSend && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      marginTop: 8,
      textAlign: "center"
    }
  }, "Add patient initials & room to send.")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 26
    }
  }, /*#__PURE__*/React.createElement(SectionTitle, {
    action: /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: "var(--muted-foreground)",
        fontWeight: 500
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "history",
      size: 13
    }), " Kept 2 days \xB7 accepted included")
  }, "Recently sent"), sent.length === 0 && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 28,
      textAlign: "center",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No assignments sent yet."), dayKeys.map(day => /*#__PURE__*/React.createElement("div", {
    key: day,
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: "var(--muted-foreground)",
      textTransform: "uppercase",
      letterSpacing: ".04em",
      margin: "0 2px 8px"
    }
  }, day), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "visible"
    }
  }, grouped[day].map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s.idx,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "12px 16px",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: s.initials,
    size: 32,
    tint: s.status === "accepted" ? "emerald" : "blue"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, "Patient ", s.initials, " \u2192 ", s.provider), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", null, s.complaint || "—", " \xB7 ", s.time), (s.consultants || []).map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "1px 8px",
      borderRadius: "var(--radius-full)",
      background: "var(--secondary)",
      color: "var(--foreground)",
      fontSize: 11,
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "stethoscope",
    size: 10
  }), " ", c)))), /*#__PURE__*/React.createElement(ReassignSelect, {
    providers: providers,
    onPick: name => onReassign(s.id, name)
  }), /*#__PURE__*/React.createElement(Badge, {
    status: s.status
  }, STATUS[s.status].label))))))));
  function tabStyle(active) {
    return {
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      padding: "9px 10px",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 500,
      border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
      background: active ? "#EFF6FF" : "#fff",
      color: active ? "var(--primary)" : "var(--foreground)"
    };
  }
}
Object.assign(window, {
  ErDoctorDashboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/ErDoctorDashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/HospitalistDashboard.jsx
try { (() => {
/* DocTurn web-app UI kit — Hospitalist dashboard (census + accept/decline) */

function ExpiryBadge({
  expiresAt
}) {
  useClock();
  const remain = expiresAt - Date.now();
  const urgent = remain <= 60000;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "2px 9px",
      borderRadius: "var(--radius-full)",
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 1.6,
      fontVariantNumeric: "tabular-nums",
      background: urgent ? "var(--status-rejected-bg)" : "var(--status-pending-bg)",
      color: urgent ? "var(--status-rejected)" : "var(--status-pending)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: urgent ? "alarm-clock" : "clock",
    size: 11
  }), "Expires in ", dtFmt.mmss(remain));
}
function HospitalistDashboard({
  pending,
  onAccept,
  onDecline,
  myPatients,
  acceptedToday = 0,
  unit = [],
  onOpenTeam,
  onMessage
}) {
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Current census",
    value: myPatients.length,
    icon: "users",
    tint: "blue"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Patient cap",
    value: "" + myPatients.length + "/12",
    icon: "gauge",
    tint: "slate"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Pending",
    value: pending.length,
    icon: "clock",
    tint: "amber"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Accepted today",
    value: acceptedToday,
    icon: "check-circle-2",
    tint: "emerald"
  })), /*#__PURE__*/React.createElement("div", {
    onClick: onOpenTeam,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "11px 14px",
      marginBottom: 18,
      borderRadius: "var(--radius-md)",
      background: "#EFF6FF",
      border: "1px solid #BFDBFE",
      cursor: onOpenTeam ? "pointer" : "default"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 16,
    color: "var(--primary)"
  }), unit.length === 0 ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "#1E3A5F"
    }
  }, "You're taking requests solo. ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      textDecoration: "underline"
    }
  }, "Add a midlevel or partner"), " to share your on-call load.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "#1E3A5F",
      whiteSpace: "nowrap"
    }
  }, "Requests are shared with your on-call unit:"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, unit.map(m => /*#__PURE__*/React.createElement("span", {
    key: m.id,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      background: "#fff",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-full)",
      padding: "2px 8px 2px 3px"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: m.avatar,
    size: 18,
    tint: (window.TEAM_ROLE[m.role] || {}).tint || "slate"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: "nowrap"
    }
  }, m.name.split(",")[0]), /*#__PURE__*/React.createElement(RolePill, {
    role: m.role
  })))), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 15,
    color: "var(--muted-foreground)",
    style: {
      marginLeft: "auto"
    }
  }))), /*#__PURE__*/React.createElement(SectionTitle, {
    action: /*#__PURE__*/React.createElement(Badge, {
      status: "pending"
    }, pending.length, " awaiting")
  }, "Incoming assignment requests"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12,
      marginBottom: 28
    }
  }, pending.length === 0 && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 36,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "inbox",
    size: 26,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      marginTop: 8
    }
  }, "No pending assignments"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      marginTop: 2
    }
  }, "You're all caught up.")), pending.map(p => /*#__PURE__*/React.createElement(Card, {
    key: p.id,
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: p.initials,
    size: 42,
    tint: "amber"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      whiteSpace: "nowrap"
    }
  }, "Patient ", p.initials), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      whiteSpace: "nowrap"
    }
  }, "\xB7 Room ", p.room), p.expiresAt ? /*#__PURE__*/React.createElement(ExpiryBadge, {
    expiresAt: p.expiresAt
  }) : /*#__PURE__*/React.createElement(Badge, {
    status: "pending"
  }, "Pending")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--foreground)",
      marginTop: 4
    }
  }, p.complaint), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginTop: 8,
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 5,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "ambulance",
    size: 13
  }), "from ", p.from), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 5,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "stethoscope",
    size: 13
  }), p.specialty), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      gap: 5,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "route",
    size: 13
  }), p.via))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm",
    icon: "x",
    onClick: () => onDecline(p.id)
  }, "Decline"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: "check",
    onClick: () => onAccept(p.id)
  }, "Accept")))))), /*#__PURE__*/React.createElement(SectionTitle, null, "My patients"), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, myPatients.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "12px 16px",
      borderTop: i ? "1px solid var(--border)" : "none"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: p.initials,
    size: 34,
    tint: "blue"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, "Patient ", p.initials, " \xB7 Room ", p.room), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, p.complaint)), /*#__PURE__*/React.createElement(Badge, {
    status: "accepted"
  }, "Accepted"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "message-square",
    onClick: () => onMessage && onMessage({
      name: `Patient ${p.initials} \u00b7 care`,
      role: `Room ${p.room}`,
      avatar: p.initials,
      tint: "blue"
    })
  }, "Message")))));
}
Object.assign(window, {
  HospitalistDashboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/HospitalistDashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/LockScreen.jsx
try { (() => {
/* DocTurn web-app UI kit — App lock screen (HIPAA session security).
   Shows on manual lock or after inactivity. Unlock with a 4-digit PIN
   (any code, demo) or "Face ID". Mirrors the mobile app-lock + the 15-min
   session-timeout policy. Self-contained; calls onUnlock() to dismiss. */

function LockScreen({
  me,
  appName,
  reason,
  onUnlock
}) {
  const who = me || {
    name: "Dr. Jordan Chen",
    avatar: "JC",
    role: "Director"
  };
  const [pin, setPin] = React.useState("");
  const [shake, setShake] = React.useState(false);
  const press = d => {
    setPin(p => {
      if (p.length >= 4) return p;
      const next = p + d;
      if (next.length === 4) setTimeout(() => onUnlock(), 260);
      return next;
    });
  };
  const back = () => setPin(p => p.slice(0, -1));
  const faceId = () => {
    setShake(false);
    setTimeout(() => onUnlock(), 500);
  };
  React.useEffect(() => {
    const onKey = e => {
      if (/^[0-9]$/.test(e.key)) press(e.key);else if (e.key === "Backspace") back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "face", "0", "back"];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 80,
      background: "linear-gradient(160deg,#0b1220 0%,#172033 60%,#1e293b 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      animation: "dt-toast-in .2s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 320,
      textAlign: "center",
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 14,
      marginBottom: 26
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 56,
      height: 56,
      borderRadius: 16,
      background: "var(--primary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 8px 24px rgba(37,99,235,.4)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 26,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700
    }
  }, appName || "DocTurn", " locked"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "rgba(255,255,255,.6)",
      marginTop: 3
    }
  }, reason || "Session paused for security"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 9,
      padding: "6px 14px 6px 6px",
      borderRadius: 99,
      background: "rgba(255,255,255,.08)",
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 99,
      background: "rgba(255,255,255,.16)",
      color: "#fff",
      fontWeight: 700,
      fontSize: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, who.avatar), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, who.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 16,
      justifyContent: "center",
      marginBottom: 28,
      transition: "transform .1s",
      transform: shake ? "translateX(0)" : "none"
    }
  }, [0, 1, 2, 3].map(i => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 14,
      height: 14,
      borderRadius: 99,
      border: "1.5px solid rgba(255,255,255,.45)",
      background: i < pin.length ? "#fff" : "transparent",
      transition: "background .15s"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 16,
      justifyItems: "center"
    }
  }, KEYS.map(k => {
    if (k === "face") return /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: faceId,
      title: "Face ID",
      style: lockKeyStyle(true)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "scan-face",
      size: 24,
      color: "rgba(255,255,255,.85)"
    }));
    if (k === "back") return /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: back,
      title: "Delete",
      style: lockKeyStyle(true)
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "delete",
      size: 22,
      color: "rgba(255,255,255,.85)"
    }));
    return /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: () => press(k),
      style: lockKeyStyle(false),
      onMouseDown: e => e.currentTarget.style.background = "rgba(255,255,255,.22)",
      onMouseUp: e => e.currentTarget.style.background = "rgba(255,255,255,.1)",
      onMouseLeave: e => e.currentTarget.style.background = "rgba(255,255,255,.1)"
    }, k);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24,
      fontSize: 11.5,
      color: "rgba(255,255,255,.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-check",
    size: 13,
    color: "rgba(255,255,255,.45)"
  }), "Auto-locks after 15 min idle \xB7 HIPAA")));
}
function lockKeyStyle(plain) {
  return {
    width: 66,
    height: 66,
    borderRadius: 99,
    border: "none",
    cursor: "pointer",
    background: plain ? "transparent" : "rgba(255,255,255,.1)",
    color: "#fff",
    fontSize: 26,
    fontWeight: 400,
    fontFamily: "var(--font-sans)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background .12s"
  };
}
Object.assign(window, {
  LockScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/LockScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/LoginScreen.jsx
try { (() => {
/* DocTurn web-app UI kit — auth / login screen */

function LoginScreen({
  onLogin,
  appName
}) {
  const brand = appName || "DocTurn";
  const [org, setOrg] = React.useState("MERCY");
  const [user, setUser] = React.useState("dr.chen");
  const [pass, setPass] = React.useState("••••••••");
  const [role, setRole] = React.useState("hospitalist");
  const roles = [{
    id: "hospitalist",
    label: "Hospitalist",
    icon: "stethoscope"
  }, {
    id: "er_doctor",
    label: "ER physician",
    icon: "ambulance"
  }, {
    id: "er_director",
    label: "ER director",
    icon: "siren"
  }, {
    id: "director",
    label: "Hospitalist director",
    icon: "clipboard-list"
  }, {
    id: "developer",
    label: "Developer",
    icon: "terminal"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      minHeight: "100vh",
      background: "var(--background)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 50%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      maxWidth: 360
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: "var(--radius-md)",
      background: "var(--primary)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 800,
      fontSize: 18
    }
  }, brand.charAt(0).toUpperCase()), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22,
      fontWeight: 800,
      letterSpacing: "-.02em"
    }
  }, brand)), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 24,
      fontWeight: 700,
      margin: "28px 0 6px"
    }
  }, "Sign in"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      color: "var(--muted-foreground)",
      margin: "0 0 24px"
    }
  }, "Secure access to your hospital workspace."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Organization code",
    icon: "building-2",
    value: org,
    onChange: setOrg,
    help: "Your hospital's short code."
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Username",
    icon: "user",
    value: user,
    onChange: setUser
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Password",
    icon: "lock",
    type: "password",
    value: pass,
    onChange: setPass
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      display: "block",
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 8
    }
  }, "Demo as role"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(2,1fr)",
      gap: 8
    }
  }, roles.map(r => /*#__PURE__*/React.createElement("button", {
    key: r.id,
    onClick: () => setRole(r.id),
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      padding: "11px 6px",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 500,
      border: `1px solid ${role === r.id ? "var(--primary)" : "var(--border)"}`,
      background: role === r.id ? "var(--primary-tint, #EFF6FF)" : "#fff",
      color: role === r.id ? "var(--primary)" : "var(--foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: r.icon,
    size: 18
  }), r.label)))), /*#__PURE__*/React.createElement(Button, {
    full: true,
    size: "lg",
    onClick: () => onLogin(role, org, user)
  }, "Sign in"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
      color: "var(--muted-foreground)",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-check",
    size: 14,
    color: "var(--status-accepted)"
  }), "HIPAA\u2011compliant \xB7 MFA enabled \xB7 15\u2011min sessions")))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 50%",
      background: "var(--marketing-bg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 48,
      position: "relative",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 380,
      position: "relative",
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "rgba(255,255,255,.7)",
      padding: "5px 12px",
      borderRadius: "99px",
      fontSize: 12,
      fontWeight: 600,
      color: "var(--sky-700)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "route",
    size: 14
  }), " Patient assignment, automated"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 34,
      fontWeight: 700,
      lineHeight: 1.15,
      letterSpacing: "-0.02em",
      color: "#0f172a",
      margin: "18px 0 12px"
    }
  }, "Every admit reaches the right hospitalist \u2014 in seconds."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 15,
      color: "#475569",
      lineHeight: 1.55,
      margin: 0
    }
  }, "Round\u2011robin routing, real\u2011time notifications across push and SMS, and HIPAA\u2011compliant messaging for your whole care team."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 28,
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, [["bell-ring", "Notified instantly", "WebSocket → push → SMS cascade"], ["repeat", "Fair rotation", "Lowest‑census provider goes next"], ["lock", "PHI stays protected", "Initials only, full audit trail"]].map(([ic, t, d]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 10,
      background: "#fff",
      color: "var(--primary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 18
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: "#0f172a"
    }
  }, t), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "#64748b"
    }
  }, d)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 320,
      height: 320,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(56,189,248,.25), transparent 70%)",
      top: -80,
      right: -60
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 260,
      height: 260,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(255,228,230,.6), transparent 70%)",
      bottom: -70,
      left: -50
    }
  })));
}
Object.assign(window, {
  LoginScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/LoginScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Messaging.jsx
try { (() => {
/* DocTurn web-app UI kit — secure messaging (conversation list + thread).
   Fully store-backed: conversations and threads persist, unread clears on open,
   sending posts to the store and triggers a simulated typing + reply, and the
   header / search / new-thread / attach controls all do real work. */

function fmtTime(at) {
  // single source of truth — shared with the store's clock + mobile composer
  if (window.dtFmt && window.dtFmt.hhmm) return window.dtFmt.hhmm(at);
  const d = new Date(at);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function Messaging() {
  const st = useStore();
  const a = useActions();
  const convos = st.conversations;
  const [active, setActive] = React.useState(st.__activeConvo || convos[0] && convos[0].id);
  const [draft, setDraft] = React.useState("");
  const [q, setQ] = React.useState("");
  const [composing, setComposing] = React.useState(false);
  const threadRef = React.useRef(null);

  // follow a store-initiated conversation switch (e.g. "Message" from another screen)
  React.useEffect(() => {
    if (st.__activeConvo && st.__activeConvo !== active) setActive(st.__activeConvo);
  }, [st.__activeConvo]);
  // clear unread whenever the open thread changes
  React.useEffect(() => {
    if (active) a.openConversation(active);
  }, [active]);
  // keep the thread pinned to the latest message
  const conv = convos.find(c => c.id === active) || convos[0];
  React.useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv && conv.messages.length, conv && conv.typing]);
  const list = convos.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || (c.role || "").toLowerCase().includes(q.toLowerCase()));
  const send = () => {
    if (!draft.trim()) return;
    a.sendMessage(active, draft);
    setDraft("");
  };
  const startWith = p => {
    a.startConversation({
      name: p.name,
      specialty: p.specialty,
      avatar: p.avatar,
      working: p.working,
      tint: p.working ? "emerald" : "slate"
    });
    setComposing(false);
    setQ("");
  };
  const startable = st.providers.filter(p => !convos.some(c => c.name === p.name));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: "calc(100vh - 64px)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 312,
      flex: "none",
      borderRight: "1px solid var(--border)",
      background: "#fff",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 16px 12px",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 17,
      fontWeight: 700,
      margin: 0
    }
  }, "Messages"), /*#__PURE__*/React.createElement(Button, {
    size: "icon",
    variant: composing ? "secondary" : "outline",
    icon: composing ? "x" : "pen-square",
    onClick: () => setComposing(!composing)
  })), /*#__PURE__*/React.createElement(Field, {
    icon: "search",
    placeholder: "Search conversations\u2026",
    value: q,
    onChange: setQ
  })), composing && /*#__PURE__*/React.createElement("div", {
    style: {
      borderBottom: "1px solid var(--border)",
      background: "var(--secondary)",
      maxHeight: 260,
      overflowY: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 16px 4px",
      fontSize: 11.5,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: ".04em",
      color: "var(--muted-foreground)"
    }
  }, "Start a conversation"), startable.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px 16px 14px",
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, "You already have a thread with everyone on shift."), startable.map(p => /*#__PURE__*/React.createElement("button", {
    key: p.id,
    onClick: () => startWith(p),
    onMouseEnter: e => e.currentTarget.style.background = "#fff",
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    style: {
      width: "100%",
      display: "flex",
      gap: 10,
      alignItems: "center",
      padding: "9px 16px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: p.avatar,
    size: 30,
    tint: p.working ? "emerald" : "slate"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, p.specialty)), /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 15,
    color: "var(--primary)"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowY: "auto",
      flex: 1
    }
  }, list.map(c => {
    const last = c.messages[c.messages.length - 1];
    return /*#__PURE__*/React.createElement("button", {
      key: c.id,
      onClick: () => setActive(c.id),
      style: {
        width: "100%",
        display: "flex",
        gap: 11,
        padding: "12px 16px",
        border: "none",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        textAlign: "left",
        background: active === c.id ? "#EFF6FF" : "#fff"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: "relative",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      initials: c.initials,
      size: 40,
      tint: c.tint
    }), !c.group && !c.broadcast && /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        bottom: -1,
        right: -1,
        border: "2px solid #fff",
        borderRadius: 99
      }
    }, /*#__PURE__*/React.createElement(StatusDot, {
      status: c.presence
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, c.name), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--muted-foreground)",
        flex: "none",
        marginLeft: 6
      }
    }, last ? dtFmt.ago(last.at) : "")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)",
        marginTop: 1
      }
    }, c.role), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 3,
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "var(--foreground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        opacity: .8
      }
    }, c.typing ? "typing…" : last ? (last.me ? "You: " : "") + last.text : "No messages yet"), c.unread > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: "none",
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 99,
        background: "var(--primary)",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, c.unread))));
  }), list.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 28,
      textAlign: "center",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No conversations match \"", q, "\"."))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      background: "var(--secondary)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 60,
      flex: "none",
      background: "#fff",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "0 20px"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: conv.initials,
    size: 36,
    tint: conv.tint
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 700
    }
  }, conv.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, conv.typing ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--status-active)",
      fontWeight: 600
    }
  }, "typing\u2026") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(StatusDot, {
    status: conv.presence,
    pulse: conv.presence === "online"
  }), conv.presence === "online" ? "Online" : conv.role))), /*#__PURE__*/React.createElement(Button, {
    size: "icon",
    variant: "ghost",
    icon: "phone",
    onClick: () => a.toast({
      tone: "sent",
      title: "Calling " + conv.name,
      msg: "Connecting on the secure line…"
    })
  }), /*#__PURE__*/React.createElement(Button, {
    size: "icon",
    variant: "ghost",
    icon: "info",
    onClick: () => a.toast({
      tone: "accepted",
      title: conv.name,
      msg: (conv.group ? conv.role : conv.role + " · ") + conv.messages.length + " messages · end-to-end audited."
    })
  })), /*#__PURE__*/React.createElement("div", {
    ref: threadRef,
    style: {
      flex: 1,
      overflowY: "auto",
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      background: "#fff",
      padding: "3px 12px",
      borderRadius: 99,
      border: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 11,
    style: {
      marginRight: 4,
      verticalAlign: "-1px"
    }
  }), "End-to-end encrypted \xB7 auto-deletes in 30 days")), conv.messages.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      justifyContent: m.me ? "flex-end" : "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "62%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "9px 13px",
      borderRadius: 14,
      fontSize: 13.5,
      lineHeight: 1.45,
      background: m.me ? "var(--primary)" : "#fff",
      color: m.me ? "#fff" : "var(--foreground)",
      border: m.me ? "none" : "1px solid var(--border)",
      borderBottomRightRadius: m.me ? 4 : 14,
      borderBottomLeftRadius: m.me ? 14 : 4
    }
  }, m.text), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: "var(--muted-foreground)",
      marginTop: 3,
      textAlign: m.me ? "right" : "left",
      display: "flex",
      gap: 4,
      justifyContent: m.me ? "flex-end" : "flex-start",
      alignItems: "center"
    }
  }, fmtTime(m.at), m.me && /*#__PURE__*/React.createElement(Icon, {
    name: m.read ? "check-check" : "check",
    size: 12,
    color: m.read ? "var(--status-active)" : "var(--muted-foreground)"
  }))))), conv.typing && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "11px 15px",
      borderRadius: 14,
      borderBottomLeftRadius: 4,
      background: "#fff",
      border: "1px solid var(--border)",
      display: "flex",
      gap: 4
    }
  }, [0, 1, 2].map(d => /*#__PURE__*/React.createElement("span", {
    key: d,
    style: {
      width: 6,
      height: 6,
      borderRadius: 99,
      background: "var(--muted-foreground)",
      animation: "dt-pulse 1.2s infinite",
      animationDelay: d * 0.18 + "s"
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      padding: 16,
      background: "#fff",
      borderTop: "1px solid var(--border)",
      display: "flex",
      gap: 10,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "icon",
    variant: "ghost",
    icon: "paperclip",
    onClick: () => a.toast({
      tone: "accepted",
      title: "Attachment",
      msg: "File sharing is audited and PHI-scanned."
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: draft,
    onChange: e => setDraft(e.target.value),
    onKeyDown: e => e.key === "Enter" && send(),
    placeholder: conv.broadcast ? "Replies disabled for broadcasts" : "Type a secure message…",
    disabled: conv.broadcast,
    style: {
      width: "100%",
      height: 40,
      border: "1px solid var(--input)",
      borderRadius: "var(--radius-md)",
      padding: "0 14px",
      fontSize: 14,
      fontFamily: "inherit",
      outline: "none",
      boxSizing: "border-box",
      background: conv.broadcast ? "var(--secondary)" : "#fff"
    }
  })), /*#__PURE__*/React.createElement(Button, {
    icon: "send",
    onClick: send
  }, "Send"))));
}
Object.assign(window, {
  Messaging
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Messaging.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/OrgSettings.jsx
try { (() => {
/* DocTurn web-app UI kit — Organization Settings.
   Spec: Req FR-2.2/2.3/2.4 (org config: timeout, round-robin rules, custom shift
   types, per-portal feature toggles) + Eng §9 (integrations). Director surface.
   Store-backed: reflects the selected tenant and persists every change. */

function Toggle({
  on,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      width: 44,
      height: 26,
      borderRadius: 99,
      border: "none",
      cursor: "pointer",
      position: "relative",
      flex: "none",
      background: on ? "var(--status-accepted)" : "var(--status-neutral-bg)",
      transition: "background .2s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 3,
      left: on ? 21 : 3,
      width: 20,
      height: 20,
      borderRadius: 99,
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      transition: "left .2s"
    }
  }));
}
function FlagRow({
  icon,
  title,
  desc,
  on,
  onToggle,
  last
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: "13px 0",
      borderBottom: last ? "none" : "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: "var(--radius-md)",
      background: "var(--secondary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 17,
    color: "var(--muted-foreground)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, desc)), /*#__PURE__*/React.createElement(Toggle, {
    on: on,
    onClick: onToggle
  }));
}
function OrgSettings() {
  const st = useStore();
  const a = useActions();
  const s = st.settings;
  const org = st.orgs.find(o => o.code === st.selectedOrg) || st.orgs[0];
  const INTEGRATIONS = [{
    key: "twilio",
    name: "Twilio",
    desc: "SMS notifications & 2FA",
    icon: "message-circle"
  }, {
    key: "firebase",
    name: "Firebase",
    desc: "Push notifications (FCM)",
    icon: "bell"
  }, {
    key: "openai",
    name: "OpenAI",
    desc: "AI intake extraction",
    icon: "sparkles"
  }, {
    key: "amion",
    name: "Amion",
    desc: "Provider schedule sync",
    icon: "calendar-sync"
  }];
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44,
      height: 44,
      borderRadius: "var(--radius-md)",
      background: org.active ? "#DBEAFE" : "var(--status-neutral-bg)",
      color: org.active ? "var(--primary)" : "var(--status-neutral)",
      fontWeight: 700,
      fontSize: 16,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, org.code.slice(0, 2)), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      lineHeight: 1.3
    }
  }, /*#__PURE__*/React.createElement(EditableText, {
    value: org.name,
    onSave: v => a.updateOrg(org.code, {
      name: v
    }),
    size: 17,
    weight: 700
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      lineHeight: 1.4,
      display: "flex",
      gap: 8,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(EditableText, {
    value: org.code,
    onSave: v => a.updateOrg(org.code, {
      code: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)
    }),
    size: 12.5,
    weight: 600,
    mono: true,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("span", null, "\xB7"), /*#__PURE__*/React.createElement(EditableText, {
    value: org.timezone,
    onSave: v => a.updateOrg(org.code, {
      timezone: v
    }),
    size: 12.5,
    weight: 400,
    color: "var(--muted-foreground)"
  }))), !org.active && /*#__PURE__*/React.createElement(Badge, {
    status: "offline"
  }, "Suspended")), /*#__PURE__*/React.createElement(ScheduleSync, null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 18,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "route",
    size: 18,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "Assignment & rotation")), /*#__PURE__*/React.createElement(Field, {
    label: "Assignment timeout (minutes)",
    icon: "timer",
    value: String(s.timeout),
    onChange: v => a.setSetting("timeout", parseInt(v.replace(/[^0-9]/g, ""), 10) || 0),
    help: "Unanswered requests re-route after this."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(FlagRow, {
    icon: "phone-call",
    title: "On-call providers only",
    desc: "Restrict rotation to on-call hospitalists.",
    on: s.onCallOnly,
    onToggle: () => a.setSetting("onCallOnly", !s.onCallOnly)
  }), /*#__PURE__*/React.createElement(FlagRow, {
    icon: "activity",
    title: "Active (on-shift) only",
    desc: "Skip providers not working today.",
    on: s.activeOnly,
    onToggle: () => a.setSetting("activeOnly", !s.activeOnly),
    last: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm",
    full: true,
    icon: "rotate-ccw",
    onClick: a.resetRotation
  }, "Reset rotation index"))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 18,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "Shift types"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    icon: "plus",
    onClick: a.addShiftType
  }, "Add"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, s.shiftTypes.map(sh => /*#__PURE__*/React.createElement("div", {
    key: sh.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      padding: "10px 12px",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 99,
      background: sh.color,
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(EditableText, {
    value: sh.name,
    onSave: v => a.updateShiftType(sh.id, {
      name: v
    }),
    size: 13.5,
    weight: 600
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(EditableText, {
    value: sh.time,
    onSave: v => a.updateShiftType(sh.id, {
      time: v
    }),
    size: 12.5,
    weight: 400,
    mono: true,
    color: "var(--muted-foreground)"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => a.removeShiftType(sh.id),
    title: "Remove shift type",
    onMouseEnter: e => e.currentTarget.style.color = "var(--destructive)",
    onMouseLeave: e => e.currentTarget.style.color = "var(--muted-foreground)",
    style: {
      width: 28,
      height: 28,
      borderRadius: "var(--radius-md)",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "trash-2",
    size: 14
  })))))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "toggle-right",
    size: 18,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "Feature toggles")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      margin: "0 0 6px"
    }
  }, "Per-portal availability for this tenant."), /*#__PURE__*/React.createElement(FlagRow, {
    icon: "message-circle",
    title: "SMS notifications",
    desc: "Twilio assignment alerts & fallback.",
    on: s.flags.sms,
    onToggle: () => a.toggleFlag("sms")
  }), /*#__PURE__*/React.createElement(FlagRow, {
    icon: "bell",
    title: "Push notifications",
    desc: "Firebase Cloud Messaging.",
    on: s.flags.push,
    onToggle: () => a.toggleFlag("push")
  }), /*#__PURE__*/React.createElement(FlagRow, {
    icon: "sparkles",
    title: "AI intake assistant",
    desc: "OpenAI free-text extraction.",
    on: s.flags.ai,
    onToggle: () => a.toggleFlag("ai")
  }), /*#__PURE__*/React.createElement(FlagRow, {
    icon: "megaphone",
    title: "Emergency broadcasts",
    desc: "Org-wide urgent messaging.",
    on: s.flags.broadcasts,
    onToggle: () => a.toggleFlag("broadcasts")
  }), /*#__PURE__*/React.createElement(FlagRow, {
    icon: "calendar-sync",
    title: "Amion schedule sync",
    desc: "External on-call import.",
    on: s.flags.amion,
    onToggle: () => a.toggleFlag("amion"),
    last: true
  })), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plug",
    size: 18,
    color: "var(--primary)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0
    }
  }, "Integrations")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, INTEGRATIONS.map(it => {
    const on = s.integrations[it.key];
    return /*#__PURE__*/React.createElement("div", {
      key: it.key,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 12px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 34,
        height: 34,
        borderRadius: "var(--radius-md)",
        background: "var(--secondary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: it.icon,
      size: 17,
      color: on ? "var(--primary)" : "var(--muted-foreground)"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13.5,
        fontWeight: 600
      }
    }, it.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)"
      }
    }, it.desc)), on ? /*#__PURE__*/React.createElement("button", {
      onClick: () => a.toggleIntegration(it.key),
      title: "Disconnect",
      style: {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      status: "accepted",
      icon: "circle"
    }, "Connected")) : /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "outline",
      onClick: () => a.toggleIntegration(it.key)
    }, "Connect"));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 13,
      display: "flex",
      alignItems: "center",
      gap: 7,
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 13
  }), "Credentials are stored server-side, never exposed to clients."))));
}
Object.assign(window, {
  OrgSettings
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/OrgSettings.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/PatientBoard.jsx
try { (() => {
/* DocTurn web-app UI kit — Patient Board (hospital-wide distribution).
   Shows every distributed patient: who is responsible (attending + on-call unit),
   consultants, and the admitting source. Works two ways:
     • EHR connected (FHIR) — census auto-syncs from the hospital system.
     • Manual — admissions are added, edited, reassigned and removed by hand.
   Lists admissions given + their acceptance status; directors can fully edit. */

function BoardWrap({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 28,
      maxWidth: 1220,
      margin: "0 auto"
    }
  }, children);
}
function AvatarStack({
  lead,
  unit
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: lead.avatar,
    size: 30,
    tint: "blue"
  }), unit && unit.map((u, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      marginLeft: -8,
      border: "2px solid #fff",
      borderRadius: "99px",
      display: "inline-flex"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: u.avatar,
    size: 26,
    tint: (window.TEAM_ROLE[u.role] || {}).tint || "slate"
  }))));
}
const BOARD_STATUS = {
  admitted: {
    status: "accepted",
    label: "Admitted"
  },
  observation: {
    status: "active",
    label: "Observation"
  },
  pending: {
    status: "pending",
    label: "Awaiting accept"
  },
  transfer: {
    status: "offline",
    label: "Transfer"
  }
};
function BoardReassign({
  providers,
  onPick,
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "repeat",
    size: 11,
    color: "var(--primary)",
    style: {
      position: "absolute",
      left: 8,
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("select", {
    value: "",
    onChange: e => {
      if (e.target.value) onPick(e.target.value);
    },
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      height: 26,
      padding: "0 22px 0 24px",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      fontSize: 11.5,
      fontWeight: 600,
      color: "var(--primary)",
      fontFamily: "var(--font-sans)",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, label), providers.map(p => /*#__PURE__*/React.createElement("option", {
    key: p.id,
    value: p.name
  }, p.name))), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 11,
    color: "var(--muted-foreground)",
    style: {
      position: "absolute",
      right: 7,
      pointerEvents: "none"
    }
  }));
}
function BoardStatusSelect({
  value,
  onChange
}) {
  const opts = [["admitted", "Admitted"], ["observation", "Observation"], ["pending", "Awaiting accept"], ["transfer", "Transfer"]];
  const bs = BOARD_STATUS[value] || BOARD_STATUS.admitted;
  const pal = window.STATUS[bs.status] || {};
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "inline-flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: value,
    onChange: e => onChange(e.target.value),
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      height: 26,
      padding: "0 22px 0 10px",
      borderRadius: "var(--radius-full)",
      border: "none",
      background: pal.bg,
      color: pal.fg,
      fontSize: 12,
      fontWeight: 600,
      fontFamily: "var(--font-sans)",
      cursor: "pointer"
    }
  }, opts.map(([v, l]) => /*#__PURE__*/React.createElement("option", {
    key: v,
    value: v
  }, l))), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 11,
    color: pal.fg,
    style: {
      position: "absolute",
      right: 7,
      pointerEvents: "none"
    }
  }));
}
function DataSourceBanner({
  fhir,
  canEdit,
  onConnect,
  onDisconnect,
  onSync
}) {
  const connected = fhir && fhir.connected;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: "12px 16px",
      marginBottom: 18,
      borderRadius: "var(--radius-lg)",
      background: connected ? "var(--status-accepted-bg)" : "var(--secondary)",
      border: `1px solid ${connected ? "var(--status-accepted)" : "var(--border)"}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 36,
      borderRadius: "var(--radius-md)",
      flex: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: connected ? "var(--status-accepted)" : "#fff",
      color: connected ? "#fff" : "var(--muted-foreground)",
      border: connected ? "none" : "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: connected ? "cloud" : "cloud-off",
    size: 19
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, connected ? `Live · synced from ${fhir.source}` : "Manual census entry", connected && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: "online",
    pulse: true
  }), " ")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, connected ? /*#__PURE__*/React.createElement(React.Fragment, null, "Admissions pull automatically via FHIR \xB7 last sync ", fhir.lastSync ? dtFmt.ago(fhir.lastSync) : "just now", " \xB7 ", /*#__PURE__*/React.createElement("span", {
    className: "ds-mono"
  }, fhir.endpoint)) : "No EHR connection — add and manage admissions by hand, or connect a FHIR endpoint to auto-sync.")), connected ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "outline",
    icon: "refresh-cw",
    onClick: onSync
  }, "Sync now"), canEdit && /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    icon: "unplug",
    onClick: onDisconnect
  }, "Disconnect")) : canEdit && /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: "plug",
    onClick: onConnect
  }, "Connect EHR (FHIR)"));
}
const DEPT_OPTS = ["MED", "ICU", "TELE", "ER", "SURG"];
function AddAdmissionModal({
  providers,
  onClose,
  onAdd
}) {
  const [f, setF] = React.useState({
    initials: "",
    room: "",
    dept: "MED",
    issue: "",
    attending: "",
    er: ""
  });
  const set = (k, v) => setF(p => Object.assign({}, p, {
    [k]: v
  }));
  return /*#__PURE__*/React.createElement(Modal, {
    title: "Add admission",
    subtitle: "Record a new patient on the board. Leave the attending blank to queue for acceptance.",
    icon: "clipboard-plus",
    onClose: onClose,
    width: 520,
    children: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 120
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Initials",
      icon: "user",
      value: f.initials,
      onChange: v => set("initials", v.toUpperCase().slice(0, 3)),
      placeholder: "A.B."
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 110
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Room",
      icon: "door-open",
      value: f.room,
      onChange: v => set("room", v),
      placeholder: "318"
    })), /*#__PURE__*/React.createElement(DSelect, {
      label: "Unit",
      icon: "building",
      value: f.dept,
      onChange: v => set("dept", v),
      options: DEPT_OPTS.map(d => ({
        value: d,
        label: d
      }))
    })), /*#__PURE__*/React.createElement(Field, {
      label: "Presenting issue",
      icon: "clipboard-list",
      value: f.issue,
      onChange: v => set("issue", v),
      placeholder: "e.g. CHF exacerbation"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(DSelect, {
      label: "Attending (optional)",
      icon: "stethoscope",
      value: f.attending,
      onChange: v => set("attending", v),
      options: [{
        value: "",
        label: "— Queue for acceptance —"
      }].concat(providers.map(p => ({
        value: p.name,
        label: p.name
      })))
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Admitted by",
      icon: "ambulance",
      value: f.er,
      onChange: v => set("er", v),
      placeholder: "ER physician / source"
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 4
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "outline",
      size: "sm",
      onClick: onClose
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      icon: "check",
      onClick: () => {
        if (f.initials.trim()) {
          onAdd(f);
          onClose();
        } else window.DT.actions.toast({
          tone: "rejected",
          title: "Initials required",
          msg: "Enter the patient's initials."
        });
      }
    }, "Add admission")))
  });
}
function PatientBoard({
  patients,
  role,
  providers = [],
  fhir,
  onReassign,
  onUpdate,
  onAdd,
  onRemove,
  onConnectFhir,
  onDisconnectFhir,
  onSyncFhir
}) {
  const [query, setQuery] = React.useState("");
  const [dept, setDept] = React.useState("ALL");
  const [adding, setAdding] = React.useState(false);
  const DEPTS = ["ALL", "ER", "ICU", "MED", "TELE"];
  const canEdit = (role === "director" || role === "er_director") && onUpdate;
  const rows = patients.filter(p => (dept === "ALL" || p.dept === dept) && (p.initials.toLowerCase().includes(query.toLowerCase()) || p.issue.toLowerCase().includes(query.toLowerCase()) || p.attending.name.toLowerCase().includes(query.toLowerCase()) || (p.consultants || []).join(" ").toLowerCase().includes(query.toLowerCase())));
  const accepted = patients.filter(p => p.status === "admitted" || p.status === "observation").length;
  const awaiting = patients.filter(p => p.status === "pending").length;
  const withConsult = patients.filter(p => (p.consultants || []).length).length;
  const Th = ({
    children,
    w,
    grow
  }) => /*#__PURE__*/React.createElement("span", {
    style: {
      width: w,
      flex: grow ? grow + " 1 0" : w ? "none" : 1,
      fontSize: 11.5,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: ".04em",
      color: "var(--muted-foreground)"
    }
  }, children);
  return /*#__PURE__*/React.createElement(BoardWrap, null, /*#__PURE__*/React.createElement(DataSourceBanner, {
    fhir: fhir,
    canEdit: canEdit,
    onConnect: onConnectFhir,
    onDisconnect: onDisconnectFhir,
    onSync: onSyncFhir
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Admissions",
    value: patients.length,
    icon: "layout-list",
    tint: "blue"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Accepted",
    value: accepted,
    icon: "check-circle-2",
    tint: "emerald"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Awaiting acceptance",
    value: awaiting,
    icon: "clock",
    tint: "amber"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "With consultants",
    value: withConsult,
    icon: "users-round",
    tint: "slate"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginBottom: 14,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 220,
      maxWidth: 320
    }
  }, /*#__PURE__*/React.createElement(Field, {
    icon: "search",
    value: query,
    onChange: setQuery,
    placeholder: "Search patient, attending, issue\u2026"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      padding: 4,
      background: "var(--secondary)",
      borderRadius: "var(--radius-md)"
    }
  }, DEPTS.map(d => {
    const on = dept === d;
    return /*#__PURE__*/React.createElement("button", {
      key: d,
      onClick: () => setDept(d),
      style: {
        padding: "6px 13px",
        borderRadius: 5,
        border: "none",
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 600,
        background: on ? "#fff" : "transparent",
        color: on ? "var(--primary)" : "var(--muted-foreground)",
        boxShadow: on ? "var(--shadow-sm)" : "none"
      }
    }, d === "ALL" ? "All units" : d);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 15,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--muted-foreground)",
      fontWeight: 500,
      fontVariantNumeric: "tabular-nums"
    }
  }, rows.length === patients.length ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--foreground)"
    }
  }, patients.length), " total") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--foreground)"
    }
  }, rows.length), " of ", patients.length))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 8
    }
  }, canEdit && /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: "plus",
    onClick: () => setAdding(true)
  }, "Add admission"), canEdit && /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "outline",
    icon: "download",
    onClick: () => {
      const out = [["patient", "room", "dept", "issue", "status", "attending", "consultants", "admitted_by"]].concat(patients.map(p => [p.initials, p.room, p.dept, p.issue, p.status, p.attending.name || "—", (p.consultants || []).join("; "), p.er.name]));
      const csv = out.map(r => r.map(c => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], {
        type: "text/csv"
      }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "docturn-census.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.DT.actions.toast({
        tone: "accepted",
        title: "Census exported",
        msg: patients.length + " patients · docturn-census.csv"
      });
    }
  }, "Export"))), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: "auto",
      borderRadius: "var(--radius-lg)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 0,
      overflow: "hidden",
      minWidth: 1080
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "10px 18px",
      background: "var(--secondary)",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(Th, {
    w: 150
  }, "Patient"), /*#__PURE__*/React.createElement(Th, {
    grow: 1.5
  }, "Issue"), /*#__PURE__*/React.createElement(Th, {
    grow: 1.4
  }, "Responsible"), /*#__PURE__*/React.createElement(Th, {
    grow: 1.2
  }, "Consultants"), /*#__PURE__*/React.createElement(Th, {
    grow: 1
  }, "Admitted by"), /*#__PURE__*/React.createElement(Th, {
    w: 132
  }, "Status"), canEdit && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      flex: "none"
    }
  })), rows.map((p, i) => {
    const bs = BOARD_STATUS[p.status] || BOARD_STATUS.admitted;
    return /*#__PURE__*/React.createElement("div", {
      key: p.id || i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 18px",
        borderTop: i ? "1px solid var(--border)" : "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 150,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 11
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      initials: p.initials,
      size: 36,
      tint: p.status === "pending" ? "amber" : "slate"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13.5,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        gap: 5
      }
    }, p.initials, p.synced && /*#__PURE__*/React.createElement(Icon, {
      name: "cloud",
      size: 12,
      color: "var(--status-accepted)",
      title: "Synced from EHR"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: "var(--muted-foreground)",
        display: "flex",
        alignItems: "center",
        gap: 3
      }
    }, "Rm ", canEdit ? /*#__PURE__*/React.createElement(EditableText, {
      value: p.room,
      onSave: v => onUpdate(p.id, {
        room: v
      }),
      size: 11.5,
      weight: 400,
      color: "var(--muted-foreground)"
    }) : p.room, " \xB7 ", p.dept))), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: "1.5 1 0",
        fontSize: 13,
        color: "var(--foreground)",
        minWidth: 0,
        paddingRight: 8
      }
    }, canEdit ? /*#__PURE__*/React.createElement(EditableText, {
      value: p.issue,
      onSave: v => onUpdate(p.id, {
        issue: v
      }),
      size: 13,
      weight: 400,
      multiline: true
    }) : p.issue), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: "1.4 1 0",
        minWidth: 0
      }
    }, p.status === "pending" ? canEdit && onReassign ? /*#__PURE__*/React.createElement(BoardReassign, {
      providers: providers,
      onPick: name => onReassign(p.id, name),
      label: "Assign\u2026"
    }) : /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12.5,
        color: "var(--status-pending)",
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "loader",
      size: 14
    }), "Routing\u2026") : /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 9,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement(AvatarStack, {
      lead: p.attending,
      unit: p.unit
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, p.attending.name), canEdit && onReassign ? /*#__PURE__*/React.createElement(BoardReassign, {
      providers: providers,
      onPick: name => onReassign(p.id, name),
      label: "Reassign\u2026"
    }) : /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: "var(--muted-foreground)"
      }
    }, p.unit && p.unit.length ? `+ ${p.unit.map(u => u.role).join(", ")} on unit` : "Solo")))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: "1.2 1 0",
        minWidth: 0,
        display: "flex",
        flexWrap: "wrap",
        gap: 5
      }
    }, (p.consultants || []).length === 0 ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        color: "var(--muted-foreground)"
      }
    }, "\u2014") : p.consultants.map(c => /*#__PURE__*/React.createElement("span", {
      key: c,
      style: {
        fontSize: 11.5,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        background: "#DBEAFE",
        color: "var(--primary)"
      }
    }, c))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      initials: p.er.avatar,
      size: 26,
      tint: "slate"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "var(--foreground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, p.er.name)), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 132,
        flex: "none"
      }
    }, canEdit ? /*#__PURE__*/React.createElement(BoardStatusSelect, {
      value: p.status,
      onChange: v => onUpdate(p.id, {
        status: v
      })
    }) : /*#__PURE__*/React.createElement(Badge, {
      status: bs.status
    }, bs.label)), canEdit && /*#__PURE__*/React.createElement("button", {
      onClick: () => onRemove(p.id),
      title: "Remove admission",
      onMouseEnter: e => e.currentTarget.style.color = "var(--destructive)",
      onMouseLeave: e => e.currentTarget.style.color = "var(--muted-foreground)",
      style: {
        width: 32,
        height: 32,
        flex: "none",
        borderRadius: "var(--radius-md)",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted-foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "trash-2",
      size: 16
    })));
  }), rows.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 30,
      textAlign: "center",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No patients match your filter."))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginTop: 12,
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 13
  }), "Patients shown by initials only \xB7 access is logged to the PHI audit trail."), adding && /*#__PURE__*/React.createElement(AddAdmissionModal, {
    providers: providers,
    onAdd: onAdd,
    onClose: () => setAdding(false)
  }));
}
Object.assign(window, {
  PatientBoard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/PatientBoard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/People.jsx
try { (() => {
/* DocTurn web-app UI kit — People management (Hospitalist Director & ER Director).
   The org-scoped counterpart to the Developer's cross-tenant panel: a tidy,
   color-coded roster of everyone in the director's organization, grouped by
   role with collapsible sections, dropdown filters, and add/remove. */

const PEOPLE_ROLES = [["hospitalist", "Hospitalist", "stethoscope"], ["er_doctor", "ER physician", "ambulance"], ["er_director", "ER director", "siren"], ["director", "Hospitalist director", "clipboard-list"]];
const PEOPLE_ROLE_LABEL = Object.fromEntries(PEOPLE_ROLES.map(r => [r[0], r[1]]));
function peopleInitials(name) {
  return name.replace(/\(root\)/i, "").replace(/^Dr\.?\s*/, "").trim().split(/[\s,]+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
function PersonRoleChip({
  role,
  color
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 10px 3px 8px",
      borderRadius: "var(--radius-full)",
      fontSize: 12,
      fontWeight: 600,
      color: color,
      background: (color || "#888") + "18",
      border: "1px solid " + (color || "#888") + "33",
      whiteSpace: "nowrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 99,
      background: color,
      flex: "none"
    }
  }), PEOPLE_ROLE_LABEL[role] || role);
}
function PeopleManager({
  scopeOrg,
  domainRoles
}) {
  const st = useStore();
  const a = useActions();
  const roleColors = st.roleColors;
  const orgName = (st.orgs.find(o => o.code === scopeOrg) || {}).name || scopeOrg;

  // Which roles this director may see & add. Hospitalist director → hospitalist
  // group; ER director → ER group. Falls back to everything.
  const allowed = domainRoles && domainRoles.length ? domainRoles : PEOPLE_ROLES.map(r => r[0]);
  const domainList = PEOPLE_ROLES.filter(r => allowed.includes(r[0]));
  const [open, setOpen] = React.useState(false);
  const [roleFilter, setRoleFilter] = React.useState("ALL");
  const [collapsed, setCollapsed] = React.useState({});
  const [form, setForm] = React.useState({
    name: "",
    email: "",
    role: allowed[0],
    specialty: "Hospital Medicine",
    org: scopeOrg,
    scope: "local"
  });
  const set = (k, v) => setForm(f => Object.assign({}, f, {
    [k]: v
  }));
  const users = st.devUsers.filter(u => u.org === scopeOrg && allowed.includes(u.role) && (roleFilter === "ALL" || u.role === roleFilter));
  const byRole = {};
  users.forEach(u => {
    (byRole[u.role] = byRole[u.role] || []).push(u);
  });
  const orderedRoles = domainList.map(r => r[0]).filter(rid => byRole[rid]);
  const submit = () => {
    if (!form.name.trim()) {
      a.toast({
        tone: "rejected",
        title: "Name required",
        msg: "Enter the person's full name."
      });
      return;
    }
    a.addUser(Object.assign({}, form, {
      org: scopeOrg
    }));
    setForm(f => Object.assign({}, f, {
      name: "",
      email: ""
    }));
    setOpen(false);
  };
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700
    }
  }, "People"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, "Manage everyone in ", orgName, " with role-based access control.")), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: open ? "secondary" : "default",
    icon: open ? "x" : "user-plus",
    onClick: () => setOpen(!open)
  }, open ? "Close" : "Add person")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      margin: "16px 0"
    }
  }, domainList.map(([rid, label, icon]) => {
    const n = st.devUsers.filter(u => u.org === scopeOrg && u.role === rid).length;
    return /*#__PURE__*/React.createElement(Card, {
      key: rid,
      style: {
        padding: 14,
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 28,
        height: 28,
        borderRadius: "var(--radius-md)",
        background: "var(--secondary)",
        color: "var(--muted-foreground)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 15
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)",
        fontWeight: 500,
        lineHeight: 1.2
      }
    }, label)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "baseline",
        gap: 7
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: 99,
        background: roleColors[rid],
        flex: "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 24,
        fontWeight: 800,
        letterSpacing: "-.02em"
      }
    }, n)));
  })), open && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 8
    }
  }, "Role"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 16
    }
  }, domainList.map(([id, label, icon]) => {
    const on = form.role === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => set("role", id),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 14px",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
        background: on ? "var(--primary-tint, #EFF6FF)" : "#fff",
        color: on ? "var(--primary)" : "var(--foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 15
    }), label);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Full name",
    icon: "user",
    value: form.name,
    onChange: v => set("name", v),
    placeholder: "Dr. Jane Smith"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Email",
    icon: "mail",
    value: form.email,
    onChange: v => set("email", v),
    placeholder: "jane@hospital.com"
  }))), form.role === "hospitalist" && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Specialty",
    icon: "stethoscope",
    value: form.specialty,
    onChange: v => set("specialty", v),
    placeholder: "e.g. Cardiology"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    size: "sm",
    onClick: () => setOpen(false)
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: "check",
    onClick: submit
  }, "Add person"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: 12,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 220
    }
  }, /*#__PURE__*/React.createElement(DSelect, {
    label: "Filter by role",
    icon: "shield-half",
    value: roleFilter,
    onChange: setRoleFilter,
    options: [{
      value: "ALL",
      label: "All roles"
    }].concat(domainList.map(([id, label]) => ({
      value: id,
      label
    })))
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      paddingBottom: 8
    }
  }, users.length, " ", users.length === 1 ? "person" : "people")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, orderedRoles.map(rid => {
    const accent = roleColors[rid];
    const isOpen = !collapsed[rid];
    const list = byRole[rid];
    return /*#__PURE__*/React.createElement(Card, {
      key: rid,
      style: {
        padding: 0,
        overflow: "hidden"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setCollapsed(c => Object.assign({}, c, {
        [rid]: !c[rid]
      })),
      style: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "12px 16px",
        border: "none",
        background: isOpen ? "var(--secondary)" : "#fff",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-sans)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-right",
      size: 16,
      color: "var(--muted-foreground)",
      style: {
        transform: isOpen ? "rotate(90deg)" : "none",
        transition: "transform .15s",
        flex: "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: 99,
        background: accent,
        flex: "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13.5,
        fontWeight: 700
      }
    }, PEOPLE_ROLE_LABEL[rid]), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 12,
        color: "var(--muted-foreground)"
      }
    }, list.length, " ", list.length === 1 ? "person" : "people")), isOpen && list.map((u, i) => /*#__PURE__*/React.createElement("div", {
      key: u.id,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "11px 16px",
        borderTop: "1px solid var(--border)"
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      initials: peopleInitials(u.name),
      size: 34,
      tint: "slate"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13.5,
        fontWeight: 600
      }
    }, u.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--muted-foreground)"
      }
    }, u.specialty || PEOPLE_ROLE_LABEL[u.role])), /*#__PURE__*/React.createElement("button", {
      onClick: () => a.removeUser(u.id),
      title: "Remove",
      onMouseEnter: e => e.currentTarget.style.color = "var(--destructive)",
      onMouseLeave: e => e.currentTarget.style.color = "var(--muted-foreground)",
      style: {
        width: 28,
        height: 28,
        borderRadius: "var(--radius-md)",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted-foreground)",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "trash-2",
      size: 15
    })))));
  }), orderedRoles.length === 0 && /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 28,
      textAlign: "center",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No people match this filter.")));
}
Object.assign(window, {
  PeopleManager
});
function AccessPeople({
  scopeOrg,
  domainRoles,
  domainPortals,
  roles,
  onCreate,
  onUpdate,
  onDelete
}) {
  const [tab, setTab] = React.useState("people");
  const tabs = [["people", "People", "users-round"], ["roles", "Roles & permissions", "shield-half"]];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "22px 28px 0",
      maxWidth: "var(--content-max, 1040px)",
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      gap: 4,
      padding: 4,
      background: "var(--secondary)",
      borderRadius: "var(--radius-md)"
    }
  }, tabs.map(([id, label, icon]) => {
    const on = tab === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => setTab(id),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 16px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: "var(--font-sans)",
        background: on ? "#fff" : "transparent",
        color: on ? "var(--primary)" : "var(--muted-foreground)",
        boxShadow: on ? "var(--shadow-sm)" : "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 15
    }), label);
  }))), tab === "people" ? /*#__PURE__*/React.createElement(PeopleManager, {
    scopeOrg: scopeOrg,
    domainRoles: domainRoles
  }) : /*#__PURE__*/React.createElement(RoleManagement, {
    roles: roles,
    onCreate: onCreate,
    onUpdate: onUpdate,
    onDelete: onDelete,
    domainPortals: domainPortals
  }));
}
Object.assign(window, {
  PeopleManager,
  AccessPeople
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/People.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/RoleManagement.jsx
try { (() => {
/* DocTurn web-app UI kit — Role Management (Director & Developer).
   Create and manage user roles with specific permissions and portal access.
   Store-backed: roles persist; built-in roles are protected from deletion.
   Spec: Req FR-2 (org config / RBAC), Eng §10 (admin portals). */

const PORTALS = [["hospitalist", "Hospitalist Portal", "stethoscope"], ["hosp_director", "Hospitalist Director Portal", "clipboard-list"], ["er_physician", "ER Physician Portal", "ambulance"], ["er_director", "ER Director Portal", "siren"], ["admin", "Admin Portal", "shield"], ["developer", "Developer Portal", "terminal"]];
const PERMS = [["view_census", "View Census", "View patient census and occupancy data"], ["assign_patients", "Assign Patients", "Assign patients to hospitalists and residents"], ["manage_assignments", "Manage Assignments", "Edit and modify existing patient assignments"], ["view_reports", "View Reports", "Access reporting features and analytics"], ["manage_staff", "Manage Staff", "Add, edit, and manage staff members"], ["system_settings", "System Settings", "Access and modify system configuration"]];
const FEATURES = [["ai_chatbot", "AI Chatbot Access", "bot"], ["portal_customization", "Portal Customization", "palette"]];
const PORTAL_LABEL = Object.fromEntries(PORTALS.map(p => [p[0], p[1]]));
const PERM_LABEL = Object.fromEntries(PERMS.map(p => [p[0], p[1]]));
function CheckRow({
  checked,
  onToggle,
  title,
  desc,
  icon
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onToggle,
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 11,
      padding: "11px 12px",
      width: "100%",
      textAlign: "left",
      cursor: "pointer",
      border: checked ? "1px solid var(--primary)" : "1px solid var(--border)",
      background: checked ? "#EFF6FF" : "#fff",
      borderRadius: "var(--radius-md)",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 19,
      height: 19,
      borderRadius: 5,
      flex: "none",
      marginTop: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: checked ? "none" : "1.5px solid var(--border)",
      background: checked ? "var(--primary)" : "#fff"
    }
  }, checked && /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 13.5,
      fontWeight: 600,
      color: "var(--foreground)"
    }
  }, icon && /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 14,
    color: checked ? "var(--primary)" : "var(--muted-foreground)"
  }), title), desc && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: 12,
      color: "var(--muted-foreground)",
      marginTop: 2,
      lineHeight: 1.4
    }
  }, desc)));
}
function emptyDraft() {
  return {
    name: "",
    desc: "",
    portals: [],
    perms: [],
    features: []
  };
}
function RoleEditor({
  initial,
  onSave,
  onCancel,
  isNew,
  portalList
}) {
  const PL = portalList || PORTALS;
  const [d, setD] = React.useState(initial);
  const toggle = (key, val) => setD(p => {
    const arr = p[key];
    return Object.assign({}, p, {
      [key]: arr.includes(val) ? arr.filter(x => x !== val) : arr.concat([val])
    });
  });
  const Section = ({
    title,
    sub,
    children
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      marginBottom: 2
    }
  }, title), sub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)",
      marginBottom: 10
    }
  }, sub), children);
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 34,
      height: 34,
      borderRadius: "var(--radius-md)",
      background: "#DBEAFE",
      color: "var(--primary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: isNew ? "shield-plus" : "shield-half",
    size: 18
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      margin: 0
    }
  }, isNew ? "Create new role" : "Edit role"), initial.system && /*#__PURE__*/React.createElement(Badge, {
    status: "offline",
    icon: "lock"
  }, "Built-in")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1.4fr",
      gap: 14,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Role name",
    icon: "tag",
    value: d.name,
    onChange: v => setD(Object.assign({}, d, {
      name: v
    })),
    placeholder: "e.g. Chief, ICU, Technician"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Description",
    icon: "text",
    value: d.desc,
    onChange: v => setD(Object.assign({}, d, {
      desc: v
    })),
    placeholder: "Brief description of role responsibilities"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--border)",
      margin: "16px 0 18px"
    }
  }), /*#__PURE__*/React.createElement(Section, {
    title: "Portal access permissions",
    sub: "Select which portals this role can access"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8
    }
  }, PL.map(([id, label, icon]) => /*#__PURE__*/React.createElement(CheckRow, {
    key: id,
    checked: d.portals.includes(id),
    onToggle: () => toggle("portals", id),
    title: label,
    icon: icon
  })))), /*#__PURE__*/React.createElement(Section, {
    title: "Access permissions",
    sub: "Define what actions this role can perform"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8
    }
  }, PERMS.map(([id, label, desc]) => /*#__PURE__*/React.createElement(CheckRow, {
    key: id,
    checked: d.perms.includes(id),
    onToggle: () => toggle("perms", id),
    title: label,
    desc: desc
  })))), /*#__PURE__*/React.createElement(Section, {
    title: "Special features"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8
    }
  }, FEATURES.map(([id, label, icon]) => /*#__PURE__*/React.createElement(CheckRow, {
    key: id,
    checked: d.features.includes(id),
    onToggle: () => toggle("features", id),
    title: label,
    icon: icon
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: 9,
      marginTop: 22,
      paddingTop: 16,
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "outline",
    onClick: onCancel
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    icon: isNew ? "plus" : "check",
    onClick: () => onSave(d)
  }, isNew ? "Create role" : "Save changes")));
}
function RoleCard({
  role,
  onEdit,
  onDelete
}) {
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: "var(--radius-md)",
      background: "var(--secondary)",
      color: role.system ? "var(--muted-foreground)" : "var(--primary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-half",
    size: 19
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 700
    }
  }, role.name), role.system ? /*#__PURE__*/React.createElement(Badge, {
    status: "offline",
    icon: "lock"
  }, "Built-in") : /*#__PURE__*/React.createElement(Badge, {
    status: "accepted"
  }, "Custom")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      marginTop: 2,
      lineHeight: 1.45
    }
  }, role.desc || "No description.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "icon",
    variant: "outline",
    icon: "pencil",
    onClick: () => onEdit(role)
  }), /*#__PURE__*/React.createElement(Button, {
    size: "icon",
    variant: "ghost",
    icon: "trash-2",
    onClick: () => onDelete(role),
    style: role.system ? {
      opacity: .4,
      cursor: "not-allowed"
    } : null
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 14,
      marginTop: 13,
      paddingTop: 13,
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement(Meta, {
    icon: "users",
    label: role.users + " user" + (role.users === 1 ? "" : "s")
  }), /*#__PURE__*/React.createElement(Meta, {
    icon: "layout-grid",
    label: role.portals.length + " portal" + (role.portals.length === 1 ? "" : "s")
  }), /*#__PURE__*/React.createElement(Meta, {
    icon: "key-round",
    label: role.perms.length + " permission" + (role.perms.length === 1 ? "" : "s")
  }), role.features.length > 0 && /*#__PURE__*/React.createElement(Meta, {
    icon: "sparkles",
    label: role.features.length + " feature" + (role.features.length === 1 ? "" : "s")
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 11
    }
  }, role.portals.map(p => /*#__PURE__*/React.createElement(Tag, {
    key: p,
    tone: "slate"
  }, PORTAL_LABEL[p] ? PORTAL_LABEL[p].replace(" Portal", "") : p))));
}
function Meta({
  icon,
  label
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 14
  }), label);
}
function Tag({
  children,
  tone
}) {
  const map = {
    blue: ["#EFF6FF", "var(--primary)"],
    slate: ["var(--secondary)", "var(--muted-foreground)"]
  };
  const [bg, fg] = map[tone] || map.slate;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      padding: "2px 9px",
      borderRadius: "var(--radius-full)",
      background: bg,
      color: fg
    }
  }, children);
}
function RoleManagement({
  roles,
  onCreate,
  onUpdate,
  onDelete,
  domainPortals
}) {
  const [editing, setEditing] = React.useState(null); // null | "new" | roleObject
  const portalList = domainPortals ? PORTALS.filter(p => domainPortals.includes(p[0])) : PORTALS;
  const shownRoles = domainPortals ? roles.filter(r => r.portals.some(p => domainPortals.includes(p))) : roles;
  const totalUsers = shownRoles.reduce((a, r) => a + r.users, 0);
  const customCount = shownRoles.filter(r => !r.system).length;
  const save = d => {
    if (!d.name.trim()) {
      window.DT.actions.toast({
        tone: "rejected",
        title: "Role name required",
        msg: "Give the role a name."
      });
      return;
    }
    if (editing === "new") onCreate(d);else onUpdate(editing.id, d);
    setEditing(null);
  };
  const del = r => {
    if (!r.system) onDelete(r.id);else window.DT.actions.toast({
      tone: "rejected",
      title: "Protected role",
      msg: "Built-in roles can't be deleted."
    });
  };
  return /*#__PURE__*/React.createElement(PageWrap, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(StatTile, {
    label: "Roles defined",
    value: shownRoles.length,
    icon: "shield-half",
    tint: "slate"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Custom roles",
    value: customCount,
    icon: "shield-plus",
    tint: "slate"
  }), /*#__PURE__*/React.createElement(StatTile, {
    label: "Users assigned",
    value: totalUsers,
    icon: "users",
    tint: "slate"
  })), editing ? /*#__PURE__*/React.createElement(RoleEditor, {
    isNew: editing === "new",
    portalList: portalList,
    initial: editing === "new" ? Object.assign(emptyDraft(), {
      portals: domainPortals ? domainPortals.slice() : []
    }) : {
      name: editing.name,
      desc: editing.desc,
      portals: [...editing.portals],
      perms: [...editing.perms],
      features: [...editing.features],
      system: editing.system
    },
    onSave: save,
    onCancel: () => setEditing(null)
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700
    }
  }, "Roles & permissions"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, "Create and manage user roles with specific permissions and portal access.")), /*#__PURE__*/React.createElement(Button, {
    icon: "plus",
    onClick: () => setEditing("new")
  }, "Create new role")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, shownRoles.map(r => /*#__PURE__*/React.createElement(RoleCard, {
    key: r.id,
    role: r,
    onEdit: setEditing,
    onDelete: del
  }))), /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18,
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 16,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      margin: 0
    }
  }, "Permission details")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "8px 28px"
    }
  }, PERMS.concat([["portal_customization", "Portal Customization", "Customize portal appearance and features"]]).map(([id, label, desc]) => /*#__PURE__*/React.createElement("div", {
    key: id,
    style: {
      fontSize: 12.5,
      lineHeight: 1.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700
    }
  }, label, ":"), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--muted-foreground)"
    }
  }, desc)))))));
}
Object.assign(window, {
  RoleManagement
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/RoleManagement.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/ScheduleSync.jsx
try { (() => {
/* DocTurn web-app UI kit — Schedule Sync (Amion / external on-call import).
   Two ingestion modes:
     • API        — token-based pull (preferred, when the vendor exposes one)
     • Capture     — NO public API: DocTurn signs in on your behalf in a sandboxed
                     headless browser and parses the published on-call grid off the
                     rendered page ("rip contents off screen"). Credentials encrypted
                     server-side, read-only, every fetch audited.
   Self-contained demo component; manages its own local state. Director surface. */

// Real captured grid — Tarzana ISP hospitalist schedule (amion.com/cgi-bin/ocs).
// `secure` = "Secure message to Amion app" (onboarded) vs "Not ready to receive
// secure messages" — the onboarding signal DocTurn uses to invite the rest.
const SS_HRS = {
  "7a-7p": ["Day call", "amber"],
  "4p-12a": ["Swing", "blue"],
  "7p-7a": ["Nights", "slate"],
  "11p-7a": ["Night X-cover", "slate"]
};
const SS_ROWS = [{
  slot: "Tarzana 1",
  hrs: "7a-7p",
  prov: "Alyesh, Nathan",
  grp: "ISP North",
  secure: false
}, {
  slot: "Tarzana 2",
  hrs: "7a-7p",
  prov: "George, Sharon",
  grp: "ISP North",
  secure: true
}, {
  slot: "Tarzana 3",
  hrs: "7a-7p",
  prov: "Ahmed, Amir",
  grp: "ISP North",
  secure: false
}, {
  slot: "Tarzana 4",
  hrs: "7a-7p",
  prov: "Kazanchyan, Moe",
  grp: "Moonlighter",
  secure: false
}, {
  slot: "Tarzana 5",
  hrs: "7a-7p",
  prov: "Darouichi, Joline",
  grp: "ISP North",
  secure: false
}, {
  slot: "Tarzana 6",
  hrs: "7a-7p",
  prov: "Gideon, Danny",
  grp: "ISP North",
  secure: false
}, {
  slot: "Tarzana 7",
  hrs: "7a-7p",
  prov: "Gopal, Arun",
  grp: "ISP Hospitalist",
  secure: true
}, {
  slot: "Tarzana 8",
  hrs: "7a-7p",
  prov: "Williams, Nicole",
  grp: "ISP North",
  secure: true
}, {
  slot: "Tarzana 9",
  hrs: "7a-7p",
  prov: "Malhotra, Veshal",
  grp: "ISP North",
  secure: true
}, {
  slot: "North Triage",
  hrs: "7a-7p",
  prov: "Williams, Nicole",
  grp: "ISP North",
  secure: true
}, {
  slot: "Tarzana 2 PM Swing",
  hrs: "4p-12a",
  prov: "Manukian, Naira",
  grp: "ISP North",
  secure: false
}, {
  slot: "Tarzana Night Triage",
  hrs: "7p-7a",
  prov: "Kohan, Salar",
  grp: "ISP North",
  secure: false
}, {
  slot: "Tarzana Night XC",
  hrs: "7p-7a",
  prov: "Niculescu, Alex",
  grp: "ISP North",
  secure: true
}, {
  slot: "West Night2",
  hrs: "11p-7a",
  prov: "Shergill, Jasper",
  grp: "ISP Hospitalist",
  secure: true
}, {
  slot: "11 PM Triage",
  hrs: "11p-7a",
  prov: "Guedikian, Roupen",
  grp: "Nocturnist",
  secure: true
}, {
  slot: "11 PM X-Cover",
  hrs: "11p-7a",
  prov: "Tran, Ann",
  grp: "ISP Hospitalist",
  secure: true
}, {
  slot: "11 PM Admit",
  hrs: "11p-7a",
  prov: "Chen, David",
  grp: "Nocturnist",
  secure: true
}];
const SS_MAP = [{
  code: "7a–7p",
  shift: "Day call",
  tint: "amber"
}, {
  code: "4p–12a",
  shift: "Swing",
  tint: "blue"
}, {
  code: "7p–7a",
  shift: "Nights",
  tint: "slate"
}, {
  code: "11p–7a",
  shift: "Night X-cover",
  tint: "slate"
}];
// "Last, First" → "First Last"; initials from both.
function ssName(prov) {
  const [last, first] = prov.split(", ");
  return (first || "") + " " + last;
}
function ssInit(prov) {
  const [last, first] = prov.split(", ");
  return ((first || " ")[0] + last[0]).toUpperCase();
}
function SSModeTab({
  active,
  icon,
  label,
  sub,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      flex: 1,
      textAlign: "left",
      display: "flex",
      gap: 11,
      alignItems: "flex-start",
      padding: "12px 13px",
      borderRadius: "var(--radius-md)",
      cursor: "pointer",
      border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
      background: active ? "#EFF6FF" : "#fff",
      transition: "all .15s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: "var(--radius-md)",
      background: active ? "#fff" : "var(--secondary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 16,
    color: active ? "var(--primary)" : "var(--muted-foreground)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      color: active ? "var(--primary)" : "var(--foreground)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      lineHeight: 1.35,
      marginTop: 1
    }
  }, sub)));
}
function ShiftChip({
  shift,
  tint
}) {
  const c = {
    amber: ["var(--status-pending-bg)", "var(--status-pending)"],
    blue: ["var(--status-active-bg)", "var(--status-active)"],
    slate: ["var(--status-neutral-bg)", "var(--status-neutral)"]
  }[tint] || ["var(--secondary)", "var(--muted-foreground)"];
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 11.5,
      fontWeight: 600,
      padding: "2px 9px",
      borderRadius: "var(--radius-full)",
      background: c[0],
      color: c[1],
      whiteSpace: "nowrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 99,
      background: c[1],
      flex: "none"
    }
  }), shift);
}
function ScheduleSync() {
  const [connected, setConnected] = React.useState(false);
  const [mode, setMode] = React.useState("capture"); // default to the no-API path
  const [busy, setBusy] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false); // capture preview shown
  const [lastSync, setLastSync] = React.useState("just now");
  const [interval, setIntervalVal] = React.useState("15m");

  // API fields
  const [token, setToken] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("https://www.amion.com/api");
  // Capture fields
  const [loginUrl, setLoginUrl] = React.useState("https://www.amion.com");
  const [username, setUsername] = React.useState("tarzana.isp");
  const [password, setPassword] = React.useState("••••••••••");
  const [schedKey, setSchedKey] = React.useState("!299a6dc6iJRQ");
  const run = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setConnected(true);
      setRevealed(true);
      setLastSync("just now");
    }, 1200);
  };
  const syncNow = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setLastSync("just now");
    }, 900);
  };
  const disconnect = () => {
    setConnected(false);
    setRevealed(false);
  };
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 18,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: "var(--radius-md)",
      background: "#DBEAFE",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar-clock",
    size: 19,
    color: "var(--primary)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      margin: 0,
      whiteSpace: "nowrap"
    }
  }, "On-call schedule sync"), /*#__PURE__*/React.createElement(Badge, {
    variant: "secondary"
  }, "Amion"), connected && /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: "nowrap"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    status: "accepted",
    icon: "circle"
  }, "Connected \xB7 ", mode === "api" ? "API" : "Capture"))), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      margin: "2px 0 0"
    }
  }, "Import the live on-call grid to drive DocTurn's rotation pool. Manual overrides always win at game time.")), connected && /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "outline",
    icon: "rotate-ccw",
    onClick: syncNow
  }, busy ? "Syncing…" : "Sync now")), !connected && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      margin: "14px 0 6px"
    }
  }, /*#__PURE__*/React.createElement(SSModeTab, {
    active: mode === "api",
    icon: "plug-zap",
    label: "API token",
    sub: "Vendor exposes a schedule API. Cleanest, real-time.",
    onClick: () => setMode("api")
  }), /*#__PURE__*/React.createElement(SSModeTab, {
    active: mode === "capture",
    icon: "scan-line",
    label: "Sign-in capture",
    sub: "No API? We log in & read the schedule off-screen.",
    onClick: () => setMode("capture")
  })), mode === "api" ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "API base URL",
    icon: "link",
    value: baseUrl,
    onChange: setBaseUrl
  }), /*#__PURE__*/React.createElement(Field, {
    label: "API token",
    icon: "key-round",
    value: token,
    onChange: setToken,
    type: "password",
    placeholder: "paste secret token",
    help: "Stored server-side, never exposed to clients."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: "1 / -1"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    icon: "plug",
    onClick: run
  }, busy ? "Connecting…" : "Test & connect"))) : /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 9,
      alignItems: "flex-start",
      background: "#FFFBEB",
      border: "1px solid #FDE68A",
      borderRadius: "var(--radius-md)",
      padding: "11px 13px",
      marginBottom: 14,
      fontSize: 12.5,
      color: "#92400E",
      lineHeight: 1.5
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 15,
    color: "#B45309",
    style: {
      marginTop: 1,
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", null, "No public API? DocTurn signs in to Amion inside an ", /*#__PURE__*/React.createElement("b", null, "isolated, server-side headless browser"), ", opens your published on-call page, and parses the grid straight off the rendered screen. Credentials are ", /*#__PURE__*/React.createElement("b", null, "encrypted (AES-256) at rest"), ", used only to fetch the schedule, and every capture is written to the audit log.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Sign-in URL",
    icon: "link",
    value: loginUrl,
    onChange: setLoginUrl
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Schedule key / org password",
    icon: "hash",
    value: schedKey,
    onChange: setSchedKey,
    help: "Amion's interactive-schedule password."
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Username",
    icon: "user",
    value: username,
    onChange: setUsername
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Password",
    icon: "lock",
    value: password,
    onChange: setPassword,
    type: "password"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    icon: "scan-line",
    onClick: run
  }, busy ? "Signing in & capturing…" : "Sign in & capture")))), connected && revealed && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      display: "grid",
      gridTemplateColumns: "minmax(0,260px) 1fr",
      gap: 16,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginBottom: 7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "scan-line",
    size: 13,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: ".04em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, "Captured page")), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      background: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "7px 10px",
      background: "var(--secondary)",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 99,
      background: "#E2574C"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 99,
      background: "#E9B23E"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 99,
      background: "#3FB950"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono, monospace)",
      fontSize: 10.5,
      color: "var(--muted-foreground)",
      marginLeft: 4,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "amion.com/cgi-bin/ocs?Lo=\u2026")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 300,
      overflowY: "auto"
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      fontFamily: "var(--font-mono, monospace)",
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: "left",
      padding: "6px 10px",
      color: "var(--muted-foreground)",
      fontWeight: 600,
      borderBottom: "1px solid var(--border)",
      position: "sticky",
      top: 0,
      background: "#fff"
    }
  }, "Assignment"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: "left",
      padding: "6px 8px",
      color: "var(--muted-foreground)",
      fontWeight: 600,
      borderBottom: "1px solid var(--border)",
      position: "sticky",
      top: 0,
      background: "#fff"
    }
  }, "Provider"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: "center",
      padding: "6px 8px",
      color: "var(--muted-foreground)",
      fontWeight: 600,
      borderBottom: "1px solid var(--border)",
      position: "sticky",
      top: 0,
      background: "#fff"
    },
    title: "Secure-message ready"
  }, "Sec"))), /*#__PURE__*/React.createElement("tbody", null, SS_ROWS.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "5px 10px",
      borderBottom: i < SS_ROWS.length - 1 ? "1px solid var(--border)" : "none",
      whiteSpace: "nowrap"
    }
  }, r.slot, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--muted-foreground)",
      marginLeft: 5
    }
  }, r.hrs)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "5px 8px",
      borderBottom: i < SS_ROWS.length - 1 ? "1px solid var(--border)" : "none",
      whiteSpace: "nowrap"
    }
  }, r.prov), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "5px 8px",
      borderBottom: i < SS_ROWS.length - 1 ? "1px solid var(--border)" : "none",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: r.secure ? "check" : "x",
    size: 12,
    color: r.secure ? "var(--status-accepted)" : "var(--status-rejected)"
  })))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 11
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: ".04em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)",
      marginBottom: 7
    }
  }, "Hours \u2192 shift"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, SS_MAP.map(m => /*#__PURE__*/React.createElement("div", {
    key: m.code,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("code", {
    style: {
      fontFamily: "var(--font-mono, monospace)",
      fontSize: 11,
      background: "var(--secondary)",
      padding: "1px 6px",
      borderRadius: 5,
      minWidth: 46,
      textAlign: "center"
    }
  }, m.code), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 12,
    color: "var(--muted-foreground)"
  }), /*#__PURE__*/React.createElement(ShiftChip, {
    shift: m.shift,
    tint: m.tint
  })))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginBottom: 7,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check-check",
    size: 14,
    color: "var(--status-accepted)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: ".04em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, "Parsed \u2192 on-call today"), /*#__PURE__*/React.createElement(Badge, {
    status: "accepted"
  }, SS_ROWS.length, " assignments"), /*#__PURE__*/React.createElement(Badge, {
    status: "pending",
    icon: "user-plus"
  }, SS_ROWS.filter(r => !r.secure).length, " to invite")), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      maxHeight: 360,
      overflowY: "auto"
    }
  }, SS_ROWS.map((r, i) => {
    const [shift, tint] = SS_HRS[r.hrs];
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "8px 13px",
        borderTop: i ? "1px solid var(--border)" : "none"
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      initials: ssInit(r.prov),
      size: 30,
      tint: r.secure ? "emerald" : "amber"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, ssName(r.prov)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--muted-foreground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, r.slot, " \xB7 ", r.grp)), r.secure ? /*#__PURE__*/React.createElement("span", {
      title: "Ready for secure messages",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: "var(--status-accepted)",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "message-square",
      size: 12
    }), "App") : /*#__PURE__*/React.createElement("span", {
      title: "Not on secure messaging \u2014 will be invited",
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: "var(--status-pending)",
        flex: "none"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "mail",
      size: 12
    }), "Invite"), /*#__PURE__*/React.createElement(ShiftChip, {
      shift: shift,
      tint: tint
    }));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 7,
      marginTop: 9,
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      lineHeight: 1.45
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 13,
    style: {
      marginTop: 1,
      flex: "none"
    }
  }), "Providers marked ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--status-pending)",
      fontWeight: 600
    }
  }, "Invite"), " show \"Not ready to receive secure messages\" in Amion \u2014 DocTurn auto-sends an enrollment invite and falls back to SMS until they're on the app."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginTop: 13,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      fontSize: 12.5,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 14
  }), "Re-sync every", /*#__PURE__*/React.createElement("select", {
    value: interval,
    onChange: e => setIntervalVal(e.target.value),
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 12.5,
      fontWeight: 600,
      padding: "5px 8px",
      borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)",
      background: "#fff",
      color: "var(--foreground)",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "5m"
  }, "5 min"), /*#__PURE__*/React.createElement("option", {
    value: "15m"
  }, "15 min"), /*#__PURE__*/React.createElement("option", {
    value: "1h"
  }, "1 hour"), /*#__PURE__*/React.createElement("option", {
    value: "manual"
  }, "Manual only"))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, "\xB7 Last sync ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--foreground)",
      fontWeight: 600
    }
  }, lastSync)), /*#__PURE__*/React.createElement("button", {
    onClick: disconnect,
    style: {
      marginLeft: "auto",
      border: "none",
      background: "transparent",
      color: "var(--destructive)",
      fontSize: 12.5,
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      display: "inline-flex",
      alignItems: "center",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "unplug",
    size: 13
  }), "Disconnect")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginTop: 11,
      fontSize: 11.5,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-check",
    size: 13,
    color: "var(--status-accepted)"
  }), "Read-only \xB7 credentials encrypted at rest \xB7 every capture written to the audit log."))));
}
Object.assign(window, {
  ScheduleSync
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/ScheduleSync.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/components.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* DocTurn web-app UI kit — shared primitives.
   Exports components to window for cross-file (Babel) access. */

function Icon({
  name,
  size = 16,
  color,
  strokeWidth = 2,
  style,
  className
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = `<i data-lucide="${name}"></i>`;
    window.lucide.createIcons({
      attrs: {
        width: size,
        height: size,
        "stroke-width": strokeWidth
      },
      root: host
    });
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "center",
      color,
      flex: "none",
      ...style
    }
  });
}
function Button({
  variant = "default",
  size = "default",
  icon,
  children,
  onClick,
  type,
  full,
  style
}) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background .15s ease, box-shadow .15s ease, opacity .15s ease",
    width: full ? "100%" : "auto"
  };
  const sizes = {
    sm: {
      height: 36,
      padding: "0 12px",
      fontSize: 13
    },
    default: {
      height: 40,
      padding: "0 16px",
      fontSize: 14
    },
    lg: {
      height: 44,
      padding: "0 32px",
      fontSize: 15
    },
    icon: {
      height: 40,
      width: 40,
      padding: 0
    }
  };
  const variants = {
    default: {
      background: "var(--primary)",
      color: "#fff",
      boxShadow: "var(--shadow-sm)"
    },
    destructive: {
      background: "var(--destructive)",
      color: "#fff"
    },
    outline: {
      background: "#fff",
      borderColor: "var(--border)",
      color: "var(--foreground)"
    },
    secondary: {
      background: "var(--secondary)",
      color: "var(--foreground)"
    },
    ghost: {
      background: "transparent",
      color: "var(--foreground)"
    },
    link: {
      background: "transparent",
      color: "var(--primary)",
      textDecoration: "underline",
      height: "auto",
      padding: 0
    }
  };
  return /*#__PURE__*/React.createElement("button", {
    type: type || "button",
    onClick: onClick,
    onMouseEnter: e => {
      if (variant === "ghost" || variant === "secondary") e.currentTarget.style.background = "var(--secondary)";
      if (variant === "default") e.currentTarget.style.boxShadow = "var(--shadow-md)";
      if (variant === "outline") e.currentTarget.style.background = "var(--secondary)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = variants[variant].background;
      if (variant === "default") e.currentTarget.style.boxShadow = "var(--shadow-sm)";
    },
    style: {
      ...base,
      ...sizes[size],
      ...variants[variant],
      ...style
    }
  }, icon && /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: size === "lg" ? 18 : 16
  }), children);
}
const STATUS = {
  pending: {
    label: "Pending",
    bg: "var(--status-pending-bg)",
    fg: "var(--status-pending)",
    icon: "clock"
  },
  accepted: {
    label: "Accepted",
    bg: "var(--status-accepted-bg)",
    fg: "var(--status-accepted)",
    icon: "check"
  },
  online: {
    label: "Online",
    bg: "var(--status-accepted-bg)",
    fg: "var(--status-accepted)",
    icon: "circle"
  },
  sent: {
    label: "Sent",
    bg: "var(--status-active-bg)",
    fg: "var(--status-active)",
    icon: "send"
  },
  active: {
    label: "Active",
    bg: "var(--status-active-bg)",
    fg: "var(--status-active)",
    icon: "activity"
  },
  rejected: {
    label: "Rejected",
    bg: "var(--status-rejected-bg)",
    fg: "var(--status-rejected)",
    icon: "x"
  },
  expired: {
    label: "Expired",
    bg: "var(--status-neutral-bg)",
    fg: "var(--status-neutral)",
    icon: "minus"
  },
  offline: {
    label: "Offline",
    bg: "var(--status-neutral-bg)",
    fg: "var(--status-neutral)",
    icon: "minus"
  }
};
function Badge({
  status,
  variant,
  children,
  icon
}) {
  const s = status ? STATUS[status] : null;
  const palette = s ? {
    background: s.bg,
    color: s.fg
  } : variant === "outline" ? {
    background: "#fff",
    color: "var(--foreground)",
    border: "1px solid var(--border)"
  } : variant === "secondary" ? {
    background: "var(--secondary)",
    color: "var(--foreground)"
  } : variant === "destructive" ? {
    background: "var(--destructive)",
    color: "#fff"
  } : {
    background: "var(--primary)",
    color: "#fff"
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "2px 9px",
      borderRadius: "var(--radius-full)",
      fontSize: 12,
      fontWeight: 600,
      lineHeight: 1.6,
      ...palette
    }
  }, (icon || s) && /*#__PURE__*/React.createElement(Icon, {
    name: icon || s.icon,
    size: 11
  }), children || s && s.label);
}
function StatusDot({
  status = "offline",
  pulse
}) {
  const s = STATUS[status] || STATUS.offline;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      width: 9,
      height: 9,
      display: "inline-block",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: "99px",
      background: s.fg
    }
  }), pulse && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: "99px",
      background: s.fg,
      animation: "dt-pulse 1.5s infinite"
    }
  }));
}
function Avatar({
  initials,
  size = 36,
  tint = "blue"
}) {
  const tints = {
    blue: {
      bg: "#DBEAFE",
      fg: "var(--primary)"
    },
    emerald: {
      bg: "var(--status-accepted-bg)",
      fg: "var(--status-accepted)"
    },
    amber: {
      bg: "var(--status-pending-bg)",
      fg: "var(--status-pending)"
    },
    slate: {
      bg: "var(--status-neutral-bg)",
      fg: "var(--status-neutral)"
    }
  };
  const t = tints[tint] || tints.blue;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: "99px",
      background: t.bg,
      color: t.fg,
      fontWeight: 700,
      fontSize: size * 0.36,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, initials);
}
function Card({
  children,
  style,
  onClick,
  hover
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => hover && setH(true),
    onMouseLeave: () => hover && setH(false),
    style: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      boxShadow: h ? "var(--shadow-md)" : "var(--shadow-sm)",
      transition: "box-shadow .2s ease, transform .2s ease",
      transform: h ? "translateY(-1px)" : "none",
      cursor: onClick ? "pointer" : "default",
      ...style
    }
  }, children);
}
function Field({
  label,
  icon,
  value,
  onChange,
  placeholder,
  type,
  help,
  error,
  textarea,
  rows
}) {
  const [focus, setFocus] = React.useState(false);
  const borderColor = error ? "var(--destructive)" : focus ? "var(--ring)" : "var(--input)";
  return /*#__PURE__*/React.createElement("div", null, label && /*#__PURE__*/React.createElement("label", {
    style: {
      display: "block",
      fontSize: 13,
      fontWeight: 500,
      marginBottom: 6
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: textarea ? "flex-start" : "center",
      gap: 8,
      padding: textarea ? "10px 12px" : "0 12px",
      height: textarea ? "auto" : 40,
      border: `1px solid ${borderColor}`,
      borderRadius: "var(--radius-md)",
      background: "#fff",
      boxShadow: focus ? "0 0 0 2px hsl(221 83% 53% / .22)" : "none",
      transition: "border-color .15s, box-shadow .15s"
    }
  }, icon && /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 16,
    color: "var(--muted-foreground)",
    style: {
      marginTop: textarea ? 2 : 0
    }
  }), textarea ? /*#__PURE__*/React.createElement("textarea", {
    value: value,
    onChange: e => onChange && onChange(e.target.value),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    placeholder: placeholder,
    rows: rows || 3,
    style: {
      border: "none",
      outline: "none",
      fontSize: 14,
      width: "100%",
      fontFamily: "inherit",
      background: "transparent",
      resize: "vertical",
      color: "var(--foreground)"
    }
  }) : /*#__PURE__*/React.createElement("input", {
    type: type || "text",
    value: value,
    onChange: e => onChange && onChange(e.target.value),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    placeholder: placeholder,
    style: {
      border: "none",
      outline: "none",
      fontSize: 14,
      width: "100%",
      fontFamily: "inherit",
      background: "transparent",
      color: "var(--foreground)"
    }
  })), error ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--destructive)",
      marginTop: 5,
      display: "flex",
      gap: 4,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert-circle",
    size: 12
  }), error) : help ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--muted-foreground)",
      marginTop: 5
    }
  }, help) : null);
}
function Logo({
  height = 30
}) {
  return /*#__PURE__*/React.createElement("img", {
    src: "assets/docturn-wordmark.svg",
    alt: "DocTurn",
    style: {
      height,
      display: "block"
    }
  });
}
function Modal({
  title,
  subtitle,
  icon,
  onClose,
  children,
  width = 460
}) {
  React.useEffect(() => {
    const onKey = e => {
      if (e.key === "Escape") onClose && onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 60,
      background: "rgba(15,23,42,.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      animation: "dt-toast-in .18s ease"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: width,
      maxWidth: "100%",
      maxHeight: "90vh",
      overflowY: "auto",
      background: "#fff",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-2xl, 0 24px 60px rgba(2,6,23,.28))",
      border: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      padding: "18px 20px",
      borderBottom: "1px solid var(--border)"
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 36,
      borderRadius: "var(--radius-md)",
      background: "#DBEAFE",
      color: "var(--primary)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      fontWeight: 700
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      marginTop: 1
    }
  }, subtitle)), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      width: 32,
      height: 32,
      borderRadius: "var(--radius-md)",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 18
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20
    }
  }, children)));
}
function EditableText({
  value,
  onSave,
  placeholder,
  mono,
  size = 14,
  weight = 600,
  color = "var(--foreground)",
  multiline,
  width
}) {
  const [editing, setEditing] = React.useState(false);
  const [v, setV] = React.useState(value);
  const [hover, setHover] = React.useState(false);
  React.useEffect(() => {
    setV(value);
  }, [value]);
  const commit = () => {
    setEditing(false);
    if ((v || "").trim() !== (value || "")) onSave((v || "").trim());
  };
  const cancel = () => {
    setEditing(false);
    setV(value);
  };
  const fontFam = mono ? "var(--font-mono, ui-monospace, monospace)" : "var(--font-sans)";
  if (editing) {
    const common = {
      value: v,
      autoFocus: true,
      onChange: e => setV(e.target.value),
      onBlur: commit,
      onKeyDown: e => {
        if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") cancel();
      },
      style: {
        font: "inherit",
        fontSize: size,
        fontWeight: weight,
        fontFamily: fontFam,
        color: color,
        width: width || "auto",
        minWidth: 60,
        border: "1px solid var(--ring)",
        borderRadius: "var(--radius-sm)",
        padding: multiline ? "6px 8px" : "1px 6px",
        outline: "none",
        boxShadow: "0 0 0 2px hsl(221 83% 53% / .18)",
        background: "#fff",
        boxSizing: "border-box"
      }
    };
    return multiline ? /*#__PURE__*/React.createElement("textarea", _extends({
      rows: 2
    }, common)) : /*#__PURE__*/React.createElement("input", common);
  }
  return /*#__PURE__*/React.createElement("span", {
    onClick: () => setEditing(true),
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    title: "Click to edit",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      cursor: "text",
      fontSize: size,
      fontWeight: weight,
      fontFamily: fontFam,
      color: value || color,
      borderBottom: hover ? "1px dashed var(--muted-foreground)" : "1px dashed transparent",
      lineHeight: 1.3,
      maxWidth: "100%"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: value ? color : "var(--muted-foreground)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: multiline ? "normal" : "nowrap"
    }
  }, value || placeholder || "—"), /*#__PURE__*/React.createElement(Icon, {
    name: "pencil",
    size: Math.max(10, size - 3),
    color: "var(--muted-foreground)",
    style: {
      opacity: hover ? 0.9 : 0,
      flex: "none",
      transition: "opacity .12s"
    }
  }));
}
Object.assign(window, {
  Icon,
  Button,
  Badge,
  StatusDot,
  Avatar,
  Card,
  Field,
  Logo,
  StatTile,
  STATUS,
  Modal,
  EditableText
});
function StatTile({
  label,
  value,
  icon,
  tint = "blue"
}) {
  const tints = {
    blue: "var(--primary)",
    emerald: "var(--status-accepted)",
    amber: "var(--status-pending)",
    slate: "var(--status-neutral)"
  };
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      padding: 16,
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--muted-foreground)",
      fontWeight: 500
    }
  }, label), /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 16,
    color: tints[tint]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      fontWeight: 700,
      marginTop: 6,
      letterSpacing: "-0.02em"
    }
  }, value));
}
Object.assign(window, {
  Icon,
  Button,
  Badge,
  StatusDot,
  Avatar,
  Card,
  Field,
  Logo,
  StatTile,
  STATUS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/components.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/store.js
try { (() => {
/* ============================================================================
   DocTurn — application store (single source of truth).

   Plain JS (no JSX) so it loads synchronously before the Babel component
   scripts. Everything the app shows lives here; it is persisted to
   localStorage on every real mutation and rehydrated on load, so the whole
   prototype survives a refresh. A 1-second clock drives live countdowns,
   expiry-based auto re-routing, presence and typing — without thrashing
   localStorage (we persist only when data actually changes).

   Exposes:  window.DT  ........ { getState, subscribe, actions, ... }
             window.useStore() .. React hook -> whole state (re-renders on change)
             window.useActions() React hook -> stable actions object
             window.useClock() .. React hook -> seconds counter (live ticking UI)
             window.dtFmt ....... small formatting helpers
   ============================================================================ */
(function () {
  "use strict";

  var KEY = "docturn:store:v6";
  var now = function () {
    return Date.now();
  };
  var uid = function () {
    var n = 1000;
    return function (p) {
      return (p || "id") + "_" + ++n + "_" + Math.floor(Math.random() * 1e4);
    };
  }();

  /* ---- time helpers ------------------------------------------------------ */
  function hhmm(ts) {
    var d = ts == null ? new Date() : new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function clockLabel() {
    return hhmm();
  }
  function mmss(ms) {
    if (ms <= 0) return "0:00";
    var s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function ago(ts) {
    var s = Math.max(0, Math.round((now() - ts) / 1000));
    if (s < 60) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }
  function initialsOf(name) {
    return name.replace(/^Dr\.?\s*/, "").split(/[\s,]+/).map(function (w) {
      return w[0];
    }).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }

  /* ---- AI intake extraction (deterministic, note-driven) ----------------- */
  var SPECIALTY_KEYS = [[/chest pain|troponin|nstemi|stemi|cardiac|afib|chf|angina/i, "Cardiology"], [/copd|pneumonia|sob|short(ness)? of breath|asthma|pe\b|pulmonary|hypox/i, "Pulmonology"], [/dka|diabet|ketoacidosis|hyperglyc|thyroid|endocrine/i, "Endocrine"], [/aki|ckd|renal|kidney|electrolyte|dialysis/i, "Nephrology"], [/gi bleed|melena|hematemesis|abdominal|pancreatitis|hepatic|liver/i, "GI"], [/sepsis|septic|infection|cellulitis|abscess|febrile/i, "Infectious Disease"], [/stroke|seizure|altered mental|neuro|headache/i, "Neurology"]];
  function extractIntake(note) {
    var text = (note || "").trim();
    if (!text) return {
      initials: "",
      room: "",
      complaint: "",
      specialty: "",
      consults: [],
      empty: true
    };
    var initials = "";
    var im = text.match(/\b(?:patient|pt\.?)\s+([A-Z]\.?\s?[A-Z])\b/i);
    if (im) {
      initials = im[1].replace(/[.\s]/g, "").toUpperCase().slice(0, 2);
    }
    if (!initials) {
      var im2 = text.match(/\b([A-Z]{2})\b/);
      if (im2) initials = im2[1];
    }
    if (!initials) {
      var caps = text.match(/\b[A-Z][a-z]+\b/g) || [];
      if (caps.length >= 2) initials = (caps[0][0] + caps[1][0]).toUpperCase();
    }
    var rm = text.match(/\b(?:room|rm\.?|bed)\s*#?\s*([0-9]{1,4}[A-Za-z]?)\b/i);
    var room = rm ? rm[1] : (text.match(/\b([0-9]{3})\b/) || [])[1] || "";
    var complaint = text.split(/[.\n;]/)[0].trim().replace(/^\s*(patient|pt\.?)\s+[A-Z.\s]+\s*(with|w\/|presenting with|presents with)?\s*/i, "");
    complaint = complaint.charAt(0).toUpperCase() + complaint.slice(1);
    if (complaint.length > 90) complaint = complaint.slice(0, 88) + "…";
    var specialty = "Hospital Medicine",
      consults = [];
    for (var i = 0; i < SPECIALTY_KEYS.length; i++) {
      if (SPECIALTY_KEYS[i][0].test(text)) {
        specialty = SPECIALTY_KEYS[i][1];
        consults = [specialty];
        break;
      }
    }
    return {
      initials: initials || "—",
      room: room,
      complaint: complaint || text.slice(0, 80),
      specialty: specialty,
      consults: consults,
      empty: false
    };
  }

  /* ---- incoming-admit generator (for live "real" feel) ------------------- */
  var ADMIT_POOL = [{
    initials: "GV",
    room: "221",
    complaint: "Septic shock, on pressors",
    specialty: "Infectious Disease",
    from: "Dr. Reyes (ER)"
  }, {
    initials: "HP",
    room: "117",
    complaint: "PE, hypoxic on room air",
    specialty: "Pulmonology",
    from: "Dr. Osei (ER)"
  }, {
    initials: "WN",
    room: "309",
    complaint: "AKI on CKD, hyperkalemia",
    specialty: "Nephrology",
    from: "Dr. Okafor (ER)"
  }, {
    initials: "EB",
    room: "402",
    complaint: "Afib with RVR",
    specialty: "Cardiology",
    from: "Dr. Reyes (ER)"
  }, {
    initials: "TS",
    room: "210",
    complaint: "Acute pancreatitis",
    specialty: "GI",
    from: "Dr. Osei (ER)"
  }];

  /* ---- seed (initial) state --------------------------------------------- */
  function seed() {
    var t0 = now();
    return {
      v: 6,
      theme: {
        appName: "DocTurn",
        accent: "#2563EB",
        radius: 8,
        sidebar: "expanded",
        contentWidth: "standard"
      },
      navHidden: {},
      navOrder: {},
      session: null,
      // { role, org, user, name }
      ui: {
        nav: "dashboard",
        notifOpen: false,
        realtime: true,
        onShift: true
      },
      me: {
        name: "Dr. Jordan Chen",
        avatar: "JC",
        role: "MD"
      },
      providers: [{
        id: "h1",
        name: "Dr. Sarah Chen",
        avatar: "SC",
        specialty: "Cardiology",
        census: 3,
        cap: 12,
        working: true,
        shift: "day",
        inRotation: true
      }, {
        id: "h2",
        name: "Dr. Amir Patel",
        avatar: "AP",
        specialty: "Hospital Medicine",
        census: 5,
        cap: 12,
        working: true,
        shift: "day",
        inRotation: true
      }, {
        id: "h3",
        name: "Dr. Maria Lopez",
        avatar: "ML",
        specialty: "Pulmonology",
        census: 7,
        cap: 10,
        working: true,
        shift: "swing",
        inRotation: true
      }, {
        id: "h5",
        name: "Dr. Nina Roy",
        avatar: "NR",
        specialty: "Hospital Medicine",
        census: 4,
        cap: 12,
        working: true,
        shift: "swing",
        inRotation: false
      }, {
        id: "h6",
        name: "Dr. Omar Haddad",
        avatar: "OH",
        specialty: "Hospital Medicine",
        census: 6,
        cap: 12,
        working: true,
        shift: "night",
        inRotation: true
      }, {
        id: "h4",
        name: "Dr. James Liu",
        avatar: "JL",
        specialty: "Nephrology",
        census: 2,
        cap: 8,
        working: false,
        shift: "night",
        inRotation: false
      }],
      shifts: [{
        id: "day",
        label: "Day call",
        start: "07:00",
        end: "15:00"
      }, {
        id: "swing",
        label: "Swing",
        start: "15:00",
        end: "23:00"
      }, {
        id: "night",
        label: "Nights",
        start: "23:00",
        end: "07:00"
      }],
      rotationCursor: 0,
      erPhysicians: [{
        id: "e1",
        name: "Dr. Ruth Osei",
        avatar: "RO",
        working: true,
        shift: "day",
        admitsToday: 6
      }, {
        id: "e2",
        name: "Dr. Paul Okafor",
        avatar: "PO",
        working: true,
        shift: "day",
        admitsToday: 4
      }, {
        id: "e3",
        name: "Dr. Dana Reyes",
        avatar: "DR",
        working: true,
        shift: "swing",
        admitsToday: 5
      }, {
        id: "e4",
        name: "Dr. Sam Iyer",
        avatar: "SI",
        working: false,
        shift: "night",
        admitsToday: 0
      }],
      diversion: false,
      avgAcceptSec: 252,
      fhir: {
        connected: false,
        lastSync: null,
        source: "Epic FHIR",
        endpoint: "fhir.mayo.org/api/r4"
      },
      pending: [{
        id: "a1",
        initials: "RM",
        room: "318",
        complaint: "Acute abdominal pain, 2-day onset",
        from: "Dr. Reyes (ER)",
        specialty: "General Medicine",
        via: "Round-robin",
        expiresAt: t0 + 272000,
        acceptedToday: false
      }, {
        id: "a2",
        initials: "TK",
        room: "205",
        complaint: "Diabetic ketoacidosis",
        from: "Dr. Osei (ER)",
        specialty: "Endocrinology",
        via: "Manual",
        expiresAt: t0 + 430000,
        acceptedToday: false
      }],
      myPatients: [{
        id: "p1",
        initials: "DW",
        room: "410",
        complaint: "CHF exacerbation"
      }, {
        id: "p2",
        initials: "BG",
        room: "402",
        complaint: "Community-acquired pneumonia"
      }, {
        id: "p3",
        initials: "SC",
        room: "412",
        complaint: "Chest pain — observation"
      }],
      acceptedToday: 7,
      sent: [{
        id: uid("s"),
        initials: "MJ",
        provider: "Dr. Amir Patel",
        complaint: "NSTEMI, troponin trending",
        consultants: ["Cardiology"],
        time: "Today · 08:41",
        day: "Today",
        status: "accepted"
      }, {
        id: uid("s"),
        initials: "RV",
        provider: "Dr. Maria Lopez",
        complaint: "COPD exacerbation",
        consultants: ["Pulmonology"],
        time: "Today · 07:55",
        day: "Today",
        status: "sent"
      }, {
        id: uid("s"),
        initials: "DK",
        provider: "Dr. Sarah Chen",
        complaint: "Syncope, workup",
        consultants: [],
        time: "Yesterday · 21:10",
        day: "Yesterday",
        status: "accepted"
      }, {
        id: uid("s"),
        initials: "LP",
        provider: "Dr. Omar Haddad",
        complaint: "GI bleed, melena",
        consultants: ["GI"],
        time: "Yesterday · 16:32",
        day: "Yesterday",
        status: "rejected"
      }],
      team: [{
        id: "m1",
        name: "Jordan Wu, PA-C",
        avatar: "JW",
        role: "PA",
        specialty: "Hospital Medicine",
        onCall: true
      }, {
        id: "m2",
        name: "Nina Roy, NP",
        avatar: "NR",
        role: "NP",
        specialty: "Cardiology",
        onCall: false
      }],
      candidates: [{
        id: "c1",
        name: "Dr. Omar Haddad",
        avatar: "OH",
        role: "MD",
        specialty: "Hospital Medicine"
      }, {
        id: "c2",
        name: "Priya Shah, NP",
        avatar: "PS",
        role: "NP",
        specialty: "Pulmonology"
      }, {
        id: "c3",
        name: "Marcus Bell, PA-C",
        avatar: "MB",
        role: "PA",
        specialty: "General Medicine"
      }, {
        id: "c4",
        name: "Dr. Lena Ortiz",
        avatar: "LO",
        role: "DO",
        specialty: "Nephrology"
      }, {
        id: "c5",
        name: "Sam Cole, RN",
        avatar: "SC",
        role: "RN",
        specialty: "Telemetry"
      }],
      board: [{
        id: uid("b"),
        initials: "RM",
        room: "318",
        dept: "MED",
        issue: "Acute abdominal pain, 2-day onset",
        status: "admitted",
        attending: {
          name: "Dr. Sarah Chen",
          avatar: "SC"
        },
        unit: [{
          avatar: "JW",
          role: "PA"
        }],
        consultants: ["GI"],
        er: {
          name: "Dr. Reyes",
          avatar: "Re"
        }
      }, {
        id: uid("b"),
        initials: "TK",
        room: "205",
        dept: "ICU",
        issue: "Diabetic ketoacidosis",
        status: "observation",
        attending: {
          name: "Dr. Maria Lopez",
          avatar: "ML"
        },
        unit: [{
          avatar: "NR",
          role: "NP"
        }],
        consultants: ["Endocrine", "Nephro"],
        er: {
          name: "Dr. Osei",
          avatar: "Os"
        }
      }, {
        id: uid("b"),
        initials: "DW",
        room: "410",
        dept: "TELE",
        issue: "CHF exacerbation",
        status: "admitted",
        attending: {
          name: "Dr. Amir Patel",
          avatar: "AP"
        },
        unit: [],
        consultants: ["Cardiology"],
        er: {
          name: "Dr. Reyes",
          avatar: "Re"
        }
      }, {
        id: uid("b"),
        initials: "BG",
        room: "402",
        dept: "MED",
        issue: "Community-acquired pneumonia",
        status: "admitted",
        attending: {
          name: "Dr. Sarah Chen",
          avatar: "SC"
        },
        unit: [{
          avatar: "JW",
          role: "PA"
        }],
        consultants: [],
        er: {
          name: "Dr. Okafor",
          avatar: "Ok"
        }
      }, {
        id: uid("b"),
        initials: "LH",
        room: "—",
        dept: "ER",
        issue: "Chest pain, rule-out ACS",
        status: "pending",
        attending: {
          name: "",
          avatar: ""
        },
        unit: [],
        consultants: [],
        er: {
          name: "Dr. Osei",
          avatar: "Os"
        }
      }, {
        id: uid("b"),
        initials: "PV",
        room: "221",
        dept: "ICU",
        issue: "Septic shock, on pressors",
        status: "observation",
        attending: {
          name: "Dr. Maria Lopez",
          avatar: "ML"
        },
        unit: [{
          avatar: "PS",
          role: "NP"
        }],
        consultants: ["ID", "Pulm"],
        er: {
          name: "Dr. Reyes",
          avatar: "Re"
        }
      }, {
        id: uid("b"),
        initials: "AC",
        room: "308",
        dept: "MED",
        issue: "AKI on CKD, electrolyte derangement",
        status: "transfer",
        attending: {
          name: "Dr. James Liu",
          avatar: "JL"
        },
        unit: [],
        consultants: ["Nephro"],
        er: {
          name: "Dr. Okafor",
          avatar: "Ok"
        }
      }],
      orgs: [{
        code: "MAYO",
        name: "Mayo General Hospital",
        timezone: "America/New_York",
        users: 142,
        assignments: 88,
        active: true
      }, {
        code: "STJUDE",
        name: "St. Jude Medical Center",
        timezone: "America/Chicago",
        users: 96,
        assignments: 54,
        active: true
      }, {
        code: "CLEVE",
        name: "Cleveland Care Network",
        timezone: "America/New_York",
        users: 211,
        assignments: 132,
        active: true
      }, {
        code: "MERCY",
        name: "Mercy West",
        timezone: "America/Los_Angeles",
        users: 67,
        assignments: 29,
        active: true
      }, {
        code: "PINE",
        name: "Pinecrest Regional",
        timezone: "America/Denver",
        users: 38,
        assignments: 12,
        active: false
      }],
      selectedOrg: "MAYO",
      roleColors: {
        hospitalist: "#2563EB",
        er_doctor: "#D97706",
        er_director: "#DC2626",
        director: "#7C3AED",
        developer: "#0F766E"
      },
      devUsers: [{
        id: uid("u"),
        name: "Dr. Lena Ortiz",
        role: "hospitalist",
        org: "MAYO",
        specialty: "Nephrology"
      }, {
        id: uid("u"),
        name: "Priya Shah, NP",
        role: "hospitalist",
        org: "CLEVE",
        specialty: "Pulmonology"
      }, {
        id: uid("u"),
        name: "Karen Vance",
        role: "director",
        org: "MAYO",
        specialty: ""
      }, {
        id: uid("u"),
        name: "Dr. Ruth Osei",
        role: "er_doctor",
        org: "STJUDE",
        specialty: ""
      }, {
        id: uid("u"),
        name: "Dr. Paul Okafor",
        role: "er_director",
        org: "CLEVE",
        specialty: ""
      }, {
        id: uid("u"),
        name: "Sam Rivera",
        role: "developer",
        org: "MAYO",
        specialty: "",
        scope: "local"
      }, {
        id: uid("u"),
        name: "Alex Kim (root)",
        role: "developer",
        org: "*",
        specialty: "",
        scope: "root"
      }],
      diagnostics: null,
      conversations: [{
        id: "cv1",
        name: "Dr. Sarah Chen",
        role: "Cardiology",
        initials: "SC",
        presence: "online",
        tint: "emerald",
        unread: 2,
        typing: false,
        messages: [{
          me: false,
          text: "Got the round-robin assignment for patient SC, room 412.",
          at: t0 - 200000
        }, {
          me: true,
          text: "Thanks — chest pain, SOB on exertion. Cardiology suggested.",
          at: t0 - 190000
        }, {
          me: false,
          text: "Accepting the 412 hand-off now.",
          at: t0 - 120000,
          read: true
        }]
      }, {
        id: "cv2",
        name: "ICU Care Team",
        role: "Group · 6 members",
        initials: "IC",
        presence: "online",
        tint: "blue",
        unread: 0,
        group: true,
        typing: false,
        messages: [{
          me: false,
          text: "Bed 3 is open for the next admit.",
          at: t0 - 840000
        }]
      }, {
        id: "cv3",
        name: "Dr. Amir Patel",
        role: "Hospital Medicine",
        initials: "AP",
        presence: "pending",
        tint: "amber",
        unread: 0,
        typing: false,
        messages: [{
          me: false,
          text: "On my way up — give me 5.",
          at: t0 - 3600000
        }]
      }, {
        id: "cv4",
        name: "Emergency broadcast",
        role: "Code · all providers",
        initials: "!",
        presence: "offline",
        tint: "slate",
        unread: 0,
        broadcast: true,
        typing: false,
        messages: [{
          me: false,
          text: "Mass casualty drill at 14:00.",
          at: t0 - 10800000
        }]
      }],
      broadcasts: [{
        id: uid("bc"),
        title: "Code stroke — Bed 4 ICU",
        sev: "critical",
        at: t0 - 480000,
        acked: 11,
        total: 14,
        ackReq: true
      }, {
        id: uid("bc"),
        title: "Diversion lifted — accepting transfers",
        sev: "info",
        at: t0 - 3600000,
        acked: 0,
        total: 0,
        ackReq: false
      }, {
        id: uid("bc"),
        title: "Mass casualty drill at 15:00",
        sev: "warning",
        at: t0 - 10800000,
        acked: 22,
        total: 24,
        ackReq: true
      }],
      settings: {
        timeout: 10,
        autoReassign: true,
        onCallOnly: false,
        activeOnly: true,
        flags: {
          sms: true,
          push: true,
          ai: true,
          broadcasts: true,
          amion: false
        },
        shiftTypes: [{
          id: "rounding",
          name: "Rounding",
          time: "07:00–19:00",
          color: "var(--status-active)"
        }, {
          id: "swing",
          name: "Swing",
          time: "13:00–23:00",
          color: "var(--status-pending)"
        }, {
          id: "nocturnist",
          name: "Nocturnist",
          time: "19:00–07:00",
          color: "var(--status-neutral)"
        }],
        integrations: {
          twilio: true,
          firebase: true,
          openai: true,
          amion: false
        }
      },
      roles: [{
        id: "r_super",
        name: "Super Admin",
        desc: "Full platform access across all tenants and portals.",
        system: true,
        portals: ["hospitalist", "hosp_director", "er_physician", "er_director", "admin", "developer"],
        perms: ["view_census", "assign_patients", "manage_assignments", "view_reports", "manage_staff", "system_settings"],
        features: ["ai_chatbot", "portal_customization"],
        users: 3
      }, {
        id: "r_hospdir",
        name: "Hospitalist Director",
        desc: "Runs the hospitalist group — rotation, staff and census.",
        system: true,
        portals: ["hospitalist", "hosp_director"],
        perms: ["view_census", "assign_patients", "manage_assignments", "view_reports", "manage_staff"],
        features: ["ai_chatbot", "portal_customization"],
        users: 4
      }, {
        id: "r_hosp",
        name: "Hospitalist",
        desc: "Accepts hand-offs and manages their own census.",
        system: true,
        portals: ["hospitalist"],
        perms: ["view_census", "manage_assignments"],
        features: ["ai_chatbot"],
        users: 38
      }, {
        id: "r_erdir",
        name: "ER Director",
        desc: "Oversees ER intake and routing performance.",
        system: false,
        portals: ["er_physician", "er_director"],
        perms: ["view_census", "assign_patients", "view_reports"],
        features: ["ai_chatbot"],
        users: 2
      }, {
        id: "r_er",
        name: "ER Physician",
        desc: "Admits patients and routes them to hospitalists.",
        system: false,
        portals: ["er_physician"],
        perms: ["view_census", "assign_patients"],
        features: ["ai_chatbot"],
        users: 21
      }, {
        id: "r_tech",
        name: "Technician",
        desc: "Read-only census visibility for floor support.",
        system: false,
        portals: ["hospitalist"],
        perms: ["view_census"],
        features: [],
        users: 12
      }],
      notifications: [{
        id: uid("n"),
        icon: "route",
        title: "New assignment routed",
        body: "Patient RM → you · round-robin",
        at: t0 - 90000,
        read: false
      }, {
        id: uid("n"),
        icon: "message-square",
        title: "Dr. Sarah Chen",
        body: "Accepting the 412 hand-off now.",
        at: t0 - 120000,
        read: false
      }, {
        id: uid("n"),
        icon: "megaphone",
        title: "Code stroke — Bed 4 ICU",
        body: "Critical broadcast · ack required",
        at: t0 - 480000,
        read: true
      }],
      audit: [{
        id: uid("a"),
        at: t0 - 1000,
        actor: "Dr. R. Osei",
        role: "er_doctor",
        action: "create_assignment",
        resource: "assignment #a8842",
        ip: "10.2.4.18",
        risk: "low",
        org: "MAYO"
      }, {
        id: uid("a"),
        at: t0 - 380000,
        actor: "Admin K. Vance",
        role: "director",
        action: "reassign_patient",
        resource: "assignment #a8830",
        ip: "10.2.4.6",
        risk: "medium",
        org: "MAYO"
      }, {
        id: uid("a"),
        at: t0 - 760000,
        actor: "Dr. S. Chen",
        role: "hospitalist",
        action: "accept_assignment",
        resource: "assignment #a8829",
        ip: "10.2.7.91",
        risk: "low",
        org: "MAYO"
      }, {
        id: uid("a"),
        at: t0 - 1500000,
        actor: "Admin K. Vance",
        role: "director",
        action: "delete_conversation",
        resource: "conversation 3f9a",
        ip: "10.2.4.6",
        risk: "high",
        org: "MAYO"
      }, {
        id: uid("a"),
        at: t0 - 1980000,
        actor: "Dr. A. Patel",
        role: "hospitalist",
        action: "login",
        resource: "session",
        ip: "10.2.7.40",
        risk: "low",
        org: "MAYO"
      }],
      phiLog: [{
        id: uid("ph"),
        at: t0 - 1000,
        actor: "Dr. R. Osei",
        patient: "RM",
        access: "view",
        fields: "initials, room, issue",
        purpose: "Admission intake",
        ok: true
      }, {
        id: uid("ph"),
        at: t0 - 290000,
        actor: "Dr. S. Chen",
        patient: "DW",
        access: "edit",
        fields: "issue summary",
        purpose: "Care update",
        ok: true
      }, {
        id: uid("ph"),
        at: t0 - 1010000,
        actor: "Dr. M. Lopez",
        patient: "TK",
        access: "view",
        fields: "full record",
        purpose: "—",
        ok: false
      }, {
        id: uid("ph"),
        at: t0 - 2900000,
        actor: "Dr. A. Patel",
        patient: "BG",
        access: "export",
        fields: "discharge summary",
        purpose: "Transfer",
        ok: true
      }],
      incidents: [{
        id: uid("i"),
        type: "failed_login",
        sev: "medium",
        desc: "5 failed logins for user #214 from 84.21.x.x",
        status: "investigating",
        at: t0 - 720000
      }, {
        id: uid("i"),
        type: "unauthorized_access",
        sev: "critical",
        desc: "Cross-tenant read attempt blocked — STJUDE → MAYO",
        status: "open",
        at: t0 - 1860000
      }, {
        id: uid("i"),
        type: "suspicious_activity",
        sev: "high",
        desc: "PHI export volume spike for user #51",
        status: "open",
        at: t0 - 3600000
      }, {
        id: uid("i"),
        type: "failed_login",
        sev: "low",
        desc: "Expired session reuse rejected",
        status: "resolved",
        at: t0 - 10800000
      }],
      lastAdmitAt: t0
    };
  }

  /* ---- persistence ------------------------------------------------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 6) return null;
      // transient UI bits always reset sensibly
      s.ui = s.ui || {
        nav: "dashboard",
        notifOpen: false,
        realtime: true
      };
      s.ui.notifOpen = false;
      return s;
    } catch (e) {
      return null;
    }
  }
  var state = load() || seed();
  var listeners = new Set();
  var clockListeners = new Set();

  // Debounced persistence: batch write-heavy flows (e.g. typing, the 1s clock)
  // into one localStorage write at most every 250ms; flush on unload so nothing
  // is lost on refresh.
  var persistTimer = null;
  function persistNow() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {}
  }
  function persist() {
    if (persistTimer) return;
    persistTimer = setTimeout(function () {
      persistTimer = null;
      persistNow();
    }, 250);
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("beforeunload", function () {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      persistNow();
    });
  }
  function emit() {
    listeners.forEach(function (l) {
      l();
    });
  }

  // Mutate via a producer that always yields a NEW top-level object (so
  // useSyncExternalStore sees a changed reference), persists, and notifies.
  function set(producer) {
    var next = producer(state) || state;
    state = Object.assign({}, next);
    persist();
    emit();
  }
  function getState() {
    return state;
  }
  function subscribe(l) {
    listeners.add(l);
    return function () {
      listeners.delete(l);
    };
  }
  function subscribeClock(l) {
    clockListeners.add(l);
    ensureClock();
    return function () {
      clockListeners.delete(l);
      ensureClock();
    };
  }

  /* ---- derived ----------------------------------------------------------- */
  function sortedProviders() {
    return state.providers.slice().sort(function (a, b) {
      return b.working - a.working || a.census - b.census;
    });
  }
  function rotationList() {
    return state.providers.filter(function (p) {
      return p.working && p.inRotation;
    });
  }
  function nextUp() {
    var r = rotationList();
    if (!r.length) return null;
    return r.slice().sort(function (a, b) {
      return a.census - b.census;
    })[0];
  }
  function unreadMessages() {
    return state.conversations.reduce(function (a, c) {
      return a + (c.unread || 0);
    }, 0);
  }
  function unreadNotifs() {
    return state.notifications.filter(function (n) {
      return !n.read;
    }).length;
  }

  /* ---- audit / notify helpers ------------------------------------------- */
  function pushAudit(s, entry) {
    var who = s.session ? actorName(s) : "System";
    var role = s.session ? s.session.role : "system";
    s.audit = [Object.assign({
      id: uid("a"),
      at: now(),
      actor: who,
      role: role,
      ip: "10.2.7.40",
      org: s.selectedOrg || "MAYO",
      risk: "low"
    }, entry)].concat(s.audit).slice(0, 60);
  }
  function pushPhi(s, entry) {
    s.phiLog = [Object.assign({
      id: uid("ph"),
      at: now(),
      actor: actorName(s),
      ok: true
    }, entry)].concat(s.phiLog).slice(0, 40);
  }
  function pushNotif(s, entry) {
    s.notifications = [Object.assign({
      id: uid("n"),
      at: now(),
      read: false
    }, entry)].concat(s.notifications).slice(0, 30);
  }
  function actorName(s) {
    return s.session && s.session.name || s.me.name;
  }

  /* ---- the 1-second clock: live countdowns + expiry re-routing ---------- */
  var lastTickRender = 0;
  function tick() {
    var changed = false;
    var t = now();
    if (state.ui.realtime) {
      // expiry-driven auto re-route
      if (state.settings.autoReassign) {
        state.pending.forEach(function (p) {
          if (!p.rerouted && p.via === "Round-robin" && p.expiresAt - t <= 0) {
            p.rerouted = true;
            var nx = nextUp();
            p.expiresAt = t + state.settings.timeout * 60000;
            p.from = p.from;
            changed = true;
            pushAudit(state, {
              action: "auto_reassign",
              resource: "assignment " + p.id,
              risk: "medium"
            });
            pushNotif(state, {
              icon: "repeat",
              title: "Assignment re-routed",
              body: "Patient " + p.initials + " expired — sent to next provider"
            });
          }
        });
      }
      // occasional new incoming admit (kept rare + capped)
      if (t - state.lastAdmitAt > 45000 && state.pending.length < 4 && Math.random() < 0.5) {
        var tmpl = ADMIT_POOL[Math.floor(Math.random() * ADMIT_POOL.length)];
        if (!state.pending.some(function (p) {
          return p.initials === tmpl.initials;
        })) {
          state.pending = [{
            id: uid("a"),
            initials: tmpl.initials,
            room: tmpl.room,
            complaint: tmpl.complaint,
            specialty: tmpl.specialty,
            from: tmpl.from,
            via: "Round-robin",
            expiresAt: t + state.settings.timeout * 60000
          }].concat(state.pending);
          state.lastAdmitAt = t;
          changed = true;
          pushNotif(state, {
            icon: "route",
            title: "New assignment routed",
            body: "Patient " + tmpl.initials + " → you · round-robin"
          });
          pushAudit(state, {
            actor: tmpl.from.replace(" (ER)", ""),
            role: "er_doctor",
            action: "create_assignment",
            resource: "assignment " + tmpl.initials,
            risk: "low"
          });
        } else {
          state.lastAdmitAt = t;
        }
      }
      // broadcast ack progress creeps up
      state.broadcasts.forEach(function (b) {
        if (b.ackReq && b.acked < b.total && Math.random() < 0.25) {
          b.acked = Math.min(b.total, b.acked + 1);
          changed = true;
        }
      });
    }
    if (changed) {
      state = Object.assign({}, state);
      persist();
      emit();
    }
    // clock listeners always fire (drives countdown labels) — throttled to 1s
    clockListeners.forEach(function (l) {
      l();
    });
  }
  // Managed clock: only tick while live countdown UI is mounted (i.e. something
  // subscribed via useClock). Pauses entirely on the login screen / when idle.
  var clockTimer = null;
  function ensureClock() {
    if (clockListeners.size > 0 && !clockTimer) clockTimer = setInterval(tick, 1000);else if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  /* ---- actions ----------------------------------------------------------- */
  var actions = {
    /* session */
    login: function (role, org, user) {
      set(function (s) {
        s.session = {
          role: role,
          org: org || "MERCY",
          user: user || "dr.chen",
          name: s.me.name
        };
        s.ui.nav = "dashboard";
        s.ui.notifOpen = false;
        pushAudit(s, {
          action: "login",
          resource: "session",
          risk: "low"
        });
        return s;
      });
    },
    logout: function () {
      set(function (s) {
        pushAudit(s, {
          action: "logout",
          resource: "session",
          risk: "low"
        });
        s.session = null;
        s.ui.notifOpen = false;
        return s;
      });
    },
    setNav: function (nav) {
      set(function (s) {
        s.ui.nav = nav;
        s.ui.notifOpen = false;
        return s;
      });
    },
    setRole: function (role) {
      set(function (s) {
        s.session = Object.assign({}, s.session, {
          role: role
        });
        s.ui.nav = "dashboard";
        s.ui.notifOpen = false;
        return s;
      });
    },
    toggleNotif: function (open) {
      set(function (s) {
        s.ui.notifOpen = open == null ? !s.ui.notifOpen : open;
        if (s.ui.notifOpen) s.notifications = s.notifications.map(function (n) {
          return Object.assign({}, n, {
            read: true
          });
        });
        return s;
      });
    },
    toggleRealtime: function (on) {
      set(function (s) {
        s.ui.realtime = on == null ? !s.ui.realtime : on;
        return s;
      });
    },
    toggleOnShift: function () {
      set(function (s) {
        s.ui.onShift = !s.ui.onShift;
        return s;
      });
    },
    markNotifRead: function (id) {
      set(function (s) {
        s.notifications = s.notifications.map(function (n) {
          return n.id === id ? Object.assign({}, n, {
            read: true
          }) : n;
        });
        return s;
      });
    },
    /* hospitalist */
    accept: function (id) {
      set(function (s) {
        var p = s.pending.find(function (x) {
          return x.id === id;
        });
        if (!p) return s;
        s.pending = s.pending.filter(function (x) {
          return x.id !== id;
        });
        s.myPatients = [{
          id: "n" + id,
          initials: p.initials,
          room: p.room,
          complaint: p.complaint
        }].concat(s.myPatients);
        s.acceptedToday = (s.acceptedToday || 0) + 1;
        // reflect on the board
        var bd = s.board.find(function (b) {
          return b.initials === p.initials;
        });
        if (bd) {
          bd.status = "admitted";
          bd.attending = {
            name: s.me.name,
            avatar: s.me.avatar
          };
        } else s.board = [{
          id: uid("b"),
          initials: p.initials,
          room: p.room,
          dept: "MED",
          issue: p.complaint,
          status: "admitted",
          attending: {
            name: s.me.name,
            avatar: s.me.avatar
          },
          unit: s.team.filter(function (m) {
            return m.onCall;
          }).map(function (m) {
            return {
              avatar: m.avatar,
              role: m.role
            };
          }),
          consultants: [],
          er: {
            name: p.from.replace(" (ER)", ""),
            avatar: "Er"
          }
        }].concat(s.board);
        pushAudit(s, {
          action: "accept_assignment",
          resource: "assignment " + id,
          risk: "low"
        });
        pushPhi(s, {
          patient: p.initials,
          access: "view",
          fields: "initials, room, issue",
          purpose: "Assignment accept"
        });
        s.__toast = {
          tone: "accepted",
          title: "Assignment accepted",
          msg: "Patient " + p.initials + " added to your census."
        };
        return s;
      });
    },
    decline: function (id) {
      set(function (s) {
        var p = s.pending.find(function (x) {
          return x.id === id;
        });
        if (!p) return s;
        s.pending = s.pending.filter(function (x) {
          return x.id !== id;
        });
        pushAudit(s, {
          action: "decline_assignment",
          resource: "assignment " + id,
          risk: "low"
        });
        s.__toast = {
          tone: "rejected",
          title: "Declined — re-routing",
          msg: "Patient " + p.initials + " sent to the next provider."
        };
        return s;
      });
    },
    /* ER */
    sendAssignment: function (provider, fields, consults) {
      set(function (s) {
        var entry = {
          id: uid("s"),
          initials: fields.initials,
          provider: provider.name,
          complaint: fields.complaint,
          consultants: consults || [],
          time: "Today · " + clockLabel(),
          day: "Today",
          status: "sent"
        };
        s.sent = [entry].concat(s.sent);
        // create a board row (routing) + a pending request for the receiving hospitalist view
        s.board = [{
          id: uid("b"),
          initials: fields.initials,
          room: fields.room || "—",
          dept: "MED",
          issue: fields.complaint || "—",
          status: "pending",
          attending: {
            name: "",
            avatar: ""
          },
          unit: [],
          consultants: consults || [],
          er: {
            name: s.me.name,
            avatar: "Er"
          }
        }].concat(s.board);
        s.pending = s.pending.concat([{
          id: uid("a"),
          initials: fields.initials,
          room: fields.room || "—",
          complaint: fields.complaint || "—",
          from: "You (ER)",
          specialty: fields.specialty || "General Medicine",
          via: provider.id === (nextUp() || {}).id ? "Round-robin" : "Manual",
          expiresAt: now() + s.settings.timeout * 60000
        }]);
        s.lastAdmitAt = now();
        pushAudit(s, {
          action: "create_assignment",
          resource: "assignment " + entry.id,
          risk: "low"
        });
        pushPhi(s, {
          patient: fields.initials,
          access: "view",
          fields: "initials, room, issue",
          purpose: "Admission intake"
        });
        var extra = consults && consults.length ? " + " + consults.length + " consult" + (consults.length > 1 ? "s" : "") + " · push + SMS fallback." : " Notified by push and SMS fallback.";
        s.__toast = {
          tone: "sent",
          title: "Assignment sent to " + provider.name,
          msg: extra.trim()
        };
        return s;
      });
    },
    reassignSent: function (id, name) {
      set(function (s) {
        s.sent = s.sent.map(function (x) {
          return x.id === id ? Object.assign({}, x, {
            provider: name,
            status: "sent"
          }) : x;
        });
        pushAudit(s, {
          action: "reassign_patient",
          resource: "assignment " + id,
          risk: "medium"
        });
        s.__toast = {
          tone: "sent",
          title: "Reassigned to " + name,
          msg: "Previous provider notified of the hand-off change."
        };
        return s;
      });
    },
    /* director — provider mgmt */
    toggleWorking: function (id) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          return p.id === id ? Object.assign({}, p, {
            working: !p.working
          }) : p;
        });
        return s;
      });
    },
    adjustCensus: function (id, d) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          return p.id === id ? Object.assign({}, p, {
            census: Math.max(0, Math.min(p.cap, p.census + d))
          }) : p;
        });
        return s;
      });
    },
    adjustCap: function (id, d) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          return p.id === id ? Object.assign({}, p, {
            cap: Math.max(1, p.cap + d)
          }) : p;
        });
        return s;
      });
    },
    bulkWorking: function (on) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          return Object.assign({}, p, {
            working: on
          });
        });
        return s;
      });
    },
    setAllCap: function (n) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          return Object.assign({}, p, {
            cap: n,
            census: Math.min(p.census, n)
          });
        });
        s.__toast = {
          tone: "accepted",
          title: "Cap applied",
          msg: "Daily census limit set to " + n + " for all providers."
        };
        return s;
      });
    },
    toggleRotation: function (id) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          return p.id === id ? Object.assign({}, p, {
            inRotation: !p.inRotation
          }) : p;
        });
        return s;
      });
    },
    setShiftFor: function (id, sid) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          return p.id === id ? Object.assign({}, p, {
            shift: sid
          }) : p;
        });
        return s;
      });
    },
    updateShift: function (sid, patch) {
      set(function (s) {
        s.shifts = s.shifts.map(function (x) {
          return x.id === sid ? Object.assign({}, x, patch) : x;
        });
        return s;
      });
    },
    reorderProviders: function (dragId, targetId) {
      set(function (s) {
        var a = s.providers.slice();
        var from = a.findIndex(function (p) {
            return p.id === dragId;
          }),
          to = a.findIndex(function (p) {
            return p.id === targetId;
          });
        if (from < 0 || to < 0 || from === to) return s;
        var m = a.splice(from, 1)[0];
        a.splice(to, 0, m);
        s.providers = a;
        return s;
      });
    },
    addProvider: function (data) {
      set(function (s) {
        var name = data.name.trim();
        if (!name) return s;
        var fmt = /,|PA|NP|RN/.test(name) ? name : /^Dr\.?/i.test(name) ? name : "Dr. " + name;
        s.providers = s.providers.concat([{
          id: uid("h"),
          name: fmt,
          avatar: initialsOf(fmt),
          specialty: data.specialty || "Hospital Medicine",
          census: 0,
          cap: parseInt(data.cap, 10) || 12,
          working: true,
          shift: data.shift || "day",
          inRotation: true
        }]);
        pushAudit(s, {
          action: "create_provider",
          resource: fmt,
          risk: "low"
        });
        s.__toast = {
          tone: "accepted",
          title: "Provider added",
          msg: fmt + " added to " + (s.shifts.find(function (x) {
            return x.id === (data.shift || "day");
          }) || {}).label + "."
        };
        return s;
      });
    },
    updateProvider: function (id, patch) {
      set(function (s) {
        s.providers = s.providers.map(function (p) {
          if (p.id !== id) return p;
          var np = Object.assign({}, p, patch);
          if (patch.name != null) np.avatar = initialsOf(patch.name) || p.avatar;
          return np;
        });
        if (patch.name != null) pushAudit(s, {
          action: "rename_provider",
          resource: id,
          risk: "low"
        });
        return s;
      });
    },
    removeProvider: function (id) {
      set(function (s) {
        var p = s.providers.find(function (x) {
          return x.id === id;
        });
        s.providers = s.providers.filter(function (x) {
          return x.id !== id;
        });
        if (p) {
          pushAudit(s, {
            action: "remove_provider",
            resource: p.name,
            risk: "medium"
          });
          s.__toast = {
            tone: "rejected",
            title: "Provider removed",
            msg: p.name + " removed from the group."
          };
        }
        return s;
      });
    },
    renameShift: function (sid, label) {
      set(function (s) {
        s.shifts = s.shifts.map(function (x) {
          return x.id === sid ? Object.assign({}, x, {
            label: label
          }) : x;
        });
        return s;
      });
    },
    resetRotation: function () {
      set(function (s) {
        s.rotationCursor = 0;
        pushAudit(s, {
          action: "reset_rotation_index",
          resource: "rotation",
          risk: "low"
        });
        s.__toast = {
          tone: "accepted",
          title: "Rotation index reset",
          msg: "Round-robin will start from the top."
        };
        return s;
      });
    },
    /* ER director — ER physician staffing + diversion */
    toggleErPhysician: function (id) {
      set(function (s) {
        s.erPhysicians = s.erPhysicians.map(function (p) {
          return p.id === id ? Object.assign({}, p, {
            working: !p.working
          }) : p;
        });
        return s;
      });
    },
    updateErPhysician: function (id, patch) {
      set(function (s) {
        s.erPhysicians = s.erPhysicians.map(function (p) {
          return p.id === id ? Object.assign({}, p, patch) : p;
        });
        if (patch.name != null) pushAudit(s, {
          action: "rename_er_physician",
          resource: id,
          risk: "low"
        });
        return s;
      });
    },
    setErShift: function (id, sid) {
      set(function (s) {
        s.erPhysicians = s.erPhysicians.map(function (p) {
          return p.id === id ? Object.assign({}, p, {
            shift: sid
          }) : p;
        });
        return s;
      });
    },
    addErPhysician: function (data) {
      set(function (s) {
        var name = data.name && data.name.trim();
        if (!name) {
          s.__toast = {
            tone: "rejected",
            title: "Name required",
            msg: "Enter the physician's name."
          };
          return s;
        }
        var fmt = /^Dr\.?/i.test(name) ? name : "Dr. " + name;
        s.erPhysicians = s.erPhysicians.concat([{
          id: uid("e"),
          name: fmt,
          avatar: initialsOf(fmt),
          working: true,
          shift: data.shift || "day",
          admitsToday: 0
        }]);
        pushAudit(s, {
          action: "create_er_physician",
          resource: fmt,
          risk: "low"
        });
        s.__toast = {
          tone: "accepted",
          title: "ER physician added",
          msg: fmt + " added to the ER roster."
        };
        return s;
      });
    },
    removeErPhysician: function (id) {
      set(function (s) {
        var p = s.erPhysicians.find(function (x) {
          return x.id === id;
        });
        s.erPhysicians = s.erPhysicians.filter(function (x) {
          return x.id !== id;
        });
        if (p) {
          pushAudit(s, {
            action: "remove_er_physician",
            resource: p.name,
            risk: "medium"
          });
          s.__toast = {
            tone: "rejected",
            title: "Removed",
            msg: p.name + " removed from the ER roster."
          };
        }
        return s;
      });
    },
    toggleDiversion: function () {
      set(function (s) {
        s.diversion = !s.diversion;
        pushAudit(s, {
          action: s.diversion ? "declare_diversion" : "lift_diversion",
          resource: s.selectedOrg || "ER",
          risk: s.diversion ? "high" : "low"
        });
        s.broadcasts = [{
          id: uid("bc"),
          title: s.diversion ? "ER on diversion — divert incoming ambulances" : "Diversion lifted — accepting transfers",
          sev: s.diversion ? "critical" : "info",
          at: now(),
          acked: 0,
          total: s.diversion ? 18 : 0,
          ackReq: s.diversion
        }].concat(s.broadcasts);
        s.__toast = {
          tone: s.diversion ? "rejected" : "accepted",
          title: s.diversion ? "Diversion declared" : "Diversion lifted",
          msg: s.diversion ? "EMS notified; broadcast sent to all providers." : "Now accepting incoming transfers."
        };
        return s;
      });
    },
    /* org + board editing */
    updateOrg: function (code, patch) {
      set(function (s) {
        s.orgs = s.orgs.map(function (o) {
          return o.code === code ? Object.assign({}, o, patch) : o;
        });
        if (patch.code && patch.code !== code) {
          if (s.selectedOrg === code) s.selectedOrg = patch.code;
        }
        pushAudit(s, {
          action: "update_organization",
          resource: code,
          risk: "medium"
        });
        return s;
      });
    },
    updateShiftType: function (id, patch) {
      set(function (s) {
        s.settings = Object.assign({}, s.settings, {
          shiftTypes: s.settings.shiftTypes.map(function (x) {
            return x.id === id ? Object.assign({}, x, patch) : x;
          })
        });
        return s;
      });
    },
    removeShiftType: function (id) {
      set(function (s) {
        s.settings = Object.assign({}, s.settings, {
          shiftTypes: s.settings.shiftTypes.filter(function (x) {
            return x.id !== id;
          })
        });
        return s;
      });
    },
    updateBoardRow: function (id, patch) {
      set(function (s) {
        s.board = s.board.map(function (b) {
          return b.id === id ? Object.assign({}, b, patch) : b;
        });
        pushAudit(s, {
          action: "edit_admission",
          resource: id,
          risk: "low"
        });
        return s;
      });
    },
    addBoardPatient: function (data) {
      set(function (s) {
        var init = (data.initials || "").toUpperCase().slice(0, 3);
        if (!init) {
          s.__toast = {
            tone: "rejected",
            title: "Initials required",
            msg: "Enter the patient's initials."
          };
          return s;
        }
        var pr = data.attending ? s.providers.find(function (p) {
          return p.name === data.attending;
        }) : null;
        var row = {
          id: uid("b"),
          initials: init,
          room: data.room || "—",
          dept: data.dept || "MED",
          issue: data.issue || "—",
          status: data.attending ? "admitted" : "pending",
          attending: data.attending ? {
            name: data.attending,
            avatar: pr ? pr.avatar : initialsOf(data.attending)
          } : {
            name: "",
            avatar: ""
          },
          unit: [],
          consultants: data.consultants || [],
          er: {
            name: data.er || actorName(s),
            avatar: "Er"
          }
        };
        s.board = [row].concat(s.board);
        pushAudit(s, {
          action: "create_admission",
          resource: "patient " + init,
          risk: "low"
        });
        pushPhi(s, {
          patient: init,
          access: "create",
          fields: "initials, room, issue",
          purpose: "Manual admission"
        });
        s.__toast = {
          tone: "accepted",
          title: "Admission added",
          msg: "Patient " + init + (data.attending ? " admitted to " + data.attending + "." : " queued for acceptance.")
        };
        return s;
      });
    },
    removeBoardPatient: function (id) {
      set(function (s) {
        var b = s.board.find(function (x) {
          return x.id === id;
        });
        s.board = s.board.filter(function (x) {
          return x.id !== id;
        });
        if (b) {
          pushAudit(s, {
            action: "remove_admission",
            resource: "patient " + b.initials,
            risk: "medium"
          });
          s.__toast = {
            tone: "rejected",
            title: "Admission removed",
            msg: "Patient " + b.initials + " removed from the board."
          };
        }
        return s;
      });
    },
    connectFhir: function () {
      set(function (s) {
        s.fhir = Object.assign({}, s.fhir, {
          connected: true,
          lastSync: now()
        });
        // simulate a sync pulling two admissions from the EHR
        var pull = [{
          id: uid("b"),
          initials: "EHR1",
          room: "514",
          dept: "MED",
          issue: "Cellulitis, IV antibiotics",
          status: "admitted",
          attending: {
            name: "Dr. Amir Patel",
            avatar: "AP"
          },
          unit: [],
          consultants: ["Infectious Disease"],
          er: {
            name: "Epic FHIR",
            avatar: "FH"
          },
          synced: true
        }, {
          id: uid("b"),
          initials: "EHR2",
          room: "230",
          dept: "ICU",
          issue: "Respiratory failure, intubated",
          status: "observation",
          attending: {
            name: "Dr. Maria Lopez",
            avatar: "ML"
          },
          unit: [{
            avatar: "PS",
            role: "NP"
          }],
          consultants: ["Pulmonology"],
          er: {
            name: "Epic FHIR",
            avatar: "FH"
          },
          synced: true
        }].filter(function (n) {
          return !s.board.some(function (b) {
            return b.initials === n.initials;
          });
        });
        s.board = pull.concat(s.board);
        pushAudit(s, {
          action: "connect_fhir",
          resource: s.fhir.source,
          risk: "medium"
        });
        s.__toast = {
          tone: "accepted",
          title: "Connected to " + s.fhir.source,
          msg: "Census is now syncing from the EHR (" + pull.length + " pulled)."
        };
        return s;
      });
    },
    disconnectFhir: function () {
      set(function (s) {
        s.fhir = Object.assign({}, s.fhir, {
          connected: false
        });
        pushAudit(s, {
          action: "disconnect_fhir",
          resource: s.fhir.source,
          risk: "low"
        });
        s.__toast = {
          tone: "rejected",
          title: "EHR disconnected",
          msg: "Switched to manual census entry."
        };
        return s;
      });
    },
    syncFhir: function () {
      set(function (s) {
        s.fhir = Object.assign({}, s.fhir, {
          lastSync: now()
        });
        s.__toast = {
          tone: "accepted",
          title: "Census synced",
          msg: "Pulled the latest admissions from " + s.fhir.source + "."
        };
        return s;
      });
    },
    reassignBoard: function (id, providerName) {
      set(function (s) {
        var pr = s.providers.find(function (p) {
          return p.name === providerName;
        });
        s.board = s.board.map(function (b) {
          return b.id === id ? Object.assign({}, b, {
            attending: {
              name: providerName,
              avatar: pr ? pr.avatar : initialsOf(providerName)
            },
            status: b.status === "pending" ? "admitted" : b.status
          }) : b;
        });
        pushAudit(s, {
          action: "reassign_patient",
          resource: id + " → " + providerName,
          risk: "medium"
        });
        s.__toast = {
          tone: "sent",
          title: "Reassigned to " + providerName,
          msg: "Board updated; previous owner notified."
        };
        return s;
      });
    },
    renameMe: function (name) {
      set(function (s) {
        if (!name.trim()) return s;
        s.me = Object.assign({}, s.me, {
          name: name,
          avatar: initialsOf(name)
        });
        if (s.session) s.session = Object.assign({}, s.session, {
          name: name
        });
        return s;
      });
    },
    /* care team */
    addMember: function (id) {
      set(function (s) {
        var c = s.candidates.find(function (x) {
          return x.id === id;
        });
        if (!c) return s;
        s.team = s.team.concat([Object.assign({}, c, {
          onCall: true
        })]);
        s.__toast = {
          tone: "accepted",
          title: c.name + " added to your unit",
          msg: "They now share your requests and threads."
        };
        return s;
      });
    },
    removeMember: function (id) {
      set(function (s) {
        s.team = s.team.filter(function (m) {
          return m.id !== id;
        });
        return s;
      });
    },
    toggleMemberCall: function (id) {
      set(function (s) {
        s.team = s.team.map(function (m) {
          return m.id === id ? Object.assign({}, m, {
            onCall: !m.onCall
          }) : m;
        });
        return s;
      });
    },
    /* messaging */
    openConversation: function (id) {
      set(function (s) {
        s.conversations = s.conversations.map(function (c) {
          return c.id === id ? Object.assign({}, c, {
            unread: 0
          }) : c;
        });
        s.__activeConvo = id;
        return s;
      });
    },
    sendMessage: function (id, text) {
      if (!text || !text.trim()) return;
      set(function (s) {
        s.conversations = s.conversations.map(function (c) {
          if (c.id !== id) return c;
          return Object.assign({}, c, {
            messages: c.messages.concat([{
              me: true,
              text: text.trim(),
              at: now()
            }]),
            unread: 0
          });
        });
        pushAudit(s, {
          action: "send_message",
          resource: "conversation " + id,
          risk: "low"
        });
        return s;
      });
      // simulated reply + typing
      var convo = state.conversations.find(function (c) {
        return c.id === id;
      });
      if (convo && !convo.broadcast) {
        set(function (s) {
          s.conversations = s.conversations.map(function (c) {
            return c.id === id ? Object.assign({}, c, {
              typing: true
            }) : c;
          });
          return s;
        });
        setTimeout(function () {
          set(function (s) {
            s.conversations = s.conversations.map(function (c) {
              if (c.id !== id) return c;
              s2reply = REPLIES[Math.floor(Math.random() * REPLIES.length)];
              return Object.assign({}, c, {
                typing: false,
                messages: c.messages.concat([{
                  me: false,
                  text: s2reply,
                  at: now(),
                  read: false
                }])
              });
            });
            return s;
          });
        }, 1800 + Math.random() * 1400);
      }
    },
    startConversation: function (participant) {
      set(function (s) {
        var existing = s.conversations.find(function (c) {
          return c.name === participant.name;
        });
        if (existing) {
          s.__activeConvo = existing.id;
          s.conversations = s.conversations.map(function (c) {
            return c.id === existing.id ? Object.assign({}, c, {
              unread: 0
            }) : c;
          });
          return s;
        }
        var id = uid("cv");
        s.conversations = [{
          id: id,
          name: participant.name,
          role: participant.specialty || participant.role || "Provider",
          initials: participant.avatar || initialsOf(participant.name),
          presence: participant.working === false ? "offline" : "online",
          tint: participant.tint || "blue",
          unread: 0,
          typing: false,
          messages: []
        }].concat(s.conversations);
        s.__activeConvo = id;
        return s;
      });
    },
    /* broadcasts */
    sendBroadcast: function (data) {
      set(function (s) {
        var total = data.ackReq ? 10 + Math.floor(Math.random() * 14) : 0;
        s.broadcasts = [{
          id: uid("bc"),
          title: data.title || "(untitled broadcast)",
          sev: data.severity,
          at: now(),
          acked: 0,
          total: total,
          ackReq: data.ackReq
        }].concat(s.broadcasts);
        pushAudit(s, {
          action: "send_broadcast",
          resource: data.title || "broadcast",
          risk: data.severity === "emergency" || data.severity === "critical" ? "high" : "low"
        });
        s.__toast = {
          tone: "sent",
          title: "Broadcast sent",
          msg: data.audience.length + " audience group(s) notified" + (data.ackReq ? " · ack required" : "") + "."
        };
        return s;
      });
    },
    /* developer */
    selectOrg: function (code) {
      set(function (s) {
        s.selectedOrg = code;
        return s;
      });
    },
    addTenant: function (data) {
      set(function (s) {
        var code = (data.code || data.name.slice(0, 5)).toUpperCase().replace(/[^A-Z]/g, "");
        if (!data.name.trim() || !code) {
          s.__toast = {
            tone: "rejected",
            title: "Name & code required",
            msg: "Enter a hospital name and short code."
          };
          return s;
        }
        s.orgs = s.orgs.concat([{
          code: code,
          name: data.name,
          timezone: data.timezone || "America/New_York",
          users: 1,
          assignments: 0,
          active: true
        }]);
        pushAudit(s, {
          action: "create_organization",
          resource: code,
          risk: "high"
        });
        s.__toast = {
          tone: "accepted",
          title: "Tenant created",
          msg: data.name + " (" + code + ") provisioned."
        };
        return s;
      });
    },
    toggleTenant: function (code) {
      set(function (s) {
        s.orgs = s.orgs.map(function (o) {
          return o.code === code ? Object.assign({}, o, {
            active: !o.active
          }) : o;
        });
        return s;
      });
    },
    addUser: function (form) {
      set(function (s) {
        if (!form.name.trim()) {
          s.__toast = {
            tone: "rejected",
            title: "Name required",
            msg: "Enter the user's full name."
          };
          return s;
        }
        var isRoot = form.role === "developer" && form.scope === "root";
        var org = isRoot ? "*" : form.org;
        s.devUsers = [{
          id: uid("u"),
          name: form.name,
          role: form.role,
          org: org,
          specialty: form.role === "hospitalist" ? form.specialty : "",
          scope: form.role === "developer" ? form.scope || "local" : undefined
        }].concat(s.devUsers);
        if (!isRoot) s.orgs = s.orgs.map(function (o) {
          return o.code === form.org ? Object.assign({}, o, {
            users: o.users + 1
          }) : o;
        });
        pushAudit(s, {
          action: "create_user",
          resource: form.name + " @ " + (isRoot ? "ALL ORGS" : form.org),
          risk: isRoot ? "high" : "medium"
        });
        var label = {
          hospitalist: "Hospitalist",
          er_doctor: "ER physician",
          er_director: "ER director",
          director: "Director",
          developer: isRoot ? "Root developer" : "Local developer"
        }[form.role];
        s.__toast = {
          tone: "accepted",
          title: label + " created",
          msg: form.name + " added to " + (isRoot ? "all organizations" : form.org) + "."
        };
        return s;
      });
    },
    removeUser: function (id) {
      set(function (s) {
        var u = s.devUsers.find(function (x) {
          return x.id === id;
        });
        s.devUsers = s.devUsers.filter(function (x) {
          return x.id !== id;
        });
        if (u && u.org !== "*") s.orgs = s.orgs.map(function (o) {
          return o.code === u.org ? Object.assign({}, o, {
            users: Math.max(0, o.users - 1)
          }) : o;
        });
        if (u) {
          pushAudit(s, {
            action: "remove_user",
            resource: u.name,
            risk: "medium"
          });
          s.__toast = {
            tone: "rejected",
            title: "User removed",
            msg: u.name + " removed."
          };
        }
        return s;
      });
    },
    setRoleColor: function (role, color) {
      set(function (s) {
        s.roleColors = Object.assign({}, s.roleColors, function () {
          var o = {};
          o[role] = color;
          return o;
        }());
        pushAudit(s, {
          action: "customize_role_color",
          resource: role,
          risk: "low"
        });
        return s;
      });
    },
    runDiagnostics: function () {
      set(function (s) {
        var insights = ["STJUDE assignment expiry rate up 18% this shift — likely the delayed Twilio queue. Suggest enabling push-first fallback.", "MAYO round-robin fairness within 4% across providers — no cap relief triggered in the last 24h.", "CLEVE WebSocket reconnect rate normal; 0 dropped events in the last hour.", "Cross-tenant isolation checks: 0 violations. 1 attempt blocked and logged (STJUDE → MAYO)."];
        s.diagnostics = {
          text: insights[Math.floor(Math.random() * insights.length)],
          at: now()
        };
        pushAudit(s, {
          action: "run_ai_diagnostics",
          resource: "platform",
          risk: "low"
        });
        return s;
      });
    },
    /* org settings */
    setSetting: function (key, val) {
      set(function (s) {
        s.settings = Object.assign({}, s.settings, function () {
          var o = {};
          o[key] = val;
          return o;
        }());
        return s;
      });
    },
    toggleFlag: function (key) {
      set(function (s) {
        s.settings = Object.assign({}, s.settings, {
          flags: Object.assign({}, s.settings.flags, function () {
            var o = {};
            o[key] = !s.settings.flags[key];
            return o;
          }())
        });
        pushAudit(s, {
          action: "toggle_feature_flag",
          resource: key,
          risk: "low"
        });
        return s;
      });
    },
    toggleIntegration: function (key) {
      set(function (s) {
        s.settings = Object.assign({}, s.settings, {
          integrations: Object.assign({}, s.settings.integrations, function () {
            var o = {};
            o[key] = !s.settings.integrations[key];
            return o;
          }())
        });
        pushAudit(s, {
          action: "toggle_integration",
          resource: key,
          risk: "medium"
        });
        s.__toast = {
          tone: "accepted",
          title: s.settings.integrations[key] ? "Connected" : "Disconnected",
          msg: key + " integration updated."
        };
        return s;
      });
    },
    addShiftType: function () {
      set(function (s) {
        var n = s.settings.shiftTypes.length + 1;
        s.settings.shiftTypes = s.settings.shiftTypes.concat([{
          id: uid("st"),
          name: "Custom shift " + n,
          time: "08:00–20:00",
          color: "var(--primary)"
        }]);
        return s;
      });
    },
    resolveIncident: function (id) {
      set(function (s) {
        s.incidents = s.incidents.map(function (i) {
          return i.id === id ? Object.assign({}, i, {
            status: "resolved"
          }) : i;
        });
        pushAudit(s, {
          action: "resolve_incident",
          resource: id,
          risk: "low"
        });
        return s;
      });
    },
    /* toast lifecycle */
    toast: function (t) {
      set(function (s) {
        s.__toast = t;
        return s;
      });
    },
    clearToast: function () {
      set(function (s) {
        s.__toast = null;
        return s;
      });
    },
    /* role management */
    createRole: function (data) {
      set(function (s) {
        if (!data.name || !data.name.trim()) {
          s.__toast = {
            tone: "rejected",
            title: "Role name required",
            msg: "Give the role a name."
          };
          return s;
        }
        s.roles = s.roles.concat([{
          id: uid("r"),
          name: data.name.trim(),
          desc: (data.desc || "").trim(),
          system: false,
          portals: data.portals || [],
          perms: data.perms || [],
          features: data.features || [],
          users: 0
        }]);
        pushAudit(s, {
          action: "create_role",
          resource: data.name.trim(),
          risk: "medium"
        });
        s.__toast = {
          tone: "accepted",
          title: "Role created",
          msg: data.name.trim() + " is ready to assign."
        };
        return s;
      });
    },
    updateRole: function (id, patch) {
      set(function (s) {
        s.roles = s.roles.map(function (r) {
          return r.id === id ? Object.assign({}, r, patch) : r;
        });
        pushAudit(s, {
          action: "update_role",
          resource: id,
          risk: "medium"
        });
        return s;
      });
    },
    deleteRole: function (id) {
      set(function (s) {
        var r = s.roles.find(function (x) {
          return x.id === id;
        });
        if (r && r.system) {
          s.__toast = {
            tone: "rejected",
            title: "Protected role",
            msg: "Built-in roles can't be deleted."
          };
          return s;
        }
        s.roles = s.roles.filter(function (x) {
          return x.id !== id;
        });
        if (r) {
          pushAudit(s, {
            action: "delete_role",
            resource: r.name,
            risk: "high"
          });
          s.__toast = {
            tone: "rejected",
            title: "Role deleted",
            msg: r.name + " removed."
          };
        }
        return s;
      });
    },
    /* appearance & layout customization */
    setTheme: function (patch) {
      set(function (s) {
        s.theme = Object.assign({}, s.theme, patch);
        pushAudit(s, {
          action: "update_appearance",
          resource: Object.keys(patch).join(","),
          risk: "low"
        });
        return s;
      });
    },
    toggleNavItem: function (role, id) {
      set(function (s) {
        if (id === "dashboard") return s; // home is always present
        var hidden = (s.navHidden[role] || []).slice();
        var i = hidden.indexOf(id);
        if (i >= 0) hidden.splice(i, 1);else hidden.push(id);
        s.navHidden = Object.assign({}, s.navHidden, function () {
          var o = {};
          o[role] = hidden;
          return o;
        }());
        return s;
      });
    },
    moveNavItem: function (role, ids, id, dir) {
      set(function (s) {
        var arr = ids.slice();
        var from = arr.indexOf(id),
          to = from + dir;
        if (from < 0 || to < 0 || to >= arr.length) return s;
        var m = arr.splice(from, 1)[0];
        arr.splice(to, 0, m);
        s.navOrder = Object.assign({}, s.navOrder, function () {
          var o = {};
          o[role] = arr;
          return o;
        }());
        return s;
      });
    },
    resetLayout: function (role) {
      set(function (s) {
        s.theme = {
          appName: "DocTurn",
          accent: "#2563EB",
          radius: 8,
          sidebar: "expanded",
          contentWidth: "standard"
        };
        s.navHidden = Object.assign({}, s.navHidden, function () {
          var o = {};
          o[role] = [];
          return o;
        }());
        s.navOrder = Object.assign({}, s.navOrder, function () {
          var o = {};
          o[role] = null;
          return o;
        }());
        s.__toast = {
          tone: "accepted",
          title: "Layout reset",
          msg: "Appearance and navigation restored to defaults."
        };
        return s;
      });
    },
    /* danger zone */
    resetAll: function () {
      state = seed();
      persist();
      emit();
    }
  };
  var REPLIES = ["Copy — on it.", "Thanks for the heads up.", "Accepting now.", "Give me 5 minutes.", "Got it, will round shortly.", "Understood. I'll update the chart.", "On my way up."];
  var s2reply;

  /* ---- React hooks ------------------------------------------------------- */
  function useStore() {
    var R = window.React;
    return R.useSyncExternalStore(subscribe, getState, getState);
  }
  function useClock() {
    var R = window.React;
    var sub = R.useCallback(function (cb) {
      return subscribeClock(cb);
    }, []);
    return R.useSyncExternalStore(sub, function () {
      return Math.floor(Date.now() / 1000);
    });
  }

  /* ---- expose ------------------------------------------------------------ */
  window.DT = {
    getState: getState,
    subscribe: subscribe,
    actions: actions,
    sortedProviders: sortedProviders,
    rotationList: rotationList,
    nextUp: nextUp,
    unreadMessages: unreadMessages,
    unreadNotifs: unreadNotifs,
    extractIntake: extractIntake
  };
  window.useStore = useStore;
  window.useActions = function () {
    return actions;
  };
  window.useClock = useClock;
  window.dtFmt = {
    mmss: mmss,
    ago: ago,
    hhmm: hhmm,
    clockLabel: clockLabel,
    initialsOf: initialsOf
  };
  window.extractIntake = extractIntake;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/store.js", error: String((e && e.message) || e) }); }

})();
