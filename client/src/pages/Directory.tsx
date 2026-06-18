import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { DirectoryEntry } from "@/lib/types";
import { Card, EmptyState, Input } from "@/components/ui";

export function Directory() {
  const [q, setQ] = useState("");
  const { data: entries = [] } = useQuery<DirectoryEntry[]>({
    queryKey: ["/api/physicians/directory"],
  });

  const filtered = entries.filter(
    (e) =>
      e.displayName.toLowerCase().includes(q.toLowerCase()) ||
      e.specialty.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Directory</h1>

      <div className="relative max-w-sm">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="pl-9"
          placeholder="Search by name or specialty…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState message="No providers match." />
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((e) => (
            <Card key={e.id} className="p-5">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-sm font-bold">
                    {e.displayName
                      .split(" ")
                      .map((p) => p[0])
                      .slice(-2)
                      .join("")}
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
                    style={{
                      background: e.working
                        ? "var(--status-accepted)"
                        : "var(--status-neutral)",
                    }}
                  />
                </div>
                <div>
                  <div className="font-semibold">
                    {e.displayName}
                    {e.credential && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {e.credential}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {e.specialty}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs capitalize text-muted-foreground">
                {e.working ? `On shift · ${e.shiftType}` : "Off shift"}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
