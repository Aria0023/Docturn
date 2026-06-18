import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium px-4 h-9 transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    secondary: "bg-secondary text-foreground hover:bg-muted",
    ghost: "hover:bg-muted text-foreground",
    destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
  };
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-md border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between border-b border-border px-6 py-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> =
  {
    pending: { bg: "var(--status-pending-bg)", fg: "var(--status-pending)", label: "Pending" },
    accepted: { bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)", label: "Accepted" },
    assigned: { bg: "var(--status-accepted-bg)", fg: "var(--status-accepted)", label: "Assigned" },
    active: { bg: "var(--status-active-bg)", fg: "var(--status-active)", label: "Active" },
    waiting: { bg: "var(--status-pending-bg)", fg: "var(--status-pending)", label: "Waiting" },
    rejected: { bg: "var(--status-rejected-bg)", fg: "var(--status-rejected)", label: "Rejected" },
    cancelled: { bg: "var(--status-rejected-bg)", fg: "var(--status-rejected)", label: "Cancelled" },
    expired: { bg: "var(--status-neutral-bg)", fg: "var(--status-neutral)", label: "Expired" },
    offline: { bg: "var(--status-neutral-bg)", fg: "var(--status-neutral)", label: "Offline" },
  };

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? {
    bg: "var(--status-neutral-bg)",
    fg: "var(--status-neutral)",
    label: status,
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.fg }} />
      {s.label}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </Card>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-6 py-12 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
