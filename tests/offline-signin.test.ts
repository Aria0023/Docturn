import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Offline sign-in on the REAL web client (webapp/store.js + api-bridge.js in
 * jsdom) — A.CON-MIN-9, the residual of A.CON-LAU-18.
 *
 * When the server cannot be reached, a sign-in used to fall back to the kit's
 * local demo login (a signed-in shell of FABRICATED patients) whenever the
 * store's `syntheticData` flag was on. That flag defaults to ON and lives in the
 * persisted snapshot that sign-out purges, so an installed app relaunched
 * offline after a sign-out (the OS discards a backgrounded PWA without an
 * unload) believed it was a demo — on a real-PHI deployment too. Measured in
 * Chromium before the fix: offline relaunch → any password → a session named
 * "Dr. Jordan Chen" from the demo seed.
 *
 * The demo fallback now requires the SERVER to have said syntheticData:true
 * during this page load; otherwise an offline sign-in stays on the sign-in
 * screen with "Can't reach the server".
 *
 * The same class of fake success existed inside a REAL session that loses its
 * connection: an ER admission sent offline stayed on the sent board with
 * "Assignment sent to …", and a broadcast fell back to the kit's local copy —
 * nothing had reached the server and nobody was notified. Those optimistic
 * results are now kept only inside the labelled local demo.
 */

const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom"; // untyped devDependency — loaded dynamically
const { JSDOM } = (await import(jsdomName)) as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const windows: any[] = [];
afterEach(() => { while (windows.length) { try { windows.pop().close(); } catch { /* ignore */ } } });

/**
 * Boot the client. `config` is what GET /api/config answers while the server is
 * reachable (undefined = the server is unreachable from the very first request,
 * i.e. an offline launch of the cached shell).
 */
const ER_DOC = { id: 21, username: "er.doc", displayName: "Dr. Erin Reyes", role: "er_doctor", credential: "MD" };

async function boot(config?: { syntheticData: boolean }) {
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  windows.push(w);
  const net = { online: config !== undefined, posts: 0, signedIn: false };
  w.fetch = (url: string, init: any = {}) => {
    if (!net.online) return Promise.reject(new TypeError("Failed to fetch"));
    const path = new URL(url, "https://app.test/").pathname;
    const method = (init.method || "GET").toUpperCase();
    if (method !== "GET") net.posts++;
    let status = 200;
    let body: any = [];
    if (path === "/api/config") body = config;
    else if (path === "/api/login" && method === "POST") { net.signedIn = true; body = { ok: true }; }
    else if (path === "/api/user") { if (net.signedIn) body = ER_DOC; else { status = 401; body = null; } }
    else if (path === "/api/modules") body = { modules: {}, registry: [] };
    else if (path === "/api/settings") body = { me: { dnd: false }, org: {} };
    else if (method !== "GET") { status = 204; body = null; }
    const text = body == null ? "" : JSON.stringify(body);
    return Promise.resolve({ status, ok: status < 300, statusText: "", text: () => Promise.resolve(text), json: () => Promise.resolve(body), headers: { get: () => "application/json" } });
  };
  w.WebSocket = class { readyState = 0; onopen: any; onclose: any; onmessage: any; onerror: any; send() {} close() {} };
  w.console.log = () => {};
  w.console.error = () => {};
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  await sleep(50); // /api/config and the restore probe settle
  return { w, net, state: () => w.DT.getState() };
}

async function signInOffline(h: Awaited<ReturnType<typeof boot>>) {
  h.net.online = false;
  await h.w.DT.actions.login("hospitalist", "DOCTURN", "dev", "anything-at-all");
  await sleep(20);
}

describe("offline sign-in never fabricates a signed-in session unless the server said 'synthetic'", () => {
  it("cold offline launch (flag at its default, nothing from the server): stays signed out with a connection error", async () => {
    const h = await boot(undefined);
    expect(h.state().syntheticData).toBe(true); // the store's default — not evidence of anything
    await signInOffline(h);
    expect(h.state().session).toBeNull();
    expect(h.state().loginError).toMatch(/can't reach the server/i);
    expect((h.state().__toast || {}).title).not.toMatch(/demo mode/i);
  });

  it("real-PHI server (syntheticData:false) then offline: stays signed out", async () => {
    const h = await boot({ syntheticData: false });
    expect(h.state().syntheticData).toBe(false);
    await signInOffline(h);
    expect(h.state().session).toBeNull();
    expect(h.state().loginError).toMatch(/can't reach the server/i);
  });

  it("synthetic server (syntheticData:true) then offline: the labelled local demo is still available", async () => {
    const h = await boot({ syntheticData: true });
    await signInOffline(h);
    expect(h.state().session).toBeTruthy();
    expect((h.state().__toast || {}).title).toMatch(/offline — demo mode/i);
  });

  it("a REAL session that loses its connection: an admission sent offline is not shown as sent", async () => {
    const h = await boot({ syntheticData: true });
    await h.w.DT.actions.login("er_doctor", "ISPN", "er.doc", "docturn");
    await sleep(50);
    expect(h.state().session).toMatchObject({ role: "er_doctor", user: "er.doc" });
    h.net.online = false;
    h.w.DT.actions.sendAssignment({ id: 1, name: "Dr. Test" }, { initials: "QZ", room: "4", complaint: "cp", specialty: "Cardiology" }, []);
    await sleep(50);
    expect((h.state().sent || []).some((x: any) => x.initials === "QZ")).toBe(false);
    expect((h.state().admissions || []).some((x: any) => x.initials === "QZ")).toBe(false);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Couldn't send assignment" });
    expect(h.state().__toast.msg).toMatch(/NOT sent/);
  });

  it("a REAL session that loses its connection: a broadcast sent offline is reported as not delivered", async () => {
    const h = await boot({ syntheticData: true });
    await h.w.DT.actions.login("er_doctor", "ISPN", "er.doc", "docturn");
    await sleep(50);
    const before = (h.state().broadcasts || []).length;
    h.net.online = false;
    await h.w.DT.actions.sendBroadcast({ title: "Code drill", message: "test", severity: "critical" });
    await sleep(20);
    expect((h.state().broadcasts || []).length).toBe(before);
    expect(h.state().__toast).toMatchObject({ tone: "rejected", title: "Broadcast not delivered" });
    expect(h.state().__toast.msg).toMatch(/nobody was alerted/i);
  });

  it("inside the labelled LOCAL demo the optimistic admission stays (the demo remains explorable)", async () => {
    const h = await boot({ syntheticData: true });
    await signInOffline(h);
    h.w.DT.actions.sendAssignment({ id: 1, name: "Dr. Test" }, { initials: "QD", room: "4", complaint: "cp", specialty: "Cardiology" }, []);
    await sleep(50);
    expect((h.state().sent || []).some((x: any) => x.initials === "QD")).toBe(true);
  });

  it("the demo role switcher is gated the same way: offline + no server confirmation → no local role flip", async () => {
    const h = await boot(undefined);
    const before = h.state().session;
    h.w.DT.actions.setRole("director");
    await sleep(30);
    expect(h.state().session).toEqual(before);
    expect((h.state().__toast || {}).title || "").toMatch(/could not switch role/i);
  });
});
