import { ServerResponse, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { RequestHandler } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "../storage.js";
import { configureNotifications, type WsFanout } from "../services/notifications.js";
import { demoConnectionId, demoTokenLockedAt, resolveDemoUser } from "../demoAuth.js";
import {
  APP_LOCK_CLOSE_CODE,
  onSessionLocked,
  onSessionsRevoked,
  resolveImpersonator,
  resolveSessionUser,
} from "../auth.js";

/**
 * WebSocket server mounted at /ws. On connect it runs the SAME express-session
 * middleware against the upgrade request to resolve the session → userId +
 * organizationId, then stores the socket in a `clients` map keyed by userId.
 * Connections that fail session resolution close with code 1008. All fan-out is
 * tenant-scoped.
 *
 * Session validity is decided by the same rule as HTTP (server/auth.ts
 * resolveSessionUser) for cookie sessions and demo bearer tokens alike: a
 * deactivated account or a session/token issued before the user's last
 * password change never connects, and when a password is changed or reset the
 * hub closes that user's live sockets (code 1008 "session_revoked") except the
 * ones belonging to the session (or token) that made the change.
 *
 * A developer's borrowed (impersonated / managed-org) session is held to the
 * DEVELOPER's credential as well (server/auth.ts resolveImpersonator): it
 * does not connect once the developer's password has changed or the
 * developer was deactivated, and each socket remembers its impersonator so a
 * password change, reset or deactivation of the developer closes the
 * borrowed portals' sockets too — not only the sockets signed in as them.
 *
 * App lock (A.CON-SHO-7): a locked session (or demo token) never connects —
 * the upgrade is closed with 4423 "session_locked" — and locking a session
 * closes its open sockets the same way, so nothing is pushed to a locked tab
 * and nothing it receives can make it re-fetch. 4423 is not 1008: the client
 * keeps its lock screen instead of treating the session as dead.
 */

interface ClientMeta {
  userId: number;
  organizationId: number;
  /** express-session id the socket authenticated with, or a demo token's demoConnectionId(). */
  sessionId: string | null;
  /** The developer behind a borrowed (impersonated / managed-org) session, else null. */
  impersonatorId: number | null;
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
  private unsubscribeRevoker: () => void;
  private unsubscribeLock: () => void;

  constructor(
    server: HttpServer,
    private sessionMiddleware: RequestHandler,
  ) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
    this.unsubscribeRevoker = onSessionsRevoked((r) =>
      r.all
        ? this.closeAllSockets({ exceptSessionId: r.exceptSessionId })
        : this.closeUserSockets(r.userId, { exceptSessionId: r.exceptSessionId }),
    );
    this.unsubscribeLock = onSessionLocked((e) => this.closeSessionSockets(e.userId, e.connectionId));
    this.startHeartbeat();
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage) {
    const session = await this.resolveSession(req);
    if (session === "locked") {
      ws.close(APP_LOCK_CLOSE_CODE, "session_locked");
      return;
    }
    if (!session) {
      ws.close(1008, "unauthorized");
      return;
    }
    const { userId, organizationId, sessionId, impersonatorId } = session;
    this.meta.set(ws, {
      userId,
      organizationId,
      sessionId,
      impersonatorId,
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
  ): Promise<
    { userId: number; organizationId: number; sessionId: string | null; impersonatorId: number | null } | "locked" | null
  > {
    // Demo-token auth (side-by-side console): the socket carries ?token=<t> so a
    // pane authenticates without the shared session cookie. Check it first.
    // Same rule as a cookie session (resolveDemoUser → resolveSessionUser): a
    // token issued before the user's last password change, or of a
    // deactivated account, does not connect.
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token");
      if (token) {
        const user = await resolveDemoUser(token);
        if (user) {
          if (demoTokenLockedAt(token) != null) return "locked";
          return {
            userId: user.id,
            organizationId: user.organizationId,
            sessionId: demoConnectionId(token),
            impersonatorId: null, // a token is never a borrowed session
          };
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
          const r = req as {
            session?: {
              passport?: { user?: unknown };
              appLock?: { userId?: number; at?: number };
              impersonatorId?: number;
              impersonatorPg?: number;
            };
            sessionID?: string;
          };
          // ONE rule for "is this session still signed in" — shared with
          // Passport's deserializeUser, so the realtime feed can never outlive
          // the HTTP session (deactivation, password change/reset)…
          const user = await resolveSessionUser(r.session?.passport?.user);
          if (!user) return resolve(null);
          // …including, for a borrowed session, the developer behind it.
          const imp = await resolveImpersonator(r.session);
          if (imp.state === "revoked") return resolve(null);
          // A locked session gets no realtime feed (A.CON-SHO-7).
          if (r.session?.appLock?.userId === user.id) return resolve("locked");
          resolve({
            userId: user.id,
            organizationId: user.organizationId,
            sessionId: r.sessionID ?? null,
            impersonatorId: imp.state === "ok" ? imp.developer.id : null,
          });
        } catch {
          resolve(null);
        }
      });
    });
  }

  /**
   * Close every live socket of a user (1008 "session_revoked") — the sockets
   * signed in AS them and the sockets of every borrowed (impersonated /
   * managed-org) session they opened as a developer — optionally sparing the
   * sockets of one session, the one that changed the password.
   * Returns how many sockets were closed.
   */
  /**
   * Close every live socket on this instance (1008 "session_revoked") — the
   * operator's "Sign out all" — sparing only the operator's own session.
   */
  closeAllSockets(opts: { exceptSessionId?: string } = {}): number {
    let closed = 0;
    for (const set of [...this.clients.values()]) {
      for (const ws of [...set]) {
        const m = this.meta.get(ws);
        if (m && opts.exceptSessionId && m.sessionId === opts.exceptSessionId) continue;
        try {
          ws.close(1008, "session_revoked");
        } catch {
          ws.terminate();
        }
        closed++;
      }
    }
    return closed;
  }

  closeUserSockets(userId: number, opts: { exceptSessionId?: string } = {}): number {
    let closed = 0;
    for (const set of [...this.clients.values()]) {
      for (const ws of [...set]) {
        const m = this.meta.get(ws);
        if (!m || (m.userId !== userId && m.impersonatorId !== userId)) continue;
        if (opts.exceptSessionId && m.sessionId === opts.exceptSessionId) continue;
        try {
          ws.close(1008, "session_revoked");
        } catch {
          ws.terminate();
        }
        closed++;
      }
    }
    return closed;
  }

  /** Close the sockets of ONE session (it was locked): 4423 "session_locked". */
  closeSessionSockets(userId: number, sessionId: string): number {
    const set = this.clients.get(userId);
    if (!set) return 0;
    let closed = 0;
    for (const ws of [...set]) {
      if (this.meta.get(ws)?.sessionId !== sessionId) continue;
      try {
        ws.close(APP_LOCK_CLOSE_CODE, "session_locked");
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

  /**
   * Live, authenticated sockets on THIS instance right now, and how many
   * distinct users hold them (developer console → System health).
   */
  stats(): { connections: number; users: number } {
    let connections = 0;
    for (const set of this.clients.values()) connections += set.size;
    return { connections, users: this.clients.size };
  }

  close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.unsubscribeRevoker();
    this.unsubscribeLock();
    this.wss.close();
    if (liveHub === this) liveHub = null;
  }
}

/** The hub serving this process (null until attached, and after close). */
let liveHub: WsHub | null = null;

/**
 * This instance's live socket count, or null when no hub is attached (e.g. a
 * process serving HTTP only) — never a made-up number.
 */
export function liveSocketStats(): { connections: number; users: number } | null {
  return liveHub ? liveHub.stats() : null;
}

/** Attach a WS hub to the HTTP server and route notifications through it. */
export function attachWebSocket(
  server: HttpServer,
  sessionMiddleware: RequestHandler,
): WsHub {
  const hub = new WsHub(server, sessionMiddleware);
  configureNotifications({ ws: hub });
  liveHub = hub;
  return hub;
}
