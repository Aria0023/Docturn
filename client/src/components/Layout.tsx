import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  LogOut,
  Activity,
  Stethoscope,
} from 'lucide-react';
import { useLogout, useUser } from '@/hooks/useAuth';
import { useWebSocketStatus } from '@/components/WebSocketProvider';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/messaging', label: 'Messaging', icon: MessageSquare },
  { href: '/directory', label: 'Directory', icon: Users },
];

const ROLE_LABELS: Record<string, string> = {
  director: 'Director',
  er_director: 'ER Director',
  er_doctor: 'ER Doctor',
  hospitalist: 'Hospitalist',
  developer: 'Developer',
};

export function Layout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { data: user } = useUser();
  const logout = useLogout();
  const { status } = useWebSocketStatus();

  const handleLogout = async () => {
    await logout.mutateAsync();
    navigate('/login');
  };

  return (
    <div className="flex h-full min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#2563EB] text-white">
            <Stethoscope className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Doc<span className="text-[#2563EB]">Turn</span>
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = location === href || location.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-blue-50 text-[#2563EB]'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            onClick={handleLogout}
            disabled={logout.isPending}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {user?.fullName ?? 'DocTurn'}
            </p>
            {user && (
              <p className="text-xs text-slate-500">{ROLE_LABELS[user.role] ?? user.role}</p>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Activity
              className={cn(
                'h-4 w-4',
                status === 'open' ? 'text-emerald-500' : 'text-slate-400',
              )}
            />
            <span>{status === 'open' ? 'Live' : 'Reconnecting…'}</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-slate-50 p-6">{children}</main>
      </div>
    </div>
  );
}
