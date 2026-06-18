import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BoardRow } from "@/lib/types";
import { Card, EmptyState, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/cn";

const DEPARTMENTS = ["ALL", "ER", "ICU", "MED", "TELE"];

export function PatientBoard() {
  const [dept, setDept] = useState("ALL");
  const path =
    dept === "ALL" ? "/api/patient-board" : `/api/patient-board?department=${dept}`;
  const { data: rows = [] } = useQuery<BoardRow[]>({ queryKey: [path] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Patient board</h1>
        <div className="flex gap-1 rounded-md border border-border bg-card p-1">
          {DEPARTMENTS.map((d) => (
            <button
              key={d}
              onClick={() => setDept(d)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium",
                dept === d
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState message="No distributed patients." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-6 py-2 font-medium">Patient</th>
                <th className="px-6 py-2 font-medium">Responsible</th>
                <th className="px-6 py-2 font-medium">Consultants</th>
                <th className="px-6 py-2 font-medium">Admitted by</th>
                <th className="px-6 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.patient.id} className="border-b border-border last:border-0">
                  <td className="px-6 py-3">
                    <div className="font-semibold">
                      {r.patient.initials}
                      {r.patient.room && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {r.patient.room}
                        </span>
                      )}
                      {r.patient.department && (
                        <span className="ml-2 rounded bg-secondary px-1.5 text-xs">
                          {r.patient.department}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.patient.issue}
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    {r.responsible?.attending ? (
                      <div className="flex items-center gap-1">
                        <Avatar name={r.responsible.attending.displayName} />
                        {r.responsible.unit.map((u) => (
                          <Avatar key={u.userId} name={u.displayName} small />
                        ))}
                        <span className="ml-1 text-xs">
                          {r.responsible.attending.displayName}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs italic text-muted-foreground">
                        Routing…
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    {r.consultants.length ? (
                      <div className="flex flex-wrap gap-1">
                        {r.consultants.map((c, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-status-active-bg px-2 py-0.5 text-xs font-semibold text-status-active"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {r.admittedBy?.displayName ?? "—"}
                  </td>
                  <td className="px-6 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Avatar({ name, small }: { name: string; small?: boolean }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-secondary font-bold ring-2 ring-card",
        small ? "h-6 w-6 text-[10px]" : "h-7 w-7 text-xs",
      )}
    >
      {initials}
    </div>
  );
}
