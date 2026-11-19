import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDemoTenants } from "../server/seed.js";
import { setModule } from "../server/modules.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Priority alert sounds (PerfectServe parity #8, module messaging.alertSounds).
 * The server stores each user's choice of in-app tone per priority; the open
 * app plays it (WebAudio, no files). The caller's own row only, a strict body
 * from a fixed catalog, audited without content, another tenant isolated.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

describe("alert sounds", () => {
  it("defaults until the user chooses; a PUT stores the caller's own choice and is audited", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const me = (await agent.get("/api/user")).body;
    const first = await agent.get("/api/messaging/alert-sounds");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ stat: "siren", urgent: "alarm", routine: "ping", defaults: { stat: "siren", urgent: "alarm", routine: "ping" } });
    expect(first.body.sounds).toEqual(["siren", "alarm", "chime", "ping", "soft", "none"]);

    const put = await agent.put("/api/messaging/alert-sounds").send({ stat: "alarm", urgent: "chime", routine: "none" });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ stat: "alarm", urgent: "chime", routine: "none" });
    expect((await agent.get("/api/messaging/alert-sounds")).body).toMatchObject({ stat: "alarm", urgent: "chime", routine: "none" });
    const row = await ctx.storage.getSoundPrefs(ctx.seedResult.orgId, me.id);
    expect(row).toMatchObject({ statSound: "alarm", urgentSound: "chime", routineSound: "none", organizationId: ctx.seedResult.orgId });

    const audit = (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 200)).filter((r) => r.action === "sound.prefs_update");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: me.id, resourceId: me.id, riskLevel: "low", details: { stat: "alarm", urgent: "chime", routine: "none" } });

    // Another user in the same org still has the defaults.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.get("/api/messaging/alert-sounds")).body).toMatchObject({ stat: "siren", urgent: "alarm", routine: "ping" });
  });

  it("strict body from the fixed catalog: unknown tones, missing or extra fields are 400 and nothing is stored", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const me = (await agent.get("/api/user")).body;
    for (const body of [
      { stat: "https://evil.example/a.mp3", urgent: "chime", routine: "ping" },
      { stat: "siren", urgent: "chime" },
      { stat: "siren", urgent: "chime", routine: "ping", userId: 1 },
      { stat: "siren", urgent: "chime", routine: "ping", organizationId: 99 },
    ]) {
      const r = await agent.put("/api/messaging/alert-sounds").send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(await ctx.storage.getSoundPrefs(ctx.seedResult.orgId, me.id)).toBeUndefined();
  });

  it("module off: GET and PUT answer 404 module_disabled; the stored choice is kept for when it comes back", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    await agent.put("/api/messaging/alert-sounds").send({ stat: "chime", urgent: "chime", routine: "soft" }).expect(200);
    await setModule(ctx.seedResult.orgId, "messaging.alertSounds", false);
    for (const r of [await agent.get("/api/messaging/alert-sounds"), await agent.put("/api/messaging/alert-sounds").send({ stat: "none", urgent: "none", routine: "none" })]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "module_disabled", module: "messaging.alertSounds" });
    }
    await setModule(ctx.seedResult.orgId, "messaging.alertSounds", true);
    expect((await agent.get("/api/messaging/alert-sounds")).body).toMatchObject({ stat: "chime", urgent: "chime", routine: "soft" });
  });

  it("another tenant: its own switch and its own rows", async () => {
    await ensureDemoTenants(ctx.storage);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.put("/api/messaging/alert-sounds").send({ stat: "none", urgent: "none", routine: "none" }).expect(200);
    const { agent: voss } = await login(ctx.app, { orgCode: "HOSP", username: "voss" });
    expect((await voss.get("/api/messaging/alert-sounds")).body).toMatchObject({ stat: "siren", urgent: "alarm", routine: "ping" });
    await setModule(ctx.seedResult.orgId, "messaging.alertSounds", false);
    expect((await voss.get("/api/messaging/alert-sounds")).status).toBe(200);
    expect((await chen.get("/api/messaging/alert-sounds")).status).toBe(404);
  });
});
