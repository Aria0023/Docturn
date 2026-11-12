import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Settings → Assignment & rotation (webapp/api-bridge.js setSetting), the REAL
 * web client in jsdom against a scripted backend.
 *
 * The STAT SMS fallback switch, auto-reassign and the assignment timeout are
 * org settings the SERVER owns. The client used to apply every change locally
 * and swallow the server's refusal (`.catch(function () {})`), so an ER
 * director (403) — or a director typing an out-of-range timeout — saw a value
 * on screen that the server was not applying. Now:
 *   - a refused change is rolled back to the value the server holds, and a
 *     toast says why ("Only a director can change this.");
 *   - the timeout field returns to the server's value on an invalid entry or a
 *     refused save, and remembers each value the server accepted.
 */

const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom";
const { JSDOM } = (await import(jsdomName)) as any;

type Req = { method: string; path: string; body: any };
type Reply = { status: number; body?: any };
type Route = (req: Req) => Reply | undefined;

interface Harness {
  w: any;
  reqs: Req[];
  routes: Record<string, Route>;
  org: { assignmentTimeoutMin: number; statSmsFallback: boolean; autoReassignOnDecline: boolean };
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

async function boot(role: "director" | "er_director"): Promise<Harness> {
  const me = { id: role === "director" ? 2 : 3, username: role === "director" ? "director" : "er.director", displayName: "Dr. Test", role, credential: "MD", organizationId: 1 };
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const h: Harness = {
    w, reqs, routes: {},
    org: { assignmentTimeoutMin: 15, statSmsFallback: true, autoReassignOnDecline: false },
    state: () => w.DT.getState(),
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  const respond = (req: Req): Reply => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: me };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user: me } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: true } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: { ...h.org } } };
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
  await until(() => w.DT.getState().settings && w.DT.getState().settings.timeout === 15 && w.DT.getState().settings.statSmsFallback === true);
  await sleep(30);
  return h;
}

const forbidden = (path: string): Route => (req) => (req.path === path && req.method === "PATCH" ? { status: 403, body: { error: "forbidden" } } : undefined);
const patches = (h: Harness, path: string) => h.reqs.filter((r) => r.method === "PATCH" && r.path === path);

describe("Settings: a refused org-setting change never stays on screen", () => {
  it("ER director flips STAT SMS fallback → 403 → switch returns to the server's value with a reason", async () => {
    const h = await boot("er_director");
    h.routes.settings = forbidden("/api/settings/org");
    h.w.DT.actions.setSetting("statSmsFallback", false);
    // Optimistic first …
    expect(h.state().settings.statSmsFallback).toBe(false);
    await until(() => patches(h, "/api/settings/org").length === 1);
    // … then rolled back once the server says no.
    await until(() => h.state().settings.statSmsFallback === true);
    const toast = h.state().__toast;
    expect(toast).toMatchObject({ tone: "rejected", title: "Not saved" });
    expect(toast.msg).toBe("Only a director can change this.");
  });

  it("auto-reassign: a failed save (500) is rolled back too", async () => {
    const h = await boot("director");
    h.routes.settings = (req) => (req.path === "/api/settings/org" && req.method === "PATCH" ? { status: 500, body: { error: "internal_error" } } : undefined);
    h.w.DT.actions.setSetting("autoReassign", true);
    await until(() => patches(h, "/api/settings/org").length === 1);
    await until(() => h.state().settings.autoReassign === false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Not saved", msg: "Try again." });
  });

  it("a director's accepted change stays", async () => {
    const h = await boot("director");
    h.w.DT.actions.setSetting("statSmsFallback", false);
    await until(() => patches(h, "/api/settings/org").length === 1);
    await sleep(50);
    expect(h.state().settings.statSmsFallback).toBe(false);
    expect(patches(h, "/api/settings/org")[0]!.body).toEqual({ key: "statSmsFallback", value: false });
  });
});

describe("Settings: the assignment timeout field shows what the server holds", () => {
  it("refused save (ER director, 403) → field returns to the server's 15", async () => {
    const h = await boot("er_director");
    h.routes.cfg = forbidden("/api/org/config");
    h.w.DT.actions.setSetting("timeout", 33);
    expect(h.state().settings.timeout).toBe(33); // what the user typed, while it saves
    await until(() => patches(h, "/api/org/config").length === 1);
    await until(() => h.state().settings.timeout === 15);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Timeout not saved", msg: "Only a director can change it." });
  });

  it("out-of-range entry → nothing sent, field returns to the last value the server accepted", async () => {
    const h = await boot("director");
    h.w.DT.actions.setSetting("timeout", 27);
    await until(() => patches(h, "/api/org/config").length === 1);
    await until(() => h.state().__toast && h.state().__toast.title === "Assignment timeout saved");
    expect(h.state().settings.timeout).toBe(27);
    h.w.DT.actions.setSetting("timeout", 0);
    await until(() => h.state().__toast && h.state().__toast.title === "Timeout not saved");
    expect(h.state().__toast.msg).toBe("Enter 1–120 minutes.");
    expect(h.state().settings.timeout).toBe(27);
    expect(patches(h, "/api/org/config")).toHaveLength(1);
  });
});
