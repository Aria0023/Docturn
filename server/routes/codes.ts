import type { Express, Request, Response } from "express";
import { appendAudit, logPhiAccess } from "../audit.js";
import { parseId } from "../params.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";
import {
  CODE_ROLES,
  CODE_TEMPLATES,
  CodeError,
  activateCode,
  activateSchema,
  broadcastCodeChange,
  canManageCodes,
  codeViews,
  mayActOn,
  normalizeProtocol,
  protocolInputSchema,
  publicProtocol,
  resolveTeam,
  teamOptions,
} from "../services/codes.js";

/**
 * Code protocols (module codes.protocols). Every clinical role can see the
 * organization's codes and call one; directors and ER directors manage the
 * protocols. Acknowledging and arriving are the team member's own actions;
 * steps and closing belong to the team, the person who called the code and
 * the director roles.
 */
const MANAGERS = ["director", "er_director", "developer"] as const;

function fail(res: Response, err: unknown) {
  if (err instanceof CodeError) return res.status(err.status).json({ error: err.code });
  throw err;
}

/** The ACTIVE activation a member action names, with its team — or the response is already sent. */
async function activeCode(req: Request, res: Response) {
  const me = currentUser(req);
  const id = parseId(req.params.id);
  const act = id == null ? undefined : await storage().getCodeActivation(me.organizationId, id);
  if (!act) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  if (act.status !== "active") {
    res.status(409).json({ error: "code_closed" });
    return null;
  }
  return { me, act, members: await storage().listCodeMembers(me.organizationId, [act.id]) };
}

export function registerCodeRoutes(app: Express) {
  app.get("/api/codes", requireAuth, requireRole(...CODE_ROLES), async (req, res) => {
    const me = currentUser(req);
    const manage = canManageCodes(me);
    const [protocols, activations] = await Promise.all([storage().listCodeProtocols(me.organizationId), codeViews(storage(), me)]);
    if (activations.some((a) => a.patient)) await logPhiAccess(req, "codes");
    res.setHeader("Cache-Control", "no-store");
    res.json({
      canManage: manage,
      protocols: protocols.filter((p) => manage || p.enabled).map(publicProtocol),
      activations,
      templates: manage ? CODE_TEMPLATES : [],
    });
  });

  // What a director can put on a team: on-call roles and people.
  app.get("/api/codes/team-options", requireAuth, requireRole(...MANAGERS), async (req, res) => {
    res.json(await teamOptions(storage(), currentUser(req)));
  });

  // Who would be alerted if this protocol were activated right now.
  app.get("/api/codes/protocols/:id/team", requireAuth, requireRole(...CODE_ROLES), async (req, res) => {
    const me = currentUser(req);
    const id = parseId(req.params.id);
    const protocol = id == null ? undefined : await storage().getCodeProtocol(me.organizationId, id);
    if (!protocol || (!protocol.enabled && !canManageCodes(me))) return res.status(404).json({ error: "not_found" });
    res.json({ team: await resolveTeam(storage(), me, protocol.team) });
  });

  app.post("/api/codes/protocols", requireAuth, requireRole(...MANAGERS), async (req, res) => {
    const me = currentUser(req);
    const parsed = protocolInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const existing = await storage().listCodeProtocols(me.organizationId);
    if (existing.length >= 30) return res.status(409).json({ error: "too_many_protocols" });
    if (existing.some((p) => p.name.toLowerCase() === parsed.data.name.toLowerCase())) return res.status(409).json({ error: "name_taken" });
    const row = await storage().createCodeProtocol({ organizationId: me.organizationId, updatedBy: me.id, ...normalizeProtocol(parsed.data) });
    await appendAudit({
      organizationId: me.organizationId, userId: me.id, action: "code.protocol_create", resourceType: "code_protocol", resourceId: row.id,
      details: { name: row.name, team: row.team.length, steps: row.steps.length }, riskLevel: "medium",
    });
    broadcastCodeChange(me.organizationId, 0);
    res.status(201).json(publicProtocol(row));
  });

  app.patch("/api/codes/protocols/:id", requireAuth, requireRole(...MANAGERS), async (req, res) => {
    const me = currentUser(req);
    const id = parseId(req.params.id);
    const current = id == null ? undefined : await storage().getCodeProtocol(me.organizationId, id);
    if (!current) return res.status(404).json({ error: "not_found" });
    const parsed = protocolInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const others = (await storage().listCodeProtocols(me.organizationId)).filter((p) => p.id !== current.id);
    if (others.some((p) => p.name.toLowerCase() === parsed.data.name.toLowerCase())) return res.status(409).json({ error: "name_taken" });
    const row = await storage().updateCodeProtocol(me.organizationId, current.id, { updatedBy: me.id, ...normalizeProtocol(parsed.data) });
    if (!row) return res.status(404).json({ error: "not_found" });
    await appendAudit({
      organizationId: me.organizationId, userId: me.id, action: "code.protocol_update", resourceType: "code_protocol", resourceId: row.id,
      details: { name: row.name, team: row.team.length, steps: row.steps.length, enabled: row.enabled }, riskLevel: "medium",
    });
    broadcastCodeChange(me.organizationId, 0);
    res.json(publicProtocol(row));
  });

  // Deleting a protocol never touches the codes already called with it.
  app.delete("/api/codes/protocols/:id", requireAuth, requireRole(...MANAGERS), async (req, res) => {
    const me = currentUser(req);
    const id = parseId(req.params.id);
    const current = id == null ? undefined : await storage().getCodeProtocol(me.organizationId, id);
    if (!current) return res.status(404).json({ error: "not_found" });
    await storage().deleteCodeProtocol(me.organizationId, current.id);
    await appendAudit({
      organizationId: me.organizationId, userId: me.id, action: "code.protocol_delete", resourceType: "code_protocol", resourceId: current.id,
      details: { name: current.name }, riskLevel: "medium",
    });
    broadcastCodeChange(me.organizationId, 0);
    res.status(204).end();
  });

  app.post("/api/codes/activate", requireAuth, requireRole(...CODE_ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = activateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    try {
      const act = await activateCode(storage(), me, parsed.data);
      res.status(201).json({ id: act.id });
    } catch (err) {
      return fail(res, err);
    }
  });

  const memberAction = (what: "ack" | "arrived") => async (req: Request, res: Response) => {
    const ctx = await activeCode(req, res);
    if (!ctx) return;
    const { me, act, members } = ctx;
    if (!members.some((m) => m.userId === me.id)) return res.status(403).json({ error: "not_on_team" });
    const changed = await storage().markCodeMember(me.organizationId, act.id, me.id, what, new Date());
    if (changed) {
      await appendAudit({
        organizationId: me.organizationId, userId: me.id, action: what === "ack" ? "code.ack" : "code.arrived",
        resourceType: "code_activation", resourceId: act.id, details: { protocol: act.protocolName }, riskLevel: "low",
      });
      broadcastCodeChange(me.organizationId, act.id);
    }
    res.status(204).end();
  };
  app.post("/api/codes/activations/:id/ack", requireAuth, requireRole(...CODE_ROLES), memberAction("ack"));
  app.post("/api/codes/activations/:id/arrived", requireAuth, requireRole(...CODE_ROLES), memberAction("arrived"));

  app.post("/api/codes/activations/:id/steps/:stepId", requireAuth, requireRole(...CODE_ROLES), async (req, res) => {
    const ctx = await activeCode(req, res);
    if (!ctx) return;
    const { me, act, members } = ctx;
    if (!mayActOn(me, act, members)) return res.status(403).json({ error: "not_on_team" });
    const stepId = parseId(req.params.stepId);
    const done = (req.body ?? {}).done;
    if (stepId == null || typeof done !== "boolean") return res.status(400).json({ error: "validation_error" });
    const row = await storage().setCodeStep(me.organizationId, act.id, stepId, done ? { at: new Date(), by: me.id } : null);
    if (row) {
      await appendAudit({
        organizationId: me.organizationId, userId: me.id, action: done ? "code.step_done" : "code.step_undone",
        resourceType: "code_activation", resourceId: act.id, details: { protocol: act.protocolName, step: row.label }, riskLevel: "low",
      });
      broadcastCodeChange(me.organizationId, act.id);
    } else if (!(await storage().listCodeSteps(me.organizationId, [act.id])).some((s) => s.id === stepId)) {
      return res.status(404).json({ error: "not_found" });
    }
    res.status(204).end();
  });

  app.post("/api/codes/activations/:id/close", requireAuth, requireRole(...CODE_ROLES), async (req, res) => {
    const ctx = await activeCode(req, res);
    if (!ctx) return;
    const { me, act, members } = ctx;
    if (!mayActOn(me, act, members)) return res.status(403).json({ error: "not_on_team" });
    const outcome = (req.body ?? {}).outcome;
    if (outcome !== "completed" && outcome !== "stood_down") return res.status(400).json({ error: "validation_error" });
    const closed = await storage().closeCodeActivation(me.organizationId, act.id, outcome, me.id, new Date());
    if (!closed) return res.status(409).json({ error: "code_closed" });
    await appendAudit({
      organizationId: me.organizationId, userId: me.id, action: outcome === "completed" ? "code.complete" : "code.stand_down",
      resourceType: "code_activation", resourceId: act.id, details: { protocol: act.protocolName }, riskLevel: "medium",
    });
    broadcastCodeChange(me.organizationId, act.id);
    res.status(204).end();
  });
}
