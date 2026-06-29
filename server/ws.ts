import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseCookie } from './cookie.js';
import { SqliteSessionStore } from './session-store.js';
import { userStore } from './storage.js';

interface ClientMeta {
  ws: WebSocket;
  userId: number;
  orgId: number;
  isAlive: boolean;
}

// userId -> set of connections (a user may have multiple tabs/devices)
const clients = new Map<number, Set<ClientMeta>>();
const store = new SqliteSessionStore();

function unsign(raw: string): string {
  // express-session prefixes signed cookies with "s:". The signature follows a
  // ".". We only need the sid portion; the store validates existence/expiry.
  if (raw.startsWith('s:')) {
    const body = raw.slice(2);
    const dot = body.lastIndexOf('.');
    return dot >= 0 ? body.slice(0, dot) : body;
  }
  return raw;
}

function getSession(sid: string): Promise<any> {
  return new Promise((resolve) => {
    store.get(sid, (err, sess) => resolve(err ? null : sess));
  });
}

export function broadcast(orgId: number, msg: unknown) {
  const payload = JSON.stringify(msg);
  for (const set of clients.values()) {
    for (const c of set) {
      if (c.orgId === orgId && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    }
  }
}

/** Send to specific users; returns the userIds actually reached over WS. */
export function sendToUsers(userIds: number[], msg: unknown): number[] {
  const payload = JSON.stringify(msg);
  const reached: number[] = [];
  for (const userId of userIds) {
    const set = clients.get(userId);
    if (!set) continue;
    let any = false;
    for (const c of set) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
        any = true;
      }
    }
    if (any) reached.push(userId);
  }
  return reached;
}

export function presence(orgId: number): number[] {
  const online: number[] = [];
  for (const [userId, set] of clients.entries()) {
    for (const c of set) {
      if (c.orgId === orgId) {
        online.push(userId);
        break;
      }
    }
  }
  return online;
}

export function attachWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    try {
      const cookies = parseCookie(req.headers.cookie || '');
      const sidCookie = cookies['connect.sid'];
      if (!sidCookie) return ws.close(1008, 'no session');
      const sid = unsign(decodeURIComponent(sidCookie));
      const sess = await getSession(sid);
      const userId: number | undefined = sess?.passport?.user;
      if (!userId) return ws.close(1008, 'unauthenticated');
      const user = await userStore.getById(userId);
      if (!user) return ws.close(1008, 'unknown user');

      const meta: ClientMeta = { ws, userId, orgId: user.orgId, isAlive: true };
      if (!clients.has(userId)) clients.set(userId, new Set());
      clients.get(userId)!.add(meta);

      ws.send(JSON.stringify({ type: 'connected', userId, orgId: user.orgId }));
      broadcast(user.orgId, { type: 'presence.online', userId });

      ws.on('pong', () => {
        meta.isAlive = true;
      });
      ws.on('message', (raw) => {
        // Echo-style ping support; clients mostly receive.
        try {
          const data = JSON.parse(raw.toString());
          if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        } catch {
          /* ignore malformed */
        }
      });
      ws.on('close', () => {
        const set = clients.get(userId);
        if (set) {
          set.delete(meta);
          if (set.size === 0) {
            clients.delete(userId);
            broadcast(user.orgId, { type: 'presence.offline', userId });
          }
        }
      });
    } catch (err) {
      ws.close(1011, 'server error');
    }
  });

  // 20s heartbeat.
  const heartbeat = setInterval(() => {
    for (const set of clients.values()) {
      for (const c of set) {
        if (!c.isAlive) {
          c.ws.terminate();
          continue;
        }
        c.isAlive = false;
        try {
          c.ws.ping();
        } catch {
          /* ignore */
        }
      }
    }
  }, 20_000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}

export { clients };
