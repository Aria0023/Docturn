import { existsSync, mkdtempSync, readdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { messageAttachments, messages, orgSettings } from "@shared/schema";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules } from "../server/modules.js";
import { renderPolicy } from "../server/compliance/policies.js";
import { MODULES } from "@shared/modules";
import {
  readRetentionSetting,
  runMessageRetentionSweep,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_RECOMMENDED_DAYS,
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
    // The audit row names the value it refused, so an operator can find it.
    expect(row!.details).toMatchObject({ setting: "messageRetentionDays", storedValue: "0.5" });
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

  async function control(agent: import("supertest").Agent, id: string) {
    const res = await agent.get("/api/compliance/status").expect(200);
    const row = (res.body.controls as Array<{ id: string; status: string; detail: string; evidence: Record<string, any> }>).find((c) => c.id === id);
    expect(row, id).toBeTruthy();
    return row!;
  }

  it("the msg-retention-policy control reads the stored value exactly as the sweep does — no green for a skipped org", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });

    let c = await control(director, "msg-retention-policy");
    expect(c.status).toBe("warn");
    expect(c.evidence).toMatchObject({ storedValue: null, interpretation: "off", messageRetentionDays: null, enforced: false });

    // Pre-validation rows: the sweep skips every one of these and audits
    // retention.invalid_setting, so the control must FAIL, not claim a window.
    for (const bad of [0.00001, true, 1e9, -5, "abc", 7.5]) {
      await ctx.storage.setOrgSetting(orgId, "messageRetentionDays", bad, null);
      c = await control(director, "msg-retention-policy");
      expect(c.status, JSON.stringify(bad)).toBe("fail");
      expect(c.detail).not.toMatch(/purges clinical messages older than/);
      expect(c.detail).toMatch(/NOT being applied/);
      expect(c.detail).toContain(JSON.stringify(bad));
      expect(c.evidence).toMatchObject({
        storedValue: JSON.stringify(bad),
        storedType: typeof bad,
        interpretation: "invalid",
        messageRetentionDays: null,
        enforced: false,
      });
    }

    // A valid window with the module on is the only pass.
    await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 30 }).expect(200);
    c = await control(director, "msg-retention-policy");
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("older than 30 day(s)");
    expect(c.evidence).toMatchObject({ storedValue: "30", interpretation: "days", messageRetentionDays: 30, moduleEnabled: true, enforced: true });

    // Configured but the ops.retention switch is off: the sweep leaves the data
    // alone, so the control must not say it is purging.
    await ctx.storage.setOrgSetting(orgId, "modules", { "ops.retention": false }, null);
    invalidateModules();
    c = await control(director, "msg-retention-policy");
    expect(c.status).toBe("warn");
    expect(c.detail).toMatch(/ops\.retention/);
    expect(c.detail).not.toMatch(/purges clinical messages older than/);
    expect(c.evidence).toMatchObject({ messageRetentionDays: 30, moduleEnabled: false, enforced: false });
    await ctx.storage.setOrgSetting(orgId, "modules", { "ops.retention": true }, null);
    invalidateModules();

    // An explicit 0 is a deliberate "keep everything".
    await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 0 }).expect(200);
    c = await control(director, "msg-retention-policy");
    expect(c.status).toBe("warn");
    expect(c.detail).toMatch(/set to 0/);
    expect(c.evidence).toMatchObject({ storedValue: "0", interpretation: "off", enforced: false });
  });

  it("a window below the 7-day floor is enforced, but the control WARNS (never a plain pass) and the PATCH says so", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })).body;
    const msg = (await er.post("/api/messaging/send").send({ conversationId: convo.id, content: "two days old" })).body;
    await ctx.handle.db.update(messages).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(messages.id, msg.id));
    const { agent: director } = await login(ctx.app, { username: "director" });
    expect(RETENTION_MIN_RECOMMENDED_DAYS).toBe(7);

    for (const days of [1, 3, 6]) {
      const res = await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: days }).expect(200);
      // The write is accepted (a valid, deliberate setting) but flagged.
      expect(res.body.retention).toMatchObject({
        days, moduleEnabled: true, enforced: true, minimumRecommendedDays: 7, belowRecommendedFloor: true,
      });
      const c = await control(director, "msg-retention-policy");
      expect(c.status, `${days} day(s)`).toBe("warn");
      expect(c.detail).toMatch(new RegExp(`${days} day\\(s\\)`));
      expect(c.detail).toMatch(/below the 7-day/);
      expect(c.evidence).toMatchObject({
        messageRetentionDays: days, enforced: true, minimumRecommendedDays: 7, belowRecommendedFloor: true,
      });
      const s = (await director.get("/api/settings").expect(200)).body.org;
      expect(s.messageRetentionDays).toBe(days);
      expect(s.messageRetention).toMatchObject({ days, enforced: true, belowRecommendedFloor: true });
    }
    // Warn is about the risk, not a refusal: the 1-day window really purges.
    await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 1 }).expect(200);
    expect(await runMessageRetentionSweep()).toBe(1);
    expect(await ctx.storage.getMessage(orgId, msg.id)).toBeUndefined();

    // At and above the floor it is a plain pass again.
    for (const days of [7, 30]) {
      const res = await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: days }).expect(200);
      expect(res.body.retention).toMatchObject({ days, enforced: true, belowRecommendedFloor: false });
      const c = await control(director, "msg-retention-policy");
      expect(c.status, `${days} day(s)`).toBe("pass");
      expect(c.evidence).toMatchObject({ belowRecommendedFloor: false });
    }
  });

  it("with ops.retention OFF the settings API says the window is not enforced and refuses to set a new one", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 90 }).expect(200);
    let s = (await director.get("/api/settings").expect(200)).body.org;
    expect(s.messageRetention).toMatchObject({ days: 90, moduleEnabled: true, enforced: true });

    // The operator switches the purge off (the developer console's route).
    const { agent: dev } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    await dev.patch("/api/dev/modules/" + orgId).send({ id: "ops.retention", enabled: false }).expect(200);

    // GET reports the saved window AND that nothing enforces it.
    s = (await director.get("/api/settings").expect(200)).body.org;
    expect(s.messageRetentionDays).toBe(90);
    expect(s.messageRetention).toMatchObject({ days: 90, moduleEnabled: false, enforced: false });

    // A new window would be a promise nothing keeps: refused like every other
    // switched-off feature, and nothing is written or audited as an update.
    const auditBefore = (await ctx.storage.listAuditLogs(orgId, 200)).filter((a) => a.action === "settings.org_update").length;
    const refused = await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 30 });
    expect(refused.status).toBe(404);
    expect(refused.body).toEqual({ error: "module_disabled", module: "ops.retention" });
    expect(await ctx.storage.getOrgSetting(orgId, "messageRetentionDays")).toBe(90);
    expect((await ctx.storage.listAuditLogs(orgId, 200)).filter((a) => a.action === "settings.org_update").length).toBe(auditBefore);

    // Clearing the saved window ("Keep everything") claims nothing and stops a
    // re-enable from purging by surprise — allowed.
    const cleared = await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 0 }).expect(200);
    expect(cleared.body.retention).toMatchObject({ days: 0, moduleEnabled: false, enforced: false });
    expect(await ctx.storage.getOrgSetting(orgId, "messageRetentionDays")).toBe(0);
    // Other org settings are untouched by the retention switch.
    await director.patch("/api/settings/org").send({ key: "statSmsFallback", value: false }).expect(200);
    // Validation still comes first for a malformed value.
    expect((await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 0.5 })).body.error).toBe("validation_error");

    // Back on: a window can be set again.
    await dev.patch("/api/dev/modules/" + orgId).send({ id: "ops.retention", enabled: true }).expect(200);
    const back = await director.patch("/api/settings/org").send({ key: "messageRetentionDays", value: 30 }).expect(200);
    expect(back.body.retention).toMatchObject({ days: 30, moduleEnabled: true, enforced: true });
  });

  it("the ops.retention module blurb says what switching it off does", () => {
    const def = MODULES.find((m) => m.id === "ops.retention")!;
    expect(def.blurb).toMatch(/hourly/i);
    expect(def.blurb).toMatch(/attachment/i);
    expect(def.blurb).toMatch(/Off:.*kept indefinitely/);
  });

  it("the attachment-storage control measures file drift: rows whose ciphertext is gone, and files no row references", async () => {
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })).body;
    const sent = await uploadAndSend(er, convo.id, "film");
    const { agent: director } = await login(ctx.app, { username: "director" });

    let c = await control(director, "attachment-storage");
    expect(c.status).toBe("pass");
    expect(c.evidence.fileDrift).toMatchObject({ checked: true, encryptedRows: 1, rowsMissingFile: 0, unreferencedFiles: 0 });

    // Ciphertext a failed delete left behind (old) is drift; an upload being
    // written right now (fresh, row not inserted yet) is not.
    const stray = join(dir, "ab".repeat(16) + ".bin");
    const inFlight = join(dir, "cd".repeat(16) + ".bin");
    writeFileSync(stray, "x");
    writeFileSync(inFlight, "x");
    const old = new Date(Date.now() - 2 * 3600_000);
    utimesSync(stray, old, old);
    c = await control(director, "attachment-storage");
    expect(c.status).toBe("warn");
    expect(c.evidence.fileDrift).toMatchObject({ checked: true, rowsMissingFile: 0, unreferencedFiles: 1 });
    expect(c.detail).toMatch(/1 encrypted file\(s\) .*no attachment row references/);

    // A row whose ciphertext file has vanished cannot be served.
    unlinkSync(stray);
    unlinkSync(inFlight);
    unlinkSync(fileOf(sent.ref));
    c = await control(director, "attachment-storage");
    expect(c.status).toBe("warn");
    expect(c.evidence.fileDrift).toMatchObject({ checked: true, encryptedRows: 1, rowsMissingFile: 1, unreferencedFiles: 0 });
    expect(c.detail).toMatch(/1 of 1 encrypted attachment row\(s\)/);
    // Counts only — never a ref or file name.
    expect(JSON.stringify(c)).not.toContain(sent.ref.replace(/^fsenc:/, ""));
  });

  it("the generated HIPAA policies describe attachment storage and deletion as the code does it", () => {
    const vars = { organizationName: "Test Hospital", effectiveDate: "2026-01-01" };
    const disposal = renderPolicy("disposal-media", vars)!.markdown;
    // The old sentence was false under ATTACHMENT_STORE=fs-encrypted.
    expect(disposal).not.toMatch(/stored\s+base64-encoded inside the message row rather than in separate storage/);
    expect(disposal).toMatch(/ciphertext file/);
    expect(disposal).toMatch(/never\s+attached to a sent message/);
    expect(disposal).toMatch(/ops\.retention/);
    expect(disposal).toMatch(/This deployment[^\n]*\n?[^\n]*ATTACHMENT_STORE=fs-encrypted/);

    const backup = renderPolicy("contingency-plan", vars)!.markdown;
    expect(backup).not.toMatch(/Includes attachments: yes, because/);
    expect(backup).toMatch(/does NOT contain/);
    for (const id of ["baa-database", "risk-analysis", "backup-tested"]) {
      const md = renderPolicy(id, vars)!.markdown;
      expect(md, id).not.toMatch(/attachments are stored base64[- ]\w* inside (the )?(database|message) row/i);
    }

    // The deployment line follows the store this process is actually using.
    process.env.ATTACHMENT_STORE = "db";
    const dbMode = renderPolicy("disposal-media", vars)!.markdown;
    expect(dbMode).toMatch(/ATTACHMENT_STORE=db/);
    expect(dbMode).not.toMatch(/\{[a-zA-Z]+\}/);
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
