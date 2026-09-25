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

export const GATE_TABLE: readonly GateRule[] = [
  // Routing
  { path: /^\/api\/assignments(\/|$)/, module: "routing.assignments" },
  { path: /^\/api\/consults(\/|$)/, module: "routing.consults" },
  { path: /^\/api\/consult-services(\/|$)/, module: "routing.consults" },
  { path: /^\/api\/patients\/[^/]+\/consults(\/|$)/, module: "routing.consults" },
  { path: /^\/api\/messaging\/on-call-targets(\/|$)/, module: "routing.roleMessaging" },
  // Messaging
  { path: /^\/api\/messaging\/patient-thread(\/|$)/, module: "messaging.patientThreads" },
  { path: /^\/api\/messaging\/attachments(\/|$)/, module: "messaging.attachments" },
  { path: /^\/api\/messaging\/availability(\/|$)/, module: "messaging.dnd" },
  { path: /^\/api\/messaging\/messages\/[^/]+$/, module: "messaging.recall", methods: ["DELETE"] },
  // Priority/STAT: the send route itself stays reachable; a non-routine
  // priority is REJECTED (400) when the module is off. The route can't be
  // edited here, so downgrading is not an option — reject is explicit.
  { path: /^\/api\/messaging\/send$/, module: "messaging.priority", methods: ["POST"], when: nonRoutinePriority, status: 400 },
  { path: /^\/api\/broadcasts(\/|$)/, module: "broadcasts" },
  // Schedule
  { path: /^\/api\/amion(\/|$)/, module: "schedule.amion" },
  { path: /^\/api\/oncall(\/|$)/, module: "oncall.board" },
  { path: /^\/api\/on-call(\/|$)/, module: "oncall.board" },
  // Operations
  { path: /^\/api\/metrics(\/|$)/, module: "ops.analytics" },
  { path: /^\/api\/reports(\/|$)/, module: "ops.analytics" },
  // Only the /api/resources* surface: beds/equipment/departments are legacy
  // routes still exercised by existing flows, and ops.resources defaults OFF.
  { path: /^\/api\/resources(\/|$)/, module: "ops.resources" },
  { path: /^\/api\/maintenance\/purge$/, module: "ops.retention" },
  // Platform
  { path: /^\/api\/settings\/appearance(\/|$)/, module: "platform.appearance" },
  { path: /^\/api\/org\/preferences$/, module: "platform.appearance", methods: ["PATCH"], when: bodyHasTheme },
  { path: /^\/api\/cms(\/|$)/, module: "platform.cms" },
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
