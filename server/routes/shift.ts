import type { Express } from "express";
import { z } from "zod";
import { attributedAuditRow } from "../audit.js";
import { isModuleEnabled } from "../modules.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import {
  acknowledgeAssignment,
  broadcastAssignmentChange,
  broadcastRotationChange,
  notifyAssignment,
} from "../services/notifications.js";
import { storage } from "../storage.js";

/**
 * End shift / Start shift (PerfectServe parity #4, module shift.handoff —
 * gated centrally in server/modules.ts GATE_TABLE).
 *
 *   GET  /api/shift        the caller's shift truth (profile, on shift, pending /
 *                          accepted counts, covering, DND, away message)
 *   POST /api/shift/end    { coveringUserId?, dnd?, awayMessage? }
 *   POST /api/shift/start  {}
 *
 * Only an account with a rotation profile (hospitalists row) has a shift to
 * end; the roles that can hold one are hospitalist and director. End shift is
 * ONE transaction (storage.endShift): off shift, pending incoming requests
 * handed to the covering provider's rotation profile (so the covering provider
 * is REQUIRED while any are pending, and must be on shift in the rotation),
 * the covering / DND / away-message preferences written, one audit row.
 * Accepted patients are never re-routed — they stay on the caller's census.
 * DND and the away message belong to messaging.dnd: while that module is off
 * they are refused, never stored as a promise nothing keeps.
 */

const endSchema = z
  .object({
    coveringUserId: z.number().int().positive().optional(),
    dnd: z.boolean().optional(),
    awayMessage: z.string().max(2000).optional(),
  })
  .strict();
const startSchema = z.object({}).strict();

const ROLES = ["hospitalist", "director"] as const;

async function shiftState(orgId: number, userId: number) {
  const h = await storage().getHospitalistByUser(orgId, userId);
  const [dnd, covering, away] = await Promise.all([
    storage().getUserPreference(userId, "dnd"),
    storage().getUserPreference(userId, "coveringUserId"),
    storage().getUserPreference(userId, "awayMessage"),
  ]);
  const [pending, accepted] = h
    ? await Promise.all([
        storage().listPendingForHospitalist(orgId, h.id),
        storage().listAcceptedForHospitalist(orgId, h.id),
      ])
    : [[], []];
  return {
    profile: h ?? null,
    view: {
      hasProfile: !!h,
      working: !!h?.working,
      pendingCount: pending.length,
      acceptedCount: accepted.length,
      coveringUserId: typeof covering === "number" ? covering : null,
      dnd: dnd === true,
      awayMessage: typeof away === "string" && away.trim() ? away.trim().slice(0, 280) : null,
    },
  };
}

export function registerShiftRoutes(app: Express) {
  app.get("/api/shift", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    res.json((await shiftState(me.organizationId, me.id)).view);
  });

  app.post("/api/shift/end", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = endSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const body = parsed.data;
    const orgId = me.organizationId;

    const { profile, view } = await shiftState(orgId, me.id);
    if (!profile) return res.status(409).json({ error: "no_rotation_profile" });
    if (!profile.working) return res.status(409).json({ error: "not_on_shift" });
    if ((body.dnd === true || body.awayMessage !== undefined) && !(await isModuleEnabled(orgId, "messaging.dnd"))) {
      return res.status(404).json({ error: "module_disabled", module: "messaging.dnd" });
    }

    // The covering provider: a real, active user of MY org (another tenant's
    // id answers exactly like an unknown one), never myself.
    let handOffTo: number | null = null;
    if (body.coveringUserId !== undefined) {
      if (body.coveringUserId === me.id) return res.status(400).json({ error: "covering_is_self" });
      const cu = await storage().getUser(orgId, body.coveringUserId);
      if (!cu) return res.status(404).json({ error: "covering_not_found" });
      if (cu.disabledAt) return res.status(409).json({ error: "covering_inactive" });
    }
    const coveringId = body.coveringUserId ?? view.coveringUserId;
    if (view.pendingCount > 0) {
      if (body.coveringUserId === undefined) {
        return res.status(409).json({ error: "covering_required", pendingCount: view.pendingCount });
      }
      // Pending requests are handed to the covering provider's rotation
      // profile, so they need one — and must be on shift to answer them.
      const ch = await storage().getHospitalistByUser(orgId, body.coveringUserId);
      if (!ch) return res.status(409).json({ error: "covering_not_in_rotation", pendingCount: view.pendingCount });
      if (!ch.working) return res.status(409).json({ error: "covering_off_shift", pendingCount: view.pendingCount });
      handOffTo = ch.id;
    }

    const awayMessage = body.awayMessage !== undefined ? body.awayMessage.trim().slice(0, 280) : undefined;
    const org = await storage().getOrganization(orgId);
    const result = await storage().endShift({
      orgId,
      userId: me.id,
      hospitalistId: profile.id,
      coveringUserId: body.coveringUserId,
      handOffToHospitalistId: handOffTo,
      timeoutMin: org?.assignmentTimeoutMin ?? 10,
      dnd: body.dnd,
      awayMessage,
      // Ids and flags only — never the away-message text.
      audit: ({ handedOff, acceptedKept }) =>
        attributedAuditRow({
          organizationId: orgId,
          userId: me.id,
          action: "shift.end",
          resourceType: "hospitalist",
          resourceId: profile.id,
          details: {
            coveringUserId: coveringId,
            handedOff,
            acceptedKept,
            dnd: body.dnd ?? view.dnd,
            awayMessageSet: awayMessage !== undefined ? awayMessage.length > 0 : view.awayMessage != null,
          },
          riskLevel: handedOff > 0 ? "medium" : "low",
        }),
    });
    if (!result.ok) {
      return res.status(409).json({ error: result.error, pendingCount: result.pendingCount });
    }

    // After commit: the covering provider's unit is alerted for each request
    // (the same fan-out a routed request gets); the old requests' re-push
    // timers stop; every session re-reads the rotation and assignments.
    if (handOffTo != null && coveringId != null) {
      const targets = await storage().unitUserIds(orgId, coveringId);
      for (const a of result.handedOff) await notifyAssignment(a, targets);
    }
    for (const id of result.released) acknowledgeAssignment(id);
    broadcastRotationChange(orgId);
    if (result.handedOff.length) broadcastAssignmentChange(orgId);
    const after = (await shiftState(orgId, me.id)).view;
    res.json({ ...after, handedOff: result.handedOff.length, acceptedKept: result.acceptedKept });
  });

  app.post("/api/shift/start", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const orgId = me.organizationId;
    const { profile } = await shiftState(orgId, me.id);
    if (!profile) return res.status(409).json({ error: "no_rotation_profile" });
    const started = await storage().startShift({
      orgId,
      userId: me.id,
      hospitalistId: profile.id,
      audit: attributedAuditRow({
        organizationId: orgId,
        userId: me.id,
        action: "shift.start",
        resourceType: "hospitalist",
        resourceId: profile.id,
        details: { dnd: false },
        riskLevel: "low",
      }),
    });
    if (!started) return res.status(409).json({ error: "already_on_shift" });
    broadcastRotationChange(orgId);
    res.json((await shiftState(orgId, me.id)).view);
  });
}
