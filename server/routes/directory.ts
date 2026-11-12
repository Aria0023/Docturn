import type { Express } from "express";
import { z } from "zod";
import { FAVORITE_TARGET_KINDS, type FavoriteTargetKind, type User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { isModuleEnabled } from "../modules.js";
import { currentUser, requireAuth } from "../rbac.js";
import { storage } from "../storage.js";
import { buildRoleContacts, type RoleContact } from "./messaging.js";

/**
 * Directory favorites + recently contacted (PerfectServe parity #2, module
 * directory.favorites — gated centrally in server/modules.ts GATE_TABLE).
 *
 *   GET    /api/directory/favorites                     the caller's stars, resolved
 *   POST   /api/directory/favorites { targetKind, targetId }
 *   DELETE /api/directory/favorites/:targetKind/:targetId
 *   GET    /api/directory/recents                       derived, never stored
 *
 * A favorite is keyed (organization, user, target kind, target id). Every
 * target is validated against the CALLER's org before it is written: a person
 * must be an active user of the org (another tenant's id answers 404 exactly
 * like an unknown one), a role must be a role the org's one resolution path
 * (resolveOnCallTargets, via buildRoleContacts) resolves now. Rows carry ids
 * and role keys only — no patient data — and the audit rows carry the kind
 * and the user id, never a name.
 *
 * Recently contacted is derived from the caller's OWN direct conversations,
 * newest message first. It returns people and times, never message content,
 * so it is not a PHI read.
 */

const favoriteSchema = z.object({
  targetKind: z.enum(FAVORITE_TARGET_KINDS),
  targetId: z.string().trim().min(1).max(200),
});

export interface DirectoryPerson {
  userId: number;
  displayName: string;
  credential: string | null;
  role: User["role"];
  active: boolean;
}
const personView = (u: User): DirectoryPerson => ({
  userId: u.id,
  displayName: u.displayName,
  credential: u.credential ?? null,
  role: u.role,
  active: u.disabledAt == null,
});

const RECENTS_LIMIT = 10;

/** Role contacts, or none when role messaging (or the board it requires) is off. */
async function roleContactsFor(me: User): Promise<RoleContact[] | null> {
  if (!(await isModuleEnabled(me.organizationId, "routing.roleMessaging"))) return null;
  return buildRoleContacts(me);
}

export function registerDirectoryRoutes(app: Express) {
  app.get("/api/directory/favorites", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const rows = await storage().listFavorites(me.organizationId, me.id);
    const users = await storage().listUsers(me.organizationId);
    const byId = new Map(users.map((u) => [u.id, u]));
    const roles = rows.some((r) => r.targetKind === "role") ? await roleContactsFor(me) : [];
    const byRole = new Map((roles ?? []).map((r) => [r.role, r]));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      favorites: rows.map((r) => {
        if (r.targetKind === "user") {
          const u = byId.get(Number(r.targetId));
          return { targetKind: r.targetKind, targetId: r.targetId, createdAt: r.createdAt, user: u ? personView(u) : null };
        }
        // A starred role nobody reachable holds right now resolves to null:
        // the client shows no empty "on call" card for it (the star is kept).
        return { targetKind: r.targetKind, targetId: r.targetId, createdAt: r.createdAt, role: byRole.get(r.targetId) ?? null };
      }),
    });
  });

  app.post("/api/directory/favorites", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = favoriteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const { targetKind, targetId } = parsed.data;
    let resourceId: number | null = null;
    if (targetKind === "user") {
      if (!/^\d{1,10}$/.test(targetId)) return res.status(400).json({ error: "validation_error" });
      const id = Number(targetId);
      if (id === me.id) return res.status(400).json({ error: "cannot_favorite_self" });
      // Same-org only: another tenant's user is indistinguishable from none.
      const u = await storage().getUser(me.organizationId, id);
      if (!u) return res.status(404).json({ error: "not_found" });
      if (u.disabledAt) return res.status(409).json({ error: "user_disabled" });
      resourceId = id;
    } else {
      const roles = await roleContactsFor(me);
      if (roles === null) return res.status(404).json({ error: "module_disabled", module: "routing.roleMessaging" });
      if (!roles.some((r) => r.role === targetId)) return res.status(404).json({ error: "role_not_found" });
    }
    const created = await storage().addFavorite(me.organizationId, me.id, targetKind, targetId);
    if (created) {
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "directory.favorite_add",
        resourceType: targetKind === "user" ? "user" : "role",
        resourceId,
        details: { targetKind },
        riskLevel: "low",
      });
    }
    res.status(created ? 201 : 200).json({ targetKind, targetId, created });
  });

  app.delete("/api/directory/favorites/:targetKind/:targetId", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = favoriteSchema.safeParse({ targetKind: req.params.targetKind, targetId: req.params.targetId });
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const kind: FavoriteTargetKind = parsed.data.targetKind;
    const gone = await storage().removeFavorite(me.organizationId, me.id, kind, parsed.data.targetId);
    if (!gone) return res.status(404).json({ error: "not_found" });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "directory.favorite_remove",
      resourceType: kind === "user" ? "user" : "role",
      resourceId: kind === "user" && /^\d{1,10}$/.test(parsed.data.targetId) ? Number(parsed.data.targetId) : null,
      details: { targetKind: kind },
      riskLevel: "low",
    });
    res.status(204).end();
  });

  app.get("/api/directory/recents", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const convos = (await storage().listConversationsForUser(me.organizationId, me.id)).filter(
      (c) => c.type === "direct",
    );
    const last = await storage().lastMessagesFor(
      me.organizationId,
      convos.map((c) => c.id),
    );
    const users = await storage().listUsers(me.organizationId);
    const byId = new Map(users.map((u) => [u.id, u]));
    const rows: Array<DirectoryPerson & { conversationId: number; lastMessageAt: Date }> = [];
    const seen = new Set<number>();
    const ordered = convos
      .map((c) => ({ c, m: last.get(c.id) }))
      .filter((x): x is { c: (typeof convos)[number]; m: NonNullable<typeof x.m> } => !!x.m)
      .sort((a, b) => b.m.createdAt.getTime() - a.m.createdAt.getTime() || b.m.id - a.m.id);
    for (const { c, m } of ordered) {
      const otherId = c.participantIds.find((id) => id !== me.id);
      const u = otherId != null ? byId.get(otherId) : undefined;
      if (!u || seen.has(u.id)) continue;
      seen.add(u.id);
      rows.push({ ...personView(u), conversationId: c.id, lastMessageAt: m.createdAt });
      if (rows.length >= RECENTS_LIMIT) break;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ recents: rows });
  });
}
