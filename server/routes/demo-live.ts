import type { Express } from "express";
import { z } from "zod";
import { appendAudit } from "../audit.js";
import { isPlatformOrg } from "../billing/seats.js";
import { currentUser, requireAuth } from "../rbac.js";
import { liveDemoAvailable, liveDemoStatus, noteViewer, startLiveDemo, stopLiveDemo, storyControl } from "../services/demo-live.js";
import { storage } from "../storage.js";

/**
 * Live demo for sales calls (synthetic-data instances only).
 *
 *   GET  /api/demo/live   status + recent events; also marks the caller as a viewer
 *   POST /api/demo/live   { on: boolean, pace?: "steady" | "busy", mode?: "free" | "story" }
 *                         { on: true, story: "next" | "pause" | "resume" | "replay" }  guided-story controls
 *
 * On a real-PHI instance (SYNTHETIC_DATA=false) both answer 404: the feature
 * does not exist there.
 */
const bodySchema = z.object({
  on: z.boolean(),
  pace: z.enum(["steady", "busy"]).optional(),
  mode: z.enum(["free", "story"]).optional(),
  story: z.enum(["next", "pause", "resume", "replay"]).optional(),
});

export function registerDemoLiveRoutes(app: Express) {
  app.get("/api/demo/live", requireAuth, async (req, res) => {
    if (!liveDemoAvailable()) return res.status(404).json({ error: "not_found" });
    const me = currentUser(req);
    noteViewer(me.organizationId, me.id);
    res.setHeader("Cache-Control", "no-store");
    res.json(liveDemoStatus(me.organizationId));
  });

  app.post("/api/demo/live", requireAuth, async (req, res) => {
    if (!liveDemoAvailable()) return res.status(404).json({ error: "not_found" });
    const me = currentUser(req);
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const org = await storage().getOrganization(me.organizationId);
    if (!org || isPlatformOrg(org)) return res.status(409).json({ error: "clinical_org_only" });
    noteViewer(me.organizationId, me.id);
    // Story controls are presenter clicks, not starts/stops: no audit row each.
    if (parsed.data.on && parsed.data.story) {
      if (!storyControl(org.id, parsed.data.story)) return res.status(409).json({ error: "story_not_running" });
      return res.json(liveDemoStatus(org.id));
    }
    if (parsed.data.on) {
      // Loopback to this same process: the driver uses the app's own endpoints.
      const base = `http://127.0.0.1:${req.socket.localPort}`;
      startLiveDemo({ orgId: org.id, orgCode: org.code, base, pace: parsed.data.pace ?? "steady", mode: parsed.data.mode, startedBy: me.id });
    } else {
      stopLiveDemo(org.id);
    }
    await appendAudit({
      organizationId: org.id,
      userId: me.id,
      action: parsed.data.on ? "demo.live_start" : "demo.live_stop",
      resourceType: "organization",
      resourceId: org.id,
      details: parsed.data.on ? { pace: parsed.data.pace ?? "steady", mode: parsed.data.mode ?? "free" } : {},
      riskLevel: "low",
    });
    res.json(liveDemoStatus(org.id));
  });
}
