/**
 * Generic OIDC (E2.1, module `enterprise.sso`) — the protocol half, with no
 * Express and no database in it, so it can be driven against a local issuer
 * fixture in tests.
 *
 * What DocTurn implements, and nothing more:
 *   • discovery at `<issuer>/.well-known/openid-configuration` (cached), with
 *     the document's own `issuer` required to equal the configured one;
 *   • authorization code + **PKCE S256** + `state` + `nonce`;
 *   • a token exchange with `client_secret_post` (Okta, Entra and Google all
 *     accept it) and `code_verifier`;
 *   • **RS256 id_token verification against the JWKS** — `alg` must be RS256,
 *     the `kid` must be in the live key set (one refetch on a miss, so a key
 *     rotation does not need a restart), and `iss` / `aud` / `exp` / `iat` /
 *     `nonce` are all checked;
 *   • a role from a group/claim mapping, with a default.
 *
 * No implicit flow, no `none` alg, no HS256 (a shared-secret id_token from a
 * compromised client registration would be forgeable), no unsigned userinfo
 * trust: every claim DocTurn acts on comes from the verified id_token.
 *
 * The HTTP transport is a PARAMETER. The routes pass `guardedFetch`
 * (server/integrations/http.ts: https-only, public addresses only, re-checked
 * on every redirect hop and at connect time, one 10 s deadline); the tests
 * pass a plain fetch so a local http fixture can play the identity provider.
 * The SSRF control itself is enforced where the connection is SAVED
 * (`publicHttpsUrlProblem` on the issuer) and by that transport in
 * production — never by this file.
 */
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";

export type OidcFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  /** Advertised, not required. */
  end_session_endpoint?: string;
}

export class OidcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

const DISCOVERY_TTL_MS = 10 * 60_000;
const JWKS_TTL_MS = 10 * 60_000;
/** Clock skew allowed on `exp` / `iat` (seconds). */
const SKEW_S = 120;

interface CacheEntry<T> {
  at: number;
  value: T;
}
const discoveryCache = new Map<string, CacheEntry<OidcDiscovery>>();
const jwksCache = new Map<string, CacheEntry<unknown[]>>();

/** Tests: forget what was cached (each test builds its own issuer). */
export function _resetOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

/** base64url without padding. */
export function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** A PKCE pair: the verifier stays in the session, the challenge goes out. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export const randomToken = (bytes = 32): string => b64url(randomBytes(bytes));

async function getJson(fetchImpl: OidcFetch, url: string, code: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new OidcError(code, `Could not reach the identity provider (${(err as Error)?.message ?? "network error"}).`);
  }
  if (!res.ok) throw new OidcError(code, `The identity provider answered ${res.status} for ${new URL(url).pathname}.`);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new OidcError(code, `The identity provider's answer for ${new URL(url).pathname} was not JSON.`);
  }
}

/** `<issuer>/.well-known/openid-configuration`, cached for 10 minutes. */
export async function discover(issuer: string, fetchImpl: OidcFetch): Promise<OidcDiscovery> {
  const base = issuer.replace(/\/+$/, "");
  const hit = discoveryCache.get(base);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.value;
  const doc = (await getJson(fetchImpl, `${base}/.well-known/openid-configuration`, "discovery")) as Partial<OidcDiscovery>;
  for (const field of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof doc[field] !== "string" || !doc[field]) {
      throw new OidcError("discovery", `The identity provider's configuration has no ${field}.`);
    }
  }
  // The document must claim the issuer we configured: otherwise a URL that
  // merely HOSTS a configuration could point the flow anywhere.
  if (String(doc.issuer).replace(/\/+$/, "") !== base) {
    throw new OidcError("issuer_mismatch", "The identity provider's configuration names a different issuer.");
  }
  const value = doc as OidcDiscovery;
  discoveryCache.set(base, { at: Date.now(), value });
  return value;
}

async function jwks(url: string, fetchImpl: OidcFetch, force = false): Promise<unknown[]> {
  const hit = jwksCache.get(url);
  if (!force && hit && Date.now() - hit.at < JWKS_TTL_MS) return hit.value;
  const doc = (await getJson(fetchImpl, url, "jwks")) as { keys?: unknown };
  if (!Array.isArray(doc.keys)) throw new OidcError("jwks", "The identity provider's key set has no keys.");
  jwksCache.set(url, { at: Date.now(), value: doc.keys });
  return doc.keys;
}

export interface AuthorizeUrlInput {
  discovery: OidcDiscovery;
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /** `acr_values` to ask the IdP for (e.g. an MFA policy), if configured. */
  acrValues?: string | null;
}

export function authorizeUrl(i: AuthorizeUrlInput): string {
  const u = new URL(i.discovery.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", i.clientId);
  u.searchParams.set("redirect_uri", i.redirectUri);
  u.searchParams.set("scope", i.scopes);
  u.searchParams.set("state", i.state);
  u.searchParams.set("nonce", i.nonce);
  u.searchParams.set("code_challenge", i.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (i.acrValues) u.searchParams.set("acr_values", i.acrValues);
  return u.toString();
}

export interface TokenInput {
  discovery: OidcDiscovery;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

/** Exchange the code. Returns the raw id_token (still unverified). */
export async function exchangeCode(i: TokenInput, fetchImpl: OidcFetch): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: i.code,
    redirect_uri: i.redirectUri,
    client_id: i.clientId,
    client_secret: i.clientSecret,
    code_verifier: i.codeVerifier,
  });
  let res: Response;
  try {
    res = await fetchImpl(i.discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch (err) {
    throw new OidcError("token", `Could not reach the identity provider's token endpoint (${(err as Error)?.message ?? "network error"}).`);
  }
  const text = await res.text();
  let parsed: { id_token?: unknown; error?: unknown; error_description?: unknown } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    /* reported below */
  }
  if (!res.ok) {
    // The IdP's own error code is useful and carries no secret; its
    // description can, so it is not echoed.
    const code = typeof parsed.error === "string" ? parsed.error : String(res.status);
    throw new OidcError("token", `The identity provider refused the code exchange (${code}).`);
  }
  if (typeof parsed.id_token !== "string" || !parsed.id_token) {
    throw new OidcError("token", "The identity provider returned no id_token.");
  }
  return parsed.id_token;
}

export interface VerifiedIdToken {
  claims: Record<string, unknown>;
  /** The `amr` values the IdP asserted, lower-cased. */
  amr: string[];
  acr: string | null;
}

/**
 * Verify an id_token: RS256 only, a `kid` from the live JWKS, and `iss`,
 * `aud`, `exp`, `iat` and `nonce` all checked. Never trusts the header's
 * `jku`/`x5u` (a token cannot name its own key source).
 */
export async function verifyIdToken(
  idToken: string,
  opts: { discovery: OidcDiscovery; clientId: string; nonce: string; now?: number },
  fetchImpl: OidcFetch,
): Promise<VerifiedIdToken> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new OidcError("id_token", "The id_token is not a three-part JWT.");
  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(parts[0]!).toString("utf8")) as typeof header;
    claims = JSON.parse(b64urlDecode(parts[1]!).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new OidcError("id_token", "The id_token could not be decoded.");
  }
  if (header.alg !== "RS256") {
    throw new OidcError("id_token", `The id_token is signed with ${String(header.alg)}; DocTurn requires RS256.`);
  }
  const kid = typeof header.kid === "string" ? header.kid : null;
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = b64urlDecode(parts[2]!);

  const matching = async (force: boolean) => {
    const keys = (await jwks(opts.discovery.jwks_uri, fetchImpl, force)) as Array<Record<string, unknown>>;
    return keys.filter(
      (k) => k && k.kty === "RSA" && (!kid || k.kid === kid) && (k.alg === undefined || k.alg === "RS256") && (k.use === undefined || k.use === "sig"),
    );
  };
  let candidates = await matching(false);
  // A rotated key: refetch once rather than fail until the cache lapses.
  if (candidates.length === 0) candidates = await matching(true);
  if (candidates.length === 0) throw new OidcError("id_token", "No matching signing key in the identity provider's key set.");
  const ok = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk as never, format: "jwk" });
      return cryptoVerify("RSA-SHA256", signed, key, signature);
    } catch {
      return false;
    }
  });
  if (!ok) throw new OidcError("id_token", "The id_token's signature does not verify.");

  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const iss = String(claims.iss ?? "").replace(/\/+$/, "");
  if (iss !== opts.discovery.issuer.replace(/\/+$/, "")) throw new OidcError("id_token", "The id_token's issuer is wrong.");
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.some((a) => a === opts.clientId) : aud === opts.clientId;
  if (!audOk) throw new OidcError("id_token", "The id_token was not issued for this client.");
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp + SKEW_S < now) throw new OidcError("id_token", "The id_token has expired.");
  const iat = Number(claims.iat);
  if (!Number.isFinite(iat) || iat - SKEW_S > now) throw new OidcError("id_token", "The id_token is dated in the future.");
  if (claims.nonce !== opts.nonce) throw new OidcError("id_token", "The id_token's nonce does not match this sign-in.");

  const amrRaw = claims.amr;
  const amr = Array.isArray(amrRaw) ? amrRaw.filter((v) => typeof v === "string").map((v) => String(v).toLowerCase()) : [];
  return { claims, amr, acr: typeof claims.acr === "string" ? claims.acr : null };
}

/* ── claims → DocTurn ───────────────────────────────────────────────────── */

/** `amr` values that mean "the IdP performed more than one factor". */
export const MFA_AMR_VALUES: readonly string[] = ["mfa", "otp", "hwk", "swk", "sc", "pop", "fido", "wia", "mca"];

export function assertsMfa(v: VerifiedIdToken, acrMfaValue?: string | null): boolean {
  if (v.amr.some((a) => MFA_AMR_VALUES.includes(a))) return true;
  return !!(acrMfaValue && v.acr && v.acr === acrMfaValue);
}

/** The username to use: `preferred_username`, else `email`, else `sub`. */
export function usernameFromClaims(claims: Record<string, unknown>): string | null {
  for (const key of ["preferred_username", "email", "sub"]) {
    const v = claims[key];
    if (typeof v === "string" && v.trim()) {
      // An email-shaped username keeps its local part: DocTurn usernames are
      // short handles, unique per org.
      const raw = key === "email" || v.includes("@") ? v.split("@")[0]! : v;
      const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, ".").replace(/^[.]+|[.]+$/g, "");
      if (cleaned.length >= 3) return cleaned.slice(0, 64);
    }
  }
  return null;
}

export function displayNameFromClaims(claims: Record<string, unknown>, fallback: string): string {
  const str = (k: string) => (typeof claims[k] === "string" && String(claims[k]).trim() ? String(claims[k]).trim() : null);
  const assembled = [str("given_name"), str("family_name")].filter(Boolean).join(" ").trim();
  return str("name") ?? (assembled || null) ?? fallback;
}

export interface RoleMapping {
  /** The claim carrying the group / role values (default "groups"). */
  claim: string;
  /** The role for someone no mapping matches; null = refuse the sign-in. */
  default: string | null;
  /** claim VALUE → DocTurn role. */
  map: Record<string, string>;
}

/**
 * The DocTurn role for a verified token. The mapping is matched
 * case-insensitively; the FIRST matching value in the claim wins, in the
 * order the mapping declares (so a director mapping listed first beats a
 * hospitalist one for someone in both groups).
 */
export function roleFromClaims(claims: Record<string, unknown>, mapping: RoleMapping, allowed: readonly string[]): string | null {
  const raw = claims[mapping.claim];
  const values = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
    .filter((v) => typeof v === "string")
    .map((v) => String(v).toLowerCase());
  for (const [group, role] of Object.entries(mapping.map ?? {})) {
    if (values.includes(group.toLowerCase()) && allowed.includes(role)) return role;
  }
  return mapping.default && allowed.includes(mapping.default) ? mapping.default : null;
}
