import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { _setDemoTimingForTests, stopAllLiveDemos } from "../server/services/demo-live.js";

/**
 * Live demo: on a synthetic instance the driver acts as the seeded demo
 * accounts through the real endpoints. It never acts as an account that has
 * the app open, and the feature does not exist on a real-PHI instance.
 */
let ctx: TestContext;
let server: Server;
let base: string;

beforeEach(async () => {
  ctx = await createTestApp();
  server = ctx.app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  _setDemoTimingForTests({ tickMs: 250, respondAfterMs: 0, statAckAfterMs: 0 });
});
afterEach(async () => {
  stopAllLiveDemos();
  delete process.env.SYNTHETIC_DATA;
  await new Promise((r) => server.close(r));
  await ctx.handle.close();
});

async function signIn(username: string, orgCode = "ISPN") {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgCode, username, password: "docturn" }) });
  expect(r.status).toBe(200);
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return (method: string, path: string, body?: unknown) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async (x) => ({ status: x.status, json: (await x.json().catch(() => null)) as any }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("live demo", () => {
  it("produces real admissions, messages and accepts, never acting as the viewer", async () => {
    const director = await signIn("director");
    const org0 = (await ctx.storage.getOrganizationByCode("ISPN"))!;
    const before = (await ctx.storage.listPatients(org0.id)).length;
    const on = await director("POST", "/api/demo/live", { on: true, pace: "busy" });
    expect(on.status).toBe(200);
    expect(on.json.running).toBe(true);

    for (let i = 0; i < 40; i++) { await director("GET", "/api/demo/live"); await sleep(250); }
    const st = (await director("GET", "/api/demo/live")).json;
    expect(st.running).toBe(true);
    expect(st.events.length).toBeGreaterThan(3);

    const org = (await ctx.storage.getOrganizationByCode("ISPN"))!;
    const users = await ctx.storage.listUsers(org.id);
    const directorId = users.find((u) => u.username === "director")!.id;
    expect((await ctx.storage.listPatients(org.id)).length).toBeGreaterThan(before);
    const audit = await ctx.storage.listAuditLogs(org.id);
    const driven = audit.filter((a) => ["assignment.create", "assignment.accept"].includes(a.action));
    expect(driven.length).toBeGreaterThan(0);
    // Nothing was done AS the director, who had the app open the whole time.
    expect(driven.every((a) => a.userId !== directorId)).toBe(true);
    expect(audit.some((a) => a.action === "demo.live_start" && a.userId === directorId)).toBe(true);

    const off = await director("POST", "/api/demo/live", { on: false });
    expect(off.json.running).toBe(false);
  }, 30_000);

  it("validates input and is refused for the platform org", async () => {
    const director = await signIn("director");
    expect((await director("POST", "/api/demo/live", { on: "yes" })).status).toBe(400);
    expect((await director("POST", "/api/demo/live", { on: true, pace: "frantic" })).status).toBe(400);
    const dev = await signIn("dev", "DOCTURN");
    expect((await dev("POST", "/api/demo/live", { on: true })).json.error).toBe("clinical_org_only");
    expect((await fetch(base + "/api/demo/live")).status).toBe(401);
  });

  it("does not exist on a real-PHI instance", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    process.env.SYNTHETIC_DATA = "false";
    expect((await agent.get("/api/demo/live")).status).toBe(404);
    expect((await agent.post("/api/demo/live").send({ on: true })).status).toBe(404);
  });
});
