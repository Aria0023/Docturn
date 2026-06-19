import { Route, Switch } from "wouter";
import { useAuth } from "@/lib/auth";
import { WebSocketProvider } from "@/lib/ws";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Messaging } from "@/pages/Messaging";
import { Directory } from "@/pages/Directory";
import { Settings } from "@/pages/Settings";
import { PatientBoard } from "@/pages/PatientBoard";
import { CareTeamScreen } from "@/pages/CareTeamScreen";
import { Broadcasts } from "@/pages/Broadcasts";
import { Compliance } from "@/pages/Compliance";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", fontSize: 14 }}>
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
          <Route path="/board" component={PatientBoard} />
          <Route path="/team" component={CareTeamScreen} />
          <Route path="/broadcasts" component={Broadcasts} />
          <Route path="/messages" component={Messaging} />
          <Route path="/directory" component={Directory} />
          <Route path="/compliance" component={Compliance} />
          <Route path="/settings" component={Settings} />
          <Route>
            <div style={{ padding: 28, color: "var(--muted-foreground)" }}>Not found.</div>
          </Route>
        </Switch>
      </AppShell>
    </WebSocketProvider>
  );
}
