import webpush from "web-push";
import { storage } from "../storage.js";
import type { PushTransport } from "./notifications.js";

/**
 * Real push delivery — the "message reaches the doctor's pocket" transport.
 *
 * Two channels, chosen by each stored device token's platform:
 *   - "webpush": browser Web Push (the /m PWA + any subscribed browser).
 *     Token = JSON-serialized PushSubscription; signed with our VAPID keys.
 *   - "expo": the native Expo app; token = ExponentPushToken[...], relayed via
 *     Expo's push API.
 *
 * Payloads are CONTENT-FREE (a generic title only — never message text, names,
 * or patient data): Apple/Google/Expo don't sign BAAs for push content, so no
 * PHI may transit them. The app fetches the real content over TLS on open.
 *
 * Dead subscriptions (404/410 from the push service) are pruned so the token
 * store doesn't accumulate corpses.
 */

export interface PushSenders {
  webPushSend?: (
    subscription: webpush.PushSubscription,
    payload: string,
  ) => Promise<unknown>;
  expoSend?: (messages: Array<{ to: string; title: string }>) => Promise<unknown>;
}

let vapidPublicKey: string | null = null;

/**
 * Configure VAPID once at boot. Keys come from env when provided; otherwise a
 * pair is generated and persisted in the platform org's settings so existing
 * browser subscriptions stay valid across restarts.
 */
export async function initWebPush(): Promise<string | null> {
  try {
    let pub = process.env.VAPID_PUBLIC_KEY ?? null;
    let priv = process.env.VAPID_PRIVATE_KEY ?? null;
    if (!pub || !priv) {
      const platform = await storage().getOrganizationByCode("DOCTURN");
      if (!platform) return null;
      const saved = (await storage().getOrgSetting(platform.id, "vapidKeys")) as
        | { publicKey?: string; privateKey?: string }
        | null;
      if (saved?.publicKey && saved?.privateKey) {
        pub = saved.publicKey;
        priv = saved.privateKey;
      } else {
        const keys = webpush.generateVAPIDKeys();
        pub = keys.publicKey;
        priv = keys.privateKey;
        // updatedBy null = system (boot-time, no user in scope).
        await storage().setOrgSetting(platform.id, "vapidKeys", keys, null);
      }
    }
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:ops@docturn.example",
      pub,
      priv,
    );
    vapidPublicKey = pub;
    return pub;
  } catch (err) {
    console.error("[push] web-push init failed (web push disabled)", err);
    return null;
  }
}

export function getVapidPublicKey(): string | null {
  return vapidPublicKey;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export class LivePushTransport implements PushTransport {
  private readonly webPushSend: NonNullable<PushSenders["webPushSend"]>;
  private readonly expoSend: NonNullable<PushSenders["expoSend"]>;

  constructor(senders: PushSenders = {}) {
    this.webPushSend =
      senders.webPushSend ??
      ((sub, payload) => webpush.sendNotification(sub, payload));
    this.expoSend =
      senders.expoSend ??
      (async (msgs) =>
        fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            msgs.map((m) => ({ to: m.to, title: m.title, sound: "default" })),
          ),
        }));
  }

  async send(userId: number, payload: { title: string }): Promise<void> {
    const tokens = await storage().listDeviceTokens(userId);
    const expoBatch: Array<{ to: string; title: string }> = [];
    for (const t of tokens) {
      if (t.platform === "webpush") {
        try {
          const sub = JSON.parse(t.token) as webpush.PushSubscription;
          await this.webPushSend(sub, JSON.stringify({ title: payload.title }));
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Subscription expired/revoked — prune it.
            await storage().deleteDeviceToken(userId, t.token).catch(() => {});
          }
          // Everything else: swallow + continue (graceful degradation).
        }
      } else if (t.platform === "expo") {
        expoBatch.push({ to: t.token, title: payload.title });
      }
      // Unknown platforms (raw FCM/APNs) are future transports.
    }
    if (expoBatch.length) {
      try {
        await this.expoSend(expoBatch);
      } catch {
        /* graceful degradation */
      }
    }
  }
}
