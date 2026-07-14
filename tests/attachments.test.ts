import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Message attachments (synthetic-data pilot): upload → link at send → access-
 * controlled fetch. Verifies tenant/participant scoping, mime + size gates, and
 * that a fetch is audited (ids only, no PHI).
 */

// A valid 1x1 transparent PNG.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("message attachments", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  async function directConvo(
    agent: import("supertest").Agent,
    otherUserId: number,
  ) {
    const res = await agent
      .post("/api/messaging/conversations")
      .send({ type: "direct", participantIds: [otherUserId] });
    expect(res.status).toBe(201);
    return res.body as { id: number; participantIds: number[] };
  }

  it("uploads, links on send, exposes metadata, and gates fetch by participant", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });

    // 1) Upload returns an id.
    const up = await er.post("/api/messaging/attachments").send({
      fileName: "xray.png",
      mimeType: "image/png",
      dataBase64: PNG_1x1,
    });
    expect(up.status).toBe(201);
    expect(typeof up.body.id).toBe("number");
    const attId = up.body.id as number;

    // 2) Sending a message with the attachment links it.
    const convo = await directConvo(er, chenId);
    const sent = await er.post("/api/messaging/send").send({
      conversationId: convo.id,
      content: "See attached",
      attachmentIds: [attId],
    });
    expect(sent.status).toBe(201);
    const messageId = sent.body.id as number;

    // 3) GET messages includes attachment metadata with isImage true for a png,
    //    and never leaks the raw bytes.
    const msgs = await er.get(
      "/api/messaging/conversations/" + convo.id + "/messages",
    );
    expect(msgs.status).toBe(200);
    const m = (msgs.body as any[]).find((x) => x.id === messageId);
    expect(m).toBeTruthy();
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0].id).toBe(attId);
    expect(m.attachments[0].isImage).toBe(true);
    expect(m.attachments[0].fileName).toBe("xray.png");
    expect(m.attachments[0].dataBase64).toBeUndefined();

    // 4) A participant (chen) can fetch the bytes; content-type is set.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const view = await chen.get("/api/messaging/attachments/" + attId);
    expect(view.status).toBe(200);
    expect(view.headers["content-type"]).toContain("image/png");
    expect(view.body).toBeInstanceOf(Buffer);

    // 5) A non-participant (patel) is forbidden.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const denied = await patel.get("/api/messaging/attachments/" + attId);
    expect(denied.status).toBe(403);

    // 6) The successful fetch was audited (ids only).
    const audit = await ctx.storage.listAuditLogs(orgId, 100);
    expect(
      audit.some(
        (a) => a.action === "message.attachment_view" && a.resourceId === attId,
      ),
    ).toBe(true);
  });

  it("rejects oversize and disallowed mime uploads", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });

    // Disallowed mime → 400 bad_type.
    const badType = await er.post("/api/messaging/attachments").send({
      fileName: "evil.exe",
      mimeType: "application/x-msdownload",
      dataBase64: PNG_1x1,
    });
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("bad_type");

    // >8 MB decoded → 400 too_large. ~11.5 MB of base64 decodes to ~8.6 MB
    // (over the 8 MB cap) while the JSON body stays under the 12 MB parser limit.
    const big = "A".repeat(11 * 1024 * 1024);
    const tooBig = await er.post("/api/messaging/attachments").send({
      fileName: "huge.pdf",
      mimeType: "application/pdf",
      dataBase64: big,
    });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toBe("too_large");
  });

  it("rejects a message with neither text nor attachments", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = await directConvo(er, chenId);
    const empty = await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("empty_message");
  });

  it("allows an attachment-only message (empty text)", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const up = await er.post("/api/messaging/attachments").send({
      fileName: "scan.png",
      mimeType: "image/png",
      dataBase64: PNG_1x1,
    });
    const convo = await directConvo(er, chenId);
    const sent = await er.post("/api/messaging/send").send({
      conversationId: convo.id,
      content: "",
      attachmentIds: [up.body.id],
    });
    expect(sent.status).toBe(201);
  });

  it("does not link another user's attachment across senders", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });

    // Chen uploads an attachment.
    const up = await chen.post("/api/messaging/attachments").send({
      fileName: "chen.png",
      mimeType: "image/png",
      dataBase64: PNG_1x1,
    });
    const chenAttId = up.body.id as number;

    // ER tries to send a message claiming Chen's attachment id — it must NOT link.
    const convo = await directConvo(er, chenId);
    const sent = await er.post("/api/messaging/send").send({
      conversationId: convo.id,
      content: "not mine",
      attachmentIds: [chenAttId],
    });
    expect(sent.status).toBe(201);
    const msgs = await er.get(
      "/api/messaging/conversations/" + convo.id + "/messages",
    );
    const m = (msgs.body as any[]).find((x) => x.id === sent.body.id);
    expect(m.attachments).toHaveLength(0);
  });
});
