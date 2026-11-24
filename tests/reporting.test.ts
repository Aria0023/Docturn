import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { _setReportingDepsForTests } from "../server/routes/reporting.js";
import { applyConfig, defaultConfig, ehrRow, initialsOf, toCsv } from "../server/services/reporting.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestApp();
  _setReportingDepsForTests({});
});
afterEach(async () => {
  _setReportingDepsForTests({});
  invalidateModules();
  await ctx.handle.close();
});

const orgId = () => ctx.seedResult.orgId;
const run = (agent: Awaited<ReturnType<typeof login>>["agent"], body: object) => agent.post("/api/reporting/run").send(body);

/** A patient chen has accepted, so it is on chen's census. */
async function admitTo(initials: string, room: string) {
  const { agent: er } = await login(ctx.app, { username: "er.doc" });
  const p = await er.post("/api/patients").send({ initials, roomNumber: room, issueSummary: "report test", acuity: 2 });
  expect(p.status).toBe(201);
  const a = await er.post("/api/assignments").send({ patientId: p.body.id, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds.chen });
  expect(a.status).toBe(201);
  const { agent: chen } = await login(ctx.app, { username: "chen" });
  expect((await chen.patch(`/api/assignments/${a.body.id}/accept`).send({})).status).toBe(200);
  return p.body.id as number;
}

describe("reports — DocTurn's own records", () => {
  it("team census lists accepted patients under their hospitalist, and pending admits lists the ones still waiting", async () => {
    await admitTo("TC", "412");
    const { agent } = await login(ctx.app, { username: "director" });

    const census = await run(agent, { ref: "builtin:team_census" });
    expect(census.status).toBe(200);
    expect(census.headers["cache-control"]).toBe("no-store");
    expect(census.body.source).toBe("docturn");
    expect(census.body.groupBy).toBe("hospitalist");
    const row = census.body.rows.find((r: { patient: string }) => r.patient === "TC");
    expect(row).toMatchObject({ hospitalist: "Dr. Nolan Avery", room: "412", acuity: 2 });
    expect(typeof row.losHours).toBe("number");
    // Seeded census counters are numbers with no patient behind them: the report says so.
    expect(census.body.notes[0]).toMatch(/census counters add up to \d+; DocTurn has \d+ of those patients on record/);
    // Not on the pending list once accepted.
    const pending = await run(agent, { ref: "builtin:pending_admits" });
    expect(pending.status).toBe(200);
    expect(pending.body.rows.some((r: { patient: string }) => r.patient === "TC")).toBe(false);
    // The seed leaves one request waiting on a hospitalist.
    const waiting = pending.body.rows.filter((r: { request: string }) => r.request === "Sent, not accepted yet");
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting[0].requestedHospitalist).toBeTruthy();

    // One PHI-access row per patient report run.
    const phi = (await ctx.storage.listPhiAccess(orgId(), 50)).filter((r) => r.resource === "reports");
    expect(phi).toHaveLength(2);
  });

  it("provider load counts census, open slots and waiting requests, and writes no PHI-access row", async () => {
    const { agent } = await login(ctx.app, { username: "chen" });
    const res = await run(agent, { ref: "builtin:provider_load" });
    expect(res.status).toBe(200);
    const all = await ctx.storage.listHospitalists(orgId());
    expect(res.body.rows).toHaveLength(all.length);
    for (const r of res.body.rows) expect(r.openSlots).toBe(Math.max(0, r.cap - r.census));
    expect(res.body.rows.reduce((n: number, r: { pending: number }) => n + r.pending, 0)).toBeGreaterThan(0);
    expect((await ctx.storage.listPhiAccess(orgId(), 50)).filter((r) => r.resource === "reports")).toHaveLength(0);
  });

  it("a custom report filters, sorts, picks columns, saves, and exports as CSV with an audit row", async () => {
    await admitTo("AA", "9");
    await admitTo("BB", "10");
    await admitTo("CC", "2");
    const { agent } = await login(ctx.app, { username: "chen" });
    const config = {
      columns: ["patient", "room"],
      filters: [{ column: "patient", op: "neq", value: "bb" }],
      groupBy: null,
      sort: { column: "room", dir: "desc" },
      ehrListId: null,
    };
    // A draft runs before it is saved.
    const draft = await run(agent, { dataset: "team_census", config });
    expect(draft.status).toBe(200);
    expect(draft.body.columns.map((c: { id: string }) => c.id)).toEqual(["patient", "room"]);
    const mine = draft.body.rows.filter((r: { patient: string }) => ["AA", "BB", "CC"].includes(r.patient));
    // "10" sorts above "9" (numeric-aware), BB is filtered out.
    expect(mine.map((r: { patient: string }) => r.patient)).toEqual(["AA", "CC"]);

    const saved = await agent.post("/api/reporting/reports").send({ name: "My rooms", dataset: "team_census", config });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ name: "My rooms", shared: false, mine: true });

    const csv = await agent.post("/api/reporting/export").send({ ref: saved.body.id });
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.split("\r\n")[0]).toBe("Patient,Room");
    expect(csv.text).toContain("AA,9");
    const audit = await ctx.storage.listAuditLogs(orgId(), 100);
    expect(audit.some((r) => r.action === "report.create")).toBe(true);
    expect(audit.find((r) => r.action === "report.export")).toMatchObject({ riskLevel: "medium", resourceId: Number(saved.body.id) });
  });

  it("a private report is the owner's alone; only a director can publish one to the organization", async () => {
    const config = defaultConfig("provider_load");
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const { agent: director } = await login(ctx.app, { username: "director" });

    expect((await chen.post("/api/reporting/reports").send({ name: "X", dataset: "provider_load", config, shared: true })).status).toBe(403);
    const priv = await chen.post("/api/reporting/reports").send({ name: "Mine", dataset: "provider_load", config });
    expect(priv.status).toBe(201);

    const seen = (await patel.get("/api/reporting/reports")).body.reports;
    expect(seen.some((r: { id: string }) => r.id === priv.body.id)).toBe(false);
    expect(seen.filter((r: { builtin: boolean }) => r.builtin)).toHaveLength(3);
    expect((await run(patel, { ref: priv.body.id })).status).toBe(404);
    expect((await patel.delete(`/api/reporting/reports/${priv.body.id}`)).status).toBe(404);

    const shared = await director.post("/api/reporting/reports").send({ name: "Org load", dataset: "provider_load", config, shared: true });
    expect(shared.status).toBe(201);
    expect((await run(patel, { ref: shared.body.id })).status).toBe(200);
    // Visible to everyone, editable by its owner and directors only.
    expect((await patel.patch(`/api/reporting/reports/${shared.body.id}`).send({ name: "Hijack", dataset: "provider_load", config, shared: true })).status).toBe(403);
    expect((await patel.delete(`/api/reporting/reports/${shared.body.id}`)).status).toBe(403);
    expect((await director.delete(`/api/reporting/reports/${shared.body.id}`)).status).toBe(204);
  });

  it("refuses unknown columns, a malformed Epic list id, another organization, and a switched-off module", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    const base = defaultConfig("team_census");
    expect((await run(agent, { dataset: "team_census", config: { ...base, columns: ["patient", "ssn"] } })).status).toBe(400);
    expect((await run(agent, { dataset: "ehr_patient_list", config: { ...defaultConfig("ehr_patient_list"), ehrListId: "../Patient" } })).status).toBe(400);
    expect((await run(agent, { ref: "builtin:nope" })).status).toBe(404);
    expect((await agent.patch("/api/reporting/reports/builtin:team_census").send({ name: "x", dataset: "team_census", config: base })).status).toBe(404);

    // A second organization never sees or runs this organization's saved report.
    const saved = await agent.post("/api/reporting/reports").send({ name: "Shared", dataset: "team_census", config: base, shared: true });
    const other = await ctx.storage.createOrganization({
      name: "Other Hospital", code: "OTHR", city: null, state: null, timezone: "America/New_York",
      assignmentTimeoutMin: 15, roundRobinShiftTypes: ["day", "night"], rotationMode: "lowest_census", rotationIndex: 0,
    });
    expect(await ctx.storage.getReportDefinition(other.id, Number(saved.body.id))).toBeUndefined();

    await setModule(orgId(), "ops.reports", false);
    expect((await agent.get("/api/reporting/catalog")).status).toBe(404);
    expect((await run(agent, { ref: "builtin:team_census" })).status).toBe(404);
  });
});

describe("reports — Epic patient list", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const BASE = "https://fhir.example-epic.test/api/FHIR/R4";
  const ENV = {
    EPIC_FHIR_BASE_URL: BASE,
    EPIC_CLIENT_ID: "docturn-nonprod-client",
    EPIC_PRIVATE_KEY_PEM: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    EPIC_TOKEN_URL: "https://fhir.example-epic.test/oauth2/token",
    EPIC_ORG_CODE: "ISPN",
  } as unknown as NodeJS.ProcessEnv;
  const NOW = new Date("2026-09-03T12:00:00Z");
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/fhir+json" } });

  function epic(calls: string[]): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url === ENV.EPIC_TOKEN_URL) return json({ access_token: "tok", expires_in: 300 });
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      if (url === `${BASE}/List?code=patients&_count=100`) {
        return json({ resourceType: "Bundle", entry: [{ resource: { resourceType: "List", id: "team-a", title: "Hospitalist Team A" } }] });
      }
      if (url === `${BASE}/List/team-a`) {
        return json({
          resourceType: "List", id: "team-a", title: "Hospitalist Team A",
          entry: [
            { item: { reference: "Patient/p1" } },
            { item: { reference: "Patient/p2" } },
            { item: { reference: "Patient/p3" } },
            { item: { reference: "Patient/p1" } }, // listed twice
            { deleted: true, item: { reference: "Patient/gone" } },
          ],
        });
      }
      if (url === `${BASE}/Patient/p1`) return json({ resourceType: "Patient", id: "p1", name: [{ use: "official", family: "Okafor", given: ["Ruth"] }], gender: "female", birthDate: "1950-10-01" });
      if (url === `${BASE}/Patient/p2`) return json({ resourceType: "Patient", id: "p2", name: [{ text: "Miguel Santos" }], gender: "male", birthDate: "1990-01-15" });
      if (url === `${BASE}/Patient/p3`) return json({ issue: [] }, 403);
      if (url === `${BASE}/Encounter?patient=p1&_count=20`) {
        return json({ resourceType: "Bundle", entry: [
          { resource: { resourceType: "Encounter", id: "old", status: "finished", period: { start: "2026-01-01T00:00:00Z", end: "2026-01-03T00:00:00Z" } } },
          { resource: {
            resourceType: "Encounter", id: "cur", status: "in-progress", class: { code: "IMP", display: "inpatient" },
            period: { start: "2026-09-02T12:00:00Z" },
            location: [{ location: { display: "ED 4" }, period: { end: "2026-09-02T15:00:00Z" } }, { location: { display: "5W 512-A" } }],
            participant: [{ type: [{ coding: [{ code: "ATND" }] }], individual: { display: "Dr. Priya Rao" } }],
            reasonCode: [{ text: "Sepsis" }],
            serviceProvider: { display: "5 West" },
          } },
        ] });
      }
      if (url === `${BASE}/Encounter?patient=p2&_count=20`) return json({ resourceType: "Bundle", entry: [] });
      return json({}, 404);
    }) as typeof fetch;
  }

  it("answers ehr_not_connected when the hospital has no Epic connection", async () => {
    const { agent } = await login(ctx.app, { username: "director" });
    _setReportingDepsForTests({ env: {} as NodeJS.ProcessEnv });
    expect((await agent.get("/api/reporting/catalog")).body.ehrConnected).toBe(false);
    const res = await run(agent, { dataset: "ehr_patient_list", config: { ...defaultConfig("ehr_patient_list"), ehrListId: "team-a" } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "ehr_not_connected" });
    expect((await agent.get("/api/reporting/ehr/lists")).status).toBe(409);
  });

  it("reads the list live: initials only, the current encounter, and says which patients it could not read", async () => {
    const calls: string[] = [];
    _setReportingDepsForTests({ env: ENV, fetchImpl: epic(calls), now: () => NOW });
    const { agent } = await login(ctx.app, { username: "director" });
    expect((await agent.get("/api/reporting/catalog")).body.ehrConnected).toBe(true);
    expect((await agent.get("/api/reporting/ehr/lists")).body.lists).toEqual([{ id: "team-a", title: "Hospitalist Team A" }]);

    const res = await run(agent, { dataset: "ehr_patient_list", config: { ...defaultConfig("ehr_patient_list"), ehrListId: "team-a" } });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ehr");
    expect(res.body.rows).toHaveLength(2);
    const ruth = res.body.rows.find((r: { patient: string }) => r.patient === "RO");
    expect(ruth).toMatchObject({
      age: 75, sex: "female", location: "5W 512-A", unit: "5 West", attending: "Dr. Priya Rao",
      encounterStatus: "in-progress", losHours: 24, reason: "Sepsis",
    });
    expect(res.body.rows.find((r: { patient: string }) => r.patient === "MS")).toMatchObject({ age: 36, location: null, encounterStatus: null });
    expect(res.body.notes).toEqual(["1 patient on the list could not be read from Epic and is not shown."]);
    // Never a full name, in the response or anywhere else.
    expect(JSON.stringify(res.body)).not.toMatch(/Okafor|Santos|Ruth|Miguel/);
    expect(calls.filter((u) => u.includes("/Patient/p1"))).toHaveLength(1);
    expect((await ctx.storage.listPhiAccess(orgId(), 50)).filter((r) => r.resource === "reports")).toHaveLength(1);
  });

  it("reports a failed Epic read as a failure, never as an empty list", async () => {
    const down = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      return url === ENV.EPIC_TOKEN_URL ? json({ access_token: "tok" }) : json({}, 500);
    }) as typeof fetch;
    _setReportingDepsForTests({ env: ENV, fetchImpl: down, now: () => NOW });
    const { agent } = await login(ctx.app, { username: "director" });
    const res = await run(agent, { dataset: "ehr_patient_list", config: { ...defaultConfig("ehr_patient_list"), ehrListId: "team-a" } });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "ehr_failed", detail: "epic_fhir_http_500" });
  });
});

describe("report engine", () => {
  it("keeps blanks last, groups before sorting, and always sends the group column", () => {
    const rows = [
      { hospitalist: "B", patient: "P1", room: null },
      { hospitalist: "A", patient: "P2", room: "3" },
      { hospitalist: "A", patient: "P3", room: "12" },
      { hospitalist: "A", patient: "P4", room: null },
    ];
    const out = applyConfig("team_census", { columns: ["patient", "room"], filters: [], groupBy: "hospitalist", sort: { column: "room", dir: "desc" }, ehrListId: null }, rows);
    expect(out.columns.map((c) => c.id)).toEqual(["hospitalist", "patient", "room"]);
    expect(out.rows.map((r) => r.patient)).toEqual(["P3", "P2", "P4", "P1"]);
    const few = applyConfig("team_census", { columns: ["patient"], filters: [{ column: "room", op: "gte", value: "4" }], groupBy: null, sort: null, ehrListId: null }, rows.map((r) => ({ ...r, acuity: 1 })));
    // "at least 4": blanks never match, "12" does, "3" does not.
    expect(few.rows.map((r) => r.patient)).toEqual(["P3"]);
  });

  it("writes spreadsheet-formula text as plain text and quotes commas", () => {
    const csv = toCsv({
      columns: [{ id: "patient", label: "Patient", type: "text" }, { id: "summary", label: "Summary", type: "text" }, { id: "acuity", label: "Acuity", type: "number" }],
      rows: [{ patient: "=HYPERLINK(1)", summary: 'chest pain, "crushing"', acuity: -1 }],
    });
    expect(csv).toBe('Patient,Summary,Acuity\r\n\'=HYPERLINK(1),"chest pain, ""crushing""",-1\r\n');
  });

  it("derives initials without ever returning a name, and leaves a missing encounter blank", () => {
    expect(initialsOf({ name: [{ family: "de la Cruz", given: ["ana", "maria"] }] })).toBe("AD");
    expect(initialsOf({})).toBe("—");
    expect(ehrRow(undefined, undefined, new Date())).toMatchObject({ patient: "—", location: null, losHours: null });
  });
});
