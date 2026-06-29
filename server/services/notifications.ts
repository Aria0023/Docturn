import { deviceStore, smsStore } from '../storage.js';
import { sendToUsers } from '../ws.js';

/**
 * Stubbed notification cascade. PHI-free by contract: callers must pass
 * already-redacted titles/bodies (initials only, no names/diagnoses).
 *
 * Cascade order: WebSocket -> push (stub) -> SMS (stub).
 */
export const notifications = {
  async cascade(opts: {
    orgId: number;
    userIds: number[];
    event: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }) {
    const { userIds, event, title, body, data } = opts;

    // 1. WebSocket (realtime, in-app)
    const delivered = sendToUsers(userIds, { type: event, title, body, data });

    // 2. Push stub — recorded but not actually sent.
    for (const userId of userIds) {
      const tokens = await deviceStore.listByUser(userId);
      if (tokens.length > 0) {
        await deviceStore.recordPush(userId, title, body, data ? JSON.stringify(data) : undefined);
      }
    }

    // 3. SMS stub — recorded only when the WS path did not reach the user.
    for (const userId of userIds) {
      if (!delivered.includes(userId)) {
        await smsStore.record({
          orgId: opts.orgId,
          userId,
          toPhone: 'stub',
          body: `${title}: ${body}`,
          status: 'stubbed',
        });
      }
    }

    return { wsDelivered: delivered };
  },
};
