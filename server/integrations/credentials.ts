import { createPrivateKey } from "node:crypto";
import type { OrgIntegrationCredential } from "@shared/schema";
import type { DatabaseStorage } from "../storage.js";
import { credentialKeyState, decryptCredentialRow, sealCredentials } from "./crypto.js";
import { publicHttpsUrlProblem } from "./http.js";

/**
 * A hospital's OWN credentials for the organization-scope integrations
 * (Amion, Epic). WRITE-ONLY: values go in through PUT, are sealed with
 * AES-256-GCM (crypto.ts) and are only ever decrypted server-side to make the
 * outbound call. Responses carry `summary` (non-secret: hosts) and who saved
 * them when — never a secret field.
 */

export type OrgScopeIntegrationId = "amion" | "epic-fhir";
export const ORG_SCOPE_INTEGRATIONS: readonly OrgScopeIntegrationId[] = ["amion", "epic-fhir"];

export interface CredentialField {
  name: string;
  label: string;
  /** Secret fields are never displayed back; an empty value on save keeps the stored one. */
  secret: boolean;
  required: boolean;
  multiline?: boolean;
  placeholder?: string;
  help: string;
  maxLength: number;
}

export const CREDENTIAL_FIELDS: Record<OrgScopeIntegrationId, CredentialField[]> = {
  amion: [
    {
      name: "ocsUrl",
      label: "Amion OCS feed URL",
      secret: true,
      required: false,
      placeholder: "https://www.amion.com/cgi-bin/ocs?Lo=…",
      help:
        "Your schedule's on-call (OCS) link from Amion. It contains your schedule's login (Lo=…) — treat it like a password. " +
        "Ask your Amion schedule administrator, or Amion support, for the OCS / on-call export link.",
      maxLength: 2048,
    },
    {
      name: "login",
      label: "…or only the Amion schedule login",
      secret: true,
      required: false,
      placeholder: "the Lo= value / schedule password",
      help: "If you only have the schedule login (the password staff type on amion.com), enter it here instead and DocTurn builds the feed link.",
      maxLength: 200,
    },
  ],
  "epic-fhir": [
    {
      name: "baseUrl",
      label: "FHIR R4 base URL",
      secret: false,
      required: true,
      placeholder: "https://<epic-host>/interconnect-fhir-oauth/api/FHIR/R4",
      help: "Your health system's Epic FHIR R4 endpoint, from your Epic analyst / interface team.",
      maxLength: 2048,
    },
    {
      name: "clientId",
      label: "Backend app client ID",
      secret: true,
      required: true,
      placeholder: "Client ID issued for DocTurn's backend-services app",
      help: "Issued when your Epic team registers DocTurn as a backend-services app (non-production and production IDs differ).",
      maxLength: 256,
    },
    {
      name: "privateKeyPem",
      label: "Private key (PEM, RS384)",
      secret: true,
      required: true,
      multiline: true,
      placeholder: "-----BEGIN PRIVATE KEY-----",
      help: "The RSA private key whose public half your Epic team registered for the app. DocTurn signs RS384 JWT assertions with it.",
      maxLength: 20_000,
    },
    {
      name: "tokenUrl",
      label: "Token URL (optional)",
      secret: false,
      required: false,
      placeholder: "https://<epic-host>/interconnect-fhir-oauth/oauth2/token",
      help: "Leave blank to use the standard Epic token endpoint beside the FHIR base URL.",
      maxLength: 2048,
    },
  ],
};

export function isOrgScopeIntegration(id: string): id is OrgScopeIntegrationId {
  return (ORG_SCOPE_INTEGRATIONS as readonly string[]).includes(id);
}

// ── derived values shared with the services ─────────────────────────────────
export const AMION_DEFAULT_OCS = "https://www.amion.com/cgi-bin/ocs";

/** The URL to fetch for stored Amion credentials (full OCS URL, or built from the login). */
export function amionUrlFromCredentials(values: Record<string, string>): string | null {
  if (values.ocsUrl) return values.ocsUrl;
  if (values.login) return `${AMION_DEFAULT_OCS}?Lo=${encodeURIComponent(values.login)}`;
  return null;
}

/** Epic's token endpoint sits beside the FHIR base: …/interconnect-fhir-oauth/oauth2/token */
export function deriveEpicTokenUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  return b ? b.replace(/\/api\/FHIR\/R4$/i, "") + "/oauth2/token" : "";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ── read ────────────────────────────────────────────────────────────────────
export type StoredCredentials =
  | { state: "none" }
  | { state: "ok"; values: Record<string, string>; row: OrgIntegrationCredential }
  | { state: "unreadable"; reason: "no_key" | "key_mismatch"; row: OrgIntegrationCredential };

/** Load + decrypt one org's credentials. Never throws; never logs the values. */
export async function readOrgCredentials(
  db: DatabaseStorage,
  orgId: number,
  integrationId: string,
): Promise<StoredCredentials> {
  const row = await db.getIntegrationCredential(orgId, integrationId);
  if (!row) return { state: "none" };
  if (!credentialKeyState().ok) return { state: "unreadable", reason: "no_key", row };
  try {
    return { state: "ok", values: decryptCredentialRow(row), row };
  } catch {
    return { state: "unreadable", reason: "key_mismatch", row };
  }
}

// ── validate + save ─────────────────────────────────────────────────────────
export type CredentialValidation =
  | { ok: true; values: Record<string, string>; summary: Record<string, string> }
  | { ok: false; field: string; message: string };

const PRINTABLE = /^[\x21-\x7e]+$/;

export function validateCredentials(id: OrgScopeIntegrationId, v: Record<string, string>): CredentialValidation {
  if (id === "amion") {
    if (v.ocsUrl) {
      const p = publicHttpsUrlProblem(v.ocsUrl);
      if (p) return { ok: false, field: "ocsUrl", message: p };
      const host = hostOf(v.ocsUrl).toLowerCase();
      if (host !== "amion.com" && !host.endsWith(".amion.com")) {
        return { ok: false, field: "ocsUrl", message: "The feed must be an amion.com link." };
      }
      return { ok: true, values: { ocsUrl: v.ocsUrl }, summary: { host } };
    }
    if (v.login) {
      if (!PRINTABLE.test(v.login)) return { ok: false, field: "login", message: "The login cannot contain spaces." };
      return { ok: true, values: { login: v.login }, summary: { host: hostOf(AMION_DEFAULT_OCS) } };
    }
    return { ok: false, field: "ocsUrl", message: "Enter the Amion OCS feed URL or the schedule login." };
  }
  // epic-fhir
  const baseUrl = (v.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) return { ok: false, field: "baseUrl", message: "Enter the FHIR R4 base URL." };
  const pb = publicHttpsUrlProblem(baseUrl);
  if (pb) return { ok: false, field: "baseUrl", message: pb };
  if (!v.clientId) return { ok: false, field: "clientId", message: "Enter the client ID." };
  if (!PRINTABLE.test(v.clientId)) return { ok: false, field: "clientId", message: "The client ID cannot contain spaces." };
  const pem = (v.privateKeyPem ?? "").replace(/\\n/g, "\n").trim();
  if (!pem) return { ok: false, field: "privateKeyPem", message: "Paste the private key (PEM)." };
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa") {
      return { ok: false, field: "privateKeyPem", message: "Epic needs an RSA key (RS384)." };
    }
  } catch {
    return { ok: false, field: "privateKeyPem", message: "That is not a readable PEM private key." };
  }
  const tokenUrl = (v.tokenUrl ?? "").trim();
  if (tokenUrl) {
    const pt = publicHttpsUrlProblem(tokenUrl);
    if (pt) return { ok: false, field: "tokenUrl", message: pt };
  }
  const values: Record<string, string> = { baseUrl, clientId: v.clientId, privateKeyPem: pem };
  if (tokenUrl) values.tokenUrl = tokenUrl;
  return {
    ok: true,
    values,
    summary: { baseUrlHost: hostOf(baseUrl), tokenUrlHost: hostOf(tokenUrl || deriveEpicTokenUrl(baseUrl)) },
  };
}

export type SaveResult =
  | { ok: true }
  | { ok: false; status: number; error: string; field?: string; message: string };

/**
 * Merge the submitted fields over the stored ones and save. A secret field
 * left empty keeps its stored value (the UI cannot show it back to re-submit);
 * a non-secret optional field submitted empty is cleared. For Amion the two
 * fields are alternatives: submitting one replaces the other.
 */
export async function saveOrgCredentials(
  db: DatabaseStorage,
  orgId: number,
  id: OrgScopeIntegrationId,
  body: unknown,
  actorUserId: number,
): Promise<SaveResult> {
  const key = credentialKeyState();
  if (!key.ok) return { ok: false, status: 503, error: "credential_storage_disabled", message: key.message };
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "validation_error", message: "Send the credential fields as JSON." };
  }
  const fields = CREDENTIAL_FIELDS[id];
  const input: Record<string, string> = {};
  const provided = new Set<string>();
  for (const f of fields) {
    const raw = (body as Record<string, unknown>)[f.name];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") return { ok: false, status: 400, error: "validation_error", field: f.name, message: `${f.label} must be text.` };
    const val = f.multiline ? raw.trim() : raw.trim();
    if (val.length > f.maxLength) return { ok: false, status: 400, error: "validation_error", field: f.name, message: `${f.label} is too long.` };
    provided.add(f.name);
    input[f.name] = val;
  }
  const stored = await readOrgCredentials(db, orgId, id);
  const merged: Record<string, string> = stored.state === "ok" ? { ...stored.values } : {};
  if (id === "amion" && (input.ocsUrl || input.login)) {
    delete merged.ocsUrl;
    delete merged.login;
  }
  for (const f of fields) {
    if (!provided.has(f.name)) continue;
    const val = input[f.name]!;
    if (val) merged[f.name] = val;
    else if (!f.secret) delete merged[f.name];
  }
  const v = validateCredentials(id, merged);
  if (!v.ok) return { ok: false, status: 400, error: "validation_error", field: v.field, message: v.message };
  const sealed = sealCredentials(orgId, id, v.values);
  await db.upsertIntegrationCredential({
    organizationId: orgId,
    integrationId: id,
    ...sealed,
    summary: v.summary,
    updatedBy: actorUserId,
  });
  return { ok: true };
}
