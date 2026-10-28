import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The live client (store.js + api-bridge.js) never shows the design kit's demo
 * clinical rows — not before the server answers, not when a read fails, and
 * not after a sign-out re-seeds the store for the next person.
 *
 * store.js seeds demo providers, board rows, ER "sent" rows, incoming requests
 * and a census so the offline design kit has something to render. Before this
 * fix those seeds stayed in a live page: a hydrate whose /api/hospitalists,
 * /api/patient-board or /api/assignments/sent read failed left them on screen
 * as if they were the org's (fabricated patients — initials, rooms,
 * complaints — and doctors offered as routing targets). Sign-out re-seeded
 * them too, and kept the previous org's provider roster for the next user.
 *
 * The labelled local demo (server said syntheticData:true, then went
 * unreachable) still gets the demo rows: that is the one place they belong.
 */

const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom"; // untyped devDependency — loaded dynamically
const { JSDOM } = (await import(jsdomName)) as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const windows: any[] = [];
afterEach(() => { while (windows.length) { try { windows.pop().close(); } catch { /* ignore */ } } });

// Every name, complaint and initials pair the kit seeds (store.js seed()).
const DEMO = /Sarah Chen|Amir Patel|Maria Lopez|Nina Roy|Omar Haddad|James Liu|Jordan Chen|Dr\. Reyes|Dr\. Osei|Dr\. Okafor|Acute abdominal pain|Diabetic ketoacidosis|CHF exacerbation|Community-acquired pneumonia|Chest pain|Septic shock|AKI on CKD|NSTEMI|COPD exacerbation|Syncope, workup|GI bleed|Sepsis, source unclear/;
const CLINICAL = ["providers", "board", "sent", "pending", "myPatients", "myAdmissions"];

const ER_DOC = { id: 21, username: "er.doc", displayName: "Dr. Erin Vale", role: "er_doctor", credential: "MD", organizationId: 7 };
const HOSP = { id: 22, username: "hosp", displayName: "Dr. Hal Brook", role: "hospitalist", credential: "MD", organizationId: 8 };
const ORG_A_HOSPS = [{ id: 1, userId: 31, working: true, shiftType: "day", census: 2, cap: 12, specialty: "Hospital Medicine", inRotation: true }];
const ORG_A_DIR = [{ userId: 31, displayName: "Dr. Ada Prior", credential: "MD", specialty: "Hospital Medicine", working: true, shiftType: "day" }];

type Net = { online: boolean; user: any; failClinical: boolean; orgA: boolean };

async function boot(config: { syntheticData: boolean } | undefined) {
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  windows.push(w);
  const net: Net = { online: config !== undefined, user: null, failClinical: true, orgA: false };
  w.fetch = (url: string, init: any = {}) => {
    if (!net.online) return Promise.reject(new TypeError("Failed to fetch"));
    const path = new URL(url, "https://app.test/").pathname;
    const method = (init.method || "GET").toUpperCase();
    let status = 200;
    let body: any = [];
    if (path === "/api/config") body = config;
    else if (path === "/api/login" && method === "POST") {
      const sent = JSON.parse(init.body || "{}");
      net.user = sent.username === "hosp" ? HOSP : ER_DOC;
      body = { ok: true, user: net.user };
    } else if (path === "/api/logout") { net.user = null; body = { ok: true }; }
    else if (path === "/api/user") { if (net.user) body = net.user; else { status = 401; body = null; } }
    else if (path === "/api/session") body = net.user ? { authenticated: true, user: net.user } : { authenticated: false };
    else if (path === "/api/modules") body = { modules: {}, registry: [] };
    else if (path === "/api/settings") body = { me: { dnd: false }, org: {} };
    else if (net.orgA && path === "/api/hospitalists") body = ORG_A_HOSPS;
    else if (net.orgA && path === "/api/physicians/directory") body = ORG_A_DIR;
    else if (net.failClinical && /^\/api\/(hospitalists|physicians\/directory|patient-board|assignments\/(sent|pending|my)|patients)$/.test(path)) { status = 503; body = { message: "unavailable" }; }
    else if (method !== "GET") { status = 204; body = null; }
    const text = body == null ? "" : JSON.stringify(body);
    return Promise.resolve({ status, ok: status < 300, statusText: "", text: () => Promise.resolve(text), json: () => Promise.resolve(body), headers: { get: () => "application/json" } });
  };
  w.WebSocket = class { readyState = 0; onopen: any; onclose: any; onmessage: any; onerror: any; send() {} close() {} };
  w.console.log = () => {};
  w.console.error = () => {};
  w.console.warn = () => {};
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  await sleep(50);
  return { w, net, state: () => w.DT.getState() };
}

function demoRowsIn(state: any): string[] {
  const hits: string[] = [];
  for (const k of CLINICAL) {
    const text = JSON.stringify(state[k] || []);
    const m = text.match(DEMO);
    if (m) hits.push(k + ": " + m[0]);
  }
  if (state.me && DEMO.test(String(state.me.name || ""))) hits.push("me: " + state.me.name);
  return hits;
}

describe("live client: no demo clinical rows", () => {
  it("before anyone signs in, the live page holds no demo providers, patients or requests", async () => {
    const h = await boot({ syntheticData: false });
    expect(demoRowsIn(h.state())).toEqual([]);
    expect(h.state().acceptedToday || 0).toBe(0);
  });

  it("an ER physician whose clinical reads fail sees empty lists, not the kit's demo rows", async () => {
    const h = await boot({ syntheticData: false });
    await h.w.DT.actions.login("er_doctor", "LAKE", "er.doc", "pw-123456789");
    await sleep(80);
    expect(h.state().session).toMatchObject({ role: "er_doctor" });
    expect(demoRowsIn(h.state())).toEqual([]);
    expect(h.state().providers).toEqual([]);
    expect(h.state().board).toEqual([]);
    expect(h.state().sent).toEqual([]);
  });

  it("a hospitalist whose clinical reads fail sees no demo census or incoming requests", async () => {
    const h = await boot({ syntheticData: true }); // even on a synthetic server: live means the server's rows only
    await h.w.DT.actions.login("hospitalist", "LAKE", "hosp", "pw-123456789");
    await sleep(80);
    expect(h.state().session).toMatchObject({ role: "hospitalist" });
    expect(demoRowsIn(h.state())).toEqual([]);
  });

  it("sign-out does not re-seed demo rows, and the next user never inherits the previous org's roster", async () => {
    const h = await boot({ syntheticData: false });
    h.net.orgA = true; // org A's roster reads succeed for the first user
    await h.w.DT.actions.login("er_doctor", "ORGA", "er.doc", "pw-123456789");
    await sleep(80);
    expect(JSON.stringify(h.state().providers)).toMatch(/Ada Prior/);

    await h.w.DT.actions.logout();
    await sleep(30);
    expect(demoRowsIn(h.state())).toEqual([]);
    expect(JSON.stringify(h.state().providers || [])).not.toMatch(/Ada Prior/);

    h.net.orgA = false; // org B's reads fail
    await h.w.DT.actions.login("hospitalist", "ORGB", "hosp", "pw-123456789");
    await sleep(80);
    expect(demoRowsIn(h.state())).toEqual([]);
    expect(JSON.stringify(h.state().providers || [])).not.toMatch(/Ada Prior/);
  });

  // PerfectServe-parity per-user / per-org slices: empty before the server
  // answers (live or offline seed — there are no kit demo rows for them), and
  // emptied on sign-out so the next person never sees the previous one's.
  const PARITY_SLICES = ["roleContacts", "favorites", "recents"];
  it("parity slices (role contacts, favorites, recents …) start empty and are emptied on sign-out", async () => {
    const h = await boot({ syntheticData: false });
    for (const k of PARITY_SLICES) expect(h.state()[k], k).toEqual([]);
    await h.w.DT.actions.login("er_doctor", "LAKE", "er.doc", "pw-123456789");
    await sleep(80);
    h.w.DT.set((s: any) => { for (const k of PARITY_SLICES) s[k] = [{ marker: "previous person's row" }]; return s; });
    await h.w.DT.actions.logout();
    await sleep(30);
    for (const k of PARITY_SLICES) expect(h.state()[k], k).toEqual([]);
  });

  it("the labelled local demo (synthetic server, then unreachable) still has the kit's demo rows", async () => {
    const h = await boot({ syntheticData: true });
    h.net.online = false;
    await h.w.DT.actions.login("hospitalist", "DOCTURN", "dev", "anything");
    await sleep(30);
    expect(h.state().session).toBeTruthy();
    expect((h.state().__toast || {}).title).toMatch(/offline — demo mode/i);
    expect(h.state().providers.length).toBeGreaterThan(0);
    expect(h.state().board.length).toBeGreaterThan(0);
    expect(h.state().pending.length).toBeGreaterThan(0);
  });
});
