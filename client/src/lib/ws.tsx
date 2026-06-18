import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";

type Listener = (msg: any) => void;

interface WsState {
  send: (msg: unknown) => void;
  subscribe: (fn: Listener) => () => void;
}

const WsContext = createContext<WsState | null>(null);

/**
 * Streams server events and reconciles cached queries. On each event we
 * invalidate the affected query keys so TanStack refetches; on reconnect we
 * invalidate everything so missed events reconcile (exponential backoff).
 */
export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef(new Set<Listener>());
  const backoff = useRef(1000);

  useEffect(() => {
    if (!user) return;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        backoff.current = 1000;
        // Reconcile any events missed while disconnected.
        qc.invalidateQueries();
      };
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        route(msg, qc);
        for (const fn of listeners.current) fn(msg);
      };
      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = setTimeout(connect, backoff.current);
        backoff.current = Math.min(backoff.current * 2, 15_000);
      };
      ws.onerror = () => ws.close();
    }
    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [user, qc]);

  const value: WsState = {
    send: (msg) => wsRef.current?.send(JSON.stringify(msg)),
    subscribe: (fn) => {
      listeners.current.add(fn);
      return () => listeners.current.delete(fn);
    },
  };
  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
}

function route(msg: any, qc: ReturnType<typeof useQueryClient>) {
  switch (msg.type) {
    case "ASSIGNMENT_CREATED":
    case "ASSIGNMENT_UPDATED":
      qc.invalidateQueries({ queryKey: ["/api/assignments/pending"] });
      qc.invalidateQueries({ queryKey: ["/api/assignments/my"] });
      qc.invalidateQueries({ queryKey: ["/api/patients"] });
      break;
    case "MESSAGE_RECEIVED":
      qc.invalidateQueries({ queryKey: ["/api/messaging/conversations"] });
      if (msg.message?.conversationId) {
        qc.invalidateQueries({
          queryKey: [
            `/api/messaging/conversations/${msg.message.conversationId}/messages`,
          ],
        });
      }
      break;
    case "PROVIDER_CREATED":
    case "PROVIDER_UPDATED":
    case "HOSPITALIST_DELETED":
      qc.invalidateQueries({ queryKey: ["/api/hospitalists"] });
      break;
    default:
      break;
  }
}

export function useWs() {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs must be used within WebSocketProvider");
  return ctx;
}
