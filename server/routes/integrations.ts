import type { Express, Request, Response } from "express";
import type { Organization } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { setModule } from "../modules.js";
import { parseId } from "../params.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";
import { credentialKeyState } from "../integrations/crypto.js";
import { isOrgScopeIntegration, saveOrgCredentials } from "../integrations/credentials.js";
import {
  buildCard,
  buildCards,
  INTEGRATIONS,
  integrationDef,
  integrationStatus,
  runIntegrationTest,
  type IntegrationCard,
} from "../integrations/registry.js";

/**
 * Settings → Integrations — the real panel behind every card.
 *
 *   GET    /api/integrations[?orgId=]                          cards for the org
 *   PATCH  /api/integrations/:integrationId          {enabled} the org's gating module
 *   POST   /api/integrations/:integrationId/test               real, harmless connectivity test
 *   PUT    /api/integrations/:integrationId/credentials        write-only, encrypted (Amion / Epic)
 *   DELETE /api/integrations/:integrationId/credentials
 *   GET    /api/dev/integrations                               developer: every org × integration
 *
 * Roles: director, er_director, developer (hospitalists 403). Org-scoped: a
 * director acts on their own org only — any other ?orgId is a 404 (no
 * existence oracle); a developer may name any org. The switch a director can
 * flip here is ONLY one of the five integrations' gating modules (an
 * allowlist by construction: the id must be in the registry); every other
 * module stays developer-only (PATCH /api/dev/modules). Audit rows carry ids
 * and outcomes only — never a credential, URL or token.
 *
 * The param is :integrationId (a string) because :id is reserved for numeric
 * keys by the app-wide guard (server/params.ts).
 */
const ROLES = ["director", "er_director", "developer"] as const;

async function targetOrg(req: Request, res: Response): Promise<Organization | null> {
  const me = currentUser(req);
  const raw = req.query.orgId;
  let orgId = me.organizationId;
  if (raw !== undefined && raw !== "") {
    const id = parseId(raw);
    if (id === null || (me.role !== "developer" && id !== me.organizationId)) {
      res.status(404).json({ error: "not_found" });
      return null;
    }
    orgId = id;
  }
  const org = await storage().getOrganization(orgId);
  if (!org) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return org;
}

function defOr404(req: Request, res: Response) {
  const def = integrationDef(String(req.params.integrationId ?? ""));
  if (!def) res.status(404).json({ error: "not_found" });
  return def ?? null;
}

/** The 409 body for "can't switch this on yet" — reused by the developer module console. */
export function notReadyBody(card: IntegrationCard) {
  return {
    error: "integration_not_ready",
    integration: card.id,
    status: card.status,
    reason: card.statusText,
    missing: card.missing,
    invalid: card.invalid,
  };
}

export function registerIntegrationRoutes(app: Express) {
  app.get("/api/integrations", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const org = await targetOrg(req, res);
    if (!org) return;
    // A developer reading a tenant's integrations is a cross-tenant read: one
    // ids-only row in that tenant's trail, before the read.
    if (me.role === "developer" && org.id !== me.organizationId) {
      await appendAudit({
        organizationId: org.id,
        userId: me.id,
        action: "dev.integrations_read",
        resourceType: "organization",
        resourceId: org.id,
        details: { orgId: org.id },
        riskLevel: "low",
      });
    }
    const key = credentialKeyState();
    res.json({
      orgId: org.id,
      orgCode: org.code,
      orgName: org.name,
      credentialStorage: { available: key.ok, message: key.ok ? null : key.message },
      integrations: await buildCards(storage(), org),
    });
  });

  app.patch("/api/integrations/:integrationId", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const def = defOr404(req, res);
    if (!def) return;
    const org = await targetOrg(req, res);
    if (!org) return;
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "validation_error" });
    if (enabled) {
      const before = await buildCard(storage(), def, org);
      if (!before.canEnable) return res.status(409).json(notReadyBody(before));
    }
    await setModule(org.id, def.module, enabled, me.id);
    await appendAudit({
      organizationId: org.id,
      userId: me.id,
      action: enabled ? "integration.enable" : "integration.disable",
      resourceType: "organization",
      resourceId: org.id,
      details: { integration: def.id, module: def.module },
      riskLevel: "medium",
    });
    res.json({ integration: await buildCard(storage(), def, org) });
  });

  app.post("/api/integrations/:integrationId/test", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const def = defOr404(req, res);
    if (!def) return;
    const org = await targetOrg(req, res);
    if (!org) return;
    const result = await runIntegrationTest(storage(), def, org, me.id);
    if (!result) {
      const card = await buildCard(storage(), def, org);
      return res.status(409).json({ error: "integration_not_configured", status: card.status, reason: card.statusText, missing: card.missing, invalid: card.invalid });
    }
    await appendAudit({
      organizationId: org.id,
      userId: me.id,
      action: "integration.test",
      resourceType: "organization",
      resourceId: org.id,
      details: { integration: def.id, ok: result.ok, code: result.code },
      riskLevel: "low",
    });
    res.json({
      ok: result.ok,
      code: result.code,
      message: result.message,
      detail: result.detail ?? null,
      at: result.at,
      integration: await buildCard(storage(), def, org),
    });
  });

  app.put("/api/integrations/:integrationId/credentials", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const def = defOr404(req, res);
    if (!def) return;
    const org = await targetOrg(req, res);
    if (!org) return;
    if (!isOrgScopeIntegration(def.id)) {
      return res.status(400).json({
        error: "platform_scope",
        message: `${def.name} uses the DocTurn operator's account: its keys are set on the server (Render Environment or AWS SSM), never stored through this screen.`,
      });
    }
    const saved = await saveOrgCredentials(storage(), org.id, def.id, req.body, me.id);
    if (!saved.ok) {
      return res.status(saved.status).json({ error: saved.error, field: saved.field ?? null, message: saved.message });
    }
    await appendAudit({
      organizationId: org.id,
      userId: me.id,
      action: "integration.credentials_set",
      resourceType: "organization",
      resourceId: org.id,
      details: { integration: def.id },
      riskLevel: "high",
    });
    res.json({ integration: await buildCard(storage(), def, org) });
  });

  app.delete("/api/integrations/:integrationId/credentials", requireAuth, requireRole(...ROLES), async (req, res) => {
    const me = currentUser(req);
    const def = defOr404(req, res);
    if (!def) return;
    const org = await targetOrg(req, res);
    if (!org) return;
    if (!isOrgScopeIntegration(def.id)) return res.status(400).json({ error: "platform_scope" });
    const removed = await storage().deleteIntegrationCredential(org.id, def.id);
    if (removed) {
      await appendAudit({
        organizationId: org.id,
        userId: me.id,
        action: "integration.credentials_cleared",
        resourceType: "organization",
        resourceId: org.id,
        details: { integration: def.id },
        riskLevel: "high",
      });
    }
    res.json({ removed, integration: await buildCard(storage(), def, org) });
  });

  // Developer console: the same truth across every org (cross-tenant list →
  // one ids-only row in the operator's own org).
  app.get("/api/dev/integrations", requireAuth, requireRole("developer"), async (req, res) => {
    const me = currentUser(req);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "dev.integrations_overview",
      resourceType: "organization",
      resourceId: null,
      details: {},
      riskLevel: "low",
    });
    const orgs = await storage().listOrganizations();
    const platform = orgs.find((o) => o.id === me.organizationId) ?? orgs[0];
    const integrations = [] as Array<Record<string, unknown>>;
    for (const def of INTEGRATIONS) {
      const c = platform ? await buildCard(storage(), def, platform) : null;
      integrations.push({
        id: def.id,
        name: def.name,
        vendor: def.vendor,
        scope: def.scope,
        module: def.module,
        phi: def.phi,
        baaRequired: def.baaRequired,
        // Platform-scope: the operator's own configuration (same for every org).
        platform: def.scope === "platform" && c ? { configured: c.canEnable, needsBaa: c.status === "needs_baa", missing: c.missing, invalid: c.invalid, note: c.note } : null,
        setup: def.scope === "platform" && c ? c.setup : null,
      });
    }
    const rows = [] as Array<{ orgId: number; code: string; name: string; statuses: Record<string, string>; enabled: Record<string, boolean> }>;
    for (const org of orgs) {
      const statuses: Record<string, string> = {};
      const enabled: Record<string, boolean> = {};
      for (const def of INTEGRATIONS) {
        const s = await integrationStatus(storage(), def, org);
        statuses[def.id] = s.status;
        enabled[def.id] = s.enabled;
      }
      rows.push({ orgId: org.id, code: org.code, name: org.name, statuses, enabled });
    }
    const key = credentialKeyState();
    res.json({ credentialStorage: { available: key.ok, message: key.ok ? null : key.message }, integrations, orgs: rows });
  });
}
