import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { setStorage } from "../server/storage.js";
import { LivePushTransport } from "../server/services/push.js";
import { expoChannelFor, expoMessageFor } from "../server/services/push-channels.js";

/**
 * Android notification channels for the native shell (mobile-app/): Expo's
 * push service routes a message to the channel named in `channelId`, so a
 * "STAT" channel the shell defines is only real if the server names it. The
 * channel is derived from the push TITLE (the same idiom webapp/sw.js uses to
 * pick the notification's navigation) — titles are the server's own
 * content-free strings, never message text, so the channel leaks nothing more
 * than the title already does.
 */
describe("push channels for the native shell", () => {
  it("maps every server push title to stat / urgent / routine", () => {
    // The literal titles the server sends (routes/messaging.ts, services/escalation.ts,
    // services/notifications.ts, routes/board.ts).
    expect(expoChannelFor("STAT secure message")).toBe("stat");
    expect(expoChannelFor("STAT message awaiting your acknowledgement")).toBe("stat");
    expect(expoChannelFor("Escalated STAT message needs attention")).toBe("stat");
    expect(expoChannelFor("Urgent secure message")).toBe("urgent");
    expect(expoChannelFor("New consult request")).toBe("urgent");
    expect(expoChannelFor("New assignment")).toBe("urgent");
    expect(expoChannelFor("New secure message")).toBe("routine");
    expect(expoChannelFor("")).toBe("routine");
    // "stat" must be the word, not a substring ("statistics", "status").
    expect(expoChannelFor("Status report")).toBe("routine");
  });

  it("builds a content-free Expo message: title + channel + priority, nothing else", () => {
    expect(expoMessageFor("ExponentPushToken[a]", "STAT secure message")).toEqual({
      to: "ExponentPushToken[a]", title: "STAT secure message", channelId: "stat", priority: "high",
    });
    expect(expoMessageFor("ExponentPushToken[b]", "Urgent secure message")).toEqual({
      to: "ExponentPushToken[b]", title: "Urgent secure message", channelId: "urgent", priority: "high",
    });
    expect(expoMessageFor("ExponentPushToken[c]", "New secure message")).toEqual({
      to: "ExponentPushToken[c]", title: "New secure message", channelId: "routine", priority: "default",
    });
  });

  describe("through the live transport", () => {
    let ctx: TestContext;
    beforeEach(async () => {
      ctx = await createTestApp();
      setStorage(ctx.storage);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("the batch handed to Expo carries the channel per token, and the default sender posts it", async () => {
      const chenId = ctx.seedResult.userIds.chen!;
      const { agent: chen } = await login(ctx.app, { username: "chen" });
      await chen.post("/api/mobile/device-tokens").send({ token: "ExponentPushToken[abc]", platform: "expo" }).expect(201);

      const got: unknown[] = [];
      const custom = new LivePushTransport({ expoSend: async (msgs) => { got.push(...msgs); } });
      await custom.send(chenId, { title: "STAT secure message" });
      expect(got).toEqual([{ to: "ExponentPushToken[abc]", title: "STAT secure message", channelId: "stat", priority: "high" }]);

      const posted: Array<{ url: string; body: unknown }> = [];
      vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
        posted.push({ url, body: JSON.parse(init.body) });
        return new Response("{}", { status: 200 });
      });
      await new LivePushTransport().send(chenId, { title: "New secure message" });
      expect(posted).toHaveLength(1);
      expect(posted[0]!.url).toMatch(/exp\.host|expo\.dev/);
      expect(posted[0]!.body).toEqual([
        { to: "ExponentPushToken[abc]", title: "New secure message", channelId: "routine", priority: "default", sound: "default" },
      ]);
      // Still content-free: no body, no data, no patient anything.
      const keys = Object.keys((posted[0]!.body as Array<Record<string, unknown>>)[0]!).sort();
      expect(keys).toEqual(["channelId", "priority", "sound", "title", "to"]);
    });
  });
});
