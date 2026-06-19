import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Assignment, Hospitalist, Role } from "@/lib/types";
import { Avatar, Badge, Icon, StatusDot } from "./kit";
import { RoleSwitcher } from "./RoleSwitcher";
import { NotificationsPanel } from "./NotificationsPanel";

interface NavItem {
  href: string;
  id: string;
  label: string;
  icon: string;
  roles: Role[];
}

// Per-role navigation, mirroring the design kit's NAV map.
const NAV: NavItem[] = [
  { href: "/", id: "dashboard", label: "Dashboard", icon: "layout-dashboard", roles: ["director", "er_director", "er_doctor", "hospitalist"] },
  { href: "/", id: "dashboard-dev", label: "Organizations", icon: "building-2", roles: ["developer"] },
  { href: "/board", id: "board", label: "Patient board", icon: "layout-list", roles: ["director", "er_director", "er_doctor", "hospitalist"] },
  { href: "/team", id: "team", label: "My care team", icon: "users-round", roles: ["director", "er_director", "er_doctor", "hospitalist"] },
  { href: "/broadcasts", id: "broadcasts", label: "Broadcasts", icon: "megaphone", roles: ["director", "er_director"] },
  { href: "/messages", id: "messages", label: "Messages", icon: "message-square", roles: ["director", "er_director", "er_doctor", "hospitalist", "developer"] },
  { href: "/directory", id: "directory", label: "Directory", icon: "contact", roles: ["director", "er_director", "er_doctor", "hospitalist"] },
  { href: "/compliance", id: "compliance", label: "Compliance", icon: "shield-check", roles: ["director", "er_director", "er_doctor", "hospitalist", "developer"] },
  { href: "/settings", id: "settings", label: "Settings", icon: "settings", roles: ["director", "er_director", "developer"] },
];

const TOP: Record<string, [string, string]> = {
  "/board": ["Patient board", "Who's responsible for every distributed patient"],
  "/team": ["My care team", "Link midlevels and partners into your on-call unit"],
  "/messages": ["Secure messaging", "Direct, group and emergency broadcast"],
  "/directory": ["Care team", "On-call and availability"],
  "/broadcasts": ["Emergency broadcasts", "Targeted alerts with acknowledgement tracking"],
  "/compliance": ["Audit & compliance", "HIPAA audit trail, PHI access and incidents"],
  "/settings": ["Organization settings", "Rotation rules, feature flags and integrations"],
};

const ROLE_META: Record<string, [string, string]> = {
  hospitalist: ["Census & assignments", "Accept incoming hand-offs and manage your patients"],
  er_doctor: ["Patient intake", "Admit a patient and route to a hospitalist"],
  er_director: ["ER operations", "Intake throughput, ER staffing and routing performance"],
  director: ["Hospital overview", "Hospitalist providers, rotation and reassignment"],
  developer: ["Organizations", "Cross-tenant platform administration"],
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const qc = useQueryClient();
  const [bellOpen, setBellOpen] = useState(false);
  const [locked, setLocked] = useState(false);

  const { data: hospitalists } = useQuery<Hospitalist[]>({
    queryKey: ["/api/hospitalists"],
    enabled: !!user,
  });
  const { data: pending } = useQuery<Assignment[]>({
    queryKey: ["/api/assignments/pending"],
    enabled: user?.role === "hospitalist",
  });

  const me = hospitalists?.find((h) => h.userId === user?.id);
  const toggleWorking = useMutation({
    mutationFn: (working: boolean) =>
      api.patch(`/api/hospitalists/${me?.id}/working-status`, { working }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/hospitalists"] }),
  });

  if (!user) return null;
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const [metaTitle, metaSub] = ROLE_META[user.role] ?? ["", ""];
  const [topTitle, topSub] = TOP[location] ?? [metaTitle, metaSub];
  const onDashboard = location === "/";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--secondary)" }}>
      {/* Sidebar */}
      <aside style={{ width: 232, flex: "none", background: "#fff", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", height: "100vh", position: "sticky", top: 0 }}>
        <div style={{ padding: "18px 18px 14px", display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16 }}>D</span>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.02em" }}>DocTurn</span>
        </div>
        <nav style={{ padding: "6px 12px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {items.map((item) => {
            const on =
              item.href === "/" ? location === "/" : location.startsWith(item.href);
            const badge =
              item.id === "dashboard" && pending?.length ? pending.length : undefined;
            return (
              <Link key={item.id} href={item.href}>
                <a style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: "var(--radius-md)", fontSize: 14, fontWeight: 500, textDecoration: "none", background: on ? "#EFF6FF" : "transparent", color: on ? "var(--primary)" : "var(--foreground)" }}>
                  <Icon name={item.icon} size={18} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {badge ? <Badge status="pending">{badge}</Badge> : null}
                </a>
              </Link>
            );
          })}
        </nav>
        <div style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
            <Avatar initials={initialsOf(user.displayName)} size={34} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.displayName}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{user.role.replace("_", " ")}</div>
            </div>
            <button onClick={() => logout()} title="Sign out" style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
              <Icon name="log-out" size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header style={{ height: 64, borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,.85)", backdropFilter: "blur(6px)", position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{topTitle}</div>
            {topSub && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{topSub}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <RoleSwitcher current={user.role} />
            {user.role === "hospitalist" && onDashboard && me && (
              <button onClick={() => toggleWorking.mutate(!me.working)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                <StatusDot status={me.working ? "online" : "offline"} pulse={me.working} />
                {me.working ? "On shift" : "Off shift"}
              </button>
            )}
            <button onClick={() => setBellOpen((v) => !v)} title="Notifications" style={{ position: "relative", width: 38, height: 38, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="bell" size={18} />
            </button>
            <button onClick={() => setLocked(true)} title="Lock app" style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="lock" size={17} />
            </button>
          </div>
        </header>
        <main style={{ flex: 1, background: location === "/messages" ? "#fff" : "var(--secondary)" }}>
          {children}
        </main>
      </div>

      <NotificationsPanel open={bellOpen} onClose={() => setBellOpen(false)} />
      {locked && <LockScreen name={user.displayName} onUnlock={() => setLocked(false)} />}
    </div>
  );
}

function LockScreen({ name, onUnlock }: { name: string; onUnlock: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(15,23,42,.55)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 320, background: "#fff", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", padding: 28, textAlign: "center" }}>
        <Avatar initials={initialsOf(name)} size={56} />
        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 12 }}>{name}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>
          Session locked for HIPAA. Click to resume.
        </div>
        <div style={{ marginTop: 18 }}>
          <button onClick={onUnlock} style={{ width: "100%", height: 44, borderRadius: "var(--radius-md)", border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
            Unlock
          </button>
        </div>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  return name
    .replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
