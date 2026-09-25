import { generateKeyPairSync, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { createTestApp, login, type TestContext } from "./helpers.js";
import { invalidateModules, setModule } from "../server/modules.js";
import { syncAmion } from "../server/services/amion.js";
import {
  buildClientAssertion,
  createEpicSource,
  epicConfigured,
  parseEpicBundle,
  syncEpic,
} from "../server/services/schedule-sources/epic-fhir.js";
import { getSelectedSource } from "../server/services/schedule-sources/index.js";
import {
  configureOnCallSources,
  resolveEhrLink,
  validateEhrTemplate,
} from "../server/routes/oncall.js";

const AMION_HTML = readFileSync(new URL("./fixtures/amion-ocs.html", import.meta.url), "utf8");
const EPIC_BUNDLE = JSON.parse(
  readFileSync(new URL("./fixtures/epic-practitionerrole.json", import.meta.url), "utf8"),
);
/** Inside the fixture's day slots (07:00–19:00Z on 2026-09-03). */
const EPIC_NOW = new Date("2026-09-03T12:00:00Z");

// ── helpers ──────────────────────────────────────────────────────────────────
function serveAmion(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(AMION_HTML);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/ocs?Lo=test-fixture` });
    });
  });
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

const EPIC_ENV = {
  EPIC_FHIR_BASE_URL: "https://fhir.example-epic.test/api/FHIR/R4",
  EPIC_CLIENT_ID: "docturn-nonprod-client",
  EPIC_PRIVATE_KEY_PEM: PRIVATE_PEM,
  EPIC_TOKEN_URL: "https://fhir.example-epic.test/oauth2/token",
  EPIC_ORG_CODE: "ISPN",
} as NodeJS.ProcessEnv;

/** Offline stand-in for Epic: token endpoint + FHIR searches answered from the fixture. */
function stubEpicFetch(calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === EPIC_ENV.EPIC_TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "tok-123", token_type: "bearer", expires_in: 300 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if ((init?.headers as Record<string, string>)?.Authorization !== "Bearer tok-123") {
      return new Response("{}", { status: 401 });
    }
    if (url.includes("/PractitionerRole?")) {
      return new Response(JSON.stringify(EPIC_BUNDLE), { status: 200, headers: { "Content-Type": "application/fhir+json" } });
    }
    if (url.includes("/Slot?")) {
      // Slot search on a site that doesn't model on-call as Slot → 404.
      return new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

const ENV_KEYS = ["AMION_OCS_URL", "AMION_ORG_CODE"] as const;
const savedEnv: Record<string, string | undefined> = {};
let ctx: TestContext;
let amion: { server: Server; url: string } | null = null;

beforeEach(async () => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  configureOnCallSources({});
  // The module map is cached per org id for a few seconds; every test gets a
  // fresh DB with the same ids, so drop the cache between tests.
  invalidateModules();
  ctx = await createTestApp();
});
afterEach(async () => {
  amion?.server.close();
  amion = null;
  configureOnCallSources({});
  invalidateModules();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await ctx.handle.close();
});

async function withAmion() {
  amion = await serveAmion();
  process.env.AMION_OCS_URL = amion.url;
  process.env.AMION_ORG_CODE = "ISPN";
  await syncAmion(ctx.storage);
}

// ── board ────────────────────────────────────────────────────────────────────
describe("on-call board", () => {
  it("merges Amion slots, consult-service holders and the next hospitalist", async () => {
    await withAmion();
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch("/api/org/preferences").send({
      consultServices: [
        { id: "cs-card", name: "Cardiology", onCall: { name: "Dr. Sharon George", avatar: "SG" }, members: [] },
        { id: "cs-gi", name: "GI", onCall: null, members: [] },
      ],
    });

    const res = await director.get("/api/oncall/board");
    expect(res.status).toBe(200);
    expect(res.body.source.id).toBe("amion");
    expect(res.body.source.explicit).toBe(false); // defaulted: Amion is configured for ISPN
    expect(res.body.source.status.configured).toBe(true);
    expect(res.body.source.status.rowCount).toBe(13);

    const rows = res.body.rows as any[];
    const schedule = rows.filter((r) => r.kind === "schedule");
    expect(schedule).toHaveLength(13);
    const t1 = schedule.find((r) => r.label === "Tarzana 1");
    expect(t1).toMatchObject({ holderName: "May Lou", hours: "7a-7p", shift: "day", source: "amion", group: "Hospitalist slots" });
    expect(t1.asOf).toBeTruthy();
    // Grid names resolve to real in-org users regardless of the "Dr." prefix.
    const t7 = schedule.find((r) => r.label === "Tarzana 7");
    expect(t7.holderUserId).toBe(ctx.seedResult.userIds.chen); // "Alyesh, Nathan" → Dr. Nathan Alyesh
    expect(t7.messageable).toBe(true);
    expect(schedule.find((r) => r.label === "North Triage").group).toBe("Triage");
    expect(schedule.find((r) => r.label === "Tarzana Night XC").group).toBe("Night");
    // Gopal holds two slots — both stay (distinct slots), no duplicate rows.
    expect(schedule.filter((r) => r.holderName === "Arun Gopal")).toHaveLength(2);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Consult services: resolved holder shows; an empty on-call still lists the service (unmessageable).
    const cardio = rows.find((r) => r.id === "consult_service:cs-card");
    expect(cardio).toMatchObject({ group: "Consult services", holderUserId: ctx.seedResult.userIds.patel, messageable: true, source: "consults" });
    const gi = rows.find((r) => r.id === "consult_service:cs-gi");
    expect(gi).toMatchObject({ holderName: null, holderUserId: null, messageable: false });

    // Next hospitalist: same answer as the messaging picker (chen, lowest census).
    const next = rows.find((r) => r.kind === "next_hospitalist");
    expect(next).toMatchObject({ group: "Next up", holderUserId: ctx.seedResult.userIds.chen, source: "rotation" });

    // Every resolved holder is a real user of the caller's org.
    for (const r of rows) {
      if (r.holderUserId != null) expect(await ctx.storage.getUser(ctx.seedResult.orgId, r.holderUserId)).toBeTruthy();
    }
  });

  it("reflects DND → covering on the holder, and is never messageable to yourself", async () => {
    await withAmion();
    // Patel (Dr. Sharon George, Tarzana 6) goes DND with Lopez covering.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    await patel.patch("/api/settings/me").send({ key: "dnd", value: true });
    await patel.patch("/api/settings/me").send({ key: "coveringUserId", value: ctx.seedResult.userIds.lopez });

    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    const res = await erDoc.get("/api/oncall/board");
    const t6 = (res.body.rows as any[]).find((r) => r.label === "Tarzana 6");
    expect(t6.holderUserId).toBe(ctx.seedResult.userIds.patel);
    expect(t6.dnd).toBe(true);
    expect(t6.covering).toEqual({ userId: ctx.seedResult.userIds.lopez, name: "Dr. Amir Ahmed" });
    expect(t6.messageUserId).toBe(ctx.seedResult.userIds.lopez);
    expect(t6.messageable).toBe(true);

    // DND with no covering → shown, but unreachable.
    const { agent: kohan } = await login(ctx.app, { username: "kohan" });
    await kohan.patch("/api/settings/me").send({ key: "dnd", value: true });
    const res2 = await erDoc.get("/api/oncall/board");
    const night = (res2.body.rows as any[]).find((r) => r.label === "Tarzana Night Triage");
    expect(night).toMatchObject({ dnd: true, covering: null, messageable: false, messageUserId: null });

    // Chen sees his own slot but can't message himself.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const mine = (await chen.get("/api/oncall/board")).body.rows.find((r: any) => r.label === "Tarzana 7");
    expect(mine.holderUserId).toBe(ctx.seedResult.userIds.chen);
    expect(mine.messageable).toBe(false);
  });

  it("dedupes identical manual slots and falls back to manual when Amion isn't configured", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const sources = await director.get("/api/oncall/sources");
    expect(sources.status).toBe(200);
    expect(sources.body.selected).toBe("manual");
    expect(sources.body.sources.amion.configured).toBe(false);
    expect(sources.body.sources.epic.configured).toBe(false);
    expect(sources.body.sources.epic.message).toMatch(/Epic app credentials/);
    expect(sources.body.sources.manual.configured).toBe(true);

    const slot = { slot: "Swing", hours: "2p-10p", providerName: "Dr. Naira Manukian" };
    expect((await director.post("/api/oncall/manual").send(slot)).status).toBe(201);
    expect((await director.post("/api/oncall/manual").send(slot)).status).toBe(201);
    const board = await director.get("/api/oncall/board");
    const swing = (board.body.rows as any[]).filter((r) => r.label === "Swing");
    expect(swing).toHaveLength(1);
    expect(swing[0]).toMatchObject({ source: "manual", shift: "swing", holderUserId: ctx.seedResult.userIds.manukian });
  });

  it("is unavailable without auth and 404 module_disabled when the board module is off", async () => {
    expect((await supertest(ctx.app).get("/api/oncall/board")).status).toBe(401);
    await setModule(ctx.seedResult.orgId, "oncall.board", false);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.get("/api/oncall/board");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("module_disabled");
  });
});

// ── source selection ─────────────────────────────────────────────────────────
describe("schedule source selection", () => {
  it("persists a director's choice, validates it, and gates by role/module", async () => {
    await withAmion();
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });

    expect((await chen.patch("/api/oncall/source").send({ source: "manual" })).status).toBe(403);
    expect((await director.patch("/api/oncall/source").send({ source: "qgenda" })).status).toBe(400);
    // Epic is off by default (module schedule.epic) → cannot be selected.
    const epicOff = await director.patch("/api/oncall/source").send({ source: "epic" });
    expect(epicOff.status).toBe(404);
    expect(epicOff.body).toMatchObject({ error: "module_disabled", module: "schedule.epic" });

    const set = await director.patch("/api/oncall/source").send({ source: "manual" });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ selected: "manual", explicit: true });
    expect(await getSelectedSource(ctx.storage, ctx.seedResult.orgId)).toEqual({ id: "manual", explicit: true });

    // The board now reads the manual list even though Amion is live.
    const board = await chen.get("/api/oncall/board");
    expect(board.body.source).toMatchObject({ id: "manual", explicit: true });
    expect(board.body.rows.filter((r: any) => r.kind === "schedule")).toHaveLength(0);
    const src = await chen.get("/api/oncall/sources");
    expect(src.body.selected).toBe("manual");
    expect(src.body.sources.amion).toMatchObject({ configured: true, rowCount: 13, lastStatus: "ok" });

    // Back to Amion — survives across requests.
    expect((await director.patch("/api/oncall/source").send({ source: "amion" })).status).toBe(200);
    expect((await chen.get("/api/oncall/board")).body.source.id).toBe("amion");
  });
});

// ── manual slots ─────────────────────────────────────────────────────────────
describe("manual on-call slots", () => {
  it("CRUD by directors only; readable by everyone in the org", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });

    expect((await chen.post("/api/oncall/manual").send({ slot: "X", providerName: "Y" })).status).toBe(403);
    expect((await erDoc.post("/api/oncall/manual").send({ slot: "X", providerName: "Y" })).status).toBe(403);
    expect((await director.post("/api/oncall/manual").send({ providerName: "no slot" })).status).toBe(400);

    const created = await director.post("/api/oncall/manual").send({
      slot: "Weekend Triage", hours: "7a-7p", providerName: "Dr. Arun Gopal", group: "ISP Hospitalist",
      providerUserId: 999999, // not an in-org user → dropped, name still resolves
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slot: "Weekend Triage", shift: "day", providerUserId: null, group: "ISP Hospitalist" });
    const id = created.body.id as string;

    const list = await chen.get("/api/oncall/manual");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const patched = await director.patch(`/api/oncall/manual/${id}`).send({ hours: "7p-7a", providerUserId: ctx.seedResult.userIds.kohan });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ hours: "7p-7a", shift: "night", providerUserId: ctx.seedResult.userIds.kohan });
    expect((await chen.patch(`/api/oncall/manual/${id}`).send({ hours: "7a-7p" })).status).toBe(403);
    expect((await director.patch("/api/oncall/manual/nope").send({ hours: "7a-7p" })).status).toBe(404);

    // Board honours the pinned user over the (different) name.
    const row = (await chen.get("/api/oncall/board")).body.rows.find((r: any) => r.label === "Weekend Triage");
    expect(row).toMatchObject({ group: "Triage", holderUserId: ctx.seedResult.userIds.kohan, holderName: "Dr. Arun Gopal", source: "manual" });

    expect((await chen.delete(`/api/oncall/manual/${id}`)).status).toBe(403);
    expect((await director.delete(`/api/oncall/manual/${id}`)).status).toBe(204);
    expect((await director.delete(`/api/oncall/manual/${id}`)).status).toBe(404);
    expect((await chen.get("/api/oncall/manual")).body).toHaveLength(0);

    // Every mutation is audited.
    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId);
    for (const action of ["oncall.manual_add", "oncall.manual_update", "oncall.manual_remove"]) {
      expect(audit.some((r) => r.action === action)).toBe(true);
    }
  });
});

// ── Epic adapter ─────────────────────────────────────────────────────────────
describe("epic FHIR adapter", () => {
  it("parses a PractitionerRole/Practitioner/Schedule/Slot bundle into on-call rows", () => {
    const rows = parseEpicBundle(EPIC_BUNDLE, EPIC_NOW);
    expect(rows.map((r) => r.slot).sort()).toEqual(["Cardiology On Call", "Hospitalist Day 1", "Night Triage"]);
    expect(rows.find((r) => r.slot === "Hospitalist Day 1")).toMatchObject({
      providerName: "Nathan Alyesh", service: "Hospital Medicine", hours: "7a-7p", shift: "day", group: "ISP North",
    });
    expect(rows.find((r) => r.slot === "Night Triage")).toMatchObject({ providerName: "Salar Kohan", hours: "7p-7a", shift: "night" });
    // Slot in the current window → holder from the Schedule's practitioner actor.
    expect(rows.find((r) => r.slot === "Cardiology On Call")).toMatchObject({
      providerName: "Sharon George", service: "Cardiology", hours: "7a-7p", shift: "day",
    });
    // Expired period, inactive role, tomorrow's slot and free slots are excluded.
    expect(rows.some((r) => r.slot === "Hospitalist Day 2" || r.slot === "Hospitalist Day 3")).toBe(false);
    // Outside the slot window nothing from Slot survives; roles without a period still do.
    const later = parseEpicBundle(EPIC_BUNDLE, new Date("2026-09-05T12:00:00Z"));
    expect(later.map((r) => r.slot)).toEqual(["Night Triage"]);
  });

  it("signs an RS384 client assertion addressed to the token endpoint", () => {
    const jwt = buildClientAssertion(
      { clientId: EPIC_ENV.EPIC_CLIENT_ID!, privateKeyPem: PRIVATE_PEM, tokenUrl: EPIC_ENV.EPIC_TOKEN_URL! },
      EPIC_NOW,
    );
    const [h = "", p = "", s = ""] = jwt.split(".");
    const dec = (x: string) => JSON.parse(Buffer.from(x.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    expect(dec(h)).toEqual({ alg: "RS384", typ: "JWT" });
    const claims = dec(p);
    expect(claims).toMatchObject({ iss: "docturn-nonprod-client", sub: "docturn-nonprod-client", aud: EPIC_ENV.EPIC_TOKEN_URL });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
    const v = createVerify("RSA-SHA384");
    v.update(`${h}.${p}`);
    expect(v.verify(PUBLIC_PEM, Buffer.from(s!.replace(/-/g, "+").replace(/_/g, "/"), "base64"))).toBe(true);
  });

  it("reports configured:false with the credential hint when env is absent — never fake data", async () => {
    expect(epicConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    const src = createEpicSource(ctx.storage, { env: {} as NodeJS.ProcessEnv });
    const st = await src.status(ctx.seedResult.orgId);
    expect(st).toMatchObject({ configured: false, lastStatus: "never", rowCount: 0 });
    expect(st.message).toMatch(/needs Epic app credentials \(App Orchard\/Vendor Services registration\)/);
    expect(await src.fetch(ctx.seedResult.orgId)).toEqual([]);
    // Configured for ANOTHER org → still nothing for this one.
    const other = createEpicSource(ctx.storage, { env: { ...EPIC_ENV, EPIC_ORG_CODE: "HOSP" } });
    expect((await other.status(ctx.seedResult.orgId)).configured).toBe(false);
    expect(await other.fetch(ctx.seedResult.orgId)).toEqual([]);
  });

  it("syncs offline through an injected fetch and drives the board when selected", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const deps = { fetchImpl: stubEpicFetch(calls), now: () => EPIC_NOW, env: EPIC_ENV };
    const state = await syncEpic(ctx.storage, deps);
    expect(state.lastStatus).toBe("ok");
    expect(state.rowCount).toBe(3);
    expect(calls[0]!.url).toBe(EPIC_ENV.EPIC_TOKEN_URL);
    expect(String(calls[0]!.init?.body)).toContain("grant_type=client_credentials");
    expect(String(calls[0]!.init?.body)).toContain("client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer");
    expect(calls.some((c) => c.url.includes("/PractitionerRole?active=true&_include=PractitionerRole:practitioner"))).toBe(true);
    // No secret ever lands in the stored state.
    const stored = JSON.stringify(await ctx.storage.getOrgSetting(ctx.seedResult.orgId, "epicSync"));
    expect(stored).not.toContain("PRIVATE KEY");
    expect(stored).not.toContain(EPIC_ENV.EPIC_CLIENT_ID!);

    // Select Epic (module on) and read the board.
    configureOnCallSources({ epic: deps });
    await setModule(ctx.seedResult.orgId, "schedule.epic", true);
    const { agent: director } = await login(ctx.app, { username: "director" });
    expect((await director.patch("/api/oncall/source").send({ source: "epic" })).status).toBe(200);
    const board = await director.get("/api/oncall/board");
    expect(board.body.source).toMatchObject({ id: "epic", status: { configured: true, rowCount: 3, lastStatus: "ok" } });
    const rows = board.body.rows.filter((r: any) => r.kind === "schedule");
    expect(rows).toHaveLength(3);
    expect(rows.find((r: any) => r.label === "Hospitalist Day 1")).toMatchObject({
      holderUserId: ctx.seedResult.userIds.chen, source: "epic", group: "Hospitalist slots", messageable: true,
    });
    expect(rows.find((r: any) => r.label === "Cardiology On Call").holderUserId).toBe(ctx.seedResult.userIds.patel);

    // sync-now: role + module gated; refreshes the snapshot.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.post("/api/oncall/epic/sync-now")).status).toBe(403);
    const sync = await director.post("/api/oncall/epic/sync-now");
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ id: "epic", configured: true, rowCount: 3 });
    expect(JSON.stringify(sync.body)).not.toContain(EPIC_ENV.EPIC_CLIENT_ID!);
    await setModule(ctx.seedResult.orgId, "schedule.epic", false);
    expect((await director.post("/api/oncall/epic/sync-now")).status).toBe(404);
  });

  it("keeps the last good snapshot and records the error when Epic is unreachable", async () => {
    const good = { fetchImpl: stubEpicFetch(), now: () => EPIC_NOW, env: EPIC_ENV };
    await syncEpic(ctx.storage, good);
    const failing: typeof fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    const state = await syncEpic(ctx.storage, { ...good, fetchImpl: failing });
    expect(state.lastStatus).toBe("error");
    expect(state.lastError).toBe("epic_token_http_503");
    expect(state.rowCount).toBe(3);
    expect(state.slots).toHaveLength(3);
    // sync-now without credentials answers 409 with the hint, never 500.
    configureOnCallSources({ epic: { env: {} as NodeJS.ProcessEnv } });
    await setModule(ctx.seedResult.orgId, "schedule.epic", true);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.post("/api/oncall/epic/sync-now");
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Epic app credentials/);
  });
});

// ── EHR deep links ───────────────────────────────────────────────────────────
describe("EHR deep links", () => {
  const HAIKU = "epichaiku://launch?mrn={ehrId}";

  it("validates templates and resolves them with a URL-safe id", () => {
    expect(validateEhrTemplate(HAIKU)).toBeNull();
    expect(validateEhrTemplate("https://epic.example.org/Launch?mrn={ehrId}&csn={csn}")).toBeNull();
    expect(validateEhrTemplate("javascript:alert({ehrId})")).toBe("template_scheme");
    expect(validateEhrTemplate("https://x/{mrn}")).toBe("template_missing_placeholder");
    expect(validateEhrTemplate("epichaiku://launch?mrn={ehrId} ")).not.toBeNull(); // trimmed by zod, but raw whitespace is rejected
    expect(validateEhrTemplate("")).toBe("template_required");
    expect(resolveEhrLink(HAIKU, "MRN 12/34&x")).toBe("epichaiku://launch?mrn=MRN%2012%2F34%26x");
  });

  it("is 404 module_disabled until the module is on, then configured by a director", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    const pid = ctx.seedResult.patientIds.sc;

    const off = await erDoc.get(`/api/patients/${pid}/ehr-link`);
    expect(off.status).toBe(404);
    expect(off.body).toMatchObject({ error: "module_disabled", module: "ehr.deepLinks" });

    await setModule(ctx.seedResult.orgId, "ehr.deepLinks", true);
    expect((await erDoc.get(`/api/patients/${pid}/ehr-link`)).status).toBe(409); // module on, nothing configured

    // Config: readable by anyone signed in, writable by directors only, validated.
    const cfg0 = await erDoc.get("/api/ehr/config");
    expect(cfg0.status).toBe(200);
    expect(cfg0.body).toMatchObject({ configured: false, moduleEnabled: true });
    expect(cfg0.body.presets.epic_haiku.template).toBe(HAIKU);
    expect((await erDoc.patch("/api/ehr/config").send({ vendor: "epic", template: HAIKU })).status).toBe(403);
    expect((await director.patch("/api/ehr/config").send({ vendor: "epic", template: "javascript:alert(1)//{ehrId}" })).status).toBe(400);
    // A preset still carrying the placeholder host is stored but NOT configured.
    const placeholder = await director.patch("/api/ehr/config").send({ vendor: "cerner", template: cfg0.body.presets.cerner_powerchart.template });
    expect(placeholder.status).toBe(200);
    expect(placeholder.body.configured).toBe(false);
    const set = await director.patch("/api/ehr/config").send({ vendor: "epic", template: HAIKU });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ vendor: "epic", template: HAIKU, configured: true });
    // Seed patient has no EHR id → explicit 404 no_ehr_id (not a fabricated link).
    const none = await erDoc.get(`/api/patients/${pid}/ehr-link`);
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("no_ehr_id");
  });

  it("resolves for the care team and directors only, and audits every read as PHI", async () => {
    await setModule(ctx.seedResult.orgId, "ehr.deepLinks", true);
    const { agent: director } = await login(ctx.app, { username: "director" });
    await director.patch("/api/ehr/config").send({ vendor: "epic", template: HAIKU });
    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });

    expect((await erDoc.post("/api/patients").send({ initials: "AB", issueSummary: "x", ehrId: "bad id!" })).status).toBe(400);
    const created = await erDoc.post("/api/patients").send({ initials: "AB", roomNumber: "310", issueSummary: "Sepsis", ehrId: "E1234567" });
    expect(created.status).toBe(201);
    const pid = created.body.id as number;

    // Admitting ER doc is on the team.
    const link = await erDoc.get(`/api/patients/${pid}/ehr-link`);
    expect(link.status).toBe(200);
    expect(link.body).toEqual({ url: "epichaiku://launch?mrn=E1234567", vendor: "epic" });
    // A hospitalist with no relationship → 403; developer → 403; other org → 404.
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    expect((await patel.get(`/api/patients/${pid}/ehr-link`)).status).toBe(403);
    // The developer lives in the platform org: either the module gate (404) or
    // the developer rule (403) denies — never a link.
    const { agent: dev } = await login(ctx.app, { username: "dev", orgCode: "DOCTURN" });
    const devRes = await dev.get(`/api/patients/${pid}/ehr-link`);
    expect([403, 404]).toContain(devRes.status);
    expect(devRes.body.url).toBeUndefined();
    // Route the patient to Patel → now on the team (pending assignment).
    const asg = await erDoc.post("/api/assignments").send({ patientId: pid, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds.patel });
    expect(asg.status).toBe(201);
    expect((await patel.get(`/api/patients/${pid}/ehr-link`)).status).toBe(200);
    // Director oversight is allowed but audited high.
    expect((await director.get(`/api/patients/${pid}/ehr-link`)).status).toBe(200);
    expect((await director.get("/api/patients/999999/ehr-link")).status).toBe(404);

    const audit = await ctx.storage.listAuditLogs(ctx.seedResult.orgId);
    expect(audit.filter((r) => r.action === "ehr.deeplink_open")).toHaveLength(2);
    const oversight = audit.find((r) => r.action === "ehr.deeplink_open_oversight");
    expect(oversight).toMatchObject({ riskLevel: "high", resourceId: pid });
    // PHI access log: one row per read, identifying the patient, never the id itself.
    const phi = await ctx.storage.listPhiAccess(ctx.seedResult.orgId, 500);
    const reads = phi.filter((r) => r.resource === "patient-ehr-link");
    expect(reads).toHaveLength(3);
    expect(reads.every((r) => r.patientId === pid)).toBe(true);
    expect(JSON.stringify([...audit, ...phi])).not.toContain("E1234567");
  });

  it("never lets the EHR id reach messaging responses, WebSocket or push payloads", async () => {
    const SECRET = "MRN-SECRET-4242";
    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    const created = await erDoc.post("/api/patients").send({ initials: "ZQ", issueSummary: "Chest pain", ehrId: SECRET });
    const pid = created.body.id as number;
    const asg = await erDoc.post("/api/assignments").send({ patientId: pid, mode: "manual", hospitalistId: ctx.seedResult.hospitalistIds.chen });
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.patch(`/api/assignments/${asg.body.id}/accept`)).status).toBe(200); // chen joins the care team

    // Patient thread + a message + a STAT message (push/WS fan-out).
    const thread = await erDoc.post("/api/messaging/patient-thread").send({ patientId: pid });
    expect(thread.status).toBeLessThan(300);
    await erDoc.post("/api/messaging/send").send({ conversationId: thread.body.id, content: "please see", priority: "stat" });
    const direct = await chen.post("/api/messaging/conversations").send({ type: "direct", participantIds: [ctx.seedResult.userIds["er.doc"]] });
    await chen.post("/api/messaging/send").send({ conversationId: direct.body.id, content: "on my way" });

    const bodies: unknown[] = [];
    for (const agent of [erDoc, chen]) {
      for (const path of [
        "/api/messaging/conversations",
        `/api/messaging/conversations/${thread.body.id}/messages`,
        `/api/messaging/conversations/${direct.body.id}/messages`,
        "/api/messaging/on-call-targets",
        "/api/oncall/board",
        "/api/patient-board",
      ]) {
        const r = await agent.get(path);
        expect(r.status, path).toBe(200);
        bodies.push(r.body);
      }
    }
    expect(JSON.stringify(bodies)).not.toContain(SECRET);
    // Anything fanned out over the socket or pushed to a device is PHI-free too.
    expect(ctx.ws.delivered.length).toBeGreaterThan(0);
    expect(JSON.stringify(ctx.ws.delivered)).not.toContain(SECRET);
    expect(JSON.stringify(ctx.push.sent)).not.toContain(SECRET);
    expect(JSON.stringify(ctx.sms.sent ?? [])).not.toContain(SECRET);
  });
});
