import type { Express } from "express";
import { z } from "zod";
import type { Patient, User } from "@shared/schema";
import { appendAudit, logPhiAccess } from "../audit.js";
import { isModuleEnabled, requireModule } from "../modules.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { isDnd, resolveCovering } from "../services/escalation.js";
import { previewNext } from "../services/rotation.js";
import {
  allSourceStatuses,
  createSourceRegistry,
  fetchSelectedSlots,
  getSelectedSource,
  isScheduleSourceId,
  setSelectedSource,
  type OnCallSlot,
  type ScheduleSourceId,
  type ScheduleSourceStatus,
  type ShiftType,
  type SourceRegistry,
} from "../services/schedule-sources/index.js";
import {
  EPIC_NOT_CONFIGURED_MESSAGE,
  epicConfigured,
  syncEpic,
  type EpicClientDeps,
} from "../services/schedule-sources/epic-fhir.js";
import {
  addManualSlot,
  listManualSlots,
  manualSlotInputSchema,
  manualSlotPatchSchema,
  removeManualSlot,
  updateManualSlot,
} from "../services/schedule-sources/manual.js";
import { storage, type DatabaseStorage } from "../storage.js";

/**
 * "Who's on call" board + schedule-source management + EHR deep links.
 *
 *   GET    /api/oncall/board            every role/service with its current holder
 *   GET    /api/oncall/sources          amion / epic / manual status for this org
 *   PATCH  /api/oncall/source           { source } director/developer
 *   GET    /api/oncall/manual           manual slots
 *   POST   /api/oncall/manual           director/developer
 *   PATCH  /api/oncall/manual/:id       director/developer
 *   DELETE /api/oncall/manual/:id       director/developer
 *   POST   /api/oncall/epic/sync-now    director/developer, module schedule.epic
 *   GET    /api/ehr/config              deep-link vendor/template (+ presets)
 *   PATCH  /api/ehr/config              director/developer
 *   GET    /api/patients/:id/ehr-link   module ehr.deepLinks; care team / director; audited
 *
 * Every read is org-scoped; a holder is only ever a real user IN THE CALLER'S
 * ORG (never invented, never cross-tenant). DND → covering redirection reuses
 * the same helpers the messaging on-call picker uses (services/escalation.ts,
 * services/rotation.ts) so the two views can never disagree.
 */

// ── source registry (per storage instance; tests may inject Epic deps) ───────
let registry: SourceRegistry | null = null;
let registryFor: DatabaseStorage | null = null;
let epicDeps: EpicClientDeps | undefined;

/** Test hook: inject an Epic fetch/now/env and rebuild the registry. */
export function configureOnCallSources(opts: { epic?: EpicClientDeps } = {}) {
  epicDeps = opts.epic;
  registry = null;
  registryFor = null;
}
function sources(): SourceRegistry {
  const db = storage();
  if (!registry || registryFor !== db) {
    registry = createSourceRegistry(db, { epic: epicDeps });
    registryFor = db;
  }
  return registry;
}

// ── board ─────────────────────────────────────────────────────────────────────
export type BoardGroup = "Hospitalist slots" | "Triage" | "Night" | "Consult services" | "Next up";

export interface BoardRow {
  kind: "schedule" | "consult_service" | "next_hospitalist";
  id: string;
  group: BoardGroup;
  label: string;
  service: string;
  holderName: string | null;
  holderUserId: number | null;
  /** Set when the holder is on DND and designated a covering provider. */
  covering: { userId: number; name: string } | null;
  dnd: boolean;
  shift: ShiftType | null;
  hours: string;
  source: ScheduleSourceId | "consults" | "rotation";
  asOf: string | null;
  secure: boolean;
  /** True when a "Message" button should work (resolves to a real, reachable, non-self user). */
  messageable: boolean;
  /** Who a message actually goes to (covering when DND), or null. */
  messageUserId: number | null;
}

export interface BoardResponse {
  source: { id: ScheduleSourceId; explicit: boolean; status: ScheduleSourceStatus };
  generatedAt: string;
  rows: BoardRow[];
}

function groupForSlot(s: OnCallSlot): BoardGroup {
  if (/triage/i.test(s.slot)) return "Triage";
  if (s.shift === "night") return "Night";
  return "Hospitalist slots";
}

export async function buildOnCallBoard(
  db: DatabaseStorage,
  me: Pick<User, "id" | "organizationId">,
  reg: SourceRegistry,
): Promise<BoardResponse> {
  const orgId = me.organizationId;
  const users = await db.listUsers(orgId);
  const byId = new Map(users.map((u) => [u.id, u]));
  const byName = new Map(users.map((u) => [u.displayName.trim().toLowerCase(), u]));

  const rows: BoardRow[] = [];
  const seen = new Set<string>();

  async function push(
    base: Omit<BoardRow, "covering" | "dnd" | "messageable" | "messageUserId">,
  ) {
    // A holder must be a real in-org user to be addressable; a named-but-
    // unmatched holder still shows (the schedule says so) but isn't messageable.
    const holderUserId = base.holderUserId != null && byId.has(base.holderUserId) ? base.holderUserId : null;
    const key = `${base.kind}|${base.label.toLowerCase()}|${holderUserId ?? (base.holderName ?? "").toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    let covering: BoardRow["covering"] = null;
    let dnd = false;
    let messageUserId: number | null = holderUserId;
    if (holderUserId != null && (await isDnd(db, holderUserId))) {
      dnd = true;
      const coveringId = await resolveCovering(db, orgId, holderUserId);
      const cu = coveringId != null ? byId.get(coveringId) : undefined;
      covering = cu ? { userId: cu.id, name: cu.displayName } : null;
      messageUserId = cu ? cu.id : null; // no covering → unreachable, never route into a muted inbox
    }
    const messageable = messageUserId != null && messageUserId !== me.id;
    rows.push({
      ...base,
      holderUserId,
      holderName: base.holderName ?? (holderUserId != null ? byId.get(holderUserId)!.displayName : null),
      covering,
      dnd,
      messageable,
      messageUserId: messageable ? messageUserId : null,
    });
  }

  // 1) Schedule slots from the org's selected source (Amion / Epic / manual).
  const { source, slots } = await fetchSelectedSlots(db, reg, orgId);
  for (const s of slots) {
    await push({
      kind: "schedule",
      id: `schedule:${source}:${s.slot}:${s.providerName}`,
      group: groupForSlot(s),
      label: s.slot,
      service: s.service,
      holderName: s.providerName,
      holderUserId: s.providerUserId,
      shift: s.shift,
      hours: s.hours,
      source: s.source,
      asOf: s.asOf,
      secure: s.secure,
    });
  }

  // 2) Consult services (org setting "consultServices") — same resolution rule
  //    as /api/messaging/on-call-targets: explicit userId, else display name.
  const consultServices = await db.getOrgSetting(orgId, "consultServices");
  if (Array.isArray(consultServices)) {
    for (const svc of consultServices) {
      const onCall = svc?.onCall;
      if (!svc?.name) continue;
      let userId: number | null = typeof onCall?.userId === "number" ? onCall.userId : null;
      if (userId == null && typeof onCall?.name === "string") {
        userId = byName.get(onCall.name.trim().toLowerCase())?.id ?? null;
      }
      await push({
        kind: "consult_service",
        id: `consult_service:${svc.id ?? svc.name}`,
        group: "Consult services",
        label: `On-call ${svc.name}`,
        service: String(svc.name),
        holderName: typeof onCall?.name === "string" && onCall.name ? onCall.name : null,
        holderUserId: userId,
        shift: null,
        hours: "",
        source: "consults",
        asOf: null,
        secure: userId != null,
      });
    }
  }

  // 3) Next hospitalist by rotation (read-only preview — no cursor advance).
  const next = await previewNext(db, orgId);
  if (next) {
    const u = byId.get(next.userId);
    await push({
      kind: "next_hospitalist",
      id: "next_hospitalist",
      group: "Next up",
      label: "Next hospitalist",
      service: next.specialty || "Hospital Medicine",
      holderName: u?.displayName ?? null,
      holderUserId: next.userId,
      shift: next.shiftType as ShiftType,
      hours: "",
      source: "rotation",
      asOf: null,
      secure: !!u,
    });
  }

  const sel = await getSelectedSource(db, orgId);
  return {
    source: { id: sel.id, explicit: sel.explicit, status: await reg.get(sel.id).status(orgId) },
    generatedAt: new Date().toISOString(),
    rows,
  };
}

// ── EHR deep links ────────────────────────────────────────────────────────────
export const EHR_SETTING_KEY = "ehrDeepLink";
const EHR_VENDORS = ["epic", "cerner", "custom"] as const;
export type EhrVendor = (typeof EHR_VENDORS)[number];

/**
 * Presets are STARTING TEMPLATES, not working URLs: every health system's Epic
 * / Cerner team issues the exact launch scheme, host and parameters for their
 * deployment. A template still carrying a YOUR-…-HOST placeholder is treated as
 * not configured, so nobody can open a link that goes nowhere.
 */
export const EHR_PRESETS: Record<string, { vendor: EhrVendor; label: string; template: string; note: string }> = {
  epic_haiku: {
    vendor: "epic",
    label: "Epic Haiku / Canto (mobile)",
    template: "epichaiku://launch?mrn={ehrId}",
    note: "Opens the patient in Epic's mobile apps. The exact URL scheme and parameters (mrn / csn / launch context) are provided by your health system's Epic team — Haiku/Canto deep links are configured per deployment.",
  },
  epic_hyperspace: {
    vendor: "epic",
    label: "Epic Hyperspace (web launch)",
    template: "https://YOUR-EPIC-HOST/EpicWeb/Launch?mrn={ehrId}",
    note: "Replace YOUR-EPIC-HOST (and the path) with the Hyperspace Web / Hyperdrive launch URL your Epic team publishes for patient-context launch.",
  },
  cerner_powerchart: {
    vendor: "cerner",
    label: "Cerner PowerChart",
    template: "https://YOUR-CERNER-HOST/PowerChart/launch?mrn={ehrId}",
    note: "Replace YOUR-CERNER-HOST with the PowerChart (or PowerChart Touch) patient-launch URL from your Cerner team.",
  },
};

const FORBIDDEN_SCHEMES = new Set(["javascript", "data", "vbscript", "file", "blob", "about"]);
const PLACEHOLDER_HOST = /YOUR-[A-Z0-9-]*HOST/i;

export const ehrConfigSchema = z.object({
  vendor: z.enum(EHR_VENDORS),
  template: z.string().trim().max(2048),
});

/** Validate a template's shape; returns an error code or null when acceptable. */
export function validateEhrTemplate(template: string): string | null {
  if (!template) return "template_required";
  if (/\s/.test(template)) return "template_whitespace";
  if (!/\{ehrId\}/.test(template)) return "template_missing_placeholder";
  const m = template.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!m) return "template_scheme";
  if (FORBIDDEN_SCHEMES.has(m[1]!.toLowerCase())) return "template_scheme";
  return null;
}

export interface EhrConfig {
  vendor: EhrVendor;
  template: string;
  /** Valid template with no placeholder host left in it. */
  configured: boolean;
}

export async function getEhrConfig(db: DatabaseStorage, orgId: number): Promise<EhrConfig> {
  const raw = (await db.getOrgSetting(orgId, EHR_SETTING_KEY)) as Partial<EhrConfig> | null;
  const vendor = raw && (EHR_VENDORS as readonly string[]).includes(String(raw.vendor)) ? (raw.vendor as EhrVendor) : "epic";
  const template = raw && typeof raw.template === "string" ? raw.template : "";
  const configured = validateEhrTemplate(template) == null && !PLACEHOLDER_HOST.test(template);
  return { vendor, template, configured };
}

/** Fill the template. The id is URL-encoded so it can never break out of the URL. */
export function resolveEhrLink(template: string, ehrId: string): string {
  const enc = encodeURIComponent(ehrId);
  return template.replace(/\{ehrId\}/g, enc).replace(/\{mrn\}/gi, enc).replace(/\{csn\}/gi, enc);
}

/**
 * The users with a legitimate treatment relationship to this patient: the ER
 * physician of record, everyone on its assignments (routed hospitalist, whoever
 * accepted, the admitting ER doc), the accepted hospitalist's care-team unit,
 * accepted consultants and the patient-thread participants.
 */
export async function patientCareTeam(db: DatabaseStorage, orgId: number, patient: Patient): Promise<Set<number>> {
  const team = new Set<number>();
  if (patient.erDoctorId) team.add(patient.erDoctorId);
  for (const a of await db.listAssignments(orgId)) {
    if (a.patientId !== patient.id) continue;
    if (a.erDoctorId) team.add(a.erDoctorId);
    if (a.acceptedByUserId) team.add(a.acceptedByUserId);
    if (a.status === "pending" || a.status === "accepted") {
      const h = await db.getHospitalist(orgId, a.hospitalistId);
      if (h?.userId) {
        team.add(h.userId);
        if (a.status === "accepted") for (const uid of await db.unitUserIds(orgId, h.userId)) team.add(uid);
      }
    }
  }
  for (const c of await db.listConsultsForPatient(orgId, patient.id)) {
    if (c.status === "accepted" && c.consultantUserId) team.add(c.consultantUserId);
  }
  const thread = await db.getConversationByPatient(orgId, patient.id);
  for (const uid of thread?.participantIds ?? []) team.add(uid);
  return team;
}

const OVERSIGHT_ROLES = new Set<string>(["director", "er_director"]);

// ── routes ────────────────────────────────────────────────────────────────────
const sourcePatchSchema = z.object({ source: z.string() });

export function registerOnCallRoutes(app: Express) {
  app.get("/api/oncall/board", requireAuth, requireModule("oncall.board"), async (req, res) => {
    const me = currentUser(req);
    res.json(await buildOnCallBoard(storage(), me, sources()));
  });

  app.get("/api/oncall/sources", requireAuth, requireModule("oncall.board"), async (req, res) => {
    const me = currentUser(req);
    const sel = await getSelectedSource(storage(), me.organizationId);
    const statuses = await allSourceStatuses(sources(), me.organizationId);
    // Module switches decide whether a source is even offered.
    const [amionOn, epicOn] = await Promise.all([
      isModuleEnabled(me.organizationId, "schedule.amion"),
      isModuleEnabled(me.organizationId, "schedule.epic"),
    ]);
    res.json({
      selected: sel.id,
      explicit: sel.explicit,
      sources: statuses,
      modules: { amion: amionOn, epic: epicOn, manual: true },
    });
  });

  app.patch(
    "/api/oncall/source",
    requireAuth,
    requireModule("oncall.board"),
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = sourcePatchSchema.safeParse(req.body);
      if (!parsed.success || !isScheduleSourceId(parsed.data.source)) {
        return res.status(400).json({ error: "validation_error" });
      }
      const id = parsed.data.source;
      if (id === "epic" && !(await isModuleEnabled(me.organizationId, "schedule.epic"))) {
        return res.status(404).json({ error: "module_disabled", module: "schedule.epic" });
      }
      if (id === "amion" && !(await isModuleEnabled(me.organizationId, "schedule.amion"))) {
        return res.status(404).json({ error: "module_disabled", module: "schedule.amion" });
      }
      await setSelectedSource(storage(), me.organizationId, id, me.id);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "oncall.source_change",
        resourceType: "org_settings",
        resourceId: null,
        details: { source: id },
        riskLevel: "low",
      });
      const status = await sources().get(id).status(me.organizationId);
      res.json({ selected: id, explicit: true, status });
    },
  );

  // ── manual slots ──
  app.get("/api/oncall/manual", requireAuth, requireModule("oncall.board"), async (req, res) => {
    const me = currentUser(req);
    res.json(await listManualSlots(storage(), me.organizationId));
  });

  app.post(
    "/api/oncall/manual",
    requireAuth,
    requireModule("oncall.board"),
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = manualSlotInputSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const slot = await addManualSlot(storage(), me.organizationId, parsed.data, me.id);
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "oncall.manual_add",
        resourceType: "org_settings",
        resourceId: null,
        details: { slot: slot.slot, providerUserId: slot.providerUserId },
        riskLevel: "low",
      });
      res.status(201).json(slot);
    },
  );

  app.patch(
    "/api/oncall/manual/:id",
    requireAuth,
    requireModule("oncall.board"),
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = manualSlotPatchSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const slot = await updateManualSlot(storage(), me.organizationId, String(req.params.id), parsed.data, me.id);
      if (!slot) return res.status(404).json({ error: "not_found" });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "oncall.manual_update",
        resourceType: "org_settings",
        resourceId: null,
        details: { slot: slot.slot, providerUserId: slot.providerUserId },
        riskLevel: "low",
      });
      res.json(slot);
    },
  );

  app.delete(
    "/api/oncall/manual/:id",
    requireAuth,
    requireModule("oncall.board"),
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const ok = await removeManualSlot(storage(), me.organizationId, String(req.params.id), me.id);
      if (!ok) return res.status(404).json({ error: "not_found" });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "oncall.manual_remove",
        resourceType: "org_settings",
        resourceId: null,
        details: { id: String(req.params.id) },
        riskLevel: "low",
      });
      res.status(204).end();
    },
  );

  // ── Epic ──
  app.post(
    "/api/oncall/epic/sync-now",
    requireAuth,
    requireModule("oncall.board"),
    requireModule("schedule.epic"),
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const status = await sources().get("epic").status(me.organizationId);
      if (!epicConfigured(epicDeps?.env) || !status.configured) {
        return res.status(409).json({ error: "epic_not_configured", message: status.message ?? EPIC_NOT_CONFIGURED_MESSAGE });
      }
      try {
        await syncEpic(storage(), { ...epicDeps, actorUserId: me.id });
      } catch (err) {
        console.error("[epic] sync-now failed:", err instanceof Error ? err.message : err);
        return res.status(502).json({ error: "epic_sync_failed" });
      }
      res.json(await sources().get("epic").status(me.organizationId));
    },
  );

  // ── EHR deep links ──
  app.get("/api/ehr/config", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const cfg = await getEhrConfig(storage(), me.organizationId);
    res.json({
      ...cfg,
      moduleEnabled: await isModuleEnabled(me.organizationId, "ehr.deepLinks"),
      presets: EHR_PRESETS,
    });
  });

  app.patch(
    "/api/ehr/config",
    requireAuth,
    requireRole("director", "developer"),
    async (req, res) => {
      const me = currentUser(req);
      const parsed = ehrConfigSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      // An empty template clears the integration; anything else must be well-formed.
      if (parsed.data.template) {
        const bad = validateEhrTemplate(parsed.data.template);
        if (bad) return res.status(400).json({ error: bad });
      }
      await storage().setOrgSetting(
        me.organizationId,
        EHR_SETTING_KEY,
        { vendor: parsed.data.vendor, template: parsed.data.template },
        me.id,
      );
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "ehr.deeplink_config",
        resourceType: "org_settings",
        resourceId: null,
        details: { vendor: parsed.data.vendor, configured: !!parsed.data.template },
        riskLevel: "low",
      });
      res.json(await getEhrConfig(storage(), me.organizationId));
    },
  );

  // Resolve the deep link for ONE patient. The EHR id never leaves the server
  // except through this audited, access-controlled read.
  app.get(
    "/api/patients/:id/ehr-link",
    requireAuth,
    requireModule("ehr.deepLinks"),
    async (req, res) => {
      const me = currentUser(req);
      // Platform operators don't read tenant PHI (same rule as the patient board).
      if (me.role === "developer") return res.status(403).json({ error: "forbidden" });
      const patientId = Number(req.params.id);
      if (!Number.isInteger(patientId) || patientId <= 0) {
        return res.status(400).json({ error: "validation_error" });
      }
      const patient = await storage().getPatient(me.organizationId, patientId);
      if (!patient) return res.status(404).json({ error: "not_found" });

      const team = await patientCareTeam(storage(), me.organizationId, patient);
      const onTeam = team.has(me.id);
      const oversight = OVERSIGHT_ROLES.has(me.role);
      if (!onTeam && !oversight) return res.status(403).json({ error: "forbidden" });

      const cfg = await getEhrConfig(storage(), me.organizationId);
      if (!cfg.configured) return res.status(409).json({ error: "ehr_not_configured" });
      if (!patient.ehrId) return res.status(404).json({ error: "no_ehr_id" });

      // PHI read (§164.528 accounting): who opened which patient's chart link.
      await logPhiAccess(req, "patient-ehr-link", { resourceId: patientId, patientId });
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: onTeam ? "ehr.deeplink_open" : "ehr.deeplink_open_oversight",
        resourceType: "patient",
        resourceId: patientId,
        details: { patientId, vendor: cfg.vendor, role: me.role },
        riskLevel: onTeam ? "medium" : "high",
      });
      res.json({ url: resolveEhrLink(cfg.template, patient.ehrId), vendor: cfg.vendor });
    },
  );
}
