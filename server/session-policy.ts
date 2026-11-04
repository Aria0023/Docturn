/**
 * Per-org session policy (E2 — module `enterprise.sessionPolicy`).
 *
 * Three settings a hospital IT security review asks for, stored per
 * organization in `org_session_policy` and enforced by the gate below on
 * every authenticated `/api` request AND at the WebSocket upgrade:
 *
 *   idleMinutes    How long a session may sit idle. Enforced by the SESSION
 *                  STORE, not by a timer of ours: express-session is
 *                  `rolling`, so the cookie (and the store row's expiry) is
 *                  re-issued on every request — the gate simply sets this
 *                  request's `cookie.maxAge` to the org's window. The
 *                  platform default (15 minutes, `SESSION_POLICY.maxAgeMs`)
 *                  is what every org gets today and remains the default.
 *   absoluteHours  The longest a session may live however much traffic it
 *                  has. Counted from `user_sessions.issued_at` — when the
 *                  session was FIRST seen — so rolling the cookie cannot
 *                  extend it (its own `iat` is the fallback before the row
 *                  exists).
 *   maxConcurrent  How many sessions one person may hold at once. A new
 *                  session's first authenticated request evicts the OLDEST
 *                  live one, which is then told WHY: HTTP answers
 *                  401 { error: "session_ended", reason: "max_concurrent" }
 *                  and its live sockets close with 1008 "session_evicted".
 *
 * Cost when the module is OFF: one cached module lookup, no query. Nothing
 * below changes behaviour for an org that has not turned it on.
 *
 * NOT here: "sign out everywhere" (server/routes/session-policy.ts) is a
 * per-user epoch on the user row, enforced in server/auth.ts
 * resolveSessionUser, so it keeps working whatever this module is set to.
 */
import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { User } from "@shared/schema";
import { appendAudit } from "./audit.js";
import { SESSION_POLICY } from "./config.js";
import { isModuleEnabled } from "./modules.js";
import { parseSessionPrincipal, revokeOneSession } from "./auth.js";
import { storage } from "./storage.js";

export const SESSION_POLICY_MODULE = "enterprise.sessionPolicy";

/** The bounds a director may choose inside. Served to the card verbatim. */
export const SESSION_POLICY_BOUNDS = {
  idleMinutes: { min: 5, max: 480, default: SESSION_POLICY.maxAgeMs / 60_000 },
  maxConcurrent: { min: 1, max: 20 },
  absoluteHours: { min: 1, max: 720 },
} as const;

export interface StoredPolicy {
  idleMinutes: number | null;
  maxConcurrent: number | null;
  absoluteHours: number | null;
}
export interface EffectivePolicy {
  idleMinutes: number;
  maxConcurrent: number | null;
  absoluteHours: number | null;
}

/** Why a session was ended — the reason the client is given, verbatim. */
export type SessionEndReason = "idle_timeout" | "absolute_timeout" | "max_concurrent" | "sign_out_everywhere";

export const PLATFORM_DEFAULT_POLICY: EffectivePolicy = {
  idleMinutes: SESSION_POLICY.maxAgeMs / 60_000,
  maxConcurrent: null,
  absoluteHours: null,
};

/** SHA-256 of a session id. The id itself is never stored. */
export function sidHashOf(sid: string): string {
  return createHash("sha256").update("docturn.session:" + sid).digest("hex");
}

// Short cache, exactly like the module map: a policy change takes effect
// within 5 s on every instance without a query per request.
const cache = new Map<number, { at: number; stored: StoredPolicy | null }>();
const TTL_MS = 5_000;

export function invalidateSessionPolicy(orgId?: number): void {
  if (orgId == null) cache.clear();
  else cache.delete(orgId);
}

export async function storedSessionPolicy(orgId: number): Promise<StoredPolicy | null> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.stored;
  const row = await storage().getOrgSessionPolicy(orgId);
  const stored: StoredPolicy | null = row
    ? { idleMinutes: row.idleMinutes ?? null, maxConcurrent: row.maxConcurrent ?? null, absoluteHours: row.absoluteHours ?? null }
    : null;
  cache.set(orgId, { at: Date.now(), stored });
  return stored;
}

/** The stored policy over the platform default, bounds re-applied. */
export function effectiveFrom(stored: StoredPolicy | null): EffectivePolicy {
  const clamp = (v: number | null | undefined, b: { min: number; max: number }) =>
    v == null ? null : Math.min(b.max, Math.max(b.min, Math.floor(v)));
  return {
    idleMinutes: clamp(stored?.idleMinutes, SESSION_POLICY_BOUNDS.idleMinutes) ?? PLATFORM_DEFAULT_POLICY.idleMinutes,
    maxConcurrent: clamp(stored?.maxConcurrent, SESSION_POLICY_BOUNDS.maxConcurrent),
    absoluteHours: clamp(stored?.absoluteHours, SESSION_POLICY_BOUNDS.absoluteHours),
  };
}

export async function effectiveSessionPolicy(orgId: number): Promise<EffectivePolicy> {
  return effectiveFrom(await storedSessionPolicy(orgId));
}

/**
 * The idle window the client should arm its own auto-lock timer with, in
 * minutes — the org's when the module is on, else the platform's 15. Served
 * on GET /api/user / GET /api/session, and only when it DIFFERS from the
 * platform default, so an org that never touched the policy sees exactly the
 * body it saw before.
 */
export async function idleMinutesFor(orgId: number): Promise<number> {
  if (!(await isModuleEnabled(orgId, SESSION_POLICY_MODULE))) return PLATFORM_DEFAULT_POLICY.idleMinutes;
  return (await effectiveSessionPolicy(orgId)).idleMinutes;
}

export interface PolicyDecision {
  /** The org's idle window for this request (always set). */
  idleMs: number;
  /** Set when the session must end now. */
  endedBecause?: SessionEndReason;
}

/**
 * Apply the policy to one live session. Shared by the HTTP gate and the
 * WebSocket upgrade, so a session the gate ends cannot open a socket either.
 */
export async function applySessionPolicy(args: {
  user: Pick<User, "id" | "organizationId">;
  /** The express-session id, or null for a credential that is not a cookie session. */
  sid: string | null;
  /** The session's own issue time (epoch ms), used before the row exists. */
  issuedAt: number | null;
  /** A borrowed (impersonated / managed-org) session: counted for nobody. */
  borrowed: boolean;
}): Promise<PolicyDecision> {
  const fallback: PolicyDecision = { idleMs: SESSION_POLICY.maxAgeMs };
  if (!(await isModuleEnabled(args.user.organizationId, SESSION_POLICY_MODULE))) return fallback;
  const policy = await effectiveSessionPolicy(args.user.organizationId);
  const idleMs = policy.idleMinutes * 60_000;
  // A borrowed session belongs to the operator, not to the person whose
  // account it is signed in as: it must never evict that person's own
  // session, and the operator's portal is not "their" device.
  if (!args.sid || args.borrowed) return { idleMs };

  const hash = sidHashOf(args.sid);
  let row = await storage().getUserSession(hash);
  if (row?.revokedAt) {
    const reasons: Record<string, SessionEndReason> = {
      max_concurrent: "max_concurrent",
      absolute_timeout: "absolute_timeout",
      sign_out_everywhere: "sign_out_everywhere",
    };
    return { idleMs, endedBecause: reasons[row.revokedReason ?? ""] ?? "absolute_timeout" };
  }
  if (!row) {
    row = await storage().upsertUserSession({
      organizationId: args.user.organizationId,
      userId: args.user.id,
      sidHash: hash,
    });
    // Opportunistic cleanup of rows no live cookie can belong to (one DELETE
    // on the rare first-request path, never on the hot path).
    void storage().pruneUserSessions(new Date(Date.now() - 30 * 24 * 3600_000)).catch(() => {});
  } else if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
    // Touched at most once a minute: the idle window is ≥ 5 minutes, so a
    // row can be at most a minute stale and still orders evictions correctly.
    await storage().touchUserSession(hash);
  }

  const startedAt = row.issuedAt?.getTime() ?? args.issuedAt ?? Date.now();
  if (policy.absoluteHours != null && Date.now() - startedAt > policy.absoluteHours * 3600_000) {
    await storage().revokeUserSessionById(row.id, "absolute_timeout");
    revokeOneSession({ userId: args.user.id, sidHash: hash, reason: "session_expired" });
    return { idleMs, endedBecause: "absolute_timeout" };
  }

  if (policy.maxConcurrent != null) {
    const live = await storage().listLiveUserSessions(args.user.id, new Date(Date.now() - idleMs));
    if (live.length > policy.maxConcurrent) {
      // Oldest first: evict until the person is inside their allowance.
      const doomed = live.slice(0, live.length - policy.maxConcurrent);
      for (const s of doomed) {
        const gone = await storage().revokeUserSessionById(s.id, "max_concurrent");
        if (!gone) continue;
        void appendAudit({
          organizationId: args.user.organizationId,
          userId: args.user.id,
          action: "auth.session_evicted",
          resourceType: "user",
          resourceId: args.user.id,
          details: { reason: "max_concurrent", maxConcurrent: policy.maxConcurrent, live: live.length },
          riskLevel: "low",
        });
      }
      // This request's own session may be one of the evicted ones when a
      // stale clock or a concurrent sign-in ordered it last.
      if (doomed.some((s) => s.sidHash === hash)) return { idleMs, endedBecause: "max_concurrent" };
      // Close the evicted sessions' live sockets now, everywhere.
      for (const s of doomed) revokeOneSession({ userId: args.user.id, sidHash: s.sidHash, reason: "session_evicted" });
    }
  }
  return { idleMs };
}

/**
 * The `/api` gate. Mounted after session + passport (so the principal and
 * `req.user` are resolved) and before every other gate: a session the policy
 * has ended must not be able to do anything else first.
 *
 * `GET /api/session` and `POST /api/logout` are answered normally after the
 * session is destroyed — the probe's job is to say "signed out", not to fail —
 * everything else gets 401 { error: "session_ended", reason } so the client
 * can tell the person why they are back at the sign-in screen.
 */
/**
 * Paths the gate never touches, because they ARE re-authentication: a person
 * whose session was just ended (evicted, past the absolute maximum, signed
 * out everywhere) must be able to sign in again from the same browser, and
 * the dead cookie it still carries must not refuse that request.
 */
const SIGN_IN_PATHS = /^\/(login|register)\/?$|^\/2fa(\/|$)/;

/**
 * Paths that are answered NORMALLY after the ended session is destroyed: the
 * session probe's job is to say "signed out", not to fail, and sign-out must
 * always succeed.
 */
const REASON_PASSTHROUGH = /^\/(session|logout)\/?$/;

/**
 * Passport DELETES `session.passport.user` when deserializeUser refuses a
 * session, so by the time the gate runs there is nothing left to say which
 * session it was. This remembers the principal on the request BEFORE
 * passport looks at it; mount it between the session middleware and
 * `passport.session()`.
 */
export function rememberSessionPrincipal(): RequestHandler {
  return (req, res, next) => {
    const sess = req.session as (typeof req.session & { passport?: { user?: unknown } }) | undefined;
    const principal = parseSessionPrincipal(sess?.passport?.user);
    if (principal) (res.locals as { sessionPrincipal?: unknown }).sessionPrincipal = principal;
    next();
  };
}

/**
 * The idle window in force for THIS request (the org's, else the platform's).
 * Written by the gate; read by the app lock so both use one number.
 */
export function idleWindowMsOf(res: Response): number {
  const v = (res.locals as { idleWindowMs?: number }).idleWindowMs;
  return typeof v === "number" && v > 0 ? v : SESSION_POLICY.maxAgeMs;
}

/** The principal this request arrived with, even if it was since refused. */
function principalOf(req: Request, res: Response): { id: number; pg: number; iat?: number } | null {
  const remembered = (res.locals as { sessionPrincipal?: { id: number; pg: number; iat?: number } }).sessionPrincipal;
  if (remembered) return remembered;
  const sess = req.session as (typeof req.session & { passport?: { user?: unknown } }) | undefined;
  return parseSessionPrincipal(sess?.passport?.user);
}

export function sessionPolicyGate(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (SIGN_IN_PATHS.test(req.path)) return next();
      const principal = principalOf(req, res);
      if (!principal) return next();
      const me = req.user as unknown as User | undefined;

      if (!me) {
        // Something upstream already refused this session. Say why when the
        // reason is one of ours, so the client shows it instead of a generic
        // "your session expired".
        const row = await storage().getUserById(principal.id);
        const at = row?.sessionsRevokedAt ? new Date(row.sessionsRevokedAt).getTime() : 0;
        if (at && (principal.iat ?? 0) < at) return endSession(req, res, next, "sign_out_everywhere");
        return next();
      }

      const decision = await applySessionPolicy({
        user: me,
        sid: req.sessionID ?? null,
        issuedAt: principal.iat ?? null,
        borrowed: typeof req.session?.impersonatorId === "number",
      });
      // The idle window is the SESSION STORE's expiry: rolling re-issues the
      // cookie with this maxAge on every request.
      if (req.session?.cookie) req.session.cookie.maxAge = decision.idleMs;
      // The app lock counts its own deadline in the SAME window (server/auth.ts
      // appLockGate / POST /api/session/lock), so a 5-minute org does not keep
      // a locked session alive for 15.
      (res.locals as { idleWindowMs?: number }).idleWindowMs = decision.idleMs;
      if (decision.endedBecause) return endSession(req, res, next, decision.endedBecause);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function endSession(req: Request, res: Response, next: NextFunction, reason: SessionEndReason) {
  const finish = () => {
    if (REASON_PASSTHROUGH.test(req.path)) return next();
    return res.status(401).json({ error: "session_ended", reason });
  };
  // passport's logOut regenerates the session, so the ended one is gone.
  if (typeof req.logout === "function") {
    req.logout((err) => {
      if (err) return next(err);
      (req as unknown as { user?: unknown }).user = undefined;
      finish();
    });
  } else {
    finish();
  }
}
