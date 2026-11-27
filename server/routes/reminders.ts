import type { Express } from "express";
import { z } from "zod";
import { REMINDER_INTERVALS_MIN } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * Unread-message reminder preference (PerfectServe parity #5, module
 * messaging.unreadReminder — gated centrally in server/modules.ts GATE_TABLE).
 *
 *   GET /api/messaging/unread-reminder   { enabled, intervalMin, intervals }
 *   PUT /api/messaging/unread-reminder   { enabled, intervalMin }
 *
 * The caller's own row only (organization + user from the session, never the
 * body). Off until the user opts in. The reminder itself is sent by the server
 * sweep (services/unread-reminder.ts) — content-free, DND-aware.
 */

const DEFAULT_INTERVAL = 10;
const prefSchema = z
  .object({
    enabled: z.boolean(),
    intervalMin: z.number().int().refine((n) => (REMINDER_INTERVALS_MIN as readonly number[]).includes(n)),
  })
  .strict();

function view(row: { enabled: boolean; intervalMin: number } | undefined) {
  return {
    enabled: !!row?.enabled,
    intervalMin: row?.intervalMin ?? DEFAULT_INTERVAL,
    intervals: [...REMINDER_INTERVALS_MIN],
  };
}

export function registerReminderRoutes(app: Express) {
  app.get("/api/messaging/unread-reminder", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(view(await storage().getReminderPrefs(me.organizationId, me.id)));
  });

  app.put("/api/messaging/unread-reminder", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = prefSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const row = await storage().setReminderPrefs(me.organizationId, me.id, parsed.data);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "reminder.prefs_update",
      resourceType: "user",
      resourceId: me.id,
      details: { enabled: row.enabled, intervalMin: row.intervalMin },
      riskLevel: "low",
    });
    res.json(view(row));
  });
}
