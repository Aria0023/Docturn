import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * A.CON-SHO-23 / A.CON-SHO-37 (client half) — the REAL web client
 * (webapp/store.js + webapp/api-bridge.js) in jsdom against a scripted backend.
 *
 * The director's Settings → Organization "Message retention" card writes
 * messageRetentionDays. The toast it shows after a save must be the SERVER's
 * word (the PATCH answers with what the sweep will actually do), never a
 * promise the client makes up:
 *   - ops.retention off → the server refuses a new window (404
 *     module_disabled); the client says the purge is switched off, puts the
 *     previous value back, and re-reads the module map;
 *   - a window the server stored but does not enforce is never toasted as
 *     "auto-delete";
 *   - a window under the recommended floor says so.
 * The card itself (module-off notice, options) is measured in Chromium by
 * scripts/retention-card-check.mjs.
 */

const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom"; // untyped devDependency — loaded dynamically
const { JSDOM } = (await import(jsdomName)) as any;

const DIRECTOR = { id: 21, username: "director", displayName: "Dr. Director", role: "director", credential: "MD" };

type Req = { method: string; path: string; body: any };
type Reply = { status: number; body?: any };
type Route = (req: Req) => Reply | undefined;

interface Harness {
  w: any;
  reqs: Req[];
  routes: Record<string, Route>;
  modules: Record<string, boolean>;
  settingsOrg: Record<string, unknown>;
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

const retention = (days: number, moduleEnabled: boolean) => ({
  days, moduleEnabled, enforced: days > 0 && moduleEnabled,
  minimumRecommendedDays: 7, belowRecommendedFloor: days > 0 && days < 7,
});

async function boot(org: Record<string, unknown>, modules: Record<string, boolean> = {}): Promise<Harness> {
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const h: Harness = {
    w, reqs, routes: {}, modules: { ...modules }, settingsOrg: org,
    state: () => w.DT.getState(),
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  const respond = (req: Req): Reply => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: DIRECTOR };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user: DIRECTOR } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: true } };
    if (p === "/api/modules") return { status: 200, body: { modules: { ...h.modules }, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: { ...h.settingsOrg } } };
    if (req.method !== "GET") return { status: 204 };
    return { status: 200, body: [] };
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
    send() { /* ignore */ }
    close(code = 1000, reason = "") { if (this.readyState === 3) return; this.readyState = 3; const cb = this.onclose; setTimeout(() => cb?.({ code, reason }), 0); }
    emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  }
  w.WebSocket = FakeWS;
  w.console.log = () => {};
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  await until(() => sockets.length >= 1 && !!w.DT.getState().session);
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: DIRECTOR.id });
  await until(() => !!w.DT.getState().modules);
  await until(() => reqs.some((r) => r.path === "/api/settings"));
  await sleep(50);
  return h;
}
const moduleGets = (h: Harness) => h.reqs.filter((r) => r.method === "GET" && r.path === "/api/modules").length;
const patchRoute = (reply: Reply): Route => (req) =>
  req.method === "PATCH" && req.path === "/api/settings/org" && req.body?.key === "messageRetentionDays" ? reply : undefined;

describe("web client: message retention card actions tell the server's truth", () => {
  it("hydrates the server's retention status (window, module switch, enforced) from GET /api/settings", async () => {
    const h = await boot({ messageRetentionDays: 30, messageRetention: retention(30, false) }, { "ops.retention": false });
    expect(h.state().orgRetentionDays).toBe(30);
    expect(h.state().orgRetention).toMatchObject({ days: 30, moduleEnabled: false, enforced: false });
  });

  it("a saved, enforced window: the toast describes the hourly purge, from the PATCH answer", async () => {
    const h = await boot({ messageRetentionDays: 0, messageRetention: retention(0, true) });
    h.routes.patch = patchRoute({ status: 200, body: { ok: true, retention: retention(90, true) } });
    await h.w.DT.actions.setOrgRetention(90);
    const t = h.state().__toast;
    expect(t.tone).toBe("accepted");
    expect(t.title).toBe("Retention updated");
    expect(t.msg).toMatch(/older than 90 days are permanently deleted/);
    expect(h.state().orgRetentionDays).toBe(90);
    expect(h.state().orgRetention).toMatchObject({ days: 90, enforced: true });
  });

  it("ops.retention off: a refused window says the purge is switched off, restores the old value, re-reads the module map", async () => {
    const h = await boot({ messageRetentionDays: 0, messageRetention: retention(0, true) });
    const before = moduleGets(h);
    h.modules = { "ops.retention": false }; // flipped after this page loaded
    h.routes.patch = patchRoute({ status: 404, body: { error: "module_disabled", module: "ops.retention" } });
    await h.w.DT.actions.setOrgRetention(30);
    const t = h.state().__toast;
    expect(t.tone).toBe("rejected");
    expect(t.title).toBe("Not saved");
    expect(t.msg).toMatch(/message retention purge is switched off/i);
    expect(t.msg).not.toMatch(/auto-delete/);
    expect(h.state().orgRetentionDays).toBe(0);
    await until(() => moduleGets(h) > before);
    await until(() => h.w.DT.moduleOn("ops.retention") === false);
  });

  it("a window the server stored but does NOT enforce is never toasted as auto-delete", async () => {
    const h = await boot({ messageRetentionDays: 0, messageRetention: retention(0, true) });
    h.routes.patch = patchRoute({ status: 200, body: { ok: true, retention: retention(30, false) } });
    await h.w.DT.actions.setOrgRetention(30);
    const t = h.state().__toast;
    expect(t.title).toBe("Saved — not enforced");
    expect(t.msg).toMatch(/switched off/);
    expect(t.msg).toMatch(/nothing is deleted/);
    expect(t.msg).not.toMatch(/auto-delete|permanently deleted/);
    expect(h.state().orgRetention).toMatchObject({ days: 30, enforced: false });
  });

  it("clearing the window ('Keep everything') with the purge off is allowed and says messages are kept", async () => {
    const h = await boot({ messageRetentionDays: 30, messageRetention: retention(30, false) }, { "ops.retention": false });
    h.routes.patch = patchRoute({ status: 200, body: { ok: true, retention: retention(0, false) } });
    await h.w.DT.actions.setOrgRetention(0);
    expect(h.state().__toast.msg).toBe("Messages are kept indefinitely.");
    expect(h.state().orgRetentionDays).toBe(0);
  });

  it("a window under the 7-day floor is saved but the toast flags it", async () => {
    const h = await boot({ messageRetentionDays: 30, messageRetention: retention(30, true) });
    h.routes.patch = patchRoute({ status: 200, body: { ok: true, retention: retention(3, true) } });
    await h.w.DT.actions.setOrgRetention(3);
    const t = h.state().__toast;
    expect(t.msg).toMatch(/older than 3 days are permanently deleted/);
    expect(t.msg).toMatch(/below the 7-day minimum/);
  });

  it("any other failure restores the previous value and does not re-read the module map", async () => {
    const h = await boot({ messageRetentionDays: 90, messageRetention: retention(90, true) });
    const before = moduleGets(h);
    h.routes.patch = patchRoute({ status: 500, body: { error: "internal_error" } });
    await h.w.DT.actions.setOrgRetention(30);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Not saved", msg: "Couldn't update retention." });
    expect(h.state().orgRetentionDays).toBe(90);
    await sleep(250);
    expect(moduleGets(h)).toBe(before);
  });
});
