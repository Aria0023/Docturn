import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The web app inside the native shell (mobile-app/, Expo + react-native-webview)
 * — the REAL client (store.js, api-bridge.js, every JSX screen index.html
 * loads) mounted in jsdom under the shell's user agent, against a scripted
 * backend. What the shell contract promises:
 *
 *   - Detection: the UA suffix "DocTurnShell/<version>" (or the injected
 *     window.DocTurnShell flag) makes DT.shell truthy; a browser gets null.
 *   - No browser-install UI inside the app: the Install banner (which an
 *     iPhone UA would otherwise show) and the one-time "Turn on STAT alerts"
 *     card never render — push goes through the shell, so DT.pushStatus() is
 *     never a browser state ("default" / "ios-home-screen").
 *   - Session signal: the page tells the shell when a session exists / ends
 *     (window.ReactNativeWebView.postMessage, {type:"dt-session"}).
 *   - Push token: the shell hands its Expo token to window.__dtShell.pushToken;
 *     the page registers it with the signed-in account through the existing
 *     POST /api/mobile/device-tokens (platform "expo") — and only then reports
 *     "granted". A token handed before sign-in is registered when the session
 *     arrives. Sign-out DELETEs it (while the session still exists, before
 *     POST /api/logout) and posts "ended".
 *   - Deep links: window.__dtShell.open({nav, conversationId}) (a tapped
 *     notification / a universal link while the app is up) and the path
 *     /messages/<id> (a universal link that starts the app) open Messages and
 *     that thread once the list is live.
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

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const SHELL_UA = IPHONE_UA + " DocTurnShell/1.2.3";
const ME = { id: 11, username: "chen", displayName: "Dr. Test Chen", role: "hospitalist", credential: "MD", organizationId: 1 };
const TOKEN = "ExponentPushToken[abc-123]";

type Req = { method: string; path: string; body: any };
interface Harness { w: any; reqs: Req[]; posted: any[]; sockets: any[]; user: any; state(): any; text(): string; close(): void }
const harnesses: Harness[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
afterEach(async () => { if (harnesses.length) await sleep(300); while (harnesses.length) harnesses.pop()!.close(); });
async function until(pred: () => boolean, ms = 6000, what = "condition") {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error("timed out waiting for " + what);
    await sleep(15);
  }
}

async function boot(opts: { ua?: string; flag?: boolean; url?: string; convos?: any[]; signedIn?: boolean; installDismissed?: boolean } = {}): Promise<Harness> {
  const dom = new JSDOM('<!doctype html><html><head><title>DocTurn</title></head><body><div id="root"></div></body></html>', {
    url: opts.url || "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true, userAgent: opts.ua || SHELL_UA,
  });
  const w = dom.window;
  // jsdom 25 ignores its userAgent option; the client reads navigator.userAgent.
  const ua = opts.ua || SHELL_UA;
  Object.defineProperty(w.navigator, "userAgent", { get: () => ua, configurable: true });
  const reqs: Req[] = [];
  const posted: any[] = [];
  const sockets: any[] = [];
  const convos = opts.convos || [];
  const h: Harness = {
    w, reqs, posted, sockets, user: opts.signedIn === false ? null : ME,
    state: () => w.DT.getState(),
    text: () => w.document.body.textContent || "",
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  if (opts.installDismissed) w.localStorage.setItem("dt_install_dismissed", "1");
  const respond = (req: Req): { status: number; body?: any } => {
    const p = req.path.split("?")[0]!;
    if (p === "/api/login") { h.user = ME; return { status: 200, body: ME }; }
    if (p === "/api/user") return h.user ? { status: 200, body: h.user } : { status: 401, body: { error: "unauthorized" } };
    if (p === "/api/session") return { status: 200, body: h.user ? { authenticated: true, user: h.user } : { authenticated: false } };
    if (p === "/api/logout") { h.user = null; return { status: 200, body: { ok: true } }; }
    if (p === "/api/config") return { status: 200, body: { syntheticData: false } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: {} } };
    if (p === "/api/presence") return { status: 200, body: { live: true, online: [] } };
    if (p === "/api/messaging/conversations" && req.method === "GET") return { status: 200, body: convos };
    if (/^\/api\/messaging\/conversations\/\d+\/messages/.test(p)) return { status: 200, body: [] };
    if (p === "/api/mobile/device-tokens" && req.method === "POST") return { status: 201, body: { ok: true } };
    if (p.startsWith("/api/mobile/device-tokens/") && req.method === "DELETE") return { status: 204 };
    if (req.method !== "GET") return { status: 204 };
    return { status: 200, body: [] };
  };
  w.fetch = (url: string, init: any = {}) => {
    const u = new URL(url, "https://app.test/");
    const req: Req = { method: (init.method || "GET").toUpperCase(), path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null };
    reqs.push(req);
    const r = respond(req);
    const text = r.body === undefined || r.body === null ? "" : JSON.stringify(r.body);
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, statusText: "", text: () => Promise.resolve(text), json: () => Promise.resolve(r.body), headers: { get: () => "application/json" } });
  };
  class FakeWS {
    url: string; readyState = 0; onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
    constructor(url: string) { this.url = url; sockets.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.({}); } }, 0); }
    send() {}
    close() { this.readyState = 3; }
    emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  }
  w.WebSocket = FakeWS;
  // A phone-width viewport that is NOT a home-screen (standalone) app.
  w.matchMedia = (q: string) => ({ matches: !/display-mode/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
  w.scrollTo = () => {};
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.confirm = () => true;
  w.open = () => null;
  w.console.log = () => {};
  w.console.error = () => {};
  w.console.warn = () => {};
  // What the shell injects before the page's own scripts run, and the bridge it posts to.
  if (opts.flag !== false && (opts.ua || SHELL_UA).includes("DocTurnShell/")) {
    w.DocTurnShell = { version: "1.2.3", platform: "ios" };
    w.ReactNativeWebView = { postMessage: (s: string) => posted.push(JSON.parse(s)) };
  }
  for (const v of VENDOR) w.eval(v);
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  w.eval(APP_SRC);
  if (opts.signedIn !== false) {
    await until(() => sockets.length >= 1 && !!w.DT.getState().session, 6000, "session");
    sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: ME.id });
    await until(() => !!w.DT.getState().modules, 6000, "modules");
  }
  await sleep(150);
  return h;
}

const sessionStates = (h: Harness) => h.posted.filter((m) => m && m.type === "dt-session").map((m) => m.state);

describe("the web app inside the native shell", () => {
  it("detects the shell from the UA suffix; a browser gets DT.shell === null and the old behaviour", async () => {
    const h = await boot();
    expect(h.w.DT.shell).toMatchObject({ version: "1.2.3" });
    const browser = await boot({ ua: IPHONE_UA, flag: false });
    expect(browser.w.DT.shell).toBeNull();
    // A browser state (an iPhone Safari tab without PushManager) — never the shell's.
    expect(browser.w.DT.pushStatus()).toBe("ios-home-screen");
    expect(browser.text()).toMatch(/Install DocTurn/); // the browser still gets the install banner
    expect(browser.w.__dtShell).toBeTruthy();
    browser.w.__dtShell.pushToken(TOKEN); // ignored outside the shell
    await sleep(100);
    expect(browser.reqs.filter((r) => r.path === "/api/mobile/device-tokens")).toEqual([]);
    expect(browser.posted).toEqual([]);
  });

  it("never shows the Install banner or the Turn-on-alerts card inside the shell; push status is the shell's", async () => {
    const fresh = await boot();
    expect(fresh.text()).not.toMatch(/Install DocTurn/);
    expect(fresh.w.document.querySelector("[data-alerts-card]")).toBeNull();
    expect(fresh.w.DT.pushStatus()).toBe("shell");
    // With the install banner dismissed, the old client's card explained
    // "Add to Home Screen" on an iPhone UA — meaningless inside the app.
    const dismissed = await boot({ installDismissed: true });
    expect(dismissed.w.document.querySelector("[data-alerts-card]")).toBeNull();
    expect(dismissed.text()).not.toMatch(/Home Screen/);
  });

  it("tells the shell the session is active, registers the handed Expo token as platform expo, and only then says granted", async () => {
    const h = await boot();
    expect(sessionStates(h)).toEqual(["active"]);
    expect(h.reqs.filter((r) => r.path.startsWith("/api/mobile/device-tokens"))).toEqual([]);
    h.w.__dtShell.pushToken(TOKEN);
    await until(() => h.reqs.some((r) => r.method === "POST" && r.path === "/api/mobile/device-tokens"), 3000, "token POST");
    const posts = h.reqs.filter((r) => r.method === "POST" && r.path === "/api/mobile/device-tokens");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ token: TOKEN, platform: "expo" });
    await until(() => h.w.DT.pushStatus() === "granted", 3000, "granted");
    // Handing the same token again (every page load / session signal) is not a second registration.
    h.w.__dtShell.pushToken(TOKEN);
    await sleep(100);
    expect(h.reqs.filter((r) => r.method === "POST" && r.path === "/api/mobile/device-tokens")).toHaveLength(1);
    // The shell's own report of a refused permission shows as denied (Settings explains device settings).
    const refused = await boot();
    refused.w.__dtShell.pushStatus("denied");
    expect(refused.w.DT.pushStatus()).toBe("denied");
    expect(refused.w.document.querySelector("[data-alerts-card]")).toBeNull();
  });

  it("a token handed before sign-in is registered when the session arrives", async () => {
    const h = await boot({ signedIn: false });
    await sleep(200);
    expect(h.state().session).toBeFalsy();
    h.w.__dtShell.pushToken(TOKEN);
    await sleep(100);
    expect(h.reqs.filter((r) => r.path === "/api/mobile/device-tokens")).toEqual([]);
    expect(sessionStates(h)).toEqual([]);
    await h.w.DT.actions.login("hospitalist", "ISPN", "chen", "correct-horse");
    await until(() => h.reqs.some((r) => r.method === "POST" && r.path === "/api/mobile/device-tokens"), 3000, "token POST after login");
    expect(h.reqs.find((r) => r.method === "POST" && r.path === "/api/mobile/device-tokens")!.body).toEqual({ token: TOKEN, platform: "expo" });
    expect(sessionStates(h)).toEqual(["active"]);
  });

  it("sign-out deletes the shell's token while the session still exists, then ends it and tells the shell", async () => {
    const h = await boot();
    h.w.__dtShell.pushToken(TOKEN);
    await until(() => h.w.DT.pushStatus() === "granted", 3000, "granted");
    const from = h.reqs.length;
    await h.w.DT.actions.logout();
    const after = h.reqs.slice(from);
    const del = after.findIndex((r) => r.method === "DELETE" && r.path === "/api/mobile/device-tokens/" + encodeURIComponent(TOKEN));
    const out = after.findIndex((r) => r.method === "POST" && r.path === "/api/logout");
    expect(del).toBeGreaterThanOrEqual(0);
    expect(out).toBeGreaterThan(del);
    expect(sessionStates(h)).toEqual(["active", "ended"]);
    expect(h.w.DT.pushStatus()).toBe("shell");
  });

  it("opens Messages (and a thread) on the shell's request, and from a /messages/<id> universal link", async () => {
    const convos = [{ id: 42, type: "direct", name: null, participantIds: [ME.id, 12], patientId: null }];
    const h = await boot({ convos });
    expect(h.state().ui.nav).not.toBe("messages");
    h.w.__dtShell.open({ nav: "messages" });
    await until(() => h.state().ui.nav === "messages", 3000, "messages nav");
    h.w.__dtShell.open({ nav: "messages", conversationId: 42 });
    await until(() => h.state().__activeConvo === 42, 3000, "thread 42");

    const link = await boot({ convos, url: "https://app.test/messages/42" });
    await until(() => link.state().ui.nav === "messages" && link.state().__activeConvo === 42, 6000, "thread from the link");
    // The path is consumed: a reload does not re-open the thread, and no thread id is left in the address.
    expect(link.w.location.pathname).toBe("/");
  });
});
