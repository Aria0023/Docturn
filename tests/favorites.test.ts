import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { ensureDemoTenants } from "../server/seed.js";
import { setModule } from "../server/modules.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * Favorites + recently contacted (PerfectServe parity #2, module
 * directory.favorites). Favorites are stored per (org, user, kind, target),
 * every target same-org validated; recents are derived server-side from the
 * caller's own direct conversations by last message time — nothing stored.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.handle.close();
});
const ids = () => ctx.seedResult.userIds;
const auditActions = async () => (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 500)).map((a) => a.action);

describe("directory favorites", () => {
  it("stars a person and a role, lists them resolved, unstars them — audited with ids only", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const patelName = (await ctx.storage.getUser(ctx.seedResult.orgId, ids().patel!))!.displayName;
    await director.post("/api/oncall/manual").send({ slot: "Cardiology call", providerName: patelName });

    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    expect((await er.get("/api/directory/favorites")).body).toEqual({ favorites: [] });

    const a = await er.post("/api/directory/favorites").send({ targetKind: "user", targetId: String(ids().chen) });
    expect(a.status).toBe(201);
    // Idempotent.
    const again = await er.post("/api/directory/favorites").send({ targetKind: "user", targetId: String(ids().chen) });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    const b = await er.post("/api/directory/favorites").send({ targetKind: "role", targetId: "schedule:Cardiology call" });
    expect(b.status).toBe(201);

    const list = (await er.get("/api/directory/favorites")).body.favorites;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ targetKind: "user", targetId: String(ids().chen), user: { userId: ids().chen, active: true } });
    expect(list[1]).toMatchObject({ targetKind: "role", targetId: "schedule:Cardiology call", role: { label: "Cardiology call" } });
    expect(list[1].role.holders[0].userId).toBe(ids().patel);

    // Only the caller's own stars: another user of the same org sees none.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.get("/api/directory/favorites")).body.favorites).toEqual([]);

    expect((await er.delete(`/api/directory/favorites/user/${ids().chen}`)).status).toBe(204);
    expect((await er.delete(`/api/directory/favorites/role/${encodeURIComponent("schedule:Cardiology call")}`)).status).toBe(204);
    expect((await er.delete(`/api/directory/favorites/user/${ids().chen}`)).status).toBe(404);
    expect((await er.get("/api/directory/favorites")).body.favorites).toEqual([]);

    const acts = await auditActions();
    expect(acts.filter((x) => x === "directory.favorite_add")).toHaveLength(2);
    expect(acts.filter((x) => x === "directory.favorite_remove")).toHaveLength(2);
    for (const row of (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 500)).filter((r) => r.action.startsWith("directory."))) {
      expect(JSON.stringify(row.details)).not.toMatch(/Cardiology|Dr\./);
    }
  });

  it("validates every target against the caller's org: no other tenant's user, no unresolvable role, no self", async () => {
    await ensureDemoTenants(ctx.storage);
    const hosp = (await ctx.storage.getOrganizationByCode("HOSP"))!;
    const voss = (await ctx.storage.getUserByUsername(hosp.id, "voss"))!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const cross = await er.post("/api/directory/favorites").send({ targetKind: "user", targetId: String(voss.id) });
    expect(cross.status).toBe(404);
    expect((await er.post("/api/directory/favorites").send({ targetKind: "user", targetId: "999999" })).status).toBe(404);
    expect((await er.post("/api/directory/favorites").send({ targetKind: "user", targetId: String(ids()["er.doc"]) })).body.error).toBe("cannot_favorite_self");
    expect((await er.post("/api/directory/favorites").send({ targetKind: "role", targetId: "schedule:Nothing here" })).status).toBe(404);
    for (const bad of [{}, { targetKind: "team", targetId: "1" }, { targetKind: "user", targetId: "abc" }, { targetKind: "user", targetId: "" }]) {
      expect((await er.post("/api/directory/favorites").send(bad)).status).toBe(400);
    }
    expect(await ctx.storage.listFavorites(ctx.seedResult.orgId, ids()["er.doc"]!)).toEqual([]);

    // A deactivated colleague cannot be starred.
    await ctx.storage.updateUser(ids().kohan!, { disabledAt: new Date() });
    expect((await er.post("/api/directory/favorites").send({ targetKind: "user", targetId: String(ids().kohan) })).status).toBe(409);
  });

  it("a starred role nobody holds right now resolves to null (kept, never shown as an empty card)", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const patelName = (await ctx.storage.getUser(ctx.seedResult.orgId, ids().patel!))!.displayName;
    await director.post("/api/oncall/manual").send({ slot: "Neuro call", providerName: patelName });
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    expect((await er.post("/api/directory/favorites").send({ targetKind: "role", targetId: "schedule:Neuro call" })).status).toBe(201);
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await patel.patch("/api/settings/me").send({ key: "dnd", value: true }); // DND, no covering → unreachable
    const list = (await er.get("/api/directory/favorites")).body.favorites;
    expect(list).toEqual([expect.objectContaining({ targetKind: "role", targetId: "schedule:Neuro call", role: null })]);
  });

  it("recently contacted: the caller's direct conversations, newest message first, one row per person, no content", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const open = async (uid: number) => (await er.post("/api/messaging/conversations").send({ type: "direct", participantIds: [uid] })).body.id;
    const cChen = await open(ids().chen!);
    const cPatel = await open(ids().patel!);
    await open(ids().lopez!); // a thread with no message is not "contacted"
    await er.post("/api/messaging/send").send({ conversationId: cChen, content: "first, secret content" });
    await new Promise((r) => setTimeout(r, 15));
    await er.post("/api/messaging/send").send({ conversationId: cPatel, content: "second" });
    // Group threads are not a person.
    await er.post("/api/messaging/conversations").send({ type: "group", name: "g", participantIds: [ids().chen, ids().patel] });

    const res = await er.get("/api/directory/recents");
    expect(res.status).toBe(200);
    expect(res.body.recents.map((r: any) => r.userId)).toEqual([ids().patel, ids().chen]);
    expect(res.body.recents[0]).toMatchObject({ conversationId: cPatel, active: true });
    expect(JSON.stringify(res.body)).not.toMatch(/secret content|second/);

    // A reply in the older thread moves that person back to the top.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await new Promise((r) => setTimeout(r, 15));
    await chen.post("/api/messaging/send").send({ conversationId: cChen, content: "reply" });
    expect((await er.get("/api/directory/recents")).body.recents.map((r: any) => r.userId)).toEqual([ids().chen, ids().patel]);
    // Someone else's conversations are not mine.
    const { agent: lopez } = await login(ctx.app, { username: "lopez" });
    expect((await lopez.get("/api/directory/recents")).body.recents).toEqual([]);
  });

  it("needs auth; 404 module_disabled when directory.favorites is off — and a stored star is not served", async () => {
    expect((await supertest(ctx.app).get("/api/directory/favorites")).status).toBe(401);
    expect((await supertest(ctx.app).get("/api/directory/recents")).status).toBe(401);
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    await er.post("/api/directory/favorites").send({ targetKind: "user", targetId: String(ids().chen) });
    await setModule(ctx.seedResult.orgId, "directory.favorites", false);
    for (const [m, p] of [["get", "/api/directory/favorites"], ["get", "/api/directory/recents"], ["post", "/api/directory/favorites"], ["delete", `/api/directory/favorites/user/${ids().chen}`]] as const) {
      const r = await (er as any)[m](p).send(m === "post" ? { targetKind: "user", targetId: String(ids().patel) } : undefined);
      expect(r.status, m + " " + p).toBe(404);
      expect(r.body, m + " " + p).toEqual({ error: "module_disabled", module: "directory.favorites" });
    }
    await setModule(ctx.seedResult.orgId, "directory.favorites", true);
    expect((await er.get("/api/directory/favorites")).body.favorites).toHaveLength(1);
  });

  it("starring a role needs role messaging: with it off a role star is refused, a person star still works", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    await setModule(ctx.seedResult.orgId, "routing.roleMessaging", false);
    const r = await er.post("/api/directory/favorites").send({ targetKind: "role", targetId: "next_hospitalist" });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "module_disabled", module: "routing.roleMessaging" });
    expect((await er.post("/api/directory/favorites").send({ targetKind: "user", targetId: String(ids().chen) })).status).toBe(201);
  });
});
