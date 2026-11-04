import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDemoTenants } from "../server/seed.js";
import { setModule } from "../server/modules.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Per-user display presets over the organization's branding (module
 * platform.userThemes). The organization keeps appName / accent / radius /
 * sidebar / content width / palette; each person layers their own preset, text
 * size and "follow device" on top. The caller's own row only, a strict body
 * from fixed catalogues, audited without content, another user and another
 * tenant unaffected.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});

describe("per-user theme preferences", () => {
  it("defaults to the organization's palette until the user chooses; a PUT stores the caller's own row and is audited", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const me = (await agent.get("/api/user")).body;

    const first = await agent.get("/api/me/theme");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      preset: "org",
      textSize: "default",
      followDevice: false,
      defaults: { preset: "org", textSize: "default", followDevice: false },
    });
    expect(first.body.presets).toEqual(["org", "classic", "calm", "warm", "night", "contrast"]);
    expect(first.body.textSizes).toEqual(["default", "large"]);
    expect(first.body.followDevicePresets).toEqual(["org", "night"]);

    const put = await agent.put("/api/me/theme").send({ preset: "night", textSize: "large", followDevice: true });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ preset: "night", textSize: "large", followDevice: true });
    expect((await agent.get("/api/me/theme")).body).toMatchObject({ preset: "night", textSize: "large", followDevice: true });

    const row = await ctx.storage.getThemePrefs(ctx.seedResult.orgId, me.id);
    expect(row).toMatchObject({ preset: "night", textSize: "large", followDevice: true, organizationId: ctx.seedResult.orgId, userId: me.id });

    const audit = (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 200)).filter((r) => r.action === "theme.prefs_update");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      userId: me.id,
      resourceType: "user",
      resourceId: me.id,
      riskLevel: "low",
      details: { preset: "night", textSize: "large", followDevice: true },
    });

    // Another user in the same org is unaffected — one row per user.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.get("/api/me/theme")).body).toMatchObject({ preset: "org", textSize: "default", followDevice: false });
    await patel.put("/api/me/theme").send({ preset: "contrast", textSize: "default", followDevice: false }).expect(200);
    expect((await agent.get("/api/me/theme")).body).toMatchObject({ preset: "night", textSize: "large" });
  });

  it("strict body from the fixed catalogues: unknown values, missing or extra fields are 400 and nothing is stored", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const me = (await agent.get("/api/user")).body;
    for (const body of [
      { preset: "neon", textSize: "default", followDevice: false },
      { preset: "night", textSize: "huge", followDevice: false },
      { preset: "night", textSize: "large" },
      { preset: "night", textSize: "large", followDevice: "yes" },
      { preset: "night", textSize: "large", followDevice: false, userId: 1 },
      { preset: "night", textSize: "large", followDevice: false, organizationId: 99 },
      { preset: "night", textSize: "large", followDevice: false, accent: "#000000" },
    ]) {
      const r = await agent.put("/api/me/theme").send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body).toEqual({ error: "validation_error" });
    }
    expect(await ctx.storage.getThemePrefs(ctx.seedResult.orgId, me.id)).toBeUndefined();
  });

  it("module off: GET and PUT answer 404 module_disabled; the stored choice is kept for when it comes back", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    await agent.put("/api/me/theme").send({ preset: "warm", textSize: "large", followDevice: false }).expect(200);
    await setModule(ctx.seedResult.orgId, "platform.userThemes", false);
    for (const r of [
      await agent.get("/api/me/theme"),
      await agent.put("/api/me/theme").send({ preset: "night", textSize: "default", followDevice: false }),
    ]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "module_disabled", module: "platform.userThemes" });
    }
    await setModule(ctx.seedResult.orgId, "platform.userThemes", true);
    expect((await agent.get("/api/me/theme")).body).toMatchObject({ preset: "warm", textSize: "large" });
  });

  it("signed out: no preference is served or stored", async () => {
    const anon = supertest(ctx.app);
    expect((await anon.get("/api/me/theme")).status).toBe(401);
    expect((await anon.put("/api/me/theme").send({ preset: "night", textSize: "default", followDevice: false })).status).toBe(401);
  });

  it("another tenant: its own switch and its own rows", async () => {
    await ensureDemoTenants(ctx.storage);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.put("/api/me/theme").send({ preset: "night", textSize: "default", followDevice: true }).expect(200);
    const { agent: voss } = await login(ctx.app, { orgCode: "HOSP", username: "voss" });
    expect((await voss.get("/api/me/theme")).body).toMatchObject({ preset: "org", textSize: "default", followDevice: false });
    await setModule(ctx.seedResult.orgId, "platform.userThemes", false);
    expect((await voss.get("/api/me/theme")).status).toBe(200);
    expect((await chen.get("/api/me/theme")).status).toBe(404);
  });
});
