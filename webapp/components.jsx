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

function Button({ variant = "default", size = "default", icon, children, onClick, type, full, style, title, "aria-label": ariaLabel }) {
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    fontFamily: "var(--font-sans)", fontWeight: 500, borderRadius: "var(--radius-md)",
    border: "1px solid transparent", cursor: "pointer", whiteSpace: "nowrap",
    transition: "background .15s ease, box-shadow .15s ease, opacity .15s ease",
    width: full ? "100%" : "auto",
    // A nowrap label must never be squeezed: on touch screens the 44px
    // tap-target rule (index.html, `button { min-width: 44px }`) replaces a
    // flex item's content-based minimum, so in a tight row the button shrank
    // below its label and drew it outside its box ("Add person" at 375px,
    // A.CON-SHO-50). Not shrinking restores the desktop behaviour; a caller
    // that wants a flexible button passes `flex` in `style` (left alone, so
    // shorthand and longhand never mix on one element), and `full` buttons
    // keep shrinking with their row.
    flexShrink: full || (style && (style.flex != null || style.flexShrink != null)) ? undefined : 0,
  };
  const sizes = {
    sm: { height: 36, padding: "0 12px", fontSize: 13 },
    default: { height: 40, padding: "0 16px", fontSize: 14 },
    lg: { height: 44, padding: "0 32px", fontSize: 15 },
    icon: { height: 40, width: 40, padding: 0 },
  };
  const variants = {
    default: { background: "var(--primary)", color: "var(--primary-foreground)", boxShadow: "var(--shadow-sm)" },
    destructive: { background: "var(--destructive)", color: "var(--destructive-foreground)" },
    outline: { background: "var(--card)", borderColor: "var(--border)", color: "var(--foreground)" },
    secondary: { background: "var(--secondary)", color: "var(--foreground)" },
    ghost: { background: "transparent", color: "var(--foreground)" },
    link: { background: "transparent", color: "var(--primary-ink)", textDecoration: "underline", height: "auto", padding: 0 },
  };
  return (
    <button type={type || "button"} onClick={onClick} title={title} aria-label={ariaLabel || title}
      onMouseEnter={(e) => { if (variant === "ghost" || variant === "secondary") e.currentTarget.style.background = "var(--secondary)"; if (variant === "default") e.currentTarget.style.boxShadow = "var(--shadow-md)"; if (variant === "outline") e.currentTarget.style.background = "var(--secondary)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = variants[variant].background; if (variant === "default") e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {icon && <Icon name={icon} size={size === "lg" ? 18 : 16} />}
      {children}
    </button>
  );
}

// `fg` is the text colour used ON the `bg` tint (the deeper `--status-*-fg`
// shade, ≥6:1 — WCAG AA, A.CON-SHO-53); `dot` is the solid status colour for
// marks that sit on white (StatusDot, borders, icons).
const STATUS = {
  pending:  { label: "Pending",  bg: "var(--status-pending-bg)",  fg: "var(--status-pending-fg)",  dot: "var(--status-pending)",  icon: "clock" },
  accepted: { label: "Accepted", bg: "var(--status-accepted-bg)", fg: "var(--status-accepted-fg)", dot: "var(--status-accepted)", icon: "check" },
  online:   { label: "Online",   bg: "var(--status-accepted-bg)", fg: "var(--status-accepted-fg)", dot: "var(--status-accepted)", icon: "circle" },
  sent:     { label: "Sent",     bg: "var(--status-active-bg)",   fg: "var(--status-active-fg)",   dot: "var(--status-active)",   icon: "send" },
  active:   { label: "Active",   bg: "var(--status-active-bg)",   fg: "var(--status-active-fg)",   dot: "var(--status-active)",   icon: "activity" },
  rejected: { label: "Rejected", bg: "var(--status-rejected-bg)", fg: "var(--status-rejected-fg)", dot: "var(--status-rejected)", icon: "x" },
  declined: { label: "Declined", bg: "var(--status-rejected-bg)", fg: "var(--status-rejected-fg)", dot: "var(--status-rejected)", icon: "x" },
  rerouted: { label: "Re-routed", bg: "var(--status-pending-bg)", fg: "var(--status-pending-fg)", dot: "var(--status-pending)", icon: "repeat" },
  expired:  { label: "Expired",  bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral-fg)",  dot: "var(--status-neutral)",  icon: "minus" },
  offline:  { label: "Offline",  bg: "var(--status-neutral-bg)",  fg: "var(--status-neutral-fg)",  dot: "var(--status-neutral)",  icon: "minus" },
};

function Badge({ status, variant, children, icon }) {
  const s = status ? STATUS[status] : null;
  const palette = s
    ? { background: s.bg, color: s.fg }
    : variant === "outline" ? { background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" }
    : variant === "secondary" ? { background: "var(--secondary)", color: "var(--foreground)" }
    : variant === "destructive" ? { background: "var(--destructive)", color: "var(--destructive-foreground)" }
    : { background: "var(--primary)", color: "var(--primary-foreground)" };
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
      <span style={{ position: "absolute", inset: 0, borderRadius: "99px", background: s.dot || s.fg }} />
      {pulse && <span style={{ position: "absolute", inset: 0, borderRadius: "99px", background: s.dot || s.fg, animation: "dt-pulse 1.5s infinite" }} />}
    </span>
  );
}

function Avatar({ initials, size = 36, tint = "blue" }) {
  // Initials sit on a tint: use the deeper -fg shades (≥6:1, A.CON-SHO-53).
  const tints = {
    blue: { bg: "var(--status-active-bg)", fg: "var(--status-active-fg)" },
    emerald: { bg: "var(--status-accepted-bg)", fg: "var(--status-accepted-fg)" },
    amber: { bg: "var(--status-pending-bg)", fg: "var(--status-pending-fg)" },
    slate: { bg: "var(--status-neutral-bg)", fg: "var(--status-neutral-fg)" },
  };
  const t = tints[tint] || tints.blue;
  // Floor the initials at 10px (a 22px avatar used to render 7.9px text); the
  // phone stylesheet in index.html raises anything under 12px further.
  return (
    <span style={{ width: size, height: size, borderRadius: "99px", background: t.bg, color: t.fg, fontWeight: 700, fontSize: Math.max(10, Math.round(size * 0.36)), display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
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

// Form field. The attributes iOS Safari and password managers depend on
// (name, autocomplete, autocapitalize, autocorrect, inputmode, spellcheck,
// enterkeyhint) reach the control either as top-level props or via
// `inputProps` (A.CON-SHO-12/57); the label is tied to the control (htmlFor/id)
// so AutoFill heuristics and screen readers can identify it. The 16px phone
// font and the 44pt phone tap height come from index.html's stylesheet
// (`.dt-field` + the phone media block), which beats these inline styles.
function Field({ label, icon, value, onChange, placeholder, type, help, error, textarea, rows, inputProps,
  name, id, autoComplete, autoCapitalize, autoCorrect, inputMode, spellCheck, enterKeyHint, required, disabled, onKeyDown, onFocus, onBlur }) {
  const [focus, setFocus] = React.useState(false);
  // Password fields get a show/hide control: on a phone keyboard a mistyped
  // new password is otherwise invisible until the next sign-in fails.
  const [reveal, setReveal] = React.useState(false);
  const isPassword = type === "password" && !textarea;
  const autoId = (typeof React.useId === "function") ? React.useId() : null;
  const fieldId = id || (inputProps && inputProps.id) || (autoId ? "dtf" + String(autoId).replace(/[^a-zA-Z0-9_-]/g, "") : undefined);
  const noteId = fieldId && (error || help) ? fieldId + "-note" : undefined;
  const borderColor = error ? "var(--destructive)" : focus ? "var(--ring)" : "var(--input)";
  const fwd = Object.assign({ name, autoComplete, autoCapitalize, autoCorrect, inputMode, spellCheck, enterKeyHint, required, disabled, onKeyDown }, inputProps || {});
  Object.keys(fwd).forEach((k) => { if (fwd[k] === undefined) delete fwd[k]; });
  const common = {
    value, placeholder,
    onChange: (e) => onChange && onChange(e.target.value),
    onFocus: (e) => { setFocus(true); if (onFocus) onFocus(e); },
    onBlur: (e) => { setFocus(false); if (onBlur) onBlur(e); },
    "aria-invalid": error ? true : undefined,
    "aria-describedby": noteId,
    ...fwd,
    id: fieldId,
  };
  return (
    <div>
      {label && <label htmlFor={fieldId} style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>}
      <div className="dt-field" style={{ display: "flex", alignItems: textarea ? "flex-start" : "center", gap: 8, padding: textarea ? "10px 12px" : "0 12px", height: textarea ? "auto" : 40, border: `1px solid ${borderColor}`, borderRadius: "var(--radius-md)", background: "var(--card)", boxShadow: focus ? "0 0 0 2px hsl(221 83% 53% / .22)" : "none", transition: "border-color .15s, box-shadow .15s" }}>
        {icon && <Icon name={icon} size={16} color="var(--muted-foreground)" style={{ marginTop: textarea ? 2 : 0 }} />}
        {textarea
          ? <textarea {...common} rows={rows || 3} style={{ border: "none", outline: "none", fontSize: 14, width: "100%", fontFamily: "inherit", background: "transparent", resize: "vertical", color: "var(--foreground)" }} />
          : <input {...common} type={isPassword && reveal ? "text" : (type || "text")} style={{ border: "none", outline: "none", fontSize: 16, width: "100%", minWidth: 0, fontFamily: "inherit", background: "transparent", color: "var(--foreground)" }} />}
        {isPassword && !disabled && (
          <button type="button" className="dt-reveal" onClick={() => setReveal(!reveal)} aria-label={reveal ? "Hide password" : "Show password"} aria-pressed={reveal} title={reveal ? "Hide password" : "Show password"}
            style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, margin: "-2px -12px -2px 0", border: "none", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", borderRadius: "var(--radius-md)" }}>
            <Icon name={reveal ? "eye-off" : "eye"} size={16} />
          </button>
        )}
      </div>
      {error ? <div id={noteId} role="alert" style={{ fontSize: 12, color: "var(--destructive)", marginTop: 5, display: "flex", gap: 4, alignItems: "center" }}><Icon name="alert-circle" size={12} />{error}</div>
        : help ? <div id={noteId} style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 5 }}>{help}</div> : null}
    </div>
  );
}

function Logo({ height = 30 }) {
  // Root-absolute so the wordmark resolves from any document path (A.CON-SHO-58).
  return <img src="/assets/docturn-wordmark.svg" alt="DocTurn" style={{ height, display: "block" }} />;
}

function Modal({ title, subtitle, icon, onClose, children, width = 460 }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "dt-toast-in .18s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: "var(--card)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-2xl, 0 24px 60px rgba(2,6,23,.28))", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
          {icon && <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--status-active-bg)", color: "var(--primary-ink)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={icon} size={18} /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 1 }}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close" style={{ width: 36, height: 36, margin: "-4px -6px 0 0", borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", flex: "none" }}><Icon name="x" size={18} /></button>
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
        boxShadow: "0 0 0 2px hsl(221 83% 53% / .18)", background: "var(--card)", boxSizing: "border-box" } };
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
// `color` is the chip TEXT on `bg` (12px bold on phones), the dot, the border
// and the fill behind white icons, so every shade is the Tailwind 700 step:
// ≥4.76:1 on its tint and ≥4.9:1 under white (WCAG AA, A.CON-SHO-53;
// scripts/contrast-check.mjs recomputes them). The 500/600 steps used before
// read 3.07–4.41:1 (GI, Pulmonology, ID, Neurology, Cardiology chips).
const SPECIALTY_PALETTE = [
  { color: "#1D4ED8", bg: "#EFF6FF" }, // blue     6.16:1
  { color: "#B91C1C", bg: "#FEF2F2" }, // red      5.91:1
  { color: "#B45309", bg: "#FFFBEB" }, // amber    4.84:1
  { color: "#0E7490", bg: "#ECFEFF" }, // cyan     5.15:1
  { color: "#6D28D9", bg: "#F5F3FF" }, // violet   6.48:1
  { color: "#047857", bg: "#ECFDF5" }, // emerald  5.21:1
  { color: "#BE185D", bg: "#FDF2F8" }, // pink     5.53:1
  { color: "#4338CA", bg: "#EEF2FF" }, // indigo   7.07:1
  { color: "#A16207", bg: "#FEFCE8" }, // yellow   4.76:1
  { color: "#0F766E", bg: "#F0FDFA" }, // teal     5.25:1
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
// only="person": the people list alone, for a place that already offers the
// services separately (the ER intake form).
function ConsultAdd({ services, onPick, label, only }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  // Two ways to consult: a SERVICE (its on-call and team are called) or a
  // specific PHYSICIAN by name — anyone in the organization, not only whoever
  // is on call. onPick receives the service name, or { person }.
  const [tab, setTab] = React.useState(only === "person" ? "person" : "service");
  const [q, setQ] = React.useState("");
  const btnRef = React.useRef(null);
  const list = (services && services.length) ? services : ["Hospital Medicine", "Cardiology", "GI", "Pulmonology", "Nephrology", "Endocrine", "Infectious Disease", "Neurology"];
  const people = open && tab === "person" && window.DT && window.DT.consultPeople ? window.DT.consultPeople() : [];
  const ql = q.trim().toLowerCase();
  const matches = ql ? people.filter((p) => p.name.toLowerCase().includes(ql) || p.label.toLowerCase().includes(ql)) : people;
  // Anchor the menu with position:fixed off the button's screen rect so it
  // floats ABOVE the row (and any clipping ancestor) instead of being buried
  // inside it. Flip upward when there isn't enough room below.
  function place() {
    const el = btnRef.current;
    const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { top: 0, bottom: 0, right: 0, left: 0 };
    const width = Math.min(300, vw - 24);
    let left = r.right - width;
    if (left < 12) left = 12;
    if (left + width > vw - 12) left = vw - 12 - width;
    const below = vh - r.bottom;
    const up = below < 340 && r.top > below;
    // Never taller than the room on the side it opens toward, so the list
    // scrolls inside the menu instead of running off the screen.
    const room = Math.max(160, Math.round((up ? r.top : below) - 18));
    return { left, width, room, top: up ? null : Math.round(r.bottom + 6), bottom: up ? Math.round(vh - r.top + 6) : null };
  }
  function toggle() { setOpen((v) => { const nv = !v; if (nv) { setPos(place()); setQ(""); } return nv; }); }
  const tabBtn = (id, text) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      style={{ flex: 1, height: 32, border: "none", borderRadius: "var(--radius-sm, 6px)", cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "var(--font-sans)",
        background: tab === id ? "var(--card)" : "transparent", color: tab === id ? "var(--primary-ink)" : "var(--muted-foreground)", boxShadow: tab === id ? "var(--shadow-sm)" : "none" }}>{text}</button>
  );
  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={btnRef} onClick={toggle} aria-expanded={open}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "var(--font-sans)", whiteSpace: "nowrap", border: "1px dashed var(--border)", background: "var(--card)", color: "var(--primary-ink)" }}>
        <Icon name={open ? "x" : "plus"} size={11} />{label || "Consult"}
      </button>
      {open && pos && (
        <React.Fragment>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div data-consult-menu style={{ position: "fixed", left: pos.left, top: pos.top == null ? undefined : pos.top, bottom: pos.bottom == null ? undefined : pos.bottom, zIndex: 9999, width: pos.width, maxWidth: "92vw", maxHeight: Math.min(pos.room, Math.round((window.innerHeight || 768) * 0.7)), display: "flex", flexDirection: "column", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-xl)", padding: 10, gap: 8 }}>
            {only !== "person" && (
              <div role="tablist" aria-label="Consult by" style={{ display: "flex", gap: 2, padding: 3, background: "var(--secondary)", borderRadius: "var(--radius-md)" }}>
                {tabBtn("service", "Service (on call)")}
                {tabBtn("person", "Specific physician")}
              </div>
            )}
            {tab === "service" ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, overflowY: "auto" }}>
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
            ) : (
              <React.Fragment>
                <input data-consult-search autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or specialty…" aria-label="Search physicians"
                  style={{ height: 36, padding: "0 10px", border: "1px solid var(--input)", borderRadius: "var(--radius-md)", fontSize: 14, fontFamily: "inherit", background: "var(--card)", color: "var(--foreground)", outline: "none" }} />
                <div role="listbox" aria-label="Physicians" style={{ overflowY: "auto", display: "flex", flexDirection: "column", margin: "0 -4px" }}>
                  {matches.length === 0 && (
                    <div style={{ padding: "12px 6px", fontSize: 12.5, color: "var(--muted-foreground)" }}>{people.length ? "No one matches “" + q + "”." : "No one else is listed in your organization yet."}</div>
                  )}
                  {matches.map((p) => (
                    <button key={p.key} type="button" role="option" data-consult-person={p.userId || p.name} onClick={() => { onPick({ person: p }); setOpen(false); }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--secondary)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                      style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 6px", border: "none", borderRadius: "var(--radius-md)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)", color: "var(--foreground)" }}>
                      <Avatar initials={p.avatar} size={26} tint="slate" />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}{p.hasAccount ? "" : " · no DocTurn account — recorded, not alerted"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </React.Fragment>
            )}
          </div>
        </React.Fragment>
      )}
    </span>
  );
}

// Per-specialty consult roster: shows WHO was consulted on each service and who
// accepted / declined / is still pending. `details` = [{id, specialty, name,
// credential, status}]. When onRespond is given, pending rows get Accept/Decline.
function consultStatusStyle(status) {
  if (status === "accepted") return { label: "Accepted", color: "var(--status-accepted-fg)", bg: "var(--status-accepted-bg)", icon: "check" };
  if (status === "declined") return { label: "Declined", color: "var(--status-rejected-fg)", bg: "var(--status-rejected-bg)", icon: "x" };
  return { label: "Pending", color: "var(--status-pending-fg)", bg: "var(--status-pending-bg)", icon: "clock" };
}
// Who may answer: ONLY the consultant a row is addressed to (`mine`). Anyone
// else sees its state — Pending / Accepted / Declined — never an Accept that
// would answer for a colleague (the server refuses that too). onRemove (the
// board's editors) adds a remove control.
function ConsultRoster({ details, onRespond, canAnswer, onRemove, compact }) {
  const mayAnswer = canAnswer || ((m) => !!m.mine);
  const list = details || [];
  if (!list.length) return null;
  const bySpec = {};
  list.forEach((c) => { (bySpec[c.specialty] = bySpec[c.specialty] || []).push(c); });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {Object.keys(bySpec).map((spec) => {
        const members = bySpec[spec];
        const accepted = members.filter((m) => m.status === "accepted").length;
        const c = specialtyColor(spec);
        return (
          <div key={spec} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            {/* The band carries THEME ink (the name, the counter), so its tint
                is the specialty hue mixed into the current surface rather than
                the palette's fixed light tint: on a dark canvas the fixed tint
                stayed light and the muted counter on it read 1.78:1
                (scripts/theme-check.mjs). The hue still names the service, and
                the dot keeps the fixed shade. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", background: "color-mix(in srgb, " + c.color + " 16%, var(--card))" }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: c.color, flex: "none" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", minWidth: 0, overflowWrap: "anywhere" }}>{spec}</span>
              <span style={{ marginLeft: "auto", flex: "none", whiteSpace: "nowrap", fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600 }}>{accepted}/{members.length} accepted</span>
            </div>
            {members.map((m, i) => {
              const ss = consultStatusStyle(m.status);
              return (
                // The name keeps a readable minimum and never breaks word by
                // word; when the name and the answer controls don't both fit,
                // the controls drop to their own line, right-aligned, instead
                // of sitting on top of the name.
                <div key={m.id || i} data-consult-member style={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 8, rowGap: 6, padding: "6px 9px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ flex: "1 1 auto", minWidth: 0, maxWidth: "100%", display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar initials={(m.name || "?").replace(/^Dr\.?\s*/, "").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()} size={26} tint="slate" />
                    <div style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={m.name || "On-call team"}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{m.name || "On-call team"}</span>
                      {m.credential ? <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: 5 }}>{m.credential}</span> : null}
                    </div>
                  </div>
                  {onRespond && mayAnswer(m) && m.status !== "accepted" && m.status !== "declined" ? (
                    <span data-consult-answer style={{ display: "inline-flex", gap: 4, flex: "none", marginLeft: "auto" }}>
                      <button onClick={() => onRespond(m.id, "declined")} title="Decline consult"
                        style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", fontFamily: "var(--font-sans)", whiteSpace: "nowrap" }}><Icon name="x" size={11} />Decline</button>
                      <button onClick={() => onRespond(m.id, "accepted")} title="Accept consult"
                        style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: "var(--radius-full)", border: "1px solid var(--status-accepted)", background: "var(--status-accepted-bg)", cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--status-accepted-fg)", fontFamily: "var(--font-sans)", whiteSpace: "nowrap" }}><Icon name="check" size={11} />Accept</button>
                    </span>
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: 11, fontWeight: 700, color: ss.color, background: ss.bg, flex: "none", marginLeft: "auto", whiteSpace: "nowrap" }} title={m.respondedAt ? ss.label + " at " + new Date(m.respondedAt).toLocaleString() : ss.label}><Icon name={ss.icon} size={10} />{ss.label}{m.respondedAt && window.dtFmt ? " · " + window.dtFmt.hhmm(m.respondedAt) : ""}</span>
                  )}
                  {onRemove && m.id != null && (
                    <button type="button" data-consult-remove onClick={() => { if (window.confirm("Cancel this " + (m.specialty || "consult") + " consult" + (m.name ? " (" + m.name + ")" : "") + "? It is withdrawn for everyone.")) onRemove(m.id); }}
                      title="Cancel consult" aria-label={"Cancel consult: " + (m.name || "On-call team")}
                      onMouseEnter={(e) => e.currentTarget.style.color = "var(--destructive)"} onMouseLeave={(e) => e.currentTarget.style.color = "var(--muted-foreground)"}
                      style={{ flex: "none", width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", borderRadius: "var(--radius-md)", cursor: "pointer", color: "var(--muted-foreground)" }}>
                      <Icon name="trash-2" size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { Icon, Button, Badge, StatusDot, Avatar, Card, Field, Logo, StatTile, STATUS, Modal, EditableText, AcuityChip, ESI, specialtyColor, SpecialtyTag, ConsultAdd, ConsultRoster });

function StatTile({ label, value, icon, tint = "blue", sub }) {
  const tints = { blue: "var(--primary)", emerald: "var(--status-accepted)", amber: "var(--status-pending)", slate: "var(--status-neutral)" };
  return (
    <Card style={{ padding: 16, flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", fontWeight: 500 }}>{label}</span>
        <Icon name={icon} size={16} color={tints[tint]} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 5 }}>{sub}</div>}
    </Card>
  );
}

// Short duration for comms KPIs: null → "—", else "4m 12s" / "45s".
function fmtCommsDur(sec) {
  if (sec == null) return "—";
  const s = Math.round(sec);
  if (s < 60) return s + "s";
  return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
}
// The 3 real clinical-comms KPI tiles (formatted for CustomizableStats), from
// the server-computed metrics ({ messages7d, statAckAvgSec, consultResponseAvgSec }).
// Stable ids so per-key show/hide + order persist. "—" when a metric is null.
function commsStatTiles(cm) {
  const m = cm || {};
  return [
    { id: "comms_msgs", label: "Messages (7 days)", value: m.messages7d != null ? m.messages7d : 0, icon: "message-square", tint: "blue" },
    { id: "comms_statack", label: "STAT ack (avg)", value: fmtCommsDur(m.statAckAvgSec), icon: "siren", tint: "amber" },
    { id: "comms_consult", label: "Consult response (avg)", value: fmtCommsDur(m.consultResponseAvgSec), icon: "stethoscope", tint: "slate" },
  ];
}
Object.assign(window, { fmtCommsDur, commsStatTiles });

Object.assign(window, { Icon, Button, Badge, StatusDot, Avatar, Card, Field, Logo, StatTile, STATUS });

// "Consult requests for you": consults addressed to the signed-in clinician on
// ANY patient (GET /api/consults/mine). The one place a consultant answers —
// they are often not on that patient's care team, so the board alone would
// not show it to them. Renders nothing when there are none.
function MyConsultRequests() {
  const st = useStore();
  const a = useActions();
  const list = st.myConsults || [];
  const [busy, setBusy] = React.useState({});
  if (!list.length) return null;
  const answer = (c, status) => {
    if (busy[c.id]) return;
    setBusy((b) => Object.assign({}, b, { [c.id]: true }));
    Promise.resolve(a.respondConsult(c.id, status)).then(() => setBusy((b) => { const n = Object.assign({}, b); delete n[c.id]; return n; }));
  };
  return (
    <div data-my-consults style={{ marginBottom: 16 }}>
    <Card style={{ padding: 0, overflow: "hidden", border: "1px solid var(--status-pending)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--status-pending-bg)", color: "var(--status-pending-fg)", fontSize: 13.5, fontWeight: 700 }}>
        <Icon name="stethoscope" size={15} />Consult requests for you
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600 }}>{list.length} waiting</span>
      </div>
      {list.map((c, i) => {
        const sc = specialtyColor(c.specialty);
        return (
          <div key={c.id} data-my-consult={c.id} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "10px 14px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={c.initials} size={34} tint="amber" />
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13.5, fontWeight: 700 }}>
                Patient {c.initials}
                {c.acuity ? <AcuityChip level={c.acuity} size="sm" /> : null}
                {c.roomNumber ? <span style={{ fontSize: 12, fontWeight: 500, color: "var(--muted-foreground)" }}>· Room {c.roomNumber}</span> : null}
              </div>
              {c.issueSummary ? <div style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{c.issueSummary}</div> : null}
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: sc.color, fontWeight: 600 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: sc.color }} />{c.specialty}</span>
                {c.admittedBy ? <span>· admitted by {c.admittedBy}</span> : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginLeft: "auto", opacity: busy[c.id] ? 0.55 : 1 }}>
              <Button size="sm" variant="outline" icon="x" onClick={() => answer(c, "declined")}>Decline</Button>
              <Button size="sm" icon="check" onClick={() => answer(c, "accepted")}>Accept</Button>
            </div>
          </div>
        );
      })}
    </Card>
    </div>
  );
}

Object.assign(window, { MyConsultRequests });
