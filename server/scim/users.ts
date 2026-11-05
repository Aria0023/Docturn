/**
 * SCIM 2.0 Users (E2.2, module `enterprise.scim`) — mounted at `/scim/v2`,
 * authenticated by a per-organization bearer token (server/scim/auth.ts).
 *
 *   GET    /scim/v2/Users                 list, `filter=userName eq "x"`,
 *                                         startIndex (1-based) + count
 *   GET    /scim/v2/Users/:id             one user (404 across tenants)
 *   POST   /scim/v2/Users                 provision (409 on a taken userName)
 *   PUT    /scim/v2/Users/:id             replace the stored attributes
 *   PATCH  /scim/v2/Users/:id             add / replace / remove ops
 *   DELETE /scim/v2/Users/:id             DEACTIVATE (never a hard delete)
 *   GET    /scim/v2/ServiceProviderConfig | /Schemas | /Schemas/:id |
 *          /ResourceTypes | /ResourceTypes/:id
 *
 * Every write goes through the SAME paths the administrative screens use
 * (server/services/provisioning.ts), so a SCIM `active:false` is the real
 * deactivation: disabled_at, off the rotation, and every live session and
 * socket of that person ended at once. `active:true` is the reactivate path.
 *
 * A hard DELETE is deliberately NOT offered: HIPAA §164.316(b)(2)(i) wants
 * the account's trail to stay attributable, and the audit rows are
 * FK-bound to the user. The RFC allows this (§3.6 "MAY ... disable"), and
 * ServiceProviderConfig + the docs say so.
 */
import type { Express, Request, Response } from "express";
import type { Role, User } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { normalizeUsername } from "../usernames.js";
import { deactivateAccount, provisionUser, reactivateAccount } from "../services/provisioning.js";
import { storage } from "../storage.js";
import { scimAuth, scimContext, sendScimError, type ScimContext } from "./auth.js";
import {
  ci,
  coerceBoolean,
  displayNameFrom,
  parseFilter,
  readScimUser,
  resourceTypes,
  SCIM_ASSIGNABLE_ROLES,
  SCIM_CONTENT_TYPE,
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
  scimList,
  scimUser,
  SERVICE_PROVIDER_CONFIG,
  userSchemaDefinition,
} from "./schemas.js";

const MAX_COUNT = 200;
const DEFAULT_COUNT = 100;
/** The roles a SCIM connector may never create or move someone into. */
const PRIVILEGED = new Set<string>(["director", "er_director", "developer"]);

const ok = (res: Response, status: number, body: unknown) => {
  res.setHeader("Content-Type", SCIM_CONTENT_TYPE);
  return res.status(status).json(body);
};

/** The target user, inside the token's org. Anything else is 404. */
async function target(req: Request, res: Response, scim: ScimContext): Promise<User | null> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    sendScimError(res, 404, "No such user.");
    return null;
  }
  const user = await storage().getUserById(id);
  if (!user || user.organizationId !== scim.organizationId) {
    // Never reveal that the id exists in another tenant.
    sendScimError(res, 404, "No such user.");
    return null;
  }
  if (PRIVILEGED.has(user.role)) {
    // A connector may read nothing it is not allowed to change.
    sendScimError(res, 404, "No such user.");
    return null;
  }
  return user;
}

/** Resolve a requested role, or null when it is not one a connector may set. */
function assignableRole(raw: string | undefined): Role | null | undefined {
  if (raw === undefined) return undefined;
  const want = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const found = SCIM_ASSIGNABLE_ROLES.find((r) => r === want);
  return found ?? null;
}

async function auditScim(scim: ScimContext, action: string, userId: number | null, details: Record<string, unknown>, riskLevel: "low" | "medium" | "high") {
  await appendAudit({
    organizationId: scim.organizationId,
    // A SCIM request has no DocTurn user behind it: the actor is the token,
    // named in the details, and the row's userId is the SUBJECT.
    userId: null,
    action,
    resourceType: "user",
    resourceId: userId,
    details: { ...details, scimTokenId: scim.tokenId },
    riskLevel,
  });
}

export function registerScimRoutes(app: Express, scimJson: import("express").RequestHandler) {
  const auth = scimAuth();

  // ── discovery ────────────────────────────────────────────────────────────
  app.get("/scim/v2/ServiceProviderConfig", auth, (_req, res) => ok(res, 200, SERVICE_PROVIDER_CONFIG));
  app.get("/scim/v2/ResourceTypes", auth, (_req, res) => {
    const list = resourceTypes(scimContext(res).baseUrl);
    return ok(res, 200, scimList(list, list.length, 1));
  });
  // NOT `:id`: server/params.ts validates every `:id` as a positive integer
  // app-wide, which would 404 "User" before this handler ran.
  app.get("/scim/v2/ResourceTypes/:resourceType", auth, (req, res) => {
    const list = resourceTypes(scimContext(res).baseUrl);
    const found = list.find((r) => r.id.toLowerCase() === String(req.params.resourceType).toLowerCase());
    return found ? ok(res, 200, found) : sendScimError(res, 404, "No such resource type.");
  });
  app.get("/scim/v2/Schemas", auth, (_req, res) => {
    const list = [userSchemaDefinition(scimContext(res).baseUrl)];
    return ok(res, 200, scimList(list, list.length, 1));
  });
  app.get("/scim/v2/Schemas/:schemaUrn", auth, (req, res) => {
    const def = userSchemaDefinition(scimContext(res).baseUrl);
    return String(req.params.schemaUrn) === SCIM_USER_SCHEMA ? ok(res, 200, def) : sendScimError(res, 404, "No such schema.");
  });

  // ── list ─────────────────────────────────────────────────────────────────
  app.get("/scim/v2/Users", auth, async (req, res) => {
    const scim = scimContext(res);
    const filter = parseFilter(typeof req.query.filter === "string" ? req.query.filter : undefined);
    if (filter.kind === "unsupported") {
      return sendScimError(res, 400, 'Only `userName eq "value"` is supported as a filter.', "invalidFilter");
    }
    const startRaw = Number(req.query.startIndex ?? 1);
    const countRaw = Number(req.query.count ?? DEFAULT_COUNT);
    // SCIM paging is 1-BASED (RFC 7644 §3.4.2.4); a value below 1 is treated as 1.
    const startIndex = Number.isFinite(startRaw) && startRaw >= 1 ? Math.floor(startRaw) : 1;
    const count = Number.isFinite(countRaw) ? Math.min(MAX_COUNT, Math.max(0, Math.floor(countRaw))) : DEFAULT_COUNT;

    if (filter.kind === "never") return ok(res, 200, scimList([], 0, startIndex));
    let rows: User[];
    if (filter.kind === "userName") {
      const one = await storage().getUserByUsername(scim.organizationId, filter.value);
      rows = one && !PRIVILEGED.has(one.role) ? [one] : [];
    } else {
      rows = (await storage().listUsers(scim.organizationId)).filter((u) => !PRIVILEGED.has(u.role));
    }
    const page = rows.slice(startIndex - 1, startIndex - 1 + count);
    return ok(res, 200, scimList(page.map((u) => scimUser(u, scim.baseUrl)), rows.length, startIndex));
  });

  app.get("/scim/v2/Users/:id", auth, async (req, res) => {
    const scim = scimContext(res);
    const user = await target(req, res, scim);
    if (!user) return;
    return ok(res, 200, scimUser(user, scim.baseUrl));
  });

  // ── create ───────────────────────────────────────────────────────────────
  app.post("/scim/v2/Users", auth, scimJson, async (req, res) => {
    const scim = scimContext(res);
    const body = readScimUser(req.body);
    if (!body.userName) return sendScimError(res, 400, "userName is required.", "invalidValue");
    const username = normalizeUsername(body.userName);
    if (username.length < 3 || username.length > 64) {
      return sendScimError(res, 400, "userName must be 3 to 64 characters.", "invalidValue");
    }
    const displayName = displayNameFrom(body);
    if (!displayName) return sendScimError(res, 400, "displayName (or name.givenName / name.familyName) is required.", "invalidValue");
    const role = assignableRole(body.role);
    if (role === null) {
      return sendScimError(res, 400, `roles[0].value must be one of: ${SCIM_ASSIGNABLE_ROLES.join(", ")}. Directors and developers are provisioned inside DocTurn.`, "invalidValue");
    }
    const existing = await storage().getUserByUsername(scim.organizationId, username);
    if (existing) {
      return sendScimError(res, 409, "A user with that userName already exists.", "uniqueness");
    }
    const user = await provisionUser({
      organizationId: scim.organizationId,
      username,
      displayName,
      role: role ?? "hospitalist",
      actorUserId: null,
      source: "scim",
    });
    // `active:false` at creation: provision, then deactivate through the real
    // path, so a pre-disabled account behaves like any other leaver.
    if (body.active === false) {
      await deactivateAccount(user);
      await auditScim(scim, "scim.user_deactivate", user.id, { username: user.username, atCreate: true }, "high");
    }
    const fresh = (await storage().getUserById(user.id)) ?? user;
    res.setHeader("Location", `${scim.baseUrl}/Users/${user.id}`);
    return ok(res, 201, scimUser(fresh, scim.baseUrl));
  });

  // ── replace (PUT) ────────────────────────────────────────────────────────
  app.put("/scim/v2/Users/:id", auth, scimJson, async (req, res) => {
    const scim = scimContext(res);
    const user = await target(req, res, scim);
    if (!user) return;
    const body = readScimUser(req.body);
    const role = assignableRole(body.role);
    if (role === null) {
      return sendScimError(res, 400, `roles[0].value must be one of: ${SCIM_ASSIGNABLE_ROLES.join(", ")}.`, "invalidValue");
    }
    // userName is the correlation key: a PUT may not rename someone into
    // another account's name.
    if (body.userName) {
      const wanted = normalizeUsername(body.userName);
      const clash = await storage().getUserByUsername(scim.organizationId, wanted);
      if (clash && clash.id !== user.id) return sendScimError(res, 409, "A user with that userName already exists.", "uniqueness");
    }
    const changed = await applyChanges(scim, user, {
      userName: body.userName,
      displayName: displayNameFrom(body, user.displayName),
      role: role ?? undefined,
      active: body.active,
    });
    return ok(res, 200, scimUser(changed, scim.baseUrl));
  });

  // ── patch ────────────────────────────────────────────────────────────────
  app.patch("/scim/v2/Users/:id", auth, scimJson, async (req, res) => {
    const scim = scimContext(res);
    const user = await target(req, res, scim);
    if (!user) return;
    const schemas = ci(req.body, "schemas");
    if (Array.isArray(schemas) && schemas.length && !schemas.some((s) => String(s) === SCIM_PATCH_SCHEMA)) {
      return sendScimError(res, 400, `A PATCH body must declare ${SCIM_PATCH_SCHEMA}.`, "invalidSyntax");
    }
    const opsRaw = ci(req.body, "Operations");
    if (!Array.isArray(opsRaw) || opsRaw.length === 0) {
      return sendScimError(res, 400, "Operations must be a non-empty array.", "invalidSyntax");
    }
    const patch: PendingChanges = {};
    for (const raw of opsRaw) {
      const op = String(ci(raw, "op") ?? "").toLowerCase();
      if (op !== "add" && op !== "replace" && op !== "remove") {
        return sendScimError(res, 400, `Unsupported op "${String(ci(raw, "op"))}".`, "invalidSyntax");
      }
      const path = String(ci(raw, "path") ?? "").trim();
      const value = ci(raw, "value");
      // No path: the value is a partial User resource (Okta's active:false).
      if (!path) {
        if (op === "remove") return sendScimError(res, 400, "A remove op needs a path.", "noTarget");
        const part = readScimUser(value);
        if (part.active !== undefined) patch.active = part.active;
        if (part.userName !== undefined) patch.userName = part.userName;
        const dn = displayNameFrom(part);
        if (dn !== undefined) patch.displayName = dn;
        if (part.role !== undefined) {
          const r = assignableRole(part.role);
          if (r === null) return sendScimError(res, 400, "That role cannot be set over SCIM.", "invalidValue");
          patch.role = r ?? undefined;
        }
        continue;
      }
      const attr = path.toLowerCase().replace(/\[.*$/, "");
      if (attr === "active") {
        const v = op === "remove" ? true : coerceBoolean(value);
        if (v === undefined) return sendScimError(res, 400, "active must be true or false.", "invalidValue");
        patch.active = v;
      } else if (attr === "username") {
        if (op === "remove") return sendScimError(res, 400, "userName cannot be removed.", "mutability");
        const v = typeof value === "string" ? value : String(ci(value, "userName") ?? "");
        if (!v.trim()) return sendScimError(res, 400, "userName must be a non-empty string.", "invalidValue");
        patch.userName = v.trim();
      } else if (attr === "displayname" || attr === "name" || attr.startsWith("name.")) {
        if (op === "remove") return sendScimError(res, 400, "A name cannot be removed.", "mutability");
        const v =
          attr === "displayname"
            ? (typeof value === "string" ? value : undefined)
            : attr === "name"
              ? displayNameFrom(readScimUser({ name: value }))
              : namePart(attr, value, user.displayName, patch);
        if (!v || !v.trim()) return sendScimError(res, 400, "A name must be a non-empty string.", "invalidValue");
        patch.displayName = v.trim();
      } else if (attr === "roles") {
        if (op === "remove") return sendScimError(res, 400, "A role cannot be removed; replace it instead.", "mutability");
        const r = assignableRole(readScimUser({ roles: value }).role);
        if (r === null || r === undefined) return sendScimError(res, 400, "That role cannot be set over SCIM.", "invalidValue");
        patch.role = r;
      } else {
        // Attributes DocTurn does not store (emails, title, department, …):
        // accepted and dropped, exactly as the Schemas endpoint says.
        continue;
      }
    }
    if (patch.userName) {
      const wanted = normalizeUsername(patch.userName);
      const clash = await storage().getUserByUsername(scim.organizationId, wanted);
      if (clash && clash.id !== user.id) return sendScimError(res, 409, "A user with that userName already exists.", "uniqueness");
    }
    const changed = await applyChanges(scim, user, patch);
    return ok(res, 200, scimUser(changed, scim.baseUrl));
  });

  // ── delete = deactivate ──────────────────────────────────────────────────
  app.delete("/scim/v2/Users/:id", auth, async (req, res) => {
    const scim = scimContext(res);
    const user = await target(req, res, scim);
    if (!user) return;
    if (!user.disabledAt) {
      await deactivateAccount(user);
      await auditScim(scim, "scim.user_deactivate", user.id, { username: user.username, via: "delete" }, "high");
    }
    res.setHeader("Content-Type", SCIM_CONTENT_TYPE);
    return res.status(204).end();
  });

  // LAST: anything else under /scim is a SCIM error, never the web app's HTML
  // shell (the SPA fallback in server/webapp-static.ts skips /scim; this
  // closes the gap for a path that LOOKS like SCIM but is not served).
  app.all("/scim/*", auth, (_req, res) =>
    sendScimError(res, 404, "No such SCIM endpoint. DocTurn implements /scim/v2/Users and the discovery endpoints."),
  );
}

interface PendingChanges {
  userName?: string;
  displayName?: string;
  role?: Role;
  active?: boolean;
}

/** `name.givenName` / `name.familyName` against the stored display name. */
function namePart(attr: string, value: unknown, current: string, patch: PendingChanges): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const base = (patch.displayName ?? current).trim().split(/\s+/);
  if (attr === "name.givenname") return [value.trim(), base.slice(1).join(" ")].filter(Boolean).join(" ");
  if (attr === "name.familyname") return [base.slice(0, -1).join(" ") || base[0], value.trim()].filter(Boolean).join(" ");
  if (attr === "name.formatted") return value.trim();
  return undefined;
}

/** Apply the changes, each through the path the app itself uses, and audit. */
async function applyChanges(scim: ScimContext, user: User, patch: PendingChanges): Promise<User> {
  const fields: Partial<Pick<User, "username" | "displayName" | "role">> = {};
  if (patch.userName && normalizeUsername(patch.userName) !== user.username) fields.username = normalizeUsername(patch.userName);
  if (patch.displayName && patch.displayName !== user.displayName) fields.displayName = patch.displayName;
  if (patch.role && patch.role !== user.role) fields.role = patch.role;
  if (Object.keys(fields).length > 0) {
    await storage().updateUser(user.id, fields);
    await auditScim(scim, "scim.user_update", user.id, { username: user.username, changedKeys: Object.keys(fields) }, "medium");
  }
  if (patch.active === false && !user.disabledAt) {
    await deactivateAccount(user);
    await auditScim(scim, "scim.user_deactivate", user.id, { username: user.username }, "high");
  } else if (patch.active === true && user.disabledAt) {
    await reactivateAccount(user);
    await auditScim(scim, "scim.user_reactivate", user.id, { username: user.username }, "high");
  }
  return (await storage().getUserById(user.id)) ?? user;
}
