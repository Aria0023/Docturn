import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The REAL web client (webapp/store.js + webapp/api-bridge.js) in jsdom with a
 * scripted backend and a fake WebSocket: "Next up" (Director card, ER Quick
 * hint, hospitalist chip — all read state.rotation via DT.nextUp /
 * DT.rotationQueue) must follow the server after anything that moves it, in
 * the session that made the change AND in every other open session
 * (A.CON-SHO-29, live half):
 *
 *  - Reset rotation re-reads GET /api/rotation/next after the reset is
 *    accepted, names the post-reset provider, and says so when the server
 *    refuses (no success toast for a reset that did not happen).
 *  - A ROTATION_UPDATED frame (another director reset the cursor, took
 *    someone off shift, changed a cap, …) re-reads Next up — one fetch for a
 *    burst of frames.
 *  - The Director's rotation inputs that used to be local-only (Rotation/Off
 *    toggle, shift selector, drag reorder, Apply-to-all cap, All on/off shift)
 *    write to the server and then re-read it.
 */

const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom";
const { JSDOM } = (await import(jsdomName)) as any;

const DIRECTOR = { id: 1, username: "director", displayName: "Dr. Dana Director", role: "director" };
const ER = { id: 2, username: "er.doc", displayName: "Dr. Erin Reyes", role: "er_doctor", credential: "MD" };
const NAMES: Record<number, string> = { 1: "Dr. Nathan Alyesh", 2: "Dr. Sharon George", 3: "Dr. Amir Ahmed", 4: "Dr. Joline Darouichi" };

type Req = { method: string; path: string; body: any };
type Hosp = { id: number; userId: number; specialty: string; currentPatientCount: number; patientCap: number; rotationOrder: number; working: boolean; shiftType: string; inRotation: boolean };

interface Harness {
  w: any;
  reqs: Req[];
  sockets: any[];
  hosps: Hosp[];
  /** The server's current sequential cursor (drives GET /api/rotation/next). */
  server: { cursor: number; mode: string; resetStatus: number };
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

async function boot(user: any): Promise<Harness> {
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const hosps: Hosp[] = [1, 2, 3, 4].map((id) => ({
    id, userId: 100 + id, specialty: "Hospital Medicine", currentPatientCount: 6, patientCap: 12,
    rotationOrder: id - 1, working: true, shiftType: "day", inRotation: true,
  }));
  const server = { cursor: 2, mode: "sequential", resetStatus: 200 };
  const h: Harness = { w, reqs, sockets, hosps, server, state: () => w.DT.getState(), close: () => { try { w.close(); } catch { /* ignore */ } } };
  harnesses.push(h);
  // Sequential planner over the routable pool (working, in rotation, day/night, census < cap).
  const preview = () => {
    const pool = hosps.filter((x) => x.working && x.inRotation && ["day", "night"].includes(x.shiftType) && x.currentPatientCount < x.patientCap)
      .sort((a, b) => a.rotationOrder - b.rotationOrder || a.id - b.id);
    const start = pool.length ? server.cursor % pool.length : 0;
    const order = [...pool.slice(start), ...pool.slice(0, start)];
    const n = order[0];
    return {
      mode: server.mode, shiftTypes: ["day", "night"], capRelief: false,
      next: n ? { hospitalistId: n.id, userId: n.userId, displayName: NAMES[n.id], specialty: n.specialty, shiftType: n.shiftType, census: n.currentPatientCount, cap: n.patientCap } : null,
      order: order.map((x) => x.id),
    };
  };
  const respond = (req: Req): { status: number; body?: any } => {
    const p = req.path.split("?")[0]!;
    let m: RegExpExecArray | null;
    if (p === "/api/user") return { status: 200, body: user };
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: true } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: {} } };
    // Like storage.listHospitalists: rotation order, then id.
    if (p === "/api/hospitalists" && req.method === "GET") return { status: 200, body: [...hosps].sort((a, b) => a.rotationOrder - b.rotationOrder || a.id - b.id).map((x) => ({ ...x })) };
    if (p === "/api/physicians/directory") return { status: 200, body: hosps.map((x) => ({ id: x.id, userId: x.userId, displayName: NAMES[x.id], credential: "MD", specialty: x.specialty, working: x.working, shiftType: x.shiftType })) };
    if (p === "/api/rotation/next") return { status: 200, body: preview() };
    if (p === "/api/round-robin/reset" && req.method === "POST") {
      if (server.resetStatus !== 200) return { status: server.resetStatus, body: { error: "forbidden" } };
      server.cursor = 0;
      return { status: 200, body: { ok: true } };
    }
    if ((m = /^\/api\/hospitalists\/(\d+)\/rotation$/.exec(p)) && req.method === "PATCH") {
      const x = hosps.find((y) => y.id === Number(m![1]))!; x.inRotation = req.body.inRotation; return { status: 200, body: x };
    }
    if ((m = /^\/api\/hospitalists\/(\d+)\/shift$/.exec(p)) && req.method === "PATCH") {
      const x = hosps.find((y) => y.id === Number(m![1]))!; x.shiftType = req.body.shiftType; return { status: 200, body: x };
    }
    if ((m = /^\/api\/hospitalists\/(\d+)\/working-status$/.exec(p)) && req.method === "PATCH") {
      const x = hosps.find((y) => y.id === Number(m![1]))!; x.working = req.body.working; return { status: 200, body: x };
    }
    if (p === "/api/hospitalists/working-status" && req.method === "PATCH") { hosps.forEach((x) => { x.working = req.body.all; }); return { status: 200, body: { ok: true } }; }
    if (p === "/api/physicians/capacity" && req.method === "PATCH") { hosps.forEach((x) => { x.patientCap = req.body.patientCap; }); return { status: 200, body: { ok: true } }; }
    if (p === "/api/hospitalists/rotation-order" && req.method === "PATCH") {
      (req.body.order as number[]).forEach((id, i) => { const x = hosps.find((y) => y.id === id); if (x) x.rotationOrder = i; });
      return { status: 200, body: hosps };
    }
    if (req.method !== "GET") return { status: 204 };
    return { status: 200, body: [] };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(req);
    const r = respond(req);
    const text = r.body === undefined ? "" : JSON.stringify(r.body);
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, statusText: "", text: () => Promise.resolve(text), headers: { get: (k: string) => (String(k).toLowerCase() === "content-type" ? "application/json" : null) } });
  };
  class FakeWS {
    url: string; readyState = 0; sent: string[] = [];
    onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
    constructor(url: string) { this.url = url; sockets.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.({}); } }, 0); }
    send(d: string) { this.sent.push(d); }
    close() { this.readyState = 3; }
    emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  }
  w.WebSocket = FakeWS;
  w.console.log = () => {};
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  await until(() => sockets.length >= 1 && !!w.DT.getState().session);
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: user.id });
  await until(() => { const r = w.DT.getState().rotation; return !!(r && r.source === "server"); });
  await sleep(50);
  return h;
}
const rotationGets = (h: Harness) => h.reqs.filter((r) => r.method === "GET" && r.path.startsWith("/api/rotation/next"));
const nextId = (h: Harness) => { const n = h.w.DT.nextUp(); return n ? n.id : null; };

describe("web client 'Next up' stays live (jsdom, real store.js + api-bridge.js) — A.CON-SHO-29", () => {
  it("Reset rotation re-reads the planner: Next up becomes the post-reset provider and the toast names them", async () => {
    const h = await boot(DIRECTOR);
    expect(nextId(h)).toBe("h3"); // cursor 2 → Dr. Amir Ahmed
    h.reqs.length = 0;
    h.w.DT.actions.resetRotation();
    await until(() => nextId(h) === "h1");
    const posts = h.reqs.findIndex((r) => r.method === "POST" && r.path === "/api/round-robin/reset");
    const reread = h.reqs.findIndex((r, i) => i > posts && r.method === "GET" && r.path.startsWith("/api/rotation/next"));
    expect(posts).toBeGreaterThanOrEqual(0);
    expect(reread).toBeGreaterThan(posts);
    expect(h.w.DT.rotationQueue().map((p: any) => p.id)).toEqual(["h1", "h2", "h3", "h4"]);
    await until(() => /Alyesh/.test(String(h.state().__toast && h.state().__toast.msg)));
    expect(h.state().__toast).toMatchObject({ tone: "accepted", title: "Rotation index reset" });
  });

  it("a refused reset says so and keeps the (still true) Next up", async () => {
    const h = await boot(DIRECTOR);
    h.server.resetStatus = 403;
    h.w.DT.actions.resetRotation();
    await until(() => !!(h.state().__toast && h.state().__toast.tone === "rejected"));
    expect(h.state().__toast.title).toMatch(/Couldn't reset rotation/);
    expect(nextId(h)).toBe("h3");
  });

  it("ROTATION_UPDATED from another session re-reads Next up — once for a burst", async () => {
    const h = await boot(ER);
    expect(nextId(h)).toBe("h3");
    // Another director resets the cursor; the server announces it.
    h.server.cursor = 0;
    const before = rotationGets(h).length;
    h.sockets[0].emit({ type: "ROTATION_UPDATED" });
    h.sockets[0].emit({ type: "ROTATION_UPDATED" });
    h.sockets[0].emit({ type: "ROTATION_UPDATED" });
    await until(() => nextId(h) === "h1");
    await sleep(600);
    expect(rotationGets(h).length - before).toBe(1);
    // …and someone takes the new next-up off shift elsewhere.
    h.hosps[0]!.working = false;
    h.sockets[0].emit({ type: "ROTATION_UPDATED" });
    await until(() => nextId(h) === "h2");
    expect(h.state().providers.find((p: any) => p.id === "h1").working).toBe(false);
  });

  it("the Director's Rotation/Off toggle, shift selector, reorder, Apply-to-all cap and All on/off write to the server, then re-read it", async () => {
    const h = await boot(DIRECTOR);
    const a = h.w.DT.actions;
    const writes = () => h.reqs.filter((r) => r.method === "PATCH").map((r) => [r.path, r.body]);
    const queue = () => h.w.DT.rotationQueue().map((p: any) => p.id);

    h.reqs.length = 0;
    a.toggleRotation("h3");
    // The row flips at once (preview); the queue follows the server's re-read.
    expect(h.state().providers.find((p: any) => p.id === "h3").inRotation).toBe(false);
    await until(() => rotationGets(h).length >= 1 && !queue().includes("h3"));
    expect(writes()).toEqual([["/api/hospitalists/3/rotation", { inRotation: false }]]);
    expect(h.hosps.find((x) => x.id === 3)!.inRotation).toBe(false);

    h.reqs.length = 0;
    a.setShiftFor("h2", "swing");
    await until(() => rotationGets(h).length >= 1 && !queue().includes("h2"));
    expect(writes()).toEqual([["/api/hospitalists/2/shift", { shiftType: "swing" }]]);
    expect(h.state().providers.find((p: any) => p.id === "h2").shift).toBe("swing");

    h.reqs.length = 0;
    a.reorderProviders("h4", "h1");
    await until(() => h.state().providers[0].id === "h4");
    expect(writes()).toEqual([["/api/hospitalists/rotation-order", { order: [4, 1, 2, 3] }]]);
    expect(h.state().providers.map((p: any) => p.id)).toEqual(["h4", "h1", "h2", "h3"]);

    h.reqs.length = 0;
    a.setAllCap(6); // everyone is at 6 → nobody has room
    await until(() => h.state().providers.every((p: any) => p.cap === 6));
    expect(writes()).toEqual([["/api/physicians/capacity", { patientCap: 6 }]]);

    h.reqs.length = 0;
    a.bulkWorking(false);
    await until(() => h.state().providers.every((p: any) => p.working === false));
    expect(writes()).toEqual([["/api/hospitalists/working-status", { all: false }]]);
    expect(h.w.DT.nextUp()).toBeNull();
  });

  it("maps the server's inRotation onto the roster", async () => {
    const h = await boot(DIRECTOR);
    h.hosps[1]!.inRotation = false;
    h.sockets[0].emit({ type: "ROTATION_UPDATED" });
    await until(() => h.state().providers.find((p: any) => p.id === "h2").inRotation === false);
    expect(h.state().providers.find((p: any) => p.id === "h1").inRotation).toBe(true);
  });
});
