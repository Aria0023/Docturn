import express, { type Express } from "express";
import { appendAudit } from "../audit.js";
import { isModuleEnabled } from "../modules.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { broadcastAssignmentChange } from "../services/notifications.js";
import { storage } from "../storage.js";
import {
  ADT_MODULE,
  AdtParseError,
  adtAck,
  applyAdt,
  issueAdtToken,
  orgForAdtToken,
  parseAdt,
  readAdtState,
  recordAdt,
  revokeAdtToken,
} from "../services/adt-feed.js";

/**
 * EHR admission feed (module ehr.adtFeed; server/services/adt-feed.ts).
 *
 *   GET/POST/DELETE /api/ehr/adt/token — a director's view of the feed, and
 *     generating / revoking its token (shown once).
 *   POST /api/ehr/adt — the interface engine posts one HL7 v2 ADT message
 *     with `Authorization: Bearer <token>`; the answer is an HL7 ACK.
 *
 * The receiver has no session: the token names the hospital. Nothing from a
 * message is logged or audited beyond the event type and the outcome.
 */
export function registerAdtRoutes(app: Express) {
  const managers = requireRole("director", "developer");

  app.get("/api/ehr/adt/token", requireAuth, managers, async (req, res) => {
    const s = await readAdtState(storage(), currentUser(req).organizationId);
    res.json({ connected: !!s.tokenHash, createdAt: s.createdAt, lastMessageAt: s.lastMessageAt, lastEvent: s.lastEvent, received: s.received, rejected: s.rejected });
  });

  app.post("/api/ehr/adt/token", requireAuth, managers, async (req, res) => {
    const me = currentUser(req);
    const replaced = !!(await readAdtState(storage(), me.organizationId)).tokenHash;
    const token = await issueAdtToken(storage(), me.organizationId, me.id);
    await appendAudit({
      organizationId: me.organizationId, userId: me.id, action: "ehr.adt_token_issue", resourceType: "organization",
      resourceId: me.organizationId, details: { replaced }, riskLevel: "high",
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ token });
  });

  app.delete("/api/ehr/adt/token", requireAuth, managers, async (req, res) => {
    const me = currentUser(req);
    await revokeAdtToken(storage(), me.organizationId, me.id);
    await appendAudit({
      organizationId: me.organizationId, userId: me.id, action: "ehr.adt_token_revoke", resourceType: "organization",
      resourceId: me.organizationId, details: {}, riskLevel: "high",
    });
    res.status(204).end();
  });

  app.post("/api/ehr/adt", express.text({ type: () => true, limit: "64kb" }), async (req, res) => {
    const raw = typeof req.body === "string" ? req.body : "";
    const hl7 = (code: "AA" | "AE" | "AR", status: number, text = "") =>
      res.status(status).type("application/hl7-v2").send(adtAck(raw, code, text));
    const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ""));
    const orgId = m ? await orgForAdtToken(storage(), m[1]!) : null;
    // Unknown token and switched-off module look the same from outside.
    if (orgId == null || !(await isModuleEnabled(orgId, ADT_MODULE))) return hl7("AR", 401, "not authorized");
    try {
      const msg = parseAdt(raw);
      const outcome = await applyAdt(storage(), orgId, msg, await isModuleEnabled(orgId, "patients.identity"));
      await recordAdt(storage(), orgId, true, msg.event);
      if (outcome !== "ignored") broadcastAssignmentChange(orgId);
      return hl7("AA", 200, outcome);
    } catch (err) {
      await recordAdt(storage(), orgId, false, null).catch(() => {});
      if (err instanceof AdtParseError) return hl7("AE", 400, err.message);
      console.error("[adt] message could not be applied:", err instanceof Error ? err.name : "error");
      return hl7("AE", 500, "not applied");
    }
  });
}
