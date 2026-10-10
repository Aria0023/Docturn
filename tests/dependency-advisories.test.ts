/**
 * Production-dependency advisories (A.CON-SHO-1).
 *
 * `npm audit --omit=dev` flagged proxy-addr (critical), drizzle-orm (high),
 * body-parser and qs (moderate). They were cleared by upgrading, inside the
 * existing semver ranges where possible:
 *   express 4.22.3  → qs ~6.16.0
 *   body-parser 1.20.8, proxy-addr 2.0.8, qs 6.16.0 (express' own deps)
 *   drizzle-orm 0.45.2 (0.36 → 0.45; same `compatibilityVersion` 10, so the
 *   pinned drizzle-kit 0.28 still pairs with it; the full suite is green)
 *
 * These tests pin that outcome: they fail if a lockfile regeneration or a
 * dependency bump ever resolves a vulnerable copy again, and they exercise the
 * two advisories whose behaviour is observable from this codebase.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { createRequire } from "node:module";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
// drizzle-orm does not export its package.json; it exports its version here.
import { npmVersion as drizzleVersion } from "drizzle-orm/version";

const requireHere = createRequire(import.meta.url);
/** require() as seen from inside an installed package (its own node_modules first). */
const requireFrom = (pkg: string, from = requireHere) =>
  createRequire(path.join(path.dirname(from.resolve(`${pkg}/package.json`)), "package.json"));
const versionOf = (pkg: string, from = requireHere): string =>
  (from(`${pkg}/package.json`) as { version: string }).version;

function atLeast(actual: string, floor: string): boolean {
  const a = (actual.split("-")[0] ?? "").split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

describe("production dependencies resolve to patched versions", () => {
  const fromExpress = requireFrom("express");
  const fromBodyParser = requireFrom("body-parser", fromExpress);
  const cases: Array<[string, string, string]> = [
    ["express", versionOf("express"), "4.22.3"],
    // The copies express actually loads, not whatever sits at the top level.
    ["proxy-addr (GHSA-jqcg-44mw-7w3h)", versionOf("proxy-addr", fromExpress), "2.0.8"],
    ["body-parser (GHSA-v422-hmwv-36x6)", versionOf("body-parser", fromExpress), "1.20.7"],
    ["qs via express (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g)", versionOf("qs", fromExpress), "6.16.0"],
    ["qs via body-parser", versionOf("qs", fromBodyParser), "6.16.0"],
    ["drizzle-orm (GHSA-gpj5-g38j-94v9)", drizzleVersion, "0.45.2"],
  ];
  for (const [name, actual, floor] of cases) {
    it(`${name} >= ${floor}`, () => {
      expect(atLeast(actual, floor), `${name} resolved to ${actual}`).toBe(true);
    });
  }
});

describe("proxy-addr: an IPv6 trust range is not a back door for IPv4 peers", () => {
  // TRUST_PROXY accepts CIDRs (server/config.ts resolveTrustProxy). Before
  // proxy-addr 2.0.8 an IPv4 peer (or its ::ffff:-mapped form) was matched
  // against an IPv6 range such as ::/64, so ANY direct client counted as the
  // trusted proxy and could choose its own req.ip — its rate-limit bucket and
  // the address written to audit rows — with X-Forwarded-For.
  it("an IPv4 loopback peer is not trusted by trust proxy ::/64, so its X-Forwarded-For is ignored", async () => {
    const app = express();
    app.set("trust proxy", "::/64");
    app.get("/ip", (req, res) => res.json({ ip: req.ip }));
    const res = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.9");
    expect(res.status).toBe(200);
    expect(res.body.ip).not.toBe("203.0.113.9");
    expect(res.body.ip).toMatch(/127\.0\.0\.1$/);
  });

  it("the documented address-list trust still works: a loopback proxy's X-Forwarded-For is honoured", async () => {
    const app = express();
    app.set("trust proxy", "loopback");
    app.get("/ip", (req, res) => res.json({ ip: req.ip }));
    const res = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.9");
    expect(res.body.ip).toBe("203.0.113.9");
  });
});

describe("drizzle-orm: identifiers are escaped", () => {
  // DocTurn never builds identifiers from input (no sql.identifier / sql.raw in
  // server/ or shared/), so the advisory was not reachable here; the upgrade
  // removes it anyway and this pins the escaping.
  it("a double quote inside an identifier is doubled, not allowed to close it", () => {
    const q = new PgDialect().sqlToQuery(sql`select ${sql.identifier('x" ; drop table users; --')} from t`);
    expect(q.sql).toBe('select "x"" ; drop table users; --" from t');
  });
});
