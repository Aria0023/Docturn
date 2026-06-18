import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Hospitalist, User } from "@/lib/types";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Stat,
} from "@/components/ui";

interface OrgConfig {
  assignmentTimeoutMin: number;
  roundRobinShiftTypes: string[];
  rotationMode: string;
}

export function DirectorDashboard() {
  const qc = useQueryClient();

  const { data: hospitalists = [] } = useQuery<Hospitalist[]>({
    queryKey: ["/api/hospitalists"],
  });
  const { data: users = [] } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: config } = useQuery<OrgConfig>({
    queryKey: ["/api/org/config"],
  });

  const userById = new Map(users.map((u) => [u.id, u]));

  const toggle = useMutation({
    mutationFn: ({ id, working }: { id: number; working: boolean }) =>
      api.patch(`/api/hospitalists/${id}/working-status`, { working }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/hospitalists"] }),
  });
  const bulk = useMutation({
    mutationFn: (working: boolean) =>
      api.patch(`/api/hospitalists/0/working-status`, { all: working }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/hospitalists"] }),
  });
  const setCap = useMutation({
    mutationFn: ({ id, patientCap }: { id: number; patientCap: number }) =>
      api.patch(`/api/physicians/${id}/capacity`, { patientCap }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/hospitalists"] }),
  });
  const resetRotation = useMutation({
    mutationFn: () => api.post("/api/round-robin/reset"),
  });
  const setTimeout_ = useMutation({
    mutationFn: (assignmentTimeoutMin: number) =>
      api.patch("/api/org/config", { assignmentTimeoutMin }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/org/config"] }),
  });

  const working = hospitalists.filter((h) => h.working).length;
  const totalCensus = hospitalists.reduce(
    (s, h) => s + h.currentPatientCount,
    0,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Director dashboard</h1>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Providers" value={hospitalists.length} />
        <Stat label="On shift" value={working} />
        <Stat label="Total census" value={totalCensus} />
        <Stat label="Timeout (min)" value={config?.assignmentTimeoutMin ?? "—"} />
      </div>

      <Card>
        <CardHeader
          title="Providers"
          subtitle="Census, cap, and working status"
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => bulk.mutate(true)}>
                All on
              </Button>
              <Button variant="secondary" onClick={() => bulk.mutate(false)}>
                All off
              </Button>
            </div>
          }
        />
        {hospitalists.length === 0 ? (
          <EmptyState message="No providers yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-6 py-2 font-medium">Provider</th>
                <th className="px-6 py-2 font-medium">Specialty</th>
                <th className="px-6 py-2 font-medium">Census / Cap</th>
                <th className="px-6 py-2 font-medium">Shift</th>
                <th className="px-6 py-2 font-medium">Working</th>
              </tr>
            </thead>
            <tbody>
              {hospitalists.map((h) => (
                <tr key={h.id} className="border-b border-border last:border-0">
                  <td className="px-6 py-3 font-semibold">
                    {userById.get(h.userId)?.displayName ?? `#${h.id}`}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {h.specialty}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{h.currentPatientCount}</span>
                      <span className="text-muted-foreground">/</span>
                      <button
                        className="rounded border border-border px-2"
                        onClick={() =>
                          setCap.mutate({
                            id: h.id,
                            patientCap: Math.max(1, h.patientCap - 1),
                          })
                        }
                      >
                        −
                      </button>
                      <span className="font-mono">{h.patientCap}</span>
                      <button
                        className="rounded border border-border px-2"
                        onClick={() =>
                          setCap.mutate({
                            id: h.id,
                            patientCap: h.patientCap + 1,
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-3 capitalize text-muted-foreground">
                    {h.shiftType}
                  </td>
                  <td className="px-6 py-3">
                    <button
                      onClick={() =>
                        toggle.mutate({ id: h.id, working: !h.working })
                      }
                      className="relative h-6 w-11 rounded-full transition-colors"
                      style={{
                        background: h.working
                          ? "var(--status-accepted)"
                          : "var(--status-neutral-bg)",
                      }}
                      aria-label="toggle working"
                    >
                      <span
                        className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all"
                        style={{ left: h.working ? "22px" : "2px" }}
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <CardHeader title="Round-robin configuration" />
        <div className="flex flex-wrap items-center gap-3 p-6">
          <label className="text-sm font-medium">Timeout (min)</label>
          <input
            type="number"
            min={1}
            max={120}
            defaultValue={config?.assignmentTimeoutMin}
            className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
            onBlur={(e) => setTimeout_.mutate(Number(e.target.value))}
          />
          <span className="text-sm text-muted-foreground">
            Mode: <span className="font-semibold">{config?.rotationMode}</span>
          </span>
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => resetRotation.mutate()}
          >
            Reset rotation cursor
          </Button>
        </div>
      </Card>
    </div>
  );
}
