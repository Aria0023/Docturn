import { useAuth } from "@/lib/auth";
import { HospitalistDashboard } from "./HospitalistDashboard";
import { ERDashboard } from "./ERDashboard";
import { ErDirectorDashboard } from "./ErDirectorDashboard";
import { DirectorDashboard } from "./DirectorDashboard";
import { DevConsole } from "./DevConsole";

// Picks the right dashboard for the signed-in role.
export function Dashboard() {
  const { user } = useAuth();
  switch (user?.role) {
    case "hospitalist":
      return <HospitalistDashboard />;
    case "er_doctor":
      return <ERDashboard />;
    case "er_director":
      return <ErDirectorDashboard />;
    case "director":
      return <DirectorDashboard />;
    case "developer":
      return <DevConsole />;
    default:
      return null;
  }
}
