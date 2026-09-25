import { beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { MODULES, moduleDefaults, resolveModules } from "@shared/modules";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules } from "../server/modules.js";

const devLogin = (ctx: TestContext) =>
  login(ctx.app, { orgCode: "DOCTURN", username: "dev" });

describe("feature modules — registry resolution", () => {
  it("defaults resolve from the registry when an org has no overrides", () => {
    const eff = resolveModules(null);
    for (const m of MODULES) expect(eff[m.id]).toBe(m.default);
    expect(eff).toEqual(moduleDefaults());
  });

  it("honours the requires-chain: a module with an off prerequisite reports off", () => {
    // messaging.escalation requires messaging.priority.
    const eff = resolveModules({ "messaging.priority": false, "messaging.escalation": true });
    expect(eff["messaging.priority"]).toBe(false);
    expect(eff["messaging.escalation"]).toBe(false);
    // Turning the prerequisite back on restores the dependent's own value.
    const back = resolveModules({ "messaging.priority": true, "messaging.escalation": true });
    expect(back["messaging.escalation"]).toBe(true);
  });

  it("ignores unknown keys and non-boolean values in stored overrides", () => {
    const eff = resolveModules({ bogus: false, broadcasts: "no" });
    expect((eff as Record<string, unknown>).bogus).toBeUndefined();
    expect(eff.broadcasts).toBe(true);
  });
});

describe("feature modules — API + central gate", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
    invalidateModules();
  });

  it("GET /api/modules returns the caller's effective map plus the registry", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.get("/api/modules").expect(200);
    expect(res.body.orgId).toBe(ctx.seedResult.orgId);
    expect(res.body.modules).toEqual(moduleDefaults());
    expect(Array.isArray(res.body.registry)).toBe(true);
    expect(res.body.registry.length).toBe(MODULES.length);
  });

  it("developer PATCH persists, GET reflects it, and an audit row is written", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: dev, res: loginRes } = await devLogin(ctx);
    expect(loginRes.status).toBe(200);

    const patched = await dev
      .patch(`/api/dev/modules/${orgId}`)
      .send({ id: "broadcasts", enabled: false })
      .expect(200);
    expect(patched.body.modules.broadcasts).toBe(false);

    const read = await dev.get(`/api/dev/modules/${orgId}`).expect(200);
    expect(read.body.modules.broadcasts).toBe(false);

    // The org's own users see the same truth.
    const { agent: director } = await login(ctx.app, { username: "director" });
    const mine = await director.get("/api/modules").expect(200);
    expect(mine.body.modules.broadcasts).toBe(false);

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const row = audit.find((a) => a.action === "module.toggle");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ orgId, id: "broadcasts", enabled: false });
  });

  it("director can read their own org's map but cannot PATCH (403), nor read another org", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.get(`/api/dev/modules/${orgId}`).expect(200);
    await director
      .patch(`/api/dev/modules/${orgId}`)
      .send({ id: "broadcasts", enabled: false })
      .expect(403);
    await director.get(`/api/dev/modules/${ctx.seedResult.platformOrgId}`).expect(403);
  });

  it("unknown module id → 400; non-boolean enabled → 400", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: dev } = await devLogin(ctx);
    const bad = await dev
      .patch(`/api/dev/modules/${orgId}`)
      .send({ id: "nope.nothing", enabled: false })
      .expect(400);
    expect(bad.body.error).toBe("unknown_module");
    await dev
      .patch(`/api/dev/modules/${orgId}`)
      .send({ id: "broadcasts", enabled: "off" })
      .expect(400);
  });

  it("with broadcasts off, POST /api/broadcasts → 404 module_disabled; back on → 201", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: dev } = await devLogin(ctx);
    const { agent: director } = await login(ctx.app, { username: "director" });

    await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "broadcasts", enabled: false }).expect(200);
    const blocked = await director
      .post("/api/broadcasts")
      .send({ message: "Code blue drill", severity: "info" });
    expect(blocked.status).toBe(404);
    expect(blocked.body).toEqual({ error: "module_disabled", module: "broadcasts" });

    // Other modules are untouched.
    await director.get("/api/assignments/pending").expect(200);

    await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "broadcasts", enabled: true }).expect(200);
    const ok = await director
      .post("/api/broadcasts")
      .send({ message: "Code blue drill", severity: "info" });
    expect(ok.status).toBe(201);
  });

  it("gate is per-org: switching ISPN off does not affect the platform org", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: dev } = await devLogin(ctx);
    await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "ops.analytics", enabled: false }).expect(200);
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.get("/api/reports/ops").expect(404);
    // Developer is in DOCTURN, which still has the default (on).
    const own = await dev.get("/api/modules").expect(200);
    expect(own.body.modules["ops.analytics"]).toBe(true);
  });

  it("with messaging.priority off, a non-routine send is rejected (400) and routine still works", async () => {
    const orgId = ctx.seedResult.orgId;
    const chenId = ctx.seedResult.userIds.chen!;
    const { agent: dev } = await devLogin(ctx);
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const convo = (
      await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [chenId] })
    ).body;

    await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "messaging.priority", enabled: false }).expect(200);
    const stat = await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "now", priority: "stat" });
    expect(stat.status).toBe(400);
    expect(stat.body).toEqual({ error: "module_disabled", module: "messaging.priority" });
    await er
      .post("/api/messaging/send")
      .send({ conversationId: convo.id, content: "later", priority: "routine" })
      .expect(201);
  });

  it("unauthenticated requests pass through the gate to auth (401, not 404)", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: dev } = await devLogin(ctx);
    await dev.patch(`/api/dev/modules/${orgId}`).send({ id: "broadcasts", enabled: false }).expect(200);
    const res = await supertest(ctx.app).post("/api/broadcasts").send({ message: "x" });
    expect(res.status).toBe(401);
  });
});
