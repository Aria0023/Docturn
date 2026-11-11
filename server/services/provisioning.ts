/**
 * Provisioning an account from OUTSIDE the app, and ending its access — the
 * one path SCIM (E2.2) and OIDC just-in-time sign-in (E2.1) share with the
 * administrative screens, so a person created by the identity provider is
 * exactly the same kind of account as one a director adds by hand.
 *
 * Two deliberate decisions:
 *
 *  • **No password.** An externally provisioned account gets a random
 *    32-byte scrypt hash nobody holds: sign-in happens through the identity
 *    provider. `must_change_password` is NOT set — that gate exists to force
 *    a one-time credential to be replaced, and there is no credential here;
 *    setting it would lock an SSO user out of every route. A director who
 *    needs local access for such an account uses "Reset password" on the
 *    People screen, which mints a real one-time credential.
 *  • **Deactivation is the existing path.** `deactivateAccount` is what
 *    POST /api/accounts/:id/deactivate does — users.disabled_at, off the
 *    rotation at once (so routing never offers a leaver a patient) and the
 *    live sessions / sockets / demo tokens ended now — so a SCIM
 *    `active:false` is not a second, weaker kind of deactivation.
 */
import { randomBytes } from "node:crypto";
import type { Role, User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { releasePendingForHospitalist } from "./assignments.js";
import { endSessionsOfDeactivatedUser, hashPassword } from "../auth.js";
import { broadcastRotationChange } from "./notifications.js";
import { storage } from "../storage.js";

export type ProvisionSource = "scim" | "sso";

export interface ProvisionInput {
  organizationId: number;
  username: string;
  displayName: string;
  role: Role;
  credential?: User["credential"];
  phone?: string | null;
  /** The person or token that caused it (null for an IdP with no DocTurn user). */
  actorUserId?: number | null;
  source: ProvisionSource;
}

/** A hash of 32 random bytes: a credential that exists but nobody knows. */
export async function unguessablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("base64url"));
}

/**
 * Create an account the identity provider owns. The caller has already
 * checked the org, the role and that the username is free.
 */
export async function provisionUser(input: ProvisionInput): Promise<User> {
  const user = await storage().createUser({
    organizationId: input.organizationId,
    username: input.username,
    passwordHash: await unguessablePasswordHash(),
    role: input.role,
    displayName: input.displayName,
    credential: (input.credential ?? null) as User["credential"],
    phone: input.phone ?? null,
    twoFactorEnabled: false,
    mustChangePassword: false,
  });
  // A hospitalist needs a rotation profile to appear in routing and on the
  // dashboards — exactly what approving a registration does.
  if (input.role === "hospitalist") {
    const existing = await storage().listHospitalists(input.organizationId);
    await storage().createHospitalist({
      organizationId: input.organizationId,
      userId: user.id,
      specialty: "Hospital Medicine",
      currentPatientCount: 0,
      patientCap: 12,
      rotationOrder: existing.length,
      working: false,
      shiftType: "day",
    });
  }
  await appendAudit({
    organizationId: input.organizationId,
    userId: input.actorUserId ?? null,
    action: input.source === "scim" ? "scim.user_create" : "sso.user_create",
    resourceType: "user",
    resourceId: user.id,
    details: { username: user.username, role: user.role, source: input.source },
    riskLevel: "medium",
  });
  return user;
}

/**
 * Keep the rotation consistent with a ROLE CHANGE (the identity provider
 * moving someone between hospitalist and ER physician):
 *   • INTO hospitalist — they get the rotation profile every hospitalist
 *     has (off shift), or they could never start a shift or be routed to;
 *   • OUT OF hospitalist — they come off shift at once and any request still
 *     waiting on them goes to the next provider: an ER physician cannot accept
 *     an admission, so leaving them in the round-robin would route patients
 *     to someone the server will refuse. The profile row itself stays (past
 *     assignments reference it).
 * The caller has already written users.role.
 */
export async function syncRotationAfterRoleChange(user: Pick<User, "id" | "organizationId">, from: Role, to: Role): Promise<void> {
  if (from === to) return;
  const profile = await storage().getHospitalistByUser(user.organizationId, user.id);
  if (to === "hospitalist") {
    if (!profile) {
      const existing = await storage().listHospitalists(user.organizationId);
      await storage().createHospitalist({
        organizationId: user.organizationId,
        userId: user.id,
        specialty: "Hospital Medicine",
        currentPatientCount: 0,
        patientCap: 12,
        rotationOrder: existing.length,
        working: false,
        shiftType: "day",
      });
      broadcastRotationChange(user.organizationId);
    }
    return;
  }
  if (from === "hospitalist" && profile) {
    if (profile.working) {
      await storage().updateHospitalist(user.organizationId, profile.id, { working: false });
      broadcastRotationChange(user.organizationId);
    }
    await releasePendingForHospitalist(storage(), user.organizationId, profile.id);
  }
}

/**
 * End a person's access — the SAME path as POST /api/accounts/:id/deactivate:
 * the row carries disabled_at (so sign-in is refused and every live session
 * stops deserialising on its next request), the provider comes off shift at
 * once, and the live transports are closed now. Idempotent.
 */
export async function deactivateAccount(target: User): Promise<void> {
  if (!target.disabledAt) {
    await storage().updateUser(target.id, { disabledAt: new Date() });
    const profile = await storage().getHospitalistByUser(target.organizationId, target.id);
    if (profile && profile.working) {
      await storage().updateHospitalist(target.organizationId, profile.id, { working: false });
      broadcastRotationChange(target.organizationId);
    }
    if (profile) await releasePendingForHospitalist(storage(), target.organizationId, profile.id);
  }
  endSessionsOfDeactivatedUser(target.id);
}

/** Restore access — the SAME path as POST /api/accounts/:id/reactivate. */
export async function reactivateAccount(target: User): Promise<void> {
  if (target.disabledAt) await storage().updateUser(target.id, { disabledAt: null });
}
