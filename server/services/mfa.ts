import { createHash, randomBytes, randomInt } from "node:crypto";
import speakeasy from "speakeasy";
import { storage } from "../storage.js";
import { smsFor } from "./sms.js";
import { getNotificationProfile } from "../config.js";

/**
 * Multi-factor auth. TOTP via speakeasy; backup codes stored as SHA-256 and
 * single-use; SMS OTP via the carrier adapter (stubbed without creds). The
 * session is not authenticated until a second factor completes.
 */

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function beginEnrollment(username: string) {
  const secret = speakeasy.generateSecret({
    name: `DocTurn (${username})`,
    length: 20,
  });
  return { secret: secret.base32, otpauthUrl: secret.otpauth_url ?? "" };
}

export function verifyTotp(secret: string, code: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token: code,
    window: 1,
  });
}

export function generateBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () =>
    randomBytes(5).toString("hex").toUpperCase(),
  );
}

// ── SMS OTP ────────────────────────────────────────────────────────────────────
// In-memory OTP store keyed by userId, with attempt limiting. (A production
// build persists to sms_verification_codes; this keeps dev/test secret-free.)
const otps = new Map<number, { code: string; expires: number; attempts: number }>();

export async function sendSmsOtp(userId: number): Promise<string | null> {
  const user = await storage().getUserById(userId);
  if (!user?.phone) return null;
  const code = String(randomInt(100000, 999999));
  otps.set(userId, { code, expires: Date.now() + 5 * 60_000, attempts: 0 });
  const profile = await getNotificationProfile(user.organizationId);
  const sms = smsFor(profile.smsCarrier);
  await sms.send(user.phone, `Your DocTurn verification code is ${code}`);
  await storage().appendSmsHistory({
    organizationId: user.organizationId,
    userId,
    toPhone: user.phone,
    body: "DocTurn verification code",
    carrier: sms.carrier,
  });
  return code;
}

export function verifySmsOtp(userId: number, code: string): boolean {
  const entry = otps.get(userId);
  if (!entry) return false;
  if (Date.now() > entry.expires) {
    otps.delete(userId);
    return false;
  }
  entry.attempts++;
  if (entry.attempts > 5) {
    otps.delete(userId);
    return false;
  }
  if (entry.code === code) {
    otps.delete(userId);
    return true;
  }
  return false;
}

/**
 * Complete a second factor for a pending login. Tries TOTP, then SMS OTP, then a
 * single-use backup code. Returns true on success.
 */
export async function completeSecondFactor(
  userId: number,
  code: string,
): Promise<boolean> {
  const cred = await storage().getMfaCredential(userId);
  if (cred?.activated && verifyTotp(cred.secret, code)) return true;
  if (verifySmsOtp(userId, code)) return true;
  if (await storage().consumeBackupCode(userId, sha256(code.toUpperCase())))
    return true;
  return false;
}

export function _resetOtps() {
  otps.clear();
}
