import { ServerResponse, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { RequestHandler } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "../storage.js";
import { configureNotifications, type WsFanout } from "../services/notifications.js";
import { resolveDemoUserId } from "../demoAuth.js";

/**
 * WebSocket server mounted at /ws. On connect it runs the SAME express-session
 * middleware against the upgrade request to resolve the session → userId +
 * organizationId, then stores the socket in a `clients` map keyed by userId.
 * Connections that fail session resolution close with code 1008. All fan-out is
 * tenant-scoped.
 */

interface ClientMeta {
  userId: number;
  organizationId: number;
  isAlive: boolean;
  /** When this socket last had a typing event relayed (throttle clock). */
  typingLastAt: number;
  /** The typing state that was last relayed for this socket. */
  typingLastState: boolean | null;
}

const HEARTBEAT_MS = 20_000;
/**
 * Per-socket floor between relayed typing events. A real keyboard produces one
 * typing_start then a typing_stop ~2.5 s later; anything faster is a flood,
 * and every relayed event costs one conversation lookup plus a fan-out.
 */
export const TYPING_MIN_INTERVAL_MS = 500;

export class WsHub implements WsFanout {
  private wss: WebSocketServer;
  /** userId → set of sockets (a user may have multiple tabs/devices). */
  private clients = new Map<number, Set<WebSocket>>();
  private meta = new WeakMap<WebSocket, ClientMeta>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    server: HttpServer,
    private sessionMiddleware: RequestHandler,
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.startHeartbeat();
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage) {
    const session = await this.resolveSession(req);
    if (!session) {
      ws.close(1008, "unauthorized");
      return;
    }
    const { userId, organizationId } = session;
    this.meta.set(ws, {
      userId,
      organizationId,
      isAlive: true,
      typingLastAt: 0,
      typingLastState: null,
    });
    if (!this.clients.has(userId)) this.clients.set(userId, new Set());
    this.clients.get(userId)!.add(ws);

    ws.send(
      JSON.stringify({
        type: "CONNECTION_ESTABLISHED",
        userId,
        connectionId: `${userId}-${Date.now()}`,
      }),
    );

    // Presence: announce online to the tenant.
    this.broadcast(organizationId, {
      type: "USER_PRESENCE_CHANGED",
      userId,
      online: true,
    });

    ws.on("pong", () => {
      const m = this.meta.get(ws);
      if (m) m.isAlive = true;
    });

    ws.on("message", (data) => this.onMessage(ws, data.toString()));
    ws.on("close", () => this.onClose(ws));
    ws.on("error", () => this.onClose(ws));
  }

  private onMessage(ws: WebSocket, raw: string) {
    const m = this.meta.get(ws);
    if (!m) return;
    let msg: { type?: string; conversationId?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case "PING":
        ws.send(JSON.stringify({ type: "PONG" }));
        break;
      case "typing_start":
      case "typing_stop": {
        // Relay typing intent to the OTHER participants of the conversation —
        // resolved server-side from the sender's own org. Any participant list
        // the client sends is ignored: it used to be trusted verbatim, which
        // let a socket push typing events to any user in any tenant.
        const conversationId = msg.conversationId;
        if (!Number.isInteger(conversationId) || (conversationId as number) <= 0) break;
        const typing = msg.type === "typing_start";
        // Throttle BEFORE the lookup so a flood never amplifies into database
        // reads or fan-out. A start→stop transition always gets through once,
        // so a peer is never left showing "typing…" because the stop was dropped.
        const now = Date.now();
        const stopAfterStart = !typing && m.typingLastState === true;
        if (now - m.typingLastAt < TYPING_MIN_INTERVAL_MS && !stopAfterStart) break;
        m.typingLastAt = now;
        m.typingLastState = typing;
        void this.relayTyping(m, conversationId as number, typing);
        break;
      }
      default:
        break;
    }
  }

  /** Org-scoped lookup; the sender must be a member; fan out to the rest. */
  private async relayTyping(m: ClientMeta, conversationId: number, typing: boolean) {
    try {
      const convo = await storage().getConversation(m.organizationId, conversationId);
      if (!convo || !convo.participantIds.includes(m.userId)) return;
      this.sendToUsers(
        convo.participantIds.filter((id) => id !== m.userId),
        { type: "user_typing", userId: m.userId, conversationId, typing },
      );
    } catch {
      /* a failed lookup drops the event — typing is best-effort */
    }
  }

  private onClose(ws: WebSocket) {
    const m = this.meta.get(ws);
    if (!m) return;
    const set = this.clients.get(m.userId);
    set?.delete(ws);
    const stillOnline = set && set.size > 0;
    if (!stillOnline) {
      this.clients.delete(m.userId);
      this.broadcast(m.organizationId, {
        type: "USER_PRESENCE_CHANGED",
        userId: m.userId,
        online: false,
      });
    }
    this.meta.delete(ws);
  }

  /** Resolve the session by replaying the session middleware on the upgrade req. */
  private async resolveSession(
    req: IncomingMessage,
  ): Promise<{ userId: number; organizationId: number } | null> {
    // Demo-token auth (side-by-side console): the socket carries ?token=<t> so a
    // pane authenticates without the shared session cookie. Check it first.
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token");
      if (token) {
        const uid = resolveDemoUserId(token);
        if (uid != null) {
          const user = await storage().getUserById(uid);
          if (user) return { userId: user.id, organizationId: user.organizationId };
        }
      }
    } catch {
      /* fall through to cookie session */
    }
    return new Promise((resolve) => {
      // A real ServerResponse gives express-session the methods it wraps
      // (setHeader/end/on) without us mocking them.
      const res = new ServerResponse(req);
      this.sessionMiddleware(req as never, res as never, async () => {
        try {
          const sess = (req as { session?: { passport?: { user?: number } } })
            .session;
          const userId = sess?.passport?.user;
          if (!userId) return resolve(null);
          const user = await storage().getUserById(userId);
          if (!user) return resolve(null);
          resolve({ userId: user.id, organizationId: user.organizationId });
        } catch {
          resolve(null);
        }
      });
    });
  }

  private startHeartbeat() {
    this.heartbeat = setInterval(() => {
      for (const set of this.clients.values()) {
        for (const ws of set) {
          const m = this.meta.get(ws);
          if (!m) continue;
          if (!m.isAlive) {
            ws.terminate();
            continue;
          }
          m.isAlive = false;
          try {
            ws.ping();
          } catch {
            /* ignore */
          }
        }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  // ── WsFanout ───────────────────────────────────────────────────────────────
  sendToUsers(userIds: number[], message: unknown) {
    const payload = JSON.stringify(message);
    for (const uid of new Set(userIds)) {
      const set = this.clients.get(uid);
      if (!set) continue;
      for (const ws of set) {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }
    }
  }

  broadcast(orgId: number, message: unknown) {
    const payload = JSON.stringify(message);
    for (const set of this.clients.values()) {
      for (const ws of set) {
        const m = this.meta.get(ws);
        if (m?.organizationId === orgId && ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    }
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.wss.close();
  }
}

/** Attach a WS hub to the HTTP server and route notifications through it. */
export function attachWebSocket(
  server: HttpServer,
  sessionMiddleware: RequestHandler,
): WsHub {
  const hub = new WsHub(server, sessionMiddleware);
  configureNotifications({ ws: hub });
  return hub;
}
