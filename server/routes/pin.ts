import type { Express } from "express";
import { z } from "zod";
import { appendAudit } from "../audit.js";
import { appLockForPin, hashPassword, verifyPassword } from "../auth.js";
import { currentUser, requireAuth } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * PIN unlock (PerfectServe parity #7, module security.pin — default OFF, gated
 * centrally in server/modules.ts GATE_TABLE).
 *
 *   GET    /api/security/pin            { set, minLength, maxLength }
 *   PUT    /api/security/pin            { currentPassword, pin }   set / change
 *   DELETE /api/security/pin                                        remove
 *   POST   /api/session/unlock-pin      { pin }   re-open THIS locked session
 *
 * A PIN re-opens an authenticated, locked session; it is not authentication.
 * The unlock route is lock-exempt (server/auth.ts APP_LOCK_EXEMPT), never a
 * passthrough: the lock gate runs first, so a lock that outlived the idle
 * window (the 15-minute idle auto-lock is back-dated to exactly that) has
 * already ended the session and the caller is signed out (401). It needs a
 * session that is signed in AND locked; it never creates one.
 *
 * Wrong PINs are counted per session (pin_unlock_failures, keyed by a hash of
 * the session id) and the attempt is spent BEFORE the hash is checked, so a
 * burst of parallel guesses cannot exceed the limit. At PIN_MAX_FAILURES the
 * PIN is disabled for that session; only the password (POST /api/login, which
 * replaces the session) re-opens it. Audit rows carry counts, never digits.
 */

export const PIN_MAX_FAILURES = 5;
const PIN_RE = /^\d{4,8}$/;

/** One repeated digit, or a straight ascending / descending run. */
export function isWeakPin(pin: string): boolean {
  if (!PIN_RE.test(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const step = d[1]! - d[0]!;
  if (step === 1 || step === -1) {
    if (d.every((v, i) => i === 0 || v - d[i - 1]! === step)) return true;
  }
  return false;
}

const setSchema = z
  .object({
    currentPassword: z.string().min(1).max(512),
    pin: z.string().regex(PIN_RE),
  })
  .strict();
const unlockSchema = z.object({ pin: z.string().min(1).max(16) }).strict();

export function registerPinRoutes(app: Express) {
  app.get("/api/security/pin", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const row = await storage().getUserPin(me.organizationId, me.id);
    res.json({ set: !!row, minLength: 4, maxLength: 8 });
  });

  app.put("/api/security/pin", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = setSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    if (isWeakPin(parsed.data.pin)) return res.status(400).json({ error: "weak_pin" });
    // The account password, re-entered — exactly as a password change checks it.
    const fresh = await storage().getUserById(me.id);
    if (!fresh || fresh.organizationId !== me.organizationId) return res.status(404).json({ error: "not_found" });
    if (!(await verifyPassword(parsed.data.currentPassword, fresh.passwordHash))) {
      return res.status(403).json({ error: "wrong_password" });
    }
    const had = !!(await storage().getUserPin(me.organizationId, me.id));
    await storage().setUserPin(me.organizationId, me.id, await hashPassword(parsed.data.pin));
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "pin.set",
      resourceType: "user",
      resourceId: me.id,
      details: { changed: had },
      riskLevel: "low",
    });
    res.json({ set: true, minLength: 4, maxLength: 8 });
  });

  // Removing the PIN only takes a capability away, so no password is asked.
  app.delete("/api/security/pin", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const removed = await storage().deleteUserPin(me.organizationId, me.id);
    if (removed) {
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "pin.remove",
        resourceType: "user",
        resourceId: me.id,
        details: {},
        riskLevel: "low",
      });
    }
    res.json({ set: false, minLength: 4, maxLength: 8 });
  });

  app.post("/api/session/unlock-pin", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = unlockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const lock = appLockForPin(req, res);
    if (!lock || lock.lockedAt == null) return res.status(409).json({ error: "not_locked" });
    const pin = await storage().getUserPin(me.organizationId, me.id);
    if (!pin) return res.status(409).json({ error: "pin_not_set", passwordRequired: true });

    const audit = (action: string, details: Record<string, unknown>, riskLevel: "low" | "medium") =>
      appendAudit({ organizationId: me.organizationId, userId: me.id, action, resourceType: "user", resourceId: me.id, details, riskLevel });
    const disabled = () => res.status(403).json({ error: "pin_disabled", passwordRequired: true });

    // Spend the attempt first (atomic), then — only within the limit — check.
    const { attempt, disabled: already } = await storage().reservePinAttempt(me.organizationId, me.id, lock.key, PIN_MAX_FAILURES);
    if (already) {
      await storage().markPinDisabled(me.organizationId, me.id, lock.key);
      return disabled();
    }
    if (await verifyPassword(parsed.data.pin, pin.pinHash)) {
      await storage().clearPinFailures(me.organizationId, me.id, lock.key);
      await lock.unlock();
      await audit("auth.unlock", { method: "pin" }, "low");
      return res.json({ locked: false });
    }
    await audit("auth.pin_failed", { attempt }, "low");
    if (attempt >= PIN_MAX_FAILURES) {
      await storage().markPinDisabled(me.organizationId, me.id, lock.key);
      await audit("auth.pin_disabled", { attempts: attempt }, "medium");
      return disabled();
    }
    return res.status(403).json({ error: "wrong_pin", attemptsLeft: PIN_MAX_FAILURES - attempt });
  });
}
