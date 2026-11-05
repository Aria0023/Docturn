import type { NextFunction, Request, Response } from "express";
import type { Role, User } from "@shared/schema";

/**
 * Roles with administrative / cross-user reach. The single definition the MFA
 * enrolment gate (server/auth.ts), the analytics routes and the compliance
 * monitor all read, so "privileged" means the same thing everywhere.
 */
export const PRIVILEGED_ROLES: readonly Role[] = ["director", "er_director", "developer"];

export function isPrivilegedRole(role: string | null | undefined): boolean {
  return PRIVILEGED_ROLES.includes(role as Role);
}

/** 403 unless the caller holds one of the PRIVILEGED_ROLES. */
export function requirePrivileged() {
  return requireRole(...PRIVILEGED_ROLES);
}

/** 401 unless an authenticated session is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: "unauthorized" });
}

/** 403 unless the caller's role is in the allow-list. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const user = req.user as unknown as User;
    if (!roles.includes(user.role as Role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    return next();
  };
}

/**
 * Assert a fetched resource belongs to the caller's tenant. Developers bypass
 * (they administer all tenants) — callers must audit any developer bypass.
 * Returns true when access is allowed; when false it has already written the
 * 403/404 response.
 */
export function assertSameOrg(
  req: Request,
  res: Response,
  resource: { organizationId: number } | undefined | null,
): resource is { organizationId: number } {
  const user = req.user as unknown as User;
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return false;
  }
  if (user.role === "developer") return true;
  if (resource.organizationId !== user.organizationId) {
    // Don't reveal existence across tenants — 404, not 403.
    res.status(404).json({ error: "not_found" });
    return false;
  }
  return true;
}

export function currentUser(req: Request): User {
  return req.user as unknown as User;
}
