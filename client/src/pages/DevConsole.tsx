import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, CardHeader, EmptyState, Input } from "@/components/ui";

interface Org {
  id: number;
  name: string;
  code: string;
}

export function DevConsole() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [, navigate] = useLocation();
  const { data: orgs = [] } = useQuery<Org[]>({
    queryKey: ["/api/dev/organizations"],
  });
  const { data: diag } = useQuery<{ extractor: string; liveAi: boolean }>({
    queryKey: ["/api/dev/ai-diagnostics"],
  });

  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const createOrg = useMutation({
    mutationFn: () => api.post("/api/dev/organizations", { name, code }),
    onSuccess: () => {
      setName("");
      setCode("");
      qc.invalidateQueries({ queryKey: ["/api/dev/organizations"] });
    },
  });

  // Enter an org as its senior admin (audited server-side session swap), then
  // re-read the now-swapped session and land on that tenant's dashboard.
  const enterOrg = useMutation({
    mutationFn: (orgId: number) => api.post("/api/dev/manage-org", { orgId }),
    onSuccess: async () => {
      await refresh();
      navigate("/");
    },
  });

  return (
    <div className="space-y-6" style={{ padding: 28, maxWidth: 1040, margin: "0 auto" }}>
      <h1 className="text-2xl font-bold">Developer console</h1>

      <Card>
        <CardHeader title="AI diagnostics" />
        <div className="p-6 text-sm">
          <div>
            Extractor: <span className="font-mono">{diag?.extractor ?? "—"}</span>
          </div>
          <div>
            Live AI:{" "}
            <span className="font-semibold">
              {diag?.liveAi ? "enabled" : "stub (no key)"}
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Organizations" subtitle="Cross-tenant administration" />
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-6">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Code</span>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <Button
            disabled={!name || !code || createOrg.isPending}
            onClick={() => createOrg.mutate()}
          >
            Create org
          </Button>
        </div>
        {orgs.length === 0 ? (
          <EmptyState message="No organizations." />
        ) : (
          <ul className="divide-y divide-border">
            {orgs.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-6 py-3">
                <span className="font-mono text-sm">{o.code}</span>
                <span className="text-sm">{o.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  #{o.id}
                </span>
                <Button
                  variant="secondary"
                  disabled={enterOrg.isPending}
                  onClick={() => enterOrg.mutate(o.id)}
                >
                  Enter
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
