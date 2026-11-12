import type { Express } from "express";
import { sessionPolicySchema, type User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { restampSession, revokeOneSession } from "../auth.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import {
  effectiveFrom,
  invalidateSessionPolicy,
  SESSION_POLICY_BOUNDS,
  sidHashOf,
  storedSessionPolicy,
} from "../session-policy.js";
import { storage } from "../storage.js";

/**
 * The director's session-policy card and "sign out everywhere"
 * (E2 — module `enterprise.sessionPolicy`; GATE_TABLE answers 404 while it is
 * off). The enforcement itself is server/session-policy.ts (every `/api`
 * request and the WebSocket upgrade) and server/auth.ts
 * (`resolveSessionUser`, for the per-user epoch).
 */

const POLICY_ROLES = ["director", "developer"] as const;

/**
 * End every session of `userId` except, optionally, the one making the
 * request. Two mechanisms on purpose:
 *   • users.sessions_revoked_at — the DURABLE one: every session issued
 *     before this moment stops resolving on its next HTTP request and at the
 *     socket upgrade, on every instance, and keeps doing so even if the
 *     module is switched off afterwards;
 *   • the live transports are closed NOW (revokeOneSession), so a socket does
 *     not sit open until its next reconnect.
 * The `user_sessions` rows are marked too, so the registry does not count a
 * dead session towards the person's maximum.
 */
async function signOutEverywhere(
  target: Pick<User, "id" | "organizationId">,
  opts: { keepSessionId?: string },
): Promise<number> {
  const at = new Date();
  const keepHash = opts.keepSessionId ? sidHashOf(opts.keepSessionId) : undefined;
  // The DURABLE epoch first: if anything fails after this, the sessions are
  // still over. Marking the registry rows is only bookkeeping for the
  // maximum-concurrent count.
  await storage().setUserSessionsRevokedAt(target.id, at);
  const ended = await storage().revokeUserSessions(target.id, "sign_out_everywhere", keepHash);
  revokeOneSession({
    userId: target.id,
    ...(opts.keepSessionId ? { exceptSessionId: opts.keepSessionId } : {}),
    reason: "sign_out_everywhere",
  });
  return ended;
}

export function registerSessionPolicyRoutes(app: Express) {
  // The card: what is stored, what is in force, and the bounds it may choose
  // inside — all from the server, so the card can never offer a value the
  // server would clamp.
  app.get("/api/org/session-policy", requireAuth, requireRole(...POLICY_ROLES), async (req, res) => {
    const me = currentUser(req);
    const stored = await storedSessionPolicy(me.organizationId);
    res.json({
      stored: !!stored,
      policy: stored ?? { idleMinutes: null, maxConcurrent: null, absoluteHours: null },
      effective: effectiveFrom(stored),
      limits: SESSION_POLICY_BOUNDS,
    });
  });

  app.put("/api/org/session-policy", requireAuth, requireRole(...POLICY_ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = sessionPolicySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const current = await storedSessionPolicy(me.organizationId);
    const next = {
      idleMinutes: parsed.data.idleMinutes !== undefined ? parsed.data.idleMinutes : current?.idleMinutes ?? null,
      maxConcurrent: parsed.data.maxConcurrent !== undefined ? parsed.data.maxConcurrent : current?.maxConcurrent ?? null,
      absoluteHours: parsed.data.absoluteHours !== undefined ? parsed.data.absoluteHours : current?.absoluteHours ?? null,
    };
    await storage().upsertOrgSessionPolicy({
      organizationId: me.organizationId,
      idleMinutes: next.idleMinutes,
      maxConcurrent: next.maxConcurrent,
      absoluteHours: next.absoluteHours,
      updatedBy: me.id,
    });
    invalidateSessionPolicy(me.organizationId);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "org.session_policy_set",
      resourceType: "organization",
      resourceId: me.organizationId,
      details: { ...next },
      riskLevel: "medium",
    });
    res.json({ stored: true, policy: next, effective: effectiveFrom(next), limits: SESSION_POLICY_BOUNDS });
  });

  // Back to the platform default (today's 15-minute idle timeout, no session
  // cap, no absolute maximum).
  app.delete("/api/org/session-policy", requireAuth, requireRole(...POLICY_ROLES), async (req, res) => {
    const me = currentUser(req);
    const existed = await storage().deleteOrgSessionPolicy(me.organizationId);
    invalidateSessionPolicy(me.organizationId);
    if (existed) {
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "org.session_policy_cleared",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: {},
        riskLevel: "medium",
      });
    }
    res.json({ stored: false, policy: { idleMinutes: null, maxConcurrent: null, absoluteHours: null }, effective: effectiveFrom(null), limits: SESSION_POLICY_BOUNDS });
  });

  // Self-service: "sign out everywhere else". THIS session continues — it is
  // re-stamped with an issue time after the epoch, exactly as a self-service
  // password change re-stamps it.
  app.post("/api/account/sessions/revoke-all", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const ended = await signOutEverywhere(me, { keepSessionId: req.sessionID });
    const fresh = (await storage().getUserById(me.id)) ?? me;
    await restampSession(req, fresh as User);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "auth.sign_out_everywhere",
      resourceType: "user",
      resourceId: me.id,
      details: { self: true, sessionsEnded: ended },
      riskLevel: "medium",
    });
    res.json({ ok: true, sessionsEnded: ended });
  });
}

export { signOutEverywhere };
