import { ServerResponse, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { RequestHandler } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "../storage.js";
import { configureNotifications, type WsFanout } from "../services/notifications.js";
import { resolveDemoUserId } from "../demoAuth.js";
import { onSessionsRevoked, resolveSessionUser } from "../auth.js";

/**
 * WebSocket server mounted at /ws. On connect it runs the SAME express-session
 * middleware against the upgrade request to resolve the session → userId +
 * organizationId, then stores the socket in a `clients` map keyed by userId.
 * Connections that fail session resolution close with code 1008. All fan-out is
 * tenant-scoped.
 *
 * Session validity is decided by the same rule as HTTP (server/auth.ts
 * resolveSessionUser): a deactivated account or a session issued before the
 * user's last password change never connects, and when a password is changed
 * or reset the hub closes that user's live sockets (code 1008
 * "session_revoked") except the one belonging to the session that made the
 * change.
 */

interface ClientMeta {
  userId: number;
  organizationId: number;
  /** express-session id the socket authenticated with; null for demo tokens. */
  sessionId: string | null;
  isAlive: boolean;
}

const HEARTBEAT_MS = 20_000;

export class WsHub implements WsFanout {
  private wss: WebSocketServer;
  /** userId → set of sockets (a user may have multiple tabs/devices). */
  private clients = new Map<number, Set<WebSocket>>();
  private meta = new WeakMap<WebSocket, ClientMeta>();
  private heartbeat: NodeJS.Timeout | null = null;
  private unsubscribeRevoker: () => void;

  constructor(
    server: HttpServer,
    private sessionMiddleware: RequestHandler,
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.unsubscribeRevoker = onSessionsRevoked((r) =>
      this.closeUserSockets(r.userId, { exceptSessionId: r.exceptSessionId }),
    );
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
        const targets = (msg.participantIds ?? []).filter((id) => id !== m.userId);
        this.sendToUsers(targets, {
          type: "user_typing",
          userId: m.userId,
          conversationId: msg.conversationId,
          typing: msg.type === "typing_start",
        });
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
  ): Promise<{ userId: number; organizationId: number; sessionId: string | null } | null> {
    // Demo-token auth (side-by-side console): the socket carries ?token=<t> so a
    // pane authenticates without the shared session cookie. Check it first.
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token");
      if (token) {
        const uid = resolveDemoUserId(token);
        if (uid != null) {
          const user = await storage().getUserById(uid);
          if (user && !user.disabledAt) {
            return { userId: user.id, organizationId: user.organizationId, sessionId: null };
          }
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
          const r = req as { session?: { passport?: { user?: unknown } }; sessionID?: string };
          // ONE rule for "is this session still signed in" — shared with
          // Passport's deserializeUser, so the realtime feed can never outlive
          // the HTTP session (deactivation, password change/reset).
          const user = await resolveSessionUser(r.session?.passport?.user);
          if (!user) return resolve(null);
          resolve({
            userId: user.id,
            organizationId: user.organizationId,
            sessionId: r.sessionID ?? null,
          });
        } catch {
          resolve(null);
        }
      });
    });
  }

  /**
   * Close every live socket of a user (1008 "session_revoked"), optionally
   * sparing the sockets of one session — the one that changed the password.
   * Returns how many sockets were closed.
   */
  closeUserSockets(userId: number, opts: { exceptSessionId?: string } = {}): number {
    const set = this.clients.get(userId);
    if (!set) return 0;
    let closed = 0;
    for (const ws of [...set]) {
      const m = this.meta.get(ws);
      if (opts.exceptSessionId && m?.sessionId === opts.exceptSessionId) continue;
      try {
        ws.close(1008, "session_revoked");
      } catch {
        ws.terminate();
      }
      closed++;
    }
    return closed;
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
    this.unsubscribeRevoker();
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
