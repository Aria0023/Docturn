import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CareTeam, Candidate } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyCard, PageWrap, SectionTitle, StatusDot } from "@/components/kit";

export function CareTeamScreen() {
  const qc = useQueryClient();
  const { data: team } = useQuery<CareTeam>({ queryKey: ["/api/care-team"] });
  const { data: candidates = [] } = useQuery<Candidate[]>({ queryKey: ["/api/care-team/candidates"] });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/care-team"] });
    qc.invalidateQueries({ queryKey: ["/api/care-team/candidates"] });
  };
  const add = useMutation({ mutationFn: (memberUserId: number) => api.post("/api/care-team/members", { memberUserId }), onSuccess: invalidate });
  const toggle = useMutation({ mutationFn: ({ id, onCall }: { id: number; onCall: boolean }) => api.patch(`/api/care-team/members/${id}`, { onCall }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/care-team/members/${id}`), onSuccess: invalidate });

  return (
    <PageWrap>
      <SectionTitle>On-call unit</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
        {!team?.members.length && <EmptyCard icon="users-round" title="No unit members yet" subtitle="Link a midlevel or partner to share your on-call load." />}
        {team?.members.map((m, i) => (
          <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={initialsOf(m.displayName)} size={36} tint={m.onCall ? "emerald" : "slate"} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{m.displayName}</div>
              {m.credential && <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{m.credential}</div>}
            </div>
            <button onClick={() => toggle.mutate({ id: m.userId, onCall: !m.onCall })}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 500, width: 110, justifyContent: "center" }}>
              <StatusDot status={m.onCall ? "online" : "offline"} />
              {m.onCall ? "On call" : "Off call"}
            </button>
            <Button variant="ghost" size="sm" icon="trash-2" onClick={() => remove.mutate(m.userId)} style={{ color: "var(--destructive)" }}>Remove</Button>
          </div>
        ))}
      </Card>

      <SectionTitle>Add to your unit</SectionTitle>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {candidates.length === 0 && <EmptyCard icon="user-plus" title="No one to add" />}
        {candidates.map((c, i) => (
          <div key={c.userId} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <Avatar initials={initialsOf(c.displayName)} size={34} tint="slate" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{c.displayName}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{c.role.replace("_", " ")}</div>
            </div>
            {c.credential && <Badge variant="secondary">{c.credential}</Badge>}
            <Button size="sm" variant="outline" icon="plus" onClick={() => add.mutate(c.userId)}>Add</Button>
          </div>
        ))}
      </Card>
    </PageWrap>
  );
}

function initialsOf(name: string): string {
  return name.replace(/,.*$/, "").replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
