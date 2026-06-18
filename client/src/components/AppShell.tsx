import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  LayoutDashboard,
  LayoutGrid,
  MessageSquare,
  Users,
  Settings as SettingsIcon,
  Terminal,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { Assignment, Role } from "@/lib/types";
import { cn } from "@/lib/cn";
import { BroadcastBanner } from "./BroadcastBanner";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  roles: Role[];
}

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: <LayoutDashboard size={18} />,
    roles: ["director", "er_director", "er_doctor", "hospitalist", "developer"],
  },
  {
    href: "/board",
    label: "Patient board",
    icon: <LayoutGrid size={18} />,
    roles: ["director", "er_director", "er_doctor", "hospitalist"],
  },
  {
    href: "/messages",
    label: "Messages",
    icon: <MessageSquare size={18} />,
    roles: ["director", "er_director", "er_doctor", "hospitalist", "developer"],
  },
  {
    href: "/console",
    label: "Console",
    icon: <Terminal size={18} />,
    roles: ["developer"],
  },
  {
    href: "/directory",
    label: "Directory",
    icon: <Users size={18} />,
    roles: ["director", "er_director", "er_doctor", "hospitalist", "developer"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: <SettingsIcon size={18} />,
    roles: ["director", "er_director", "er_doctor", "hospitalist", "developer"],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  // Badge count: a hospitalist's pending queue.
  const { data: pending } = useQuery<Assignment[]>({
    queryKey: ["/api/assignments/pending"],
    enabled: user?.role === "hospitalist",
  });

  if (!user) return null;
  const items = NAV.filter((n) => n.roles.includes(user.role));

  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Activity size={18} />
          </div>
          <span className="text-lg font-bold">DocTurn</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {items.map((item) => {
            const active = location === item.href;
            const badge =
              item.href === "/" && pending?.length ? pending.length : null;
            return (
              <Link key={item.href} href={item.href}>
                <a
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {badge != null && (
                    <span className="rounded-full bg-status-pending-bg px-2 text-xs font-semibold text-status-pending">
                      {badge}
                    </span>
                  )}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-3 py-3">
          <div className="px-2 pb-2">
            <div className="text-sm font-semibold">{user.displayName}</div>
            <div className="text-xs capitalize text-muted-foreground">
              {user.role.replace("_", " ")}
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <BroadcastBanner />
        <div className="mx-auto max-w-6xl p-6">{children}</div>
      </main>
    </div>
  );
}
