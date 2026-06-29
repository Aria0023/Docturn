import type { ReactNode } from 'react';
import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useUser } from '@/hooks/useAuth';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { MessagingPage } from '@/pages/MessagingPage';
import { DirectoryPage } from '@/pages/DirectoryPage';

function FullScreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#2563EB]" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useUser();
  if (isLoading) return <FullScreenSpinner />;
  if (!user) return <Redirect to="/login" />;
  return <Layout>{children}</Layout>;
}

function LoginRoute() {
  const { data: user, isLoading } = useUser();
  if (isLoading) return <FullScreenSpinner />;
  if (user) return <Redirect to="/dashboard" />;
  return <LoginPage />;
}

export function App() {
  const [location] = useLocation();

  return (
    <Switch>
      <Route path="/login" component={LoginRoute} />
      <Route path="/dashboard">
        <RequireAuth>
          <DashboardPage />
        </RequireAuth>
      </Route>
      <Route path="/messaging">
        <RequireAuth>
          <MessagingPage />
        </RequireAuth>
      </Route>
      <Route path="/directory">
        <RequireAuth>
          <DirectoryPage />
        </RequireAuth>
      </Route>
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route>
        {location !== '/login' ? <Redirect to="/dashboard" /> : null}
      </Route>
    </Switch>
  );
}
