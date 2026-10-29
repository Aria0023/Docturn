import { readFileSync } from "node:fs";

/**
 * Shared jsdom harness for the PerfectServe-parity client tests
 * (tests/client-directory.test.ts, tests/client-done.test.ts): the REAL web
 * client (webapp/store.js + webapp/api-bridge.js) against a scripted backend
 * and a fake WebSocket. CLIENT_SRC_ROOT points it at another checkout's
 * webapp/ (e.g. HEAD before a feature, to show the old client failing).
 */
const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom"; // untyped devDependency — loaded dynamically
const { JSDOM } = (await import(jsdomName)) as any;

export const ME = { id: 11, username: "chen", displayName: "Dr. Test Chen", role: "hospitalist", credential: "MD", organizationId: 1 };

export type Req = { method: string; path: string; body: any };
export type Reply = { status: number; body?: any } | { network: true };
export type Route = (req: Req) => Reply | undefined;

export interface Harness {
  w: any;
  reqs: Req[];
  routes: Record<string, Route>;
  modules: Record<string, boolean>;
  convos: any[];
  sockets: any[];
  user: any;
  state(): any;
  close(): void;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until(pred: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting");
    await sleep(10);
  }
}

const open: Harness[] = [];
export function closeAll() {
  while (open.length) open.pop()!.close();
}

export async function boot(opts: { modules?: Record<string, boolean>; convos?: any[] } = {}): Promise<Harness> {
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const h: Harness = {
    w, reqs: [], routes: {}, modules: { ...(opts.modules || {}) }, convos: opts.convos || [], sockets: [], user: ME,
    state: () => w.DT.getState(),
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  open.push(h);
  const respond = (req: Req): Reply => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return h.user ? { status: 200, body: h.user } : { status: 401, body: null };
    if (p === "/api/session") return { status: 200, body: h.user ? { authenticated: true, user: h.user } : { authenticated: false } };
    if (p === "/api/logout") { h.user = null; return { status: 200, body: { ok: true } }; }
    if (p === "/api/config") return { status: 200, body: { syntheticData: false } };
    if (p === "/api/modules") return { status: 200, body: { modules: { ...h.modules }, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: {} } };
    if (p === "/api/presence") return { status: 200, body: { live: true, online: [] } };
    if (p === "/api/messaging/conversations" && req.method === "GET") return { status: 200, body: h.convos };
    if (/^\/api\/messaging\/conversations\/\d+\/messages/.test(p)) return { status: 200, body: [] };
    if (req.method !== "GET") return { status: 204 };
    return { status: 200, body: [] };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    h.reqs.push(req);
    const r = respond(req);
    if ("network" in r) return Promise.reject(new w.TypeError("Failed to fetch"));
    const text = r.body === undefined || r.body === null ? "" : JSON.stringify(r.body);
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, statusText: "", text: () => Promise.resolve(text), json: () => Promise.resolve(r.body), headers: { get: () => "application/json" } });
  };
  class FakeWS {
    url: string; readyState = 0; sent: string[] = [];
    onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
    constructor(url: string) { this.url = url; h.sockets.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.({}); } }, 0); }
    send(d: string) { this.sent.push(d); }
    close(code = 1000, reason = "") { if (this.readyState === 3) return; this.readyState = 3; const cb = this.onclose; setTimeout(() => cb?.({ code, reason }), 0); }
    emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  }
  w.WebSocket = FakeWS;
  w.console.log = () => {};
  w.console.warn = () => {};
  w.console.error = () => {};
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  await until(() => h.sockets.length >= 1 && !!w.DT.getState().session);
  h.sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: ME.id });
  await until(() => !!w.DT.getState().modules);
  await sleep(50);
  return h;
}

export const count = (h: Harness, method: string, path: string | RegExp) =>
  h.reqs.filter((r) => r.method === method && (typeof path === "string" ? r.path === path : path.test(r.path))).length;
