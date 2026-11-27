import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { z } from "zod";
import {
  consultMemberCreateSchema,
  consultServiceCreateSchema,
  consultServicePatchSchema,
} from "@shared/schema";
import { appendAudit } from "../audit.js";
import { currentUser, requireAuth, requireRole } from "../rbac.js";
import { storage } from "../storage.js";

/**
 * Directory → Consult services: the org's consult-service catalog (org setting
 * "consultServices"), read by the ER intake picker, the on-call board and
 * on-call message addressing.
 *
 * Edited ONE ITEM AT A TIME. The screen used to PATCH the whole array from the
 * copy it loaded at sign-in, so an admin with the screen open silently deleted
 * a service another admin had just added (and been told was "now available").
 * Each route here is a locked read-modify-write (storage.mutateOrgSettings):
 * it applies its single change to the CURRENT catalog, bumps the revision
 * ("consultServicesRev") and answers with the server's whole list, which the
 * client shows — so a confirmation always follows the server's answer.
 *
 * Who may do what (mirrored in the UI):
 *   director, er_director, developer → add, rename, pin on-call, PA/NP members
 *   director, developer               → remove a service
 * Everything is tenant-scoped to the caller's org; an id from another org is
 * simply not in this org's list (404). Gated by the routing.consults module
 * (server/modules.ts GATE_TABLE). Each change writes an audit row.
 */

export const CONSULT_KEY = "consultServices";
export const CONSULT_REV_KEY = "consultServicesRev";
const EDIT_ROLES = ["director", "er_director", "developer"] as const;
const REMOVE_ROLES = ["director", "developer"] as const;

export interface ConsultMember {
  id: string;
  name: string;
  avatar: string;
  role: "NP" | "PA" | "RN";
}
export interface ConsultService {
  id: string;
  name: string;
  onCall: z.infer<typeof consultServicePatchSchema>["onCall"] | null;
  members: ConsultMember[];
  [extra: string]: unknown;
}

/** The stored catalog as a list (anything unset or malformed reads as empty). */
export function catalogOf(v: unknown): ConsultService[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string")
    .map((s) => {
      const o = s as Record<string, unknown>;
      return {
        ...o,
        id: typeof o.id === "string" && o.id ? o.id : String(o.name),
        name: String(o.name),
        onCall: (o.onCall && typeof o.onCall === "object" ? o.onCall : null) as ConsultService["onCall"],
        members: Array.isArray(o.members) ? (o.members as ConsultMember[]) : [],
      };
    });
}
export function revOf(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

function newId(prefix: string): string {
  return prefix + "_" + randomBytes(6).toString("hex");
}
function initials(name: string): string {
  return (
    name
      .replace(/^Dr\.?\s*/i, "")
      .trim()
      .split(/[\s,]+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type Outcome =
  | { ok: true; status: number; services: ConsultService[]; version: number; service?: ConsultService; member?: ConsultMember; audit: { action: string; details: Record<string, unknown> } }
  | { ok: false; status: number; error: string };

/**
 * Apply one change to the org's CURRENT catalog under the row lock, then audit
 * and answer. `change` returns the new list (or an error) from the current one.
 */
async function mutate(
  req: Request,
  res: Response,
  change: (list: ConsultService[]) => Exclude<Outcome, { ok: true }> | { list: ConsultService[]; status?: number; service?: ConsultService; member?: ConsultMember; audit: { action: string; details: Record<string, unknown> } },
) {
  const me = currentUser(req);
  const out = await storage().mutateOrgSettings<Outcome>(
    me.organizationId,
    [CONSULT_KEY, CONSULT_REV_KEY],
    me.id,
    (cur) => {
      const r = change(catalogOf(cur[CONSULT_KEY]));
      if ("ok" in r) return { result: r };
      const version = revOf(cur[CONSULT_REV_KEY]) + 1;
      return {
        write: { [CONSULT_KEY]: r.list, [CONSULT_REV_KEY]: version },
        result: { ok: true, status: r.status ?? 200, services: r.list, version, service: r.service, member: r.member, audit: r.audit },
      };
    },
  );
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  await appendAudit({
    organizationId: me.organizationId,
    userId: me.id,
    action: out.audit.action,
    resourceType: "organization",
    resourceId: me.organizationId,
    details: out.audit.details,
    riskLevel: "low",
  });
  const body: Record<string, unknown> = { services: out.services, version: out.version };
  if (out.service) body.service = out.service;
  if (out.member) body.member = out.member;
  return res.status(out.status).json(body);
}

const invalid = { error: "validation_error" };
const notFound = { ok: false as const, status: 404, error: "not_found" };

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> | null {
  const p = schema.safeParse(body ?? {});
  return p.success ? p.data : null;
}

export function registerConsultServiceRoutes(app: Express) {
  // The catalog and its revision (any signed-in member of the org).
  app.get("/api/org/consult-services", requireAuth, async (req, res) => {
    const me = currentUser(req);
    const [list, rev] = await Promise.all([
      storage().getOrgSetting(me.organizationId, CONSULT_KEY),
      storage().getOrgSetting(me.organizationId, CONSULT_REV_KEY),
    ]);
    res.json({ services: catalogOf(list), version: revOf(rev) });
  });

  app.post("/api/org/consult-services", requireAuth, requireRole(...EDIT_ROLES), (req, res) => {
    const data = parse(consultServiceCreateSchema, req.body);
    if (!data) return res.status(400).json(invalid);
    return mutate(req, res, (list) => {
      if (list.some((s) => sameName(s.name, data.name))) return { ok: false, status: 409, error: "duplicate_name" };
      const service: ConsultService = { id: newId("cs"), name: data.name, onCall: null, members: [] };
      return {
        list: [...list, service],
        status: 201,
        service,
        audit: { action: "org.consult_service_add", details: { serviceId: service.id, name: service.name } },
      };
    });
  });

  app.patch("/api/org/consult-services/:serviceId", requireAuth, requireRole(...EDIT_ROLES), (req, res) => {
    const data = parse(consultServicePatchSchema, req.body);
    if (!data) return res.status(400).json(invalid);
    const id = String(req.params.serviceId);
    return mutate(req, res, (list) => {
      const cur = list.find((s) => s.id === id);
      if (!cur) return notFound;
      if (data.name !== undefined && list.some((s) => s.id !== id && sameName(s.name, data.name!))) {
        return { ok: false, status: 409, error: "duplicate_name" };
      }
      const next: ConsultService = { ...cur };
      if (data.name !== undefined) next.name = data.name;
      if (data.onCall !== undefined) {
        next.onCall = data.onCall ? { ...data.onCall, avatar: data.onCall.avatar || initials(data.onCall.name) } : null;
      }
      return {
        list: list.map((s) => (s.id === id ? next : s)),
        service: next,
        audit: {
          action: "org.consult_service_update",
          details: { serviceId: id, fields: Object.keys(data), name: next.name, onCall: next.onCall ? next.onCall.name : null },
        },
      };
    });
  });

  app.delete("/api/org/consult-services/:serviceId", requireAuth, requireRole(...REMOVE_ROLES), (req, res) => {
    const id = String(req.params.serviceId);
    return mutate(req, res, (list) => {
      const cur = list.find((s) => s.id === id);
      if (!cur) return notFound;
      return {
        list: list.filter((s) => s.id !== id),
        audit: { action: "org.consult_service_remove", details: { serviceId: id, name: cur.name } },
      };
    });
  });

  app.post("/api/org/consult-services/:serviceId/members", requireAuth, requireRole(...EDIT_ROLES), (req, res) => {
    const data = parse(consultMemberCreateSchema, req.body);
    if (!data) return res.status(400).json(invalid);
    const id = String(req.params.serviceId);
    return mutate(req, res, (list) => {
      const cur = list.find((s) => s.id === id);
      if (!cur) return notFound;
      if (cur.members.some((m) => sameName(m.name, data.name))) return { ok: false, status: 409, error: "duplicate_member" };
      const member: ConsultMember = { id: newId("cm"), name: data.name, avatar: data.avatar || initials(data.name), role: data.role };
      const next: ConsultService = { ...cur, members: [...cur.members, member] };
      return {
        list: list.map((s) => (s.id === id ? next : s)),
        status: 201,
        service: next,
        member,
        audit: { action: "org.consult_member_add", details: { serviceId: id, memberId: member.id, name: member.name, role: member.role } },
      };
    });
  });

  app.delete("/api/org/consult-services/:serviceId/members/:memberId", requireAuth, requireRole(...EDIT_ROLES), (req, res) => {
    const id = String(req.params.serviceId);
    const memberId = String(req.params.memberId);
    return mutate(req, res, (list) => {
      const cur = list.find((s) => s.id === id);
      const member = cur?.members.find((m) => m.id === memberId);
      if (!cur || !member) return notFound;
      const next: ConsultService = { ...cur, members: cur.members.filter((m) => m.id !== memberId) };
      return {
        list: list.map((s) => (s.id === id ? next : s)),
        service: next,
        audit: { action: "org.consult_member_remove", details: { serviceId: id, memberId, name: member.name } },
      };
    });
  });
}
