import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The comms / account screens (A.CON comms-account #1-#15), the REAL web
 * client — store.js, api-bridge.js and every JSX screen index.html loads,
 * mounted in jsdom with React — against a scripted backend that plays the
 * server.
 *
 *   #1      Settings → On shift reads and writes the rotation profile
 *           (PATCH /api/hospitalists/:id/working-status); it moves only on
 *           the server's answer; no profile → said, no switch.
 *   #2      The profile / sidebar name is read-only (no self-rename).
 *   #3-#6   Compliance: no Clear logs, no Security incidents, no Open
 *           incidents / Denied access tiles, no Allowed / Purpose, no
 *           System logs.
 *   #7      The tiles are auditCount / phiAccessCount, not page sizes.
 *   #8      Export is GET /api/audit/export (the server's CSV).
 *   #9      A clinician's trail is GET /api/audit/mine.
 *   #10-#12 Broadcasts: the audience is sent and the toast reports the
 *           server's count; no Require-ack switch; no Emergency level.
 *   #13     "Online" is live presence (GET /api/presence +
 *           USER_PRESENCE_CHANGED), never on-shift.
 *   #14     The details toast states no loaded-message count.
 *   #15     A failed DND save leaves the server's state on screen.
 *
 * CLIENT_SRC_ROOT=<dir> runs the same checks against another copy of webapp/
 * (used to show they fail on the previous client).
 */

const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + "webapp/" + f, "utf8");
const VENDOR = ["react.js", "react-dom.js", "lucide.min.js"].map((f) => readFileSync(new URL("../webapp/assets/vendor/" + f, import.meta.url), "utf8"));
const STORE_SRC = read("store.js");
const BRIDGE_SRC = read("api-bridge.js");
const require = createRequire(import.meta.url);
const Babel = require("@babel/standalone");
const HTML = read("index.html");
const JSX_FILES = [...HTML.matchAll(/<script[^>]*src="\/?([A-Za-z0-9_-]+\.jsx)"/g)].map((m) => m[1]!);
const INLINE_APP = HTML.match(/<script type="text\/babel" data-presets="react">([\s\S]*?)<\/script>/)![1]!;
const APP_SRC: string = Babel.transform(JSX_FILES.map(read).join("\n;\n") + "\n;\n" + INLINE_APP, { presets: ["react"] }).code;
const jsdomName = "jsdom";
const { JSDOM } = (await import(jsdomName)) as any;

type Req = { method: string; path: string; body: any };
type Reply = { status: number; body?: any; text?: string; headers?: Record<string, string> };
type Route = (req: Req) => Reply | undefined;
type Role = "director" | "er_director" | "er_doctor" | "hospitalist";

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Server {
  synthetic: boolean;
  hospitalists: any[];
  candidates: any[];
  prefs: { dnd: boolean; coveringUserId: number | null };
  audit: any;
  mine: any;
  broadcasts: any[];
  conversations: any[];
  presence: { live: boolean; online: number[] };
}
interface Harness {
  w: any; reqs: Req[]; routes: Record<string, Route>; server: Server; sockets: any[]; me: any; downloads: string[]; preSignIn?: any;
  state(): any; text(): string; close(): void;
}
const harnesses: Harness[] = [];
afterEach(async () => { if (harnesses.length) await sleep(400); while (harnesses.length) harnesses.pop()!.close(); });

async function until(pred: () => boolean, ms = 6000, what = "condition") {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting for " + what);
    await sleep(15);
  }
}

const USERS: Record<Role, any> = {
  director: { id: 2, username: "director", displayName: "Dr. Dana Director", role: "director", credential: "MD", organizationId: 1 },
  er_director: { id: 3, username: "er.director", displayName: "Dr. Evan Marsh", role: "er_director", credential: "MD", organizationId: 1 },
  er_doctor: { id: 4, username: "er.doc", displayName: "Dr. Erin Reyes", role: "er_doctor", credential: "MD", organizationId: 1 },
  hospitalist: { id: 5, username: "chen", displayName: "Dr. Nathan Alyesh", role: "hospitalist", credential: "MD", organizationId: 1 },
};

const auditRow = (id: number, userId: number, actorName: string, actorRole: string, action: string) => ({ id, organizationId: 1, userId, impersonatorUserId: null, action, resourceType: "user", resourceId: userId, details: null, riskLevel: "low", createdAt: now(), actorName, actorUsername: actorName.toLowerCase().replace(/[^a-z]/g, ""), actorRole, operatorName: null });
const phiRow = (id: number, userId: number, actorName: string, actorRole: string) => ({ id, organizationId: 1, userId, impersonatorUserId: null, resource: "conversation-messages", resourceId: 77, patientId: 13, method: "GET", ip: "10.0.0.7", userAgent: "x", createdAt: now(), actorName, actorUsername: "u", actorRole, operatorName: null });

function defaultServer(): Server {
  return {
    synthetic: true,
    hospitalists: [
      { id: 1, userId: 5, specialty: "Hospital Medicine", currentPatientCount: 3, patientCap: 12, working: true, shiftType: "day", inRotation: true },
      { id: 2, userId: 6, specialty: "Hospital Medicine", currentPatientCount: 4, patientCap: 12, working: true, shiftType: "day", inRotation: true },
    ],
    candidates: [
      { userId: 2, displayName: "Dr. Dana Director", credential: null, role: "director", active: true },
      { userId: 4, displayName: "Dr. Erin Reyes", credential: "MD", role: "er_doctor", active: true },
      { userId: 6, displayName: "Dr. Sharon George", credential: "MD", role: "hospitalist", active: true },
    ],
    prefs: { dnd: false, coveringUserId: null },
    audit: {
      scope: "org",
      audit: [auditRow(901, 4, "Dr. Erin Reyes", "er_doctor", "auth.login"), auditRow(900, 2, "Dr. Dana Director", "director", "auth.login")],
      auditCount: 4321,
      phiAccess: [phiRow(501, 5, "Dr. Nathan Alyesh", "hospitalist")],
      phiAccessCount: 111,
    },
    mine: {
      scope: "mine",
      audit: [auditRow(950, 5, "Dr. Nathan Alyesh", "hospitalist", "auth.login")],
      auditCount: 17,
      phiAccess: [phiRow(601, 5, "Dr. Nathan Alyesh", "hospitalist")],
      phiAccessCount: 33,
    },
    broadcasts: [],
    conversations: [],
    presence: { live: true, online: [] },
  };
}

async function boot(opts: { role?: Role; server?: Partial<Server>; mobile?: boolean } = {}): Promise<Harness> {
  const role = opts.role ?? "director";
  const me = USERS[role];
  const dom = new JSDOM('<!doctype html><html><head><title>DocTurn</title></head><body><div id="root"></div></body></html>', { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const downloads: string[] = [];
  const server: Server = { ...defaultServer(), ...(opts.server || {}) };
  const h: Harness = {
    w, reqs, routes: {}, server, sockets, me, downloads,
    state: () => w.DT.getState(),
    text: () => (w.document.querySelector("main") || w.document.body).textContent || "",
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  const directory = () => server.hospitalists.map((x) => {
    const u = server.candidates.find((c) => c.userId === x.userId) || (x.userId === me.id ? { displayName: me.displayName, credential: me.credential } : { displayName: "Provider " + x.id, credential: "MD" });
    return { id: x.id, userId: x.userId, displayName: u.displayName, credential: u.credential, specialty: x.specialty, working: x.working, shiftType: x.shiftType };
  });
  const respond = (req: Req): Reply => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: me };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user: me } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: server.synthetic } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings" && req.method === "GET") return { status: 200, body: { me: server.prefs, org: { assignmentTimeoutMin: 15, statSmsFallback: true, autoReassignOnDecline: false } } };
    if (p === "/api/settings/me" && req.method === "PATCH") { (server.prefs as any)[req.body.key] = req.body.value; return { status: 200, body: { ok: true } }; }
    if (p === "/api/org/config") return { status: 200, body: { name: "Sweep General", code: "SWPGEN", timezone: "America/Chicago", roundRobinShiftTypes: ["day", "night"], consultServices: [], consultServicesVersion: 0, theme: null, shifts: [] } };
    if (p === "/api/rotation/next") return { status: 200, body: { mode: "lowest_census", shiftTypes: ["day", "night"], capRelief: false, next: { hospitalistId: 2 }, order: [2, 1] } };
    if (p === "/api/hospitalists" && req.method === "GET") return { status: 200, body: server.hospitalists };
    const ws = p.match(/^\/api\/hospitalists\/(\d+)\/working-status$/);
    if (ws && req.method === "PATCH") {
      const hh = server.hospitalists.find((x) => x.id === Number(ws[1]))!;
      hh.working = !!req.body.working;
      return { status: 200, body: hh };
    }
    if (p === "/api/physicians/directory") return { status: 200, body: directory() };
    if (p === "/api/care-team/candidates") return { status: 200, body: server.candidates.filter((c) => c.userId !== me.id) };
    if (p === "/api/audit") return me.role === "director" || me.role === "er_director" ? { status: 200, body: server.audit } : { status: 403, body: { error: "forbidden" } };
    if (p === "/api/audit/mine") return { status: 200, body: server.mine };
    if (p === "/api/audit/export") {
      const q = new URL("https://x" + req.path).searchParams;
      const scope = q.get("scope");
      if (scope === "org" && !(me.role === "director" || me.role === "er_director")) return { status: 403, body: { error: "forbidden" } };
      const n = scope === "mine" ? 17 : 4321;
      return { status: 200, text: "occurred_at_utc,actor\r\n", headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="docturn-${q.get("trail")}-SWPGEN${scope === "mine" ? "-mine" : ""}-2026-10-10.csv"`, "x-export-rows": String(n), "x-export-total": String(n), "x-export-truncated": "0" } };
    }
    if (p === "/api/broadcasts" && req.method === "GET") return { status: 200, body: server.broadcasts };
    if (p === "/api/broadcasts" && req.method === "POST") {
      const total = req.body.audience === "all" ? 15 : 1;
      const b = { id: 70 + server.broadcasts.length, organizationId: 1, senderId: me.id, message: req.body.message, severity: req.body.severity, createdAt: now(), audience: req.body.audience === "all" ? null : req.body.audience, total };
      server.broadcasts = [{ ...b, senderName: me.displayName, recipient: false, ackRequired: req.body.severity !== "info", acked: false, ackedAt: null, ackCount: 0, total, ackedBy: [] }].concat(server.broadcasts);
      return { status: 201, body: b };
    }
    if (p === "/api/presence") return { status: 200, body: server.presence };
    if (p === "/api/messaging/conversations" && req.method === "GET") return { status: 200, body: server.conversations };
    if (/^\/api\/messaging\/conversations\/\d+\/messages/.test(p)) return { status: 200, body: [] };
    if (/^\/api\/messaging\/availability\//.test(p)) return { status: 200, body: { dnd: false, awayMessage: "" } };
    if (p === "/api/patients" && req.method === "GET") return { status: 200, body: [] };
    if (p === "/api/assignments/my" || p === "/api/patient-board" || p === "/api/assignments/sent") return { status: 200, body: [] };
    if (p === "/api/care-team") return { status: 200, body: { owner: { userId: me.id }, members: [] } };
    if (req.method !== "GET") return { status: 204 };
    if (/^\/api\/(assignments\/pending|registrations|admissions|oncall\/sources|metrics\/comms)$/.test(p)) return { status: 200, body: p === "/api/admissions" ? { rows: [], total: 0, last24h: 0, sinceReset: 0, reset: null } : [] };
    return { status: 404, body: { error: "not_found" } };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(req);
    const r = respond(req);
    if (process.env.DEBUG_REQS) process.stderr.write(req.method + " " + req.path + " -> " + r.status + "\n");
    const text = r.text !== undefined ? r.text : r.body === undefined ? "" : JSON.stringify(r.body);
    const hdrs: Record<string, string> = Object.assign({ "content-type": "application/json" }, r.headers || {});
    return Promise.resolve({
      status: r.status, ok: r.status >= 200 && r.status < 300, statusText: "",
      text: () => Promise.resolve(text),
      blob: () => Promise.resolve(new w.Blob([text], { type: hdrs["content-type"] })),
      headers: { get: (k: string) => hdrs[String(k).toLowerCase()] ?? null },
    });
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
  const mobile = !!opts.mobile;
  w.matchMedia = () => ({ matches: mobile, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
  w.scrollTo = () => {};
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = () => true;
  w.open = () => null;
  w.URL.createObjectURL = () => "blob:test";
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  w.console.log = () => {};
  w.console.error = () => {};
  w.console.warn = () => {};
  for (const v of VENDOR) w.eval(v);
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  // What a live page holds before anyone has signed in.
  const pre = w.DT.getState();
  h.preSignIn = { broadcasts: pre.broadcasts, conversations: pre.conversations };
  w.eval(APP_SRC);
  await until(() => sockets.length >= 1 && !!w.DT.getState().session, 6000, "session");
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: me.id });
  await sleep(150);
  return h;
}

const writes = (h: Harness, from = 0) => h.reqs.slice(from).filter((r) => r.method !== "GET");
const click = (h: Harness, el: any) => el.dispatchEvent(new h.w.MouseEvent("click", { bubbles: true, cancelable: true }));
const buttons = (h: Harness, re: RegExp) => [...h.w.document.querySelectorAll("button")].filter((b: any) => re.test((b.textContent || "").trim())) as any[];
const buttonByText = (h: Harness, re: RegExp) => buttons(h, re)[0];
function setValue(h: Harness, el: any, value: string) {
  const proto = el.tagName === "TEXTAREA" ? h.w.HTMLTextAreaElement.prototype : h.w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new h.w.Event("input", { bubbles: true }));
}
async function openNav(h: Harness, nav: string) { h.w.DT.actions.setNav(nav); await sleep(150); }
const onShiftSwitch = (h: Harness) => h.w.document.querySelector('button[aria-label="On shift"]');

// ── #1 On shift ─────────────────────────────────────────────────────────────
describe("#1 Settings → On shift is the rotation profile on the server", () => {
  it("reads the server's working flag; a tap is PATCH working-status and the switch follows the answer", async () => {
    const h = await boot({ role: "hospitalist", server: { hospitalists: [{ id: 1, userId: 5, specialty: "Hospital Medicine", currentPatientCount: 3, patientCap: 12, working: false, shiftType: "day", inRotation: true }] } });
    await openNav(h, "account");
    await until(() => !!onShiftSwitch(h), 6000, "switch");
    // The server says OFF: the switch says off, whatever this device held.
    expect(onShiftSwitch(h).getAttribute("aria-pressed")).toBe("false");
    expect(h.text()).toMatch(/Off shift — round-robin skips you/);
    const from = h.reqs.length;
    click(h, onShiftSwitch(h));
    await until(() => writes(h, from).length >= 1, 4000, "PATCH");
    expect(writes(h, from)[0]).toEqual({ method: "PATCH", path: "/api/hospitalists/1/working-status", body: { working: true } });
    await until(() => onShiftSwitch(h).getAttribute("aria-pressed") === "true", 4000, "on");
    expect(h.text()).toMatch(/On shift — round-robin can send you new admissions/);
    expect(h.state().__toast).toMatchObject({ title: "You're on shift" });
    // Nothing device-local claims a shift state.
    expect(h.state().ui.onShift).toBeUndefined();
  });

  it("a refused change leaves the switch where the server is and says so", async () => {
    const h = await boot({ role: "hospitalist" });
    await openNav(h, "account");
    await until(() => !!onShiftSwitch(h), 6000, "switch");
    expect(onShiftSwitch(h).getAttribute("aria-pressed")).toBe("true");
    h.routes.refuse = (r) => (r.method === "PATCH" && /working-status/.test(r.path) ? { status: 500, body: { error: "boom" } } : undefined);
    click(h, onShiftSwitch(h));
    await until(() => h.state().__toast && h.state().__toast.title === "Shift status not changed", 4000, "toast");
    expect(h.state().__toast.msg).toMatch(/still on shift/);
    expect(onShiftSwitch(h).getAttribute("aria-pressed")).toBe("true");
  });

  it("a hospitalist with no rotation profile is told so — no switch", async () => {
    const h = await boot({ role: "hospitalist", server: { hospitalists: [{ id: 2, userId: 6, specialty: "Hospital Medicine", currentPatientCount: 4, patientCap: 12, working: true, shiftType: "day", inRotation: true }] } });
    await openNav(h, "account");
    await until(() => !!h.w.document.querySelector('[data-onshift-row="none"]'), 6000, "none row");
    expect(onShiftSwitch(h)).toBeNull();
    expect(h.text()).toMatch(/no rotation profile/);
  });
});

// ── #2 name ─────────────────────────────────────────────────────────────────
describe("#2 the profile name is read-only", () => {
  it("no click-to-edit in Settings or the sidebar; no rename action", async () => {
    const h = await boot({ role: "hospitalist" });
    await openNav(h, "account");
    await until(() => /Dr\. Nathan Alyesh/.test(h.text()), 6000, "name");
    expect(h.w.DT.actions.renameMe).toBeUndefined();
    const before = h.w.document.querySelectorAll("input").length;
    const nameEls = [...h.w.document.querySelectorAll("div,span")].filter((e: any) => (e.textContent || "").trim() === "Dr. Nathan Alyesh" && e.children.length === 0) as any[];
    expect(nameEls.length).toBeGreaterThan(0);
    for (const el of nameEls) click(h, el);
    await sleep(100);
    expect(h.w.document.querySelectorAll("input").length).toBe(before);
    expect(writes(h).filter((r) => /user|account|profile/.test(r.path)).length).toBe(0);
  });
});

// ── #3-#9 Compliance ────────────────────────────────────────────────────────
describe("#3-#8 the director's Compliance screen is the server's trail", () => {
  it("true totals; no Clear logs / incidents / denied / allowed / purpose / system logs; named actors and roles", async () => {
    const h = await boot({ role: "director" });
    await openNav(h, "compliance");
    await until(() => /4,321/.test(h.text()), 6000, "tiles");
    const t = h.text();
    expect(t).toMatch(/Audit events\s*4,321/);
    expect(t).toMatch(/PHI accesses\s*111/);
    expect(t).toMatch(/newest 2 of 4,321/);
    expect(t).not.toMatch(/Open incidents|Denied access|Security incidents|System logs|Clear logs/);
    expect(buttons(h, /Clear logs|Resolve/).length).toBe(0);
    expect(t).toMatch(/Dr\. Erin Reyes/);
    expect(t).toMatch(/er doctor/i);
    expect(t).not.toMatch(/User 4/);
    click(h, h.w.document.querySelector('[data-compliance-tab="phi"]'));
    await sleep(100);
    const p = h.text();
    expect(p).toMatch(/111/);
    expect(p).toMatch(/10\.0\.0\.7/);
    expect(p).toMatch(/patient #13/);
    expect(p).not.toMatch(/Allowed|Denied|Purpose/);
    expect(h.w.document.querySelector('[data-compliance-tab="incidents"]')).toBeNull();
    expect(h.w.document.querySelector('[data-compliance-tab="logs"]')).toBeNull();
    expect(h.w.DT.actions.resolveIncident).toBeUndefined();
  });

  it("Export is the server's CSV (GET /api/audit/export), and the toast reports its row count", async () => {
    const h = await boot({ role: "director" });
    await openNav(h, "compliance");
    await until(() => /4,321/.test(h.text()), 6000, "tiles");
    const from = h.reqs.length;
    click(h, h.w.document.querySelector("[data-compliance-export] button"));
    await until(() => h.downloads.length === 1, 4000, "download");
    expect(h.reqs.slice(from).map((r) => r.path)).toContain("/api/audit/export?trail=audit&scope=org");
    expect(h.downloads[0]).toBe("docturn-audit-SWPGEN-2026-10-10.csv");
    expect(h.state().__toast).toMatchObject({ title: "Exported 4,321 rows" });
    expect(h.state().__toast.msg).toMatch(/every row/);
  });
});

describe("#9 a clinician's Compliance screen is their own trail", () => {
  for (const role of ["hospitalist", "er_doctor"] as Role[]) {
    it(`${role}: GET /api/audit/mine fills it (never zeros); Export is scope=mine`, async () => {
      const h = await boot({ role });
      await openNav(h, "compliance");
      await until(() => /Your audit events\s*17/.test(h.text()), 6000, "own tiles");
      expect(h.text()).toMatch(/Your PHI accesses\s*33/);
      expect(h.reqs.some((r) => r.path === "/api/audit/mine")).toBe(true);
      expect(h.reqs.some((r) => r.path === "/api/audit")).toBe(false);
      click(h, h.w.document.querySelector("[data-compliance-export] button"));
      await until(() => h.downloads.length === 1, 4000, "download");
      expect(h.reqs.some((r) => r.path === "/api/audit/export?trail=audit&scope=mine")).toBe(true);
    });
  }
});

// ── #10-#12 broadcasts ──────────────────────────────────────────────────────
describe("#10-#12 broadcasts", () => {
  async function compose(h: Harness, title: string) {
    await openNav(h, "broadcasts");
    await until(() => !!h.w.document.querySelector('[data-broadcast-audience="director"]'), 6000, "composer");
    const input = [...h.w.document.querySelectorAll("input")].find((x: any) => /headline/.test(x.placeholder || "")) as any;
    setValue(h, input, title);
    await sleep(30);
  }

  it("the audience is sent to the server; the toast reports who and how many it reached", async () => {
    const h = await boot({ role: "er_director" });
    await compose(h, "Directors huddle");
    click(h, h.w.document.querySelector('[data-broadcast-audience="director"]'));
    await sleep(30);
    expect(h.w.document.querySelector('[data-broadcast-audience="all"]').getAttribute("aria-pressed")).toBe("false");
    const from = h.reqs.length;
    click(h, buttonByText(h, /^Send broadcast$/));
    await until(() => writes(h, from).length >= 1, 4000, "POST");
    expect(writes(h, from)[0]).toEqual({ method: "POST", path: "/api/broadcasts", body: { message: "Directors huddle", severity: "urgent", audience: ["director"] } });
    await until(() => h.state().__toast && h.state().__toast.title === "Broadcast sent", 4000, "toast");
    expect(h.state().__toast.msg).toMatch(/Sent to 1 person \(directors\)/);
    expect(h.state().__toast.msg).not.toMatch(/everyone/);
  });

  it("Everyone is audience \"all\"; Info stays info (no ack promotion, no switch); no Emergency level", async () => {
    const h = await boot({ role: "director" });
    await compose(h, "FYI");
    expect(buttons(h, /^Emergency$/).length).toBe(0);
    expect(h.w.document.querySelector('[data-broadcast-severity="emergency"]')).toBeNull();
    expect(h.text()).not.toMatch(/Require acknowledgement/);
    click(h, h.w.document.querySelector('[data-broadcast-severity="info"]'));
    await sleep(30);
    expect(h.w.document.querySelector("[data-broadcast-ack-rule]").getAttribute("data-broadcast-ack-rule")).toBe("none");
    const from = h.reqs.length;
    click(h, buttonByText(h, /^Send broadcast$/));
    await until(() => writes(h, from).length >= 1, 4000, "POST");
    expect(writes(h, from)[0]!.body).toEqual({ message: "FYI", severity: "info", audience: "all" });
    await until(() => h.state().__toast && h.state().__toast.title === "Broadcast sent", 4000, "toast");
    expect(h.state().__toast.msg).toMatch(/Sent to 15 people \(everyone in your organization\)\./);
  });

  it("a director observing a targeted broadcast gets no Acknowledge button or banner", async () => {
    const b = { id: 9, severity: "urgent", message: "Hospitalists only", createdAt: now(), senderId: 3, senderName: "Dr. Evan Marsh", audience: ["hospitalist"], recipient: false, ackRequired: true, acked: false, ackedAt: null, ackCount: 0, total: 13, ackedBy: [] };
    const h = await boot({ role: "director", server: { broadcasts: [b] } });
    await openNav(h, "broadcasts");
    await until(() => /Hospitalists only/.test(h.text()), 6000, "card");
    expect(h.text()).toMatch(/To: Hospitalists/);
    expect(buttons(h, /^Acknowledge$/).length).toBe(0);
    const banner = h.w.document.getElementById("dt-broadcast-banner");
    expect(!banner || banner.style.display === "none").toBe(true);
  });

  it("live: no demo broadcasts or threads in the store before or after sign-in", async () => {
    const h = await boot({ role: "director", server: { synthetic: false } });
    expect(h.preSignIn.broadcasts).toEqual([]);
    expect(h.preSignIn.conversations).toEqual([]);
    expect(h.state().broadcasts.some((x: any) => /Code stroke|Mass casualty/.test(x.title))).toBe(false);
    expect(h.state().conversations.some((x: any) => /Sarah Chen|ICU Care Team/.test(x.name))).toBe(false);
  });
});

// ── #13 / #14 messaging ─────────────────────────────────────────────────────
describe("#13/#14 the thread header is live presence, and no loaded-count", () => {
  const convo = (id: number, other: number) => ({ id, type: "direct", name: null, participantIds: [5, other], unreadCount: 0, lastMessage: null, patientId: null });
  it("on shift but not connected is not Online; a presence frame makes it Online", async () => {
    const h = await boot({ role: "hospitalist", server: { conversations: [convo(41, 6)], presence: { live: true, online: [] } } });
    await openNav(h, "messages");
    await until(() => buttons(h, /Dr\. Sharon George/).length > 0, 6000, "list");
    click(h, buttons(h, /Dr\. Sharon George/)[0]);
    await until(() => !!h.w.document.querySelector("[data-thread-status]"), 4000, "header");
    expect(h.w.document.querySelector("[data-thread-status]").textContent).not.toMatch(/Online/);
    expect(h.w.document.querySelector("[data-thread-status]").getAttribute("data-thread-status")).toBe("offline");
    h.sockets[0].emit({ type: "USER_PRESENCE_CHANGED", userId: 6, online: true });
    await until(() => /Online/.test(h.w.document.querySelector("[data-thread-status]").textContent), 3000, "online");
    h.sockets[0].emit({ type: "USER_PRESENCE_CHANGED", userId: 6, online: false });
    await until(() => !/Online/.test(h.w.document.querySelector("[data-thread-status]").textContent), 3000, "offline");
    // Details: who it is, never "N messages".
    const info = h.w.document.querySelector("[data-thread-details] button");
    click(h, info);
    await sleep(50);
    expect(h.state().__toast.title).toBe("Dr. Sharon George");
    expect(h.state().__toast.msg).not.toMatch(/messages/);
  });

  it("a connected director (presence snapshot) shows Online although not a hospitalist", async () => {
    const h = await boot({ role: "hospitalist", server: { conversations: [convo(42, 2)], presence: { live: true, online: [2] } } });
    await openNav(h, "messages");
    await until(() => buttons(h, /Dr\. Dana Director/).length > 0, 6000, "list");
    click(h, buttons(h, /Dr\. Dana Director/)[0]);
    await until(() => !!h.w.document.querySelector("[data-thread-status]"), 4000, "header");
    await until(() => /Online/.test(h.w.document.querySelector("[data-thread-status]").textContent), 3000, "online");
  });
});

// ── #15 DND ─────────────────────────────────────────────────────────────────
describe("#15 DND shows what the server stored", () => {
  it("a failed 'turn off' leaves DND on screen (row, button) and says not saved", async () => {
    const h = await boot({ role: "hospitalist", server: { prefs: { dnd: true, coveringUserId: 6 } } });
    await openNav(h, "account");
    await until(() => /On · covering: Dr\. Sharon George/.test(h.text()), 6000, "dnd on");
    h.routes.fail = (r) => (r.method === "PATCH" && r.path === "/api/settings/me" ? { status: 500, body: { error: "boom" } } : undefined);
    const btn = h.w.document.querySelector("main [data-dnd-button]");
    click(h, btn);
    await until(() => h.state().__toast && h.state().__toast.title === "Setting not saved", 4000, "toast");
    await sleep(100);
    expect(h.text()).toMatch(/On · covering: Dr\. Sharon George/);
    expect(h.w.document.querySelector("main [data-dnd-button]").getAttribute("aria-pressed")).toBe("true");
    expect(h.state().myPrefs.dnd).toBe(true);
  });

  it("a successful 'turn off' changes the row only after the server's answer, then toasts", async () => {
    const h = await boot({ role: "hospitalist", server: { prefs: { dnd: true, coveringUserId: 6 } } });
    await openNav(h, "account");
    await until(() => /On · covering/.test(h.text()), 6000, "dnd on");
    click(h, h.w.document.querySelector("main [data-dnd-button]"));
    await until(() => /Off — you receive messages/.test(h.text()), 4000, "off");
    expect(h.state().__toast).toMatchObject({ title: "Do not disturb off" });
    expect(h.reqs.some((r) => r.method === "PATCH" && r.path === "/api/settings/me" && r.body.key === "dnd" && r.body.value === false)).toBe(true);
  });
});
