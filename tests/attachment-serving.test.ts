import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Response as SupertestResponse } from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { contentDispositionInline, parseByteRange } from "../server/routes/messaging.js";

/**
 * A.CON-SHO-18: a file name outside Latin-1 (CJK / Cyrillic / emoji) or with
 * CR/LF used to make Node reject the hand-built Content-Disposition header
 * (ERR_INVALID_CHAR) AFTER the audit row was written — the request then hung.
 * A.CON-SHO-27: both byte-serving routes ignored HTTP Range, so <audio>
 * scrubbing never worked and iOS Safari's `bytes=0-1` media probe got a 200.
 */

// 64 distinguishable bytes so range slices can be checked byte-for-byte.
const BYTES = Buffer.from(Array.from({ length: 64 }, (_, i) => i));

/** supertest buffers the raw body regardless of content-type. */
function raw(req: import("supertest").Test) {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  }) as unknown as Promise<SupertestResponse & { body: Buffer }>;
}

describe("Content-Disposition for non-Latin-1 file names (unit)", () => {
  it("emits an ASCII fallback plus RFC 5987 filename* and never a control character", () => {
    const cjk = contentDispositionInline("胸部X光.png");
    expect(cjk).toMatch(/^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(cjk).toContain("filename*=UTF-8''%E8%83%B8%E9%83%A8X%E5%85%89.png");
    expect(cjk).toMatch(/^[\x20-\x7e]+$/); // header-safe end to end

    const emoji = contentDispositionInline("scan 🩻 (final).png");
    expect(emoji).toMatch(/^[\x20-\x7e]+$/);
    expect(emoji).toContain("%F0%9F%A9%BB"); // the emoji, percent-encoded as UTF-8
    expect(emoji).toContain("%28final%29"); // '(' and ')' are not attr-chars

    const crlf = contentDispositionInline("evil\r\nX-Injected: 1.png");
    expect(crlf).not.toMatch(/[\r\n]/);
    expect(crlf).toBe('inline; filename="evilX-Injected: 1.png"');

    // Plain ASCII keeps the simple form.
    expect(contentDispositionInline("report-final.pdf")).toBe('inline; filename="report-final.pdf"');
    // Quotes/backslashes are neutralised in the fallback and kept (encoded) in filename*.
    expect(contentDispositionInline('report "final".pdf')).toBe(
      "inline; filename=\"report _final_.pdf\"; filename*=UTF-8''report%20%22final%22.pdf",
    );
    expect(contentDispositionInline("\u0001\u0002")).toBe('inline; filename="attachment"');
  });

  it("parses single byte ranges per RFC 7233", () => {
    expect(parseByteRange(undefined, 64)).toBeNull();
    expect(parseByteRange("bytes=0-9", 64)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=10-", 64)).toEqual({ start: 10, end: 63 });
    expect(parseByteRange("bytes=-4", 64)).toEqual({ start: 60, end: 63 });
    expect(parseByteRange("bytes=0-1000", 64)).toEqual({ start: 0, end: 63 }); // clamped
    expect(parseByteRange("bytes=64-", 64)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 64)).toBe("unsatisfiable");
    // Syntactically invalid / unsupported → ignore the header (full 200 body).
    expect(parseByteRange("bytes=9-5", 64)).toBeNull();
    expect(parseByteRange("bytes=0-9,20-29", 64)).toBeNull();
    expect(parseByteRange("items=0-9", 64)).toBeNull();
    expect(parseByteRange("bytes=abc", 64)).toBeNull();
  });
});

describe("attachment byte serving (both routes)", () => {
  let ctx: TestContext;
  const saved = { store: process.env.ATTACHMENT_STORE, dir: process.env.ATTACHMENT_DIR, key: process.env.ATTACHMENT_KEY };
  beforeEach(async () => {
    // The encrypted store, so the test covers the production configuration.
    process.env.ATTACHMENT_STORE = "fs-encrypted";
    process.env.ATTACHMENT_DIR = mkdtempSync(join(tmpdir(), "docturn-range-"));
    process.env.ATTACHMENT_KEY = "b".repeat(64);
    ctx = await createTestApp();
  });
  afterEach(() => {
    for (const [k, v] of [["ATTACHMENT_STORE", saved.store], ["ATTACHMENT_DIR", saved.dir], ["ATTACHMENT_KEY", saved.key]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  /** Upload a voice clip with the given name and send + forward it. Returns both URLs. */
  async function setup(fileName: string) {
    const chenId = ctx.seedResult.userIds.chen!;
    const patelId = ctx.seedResult.userIds.patel!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const up = await er.post("/api/messaging/attachments").send({
      fileName,
      mimeType: "audio/webm",
      dataBase64: BYTES.toString("base64"),
      durationMs: 1200,
    });
    expect(up.status).toBe(201);
    const attId = up.body.id as number;
    const convo = await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] });
    const sent = await er.post("/api/messaging/send").send({ conversationId: convo.body.id, content: "", attachmentIds: [attId] });
    expect(sent.status).toBe(201);
    const fwd = await er.post(`/api/messaging/messages/${sent.body.id}/forward`).send({ participantIds: [patelId] });
    expect(fwd.status).toBe(201);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    return {
      direct: { agent: chen, url: `/api/messaging/attachments/${attId}` },
      forwarded: { agent: patel, url: `/api/messaging/messages/${fwd.body.id}/attachments/${attId}` },
    };
  }

  it("serves a CJK-named attachment with a header-safe Content-Disposition on both routes (used to hang)", async () => {
    const routes = await setup("胸部X光 録音.webm");
    for (const r of [routes.direct, routes.forwarded]) {
      const res = await raw(r.agent.get(r.url));
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("audio/webm");
      expect(res.headers["content-disposition"]).toMatch(/^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''%E8%83%B8/);
      expect(res.headers["accept-ranges"]).toBe("bytes");
      expect(res.headers["content-length"]).toBe(String(BYTES.length));
      expect(Buffer.compare(res.body, BYTES)).toBe(0);
    }
  });

  it("answers Range requests with 206 + Content-Range on both routes, and 416 past the end", async () => {
    const routes = await setup("voice.webm");
    for (const r of [routes.direct, routes.forwarded]) {
      // iOS Safari's media probe.
      const probe = await raw(r.agent.get(r.url).set("Range", "bytes=0-1"));
      expect(probe.status).toBe(206);
      expect(probe.headers["content-range"]).toBe(`bytes 0-1/${BYTES.length}`);
      expect(probe.headers["content-length"]).toBe("2");
      expect(probe.headers["accept-ranges"]).toBe("bytes");
      expect(Buffer.compare(probe.body, BYTES.subarray(0, 2))).toBe(0);

      // A scrub into the middle, open-ended.
      const seek = await raw(r.agent.get(r.url).set("Range", "bytes=40-"));
      expect(seek.status).toBe(206);
      expect(seek.headers["content-range"]).toBe(`bytes 40-63/${BYTES.length}`);
      expect(Buffer.compare(seek.body, BYTES.subarray(40))).toBe(0);

      // Suffix range (last 4 bytes) and a clamped end.
      const tail = await raw(r.agent.get(r.url).set("Range", "bytes=-4"));
      expect(tail.status).toBe(206);
      expect(tail.headers["content-range"]).toBe(`bytes 60-63/${BYTES.length}`);
      expect(Buffer.compare(tail.body, BYTES.subarray(60))).toBe(0);
      const clamped = await raw(r.agent.get(r.url).set("Range", "bytes=60-9999"));
      expect(clamped.status).toBe(206);
      expect(clamped.headers["content-range"]).toBe(`bytes 60-63/${BYTES.length}`);

      // Unsatisfiable → 416 with the total, no body.
      const past = await raw(r.agent.get(r.url).set("Range", "bytes=64-"));
      expect(past.status).toBe(416);
      expect(past.headers["content-range"]).toBe(`bytes */${BYTES.length}`);
      expect(past.body.length).toBe(0);

      // Multi-range / malformed → full body with 200 (never a broken 206).
      const multi = await raw(r.agent.get(r.url).set("Range", "bytes=0-1,4-5"));
      expect(multi.status).toBe(200);
      expect(Buffer.compare(multi.body, BYTES)).toBe(0);
    }
  });

  it("still enforces participant access and audits the fetch on a ranged request", async () => {
    const routes = await setup("voice.webm");
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    expect((await lopez.get(routes.direct.url).set("Range", "bytes=0-1")).status).toBe(403);
    await raw(routes.direct.agent.get(routes.direct.url).set("Range", "bytes=0-1"));
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100);
    expect(audit.some((a) => a.action === "message.attachment_view")).toBe(true);
  });
});
