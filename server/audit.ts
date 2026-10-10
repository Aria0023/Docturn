import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, RequestHandler } from "express";
import type { AuditLog, User } from "@shared/schema";
import { storage } from "./storage.js";

/**
 * Input shape for an audit row. `impersonatorUserId` is normally NOT passed by
 * callers — appendAudit() fills it from the request's actor context — but it
 * may be set explicitly by code that runs outside a request.
 */
export type AuditInput = Omit<AuditLog, "id" | "createdAt" | "impersonatorUserId"> & {
  impersonatorUserId?: number | null;
};

/**
 * Who is really acting during this request. `userId` is the session identity
 * (whose permissions are being exercised); `impersonatorId` is the developer
 * who entered an impersonated / managed-org portal, when the session is one
 * (server/routes/dev.ts records it in req.session.impersonatorId).
 */
export interface ActorContext {
  userId: number | null;
  impersonatorId: number | null;
}

const actorStore = new AsyncLocalStorage<ActorContext>();

/** Build the actor context for a request from its session + Passport user. */
export function actorContext(req: Request): ActorContext {
  const user = req.user as unknown as User | undefined;
  const raw = req.session?.impersonatorId;
  const impersonatorId = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  return { userId: user?.id ?? null, impersonatorId };
}

/**
 * Express middleware: run the rest of the request inside its actor context so
 * appendAudit() can attribute rows written anywhere downstream without every
 * route having to know about impersonation. Mount AFTER session + passport.
 */
export function actorContextMiddleware(): RequestHandler {
  return (req, _res, next) => {
    actorStore.run(actorContext(req), () => next());
  };
}

/** The current request's actor context, or undefined outside a request. */
export function currentActor(): ActorContext | undefined {
  return actorStore.getStore();
}

/**
 * Merge the operator identity into a row written during an impersonated
 * session: the explicit column plus `details.onBehalfOf`, so the attribution
 * survives in both the live table and the denormalized six-year archive. A
 * row the developer writes AS THEMSELVES (dev.impersonate_stop, where userId
 * is already the operator) is left alone.
 */
function attribute(row: AuditInput, ctx: ActorContext | undefined): AuditInput {
  const operator = ctx?.impersonatorId ?? null;
  if (operator == null || operator === row.userId) {
    return { ...row, impersonatorUserId: row.impersonatorUserId ?? null };
  }
  return {
    ...row,
    impersonatorUserId: operator,
    details: { ...(row.details ?? {}), onBehalfOf: operator },
  };
}

/**
 * Append a security-relevant action to the HIPAA audit trail. Never throws.
 * Returns the stored row (so a caller can cross-reference it, e.g. into the
 * retained archive), or undefined when the write failed.
 */
export async function appendAudit(row: AuditInput): Promise<AuditLog | undefined> {
  try {
    return await storage().appendAudit(attribute(row, currentActor()));
  } catch (err) {
    console.error("[audit] failed to append", err);
    return undefined;
  }
}

/**
 * Record a PHI access — every READ that returns clinical content, not only
 * mutations. Exactly ONE row per request (never one per message/record), and
 * the row carries identifiers only: `resourceId` is the record that was read
 * (conversation id, patient id, …) and `patientId` the patient it concerns.
 * Clinical content (message bodies, notes, names) MUST NOT be passed here —
 * §164.528 accounting needs "who read what", not what it said. "Who" includes
 * the real operator when the session is an impersonated one.
 */
export async function logPhiAccess(
  req: Request,
  resource: string,
  ids: { resourceId?: number | null; patientId?: number | null } = {},
): Promise<void> {
  try {
    const user = req.user as unknown as User | undefined;
    if (!user) return;
    const { impersonatorId } = actorContext(req);
    await storage().logPhiAccess({
      organizationId: user.organizationId,
      userId: user.id,
      impersonatorUserId: impersonatorId != null && impersonatorId !== user.id ? impersonatorId : null,
      resource,
      resourceId: Number.isFinite(ids.resourceId as number)
        ? (ids.resourceId as number)
        : null,
      patientId: Number.isFinite(ids.patientId as number)
        ? (ids.patientId as number)
        : null,
      method: req.method,
      ip: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
  } catch (err) {
    console.error("[phi] failed to log access", err);
  }
}

/** Flag a suspicious event for later review. Never throws. */
export async function logSecurityIncident(input: {
  organizationId?: number;
  userId?: number;
  type: string;
  severity?: "low" | "medium" | "high";
  description: string;
}): Promise<void> {
  try {
    await appendAudit({
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
      action: `security.${input.type}`,
      resourceType: "security_incident",
      resourceId: null,
      details: { description: input.description },
      riskLevel: input.severity ?? "medium",
    });
  } catch (err) {
    console.error("[security] failed to log incident", err);
  }
}
