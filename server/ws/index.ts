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
  /** HTTP session the socket was opened under (absent for demo-token panes). */
  sessionId?: string;
  isAlive: boolean;
}

/** The slice of an express-session store the hub needs to re-check a session. */
export interface SessionLookup {
  get(
    sid: string,
    cb: (err: unknown, session?: { passport?: { user?: number } } | null) => void,
  ): void;
}

/** Close code sent when the HTTP session behind a socket has ended. */
const WS_SESSION_ENDED = 4401;

const HEARTBEAT_MS = 20_000;

export class WsHub implements WsFanout {
  private wss: WebSocketServer;
  /** userId → set of sockets (a user may have multiple tabs/devices). */
  private clients = new Map<number, Set<WebSocket>>();
  private meta = new WeakMap<WebSocket, ClientMeta>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    server: HttpServer,
    private sessionMiddleware: RequestHandler,
    private sessionStore?: SessionLookup,
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
    const { userId, organizationId, sessionId } = session;
    this.meta.set(ws, { userId, organizationId, sessionId, isAlive: true });
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
    let msg: { type?: string; conversationId?: number; participantIds?: number[] };
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
        // Relay typing intent to the other participants of the conversation.
        // The id list comes from the client, so deliver only to sockets in the
        // sender's own tenant — never let it address users in another org.
        const ids = Array.isArray(msg.participantIds) ? msg.participantIds : [];
        const targets = ids
          .filter((id) => Number.isInteger(id) && id !== m.userId)
          .slice(0, 100);
        this.sendToUsers(
          targets,
          {
            type: "user_typing",
            userId: m.userId,
            conversationId: msg.conversationId,
            typing: msg.type === "typing_start",
          },
          m.organizationId,
        );
        break;
      }
      default:
        break;
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
  ): Promise<{ userId: number; organizationId: number; sessionId?: string } | null> {
    // Demo-token auth (side-by-side console): the socket carries ?token=<t> so a
    // pane authenticates without the shared session cookie. Check it first.
    // Non-production only, matching where tokens can be issued.
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const token =
        process.env.NODE_ENV === "production" ? null : url.searchParams.get("token");
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
          resolve({
            userId: user.id,
            organizationId: user.organizationId,
            sessionId: (req as { sessionID?: string }).sessionID,
          });
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
          this.closeIfSessionEnded(ws, m);
        }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  /**
   * Automatic logoff for the realtime channel: a socket outlives the request
   * that opened it, so on each heartbeat confirm its HTTP session still exists
   * (not expired by inactivity, signed out, or swapped by impersonation) and
   * still belongs to the same user. Otherwise the tab would keep receiving the
   * tenant's feed indefinitely.
   */
  private closeIfSessionEnded(ws: WebSocket, m: ClientMeta) {
    if (!this.sessionStore || !m.sessionId) return;
    this.sessionStore.get(m.sessionId, (err, sess) => {
      if (err) return; // store hiccup: decide on the next beat
      if (sess?.passport?.user !== m.userId) {
        ws.close(WS_SESSION_ENDED, "session_ended");
      }
    });
  }

  // ── WsFanout ───────────────────────────────────────────────────────────────
  /** When `orgId` is given, sockets belonging to any other tenant are skipped. */
  sendToUsers(userIds: number[], message: unknown, orgId?: number) {
    const payload = JSON.stringify(message);
    for (const uid of new Set(userIds)) {
      const set = this.clients.get(uid);
      if (!set) continue;
      for (const ws of set) {
        if (orgId !== undefined && this.meta.get(ws)?.organizationId !== orgId) continue;
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }
    }
  }

  disconnectSession(sessionId: string) {
    for (const set of this.clients.values()) {
      for (const ws of set) {
        if (this.meta.get(ws)?.sessionId === sessionId) {
          ws.close(WS_SESSION_ENDED, "session_ended");
        }
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
  sessionStore?: SessionLookup,
): WsHub {
  const hub = new WsHub(server, sessionMiddleware, sessionStore);
  configureNotifications({ ws: hub });
  return hub;
}
