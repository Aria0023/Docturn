import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onSessionsRevoked } from "../server/auth.js";
import { invalidateModules } from "../server/modules.js";
import { ensureDemoTenants } from "../server/seed.js";
import { createTestApp, login, type TestContext } from "./helpers.js";

/**
 * The org-admin screens' server contract (People, Roles, Settings → shift
 * types, Appearance, Consult services, developer console). Every control on
 * those screens must claim only what these routes enforce and persist:
 *
 *   - People: a director adds any clinical role (PA/NP as a credentialed
 *     hospitalist) through POST /api/director/hospitalists; an ER director
 *     only ER physicians. The roster is GET /api/accounts (own org only).
 *   - Shift types: the org's routable set is organizations.round_robin_shift_types
 *     (PATCH /api/org/config, director only) — never empty, no duplicates.
 *   - Appearance: PATCH /api/org/preferences { theme } is validated and MERGED
 *     key by key, so two admins changing different keys never undo each other.
 *   - Consult services: item-level routes under /api/org/consult-services,
 *     each a locked read-modify-write with an audit row, so concurrent edits by
 *     two admins never delete each other's confirmed change; the legacy
 *     whole-array PATCH refuses a stale copy (consultServicesVersion).
 *   - Developer: "Sign out all" really ends every other session
 *     (POST /api/dev/sessions/revoke-all); per-org rule writes are validated.
 */

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestApp();
  invalidateModules(); // the module cache is per process; each test has a fresh DB
});
afterEach(async () => {
  await ctx.handle.close();
});

const devLogin = () => login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
const as = async (username: string, orgCode = "ISPN") => (await login(ctx.app, { username, orgCode })).agent;
const audit = (orgId = ctx.seedResult.orgId) => ctx.storage.listAuditLogs(orgId, 200);

async function setModule(id: string, enabled: boolean, orgId = ctx.seedResult.orgId) {
  const { agent: dev } = await devLogin();
  await dev.patch(`/api/dev/modules/${orgId}`).send({ id, enabled }).expect(200);
  invalidateModules();
}

// ── People ────────────────────────────────────────────────────────────────
describe("People: the roster and Add person are the server's", () => {
  it("director's roster is their own org from /api/accounts — no other tenant", async () => {
    await ensureDemoTenants(ctx.storage);
    const director = await as("director");
    const res = await director.get("/api/accounts").expect(200);
    expect(res.body.length).toBeGreaterThan(5);
    expect(res.body.every((u: any) => u.org === "ISPN")).toBe(true);
    expect(res.body.some((u: any) => u.username === "chen" && u.role === "hospitalist")).toBe(true);
  });

  it("director adds a PA/NP (credentialed hospitalist) and an ER director; both appear in /api/accounts", async () => {
    const director = await as("director");
    const np = await director.post("/api/director/hospitalists").send({ username: "riley.np", displayName: "Riley Quinn, NP", role: "hospitalist", credential: "NP", specialty: "Hospital Medicine" });
    expect(np.status).toBe(201);
    expect(typeof np.body.temporaryPassword).toBe("string");
    const erd = await director.post("/api/director/hospitalists").send({ username: "new.erd", displayName: "Dr. New ER Director", role: "er_director" });
    expect(erd.status).toBe(201);
    const list = (await director.get("/api/accounts").expect(200)).body;
    expect(list.find((u: any) => u.username === "riley.np")).toMatchObject({ role: "hospitalist", credential: "NP", specialty: "Hospital Medicine", mustChangePassword: true });
    expect(list.find((u: any) => u.username === "new.erd")).toMatchObject({ role: "er_director" });
    expect((await audit()).some((a) => a.action === "provider.create")).toBe(true);
  });

  it("ER director may add only ER physicians", async () => {
    const erDir = await as("er.director");
    await erDir.post("/api/director/hospitalists").send({ username: "x.hosp", displayName: "X Hosp", role: "hospitalist" }).expect(403);
    await erDir.post("/api/director/hospitalists").send({ username: "x.erd", displayName: "X ERD", role: "er_director" }).expect(403);
    await erDir.post("/api/director/hospitalists").send({ username: "x.erdoc", displayName: "Dr. X ER", role: "er_doctor" }).expect(201);
  });

  it("the developer-only route the old form used refuses directors (403)", async () => {
    const director = await as("director");
    await director.post("/api/dev/users").send({ organizationId: ctx.seedResult.orgId, role: "hospitalist", displayName: "Nope", username: "nope" }).expect(403);
  });
});

// ── Settings → Shift types ────────────────────────────────────────────────
describe("Shift types: the routable set is organizations.round_robin_shift_types", () => {
  it("GET /api/org/config reports the org's routable shift types", async () => {
    const director = await as("director");
    const cfg = (await director.get("/api/org/config").expect(200)).body;
    expect(cfg.roundRobinShiftTypes).toEqual(["day", "night"]);
  });

  it("director switches Swing into rotation → persisted + audited", async () => {
    const director = await as("director");
    const res = await director.patch("/api/org/config").send({ roundRobinShiftTypes: ["day", "swing", "night"] });
    expect(res.status).toBe(200);
    expect(res.body.roundRobinShiftTypes).toEqual(["day", "swing", "night"]);
    const cfg = (await (await as("er.director")).get("/api/org/config").expect(200)).body;
    expect(cfg.roundRobinShiftTypes).toEqual(["day", "swing", "night"]);
    const row = (await audit()).find((a) => a.action === "org.config_update");
    expect(row?.details).toMatchObject({ roundRobinShiftTypes: ["day", "swing", "night"] });
  });

  it("refuses an empty set (nobody could ever be routed) and duplicates", async () => {
    const director = await as("director");
    await director.patch("/api/org/config").send({ roundRobinShiftTypes: [] }).expect(400);
    await director.patch("/api/org/config").send({ roundRobinShiftTypes: ["day", "day"] }).expect(400);
    await director.patch("/api/org/config").send({ roundRobinShiftTypes: ["rounding"] }).expect(400);
    const org = await ctx.storage.getOrganization(ctx.seedResult.orgId);
    expect(org!.roundRobinShiftTypes).toEqual(["day", "night"]);
  });

  it("ER director cannot change it (403)", async () => {
    await (await as("er.director")).patch("/api/org/config").send({ roundRobinShiftTypes: ["day"] }).expect(403);
  });
});

// ── Appearance (org theme) ────────────────────────────────────────────────
describe("Appearance: the org theme is validated and merged per key", () => {
  it("two admins changing different keys never undo each other", async () => {
    const director = await as("director");
    const erDir = await as("er.director");
    const a = await director.patch("/api/org/preferences").send({ theme: { accent: "#7C3AED" } });
    expect(a.status).toBe(200);
    expect(a.body.theme).toMatchObject({ accent: "#7C3AED" });
    // A second admin sends only the key they changed.
    const b = await erDir.patch("/api/org/preferences").send({ theme: { radius: 14 } });
    expect(b.status).toBe(200);
    const cfg = (await (await as("chen")).get("/api/org/config").expect(200)).body;
    expect(cfg.theme).toMatchObject({ accent: "#7C3AED", radius: 14 });
    const rows = (await audit()).filter((r) => r.action === "org.preferences_update");
    expect(rows.length).toBe(2);
  });

  it("reset writes the defaults for everyone", async () => {
    const director = await as("director");
    await director.patch("/api/org/preferences").send({ theme: { accent: "#0F766E", appName: "Sweep Health", sidebar: "compact" } }).expect(200);
    const defaults = { appName: "DocTurn", accent: "#2563EB", radius: 8, sidebar: "expanded", contentWidth: "standard", palette: "classic" };
    const res = await director.patch("/api/org/preferences").send({ theme: defaults });
    expect(res.status).toBe(200);
    const cfg = (await (await as("chen")).get("/api/org/config").expect(200)).body;
    expect(cfg.theme).toMatchObject(defaults);
  });

  it("rejects invalid values and unknown keys (400) without saving", async () => {
    const director = await as("director");
    for (const theme of [{ accent: "red" }, { radius: 99 }, { sidebar: "floating" }, { contentWidth: "huge" }, { palette: "neon" }, { appName: "" }, { appName: "x".repeat(41) }, { bogus: 1 }, {}]) {
      const r = await director.patch("/api/org/preferences").send({ theme });
      expect(r.status, JSON.stringify(theme)).toBe(400);
    }
    const cfg = (await director.get("/api/org/config").expect(200)).body;
    expect(cfg.theme).toBeNull();
  });

  it("platform.appearance off → 404 module_disabled, nothing saved", async () => {
    await setModule("platform.appearance", false);
    const director = await as("director");
    const r = await director.patch("/api/org/preferences").send({ theme: { accent: "#7C3AED" } });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: "module_disabled", module: "platform.appearance" });
    expect((await director.get("/api/org/config").expect(200)).body.theme).toBeNull();
  });

  it("an ER physician cannot change the org theme (403)", async () => {
    await (await as("er.doc")).patch("/api/org/preferences").send({ theme: { accent: "#7C3AED" } }).expect(403);
  });
});

// ── Consult services ──────────────────────────────────────────────────────
describe("Consult services: item-level, locked, audited", () => {
  it("starts from the server's catalog (none seeded) with a version", async () => {
    const director = await as("director");
    const res = await director.get("/api/org/consult-services").expect(200);
    expect(res.body).toEqual({ services: [], version: 0 });
    const cfg = (await director.get("/api/org/config").expect(200)).body;
    expect(cfg.consultServicesVersion).toBe(0);
  });

  it("add → 201 with the server's list; persisted; audited; duplicate name → 409", async () => {
    const director = await as("director");
    const add = await director.post("/api/org/consult-services").send({ name: "  Toxicology " });
    expect(add.status).toBe(201);
    expect(add.body.service).toMatchObject({ name: "Toxicology", onCall: null, members: [] });
    expect(typeof add.body.service.id).toBe("string");
    expect(add.body.version).toBe(1);
    expect(add.body.services.map((s: any) => s.name)).toEqual(["Toxicology"]);
    const cfg = (await (await as("er.doc")).get("/api/org/config").expect(200)).body;
    expect(cfg.consultServices.map((s: any) => s.name)).toEqual(["Toxicology"]);
    const row = (await audit()).find((a) => a.action === "org.consult_service_add");
    expect(row?.details).toMatchObject({ serviceId: add.body.service.id, name: "Toxicology" });
    const dup = await director.post("/api/org/consult-services").send({ name: "toxicology" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("duplicate_name");
  });

  it("validates the name", async () => {
    const director = await as("director");
    await director.post("/api/org/consult-services").send({ name: "" }).expect(400);
    await director.post("/api/org/consult-services").send({ name: "x".repeat(81) }).expect(400);
    await director.post("/api/org/consult-services").send({}).expect(400);
  });

  it("two admins adding at the same time both keep their service", async () => {
    const director = await as("director");
    const erDir = await as("er.director");
    const [a, b] = await Promise.all([
      director.post("/api/org/consult-services").send({ name: "Race From Director" }),
      erDir.post("/api/org/consult-services").send({ name: "Race From ER Director" }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const list = (await director.get("/api/org/consult-services").expect(200)).body;
    expect(list.services.map((s: any) => s.name).sort()).toEqual(["Race From Director", "Race From ER Director"]);
    expect(list.version).toBe(2);
  });

  it("the legacy whole-array PATCH refuses a stale copy (409) instead of deleting another admin's service", async () => {
    const director = await as("director");
    const erDir = await as("er.director");
    // The director loaded the (empty) catalog at version 0 …
    const stale = (await director.get("/api/org/config").expect(200)).body;
    // … then the ER director added a service.
    await erDir.post("/api/org/consult-services").send({ name: "Race From ER Director" }).expect(201);
    const r = await director.patch("/api/org/preferences").send({
      consultServices: [{ id: "cs_d", name: "Race From Director", onCall: null, members: [] }],
      consultServicesVersion: stale.consultServicesVersion,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("version_conflict");
    expect(r.body.consultServices.map((s: any) => s.name)).toEqual(["Race From ER Director"]);
    const list = (await director.get("/api/org/consult-services").expect(200)).body;
    expect(list.services.map((s: any) => s.name)).toEqual(["Race From ER Director"]);
    // With the current version it is accepted (and bumps the version).
    const ok = await director.patch("/api/org/preferences").send({
      consultServices: [...list.services, { id: "cs_d", name: "Race From Director", onCall: null, members: [] }],
      consultServicesVersion: list.version,
    });
    expect(ok.status).toBe(200);
    expect((await director.get("/api/org/consult-services").expect(200)).body.version).toBe(list.version + 1);
  });

  it("the whole-catalog replace (which can remove services) is director/developer only", async () => {
    const r = await (await as("er.director")).patch("/api/org/preferences").send({ consultServices: [] });
    expect(r.status).toBe(403);
  });

  it("rename, on-call pin/unpin, PA/NP add/remove — each persisted and audited", async () => {
    const director = await as("director");
    const id = (await director.post("/api/org/consult-services").send({ name: "Heme" }).expect(201)).body.service.id;
    const ren = await director.patch(`/api/org/consult-services/${id}`).send({ name: "Heme/Onc" });
    expect(ren.status).toBe(200);
    expect(ren.body.service.name).toBe("Heme/Onc");
    const pin = await director.patch(`/api/org/consult-services/${id}`).send({ onCall: { name: "Dr. Sharon George", avatar: "SG" } });
    expect(pin.body.service.onCall).toMatchObject({ name: "Dr. Sharon George" });
    const mem = await director.post(`/api/org/consult-services/${id}/members`).send({ name: "Taylor Reed, PA", role: "PA" });
    expect(mem.status).toBe(201);
    const memberId = mem.body.member.id;
    expect(mem.body.service.members).toEqual([expect.objectContaining({ name: "Taylor Reed, PA", role: "PA" })]);
    await director.post(`/api/org/consult-services/${id}/members`).send({ name: "Taylor Reed, PA", role: "PA" }).expect(409);
    await director.post(`/api/org/consult-services/${id}/members`).send({ name: "Bad Role", role: "MD" }).expect(400);
    const rm = await director.delete(`/api/org/consult-services/${id}/members/${memberId}`);
    expect(rm.status).toBe(200);
    expect(rm.body.service.members).toEqual([]);
    const unpin = await director.patch(`/api/org/consult-services/${id}`).send({ onCall: null });
    expect(unpin.body.service.onCall).toBeNull();
    const saved = (await director.get("/api/org/consult-services").expect(200)).body.services[0];
    expect(saved).toMatchObject({ id, name: "Heme/Onc", onCall: null, members: [] });
    const actions = (await audit()).map((a) => a.action);
    for (const a of ["org.consult_service_update", "org.consult_member_add", "org.consult_member_remove"]) expect(actions).toContain(a);
    await director.patch(`/api/org/consult-services/nope`).send({ name: "X" }).expect(404);
    await director.delete(`/api/org/consult-services/${id}/members/nope`).expect(404);
  });

  it("only a director (or developer) removes a service; ER director 403; clinicians cannot edit", async () => {
    const director = await as("director");
    const id = (await director.post("/api/org/consult-services").send({ name: "GI" }).expect(201)).body.service.id;
    await (await as("er.director")).delete(`/api/org/consult-services/${id}`).expect(403);
    await (await as("er.doc")).post("/api/org/consult-services").send({ name: "Nope" }).expect(403);
    await (await as("chen")).patch(`/api/org/consult-services/${id}`).send({ name: "Nope" }).expect(403);
    const del = await director.delete(`/api/org/consult-services/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.services).toEqual([]);
    expect((await audit()).some((a) => a.action === "org.consult_service_remove")).toBe(true);
    await director.delete(`/api/org/consult-services/${id}`).expect(404);
  });

  it("is tenant-scoped: another org's director never sees or edits ISPN's services", async () => {
    await ensureDemoTenants(ctx.storage);
    const director = await as("director");
    const id = (await director.post("/api/org/consult-services").send({ name: "ISPN Only" }).expect(201)).body.service.id;
    const hosp = await as("director", "HOSP");
    expect((await hosp.get("/api/org/consult-services").expect(200)).body.services).toEqual([]);
    await hosp.patch(`/api/org/consult-services/${id}`).send({ name: "Hijack" }).expect(404);
    await hosp.delete(`/api/org/consult-services/${id}`).expect(404);
    expect((await director.get("/api/org/consult-services").expect(200)).body.services[0].name).toBe("ISPN Only");
  });

  it("routing.consults off → 404 module_disabled", async () => {
    await setModule("routing.consults", false);
    const r = await (await as("director")).post("/api/org/consult-services").send({ name: "X" });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: "module_disabled", module: "routing.consults" });
  });
});

// ── Developer: Sign out all ───────────────────────────────────────────────
describe("Developer: Sign out all really ends every other session", () => {
  it("every other session is signed out; the operator's own stays; people can sign in again", async () => {
    const director = await as("director");
    const chen = await as("chen");
    await director.get("/api/user").expect(200);
    const { agent: dev } = await devLogin();
    const { agent: dev2 } = await devLogin(); // the operator's OTHER device
    const revoked: unknown[] = [];
    const off = onSessionsRevoked((r) => revoked.push(r));
    try {
      const res = await dev.post("/api/dev/sessions/revoke-all").send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      off();
    }
    await director.get("/api/user").expect(401);
    await chen.get("/api/user").expect(401);
    await dev2.get("/api/user").expect(401);
    await dev.get("/api/user").expect(200);
    // Live sockets were told to close (the WS hub listens for this).
    expect(revoked).toEqual([expect.objectContaining({ all: true })]);
    // Signing in again works.
    const again = await as("director");
    await again.get("/api/user").expect(200);
    const row = (await audit(ctx.seedResult.platformOrgId)).find((a) => a.action === "dev.sessions_revoke_all");
    expect(row?.riskLevel).toBe("high");
  });

  it("non-developers are refused (403)", async () => {
    await (await as("director")).post("/api/dev/sessions/revoke-all").send({}).expect(403);
  });

  it("after a Sign out all, the operator can still enter an org's portal and come back", async () => {
    const { agent: dev } = await devLogin();
    await dev.post("/api/dev/sessions/revoke-all").send({}).expect(200);
    const { agent: fresh } = await devLogin();
    await fresh.post("/api/dev/manage-org").send({ orgId: ctx.seedResult.orgId }).expect(200);
    const inPortal = await fresh.get("/api/user").expect(200);
    expect(inPortal.body.role).toBe("director");
    await fresh.post("/api/dev/impersonate/stop").send({}).expect(200);
    expect((await fresh.get("/api/user").expect(200)).body.role).toBe("developer");
  });

  it("a portal opened BEFORE a Sign out all is ended by it", async () => {
    const { agent: other } = await devLogin();
    await other.post("/api/dev/manage-org").send({ orgId: ctx.seedResult.orgId }).expect(200);
    await other.get("/api/user").expect(200);
    const { agent: dev } = await devLogin();
    await dev.post("/api/dev/sessions/revoke-all").send({}).expect(200);
    await other.get("/api/user").expect(401);
    await other.post("/api/dev/impersonate/stop").send({}).expect(401);
  });
});

// ── Developer: per-org rules are validated ────────────────────────────────
describe("Developer org page: rule writes are validated", () => {
  it("assignment timeout must be 1–120 whole minutes", async () => {
    const { agent: dev } = await devLogin();
    const id = ctx.seedResult.orgId;
    for (const v of [0, 121, "abc", 1.5, null]) {
      await dev.patch(`/api/dev/organizations/${id}`).send({ assignmentTimeoutMin: v }).expect(400);
    }
    const ok = await dev.patch(`/api/dev/organizations/${id}`).send({ assignmentTimeoutMin: 42 });
    expect(ok.status).toBe(200);
    expect(ok.body.assignmentTimeoutMin).toBe(42);
  });

  it("autoCleanHours is null or 0–8760; autoReassignOnDecline is null or boolean", async () => {
    const { agent: dev } = await devLogin();
    const id = ctx.seedResult.orgId;
    const put = (key: string, value: unknown) => dev.patch(`/api/dev/organizations/${id}/settings`).send({ key, value });
    for (const v of [-1, 9000, "48", 1.5]) expect((await put("autoCleanHours", v)).status).toBe(400);
    for (const v of ["yes", 1]) expect((await put("autoReassignOnDecline", v)).status).toBe(400);
    expect((await put("autoCleanHours", 0)).status).toBe(200);
    expect((await put("autoCleanHours", null)).status).toBe(200);
    expect((await put("autoReassignOnDecline", true)).status).toBe(200);
    const s = (await dev.get(`/api/dev/organizations/${id}/settings`).expect(200)).body.settings;
    expect(s).toMatchObject({ autoCleanHours: null, autoReassignOnDecline: true });
  });
});
