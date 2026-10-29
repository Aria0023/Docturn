import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules } from "../server/modules.js";
import type * as ThreadEvents from "../mobile-app/src/threadEvents.js";
import type { ThreadMessage } from "../mobile-app/src/threadEvents.js";

/**
 * Load the Expo app's real helper module. Vite cannot transform files under
 * mobile-app/ here (its tsconfig extends expo/tsconfig.base, which is only
 * installed inside mobile-app/), so the source is transpiled with the
 * TypeScript compiler directly and evaluated — the exact code the app ships.
 * The root `tsc` still type-checks it through the type-only imports above.
 */
function loadThreadEvents(): typeof ThreadEvents {
  const src = readFileSync(new URL("../mobile-app/src/threadEvents.ts", import.meta.url), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", out.outputText)(mod, mod.exports);
  return mod.exports as unknown as typeof ThreadEvents;
}
let applyRead: typeof ThreadEvents.applyRead;
let applyRecall: typeof ThreadEvents.applyRecall;
let canRecall: typeof ThreadEvents.canRecall;
let isReadFrame: typeof ThreadEvents.isReadFrame;
let isRecalledFrame: typeof ThreadEvents.isRecalledFrame;
let recallErrorText: typeof ThreadEvents.recallErrorText;
beforeAll(() => {
  ({ applyRead, applyRecall, canRecall, isReadFrame, isRecalledFrame, recallErrorText } = loadThreadEvents());
});

/**
 * A.CON-SHO-25 (Expo half): the Expo Messages screen applies the server's
 * MESSAGE_RECALLED / MESSAGE_READ frames to an OPEN thread through the pure
 * helpers in mobile-app/src/threadEvents.ts. These tests feed those helpers
 * the frames the real server emits and the messages the real GET returns, so
 * the native client and the server cannot drift apart silently.
 */
describe("Expo thread events against the real server frames", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
    invalidateModules();
  });

  const frames = (type: string) =>
    ctx.ws.delivered.filter((d) => (d.message as { type?: string }).type === type);

  async function setup() {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const convo = (await chen.post("/api/messaging/conversations").send({ type: "direct", participantIds: [patelId] })).body as { id: number; type: string };
    const other = (await chen.post("/api/messaging/conversations").send({ type: "group", name: "Other", participantIds: [patelId, ctx.seedResult.userIds.lopez!] })).body as { id: number };
    return { chenId, patelId, chen, patel, convo, other };
  }

  it("an open recipient thread drops a recalled message live; other threads are untouched", async () => {
    const { chen, patel, convo, patelId } = await setup();
    await chen.post("/api/messaging/send").send({ conversationId: convo.id, content: "keep" }).expect(201);
    const sent = (await chen.post("/api/messaging/send").send({ conversationId: convo.id, content: "wrong patient" }).expect(201)).body;

    // What the Expo thread holds (ApiClient.messages = the same GET).
    const open = (await patel.get(`/api/messaging/conversations/${convo.id}/messages`).expect(200)).body as ThreadMessage[];
    expect(open.some((m) => m.id === sent.id)).toBe(true);

    ctx.ws.delivered = [];
    await chen.delete(`/api/messaging/messages/${sent.id}`).expect(204);
    const f = frames("MESSAGE_RECALLED").find((d) => d.userIds.includes(patelId));
    expect(f).toBeTruthy();
    expect(isRecalledFrame(f!.message)).toBe(true);
    if (!isRecalledFrame(f!.message)) return;

    const after = applyRecall(open, convo.id, f!.message);
    expect(after.some((m) => m.id === sent.id)).toBe(false);
    expect(after).toHaveLength(open.length - 1);
    // Matches what a fresh load now returns.
    const reloaded = (await patel.get(`/api/messaging/conversations/${convo.id}/messages`).expect(200)).body as ThreadMessage[];
    expect(after.map((m) => m.id)).toEqual(reloaded.map((m) => m.id));

    // A thread that is not open (or no thread open) is left as-is (same array).
    expect(applyRecall(open, convo.id + 999, f!.message)).toBe(open);
    expect(applyRecall(open, null, f!.message)).toBe(open);
  });

  it("the Recall control shows only on my unread messages and disappears live when the recipient reads", async () => {
    const { chen, patel, convo, chenId } = await setup();
    const sent = (await chen.post("/api/messaging/send").send({ conversationId: convo.id, content: "hello" }).expect(201)).body;
    const mods = (await chen.get("/api/modules").expect(200)).body as { modules: Record<string, boolean> };
    const recallOn = mods.modules["messaging.recall"] === true;
    expect(recallOn).toBe(true);

    let mine = (await chen.get(`/api/messaging/conversations/${convo.id}/messages`).expect(200)).body as ThreadMessage[];
    const m0 = mine.find((m) => m.id === sent.id)!;
    expect(canRecall(m0, chenId, recallOn, convo.type)).toBe(true);
    // Never on someone else's message, never in a broadcast, never with the module off.
    expect(canRecall({ ...m0, senderId: chenId + 1 }, chenId, recallOn, convo.type)).toBe(false);
    expect(canRecall(m0, chenId, recallOn, "broadcast")).toBe(false);
    expect(canRecall(m0, chenId, false, convo.type)).toBe(false);

    ctx.ws.delivered = [];
    await patel.post("/api/messaging/messages/mark-read").send({ messageIds: [sent.id] }).expect(204);
    const f = frames("MESSAGE_READ").find((d) => d.userIds.includes(chenId));
    expect(f).toBeTruthy();
    expect(isReadFrame(f!.message)).toBe(true);
    if (!isReadFrame(f!.message)) return;
    mine = applyRead(mine, convo.id, chenId, f!.message);
    expect(mine.find((m) => m.id === sent.id)!.readCount).toBe(1);
    expect(canRecall(mine.find((m) => m.id === sent.id)!, chenId, recallOn, convo.type)).toBe(false);

    // And the server agrees: a read message cannot be recalled.
    const res = await chen.delete(`/api/messaging/messages/${sent.id}`);
    expect(res.status).toBe(409);
    expect(recallErrorText(res.body.error)).toMatch(/already been read/);
  });

  it("with messaging.recall off the control is hidden and the server refuses", async () => {
    const { chen, convo, chenId } = await setup();
    const sent = (await chen.post("/api/messaging/send").send({ conversationId: convo.id, content: "x" }).expect(201)).body;
    await ctx.storage.setOrgSetting(ctx.seedResult.orgId, "modules", { "messaging.recall": false }, null);
    invalidateModules();
    const mods = (await chen.get("/api/modules").expect(200)).body as { modules: Record<string, boolean> };
    expect(mods.modules["messaging.recall"]).toBe(false);
    const m = ((await chen.get(`/api/messaging/conversations/${convo.id}/messages`).expect(200)).body as ThreadMessage[]).find((x) => x.id === sent.id)!;
    expect(canRecall(m, chenId, mods.modules["messaging.recall"] === true, convo.type)).toBe(false);
    const res = await chen.delete(`/api/messaging/messages/${sent.id}`);
    expect(res.status).toBe(404);
    expect(recallErrorText(res.body.error)).toMatch(/switched off/);
  });
});
