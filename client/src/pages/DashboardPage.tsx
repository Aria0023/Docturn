import { useUser } from '@/hooks/useAuth';
import { HospitalistDashboard } from '@/components/dashboards/HospitalistDashboard';
import { ERDoctorDashboard } from '@/components/dashboards/ERDoctorDashboard';
import { DirectorDashboard } from '@/components/dashboards/DirectorDashboard';
import { DeveloperDashboard } from '@/components/dashboards/DeveloperDashboard';

export function DashboardPage() {
  const { data: user } = useUser();
  if (!user) return null;

  switch (user.role) {
    case 'hospitalist':
      return <HospitalistDashboard />;
    case 'er_doctor':
      return <ERDoctorDashboard />;
    case 'director':
    case 'er_director':
      return <DirectorDashboard />;
    case 'developer':
      return <DeveloperDashboard />;
    default:
      return (
        <div className="text-sm text-slate-500">
          No dashboard available for your role.
        </div>
      );
  }
}
