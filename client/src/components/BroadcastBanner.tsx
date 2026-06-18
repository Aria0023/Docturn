import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { api } from "@/lib/api";
import { useWs } from "@/lib/ws";
import type { Broadcast } from "@/lib/types";

const SEVERITY_BG: Record<string, string> = {
  info: "var(--status-active)",
  urgent: "var(--status-pending)",
  critical: "var(--status-rejected)",
};

// Listens for BROADCAST_CREATED over WS and surfaces an acknowledgeable banner.
export function BroadcastBanner() {
  const { subscribe } = useWs();
  const [active, setActive] = useState<Broadcast | null>(null);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "BROADCAST_CREATED") setActive(msg.broadcast);
    });
  }, [subscribe]);

  if (!active) return null;

  async function ack() {
    if (active) await api.post(`/api/broadcasts/${active.id}/ack`).catch(() => {});
    setActive(null);
  }

  return (
    <div
      className="flex items-center gap-3 px-6 py-3 text-sm font-semibold text-white"
      style={{ background: SEVERITY_BG[active.severity] ?? SEVERITY_BG.urgent }}
      role="alert"
    >
      <AlertTriangle size={18} />
      <span className="uppercase tracking-wide">{active.severity}</span>
      <span className="flex-1 font-medium">{active.message}</span>
      <button
        onClick={ack}
        className="rounded bg-white/20 px-3 py-1 hover:bg-white/30"
      >
        Acknowledge
      </button>
      <button onClick={() => setActive(null)} aria-label="dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
