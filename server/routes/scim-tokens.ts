import type { Express } from "express";
import { z } from "zod";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { newScimToken, scimBaseUrl, scimTokenHash } from "../scim/auth.js";
import { SCIM_ASSIGNABLE_ROLES } from "../scim/schemas.js";
import { storage } from "../storage.js";

/**
 * SCIM token management (E2.2, module `enterprise.scim` — the GATE_TABLE
 * answers 404 while it is off). A director creates the bearer token their
 * identity provider will use, sees it ONCE, and can revoke it; the row keeps
 * `created_at`, `last_used_at` and `revoked_at` so they can tell whether the
 * connector is alive.
 */

const labelSchema = z.object({ label: z.string().trim().min(1).max(80) }).strict();
const TOKEN_ROLES = ["director", "developer"] as const;

export function registerScimTokenRoutes(app: Express) {
  app.get("/api/org/scim-tokens", requireAuth, requireRole(...TOKEN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const rows = await storage().listScimTokens(me.organizationId);
    res.json({
      // What the identity provider is pointed at. Derived from this request
      // (or PUBLIC_BASE_URL) — a display value, never a security decision.
      baseUrl: scimBaseUrl(req),
      assignableRoles: SCIM_ASSIGNABLE_ROLES,
      tokens: rows.map((t) => ({
        id: t.id,
        label: t.label,
        createdAt: t.createdAt,
        createdBy: t.createdBy,
        lastUsedAt: t.lastUsedAt,
        revokedAt: t.revokedAt,
        active: !t.revokedAt,
      })),
    });
  });

  // Created ONCE: the token is in this response and nowhere else, ever.
  app.post("/api/org/scim-tokens", requireAuth, requireRole(...TOKEN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = labelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const existing = await storage().listScimTokens(me.organizationId);
    if (existing.filter((t) => !t.revokedAt).length >= 5) {
      return res.status(409).json({ error: "too_many_tokens" });
    }
    const token = newScimToken();
    const row = await storage().createScimToken({
      organizationId: me.organizationId,
      tokenHash: scimTokenHash(token),
      label: parsed.data.label,
      createdBy: me.id,
    });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "scim.token_create",
      resourceType: "scim_token",
      resourceId: row.id,
      // The label is the director's own free text — never exported, and not
      // put in the audit row either (ids and actions only).
      details: {},
      riskLevel: "high",
    });
    res.status(201).json({
      // Shown once. The server keeps only a SHA-256 of it.
      token,
      id: row.id,
      label: row.label,
      createdAt: row.createdAt,
      baseUrl: scimBaseUrl(req),
    });
  });

  app.delete("/api/org/scim-tokens/:id", requireAuth, requireRole(...TOKEN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: "not_found" });
    const revoked = await storage().revokeScimToken(me.organizationId, id);
    if (!revoked) {
      // Already revoked, or another tenant's id: one answer either way.
      const mine = (await storage().listScimTokens(me.organizationId)).find((t) => t.id === id);
      if (!mine) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true, id, alreadyRevoked: true });
    }
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "scim.token_revoke",
      resourceType: "scim_token",
      resourceId: id,
      details: {},
      riskLevel: "high",
    });
    res.json({ ok: true, id });
  });
}
