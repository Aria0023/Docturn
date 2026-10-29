import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import speakeasy from "speakeasy";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules, setModule } from "../server/modules.js";
import {
  attachmentStoreConfig,
  FS_REF_PREFIX,
  getAttachmentStore,
  parseAttachmentKey,
} from "../server/services/attachment-store.js";

/**
 * Security batch:
 *   1. Privileged-role MFA enrolment gate (module security.mfaRequired).
 *   2. Director-level analytics (/api/metrics/comms).
 *   3. Attachment store abstraction: fs-encrypted round-trip, db unchanged.
 */

const MFA_MODULE = "security.mfaRequired";
// A valid 1x1 transparent PNG; starts with the PNG magic 89 50 4E 47.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  invalidateModules();
  await ctx.handle.close();
});

async function enrolTotp(agent: import("supertest").Agent) {
  const enroll = await agent.post("/api/mfa/enroll");
  expect(enroll.status).toBe(200);
  const secret = enroll.body.secret as string;
  const code = speakeasy.totp({ secret, encoding: "base32" });
  const verify = await agent.post("/api/mfa/verify").send({ code });
  expect(verify.status).toBe(200);
  expect(verify.body.activated).toBe(true);
  return secret;
}

describe("MFA enrolment gate for privileged roles", () => {
  it("module ON: a director without MFA is held at enrolment, then released once enrolled", async () => {
    await setModule(ctx.seedResult.orgId, MFA_MODULE, true);

    const { agent, res } = await login(ctx.app, { username: "director" });
    // Login itself succeeds — the session is only flagged.
    expect(res.status).toBe(200);
    expect(res.body.mfaEnrollmentRequired).toBe(true);

    // Everything else is blocked with the dedicated error code.
    const blocked = await agent.get("/api/hospitalists");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("mfa_enrollment_required");
    const blockedPost = await agent.post("/api/messaging/conversations").send({ type: "direct", participantIds: [] });
    expect(blockedPost.status).toBe(403);
    expect(blockedPost.body.error).toBe("mfa_enrollment_required");

    // The exemptions still answer: /api/user carries the flag, /api/mfa/* and
    // /api/config work, and /api/modules (if mounted) is never gated.
    const me = await agent.get("/api/user");
    expect(me.status).toBe(200);
    expect(me.body.mfaEnrollmentRequired).toBe(true);
    expect(me.body.username).toBe("director");
    const cfg = await agent.get("/api/config");
    expect(cfg.status).toBe(200);
    const mods = await agent.get("/api/modules");
    expect([200, 404]).toContain(mods.status);
    if (mods.status === 404) expect(mods.body.error).not.toBe("mfa_enrollment_required");
    else expect(mods.body.error).toBeUndefined();

    // Enrolment via the EXISTING TOTP flow lifts the block immediately — the
    // gate re-reads the user row, it does not trust the session flag.
    const secret = await enrolTotp(agent);
    const after = await agent.get("/api/hospitalists");
    expect(after.status).toBe(200);
    const meAfter = await agent.get("/api/user");
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.mfaEnrollmentRequired).toBeUndefined();

    // The verify-on-login flow for an enrolled user keeps working: 202, then
    // the second factor completes the login with full access.
    const agent2 = supertest.agent(ctx.app);
    const second = await agent2
      .post("/api/login")
      .send({ orgCode: "ISPN", username: "director", password: "docturn" });
    expect(second.status).toBe(202);
    expect(second.body.twoFactorRequired).toBe(true);
    const code = speakeasy.totp({ secret, encoding: "base32" });
    const complete = await agent2.post("/api/2fa/complete-login").send({ code });
    expect(complete.status).toBe(200);
    const full = await agent2.get("/api/hospitalists");
    expect(full.status).toBe(200);
  });

  it("module ON: logout is allowed while flagged", async () => {
    await setModule(ctx.seedResult.orgId, MFA_MODULE, true);
    const { agent } = await login(ctx.app, { username: "director" });
    const out = await agent.post("/api/logout");
    expect(out.status).toBe(204);
    const me = await agent.get("/api/user");
    expect(me.status).toBe(401);
  });

  it("module ON: a hospitalist is unaffected", async () => {
    await setModule(ctx.seedResult.orgId, MFA_MODULE, true);
    const { agent, res } = await login(ctx.app, { username: "chen" });
    expect(res.status).toBe(200);
    expect(res.body.mfaEnrollmentRequired).toBeUndefined();
    const ok = await agent.get("/api/hospitalists");
    expect(ok.status).toBe(200);
    const me = await agent.get("/api/user");
    expect(me.body.mfaEnrollmentRequired).toBeUndefined();
  });

  it("module ON for the platform org: the developer is gated too", async () => {
    const platform = await ctx.storage.getOrganizationByCode("DOCTURN");
    expect(platform).toBeTruthy();
    await setModule(platform!.id, MFA_MODULE, true);
    const { agent, res } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    expect(res.status).toBe(200);
    expect(res.body.mfaEnrollmentRequired).toBe(true);
    const blocked = await agent.get("/api/dev/organizations");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("mfa_enrollment_required");
    // ISPN's own switch is off, so its director is untouched.
    const { agent: director } = await login(ctx.app, { username: "director" });
    expect((await director.get("/api/hospitalists")).status).toBe(200);
  });

  it("module OFF (default): no enforcement for an un-enrolled director", async () => {
    const { agent, res } = await login(ctx.app, { username: "director" });
    expect(res.status).toBe(200);
    expect(res.body.mfaEnrollmentRequired).toBeUndefined();
    const ok = await agent.get("/api/hospitalists");
    expect(ok.status).toBe(200);
    const me = await agent.get("/api/user");
    expect(me.body.mfaEnrollmentRequired).toBeUndefined();
  });

  it("flipping the module mid-session takes effect without a re-login (DB re-check)", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    expect((await agent.get("/api/hospitalists")).status).toBe(200);
    await setModule(ctx.seedResult.orgId, MFA_MODULE, true);
    const blocked = await agent.get("/api/hospitalists");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("mfa_enrollment_required");
    await setModule(ctx.seedResult.orgId, MFA_MODULE, false);
    expect((await agent.get("/api/hospitalists")).status).toBe(200);
  });

  it("the compliance monitor reports whether enforcement is on", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const off = await agent.get("/api/compliance/status");
    expect(off.status).toBe(200);
    const findMfa = (body: unknown) => {
      const rows = (Array.isArray(body) ? body : (body as { controls?: unknown[] }).controls ?? []) as Array<{ id: string; detail: string; evidence?: Record<string, unknown> }>;
      return rows.find((r) => r.id === "mfa-enrollment");
    };
    const rowOff = findMfa(off.body);
    expect(rowOff).toBeTruthy();
    expect(rowOff!.detail).toContain("Enforcement is OFF");

    await setModule(ctx.seedResult.orgId, MFA_MODULE, true);
    // The director is now gated, so an enrolled director reads the monitor.
    await enrolTotp(agent);
    const on = await agent.get("/api/compliance/status");
    expect(on.status).toBe(200);
    const rowOn = findMfa(on.body);
    expect(rowOn!.detail).toContain("Enforcement is ON");
  });
});

describe("analytics gating", () => {
  it("/api/metrics/comms is 403 for a hospitalist and an ER physician, 200 for director roles", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const denied = await chen.get("/api/metrics/comms");
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("forbidden");

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    expect((await er.get("/api/metrics/comms")).status).toBe(403);

    const { agent: director } = await login(ctx.app, { username: "director" });
    const ok = await director.get("/api/metrics/comms");
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty("messages7d");

    const { agent: erDirector } = await login(ctx.app, { username: "er.director" });
    expect((await erDirector.get("/api/metrics/comms")).status).toBe(200);

    const { agent: dev } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    expect((await dev.get("/api/metrics/comms")).status).toBe(200);
  });
});

describe("attachment store", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let dir: string;
  const KEY_HEX = "a".repeat(32) + "b".repeat(32); // 64 hex chars = 32 bytes

  beforeEach(async () => {
    for (const k of ["ATTACHMENT_STORE", "ATTACHMENT_DIR", "ATTACHMENT_KEY"]) {
      savedEnv[k] = process.env[k];
    }
    dir = await mkdtemp(join(tmpdir(), "docturn-att-"));
  });
  afterEach(async () => {
    for (const k of ["ATTACHMENT_STORE", "ATTACHMENT_DIR", "ATTACHMENT_KEY"]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("parses the key as 64 hex chars or base64 of 32 bytes, rejects anything else", () => {
    expect(parseAttachmentKey(KEY_HEX)?.length).toBe(32);
    expect(parseAttachmentKey(Buffer.alloc(32, 7).toString("base64"))?.length).toBe(32);
    expect(parseAttachmentKey("deadbeef")).toBeNull();
    expect(parseAttachmentKey(Buffer.alloc(16, 7).toString("base64"))).toBeNull();
    expect(parseAttachmentKey("")).toBeNull();
    expect(parseAttachmentKey(undefined)).toBeNull();
  });

  it("fs-encrypted: round-trips bytes and never writes plaintext to disk", async () => {
    process.env.ATTACHMENT_STORE = "fs-encrypted";
    process.env.ATTACHMENT_DIR = dir;
    process.env.ATTACHMENT_KEY = KEY_HEX;
    expect(attachmentStoreConfig()).toMatchObject({ mode: "fs-encrypted", ready: true, keyValid: true });

    const png = Buffer.from(PNG_1x1, "base64");
    expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);

    // Store-level round trip.
    const store = getAttachmentStore();
    expect(store.kind).toBe("fs-encrypted");
    const ref = await store.put(png, { organizationId: 1, fileName: "x.png", mimeType: "image/png", byteSize: png.length });
    expect(ref.startsWith(FS_REF_PREFIX)).toBe(true);
    expect((await store.get(ref)).equals(png)).toBe(true);

    // Two puts of the same bytes produce different ciphertext (random IV).
    const ref2 = await store.put(png, { organizationId: 1, fileName: "x.png", mimeType: "image/png", byteSize: png.length });
    const files = await readdir(dir);
    expect(files).toHaveLength(2);
    const blobs = await Promise.all(files.map((f) => readFile(join(dir, f))));
    for (const blob of blobs) {
      expect(blob.includes(PNG_MAGIC)).toBe(false);
      expect(blob.includes(png)).toBe(false);
    }
    expect(blobs[0]!.equals(blobs[1]!)).toBe(false);
    expect(ref2).not.toBe(ref);

    // A wrong key fails authentication instead of returning garbage.
    process.env.ATTACHMENT_KEY = "c".repeat(64);
    await expect(getAttachmentStore().get(ref)).rejects.toMatchObject({ code: "attachment_corrupt" });
    process.env.ATTACHMENT_KEY = KEY_HEX;

    // delete removes the file; a second delete is a no-op.
    await store.delete(ref);
    await store.delete(ref);
    expect(await readdir(dir)).toHaveLength(1);
    await expect(store.get(ref)).rejects.toMatchObject({ code: "attachment_not_found" });
  });

  it("fs-encrypted through the API: upload → row holds an fsenc ref → fetch returns the bytes", async () => {
    process.env.ATTACHMENT_STORE = "fs-encrypted";
    process.env.ATTACHMENT_DIR = dir;
    process.env.ATTACHMENT_KEY = KEY_HEX;

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const up = await er.post("/api/messaging/attachments").send({ fileName: "xray.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    expect(up.status).toBe(201);
    const row = await ctx.storage.getAttachment(ctx.seedResult.orgId, up.body.id);
    expect(row!.dataBase64.startsWith(FS_REF_PREFIX)).toBe(true);
    expect(row!.byteSize).toBe(Buffer.from(PNG_1x1, "base64").length);

    const onDisk = await readdir(dir);
    expect(onDisk).toHaveLength(1);
    const blob = await readFile(join(dir, onDisk[0]!));
    expect(blob.includes(PNG_MAGIC)).toBe(false);

    const view = await er.get("/api/messaging/attachments/" + up.body.id);
    expect(view.status).toBe(200);
    expect(view.headers["content-type"]).toContain("image/png");
    expect(Buffer.from(view.body).equals(Buffer.from(PNG_1x1, "base64"))).toBe(true);

    // The compliance control passes only in this configuration.
    const { agent: director } = await login(ctx.app, { username: "director" });
    const status = await director.get("/api/compliance/status");
    const rows = (Array.isArray(status.body) ? status.body : status.body.controls ?? []) as Array<{ id: string; status: string }>;
    expect(rows.find((r) => r.id === "attachment-storage")!.status).toBe("pass");
  });

  it("fs-encrypted without a valid key refuses uploads (503) rather than storing plaintext", async () => {
    process.env.ATTACHMENT_STORE = "fs-encrypted";
    process.env.ATTACHMENT_DIR = dir;
    process.env.ATTACHMENT_KEY = "not-a-key";
    expect(attachmentStoreConfig().ready).toBe(false);
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const up = await er.post("/api/messaging/attachments").send({ fileName: "xray.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    expect(up.status).toBe(503);
    expect(up.body.error).toBe("attachment_store_unavailable");
    expect(await readdir(dir)).toHaveLength(0);
  });

  it("db store (default): row keeps inline base64 exactly as before and old rows still serve", async () => {
    delete process.env.ATTACHMENT_STORE;
    delete process.env.ATTACHMENT_KEY;
    expect(attachmentStoreConfig()).toMatchObject({ mode: "db", ready: true });

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const up = await er.post("/api/messaging/attachments").send({ fileName: "xray.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    expect(up.status).toBe(201);
    const row = await ctx.storage.getAttachment(ctx.seedResult.orgId, up.body.id);
    expect(row!.dataBase64).toBe(PNG_1x1);
    expect(await readdir(dir)).toHaveLength(0);

    const view = await er.get("/api/messaging/attachments/" + up.body.id);
    expect(view.status).toBe(200);
    expect(Buffer.from(view.body).equals(Buffer.from(PNG_1x1, "base64"))).toBe(true);

    // A legacy row written directly as base64 (pre-abstraction) is readable
    // even when the process has since switched to fs-encrypted.
    const legacy = await ctx.storage.createAttachment({
      organizationId: ctx.seedResult.orgId,
      uploaderId: ctx.seedResult.userIds["er.doc"]!,
      fileName: "legacy.png",
      mimeType: "image/png",
      byteSize: 70,
      dataBase64: PNG_1x1,
    });
    process.env.ATTACHMENT_STORE = "fs-encrypted";
    process.env.ATTACHMENT_DIR = dir;
    process.env.ATTACHMENT_KEY = KEY_HEX;
    const legacyView = await er.get("/api/messaging/attachments/" + legacy.id);
    expect(legacyView.status).toBe(200);
    expect(Buffer.from(legacyView.body).equals(Buffer.from(PNG_1x1, "base64"))).toBe(true);
  });
});
