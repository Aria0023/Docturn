/**
 * Server-side enforcement for the feature-module registry (shared/modules.ts).
 *
 * Overrides live in the org settings table under key "modules" as
 * { [moduleId]: boolean }. Effective values = registry defaults + overrides,
 * with `requires` honoured. The developer console flips them per org.
 *
 * Usage in a route:  app.get("/api/x", requireAuth, requireModule("oncall.board"), handler)
 * A disabled module answers 404 { error: "module_disabled", module } so the UI can
 * distinguish "not for you" (403) from "not switched on here" (404).
 */
import type { NextFunction, Request, Response } from "express";
import { MODULE_IDS, resolveModules } from "@shared/modules";
import { storage } from "./storage.js";
import { currentUser } from "./rbac.js";
import { isEnterpriseExportRequest } from "./compliance/audit-export.js";

const SETTING_KEY = "modules";

// Small per-process cache so every request does not hit the settings table.
const cache = new Map<number, { at: number; map: Record<string, boolean> }>();
const TTL_MS = 5_000;

export async function getModules(orgId: number): Promise<Record<string, boolean>> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  const raw = await storage().getOrgSetting(orgId, SETTING_KEY);
  const map = resolveModules(raw as Record<string, unknown> | null);
  cache.set(orgId, { at: Date.now(), map });
  return map;
}

export async function isModuleEnabled(orgId: number, id: string): Promise<boolean> {
  const map = await getModules(orgId);
  return map[id] !== false;
}

/** Persist one switch for an org. Unknown ids are rejected by the caller (route). */
export async function setModule(
  orgId: number,
  id: string,
  enabled: boolean,
  updatedBy: number | null = null,
): Promise<Record<string, boolean>> {
  if (!MODULE_IDS.includes(id)) throw new Error("unknown_module");
  const raw = (await storage().getOrgSetting(orgId, SETTING_KEY)) as Record<string, unknown> | null;
  const next: Record<string, unknown> = { ...(raw && typeof raw === "object" ? raw : {}) };
  next[id] = enabled;
  await storage().setOrgSetting(orgId, SETTING_KEY, next, updatedBy);
  cache.delete(orgId);
  return resolveModules(next);
}

export function invalidateModules(orgId?: number) {
  if (orgId == null) cache.clear();
  else cache.delete(orgId);
}

/** Express guard: 404 module_disabled when the caller's org has the module off. */
export function requireModule(id: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const me = currentUser(req);
      if (!(await isModuleEnabled(me.organizationId, id))) {
        return res.status(404).json({ error: "module_disabled", module: id });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

// ---------------------------------------------------------------------------
// Central gate — ONE table mapping API paths to the module that owns them, so
// existing route files need no per-route `requireModule` wrapper. Mounted in
// server/app.ts after session/passport and before registerRoutes(). Add a
// module = add a row to shared/modules.ts + a row here.
//
// Every rule must match at least one REGISTERED route: tests/modules.test.ts
// walks the Express router and fails on a rule that gates nothing, so the
// table can never again carry a path that looks protected but isn't served.
// ---------------------------------------------------------------------------
export interface GateRule {
  /** Regex tested against req.path (no query string). */
  path: RegExp;
  module: string;
  /** Restrict to these HTTP methods (default: all). */
  methods?: readonly string[];
  /** Extra predicate — the rule applies only when it returns true. */
  when?: (req: Request) => boolean;
  /** Status to answer with when the module is off (default 404). */
  status?: number;
}

const nonRoutinePriority = (req: Request) => {
  const p = (req.body as { priority?: unknown } | undefined)?.priority;
  return typeof p === "string" && p !== "routine";
};
const bodyHasTheme = (req: Request) => {
  const t = (req.body as { theme?: unknown } | undefined)?.theme;
  return !!t && typeof t === "object";
};
/** The E2 form of GET /api/audit/export (from / to / format / orgId). */
const enterpriseAuditExport = (req: Request) =>
  isEnterpriseExportRequest((req.query ?? {}) as Record<string, unknown>);

export const GATE_TABLE: readonly GateRule[] = [
  // Routing
  { path: /^\/api\/assignments(\/|$)/, module: "routing.assignments" },
  // Admissions log + its org-wide counter reset (server/routes/admissions.ts).
  { path: /^\/api\/admissions(\/|$)/, module: "routing.assignments" },
  { path: /^\/api\/consults(\/|$)/, module: "routing.consults" },
  { path: /^\/api\/patients\/[^/]+\/consults(\/|$)/, module: "routing.consults" },
  // The consult-service catalog editor (Directory → Consult services).
  { path: /^\/api\/org\/consult-services(\/|$)/, module: "routing.consults" },
  { path: /^\/api\/messaging\/on-call-targets(\/|$)/, module: "routing.roleMessaging" },
  // Directory role contacts (resolveOnCallTargets grouped by role).
  { path: /^\/api\/messaging\/role-contacts$/, module: "routing.roleMessaging" },
  // Rotation "Next up" preview (server/routes/oncall.ts) — part of admission routing.
  { path: /^\/api\/rotation(\/|$)/, module: "routing.assignments" },
  // Messaging
  { path: /^\/api\/messaging\/patient-thread(\/|$)/, module: "messaging.patientThreads" },
  // Done (per-user conversation state). The list/sync routes honour the same
  // switch themselves: with it off nothing is reported done.
  { path: /^\/api\/messaging\/conversations\/[^/]+\/done$/, module: "messaging.done", methods: ["PUT", "DELETE"] },
  // Unread-message reminder preference (server/routes/reminders.ts); the
  // sweep (services/unread-reminder.ts) checks the same switch per org.
  { path: /^\/api\/messaging\/unread-reminder$/, module: "messaging.unreadReminder" },
  // PIN unlock (server/routes/pin.ts): the PIN itself and the lock-exempt
  // unlock route. Off by default.
  { path: /^\/api\/security\/pin$/, module: "security.pin" },
  { path: /^\/api\/session\/unlock-pin$/, module: "security.pin" },
  // Priority alert sounds (server/routes/alert-sounds.ts): the user's choice
  // of in-app tone per priority.
  { path: /^\/api\/messaging\/alert-sounds$/, module: "messaging.alertSounds" },
  { path: /^\/api\/messaging\/attachments(\/|$)/, module: "messaging.attachments" },
  { path: /^\/api\/messaging\/availability(\/|$)/, module: "messaging.dnd" },
  { path: /^\/api\/messaging\/messages\/[^/]+$/, module: "messaging.recall", methods: ["DELETE"] },
  // Priority/STAT: the send route itself stays reachable; a non-routine
  // priority is REJECTED (400) when the module is off. The route can't be
  // edited here, so downgrading is not an option — reject is explicit.
  { path: /^\/api\/messaging\/send$/, module: "messaging.priority", methods: ["POST"], when: nonRoutinePriority, status: 400 },
  { path: /^\/api\/broadcasts(\/|$)/, module: "broadcasts" },
  // Directory favorites + recently contacted (server/routes/directory.ts).
  { path: /^\/api\/directory\/(favorites|recents)(\/|$)/, module: "directory.favorites" },
  // Schedule
  // End shift / Start shift (server/routes/shift.ts).
  { path: /^\/api\/shift(\/|$)/, module: "shift.handoff" },
  { path: /^\/api\/amion(\/|$)/, module: "schedule.amion" },
  { path: /^\/api\/oncall(\/|$)/, module: "oncall.board" },
  // Operations
  { path: /^\/api\/metrics(\/|$)/, module: "ops.analytics" },
  { path: /^\/api\/reports(\/|$)/, module: "ops.analytics" },
  // Only the /api/resources* surface: beds/equipment/departments are legacy
  // routes still exercised by existing flows, and ops.resources defaults OFF.
  { path: /^\/api\/resources(\/|$)/, module: "ops.resources" },
  // ops.retention is also enforced in two places this table cannot express:
  // the hourly sweep (services/retention.ts) skips the org, and PATCH
  // /api/settings/org refuses a NEW messageRetentionDays window (after that
  // route validates the value; clearing it to 0 stays allowed).
  { path: /^\/api\/maintenance\/purge$/, module: "ops.retention" },
  // Integrations (Settings → Integrations). The background paths — SMS
  // escalation / STAT nudges / MFA codes, push delivery, the intake extractor —
  // check the same switches in server/integrations/gates.ts.
  { path: /^\/api\/sms\/send$/, module: "integration.sms", methods: ["POST"] },
  { path: /^\/api\/push\/vapid-key$/, module: "integration.push", methods: ["GET"] },
  // Registering a device is refused while push is off; REMOVING one (sign-out)
  // always works.
  { path: /^\/api\/mobile\/device-tokens$/, module: "integration.push", methods: ["POST"] },
  // Platform — theming is written through PATCH /api/org/preferences { theme }.
  { path: /^\/api\/org\/preferences$/, module: "platform.appearance", methods: ["PATCH"], when: bodyHasTheme },
  { path: /^\/api\/cms(\/|$)/, module: "platform.cms" },
  // Platform — each person's own display preset over the org's branding
  // (server/routes/themes.ts). Off = nobody in the org can set one and the
  // client shows the org's branding only.
  { path: /^\/api\/me\/theme$/, module: "platform.userThemes" },
  // Enterprise — the developer console's cluster view (server/routes/dev.ts):
  // this instance, the realtime bus, the job leases and the limiter store.
  // The safety mechanisms themselves are never switchable per org.
  { path: /^\/api\/dev\/cluster$/, module: "enterprise.multiInstance" },
  // Audit export, ENTERPRISE form only (a date range / JSON / another
  // tenant). GET /api/audit/export is older than the module: the legacy
  // `?trail=…&scope=…` CSV is the Compliance screen's Export button for every
  // org and must stay reachable, so the gate applies only when the request
  // carries from / to / format / orgId (isEnterpriseExportRequest). A
  // developer's cross-tenant export ALSO needs the module on for the target
  // tenant — this rule can only see the caller's own org, so that second
  // check lives in the route (server/routes/compliance.ts).
  { path: /^\/api\/audit\/export$/, module: "enterprise.auditExport", methods: ["GET"], when: enterpriseAuditExport },
  // Session policy (server/routes/session-policy.ts): the director's card and
  // "sign out everywhere" (self-service and for another person). The
  // ENFORCEMENT is in two places this table cannot express: the
  // sessionPolicyGate (server/session-policy.ts, which checks the same module
  // itself on every /api request and at the WebSocket upgrade) and
  // resolveSessionUser (server/auth.ts), where a completed "sign out
  // everywhere" keeps holding even if the module is switched off afterwards.
  { path: /^\/api\/org\/session-policy$/, module: "enterprise.sessionPolicy" },
  { path: /^\/api\/account\/sessions\/revoke-all$/, module: "enterprise.sessionPolicy" },
  { path: /^\/api\/accounts\/[^/]+\/sessions\/revoke-all$/, module: "enterprise.sessionPolicy" },
  // SCIM provisioning (server/routes/scim-tokens.ts): the director's bearer
  // tokens. The SCIM API itself lives at /scim/v2 — OUTSIDE /api, where this
  // middleware never runs — so the module is enforced there by the bearer
  // middleware (server/scim/auth.ts), which answers 404 for an org that has
  // it off, exactly as this table would.
  { path: /^\/api\/org\/scim-tokens(\/|$)/, module: "enterprise.scim" },
  // Single sign-on (server/routes/sso.ts): the director's connection card and
  // its real "Test connection". The PUBLIC sign-in routes (/api/auth/sso/*)
  // are unauthenticated, where this middleware deliberately passes through,
  // so they check the module themselves — and answer exactly as they do for
  // an org code that does not exist, so neither is an oracle.
  { path: /^\/api\/org\/sso(\/|$)/, module: "enterprise.sso" },
  // Organization billing (server/routes/billing.ts): the hospital's own
  // Settings → Billing screen and its invoice download. DEFAULT OFF, so no
  // existing tenant's screens change until the operator switches it on.
  //
  // THE SAFETY INVARIANT: this rule is the ONLY billing rule in this table and
  // it may only ever match /api/billing*. The operator's console routes
  // (/api/dev/billing/*) are deliberately NOT gated — the console has to work
  // in order to turn billing on — and no care path is ever gated by billing.
  // tests/billing-safety-invariant.test.ts asserts both.
  { path: /^\/api\/billing(\/|$)/, module: "billing" },
];

/** First gate rule that applies to this request, if any. */
export function matchGate(req: Request, table: readonly GateRule[] = GATE_TABLE): GateRule | undefined {
  const path = req.path;
  const method = req.method.toUpperCase();
  return table.find(
    (r) =>
      r.path.test(path) &&
      (!r.methods || r.methods.includes(method)) &&
      (!r.when || r.when(req)),
  );
}

/**
 * Express middleware: answers 404 { error: "module_disabled", module } (or the
 * rule's status) for any /api path whose owning module is off for the CALLER's
 * org. Unauthenticated requests pass through — auth handles them downstream —
 * so nothing here leaks module state to anonymous callers.
 */
export function moduleGate(table: readonly GateRule[] = GATE_TABLE) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.path.startsWith("/api/")) return next();
      if (!req.isAuthenticated || !req.isAuthenticated()) return next();
      const rule = matchGate(req, table);
      if (!rule) return next();
      const me = currentUser(req);
      if (!me || typeof me.organizationId !== "number") return next();
      if (!(await isModuleEnabled(me.organizationId, rule.module))) {
        return res.status(rule.status ?? 404).json({ error: "module_disabled", module: rule.module });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
