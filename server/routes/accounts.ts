import type { Express, Request, Response } from "express";
import type { User } from "@shared/schema";
import { endSessionsOfDeactivatedUser, issueTemporaryPassword, rotatePassword } from "../auth.js";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { broadcastRotationChange } from "../services/notifications.js";
import { storage } from "../storage.js";

/**
 * Workforce account lifecycle — the administrative half of HIPAA
 * §164.308(a)(3)/(a)(4): list the people in an organization, cut off a
 * leaver's access immediately, restore it, and issue a fresh one-time password.
 *
 * Who may act on whom (enforced here, mirrored in the UI):
 *   developer    → any account in any org except their own
 *   director     → any clinical account in THEIR org (never a developer)
 *   er_director  → er_doctor accounts in their org only
 * A target outside the caller's reach answers 404 (never 403) so the existence
 * of accounts in other tenants is not revealed.
 *
 * Deactivation flips users.disabled_at: sign-in is refused and every live
 * session stops deserialising on its next request (server/auth.ts) — including
 * any impersonated / managed-org portal a deactivated developer is inside —
 * and the live sockets of all of them are closed at once. It also takes the
 * provider off shift so routing never offers them a patient.
 */

const MANAGE_ROLES = ["director", "er_director", "developer"] as const;

async function reachableTarget(req: Request, res: Response): Promise<User | null> {
  const me = currentUser(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "validation_error" });
    return null;
  }
  if (id === me.id) {
    res.status(409).json({ error: "cannot_act_on_self" });
    return null;
  }
  const target = await storage().getUserById(id);
  const allowed =
    !!target &&
    (me.role === "developer" ||
      (target.organizationId === me.organizationId &&
        target.role !== "developer" &&
        (me.role === "director" || (me.role === "er_director" && target.role === "er_doctor"))));
  if (!target || !allowed) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return target;
}

function publicRow(
  u: User,
  orgCode: string,
  specialty: string | undefined,
) {
  return {
    id: u.id,
    name: u.displayName,
    username: u.username,
    role: u.role,
    org: orgCode,
    specialty: specialty ?? "",
    credential: u.credential,
    disabled: !!u.disabledAt,
    mustChangePassword: !!u.mustChangePassword,
  };
}

export function registerAccountRoutes(app: Express) {
  // The people an administrator may manage, with account state. Developers get
  // every org; directors / ER directors get their own.
  app.get("/api/accounts", requireAuth, requireRole(...MANAGE_ROLES), async (req, res) => {
    const me = currentUser(req);
    if (me.role === "developer") {
      // A developer's list is a CROSS-TENANT read (every tenant's workforce:
      // usernames, roles, credentials, account state) — the same data as
      // GET /api/dev/users, so the same ids-only row, filed BEFORE the read in
      // the developer's own (platform) org, never with organization_id NULL
      // (launch finding A.CON-SHO-9; see the header of server/routes/dev.ts).
      // A director's list of their own org is not cross-tenant: no row.
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "dev.users_list",
        resourceType: "user",
        resourceId: null,
        details: {},
        riskLevel: "low",
      });
    }
    const orgs = await storage().listOrganizations();
    const orgCode = new Map(orgs.map((o) => [o.id, o.code]));
    const users =
      me.role === "developer" ? await storage().listAllUsers() : await storage().listUsers(me.organizationId);
    const hosps =
      me.role === "developer"
        ? await storage().listAllHospitalists()
        : await storage().listHospitalists(me.organizationId);
    const specByUser = new Map(hosps.map((h) => [h.userId, h.specialty]));
    res.json(users.map((u) => publicRow(u, orgCode.get(u.organizationId) ?? "—", specByUser.get(u.id))));
  });

  app.post("/api/accounts/:id/deactivate", requireAuth, requireRole(...MANAGE_ROLES), async (req, res) => {
    const me = currentUser(req);
    const target = await reachableTarget(req, res);
    if (!target) return;
    if (!target.disabledAt) {
      await storage().updateUser(target.id, { disabledAt: new Date() });
      // Off the rotation immediately: a deactivated provider must never be
      // offered an admission or resolve as the on-call.
      const profile = await storage().getHospitalistByUser(target.organizationId, target.id);
      if (profile && profile.working) {
        await storage().updateHospitalist(target.organizationId, profile.id, { working: false });
        broadcastRotationChange(target.organizationId);
      }
    }
    // The live transports end now, not at the next reconnect: the target's
    // sockets and demo tokens, and the sockets of every borrowed session a
    // deactivated developer opened (idempotent for an already-disabled row).
    endSessionsOfDeactivatedUser(target.id);
    await appendAudit({
      organizationId: target.organizationId,
      userId: me.id,
      action: "account.deactivate",
      resourceType: "user",
      resourceId: target.id,
      details: { username: target.username, role: target.role },
      riskLevel: "high",
    });
    res.json({ ok: true, id: target.id, disabled: true });
  });

  app.post("/api/accounts/:id/reactivate", requireAuth, requireRole(...MANAGE_ROLES), async (req, res) => {
    const me = currentUser(req);
    const target = await reachableTarget(req, res);
    if (!target) return;
    if (target.disabledAt) await storage().updateUser(target.id, { disabledAt: null });
    await appendAudit({
      organizationId: target.organizationId,
      userId: me.id,
      action: "account.reactivate",
      resourceType: "user",
      resourceId: target.id,
      details: { username: target.username, role: target.role },
      riskLevel: "high",
    });
    res.json({ ok: true, id: target.id, disabled: false });
  });

  // Administrative password reset: mints a one-time credential, forces a
  // change on first use, and hands it back ONCE in this response. Nothing is
  // emailed or logged; the administrator relays it out-of-band. Every live
  // session and socket of the target ends (rotatePassword → session generation
  // + WebSocket revocation): whoever held the old credential is out now.
  app.post("/api/accounts/:id/reset-password", requireAuth, requireRole(...MANAGE_ROLES), async (req, res) => {
    const me = currentUser(req);
    const target = await reachableTarget(req, res);
    if (!target) return;
    const temporaryPassword = issueTemporaryPassword();
    await rotatePassword(target.id, temporaryPassword, {
      mustChangePassword: true,
      reason: "password_reset",
    });
    await appendAudit({
      organizationId: target.organizationId,
      userId: me.id,
      action: "account.password_reset",
      resourceType: "user",
      resourceId: target.id,
      details: { username: target.username },
      riskLevel: "high",
    });
    res.json({ ok: true, id: target.id, username: target.username, temporaryPassword });
  });

  // Administrative MFA reset for a locked-out clinician (lost phone, no backup
  // codes): clears their second factor so they can sign in with password alone
  // and enrol again. If the org requires MFA for their role, the enrolment
  // gate takes them straight back into setup. Audited high.
  app.post("/api/accounts/:id/reset-mfa", requireAuth, requireRole(...MANAGE_ROLES), async (req, res) => {
    const me = currentUser(req);
    const target = await reachableTarget(req, res);
    if (!target) return;
    await storage().clearMfa(target.id);
    await appendAudit({
      organizationId: target.organizationId,
      userId: me.id,
      action: "account.mfa_reset",
      resourceType: "user",
      resourceId: target.id,
      details: { username: target.username },
      riskLevel: "high",
    });
    res.json({ ok: true, id: target.id, twoFactorEnabled: false });
  });
}
