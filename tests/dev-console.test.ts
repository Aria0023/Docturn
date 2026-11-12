import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignments } from "@shared/schema";
import { attachWebSocket, liveSocketStats } from "../server/ws/index.js";
import {
  _resetRequestMetrics,
  apiLatencySummary,
  assessHealth,
  recordApiRequest,
} from "../server/services/request-metrics.js";
import { DEV_PASSWORD } from "../server/seed.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * The developer console's server contract (A.CON developer #1, #12, #14,
 * #15, #16, #18). Every number and every option the console shows must be one
 * these routes compute or enforce:
 *
 *   #1   There is no "local" (single-tenant) developer: every developer
 *        account has cross-tenant root. So a developer account can only be
 *        created in the platform org — POST /api/dev/users refuses role
 *        "developer" in a tenant (it would be root wearing a tenant's badge) —
 *        and the platform org holds no clinical accounts.
 *   #12  GET /api/audit carries the trail's TRUE size (auditCount), not the
 *        length of its latest-100 page.
 *   #14  GET /api/dev/organizations/:id/audit and …/settings report the
 *        tenant's true audit count (countAuditLogs), not a capped page length.
 *   #15/16  GET /api/dev/platform-health: measured, this-instance numbers —
 *        database round trip and pool, API latency percentiles over a window
 *        of real requests, live WebSocket connections, process uptime.
 *   #18  GET /api/dev/organizations carries each tenant's assignments created
 *        in the last 24 hours.
 */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
  _resetRequestMetrics();
});
afterEach(async () => {
  await ctx.handle.close();
});

const devLogin = () => login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
const as = async (username: string, orgCode = "ISPN") => (await login(ctx.app, { username, orgCode })).agent;

// ── #1 Developer scope ──────────────────────────────────────────────────────
describe("#1 developer accounts are platform-wide, so they live in the platform org", () => {
  it("refuses a developer account in a tenant org (it would be cross-tenant root) and creates nothing", async () => {
    const { agent: dev } = await devLogin();
    const res = await dev.post("/api/dev/users").send({
      organizationId: ctx.seedResult.orgId,
      role: "developer",
      displayName: "Sweep Local Dev",
      username: "sweep.localdev",
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "developer_platform_org_only" });
    expect(await ctx.storage.getUserByUsername(ctx.seedResult.orgId, "sweep.localdev")).toBeFalsy();
    const rows = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 500);
    expect(rows.some((r) => r.action === "dev.user_create")).toBe(false);
  });

  it("creates a developer in the platform org; the list shows it there, with the one-time password", async () => {
    const { agent: dev } = await devLogin();
    const res = await dev.post("/api/dev/users").send({
      organizationId: ctx.seedResult.platformOrgId,
      role: "developer",
      displayName: "Second Operator",
      username: "ops.two",
    });
    expect(res.status).toBe(201);
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect(res.body.mustChangePassword).toBe(true);
    const list = (await dev.get("/api/dev/users").expect(200)).body as any[];
    expect(list.find((u) => u.username === "ops.two")).toMatchObject({ role: "developer", org: "DOCTURN" });
    const rows = await ctx.storage.listAuditLogs(ctx.seedResult.platformOrgId, 500);
    expect(rows.find((r) => r.action === "dev.user_create")).toMatchObject({ riskLevel: "high" });
  });

  it("the platform org holds operators only: a clinical account there is refused", async () => {
    const { agent: dev } = await devLogin();
    for (const role of ["hospitalist", "director", "er_doctor", "er_director"]) {
      const res = await dev.post("/api/dev/users").send({
        organizationId: ctx.seedResult.platformOrgId,
        role,
        displayName: "Misplaced " + role,
        username: "misplaced." + role.replace("_", ""),
      });
      expect(res.status, role).toBe(400);
      expect(res.body).toEqual({ error: "platform_org_operators_only" });
    }
  });

  it("clinical accounts in a tenant are unchanged (201)", async () => {
    const { agent: dev } = await devLogin();
    await dev.post("/api/dev/users").send({ organizationId: ctx.seedResult.orgId, role: "hospitalist", displayName: "Dr. Real", username: "dr.real" }).expect(201);
  });
});

// ── #18 Assignments / 24h ───────────────────────────────────────────────────
describe("#18 GET /api/dev/organizations counts each tenant's assignments of the last 24 h", () => {
  it("matches the assignments table, and an older assignment is not counted", async () => {
    const { agent: dev } = await devLogin();
    const ispnRows = await ctx.handle.db.select().from(assignments).where(eq(assignments.organizationId, ctx.seedResult.orgId));
    expect(ispnRows.length).toBeGreaterThan(0);
    const list = (await dev.get("/api/dev/organizations").expect(200)).body as any[];
    const ispn = list.find((o) => o.id === ctx.seedResult.orgId);
    expect(ispn.assignments24h).toBe(ispnRows.length);
    for (const o of list.filter((x) => x.id !== ctx.seedResult.orgId)) expect(o.assignments24h, o.code).toBe(0);
    // Back-date one row to two days ago: it leaves the window.
    await ctx.handle.db.update(assignments).set({ createdAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(assignments.id, ispnRows[0]!.id));
    const again = (await dev.get("/api/dev/organizations").expect(200)).body as any[];
    expect(again.find((o) => o.id === ctx.seedResult.orgId).assignments24h).toBe(ispnRows.length - 1);
    // No invented tenant status: the server has no active/suspended concept.
    expect(again.every((o) => !("active" in o) && !("suspended" in o))).toBe(true);
  });
});

// ── #12 / #14 Audit counts ─────────────────────────────────────────────────
async function fillAudit(orgId: number, n: number) {
  for (let i = 0; i < n; i++) {
    await ctx.storage.appendAudit({ organizationId: orgId, userId: null, action: "test.fill", resourceType: "test", resourceId: i, details: {}, riskLevel: "low" });
  }
}

describe("#12/#14 audit counts are the trail's true size, not a page length", () => {
  it("GET /api/dev/organizations/:id/audit: a 100-row page, and auditCount = countAuditLogs (incl. its own read row)", async () => {
    await fillAudit(ctx.seedResult.orgId, 110);
    const { agent: dev } = await devLogin();
    const res = await dev.get(`/api/dev/organizations/${ctx.seedResult.orgId}/audit`).expect(200);
    expect(res.body.audit).toHaveLength(100);
    const total = await ctx.storage.countAuditLogs(ctx.seedResult.orgId);
    expect(total).toBeGreaterThan(110);
    expect(res.body.auditCount).toBe(total);
    expect(res.body.phiAccessCount).toBe(await ctx.storage.countPhiAccess(ctx.seedResult.orgId));
    // The cross-tenant overview (filed in the platform org) agrees exactly.
    const overview = (await dev.get("/api/dev/compliance-overview").expect(200)).body as any[];
    expect(overview.find((o) => o.id === ctx.seedResult.orgId).auditCount).toBe(total);
  });

  it("GET /api/dev/organizations/:id/settings: compliance.auditCount is the true total", async () => {
    await fillAudit(ctx.seedResult.orgId, 105);
    const { agent: dev } = await devLogin();
    const res = await dev.get(`/api/dev/organizations/${ctx.seedResult.orgId}/settings`).expect(200);
    expect(res.body.compliance.auditCount).toBe(await ctx.storage.countAuditLogs(ctx.seedResult.orgId));
    expect(res.body.compliance.auditCount).toBeGreaterThan(100);
  });

  it("GET /api/audit (developer: the platform org's trail; director: their org's) carries auditCount", async () => {
    await fillAudit(ctx.seedResult.platformOrgId, 120);
    const { agent: dev } = await devLogin();
    const mine = await dev.get("/api/audit").expect(200);
    expect(mine.body.audit.length).toBeLessThanOrEqual(100);
    expect(mine.body.auditCount).toBe(await ctx.storage.countAuditLogs(ctx.seedResult.platformOrgId));
    expect(mine.body.audit.every((r: any) => r.organizationId === ctx.seedResult.platformOrgId)).toBe(true);
    const director = await as("director");
    const theirs = await director.get("/api/audit").expect(200);
    expect(theirs.body.auditCount).toBe(await ctx.storage.countAuditLogs(ctx.seedResult.orgId));
  });
});

// ── #15/#16 Platform health ────────────────────────────────────────────────
describe("#15/#16 GET /api/dev/platform-health reports measured numbers", () => {
  it("developer only", async () => {
    for (const u of ["director", "chen", "er.director"]) {
      const a = await as(u);
      await a.get("/api/dev/platform-health").expect(403);
    }
    await supertest(ctx.app).get("/api/dev/platform-health").expect(401);
  });

  it("database round trip, request latency over real requests, uptime; no socket hub → null, not a number", async () => {
    const { agent: dev } = await devLogin();
    for (let i = 0; i < 6; i++) await dev.get("/api/user").expect(200);
    const res = await dev.get("/api/dev/platform-health").expect(200);
    const h = res.body;
    expect(h.status).toBe("operational");
    expect(h.issues).toEqual([]);
    expect(typeof h.checkedAt).toBe("string");
    expect(h.database).toMatchObject({ ok: true, storage: "pglite-memory", pool: null });
    expect(typeof h.database.roundTripMs).toBe("number");
    expect(h.database.roundTripMs).toBeGreaterThanOrEqual(0);
    // Every /api request this test made (login + 6 × /api/user), measured.
    expect(h.api.windowSec).toBe(300);
    expect(h.api.requests).toBeGreaterThanOrEqual(7);
    expect(h.api.p50Ms).toBeGreaterThanOrEqual(0);
    expect(h.api.p95Ms).toBeGreaterThanOrEqual(h.api.p50Ms);
    expect(h.api.serverErrors).toBe(0);
    expect(h.websocket).toBeNull();
    expect(h.instance.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(h.instance.startedAt))).toBe(false);
    // Nothing invented: no "uptime percentage" the server never measured.
    expect(JSON.stringify(h)).not.toMatch(/99\.98|uptime30d|uptimePct/);
    // Filed in the operator's (platform) trail, ids only.
    const rows = await ctx.storage.listAuditLogs(ctx.seedResult.platformOrgId, 50);
    expect(rows.find((r) => r.action === "dev.platform_health")).toMatchObject({ riskLevel: "low", details: {} });
  });

  it("counts this instance's live WebSocket connections (and drops a closed one)", async () => {
    const server: Server = createServer(ctx.app);
    const hub = attachWebSocket(server, ctx.app.locals.sessionMiddleware as RequestHandler);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const cookieFor = async (username: string, orgCode: string) => {
      const r = await supertest(ctx.app).post("/api/login").send({ orgCode, username, password: DEV_PASSWORD });
      const raw = r.headers["set-cookie"];
      return String(Array.isArray(raw) ? raw[0] : raw).split(";")[0]!;
    };
    const open = (cookie: string) => new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
      ws.on("message", (d: Buffer) => { if (JSON.parse(d.toString()).type === "CONNECTION_ESTABLISHED") resolve(ws); });
      ws.on("error", reject);
    });
    try {
      const devCookie = await cookieFor("dev", "DOCTURN");
      const a = await open(devCookie);
      const b = await open(await cookieFor("chen", "ISPN"));
      const c = await open(await cookieFor("chen", "ISPN"));
      expect(liveSocketStats()).toEqual({ connections: 3, users: 2 });
      const h = (await supertest(ctx.app).get("/api/dev/platform-health").set("Cookie", devCookie).expect(200)).body;
      expect(h.websocket).toEqual({ connections: 3, users: 2 });
      await new Promise<void>((r) => { c.once("close", () => r()); c.close(); });
      for (let i = 0; i < 50 && liveSocketStats()!.connections !== 2; i++) await new Promise((r) => setTimeout(r, 10));
      expect(liveSocketStats()).toEqual({ connections: 2, users: 2 });
      a.close(); b.close();
    } finally {
      hub.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
    // A closed hub is not a live count.
    expect(liveSocketStats()).toBeNull();
  });
});

describe("request metrics (the latency the health card shows)", () => {
  it("percentiles over the window, old samples dropped, 5xx counted, degraded on a 5xx burst", () => {
    _resetRequestMetrics();
    const now = 1_000_000_000;
    // 100 requests of 1..100 ms inside the window, 50 slow ones outside it.
    for (let i = 1; i <= 100; i++) recordApiRequest(i, 200, now - 1_000);
    for (let i = 0; i < 50; i++) recordApiRequest(10_000, 200, now - 301_000);
    let s = apiLatencySummary(now);
    expect(s).toMatchObject({ windowSec: 300, requests: 100, serverErrors: 0 });
    expect(s.p50Ms).toBe(50);
    expect(s.p95Ms).toBe(95);
    for (let i = 0; i < 10; i++) recordApiRequest(5, 503, now - 500);
    s = apiLatencySummary(now);
    expect(s.requests).toBe(110);
    expect(s.serverErrors).toBe(10);
    // 10/110 server errors (> 5 % of ≥ 20 requests) → degraded, with the reason.
    expect(assessHealth({ dbOk: true, api: s, pool: null })).toEqual({ status: "degraded", issues: ["10 of 110 API requests failed with a server error in the last 5 min"] });
    expect(assessHealth({ dbOk: false, api: s, pool: null }).issues[0]).toBe("database unreachable");
    expect(assessHealth({ dbOk: true, api: { ...s, serverErrors: 0 }, pool: { total: 10, idle: 0, waiting: 3, max: 10 } })).toEqual({ status: "degraded", issues: ["3 queries waiting for a database connection"] });
    expect(assessHealth({ dbOk: true, api: { ...s, serverErrors: 0 }, pool: null })).toEqual({ status: "operational", issues: [] });
    _resetRequestMetrics();
    expect(apiLatencySummary(now)).toMatchObject({ requests: 0, p50Ms: null, p95Ms: null });
  });
});
