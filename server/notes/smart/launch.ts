import { createHash, randomBytes } from "node:crypto";

/**
 * SMART App Launch (HL7 SMART v2) helpers: PKCE, authorize URL, code
 * exchange, refresh, and id_token claim extraction. EHR-agnostic — the same
 * code path serves Epic, Oracle Health, athenahealth, MEDITECH, etc.
 */

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function makeState(): string {
  return randomBytes(24).toString("base64url");
}

export function buildAuthorizeUrl(input: {
  authorizeEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  aud: string;
  codeChallenge: string;
  launch?: string;
}): string {
  const u = new URL(input.authorizeEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("scope", input.scope);
  u.searchParams.set("state", input.state);
  u.searchParams.set("aud", input.aud);
  u.searchParams.set("code_challenge", input.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (input.launch) u.searchParams.set("launch", input.launch);
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
  patient?: string;
  encounter?: string;
  need_patient_banner?: boolean;
  [k: string]: unknown;
}

export async function exchangeCode(input: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (input.clientSecret) {
    // Confidential client: HTTP Basic per RFC 6749 §2.3.1.
    headers.Authorization =
      "Basic " + Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
  } else {
    body.set("client_id", input.clientId);
  }
  const res = await fetch(input.tokenEndpoint, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`token_exchange_failed: ${res.status} ${await res.text().catch(() => "")}`);
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(input: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: input.refreshToken });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (input.clientSecret) {
    headers.Authorization =
      "Basic " + Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
  } else {
    body.set("client_id", input.clientId);
  }
  const res = await fetch(input.tokenEndpoint, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`token_refresh_failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

/**
 * Extract claims from an OpenID id_token. The prototype decodes the payload
 * and checks `exp`/`aud`; production MUST verify the signature against the
 * EHR's `jwks_uri` (see docs/notes-plugin/08_SECURITY_COMPLIANCE.md).
 */
export function decodeIdTokenClaims(
  idToken: string | undefined,
  expectedAud: string,
): { fhirUser?: string; sub?: string; iss?: string } | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    const aud = payload.aud;
    const audOk = Array.isArray(aud) ? aud.includes(expectedAud) : aud === expectedAud || aud === undefined;
    if (!audOk) return undefined;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return undefined;
    const fhirUser = typeof payload.fhirUser === "string" ? payload.fhirUser : undefined;
    const sub = typeof payload.sub === "string" ? payload.sub : undefined;
    const iss = typeof payload.iss === "string" ? payload.iss : undefined;
    return { fhirUser: fhirUser ?? sub, sub, iss };
  } catch {
    return undefined;
  }
}

/** Reduce a fhirUser URL (https://ehr/fhir/Practitioner/123) to Practitioner/123. */
export function normalizeFhirUser(fhirUser: string | undefined): string | undefined {
  if (!fhirUser) return undefined;
  const m = fhirUser.match(/((?:Practitioner|PractitionerRole|Patient|RelatedPerson|Person)\/[^/?#]+)\/?$/);
  return m ? m[1] : fhirUser;
}
