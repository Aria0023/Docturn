/**
 * Android notification channels for the native shell (mobile-app/).
 *
 * Expo's push service delivers a message to the Android channel named in
 * `channelId`; the shell defines three (stat / urgent / routine — see
 * mobile-app/src/shell/push.ts) so a STAT wake-up can be loud and bypass
 * silent mode while a routine message stays quiet. The channel is derived from
 * the push TITLE — the server's own content-free string ("STAT secure message",
 * "New assignment", …), never message text or patient data — the same idiom
 * webapp/sw.js uses to pick where a tapped notification navigates. iOS ignores
 * `channelId`; `priority: "high"` asks both platforms to wake the device.
 */
export type ExpoChannel = "stat" | "urgent" | "routine";

export interface ExpoPushMessage {
  to: string;
  title: string;
  channelId: ExpoChannel;
  priority: "high" | "default";
}

export function expoChannelFor(title: string): ExpoChannel {
  const t = String(title || "");
  if (/\bSTAT\b/.test(t)) return "stat";
  if (/\burgent\b|\bconsult\b|\bassignment\b/i.test(t)) return "urgent";
  return "routine";
}

/** The Expo message for one device token: title, channel and priority — nothing else. */
export function expoMessageFor(to: string, title: string): ExpoPushMessage {
  const channelId = expoChannelFor(title);
  return { to, title, channelId, priority: channelId === "routine" ? "default" : "high" };
}
