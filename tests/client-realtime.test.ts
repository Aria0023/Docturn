import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The REAL web client (webapp/store.js + webapp/api-bridge.js) loaded into
 * jsdom with a scripted HTTP backend and a fake WebSocket, to pin down the
 * realtime behaviour that a server test cannot see:
 *
 *  - A.CON-SHO-65  MESSAGE_RECEIVED / MESSAGE_ACK / MESSAGE_READ /
 *                  MESSAGE_RECALLED are applied from the frame — no request per
 *                  event (each thread GET is a PHI-access audit row); an
 *                  incomplete frame re-reads ONE thread (debounced); a socket
 *                  that comes back resyncs once, re-reading only changed threads.
 *  - A.CON-SHO-67  close 1008 "session_revoked" → sign-in (expireSession), no
 *                  reconnect loop; other 1008 → one GET /api/user probe: 401 →
 *                  sign-in, still signed in → backoff, then pause (never sign a
 *                  working session out); `online` retries.
 *  - A.CON-SHO-62 / A.CON-NEE-1  sign-in / restore never ask for notification
 *                  permission; with permission already granted the device is
 *                  (re)registered silently.
 *  - A.CON-SHO-68  sign-out deletes this device's push token (while the session
 *                  still exists), unsubscribes it, THEN ends the server session.
 *  - A.CON-SHO-63  sign-out leaves no identity in localStorage, even after
 *                  later state changes.
 *  - A.CON-MIN-14  a developer's hydrate never requests /api/patient-board.
 *  - A.CON-MIN-17  unread count in document.title and navigator.setAppBadge.
 */

// CLIENT_SRC_ROOT points the suite at another checkout's webapp/ (e.g. to show
// the previous client failing these checks); defaults to this repository.
const ROOT = process.env.CLIENT_SRC_ROOT || new URL("..", import.meta.url).pathname;
const STORE_SRC = readFileSync(ROOT + "webapp/store.js", "utf8");
const BRIDGE_SRC = readFileSync(ROOT + "webapp/api-bridge.js", "utf8");
const jsdomName = "jsdom"; // untyped devDependency — loaded dynamically
const { JSDOM } = (await import(jsdomName)) as any;

const CHEN = { id: 11, username: "chen", displayName: "Dr. Nathan Alyesh", role: "hospitalist", credential: "MD" };
const PATEL = 12;
const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.now() - 60_000;

type Req = { method: string; path: string; body: any };
type Route = (req: Req) => { status: number; body?: any } | undefined;

function delivery(userId: number, read: boolean, acked = false) {
  return { userId, displayName: "U" + userId, deliveredAt: iso(T0), readAt: read ? iso(T0) : null, acknowledgedAt: acked ? iso(T0) : null, status: acked ? "acknowledged" : read ? "read" : "delivered" };
}
function msg(id: number, convo: number, sender: number, text: string, opts: any = {}) {
  const others = opts.recipients ?? [sender === CHEN.id ? PATEL : CHEN.id];
  return {
    id, conversationId: convo, organizationId: 1, senderId: sender, content: text, priority: opts.priority ?? "routine",
    forwardedFrom: null, createdAt: iso(opts.at ?? T0 + id), deletedAt: null,
    ackCount: 0, readCount: 0, acknowledgedByMe: false,
    deliveries: others.map((u: number) => delivery(u, opts.read ?? false)),
    attachments: opts.attachments ?? [],
  };
}

interface Harness {
  w: any;
  threads: Record<number, any[]>;
  convos: any[];
  reqs: Req[];
  sockets: any[];
  routes: Record<string, Route>;
  state(): any;
  convo(id: number): any;
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

/** Boot the real client signed in as `user` against scripted routes. */
async function boot(opts: { user?: any; threads?: Record<number, any[]>; convos?: any[]; push?: "default" | "granted" | null } = {}): Promise<Harness> {
  const user = opts.user ?? CHEN;
  const dom = new JSDOM("<!doctype html><html><head><title>DocTurn</title></head><body></body></html>", { url: "https://app.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const reqs: Req[] = [];
  const sockets: any[] = [];
  const threads: Record<number, any[]> = opts.threads ?? {
    1: [msg(101, 1, PATEL, "older", { read: true })],
    2: [msg(201, 2, CHEN.id, "mine, read", { read: true })],
  };
  const convos = opts.convos ?? [
    { id: 1, type: "direct", name: null, participantIds: [CHEN.id, PATEL], patientId: null },
    { id: 2, type: "direct", name: null, participantIds: [CHEN.id, 13], patientId: null },
  ];
  const h: Harness = {
    w, reqs, sockets, threads, convos,
    routes: {},
    state: () => w.DT.getState(),
    convo: (id: number) => (w.DT.getState().conversations || []).find((c: any) => c.id === id),
    close: () => { try { w.close(); } catch { /* ignore */ } },
  };
  harnesses.push(h);
  const listBody = () => convos.map((c) => ({ ...c, lastMessage: (threads[c.id] || []).at(-1) ?? null, unreadCount: (threads[c.id] || []).filter((m) => m.senderId !== user.id && m.deliveries.some((d: any) => d.userId === user.id && !d.readAt)).length }));
  const respond = (req: Req): { status: number; body?: any } => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: user };
    if (p === "/api/config") return { status: 200, body: { syntheticData: true } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: {} } };
    if (p === "/api/push/vapid-key") return { status: 200, body: { key: "BOrLbqA4n2c6s2Fv" } };
    if (p === "/api/messaging/conversations" && req.method === "GET") return { status: 200, body: listBody() };
    const m = /^\/api\/messaging\/conversations\/(\d+)\/messages$/.exec(p);
    if (m) return { status: 200, body: threads[Number(m[1])] ?? [] };
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
    url: string; readyState = 0; sent: string[] = [];
    onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
    constructor(url: string) { this.url = url; sockets.push(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.({}); } }, 0); }
    send(d: string) { this.sent.push(d); }
    close(code = 1000, reason = "") { if (this.readyState === 3) return; this.readyState = 3; const cb = this.onclose; setTimeout(() => cb?.({ code, reason }), 0); }
    emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
    serverClose(code: number, reason = "") { this.readyState = 3; this.onclose?.({ code, reason }); }
  }
  w.WebSocket = FakeWS;
  // Web Push surface (only when asked for): a registration whose pushManager
  // records subscribe/unsubscribe, and a Notification whose prompt is counted.
  const push: any = { prompts: 0, subscribed: 0, unsubscribed: 0, badge: [] as any[] };
  (h as any).push = push;
  const sub = { endpoint: "https://push.example/ep/1", toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: "k", auth: "a" } }; }, unsubscribe() { push.unsubscribed++; push.current = null; return Promise.resolve(true); } };
  const reg = { pushManager: { getSubscription: () => Promise.resolve(push.current ?? null), subscribe: () => { push.subscribed++; push.current = sub; return Promise.resolve(sub); } } };
  if (opts.push) {
    push.current = opts.push === "granted" ? sub : null;
    Object.defineProperty(w.navigator, "serviceWorker", { configurable: true, value: { getRegistration: () => Promise.resolve(reg), ready: Promise.resolve(reg), addEventListener() {}, register: () => Promise.resolve(reg) } });
    w.PushManager = function PushManager() {};
    w.Notification = { permission: opts.push, requestPermission: () => { push.prompts++; return Promise.resolve("default"); } };
  }
  Object.defineProperty(w.navigator, "setAppBadge", { configurable: true, value: (n?: number) => { push.badge.push(n ?? "flag"); return Promise.resolve(); } });
  Object.defineProperty(w.navigator, "clearAppBadge", { configurable: true, value: () => { push.badge.push(0); return Promise.resolve(); } });
  w.console.log = () => {};
  w.eval(STORE_SRC);
  w.eval(BRIDGE_SRC);
  // restoreSession → socket + hydrate; the server greets the socket.
  await until(() => sockets.length === 1 && !!w.DT.getState().session);
  sockets[0].emit({ type: "CONNECTION_ESTABLISHED", userId: user.id });
  // Live conversations in state (the store's offline demo seed has string ids).
  await until(() => convos.length === 0 || convos.every((c) => !!h.convo(c.id)));
  await sleep(50);
  return h;
}
const gets = (h: Harness, re: RegExp) => h.reqs.filter((r) => r.method === "GET" && re.test(r.path));

describe("web client realtime (jsdom, real store.js + api-bridge.js)", () => {
  it("SHO-65: a complete MESSAGE_RECEIVED frame is applied without a single request", async () => {
    const h = await boot({ threads: { 1: [msg(101, 1, PATEL, "older", { read: true })], 2: [] } });
    expect(h.convo(1).unread).toBe(0);
    h.reqs.length = 0;
    const att = { id: 9, fileName: "xray.png", mimeType: "image/png", byteSize: 70, isImage: true, isAudio: false, durationMs: null, url: "/api/messaging/attachments/9" };
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: msg(102, 1, PATEL, "new STAT", { priority: "stat", attachments: [att] }) });
    await sleep(600); // past every debounce
    expect(h.reqs.filter((r) => r.path.startsWith("/api/messaging"))).toEqual([]);
    const c = h.convo(1);
    const m = c.messages.find((x: any) => x.id === 102);
    expect(m).toMatchObject({ text: "new STAT", priority: "stat", me: false, unreadByMe: true });
    expect(m.attachments).toEqual([att]);
    expect(c.unread).toBe(1);
    // A.CON-MIN-17: title + app badge carry the count (and nothing else).
    expect(h.w.document.title).toBe("(1) DocTurn");
    expect((h as any).push.badge.at(-1)).toBe(1);
  });

  it("SHO-65: my own frame turns the receipt Delivered, then MESSAGE_READ / MESSAGE_ACK patch it — no requests", async () => {
    const h = await boot();
    h.reqs.length = 0;
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: msg(103, 1, CHEN.id, "please call", { priority: "stat" }) });
    await sleep(10);
    let m = h.convo(1).messages.find((x: any) => x.id === 103);
    expect(m.receipt).toBe("delivered");
    h.sockets[0].emit({ type: "MESSAGE_READ", conversationId: 1, messageIds: [103], userId: PATEL, readAt: iso(Date.now()) });
    m = h.convo(1).messages.find((x: any) => x.id === 103);
    expect(m.receipt).toBe("read");
    expect(m.ackCount).toBe(0);
    h.sockets[0].emit({ type: "MESSAGE_ACK", conversationId: 1, messageId: 103, userId: PATEL });
    m = h.convo(1).messages.find((x: any) => x.id === 103);
    expect(m.ackCount).toBe(1);
    expect(m.deliveries[0].status).toBe("acknowledged");
    await sleep(600);
    expect(h.reqs.filter((r) => r.path.startsWith("/api/messaging"))).toEqual([]);
  });

  it("SHO-65: MESSAGE_RECALLED removes the message and recounts unread, without a refetch", async () => {
    const h = await boot();
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: msg(104, 1, PATEL, "oops") });
    await until(() => h.convo(1).unread === 1);
    h.reqs.length = 0;
    h.sockets[0].emit({ type: "MESSAGE_RECALLED", conversationId: 1, messageId: 104, userId: PATEL });
    expect(h.convo(1).messages.some((x: any) => x.id === 104)).toBe(false);
    expect(h.convo(1).unread).toBe(0);
    await sleep(600);
    expect(h.reqs.filter((r) => r.path.startsWith("/api/messaging"))).toEqual([]);
  });

  it("SHO-65: incomplete frames re-read ONE thread, once per burst; an unknown thread costs one list + that thread", async () => {
    const h = await boot();
    h.reqs.length = 0;
    const thin = (id: number) => { const m: any = msg(id, 1, PATEL, "covering copy " + id); delete m.attachments; delete m.deliveries; return m; };
    h.threads[1] = h.threads[1]!.concat([msg(105, 1, PATEL, "covering copy 105"), msg(106, 1, PATEL, "covering copy 106")]);
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: thin(105) });
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: thin(106) });
    expect(h.convo(1).messages.some((x: any) => x.id === 106)).toBe(true); // shown at once
    await sleep(600);
    expect(gets(h, /^\/api\/messaging\//).map((r) => r.path)).toEqual(["/api/messaging/conversations/1/messages"]);

    h.reqs.length = 0;
    // Someone starts a new group thread with me (server state first, then the frame).
    h.convos.push({ id: 3, type: "group", name: "Night huddle", participantIds: [CHEN.id, PATEL, 13], patientId: null });
    h.threads[3] = [msg(301, 3, PATEL, "hi", { recipients: [CHEN.id, 13] })];
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: msg(301, 3, PATEL, "hi", { recipients: [CHEN.id, 13] }) });
    await until(() => !!h.convo(3));
    await sleep(400);
    const paths = gets(h, /^\/api\/messaging\//).map((r) => r.path);
    expect(paths.filter((p) => p === "/api/messaging/conversations")).toHaveLength(1);
    expect(paths.filter((p) => /\/messages$/.test(p))).toEqual(["/api/messaging/conversations/3/messages"]);
    expect(h.convo(3)).toMatchObject({ name: "Night huddle", group: true, unread: 1 });
  });

  it("SHO-65: a socket that comes back resyncs once — a message sent while it was down appears; unchanged threads are not re-read", async () => {
    const threads: Record<number, any[]> = { 1: [msg(101, 1, PATEL, "older", { read: true })], 2: [msg(201, 2, 13, "old", { read: true, recipients: [CHEN.id] })] };
    const h = await boot({ threads });
    h.sockets[0].serverClose(1006); // network drop
    threads[1] = threads[1]!.concat([msg(107, 1, PATEL, "sent while you were offline")]); // server state moves on
    await until(() => h.sockets.length === 2, 2500); // backoff ≤ 1 s for the first retry
    h.reqs.length = 0;
    h.sockets[1].emit({ type: "CONNECTION_ESTABLISHED", userId: CHEN.id });
    await until(() => (h.convo(1)?.messages || []).some((x: any) => x.id === 107));
    await sleep(200);
    const paths = gets(h, /^\/api\/messaging\//).map((r) => r.path);
    expect(paths.filter((p) => p === "/api/messaging/conversations")).toHaveLength(1);
    expect(paths.filter((p) => /\/messages$/.test(p))).toEqual(["/api/messaging/conversations/1/messages"]);
    expect(h.convo(1).unread).toBe(1);
  });

  it("SHO-67: close 1008 session_revoked → sign-in with the reason, and no reconnect", async () => {
    const h = await boot();
    h.reqs.length = 0;
    h.sockets[0].serverClose(1008, "session_revoked");
    expect(h.state().session).toBeNull();
    expect(h.state().loginError).toMatch(/password was changed or reset/i);
    await sleep(1500);
    expect(h.sockets).toHaveLength(1);
    expect(gets(h, /^\/api\/user$/)).toHaveLength(0);
    // PHI slices are gone with the session.
    expect((h.state().conversations || []).some((c: any) => c.id === 1)).toBe(false);
  });

  it("SHO-67: close 1008 unauthorized → one GET /api/user probe; 401 → sign-in, no reconnect loop", async () => {
    const h = await boot();
    h.routes.dead = (req) => (req.path === "/api/user" ? { status: 401, body: { error: "unauthorized" } } : undefined);
    h.reqs.length = 0;
    h.sockets[0].serverClose(1008, "unauthorized");
    await until(() => h.state().session === null);
    expect(h.state().loginError).toMatch(/session expired/i);
    expect(gets(h, /^\/api\/user$/)).toHaveLength(1);
    await sleep(1500);
    expect(h.sockets).toHaveLength(1);
  });

  it("SHO-67: 1008 while HTTP still says signed in → backoff, pause after 3 refusals, never sign out; `online` retries", async () => {
    const h = await boot();
    h.sockets[0].serverClose(1008, "unauthorized");
    await until(() => h.sockets.length === 2, 2500);
    h.sockets[1].serverClose(1008, "unauthorized");
    await until(() => h.sockets.length === 3, 4500);
    h.sockets[2].serverClose(1008, "unauthorized");
    await sleep(3000);
    expect(h.sockets).toHaveLength(3); // paused, not looping
    expect(h.state().session).not.toBeNull(); // a working session is never signed out
    h.w.dispatchEvent(new h.w.Event("online"));
    expect(h.sockets).toHaveLength(4);
  }, 20000);

  it("SHO-62/NEE-1: sign-in/restore never prompts for notifications (permission 'default')", async () => {
    const h = await boot({ push: "default" });
    await sleep(100);
    expect((h as any).push.prompts).toBe(0);
    expect(h.reqs.some((r) => r.path === "/api/mobile/device-tokens")).toBe(false);
    // Only the Settings tap asks.
    await h.w.DT.actions.enablePush();
    expect((h as any).push.prompts).toBe(1);
  });

  it("SHO-62 + SHO-68: granted → silent re-registration; sign-out deletes the token, unsubscribes, THEN ends the session; no identity left in storage (SHO-63)", async () => {
    const h = await boot({ push: "granted" });
    await until(() => h.reqs.some((r) => r.method === "POST" && r.path === "/api/mobile/device-tokens"));
    expect((h as any).push.prompts).toBe(0);
    const reg = h.reqs.find((r) => r.method === "POST" && r.path === "/api/mobile/device-tokens")!;
    expect(reg.body.platform).toBe("webpush");
    const token = reg.body.token as string;

    h.reqs.length = 0;
    await h.w.DT.actions.logout();
    const order = h.reqs.filter((r) => r.method !== "GET").map((r) => r.method + " " + r.path);
    expect(order).toEqual(["DELETE /api/mobile/device-tokens/" + encodeURIComponent(token), "POST /api/logout"]);
    expect((h as any).push.unsubscribed).toBe(1);

    // Later state changes (toasts, config) must not write the identity back.
    h.w.DT.set((s: any) => { s.loginError = "x"; return s; });
    await sleep(400);
    const raw = Object.keys(h.w.localStorage).map((k) => h.w.localStorage.getItem(k)).join("\n");
    expect(raw).not.toContain(CHEN.displayName);
    expect(raw).not.toContain('"user":"chen"');
    expect(raw).not.toMatch(/"me"\s*:/);
    expect(h.state().me.id).toBeUndefined();
    expect(h.w.document.title).toBe("DocTurn");
    expect((h as any).push.badge.at(-1)).toBe(0);
  });

  it("MIN-14: a developer's hydrate never requests the role-gated patient board", async () => {
    const h = await boot({ user: { id: 1, username: "dev", displayName: "Platform Dev", role: "developer" }, threads: {}, convos: [] });
    await sleep(300);
    expect(h.reqs.some((r) => r.path.startsWith("/api/patient-board"))).toBe(false);
    const hosp = await boot();
    await sleep(100);
    expect(hosp.reqs.some((r) => r.path.startsWith("/api/patient-board"))).toBe(true);
  });
});
