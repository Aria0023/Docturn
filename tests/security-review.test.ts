import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/** Regression tests for the November security review. */
let ctx: TestContext;
beforeEach(async () => { ctx = await createTestApp(); });
afterEach(async () => { await ctx.handle.close(); });

describe("security review fixes", () => {
  it("module gate cannot be bypassed with upper case or a trailing slash", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const plain = await agent.get("/api/billing");
    expect(plain.status).toBe(404);
    expect(plain.body.error).toBe("module_disabled");
    for (const path of ["/API/billing", "/api/billing/", "/api/BILLING", "/Api/Billing/"]) {
      const r = await agent.get(path);
      expect(r.status, path).toBe(404);
      expect(r.body.error, path).toBe("module_disabled");
    }
  });

  it("nobody can consult themselves, at request time or by re-pointing", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const chenId = ctx.seedResult.userIds.chen!;
    const pid = ctx.seedResult.patientIds.sc!;
    expect((await chen.post(`/api/patients/${pid}/consults`).send({ specialty: "Hospital Medicine", consultantUserId: chenId })).body.error).toBe("cannot_consult_self");
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const made = await er.post(`/api/patients/${pid}/consults`).send({ specialty: "Hospital Medicine", consultantUserId: ctx.seedResult.userIds.patel! });
    expect(made.status).toBe(201);
    const consults = await ctx.storage.listConsultsForPatient(ctx.seedResult.orgId, pid);
    const c = consults.find((x) => x.consultantUserId === ctx.seedResult.userIds.patel)!;
    expect((await chen.patch(`/api/consults/${c.id}`).send({ consultantUserId: chenId })).body.error).toBe("cannot_consult_self");
  });

  it("re-pointing an answered consult resets it to requested; only the consultant or a director changes status", async () => {
    const pid = ctx.seedResult.patientIds.sc!;
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await er.post(`/api/patients/${pid}/consults`).send({ specialty: "Hospital Medicine", consultantUserId: ctx.seedResult.userIds.patel! }).expect(201);
    const c = (await ctx.storage.listConsultsForPatient(ctx.seedResult.orgId, pid)).find((x) => x.consultantUserId === ctx.seedResult.userIds.patel)!;
    await patel.patch(`/api/consults/${c.id}`).send({ status: "accepted" }).expect(200);
    expect((await er.patch(`/api/consults/${c.id}`).send({ status: "closed" })).status).toBe(403);
    expect((await er.patch(`/api/consults/${c.id}`).send({ consultantUserId: ctx.seedResult.userIds.lopez!, status: "accepted" })).status).toBe(400);
    await er.patch(`/api/consults/${c.id}`).send({ consultantUserId: ctx.seedResult.userIds.lopez! }).expect(200);
    const after = (await ctx.storage.listConsultsForPatient(ctx.seedResult.orgId, pid)).find((x) => x.id === c.id)!;
    expect(after.consultantUserId).toBe(ctx.seedResult.userIds.lopez);
    expect(after.status).toBe("requested");
    expect(after.respondedAt).toBeNull();
  });

  it("one consult request cannot create an unbounded number of rows", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const many = Array.from({ length: 21 }, (_, i) => ({ name: "Dr " + i }));
    expect((await er.post(`/api/patients/${ctx.seedResult.patientIds.sc!}/consults`).send({ specialty: "Cardiology", consultants: many })).status).toBe(400);
  });

  it("personal preferences accept only known keys with valid values, and audit availability changes", async () => {
    const { agent } = await login(ctx.app, { username: "er.doc" });
    expect((await agent.patch("/api/settings/me").send({ key: "anything", value: 1 })).body.error).toBe("unknown_preference");
    expect((await agent.patch("/api/settings/me").send({ key: "dnd", value: "yes" })).status).toBe(400);
    expect((await agent.patch("/api/settings/me").send({ key: "coveringUserId", value: ctx.seedResult.userIds["er.doc"] })).body.error).toBe("covering_is_self");
    expect((await agent.patch("/api/settings/me").send({ key: "coveringUserId", value: 999999 })).status).toBe(404);
    await agent.patch("/api/settings/me").send({ key: "coveringUserId", value: ctx.seedResult.userIds.chen }).expect(200);
    await agent.patch("/api/settings/me").send({ key: "dnd", value: true }).expect(200);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    expect(audit.filter((a) => a.action === "prefs.availability").length).toBe(2);
  });

  it("deactivating an account ends its sessions for good, even after reactivation", async () => {
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await patel.get("/api/user").expect(200);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const id = ctx.seedResult.userIds.patel!;
    await director.post(`/api/accounts/${id}/deactivate`).expect(200);
    await director.post(`/api/accounts/${id}/reactivate`).expect(200);
    expect((await patel.get("/api/patients")).status).toBe(401);
  });

  it("two simultaneous Assign requests for one patient leave exactly one live request", async () => {
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const p = await er.post("/api/patients").send({ initials: "ZZ", issueSummary: "x" });
    const [a, b] = await Promise.all([
      er.post("/api/assignments").send({ patientId: p.body.id, mode: "round_robin" }),
      er.post("/api/assignments").send({ patientId: p.body.id, mode: "round_robin" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const live = (await ctx.storage.listAssignments(ctx.seedResult.orgId)).filter((x) => x.patientId === p.body.id && (x.status === "pending" || x.status === "accepted"));
    expect(live).toHaveLength(1);
  });
});
