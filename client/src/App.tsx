import { Route, Switch } from "wouter";
import { useAuth } from "@/lib/auth";
import { WebSocketProvider } from "@/lib/ws";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Messaging } from "@/pages/Messaging";
import { Directory } from "@/pages/Directory";
import { Settings } from "@/pages/Settings";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <WebSocketProvider>
      <AppShell>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/messages" component={Messaging} />
          <Route path="/directory" component={Directory} />
          <Route path="/settings" component={Settings} />
          <Route>
            <div className="text-sm text-muted-foreground">Not found.</div>
          </Route>
        </Switch>
      </AppShell>
    </WebSocketProvider>
  );
}
