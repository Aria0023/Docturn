import type { Express, Request, Response } from "express";
import { completeLoginSchema, mfaVerifySchema, toSafeUser } from "@shared/schema";
import type { User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { verifyPassword } from "../auth.js";
import { currentUser, requireAuth } from "../rbac.js";
import {
  beginEnrollment,
  completeSecondFactor,
  generateBackupCodes,
  sendSmsOtp,
  sha256,
  verifyTotp,
} from "../services/mfa.js";
import { storage } from "../storage.js";

/**
 * Step-up check for changing an ACTIVE second factor (re-enrol, disable,
 * regenerate backup codes): the caller must present their current password
 * AND a currently valid factor (TOTP or an unused backup code). A stolen
 * session alone can never weaken MFA. Writes the 401/400 itself and returns
 * false when the step-up fails.
 */
async function stepUp(req: Request, res: Response, me: User): Promise<boolean> {
  const body = (req.body ?? {}) as { currentPassword?: unknown; code?: unknown };
  const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  if (!password || !code) {
    res.status(400).json({ error: "step_up_required" });
    return false;
  }
  const fresh = await storage().getUserById(me.id);
  if (!fresh || !(await verifyPassword(password, fresh.passwordHash))) {
    await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "mfa.step_up_failed", resourceType: "user", resourceId: me.id, details: { reason: "password" }, riskLevel: "high" });
    res.status(401).json({ error: "wrong_password" });
    return false;
  }
  if (!(await completeSecondFactor(me.id, code))) {
    await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "mfa.step_up_failed", resourceType: "user", resourceId: me.id, details: { reason: "code" }, riskLevel: "high" });
    res.status(401).json({ error: "invalid_code" });
    return false;
  }
  return true;
}

export function registerMfaRoutes(app: Express) {
  // Begin TOTP enrollment — returns the secret + otpauth URL for a QR code.
  // For an account that ALREADY has an active authenticator this is a
  // re-enrolment: it requires the step-up above, and the new secret is parked
  // as pending so the existing authenticator keeps working until the new one
  // is verified (nothing is silently destroyed by one click).
  app.post("/api/mfa/enroll", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const fresh = await storage().getUserById(me.id);
    const reenrol = !!fresh?.twoFactorEnabled;
    if (reenrol && !(await stepUp(req, res, me))) return;
    const { secret, otpauthUrl } = beginEnrollment(me.username);
    await storage().upsertMfaCredential(me.id, secret);
    if (reenrol) {
      await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "mfa.reenroll_begin", resourceType: "user", resourceId: me.id, details: {}, riskLevel: "high" });
    }
    res.json({ secret, otpauthUrl, reenrol });
  });

  // Verify the first code of a (re-)enrolment → activate, return 10 backup codes ONCE.
  app.post("/api/mfa/verify", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = mfaVerifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const cred = await storage().getMfaCredential(me.id);
    if (!cred) return res.status(409).json({ error: "not_enrolled" });
    const reenrol = !!cred.pendingSecret;
    const candidate = reenrol ? cred.pendingSecret! : cred.secret;
    if (!verifyTotp(candidate, parsed.data.code)) {
      return res.status(401).json({ error: "invalid_code" });
    }
    if (reenrol) await storage().promotePendingMfaSecret(me.id);
    else await storage().activateMfaCredential(me.id);
    await storage().updateUser(me.id, { twoFactorEnabled: true });
    const codes = generateBackupCodes(10);
    await storage().replaceBackupCodes(me.id, codes.map((c) => sha256(c)));
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: reenrol ? "mfa.reenroll" : "mfa.enable",
      resourceType: "user",
      resourceId: me.id,
      details: {},
      riskLevel: reenrol ? "high" : "medium",
    });
    res.json({ activated: true, backupCodes: codes });
  });

  // Turn MFA off for your own account (step-up required; audited high). If the
  // org requires MFA for this role, the enrolment gate re-engages immediately.
  app.post("/api/mfa/disable", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const fresh = await storage().getUserById(me.id);
    if (!fresh?.twoFactorEnabled) return res.status(409).json({ error: "not_enrolled" });
    if (!(await stepUp(req, res, me))) return;
    await storage().clearMfa(me.id);
    await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "mfa.disable", resourceType: "user", resourceId: me.id, details: {}, riskLevel: "high" });
    res.json({ ok: true, twoFactorEnabled: false });
  });

  // Fresh backup codes (step-up required); every previous code is invalidated.
  app.post("/api/mfa/backup-codes/regenerate", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const fresh = await storage().getUserById(me.id);
    if (!fresh?.twoFactorEnabled) return res.status(409).json({ error: "not_enrolled" });
    if (!(await stepUp(req, res, me))) return;
    const codes = generateBackupCodes(10);
    await storage().replaceBackupCodes(me.id, codes.map((c) => sha256(c)));
    await appendAudit({ organizationId: me.organizationId, userId: me.id, action: "mfa.backup_codes_regenerated", resourceType: "user", resourceId: me.id, details: {}, riskLevel: "medium" });
    res.json({ backupCodes: codes });
  });

  // Request an SMS OTP for the pending login (alternative to TOTP).
  app.post("/api/2fa/request-sms", async (req, res) => {
    const pendingId = req.session.pendingMfaUserId;
    if (!pendingId) return res.status(401).json({ error: "no_pending_login" });
    const code = await sendSmsOtp(pendingId);
    res.json({ sent: code != null });
  });

  // Complete a pending login with TOTP / SMS OTP / backup code.
  app.post("/api/2fa/complete-login", async (req, res, next) => {
    const pendingId = req.session.pendingMfaUserId;
    if (!pendingId) return res.status(401).json({ error: "no_pending_login" });
    const parsed = completeLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });

    // Resolve the pending account FIRST so a failed factor is filed under the
    // user's own organization: a NULL-org row is invisible to every tenant
    // audit view and to the six-year archive, and (being user-keyed) used to
    // FK-block that tenant's force-delete.
    const user = await storage().getUserById(pendingId);
    const ok = await completeSecondFactor(pendingId, parsed.data.code);
    if (!ok) {
      await appendAudit({
        organizationId: user?.organizationId ?? null,
        userId: user ? pendingId : null,
        action: "mfa.failed",
        resourceType: "user",
        resourceId: pendingId,
        details: {},
        riskLevel: "high",
      });
      return res.status(401).json({ error: "invalid_code" });
    }

    if (!user) return res.status(401).json({ error: "invalid_code" });
    delete req.session.pendingMfaUserId;
    req.login(user as unknown as Express.User, (err) => {
      if (err) return next(err);
      void appendAudit({
        organizationId: user.organizationId,
        userId: user.id,
        action: "auth.login_mfa",
        resourceType: "user",
        resourceId: user.id,
        details: {},
        riskLevel: "low",
      });
      res.status(200).json(toSafeUser(user as User));
    });
  });
}
