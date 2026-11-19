/**
 * SCIM authentication (E2.2, module `enterprise.scim`): a per-organization
 * bearer token, hashed.
 *
 *   • the token is `dts_` + 32 random bytes (base64url); only its SHA-256 is
 *     stored (`scim_tokens.token_hash`), so the database cannot be used to
 *     impersonate the identity provider;
 *   • it is shown ONCE, at creation, and can be revoked (the row stays, with
 *     `revoked_at`, for the audit trail);
 *   • `last_used_at` is touched at most once a minute, so a director can see
 *     whether the connector is alive without a write per request;
 *   • the token names the ORGANIZATION — every handler scopes by it, and
 *     nothing in a SCIM request can change which tenant it is;
 *   • while the module is off for that org the endpoints answer 404 (the
 *     module's own promise), not 401, so a misconfigured connector is not
 *     reported to the IdP as a credential problem.
 *
 * `/scim` is outside `/api`, so the central module gate (server/modules.ts
 * GATE_TABLE) cannot see it: the module is enforced HERE. The GATE_TABLE rows
 * for `enterprise.scim` cover the token-management API.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isModuleEnabled } from "../modules.js";
import { storage } from "../storage.js";
import { SCIM_CONTENT_TYPE, scimError } from "./schemas.js";

export const SCIM_MODULE = "enterprise.scim";
export const SCIM_TOKEN_PREFIX = "dts_";

/** A fresh token. Returned once; only `scimTokenHash(token)` is stored. */
export function newScimToken(): string {
  return SCIM_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function scimTokenHash(token: string): string {
  return createHash("sha256").update("docturn.scim-token:" + token).digest("hex");
}

/** The organization a SCIM request is acting in. */
export interface ScimContext {
  organizationId: number;
  organizationCode: string;
  tokenId: number;
  /** Absolute base of this deployment's SCIM API, for `meta.location`. */
  baseUrl: string;
}

export function scimContext(res: Response): ScimContext {
  return (res.locals as { scim?: ScimContext }).scim as ScimContext;
}

/**
 * The absolute `/scim/v2` base for this request. SCIM clients call US, so the
 * host they reached is the right one to echo; `PUBLIC_BASE_URL` overrides it
 * for a deployment behind a rewriting proxy. Never used for a security
 * decision — only for `meta.location` and the base URL shown in the card.
 */
export function scimBaseUrl(req: Request): string {
  const override = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (override) return `${override}/scim/v2`;
  const host = req.get("host") ?? "localhost";
  return `${req.protocol}://${host}/scim/v2`;
}

function deny(res: Response, status: number, detail: string, scimType?: string) {
  res.setHeader("Content-Type", SCIM_CONTENT_TYPE);
  if (status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="DocTurn SCIM"');
  return res.status(status).json(scimError(status, detail, scimType));
}

const TOUCH_AFTER_MS = 60_000;

export function scimAuth(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.get("authorization") ?? "";
      const m = /^Bearer\s+(.+)$/i.exec(header.trim());
      if (!m) return deny(res, 401, "A bearer token is required.");
      const presented = m[1]!.trim();
      const row = await storage().getScimTokenByHash(scimTokenHash(presented));
      // One generic answer for unknown / revoked: an IdP learns nothing about
      // which tokens ever existed.
      if (!row || row.revokedAt) return deny(res, 401, "The bearer token is not valid.");
      // The lookup was by hash, so this is belt-and-braces against a future
      // non-exact lookup path.
      const a = Buffer.from(scimTokenHash(presented));
      const b = Buffer.from(row.tokenHash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return deny(res, 401, "The bearer token is not valid.");
      if (!(await isModuleEnabled(row.organizationId, SCIM_MODULE))) {
        return deny(res, 404, "SCIM provisioning is not switched on for this organization.");
      }
      const org = await storage().getOrganization(row.organizationId);
      if (!org) return deny(res, 404, "The organization no longer exists.");
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
        await storage().touchScimToken(row.organizationId, row.id, new Date());
      }
      (res.locals as { scim?: ScimContext }).scim = {
        organizationId: row.organizationId,
        organizationCode: org.code,
        tokenId: row.id,
        baseUrl: scimBaseUrl(req),
      };
      res.setHeader("Content-Type", SCIM_CONTENT_TYPE);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Answer a SCIM error with the right content type. */
export function sendScimError(res: Response, status: number, detail: string, scimType?: string) {
  res.setHeader("Content-Type", SCIM_CONTENT_TYPE);
  return res.status(status).json(scimError(status, detail, scimType));
}
