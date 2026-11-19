import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import type { Express } from "express";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/auth.js";

/**
 * Automated technical-control checks, in the spirit of a Vanta test run: each
 * test asserts one control against the running app and is tagged with the
 * HIPAA Security Rule citation and SOC 2 criterion it is evidence for. The
 * control matrix (including the controls that are NOT code and so can't be
 * tested here) lives in docs/compliance/README.md. `it.todo` entries are known
 * open gaps — they print on every run so they can't be forgotten.
 *
 * Run with `npm run compliance`.
 */

let ctx: TestContext;
// A second tenant with one clinician, to prove isolation from the seed org.
let otherOrgId: number;

beforeAll(async () => {
  ctx = await createTestApp();
  const other = await ctx.storage.createOrganization({
    name: "Other Hospital",
    code: "OTHER",
    city: null,
    state: null,
    timezone: "America/New_York",
    assignmentTimeoutMin: 15,
    roundRobinShiftTypes: ["day", "night"],
    rotationMode: "lowest_census",
    rotationIndex: 0,
  });
  otherOrgId = other.id;
  const outsider = await ctx.storage.createUser({
    organizationId: other.id,
    username: "outsider",
    passwordHash: await hashPassword(DEV_PASSWORD),
    role: "director",
    displayName: "Dr. Outsider",
    credential: null,
    phone: null,
    twoFactorEnabled: false,
  });
  await ctx.storage.createHospitalist({
    organizationId: other.id,
    userId: outsider.id,
    specialty: "General",
    currentPatientCount: 0,
    patientCap: 12,
    rotationOrder: 0,
    working: true,
    shiftType: "day",
  });
});
afterAll(async () => {
  await ctx.handle.close();
});

/** Every REST route the app registers, with path params filled in. */
function apiRoutes(app: Express): Array<{ method: string; path: string }> {
  const fill: Record<string, string> = { ":code": "ISPN", ":key": "landing", ":token": "t" };
  const stack = (app as unknown as { _router: { stack: any[] } })._router.stack;
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route || typeof route.path !== "string" || !route.path.startsWith("/api/")) continue;
    const path = route.path.replace(/:[A-Za-z]+/g, (p: string) => fill[p] ?? "1");
    for (const method of Object.keys(route.methods)) out.push({ method, path });
  }
  return out;
}

/** Routes that are intentionally reachable without a session. */
const PUBLIC = new Set([
  "get /api/health",
  "post /api/login",
  "post /api/register",
  "post /api/logout",
  "post /api/demo/login", // non-production only; see the production check below
  "post /api/2fa/request-sms", // gated on a pending password login instead
  "post /api/2fa/complete-login",
  "get /api/mobile/org/ISPN", // safe org fields for QR onboarding
]);

describe("Access control — HIPAA §164.312(a)(1), §164.312(d) · SOC 2 CC6.1", () => {
  it("every non-public API route rejects an unauthenticated request with 401", async () => {
    const routes = apiRoutes(ctx.app).filter((r) => !PUBLIC.has(`${r.method} ${r.path}`));
    expect(routes.length).toBeGreaterThan(80); // sanity: we really enumerated them
    const leaks: string[] = [];
    for (const r of routes) {
      const res = await (supertest(ctx.app) as any)[r.method](r.path).send({});
      if (res.status !== 401) leaks.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it("the public allow-list contains only routes that actually exist", () => {
    const all = new Set(apiRoutes(ctx.app).map((r) => `${r.method} ${r.path}`));
    for (const p of PUBLIC) expect(all.has(p), p).toBe(true);
  });

  it("the 2FA endpoints do nothing without a pending password login", async () => {
    const a = await supertest(ctx.app).post("/api/2fa/complete-login").send({ code: "123456" });
    const b = await supertest(ctx.app).post("/api/2fa/request-sms");
    expect([a.status, b.status]).toEqual([401, 401]);
  });

  it("the public org lookup exposes no more than name, code and timezone", async () => {
    const res = await supertest(ctx.app).get("/api/mobile/org/ISPN");
    expect(Object.keys(res.body).sort()).toEqual(["code", "id", "name", "timezone"]);
  });
});

describe("Tenant isolation — HIPAA §164.308(a)(4) · SOC 2 CC6.1, C1.1", () => {
  it("a user of another organization cannot see or act on this tenant's records", async () => {
    const { agent } = await login(ctx.app, { orgCode: "OTHER", username: "outsider" });
    const patientId = ctx.seedResult.patientIds.sc!;
    const pending = await ctx.storage.listPendingForHospitalist(
      ctx.seedResult.orgId,
      ctx.seedResult.hospitalistIds.chen!,
    );
    const assignmentId = pending[0]!.id;

    expect((await agent.get("/api/patients")).body).toEqual([]);
    expect((await agent.get("/api/patient-board")).body).toEqual([]);
    expect((await agent.get("/api/assignments")).body).toEqual([]);
    expect((await agent.get(`/api/patients/${patientId}/consults`)).body).toEqual([]);
    expect((await agent.patch(`/api/assignments/${assignmentId}/accept`)).status).toBe(404);
    expect((await agent.patch(`/api/assignments/${assignmentId}/cancel`)).status).toBe(404);
    expect(
      (await agent.post(`/api/patients/${patientId}/consults`).send({ specialty: "Neuro" })).status,
    ).toBe(404);
    expect((await agent.get("/api/users")).body.map((u: any) => u.username)).toEqual(["outsider"]);
    const audit = await agent.get("/api/audit");
    expect(audit.body.audit.every((a: any) => a.organizationId === otherOrgId)).toBe(true);

    // And nothing was changed on the seed tenant's assignment.
    const a = await ctx.storage.getAssignment(ctx.seedResult.orgId, assignmentId);
    expect(a!.status).toBe("pending");
  });

  it("a user cannot open or post into a conversation they are not part of", async () => {
    const chen = await login(ctx.app, { username: "chen" });
    const convo = await chen.agent
      .post("/api/messaging/conversations")
      .send({ participantIds: [ctx.seedResult.userIds["er.doc"]] });
    const id = convo.body.id as number;

    const sameOrgStranger = await login(ctx.app, { username: "patel" });
    expect((await sameOrgStranger.agent.get(`/api/messaging/conversations/${id}/messages`)).status).toBe(403);
    expect(
      (await sameOrgStranger.agent.post("/api/messaging/send").send({ conversationId: id, content: "x" })).status,
    ).toBe(403);

    const outsider = await login(ctx.app, { orgCode: "OTHER", username: "outsider" });
    expect((await outsider.agent.get(`/api/messaging/conversations/${id}/messages`)).status).toBe(404);
    expect(
      (await outsider.agent
        .post("/api/messaging/conversations")
        .send({ participantIds: [ctx.seedResult.userIds.chen] })).status,
    ).toBe(400);
  });
});

describe("Least privilege — HIPAA §164.308(a)(3), §164.502(b) · SOC 2 CC6.3", () => {
  it("platform operators cannot read tenant PHI through the patient board", async () => {
    const { agent } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    expect((await agent.get("/api/patient-board")).status).toBe(403);
  });

  it("clinicians cannot reach audit, admin or cross-tenant endpoints", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    for (const path of ["/api/audit", "/api/users", "/api/dev/organizations", "/api/dev/users", "/api/sms/history", "/api/registrations"]) {
      expect((await agent.get(path)).status, path).toBe(403);
    }
    expect((await agent.post("/api/dev/impersonate").send({ userId: 1 })).status).toBe(403);
    expect((await agent.post("/api/maintenance/purge").send({})).status).toBe(403);
  });

  it("nobody can self-register into the developer (root) role", async () => {
    const res = await supertest(ctx.app).post("/api/register").send({
      orgCode: "ISPN",
      username: "sneaky",
      password: "s3cret-pass",
      displayName: "Sneaky",
      requestedRole: "developer",
    });
    expect(res.status).toBe(400);
  });
});

describe("Authentication — HIPAA §164.312(d), §164.308(a)(5)(ii)(D) · SOC 2 CC6.1", () => {
  it("stores passwords only as salted scrypt hashes and never returns them", async () => {
    const users = await ctx.storage.listUsers(ctx.seedResult.orgId);
    for (const u of users) {
      expect(u.passwordHash).toMatch(/^[0-9a-f]{128}\.[0-9a-f]{32}$/);
      expect(u.passwordHash).not.toContain(DEV_PASSWORD);
    }
    // A fresh random salt per hash: the same password never hashes the same.
    expect(await hashPassword("same-password")).not.toBe(await hashPassword("same-password"));

    const { agent, res } = await login(ctx.app, { username: "director" });
    const bodies = JSON.stringify([res.body, (await agent.get("/api/users")).body, (await agent.get("/api/user")).body]);
    expect(bodies).not.toMatch(/passwordHash|password_hash/);
  });

  it("gives the same answer for a wrong password and an unknown user", async () => {
    const wrong = await supertest(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "lopez", password: "nope" });
    const unknown = await supertest(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "no-such-user", password: "nope" });
    expect([wrong.status, wrong.body]).toEqual([unknown.status, unknown.body]);
  });

  it("locks an account after five consecutive failed logins", async () => {
    const attempt = (password: string) =>
      supertest(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "gopal", password });
    for (let i = 0; i < 5; i++) await attempt("wrong");
    expect((await attempt(DEV_PASSWORD)).status).toBe(429);
  });

  it.todo("GAP: passwords shorter than 8 characters are accepted (registerSchema / createProviderSchema min is 6)");
  it.todo("GAP: MFA is optional for every role, including director and developer");
  it.todo("GAP: no change-password or reset flow exists; accounts keep their provisioning password");
});

describe("Session management — HIPAA §164.312(a)(2)(iii) · SOC 2 CC6.1", () => {
  it("issues an HttpOnly, SameSite session cookie that idles out after 15 minutes", async () => {
    const { res } = await login(ctx.app, { username: "liu" });
    const cookie = String((res.headers["set-cookie"] as unknown as string[])[0]);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const expires = new Date(/Expires=([^;]+)/i.exec(cookie)![1]!).getTime();
    expect(expires - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    expect(expires - Date.now()).toBeGreaterThan(14 * 60 * 1000);
  });

  it("marks the cookie Secure in production and does not expose demo sign-in there", async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const prod = createApp({ sessionSecret: "x", rateLimiting: false, trustProxy: true });
      const res = await supertest(prod)
        .post("/api/login")
        .set("X-Forwarded-Proto", "https")
        .send({ orgCode: "ISPN", username: "liu", password: DEV_PASSWORD });
      expect(res.status).toBe(200);
      expect(String((res.headers["set-cookie"] as unknown as string[])[0])).toMatch(/; Secure/i);

      const demo = await supertest(prod)
        .post("/api/demo/login")
        .send({ orgCode: "ISPN", username: "liu", password: DEV_PASSWORD });
      expect(demo.status).toBe(404);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it("invalidates the session on logout", async () => {
    const { agent } = await login(ctx.app, { username: "malhotra" });
    await agent.post("/api/logout");
    expect((await agent.get("/api/patients")).status).toBe(401);
  });

  it.todo("GAP: sessions live in process memory (MemoryStore) — lost on restart, not shareable across instances");
});

describe("Audit controls — HIPAA §164.312(b), §164.308(a)(1)(ii)(D) · SOC 2 CC7.2", () => {
  it("records who read PHI, from where, on every PHI route", async () => {
    const { agent } = await login(ctx.app, { username: "williams" });
    const before = await ctx.storage.countPhiAccess(ctx.seedResult.orgId);
    const reads = ["/api/patients", "/api/assignments/pending", "/api/assignments/my", "/api/patient-board", "/api/mobile/assignments", `/api/patients/${ctx.seedResult.patientIds.sc}/consults`];
    for (const path of reads) expect((await agent.get(path)).status, path).toBe(200);
    expect(await ctx.storage.countPhiAccess(ctx.seedResult.orgId)).toBe(before + reads.length);

    const [latest] = await ctx.storage.listPhiAccess(ctx.seedResult.orgId, 1);
    expect(latest!.userId).toBe(ctx.seedResult.userIds.williams);
    expect(latest!.method).toBe("GET");
    expect(latest!.ip).toBeTruthy();
  });

  it("writes an audit row for sign-in, failed sign-in and privileged changes", async () => {
    await supertest(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "kohan", password: "bad" });
    const { agent } = await login(ctx.app, { username: "director" });
    await agent.patch("/api/org/config").send({ assignmentTimeoutMin: 12 });
    await agent.patch("/api/feature-flags").send({ flag: "x", enabled: true });

    const actions = (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100)).map((a) => a.action);
    for (const expected of ["auth.login", "auth.login_failed", "org.config_update", "feature_flag.set"]) {
      expect(actions, expected).toContain(expected);
    }
  });

  it("offers no API to edit or delete an audit or PHI-access record", () => {
    const mutating = apiRoutes(ctx.app).filter(
      (r) => r.method !== "get" && /audit|phi/i.test(r.path),
    );
    expect(mutating).toEqual([]);
  });

  it.todo("GAP: deleting an organization also deletes its audit_logs and phi_access_logs (6-year retention, §164.316(b)(2))");
  it.todo("GAP: audit rows are plain table rows — no hash chain / write-once storage to prove they were not altered (§164.312(c)(1))");
});

describe("Transmission & platform hardening — HIPAA §164.312(e)(1) · SOC 2 CC6.6, CC6.7", () => {
  it("sends HSTS, no-sniff and anti-framing headers and hides the framework banner", async () => {
    const res = await supertest(ctx.app).get("/api/health");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeTruthy();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns a generic error body — no stack trace or SQL — on a server fault", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await agent.post("/api/beds").send({ label: "X", departmentId: 987654 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal_error" });
  });

  it("rate-limits sign-in attempts per client when rate limiting is on", async () => {
    const limited = createApp({ sessionSecret: "x" });
    // 50 attempts per 15 minutes are allowed; the 51st is refused.
    let last = 0;
    for (let i = 0; i < 51; i++) {
      last = (await supertest(limited).post("/api/login").send({})).status;
      if (i === 49) expect(last).toBe(400);
    }
    expect(last).toBe(429);
  });

  it.todo("GAP: Content-Security-Policy is disabled (the served UI compiles JSX in the browser and needs inline/eval)");
  it.todo("GAP: TOTP secrets and message bodies are stored unencrypted at the application layer (relies on database encryption at rest)");
  it.todo("GAP: render.yaml ships RATE_LIMIT=off and the shared demo password for the public demo deployment");
});
