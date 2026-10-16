import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { _resetDiscoveryCache } from "../server/notes/smart/discovery.js";
import { _mockWrittenDocuments, _resetMockEhr, MOCK_ENCOUNTER_ID, MOCK_PATIENT_ID } from "../server/notes/mock-ehr.js";
import { applyHardLocks, escapeDashLists, stripUnits } from "../server/notes/generation/hardlocks.js";
import { DEFAULT_TEMPLATE_MODULE } from "../server/notes/generation/default-template.js";
import type { ContextPackage } from "../server/notes/types.js";

/**
 * The plugin talks to the EHR over HTTP, so these tests run the app on a real
 * ephemeral port and point the in-process mock EHR at it. Everything is
 * zero-secrets: mock SMART sandbox, stub connectors, deterministic engine.
 */
let ctx: TestContext;
let server: Server;
let base: string;

beforeEach(async () => {
  ctx = await createTestApp();
  _resetDiscoveryCache();
  _resetMockEhr();
  server = createServer(ctx.app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await ctx.handle.close();
});

function agentFor() {
  return supertest.agent(server);
}
async function loginAs(agent: ReturnType<typeof agentFor>, username: string, orgCode = "ISPN") {
  const res = await agent.post("/api/login").send({ orgCode, username, password: DEV_PASSWORD });
  expect(res.status).toBe(200);
}

/** Follow the SMART redirect chain: launch → EHR authorize → callback → app. */
async function smartLaunch(agent: ReturnType<typeof agentFor>, opts: { standalone?: boolean; org?: string; launch?: string } = {}) {
  const launchUrl = opts.standalone
    ? `/smart/standalone?org=${opts.org ?? "ISPN"}`
    : `/smart/launch?iss=${encodeURIComponent(`${base}/mock-ehr/fhir`)}&launch=${opts.launch ?? "demo-launch-token"}${opts.org ? `&org=${opts.org}` : ""}`;
  const r1 = await agent.get(launchUrl);
  expect(r1.status, r1.text).toBe(302);
  const authorize = new URL(r1.headers.location!);
  expect(authorize.pathname).toBe("/mock-ehr/authorize");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("aud")).toBe(`${base}/mock-ehr/fhir`);
  const r2 = await agent.get(authorize.pathname + authorize.search);
  expect(r2.status, r2.text).toBe(302);
  const cb = new URL(r2.headers.location!);
  expect(cb.pathname).toBe("/smart/callback");
  const r3 = await agent.get(cb.pathname + cb.search);
  expect(r3.status, r3.text).toBe(302);
  expect(r3.headers.location).toBe("/notes.html");
}

describe("SMART on FHIR launch → context → note → export (end to end, mock EHR)", () => {
  it("runs the full clinician flow and leaves only metadata behind", async () => {
    const agent = agentFor();
    await loginAs(agent, "chen");
    await smartLaunch(agent);

    // Session carries launch context; no token is exposed to the client.
    const sess = await agent.get("/api/notes/session");
    expect(sess.status).toBe(200);
    expect(sess.body.active).toBe(true);
    expect(sess.body.patientId).toBe(MOCK_PATIENT_ID);
    expect(sess.body.encounterId).toBe(MOCK_ENCOUNTER_ID);
    expect(sess.body.writeBack).toBe(true);
    expect(sess.body.fhirUser).toBe("Practitioner/dr-chen");
    expect(JSON.stringify(sess.body)).not.toContain("access_token");
    expect(sess.body.template).toMatchObject({ name: "Locked H&P", version: 1 });

    // Context package from standard FHIR R4 resources (+ UpToDate stub knowledge).
    const ctxRes = await agent.post("/api/notes/context").send({ includeKnowledge: true });
    expect(ctxRes.status, ctxRes.text).toBe(200);
    const pkg = ctxRes.body.context as ContextPackage;
    expect(pkg.patient.reference).toBe(`Patient/${MOCK_PATIENT_ID}`);
    expect(pkg.patient.age).toBeGreaterThan(60);
    expect(pkg.problems.map((p) => p.display)).toContain("Chronic systolic heart failure");
    const aki = pkg.problems.find((p) => p.display === "Acute kidney injury");
    expect(aki?.poa).toBe("N"); // onset after encounter start
    expect(pkg.problems.find((p) => p.display === "Hypertension")?.poa).toBe("Y");
    const generics = pkg.medications.map((m) => m.genericName);
    expect(generics).toContain("furosemide"); // Lasix → generic
    expect(generics).toContain("metoprolol succinate"); // Toprol XL → generic
    expect(generics).toContain("apixaban"); // Eliquis → generic
    expect(pkg.medications.every((m) => !/mg/i.test(m.dose ?? ""))).toBe(true); // unit-free
    expect(pkg.labs.find((l) => l.display === "Creatinine")?.value).toBe("2.1"); // latest wins, unit-free
    expect(pkg.vitals.find((v) => v.display === "Blood pressure")?.value).toBe("148/92");
    expect(pkg.allergies[0]?.substance).toBe("Penicillin");
    expect(pkg.priorNotes).toHaveLength(1);
    expect(pkg.priorNotes[0]!.summary).toMatch(/Chronic systolic HF/);
    expect(pkg.priorNotes[0]!.summary.length).toBeLessThan(600);
    expect(pkg.knowledge.length).toBeGreaterThan(0);
    expect(pkg.knowledge.every((k) => k.connector === "uptodate")).toBe(true);
    expect(ctxRes.body.knowledge.ran).toEqual(["uptodate"]);
    expect(pkg.provenance.sources).toEqual(["ehr:fhir", "knowledge:uptodate"]);
    // Minimum necessary: no name / MRN / DOB anywhere in the package.
    const raw = JSON.stringify(pkg);
    expect(raw).not.toMatch(/Testpatient|MRN0001001|1958-03-14/);

    // Generate with the active locked template.
    const gen = await agent.post("/api/notes/generate").send({
      context: pkg,
      visit: {
        chiefComplaint: "Shortness of breath",
        hpi: "Three days of progressive dyspnea and leg swelling after dietary indiscretion. Took extra Lasix at home without relief.",
        exam: "JVP elevated, bibasilar crackles, 2+ pitting edema.",
        assessment: "Acute on chronic systolic heart failure exacerbation with cardiorenal AKI.",
        plan: "IV furosemide 80 BID; strict I/O; daily weights\nHold lisinopril and metformin while AKI resolves\nTelemetry",
        admissionStatus: "inpatient",
      },
    });
    expect(gen.status, gen.text).toBe(200);
    const note: string = gen.body.text;
    expect(gen.body.templateName).toBe("Locked H&P");
    expect(gen.body.templateVersion).toBe(1);
    expect(gen.body.engine).toBe("deterministic-v1");

    // HARD_LOCK: full section order.
    const titles = DEFAULT_TEMPLATE_MODULE.sections.map((s) => `${s.title}:`);
    const positions = titles.map((t) => note.indexOf(t));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // HARD_LOCK: escaped-dash lists, no markdown bullets.
    expect(note).toMatch(/^\\- furosemide 40 oral daily$/m);
    expect(note).not.toMatch(/^\s*[-•*] /m);
    // HARD_LOCK: generic names, unit-free values.
    expect(note).not.toMatch(/\b(Lasix|Toprol|Eliquis)\b/i);
    expect(note).not.toMatch(/\d\s?(mg|mmol\/L|mg\/dL|mmHg|bpm)\b/i);
    expect(note).toMatch(/Creatinine 2\.1 \(H\)/);
    expect(note).toMatch(/BP 148\/92/);
    // HARD_LOCK: POA tags and balanced A&P (every problem line followed by a plan line).
    expect(note).toMatch(/Acute kidney injury \(not POA\)/);
    expect(note).toMatch(/Hypertension \(POA\)/);
    const ap = note.slice(note.indexOf("ASSESSMENT AND PLAN:"), note.indexOf("DISPOSITION:"));
    const apLines = ap.split("\n").slice(1).filter((l) => l.trim());
    for (let i = 0; i < apLines.length; i++) {
      if (!apLines[i]!.startsWith("\\-")) expect(apLines[i + 1]?.startsWith("\\-"), apLines[i]).toBe(true);
    }
    // HARD_LOCK: two-midnight language for an inpatient admission.
    expect(note).toContain("at least two midnights");
    // HARD_LOCK: strict data isolation — no identifiers in the body.
    expect(note).not.toMatch(/Testpatient|MRN0001001|Patient\/pt-1001|1958/);
    // Word-safe: plain text only.
    expect(note).not.toMatch(/[\u2018\u2019\u201C\u201D\t#]|(?<!\*)\*\*(?!\*)/);
    expect(note).toContain("Code status: ***"); // Epic wildcard survives

    // Export 1: clipboard (CRLF).
    const clip = await agent.post("/api/notes/export").send({ mode: "clipboard", note });
    expect(clip.status).toBe(200);
    expect(clip.body.text).toContain("\r\n");
    expect(clip.body.text.replace(/\r\n/g, "\n")).toBe(note);

    // Export 2: FHIR DocumentReference write-back to the EHR.
    const wb = await agent.post("/api/notes/export").send({ mode: "documentreference", note });
    expect(wb.status, wb.text).toBe(200);
    expect(wb.body.documentReferenceId).toBe("doc-1");
    const written = _mockWrittenDocuments();
    expect(written).toHaveLength(1);
    const doc = written[0] as Record<string, unknown>;
    expect(doc.subject).toEqual({ reference: `Patient/${MOCK_PATIENT_ID}` });
    expect((doc.context as { encounter: Array<{ reference: string }> }).encounter[0]!.reference).toBe(`Encounter/${MOCK_ENCOUNTER_ID}`);
    expect((doc.type as { coding: Array<{ code: string }> }).coding[0]!.code).toBe("34117-5");
    expect((doc.author as Array<{ reference: string }>)[0]!.reference).toBe("Practitioner/dr-chen");
    const attachment = (doc.content as Array<{ attachment: { contentType: string; data: string } }>)[0]!.attachment;
    expect(attachment.contentType).toBe("text/plain");
    expect(Buffer.from(attachment.data, "base64").toString("utf8").replace(/\r\n/g, "\n")).toBe(note);

    // Audit trail: actions only — never note content or context values.
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 200);
    const actions = audit.map((a) => a.action);
    for (const a of ["notes.launch", "notes.context_assembled", "notes.generated", "notes.exported"]) expect(actions).toContain(a);
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toMatch(/furosemide|dyspnea|two midnights|Creatinine/);
    expect(auditText).toContain(MOCK_PATIENT_ID); // patient reference is allowed metadata
    // Usage was metered.
    expect((await agent.get("/api/notes/license")).status).toBe(403); // clinicians cannot read licensing
    const usage = await ctx.storage.listLicenseUsage(ctx.seedResult.orgId, new Date().toISOString().slice(0, 7));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ generations: 1, exports: 2 });

    // Discard the session: context and tokens are gone; nothing persisted.
    const end = await agent.delete("/api/notes/session");
    expect(end.status).toBe(200);
    const after = await agent.get("/api/notes/session");
    expect(after.body.active).toBe(false);
    const again = await agent.post("/api/notes/context").send({});
    expect(again.status).toBe(409);
  });

  it("standalone launch + just-in-time provisioning from the EHR identity (no prior DocTurn login)", async () => {
    const agent = agentFor();
    await smartLaunch(agent, { standalone: true });
    const sess = await agent.get("/api/notes/session");
    expect(sess.status).toBe(200);
    expect(sess.body.active).toBe(true);
    expect(sess.body.user.username).toBe("practitioner-dr-chen");
    expect(sess.body.user.role).toBe("hospitalist");
    expect(sess.body.patientId).toBe(MOCK_PATIENT_ID);
    expect(sess.body.encounterId).toBeUndefined(); // standalone: patient only
    const link = await ctx.storage.getEhrUserLink((await ctx.storage.listEhrConnections(ctx.seedResult.orgId))[0]!.id, "Practitioner/dr-chen");
    expect(link).toBeTruthy();
    // Second launch reuses the same account.
    const agent2 = agentFor();
    await smartLaunch(agent2, { standalone: true });
    expect((await agent2.get("/api/notes/session")).body.user.id).toBe(sess.body.user.id);
    expect((await ctx.storage.listUsers(ctx.seedResult.orgId)).filter((u) => u.username.startsWith("practitioner-dr-chen"))).toHaveLength(1);
  });

  it("rejects a forged state, a context for another patient, and generation without a SMART session", async () => {
    const agent = agentFor();
    await loginAs(agent, "chen");
    const noSession = await agent.post("/api/notes/generate").send({ context: { schemaVersion: 1, patient: { reference: "Patient/x" } }, visit: {} });
    expect(noSession.status).toBe(409);
    const bad = await agent.get("/smart/callback?code=abc&state=forged");
    expect(bad.status).toBe(400);
    await smartLaunch(agent);
    const other = await agent.post("/api/notes/generate").send({
      context: { schemaVersion: 1, patient: { reference: "Patient/someone-else" }, problems: [], medications: [], allergies: [], vitals: [], labs: [], priorNotes: [], knowledge: [], provenance: { sources: [], assembledAt: "", warnings: [] } },
      visit: {},
    });
    expect(other.status).toBe(409);
    expect(other.body.error).toBe("context_patient_mismatch");
  });
});

describe("template versions: upload, activate, roll forward without a deploy", () => {
  it("an org version overrides the platform default and the next note uses it", async () => {
    const director = agentFor();
    await loginAs(director, "director");
    const list = await director.get("/api/notes/templates");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ platformDefault: true, status: "active", version: 1 });

    // Upload v1 of an org template with an extra section and a custom two-midnight phrase.
    const module = {
      ...DEFAULT_TEMPLATE_MODULE,
      sections: [
        ...DEFAULT_TEMPLATE_MODULE.sections.slice(0, 5),
        { key: "social", title: "SOCIAL HISTORY", required: true, guidance: "Tobacco, alcohol, living situation." },
        ...DEFAULT_TEMPLATE_MODULE.sections.slice(5),
      ],
      phrases: { ...DEFAULT_TEMPLATE_MODULE.phrases, twoMidnightInpatient: "Expected length of stay crosses two midnights; inpatient status is appropriate." },
    };
    const invalid = await director.post("/api/notes/templates").send({ name: "Mercy H&P", module: { schemaVersion: 1 } });
    expect(invalid.status).toBe(400);
    const created = await director.post("/api/notes/templates").send({ name: "Mercy H&P", module, changelog: "Add social history" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "draft", version: 1, organizationId: ctx.seedResult.orgId });

    // Still the platform default until activation.
    expect((await director.get("/api/notes/templates/active")).body.platformDefault).toBe(true);
    const act = await director.post(`/api/notes/templates/${created.body.id}/activate`);
    expect(act.status).toBe(200);
    expect(act.body.status).toBe("active");
    const active = await director.get("/api/notes/templates/active");
    expect(active.body).toMatchObject({ name: "Mercy H&P", version: 1, platformDefault: false });
    expect(active.body.sections).toContain("SOCIAL HISTORY");

    // A clinician's next note uses it.
    const chen = agentFor();
    await loginAs(chen, "chen");
    await smartLaunch(chen);
    const pkg = (await chen.post("/api/notes/context").send({})).body.context;
    const gen = await chen.post("/api/notes/generate").send({ context: pkg, visit: { admissionStatus: "inpatient" } });
    expect(gen.status).toBe(200);
    expect(gen.body.templateName).toBe("Mercy H&P");
    expect(gen.body.text).toContain("SOCIAL HISTORY:\n***");
    expect(gen.body.text).toContain("Expected length of stay crosses two midnights");
    expect(gen.body.text.indexOf("SOCIAL HISTORY:")).toBeLessThan(gen.body.text.indexOf("REVIEW OF SYSTEMS:"));

    // v2 retires v1 atomically: exactly one active per scope.
    const v2 = await director.post("/api/notes/templates").send({ name: "Mercy H&P", module: DEFAULT_TEMPLATE_MODULE, activate: true });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ version: 2, status: "active" });
    const all = (await director.get("/api/notes/templates")).body as Array<{ status: string; organizationId: number | null; version: number }>;
    const orgActive = all.filter((t) => t.organizationId != null && t.status === "active");
    expect(orgActive).toHaveLength(1);
    expect(orgActive[0]!.version).toBe(2);
    // Clinicians cannot manage templates.
    expect((await chen.post("/api/notes/templates").send({ name: "x", module })).status).toBe(403);
    const audit = (await director.get("/api/notes/audit")).body as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toContain("notes.template_activated");
  });
});

describe("connectors: enable a new source per org through the same interface", () => {
  it("lists the catalog, enables sources with encrypted secrets, and merges their results in priority order", async () => {
    const director = agentFor();
    await loginAs(director, "director");
    const cat = await director.get("/api/notes/connectors");
    expect(cat.status).toBe(200);
    const keys = cat.body.catalog.map((c: { key: string }) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["uptodate", "baa-llm", "doximity", "openevidence", "metriport"]));
    expect(cat.body.enabled.map((e: { connectorKey: string }) => e.connectorKey)).toEqual(["uptodate"]);

    // Enable OpenEvidence (stub mode) ahead of UpToDate, with a secret.
    const put = await director.put("/api/notes/connectors/openevidence").send({ enabled: true, priority: 1, config: { apiKey: "oe-secret-123" } });
    expect(put.status).toBe(200);
    expect(put.body.config.apiKey).toBe("••••••••");
    const stored = (await ctx.storage.listOrgConnectors(ctx.seedResult.orgId)).find((c) => c.connectorKey === "openevidence")!;
    expect(String(stored.config.apiKey)).toMatch(/^v1\./); // encrypted at rest
    expect(String(stored.config.apiKey)).not.toContain("oe-secret-123");
    expect((await director.put("/api/notes/connectors/nope").send({ enabled: true })).status).toBe(404);

    // Re-saving with the mask keeps the stored secret.
    await director.put("/api/notes/connectors/openevidence").send({ enabled: true, config: { apiKey: "••••••••", question: "What matters today?" } });
    const stored2 = (await ctx.storage.listOrgConnectors(ctx.seedResult.orgId)).find((c) => c.connectorKey === "openevidence")!;
    expect(stored2.config.apiKey).toBe(stored.config.apiKey);
    expect(stored2.config.question).toBe("What matters today?");

    const chen = agentFor();
    await loginAs(chen, "chen");
    await smartLaunch(chen);
    const ctxRes = await chen.post("/api/notes/context").send({});
    expect(ctxRes.body.knowledge.ran).toEqual(["openevidence", "uptodate"]);
    const connectors = (ctxRes.body.context as ContextPackage).knowledge.map((k) => k.connector);
    expect(connectors[0]).toBe("openevidence");
    expect(connectors).toContain("uptodate");

    // Disable UpToDate → gone next time; nothing else changes.
    await director.put("/api/notes/connectors/uptodate").send({ enabled: false });
    const ctx2 = await chen.post("/api/notes/context").send({});
    expect(ctx2.body.knowledge.ran).toEqual(["openevidence"]);

    // Ad-hoc question goes through the first enabled connector.
    const ask = await chen.post("/api/notes/ask").send({ question: "Dose adjust apixaban for AKI?", context: ctx2.body.context });
    expect(ask.status).toBe(200);
    expect(ask.body.connector).toBe("openevidence");

    // External aggregator is on-demand only.
    await director.put("/api/notes/connectors/metriport").send({ enabled: true });
    const noExt = await chen.post("/api/notes/context").send({});
    expect(noExt.body.external.ran).toEqual([]);
    const withExt = await chen.post("/api/notes/context").send({ includeExternal: true });
    expect(withExt.body.external.ran).toEqual(["metriport"]);
    expect(withExt.body.context.provenance.sources).toContain("aggregator:metriport(stub)");
  });
});

describe("licensing: enforced before generation and export", () => {
  it("usage caps and seat limits return 402; the developer manages licenses cross-tenant", async () => {
    const dev = agentFor();
    await loginAs(dev, "dev", "DOCTURN");
    const orgId = ctx.seedResult.orgId;
    const set = await dev.put(`/api/notes/license/${orgId}`).send({ plan: "usage", usageCap: 1 });
    expect(set.status).toBe(200);
    expect(set.body.plan).toBe("usage");

    const chen = agentFor();
    await loginAs(chen, "chen");
    await smartLaunch(chen);
    const pkg = (await chen.post("/api/notes/context").send({})).body.context;
    expect((await chen.post("/api/notes/generate").send({ context: pkg, visit: {} })).status).toBe(200);
    const blocked = await chen.post("/api/notes/generate").send({ context: pkg, visit: {} });
    expect(blocked.status).toBe(402);
    expect(blocked.body.reason).toBe("usage_exhausted");
    // Export of an existing draft is still allowed under a usage cap (cap is on generations).
    expect((await chen.post("/api/notes/export").send({ mode: "clipboard", note: "x" })).status).toBe(200);

    // Seat plan: one seat, already consumed by chen this period → patel is refused.
    await dev.put(`/api/notes/license/${orgId}`).send({ plan: "seat", seats: 1 });
    const patel = agentFor();
    await loginAs(patel, "patel");
    await smartLaunch(patel, { launch: "practitioner:dr-patel" });
    expect((await patel.get("/api/notes/session")).body.user.username).toBe("patel");
    const pkg2 = (await patel.post("/api/notes/context").send({})).body.context;
    const seat = await patel.post("/api/notes/generate").send({ context: pkg2, visit: {} });
    expect(seat.status).toBe(402);
    expect(seat.body.reason).toBe("seats_exhausted");
    expect((await chen.post("/api/notes/generate").send({ context: pkg, visit: {} })).status).toBe(200);

    // Suspended → everything stops; director can read usage but not change the plan.
    await dev.put(`/api/notes/license/${orgId}`).send({ plan: "seat", seats: 1, status: "suspended" });
    expect((await chen.post("/api/notes/export").send({ mode: "clipboard", note: "x" })).status).toBe(402);
    const director = agentFor();
    await loginAs(director, "director");
    const view = await director.get("/api/notes/license");
    expect(view.body.license.status).toBe("suspended");
    expect(view.body.usage.seatsUsed).toBe(1);
    expect((await director.put(`/api/notes/license/${orgId}`).send({ plan: "trial" })).status).toBe(403);
  });
});

describe("EHR onboarding is configuration, not code", () => {
  it("a director registers a new EHR endpoint; the client secret is encrypted and never returned", async () => {
    const director = agentFor();
    await loginAs(director, "director");
    const created = await director.put("/api/notes/ehr").send({
      name: "Epic (production)",
      vendor: "epic",
      iss: "https://fhir.example-health.org/api/FHIR/R4/",
      clientId: "abc-123",
      clientSecret: "super-secret",
      writeBack: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.iss).toBe("https://fhir.example-health.org/api/FHIR/R4");
    expect(created.body.hasClientSecret).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain("super-secret");
    const row = await ctx.storage.getEhrConnection(ctx.seedResult.orgId, created.body.id);
    expect(row!.clientSecretEnc).toMatch(/^v1\./);
    const list = await director.get("/api/notes/ehr");
    expect(list.body.map((c: { vendor: string }) => c.vendor).sort()).toEqual(["epic", "mock"]);
    // Unknown iss → 404 at launch (no tenant resolves it).
    const r = await director.get(`/smart/launch?iss=${encodeURIComponent("https://unknown.example.org/fhir")}&launch=x`);
    expect(r.status).toBe(404);
  });
});

describe("HARD_LOCK post-processors (pure)", () => {
  const pkg: ContextPackage = {
    schemaVersion: 1,
    patient: { reference: "Patient/1", age: 70, sex: "male" },
    problems: [{ display: "Pneumonia", poa: "Y" }, { display: "Delirium", poa: "N" }],
    medications: [{ genericName: "furosemide", display: "Lasix 40 MG", source: "MedicationRequest" }],
    allergies: [], vitals: [], labs: [], priorNotes: [], knowledge: [],
    provenance: { sources: [], assembledAt: "", warnings: [] },
  };
  it("strips units, escapes dashes, genericizes, orders sections, tags POA, balances A&P, scrubs identifiers", () => {
    expect(stripUnits("K 3.2 mmol/L, Cr 1.4 mg/dL, BP 120/80 mmHg, HR 88 bpm, SpO2 95%")).toBe("K 3.2, Cr 1.4, BP 120/80, HR 88, SpO2 95");
    expect(escapeDashLists("- one\n• two\n1. three\n\\- four")).toBe("\\- one\n\\- two\n\\- three\n\\- four");
    const llmOutput = [
      "## ASSESSMENT AND PLAN:",
      "**Pneumonia**",
      "- Start Rocephin 1 g IV daily",
      "Delirium",
      "",
      "CHIEF COMPLAINT:",
      "Cough. MRN: 12345. DOB: 01/02/1950",
      "RANDOM SECTION:",
      "noise",
    ].join("\n");
    const out = applyHardLocks(llmOutput, DEFAULT_TEMPLATE_MODULE, pkg, { admissionStatus: "observation" });
    const t = out.text;
    expect(t.startsWith("CHIEF COMPLAINT:\nCough. MRN ***. DOB ***")).toBe(true);
    expect(t).not.toContain("RANDOM SECTION");
    expect(t).toContain("Pneumonia (POA)\n\\- Start ceftriaxone 1 IV daily");
    expect(t).toContain("Delirium (not POA)\n\\- Plan: ***");
    expect(t).toContain("DISPOSITION:\nObservation status; anticipated hospital stay is less than two midnights");
    expect(t).not.toMatch(/[#]|(?<!\*)\*\*(?!\*)/);
    expect(out.sections.map((s) => s.key)).toEqual(DEFAULT_TEMPLATE_MODULE.sections.map((s) => s.key));
    expect(out.warnings).toEqual(expect.arrayContaining(["identifiers_scrubbed:2", "two_midnight_added", "units_stripped"]));
  });
});
