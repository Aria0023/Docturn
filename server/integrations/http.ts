import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { getVapidPublicKey } from "../services/push.js";

/**
 * Outbound HTTP for integrations — ONE injectable seam.
 *
 * Every connectivity test and every feed / API fetch goes through
 * `integrationFetch` / `guardedFetch` below, so:
 *   - tests swap `fetch` (and `lookup`) via configureIntegrations() and never
 *     touch the network;
 *   - every call is bounded END TO END: one deadline (≤ 10 s) covers the
 *     connection, the headers AND the whole body, and the body is read into
 *     memory under a size cap (5 MB) before the caller sees it. A vendor that
 *     sends headers and then drips (or stops) can never hold a request — or a
 *     scheduled sync — open past the deadline. Callers get a fully buffered
 *     Response, so their own res.text()/res.json() cannot block;
 *   - a URL a HOSPITAL typed in (Amion OCS URL, Epic base / token URL) can only
 *     reach a public https host (SSRF guard): IP literals, loopback,
 *     link-local, private, metadata, NAT64 / IPv4-mapped / IPv4-compatible
 *     IPv6 and every other non-global address are refused; the host name is
 *     resolved first, every redirect hop is re-checked, and the default
 *     transport for these URLs re-checks the address it ACTUALLY connects to
 *     (so a DNS answer that changes between the check and the connection —
 *     "DNS rebinding" — is refused too). URLs the DocTurn operator set in env
 *     are trusted as-is (same as before).
 */

export interface LookupAddress { address: string; family: number }

export interface IntegrationDeps {
  /** fetch for operator-configured (env) URLs and vendor APIs (Twilio, OpenAI). */
  fetch: typeof fetch;
  /**
   * fetch for hospital-supplied URLs. Default: an https transport whose DNS
   * lookup refuses blocked addresses at connect time. Setting `fetch` through
   * configureIntegrations() also sets this unless it is given explicitly.
   */
  publicFetch: typeof fetch;
  /** Milliseconds before an outbound call is aborted (headers + body). Hard-capped at MAX_TIMEOUT_MS. */
  timeoutMs: number;
  /** Largest response body read into memory, in bytes. */
  maxBodyBytes: number;
  /** DNS resolution for the SSRF guard (all addresses of a host). */
  lookup: (host: string) => Promise<LookupAddress[]>;
  now: () => Date;
  /** The VAPID public key THIS process signs pushes with (null = web push not running). */
  runningVapidKey: () => string | null;
}

export const MAX_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 5_000_000;

function defaults(): IntegrationDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    publicFetch: (input, init) => pinnedHttpsFetch(input, init),
    timeoutMs: MAX_TIMEOUT_MS,
    maxBodyBytes: MAX_BODY_BYTES,
    lookup: async (host) => (await dnsLookup(host, { all: true, verbatim: true })) as LookupAddress[],
    now: () => new Date(),
    runningVapidKey: () => getVapidPublicKey(),
  };
}

let deps: IntegrationDeps = defaults();

/** Test hook: override any dependency (merged over the current ones). */
export function configureIntegrations(d: Partial<IntegrationDeps>): void {
  deps = { ...deps, ...d };
  if (d.fetch && !d.publicFetch) deps.publicFetch = d.fetch;
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

// ── deadlines ───────────────────────────────────────────────────────────────
interface Deadline {
  signal: AbortSignal;
  ms: number;
  /** Which limit fired: this call's own, or an outer one (e.g. a whole sync's). */
  firedBy: () => "call" | "outer" | null;
  done: () => void;
}

/** One abort deadline: this call's own ≤ 10 s, also aborted when `outer` aborts. */
function startDeadline(outer?: AbortSignal | null): Deadline {
  const ms = Math.max(1, Math.min(deps.timeoutMs, MAX_TIMEOUT_MS));
  const ctrl = new AbortController();
  let fired: "call" | "outer" | null = null;
  const timer = setTimeout(() => {
    fired ??= "call";
    ctrl.abort();
  }, ms);
  timer.unref?.();
  const onOuter = () => {
    fired ??= "outer";
    ctrl.abort();
  };
  if (outer) {
    if (outer.aborted) onOuter();
    else outer.addEventListener("abort", onOuter, { once: true });
  }
  return {
    signal: ctrl.signal,
    ms,
    firedBy: () => fired,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

function timeoutError(d: Deadline): IntegrationCallError {
  return d.firedBy() === "outer"
    ? new IntegrationCallError("timeout", "The overall time limit for this sync ran out.")
    : new IntegrationCallError("timeout", `No complete answer within ${Math.round(d.ms / 100) / 10} s.`);
}

function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/** Rejects when `signal` aborts (never resolves). Lets any await be cut off by the deadline. */
function abortRace(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let onAbort: (() => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  promise.catch(() => {}); // never an unhandled rejection
  return { promise, dispose: () => { if (onAbort) signal.removeEventListener("abort", onAbort); } };
}

// ── bounded body reads ──────────────────────────────────────────────────────
/**
 * Read a response body into memory, refusing more than `maxBytes` (cancels the
 * stream and throws IntegrationCallError "too_large") and giving up as soon as
 * `signal` aborts (throws "timeout") — even when the underlying stream ignores
 * the abort.
 */
export async function readBodyBytes(
  res: Response,
  opts: { maxBytes?: number; signal?: AbortSignal | null } = {},
): Promise<Uint8Array> {
  const max = opts.maxBytes ?? deps.maxBodyBytes;
  const tooLarge = () => new IntegrationCallError("too_large", "The response was too large.");
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const race = opts.signal ? abortRace(opts.signal) : null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const r = race ? await Promise.race([reader.read(), race.promise]) : await reader.read();
      if (r.done) break;
      total += r.value.byteLength;
      if (total > max) throw tooLarge();
      chunks.push(r.value);
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    if (err instanceof IntegrationCallError) throw err;
    if (opts.signal?.aborted || isAbortLike(err)) throw new IntegrationCallError("timeout", "The answer did not arrive in time.");
    throw new IntegrationCallError("network", "The connection broke while reading the answer.");
  } finally {
    race?.dispose();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** readBodyBytes as UTF-8 text. */
export async function readBodyCapped(res: Response, maxBytes = MAX_BODY_BYTES, signal?: AbortSignal | null): Promise<string> {
  return new TextDecoder().decode(await readBodyBytes(res, { maxBytes, signal }));
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** One request under deadline `d`: headers AND body, returned as a buffered Response. */
async function fetchBuffered(url: string, init: RequestInit, impl: typeof fetch, d: Deadline): Promise<Response> {
  const race = abortRace(d.signal);
  const pending = impl(url, { ...init, signal: d.signal });
  try {
    const res = await Promise.race([pending, race.promise]).catch((err) => {
      // A transport that answers after the deadline: release its body.
      pending.then((late) => late.body?.cancel().catch(() => {}), () => {});
      throw err;
    });
    const method = (init.method ?? "GET").toUpperCase();
    const body = NULL_BODY_STATUS.has(res.status) || method === "HEAD" ? null : await readBodyBytes(res, { signal: d.signal });
    if (body === null) await res.body?.cancel().catch(() => {});
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } catch (err) {
    if (err instanceof IntegrationCallError && err.code !== "timeout") throw err;
    if (d.signal.aborted || isAbortLike(err) || err instanceof IntegrationCallError) throw timeoutError(d);
    // Node's fetch error text can embed the URL (and so a token): never pass it on.
    const cause = (err as { cause?: { code?: string }; code?: string } | null);
    const code = cause?.cause?.code ?? cause?.code;
    throw new IntegrationCallError("network", typeof code === "string" && /^[A-Z_]{2,40}$/.test(code) ? `Could not connect (${code}).` : "Could not connect.");
  } finally {
    race.dispose();
  }
}

/**
 * fetch with ONE deadline (≤ 10 s) over the request, the headers and the
 * whole body (≤ 5 MB), returned as a buffered Response. `outer` is an extra
 * deadline the caller holds (a whole sync's); whichever fires first wins.
 * Network/abort/size errors become IntegrationCallError.
 */
export async function integrationFetch(
  url: string,
  init: RequestInit = {},
  fetchImpl?: typeof fetch,
  outer?: AbortSignal | null,
): Promise<Response> {
  const d = startDeadline(outer ?? init.signal ?? null);
  try {
    return await fetchBuffered(url, init, fetchImpl ?? deps.fetch, d);
  } finally {
    d.done();
  }
}

// ── SSRF guard for hospital-supplied URLs ───────────────────────────────────
const BLOCKED_HOSTNAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

function ipv4Blocked(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||  // carrier-grade NAT
    (a === 169 && b === 254) ||            // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||  // TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||   // TEST-NET-3
    a >= 224                                  // multicast / reserved / broadcast
  );
}

/** An IPv6 address (already validated by isIP) as its eight 16-bit groups. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip;
  let tail: number[] = [];
  const v4 = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const p = v4[2]!.split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    tail = [(p[0]! << 8) | p[1]!, (p[2]! << 8) | p[3]!];
    s = v4[1]!.endsWith("::") ? v4[1]! : v4[1]!.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const want = 8 - tail.length;
  let words: string[];
  if (halves.length === 2) {
    const fill = want - head.length - rest.length;
    if (fill < 0) return null;
    words = [...head, ...Array<string>(fill).fill("0"), ...rest];
  } else {
    words = head;
  }
  if (words.length !== want) return null;
  const groups = words.map((w) => parseInt(w, 16));
  if (groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return [...groups, ...tail];
}

function ipv6Blocked(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return true;
  // IPv4-mapped ::ffff:a.b.c.d (in any spelling, e.g. ::ffff:7f00:1): the
  // connection goes to the embedded IPv4 address, so judge THAT address.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return ipv4Blocked(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  }
  // Everything else must be global unicast (2000::/3). That alone refuses
  // ::/128, ::1, IPv4-compatible ::a.b.c.d, ::ffff:0:0/96, NAT64 64:ff9b::/96
  // and 64:ff9b:1::/48, discard 100::/64, fc00::/7, fe80::/10, fec0::/10, ff00::/8.
  const first = g[0]!;
  if ((first & 0xe000) !== 0x2000) return true;
  if (first === 0x2002) return true;                     // 6to4 (embeds an IPv4 address)
  if (first === 0x2001 && g[1]! < 0x0200) return true;   // 2001::/23 special purpose (Teredo, benchmarking, ORCHID…)
  if (first === 0x2001 && g[1] === 0x0db8) return true;  // documentation
  if (first === 0x3fff && g[1]! < 0x1000) return true;   // documentation 3fff::/20
  return false;
}

/** True when an address must never be the target of a hospital-supplied URL. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").split("%")[0]!.toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) return ipv6Blocked(ip);
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
  // WHATWG URL has already normalised the host: IPv4 in any notation becomes
  // dotted decimal, IPv6 is bracketed and compressed (::ffff:127.0.0.1 →
  // [::ffff:7f00:1]) — isBlockedAddress understands every such spelling.
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return "The URL has no host.";
  if (isIP(host)) {
    if (isBlockedAddress(host)) return "That address is private or local; use the vendor's public host name.";
  } else if (BLOCKED_HOSTNAMES.test(host) || !host.includes(".")) {
    return "That host is local; use the vendor's public host name.";
  }
  return null;
}

const BLOCKED_DNS_MESSAGE = "The host resolves to a private or local address; DocTurn only connects to public hosts.";

async function assertPublicTarget(url: string, d: Deadline): Promise<void> {
  const problem = publicHttpsUrlProblem(url);
  if (problem) throw new IntegrationCallError("blocked_address", problem);
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  let addrs: LookupAddress[];
  const race = abortRace(d.signal);
  try {
    addrs = await Promise.race([deps.lookup(host), race.promise]);
  } catch {
    if (d.signal.aborted) throw timeoutError(d);
    throw new IntegrationCallError("dns", "The host name could not be resolved.");
  } finally {
    race.dispose();
  }
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new IntegrationCallError("blocked_address", BLOCKED_DNS_MESSAGE);
  }
}

// ── the default transport for hospital-supplied URLs ────────────────────────
/**
 * DNS lookup for the CONNECTION itself: the same resolver as the pre-check,
 * and the same rule — any blocked address refuses the connection. Because
 * this runs when the socket connects, an answer that changed after
 * assertPublicTarget (DNS rebinding) cannot slip through.
 */
const pinnedLookup = ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
  const opts = (typeof options === "object" && options ? options : { family: options }) as { all?: boolean; family?: number | string };
  const fam = opts.family === "IPv4" ? 4 : opts.family === "IPv6" ? 6 : Number(opts.family) || 0;
  deps.lookup(hostname).then(
    (all) => {
      const list = all.filter((a) => a && typeof a.address === "string" && (!fam || a.family === fam));
      if (!list.length) {
        callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
        return;
      }
      if (list.some((a) => isBlockedAddress(a.address))) {
        callback(new IntegrationCallError("blocked_address", BLOCKED_DNS_MESSAGE));
        return;
      }
      if (opts.all) callback(null, list.map((a) => ({ address: a.address, family: a.family })));
      else callback(null, list[0]!.address, list[0]!.family);
    },
    (err) => callback(err),
  );
}) as unknown as LookupFunction;

function requestBody(body: RequestInit["body"]): string | Buffer | null {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError("unsupported request body");
}

/**
 * Minimal https-only fetch over node:https whose DNS lookup is pinnedLookup.
 * No redirects are followed (guardedFetch follows them itself, re-checking
 * each hop). gzip / deflate / br bodies are decoded like fetch would.
 */
export const pinnedHttpsFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.protocol !== "https:") throw new TypeError("https only");
  const headers = new Headers(init.headers);
  const body = requestBody(init.body);
  if (body != null && !headers.has("content-length")) headers.set("content-length", String(Buffer.byteLength(body)));
  const method = (init.method ?? "GET").toUpperCase();
  return new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method,
        headers: Object.fromEntries(headers.entries()),
        lookup: pinnedLookup,
        agent: false,
        signal: init.signal ?? undefined,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue;
          if (Array.isArray(v)) for (const x of v) h.append(k, x);
          else h.set(k, String(v));
        }
        if (NULL_BODY_STATUS.has(status) || method === "HEAD" || status < 200) {
          res.resume();
          resolve(new Response(null, { status: status < 200 ? 502 : status, statusText: res.statusMessage, headers: h }));
          return;
        }
        let stream: NodeJS.ReadableStream = res;
        const enc = (h.get("content-encoding") ?? "").trim().toLowerCase();
        const decoder = enc === "gzip" || enc === "x-gzip" ? createGunzip() : enc === "deflate" ? createInflate() : enc === "br" ? createBrotliDecompress() : null;
        if (decoder) {
          res.on("error", (e) => decoder.destroy(e));
          stream = res.pipe(decoder);
          h.delete("content-encoding");
          h.delete("content-length");
        }
        resolve(new Response(Readable.toWeb(stream as Readable) as unknown as ReadableStream, { status, statusText: res.statusMessage, headers: h }));
      },
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}) as typeof fetch;

const MAX_REDIRECTS = 3;

/**
 * Resolve the URL's host and refuse it when any address is private/local,
 * then fetch it under ONE deadline (≤ 10 s for the whole redirect chain,
 * headers and bodies included). Used for every request to a hospital-supplied
 * URL. Redirects are followed by hand (at most 3) and every hop is checked
 * the same way, so a 30x cannot bounce the call onto an internal address; the
 * default transport re-checks the address at connect time.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit = {},
  fetchImpl?: typeof fetch,
  outer?: AbortSignal | null,
): Promise<Response> {
  const d = startDeadline(outer ?? init.signal ?? null);
  const impl = fetchImpl ?? deps.publicFetch;
  try {
    let target = url;
    for (let hop = 0; ; hop++) {
      await assertPublicTarget(target, d);
      let res: Response;
      try {
        res = await fetchBuffered(target, { ...init, redirect: "manual" }, impl, d);
      } catch (err) {
        // The connect-time lookup refused the address: say so, not "network".
        const cause = (err as { cause?: unknown } | null)?.cause;
        if (cause instanceof IntegrationCallError) throw cause;
        throw err;
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) return res;
      if (hop >= MAX_REDIRECTS) throw new IntegrationCallError("redirects", "Too many redirects.");
      target = new URL(location, target).toString();
    }
  } finally {
    d.done();
  }
}
