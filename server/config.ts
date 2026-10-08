import helmet from "helmet";
import { isIP } from "node:net";
import type { Request, RequestHandler } from "express";
import {
  notificationProfileSchema,
  type NotificationProfile,
} from "@shared/schema";
import { storage } from "./storage.js";

/* ────────────────────────────────────────────────────────────────────────────
 * Security posture — ONE source of truth.
 *
 * `server/app.ts` builds the running middleware from the values below, and the
 * compliance monitor (`server/compliance/checks.ts`) reads the SAME values (and
 * probes the SAME helmet instance) to report on them. Nothing is duplicated as
 * a literal in two places, so a control can never report a posture the app does
 * not actually have.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SessionPolicy {
  /** Session cookie name. */
  name: string;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  /** Inactivity window. With `rolling`, this is an idle timeout, not absolute. */
  maxAgeMs: number;
  /** Re-issue the cookie on each request → maxAge behaves as INACTIVITY expiry. */
  rolling: boolean;
  /** Mark the cookie Secure when NODE_ENV=production. */
  secureInProduction: boolean;
}

export const SESSION_POLICY: SessionPolicy = {
  name: "docturn.sid",
  httpOnly: true,
  // "lax" (not "strict") so the session cookie reliably sticks when the app is
  // reached from another device / through a tunnel. Still safe: the API is
  // same-origin and the CSRF surface is minimal.
  sameSite: "lax",
  maxAgeMs: 15 * 60 * 1000,
  rolling: true,
  secureInProduction: true,
};

/** The cookie options the running session middleware is configured with. */
export function sessionCookieOptions() {
  return {
    httpOnly: SESSION_POLICY.httpOnly,
    sameSite: SESSION_POLICY.sameSite,
    secure:
      SESSION_POLICY.secureInProduction &&
      process.env.NODE_ENV === "production",
    maxAge: SESSION_POLICY.maxAgeMs,
  };
}

/* ── Content-Security-Policy ──────────────────────────────────────────────────
 *
 * The web client is a NO-BUILD React kit: index.html carries inline <script>
 * blocks, Babel standalone compiles the .jsx files in the browser and injects
 * the output as further inline scripts, React writes inline style attributes,
 * attachments and voice clips are played from blob: URLs, and the realtime
 * feed is a same-origin WebSocket. The policy below is the TIGHTEST one that
 * app runs under with zero violations (verified in Chromium by
 * scripts/csp-check.mjs: login, messaging, voice recording, service worker).
 *
 * Honest expectation: because `script-src` must allow 'unsafe-inline' for the
 * in-browser compiler, this CSP does NOT stop a reflected/stored XSS from
 * executing. What it does enforce — and what is worth having today — is:
 *   • no script, style, font, frame or worker may load from any other origin;
 *   • fetch/XHR/WebSocket may only talk to this host (no PHI exfiltration to a
 *     third-party origin even if script injection occurred);
 *   • no plugins (object-src 'none'), no <base> hijack, forms post only here,
 *     and the app cannot be framed by another site (frame-ancestors 'self').
 * Removing 'unsafe-inline' requires a build step (precompiled JSX + nonces)
 * and is tracked in SECURITY.md.
 *
 * `upgrade-insecure-requests` is deliberately ABSENT: a dev/trial instance is
 * reached over plain http from a phone on the LAN or via a tunnel, and that
 * directive would force every sub-resource to https and break the page.
 */
function wsOrigins(req: { headers?: Record<string, unknown> }): string {
  const host = req?.headers?.host;
  if (typeof host !== "string" || !host) return "ws: wss:";
  // Only the same host the page was served from, over either WebSocket scheme
  // (the client picks ws:/wss: from location.protocol).
  return `ws://${host} wss://${host}`;
}

export const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"],
  // Inherit script-src for inline event handlers (demo.html's reset button).
  scriptSrcAttr: null,
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", "data:", "blob:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'", wsOrigins],
  mediaSrc: ["'self'", "blob:"],
  workerSrc: ["'self'"],
  frameSrc: ["'self'"],
  frameAncestors: ["'self'"],
  manifestSrc: ["'self'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  objectSrc: ["'none'"],
  upgradeInsecureRequests: null,
} as const;

export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: CSP_DIRECTIVES as unknown as Record<string, null | Iterable<string | ((req: unknown, res: unknown) => string)>>,
  },
} as const;

/**
 * Permissions-Policy: the app records voice messages (microphone) in its own
 * documents only; nothing else on this list is used anywhere in the client, so
 * it is switched off for every origin, including same-origin iframes.
 * helmet does not emit this header, hence the explicit middleware below.
 */
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()";

const helmetMiddleware = helmet(HELMET_OPTIONS);

/**
 * The exact security-header middleware the app mounts (helmet + the
 * Permissions-Policy header helmet lacks). The compliance monitor runs this
 * instance against a stub request/response to read back the response headers
 * it ACTUALLY sets (HSTS, CSP, X-Frame-Options, …) rather than assuming a
 * default.
 */
export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  helmetMiddleware(req, res, next);
};

/* ── Reverse-proxy trust ──────────────────────────────────────────────────────
 *
 * `req.ip` (rate-limit keys, PHI-access audit rows) and `req.secure` (Secure
 * cookie decisions) both come from X-Forwarded-* headers — which any client can
 * send. Express's `trust proxy` setting decides WHEN those headers are
 * believed. The old setting was the hop count `1`: "whatever connected to me
 * is a proxy", i.e. anyone able to reach the Node port directly could pick its
 * own rate-limit bucket by setting X-Forwarded-For. The resolved setting below
 * is an ADDRESS LIST instead: forwarded headers are honoured only when the TCP
 * peer is one of the listed proxies, and only one hop beyond it is taken.
 *
 *   TRUST_PROXY unset / 1 / true / on   → "loopback"  (Caddy/cloudflared/ngrok
 *                                           on the same host — the documented
 *                                           deployment; deploy/aws/Caddyfile)
 *   TRUST_PROXY=0 / false / off           → nothing is trusted (local-only run)
 *   TRUST_PROXY=<list>                    → comma-separated IPs, CIDRs and the
 *                                           keywords loopback / linklocal /
 *                                           uniquelocal — for a proxy that is
 *                                           NOT on this host (PaaS, ALB, k8s)
 *   TRUST_PROXY=<n ≥ 2>                   → legacy hop count. Accepted, but it
 *                                           is spoofable from any direct peer
 *                                           and is logged as such at boot.
 */
export interface TrustProxyResolution {
  /** Value for `app.set("trust proxy", …)`. */
  value: false | string | number;
  /** How it was derived, for the boot log. */
  source: "default" | "env";
  /** True when a direct peer can forge X-Forwarded-For (hop-count mode). */
  spoofable: boolean;
  description: string;
}

const TRUST_KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

export function resolveTrustProxy(raw: string | undefined): TrustProxyResolution {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "1" || v === "true" || v === "on" || v === "yes") {
    return {
      value: "loopback",
      source: v === "" ? "default" : "env",
      spoofable: false,
      description:
        "X-Forwarded-* honoured only from a loopback peer (reverse proxy on this host), one hop",
    };
  }
  if (v === "0" || v === "false" || v === "off" || v === "no") {
    return {
      value: false,
      source: "env",
      spoofable: false,
      description: "no proxy trusted; the TCP peer address is the client address",
    };
  }
  if (/^\d+$/.test(v)) {
    const hops = Number(v);
    return {
      value: hops,
      source: "env",
      spoofable: true,
      description: `legacy hop count ${hops}: X-Forwarded-For is believed from ANY direct peer — spoofable; prefer an address list`,
    };
  }
  // Address list. Keep only tokens that are a keyword, an IP, or a CIDR so a
  // typo cannot silently widen trust to "everything".
  const tokens = v
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => {
      if (TRUST_KEYWORDS.has(t)) return true;
      const [addr, bits] = t.split("/");
      if (!addr || isIP(addr) === 0) return false;
      if (bits === undefined) return true;
      const n = Number(bits);
      return Number.isInteger(n) && n >= 0 && n <= (isIP(addr) === 4 ? 32 : 128);
    });
  if (tokens.length === 0) {
    return {
      value: false,
      source: "env",
      spoofable: false,
      description: `TRUST_PROXY="${raw}" contains no valid IP/CIDR/keyword — nothing is trusted`,
    };
  }
  return {
    value: tokens.join(","),
    source: "env",
    spoofable: false,
    description: `X-Forwarded-* honoured only from peers in [${tokens.join(", ")}], one hop`,
  };
}

/* ── Rate limiting ─────────────────────────────────────────────────────────── */

/** Tiered request limits — stricter on auth, looser on general traffic. */
export const AUTH_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 50 };
export const GENERAL_RATE_LIMIT = { windowMs: 60 * 1000, max: 300 };
/**
 * Per-ACCOUNT failed-login budget (org code + username, case-insensitive), so a
 * distributed guesser rotating source addresses still runs into a wall for one
 * target account. Failed attempts only; a correct password never counts.
 */
export const ACCOUNT_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 10 };

/** The JSON body every limiter answers with (same shape as the API's errors). */
export const RATE_LIMIT_RESPONSE = { error: "rate_limited" } as const;

/**
 * The rate-limit key for a request: the client address as Express resolved it
 * under the `trust proxy` setting above (so a spoofed X-Forwarded-For from an
 * untrusted peer is ignored), normalised so IPv4-mapped IPv6 collapses to the
 * IPv4 and an IPv6 client is bucketed by its /64 (one device cannot rotate
 * through 2^64 interface ids to dodge the limiter).
 */
export function clientIpKey(req: Request): string {
  const raw = req.ip || req.socket?.remoteAddress || "";
  const ip = raw.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1").split("%")[0] ?? "";
  if (!ip) return "unknown";
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind === 6) return ipv6Prefix64(ip);
  return "invalid:" + ip.slice(0, 64);
}

function ipv6Prefix64(ip: string): string {
  const [head = "", tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const full = [...headParts, ...new Array<string>(missing).fill("0"), ...tailParts];
  return full.slice(0, 4).map((h) => h.padStart(4, "0")).join(":") + "::/64";
}

export interface RateLimitState {
  /** Whether the running app actually mounted the limiters. */
  enabled: boolean;
  /** Why, in machine-readable form, so the control reports the true cause. */
  reason:
    | "enabled"
    | "no_app_created"
    | "disabled_by_env"
    | "disabled_by_app_option";
}

let rateLimitState: RateLimitState = {
  enabled: false,
  reason: "no_app_created",
};

/** Recorded by createApp() with what it actually mounted. Never guessed. */
export function setRateLimitState(state: RateLimitState) {
  rateLimitState = state;
}
export function getRateLimitState(): RateLimitState {
  return rateLimitState;
}

/* ── Session store ─────────────────────────────────────────────────────────── */

export type SessionStoreKind = "postgres" | "memory";

export interface SessionStoreState {
  /** "none" until createApp() has chosen a store in this process. */
  kind: SessionStoreKind | "none";
  reason: string;
}

let sessionStoreState: SessionStoreState = {
  kind: "none",
  reason: "no Express app has been created in this process",
};

/** Recorded by server/session-store.ts with the store it actually built. */
export function setSessionStoreState(state: SessionStoreState) {
  sessionStoreState = state;
}
export function getSessionStoreState(): SessionStoreState {
  return sessionStoreState;
}

/**
 * Cached runtime configuration read in hot paths (rotation, expiry,
 * notifications). Values live in `org_settings`; a short TTL keeps reads cheap
 * while still reflecting in-app edits on the next action (no redeploy).
 */
const TTL_MS = 5_000;
const cache = new Map<string, { value: unknown; at: number }>();

function key(orgId: number, k: string) {
  return `${orgId}:${k}`;
}

export function invalidateConfig(orgId: number, k?: string) {
  if (k) cache.delete(key(orgId, k));
  else for (const ck of [...cache.keys()]) if (ck.startsWith(`${orgId}:`)) cache.delete(ck);
}

/** Clear the entire config cache (used by the test harness for isolation). */
export function _resetConfigCache() {
  cache.clear();
}

export async function getOrgSettingCached(
  orgId: number,
  k: string,
): Promise<unknown> {
  const ck = key(orgId, k);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await storage().getOrgSetting(orgId, k);
  cache.set(ck, { value, at: Date.now() });
  return value;
}

const DEFAULT_PROFILE: NotificationProfile = {
  mode: "push",
  smsCarrier: "console",
  ackTimeoutSec: 90,
  escalationTimeoutSec: 180,
};

export async function getNotificationProfile(
  orgId: number,
): Promise<NotificationProfile> {
  const raw = await getOrgSettingCached(orgId, "notification_profile");
  const parsed = notificationProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PROFILE;
}
