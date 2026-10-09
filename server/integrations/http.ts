import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getVapidPublicKey } from "../services/push.js";

/**
 * Outbound HTTP for integrations — ONE injectable seam.
 *
 * Every connectivity test and every per-hospital feed fetch goes through
 * `integrationFetch` / `guardedFetch` below, so:
 *   - tests swap `fetch` (and `lookup`) via configureIntegrations() and never
 *     touch the network;
 *   - every call is bounded: aborted after `timeoutMs` (capped at 10 s);
 *   - a URL a HOSPITAL typed in (Amion OCS URL, Epic base / token URL) can only
 *     reach a public https host: IP-literal, loopback, link-local, private and
 *     metadata addresses are refused, and the hostname is resolved first so a
 *     DNS name pointing at one is refused too (SSRF guard). URLs the DocTurn
 *     operator set in env are trusted as-is (same as before).
 */

export interface LookupAddress { address: string; family: number }

export interface IntegrationDeps {
  fetch: typeof fetch;
  /** Milliseconds before an outbound call is aborted. Hard-capped at MAX_TIMEOUT_MS. */
  timeoutMs: number;
  /** DNS resolution for the SSRF guard (all addresses of a host). */
  lookup: (host: string) => Promise<LookupAddress[]>;
  now: () => Date;
  /** The VAPID public key THIS process signs pushes with (null = web push not running). */
  runningVapidKey: () => string | null;
}

export const MAX_TIMEOUT_MS = 10_000;

function defaults(): IntegrationDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    timeoutMs: MAX_TIMEOUT_MS,
    lookup: async (host) => (await dnsLookup(host, { all: true, verbatim: true })) as LookupAddress[],
    now: () => new Date(),
    runningVapidKey: () => getVapidPublicKey(),
  };
}

let deps: IntegrationDeps = defaults();

/** Test hook: override any dependency (merged over the current ones). */
export function configureIntegrations(d: Partial<IntegrationDeps>): void {
  deps = { ...deps, ...d };
}
export function resetIntegrationDeps(): void {
  deps = defaults();
}
export function integrationDeps(): IntegrationDeps {
  return deps;
}

/** A failure the UI can show as-is: a short code + a PHI-free, secret-free sentence. */
export class IntegrationCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationCallError";
  }
}

/** fetch with an abort timeout (≤ 10 s). Network/abort errors become IntegrationCallError. */
export async function integrationFetch(url: string, init: RequestInit = {}, fetchImpl?: typeof fetch): Promise<Response> {
  const d = deps;
  const ms = Math.max(1, Math.min(d.timeoutMs, MAX_TIMEOUT_MS));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await (fetchImpl ?? d.fetch)(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (ctrl.signal.aborted || (err as { name?: string } | null)?.name === "AbortError") {
      throw new IntegrationCallError("timeout", `No answer within ${Math.round(ms / 100) / 10} s.`);
    }
    // Node's fetch error text can embed the URL (and so a token): never pass it on.
    const cause = (err as { cause?: { code?: string } } | null)?.cause?.code;
    throw new IntegrationCallError("network", cause ? `Could not connect (${cause}).` : "Could not connect.");
  } finally {
    clearTimeout(timer);
  }
}

// ── SSRF guard for hospital-supplied URLs ───────────────────────────────────
const BLOCKED_HOSTNAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||           // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                               // multicast / reserved / broadcast
  );
}

/** True when an address must never be the target of a hospital-supplied URL. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").split("%")[0]!.toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Blocked(mapped[1]!);
    if (/^f[cd]/.test(ip)) return true;        // unique local fc00::/7
    if (/^fe[89ab]/.test(ip)) return true;     // link-local fe80::/10
    if (/^ff/.test(ip)) return true;           // multicast
    return false;
  }
  return true; // not an IP at all
}

/**
 * Shape check for a URL a hospital types in. Returns an error sentence or null.
 * https only, a real DNS name or public IP, no credentials in the URL.
 */
export function publicHttpsUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Enter a full URL starting with https://";
  }
  if (u.protocol !== "https:") return "The URL must start with https://";
  if (u.username || u.password) return "The URL must not contain a user name or password.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) return "The URL has no host.";
  if (isIP(host)) {
    if (isBlockedAddress(host)) return "That address is private or local; use the vendor's public host name.";
  } else if (BLOCKED_HOSTNAMES.test(host) || !host.includes(".")) {
    return "That host is local; use the vendor's public host name.";
  }
  return null;
}

async function assertPublicTarget(url: string): Promise<void> {
  const problem = publicHttpsUrlProblem(url);
  if (problem) throw new IntegrationCallError("blocked_address", problem);
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  let addrs: LookupAddress[];
  try {
    addrs = await deps.lookup(host);
  } catch {
    throw new IntegrationCallError("dns", "The host name could not be resolved.");
  }
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new IntegrationCallError("blocked_address", "The host resolves to a private or local address; DocTurn only connects to public hosts.");
  }
}

const MAX_REDIRECTS = 3;

/**
 * Resolve the URL's host and refuse it when any address is private/local,
 * then fetch with the timeout. Used for every request to a hospital-supplied
 * URL. Redirects are followed by hand (at most 3) and every hop is checked
 * the same way, so a 30x cannot bounce the call onto an internal address.
 */
export async function guardedFetch(url: string, init: RequestInit = {}, fetchImpl?: typeof fetch): Promise<Response> {
  let target = url;
  for (let hop = 0; ; hop++) {
    await assertPublicTarget(target);
    const res = await integrationFetch(target, { ...init, redirect: "manual" }, fetchImpl);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= MAX_REDIRECTS) throw new IntegrationCallError("redirects", "Too many redirects.");
    target = new URL(location, target).toString();
  }
}
