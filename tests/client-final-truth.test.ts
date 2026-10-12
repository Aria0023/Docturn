import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The last fake claims of the final verification — the REAL web client
 * (store.js, api-bridge.js and every JSX screen index.html loads, mounted in
 * jsdom with React) against a scripted backend that plays the server:
 *
 *   developer #6  Org config → Rules re-reads the org's values when the page
 *                 opens (and after every save), says when they were read, and
 *                 its controls wait for that read — never a sign-in snapshot
 *                 presented (or saved over) as the org's current setting.
 *   schedule #1   The schedule panel says a connected Amion feed is NOT
 *                 pulled while another source is selected, and that with the
 *                 board off no feed changes who is on shift.
 *   schedule #6   The admissions counter line and the log say what the
 *                 auto-clean removes; no "the log keeps every admission".
 *   clinical #1   The diversion banner states what the server recorded about
 *                 the broadcast (sent to N / nobody alerted / not on record);
 *                 the confirm says nobody will be alerted while broadcasts
 *                 are off.
 *   clinical #4   A care-team member sees the owner's request, can accept it
 *                 for the owner (no Decline), and only accounts that can
 *                 accept are offered for linking.
 *
 * CLIENT_SRC_ROOT=<dir> runs the same checks against another copy of webapp/.
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
type Reply = { status: number; body?: any } | { hang: true };
type Route = (req: Req) => Reply | undefined;
type Who = "developer" | "director" | "er_director" | "wu";

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 6000, what = "condition") {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting for " + what);
    await sleep(15);
  }
}

const USERS: Record<Who, any> = {
  developer: { id: 1, username: "dev", displayName: "Platform Dev", role: "developer", credential: null, organizationId: 99, orgCode: "DOCTURN" },
  director: { id: 2, username: "director", displayName: "Dr. Dana Director", role: "director", credential: "MD", organizationId: 7 },
  er_director: { id: 3, username: "er.director", displayName: "Dr. Evan Marsh", role: "er_director", credential: "MD", organizationId: 7 },
  wu: { id: 9, username: "wu", displayName: "Jordan Wu, PA-C", role: "hospitalist", credential: "PA", organizationId: 7 },
};

interface Server {
  modules: Record<string, boolean>;
  orgRules: { assignmentTimeoutMin: number; rotationMode: string; autoReassignOnDecline: boolean | null; autoCleanHours: number | null };
  settingsHang: boolean;
  sources: any;
  admissions: any;
  diversion: any;
  pending: any[];
  my: any[];
  candidates: any[];
  team: any[];
}
interface Harness {
  w: any; reqs: Req[]; routes: Record<string, Route>; server: Server; sockets: any[]; me: any; confirms: string[]; release: Array<() => void>;
  state(): any; text(): string; close(): void;
}
const harnesses: Harness[] = [];
afterEach(async () => { if (harnesses.length) await sleep(300); while (harnesses.length) harnesses.pop()!.close(); });

function defaultServer(): Server {
  return {
    modules: {},
    orgRules: { assignmentTimeoutMin: 37, rotationMode: "sequential", autoReassignOnDecline: true, autoCleanHours: 48 },
    settingsHang: false,
    sources: { selected: "manual", explicit: true, sources: { amion: { id: "amion", configured: true, lastSyncAt: now(), lastStatus: "ok", error: null, rowCount: 13, message: null }, epic: { id: "epic", configured: false, lastSyncAt: null, lastStatus: "never", error: null, rowCount: 0, message: null }, manual: { id: "manual", configured: true, lastSyncAt: null, lastStatus: "never", error: null, rowCount: 0, message: null } }, modules: {} },
    admissions: { rows: [{ patientId: 31, initials: "NB", room: "B2", specialty: "Cardiology", provider: "Dr. Sharon George", via: "round_robin", status: "pending", routedAt: now(), lastRoutedAt: now(), routings: 1 }], total: 1, last24h: 1, sinceReset: 2, sinceResetRemoved: 1, autoCleanHours: 24, reset: { at: new Date(Date.now() - 48 * 3600_000).toISOString(), by: { id: 2, name: "Dr. Dana Director" } }, limit: 500, generatedAt: now() },
    diversion: { active: false, since: null, by: null },
    pending: [],
    my: [],
    candidates: [
      { userId: 5, displayName: "Dr. Nathan Alyesh", credential: "MD", role: "hospitalist", active: true, canJoinUnit: true },
      { userId: 4, displayName: "Dr. Erin Reyes", credential: "MD", role: "er_doctor", active: true, canJoinUnit: false },
      { userId: 2, displayName: "Dr. Dana Director", credential: "MD", role: "director", active: true, canJoinUnit: true },
    ],
    team: [],
  };
}

async function boot(who: Who, server: Partial<Server> = {}): Promise<Harness> {
  const me = USERS[who];
  const dom = new JSDOM('<!doctype html><html><head><title>DocTurn</title></head><body><div id="root"></div></body></html>', { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  if (who === "developer") w.localStorage.setItem("docturn:store:v6", JSON.stringify({ v: 11, selectedOrg: "SWPGEN" }));
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const srv: Server = { ...defaultServer(), ...server };
  const h: Harness = {
    w, reqs, routes: {}, server: srv, sockets, me, confirms: [], release: [],
    state: () => w.DT.getState(),
    text: () => (w.document.querySelector("main") || w.document.body).textContent || "",
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  const respond = (req: Req): Reply => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: me };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user: me } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: true } };
    if (p === "/api/modules") return { status: 200, body: { modules: srv.modules, registry: [] } };
    if (p === "/api/settings" && req.method === "GET") return { status: 200, body: { me: { dnd: false }, org: { assignmentTimeoutMin: 15, statSmsFallback: true, autoReassignOnDecline: false } } };
    if (p === "/api/org/config") return { status: 200, body: { name: "Sweep General", code: "SWPGEN", timezone: "America/Chicago", roundRobinShiftTypes: ["day", "night"], consultServices: [], consultServicesVersion: 0, theme: null, shifts: [] } };
    // developer console
    if (p === "/api/dev/organizations" && req.method === "GET") return { status: 200, body: [{ id: 99, code: "DOCTURN", name: "DocTurn Platform", userCount: 1, assignments24h: 0 }, { id: 7, code: "SWPGEN", name: "Sweep General", timezone: "America/Chicago", userCount: 5, assignments24h: 0 }] };
    if (p === "/api/dev/organizations/7/settings" && req.method === "GET") {
      const body = { org: { id: 7, code: "SWPGEN", assignmentTimeoutMin: srv.orgRules.assignmentTimeoutMin, rotationMode: srv.orgRules.rotationMode, roundRobinShiftTypes: ["day", "night"] }, settings: { autoReassignOnDecline: srv.orgRules.autoReassignOnDecline, autoCleanHours: srv.orgRules.autoCleanHours }, compliance: { auditCount: 1, phiCount: 0 } };
      if (srv.settingsHang) return { hang: true, ...{ body } } as any;
      return { status: 200, body };
    }
    if (p === "/api/dev/organizations/7/settings" && req.method === "PATCH") {
      if (req.body.key === "autoReassignOnDecline") srv.orgRules.autoReassignOnDecline = req.body.value;
      if (req.body.key === "autoCleanHours") srv.orgRules.autoCleanHours = req.body.value;
      return { status: 200, body: { ok: true } };
    }
    if (p === "/api/dev/organizations/7" && req.method === "PATCH") {
      if (req.body.assignmentTimeoutMin != null) srv.orgRules.assignmentTimeoutMin = req.body.assignmentTimeoutMin;
      if (req.body.rotationMode) srv.orgRules.rotationMode = req.body.rotationMode;
      return { status: 200, body: { id: 7 } };
    }
    if (p === "/api/dev/users") return { status: 200, body: [] };
    if (p === "/api/dev/platform-health") return { status: 503, body: { error: "unavailable" } };
    // clinical
    if (p === "/api/rotation/next") return { status: 200, body: { mode: "lowest_census", shiftTypes: ["day", "night"], capRelief: false, next: null, order: [] } };
    if (p === "/api/hospitalists" && req.method === "GET") return { status: 200, body: [{ id: 1, userId: 5, specialty: "Hospital Medicine", currentPatientCount: 3, patientCap: 12, working: true, shiftType: "day", inRotation: true }] };
    if (p === "/api/physicians/directory") return { status: 200, body: [{ id: 1, userId: 5, displayName: "Dr. Nathan Alyesh", credential: "MD", specialty: "Hospital Medicine", working: true, shiftType: "day" }] };
    if (p === "/api/care-team/candidates") return { status: 200, body: srv.candidates.filter((c) => c.userId !== me.id) };
    if (p === "/api/care-team") return { status: 200, body: { owner: { userId: me.id, displayName: me.displayName }, members: srv.team } };
    if (p === "/api/patients" && req.method === "GET") return { status: 200, body: [{ id: 41, initials: "UV", roomNumber: "12", issueSummary: "synthetic chest pain", specialty: "Cardiology", acuity: 2, status: "waiting", erDoctorId: 4, createdAt: now() }] };
    if (p === "/api/assignments/pending") return { status: 200, body: srv.pending };
    if (p === "/api/assignments/my") return { status: 200, body: srv.my };
    if (/^\/api\/assignments\/\d+\/accept$/.test(p) && req.method === "PATCH") {
      const id = Number(p.split("/")[3]);
      const a = srv.pending.find((x) => x.id === id);
      srv.pending = srv.pending.filter((x) => x.id !== id);
      if (a) srv.my = [{ ...a, status: "accepted", acceptedByUserId: me.id }];
      return { status: 200, body: { id, status: "accepted" } };
    }
    if (p === "/api/oncall/sources") return srv.modules["oncall.board"] === false ? { status: 404, body: { error: "module_disabled" } } : { status: 200, body: srv.sources };
    if (p === "/api/admissions" && req.method === "GET") return { status: 200, body: srv.admissions };
    if (p === "/api/admissions/reset" && req.method === "POST") {
      srv.admissions = { ...srv.admissions, sinceReset: 0, sinceResetRemoved: 0, reset: { at: now(), by: { id: me.id, name: me.displayName } } };
      return { status: 200, body: { total: srv.admissions.total, last24h: srv.admissions.last24h, sinceReset: 0, sinceResetRemoved: 0, autoCleanHours: 24, reset: srv.admissions.reset } };
    }
    if (p === "/api/er/diversion" && req.method === "GET") return { status: 200, body: srv.diversion };
    if (p === "/api/er/diversion" && req.method === "PUT") {
      const off = srv.modules.broadcasts === false;
      srv.diversion = req.body.active
        ? { active: true, since: now(), by: { id: me.id, name: me.displayName }, alert: off ? { sent: false, reason: "module_disabled", recipients: 0, broadcastId: null } : { sent: true, reason: null, recipients: 15, broadcastId: 77 } }
        : { active: false, since: null, by: null };
      return { status: 200, body: { diversion: srv.diversion, broadcast: off || !req.body.active ? null : { id: 77, total: 15 }, broadcastSkipped: off ? "module_disabled" : null } };
    }
    if (p === "/api/er/roster") return { status: 200, body: { physicians: [], onShift: 0, admits24h: 0 } };
    if (p === "/api/reports/er") return { status: 200, body: null };
    if (p === "/api/presence") return { status: 200, body: { live: true, online: [] } };
    if (p === "/api/broadcasts" && req.method === "GET") return { status: 200, body: [] };
    if (p === "/api/messaging/conversations") return { status: 200, body: [] };
    if (p === "/api/patient-board" || p === "/api/assignments/sent") return { status: 200, body: [] };
    if (req.method !== "GET") return { status: 204 };
    if (/^\/api\/(registrations|metrics\/comms|org\/shifts)$/.test(p)) return { status: 200, body: p === "/api/org/shifts" ? { shifts: [] } : [] };
    return { status: 404, body: { error: "not_found" } };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(req);
    const r = respond(req) as any;
    const reply = (rr: any) => {
      const text = rr.body === undefined ? "" : JSON.stringify(rr.body);
      return { status: rr.status, ok: rr.status >= 200 && rr.status < 300, statusText: "", text: () => Promise.resolve(text), headers: { get: (k: string) => (String(k).toLowerCase() === "content-type" ? "application/json" : null) } };
    };
    if (r.hang) return new Promise((resolve) => { h.release.push(() => resolve(reply({ status: 200, body: r.body }))); });
    return Promise.resolve(reply(r));
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
  w.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
  w.scrollTo = () => {};
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = (msg: string) => { h.confirms.push(msg); return true; };
  w.open = () => null;
  w.console.log = () => {};
  w.console.error = () => {};
  w.console.warn = () => {};
  for (const v of VENDOR) w.eval(v);
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  w.eval(APP_SRC);
  await until(() => sockets.length >= 1 && !!w.DT.getState().session, 6000, "session");
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: me.id });
  await sleep(200);
  return h;
}

const writes = (h: Harness, from = 0) => h.reqs.slice(from).filter((r) => r.method !== "GET");
const gets = (h: Harness, path: string, from = 0) => h.reqs.slice(from).filter((r) => r.method === "GET" && r.path === path);
const click = (h: Harness, el: any) => el.dispatchEvent(new h.w.MouseEvent("click", { bubbles: true, cancelable: true }));
const buttons = (h: Harness, re: RegExp) => [...h.w.document.querySelectorAll("button")].filter((b: any) => re.test((b.textContent || "").trim())) as any[];
async function openNav(h: Harness, nav: string) { h.w.DT.actions.setNav(nav); await sleep(150); }
const q = (h: Harness, sel: string) => h.w.document.querySelector(sel);

// ── developer #6: Org config → Rules ────────────────────────────────────────
describe("developer #6: Org config → Rules re-reads the org's values when the page opens", () => {
  const ruleEls = (h: Harness) => ({
    toggle: q(h, 'button[aria-label="Auto-reassign on decline"]'),
    timeout: q(h, 'input[aria-label="Assignment timeout in minutes"]'),
    mode: q(h, 'select[aria-label="Rotation mode"]'),
    clean: q(h, 'input[aria-label="Auto-clean after hours"]'),
  });

  it("values changed on the server after sign-in are shown when the page opens — and again after navigating away and back", async () => {
    const h = await boot("developer");
    await until(() => !!(h.state().orgConfigs || {}).SWPGEN, 6000, "sign-in snapshot");
    expect(h.state().orgConfigs.SWPGEN.rules).toMatchObject({ timeout: 37, rotationMode: "sequential", autoReassign: true, autoCleanHours: 48 });
    // A director and another developer change the rules after this sign-in.
    Object.assign(h.server.orgRules, { assignmentTimeoutMin: 22, rotationMode: "lowest_census", autoReassignOnDecline: false, autoCleanHours: 72 });
    const from = h.reqs.length;
    await openNav(h, "settings");
    await until(() => gets(h, "/api/dev/organizations/7/settings", from).length >= 1, 4000, "re-read on open");
    await until(() => !!q(h, '[data-rules-read="fresh"]'), 4000, "fresh read");
    const els = ruleEls(h);
    expect(els.timeout.value).toBe("22");
    expect(els.mode.value).toBe("lowest_census");
    expect(els.toggle.getAttribute("aria-checked")).toBe("false");
    expect(els.clean.value).toBe("72");
    expect(h.text()).toMatch(/Read from the server at/);

    // Away and back: read again.
    await openNav(h, "dashboard");
    Object.assign(h.server.orgRules, { assignmentTimeoutMin: 9 });
    const from2 = h.reqs.length;
    await openNav(h, "settings");
    await until(() => gets(h, "/api/dev/organizations/7/settings", from2).length >= 1, 4000, "re-read on reopen");
    await until(() => ruleEls(h).timeout && ruleEls(h).timeout.value === "9", 4000, "fresh timeout");
  });

  it("until this opening's read answers, the values carry their read time and the controls send nothing", async () => {
    const h = await boot("developer");
    await until(() => !!(h.state().orgConfigs || {}).SWPGEN, 6000, "sign-in snapshot");
    h.server.settingsHang = true;
    Object.assign(h.server.orgRules, { autoReassignOnDecline: false });
    await openNav(h, "settings");
    await until(() => !!q(h, '[data-rules-read="checking"]'), 4000, "checking");
    expect(h.text()).toMatch(/Checking the server for this organization's current settings/);
    const els = ruleEls(h);
    expect(els.toggle.disabled).toBe(true);
    expect(els.timeout.disabled).toBe(true);
    const from = h.reqs.length;
    click(h, els.toggle);
    await sleep(150);
    expect(writes(h, from)).toHaveLength(0);
    expect(h.state().__toast?.title || "").not.toMatch(/Saved/);
    // The server answers: the screen shows ITS value and the switch works.
    h.server.settingsHang = false;
    h.release.forEach((f) => f());
    await until(() => !!q(h, '[data-rules-read="fresh"]'), 4000, "fresh");
    expect(ruleEls(h).toggle.getAttribute("aria-checked")).toBe("false");
    const from2 = h.reqs.length;
    click(h, ruleEls(h).toggle);
    await until(() => writes(h, from2).length >= 1, 4000, "PATCH");
    expect(writes(h, from2)[0]).toEqual({ method: "PATCH", path: "/api/dev/organizations/7/settings", body: { key: "autoReassignOnDecline", value: true } });
    // …and the page re-reads after the save, so it shows what the server holds.
    await until(() => gets(h, "/api/dev/organizations/7/settings", from2).length >= 1, 4000, "re-read after save");
    await until(() => ruleEls(h).toggle.getAttribute("aria-checked") === "true", 4000, "on");
  });
});

// ── schedule #1 ─────────────────────────────────────────────────────────────
describe("schedule #1: the panel says when Amion is connected but not pulled", () => {
  it("Manual list selected with a connected Amion feed → 'not pulled'; board off → no feed changes shifts", async () => {
    const h = await boot("director");
    await until(() => !!q(h, '[data-schedule-panel="manual"]'), 6000, "panel");
    const line = () => (q(h, "[data-schedule-line]")?.textContent || "");
    expect(line()).toMatch(/no feed updates it/);
    expect(line()).toMatch(/Amion is connected but not pulled while Manual list is selected/);
    h.w.DT.set((s: any) => { s.modules = { ...(s.modules || {}), "oncall.board": false }; return s; });
    await sleep(100);
    expect(line()).toMatch(/no schedule source is read and no feed changes who is on shift/);
  });

  it("Epic chosen but switched off (the board reads the manual list): Amion is said to be idle while Epic is chosen", async () => {
    const base = defaultServer().sources;
    const h = await boot("director", { sources: { ...base, selected: "manual", explicit: false, overridden: { source: "epic", module: "schedule.epic" } } });
    await until(() => !!q(h, '[data-schedule-panel="manual"]'), 6000, "panel");
    const line = q(h, "[data-schedule-line]").textContent;
    expect(line).toMatch(/Epic \(FHIR\) is switched off for this organization/);
    expect(line).toMatch(/Amion is connected but not pulled while Epic \(FHIR\) is chosen/);
    expect(line).not.toMatch(/while Manual list is selected/);
  });
});

// ── schedule #6 ─────────────────────────────────────────────────────────────
describe("schedule #6: the counter and the log say what auto-clean removes", () => {
  it("the line names the removed admissions and the auto-clean window; the reset toast makes no 'log keeps every admission' claim", async () => {
    const h = await boot("director");
    await until(() => (q(h, "[data-admissions-since]")?.textContent || "") === "2", 6000, "count");
    const line = q(h, "[data-admissions-reset-line]").textContent;
    expect(line).toMatch(/1 of these is no longer in the log/);
    expect(line).toMatch(/auto-clean removes them after 24 h/);
    expect(line).not.toMatch(/keeps every admission/);
    click(h, buttons(h, /^Reset count$/)[0]);
    await until(() => h.state().__toast && h.state().__toast.title === "Admissions count reset", 4000, "toast");
    expect(h.state().__toast.msg).not.toMatch(/keeps every admission/);
    await openNav(h, "admissions");
    await until(() => !!q(h, "[data-adm-keep]"), 4000, "keep note");
    expect(q(h, "[data-adm-keep]").textContent).toMatch(/Auto-clean removes patients — and their rows here — after 24 h/);
    expect(h.text()).not.toMatch(/every patient on record/);
  });
});

// ── clinical #1 ─────────────────────────────────────────────────────────────
describe("clinical #1: the diversion banner says what the server recorded", () => {
  it("broadcasts off: the confirm says nobody will be alerted, and the banner says nobody was — after a reload too", async () => {
    const h = await boot("er_director", { modules: { broadcasts: false } });
    await until(() => !!q(h, '[data-diversion="off"]'), 6000, "panel");
    click(h, buttons(h, /^Declare diversion$/)[0]);
    await until(() => !!q(h, '[data-diversion="on"]'), 4000, "on");
    expect(h.confirms[0]).toMatch(/Broadcasts are switched off/);
    expect(h.confirms[0]).not.toMatch(/Everyone/);
    const line = () => q(h, "[data-diversion-line]").textContent;
    expect(line()).toMatch(/alerted nobody/);
    expect(line()).not.toMatch(/Everyone in your organization was sent/);
    // Another session (a reload) reads the same recorded state.
    const h2 = await boot("er_director", { modules: { broadcasts: true }, diversion: h.server.diversion });
    await until(() => !!h2.w.document.querySelector('[data-diversion="on"]'), 6000, "panel 2");
    expect(h2.w.document.querySelector("[data-diversion-line]").textContent).toMatch(/alerted nobody/);
  });

  it("broadcasts on: the banner gives the recorded recipient count; an old state with no record claims nothing", async () => {
    const h = await boot("er_director");
    await until(() => !!q(h, '[data-diversion="off"]'), 6000, "panel");
    click(h, buttons(h, /^Declare diversion$/)[0]);
    await until(() => !!q(h, '[data-diversion="on"]'), 4000, "on");
    expect(h.confirms[0]).toMatch(/Everyone else in your organization gets a critical broadcast/);
    expect(q(h, "[data-diversion-line]").textContent).toMatch(/A critical broadcast went to 15 people/);
    const old = await boot("er_director", { diversion: { active: true, since: now(), by: { id: 3, name: "Dr. Evan Marsh" }, alert: null } });
    await until(() => !!old.w.document.querySelector('[data-diversion="on"]'), 6000, "old");
    const t = old.w.document.querySelector("[data-diversion-line]").textContent;
    expect(t).toMatch(/No broadcast is on record/);
    expect(t).not.toMatch(/was sent a broadcast/);
  });
});

// ── clinical #4 ─────────────────────────────────────────────────────────────
describe("clinical #4: a care-team member sees and accepts the owner's request", () => {
  const ownerRow = () => ({ id: 41, patientId: 41, hospitalistId: 1, erDoctorId: 4, status: "pending", via: "manual", acceptedByUserId: null, expiresAt: new Date(Date.now() + 600_000).toISOString(), createdAt: now(), resolvedAt: null, onBehalfOf: { userId: 5, displayName: "Dr. Nathan Alyesh" } });

  it("Wu's Home lists Chen's request 'for Dr. Nathan Alyesh' with Accept only; Accept is the server's accept", async () => {
    const h = await boot("wu", { pending: [ownerRow()] });
    await until(() => !!q(h, '[data-pending-id="41"]'), 6000, "pending card");
    const card = q(h, '[data-pending-id="41"]');
    expect(card.getAttribute("data-pending-for")).toBe("5");
    expect(card.textContent).toMatch(/For Dr\. Nathan Alyesh/);
    const btns = [...card.querySelectorAll("button")].map((b: any) => b.textContent.trim());
    expect(btns).toEqual(["Accept for Dr. Nathan Alyesh"]);
    expect(h.text()).not.toMatch(/No pending assignments/);
    const from = h.reqs.length;
    click(h, card.querySelector("button"));
    await until(() => writes(h, from).length >= 1, 4000, "PATCH");
    expect(writes(h, from)[0]).toEqual({ method: "PATCH", path: "/api/assignments/41/accept", body: null });
    await until(() => h.state().__toast && /Accepted for Dr\. Nathan Alyesh/.test(h.state().__toast.title), 4000, "toast");
    await until(() => !!q(h, "[data-accepted-obo]"), 4000, "accepted for");
    expect(q(h, "[data-accepted-obo]").textContent).toMatch(/Accepted for Dr\. Nathan Alyesh/);
  });

  it("decline of an owner's request is refused locally (nothing sent)", async () => {
    const h = await boot("wu", { pending: [ownerRow()] });
    await until(() => (h.state().pending || []).length === 1, 6000, "pending");
    const from = h.reqs.length;
    await h.w.DT.actions.decline(41);
    expect(writes(h, from)).toHaveLength(0);
    expect(h.state().__toast.title).toMatch(/Only Dr\. Nathan Alyesh can decline/);
  });

  it("Add member offers only people who can accept a request", async () => {
    const h = await boot("director");
    await openNav(h, "team");
    await until(() => buttons(h, /^Add member$/).length > 0, 6000, "team screen");
    click(h, buttons(h, /^Add member$/)[0]);
    await until(() => !!q(h, "[data-candidate]"), 4000, "candidates");
    const ids = [...h.w.document.querySelectorAll("[data-candidate]")].map((e: any) => e.getAttribute("data-candidate"));
    expect(ids).toContain("5");
    expect(ids).not.toContain("4"); // the ER physician can't accept a request
    expect(h.text()).toMatch(/Hospitalists and directors only/);
  });

  it("a linked member whose role can't accept is said so, and is not counted as sharing your requests", async () => {
    const h = await boot("director", { team: [
      { userId: 9, displayName: "Jordan Wu, PA-C", credential: "PA", role: "hospitalist", active: true, onCall: true, canAccept: true },
      { userId: 4, displayName: "Dr. Erin Reyes", credential: "MD", role: "er_doctor", active: true, onCall: true, canAccept: false },
    ] });
    await openNav(h, "team");
    await until(() => !!q(h, '[data-team-member="4"]'), 6000, "members");
    expect(q(h, '[data-team-member="4"] [data-member-status]').textContent).toBe("Their role can't see or accept admission requests");
    expect(q(h, '[data-team-member="9"] [data-member-status]').textContent).toBe("Sees and can accept your new admission requests");
    expect(h.text()).toMatch(/1 on call with you/);
  });
});
