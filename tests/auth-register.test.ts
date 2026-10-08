import { beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { sql } from "drizzle-orm";
import { createApp } from "../server/app.js";
import { isUniqueViolation } from "../server/auth.js";
import { createTestDb } from "../server/db.js";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";

/**
 * Public self-registration and the director's approval queue:
 *   A.CON-SHO-15 — no registration against the platform org; privileged roles
 *                  cannot be self-requested; successes are rate limited;
 *   A.CON-SHO-11 — the endpoint is not a username oracle;
 *   A.CON-SHO-8  — one pending request per (org, username), approve/deny are
 *                  idempotent and never hang on the users unique index;
 *   A.CON-SHO-16 — the self-chosen password meets the same floor as a change.
 */

const GOOD = "Fresh-Pass-11";

function register(ctx: TestContext, body: Record<string, unknown>) {
  return supertest(ctx.app)
    .post("/api/register")
    .send({ orgCode: "ISPN", displayName: "Dr. Test", requestedRole: "hospitalist", password: GOOD, ...body });
}

describe("self-registration", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("never queues a request for the platform org (any casing) — it is handled exactly like a nonexistent org", async () => {
    for (const orgCode of ["DOCTURN", "docturn", "DocTurn", "NOPE"]) {
      const res = await register(ctx, { orgCode, username: `wannabe.root.${orgCode}` });
      // The same answer a real org gives (see the org-oracle test below).
      expect(res.status, orgCode).toBe(201);
      expect(res.body).toEqual({ pending: true });
    }
    // Refused for real: nothing reached the operator tenant's queue (or any queue).
    const platformRows = await ctx.storage.listPendingRegistrations(ctx.seedResult.platformOrgId);
    expect(platformRows).toEqual([]);
    expect(await ctx.storage.listPendingRegistrations(ctx.seedResult.orgId)).toEqual([]);
    const { agent: dev, res: devLogin } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    expect(devLogin.status).toBe(200);
    const devQueue = await dev.get("/api/registrations").expect(200);
    expect(devQueue.body).toEqual([]);
    // The operator can still see that someone tried (platform-org audit, low risk).
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.platformOrgId, 50);
    const unrouted = audit.filter((a) => a.action === "auth.register_unrouted");
    expect(unrouted).toHaveLength(4);
    expect(unrouted.map((a) => (a.details as { reason?: string }).reason).sort()).toEqual([
      "platform_org",
      "platform_org",
      "platform_org",
      "unknown_org",
    ]);
  });

  it("is not an org oracle: an unknown org, the platform org and a real org answer alike — 201, then 409 — at the same cost", async () => {
    // First submission: identical 201 whether or not the org exists.
    const real = await register(ctx, { orgCode: "ISPN", username: "probe.user" });
    const unknown = await register(ctx, { orgCode: "NOPE", username: "probe.user" });
    const platform = await register(ctx, { orgCode: "DOCTURN", username: "probe.user" });
    for (const r of [real, unknown, platform]) {
      expect(r.status).toBe(201);
      expect(r.body).toEqual({ pending: true });
    }
    // Re-submission: identical 409 request_pending in every case (and the
    // org code is matched case-insensitively in every case, like the lookup).
    for (const orgCode of ["ISPN", "ispn", "NOPE", "nope", "DOCTURN", "docturn"]) {
      const again = await register(ctx, { orgCode, username: "probe.user" });
      expect(again.status, orgCode).toBe(409);
      expect(again.body, orgCode).toEqual({ error: "request_pending" });
    }
    // A different name at the unknown org is a fresh request, exactly like at a real one.
    expect((await register(ctx, { orgCode: "NOPE", username: "probe.other" })).status).toBe(201);
    expect((await register(ctx, { orgCode: "ISPN", username: "probe.other" })).status).toBe(201);
    // Only the real org's queue holds anything.
    const rows = await ctx.storage.listPendingRegistrations(ctx.seedResult.orgId);
    expect(rows.map((r) => r.username).sort()).toEqual(["probe.other", "probe.user"]);
    expect(await ctx.storage.listPendingRegistrations(ctx.seedResult.platformOrgId)).toEqual([]);

    // Timing: every first submission pays one password hash, so an unknown
    // org is not answered in ~5 ms against ~250+ ms for a real one.
    async function medianMs(orgCode: string, prefix: string): Promise<number> {
      const samples: number[] = [];
      for (let i = 0; i < 4; i++) {
        const t = process.hrtime.bigint();
        const res = await register(ctx, { orgCode, username: `${prefix}.${i}` });
        samples.push(Number(process.hrtime.bigint() - t) / 1e6);
        expect(res.status).toBe(201);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)]!;
    }
    await register(ctx, { orgCode: "ISPN", username: "warm.up" }); // first scrypt's cold start
    const realMs = await medianMs("ISPN", "t.real");
    const unknownMs = await medianMs("NOPE", "t.unknown");
    const platformMs = await medianMs("DOCTURN", "t.platform");
    expect(unknownMs).toBeGreaterThan(realMs * 0.5);
    expect(platformMs).toBeGreaterThan(realMs * 0.5);
    expect(realMs).toBeGreaterThan(unknownMs * 0.5);
    expect(realMs).toBeGreaterThan(platformMs * 0.5);
  });

  it("an unrouted request keeps no credential: only an opaque key of (org code, username) is stored", async () => {
    expect((await register(ctx, { orgCode: "NOPE", username: "secret.name", password: "Unique-Marker-Pass-9" })).status).toBe(201);
    const rows = (await ctx.handle.db.execute(sql`SELECT * FROM unrouted_registrations`)).rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("secret.name");
    expect(text).not.toContain("NOPE");
    expect(text).not.toContain("Unique-Marker-Pass-9");
    expect(text).not.toMatch(/\$scrypt\$/);
    expect(String(rows[0]!.request_key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses privileged roles (director / er_director / developer) with a precise error", async () => {
    for (const requestedRole of ["director", "er_director", "developer", "root"]) {
      const res = await register(ctx, { username: "wannabe.admin", requestedRole });
      expect(res.status, requestedRole).toBe(400);
      expect(res.body).toEqual({ error: "role_not_self_registrable" });
    }
    expect(await ctx.storage.listPendingRegistrations(ctx.seedResult.orgId)).toEqual([]);
    // The clinical roles are still requestable; omitting the role defaults to hospitalist.
    expect((await register(ctx, { username: "er.new", requestedRole: "er_doctor" })).status).toBe(201);
    const res = await register(ctx, { username: "default.role", requestedRole: undefined });
    expect(res.status).toBe(201);
    const rows = await ctx.storage.listPendingRegistrations(ctx.seedResult.orgId);
    expect(rows.find((r) => r.username === "default.role")?.requestedRole).toBe("hospitalist");
  });

  it("applies the same password floor as a password change (8+ chars, never the demo password)", async () => {
    expect((await register(ctx, { username: "short.pw", password: "Abc1234" })).status).toBe(400); // 7 chars
    const demo = await register(ctx, { username: "demo.pw", password: DEV_PASSWORD });
    expect(demo.status).toBe(400);
    expect(demo.body).toEqual({ error: "weak_password" });
    const upper = await register(ctx, { username: "demo.pw", password: "PASSWORD" });
    expect(upper.status).toBe(400);
    expect(upper.body).toEqual({ error: "weak_password" });
    expect((await register(ctx, { username: "ok.pw", password: "Abc12345" })).status).toBe(201);
  });

  it("is not a username oracle: a taken username is accepted like a fresh one, and re-submits answer 409 in both cases", async () => {
    // "chen" exists, "brand.new" does not — the anonymous caller sees no difference.
    const taken = await register(ctx, { username: "chen" });
    const fresh = await register(ctx, { username: "brand.new" });
    expect(taken.status).toBe(201);
    expect(fresh.status).toBe(201);
    expect(taken.body).toEqual(fresh.body);

    const takenAgain = await register(ctx, { username: "chen" });
    const freshAgain = await register(ctx, { username: "brand.new" });
    expect(takenAgain.status).toBe(409);
    expect(freshAgain.status).toBe(409);
    expect(takenAgain.body).toEqual({ error: "request_pending" });
    expect(freshAgain.body).toEqual(takenAgain.body);

    // Exactly one pending row each — the second submission created nothing.
    const rows = await ctx.storage.listPendingRegistrations(ctx.seedResult.orgId);
    expect(rows.filter((r) => r.username === "chen")).toHaveLength(1);
    expect(rows.filter((r) => r.username === "brand.new")).toHaveLength(1);

    // The reviewer (who legitimately knows the roster) sees which one collides.
    const { agent: director } = await login(ctx.app, { username: "director" });
    const queue = await director.get("/api/registrations").expect(200);
    const byName = new Map((queue.body as Array<{ username: string; usernameTaken: boolean }>).map((r) => [r.username, r]));
    expect(byName.get("chen")?.usernameTaken).toBe(true);
    expect(byName.get("brand.new")?.usernameTaken).toBe(false);
    expect(JSON.stringify(queue.body)).not.toMatch(/passwordHash/);
  });

  it("the partial unique index stops two racing submissions and the violation is recognised", async () => {
    const row = {
      organizationId: ctx.seedResult.orgId,
      username: "racer",
      passwordHash: "x",
      displayName: "Racer",
      requestedRole: "hospitalist" as const,
      status: "pending" as const,
    };
    await ctx.storage.createPendingRegistration(row);
    let caught: unknown = null;
    try {
      await ctx.storage.createPendingRegistration(row);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(isUniqueViolation(caught)).toBe(true);
    expect(isUniqueViolation(new Error("something else"))).toBe(false);
    // A denied request frees the name for a new request (the index is partial).
    const [first] = await ctx.storage.listPendingRegistrations(ctx.seedResult.orgId);
    await ctx.storage.updatePendingRegistration(ctx.seedResult.orgId, first!.id, { status: "rejected" });
    await expect(ctx.storage.createPendingRegistration(row)).resolves.toBeTruthy();
  });

  it("approve is idempotent and never hangs: second approve → 200 same userId; deny after approve → 409", async () => {
    expect((await register(ctx, { username: "approvee" })).status).toBe(201);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const queue = await director.get("/api/registrations").expect(200);
    const reg = (queue.body as Array<{ id: number; username: string }>).find((r) => r.username === "approvee")!;

    const first = await director.post(`/api/registrations/${reg.id}/approve`).expect(201);
    expect(typeof first.body.userId).toBe("number");
    const second = await director.post(`/api/registrations/${reg.id}/approve`).expect(200);
    expect(second.body).toEqual({ userId: first.body.userId, alreadyApproved: true });
    // Exactly one account and one rotation profile were created.
    const users = (await ctx.storage.listUsers(ctx.seedResult.orgId)).filter((u) => u.username === "approvee");
    expect(users).toHaveLength(1);
    expect(await ctx.storage.getHospitalistByUser(ctx.seedResult.orgId, users[0]!.id)).toBeTruthy();

    const deny = await director.post(`/api/registrations/${reg.id}/deny`);
    expect(deny.status).toBe(409);
    expect(deny.body).toEqual({ error: "already_approved" });

    // The approved person can sign in with the password they requested.
    const { res } = await login(ctx.app, { username: "approvee", password: GOOD });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("hospitalist");

    // The queue no longer lists it.
    const after = await director.get("/api/registrations").expect(200);
    expect((after.body as Array<{ username: string }>).some((r) => r.username === "approvee")).toBe(false);
  });

  it("approving a request whose username is already an account answers 409 and leaves it for deny", async () => {
    expect((await register(ctx, { username: "chen" })).status).toBe(201);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const queue = await director.get("/api/registrations").expect(200);
    const reg = (queue.body as Array<{ id: number; username: string }>).find((r) => r.username === "chen")!;

    const approve = await director.post(`/api/registrations/${reg.id}/approve`);
    expect(approve.status).toBe(409);
    expect(approve.body).toEqual({ error: "username_taken" });
    // Still exactly one "chen", with the ORIGINAL credential — the stranger's hash was never installed.
    const chens = (await ctx.storage.listUsers(ctx.seedResult.orgId)).filter((u) => u.username === "chen");
    expect(chens).toHaveLength(1);
    expect((await login(ctx.app, { username: "chen" })).res.status).toBe(200);
    expect((await login(ctx.app, { username: "chen", password: GOOD })).res.status).toBe(401);

    // Still pending, so the director can clear it; denying twice is a no-op success.
    expect((await director.get("/api/registrations")).body.some((r: { id: number }) => r.id === reg.id)).toBe(true);
    await director.post(`/api/registrations/${reg.id}/deny`).expect(200);
    const again = await director.post(`/api/registrations/${reg.id}/deny`).expect(200);
    expect(again.body).toEqual({ ok: true, alreadyDenied: true });
    // Approving a denied request is refused, not a 500 and not a hang.
    const late = await director.post(`/api/registrations/${reg.id}/approve`);
    expect(late.status).toBe(409);
    expect(late.body).toEqual({ error: "already_denied" });
    // Unknown id → 404; another tenant's queue is invisible.
    expect((await director.post(`/api/registrations/999999/approve`)).status).toBe(404);
  });

  it("a denied name can be requested again (and the audit trail records the request)", async () => {
    expect((await register(ctx, { username: "retry.me" })).status).toBe(201);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const reg = (await director.get("/api/registrations")).body.find((r: { username: string }) => r.username === "retry.me");
    await director.post(`/api/registrations/${reg.id}/deny`).expect(200);
    expect((await register(ctx, { username: "retry.me" })).status).toBe(201);
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 50);
    const requests = audit.filter((a) => a.action === "auth.register_request" && (a.details as { username?: string }).username === "retry.me");
    expect(requests).toHaveLength(2);
    expect(audit.find((a) => a.action === "registration.deny")).toBeTruthy();
  });

  it("a pre-upgrade database (no password_changed_at, duplicate pending rows) migrates on boot: newest kept, index created", async () => {
    const h = await createTestDb();
    try {
      // Degrade to the shape a store written by the previous release has.
      await h.db.execute(sql`ALTER TABLE users DROP COLUMN password_changed_at`);
      await h.db.execute(sql`DROP INDEX pending_registrations_org_username_pending_uniq`);
      await h.db.execute(
        sql`INSERT INTO organizations (name, code) VALUES ('Old Hospital', 'OLDH')`,
      );
      for (const n of [1, 2, 3]) {
        await h.db.execute(
          sql`INSERT INTO pending_registrations (organization_id, username, password_hash, display_name, requested_role, status)
              SELECT id, 'dup.user', ${"h" + n}, 'Dup', 'hospitalist', 'pending' FROM organizations WHERE code = 'OLDH'`,
        );
      }
      // Boot-time DDL (the same SCHEMA_SQL every start runs) must succeed, not throw on the unique index.
      await h.ensureSchema();

      const cols = await h.db.execute(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_changed_at'`,
      );
      expect(cols.rows).toHaveLength(1);
      const idx = await h.db.execute(
        sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'pending_registrations_org_username_pending_uniq'`,
      );
      expect(idx.rows).toHaveLength(1);
      expect(String((idx.rows[0] as { indexdef: string }).indexdef)).toMatch(/UNIQUE/);
      expect(String((idx.rows[0] as { indexdef: string }).indexdef)).toMatch(/WHERE/);
      const rows = (
        await h.db.execute(
          sql`SELECT password_hash, status FROM pending_registrations WHERE username = 'dup.user' ORDER BY id`,
        )
      ).rows as Array<{ password_hash: string; status: string }>;
      expect(rows.map((r) => r.status)).toEqual(["rejected", "rejected", "pending"]);
      expect(rows[2]!.password_hash).toBe("h3"); // the newest submission survives
      // Idempotent: a second boot changes nothing.
      await h.ensureSchema();
      const again = (
        await h.db.execute(sql`SELECT status FROM pending_registrations WHERE username = 'dup.user' ORDER BY id`)
      ).rows as Array<{ status: string }>;
      expect(again.map((r) => r.status)).toEqual(["rejected", "rejected", "pending"]);
    } finally {
      await h.close();
    }
  });

  it("successful registrations are rate limited per IP when limiting is on (the auth limiter skips successes)", async () => {
    const limited = createApp({ sessionSecret: "test-secret", rateLimiting: true });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await supertest(limited)
        .post("/api/register")
        .send({ orgCode: "ISPN", username: `flood.${i}`, displayName: "Flood", requestedRole: "hospitalist", password: GOOD });
      statuses.push(res.status);
      if (res.status === 429) {
        // The same body every limiter in the app answers with (RATE_LIMIT_RESPONSE).
        expect(res.body).toEqual({ error: "rate_limited" });
        expect(res.headers["ratelimit-limit"]).toBe("10");
      }
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Nothing beyond the cap reached the queue.
    const rows = await ctx.storage.listPendingRegistrations(ctx.seedResult.orgId);
    expect(rows.filter((r) => r.username.startsWith("flood.")).length).toBe(10);
  });

  it("the registration limiter buckets like every other limiter (clientIpKey: one IPv6 /64 is one client)", async () => {
    // Behind a trusted loopback proxy the client address comes from
    // X-Forwarded-For. A single device rotating its IPv6 interface id must not
    // get a fresh 10/h budget per address: the key is the /64, exactly as the
    // login limiters in server/app.ts key it.
    const limited = createApp({ sessionSecret: "test-secret", rateLimiting: true, trustProxy: true });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await supertest(limited)
        .post("/api/register")
        .set("X-Forwarded-For", `2001:db8:4:2::${(i + 1).toString(16)}`)
        .send({ orgCode: "ISPN", username: `v6flood.${i}`, displayName: "Flood", requestedRole: "hospitalist", password: GOOD });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // A different /64 is a different client and still has its budget.
    const other = await supertest(limited)
      .post("/api/register")
      .set("X-Forwarded-For", "2001:db8:4:3::1")
      .send({ orgCode: "ISPN", username: "v6other", displayName: "Other", requestedRole: "hospitalist", password: GOOD });
    expect(other.status).toBe(201);
  });
});
