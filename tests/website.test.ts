import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * The public website (/home) and its purchase path: prices only from plans the
 * operator published, and an order request the operator can work from the
 * developer console. No session is needed to read the site or file a request.
 */
let ctx: TestContext;
beforeEach(async () => { ctx = await createTestApp(); });
afterEach(async () => { await ctx.handle.close(); });

const devLogin = () => login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
const order = (over: Record<string, unknown> = {}) => ({
  organizationName: "Riverside Medical Center",
  contactName: "Jordan Lee",
  contactTitle: "CMIO",
  email: "Jordan.Lee@example.org",
  phone: "+1 (555) 010-2000",
  seats: 40,
  term: "pilot",
  planCode: "pilot",
  message: "Hospitalist group, 3 campuses",
  agreeTerms: true,
  ...over,
});

describe("public website", () => {
  it("serves the site without a session and redirects /pricing", async () => {
    const res = await supertest(ctx.app).get("/home");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("DocTurn");
    expect(res.text).toContain('id="pricing"');
    expect(res.headers["set-cookie"]).toBeUndefined();
    const p = await supertest(ctx.app).get("/pricing");
    expect(p.status).toBe(302);
    expect(p.headers.location).toBe("/home#pricing");
  });

  it("lists only non-archived plans the operator marked for the website", async () => {
    const { agent: dev } = await devLogin();
    const hidden = await dev.post("/api/dev/billing/plans").send({ code: "internal", name: "Internal", moduleIds: [], perSeatPriceCents: 100, currency: "USD" });
    expect(hidden.status).toBe(201);
    expect(hidden.body.plan.showOnWebsite).toBe(false);
    const shown = await dev.post("/api/dev/billing/plans").send({ code: "hospital", name: "Hospital", moduleIds: [], perSeatPriceCents: 2500, currency: "USD", showOnWebsite: true });
    expect(shown.body.plan.showOnWebsite).toBe(true);

    let pub = await supertest(ctx.app).get("/api/public/plans");
    expect(pub.body.plans).toEqual([{ code: "hospital", name: "Hospital", perSeatPriceCents: 2500, currency: "USD" }]);

    await dev.patch(`/api/dev/billing/plans/${hidden.body.plan.id}`).send({ showOnWebsite: true });
    await dev.patch(`/api/dev/billing/plans/${shown.body.plan.id}`).send({ archived: true });
    pub = await supertest(ctx.app).get("/api/public/plans");
    expect(pub.body.plans.map((p: { code: string }) => p.code)).toEqual(["internal"]);
  });

  it("files an order request the operator can see and work", async () => {
    const res = await supertest(ctx.app).post("/api/public/purchase-request").send(order());
    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^DT-\d{5}$/);

    const { agent: dev } = await devLogin();
    const list = await dev.get("/api/dev/purchase-requests");
    expect(list.status).toBe(200);
    expect(list.body.requests).toHaveLength(1);
    const r = list.body.requests[0];
    expect(r).toMatchObject({ organizationName: "Riverside Medical Center", email: "jordan.lee@example.org", seats: 40, term: "pilot", planCode: "pilot", status: "new" });
    expect(r.sourceIp).toBeUndefined();

    const upd = await dev.patch(`/api/dev/purchase-requests/${r.id}`).send({ status: "contacted" });
    expect(upd.status).toBe(200);
    expect(upd.body.request.status).toBe("contacted");
    expect((await dev.patch(`/api/dev/purchase-requests/${r.id}`).send({ status: "paid" })).status).toBe(400);
    expect((await dev.patch(`/api/dev/purchase-requests/99999`).send({ status: "declined" })).status).toBe(404);
  });

  it("validates, requires the terms box, refuses unpublished plans, and drops honeypot bots", async () => {
    const bad = await supertest(ctx.app).post("/api/public/purchase-request").send(order({ email: "nope", seats: 0 }));
    expect(bad.status).toBe(400);
    expect(bad.body.fields).toEqual(expect.arrayContaining(["email", "seats"]));
    expect((await supertest(ctx.app).post("/api/public/purchase-request").send(order({ agreeTerms: false }))).status).toBe(400);
    expect((await supertest(ctx.app).post("/api/public/purchase-request").send(order({ planCode: "secret" }))).body.error).toBe("unknown_plan");

    const bot = await supertest(ctx.app).post("/api/public/purchase-request").send(order({ website: "http://spam" }));
    expect(bot.status).toBe(201);
    const { agent: dev } = await devLogin();
    expect((await dev.get("/api/dev/purchase-requests")).body.requests).toHaveLength(0);
  });

  it("keeps the order queue operator-only", async () => {
    expect((await supertest(ctx.app).get("/api/dev/purchase-requests")).status).toBe(401);
    const { agent: director } = await login(ctx.app, { username: "director" });
    expect((await director.get("/api/dev/purchase-requests")).status).toBe(403);
    expect((await director.patch("/api/dev/purchase-requests/1").send({ status: "contacted" })).status).toBe(403);
  });
});
