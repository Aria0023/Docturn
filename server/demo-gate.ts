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
 * A link carries its own end date, signed with the key, so it keeps working
 * when the server's database is reset (a demo host without a persistent
 * database starts empty on every restart). The database holds what is nice
 * to know and what can change: who the link is for, when it was used, and
 * whether it was revoked. After a reset an unexpired link is listed again as
 * "restored"; a revocation made before the reset is forgotten, so on such a
 * host the way to end every link for certain is to change the key.
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

const mac = (body: string, env: NodeJS.ProcessEnv) => createHmac("sha256", signingKey(env)).update(body).digest("base64url");
/** The pass cookie: which invitation (its token hash, or "owner") and until when. */
function sign(ref: string, expMs: number, env: NodeJS.ProcessEnv): string {
  const body = `v2.${ref}.${expMs}`;
  return body + "." + mac(body, env);
}
function verify(value: string | undefined, env: NodeJS.ProcessEnv, now: number): { ref: string; expMs: number } | null {
  const m = /^v2\.(owner|[a-f0-9]{64})\.(\d{10,15})\.([A-Za-z0-9_-]{20,})$/.exec(value ?? "");
  if (!m) return null;
  const ref = m[1]!, expMs = Number(m[2]);
  if (!same(sign(ref, expMs, env), value!) || expMs <= now) return null;
  return { ref, expMs };
}
/** An invitation link's token: random part, end date, signature. */
function mintToken(expMs: number, env: NodeJS.ProcessEnv): string {
  const body = `${randomBytes(18).toString("base64url")}.${expMs}`;
  return body + "." + mac("invite." + body, env);
}
function readToken(token: string, env: NodeJS.ProcessEnv): { expMs: number } | null {
  const m = /^([A-Za-z0-9_-]{24})\.(\d{10,15})\.([A-Za-z0-9_-]{20,})$/.exec(token);
  if (!m || !same(mac(`invite.${m[1]}.${m[2]}`, env), m[3]!)) return null;
  return { expMs: Number(m[2]) };
}
const RESTORED = "Restored after a server restart";
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
const live = new Map<string, { ok: boolean; id: number; at: number }>();
/** The invitation's row, re-created if the database was reset since the link was made. */
async function rowFor(hash: string, expMs: number) {
  const row = await storage().getDemoInviteByHash(hash);
  if (row) return row;
  try {
    return await storage().createDemoInvite({ tokenHash: hash, label: RESTORED, createdBy: null, expiresAt: new Date(expMs) });
  } catch {
    return storage().getDemoInviteByHash(hash); // another request restored it first
  }
}
async function inviteStillGood(ref: string, expMs: number, now: number): Promise<{ ok: boolean; id: number }> {
  if (ref === "owner") return { ok: true, id: 0 }; // the operator's own key
  const c = live.get(ref);
  if (c && now - c.at < 20_000) return c;
  const row = await rowFor(ref, expMs);
  const state = { ok: !!row && !row.revokedAt && new Date(row.expiresAt).getTime() > now, id: row?.id ?? -1, at: now };
  live.set(ref, state);
  return state;
}
const usage = new Map<string, { start: number; n: number; warned: boolean; touched: number }>();
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
      const good = pass ? await inviteStillGood(pass.ref, pass.expMs, now) : null;
      if (pass && good && good.ok) {
        const owner = pass.ref === "owner";
        let u = usage.get(pass.ref);
        if (!u || now - u.start > WINDOW_MS) usage.set(pass.ref, (u = { start: now, n: 0, warned: false, touched: u?.touched ?? 0 }));
        u.n++;
        if (!owner && u.n > DEMO_RATE_LIMIT) {
          if (!u.warned) {
            u.warned = true;
            console.warn(`[demo-gate] invitation ${good.id} exceeded ${DEMO_RATE_LIMIT} requests in 5 minutes; slowing it down`);
          }
          res.setHeader("Retry-After", String(Math.ceil((u.start + WINDOW_MS - now) / 1000)));
          return res.status(429).json({ error: "demo_rate_limited" });
        }
        if (!owner && now - u.touched > 60_000) {
          u.touched = now;
          void storage().touchDemoInvite(good.id, new Date(now)).catch(() => {});
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

function setPass(req: Request, res: Response, ref: string, expMs: number, env: NodeJS.ProcessEnv) {
  res.cookie(DEMO_COOKIE, sign(ref, expMs, env), {
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
      setPass(req, res, "owner", now + OWNER_DAYS * 86_400_000, env);
      return res.redirect(302, "/");
    }
    // The link proves its own end date; the database says whether it was revoked.
    const signed = readToken(token, env);
    if (!signed || signed.expMs <= now) return res.redirect(302, "/home?demo=expired");
    const hash = hashToken(token);
    const row = await rowFor(hash, signed.expMs);
    if (!row || row.revokedAt) return res.redirect(302, "/home?demo=expired");
    await storage().recordDemoVisit(row.id, new Date(now));
    live.delete(hash);
    setPass(req, res, hash, signed.expMs, env);
    return res.redirect(302, "/");
  });

  const dev = requireRole("developer");
  const view = (r: Awaited<ReturnType<ReturnType<typeof storage>["listDemoInvites"]>>[number], now: number) => ({
    id: r.id, label: r.label, createdAt: r.createdAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt,
    firstUsedAt: r.firstUsedAt, lastSeenAt: r.lastSeenAt, visits: r.visits, restored: r.label === RESTORED,
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
    if (!demoGateOn(env)) return res.status(409).json({ error: "demo_gate_off" });
    const expMs = Date.now() + days * 86_400_000;
    const token = mintToken(expMs, env);
    const row = await storage().createDemoInvite({ tokenHash: hashToken(token), label, createdBy: me.id, expiresAt: new Date(expMs) });
    res.setHeader("Cache-Control", "no-store");
    // The link is returned once and never again.
    res.status(201).json({ invite: view(row, Date.now()), path: "/demo-access/" + token });
  });

  app.delete("/api/dev/demo-invites/:id", requireAuth, dev, async (req, res) => {
    const id = Number(req.params.id);
    const row = Number.isInteger(id) && id > 0 ? await storage().revokeDemoInvite(id, new Date()) : undefined;
    if (!row) return res.status(404).json({ error: "not_found" });
    live.delete(row.tokenHash);
    res.status(204).end();
  });
}
