import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { currentUser, requireAuth, requireRole } from "./rbac.js";
import { isSyntheticDataMode } from "./seed.js";
import { storage } from "./storage.js";

/**
 * The demo is by invitation.
 *
 * On a demo instance with DEMO_ACCESS_KEY set, nothing of the app is served —
 * not a screen, not an API answer, not a line of its code — to a browser that
 * has not opened an invitation link. The public website (/home), its pricing
 * and its purchase form stay open; everything else answers with a redirect
 * to the website (pages) or 401 (the API).
 *
 *   • The operator makes links in the developer console: who it is for and
 *     how many days it lasts (7 by default, 30 at most). A link is shown once;
 *     only a hash of its token is stored. It can be revoked at any time.
 *   • Opening a link sets a signed, HttpOnly cookie that lasts as long as the
 *     invitation. Each invitation records when it was first used, when it was
 *     last seen and how many times the link was opened.
 *   • The operator's own way in is the key itself: /demo-access/<DEMO_ACCESS_KEY>.
 *   • One invitation making an unusual number of requests (someone copying
 *     the app with a script) is slowed down and noted in the server log.
 *
 * Off when the key is not set (local development, the test suite), and never
 * applied to an instance that holds real patient data: there, people have
 * their own accounts and this is not the control that protects them.
 *
 * This limits WHO can look. Someone invited can still describe or imitate
 * what they see; the invitation terms and an NDA are what address that.
 */
export const DEMO_COOKIE = "dt_demo";
const OWNER_DAYS = 30;
const MAX_DAYS = 30;
/** Requests one invitation may make in five minutes before it is slowed down. */
export const DEMO_RATE_LIMIT = 1500;
const WINDOW_MS = 5 * 60_000;

const keyOf = (env: NodeJS.ProcessEnv = process.env) => (env.DEMO_ACCESS_KEY ?? "").trim();
export function demoGateOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return isSyntheticDataMode() && keyOf(env).length >= 24;
}
const signingKey = (env: NodeJS.ProcessEnv) => createHash("sha256").update("docturn.demo-gate:" + keyOf(env)).digest();
export const hashDemoToken = (t: string) => createHash("sha256").update("docturn.demo-invite:" + t).digest("hex");
const hashToken = hashDemoToken;
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function sign(inviteId: number, expMs: number, env: NodeJS.ProcessEnv): string {
  const body = `v1.${inviteId}.${expMs}`;
  return body + "." + createHmac("sha256", signingKey(env)).update(body).digest("base64url");
}
function verify(value: string | undefined, env: NodeJS.ProcessEnv, now: number): { inviteId: number; expMs: number } | null {
  const m = /^v1\.(\d{1,9})\.(\d{10,15})\.([A-Za-z0-9_-]{20,})$/.exec(value ?? "");
  if (!m) return null;
  const inviteId = Number(m[1]), expMs = Number(m[2]);
  if (!same(sign(inviteId, expMs, env), value!) || expMs <= now) return null;
  return { inviteId, expMs };
}
function cookieOf(req: Request): string | undefined {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === DEMO_COOKIE) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** What stays open to everyone: the public website and what it needs. */
const OPEN = /^\/(?:home\/?$|pricing\/?$|site\/|api\/public\/|api\/health$|demo-access(?:\/|$)|robots\.txt$|favicon\.ico$|icons\/|\.well-known\/)/;

// Whether an invitation is still good, re-read from the database at most
// every 20 s so a revoked link stops working promptly without a query per request.
const live = new Map<number, { ok: boolean; at: number }>();
async function inviteStillGood(id: number, now: number): Promise<boolean> {
  if (id === 0) return true; // the operator's own key
  const c = live.get(id);
  if (c && now - c.at < 20_000) return c.ok;
  const row = await storage().getDemoInvite(id);
  const ok = !!row && !row.revokedAt && new Date(row.expiresAt).getTime() > now;
  live.set(id, { ok, at: now });
  return ok;
}
const usage = new Map<number, { start: number; n: number; warned: boolean; touched: number }>();
const attempts = new Map<string, { start: number; n: number }>();
/** Tests: forget cached invitation state and counters. */
export function _resetDemoGate() {
  live.clear();
  usage.clear();
  attempts.clear();
}

export function demoGate(env: NodeJS.ProcessEnv = process.env) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!demoGateOn(env) || OPEN.test(req.path)) return next();
      const now = Date.now();
      const pass = verify(cookieOf(req), env, now);
      if (pass && (await inviteStillGood(pass.inviteId, now))) {
        let u = usage.get(pass.inviteId);
        if (!u || now - u.start > WINDOW_MS) usage.set(pass.inviteId, (u = { start: now, n: 0, warned: false, touched: u?.touched ?? 0 }));
        u.n++;
        if (pass.inviteId !== 0 && u.n > DEMO_RATE_LIMIT) {
          if (!u.warned) {
            u.warned = true;
            console.warn(`[demo-gate] invitation ${pass.inviteId} exceeded ${DEMO_RATE_LIMIT} requests in 5 minutes; slowing it down`);
          }
          res.setHeader("Retry-After", String(Math.ceil((u.start + WINDOW_MS - now) / 1000)));
          return res.status(429).json({ error: "demo_rate_limited" });
        }
        if (pass.inviteId !== 0 && now - u.touched > 60_000) {
          u.touched = now;
          void storage().touchDemoInvite(pass.inviteId, new Date(now)).catch(() => {});
        }
        return next();
      }
      res.setHeader("Cache-Control", "no-store");
      if (req.path.startsWith("/api/") || req.path.startsWith("/scim/") || (req.method !== "GET" && req.method !== "HEAD")) {
        return res.status(401).json({ error: "demo_invite_required" });
      }
      return res.redirect(302, "/home?demo=invite");
    } catch (e) {
      next(e);
    }
  };
}

function setPass(req: Request, res: Response, inviteId: number, expMs: number, env: NodeJS.ProcessEnv) {
  res.cookie(DEMO_COOKIE, sign(inviteId, expMs, env), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    expires: new Date(expMs),
    path: "/",
  });
}

export function registerDemoGateRoutes(app: Express, env: NodeJS.ProcessEnv = process.env) {
  // Opening an invitation link. Wrong, expired and revoked links all land on
  // the same page; guessing is limited to 10 tries a minute per address.
  app.get("/demo-access/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!demoGateOn(env)) return res.redirect(302, "/");
    const now = Date.now();
    const ip = String(req.ip ?? "");
    let a = attempts.get(ip);
    if (!a || now - a.start > 60_000) attempts.set(ip, (a = { start: now, n: 0 }));
    if (++a.n > 10) return res.status(429).type("text/plain").send("Too many attempts. Try again in a minute.");
    const token = String(req.params.token ?? "");
    if (same(token, keyOf(env))) {
      setPass(req, res, 0, now + OWNER_DAYS * 86_400_000, env);
      return res.redirect(302, "/");
    }
    const row = /^[A-Za-z0-9_-]{30,80}$/.test(token) ? await storage().getDemoInviteByHash(hashToken(token)) : undefined;
    if (!row || row.revokedAt || new Date(row.expiresAt).getTime() <= now) return res.redirect(302, "/home?demo=expired");
    await storage().recordDemoVisit(row.id, new Date(now));
    live.delete(row.id);
    setPass(req, res, row.id, new Date(row.expiresAt).getTime(), env);
    return res.redirect(302, "/");
  });

  const dev = requireRole("developer");
  const view = (r: Awaited<ReturnType<ReturnType<typeof storage>["listDemoInvites"]>>[number], now: number) => ({
    id: r.id, label: r.label, createdAt: r.createdAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt,
    firstUsedAt: r.firstUsedAt, lastSeenAt: r.lastSeenAt, visits: r.visits,
    state: r.revokedAt ? "revoked" : new Date(r.expiresAt).getTime() <= now ? "expired" : "active",
  });

  app.get("/api/dev/demo-invites", requireAuth, dev, async (_req, res) => {
    const now = Date.now();
    res.setHeader("Cache-Control", "no-store");
    res.json({ gateOn: demoGateOn(env), synthetic: isSyntheticDataMode(), rateLimit: DEMO_RATE_LIMIT, invites: (await storage().listDemoInvites()).map((r) => view(r, now)) });
  });

  app.post("/api/dev/demo-invites", requireAuth, dev, async (req, res) => {
    const me = currentUser(req);
    const b = (req.body ?? {}) as { label?: unknown; days?: unknown };
    const label = typeof b.label === "string" ? b.label.trim() : "";
    const days = Number(b.days ?? 7);
    if (!label || label.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(label) || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      return res.status(400).json({ error: "validation_error" });
    }
    const token = randomBytes(30).toString("base64url");
    const row = await storage().createDemoInvite({ tokenHash: hashToken(token), label, createdBy: me.id, expiresAt: new Date(Date.now() + days * 86_400_000) });
    res.setHeader("Cache-Control", "no-store");
    // The link is returned once and never again.
    res.status(201).json({ invite: view(row, Date.now()), path: "/demo-access/" + token });
  });

  app.delete("/api/dev/demo-invites/:id", requireAuth, dev, async (req, res) => {
    const id = Number(req.params.id);
    const row = Number.isInteger(id) && id > 0 ? await storage().revokeDemoInvite(id, new Date()) : undefined;
    if (!row) return res.status(404).json({ error: "not_found" });
    live.delete(id);
    res.status(204).end();
  });
}
