import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { _resetDemoGate, DEMO_RATE_LIMIT, hashDemoToken } from "../server/demo-gate.js";

const KEY = "owner-key-0123456789abcdefghij";
let ctx: TestContext;
beforeEach(async () => {
  delete process.env.DEMO_ACCESS_KEY;
  _resetDemoGate();
  ctx = await createTestApp();
});
afterEach(async () => {
  delete process.env.DEMO_ACCESS_KEY;
  _resetDemoGate();
  await ctx.handle.close();
});
const cookieFrom = (res: supertest.Response) => String((res.headers["set-cookie"] as unknown as string[] | undefined)?.find((c) => c.startsWith("dt_demo=")) ?? "").split(";")[0]!;

describe("the demo is by invitation", () => {
  it("is off without the key: nothing changes", async () => {
    expect((await supertest(ctx.app).get("/api/config")).status).toBe(200);
    expect((await supertest(ctx.app).get("/demo-access/anything")).headers.location).toBe("/");
  });

  it("with the key set, the app and its API are closed and the website stays open", async () => {
    process.env.DEMO_ACCESS_KEY = KEY;
    const anon = supertest(ctx.app);
    expect((await anon.get("/api/config")).status).toBe(401);
    expect((await anon.get("/api/config")).body).toEqual({ error: "demo_invite_required" });
    expect((await anon.post("/api/login").send({ orgCode: "ISPN", username: "chen", password: DEV_PASSWORD })).status).toBe(401);
    const page = await anon.get("/");
    expect([page.status, page.headers.location]).toEqual([302, "/home?demo=invite"]);
    expect((await anon.get("/Codes.jsx")).status).toBe(302);
    expect((await anon.get("/dist/anything.js")).status).toBe(302);
    // Open: the public site's own API and health.
    expect((await anon.get("/api/public/plans")).status).toBe(200);
    expect((await anon.get("/api/health")).status).toBe(200);
  });

  it("the operator gets in with the key; an invitation works until it ends or is revoked; wrong links do not", async () => {
    process.env.DEMO_ACCESS_KEY = KEY;
    const anon = supertest(ctx.app);
    const owner = await anon.get("/demo-access/" + KEY);
    expect(owner.headers.location).toBe("/");
    const ownerCookie = cookieFrom(owner);
    expect(ownerCookie).toMatch(/^dt_demo=v1\.0\./);
    expect(String(owner.headers["set-cookie"])).toMatch(/HttpOnly/i);

    // The operator signs in (through the gate) and makes a link.
    const dev = supertest.agent(ctx.app);
    dev.jar.setCookie(ownerCookie + "; Path=/");
    const signIn = await dev.post("/api/login").send({ orgCode: "DOCTURN", username: "dev", password: DEV_PASSWORD });
    expect(signIn.status).toBe(200);
    expect((await dev.post("/api/dev/demo-invites").send({ label: "", days: 7 })).status).toBe(400);
    expect((await dev.post("/api/dev/demo-invites").send({ label: "X", days: 90 })).status).toBe(400);
    const made = await dev.post("/api/dev/demo-invites").send({ label: "Dr. Lee, Riverside", days: 7 });
    expect(made.status).toBe(201);
    const path = made.body.path as string;
    // Only a hash is stored.
    const stored = (await ctx.storage.listDemoInvites())[0]!;
    expect(path).not.toContain(stored.tokenHash);
    expect(JSON.stringify(stored)).not.toContain(path.split("/").pop()!);

    const opened = await anon.get(path);
    expect(opened.headers.location).toBe("/");
    const guest = cookieFrom(opened);
    expect((await anon.get("/api/config").set("Cookie", guest)).status).toBe(200);
    const listed = (await dev.get("/api/dev/demo-invites")).body;
    expect(listed.gateOn).toBe(true);
    expect(listed.invites[0]).toMatchObject({ label: "Dr. Lee, Riverside", state: "active", visits: 1 });
    expect(listed.invites[0].firstUsedAt).toBeTruthy();

    // A tampered cookie, a made-up link and someone else's cookie format all fail.
    expect((await anon.get("/api/config").set("Cookie", guest.slice(0, -3) + "abc")).status).toBe(401);
    expect((await anon.get("/demo-access/" + "x".repeat(40))).headers.location).toBe("/home?demo=expired");
    expect((await anon.get("/api/config").set("Cookie", "dt_demo=v1.0.99999999999999.forged")).status).toBe(401);

    // Revoked: the same cookie stops working.
    expect((await dev.delete(`/api/dev/demo-invites/${stored.id}`)).status).toBe(204);
    expect((await anon.get("/api/config").set("Cookie", guest)).status).toBe(401);
    expect((await anon.get(path)).headers.location).toBe("/home?demo=expired");

    // An invitation past its end date is refused even when its link is opened again.
    const ended = "e".repeat(40);
    await ctx.storage.createDemoInvite({ tokenHash: hashDemoToken(ended), label: "Ended", createdBy: null, expiresAt: new Date(Date.now() - 60_000) });
    expect((await anon.get("/demo-access/" + ended)).headers.location).toBe("/home?demo=expired");
    expect((await dev.get("/api/dev/demo-invites")).body.invites.find((x: { label: string }) => x.label === "Ended").state).toBe("expired");
  });

  it("slows down one invitation that makes an unusual number of requests; link guessing is limited", async () => {
    process.env.DEMO_ACCESS_KEY = KEY;
    const row = await ctx.storage.createDemoInvite({ tokenHash: "h".repeat(64), label: "Scraper", createdBy: null, expiresAt: new Date(Date.now() + 86_400_000) });
    void row;
    const anon = supertest(ctx.app);
    let limited = 0;
    for (let i = 0; i < 14; i++) if ((await anon.get("/demo-access/" + "g".repeat(40) + i)).status === 429) limited++;
    expect(limited).toBe(4); // 10 tries a minute
    expect(DEMO_RATE_LIMIT).toBeGreaterThan(500);
  });

  it("non-operators cannot list or create invitations", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    expect((await agent.get("/api/dev/demo-invites")).status).toBe(403);
    expect((await agent.post("/api/dev/demo-invites").send({ label: "x", days: 7 })).status).toBe(403);
  });
});
