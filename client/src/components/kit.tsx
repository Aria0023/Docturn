import * as Lucide from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/* DocTurn client — design-kit primitives ported from design/ui_kits/web-app.
   Inline styles + your tokens (colors_and_type.css) for 1:1 fidelity. */

function pascal(name: string): string {
  return name
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

export function Icon({
  name,
  size = 16,
  color,
  strokeWidth = 2,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  const Cmp = (Lucide as Record<string, unknown>)[pascal(name)] as
    | Lucide.LucideIcon
    | undefined;
  const Fallback = Lucide.Circle;
  const C = Cmp ?? Fallback;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", color, flex: "none", ...style }}>
      <C size={size} strokeWidth={strokeWidth} />
    </span>
  );
}

type BtnVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type BtnSize = "sm" | "default" | "lg" | "icon";

export function Button({
  variant = "default",
  size = "default",
  icon,
  children,
  onClick,
  type,
  full,
  disabled,
  style,
}: {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: string;
  children?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  full?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    fontFamily: "var(--font-sans)", fontWeight: 500, borderRadius: "var(--radius-md)",
    border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap", opacity: disabled ? 0.5 : 1,
    transition: "background .15s ease, box-shadow .15s ease, opacity .15s ease",
    width: full ? "100%" : "auto",
  };
  const sizes: Record<BtnSize, CSSProperties> = {
    sm: { height: 36, padding: "0 12px", fontSize: 13 },
    default: { height: 40, padding: "0 16px", fontSize: 14 },
    lg: { height: 44, padding: "0 32px", fontSize: 15 },
    icon: { height: 40, width: 40, padding: 0 },
  };
  const variants: Record<BtnVariant, CSSProperties> = {
    default: { background: "var(--primary)", color: "#fff", boxShadow: "var(--shadow-sm)" },
    destructive: { background: "var(--destructive)", color: "#fff" },
    outline: { background: "#fff", borderColor: "var(--border)", color: "var(--foreground)" },
    secondary: { background: "var(--secondary)", color: "var(--foreground)" },
    ghost: { background: "transparent", color: "var(--foreground)" },
    link: { background: "transparent", color: "var(--primary)", textDecoration: "underline" },
  };
  return (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {icon && <Icon name={icon} size={size === "lg" ? 18 : 16} />}
      {children}
    </button>
  );
}

export const STATUS: Record<string, { label: string; bg: string; fg: string; icon: string }> = {
  pending: { label: "Pending", bg: "var(--status-pending-bg)", fg: "var(--status-pending)", icon: "clock" },
  accepted: { label: "Accepted", bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)", icon: "check" },
  assigned: { label: "Assigned", bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)", icon: "check" },
  online: { label: "Online", bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)", icon: "circle" },
  waiting: { label: "Waiting", bg: "var(--status-pending-bg)", fg: "var(--status-pending)", icon: "clock" },
  sent: { label: "Sent", bg: "var(--status-active-bg)", fg: "var(--status-active)", icon: "send" },
  active: { label: "Active", bg: "var(--status-active-bg)", fg: "var(--status-active)", icon: "activity" },
  rejected: { label: "Rejected", bg: "var(--status-rejected-bg)", fg: "var(--status-rejected)", icon: "x" },
  cancelled: { label: "Cancelled", bg: "var(--status-rejected-bg)", fg: "var(--status-rejected)", icon: "x" },
  expired: { label: "Expired", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral)", icon: "minus" },
  offline: { label: "Offline", bg: "var(--status-neutral-bg)", fg: "var(--status-neutral)", icon: "minus" },
};

export function Badge({
  status,
  variant,
  children,
  icon,
}: {
  status?: string;
  variant?: "outline" | "secondary" | "destructive";
  children?: ReactNode;
  icon?: string;
}) {
  const s = status ? STATUS[status] : null;
  const palette: CSSProperties = s
    ? { background: s.bg, color: s.fg }
    : variant === "outline" ? { background: "#fff", color: "var(--foreground)", border: "1px solid var(--border)" }
    : variant === "secondary" ? { background: "var(--secondary)", color: "var(--foreground)" }
    : variant === "destructive" ? { background: "var(--destructive)", color: "#fff" }
    : { background: "var(--primary)", color: "#fff" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: "var(--radius-full)", fontSize: 12, fontWeight: 600, lineHeight: 1.6, ...palette }}>
      {(icon || s) && <Icon name={icon || s!.icon} size={11} />}
      {children || (s && s.label)}
    </span>
  );
}

export function StatusDot({ status = "offline", pulse }: { status?: string; pulse?: boolean }) {
  const s = STATUS[status] || STATUS.offline;
  return (
    <span style={{ position: "relative", width: 9, height: 9, display: "inline-block", flex: "none" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "99px", background: s!.fg }} />
      {pulse && <span style={{ position: "absolute", inset: 0, borderRadius: "99px", background: s!.fg, animation: "dt-pulse 1.5s infinite" }} />}
    </span>
  );
}

export function Avatar({ initials, size = 36, tint = "blue" }: { initials: string; size?: number; tint?: string }) {
  const tints: Record<string, { bg: string; fg: string }> = {
    blue: { bg: "#DBEAFE", fg: "var(--primary)" },
    emerald: { bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)" },
    amber: { bg: "var(--status-pending-bg)", fg: "var(--status-pending)" },
    slate: { bg: "var(--status-neutral-bg)", fg: "var(--status-neutral)" },
  };
  const t = tints[tint] || tints.blue;
  return (
    <span style={{ width: size, height: size, borderRadius: "99px", background: t!.bg, color: t!.fg, fontWeight: 700, fontSize: size * 0.36, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      {initials}
    </span>
  );
}

export function Card({ children, style, onClick, hover }: { children: ReactNode; style?: CSSProperties; onClick?: () => void; hover?: boolean }) {
  return (
    <div onClick={onClick}
      className={hover ? "dt-card-hover" : undefined}
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)", transition: "box-shadow .2s ease, transform .2s ease", cursor: onClick ? "pointer" : "default", ...style }}>
      {children}
    </div>
  );
}

export function Field({
  label,
  icon,
  value,
  onChange,
  placeholder,
  type,
  help,
  textarea,
  rows,
}: {
  label?: string;
  icon?: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
  help?: string;
  textarea?: boolean;
  rows?: number;
}) {
  return (
    <div>
      {label && <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>}
      <div style={{ display: "flex", alignItems: textarea ? "flex-start" : "center", gap: 8, padding: textarea ? "10px 12px" : "0 12px", height: textarea ? "auto" : 40, border: "1px solid var(--input)", borderRadius: "var(--radius-md)", background: "#fff" }}>
        {icon && <Icon name={icon} size={16} color="var(--muted-foreground)" style={{ marginTop: textarea ? 2 : 0 }} />}
        {textarea ? (
          <textarea value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} rows={rows || 3}
            style={{ border: "none", outline: "none", fontSize: 14, width: "100%", fontFamily: "inherit", background: "transparent", resize: "vertical", color: "var(--foreground)" }} />
        ) : (
          <input type={type || "text"} value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder}
            style={{ border: "none", outline: "none", fontSize: 14, width: "100%", fontFamily: "inherit", background: "transparent", color: "var(--foreground)" }} />
        )}
      </div>
      {help && <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 5 }}>{help}</div>}
    </div>
  );
}

export function StatTile({ label, value, icon, tint = "blue" }: { label: string; value: ReactNode; icon: string; tint?: string }) {
  const tints: Record<string, string> = {
    blue: "var(--primary)", emerald: "var(--status-accepted)", amber: "var(--status-pending)", slate: "var(--status-neutral)",
  };
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

export function PageWrap({ children }: { children: ReactNode }) {
  return <div style={{ padding: 28, maxWidth: "var(--content-max, 1040px)", margin: "0 auto" }}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 14px" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{children}</h2>
      {action}
    </div>
  );
}

export function EmptyCard({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <Card style={{ padding: 36, textAlign: "center" }}>
      <Icon name={icon} size={26} color="var(--muted-foreground)" />
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{subtitle}</div>}
    </Card>
  );
}
