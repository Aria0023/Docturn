import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * A.CON-SHO-40 (client half, fix step 4) — the REAL web client
 * (webapp/store.js + webapp/api-bridge.js) in jsdom against a scripted backend.
 *
 * A per-org feature switch can flip while a page is open (the module map is
 * re-read once a minute). The server refuses the stale request with
 * {error:"module_disabled"}; the client must then
 *   - say WHICH feature is switched off (not "Try again." / "Upload failed
 *     <name>"), for the patient-thread opener and for attachment / voice
 *     uploads (a refused STAT already says so — sendFailure);
 *   - re-read GET /api/modules at once, so the refused control (Message team,
 *     paperclip, mic, STAT/Urgent chips) disappears without waiting a minute;
 * and a successful "Message team" asks Messaging to SHOW that thread
 * (s.__openThread), so a phone lands on the thread rather than the list.
 *
 * The component half (PatientBoard hides "Message team" while
 * messaging.patientThreads is off; Messaging honours __openThread on a phone)
 * is measured in a real browser by scripts/messaging-phone-check.mjs.
 */

// CLIENT_SRC_ROOT points the suite at another checkout's webapp/ (e.g. to show
// the previous client failing these checks); defaults to this repository.
const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom"; // untyped devDependency — loaded dynamically
const { JSDOM } = (await import(jsdomName)) as any;

const CHEN = { id: 11, username: "chen", displayName: "Dr. Nathan Alyesh", role: "hospitalist", credential: "MD" };

type Req = { method: string; path: string; body: any };
type Reply = { status: number; body?: any } | { network: true };
type Route = (req: Req) => Reply | undefined;

interface Harness {
  w: any;
  reqs: Req[];
  routes: Record<string, Route>;
  modules: Record<string, boolean>;
  state(): any;
  close(): void;
}
const harnesses: Harness[] = [];
afterEach(() => { while (harnesses.length) harnesses.pop()!.close(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await sleep(10);
  }
}

async function boot(): Promise<Harness> {
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const h: Harness = {
    w, reqs, routes: {}, modules: {},
    state: () => w.DT.getState(),
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  const convos = [{ id: 1, type: "direct", name: null, participantIds: [CHEN.id, 12], patientId: null }];
  const respond = (req: Req): Reply => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: CHEN };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user: CHEN } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: true } };
    if (p === "/api/modules") return { status: 200, body: { modules: { ...h.modules }, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: {} } };
    if (p === "/api/messaging/conversations" && req.method === "GET") return { status: 200, body: convos.map((c) => ({ ...c, lastMessage: null, unreadCount: 0 })) };
    if (/^\/api\/messaging\/conversations\/\d+\/messages$/.test(p)) return { status: 200, body: [] };
    if (/^\/api\/messaging\/conversations\/\d+$/.test(p)) return { status: 200, body: convos[0] };
    if (req.method !== "GET") return { status: 204 };
    return { status: 200, body: [] };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(req);
    const r = respond(req);
    if ("network" in r) return Promise.reject(new w.TypeError("Failed to fetch"));
    const text = r.body === undefined ? "" : JSON.stringify(r.body);
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, statusText: "", text: () => Promise.resolve(text), headers: { get: () => "application/json" } });
  };
  class FakeWS {
    url: string; readyState = 0; sent: string[] = [];
    onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
    constructor(url: string) { this.url = url; sockets.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.({}); } }, 0); }
    send(d: string) { this.sent.push(d); }
    close(code = 1000, reason = "") { if (this.readyState === 3) return; this.readyState = 3; const cb = this.onclose; setTimeout(() => cb?.({ code, reason }), 0); }
    emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  }
  w.WebSocket = FakeWS;
  w.console.log = () => {};
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  await until(() => sockets.length === 1 && !!w.DT.getState().session);
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: CHEN.id });
  await until(() => !!w.DT.getState().modules);
  await sleep(50);
  return h;
}
const moduleGets = (h: Harness) => h.reqs.filter((r) => r.method === "GET" && r.path === "/api/modules").length;
const refused = (path: RegExp, status = 404): Route => (req) => (path.test(req.path) && req.method === "POST" ? { status, body: { error: "module_disabled" } } : undefined);
const file = (h: Harness, name: string, type: string) => new h.w.File([new Uint8Array([1, 2, 3, 4])], name, { type });

describe("web client: a request refused by a switched-off module (A.CON-SHO-40)", () => {
  it("Message team refused (404 module_disabled): names the feature and re-reads the module map at once", async () => {
    const h = await boot();
    const before = moduleGets(h);
    h.modules = { "messaging.patientThreads": false }; // flipped after this page loaded
    h.routes.pt = refused(/^\/api\/messaging\/patient-thread$/);
    await h.w.DT.actions.openPatientThread(7);
    const toast = h.state().__toast;
    expect(toast.title).toBe("Couldn't open patient thread");
    expect(toast.msg).toBe("Patient-linked threads are switched off for your organization.");
    await until(() => moduleGets(h) > before);
    await until(() => h.w.DT.moduleOn("messaging.patientThreads") === false);
    expect(h.state().ui.nav).not.toBe("messages");
  });

  it("Message team: other refusals say what happened; none of them re-reads the module map", async () => {
    const h = await boot();
    const before = moduleGets(h);
    const cases: Array<[Reply, RegExp]> = [
      [{ status: 403, body: { error: "forbidden" } }, /care team/],
      [{ status: 404, body: { error: "not_found" } }, /no longer on the board/],
      [{ network: true }, /No connection/],
      [{ status: 500, body: { error: "internal" } }, /^Try again\.$/],
    ];
    for (const [reply, re] of cases) {
      h.routes.pt = (req) => (req.path === "/api/messaging/patient-thread" ? reply : undefined);
      await h.w.DT.actions.openPatientThread(7);
      expect(h.state().__toast.msg).toMatch(re);
    }
    await sleep(50);
    expect(moduleGets(h)).toBe(before);
  });

  it("Message team that works opens the thread AND asks Messaging to show it (phone lands on the thread)", async () => {
    const h = await boot();
    h.routes.pt = (req) => (req.path === "/api/messaging/patient-thread" ? { status: 200, body: { id: 1 } } : undefined);
    await h.w.DT.actions.openPatientThread(7);
    expect(h.state().__activeConvo).toBe(1);
    expect(h.state().__openThread).toBe(1);
    expect(h.state().ui.nav).toBe("messages");
  });

  it("paperclip upload refused: the reason names the file and the switched-off feature; the map is re-read", async () => {
    const h = await boot();
    const before = moduleGets(h);
    h.modules = { "messaging.attachments": false };
    h.routes.up = refused(/^\/api\/messaging\/attachments$/);
    const err: any = await h.w.DT.actions.uploadAttachment(file(h, "x.png", "image/png")).then(() => null, (e: any) => e);
    expect(err).toBeTruthy();
    expect(err.reason).toEqual({ code: "module_disabled", text: "x.png — file attachments are switched off for your organization." });
    await until(() => moduleGets(h) > before);
    await until(() => h.w.DT.moduleOn("messaging.attachments") === false);
  });

  it("voice upload refused: says voice messages are switched off", async () => {
    const h = await boot();
    h.modules = { "messaging.voice": false };
    h.routes.up = refused(/^\/api\/messaging\/attachments$/);
    const err: any = await h.w.DT.actions.uploadAttachment(file(h, "voice-1.m4a", "audio/mp4"), { durationMs: 2000 }).then(() => null, (e: any) => e);
    expect(err.reason.code).toBe("module_disabled");
    expect(err.reason.text).toBe("Voice message — voice messages are switched off for your organization.");
    await until(() => h.w.DT.moduleOn("messaging.voice") === false);
  });

  it("other upload refusals keep a precise reason (size, type, store, offline) and do not re-read the map", async () => {
    const h = await boot();
    const before = moduleGets(h);
    const cases: Array<[Reply, string, RegExp]> = [
      [{ status: 400, body: { error: "too_large" } }, "scan.pdf", /^scan\.pdf — too large to attach \(8 MB max\)\.$/],
      [{ status: 413, body: { error: "payload_too_large" } }, "scan.pdf", /too large/],
      [{ status: 400, body: { error: "bad_type" } }, "a.exe", /file type can't be attached/],
      [{ status: 503, body: { error: "attachment_store_unavailable" } }, "x.png", /attachment store is unavailable/],
      [{ network: true }, "x.png", /no connection/],
      [{ status: 500, body: { error: "internal" } }, "x.png", /^x\.png — not uploaded; try again\.$/],
    ];
    for (const [reply, name, re] of cases) {
      h.routes.up = (req) => (req.path === "/api/messaging/attachments" ? reply : undefined);
      const err: any = await h.w.DT.actions.uploadAttachment(file(h, name, "application/pdf")).then(() => null, (e: any) => e);
      expect(err.reason.text).toMatch(re);
    }
    await sleep(50);
    expect(moduleGets(h)).toBe(before);
  });

  it("a STAT refused because priority went off re-reads the map, so the STAT/Urgent chips go away", async () => {
    const h = await boot();
    const before = moduleGets(h);
    h.modules = { "messaging.priority": false };
    h.routes.send = refused(/^\/api\/messaging\/send$/, 400);
    const out = await h.w.DT.actions.sendMessage(1, "stale STAT", "stat", []);
    expect(out.ok).toBe(false);
    expect(out.reason.code).toBe("priority_disabled");
    await until(() => moduleGets(h) > before);
    await until(() => h.w.DT.moduleOn("messaging.priority") === false);
  });

  it("a burst of refusals re-reads the module map once; a later refusal re-reads it again", async () => {
    const h = await boot();
    const before = moduleGets(h);
    h.routes.up = refused(/^\/api\/messaging\/attachments$/);
    await Promise.all([1, 2, 3].map((i) => h.w.DT.actions.uploadAttachment(file(h, `f${i}.png`, "image/png")).catch(() => null)));
    await sleep(400);
    expect(moduleGets(h) - before).toBe(1);
    // A different switch flips right after: its refusal is not swallowed.
    h.modules = { "messaging.patientThreads": false };
    h.routes.pt = refused(/^\/api\/messaging\/patient-thread$/);
    await h.w.DT.actions.openPatientThread(7);
    await until(() => moduleGets(h) - before === 2);
    await until(() => h.w.DT.moduleOn("messaging.patientThreads") === false);
  });
});
