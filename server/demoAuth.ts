import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { User } from "@shared/schema";
import {
  onSessionsRevoked,
  resolveSessionUser,
  sessionPrincipalFor,
  type BearerCredential,
  type SessionPrincipal,
} from "./auth.js";

/**
 * Demo-only, URL/header bearer-token auth — the enabler for the side-by-side
 * "3 users on one screen" demo console. A normal browser shares ONE session
 * cookie per origin, so three portals in one page would all be the same user.
 * Tokens live in memory and are passed per-iframe (?token= / Authorization:
 * Bearer), giving each pane its own identity WITHOUT touching the cookie
 * session auth that the real app uses. Issuance still requires valid demo
 * credentials and is gated to non-production (see the /api/demo/login route).
 *
 * A token is a session like any other (A.CON-SHO-16): it is bound at issue to
 * the user's password generation — the same { id, pg } principal a cookie
 * session stores — and every use resolves it through resolveSessionUser(), so
 * a password change or reset, or a deactivation, ends it on HTTP and on the
 * WebSocket alike. Revoked tokens are also dropped from memory eagerly.
 */
const tokens = new Map<string, SessionPrincipal>(); // token -> { id, pg }

export function issueDemoToken(user: { id: number; passwordChangedAt?: Date | string | null }): string {
  const t = randomBytes(24).toString("hex");
  tokens.set(t, sessionPrincipalFor(user));
  return t;
}

/**
 * The session id a token's live sockets carry (WS ClientMeta.sessionId), so a
 * password change made THROUGH a token can spare that token's own sockets.
 * Derived, never the token itself.
 */
export function demoConnectionId(token: string): string {
  return "demo:" + createHash("sha256").update(token).digest("hex").slice(0, 32);
}

/** Resolve a token to its LIVE user, or null (unknown, stale generation, deactivated). */
export async function resolveDemoUser(token: string): Promise<User | null> {
  const principal = tokens.get(token);
  if (!principal) return null;
  const user = await resolveSessionUser(principal);
  // A stale token never comes back (re-mint with the current password). Only
  // forget it if it was not re-stamped meanwhile by the change it lost to.
  if (!user && tokens.get(token) === principal) tokens.delete(token);
  return user;
}

// A password change / reset drops the user's other tokens at once (the
// generation check above would refuse them anyway on their next use).
onSessionsRevoked(({ userId, exceptSessionId }) => {
  for (const [t, p] of tokens) {
    if (p.id === userId && demoConnectionId(t) !== exceptSessionId) tokens.delete(t);
  }
});

/**
 * Express middleware: when an explicit demo token is present (Authorization:
 * Bearer <t> or ?token=<t>) and resolves to a user, attach it as req.user so
 * requireAuth/currentUser work. An explicit token OVERRIDES any session cookie
 * so each iframe pane is reliably its own user. No token, or one that no
 * longer resolves → no-op (cookie auth proceeds untouched).
 */
export function demoTokenAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      const m = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
      const q = typeof req.query.token === "string" ? req.query.token : null;
      const token = m ? m[1] : q;
      if (!token) return next();
      const user = await resolveDemoUser(token);
      if (user) {
        (req as unknown as { user: unknown }).user = user;
        const credential: BearerCredential = {
          connectionId: demoConnectionId(token),
          restamp: (u) => {
            tokens.set(token, sessionPrincipalFor(u));
          },
        };
        (res.locals as { bearerCredential?: BearerCredential }).bearerCredential = credential;
      }
    } catch {
      /* fall through as unauthenticated */
    }
    next();
  };
}
