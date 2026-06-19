import { useEffect, useState } from "react";
import { useWs } from "@/lib/ws";
import { Icon } from "./kit";

interface Notif {
  id: number;
  icon: string;
  title: string;
  body: string;
}

const LABELS: Record<string, { icon: string; title: string; body: (m: any) => string }> = {
  ASSIGNMENT_CREATED: { icon: "clipboard-plus", title: "New assignment", body: () => "A patient was routed to you." },
  ASSIGNMENT_UPDATED: { icon: "refresh-cw", title: "Assignment updated", body: () => "An assignment changed status." },
  MESSAGE_RECEIVED: { icon: "message-square", title: "New message", body: (m) => m.message?.content ?? "You have a new message." },
  BROADCAST_CREATED: { icon: "megaphone", title: "Broadcast", body: (m) => m.broadcast?.message ?? "Emergency broadcast." },
  CARE_TEAM_UPDATED: { icon: "users-round", title: "Care team", body: () => "Your on-call unit changed." },
};

export function NotificationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { subscribe } = useWs();
  const [items, setItems] = useState<Notif[]>([]);

  useEffect(() => {
    let n = 0;
    return subscribe((msg) => {
      const def = LABELS[msg.type];
      if (!def) return;
      setItems((prev) =>
        [{ id: ++n, icon: def.icon, title: def.title, body: def.body(msg) }, ...prev].slice(0, 20),
      );
    });
  }, [subscribe]);

  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <div style={{ position: "fixed", top: 58, right: 18, width: 344, zIndex: 41, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", overflow: "hidden" }}>
        <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Notifications</span>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{items.length} recent</span>
        </div>
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {items.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>
              You're all caught up.
            </div>
          )}
          {items.map((n, i) => (
            <div key={n.id} style={{ display: "flex", gap: 11, padding: "12px 16px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              <span style={{ width: 32, height: 32, borderRadius: "var(--radius-md)", background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <Icon name={n.icon} size={16} color="var(--primary)" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{n.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
