import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { EAS_PROJECT_ID } from "./config";

/**
 * Native push for the shell. The SERVER decides what is sent (content-free
 * titles — server/services/push.ts) and which Android channel it goes to
 * (server/services/push-channels.ts: stat / urgent / routine). This module
 * owns the OS side only: the channels, the permission, the Expo push token.
 * The token is handed to the web app, which registers it with the signed-in
 * account (webapp/api-bridge.js → POST /api/mobile/device-tokens).
 */

/** Android channels — ids must match server/services/push-channels.ts. */
export const CHANNELS: Array<{ id: string } & Notifications.NotificationChannelInput> = [
  {
    id: "stat",
    name: "STAT",
    description: "STAT secure messages and escalations — loud, bypasses Do Not Disturb.",
    importance: Notifications.AndroidImportance.MAX,
    bypassDnd: true,
    sound: "default",
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, // the title carries no patient data
    enableLights: true,
    lightColor: "#DC2626",
  },
  {
    id: "urgent",
    name: "Urgent",
    description: "Urgent messages, new assignments and consult requests.",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 150, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  },
  {
    id: "routine",
    name: "Routine",
    description: "New secure messages.",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  },
];

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  for (const { id, ...channel } of CHANNELS) {
    try { await Notifications.setNotificationChannelAsync(id, channel); } catch { /* best effort */ }
  }
}

/**
 * While the app is in FRONT the web app is live over its WebSocket and plays
 * its own per-priority alert tone, so the OS shows no banner and plays no
 * sound (the notification still lands in the shade's list); in the background
 * the OS presents it as the channel says.
 */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export type PushPermission = "granted" | "denied" | "undetermined";

function statusOf(s: { granted: boolean; canAskAgain: boolean; status: string }): PushPermission {
  if (s.granted) return "granted";
  return s.status === "undetermined" || (s.canAskAgain && s.status !== "denied") ? "undetermined" : "denied";
}

export async function getPermission(): Promise<PushPermission> {
  try { return statusOf(await Notifications.getPermissionsAsync()); } catch { return "denied"; }
}

export async function requestPermission(): Promise<PushPermission> {
  try {
    return statusOf(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
  } catch { return "denied"; }
}

/**
 * The Expo push token for this install, or null when there cannot be one: a
 * simulator, or a build without an EAS project id (run `eas init` and set
 * EAS_PROJECT_ID — README.md). Never throws.
 */
export async function getToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const projectId = EAS_PROJECT_ID ?? Constants.easConfig?.projectId ?? null;
  if (!projectId) return null;
  try { return (await Notifications.getExpoPushTokenAsync({ projectId })).data || null; } catch { return null; }
}

/** The title of a tapped notification (content-free by design — see links.ts pushTarget). */
export function responseTitle(r: Notifications.NotificationResponse | null | undefined): string | null {
  return r?.notification?.request?.content?.title ?? null;
}

export async function clearDelivered(): Promise<void> {
  try { await Notifications.dismissAllNotificationsAsync(); } catch { /* ignore */ }
  try { await Notifications.setBadgeCountAsync(0); } catch { /* ignore */ }
}
