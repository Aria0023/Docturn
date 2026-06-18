import type { Request } from "express";
import type { AuditLog, User } from "@shared/schema";
import { storage } from "./storage.js";

/** Append a security-relevant action to the HIPAA audit trail. Never throws. */
export async function appendAudit(
  row: Omit<AuditLog, "id" | "createdAt">,
): Promise<void> {
  try {
    await storage().appendAudit(row);
  } catch (err) {
    console.error("[audit] failed to append", err);
  }
}

/** Record a PHI access (patients / assignments / patient-board routes). */
export async function logPhiAccess(
  req: Request,
  resource: string,
): Promise<void> {
  try {
    const user = req.user as unknown as User | undefined;
    if (!user) return;
    await storage().logPhiAccess({
      organizationId: user.organizationId,
      userId: user.id,
      resource,
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
