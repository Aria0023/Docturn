import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Developer console — the REAL web client (webapp/store.js +
 * webapp/api-bridge.js) in jsdom against a scripted backend. Each test pins a
 * finding of the developer-screen sweep (A.CON developer #1–#24) to what the
 * client sends and holds:
 *
 *   #1   no "local developer": a developer account is created in the platform
 *        org; no scope is sent, none is invented for listed developers.
 *   #12  no client-fabricated audit rows; the trail's count is the server's.
 *   #14  a tenant's trail count is the server's auditCount, not a page length.
 *   #15/16 platform health is the server's measured answer (or an error).
 *   #18  "Assignments / 24h" is the server's per-org count.
 *   #19  no invented active/suspended tenant state.
 *   #20  role colors are a browser preference: no request, no audit row.
 *   #21  Add user sends the typed username; no e-mail.
 *   #22  New tenant sends the modal's fields only (no detected city).
 *   #23  no demo notifications in a live session.
 *   #24  no demo tenants or staff — not even before the server answers.
 * The rendered screens are measured in Chromium on iPhone profiles by
 * scripts/developer-truth-check.mjs.
 */

const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom";
const { JSDOM } = (await import(jsdomName)) as any;

const DEMO = /Mayo General|St\. Jude|Cleveland Care|Pinecrest|Lena Ortiz|Karen Vance|Priya Shah|Ruth Osei|Paul Okafor|Alex Kim|Sam Rivera|STJUDE|"MAYO"|Code stroke|Accepting the 412/;

type Req = { method: string; path: string; body: any };
type Reply = { status: number; body?: any } | { network: true } | { hang: true };
type Route = (req: Req) => Reply | undefined;

interface Harness {
  w: any;
  reqs: Req[];
  routes: Record<string, Route>;
  states: string[];
  state(): any;
  close(): void;
}
const harnesses: Harness[] = [];
afterEach(() => { while (harnesses.length) harnesses.pop()!.close(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 4000) {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await sleep(10);
  }
}

const ORGS = [
  { id: 99, code: "DOCTURN", name: "DocTurn Platform", timezone: "America/New_York", city: null, state: null, userCount: 2, assignments24h: 0 },
  { id: 7, code: "SWPGEN", name: "Sweep General", timezone: "America/Chicago", city: null, state: null, userCount: 5, assignments24h: 3 },
  { id: 8, code: "RIVER", name: "River Hospital", timezone: "America/Denver", city: "Boise", state: "ID", userCount: 1, assignments24h: 0 },
];
const USERS = [
  { id: 1, name: "Platform Dev", username: "dev", role: "developer", org: "DOCTURN", specialty: "", credential: null, disabled: false, mustChangePassword: false },
  { id: 30, name: "Old Tenant Dev", username: "old.dev", role: "developer", org: "SWPGEN", specialty: "", credential: null, disabled: false, mustChangePassword: false },
  { id: 4, name: "Dr. Real Hospitalist", username: "hosp", role: "hospitalist", org: "SWPGEN", specialty: "Hospital Medicine", credential: "MD", disabled: false, mustChangePassword: false },
];
const SERVER_AUDIT = [
  { id: 501, organizationId: 99, userId: 1, action: "dev.orgs_list", resourceType: "organization", resourceId: null, riskLevel: "low", createdAt: "2026-10-10T09:00:00Z" },
  { id: 502, organizationId: 99, userId: 1, action: "dev.users_list", resourceType: "user", resourceId: null, riskLevel: "low", createdAt: "2026-10-10T09:00:01Z" },
];
const HEALTH = {
  status: "operational", issues: [], checkedAt: "2026-10-10T09:00:00Z",
  instance: { startedAt: "2026-10-10T08:00:00Z", uptimeSec: 3600 },
  database: { ok: true, roundTripMs: 0.7, storage: "pglite-disk", pool: null },
  api: { windowSec: 300, requests: 42, p50Ms: 3.1, p95Ms: 18.4, serverErrors: 0 },
  websocket: { connections: 2, users: 2 },
};

async function boot(opts: { synthetic?: boolean; hangAll?: boolean; routes?: Record<string, Route> } = {}): Promise<Harness> {
  const me = { id: 1, username: "dev", displayName: "Platform Dev", role: "developer", credential: "MD", organizationId: 99, orgCode: "DOCTURN" };
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  // A device previously signed in as the developer: the persisted store says
  // "MAYO" (the kit's demo tenant) and carries the developer's session hint.
  w.localStorage.setItem("docturn:store:v6", JSON.stringify({ v: 11, selectedOrg: "MAYO", session: { role: "developer", org: "DOCTURN", user: "dev", name: "Platform Dev" } }));
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const h: Harness = {
    w, reqs, routes: { ...(opts.routes || {}) }, states: [],
    state: () => w.DT.getState(),
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  const respond = (req: Req): Reply => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    if (opts.hangAll) return { hang: true };
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: me };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user: me } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: opts.synthetic !== false } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/org/config" && req.method === "GET") return { status: 200, body: { name: "DocTurn Platform", code: "DOCTURN", timezone: "America/New_York", roundRobinShiftTypes: ["day", "night"], consultServices: [], consultServicesVersion: 0, theme: {} } };
    if (p === "/api/audit") return { status: 200, body: { audit: SERVER_AUDIT, phiAccess: [], phiAccessCount: 0, auditCount: 250 } };
    if (p === "/api/dev/organizations" && req.method === "GET") return { status: 200, body: ORGS };
    if (/^\/api\/dev\/organizations\/\d+\/settings$/.test(p) && req.method === "GET") return { status: 200, body: { org: { id: 7, code: "SWPGEN", assignmentTimeoutMin: 15, rotationMode: "lowest_census", roundRobinShiftTypes: ["day", "night"] }, settings: { autoReassignOnDecline: null, autoCleanHours: null }, compliance: { auditCount: 123, phiCount: 0 } } };
    if (p === "/api/dev/organizations/7/audit") return { status: 200, body: { org: { code: "SWPGEN" }, audit: [{ id: 900, organizationId: 7, userId: 1, action: "dev.audit_read", resourceType: "organization", resourceId: 7, riskLevel: "medium", createdAt: "2026-10-10T09:00:00Z" }], phiAccess: [], auditCount: 123, phiAccessCount: 0 } };
    if (p === "/api/dev/users" && req.method === "GET") return { status: 200, body: USERS };
    if (p === "/api/dev/platform-health") return { status: 200, body: HEALTH };
    if (req.method !== "GET") return { status: 204 };
    return { status: 200, body: [] };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(req);
    const r = respond(req);
    if ("hang" in r) return new Promise(() => {});
    if ("network" in r) return Promise.reject(new TypeError("Failed to fetch"));
    const text = r.body === undefined ? "" : JSON.stringify(r.body);
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, statusText: "", text: () => Promise.resolve(text), headers: { get: () => "application/json" } });
  };
  class FakeWS {
    url: string; readyState = 0;
    onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
    constructor(url: string) { this.url = url; sockets.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.({}); } }, 0); }
    send() {}
    close() { this.readyState = 3; }
    emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  }
  w.WebSocket = FakeWS;
  w.console.log = () => {};
  w.console.error = () => {};
  w.eval(STORE_SRC);
  // Every state the UI could render from here on (the store's own first seed
  // ran before the bridge existed; the bridge must clear it before any paint).
  w.eval(BRIDGE_SRC);
  h.states.push(JSON.stringify(slices(w.DT.getState())));
  w.DT.subscribe(() => h.states.push(JSON.stringify(slices(w.DT.getState()))));
  if (opts.hangAll) return h;
  await until(() => sockets.length >= 1 && !!w.DT.getState().session);
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: me.id });
  await until(() => w.DT.getState().orgsLoaded !== false && w.DT.getState().devUsersLoaded !== false);
  await sleep(80);
  return h;
}
// The slices the developer console and the shell render.
const slices = (s: any) => ({ orgs: s.orgs, devUsers: s.devUsers, notifications: s.notifications, selectedOrg: s.selectedOrg, audit: s.audit, diagnostics: s.diagnostics });
const calls = (h: Harness, method: string, path: string) => h.reqs.filter((r) => r.method === method && r.path === path);
const writes = (h: Harness) => h.reqs.filter((r) => r.method !== "GET");

// ── #23/#24 first paint ─────────────────────────────────────────────────────
describe("#23/#24 a live session never shows the kit's demo tenants, staff or notifications", () => {
  it("before the server has answered anything: empty and 'loading', never demo rows", async () => {
    const h = await boot({ hangAll: true });
    const st = h.state();
    expect(st.orgs).toEqual([]);
    expect(st.devUsers).toEqual([]);
    expect(st.notifications).toEqual([]);
    expect(st.orgsLoaded).toBe(false);
    expect(st.devUsersLoaded).toBe(false);
    expect(st.selectedOrg).not.toBe("MAYO");
    expect(DT_unread(h)).toBe(0);
    for (const s of h.states) expect(s).not.toMatch(DEMO);
  });

  it("through sign-in restore and every hydrate (synthetic and real servers alike)", async () => {
    for (const synthetic of [true, false]) {
      const h = await boot({ synthetic });
      expect(h.states.length).toBeGreaterThan(3);
      for (const s of h.states) expect(s).not.toMatch(DEMO);
      expect(h.state().notifications).toEqual([]);
    }
  });

  it("a sign-out reseeds nothing demo (DT_LIVE seeds start empty)", async () => {
    const h = await boot();
    const fresh = h.w.DT.seed();
    expect(fresh.orgs).toEqual([]);
    expect(fresh.devUsers).toEqual([]);
    expect(fresh.notifications).toEqual([]);
    expect(fresh.selectedOrg).toBeNull();
  });
});
const DT_unread = (h: Harness) => h.w.DT.unreadNotifs();

// ── #18/#19 organizations ─────────────────────────────────────────────────
describe("#18/#19 the organization list is the server's", () => {
  it("assignments = the server's 24 h count; no invented active/suspended; the platform org is where developers go", async () => {
    const h = await boot();
    const st = h.state();
    expect(st.orgs.map((o: any) => o.code)).toEqual(["SWPGEN", "RIVER"]);
    expect(st.orgs.find((o: any) => o.code === "SWPGEN")).toMatchObject({ id: 7, users: 5, assignments: 3 });
    for (const o of st.orgs) { expect(o).not.toHaveProperty("active"); expect(o).not.toHaveProperty("suspended"); }
    expect(st.platformOrg).toEqual({ id: 99, code: "DOCTURN", name: "DocTurn Platform" });
    expect(st.selectedOrg).toBe("SWPGEN");
    expect(h.w.DT.actions.toggleTenant).toBeUndefined();
  });

  it("an unanswered list says so (orgsLoaded = 'error'), it does not show an empty platform as real", async () => {
    const h = await boot({ routes: { fail: (req) => (req.path === "/api/dev/organizations" ? { status: 500, body: { error: "internal_error" } } : undefined) } });
    expect(h.state().orgsLoaded).toBe("error");
    expect(h.state().orgs).toEqual([]);
  });
});

// ── #1/#21 Add user ───────────────────────────────────────────────────────
describe("#1/#21 Add user sends exactly what the server stores", () => {
  it("listed developers carry no 'scope' (every developer is platform-wide)", async () => {
    const h = await boot();
    for (const u of h.state().devUsers) expect(u).not.toHaveProperty("scope");
    expect(h.state().devUsers.find((u: any) => u.username === "old.dev")).toMatchObject({ role: "developer", org: "SWPGEN" });
  });

  it("a developer is created in the platform org — whatever tenant the form had selected; no scope, no e-mail", async () => {
    const h = await boot();
    h.routes.add = (req) => (req.method === "POST" && req.path === "/api/dev/users" ? { status: 201, body: { id: 77, username: req.body.username, temporaryPassword: "Tmp-1" } } : undefined);
    const ok = await h.w.DT.actions.addUser({ role: "developer", org: "SWPGEN", scope: "local", name: "Second Operator", username: " Ops.Two ", email: "ops@x.org" });
    expect(ok).toBe(true);
    expect(calls(h, "POST", "/api/dev/users")[0]!.body).toEqual({ organizationId: 99, role: "developer", displayName: "Second Operator", username: "ops.two" });
    expect(h.state().__credentialReveal).toMatchObject({ username: "ops.two", temporaryPassword: "Tmp-1" });
  });

  it("a hospitalist: the typed username, specialty, cap and a real shift type; the e-mail is not sent", async () => {
    const h = await boot();
    h.routes.add = (req) => (req.method === "POST" && req.path === "/api/dev/users" ? { status: 201, body: { id: 78, username: req.body.username, temporaryPassword: "Tmp-2" } } : undefined);
    const ok = await h.w.DT.actions.addUser({ role: "hospitalist", org: "SWPGEN", name: "Dr. New", username: "dr.new", email: "someone@else.org", specialty: "Cardiology", cap: "14", shift: "night" });
    expect(ok).toBe(true);
    expect(calls(h, "POST", "/api/dev/users")[0]!.body).toEqual({ organizationId: 7, role: "hospitalist", displayName: "Dr. New", username: "dr.new", specialty: "Cardiology", patientCap: 14, shiftType: "night" });
    // A PA / NP is a credentialed hospitalist account.
    await h.w.DT.actions.addUser({ role: "hospitalist", org: "SWPGEN", name: "Riley NP", username: "riley.np", credential: "NP", specialty: "Hospital Medicine", shift: "day" });
    expect(calls(h, "POST", "/api/dev/users")[1]!.body).toMatchObject({ role: "hospitalist", username: "riley.np", credential: "NP", shiftType: "day" });
  });

  it("the server's refusal is shown and the form is not reported as done", async () => {
    const h = await boot();
    h.routes.add = (req) => (req.method === "POST" && req.path === "/api/dev/users" ? { status: 400, body: { error: "developer_platform_org_only" } } : undefined);
    const ok = await h.w.DT.actions.addUser({ role: "director", org: "SWPGEN", name: "Dr. D", username: "dr.d" });
    expect(ok).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Could not create Dr. D", msg: "Developer accounts are platform-wide; they are created in the platform organization." });
    h.routes.add = (req) => (req.method === "POST" && req.path === "/api/dev/users" ? { status: 409, body: { error: "username_taken" } } : undefined);
    expect(await h.w.DT.actions.addUser({ role: "director", org: "SWPGEN", name: "Dr. D", username: "dr.d" })).toBe(false);
    expect(h.state().__toast.msg).toBe("That username is already taken in SWPGEN.");
  });

  it("a short username or a bad cap is refused before anything is sent", async () => {
    const h = await boot();
    expect(await h.w.DT.actions.addUser({ role: "hospitalist", org: "SWPGEN", name: "Dr. X", username: "ab" })).toBe(false);
    expect(await h.w.DT.actions.addUser({ role: "hospitalist", org: "SWPGEN", name: "Dr. X", username: "dr.x", cap: "99" })).toBe(false);
    expect(calls(h, "POST", "/api/dev/users")).toHaveLength(0);
  });
});

// ── #12/#14 audit ───────────────────────────────────────────────────────────
describe("#12/#14 the audit trail and its count are the server's", () => {
  it("hydrate keeps the trail's true size (auditCount), not the page length", async () => {
    const h = await boot();
    expect(h.state().auditCount).toBe(250);
    expect(h.state().audit.map((r: any) => r.id)).toEqual([501, 502]);
  });

  it("no action fabricates an audit row in this browser", async () => {
    const h = await boot();
    const before = JSON.stringify(h.state().audit);
    h.w.DT.actions.setRoleColor("hospitalist", "#C25A6B");
    h.w.DT.actions.selectOrg("RIVER");
    h.w.DT.actions.runDiagnostics();
    await sleep(50);
    expect(JSON.stringify(h.state().audit)).toBe(before);
    expect(JSON.stringify(h.state().audit)).not.toMatch(/10\.2\.7\.40|customize_role_color/);
  });

  it("loadAuditTrail reads the platform trail or one tenant's, with the server's count", async () => {
    const h = await boot();
    const platform = await h.w.DT.actions.loadAuditTrail(null);
    expect(platform.count).toBe(250);
    expect(platform.rows.map((r: any) => r.id)).toEqual([501, 502]);
    const tenant = await h.w.DT.actions.loadAuditTrail(7);
    expect(tenant.count).toBe(123);
    expect(tenant.rows).toHaveLength(1);
    expect(calls(h, "GET", "/api/dev/organizations/7/audit")).toHaveLength(1);
  });
});

// ── #20 role colors ─────────────────────────────────────────────────────────
describe("#20 role colors are this browser's preference", () => {
  it("changes the local palette and sends nothing", async () => {
    const h = await boot();
    const n = writes(h).length;
    h.w.DT.actions.setRoleColor("hospitalist", "#C25A6B");
    await sleep(300);
    expect(h.state().roleColors.hospitalist).toBe("#C25A6B");
    expect(writes(h).length).toBe(n);
    expect(JSON.parse(h.w.localStorage.getItem("docturn:store:v6")).roleColors.hospitalist).toBe("#C25A6B");
  });
});

// ── #15/#16/#17 health + diagnostics ─────────────────────────────────────────
describe("#15/#16/#17 platform health and the AI monitor are the server's answers", () => {
  it("platformHealth is null until the server answers, then exactly its body; a failure is an error, not numbers", async () => {
    const h = await boot();
    expect(h.state().platformHealth).toBeNull();
    expect(h.state().diagnostics).toBeNull();
    await h.w.DT.actions.loadPlatformHealth();
    expect(h.state().platformHealth).toMatchObject(HEALTH);
    h.routes.health = (req) => (req.path === "/api/dev/platform-health" ? { status: 500, body: { error: "internal_error" } } : undefined);
    await h.w.DT.actions.loadPlatformHealth();
    expect(h.state().platformHealth).toEqual({ error: "The server didn't return its health." });
  });
});

// ── #22 New tenant ─────────────────────────────────────────────────────────
describe("#22 New tenant sends the modal's fields only", () => {
  it("no city is invented from the browser's time zone; resolves only on the server's answer", async () => {
    const h = await boot();
    h.routes.org = (req) => (req.method === "POST" && req.path === "/api/dev/organizations" ? { status: 201, body: { id: 9, code: "SWLOC" } } : undefined);
    expect(await h.w.DT.actions.addTenant({ name: "Sweep Loc", code: "SWLOC", timezone: "America/Chicago", tzSource: "browser", city: null, state: null })).toBe(true);
    expect(calls(h, "POST", "/api/dev/organizations")[0]!.body).toEqual({ name: "Sweep Loc", code: "SWLOC", timezone: "America/Chicago" });
    h.routes.org = (req) => (req.method === "POST" && req.path === "/api/dev/organizations" ? { status: 409, body: { error: "code_taken" } } : undefined);
    expect(await h.w.DT.actions.addTenant({ name: "Dup", code: "SWLOC", timezone: "America/Chicago" })).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", msg: "That code is already in use." });
  });
});
