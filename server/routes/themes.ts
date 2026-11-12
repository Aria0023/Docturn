import type { Express } from "express";
import { z } from "zod";
import {
  THEME_FOLLOW_DEVICE_PRESETS,
  THEME_PRESETS,
  THEME_TEXT_SIZES,
  USER_THEME_DEFAULTS,
} from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * Per-user display preferences (module platform.userThemes — gated centrally in
 * server/modules.ts GATE_TABLE).
 *
 *   GET /api/me/theme   { preset, textSize, followDevice, presets, textSizes,
 *                         followDevicePresets, defaults }
 *   PUT /api/me/theme   { preset, textSize, followDevice }
 *
 * The caller's OWN user_theme_prefs row — organization and user come from the
 * session, never from the body, and there is one row per user, so there is no
 * id to address and nothing cross-tenant to reach. The organization's branding
 * (appName, accent, radius, sidebar, content width and its `palette`) stays
 * where it was, on PATCH /api/org/preferences for its directors; a person's
 * preset LAYERS over it, and the default preset "org" is exactly "whatever my
 * organization chose".
 *
 * Values come from the fixed catalogues in shared/schema.ts; the body is
 * strict, so a client that invents a colour or points at a stylesheet is a 400.
 * Not PHI: the audit row carries the three chosen values and the user's own id.
 */

const prefSchema = z
  .object({
    preset: z.enum(THEME_PRESETS),
    textSize: z.enum(THEME_TEXT_SIZES),
    followDevice: z.boolean(),
  })
  .strict();

type Row = { preset: string | null; textSize: string | null; followDevice: boolean } | undefined;

/** The stored row read back through the catalogues — an unknown value reads as the default. */
function view(row: Row) {
  const inList = <T extends string>(list: readonly T[], v: string | null | undefined, d: T): T =>
    (list as readonly string[]).includes(v ?? "") ? (v as T) : d;
  return {
    preset: inList(THEME_PRESETS, row?.preset, USER_THEME_DEFAULTS.preset),
    textSize: inList(THEME_TEXT_SIZES, row?.textSize, USER_THEME_DEFAULTS.textSize),
    followDevice: row ? !!row.followDevice : USER_THEME_DEFAULTS.followDevice,
    presets: [...THEME_PRESETS],
    textSizes: [...THEME_TEXT_SIZES],
    followDevicePresets: [...THEME_FOLLOW_DEVICE_PRESETS],
    defaults: { ...USER_THEME_DEFAULTS },
  };
}

export function registerThemeRoutes(app: Express) {
  app.get("/api/me/theme", requireAuth, async (req, res) => {
    const me = currentUser(req);
    res.json(view(await storage().getThemePrefs(me.organizationId, me.id)));
  });

  app.put("/api/me/theme", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const parsed = prefSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const { preset, textSize, followDevice } = parsed.data;
    const row = await storage().setThemePrefs(me.organizationId, me.id, { preset, textSize, followDevice });
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "theme.prefs_update",
      resourceType: "user",
      resourceId: me.id,
      details: { preset, textSize, followDevice },
      riskLevel: "low",
    });
    res.json(view(row));
  });
}
