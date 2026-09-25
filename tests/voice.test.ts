import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules } from "../server/modules.js";

/**
 * Voice messages (#8) — audio rides the same encrypted-attachment path as any
 * file, but is separately switchable (messaging.voice) and carries a duration.
 * These tests pin: the module gate, the duration + size ceilings, that the
 * thread surfaces isAudio + durationMs, and that turning voice off never breaks
 * ordinary (non-audio) attachments.
 */

// Any small blob — the server gates on mime/size/duration, not audio content.
const CLIP_B64 = Buffer.from("fake-opus-bytes-for-a-voice-clip").toString("base64");
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const devLogin = (ctx: TestContext) =>
  login(ctx.app, { orgCode: "DOCTURN", username: "dev" });

describe("voice messages", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("uploads audio, stores duration, and surfaces isAudio + durationMs on the thread", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });

    const up = await er.post("/api/messaging/attachments").send({
      fileName: "voice-1.webm",
      mimeType: "audio/webm",
      dataBase64: CLIP_B64,
      durationMs: 4200,
    });
    expect(up.status).toBe(201);
    expect(up.body.isAudio).toBe(true);
    expect(up.body.durationMs).toBe(4200);
    const attId = up.body.id as number;

    const convo = await er
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [chenId] });
    expect(convo.status).toBe(201);

    const sent = await er.post("/api/messaging/send").send({
      conversationId: convo.body.id,
      content: "voice note attached",
      attachmentIds: [attId],
    });
    expect(sent.status).toBe(201);

    const msgs = await er.get(
      "/api/messaging/conversations/" + convo.body.id + "/messages",
    );
    expect(msgs.status).toBe(200);
    const withAtt = (msgs.body as Array<{ attachments?: Array<Record<string, unknown>> }>)
      .flatMap((m) => m.attachments || [])
      .find((att) => att.id === attId);
    expect(withAtt).toBeTruthy();
    expect(withAtt!.isAudio).toBe(true);
    expect(withAtt!.isImage).toBe(false);
    expect(withAtt!.durationMs).toBe(4200);

    // Bytes fetch is participant-scoped + served with the stored content type.
    const bytes = await er.get("/api/messaging/attachments/" + attId);
    expect(bytes.status).toBe(200);
    expect(bytes.headers["content-type"]).toContain("audio/webm");
  });

  it("rejects a clip longer than the duration ceiling (400 too_long)", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const res = await er.post("/api/messaging/attachments").send({
      fileName: "long.webm",
      mimeType: "audio/webm",
      dataBase64: CLIP_B64,
      durationMs: 10 * 60 * 1000, // 10 min > 3 min cap
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("too_long");
  });

  it("rejects audio over the voice byte ceiling (400 too_large) before decoding", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    // 8 MB of base64 decodes to ~6 MB: over the 5 MB voice ceiling but under the
    // 8 MB general cap, so it is rejected *as audio*. The size-gate fires on the
    // encoded length, so no multi-MB buffer is ever allocated.
    const big = "A".repeat(8 * 1024 * 1024);
    const res = await er.post("/api/messaging/attachments").send({
      fileName: "huge.webm",
      mimeType: "audio/webm",
      dataBase64: big,
      durationMs: 5000,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("too_large");
  });

  it("gates audio behind messaging.voice: off → 404, images still upload", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: dev } = await devLogin(ctx);
    await dev
      .patch(`/api/dev/modules/${orgId}`)
      .send({ id: "messaging.voice", enabled: false })
      .expect(200);
    invalidateModules(orgId);

    const { agent: er } = await login(ctx.app, { username: "er.doc" });

    const audio = await er.post("/api/messaging/attachments").send({
      fileName: "blocked.webm",
      mimeType: "audio/webm",
      dataBase64: CLIP_B64,
      durationMs: 3000,
    });
    expect(audio.status).toBe(404);
    expect(audio.body).toMatchObject({ error: "module_disabled", module: "messaging.voice" });

    // Turning voice off must not touch ordinary attachments.
    const img = await er.post("/api/messaging/attachments").send({
      fileName: "chart.png",
      mimeType: "image/png",
      dataBase64: PNG_1x1,
    });
    expect(img.status).toBe(201);
    expect(img.body.isAudio).toBe(false);
  });
});
