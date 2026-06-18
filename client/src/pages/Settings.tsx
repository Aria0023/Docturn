import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader } from "@/components/ui";

interface SettingsResponse {
  org: {
    assignmentTimeoutMin?: number;
    roundRobinShiftTypes?: string[];
    rotationMode?: string;
  };
}

export function Settings() {
  const { user } = useAuth();
  const { data } = useQuery<SettingsResponse>({ queryKey: ["/api/settings"] });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader title="My account" />
        <dl className="divide-y divide-border">
          <Row label="Name" value={user?.displayName} />
          <Row label="Username" value={user?.username} />
          <Row label="Role" value={user?.role?.replace("_", " ")} />
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="Organization policy"
          subtitle={
            user?.role === "director"
              ? "Editable on the director dashboard"
              : "Read-only for your role"
          }
        />
        <dl className="divide-y divide-border">
          <Row
            label="Assignment timeout"
            value={
              data?.org.assignmentTimeoutMin
                ? `${data.org.assignmentTimeoutMin} min`
                : "—"
            }
          />
          <Row label="Rotation mode" value={data?.org.rotationMode ?? "—"} />
          <Row
            label="Round-robin shifts"
            value={data?.org.roundRobinShiftTypes?.join(", ") ?? "—"}
          />
        </dl>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium capitalize">{value ?? "—"}</dd>
    </div>
  );
}
