import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withBootLock, type DbHandle } from "../server/db.js";
import { DatabaseStorage } from "../server/storage.js";
import { ensureDemoTenants, ensurePlatform, seed } from "../server/seed.js";

/**
 * E1 multi-instance safety — booting N instances at once against ONE real
 * Postgres (docs/ENTERPRISE_READINESS.md). Needs PG_TEST_URL; the probe
 * scripts/multi-instance-check.mjs found the race this guards against:
 * two `CREATE TABLE IF NOT EXISTS` runs in parallel on an empty database are
 * not atomic in Postgres ("duplicate key value violates unique constraint
 * pg_type_typname_nsp_index"), and two first-boot seeds would both insert the
 * demo org. Schema and seed therefore run under a session advisory lock.
 */
const PG_TEST_URL = process.env.PG_TEST_URL;

describe.skipIf(!PG_TEST_URL)("Postgres boot under concurrency (PG_TEST_URL)", () => {
  let a: DbHandle;
  let b: DbHandle;
  beforeAll(async () => {
    a = createDb({ databaseUrl: PG_TEST_URL });
    b = createDb({ databaseUrl: PG_TEST_URL });
    await a.pool!.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  });
  afterAll(async () => {
    await a.close();
    await b.close();
  });

  it("two instances applying the schema at the same moment both succeed (no pg_type race), and it stays idempotent", async () => {
    await Promise.all([a.ensureSchema(), b.ensureSchema()]);
    await Promise.all([a.ensureSchema(), b.ensureSchema()]);
    const tables = await a.pool!.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
    expect(tables.rows[0].n).toBeGreaterThan(40);
  }, 60_000);

  it("two instances seeding an empty database at the same moment produce exactly one demo org and one platform org", async () => {
    const firstBoot = async (h: DbHandle) => {
      const storage = new DatabaseStorage(h.db);
      await withBootLock(h, async () => {
        const existing = await storage.getOrganizationByCode("ISPN");
        if (!existing) await seed(storage);
        else await ensurePlatform(storage);
        await ensureDemoTenants(storage);
      });
    };
    await Promise.all([firstBoot(a), firstBoot(b)]);
    const orgs = await a.pool!.query("SELECT code, count(*)::int AS n FROM organizations GROUP BY code ORDER BY code");
    for (const row of orgs.rows) expect(row.n, row.code).toBe(1);
    expect(orgs.rows.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(["DOCTURN", "ISPN"]));
    const users = await a.pool!.query("SELECT organization_id, username, count(*)::int AS n FROM users GROUP BY 1, 2 HAVING count(*) > 1");
    expect(users.rows).toEqual([]);
  }, 60_000);
});
