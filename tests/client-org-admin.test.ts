import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Org-admin screens — the REAL web client (webapp/store.js +
 * webapp/api-bridge.js) in jsdom against a scripted backend. Every control
 * must claim only what the server did:
 *
 *   1/2  People reads the session's own org from GET /api/accounts (never the
 *        demo seed users / "Mayo"); Add person posts to the director route
 *        and reports the server's refusal instead of blaming the form.
 *   3/4  Custom-role CRUD is gone (the server has fixed roles only).
 *   5    Shift types = the org's routable set (PATCH /api/org/config); a
 *        refusal rolls back.
 *   7/8  Appearance writes only the changed keys; a refusal (module off, 403)
 *        is surfaced and rolled back to the server's theme; Reset writes the
 *        defaults to the server and only then says so.
 *   9/10 Consult-service edits are item-level server calls; the success toast
 *        follows the server's answer and the list shown IS the server's list
 *        (so another admin's concurrent add is kept, never deleted).
 *   11-16 The developer console's local-only mocks are gone; "Sign out all"
 *        calls the server; org rule writes roll back on a refusal.
 * The rendered screens are measured in Chromium by scripts/org-admin-truth-check.mjs.
 */

const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom";
const { JSDOM } = (await import(jsdomName)) as any;

type Req = { method: string; path: string; body: any };
type Reply = { status: number; body?: any } | { network: true };
type Route = (req: Req) => Reply | undefined;

interface Harness {
  w: any;
  reqs: Req[];
  routes: Record<string, Route>;
  server: { theme: any; consult: any[]; version: number; shifts: string[]; accounts: any[] };
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

const ACCOUNTS = [
  { id: 2, name: "Dr. Real Director", username: "director", role: "director", org: "SWPGEN", specialty: "", credential: "MD", disabled: false, mustChangePassword: false },
  { id: 3, name: "Dr. Real ER Director", username: "er.director", role: "er_director", org: "SWPGEN", specialty: "", credential: "MD", disabled: false, mustChangePassword: false },
  { id: 4, name: "Dr. Real Hospitalist", username: "hosp", role: "hospitalist", org: "SWPGEN", specialty: "Hospital Medicine", credential: "MD", disabled: false, mustChangePassword: false },
  { id: 5, name: "Riley Quinn, NP", username: "riley", role: "hospitalist", org: "SWPGEN", specialty: "Hospital Medicine", credential: "NP", disabled: false, mustChangePassword: true },
  { id: 6, name: "Dr. Real ER", username: "er", role: "er_doctor", org: "SWPGEN", specialty: "", credential: "MD", disabled: true, mustChangePassword: false },
];

async function boot(role: "director" | "er_director" | "developer", opts: { synthetic?: boolean } = {}): Promise<Harness> {
  const ids: Record<string, number> = { director: 2, er_director: 3, developer: 1 };
  const me = { id: ids[role], username: role === "er_director" ? "er.director" : role === "developer" ? "dev" : "director", displayName: "Dr. Test", role, credential: "MD", organizationId: role === "developer" ? 99 : 7, orgCode: role === "developer" ? "DOCTURN" : "SWPGEN" };
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  // A device that was previously signed in elsewhere: its persisted store still
  // carries the demo org "MAYO" and a violet theme.
  w.localStorage.setItem("docturn:store:v6", JSON.stringify({ v: 11, selectedOrg: "MAYO", theme: { appName: "Elsewhere", accent: "#7C3AED", radius: 8, sidebar: "expanded", contentWidth: "standard" }, session: { role, org: me.orgCode, user: me.username, name: me.displayName } }));
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const h: Harness = {
    w, reqs, routes: {},
    server: { theme: { accent: "#0F766E" }, consult: [{ id: "cs_a", name: "Cardiology", onCall: null, members: [] }], version: 3, shifts: ["day", "night"], accounts: ACCOUNTS.map((a) => ({ ...a })) },
    state: () => w.DT.getState(),
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  const respond = (req: Req): Reply => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: me };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user: me } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: opts.synthetic !== false ? true : false } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: { assignmentTimeoutMin: 15, statSmsFallback: true, autoReassignOnDecline: false } } };
    if (p === "/api/org/config" && req.method === "GET") return { status: 200, body: { name: "Sweep General", code: "SWPGEN", timezone: "America/Chicago", roundRobinShiftTypes: h.server.shifts, consultServices: h.server.consult, consultServicesVersion: h.server.version, theme: h.server.theme } };
    if (p === "/api/accounts" && req.method === "GET") return { status: 200, body: h.server.accounts };
    if (p === "/api/org/consult-services" && req.method === "GET") return { status: 200, body: { services: h.server.consult, version: h.server.version } };
    if (p === "/api/dev/organizations" && req.method === "GET") return { status: 200, body: [{ id: 7, code: "SWPGEN", name: "Sweep General", timezone: "America/Chicago", userCount: 5 }] };
    if (p === "/api/dev/organizations/7/settings" && req.method === "GET") return { status: 200, body: { org: { id: 7, code: "SWPGEN", assignmentTimeoutMin: 15, rotationMode: "lowest_census", roundRobinShiftTypes: ["day", "night"] }, settings: { autoReassignOnDecline: null, autoCleanHours: null } } };
    if (req.method !== "GET") return { status: 204 };
    return { status: 200, body: [] };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(req);
    const r = respond(req);
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
  w.eval(BRIDGE_SRC);
  await until(() => sockets.length >= 1 && !!w.DT.getState().session);
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: me.id });
  await until(() => reqs.some((r) => r.path === "/api/org/config"));
  await sleep(80);
  return h;
}

const calls = (h: Harness, method: string, path: string) => h.reqs.filter((r) => r.method === method && r.path === path);

// ── 1/2 People ──────────────────────────────────────────────────────────────
describe("People: the roster and Add person are the server's", () => {
  it("director's roster comes from GET /api/accounts for the session's org — never the demo seed", async () => {
    const h = await boot("director");
    await h.w.DT.actions.loadAccounts();
    const st = h.state();
    expect(st.accountsOrg).toBe("SWPGEN");
    expect(st.accounts.map((u: any) => u.name)).toEqual(ACCOUNTS.map((a) => a.name));
    expect(st.accounts.find((u: any) => u.id === 2).self).toBe(true);
    expect(st.accounts.find((u: any) => u.id === 6).disabled).toBe(true);
    // No demo person anywhere in the people slice.
    expect(JSON.stringify(st.accounts)).not.toMatch(/Lena Ortiz|Karen Vance|MAYO/);
  });

  it("Add person posts to the director route with a real username; the server's refusal is shown", async () => {
    const h = await boot("director");
    h.routes.add = (req) => (req.method === "POST" && req.path === "/api/director/hospitalists" ? { status: 409, body: { error: "username_taken" } } : undefined);
    const ok = await h.w.DT.actions.addPerson({ role: "consultant", name: "Riley Quinn, NP", username: "Riley.Q", credential: "NP", specialty: "Hospital Medicine" });
    expect(ok).toBe(false);
    const post = calls(h, "POST", "/api/director/hospitalists")[0]!;
    expect(post.body).toEqual({ username: "riley.q", displayName: "Riley Quinn, NP", role: "hospitalist", credential: "NP", specialty: "Hospital Medicine" });
    expect(calls(h, "POST", "/api/dev/users")).toHaveLength(0);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Could not add Riley Quinn, NP", msg: "That username is already taken in your organization." });
  });

  it("a successful add reveals the one-time password and re-reads the roster", async () => {
    const h = await boot("director");
    h.routes.add = (req) => {
      if (req.method !== "POST" || req.path !== "/api/director/hospitalists") return undefined;
      h.server.accounts.push({ id: 9, name: req.body.displayName, username: req.body.username, role: req.body.role, org: "SWPGEN", specialty: "", credential: "", disabled: false, mustChangePassword: true });
      return { status: 201, body: { user: { id: 9, username: req.body.username }, temporaryPassword: "Tmp-123-abc" } };
    };
    const before = calls(h, "GET", "/api/accounts").length;
    const ok = await h.w.DT.actions.addPerson({ role: "er_director", name: "Dr. New ERD", username: "new.erd" });
    expect(ok).toBe(true);
    expect(h.state().__credentialReveal).toMatchObject({ username: "new.erd", temporaryPassword: "Tmp-123-abc" });
    await until(() => calls(h, "GET", "/api/accounts").length > before);
    await until(() => (h.state().accounts || []).some((u: any) => u.username === "new.erd"));
  });

  it("ER director: forbidden → says so, not 'check the form'", async () => {
    const h = await boot("er_director");
    h.routes.add = (req) => (req.method === "POST" && req.path === "/api/director/hospitalists" ? { status: 403, body: { error: "forbidden" } } : undefined);
    await h.w.DT.actions.addPerson({ role: "er_doctor", name: "Dr. X", username: "dr.x" });
    expect(h.state().__toast.msg).toBe("Your role can't add this kind of account.");
  });
});

// ── 3/4 Roles ───────────────────────────────────────────────────────────────
describe("Roles: no custom-role mock", () => {
  it("the store has no local role CRUD and no seeded role counts", async () => {
    const h = await boot("director");
    const a = h.w.DT.actions;
    expect(a.createRole).toBeUndefined();
    expect(a.updateRole).toBeUndefined();
    expect(a.deleteRole).toBeUndefined();
    expect(h.state().roles).toBeUndefined();
  });
});

// ── 5 Shift types ───────────────────────────────────────────────────────────
describe("Shift types: the org's routable set", () => {
  it("loads from GET /api/org/config and saves with PATCH /api/org/config", async () => {
    const h = await boot("director");
    await h.w.DT.actions.loadOrgIdentity();
    expect(h.state().orgIdentity.roundRobinShiftTypes).toEqual(["day", "night"]);
    h.routes.cfg = (req) => (req.method === "PATCH" && req.path === "/api/org/config" ? { status: 200, body: { roundRobinShiftTypes: req.body.roundRobinShiftTypes } } : undefined);
    await h.w.DT.actions.setRotationShiftTypes(["day", "swing", "night"]);
    expect(calls(h, "PATCH", "/api/org/config")[0]!.body).toEqual({ roundRobinShiftTypes: ["day", "swing", "night"] });
    expect(h.state().orgIdentity.roundRobinShiftTypes).toEqual(["day", "swing", "night"]);
    expect(h.state().__toast).toMatchObject({ tone: "accepted" });
    // The local demo shift-type list is gone.
    expect(h.state().settings.shiftTypes).toBeUndefined();
    expect(h.w.DT.actions.addShiftType).toBeUndefined();
  });

  it("a refusal rolls back to the server's set with the reason", async () => {
    const h = await boot("director");
    await h.w.DT.actions.loadOrgIdentity();
    h.routes.cfg = (req) => (req.method === "PATCH" && req.path === "/api/org/config" ? { status: 403, body: { error: "forbidden" } } : undefined);
    await h.w.DT.actions.setRotationShiftTypes(["day"]);
    expect(h.state().orgIdentity.roundRobinShiftTypes).toEqual(["day", "night"]);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", msg: "Only a director can change this." });
  });
});

// ── 7/8/17 Appearance ───────────────────────────────────────────────────────
describe("Appearance: the org theme is the server's", () => {
  it("on sign-in the theme is the org's (server), not this device's previous org's", async () => {
    const h = await boot("director");
    expect(h.state().theme.accent).toBe("#0F766E");
    expect(h.state().theme.appName).toBe("DocTurn");
  });

  it("sends only the changed keys; an accepted change stays", async () => {
    const h = await boot("director");
    h.routes.pref = (req) => (req.method === "PATCH" && req.path === "/api/org/preferences" ? { status: 200, body: { ok: true, theme: { ...h.server.theme, ...req.body.theme } } } : undefined);
    h.w.DT.actions.setTheme({ accent: "#7C3AED" });
    expect(h.state().theme.accent).toBe("#7C3AED");
    await until(() => calls(h, "PATCH", "/api/org/preferences").length === 1);
    expect(calls(h, "PATCH", "/api/org/preferences")[0]!.body).toEqual({ theme: { accent: "#7C3AED" } });
    await until(() => h.state().themeSave && h.state().themeSave.state === "saved");
    expect(h.state().theme.accent).toBe("#7C3AED");
  });

  it("platform.appearance off: the 404 is surfaced and the screen returns to the server's theme", async () => {
    const h = await boot("director");
    h.routes.pref = (req) => (req.method === "PATCH" && req.path === "/api/org/preferences" ? { status: 404, body: { error: "module_disabled", module: "platform.appearance" } } : undefined);
    h.w.DT.actions.setTheme({ accent: "#7C3AED" });
    await until(() => h.state().theme.accent === "#0F766E");
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Appearance not saved", msg: "Appearance is switched off for your organization by the DocTurn operator." });
    expect(h.state().themeSave.state).toBe("error");
    // The module map is re-read at once so the tab disappears.
    await until(() => h.reqs.filter((r) => r.path === "/api/modules").length >= 2);
  });

  it("Reset to defaults writes the defaults to the server, then says so", async () => {
    const h = await boot("director");
    h.routes.pref = (req) => (req.method === "PATCH" && req.path === "/api/org/preferences" ? { status: 200, body: { ok: true, theme: { ...req.body.theme } } } : undefined);
    await h.w.DT.actions.resetLayout("director");
    expect(calls(h, "PATCH", "/api/org/preferences")[0]!.body).toEqual({ theme: { appName: "DocTurn", accent: "#2563EB", radius: 8, sidebar: "expanded", contentWidth: "standard", palette: "classic" } });
    expect(h.state().theme.accent).toBe("#2563EB");
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Appearance reset" });
  });

  it("a refused Reset changes nothing and says why", async () => {
    const h = await boot("director");
    h.routes.pref = (req) => (req.method === "PATCH" && req.path === "/api/org/preferences" ? { status: 503, body: { error: "unavailable" } } : undefined);
    h.w.DT.set((s: any) => { s.navHidden = { director: ["broadcasts"] }; return s; });
    await h.w.DT.actions.resetLayout("director");
    expect(h.state().theme.accent).toBe("#0F766E");
    expect(h.state().navHidden.director).toEqual(["broadcasts"]);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Appearance not reset" });
  });
});

// ── 9/10 Consult services ──────────────────────────────────────────────────
describe("Consult services: confirmation follows the server", () => {
  it("add → POST /api/org/consult-services; the list shown is the server's (another admin's add is kept)", async () => {
    const h = await boot("director");
    h.routes.cs = (req) => {
      if (req.method !== "POST" || req.path !== "/api/org/consult-services") return undefined;
      // Meanwhile another admin added "Race From ER Director".
      h.server.consult = [...h.server.consult, { id: "cs_er", name: "Race From ER Director", onCall: null, members: [] }, { id: "cs_new", name: req.body.name, onCall: null, members: [] }];
      h.server.version += 2;
      return { status: 201, body: { service: h.server.consult[h.server.consult.length - 1], services: h.server.consult, version: h.server.version } };
    };
    const ok = await h.w.DT.actions.addConsultService("Race From Director");
    expect(ok).toBe(true);
    expect(calls(h, "POST", "/api/org/consult-services")[0]!.body).toEqual({ name: "Race From Director" });
    expect(calls(h, "PATCH", "/api/org/preferences")).toHaveLength(0);
    expect(h.state().consultServices.map((s: any) => s.name)).toEqual(["Cardiology", "Race From ER Director", "Race From Director"]);
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Consult service added" });
  });

  it("a failed save (503) adds nothing on screen and says it was not saved", async () => {
    const h = await boot("director");
    h.routes.cs = (req) => (req.method === "POST" && req.path === "/api/org/consult-services" ? { status: 503, body: { error: "unavailable" } } : undefined);
    const ok = await h.w.DT.actions.addConsultService("Unsaved Toxicology");
    expect(ok).toBe(false);
    expect(h.state().consultServices.map((s: any) => s.name)).toEqual(["Cardiology"]);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Not saved" });
  });

  it("no connection → nothing changes, and it says nothing was saved", async () => {
    const h = await boot("director");
    h.routes.cs = (req) => (req.path.startsWith("/api/org/consult-services") && req.method !== "GET" ? { network: true } : undefined);
    await h.w.DT.actions.renameConsultService("cs_a", "Cardio");
    expect(h.state().consultServices[0].name).toBe("Cardiology");
    expect(h.state().__toast.msg).toMatch(/No connection/);
  });

  it("rename / on-call / members / remove each call their item route", async () => {
    const h = await boot("director");
    const ok = (svc: any) => ({ status: 200, body: { service: svc, services: [svc], version: 9 } });
    h.routes.cs = (req) => {
      if (!req.path.startsWith("/api/org/consult-services/")) return undefined;
      if (req.method === "DELETE" && req.path === "/api/org/consult-services/cs_a") return { status: 200, body: { services: [], version: 10 } };
      return ok({ id: "cs_a", name: "Cardiology", onCall: null, members: [] });
    };
    await h.w.DT.actions.renameConsultService("cs_a", "Cardio");
    await h.w.DT.actions.setConsultOnCall("cs_a", { name: "Dr. Real Hospitalist", avatar: "RH" });
    await h.w.DT.actions.addConsultMember("cs_a", { id: "ml4", name: "Riley Quinn, NP", avatar: "RQ", role: "NP" });
    await h.w.DT.actions.removeConsultMember("cs_a", "cm_1");
    await h.w.DT.actions.removeConsultService("cs_a");
    const seen = h.reqs.filter((r) => r.path.startsWith("/api/org/consult-services/")).map((r) => r.method + " " + r.path + " " + JSON.stringify(r.body));
    expect(seen).toEqual([
      'PATCH /api/org/consult-services/cs_a {"name":"Cardio"}',
      'PATCH /api/org/consult-services/cs_a {"onCall":{"name":"Dr. Real Hospitalist","avatar":"RH"}}',
      'POST /api/org/consult-services/cs_a/members {"name":"Riley Quinn, NP","role":"NP","avatar":"RQ"}',
      "DELETE /api/org/consult-services/cs_a/members/cm_1 null",
      "DELETE /api/org/consult-services/cs_a null",
    ]);
    expect(h.state().consultServices).toEqual([]);
  });

  it("an org with no catalog shows none — never the demo list", async () => {
    const h = await boot("director", { synthetic: false });
    h.server.consult = null as any;
    await h.w.DT.actions.loadConsultServices();
    expect(h.state().consultServices).toEqual([]);
  });
});

// ── 11–16 Developer console ────────────────────────────────────────────────
describe("Developer console: no local-only mocks", () => {
  it("enterprise defaults, per-role permissions, platform toggles and Clear logs are gone", async () => {
    const h = await boot("developer");
    const a = h.w.DT.actions;
    for (const k of ["setEnterpriseRule", "setEnterprisePlatform", "setRolePerm", "resetOrgPerms", "resetOrgRule", "clearComplianceLogs"]) expect(a[k], k).toBeUndefined();
    expect(h.state().enterprise).toBeUndefined();
  });

  it("Sign out all calls the server and reports its answer", async () => {
    const h = await boot("developer");
    h.routes.rv = (req) => (req.method === "POST" && req.path === "/api/dev/sessions/revoke-all" ? { status: 200, body: { ok: true, at: 1 } } : undefined);
    const ok = await h.w.DT.actions.revokeAllSessions();
    expect(ok).toBe(true);
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Everyone else is signed out" });
  });

  it("a refused Sign out all says so", async () => {
    const h = await boot("developer");
    h.routes.rv = (req) => (req.method === "POST" && req.path === "/api/dev/sessions/revoke-all" ? { status: 500, body: { error: "internal_error" } } : undefined);
    const ok = await h.w.DT.actions.revokeAllSessions();
    expect(ok).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Nobody was signed out" });
  });

  it("org rules load the server's values and a refused write rolls back", async () => {
    const h = await boot("developer");
    await until(() => !!(h.state().orgConfigs || {}).SWPGEN);
    expect(h.state().orgConfigs.SWPGEN.rules).toMatchObject({ timeout: 15, rotationMode: "lowest_census", autoReassign: false, autoCleanHours: null });
    h.routes.org = (req) => (req.method === "PATCH" && req.path === "/api/dev/organizations/7/settings" ? { status: 400, body: { error: "validation_error" } } : undefined);
    await h.w.DT.actions.setOrgRule("SWPGEN", "autoReassign", true);
    expect(h.state().orgConfigs.SWPGEN.rules.autoReassign).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected" });
  });
});
