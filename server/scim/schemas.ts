/**
 * SCIM 2.0 (RFC 7643 / RFC 7644) wire shapes — Users only (E2.2, module
 * `enterprise.scim`).
 *
 * What DocTurn exposes and why:
 *   userName     the DocTurn username (unique per org, case-insensitive) —
 *                also the correlation key, because there is nowhere to store
 *                an `externalId` today: it is ACCEPTED and echoed back within
 *                the request, never persisted, and the docs say so.
 *   name         givenName / familyName / formatted → users.display_name.
 *   displayName  users.display_name.
 *   active       NOT users.disabled_at: false deactivates through the same
 *                path as the People screen (server/services/provisioning.ts).
 *   roles        [{ value: <DocTurn role> }] — so an IdP can provision a
 *                hospitalist or an ER physician. An unknown or privileged
 *                role is refused rather than silently downgraded.
 *   emails       accepted and ignored: DocTurn stores no email address.
 *   meta         resourceType / created / lastModified / location.
 *
 * Case: SCIM attribute names are case-insensitive (RFC 7644 §3.10) and the
 * two big providers disagree on PATCH shapes (Okta sends
 * `{op:"replace", value:{active:false}}` with no `path`; Entra sends
 * `{op:"Replace", path:"active", value:"False"}`), so everything here reads
 * both.
 */
import type { Role, User } from "@shared/schema";

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_SPC_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";
export const SCIM_RESOURCE_TYPE_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ResourceType";
export const SCIM_SCHEMA_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Schema";
export const SCIM_CONTENT_TYPE = "application/scim+json; charset=utf-8";

/** Roles an identity provider may provision. Privileged roles are not on it. */
export const SCIM_ASSIGNABLE_ROLES: readonly Role[] = ["hospitalist", "er_doctor"];

export interface ScimError {
  schemas: [typeof SCIM_ERROR_SCHEMA];
  /** RFC 7644 §3.12: the status is a STRING. */
  status: string;
  scimType?: string;
  detail: string;
}

export function scimError(status: number, detail: string, scimType?: string): ScimError {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

/** Case-insensitive property read (SCIM attribute names are case-insensitive). */
export function ci(obj: unknown, name: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

/** "true" / "True" / true / 1 → true; "false" / false / 0 → false; else undefined. */
export function coerceBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return undefined;
}

export interface ScimUserBody {
  userName?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  formatted?: string;
  active?: boolean;
  role?: string;
  externalId?: string;
}

/** Read the parts of a SCIM User resource DocTurn can store. */
export function readScimUser(body: unknown): ScimUserBody {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const name = ci(body, "name");
  const rolesRaw = ci(body, "roles");
  let role: string | undefined;
  if (Array.isArray(rolesRaw)) {
    // The primary role, else the first one with a value.
    const primary = rolesRaw.find((r) => coerceBoolean(ci(r, "primary")) === true) ?? rolesRaw[0];
    role = str(ci(primary, "value")) ?? str(primary);
  } else {
    role = str(rolesRaw);
  }
  return {
    userName: str(ci(body, "userName")),
    displayName: str(ci(body, "displayName")),
    givenName: str(ci(name, "givenName")),
    familyName: str(ci(name, "familyName")),
    formatted: str(ci(name, "formatted")),
    active: coerceBoolean(ci(body, "active")),
    role,
    externalId: str(ci(body, "externalId")),
  };
}

/** The display name to store: explicit, else the formatted/assembled name. */
export function displayNameFrom(b: ScimUserBody, fallback?: string): string | undefined {
  const assembled = [b.givenName, b.familyName].filter(Boolean).join(" ").trim();
  return b.displayName ?? b.formatted ?? (assembled || undefined) ?? fallback;
}

/** Split a stored display name back into SCIM's name sub-attributes. */
function splitName(displayName: string): { givenName: string; familyName: string } {
  const parts = displayName.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/);
  if (parts.length <= 1) return { givenName: displayName, familyName: "" };
  return { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1]! };
}

/** One SCIM User resource. `baseUrl` is this request's own /scim/v2 base. */
export function scimUser(user: User, baseUrl: string): Record<string, unknown> {
  const { givenName, familyName } = splitName(user.displayName);
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: String(user.id),
    userName: user.username,
    name: { formatted: user.displayName, givenName, familyName },
    displayName: user.displayName,
    active: !user.disabledAt,
    roles: [{ value: user.role, primary: true }],
    meta: {
      resourceType: "User",
      created: user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt),
      lastModified: user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt),
      location: `${baseUrl}/Users/${user.id}`,
    },
  };
}

export function scimList(resources: Array<Record<string, unknown>>, totalResults: number, startIndex: number): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

/**
 * The ONE filter DocTurn implements: `userName eq "x"` (optionally with
 * `externalId eq "x"`, which can never match since nothing is stored).
 * Anything else is refused with scimType `invalidFilter` rather than silently
 * returning everything — an IdP that de-duplicates on a filter it thinks was
 * applied would otherwise create duplicates.
 */
export type ParsedFilter =
  | { kind: "none" }
  | { kind: "userName"; value: string }
  | { kind: "never" }
  | { kind: "unsupported" };

export function parseFilter(raw: string | undefined): ParsedFilter {
  if (!raw || !raw.trim()) return { kind: "none" };
  const m = /^\s*([A-Za-z]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/.exec(raw);
  if (!m) return { kind: "unsupported" };
  const attr = m[1]!.toLowerCase();
  const value = m[2]!.replace(/\\(.)/g, "$1");
  if (attr === "username") return { kind: "userName", value };
  // externalId / id are accepted as filters that simply match nothing.
  if (attr === "externalid") return { kind: "never" };
  return { kind: "unsupported" };
}

export const SERVICE_PROVIDER_CONFIG = {
  schemas: [SCIM_SPC_SCHEMA],
  documentationUri: "https://github.com/docturn/docs/ENTERPRISE_READINESS.md",
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: "oauthbearertoken",
      name: "OAuth Bearer Token",
      description: "A per-organization bearer token created in DocTurn (Settings → Security → SCIM provisioning). Only a SHA-256 of it is stored; it is shown once and can be revoked.",
      primary: true,
    },
  ],
  meta: { resourceType: "ServiceProviderConfig", location: "/scim/v2/ServiceProviderConfig" },
} as const;

export function resourceTypes(baseUrl: string) {
  return [
    {
      schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
      id: "User",
      name: "User",
      endpoint: "/Users",
      description: "A DocTurn workforce account",
      schema: SCIM_USER_SCHEMA,
      schemaExtensions: [],
      meta: { resourceType: "ResourceType", location: `${baseUrl}/ResourceTypes/User` },
    },
  ];
}

/** The attributes DocTurn really stores — nothing is advertised that is dropped. */
export function userSchemaDefinition(baseUrl: string) {
  const attr = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
    name,
    type,
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: "readWrite",
    returned: "default",
    uniqueness: "none",
    ...extra,
  });
  return {
    schemas: [SCIM_SCHEMA_SCHEMA],
    id: SCIM_USER_SCHEMA,
    name: "User",
    description: "DocTurn workforce account. Only the attributes listed here are stored; anything else in a request is accepted and dropped.",
    attributes: [
      attr("userName", "string", { required: true, uniqueness: "server" }),
      attr("displayName", "string"),
      {
        ...attr("name", "complex"),
        subAttributes: [attr("formatted", "string"), attr("givenName", "string"), attr("familyName", "string")],
      },
      attr("active", "boolean"),
      {
        ...attr("roles", "complex", { multiValued: true }),
        subAttributes: [attr("value", "string"), attr("primary", "boolean")],
      },
    ],
    meta: { resourceType: "Schema", location: `${baseUrl}/Schemas/${SCIM_USER_SCHEMA}` },
  };
}
