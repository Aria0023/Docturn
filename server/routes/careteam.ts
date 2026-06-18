import type { Express } from "express";
import { addCareTeamMemberSchema, toggleOnCallSchema } from "@shared/schema";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { notificationDeps } from "../services/notifications.js";
import { storage } from "../storage.js";

/**
 * Care-team on-call units. A clinician owns a unit and links members; each
 * membership has an on-call flag the owner toggles per shift. Used by the
 * assignment fan-out (attending + on-call members) and the patient board.
 */
export function registerCareTeamRoutes(app: Express) {
  app.get("/api/care-team", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const members = await storage().listCareTeamOwnedBy(
      me.organizationId,
      me.id,
    );
    const users = await storage().listUsers(me.organizationId);
    const byId = new Map(users.map((u) => [u.id, u]));
    res.json({
      owner: { userId: me.id, displayName: me.displayName },
      members: members.map((m) => {
        const u = byId.get(m.memberUserId);
        return {
          userId: m.memberUserId,
          displayName: u?.displayName ?? "Unknown",
          credential: u?.credential ?? null,
          onCall: m.onCall,
        };
      }),
    });
  });

  app.get("/api/care-team/candidates", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const members = await storage().listCareTeamOwnedBy(
      me.organizationId,
      me.id,
    );
    const linked = new Set(members.map((m) => m.memberUserId));
    const users = await storage().listUsers(me.organizationId);
    res.json(
      users
        .filter((u) => u.id !== me.id && !linked.has(u.id))
        .map((u) => ({
          userId: u.id,
          displayName: u.displayName,
          credential: u.credential,
          role: u.role,
        })),
    );
  });

  app.post("/api/care-team/members", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = addCareTeamMemberSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    if (parsed.data.memberUserId === me.id) {
      return res.status(409).json({ error: "self_link_forbidden" });
    }
    // Member must share the caller's org.
    const member = await storage().getUser(
      me.organizationId,
      parsed.data.memberUserId,
    );
    if (!member) return res.status(404).json({ error: "not_found" });
    const existing = await storage().getCareTeamMember(
      me.organizationId,
      me.id,
      parsed.data.memberUserId,
    );
    if (existing) return res.status(409).json({ error: "already_linked" });

    const row = await storage().addCareTeamMember({
      organizationId: me.organizationId,
      ownerUserId: me.id,
      memberUserId: parsed.data.memberUserId,
      onCall: true,
    });
    notificationDeps().ws.sendToUsers([me.id, parsed.data.memberUserId], {
      type: "CARE_TEAM_UPDATED",
    });
    res.status(201).json(row);
  });

  app.patch(
    "/api/care-team/members/:memberUserId",
    requireAuth,
    async (req, res) => {
      const me = currentUser(req);
      const memberUserId = Number(req.params.memberUserId);
      const parsed = toggleOnCallSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const updated = await storage().updateCareTeamMember(
        me.organizationId,
        me.id,
        memberUserId,
        { onCall: parsed.data.onCall },
      );
      if (!updated) return res.status(404).json({ error: "not_found" });
      notificationDeps().ws.sendToUsers([me.id, memberUserId], {
        type: "CARE_TEAM_UPDATED",
      });
      res.json(updated);
    },
  );

  app.delete(
    "/api/care-team/members/:memberUserId",
    requireAuth,
    async (req, res) => {
      const me = currentUser(req);
      const memberUserId = Number(req.params.memberUserId);
      await storage().deleteCareTeamMember(
        me.organizationId,
        me.id,
        memberUserId,
      );
      notificationDeps().ws.sendToUsers([me.id, memberUserId], {
        type: "CARE_TEAM_UPDATED",
      });
      res.status(204).end();
    },
  );

  app.get(
    "/api/care-team/of/:userId",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const userId = Number(req.params.userId);
      const members = await storage().listCareTeamOwnedBy(
        me.organizationId,
        userId,
      );
      res.json(members);
    },
  );
}
