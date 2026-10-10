import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The Director's schedule screens (A.CON schedule #1-#7), the REAL web client
 * — store.js, api-bridge.js and every JSX screen index.html loads, mounted in
 * jsdom with React — against a scripted backend that plays the server.
 *
 *   #1 the dashboard's schedule panel says what GET /api/oncall/sources says
 *      (selected source, configured, real lastSyncAt) — never "Amion · 2m ago";
 *   #2 Settings → On-call schedule sync offers ONLY the server's sources
 *      (amion / epic / manual); no-connector vendors and "Not configured" are
 *      not choices, and nothing is kept per browser;
 *   #3 no seeded per-org source map (an old saved one is dropped);
 *   #4/#5 shift names and hours come from the server, are saved with
 *      PATCH /api/org/shifts/:id and roll back on refusal; no demo hours;
 *   #6 "Reset count" is POST /api/admissions/reset — success only on the
 *      server's word, no local audit row;
 *   #7 the Admissions log and its tiles are GET /api/admissions — no demo
 *      rows, nothing appended by this browser.
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

const LIST_PATHS = /^\/api\/(hospitalists|physicians\/directory|patients|care-team\/candidates|assignments\/(pending|my|sent)|patient-board|registrations|messaging\/conversations|broadcasts|oncall\/manual)$/;
const DEMO_ROWS =/\b(MJ|RV|DK|LP)\b|Amir Patel|Maria Lopez|Omar Haddad/;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function sourcesBody(selected: "amion" | "epic" | "manual", amion: Partial<{ configured: boolean; lastSyncAt: string | null; lastStatus: string; rowCount: number }> = {}) {
  return {
    selected, explicit: selected !== "manual", overridden: null,
    sources: {
      amion: { id: "amion", configured: false, lastSyncAt: null, lastStatus: "never", error: null, rowCount: 0, message: "Amion feed not connected", ...amion },
      epic: { id: "epic", configured: false, lastSyncAt: null, lastStatus: "never", error: null, rowCount: 0, message: "Epic not configured" },
      manual: { id: "manual", configured: true, lastSyncAt: null, lastStatus: "never", error: null, rowCount: 0, message: null },
    },
    modules: { amion: true, epic: true, manual: true },
  };
}

interface Server {
  sources: any;
  shifts: Array<{ id: string; label: string; start: string | null; end: string | null }>;
  admissions: any;
  synthetic: boolean;
}
interface Harness {
  w: any; reqs: Req[]; routes: Record<string, Route>; server: Server; sockets: any[];
  state(): any; text(): string; close(): void;
}
const harnesses: Harness[] = [];
afterEach(() => { while (harnesses.length) harnesses.pop()!.close(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 6000, what = "condition") {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting for " + what);
    await sleep(15);
  }
}

function defaultServer(): Server {
  return {
    sources: sourcesBody("manual"),
    shifts: [
      { id: "day", label: "Day", start: null, end: null },
      { id: "swing", label: "Swing", start: null, end: null },
      { id: "night", label: "Night", start: null, end: null },
    ],
    admissions: {
      rows: [{ patientId: 7, initials: "SC", room: "204", specialty: "Cardiology", provider: "Dr. Nathan Alyesh", via: "round_robin", status: "pending", routedAt: iso(30 * 60_000), lastRoutedAt: iso(30 * 60_000), routings: 1 }],
      total: 1, last24h: 1, sinceReset: 1, reset: null, limit: 500, generatedAt: iso(0),
    },
    synthetic: true,
  };
}

async function boot(opts: { role?: "director" | "er_doctor"; server?: Partial<Server>; saved?: any; mobile?: boolean } = {}): Promise<Harness> {
  const role = opts.role ?? "director";
  const me = { id: role === "director" ? 2 : 4, username: role === "director" ? "director" : "er.doc", displayName: role === "director" ? "Dr. Dana Director" : "Dr. Erin Reyes", role, credential: "MD", organizationId: 1 };
  const dom = new JSDOM('<!doctype html><html><head><title>DocTurn</title></head><body><div id="root"></div></body></html>', { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const server: Server = { ...defaultServer(), ...(opts.server || {}) };
  const h: Harness = {
    w, reqs, routes: {}, server, sockets,
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
    if (p === "/api/config") return { status: 200, body: { syntheticData: server.synthetic } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: { assignmentTimeoutMin: 15, statSmsFallback: true, autoReassignOnDecline: false } } };
    if (p === "/api/org/config") return { status: 200, body: { name: "Sweep General", code: "SWPGEN", timezone: "America/Chicago", roundRobinShiftTypes: ["day", "night"], consultServices: [], consultServicesVersion: 0, theme: null, shifts: server.shifts } };
    if (p === "/api/org/shifts" && req.method === "GET") return { status: 200, body: { shifts: server.shifts } };
    const sm = p.match(/^\/api\/org\/shifts\/([a-z]+)$/);
    if (sm && req.method === "PATCH") {
      server.shifts = server.shifts.map((x) => (x.id === sm[1] ? { ...x, ...req.body } : x));
      return { status: 200, body: { shifts: server.shifts } };
    }
    if (p === "/api/oncall/sources") return { status: 200, body: server.sources };
    if (p === "/api/oncall/source" && req.method === "PATCH") {
      server.sources = { ...server.sources, selected: req.body.source, explicit: true };
      return { status: 200, body: { selected: req.body.source, explicit: true, status: server.sources.sources[req.body.source] } };
    }
    if (p === "/api/amion/status") return { status: 200, body: { configured: !!server.sources.sources.amion.configured, providers: [], lastSyncAt: server.sources.sources.amion.lastSyncAt, lastStatus: server.sources.sources.amion.lastStatus, rowCount: 0 } };
    if (p === "/api/admissions" && req.method === "GET") return { status: 200, body: server.admissions };
    if (p === "/api/admissions/reset" && req.method === "POST") {
      server.admissions = { ...server.admissions, sinceReset: 0, reset: { at: new Date().toISOString(), by: { id: me.id, name: me.displayName } } };
      return { status: 200, body: { total: server.admissions.total, last24h: server.admissions.last24h, sinceReset: 0, reset: server.admissions.reset } };
    }
    if (p === "/api/rotation/next") return { status: 200, body: { mode: "lowest_census", shiftTypes: ["day", "night"], capRelief: false, next: null, order: [] } };
    if (p === "/api/patients" && req.method === "POST") return { status: 201, body: { id: 99, initials: req.body.initials } };
    if (p === "/api/assignments" && req.method === "POST") return { status: 201, body: { id: 501, hospitalistId: 1, patientId: 99, status: "pending" } };
    if (req.method !== "GET") return { status: 204 };
    // Lists the hydrate reads; anything else this harness does not play is
    // "not here" (the screens handle a refused read).
    if (LIST_PATHS.test(p)) return { status: 200, body: [] };
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
  if (opts.saved) w.localStorage.setItem("docturn:store:v6", JSON.stringify(opts.saved));
  for (const v of VENDOR) w.eval(v);
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  w.eval(APP_SRC);
  await until(() => sockets.length >= 1 && !!w.DT.getState().session, 6000, "session");
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: me.id });
  await sleep(120);
  return h;
}

const writes = (h: Harness, from = 0) => h.reqs.slice(from).filter((r) => r.method !== "GET");
const panel = (h: Harness) => h.w.document.querySelector("[data-schedule-panel]");
const panelText = (h: Harness) => (panel(h) ? panel(h).textContent : "");
const click = (h: Harness, el: any) => el.dispatchEvent(new h.w.MouseEvent("click", { bubbles: true, cancelable: true }));
const buttonByText = (h: Harness, re: RegExp) => [...h.w.document.querySelectorAll("button")].find((b: any) => re.test((b.textContent || "").trim())) as any;
function setValue(h: Harness, el: any, value: string, kind: "input" | "change" = "input") {
  const proto = el.tagName === "SELECT" ? h.w.HTMLSelectElement.prototype : h.w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new h.w.Event(kind, { bubbles: true }));
}
async function openNav(h: Harness, nav: string) { h.w.DT.actions.setNav(nav); await sleep(150); }

// ── #1 dashboard schedule panel ───────────────────────────────────────────
describe("#1 the dashboard's schedule panel is the server's source and sync state", () => {
  it("server: manual, nothing configured → says Manual list; never 'synced', never 'Amion', never '2m ago'", async () => {
    const h = await boot();
    await until(() => !!panel(h) && panel(h).getAttribute("data-schedule-panel") === "manual", 6000, "panel");
    const t = panelText(h);
    expect(t).toMatch(/Manual list/);
    expect(t).toMatch(/No slots yet/);
    expect(t).not.toMatch(/synced/i);
    expect(t).not.toMatch(/Amion/);
    expect(t).not.toMatch(/2m ago/);
    expect(h.reqs.some((r) => r.path === "/api/oncall/sources")).toBe(true);
  });

  it("server: Amion synced 5 min ago with 12 slots → the real time, not a constant", async () => {
    const h = await boot({ server: { sources: sourcesBody("amion", { configured: true, lastSyncAt: iso(5 * 60_000 + 2000), lastStatus: "ok", rowCount: 12 }) } });
    await until(() => !!panel(h) && panel(h).getAttribute("data-schedule-panel") === "amion", 6000, "panel");
    const t = panelText(h);
    expect(t).toMatch(/synced from Amion/);
    expect(t).toMatch(/Synced 5 min ago · 12 slots/);
    expect(t).not.toMatch(/2m ago/);
  });

  it("server: Amion chosen but not connected → 'not connected'; Epic → names Epic", async () => {
    const a = await boot({ server: { sources: sourcesBody("amion") } });
    await until(() => !!panel(a) && panel(a).getAttribute("data-schedule-panel") === "amion", 6000, "panel");
    expect(panelText(a)).toMatch(/Amion not connected/);
    expect(panelText(a)).not.toMatch(/synced/i);
    const e = await boot({ server: { sources: sourcesBody("epic") } });
    await until(() => !!panel(e) && panel(e).getAttribute("data-schedule-panel") === "epic", 6000, "panel");
    expect(panelText(e)).toMatch(/Epic \(FHIR\) not connected/);
    expect(panelText(e)).not.toMatch(/Amion/);
  });

  it("follows the server after a change made elsewhere (re-read)", async () => {
    const h = await boot();
    await until(() => !!panel(h) && panel(h).getAttribute("data-schedule-panel") === "manual", 6000, "panel");
    h.server.sources = sourcesBody("amion", { configured: true, lastSyncAt: iso(10_000), lastStatus: "ok", rowCount: 3 });
    await h.w.DT.actions.loadOnCallSources();
    await until(() => panel(h).getAttribute("data-schedule-panel") === "amion", 6000, "amion");
    expect(panelText(h)).toMatch(/Synced just now · 3 slots/);
  });
});

// ── #2 / #3 source picker + no per-browser source map ──────────────────────
describe("#2/#3 the source picker offers only the server's sources; nothing is kept per browser", () => {
  it("Settings: options are exactly Amion / Epic / Manual, the value is the server's, and a pick goes to the server", async () => {
    const h = await boot();
    await openNav(h, "settings");
    await until(() => { const s = h.w.document.querySelector("#ss-source"); return !!s && s.value === "manual"; }, 6000, "select");
    const sel = h.w.document.querySelector("#ss-source");
    expect([...sel.options].map((o: any) => o.value)).toEqual(["amion", "epic", "manual"]);
    const txt = h.text();
    expect(txt).not.toMatch(/Not configured/);
    expect(txt).not.toMatch(/No schedule source for/);
    expect(txt).toMatch(/no connector for QGenda/);
    const from = h.reqs.length;
    setValue(h, sel, "amion", "change");
    await until(() => writes(h, from).length >= 1, 4000, "PATCH");
    expect(writes(h, from)).toEqual([{ method: "PATCH", path: "/api/oncall/source", body: { source: "amion" } }]);
    await until(() => h.w.document.querySelector("#ss-source").value === "amion", 4000, "select follows server");
  });

  it("no seeded per-org source map, no setScheduleSource, and an old saved map is dropped", async () => {
    const h = await boot({ saved: { v: 11, scheduleSources: { ISPN: "qgenda", SWPGEN: "none", MAYO: "qgenda" } } });
    expect(h.state().scheduleSources).toBeUndefined();
    expect(h.w.DT.actions.setScheduleSource).toBeUndefined();
    await until(() => !!panel(h) && panel(h).getAttribute("data-schedule-panel") === "manual", 6000, "panel");
    expect(panelText(h)).not.toMatch(/QGenda|not connected|Not configured/);
    await sleep(300);
    expect(h.w.localStorage.getItem("docturn:store:v6") || "").not.toMatch(/scheduleSources/);
  });
});

// ── #4 / #5 shift names and hours ─────────────────────────────────────────
describe("#4/#5 shift names and hours are the org's, from the server", () => {
  it("renders the server's names and NO demo hours", async () => {
    const h = await boot();
    await until(() => !!h.w.document.querySelector('[data-shift-label="day"]'), 6000, "shift header");
    expect(h.w.document.querySelector('[data-shift-label="day"]').textContent).toBe("Day");
    const inputs = [...h.w.document.querySelectorAll('[data-shift-hours] input[type="time"]')].map((i: any) => i.value);
    expect(inputs).toEqual(["", "", "", "", "", ""]);
    expect(h.text()).not.toMatch(/Day call|Nights/);
    expect(h.text()).toMatch(/hours not set/);
    expect(h.text()).toMatch(/Hours are for reference/);
  });

  it("server names and hours (set by another director) are what every session shows", async () => {
    const h = await boot({ server: { shifts: [
      { id: "day", label: "Day Team SWEEP", start: "06:30", end: "18:30" },
      { id: "swing", label: "Swing", start: null, end: null },
      { id: "night", label: "Night", start: null, end: null },
    ] } });
    await until(() => (h.w.document.querySelector('[data-shift-label="day"]') || {}).textContent === "Day Team SWEEP", 6000, "label");
    const day = [...h.w.document.querySelectorAll('[data-shift-hours="day"] input')].map((i: any) => i.value);
    expect(day).toEqual(["06:30", "18:30"]);
  });

  it("rename → PATCH /api/org/shifts/day; the screen shows the server's answer", async () => {
    const h = await boot();
    await until(() => !!h.w.document.querySelector('[data-shift-label="day"]'), 6000, "shift header");
    const from = h.reqs.length;
    const ok = await h.w.DT.actions.renameShift("day", "  Day Team SWEEP ");
    expect(ok).toBe(true);
    expect(writes(h, from)).toEqual([{ method: "PATCH", path: "/api/org/shifts/day", body: { label: "Day Team SWEEP" } }]);
    await until(() => h.w.document.querySelector('[data-shift-label="day"]').textContent === "Day Team SWEEP", 4000, "renamed");
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Shift renamed" });
  });

  it("a refused rename (403) rolls back with the reason", async () => {
    const h = await boot();
    await until(() => !!h.w.document.querySelector('[data-shift-label="day"]'), 6000, "shift header");
    h.routes.refuse = (r) => (r.method === "PATCH" && r.path.startsWith("/api/org/shifts/") ? { status: 403, body: { error: "forbidden" } } : undefined);
    const ok = await h.w.DT.actions.renameShift("day", "Mine");
    expect(ok).toBe(false);
    expect(h.state().shifts[0].label).toBe("Day");
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Not saved", msg: "Only a director can change shift names and hours." });
  });

  it("hours: editing the time field and leaving it saves to the server; a refusal puts the server's value back", async () => {
    const h = await boot();
    await until(() => !!h.w.document.querySelector('[data-shift-hours="day"] input'), 6000, "hours");
    const start = () => h.w.document.querySelector('[data-shift-hours="day"] input');
    const from = h.reqs.length;
    setValue(h, start(), "06:30");
    start().dispatchEvent(new h.w.FocusEvent("focusout", { bubbles: true }));
    start().dispatchEvent(new h.w.FocusEvent("blur", { bubbles: false }));
    await until(() => writes(h, from).length >= 1, 4000, "PATCH");
    expect(writes(h, from)[0]).toEqual({ method: "PATCH", path: "/api/org/shifts/day", body: { start: "06:30" } });
    await until(() => h.state().shifts[0].start === "06:30", 4000, "saved");

    h.routes.refuse = (r) => (r.method === "PATCH" && r.path.startsWith("/api/org/shifts/") ? { status: 400, body: { error: "validation_error" } } : undefined);
    const ok = await h.w.DT.actions.updateShift("day", { start: "07:15" });
    expect(ok).toBe(false);
    expect(h.state().shifts[0].start).toBe("06:30");
    await until(() => start().value === "06:30", 4000, "input back to server value");
  });
});

// ── #6 Reset count ────────────────────────────────────────────────────────
describe("#6 Reset count is the server's org-wide reset", () => {
  it("click → POST /api/admissions/reset; counter and toast follow the server; no local audit row", async () => {
    const h = await boot();
    await until(() => (h.w.document.querySelector("[data-admissions-since]") || {}).textContent === "1", 6000, "count");
    const btn = buttonByText(h, /^Reset count$/);
    expect(btn).toBeTruthy();
    expect(buttonByText(h, /^Reset 24h$/)).toBeFalsy();
    const from = h.reqs.length;
    click(h, btn);
    await until(() => writes(h, from).length >= 1, 4000, "POST");
    expect(writes(h, from)).toEqual([{ method: "POST", path: "/api/admissions/reset", body: {} }]);
    await until(() => (h.w.document.querySelector("[data-admissions-since]") || {}).textContent === "0", 4000, "count 0");
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Admissions count reset" });
    expect(h.w.document.querySelector("[data-admissions-reset-line]").textContent).toMatch(/reset by Dr\. Dana Director/);
    expect(h.state().audit).toEqual([]);
  });

  it("a refused reset (403) says so and leaves the server's count", async () => {
    const h = await boot();
    await until(() => (h.w.document.querySelector("[data-admissions-since]") || {}).textContent === "1", 6000, "count");
    h.routes.refuse = (r) => (r.path === "/api/admissions/reset" ? { status: 403, body: { error: "forbidden" } } : undefined);
    const ok = await h.w.DT.actions.resetAdmissionsCount();
    expect(ok).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Count not reset" });
    expect(h.w.document.querySelector("[data-admissions-since]").textContent).toBe("1");
    expect(h.state().audit).toEqual([]);
  });

  it("another director's reset (ADMISSIONS_UPDATED) re-reads the server's count", async () => {
    const h = await boot();
    await until(() => (h.w.document.querySelector("[data-admissions-since]") || {}).textContent === "1", 6000, "count");
    h.server.admissions = { ...h.server.admissions, sinceReset: 0, reset: { at: new Date().toISOString(), by: { id: 9, name: "Dr. Other Director" } } };
    h.sockets[0].emit({ type: "ADMISSIONS_UPDATED" });
    await until(() => h.w.document.querySelector("[data-admissions-since]").textContent === "0", 4000, "re-read");
  });
});

// ── #7 Admissions log ────────────────────────────────────────────────────
describe("#7 the Admissions log is the server's", () => {
  for (const synthetic of [true, false]) {
    it(`shows the server's rows and counts only — no demo admissions (syntheticData=${synthetic})`, async () => {
      const h = await boot({ server: { synthetic } });
      await openNav(h, "admissions");
      await until(() => !!h.w.document.querySelector('[data-adm-row="SC"]'), 6000, "row");
      expect([...h.w.document.querySelectorAll("[data-adm-row]")].map((r: any) => r.getAttribute("data-adm-row"))).toEqual(["SC"]);
      expect(h.text()).not.toMatch(DEMO_ROWS);
      const tile = (k: string) => h.w.document.querySelector(`[data-adm-tile="${k}"]`).textContent;
      expect([tile("total"), tile("last24h"), tile("sinceReset")]).toEqual(["1", "1", "1"]);
    });
  }

  it("an empty server log is empty (no seed rows), with the server's zero counts", async () => {
    const h = await boot({ server: { synthetic: false, admissions: { rows: [], total: 0, last24h: 0, sinceReset: 0, reset: null, limit: 500, generatedAt: iso(0) } } });
    await openNav(h, "admissions");
    await until(() => /No admissions on record/.test(h.text()), 6000, "empty");
    expect(h.text()).not.toMatch(DEMO_ROWS);
    expect(h.state().admissions).toEqual([]);
  });

  it("server counts beyond the rows shown (capped) are the server's total", async () => {
    const h = await boot({ server: { admissions: { ...defaultServer().admissions, total: 812, last24h: 40, sinceReset: 77 } } });
    await openNav(h, "admissions");
    await until(() => !!h.w.document.querySelector('[data-adm-tile="total"]') && h.w.document.querySelector('[data-adm-tile="total"]').textContent === "812", 6000, "total");
    expect(h.w.document.querySelector('[data-adm-tile="sinceReset"]').textContent).toBe("77");
    expect(h.text()).toMatch(/Showing the newest 1 of 812 admissions on record/);
  });

  it("an ER physician's send writes nothing into the admissions log in this browser", async () => {
    const h = await boot({ role: "er_doctor" });
    expect(h.state().admissions).toEqual([]);
    h.w.DT.actions.sendAssignment(null, { initials: "QZ", room: "B4", complaint: "synthetic", specialty: "Cardiology" }, [], "quick");
    await until(() => h.reqs.some((r) => r.method === "POST" && r.path === "/api/assignments"), 4000, "sent");
    await sleep(100);
    expect(h.state().admissions).toEqual([]);
  });
});
