import helmet from "helmet";
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

export const HELMET_OPTIONS = {
  contentSecurityPolicy: false as const, // SPA served separately; relax for dev.
};

/**
 * The exact helmet middleware the app mounts. The compliance monitor runs this
 * instance against a stub request/response to read back the response headers it
 * ACTUALLY sets (HSTS, X-Frame-Options, …) rather than assuming a default.
 */
export const securityHeaders = helmet(HELMET_OPTIONS);

/** Tiered request limits — stricter on auth, looser on general traffic. */
export const AUTH_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 50 };
export const GENERAL_RATE_LIMIT = { windowMs: 60 * 1000, max: 300 };

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
