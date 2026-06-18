import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Assignment, Hospitalist, Patient } from "@/lib/types";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Stat,
  StatusBadge,
} from "@/components/ui";

export function HospitalistDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: pending = [] } = useQuery<Assignment[]>({
    queryKey: ["/api/assignments/pending"],
  });
  const { data: mine = [] } = useQuery<Assignment[]>({
    queryKey: ["/api/assignments/my"],
  });
  const { data: hospitalists = [] } = useQuery<Hospitalist[]>({
    queryKey: ["/api/hospitalists"],
  });
  const { data: patients = [] } = useQuery<Patient[]>({
    queryKey: ["/api/patients"],
  });

  const me = hospitalists.find((h) => h.userId === user?.id);
  const patientById = new Map(patients.map((p) => [p.id, p]));

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "accept" | "reject" }) =>
      api.patch(`/api/assignments/${id}/${action}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/assignments/pending"] });
      qc.invalidateQueries({ queryKey: ["/api/assignments/my"] });
      qc.invalidateQueries({ queryKey: ["/api/hospitalists"] });
    },
  });

  const toggleWorking = useMutation({
    mutationFn: (working: boolean) =>
      api.patch(`/api/hospitalists/${me?.id}/working-status`, { working }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/hospitalists"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My dashboard</h1>
        {me && (
          <Button
            variant={me.working ? "secondary" : "primary"}
            onClick={() => toggleWorking.mutate(!me.working)}
          >
            {me.working ? "On shift — go off" : "Off shift — go on"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Census" value={me?.currentPatientCount ?? "—"} />
        <Stat label="Cap" value={me?.patientCap ?? "—"} />
        <Stat label="Pending" value={pending.length} />
        <Stat label="Accepted" value={mine.length} />
      </div>

      <Card>
        <CardHeader title="Pending requests" subtitle="Accept or decline" />
        {pending.length === 0 ? (
          <EmptyState message="No pending requests right now." />
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((a) => {
              const p = patientById.get(a.patientId);
              return (
                <li key={a.id} className="flex items-center gap-4 px-6 py-4">
                  <Avatar initials={p?.initials ?? "??"} />
                  <div className="flex-1">
                    <div className="font-semibold">
                      {p?.initials ?? "Patient"}{" "}
                      {p?.roomNumber && (
                        <span className="text-muted-foreground">
                          · Room {p.roomNumber}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {p?.issueSummary ?? "—"}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        respond.mutate({ id: a.id, action: "accept" })
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        respond.mutate({ id: a.id, action: "reject" })
                      }
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="My patients" subtitle="Accepted assignments" />
        {mine.length === 0 ? (
          <EmptyState message="No accepted patients yet." />
        ) : (
          <ul className="divide-y divide-border">
            {mine.map((a) => {
              const p = patientById.get(a.patientId);
              return (
                <li key={a.id} className="flex items-center gap-4 px-6 py-4">
                  <Avatar initials={p?.initials ?? "??"} />
                  <div className="flex-1">
                    <div className="font-semibold">{p?.initials}</div>
                    <div className="text-sm text-muted-foreground">
                      {p?.issueSummary}
                    </div>
                  </div>
                  <StatusBadge status="accepted" />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-bold text-foreground">
      {initials}
    </div>
  );
}
