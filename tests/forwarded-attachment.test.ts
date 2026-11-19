import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * LB-7: attachments carried along by a FORWARDED message must be served from
 * the attachment store resolved from the row's ref — exactly like the primary
 * route. Under ATTACHMENT_STORE=fs-encrypted the column holds "fsenc:<id>",
 * which the old code base64-decoded into 27 bytes of garbage with HTTP 200.
 */

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("forwarded attachments under the encrypted store", () => {
  let ctx: TestContext;
  const saved = { store: process.env.ATTACHMENT_STORE, dir: process.env.ATTACHMENT_DIR, key: process.env.ATTACHMENT_KEY };
  beforeEach(async () => {
    process.env.ATTACHMENT_STORE = "fs-encrypted";
    process.env.ATTACHMENT_DIR = mkdtempSync(join(tmpdir(), "docturn-att-"));
    process.env.ATTACHMENT_KEY = "a".repeat(64);
    ctx = await createTestApp();
  });
  afterEach(() => {
    for (const [k, v] of [["ATTACHMENT_STORE", saved.store], ["ATTACHMENT_DIR", saved.dir], ["ATTACHMENT_KEY", saved.key]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("serves the ORIGINAL bytes through both the primary and the forwarded route", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });

    const up = await er.post("/api/messaging/attachments").send({ fileName: "xray.png", mimeType: "image/png", dataBase64: PNG_1x1.toString("base64") });
    expect(up.status).toBe(201);
    const attId = up.body.id as number;

    const convo = await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] });
    expect(convo.status).toBe(201);
    const sent = await er.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "see film", attachmentIds: [attId] });
    expect(sent.status).toBe(201);

    // Primary route: store-resolved bytes (this already worked).
    const direct = await er.get("/api/messaging/attachments/" + attId).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks))); });
    expect(direct.status).toBe(200);
    expect(Buffer.compare(direct.body as Buffer, PNG_1x1)).toBe(0);

    // Forward to a different person; the attachment travels by reference.
    const fwd = await er.post(`/api/messaging/messages/${sent.body.id}/forward`).send({ participantIds: [patelId] });
    expect(fwd.status).toBe(201);
    const fwdMsgId = fwd.body.id as number;

    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const viaForward = await patel
      .get(`/api/messaging/messages/${fwdMsgId}/attachments/${attId}`)
      .buffer(true)
      .parse((res, cb) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks))); });
    expect(viaForward.status).toBe(200);
    expect(viaForward.headers["content-type"]).toContain("image/png");
    expect((viaForward.body as Buffer).length).toBe(PNG_1x1.length);
    expect(Buffer.compare(viaForward.body as Buffer, PNG_1x1)).toBe(0);
    // And never the raw store ref.
    expect((viaForward.body as Buffer).toString("utf8").startsWith("fsenc:")).toBe(false);

    // Still participant-scoped: the original sender's colleague who is in
    // neither thread gets nothing.
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    expect((await lopez.get(`/api/messaging/messages/${fwdMsgId}/attachments/${attId}`)).status).toBeGreaterThanOrEqual(403);
  });
});
