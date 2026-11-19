/**
 * The per-org OIDC connection (E2.1, module `enterprise.sso`): reading,
 * validating and saving it.
 *
 * The client SECRET is one AES-256-GCM ciphertext under `INTEGRATION_KEY`,
 * sealed by the SAME code as every other hospital credential
 * (server/integrations/crypto.ts), with the AAD bound to the org — a row
 * copied into another tenant fails to decrypt. It is write-only: no route
 * ever returns it, and nothing logs it. Without a key, saving is refused
 * rather than stored in plaintext.
 *
 * The issuer is a director-controlled URL DocTurn will fetch, so it goes
 * through the same SSRF control as Amion / Epic: `publicHttpsUrlProblem`
 * (https only, no credentials in the URL, no private / loopback /
 * link-local / metadata address, no bare host name) at SAVE time, and
 * `guardedFetch` (which re-checks the resolved address on every redirect hop
 * and at connect time, under one 10 s deadline) at CALL time.
 */
import type { SsoConnection, SsoConnectionConfig } from "@shared/schema";
import { credentialKeyState, decryptCredentialRow, KEY_MISSING_MESSAGE, sealCredentials } from "../integrations/crypto.js";
import { publicHttpsUrlProblem } from "../integrations/http.js";
import { storage } from "../storage.js";

/** The integration id the ciphertext's AAD is bound to. */
export const SSO_INTEGRATION_ID = "sso-oidc";
export const SSO_MODULE = "enterprise.sso";

/** Roles an SSO mapping may grant. `developer` is the operator's, never an IdP's. */
export const SSO_ASSIGNABLE_ROLES: readonly string[] = ["hospitalist", "er_doctor", "er_director", "director"];

export const DEFAULT_SCOPES = "openid profile email";
export const DEFAULT_CLAIM = "groups";

export function defaultConfig(): SsoConnectionConfig {
  return { claim: DEFAULT_CLAIM, defaultRole: null, map: {}, scopes: DEFAULT_SCOPES, acrMfaValue: null };
}

/** Fill in anything a stored row is missing (it is free-form jsonb). */
export function normalizeConfig(raw: SsoConnectionConfig | null | undefined): SsoConnectionConfig {
  const d = defaultConfig();
  if (!raw || typeof raw !== "object") return d;
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.map ?? {})) {
    if (typeof k === "string" && typeof v === "string" && SSO_ASSIGNABLE_ROLES.includes(v)) map[k] = v;
  }
  return {
    claim: typeof raw.claim === "string" && raw.claim.trim() ? raw.claim.trim() : d.claim,
    defaultRole: typeof raw.defaultRole === "string" && SSO_ASSIGNABLE_ROLES.includes(raw.defaultRole) ? raw.defaultRole : null,
    map,
    scopes: typeof raw.scopes === "string" && raw.scopes.trim() ? raw.scopes.trim() : d.scopes,
    acrMfaValue: typeof raw.acrMfaValue === "string" && raw.acrMfaValue.trim() ? raw.acrMfaValue.trim() : null,
  };
}

export type LoadedConnection =
  | { state: "none" }
  | { state: "unreadable"; reason: "no_key" | "key_mismatch"; row: SsoConnection }
  | { state: "ok"; row: SsoConnection; clientSecret: string; config: SsoConnectionConfig };

/** Load + decrypt one org's connection. Never throws; never logs the secret. */
export async function loadSsoConnection(orgId: number): Promise<LoadedConnection> {
  const row = await storage().getSsoConnection(orgId);
  if (!row) return { state: "none" };
  if (!credentialKeyState().ok) return { state: "unreadable", reason: "no_key", row };
  try {
    const values = decryptCredentialRow({
      organizationId: row.organizationId,
      integrationId: SSO_INTEGRATION_ID,
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      keyVersion: row.keyVersion,
    });
    return { state: "ok", row, clientSecret: values.clientSecret ?? "", config: normalizeConfig(row.roleMapping) };
  } catch {
    return { state: "unreadable", reason: "key_mismatch", row };
  }
}

export interface SsoSaveInput {
  issuer: string;
  clientId: string;
  /** Empty keeps the stored secret (so a director can edit the mapping alone). */
  clientSecret: string;
  config: SsoConnectionConfig;
  ssoRequired: boolean;
  enabled: boolean;
}

export type SsoValidation = { ok: true } | { ok: false; field: string; message: string };

/**
 * A LAB escape hatch for a test identity provider on this machine
 * (`SSO_ALLOW_INSECURE_ISSUER=1`): it lets an `http://127.0.0.1:…` issuer be
 * saved and fetched, so the browser probe (scripts/sso-check.mjs) and a
 * hospital's own pilot against a local IdP can exercise the real flow.
 *
 * It is OFF by default, REFUSED outright when `NODE_ENV=production`, says so
 * on the boot log line and in `GET /api/org/sso` (`insecureIssuersAllowed`),
 * and it never relaxes anything else: a non-loopback host still goes through
 * the full https/public-address control.
 */
export function insecureIssuersAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  return env.SSO_ALLOW_INSECURE_ISSUER === "1" || env.SSO_ALLOW_INSECURE_ISSUER === "true";
}

/** Is this the one shape the lab hatch permits — http on this machine? */
export function isLoopbackHttpIssuer(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:") return false;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    return host === "127.0.0.1" || host === "::1" || host === "localhost";
  } catch {
    return false;
  }
}

export function issuerProblemFor(raw: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (insecureIssuersAllowed(env) && isLoopbackHttpIssuer(raw)) return null;
  return publicHttpsUrlProblem(raw);
}

export function validateSsoInput(i: SsoSaveInput, hasStoredSecret: boolean): SsoValidation {
  const issuerProblem = issuerProblemFor(i.issuer);
  if (issuerProblem) return { ok: false, field: "issuer", message: issuerProblem };
  if (/[?#]/.test(i.issuer)) return { ok: false, field: "issuer", message: "The issuer URL must have no query string or fragment." };
  if (!i.clientId.trim()) return { ok: false, field: "clientId", message: "Enter the client ID your identity provider issued." };
  if (i.clientId.length > 256) return { ok: false, field: "clientId", message: "That client ID is too long." };
  if (!i.clientSecret && !hasStoredSecret) {
    return { ok: false, field: "clientSecret", message: "Enter the client secret your identity provider issued." };
  }
  if (i.clientSecret && (i.clientSecret.length < 8 || i.clientSecret.length > 2048)) {
    return { ok: false, field: "clientSecret", message: "That client secret does not look right." };
  }
  if (!/\bopenid\b/.test(i.config.scopes)) return { ok: false, field: "scopes", message: "The scopes must include `openid`." };
  if (i.config.scopes.length > 300) return { ok: false, field: "scopes", message: "That scope list is too long." };
  if (!i.config.claim || i.config.claim.length > 64) return { ok: false, field: "claim", message: "Name the claim that carries your groups (e.g. groups)." };
  for (const [group, role] of Object.entries(i.config.map)) {
    if (!group.trim() || group.length > 200) return { ok: false, field: "map", message: "A group name is empty or too long." };
    if (!SSO_ASSIGNABLE_ROLES.includes(role)) {
      return { ok: false, field: "map", message: `A group may map to: ${SSO_ASSIGNABLE_ROLES.join(", ")}. Developer accounts are DocTurn's own.` };
    }
  }
  if (Object.keys(i.config.map).length > 50) return { ok: false, field: "map", message: "That is too many group mappings." };
  if (i.config.defaultRole && !SSO_ASSIGNABLE_ROLES.includes(i.config.defaultRole)) {
    return { ok: false, field: "defaultRole", message: "That default role cannot be granted by single sign-on." };
  }
  if (!credentialKeyState().ok) return { ok: false, field: "clientSecret", message: KEY_MISSING_MESSAGE };
  return { ok: true };
}

/** Seal + store. The secret is sealed here and nowhere else. */
export async function saveSsoConnection(orgId: number, i: SsoSaveInput, updatedBy: number, keepSecret?: string): Promise<SsoConnection> {
  const secret = i.clientSecret || keepSecret || "";
  const sealed = sealCredentials(orgId, SSO_INTEGRATION_ID, { clientSecret: secret });
  return storage().upsertSsoConnection({
    organizationId: orgId,
    issuer: i.issuer.replace(/\/+$/, ""),
    clientId: i.clientId.trim(),
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    keyVersion: sealed.keyVersion,
    roleMapping: i.config,
    ssoRequired: i.ssoRequired,
    enabled: i.enabled,
    updatedBy,
  });
}

/** What a route may show about a connection — never the secret. */
export function connectionSummary(loaded: LoadedConnection) {
  if (loaded.state === "none") return { configured: false as const };
  const row = loaded.row;
  return {
    configured: true as const,
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecretStored: true as const,
    secretReadable: loaded.state === "ok",
    unreadableReason: loaded.state === "unreadable" ? loaded.reason : null,
    config: normalizeConfig(row.roleMapping),
    ssoRequired: row.ssoRequired,
    enabled: row.enabled,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}
