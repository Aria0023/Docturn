import {
  notificationProfileSchema,
  type NotificationProfile,
} from "@shared/schema";
import { storage } from "./storage.js";

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
