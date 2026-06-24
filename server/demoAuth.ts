import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { storage } from "./storage.js";

/**
 * Demo-only, URL/header bearer-token auth — the enabler for the side-by-side
 * "3 users on one screen" demo console. A normal browser shares ONE session
 * cookie per origin, so three portals in one page would all be the same user.
 * Tokens live in memory and are passed per-iframe (?token= / Authorization:
 * Bearer), giving each pane its own identity WITHOUT touching the cookie
 * session auth that the real app uses. Issuance still requires valid demo
 * credentials and is gated to non-production (see registerDemoLogin).
 */
const tokens = new Map<string, number>(); // token -> userId

export function issueDemoToken(userId: number): string {
  const t = randomBytes(24).toString("hex");
  tokens.set(t, userId);
  return t;
}

export function resolveDemoUserId(token: string): number | undefined {
  return tokens.get(token);
}

/**
 * Express middleware: when an explicit demo token is present (Authorization:
 * Bearer <t> or ?token=<t>) and resolves to a user, attach it as req.user so
 * requireAuth/currentUser work. An explicit token OVERRIDES any session cookie
 * so each iframe pane is reliably its own user. No token → no-op (cookie auth
 * proceeds untouched).
 */
export function demoTokenAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization;
      const m = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
      const q = typeof req.query.token === "string" ? req.query.token : null;
      const token = m ? m[1] : q;
      if (!token) return next();
      const uid = resolveDemoUserId(token);
      if (uid == null) return next();
      const user = await storage().getUserById(uid);
      if (user) (req as unknown as { user: unknown }).user = user;
    } catch {
      /* fall through as unauthenticated */
    }
    next();
  };
}
