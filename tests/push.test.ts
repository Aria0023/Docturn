import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { setStorage } from "../server/storage.js";
import { LivePushTransport, initWebPush, getVapidPublicKey } from "../server/services/push.js";

describe("push notifications", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
    setStorage(ctx.storage);
  });

  it("routes stored tokens to the right channel with content-free payloads", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const sub = { endpoint: "https://push.example/e1", keys: { p256dh: "k", auth: "a" } };
    await chen
      .post("/api/mobile/device-tokens")
      .send({ token: JSON.stringify(sub), platform: "webpush" })
      .expect(201);
    await chen
      .post("/api/mobile/device-tokens")
      .send({ token: "ExponentPushToken[abc]", platform: "expo" })
      .expect(201);

    const webSent: string[] = [];
    const expoSent: Array<{ to: string; title: string }> = [];
    const transport = new LivePushTransport({
      webPushSend: async (s, payload) => {
        webSent.push(payload);
        expect((s as { endpoint: string }).endpoint).toBe(sub.endpoint);
      },
      expoSend: async (msgs) => {
        expoSent.push(...msgs);
      },
    });
    await transport.send(chenId, { title: "New secure message" });

    expect(webSent).toHaveLength(1);
    expect(JSON.parse(webSent[0]!)).toEqual({ title: "New secure message" });
    expect(expoSent).toEqual([
      { to: "ExponentPushToken[abc]", title: "New secure message" },
    ]);
    // Content-free: the payload carries no message text / patient fields.
    expect(webSent[0]).not.toContain("content");
  });

  it("prunes web-push subscriptions the push service reports dead (410)", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const sub = { endpoint: "https://push.example/dead", keys: { p256dh: "k", auth: "a" } };
    await chen
      .post("/api/mobile/device-tokens")
      .send({ token: JSON.stringify(sub), platform: "webpush" })
      .expect(201);

    const gone = Object.assign(new Error("gone"), { statusCode: 410 });
    const transport = new LivePushTransport({
      webPushSend: async () => {
        throw gone;
      },
      expoSend: async () => {},
    });
    await transport.send(chenId, { title: "x" });
    expect(await ctx.storage.listDeviceTokens(chenId)).toHaveLength(0);
  });

  it("boot init generates + persists VAPID keys and serves the public key", async () => {
    const pub = await initWebPush();
    expect(pub).toBeTruthy();
    expect(getVapidPublicKey()).toBe(pub);
    // Persisted: a second init (fresh env) returns the SAME key.
    expect(await initWebPush()).toBe(pub);

    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const res = await chen.get("/api/push/vapid-key").expect(200);
    expect(res.body.key).toBe(pub);
  });

  it("sending a message pushes a content-free wake-up to recipients only", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const erId = ctx.seedResult.userIds["er.doc"]!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (
      await er
        .post("/api/messaging/conversations")
        .send({ type: "direct", participantIds: [chenId] })
    ).body;
    ctx.push.sent = [];
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "PHI-ish content", priority: "stat" })
      .expect(201);
    // Recipient got a wake-up; the sender did not; no message content leaked.
    const mine = ctx.push.sent.filter((p) => p.userId === chenId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.title).toBe("STAT secure message");
    expect(ctx.push.sent.some((p) => p.userId === erId)).toBe(false);
    expect(JSON.stringify(ctx.push.sent)).not.toContain("PHI-ish");
  });
});
