import { beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { sql } from "drizzle-orm";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";

/**
 * Usernames are identifiers people TYPE — on a phone keyboard that
 * auto-capitalises and appends a space after autocomplete. The server treats
 * them case- and surrounding-whitespace-insensitively everywhere
 * (A.CON-SHO-12 / A.CON-SHO-57):
 *  - sign-in: "Chen", "CHEN", " chen" and "chen " are the account "chen";
 *  - one account per (org, lower(trim(username))): registration, approval and
 *    administrative provisioning all refuse a case/whitespace variant of an
 *    existing account, enforced by a unique index on the normalised name;
 *  - a database that already holds such variants (registered and approved
 *    before this fix) is repaired at boot: the oldest account keeps the name,
 *    every later variant is deactivated and renamed out of the way (audited),
 *    so a sign-in can only ever reach the original account.
 */

const GOOD = "Fresh-Pass-11";

function register(ctx: TestContext, body: Record<string, unknown>) {
  return supertest(ctx.app)
    .post("/api/register")
    .send({ orgCode: "ISPN", displayName: "Dr. Test", requestedRole: "hospitalist", password: GOOD, ...body });
}

describe("username normalisation", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("sign-in ignores case and surrounding whitespace", async () => {
    const { res: canonical } = await login(ctx.app, { username: "chen" });
    expect(canonical.status).toBe(200);
    for (const typed of ["Chen", "CHEN", " chen", "chen ", "\tChEn  "]) {
      const { agent, res } = await login(ctx.app, { username: typed });
      expect(res.status, JSON.stringify(typed)).toBe(200);
      expect(res.body.id).toBe(canonical.body.id);
      expect(res.body.username).toBe("chen");
      expect((await agent.get("/api/user")).body.username).toBe("chen");
    }
    // A wrong password is still a wrong password.
    const { res: bad } = await login(ctx.app, { username: "CHEN", password: "nope-nope-nope" });
    expect(bad.status).toBe(401);
  });

  it("a case/whitespace variant of an existing account cannot be registered into an account", async () => {
    for (const variant of ["Chen", "lopez ", " PATEL"]) {
      const res = await register(ctx, { username: variant });
      // Same answer as any request (no username oracle) …
      expect(res.status, variant).toBe(201);
    }
    const { agent: director } = await login(ctx.app, { username: "director" });
    const queue = (await director.get("/api/registrations").expect(200)).body as Array<{ id: number; username: string; usernameTaken: boolean }>;
    expect(queue).toHaveLength(3);
    // … stored trimmed, flagged taken for the reviewer, and never approvable.
    expect(queue.map((r) => r.username).sort()).toEqual(["Chen", "PATEL", "lopez"]);
    for (const row of queue) {
      expect(row.usernameTaken, row.username).toBe(true);
      const approve = await director.post(`/api/registrations/${row.id}/approve`).send({});
      expect(approve.status, row.username).toBe(409);
      expect(approve.body.error).toBe("username_taken");
    }
    // Sign-in as "Chen" still reaches the one real account.
    const { res } = await login(ctx.app, { username: "Chen" });
    expect(res.body.username).toBe("chen");
  });

  it("one pending request per normalised name; an approved name is stored trimmed and signs in any-case", async () => {
    await register(ctx, { username: "New.Doc" }).expect(201);
    const again = await register(ctx, { username: " new.doc " });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("request_pending");
    // Too short once trimmed.
    expect((await register(ctx, { username: "  ab  " })).status).toBe(400);

    const { agent: director } = await login(ctx.app, { username: "director" });
    const [row] = (await director.get("/api/registrations").expect(200)).body as Array<{ id: number; username: string }>;
    expect(row!.username).toBe("New.Doc");
    const ok = await director.post(`/api/registrations/${row!.id}/approve`).send({});
    expect(ok.status).toBe(201);
    const { res } = await login(ctx.app, { username: "new.doc ", password: GOOD });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("New.Doc");
    // And the approved name now blocks its variants.
    await register(ctx, { username: "NEW.DOC" }).expect(201);
    const q2 = (await director.get("/api/registrations").expect(200)).body as Array<{ id: number; usernameTaken: boolean }>;
    expect(q2[0]!.usernameTaken).toBe(true);
    expect((await director.post(`/api/registrations/${q2[0]!.id}/approve`).send({})).status).toBe(409);
  });

  it("administrative provisioning refuses a variant of an existing username", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.post("/api/director/hospitalists").send({
      username: "PATEL ",
      displayName: "Dr. Duplicate",
      role: "hospitalist",
      specialty: "Hospital Medicine",
      patientCap: 12,
      shiftType: "day",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("username_taken");
  });

  it("the database refuses a variant even when a caller skips the check", async () => {
    const chen = await ctx.storage.getUserByUsername(ctx.seedResult.orgId, "chen");
    await expect(
      ctx.storage.createUser({
        organizationId: ctx.seedResult.orgId,
        username: "CHEN",
        passwordHash: chen!.passwordHash,
        role: "hospitalist",
        displayName: "Dup",
        credential: null,
        phone: null,
        twoFactorEnabled: false,
      }),
    ).rejects.toThrow();
  });

  it("boot repairs variants created before the fix: oldest keeps the name, later ones are deactivated, renamed and audited", async () => {
    const orgId = ctx.seedResult.orgId;
    const chen = (await ctx.storage.getUserByUsername(orgId, "chen"))!;
    const lopez = (await ctx.storage.getUserByUsername(orgId, "lopez"))!;
    // Recreate the state the auditor produced on a pre-fix database.
    await ctx.handle.db.execute(sql`DROP INDEX IF EXISTS users_org_username_ci_uniq`);
    const insert = async (username: string) => {
      const r = await ctx.handle.db.execute(sql`
        INSERT INTO users (organization_id, username, password_hash, role, display_name, two_factor_enabled)
        VALUES (${orgId}, ${username}, ${chen.passwordHash}, 'hospitalist', 'Imposter', false)
        RETURNING id`);
      return Number((r as unknown as { rows: Array<{ id: number }> }).rows[0]!.id);
    };
    const dupChen = await insert("Chen");
    const dupLopez = await insert("lopez ");

    await ctx.handle.ensureSchema(); // what every boot runs

    const after1 = await ctx.storage.getUserById(dupChen);
    const after2 = await ctx.storage.getUserById(dupLopez);
    expect(after1!.disabledAt).toBeTruthy();
    expect(after2!.disabledAt).toBeTruthy();
    expect(after1!.username.toLowerCase()).not.toBe("chen");
    expect(after2!.username.trim().toLowerCase()).not.toBe("lopez");
    expect((await ctx.storage.getUserById(chen.id))!.disabledAt).toBeNull();
    expect((await ctx.storage.getUserById(lopez.id))!.disabledAt).toBeNull();

    // Sign-in by any variant reaches the ORIGINAL account only.
    const { res: r1 } = await login(ctx.app, { username: "Chen" });
    expect(r1.body.id).toBe(chen.id);
    const { res: r2 } = await login(ctx.app, { username: "lopez " });
    expect(r2.body.id).toBe(lopez.id);

    const audit = await ctx.storage.listAuditLogs(orgId, 50);
    const blocked = audit.filter((a) => a.action === "user.username_variant_blocked");
    expect(blocked.map((a) => a.resourceId).sort()).toEqual([dupChen, dupLopez].sort());

    // Re-running the boot DDL is a no-op, and the guard is back in place.
    await ctx.handle.ensureSchema();
    await expect(insert("CHEN")).rejects.toThrow();
  });
});
