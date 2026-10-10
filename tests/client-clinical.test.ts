import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The clinical screens (A.CON clinical #1-#23), the REAL web client —
 * store.js, api-bridge.js and every JSX screen index.html loads, mounted in
 * jsdom with React — against a scripted backend that plays the server.
 *
 *   #1      ER diversion: the banner is GET /api/er/diversion; Declare / Lift
 *           is PUT /api/er/diversion; the toast follows the server's answer
 *           and never claims EMS was notified.
 *   #2      ER roster: the server's ER physician accounts; On/Off and shift
 *           are PATCH /api/er/roster/:id; no local Add / Remove / rename.
 *   #3      ER throughput tiles: GET /api/reports/er — "—" when there is
 *           nothing, never the 4m 12s constant.
 *   #4      Care team: GET /api/care-team; Link / On call / Remove are the
 *           server's; no demo members or candidates.
 *   #5/#6   Hospitalist: "Message team" opens the patient thread on the
 *           server; "Current census" is the server's census.
 *   #11/#12 Director: provider name/specialty → PATCH .../profile; a refused
 *           removal (409) says why and the row stays.
 *   #13-#16 Patient board: room/issue → PATCH /api/patients/:id; status is
 *           read-only; Add admission → POST /api/patients + /api/assignments;
 *           Remove → DELETE; no EHR/FHIR bar.
 *   #17-#22 ER intake: Extract → POST /api/patients/extract (empty note →
 *           nothing); consults → POST /api/patients/:id/consults with the
 *           named team; PA/NP picker from real accounts only; no paging pills.
 *   #23     "+ Consult" toast follows the server's answer: who was alerted.
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
type Reply = { status: number; body?: any };
type Route = (req: Req) => Reply | undefined;
type Role = "director" | "er_director" | "er_doctor" | "hospitalist";

const DEMO_NAMES = /Ruth Osei|Paul Okafor|Dana Reyes|Sam Iyer|Nina Roy|Omar Haddad|Priya Shah|Marcus Bell|Lena Ortiz|Sam Cole|Amir Patel|Maria Lopez/;
const now = () => new Date().toISOString();

interface Server {
  synthetic: boolean;
  diversion: any;
  roster: any;
  report: any;
  careTeam: any[];
  candidates: any[];
  hospitalists: any[];
  patients: any[];
  my: any[];
  board: any[];
  sent: any[];
  consultServices: any[];
  consultReply: (body: any) => any[];
  extractReply: any;
}
interface Harness {
  w: any; reqs: Req[]; routes: Record<string, Route>; server: Server; sockets: any[]; me: any;
  state(): any; text(): string; close(): void;
}
const harnesses: Harness[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Let the re-reads an action starts after its answer (rehydrate) settle
// before the window goes away, so nothing touches a closed jsdom window.
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

function defaultServer(): Server {
  return {
    synthetic: true,
    diversion: { active: false, since: null, by: null },
    roster: { physicians: [{ userId: 4, displayName: "Dr. Erin Reyes", credential: "MD", onShift: false, shiftType: null, admits24h: 2, updatedAt: null }], onShift: 0, admits24h: 3 },
    report: { scope: "org", assignments: { total: 3, accepted: 1, declined: 0, pending: 2, timeToAcceptMinAvg: 2.6, timeToAcceptMinMedian: 2 }, admits24h: 3 },
    careTeam: [{ userId: 9, displayName: "Jordan Wu, PA-C", credential: "PA", role: "hospitalist", active: true, onCall: true }],
    candidates: [
      { userId: 2, displayName: "Dr. Dana Director", credential: null, role: "director", active: true },
      { userId: 4, displayName: "Dr. Erin Reyes", credential: "MD", role: "er_doctor", active: true },
      { userId: 6, displayName: "Dr. Sharon George", credential: "MD", role: "hospitalist", active: true },
      { userId: 9, displayName: "Jordan Wu, PA-C", credential: "PA", role: "hospitalist", active: true },
      { userId: 12, displayName: "Old Former, NP", credential: "NP", role: "hospitalist", active: false },
    ],
    hospitalists: [
      { id: 1, userId: 5, specialty: "Hospital Medicine", currentPatientCount: 9, patientCap: 12, working: true, shiftType: "day", inRotation: true },
      { id: 2, userId: 6, specialty: "Cardiology", currentPatientCount: 4, patientCap: 12, working: true, shiftType: "day", inRotation: true },
    ],
    patients: [{ id: 13, initials: "QZ", roomNumber: "412", issueSummary: "Chest pain", specialty: "Cardiology", acuity: 2, erDoctorId: 4 }],
    my: [{ id: 31, patientId: 13, hospitalistId: 1, status: "accepted", createdAt: now() }],
    board: [{
      patient: { id: 13, initials: "QZ", room: "412", department: "MED", issue: "Chest pain", acuity: 2, status: "assigned" },
      assignmentId: 31, status: "assigned",
      responsible: { attending: { userId: 5, displayName: "Dr. Nathan Alyesh" }, unit: [] },
      consultants: [], consultDetails: [], admittedBy: { userId: 4, displayName: "Dr. Erin Reyes" },
    }],
    sent: [],
    consultServices: [],
    consultReply: (body) => [{ id: 501, patientId: 13, specialty: body.specialty, consultantUserId: null, consultantName: body.specialty + " on-call", status: "requested" }],
    extractReply: { initials: "JK", roomNumber: "612", issueSummary: "Patient J.K. room 612 with crushing chest pain", specialty: "Cardiology", engine: "local" },
  };
}

async function boot(opts: { role?: Role; server?: Partial<Server>; mobile?: boolean } = {}): Promise<Harness> {
  const role = opts.role ?? "director";
  const me = USERS[role];
  const dom = new JSDOM('<!doctype html><html><head><title>DocTurn</title></head><body><div id="root"></div></body></html>', { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const server: Server = { ...defaultServer(), ...(opts.server || {}) };
  const h: Harness = {
    w, reqs, routes: {}, server, sockets, me,
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
    const m = (re: RegExp) => p.match(re);
    if (p === "/api/user") return { status: 200, body: me };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user: me } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: server.synthetic } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: { assignmentTimeoutMin: 15, statSmsFallback: true, autoReassignOnDecline: false } } };
    if (p === "/api/org/config") return { status: 200, body: { name: "Sweep General", code: "SWPGEN", timezone: "America/Chicago", roundRobinShiftTypes: ["day", "night"], consultServices: server.consultServices, consultServicesVersion: 0, theme: null, shifts: [{ id: "day", label: "Day", start: null, end: null }, { id: "swing", label: "Swing", start: null, end: null }, { id: "night", label: "Night", start: null, end: null }] } };
    if (p === "/api/rotation/next") return { status: 200, body: { mode: "lowest_census", shiftTypes: ["day", "night"], capRelief: false, next: { hospitalistId: 2 }, order: [2, 1] } };
    if (p === "/api/hospitalists" && req.method === "GET") return { status: 200, body: server.hospitalists };
    if (p === "/api/physicians/directory") return { status: 200, body: directory() };
    if (p === "/api/care-team/candidates") return { status: 200, body: server.candidates.filter((c) => c.userId !== me.id && !server.careTeam.some((t) => t.userId === c.userId)) };
    if (p === "/api/patients" && req.method === "GET") return { status: 200, body: server.patients };
    if (p === "/api/assignments/my") return { status: 200, body: server.my };
    if (p === "/api/patient-board") return { status: 200, body: server.board };
    if (p === "/api/assignments/sent") return { status: 200, body: server.sent };
    // ER operations
    if (p === "/api/er/diversion" && req.method === "GET") return { status: 200, body: server.diversion };
    if (p === "/api/er/diversion" && req.method === "PUT") {
      if (req.body.active === server.diversion.active) return { status: 409, body: { error: "no_change", diversion: server.diversion } };
      server.diversion = req.body.active ? { active: true, since: now(), by: { id: me.id, name: me.displayName } } : { active: false, since: null, by: null };
      return { status: 200, body: { diversion: server.diversion, broadcast: { id: 70, total: 14 }, broadcastSkipped: null } };
    }
    if (p === "/api/er/roster" && req.method === "GET") return { status: 200, body: server.roster };
    const rm = m(/^\/api\/er\/roster\/(\d+)$/);
    if (rm && req.method === "PATCH") {
      const phys = server.roster.physicians.map((x: any) => (x.userId === Number(rm[1]) ? { ...x, ...req.body } : x));
      server.roster = { ...server.roster, physicians: phys, onShift: phys.filter((x: any) => x.onShift).length };
      return { status: 200, body: { physician: phys.find((x: any) => x.userId === Number(rm[1])), onShift: server.roster.onShift } };
    }
    if (p === "/api/reports/er") return { status: 200, body: server.report };
    // care team
    if (p === "/api/care-team" && req.method === "GET") return { status: 200, body: { owner: { userId: me.id, displayName: me.displayName }, members: server.careTeam } };
    if (p === "/api/care-team/members" && req.method === "POST") {
      const c = server.candidates.find((x) => x.userId === req.body.memberUserId)!;
      server.careTeam = server.careTeam.concat([{ userId: c.userId, displayName: c.displayName, credential: c.credential, role: c.role, active: true, onCall: true }]);
      return { status: 201, body: { id: 1 } };
    }
    const ct = m(/^\/api\/care-team\/members\/(\d+)$/);
    if (ct && req.method === "PATCH") { server.careTeam = server.careTeam.map((x) => (x.userId === Number(ct[1]) ? { ...x, onCall: req.body.onCall } : x)); return { status: 200, body: {} }; }
    if (ct && req.method === "DELETE") { server.careTeam = server.careTeam.filter((x) => x.userId !== Number(ct[1])); return { status: 204 }; }
    // providers
    const prof = m(/^\/api\/hospitalists\/(\d+)\/profile$/);
    if (prof && req.method === "PATCH") {
      const hh = server.hospitalists.find((x) => x.id === Number(prof[1]))!;
      if (req.body.specialty) hh.specialty = req.body.specialty;
      if (req.body.displayName) server.candidates = server.candidates.map((c) => (c.userId === hh.userId ? { ...c, displayName: req.body.displayName } : c));
      return { status: 200, body: { hospitalist: hh, user: { id: hh.userId, displayName: req.body.displayName } } };
    }
    if (m(/^\/api\/physicians\/(\d+)$/) && req.method === "DELETE") return { status: 409, body: { error: "has_pending_assignments" } };
    // patients
    if (p === "/api/patients/extract" && req.method === "POST") return { status: 200, body: server.extractReply };
    if (p === "/api/patients" && req.method === "POST") return { status: 201, body: { id: 99, initials: req.body.initials } };
    if (p === "/api/assignments" && req.method === "POST") return { status: 201, body: { id: 501, hospitalistId: req.body.hospitalistId || 2, patientId: req.body.patientId, status: "pending" } };
    const pc = m(/^\/api\/patients\/(\d+)\/consults$/);
    if (pc && req.method === "POST") return { status: 201, body: server.consultReply(req.body) };
    const pp = m(/^\/api\/patients\/(\d+)$/);
    if (pp && req.method === "PATCH") {
      server.board = server.board.map((b) => (b.patient.id === Number(pp[1]) ? { ...b, patient: { ...b.patient, ...(req.body.roomNumber ? { room: req.body.roomNumber } : {}), ...(req.body.issueSummary ? { issue: req.body.issueSummary } : {}) } } : b));
      return { status: 200, body: { id: Number(pp[1]) } };
    }
    if (pp && req.method === "DELETE") {
      server.board = server.board.filter((b) => b.patient.id !== Number(pp[1]));
      return { status: 200, body: { removed: { patients: 1, assignments: 1, consults: 0, conversations: 0, messages: 0, attachments: 0 } } };
    }
    if (p === "/api/messaging/patient-thread" && req.method === "POST") return { status: 200, body: { id: 77, type: "group", name: "Patient QZ · 412", participantIds: [me.id] } };
    if (p === "/api/messaging/conversations" && req.method === "GET") return { status: 200, body: [] };
    if (m(/^\/api\/messaging\/conversations\/\d+\/messages/)) return { status: 200, body: [] };
    if (req.method !== "GET") return { status: 204 };
    if (p === "/api/reports/ops") return { status: 200, body: { assignments: { total: 0, byStatus: {}, timeToAcceptMinAvg: null, timeToAcceptMinMedian: null }, consults: { total: 0, responded: 0, responseMinAvg: null }, messaging: { last7d: 0, statAcks: 0, statAckMinAvg: null } } };
    if (/^\/api\/(assignments\/pending|registrations|broadcasts|admissions|oncall\/sources|metrics\/comms)$/.test(p)) return { status: 200, body: p === "/api/admissions" ? { rows: [], total: 0, last24h: 0, sinceReset: 0, reset: null } : [] };
    return { status: 404, body: { error: "not_found" } };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(req);
    const r = respond(req);
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
  const mobile = !!opts.mobile;
  w.matchMedia = () => ({ matches: mobile, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
  w.scrollTo = () => {};
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = () => true;
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
  await sleep(150);
  return h;
}

const writes = (h: Harness, from = 0) => h.reqs.slice(from).filter((r) => r.method !== "GET");
const click = (h: Harness, el: any) => el.dispatchEvent(new h.w.MouseEvent("click", { bubbles: true, cancelable: true }));
const buttons = (h: Harness, re: RegExp) => [...h.w.document.querySelectorAll("button")].filter((b: any) => re.test((b.textContent || "").trim())) as any[];
const buttonByText = (h: Harness, re: RegExp) => buttons(h, re)[0];
function setValue(h: Harness, el: any, value: string, kind: "input" | "change" = "input") {
  const proto = el.tagName === "SELECT" ? h.w.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? h.w.HTMLTextAreaElement.prototype : h.w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new h.w.Event(kind, { bubbles: true }));
}
const fieldByLabel = (h: Harness, label: string) => {
  const l = [...h.w.document.querySelectorAll("label")].find((x: any) => (x.textContent || "").trim() === label) as any;
  return l ? h.w.document.getElementById(l.htmlFor) : null;
};
async function openNav(h: Harness, nav: string) { h.w.DT.actions.setNav(nav); await sleep(150); }

// ── #1 ER diversion ─────────────────────────────────────────────────────────
describe("#1 ER diversion is the server's", () => {
  const banner = (h: Harness) => h.w.document.querySelector("[data-diversion]");
  it("the banner is the server's state; Declare is PUT /api/er/diversion and the toast never claims EMS", async () => {
    const h = await boot({ role: "er_director" });
    await until(() => !!banner(h) && banner(h).getAttribute("data-diversion") === "off", 6000, "banner");
    expect(banner(h).textContent).toMatch(/ER is accepting patients/);
    const from = h.reqs.length;
    click(h, buttonByText(h, /^Declare diversion$/));
    await until(() => writes(h, from).length >= 1, 4000, "PUT");
    expect(writes(h, from)[0]).toEqual({ method: "PUT", path: "/api/er/diversion", body: { active: true } });
    await until(() => banner(h).getAttribute("data-diversion") === "on", 4000, "on");
    expect(banner(h).textContent).toMatch(/Declared by Dr\. Evan Marsh/);
    expect(banner(h).textContent).not.toMatch(/EMS and all providers were notified/);
    expect(h.state().__toast).toMatchObject({ title: "Diversion declared" });
    expect(h.state().__toast.msg).toMatch(/Critical broadcast sent to 14 people/);
    expect(h.state().__toast.msg).toMatch(/does not notify EMS/);
    // Nothing local: no locally-invented broadcast row, no local audit row.
    expect(h.state().audit).toEqual([]);
  });

  it("a refused declare (403) leaves the server's state and says so; a 409 shows the server's state", async () => {
    const h = await boot({ role: "er_director" });
    await until(() => !!banner(h) && banner(h).getAttribute("data-diversion") === "off", 6000, "banner");
    h.routes.refuse = (r) => (r.method === "PUT" && r.path === "/api/er/diversion" ? { status: 403, body: { error: "forbidden" } } : undefined);
    expect(await h.w.DT.actions.setDiversion(true)).toBe(false);
    expect(h.state().__toast).toMatchObject({ title: "Diversion NOT declared" });
    expect(banner(h).getAttribute("data-diversion")).toBe("off");
    delete h.routes.refuse;
    h.server.diversion = { active: true, since: now(), by: { id: 33, name: "Dr. Other" } };
    expect(await h.w.DT.actions.setDiversion(true)).toBe(false);
    await until(() => banner(h).getAttribute("data-diversion") === "on", 4000, "server state");
    expect(banner(h).textContent).toMatch(/Dr\. Other/);
  });

  it("another session's change (DIVERSION_UPDATED) re-reads the server", async () => {
    const h = await boot({ role: "er_director" });
    await until(() => !!banner(h) && banner(h).getAttribute("data-diversion") === "off", 6000, "banner");
    h.server.diversion = { active: true, since: now(), by: { id: 33, name: "Dr. Other" } };
    h.sockets[0].emit({ type: "DIVERSION_UPDATED" });
    await until(() => banner(h).getAttribute("data-diversion") === "on", 4000, "re-read");
  });
});

// ── #2 / #3 ER roster and throughput ────────────────────────────────────────
describe("#2/#3 the ER roster and throughput are the server's", () => {
  for (const synthetic of [true, false]) {
    it(`roster = the server's ER physicians, no demo names; tiles from the report (syntheticData=${synthetic})`, async () => {
      const h = await boot({ role: "er_director", server: { synthetic } });
      await until(() => !!h.w.document.querySelector('[data-er-physician="4"]'), 6000, "roster row");
      expect([...h.w.document.querySelectorAll("[data-er-physician]")].map((x: any) => x.getAttribute("data-er-physician"))).toEqual(["4"]);
      expect(h.w.document.querySelector("[data-er-roster-count]").textContent).toMatch(/0 of 1 on shift/);
      expect(h.text()).not.toMatch(DEMO_NAMES);
      expect(h.text()).toMatch(/Avg time-to-accept/);
      expect(h.text()).toMatch(/2m 36s/);
      expect(h.text()).not.toMatch(/4m 12s/);
      // No local Add / Remove / rename on the roster.
      expect(buttons(h, /^Add$/)).toHaveLength(0);
      expect(h.w.document.querySelector('[data-er-physician="4"] [title="Remove"]')).toBeNull();
      expect(buttonByText(h, /Manage in People/)).toBeTruthy();
    });
  }

  it("On/Off and shift are PATCH /api/er/roster/:id and follow the server", async () => {
    const h = await boot({ role: "er_director" });
    await until(() => !!h.w.document.querySelector('[data-er-physician="4"]'), 6000, "roster row");
    const from = h.reqs.length;
    click(h, h.w.document.querySelector('[data-er-physician="4"] button[aria-pressed]'));
    await until(() => writes(h, from).length >= 1, 4000, "PATCH");
    expect(writes(h, from)[0]).toEqual({ method: "PATCH", path: "/api/er/roster/4", body: { onShift: true } });
    await until(() => /1 of 1 on shift/.test(h.w.document.querySelector("[data-er-roster-count]").textContent), 4000, "count");
    const sel = h.w.document.querySelector('[data-er-physician="4"] select');
    setValue(h, sel, "night", "change");
    await until(() => writes(h, from).length >= 2, 4000, "PATCH shift");
    expect(writes(h, from)[1]).toEqual({ method: "PATCH", path: "/api/er/roster/4", body: { shiftType: "night" } });
  });

  it("nothing accepted → '—', and an unreadable report → '—' (never a constant)", async () => {
    const h = await boot({ role: "er_director", server: { report: { scope: "org", assignments: { total: 0, accepted: 0, declined: 0, pending: 0, timeToAcceptMinAvg: null, timeToAcceptMinMedian: null }, admits24h: 0 } } });
    await until(() => /no accepted admissions yet/.test(h.text()), 6000, "tile");
    expect(h.text()).not.toMatch(/4m 12s/);
    const d = await boot({ role: "er_doctor", server: { report: { scope: "mine", assignments: { total: 1, accepted: 1, declined: 0, pending: 0, timeToAcceptMinAvg: 1.5, timeToAcceptMinMedian: 1.5 }, admits24h: 1 } } });
    await until(() => /1m 30s/.test(d.text()), 6000, "er doctor tile");
    expect(d.reqs.some((r) => r.path === "/api/reports/er")).toBe(true);
    const off = await boot({ role: "er_doctor" });
    off.routes.off = (r) => (r.path === "/api/reports/er" ? { status: 404, body: { error: "module_disabled", module: "ops.analytics" } } : undefined);
    await off.w.DT.actions.loadErReport();
    await sleep(50);
    expect(off.state().erReport).toBeNull();
    expect(off.text()).toMatch(/switched off for your organization/);
    expect(off.text()).not.toMatch(/4m 12s/);
  });
});

// ── #4 care team ────────────────────────────────────────────────────────────
describe("#4 My care team is the server's", () => {
  it("shows the server's members and real candidates; Link / On call / Remove go to the server", async () => {
    const h = await boot({ role: "hospitalist" });
    await openNav(h, "team");
    await until(() => !!h.w.document.querySelector('[data-team-member="9"]'), 6000, "member");
    expect([...h.w.document.querySelectorAll("[data-team-member]")].map((x: any) => x.getAttribute("data-team-member"))).toEqual(["9"]);
    expect(h.text()).not.toMatch(DEMO_NAMES);
    expect(h.text()).toMatch(/1 on call with you/);
    // toggle on-call
    let from = h.reqs.length;
    click(h, h.w.document.querySelector('[data-team-member="9"] button[aria-pressed]'));
    await until(() => writes(h, from).length >= 1, 4000, "PATCH");
    expect(writes(h, from)[0]).toEqual({ method: "PATCH", path: "/api/care-team/members/9", body: { onCall: false } });
    await until(() => h.state().team[0].onCall === false, 4000, "re-read");
    // link a real candidate (deactivated ones are not offered)
    click(h, buttonByText(h, /^Add member$/));
    await sleep(50);
    expect(h.w.document.querySelector('[data-candidate="12"]')).toBeNull();
    from = h.reqs.length;
    click(h, h.w.document.querySelector('[data-candidate="6"] button'));
    await until(() => writes(h, from).length >= 1, 4000, "POST");
    expect(writes(h, from)[0]).toEqual({ method: "POST", path: "/api/care-team/members", body: { memberUserId: 6 } });
    await until(() => !!h.w.document.querySelector('[data-team-member="6"]'), 4000, "linked");
    expect(h.state().__toast.title).toMatch(/Dr\. Sharon George added to your on-call unit/);
    // remove
    from = h.reqs.length;
    click(h, h.w.document.querySelector('[data-team-member="6"] button[aria-label^="Remove"]'));
    await until(() => writes(h, from).length >= 1, 4000, "DELETE");
    expect(writes(h, from)[0]).toEqual({ method: "DELETE", path: "/api/care-team/members/6", body: null });
    await until(() => !h.w.document.querySelector('[data-team-member="6"]'), 4000, "removed");
  });

  it("an empty server team is empty — no demo members (syntheticData=false)", async () => {
    const h = await boot({ role: "hospitalist", server: { synthetic: false, careTeam: [] } });
    await openNav(h, "team");
    await until(() => /No team members yet/.test(h.text()), 6000, "empty");
    expect(h.text()).not.toMatch(/Connected · 2 on call/);
    expect(h.text()).not.toMatch(DEMO_NAMES);
  });
});

// ── #5 / #6 hospitalist dashboard ───────────────────────────────────────────
describe("#5/#6 the hospitalist dashboard", () => {
  it("'Current census' is the server's census; 'Message team' opens the patient thread on the server", async () => {
    const h = await boot({ role: "hospitalist" });
    await until(() => /9 \/ 12/.test(h.text()), 6000, "census");
    expect(h.state().myProvider).toMatchObject({ census: 9, cap: 12 });
    const btn = buttonByText(h, /^Message team$/);
    expect(btn).toBeTruthy();
    const from = h.reqs.length;
    click(h, btn);
    await until(() => writes(h, from).length >= 1, 4000, "POST");
    expect(writes(h, from)[0]).toEqual({ method: "POST", path: "/api/messaging/patient-thread", body: { patientId: 13 } });
    await until(() => h.state().ui.nav === "messages", 4000, "nav");
    // Nothing named "Patient QZ · care" was invented locally.
    expect((h.state().conversations || []).some((c: any) => /· care$/.test(c.name || ""))).toBe(false);
  });
});

// ── #11 / #12 director provider rows ────────────────────────────────────────
describe("#11/#12 provider name, specialty and removal are the server's", () => {
  it("rename + specialty → PATCH /api/hospitalists/:id/profile; refused removal (409) says why and keeps the row", async () => {
    const h = await boot({ role: "director" });
    await until(() => (h.state().providers || []).some((p: any) => p.id === "h2"), 6000, "providers");
    let from = h.reqs.length;
    await h.w.DT.actions.updateProvider("h2", { name: "Dr. Sharon George Renamed", specialty: "GI" });
    expect(writes(h, from)[0]).toEqual({ method: "PATCH", path: "/api/hospitalists/2/profile", body: { displayName: "Dr. Sharon George Renamed", specialty: "GI" } });
    await until(() => (h.state().providers.find((p: any) => p.id === "h2") || {}).name === "Dr. Sharon George Renamed", 4000, "renamed");
    from = h.reqs.length;
    await until(() => !!h.w.document.querySelector('button[aria-label="Remove Dr. Sharon George Renamed from the rotation"]'), 4000, "trash");
    const trash = h.w.document.querySelector('button[aria-label="Remove Dr. Sharon George Renamed from the rotation"]');
    click(h, trash);
    await until(() => writes(h, from).length >= 1, 4000, "DELETE");
    expect(writes(h, from)[0]).toMatchObject({ method: "DELETE", path: "/api/physicians/2" });
    await until(() => !!h.state().__toast && /Couldn't remove/.test(h.state().__toast.title), 4000, "toast");
    expect(h.state().__toast.msg).toMatch(/admission request waiting/);
    expect(h.state().providers.some((p: any) => p.id === "h2")).toBe(true);
  });
});

// ── #13-#16 patient board ───────────────────────────────────────────────────
describe("#13-#16 the patient board edits the server", () => {
  it("no EHR/FHIR bar and no editable status; room edit → PATCH; Add → POST patient + assignment; Remove → DELETE", async () => {
    const h = await boot({ role: "director" });
    await openNav(h, "board");
    await until(() => (h.state().board || []).some((b: any) => b.patientId === 13), 6000, "board");
    expect(h.text()).not.toMatch(/Connect EHR|FHIR|fhir\.mayo/);
    expect(h.w.document.querySelector("[data-testid=data-source-banner]")).toBeNull();
    expect([...h.w.document.querySelectorAll("select")].some((s: any) => [...s.options].some((o: any) => /Observation|Transfer/.test(o.textContent)))).toBe(false);
    expect(h.w.document.querySelector('[data-board-status="assigned"]').textContent).toMatch(/Admitted/);
    let from = h.reqs.length;
    await h.w.DT.actions.updateBoardRow("b13", { room: "999X" });
    expect(writes(h, from)).toEqual([{ method: "PATCH", path: "/api/patients/13", body: { roomNumber: "999X" } }]);
    await until(() => h.state().board.find((b: any) => b.patientId === 13).room === "999X", 4000, "re-read");
    // A status patch is not sent anywhere.
    from = h.reqs.length;
    await h.w.DT.actions.updateBoardRow("b13", { status: "transfer" });
    expect(writes(h, from)).toEqual([]);
    // Add admission (modal has no free-text "Admitted by")
    click(h, buttonByText(h, /^Add admission$/));
    await sleep(80);
    expect(fieldByLabel(h, "Admitted by")).toBeNull();
    expect(h.w.document.body.textContent).toMatch(/Round-robin — next eligible hospitalist/);
    from = h.reqs.length;
    const ok = await h.w.DT.actions.addBoardPatient({ initials: "zz", room: "555", dept: "MED", issue: "Sweep manual admission", attending: "" });
    expect(ok).toBe(true);
    expect(writes(h, from)).toEqual([
      { method: "POST", path: "/api/patients", body: { initials: "ZZ", issueSummary: "Sweep manual admission", roomNumber: "555", department: "MED" } },
      { method: "POST", path: "/api/assignments", body: { patientId: 99, mode: "round_robin" } },
    ]);
    expect(h.state().__toast.msg).toMatch(/awaiting their accept/);
    // Remove
    from = h.reqs.length;
    expect(await h.w.DT.actions.removeBoardPatient("b13")).toBe(true);
    expect(writes(h, from)).toEqual([{ method: "DELETE", path: "/api/patients/13", body: null }]);
    await until(() => !(h.state().board || []).some((b: any) => b.patientId === 13), 4000, "gone");
  });

  it("a refused edit says so and the board shows the server's value", async () => {
    const h = await boot({ role: "er_director" });
    await openNav(h, "board");
    await until(() => (h.state().board || []).some((b: any) => b.patientId === 13), 6000, "board");
    h.routes.refuse = (r) => (r.method === "PATCH" && r.path === "/api/patients/13" ? { status: 403, body: { error: "forbidden" } } : undefined);
    expect(await h.w.DT.actions.updateBoardRow("b13", { issue: "Edited" })).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Not saved" });
    expect(h.state().board.find((b: any) => b.patientId === 13).issue).toBe("Chest pain");
  });
});

// ── #17-#22 ER intake ───────────────────────────────────────────────────────
describe("#17-#22 the ER intake extracts and sends on the server", () => {
  const intake = (h: Harness) => ({
    note: () => [...h.w.document.querySelectorAll("textarea")][0],
    initials: () => fieldByLabel(h, "Patient initials"),
    room: () => fieldByLabel(h, "Room / location"),
  });

  it("an empty note extracts nothing and sends nothing; a note is POST /api/patients/extract, labelled by engine", async () => {
    const h = await boot({ role: "er_doctor" });
    await until(() => !!buttonByText(h, /^Extract fields$/), 6000, "intake");
    expect(buttonByText(h, /Extract with AI/)).toBeFalsy();
    let from = h.reqs.length;
    click(h, buttonByText(h, /^Extract fields$/));
    await sleep(80);
    expect(h.reqs.slice(from).filter((r) => r.path === "/api/patients/extract")).toHaveLength(0);
    expect(intake(h).initials().value).toBe("");
    expect(intake(h).room().value).toBe("");
    expect(h.text()).not.toMatch(/Chest pain, SOB on exertion/);
    expect(h.state().__toast).toMatchObject({ title: "Nothing to extract" });

    setValue(h, intake(h).note(), "Patient J.K. room 612 with crushing chest pain");
    from = h.reqs.length;
    click(h, buttonByText(h, /^Extract fields$/));
    await until(() => intake(h).initials().value === "JK", 4000, "filled");
    expect(writes(h, from)).toEqual([{ method: "POST", path: "/api/patients/extract", body: { note: "Patient J.K. room 612 with crushing chest pain" } }]);
    expect(intake(h).room().value).toBe("612");
    expect(h.w.document.querySelector("[data-extracted-by]").getAttribute("data-extracted-by")).toBe("local");
    expect(h.text()).toMatch(/keyword rules \(no AI\)/);
    expect(h.text()).not.toMatch(/AI-suggested/);
  });

  it("ticked consults are requested on the server with the named team; PA/NP picker = real accounts; no paging pills", async () => {
    const h = await boot({ role: "er_doctor", server: {
      careTeam: [],
      consultServices: [{ id: "cs1", name: "Cardiology", onCall: { name: "Dr. Card Io", userId: 21 }, members: [{ id: "cm1", name: "Pat Member, NP", avatar: "PM", role: "NP" }] }],
      consultReply: (body) => [{ id: 601, patientId: 99, specialty: body.specialty, consultantUserId: 21, consultantName: "Dr. Card Io", status: "requested" }],
    } });
    await until(() => !!buttonByText(h, /^Extract fields$/), 6000, "intake");
    setValue(h, intake(h).initials(), "AB");
    setValue(h, intake(h).room(), "7");
    await sleep(50);
    click(h, buttons(h, /Cardiology$/)[0]);
    await until(() => !!h.w.document.querySelector('[data-consult-panel="Cardiology"]'), 4000, "panel");
    const panelText = () => h.w.document.querySelector('[data-consult-panel="Cardiology"]').textContent;
    expect(panelText()).not.toMatch(/App push|Text \/ SMS|Won't be paged/);
    expect(h.w.document.querySelector("[data-consult-alerts]").textContent).toMatch(/Alerted in DocTurn: Dr\. Card Io · recorded only: Pat Member, NP/);
    click(h, buttonByText(h, /^Add PA \/ NP$/));
    await sleep(50);
    const picker = h.w.document.querySelector("[data-midlevel-picker]").textContent;
    expect(picker).toMatch(/Jordan Wu, PA-C/);
    expect(picker).not.toMatch(DEMO_NAMES);
    expect(picker).not.toMatch(/Old Former/);
    click(h, [...h.w.document.querySelectorAll("[data-midlevel-picker] button")].find((b: any) => /Jordan Wu/.test(b.textContent)));
    await sleep(50);
    const from = h.reqs.length;
    const send = buttonByText(h, /^Send assignment \+ 1 consult$/);
    expect(send).toBeTruthy();
    click(h, send);
    await until(() => writes(h, from).some((r) => r.path === "/api/patients/99/consults"), 4000, "consult POST");
    expect(writes(h, from).map((r) => r.method + " " + r.path)).toEqual(["POST /api/patients", "POST /api/assignments", "POST /api/patients/99/consults"]);
    expect(writes(h, from)[2]!.body).toEqual({ specialty: "Cardiology", consultants: [{ name: "Dr. Card Io", userId: 21 }, { name: "Pat Member, NP" }, { name: "Jordan Wu, PA-C", userId: 9 }] });
    await until(() => /Consults: Cardiology → Dr\. Card Io/.test((h.state().__toast || {}).msg || ""), 4000, "toast");
  });

  it("no PA/NP accounts → no picker, no demo pool (syntheticData=false)", async () => {
    const h = await boot({ role: "er_doctor", server: { synthetic: false, candidates: [{ userId: 6, displayName: "Dr. Sharon George", credential: "MD", role: "hospitalist", active: true }] } });
    await until(() => !!buttonByText(h, /^Extract fields$/), 6000, "intake");
    click(h, buttons(h, /Cardiology$/)[0]);
    await until(() => !!h.w.document.querySelector('[data-consult-panel="Cardiology"]'), 4000, "panel");
    expect(buttonByText(h, /^Add PA \/ NP$/)).toBeFalsy();
    expect(h.text()).not.toMatch(DEMO_NAMES);
  });

  it("an ER doctor is not offered the org catalog's 'Add a specialty' (the server refuses that role)", async () => {
    const h = await boot({ role: "er_doctor", server: { consultServices: [{ id: "cs1", name: "Cardiology", onCall: null, members: [] }] } });
    await until(() => !!buttonByText(h, /^Customize$/), 6000, "customize");
    click(h, buttonByText(h, /^Customize$/));
    await sleep(50);
    expect(h.w.document.querySelector('input[placeholder="Add a specialty…"]')).toBeNull();
  });
});

// ── #23 consult toast ───────────────────────────────────────────────────────
describe("#23 '+ Consult' says what the server did", () => {
  it("names who was alerted, or says nobody was — only after the server answers", async () => {
    const h = await boot({ role: "hospitalist" });
    await until(() => (h.state().myAdmissions || []).length > 0, 6000, "census");
    const o1 = await h.w.DT.actions.requestConsult(13, "GI");
    expect(o1).toMatchObject({ created: 1, alerted: [] });
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "GI consult recorded — nobody alerted" });
    expect(h.state().__toast.msg).not.toMatch(/has been notified/);
    h.server.consultReply = (body) => [{ id: 602, patientId: 13, specialty: body.specialty, consultantUserId: 21, consultantName: "Dr. Card Io", status: "requested" }];
    await h.w.DT.actions.requestConsult(13, "Cardiology");
    expect(h.state().__toast).toMatchObject({ tone: "sent", title: "Cardiology consult requested", msg: "Alerted in DocTurn: Dr. Card Io." });
    h.routes.off = (r) => (r.path === "/api/patients/13/consults" ? { status: 404, body: { error: "module_disabled", module: "routing.consults" } } : undefined);
    await h.w.DT.actions.requestConsult(13, "GI");
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "GI consult NOT requested" });
  });
});
