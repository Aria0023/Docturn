import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messageAttachments, messages, orgSettings } from "@shared/schema";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules } from "../server/modules.js";
import {
  readRetentionSetting,
  runMessageRetentionSweep,
  RETENTION_MAX_DAYS,
} from "../server/services/retention.js";

/**
 * A.CON-SHO-23: the retention purge must remove the encrypted attachment FILES
 * (not just the rows), sweep never-linked (orphan) uploads, and honour the
 * ops.retention module switch. A.CON-SHO-37: messageRetentionDays is validated
 * on write (integer 0..3650) and an invalid stored value is skipped + audited
 * rather than purging everything (0.5) or purging at one day (`true`).
 */

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("retention: files, orphans, module switch, setting validation", () => {
  let ctx: TestContext;
  let dir: string;
  const saved = { store: process.env.ATTACHMENT_STORE, dir: process.env.ATTACHMENT_DIR, key: process.env.ATTACHMENT_KEY };
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "docturn-ret-"));
    process.env.ATTACHMENT_STORE = "fs-encrypted";
    process.env.ATTACHMENT_DIR = dir;
    process.env.ATTACHMENT_KEY = "c".repeat(64);
    ctx = await createTestApp();
    invalidateModules();
  });
  afterEach(() => {
    for (const [k, v] of [["ATTACHMENT_STORE", saved.store], ["ATTACHMENT_DIR", saved.dir], ["ATTACHMENT_KEY", saved.key]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const files = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".bin")) : []);
  const fileOf = (ref: string) => join(dir, ref.replace(/^fsenc:/, "") + ".bin");

  async function uploadAndSend(agent: import("supertest").Agent, convoId: number, content: string) {
    const up = await agent.post("/api/messaging/attachments").send({ fileName: "x.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    expect(up.status).toBe(201);
    const sent = await agent.post("/api/messaging/send").send({ conversationId: convoId, content, attachmentIds: [up.body.id] });
    expect(sent.status).toBe(201);
    const [row] = await ctx.handle.db.select().from(messageAttachments).where(eq(messageAttachments.id, up.body.id));
    expect(row!.dataBase64.startsWith("fsenc:")).toBe(true);
    expect(existsSync(fileOf(row!.dataBase64))).toBe(true);
    return { messageId: sent.body.id as number, attachmentId: up.body.id as number, ref: row!.dataBase64 };
  }

  it("the retention purge removes the encrypted attachment file along with the rows, and audits the counts", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })).body;
    const old = await uploadAndSend(er, convo.id, "old film");
    const fresh = await uploadAndSend(er, convo.id, "new film");
    await ctx.handle.db.update(messages).set({ createdAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(messages.id, old.messageId));

    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 30 }).expect(200);
    expect(files()).toHaveLength(2);
    expect(await runMessageRetentionSweep()).toBe(1);

    // Old: row + FILE gone. Fresh: both still there.
    expect(existsSync(fileOf(old.ref))).toBe(false);
    expect(existsSync(fileOf(fresh.ref))).toBe(true);
    expect(await ctx.storage.getAttachment(orgId, old.attachmentId)).toBeUndefined();
    expect(await ctx.storage.getAttachment(orgId, fresh.attachmentId)).toBeTruthy();
    expect(files()).toHaveLength(1);

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((a) => a.action === "messages.retention_purged");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ count: 1, attachments: 1, fileDeleteFailures: 0, retentionDays: 30 });
  });

  it("sweeps never-linked uploads older than 24h (rows + files) and leaves recent ones alone", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const stale = await er.post("/api/messaging/attachments").send({ fileName: "never-sent.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    const recent = await er.post("/api/messaging/attachments").send({ fileName: "about-to-send.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    expect(stale.status).toBe(201);
    expect(recent.status).toBe(201);
    const [staleRow] = await ctx.handle.db.select().from(messageAttachments).where(eq(messageAttachments.id, stale.body.id));
    await ctx.handle.db.update(messageAttachments).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(messageAttachments.id, stale.body.id));
    expect(files()).toHaveLength(2);

    // No retention window at all — orphan cleanup still runs (an abandoned
    // upload is not a clinical record); nothing else is touched.
    expect(await runMessageRetentionSweep()).toBe(0);
    expect(await ctx.storage.getAttachment(orgId, stale.body.id)).toBeUndefined();
    expect(existsSync(fileOf(staleRow!.dataBase64))).toBe(false);
    expect(await ctx.storage.getAttachment(orgId, recent.body.id)).toBeTruthy();
    expect(files()).toHaveLength(1);
    // The recent one can still be linked and sent.
    const chenId = ctx.seedResult.userIds.chen!;
    const convo = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })).body;
    await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "", attachmentIds: [recent.body.id] }).expect(201);

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((a) => a.action === "attachments.orphans_purged");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ count: 1, fileDeleteFailures: 0 });
  });

  it("does not purge when ops.retention is off, and resumes when it is switched back on", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })).body;
    const old = (await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "ancient" })).body;
    await ctx.handle.db.update(messages).set({ createdAt: new Date(Date.now() - 400 * 86_400_000) }).where(eq(messages.id, old.id));
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 30 }).expect(200);

    await ctx.storage.setOrgSetting(orgId, "modules", { "ops.retention": false }, null);
    invalidateModules();
    expect(await runMessageRetentionSweep()).toBe(0);
    expect(await ctx.storage.getMessage(orgId, old.id)).toBeTruthy();
    expect((await ctx.storage.listAuditLogs(orgId, 50)).some((a) => a.action === "messages.retention_purged")).toBe(false);

    await ctx.storage.setOrgSetting(orgId, "modules", { "ops.retention": true }, null);
    invalidateModules();
    expect(await runMessageRetentionSweep()).toBe(1);
    expect(await ctx.storage.getMessage(orgId, old.id)).toBeUndefined();
  });

  it("PATCH /api/settings/org validates messageRetentionDays (integer 0..3650) and rejects unknown keys", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });
    for (const bad of [0.5, true, "30", -1, RETENTION_MAX_DAYS + 1, 1e12, null, [30], { days: 30 }]) {
      const res = await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: bad });
      expect(res.status, `value ${JSON.stringify(bad)}`).toBe(400);
      expect(res.body.error).toBe("validation_error");
    }
    expect(await ctx.storage.getOrgSetting(orgId, "messageRetentionDays")).toBeUndefined();
    for (const ok of [0, 1, 30, RETENTION_MAX_DAYS]) {
      await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: ok }).expect(200);
      expect((await director.get("/api/settings").expect(200)).body.org.messageRetentionDays).toBe(ok);
    }
    // Typed booleans for the two switches; anything else is a 400.
    await director.patch("/api/settings/org").send({ key: "statSmsFallback", value: false }).expect(200);
    expect((await director.patch("/api/settings/org").send({ key: "statSmsFallback", value: "no" })).status).toBe(400);
    await director.patch("/api/settings/org").send({ key: "autoReassignOnDecline", value: true }).expect(200);
    // A director cannot smuggle developer-owned keys through this route.
    const smuggle = await director.patch("/api/settings/org").send({ key: "modules", value: { "security.mfaRequired": false } });
    expect(smuggle.status).toBe(400);
    expect(smuggle.body.error).toBe("unknown_setting");
    expect(await ctx.storage.getOrgSetting(orgId, "modules")).toBeUndefined();
  });

  it("an invalid STORED value is skipped (nothing purged), reported as 0 by GET /api/settings, and audited at high risk", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })).body;
    const msg = (await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "keep me" })).body;
    await ctx.handle.db.update(messages).set({ createdAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(messages.id, msg.id));

    // 0.5 used to hard-delete everything older than 12 hours; `true` purged at 1 day.
    for (const bad of [0.5, true, 1e9]) {
      await ctx.storage.setOrgSetting(orgId, "messageRetentionDays", bad, null);
      expect(await runMessageRetentionSweep()).toBe(0);
      expect(await ctx.storage.getMessage(orgId, msg.id)).toBeTruthy();
      const { agent: director } = await login(ctx.app, { username: "director" });
      expect((await director.get("/api/settings").expect(200)).body.org.messageRetentionDays).toBe(0);
    }
    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((a) => a.action === "retention.invalid_setting");
    expect(row).toBeTruthy();
    expect(row!.riskLevel).toBe("high");
  });

  it("tenant force-delete removes the encrypted files only once the rows commit; a rolled-back delete keeps them", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })).body;
    const sent = await uploadAndSend(er, convo.id, "film");
    const orphan = await er.post("/api/messaging/attachments").send({ fileName: "never-sent.png", mimeType: "image/png", dataBase64: PNG_1x1 });
    expect(orphan.status).toBe(201);
    const [orphanRow] = await ctx.handle.db.select().from(messageAttachments).where(eq(messageAttachments.id, orphan.body.id));
    expect(files()).toHaveLength(2);

    // A foreign key the cascade cannot know about (another tenant's setting
    // row naming this tenant's user) makes the transaction roll back. The
    // rows come back, so the files they point at must still be there.
    await ctx.handle.db.insert(orgSettings).values({
      organizationId: ctx.seedResult.platformOrgId, key: "blocker", value: 1, type: "number", updatedBy: chenId,
    });
    const { agent: dev } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    expect((await dev.delete("/api/dev/organizations/" + orgId + "?force=true")).status).toBe(409);
    expect(await ctx.storage.getAttachment(orgId, sent.attachmentId)).toBeTruthy();
    expect(existsSync(fileOf(sent.ref))).toBe(true);
    expect(existsSync(fileOf(orphanRow!.dataBase64))).toBe(true);
    expect(files()).toHaveLength(2);

    // Blocker gone: the delete commits, and the tenant's ciphertext goes with it
    // (sent AND never-linked uploads).
    await ctx.handle.db.delete(orgSettings).where(eq(orgSettings.key, "blocker"));
    await dev.delete("/api/dev/organizations/" + orgId + "?force=true").expect(204);
    expect(await ctx.storage.getOrganization(orgId)).toBeUndefined();
    expect(files()).toHaveLength(0);
  });

  it("readRetentionSetting interprets stored values strictly", () => {
    expect(readRetentionSetting(undefined)).toEqual({ kind: "off" });
    expect(readRetentionSetting(null)).toEqual({ kind: "off" });
    expect(readRetentionSetting(0)).toEqual({ kind: "off" });
    expect(readRetentionSetting(false)).toEqual({ kind: "off" });
    expect(readRetentionSetting(30)).toEqual({ kind: "days", days: 30 });
    expect(readRetentionSetting("30")).toEqual({ kind: "days", days: 30 }); // legacy string rows
    expect(readRetentionSetting(RETENTION_MAX_DAYS)).toEqual({ kind: "days", days: RETENTION_MAX_DAYS });
    for (const bad of [0.5, true, -1, RETENTION_MAX_DAYS + 1, 1e12, "abc", "1.5", [30], {}]) {
      expect(readRetentionSetting(bad), JSON.stringify(bad)).toEqual({ kind: "invalid" });
    }
  });
});
