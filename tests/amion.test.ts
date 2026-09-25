import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import {
  fetchAmionGrid,
  getAmionStatus,
  mapHoursToShift,
  parseAmionBody,
  syncAmion,
  toDisplayName,
} from "../server/services/amion.js";

const FIXTURE_HTML = readFileSync(
  new URL("./fixtures/amion-ocs.html", import.meta.url),
  "utf8",
);

/** Serve a body on an ephemeral local port (stand-in for amion.com). */
function serveFixture(
  body = FIXTURE_HTML,
  contentType = "text/html",
  status = 200,
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(status, { "Content-Type": contentType });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/ocs?Lo=test-fixture` });
    });
  });
}

const ENV_KEYS = ["AMION_OCS_URL", "AMION_ORG_CODE", "AMION_SYNC_INTERVAL_MIN"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("amion parser", () => {
  it("parses the OCS HTML day view into 13 rows with correct fields", () => {
    const rows = parseAmionBody(FIXTURE_HTML, "text/html");
    expect(rows).toHaveLength(13);

    expect(rows[0]).toEqual({
      slot: "Tarzana 1",
      hrs: "7a-7p",
      name: "Lou, May",
      group: "Lead Hospitalist",
      secure: true,
      shift: "day",
    });
    expect(rows[1]!.name).toBe("Kazanchyan, Moe");
    expect(rows[1]!.group).toBe("Moonlighter");
    expect(rows[1]!.secure).toBe(false);
    expect(rows[10]).toMatchObject({ slot: "Tarzana Swing", hrs: "2p-10p", shift: "swing" });
    expect(rows[12]).toMatchObject({ slot: "Tarzana Night XC", name: "Niculescu, Alex", shift: "night" });

    // Shift distribution: 10 day slots (incl. Gopal's duplicate), 1 swing, 2 night.
    const byShift = rows.reduce<Record<string, number>>((m, r) => {
      m[r.shift] = (m[r.shift] ?? 0) + 1;
      return m;
    }, {});
    expect(byShift).toEqual({ day: 10, swing: 1, night: 2 });

    // Secure-messaging readiness parsed per row: 8 onboarded, 5 not.
    expect(rows.filter((r) => r.secure)).toHaveLength(8);

    // Gopal holds two slots → 12 unique people once deduped by name.
    const unique = new Set(rows.map((r) => toDisplayName(r.name)));
    expect(unique.size).toBe(12);
  });

  it("parses the plain-text / tab-separated report shape too", () => {
    const text = [
      "Assignment\tHours\tStaff\tDivision\tMessaging",
      "Tarzana 1\t7a-7p\tLou, May\tLead Hospitalist\tSecure message to Amion app",
      "Tarzana Swing\t2p-10p\tKashi, Kioumars\tISP North\tNot ready to receive secure messages",
      "Tarzana Night Triage\t7p-7a\tKohan, Salar\tISP North\tNot ready to receive secure messages",
      "",
    ].join("\n");
    const rows = parseAmionBody(text, "text/plain");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ slot: "Tarzana 1", name: "Lou, May", secure: true, shift: "day" });
    expect(rows[1]).toMatchObject({ shift: "swing", secure: false });
    expect(rows[2]).toMatchObject({ shift: "night", group: "ISP North" });
  });

  it("maps Amion hours tokens to DocTurn shifts (unknown → day)", () => {
    expect(mapHoursToShift("7a-7p")).toBe("day");
    expect(mapHoursToShift("2p-10p")).toBe("swing");
    expect(mapHoursToShift("4p-12a")).toBe("swing");
    expect(mapHoursToShift("7p-7a")).toBe("night");
    expect(mapHoursToShift("11p-7a")).toBe("night");
    expect(mapHoursToShift("9a-3p")).toBe("day");
  });

  it("fetches and parses the grid over HTTP", async () => {
    const { server, url } = await serveFixture();
    try {
      const rows = await fetchAmionGrid(url);
      expect(rows).toHaveLength(13);
    } finally {
      server.close();
    }
  });
});

describe("amion sync", () => {
  let ctx: TestContext;
  let fixture: { server: Server; url: string };

  beforeEach(async () => {
    ctx = await createTestApp();
    fixture = await serveFixture();
    process.env.AMION_OCS_URL = fixture.url;
    process.env.AMION_ORG_CODE = "ISPN";
  });
  afterEach(async () => {
    fixture.server.close();
    await ctx.handle.close();
  });

  it("creates missing providers, updates existing ones, and never deletes", async () => {
    const before = await ctx.storage.listUsers(ctx.seedResult.orgId);
    const state = await syncAmion(ctx.storage);

    expect(state.lastStatus).toBe("ok");
    expect(state.rowCount).toBe(13);
    expect(state.providers).toHaveLength(13);
    expect(state.lastSyncAt).toBeTruthy();

    const after = await ctx.storage.listUsers(ctx.seedResult.orgId);
    // Seed already has 8 of the 12 unique providers (as "Dr. First Last");
    // the other 4 (Lou, Rostami, Yu, Kashi) are created.
    expect(after.length - before.length).toBe(4);
    const names = after.map((u) => u.displayName);
    for (const n of ["May Lou", "Matt Rostami", "Allen Yu", "Kioumars Kashi"]) {
      expect(names).toContain(n);
    }

    // Existing seeded providers were UPDATED (shift + working), not duplicated.
    const hosps = await ctx.storage.listHospitalists(ctx.seedResult.orgId);
    const byUser = new Map(after.map((u) => [u.id, u]));
    const hospFor = (name: string) =>
      hosps.find((h) => byUser.get(h.userId)?.displayName === name);

    expect(hospFor("Dr. Salar Kohan")).toMatchObject({ shiftType: "night", working: true });
    expect(hospFor("Dr. Nathan Alyesh")).toMatchObject({ shiftType: "day", working: true });
    // New providers carry the grid's group as specialty and come in on-shift.
    expect(hospFor("Kioumars Kashi")).toMatchObject({
      specialty: "ISP North", shiftType: "swing", working: true, patientCap: 12,
    });
    expect(hospFor("May Lou")).toMatchObject({ specialty: "Lead Hospitalist", shiftType: "day" });

    // Additive-only: providers NOT on the grid survive (manual roster intact).
    expect(hospFor("Dr. Nicole Williams")).toBeTruthy();
    expect(hospFor("Dr. Naira Manukian")).toBeTruthy();

    // New accounts never leak a usable password (random hash, not "docturn").
    const lou = after.find((u) => u.displayName === "May Lou")!;
    const res = await login(ctx.app, { username: lou.username, password: "docturn" });
    expect(res.res.status).toBe(401);

    // Audit trail records the sync with counts.
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId);
    const row = audit.find((r) => r.action === "amion.sync");
    expect(row).toBeTruthy();
    expect(row!.details).toMatchObject({ status: "ok", rowCount: 13, uniqueProviders: 12, created: 4, updated: 8 });
  });

  it("is idempotent — a second sync creates nothing new", async () => {
    await syncAmion(ctx.storage);
    const users1 = await ctx.storage.listUsers(ctx.seedResult.orgId);
    const hosps1 = await ctx.storage.listHospitalists(ctx.seedResult.orgId);
    await syncAmion(ctx.storage);
    expect(await ctx.storage.listUsers(ctx.seedResult.orgId)).toHaveLength(users1.length);
    expect(await ctx.storage.listHospitalists(ctx.seedResult.orgId)).toHaveLength(hosps1.length);
  });

  it("records an error state (keeping the last snapshot) when the feed fails", async () => {
    await syncAmion(ctx.storage); // good sync first
    fixture.server.close();
    const bad = await serveFixture("gone", "text/html", 404);
    process.env.AMION_OCS_URL = bad.url;
    try {
      const state = await syncAmion(ctx.storage);
      expect(state.lastStatus).toBe("error");
      expect(state.lastError).toContain("amion_http_404");
      // Last good grid is preserved for the UI.
      expect(state.rowCount).toBe(13);
      expect(state.providers).toHaveLength(13);
    } finally {
      bad.server.close();
    }
  });

  it("serves status + sync-now through the API with role gating", async () => {
    // Unauthenticated → 401.
    expect((await supertest(ctx.app).get("/api/amion/status")).status).toBe(401);
    const { agent: director } = await login(ctx.app, { username: "director" });

    // Before any sync: configured, but no snapshot yet.
    const pre = await director.get("/api/amion/status");
    expect(pre.status).toBe(200);
    expect(pre.body.configured).toBe(true);
    expect(pre.body.rowCount).toBe(0);

    // Hospitalist may read status but NOT trigger a sync.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.get("/api/amion/status")).status).toBe(200);
    expect((await chen.post("/api/amion/sync-now")).status).toBe(403);

    // Director runs the sync and gets the fresh status back.
    const sync = await director.post("/api/amion/sync-now");
    expect(sync.status).toBe(200);
    expect(sync.body.configured).toBe(true);
    expect(sync.body.lastStatus).toBe("ok");
    expect(sync.body.rowCount).toBe(13);
    expect(sync.body.providers).toHaveLength(13);
    // No token/URL leakage anywhere in the response.
    expect(JSON.stringify(sync.body)).not.toContain(fixture.url);

    // The imported providers are live in the org's roster.
    const hosps = await director.get("/api/hospitalists");
    expect(hosps.body.length).toBeGreaterThanOrEqual(16); // 12 seeded + 4 created
  });

  it("reports configured:false when the env var is absent or for other tenants", async () => {
    delete process.env.AMION_OCS_URL;
    const { agent } = await login(ctx.app, { username: "director" });
    const off = await agent.get("/api/amion/status");
    expect(off.body.configured).toBe(false);

    // Configured, but scoped to the AMION_ORG_CODE tenant only.
    process.env.AMION_OCS_URL = fixture.url;
    await syncAmion(ctx.storage);
    const other = await getAmionStatus(ctx.storage, {
      organizationId: ctx.seedResult.orgId + 999,
      role: "director",
    });
    expect(other.configured).toBe(false);
    expect(other.providers).toHaveLength(0);
  });
});
