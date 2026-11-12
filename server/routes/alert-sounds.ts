import type { Express } from "express";
import { z } from "zod";
import { ALERT_SOUNDS, ALERT_SOUND_DEFAULTS } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * Priority alert sounds (PerfectServe parity #8, module messaging.alertSounds —
 * gated centrally in server/modules.ts GATE_TABLE).
 *
 *   GET /api/messaging/alert-sounds   { stat, urgent, routine, sounds, defaults }
 *   PUT /api/messaging/alert-sounds   { stat, urgent, routine }
 *
 * The caller's own user_sound_prefs row (organization + user from the
 * session, never the body). The tones are generated in the browser by
 * WebAudio and played by the OPEN app only — the server stores the choice,
 * it plays nothing; push notifications (iPhone lock screen) use the system
 * sound, and the UI says so.
 */

const sound = z.enum(ALERT_SOUNDS);
const prefSchema = z.object({ stat: sound, urgent: sound, routine: sound }).strict();

function view(row: { statSound: string | null; urgentSound: string | null; routineSound: string | null } | undefined) {
  const pick = (v: string | null | undefined, d: string) => ((ALERT_SOUNDS as readonly string[]).includes(v ?? "") ? v! : d);
  return {
    stat: pick(row?.statSound, ALERT_SOUND_DEFAULTS.stat),
    urgent: pick(row?.urgentSound, ALERT_SOUND_DEFAULTS.urgent),
    routine: pick(row?.routineSound, ALERT_SOUND_DEFAULTS.routine),
    sounds: [...ALERT_SOUNDS],
    defaults: { ...ALERT_SOUND_DEFAULTS },
  };
}

export function registerAlertSoundRoutes(app: Express) {
  app.get("/api/messaging/alert-sounds", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(view(await storage().getSoundPrefs(me.organizationId, me.id)));
  });

  app.put("/api/messaging/alert-sounds", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = prefSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const row = await storage().setSoundPrefs(me.organizationId, me.id, {
      statSound: parsed.data.stat,
      urgentSound: parsed.data.urgent,
      routineSound: parsed.data.routine,
    });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "sound.prefs_update",
      resourceType: "user",
      resourceId: me.id,
      details: { stat: parsed.data.stat, urgent: parsed.data.urgent, routine: parsed.data.routine },
      riskLevel: "low",
    });
    res.json(view(row));
  });
}
