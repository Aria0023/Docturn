/* DocTurn web-app UI kit — shared primitives.
   Exports components to window for cross-file (Babel) access. */

function Icon({ name, size = 16, color, strokeWidth = 2, style, className }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = `<i data-lucide="${name}"></i>`;
    window.lucide.createIcons({ attrs: { width: size, height: size, "stroke-width": strokeWidth }, root: host });
  }, [name, size, strokeWidth]);
  return <span ref={ref} className={className} style={{ display: "inline-flex", alignItems: "center", color, flex: "none", ...style }} />;
}

function Button({ variant = "default", size = "default", icon, children, onClick, type, full, style }) {
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    fontFamily: "var(--font-sans)", fontWeight: 500, borderRadius: "var(--radius-md)",
    border: "1px solid transparent", cursor: "pointer", whiteSpace: "nowrap",
    transition: "background .15s ease, box-shadow .15s ease, opacity .15s ease",
    width: full ? "100%" : "auto",
  };
  const sizes = {
    sm: { height: 36, padding: "0 12px", fontSize: 13 },
    default: { height: 40, padding: "0 16px", fontSize: 14 },
    lg: { height: 44, padding: "0 32px", fontSize: 15 },
    icon: { height: 40, width: 40, padding: 0 },
  };
  const variants = {
    default: { background: "var(--primary)", color: "#fff", boxShadow: "var(--shadow-sm)" },
    destructive: { background: "var(--destructive)", color: "#fff" },
    outline: { background: "#fff", borderColor: "var(--border)", color: "var(--foreground)" },
    secondary: { background: "var(--secondary)", color: "var(--foreground)" },
    ghost: { background: "transparent", color: "var(--foreground)" },
    link: { background: "transparent", color: "var(--primary)", textDecoration: "underline", height: "auto", padding: 0 },
  };
  return (
    <button type={type || "button"} onClick={onClick}
      onMouseEnter={(e) => { if (variant === "ghost" || variant === "secondary") e.currentTarget.style.background = "var(--secondary)"; if (variant === "default") e.currentTarget.style.boxShadow = "var(--shadow-md)"; if (variant === "outline") e.currentTarget.style.background = "var(--secondary)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = variants[variant].background; if (variant === "default") e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {icon && <Icon name={icon} size={size === "lg" ? 18 : 16} />}
      {children}
    </button>
  );
}

const STATUS = {
  pending:  { label: "Pending",  bg: "var(--status-pending-bg)",  fg: "var(--status-pending)",  icon: "clock" },
  accepted: { label: "Accepted", bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)", icon: "check" },
  online:   { label: "Online",   bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)", icon: "circle" },
  sent:     { label: "Sent",     bg: "var(--status-active-bg)",   fg: "var(--status-active)",   icon: "send" },
  active:   { label: "Active",   bg: "var(--status-active-bg)",   fg: "var(--status-active)",   icon: "activity" },
  rejected: { label: "Rejected", bg: "var(--status-rejected-bg)", fg: "var(--status-rejected)", icon: "x" },
  declined: { label: "Declined", bg: "var(--status-rejected-bg)", fg: "var(--status-rejected)", icon: "x" },
  rerouted: { label: "Re-routed", bg: "var(--status-pending-bg)", fg: "var(--status-pending)", icon: "repeat" },
  expired:  { label: "Expired",  bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral)",  icon: "minus" },
  offline:  { label: "Offline",  bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral)",  icon: "minus" },
};

function Badge({ status, variant, children, icon }) {
  const s = status ? STATUS[status] : null;
  const palette = s
    ? { background: s.bg, color: s.fg }
    : variant === "outline" ? { background: "#fff", color: "var(--foreground)", border: "1px solid var(--border)" }
    : variant === "secondary" ? { background: "var(--secondary)", color: "var(--foreground)" }
    : variant === "destructive" ? { background: "var(--destructive)", color: "#fff" }
    : { background: "var(--primary)", color: "#fff" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, lineHeight: 1.6, ...palette }}>
      {(icon || s) && <Icon name={icon || s.icon} size={11} />}
      {children || (s && s.label)}
    </span>
  );
}

function StatusDot({ status = "offline", pulse }) {
  const s = STATUS[status] || STATUS.offline;
  return (
    <span style={{ position: "relative", width: 9, height: 9, display: "inline-block", flex: "none" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "99px", background: s.fg }} />
      {pulse && <span style={{ position: "absolute", inset: 0, borderRadius: "99px", background: s.fg, animation: "dt-pulse 1.5s infinite" }} />}
    </span>
  );
}

function Avatar({ initials, size = 36, tint = "blue" }) {
  const tints = {
    blue: { bg: "#DBEAFE", fg: "var(--primary)" },
    emerald: { bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)" },
    amber: { bg: "var(--status-pending-bg)", fg: "var(--status-pending)" },
    slate: { bg: "var(--status-neutral-bg)", fg: "var(--status-neutral)" },
  };
  const t = tints[tint] || tints.blue;
  return (
    <span style={{ width: size, height: size, borderRadius: "99px", background: t.bg, color: t.fg, fontWeight: 700, fontSize: size * 0.36, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      {initials}
    </span>
  );
}

function Card({ children, style, onClick, hover }) {
  const [h, setH] = React.useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => hover && setH(true)} onMouseLeave={() => hover && setH(false)}
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
        boxShadow: h ? "var(--shadow-md)" : "var(--shadow-sm)", transition: "box-shadow .2s ease, transform .2s ease",
        transform: h ? "translateY(-1px)" : "none", cursor: onClick ? "pointer" : "default", ...style }}>
      {children}
    </div>
  );
}

function Field({ label, icon, value, onChange, placeholder, type, help, error, textarea, rows }) {
  const [focus, setFocus] = React.useState(false);
  const borderColor = error ? "var(--destructive)" : focus ? "var(--ring)" : "var(--input)";
  return (
    <div>
      {label && <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>}
      <div style={{ display: "flex", alignItems: textarea ? "flex-start" : "center", gap: 8, padding: textarea ? "10px 12px" : "0 12px", height: textarea ? "auto" : 40, border: `1px solid ${borderColor}`, borderRadius: "var(--radius-md)", background: "#fff", boxShadow: focus ? "0 0 0 2px hsl(221 83% 53% / .22)" : "none", transition: "border-color .15s, box-shadow .15s" }}>
        {icon && <Icon name={icon} size={16} color="var(--muted-foreground)" style={{ marginTop: textarea ? 2 : 0 }} />}
        {textarea
          ? <textarea value={value} onChange={(e) => onChange && onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder={placeholder} rows={rows || 3} style={{ border: "none", outline: "none", fontSize: 14, width: "100%", fontFamily: "inherit", background: "transparent", resize: "vertical", color: "var(--foreground)" }} />
          : <input type={type || "text"} value={value} onChange={(e) => onChange && onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder={placeholder} style={{ border: "none", outline: "none", fontSize: 14, width: "100%", fontFamily: "inherit", background: "transparent", color: "var(--foreground)" }} />}
      </div>
      {error ? <div style={{ fontSize: 11.5, color: "var(--destructive)", marginTop: 5, display: "flex", gap: 4, alignItems: "center" }}><Icon name="alert-circle" size={12} />{error}</div>
        : help ? <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 5 }}>{help}</div> : null}
    </div>
  );
}

function Logo({ height = 30 }) {
  return <img src="assets/docturn-wordmark.svg" alt="DocTurn" style={{ height, display: "block" }} />;
}

function Modal({ title, subtitle, icon, onClose, children, width = 460 }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "dt-toast-in .18s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-2xl, 0 24px 60px rgba(2,6,23,.28))", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
          {icon && <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "#DBEAFE", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={icon} size={18} /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 1 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function EditableText({ value, onSave, placeholder, mono, size = 14, weight = 600, color = "var(--foreground)", multiline, width }) {
  const [editing, setEditing] = React.useState(false);
  const [v, setV] = React.useState(value);
  const [hover, setHover] = React.useState(false);
  React.useEffect(() => { setV(value); }, [value]);
  const commit = () => { setEditing(false); if ((v || "").trim() !== (value || "")) onSave((v || "").trim()); };
  const cancel = () => { setEditing(false); setV(value); };
  const fontFam = mono ? "var(--font-mono, ui-monospace, monospace)" : "var(--font-sans)";
  if (editing) {
    const common = { value: v, autoFocus: true, onChange: (e) => setV(e.target.value), onBlur: commit,
      onKeyDown: (e) => { if (e.key === "Enter" && !multiline) { e.preventDefault(); commit(); } if (e.key === "Escape") cancel(); },
      style: { font: "inherit", fontSize: size, fontWeight: weight, fontFamily: fontFam, color: color, width: width || "auto", minWidth: 60,
        border: "1px solid var(--ring)", borderRadius: "var(--radius-sm)", padding: multiline ? "6px 8px" : "1px 6px", outline: "none",
        boxShadow: "0 0 0 2px hsl(221 83% 53% / .18)", background: "#fff", boxSizing: "border-box" } };
    return multiline ? <textarea rows={2} {...common} /> : <input {...common} />;
  }
  return (
    <span onClick={() => setEditing(true)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title="Click to edit"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "text", fontSize: size, fontWeight: weight, fontFamily: fontFam, color: (value || color),
        borderBottom: hover ? "1px dashed var(--muted-foreground)" : "1px dashed transparent", lineHeight: 1.3, maxWidth: "100%" }}>
      <span style={{ color: value ? color : "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: multiline ? "normal" : "nowrap" }}>{value || placeholder || "—"}</span>
      <Icon name="pencil" size={Math.max(10, size - 3)} color="var(--muted-foreground)" style={{ opacity: hover ? 0.9 : 0, flex: "none", transition: "opacity .12s" }} />
    </span>
  );
}

// ESI triage levels (1 = resuscitation … 5 = non-urgent) — colors + labels.
const ESI = {
  1: { name: "Resuscitation", bg: "#FEE2E2", fg: "#B91C1C", dot: "#DC2626" },
  2: { name: "Emergent",      bg: "#FFEDD5", fg: "#C2410C", dot: "#EA580C" },
  3: { name: "Urgent",        bg: "#FEF9C3", fg: "#A16207", dot: "#CA8A04" },
  4: { name: "Less urgent",   bg: "#DCFCE7", fg: "#15803D", dot: "#16A34A" },
  5: { name: "Non-urgent",    bg: "#DBEAFE", fg: "#1D4ED8", dot: "#2563EB" },
};
function AcuityChip({ level, showName, size }) {
  const n = Number(level);
  if (!ESI[n]) return null;
  const e = ESI[n];
  const fs = size === "sm" ? 11 : 12;
  return (
    <span title={"ESI " + n + " · " + e.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: size === "sm" ? "1px 8px" : "2px 9px", borderRadius: "var(--radius-full)", background: e.bg, color: e.fg, fontSize: fs, fontWeight: 700, whiteSpace: "nowrap", lineHeight: 1.5 }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: e.dot, flex: "none" }} />ESI {n}{showName ? " · " + e.name : ""}
    </span>
  );
}

// Per-specialty color scheme so consult services are distinguishable at a
// glance (each gets a stable color whether selected or not). Common services
// are fixed; anything else (manually-added) hashes to a palette slot.
const SPECIALTY_PALETTE = [
  { color: "#2563EB", bg: "#EFF6FF" }, // blue
  { color: "#DC2626", bg: "#FEF2F2" }, // red
  { color: "#D97706", bg: "#FFFBEB" }, // amber
  { color: "#0891B2", bg: "#ECFEFF" }, // cyan
  { color: "#7C3AED", bg: "#F5F3FF" }, // violet
  { color: "#059669", bg: "#ECFDF5" }, // emerald
  { color: "#DB2777", bg: "#FDF2F8" }, // pink
  { color: "#4F46E5", bg: "#EEF2FF" }, // indigo
  { color: "#CA8A04", bg: "#FEFCE8" }, // yellow
  { color: "#0D9488", bg: "#F0FDFA" }, // teal
];
const SPECIALTY_FIXED = {
  "hospital medicine": 0, "cardiology": 1, "gi": 2, "gastroenterology": 2, "pulmonology": 3, "pulm": 3,
  "endocrine": 4, "endocrinology": 4, "infectious disease": 5, "id": 5, "neurology": 6, "neuro": 6,
  "nephrology": 7, "nephro": 7, "hematology": 8, "heme/onc": 8, "oncology": 8, "general medicine": 9,
};
function specialtyColor(name) {
  const key = String(name || "").trim().toLowerCase();
  let idx = SPECIALTY_FIXED[key];
  if (idx == null) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    idx = h % SPECIALTY_PALETTE.length;
  }
  return SPECIALTY_PALETTE[idx];
}
// Small colored pill for a consult specialty (used on boards).
function SpecialtyTag({ name, size }) {
  const c = specialtyColor(name);
  const fs = size === "sm" ? 11 : 11.5;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: "var(--radius-full)", background: c.bg, color: c.color, border: `1px solid ${c.color}`, fontSize: fs, fontWeight: 700, whiteSpace: "nowrap", lineHeight: 1.5 }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: c.color, flex: "none" }} />{name}
    </span>
  );
}

// "+ Consult" picker — drop-in for any patient row so hospitalists / directors
// (anyone, really) can request a consult service. Calls onPick(specialtyName).
function ConsultAdd({ services, onPick, label }) {
  const [open, setOpen] = React.useState(false);
  const list = (services && services.length) ? services : ["Hospital Medicine", "Cardiology", "GI", "Pulmonology", "Nephrology", "Endocrine", "Infectious Disease", "Neurology"];
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", border: "1px dashed var(--border)", background: "#fff", color: "var(--primary)" }}>
        <Icon name={open ? "x" : "plus"} size={11} />{label || "Consult"}
      </button>
      {open && (
        <React.Fragment>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, width: 240, maxWidth: "80vw", background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", padding: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {list.map((s) => {
              const c = specialtyColor(s);
              return (
                <button key={s} onClick={() => { onPick(s); setOpen(false); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", border: `1px solid ${c.color}`, background: c.bg, color: c.color }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: c.color }} />{s}
                </button>
              );
            })}
          </div>
        </React.Fragment>
      )}
    </span>
  );
}

Object.assign(window, { Icon, Button, Badge, StatusDot, Avatar, Card, Field, Logo, StatTile, STATUS, Modal, EditableText, AcuityChip, ESI, specialtyColor, SpecialtyTag, ConsultAdd });

function StatTile({ label, value, icon, tint = "blue" }) {
  const tints = { blue: "var(--primary)", emerald: "var(--status-accepted)", amber: "var(--status-pending)", slate: "var(--status-neutral)" };
  return (
    <Card style={{ padding: 16, flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", fontWeight: 500 }}>{label}</span>
        <Icon name={icon} size={16} color={tints[tint]} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, letterSpacing: "-0.02em" }}>{value}</div>
    </Card>
  );
}

Object.assign(window, { Icon, Button, Badge, StatusDot, Avatar, Card, Field, Logo, StatTile, STATUS });
