import type { Express } from "express";
import { completeLoginSchema, mfaVerifySchema, toSafeUser } from "@shared/schema";
import type { User } from "@shared/schema";
import { appendAudit } from "../audit.js";
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

export function registerMfaRoutes(app: Express) {
  // Begin TOTP enrollment — returns the secret + otpauth URL for a QR code.
  app.post("/api/mfa/enroll", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const { secret, otpauthUrl } = beginEnrollment(me.username);
    await storage().upsertMfaCredential(me.id, secret);
    res.json({ secret, otpauthUrl });
  });

  // Verify the first TOTP code → activate 2FA, return 10 backup codes ONCE.
  app.post("/api/mfa/verify", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = mfaVerifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const cred = await storage().getMfaCredential(me.id);
    if (!cred) return res.status(409).json({ error: "not_enrolled" });
    if (!verifyTotp(cred.secret, parsed.data.code)) {
      return res.status(401).json({ error: "invalid_code" });
    }
    await storage().activateMfaCredential(me.id);
    await storage().updateUser(me.id, { twoFactorEnabled: true });
    const codes = generateBackupCodes(10);
    await storage().replaceBackupCodes(me.id, codes.map((c) => sha256(c)));
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "mfa.enable",
      resourceType: "user",
      resourceId: me.id,
      details: {},
      riskLevel: "medium",
    });
    res.json({ activated: true, backupCodes: codes });
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

    const ok = await completeSecondFactor(pendingId, parsed.data.code);
    if (!ok) {
      await appendAudit({
        organizationId: null,
        userId: pendingId,
        action: "mfa.failed",
        resourceType: "user",
        resourceId: pendingId,
        details: {},
        riskLevel: "high",
      });
      return res.status(401).json({ error: "invalid_code" });
    }

    const user = await storage().getUserById(pendingId);
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
