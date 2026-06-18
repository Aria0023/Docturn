import { useAuth } from "@/lib/auth";
import { HospitalistDashboard } from "./HospitalistDashboard";
import { ERDashboard } from "./ERDashboard";
import { DirectorDashboard } from "./DirectorDashboard";

// Picks the right dashboard for the signed-in role.
export function Dashboard() {
  const { user } = useAuth();
  switch (user?.role) {
    case "hospitalist":
      return <HospitalistDashboard />;
    case "er_doctor":
    case "er_director":
      return <ERDashboard />;
    case "director":
    case "developer":
      return <DirectorDashboard />;
    default:
      return null;
  }
}
