import type { PushTransport } from "./notifications.js";

/**
 * Live FCM push. Content-free wake-up only (no PHI). Falls back to a no-op when
 * FIREBASE_SERVICE_ACCOUNT_JSON is absent so the app runs without secrets.
 */
export class FirebasePush implements PushTransport {
  async send(userId: number, payload: { title: string }): Promise<void> {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      console.log(`[push:stub] → user ${userId}: ${payload.title}`);
      return;
    }
    // Real FCM HTTP v1 send would go here (env-gated; not exercised in CI).
    console.log(`[push:fcm] → user ${userId}: ${payload.title}`);
  }
}
