import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Broadcast } from "@/lib/types";
import { Button, Card, EmptyCard, Field, Icon, PageWrap, SectionTitle } from "@/components/kit";

const SEV: Record<string, { tint: string; label: string }> = {
  info: { tint: "var(--status-active)", label: "Info" },
  urgent: { tint: "var(--status-pending)", label: "Urgent" },
  critical: { tint: "var(--status-rejected)", label: "Critical" },
};

export function Broadcasts() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const { data: broadcasts = [] } = useQuery<Broadcast[]>({ queryKey: ["/api/broadcasts"] });

  const send = useMutation({
    mutationFn: (severity: "urgent" | "critical") => api.post("/api/broadcasts", { message: msg, severity }),
    onSuccess: () => {
      setMsg("");
      qc.invalidateQueries({ queryKey: ["/api/broadcasts"] });
    },
  });

  return (
    <PageWrap>
      <Card style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="megaphone" size={18} color="var(--status-pending)" /> Send an emergency broadcast
        </div>
        <Field textarea rows={2} value={msg} onChange={setMsg} placeholder="Message delivered to every staff member, with acknowledgement tracking…" />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button variant="secondary" disabled={!msg} onClick={() => send.mutate("urgent")}>Send urgent</Button>
          <Button variant="destructive" disabled={!msg} onClick={() => send.mutate("critical")}>Send critical</Button>
        </div>
      </Card>

      <SectionTitle>Recent broadcasts</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {broadcasts.length === 0 && <EmptyCard icon="megaphone" title="No broadcasts yet" />}
        {broadcasts.map((b) => {
          const sev = SEV[b.severity] ?? SEV.urgent;
          return (
            <Card key={b.id} style={{ padding: 16, borderLeft: `3px solid ${sev!.tint}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: sev!.tint }}>{sev!.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>{new Date(b.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 14, marginTop: 6 }}>{b.message}</div>
            </Card>
          );
        })}
      </div>
    </PageWrap>
  );
}
