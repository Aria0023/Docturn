import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Role, User } from "@shared/schema";
import { toSafeUser } from "@shared/schema";
import { appendAudit } from "../audit.js";
import { guardedFetch } from "../integrations/http.js";
import { MFA_REQUIRED_MODULE } from "../auth.js";
import { isModuleEnabled } from "../modules.js";
import { currentUser, isPrivilegedRole, requireAuth, requireRole } from "../rbac.js";
import { normalizeUsername } from "../usernames.js";
import { provisionUser } from "../services/provisioning.js";
import { storage } from "../storage.js";
import {
  connectionSummary,
  DEFAULT_CLAIM,
  DEFAULT_SCOPES,
  insecureIssuersAllowed,
  isLoopbackHttpIssuer,
  loadSsoConnection,
  normalizeConfig,
  saveSsoConnection,
  SSO_ASSIGNABLE_ROLES,
  SSO_MODULE,
  validateSsoInput,
} from "../sso/connection.js";
import {
  assertsMfa,
  authorizeUrl,
  discover,
  displayNameFromClaims,
  exchangeCode,
  OidcError,
  pkcePair,
  randomToken,
  roleFromClaims,
  usernameFromClaims,
  verifyIdToken,
  type OidcFetch,
} from "../sso/oidc.js";

/**
 * OIDC single sign-on (E2.1, module `enterprise.sso`).
 *
 * Public (unauthenticated) routes — the sign-in screen's:
 *   POST /api/auth/sso/available  { orgCode } → { sso, label? }
 *   POST /api/auth/sso/start      { orgCode } → { url }
 *   GET  /api/auth/sso/callback   ?code&state → a redirect to the app
 *
 * Director routes (GATE_TABLE answers 404 while the module is off):
 *   GET/PUT/DELETE /api/org/sso, POST /api/org/sso/test
 *
 * NOT AN ORG-CODE ORACLE. `available` does the same work and returns the same
 * shape for an org code that does not exist, one that has no connection, one
 * whose connection is disabled, and one whose module is off: `{ sso: false }`.
 * The org lookup and the connection lookup both happen in every case (the
 * connection is looked up against an impossible org id when the code is
 * unknown), so the timings match too. The label it returns for a configured
 * org is the organization's own display name — which that org's own staff are
 * typing the code of.
 *
 * MFA (the decision, documented in docs/ENTERPRISE_READINESS.md E2.1):
 *   • An SSO sign-in does NOT also ask for DocTurn's own TOTP. The identity
 *     provider is the authenticator; a second factor DocTurn holds adds
 *     nothing to a federated login it cannot verify, and would strand a
 *     hospital that requires SSO.
 *   • The org's `security.mfaRequired` module STILL holds: a privileged user
 *     without DocTurn MFA lands in the same enrolment-only session a password
 *     sign-in gives them — UNLESS the id_token proves the IdP performed
 *     multi-factor authentication (`amr` contains mfa/otp/hwk/…, or `acr`
 *     equals the connection's configured value). Then this session is
 *     treated as having a second factor, and that fact is in the audit row.
 */

const orgCodeSchema = z.object({ orgCode: z.string().trim().min(1).max(32) }).strict();

const configSchema = z
  .object({
    claim: z.string().trim().min(1).max(64).optional(),
    defaultRole: z.string().trim().max(32).nullable().optional(),
    map: z.record(z.string().max(200), z.string().max(32)).optional(),
    scopes: z.string().trim().min(1).max(300).optional(),
    acrMfaValue: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

const saveSchema = z
  .object({
    issuer: z.string().trim().min(1).max(500),
    clientId: z.string().trim().min(1).max(256),
    clientSecret: z.string().max(2048).optional(),
    ssoRequired: z.boolean().optional(),
    enabled: z.boolean().optional(),
    config: configSchema.optional(),
  })
  .strict();

const SSO_ADMIN_ROLES = ["director", "developer"] as const;

/** The absolute base of this deployment, for the redirect URI. */
export function publicBaseUrl(req: Request): string {
  const override = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (override) return override;
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}
export const redirectUriFor = (req: Request) => `${publicBaseUrl(req)}/api/auth/sso/callback`;

/**
 * Production transport: https-only, public addresses only, 10 s deadline.
 * The ONE exception is the lab hatch (`SSO_ALLOW_INSECURE_ISSUER=1`, never in
 * production — server/sso/connection.ts): an http URL on this machine is
 * fetched directly so a local test identity provider can be used. Any other
 * URL still goes through `guardedFetch`.
 */
const productionFetch: OidcFetch = (url, init) => {
  if (insecureIssuersAllowed() && isLoopbackHttpIssuer(url)) return fetch(url, init);
  return guardedFetch(url, init ?? {});
};
let transport: OidcFetch = productionFetch;
/**
 * Tests only: drive the protocol against a LOCAL issuer fixture. Production
 * never calls this, so the SSRF guard above is always the real transport.
 */
export function _setSsoTransport(fn: OidcFetch | null): void {
  transport = fn ?? productionFetch;
}

declare module "express-session" {
  interface SessionData {
    /** A sign-in in flight: bound to one org, state, nonce and PKCE verifier. */
    ssoFlow?: { orgId: number; state: string; nonce: string; verifier: string; at: number };
    /** The IdP asserted multi-factor authentication for THIS session (E2.1). */
    mfaSatisfiedByIdp?: boolean;
  }
}

/** A flow older than this is stale (the user left the tab open). */
const FLOW_TTL_MS = 10 * 60_000;

function flowError(res: Response, code: string) {
  // The sign-in screen reads ?sso=<code> and shows one sentence; nothing
  // about the identity provider's internals reaches the URL.
  return res.redirect(302, "/?sso=" + encodeURIComponent(code));
}

export function registerSsoRoutes(app: Express) {
  /* ── is there SSO for this org code? (no oracle) ───────────────────────── */
  app.post("/api/auth/sso/available", async (req, res) => {
    const parsed = orgCodeSchema.safeParse(req.body);
    // Even a malformed body does the same work and gets the same shape.
    const code = parsed.success ? parsed.data.orgCode : "";
    const org = code ? await storage().getOrganizationByCode(code) : undefined;
    const loaded = await loadSsoConnection(org?.id ?? -1);
    const moduleOn = await isModuleEnabled(org?.id ?? -1, SSO_MODULE);
    const usable = !!org && moduleOn && loaded.state === "ok" && loaded.row.enabled;
    res.setHeader("Cache-Control", "no-store");
    if (!usable) return res.json({ sso: false });
    return res.json({ sso: true, label: org!.name });
  });

  /* ── begin the flow ────────────────────────────────────────────────────── */
  app.post("/api/auth/sso/start", async (req, res, next) => {
    try {
      const parsed = orgCodeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation_error" });
      const org = await storage().getOrganizationByCode(parsed.data.orgCode);
      const loaded = await loadSsoConnection(org?.id ?? -1);
      const moduleOn = await isModuleEnabled(org?.id ?? -1, SSO_MODULE);
      if (!org || !moduleOn || loaded.state !== "ok" || !loaded.row.enabled) {
        // The same answer `available` gives: nothing about which codes exist.
        return res.status(404).json({ error: "sso_not_available" });
      }
      const { verifier, challenge } = pkcePair();
      const state = randomToken();
      const nonce = randomToken();
      let url: string;
      try {
        const discovery = await discover(loaded.row.issuer, transport);
        url = authorizeUrl({
          discovery,
          clientId: loaded.row.clientId,
          redirectUri: redirectUriFor(req),
          scopes: loaded.config.scopes,
          state,
          nonce,
          codeChallenge: challenge,
          acrValues: loaded.config.acrMfaValue,
        });
      } catch (err) {
        if (err instanceof OidcError) {
          await appendAudit({
            organizationId: org.id,
            userId: null,
            action: "sso.start_failed",
            resourceType: "organization",
            resourceId: org.id,
            details: { reason: err.code },
            riskLevel: "medium",
          });
          return res.status(502).json({ error: "sso_unavailable", reason: err.code });
        }
        throw err;
      }
      req.session.ssoFlow = { orgId: org.id, state, nonce, verifier, at: Date.now() };
      await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
      return res.json({ url });
    } catch (err) {
      return next(err);
    }
  });

  /* ── the identity provider comes back ──────────────────────────────────── */
  app.get("/api/auth/sso/callback", async (req, res, next) => {
    try {
      // Read the flow BEFORE req.login: passport regenerates the session and
      // everything in it is gone.
      const flow = req.session?.ssoFlow;
      if (req.session) delete req.session.ssoFlow;
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (typeof req.query.error === "string" && req.query.error) return flowError(res, "idp_refused");
      if (!flow || !state || flow.state !== state) return flowError(res, "state");
      if (Date.now() - flow.at > FLOW_TTL_MS) return flowError(res, "expired");
      if (!code) return flowError(res, "no_code");

      const org = await storage().getOrganization(flow.orgId);
      const loaded = await loadSsoConnection(flow.orgId);
      const moduleOn = await isModuleEnabled(flow.orgId, SSO_MODULE);
      if (!org || !moduleOn || loaded.state !== "ok" || !loaded.row.enabled) return flowError(res, "not_available");

      let verified;
      try {
        const discovery = await discover(loaded.row.issuer, transport);
        const idToken = await exchangeCode(
          {
            discovery,
            clientId: loaded.row.clientId,
            clientSecret: loaded.clientSecret,
            redirectUri: redirectUriFor(req),
            code,
            codeVerifier: flow.verifier,
          },
          transport,
        );
        verified = await verifyIdToken(idToken, { discovery, clientId: loaded.row.clientId, nonce: flow.nonce }, transport);
      } catch (err) {
        if (err instanceof OidcError) {
          await appendAudit({
            organizationId: org.id,
            userId: null,
            action: "sso.login_failed",
            resourceType: "organization",
            resourceId: org.id,
            details: { reason: err.code },
            riskLevel: "high",
          });
          return flowError(res, err.code);
        }
        throw err;
      }

      const username = usernameFromClaims(verified.claims);
      if (!username) return flowError(res, "no_username");
      const role = roleFromClaims(
        verified.claims,
        { claim: loaded.config.claim, default: loaded.config.defaultRole, map: loaded.config.map },
        SSO_ASSIGNABLE_ROLES,
      );
      if (!role) {
        await appendAudit({
          organizationId: org.id,
          userId: null,
          action: "sso.login_denied_no_role",
          resourceType: "organization",
          resourceId: org.id,
          details: { claim: loaded.config.claim },
          riskLevel: "medium",
        });
        return flowError(res, "no_role");
      }

      // E2.1 + security.mfaRequired: when the org requires MFA for privileged
      // roles, a privileged SSO sign-in is only accepted if the id_token
      // PROVES the identity provider did more than one factor. Without this
      // an already-enrolled director would get full access from a single
      // federated factor, while their password sign-in would still be held
      // to TOTP — the module would protect the unenrolled and nobody else.
      const idpMfa = assertsMfa(verified, loaded.config.acrMfaValue);
      if (!idpMfa && isPrivilegedRole(role) && (await isModuleEnabled(org.id, MFA_REQUIRED_MODULE))) {
        await appendAudit({
          organizationId: org.id,
          userId: null,
          action: "sso.login_denied_mfa_required",
          resourceType: "organization",
          resourceId: org.id,
          details: { role, amr: verified.amr.length },
          riskLevel: "high",
        });
        return flowError(res, "mfa_required");
      }

      const normalized = normalizeUsername(username);
      let user = await storage().getUserByUsername(org.id, normalized);
      let created = false;
      let roleChanged: string | null = null;
      if (!user) {
        // JIT: the same provisioning path SCIM uses (no password, a rotation
        // profile for a hospitalist, audited).
        user = await provisionUser({
          organizationId: org.id,
          username: normalized,
          displayName: displayNameFromClaims(verified.claims, normalized),
          role: role as Role,
          actorUserId: null,
          source: "sso",
        });
        created = true;
      } else {
        if (user.disabledAt) {
          await appendAudit({
            organizationId: org.id,
            userId: user.id,
            action: "sso.login_denied_disabled",
            resourceType: "user",
            resourceId: user.id,
            details: {},
            riskLevel: "high",
          });
          return flowError(res, "disabled");
        }
        // A developer is never re-roled by an identity provider.
        if (user.role !== role && user.role !== "developer") {
          roleChanged = user.role;
          const updated = await storage().updateUser(user.id, { role: role as Role });
          user = updated ?? user;
        }
        const name = displayNameFromClaims(verified.claims, user.displayName);
        if (name && name !== user.displayName) {
          const updated = await storage().updateUser(user.id, { displayName: name });
          user = updated ?? user;
        }
      }

      const live = user!;
      req.login(live as unknown as Express.User, async (loginErr) => {
        if (loginErr) return next(loginErr);
        // req.login regenerated the session: set the flag on the NEW one.
        if (idpMfa) req.session.mfaSatisfiedByIdp = true;
        await appendAudit({
          organizationId: live.organizationId,
          userId: live.id,
          action: "sso.login",
          resourceType: "user",
          resourceId: live.id,
          details: {
            username: live.username,
            role: live.role,
            ...(created ? { created: true } : {}),
            ...(roleChanged ? { roleChangedFrom: roleChanged } : {}),
            idpMfa,
            amr: verified.amr.length,
          },
          riskLevel: created || roleChanged ? "medium" : "low",
        });
        return res.redirect(302, "/?sso=ok");
      });
    } catch (err) {
      return next(err);
    }
  });

  /* ── the director's card ───────────────────────────────────────────────── */
  app.get("/api/org/sso", requireAuth, requireRole(...SSO_ADMIN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const loaded = await loadSsoConnection(me.organizationId);
    res.json({
      ...connectionSummary(loaded),
      // What the hospital's identity provider must be told.
      redirectUri: redirectUriFor(req),
      assignableRoles: SSO_ASSIGNABLE_ROLES,
      defaults: { claim: DEFAULT_CLAIM, scopes: DEFAULT_SCOPES },
      // The card says so plainly when this server is in lab mode.
      insecureIssuersAllowed: insecureIssuersAllowed(),
    });
  });

  app.put("/api/org/sso", requireAuth, requireRole(...SSO_ADMIN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    // Validate the RAW mapping before normalizing: normalizeConfig drops a
    // role SSO may not grant (it is the defensive reader for stored rows),
    // and silently dropping it would leave the director believing they had
    // mapped a group to `developer`.
    const rawConfig = parsed.data.config;
    for (const [group, role] of Object.entries(rawConfig?.map ?? {})) {
      if (!SSO_ASSIGNABLE_ROLES.includes(role)) {
        return res.status(400).json({
          error: "invalid_connection",
          field: "map",
          message: `"${group}" maps to a role single sign-on cannot grant. Choose one of: ${SSO_ASSIGNABLE_ROLES.join(", ")}.`,
        });
      }
    }
    if (rawConfig?.defaultRole && !SSO_ASSIGNABLE_ROLES.includes(rawConfig.defaultRole)) {
      return res.status(400).json({ error: "invalid_connection", field: "defaultRole", message: "That default role cannot be granted by single sign-on." });
    }
    const existing = await loadSsoConnection(me.organizationId);
    const keepSecret = existing.state === "ok" ? existing.clientSecret : "";
    const config = normalizeConfig({
      ...(existing.state === "ok" ? existing.config : normalizeConfig(null)),
      ...(parsed.data.config ?? {}),
    } as never);
    const input = {
      issuer: parsed.data.issuer,
      clientId: parsed.data.clientId,
      clientSecret: parsed.data.clientSecret ?? "",
      config,
      ssoRequired: parsed.data.ssoRequired ?? (existing.state !== "none" ? existing.row.ssoRequired : false),
      enabled: parsed.data.enabled ?? (existing.state !== "none" ? existing.row.enabled : true),
    };
    const check = validateSsoInput(input, !!keepSecret);
    if (!check.ok) return res.status(400).json({ error: "invalid_connection", field: check.field, message: check.message });
    await saveSsoConnection(me.organizationId, input, me.id, keepSecret);
    await appendAudit({
      organizationId: me.organizationId,
      userId: me.id,
      action: "sso.connection_saved",
      resourceType: "organization",
      resourceId: me.organizationId,
      // Ids and flags only — never the secret, never the issuer's query.
      details: {
        secretReplaced: !!parsed.data.clientSecret,
        ssoRequired: input.ssoRequired,
        enabled: input.enabled,
        mappings: Object.keys(config.map).length,
        defaultRole: config.defaultRole,
      },
      riskLevel: "high",
    });
    const fresh = await loadSsoConnection(me.organizationId);
    res.json({ ...connectionSummary(fresh), redirectUri: redirectUriFor(req), assignableRoles: SSO_ASSIGNABLE_ROLES, defaults: { claim: DEFAULT_CLAIM, scopes: DEFAULT_SCOPES } });
  });

  app.delete("/api/org/sso", requireAuth, requireRole(...SSO_ADMIN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const removed = await storage().deleteSsoConnection(me.organizationId);
    if (removed) {
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "sso.connection_removed",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: {},
        riskLevel: "high",
      });
    }
    res.json({ configured: false, redirectUri: redirectUriFor(req), assignableRoles: SSO_ASSIGNABLE_ROLES, defaults: { claim: DEFAULT_CLAIM, scopes: DEFAULT_SCOPES } });
  });

  /**
   * "Test connection": fetch the stored issuer's discovery document and its
   * key set for real, and say what came back. No secret is sent (the token
   * endpoint is not called), and nothing is stored.
   */
  app.post("/api/org/sso/test", requireAuth, requireRole(...SSO_ADMIN_ROLES), async (req, res) => {
    const me = currentUser(req);
    const loaded = await loadSsoConnection(me.organizationId);
    if (loaded.state === "none") return res.status(404).json({ error: "not_configured" });
    if (loaded.state === "unreadable") {
      return res.json({ ok: false, reason: loaded.reason, message: loaded.reason === "no_key" ? "The server has no INTEGRATION_KEY, so the stored client secret cannot be read." : "The stored client secret cannot be decrypted with this server's key." });
    }
    try {
      const discovery = await discover(loaded.row.issuer, transport);
      // The key set must exist and carry at least one RSA signing key, or an
      // id_token could never be verified.
      const keysRes = await transport(discovery.jwks_uri, { headers: { Accept: "application/json" } });
      const keys = keysRes.ok ? ((await keysRes.json()) as { keys?: unknown[] }).keys ?? [] : [];
      const rsa = keys.filter((k) => (k as { kty?: unknown }).kty === "RSA").length;
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "sso.connection_tested",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: { ok: rsa > 0, keys: rsa },
        riskLevel: "low",
      });
      if (rsa === 0) return res.json({ ok: false, reason: "jwks", message: "The identity provider's key set has no RSA signing key, so DocTurn could not verify an id_token." });
      return res.json({
        ok: true,
        issuer: discovery.issuer,
        authorizationEndpoint: discovery.authorization_endpoint,
        tokenEndpoint: discovery.token_endpoint,
        signingKeys: rsa,
        redirectUri: redirectUriFor(req),
      });
    } catch (err) {
      const reason = err instanceof OidcError ? err.code : "error";
      const message = err instanceof OidcError ? err.message : "The connection could not be tested.";
      await appendAudit({
        organizationId: me.organizationId,
        userId: me.id,
        action: "sso.connection_tested",
        resourceType: "organization",
        resourceId: me.organizationId,
        details: { ok: false, reason },
        riskLevel: "low",
      });
      return res.json({ ok: false, reason, message });
    }
  });
}

/**
 * Is password sign-in refused for this org? `sso_required` means the hospital
 * has said "DocTurn accounts are our identity provider's" — a password then
 * works only for a DEVELOPER (the operator's break-glass, audited), never for
 * their own staff, so a stolen password is useless without the IdP.
 */
export async function passwordSignInRefused(user: Pick<User, "organizationId" | "role">): Promise<boolean> {
  if (user.role === "developer") return false;
  if (!(await isModuleEnabled(user.organizationId, SSO_MODULE))) return false;
  const row = await storage().getSsoConnection(user.organizationId);
  return !!row && row.enabled && row.ssoRequired;
}

/**
 * Does this org have an SSO connection in force? `anyEnabled` asks only
 * whether SSO can be used (for the lock screen's button); without it, whether
 * passwords are refused for the org's own staff.
 */
export async function ssoRequiredForOrg(orgId: number, opts: { anyEnabled?: boolean } = {}): Promise<boolean> {
  if (!(await isModuleEnabled(orgId, SSO_MODULE))) return false;
  const row = await storage().getSsoConnection(orgId);
  if (!row || !row.enabled) return false;
  return opts.anyEnabled ? true : row.ssoRequired;
}

/** Exported for the login route's 403 body. */
export const SSO_REQUIRED_ERROR = { error: "sso_required" } as const;
export { toSafeUser };
export type { RequestHandler };
