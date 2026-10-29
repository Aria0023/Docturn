import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The REAL web client (webapp/store.js + webapp/api-bridge.js) loaded into
 * jsdom with a scripted HTTP backend and a fake WebSocket, to pin down the
 * realtime behaviour that a server test cannot see:
 *
 *  - A.CON-SHO-65  MESSAGE_RECEIVED / MESSAGE_ACK / MESSAGE_READ /
 *                  MESSAGE_RECALLED are applied from the frame — no request per
 *                  event (each thread GET is a PHI-access audit row). Sign-in
 *                  reads the conversation LIST only; a thread is read (one
 *                  bounded page, "Load earlier" for more) when it is opened.
 *                  A socket that comes back asks GET /api/messaging/sync once:
 *                  nothing changed → no list, no thread read; what changed
 *                  (messages, receipts, recalls) is applied from that answer.
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
 *  - identity switch on one page (demo role switch, developer impersonation):
 *                  a thread both people are in is mapped from the NEW user's
 *                  side — the previous person's window (mapped for their id)
 *                  is never re-used by the paged list (A.CON-SHO-65 follow-up).
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
  /** What GET /api/messaging/sync reports besides new messages. */
  sync: { receipts: any[]; recalled: any[]; n: number };
  reqs: Req[];
  sockets: any[];
  routes: Record<string, Route>;
  state(): any;
  convo(id: number): any;
  close(): void;
  /** Who the scripted server answers as from now on (after a POST /api/login). */
  setUser(u: any): void;
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
  let user = opts.user ?? CHEN;
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
    w, reqs, sockets, threads, convos, sync: { receipts: [], recalled: [], n: 0 },
    routes: {},
    state: () => w.DT.getState(),
    convo: (id: number) => (w.DT.getState().conversations || []).find((c: any) => c.id === id),
    close: () => { try { w.close(); } catch { /* ignore */ } },
    setUser: (u: any) => { user = u; },
  };
  harnesses.push(h);
  const unreadIn = (msgs: any[]) => msgs.filter((m) => m.senderId !== user.id && m.deliveries.some((d: any) => d.userId === user.id && !d.readAt)).length;
  const listBody = () => convos.map((c) => ({ ...c, lastMessage: (threads[c.id] || []).at(-1) ?? null, unreadCount: unreadIn(threads[c.id] || []) }));
  // The server's thread paging: newest `limit` (default 50), ?before / ?after.
  const page = (all: any[], q: URLSearchParams) => {
    const limit = Math.min(Number(q.get("limit") || 50), 200);
    const before = q.get("before"), after = q.get("after");
    if (after != null) { const rest = all.filter((m) => m.id > Number(after)); return { body: rest.slice(0, limit), more: rest.length > limit }; }
    const upto = before != null ? all.filter((m) => m.id < Number(before)) : all;
    return { body: upto.slice(Math.max(0, upto.length - limit)), more: upto.length > limit };
  };
  const respond = (req: Req): { status: number; body?: any; headers?: Record<string, string> } => {
    for (const r of Object.values(h.routes)) { const out = r(req); if (out) return out; }
    const p = req.path.split("?")[0]!;
    if (p === "/api/user") return { status: 200, body: user };
    // The boot-time restore probe (GET /api/session answers 200 either way).
    if (p === "/api/session") return { status: 200, body: { authenticated: true, user } };
    if (p === "/api/config") return { status: 200, body: { syntheticData: true } };
    if (p === "/api/modules") return { status: 200, body: { modules: {}, registry: [] } };
    if (p === "/api/settings") return { status: 200, body: { me: { dnd: false }, org: {} } };
    if (p === "/api/push/vapid-key") return { status: 200, body: { key: "BOrLbqA4n2c6s2Fv" } };
    if (p === "/api/messaging/conversations" && req.method === "GET") return { status: 200, body: listBody() };
    const m = /^\/api\/messaging\/conversations\/(\d+)\/messages$/.exec(p);
    const q = new URLSearchParams(req.path.split("?")[1] || "");
    if (m) { const pg = page(threads[Number(m[1])] ?? [], q); return { status: 200, body: pg.body, headers: { "x-has-more": pg.more ? "1" : "0" } }; }
    if (p === "/api/messaging/sync") {
      const mine = convos.filter((c) => c.participantIds.includes(user.id));
      const after = q.get("after");
      const fresh = after == null ? [] : mine.flatMap((c) => threads[c.id] || []).filter((x) => x.id > Number(after)).sort((a, b) => a.id - b.id);
      const since = q.get("since");
      return { status: 200, body: {
        cursor: "cursor-" + (++h.sync.n),
        conversations: mine.map((c) => ({ id: c.id, lastMessageId: (threads[c.id] || []).at(-1)?.id ?? null, unreadCount: unreadIn(threads[c.id] || []) })),
        messages: fresh, receipts: since ? h.sync.receipts : [], recalled: since ? h.sync.recalled : [], more: false, complete: true,
      } };
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
    const hdrs: Record<string, string> = Object.assign({ "content-type": "application/json" }, r.headers || {});
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, statusText: "", text: () => Promise.resolve(text), headers: { get: (k: string) => hdrs[String(k).toLowerCase()] ?? null } });
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
  // The post-sign-in sync that hands this device its first cursor (tolerant:
  // a client without it simply never asks).
  await until(() => convos.length === 0 || reqs.some((r) => r.path.startsWith("/api/messaging/sync")), 1000).catch(() => {});
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

  it("SHO-65: incomplete frames re-read ONE page of an OPEN thread, once per burst; an unopened thread costs nothing; an unknown thread costs one list", async () => {
    const h = await boot();
    const thin = (id: number) => { const m: any = msg(id, 1, PATEL, "covering copy " + id); delete m.attachments; delete m.deliveries; return m; };
    // Not opened yet: the thin frame is shown, nothing is fetched (the thread
    // is read when it is opened).
    h.reqs.length = 0;
    h.threads[1] = h.threads[1]!.concat([msg(105, 1, PATEL, "covering copy 105")]);
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: thin(105) });
    expect(h.convo(1).messages.some((x: any) => x.id === 105)).toBe(true);
    await sleep(600);
    expect(gets(h, /^\/api\/messaging\//)).toEqual([]);

    h.w.DT.actions.openConversation(1);
    await until(() => !!h.convo(1).loaded);
    h.reqs.length = 0;
    h.threads[1] = h.threads[1]!.concat([msg(106, 1, PATEL, "covering copy 106"), msg(107, 1, PATEL, "covering copy 107")]);
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: thin(106) });
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: thin(107) });
    expect(h.convo(1).messages.some((x: any) => x.id === 107)).toBe(true); // shown at once
    await sleep(600);
    const one = gets(h, /^\/api\/messaging\//).map((r) => r.path);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatch(/^\/api\/messaging\/conversations\/1\/messages\?limit=\d+$/);
    expect(h.convo(1).messages.find((x: any) => x.id === 107).deliveries).toHaveLength(1); // the full row replaced the thin one

    h.reqs.length = 0;
    // Someone starts a new group thread with me (server state first, then the frame).
    h.convos.push({ id: 3, type: "group", name: "Night huddle", participantIds: [CHEN.id, PATEL, 13], patientId: null });
    h.threads[3] = [msg(301, 3, PATEL, "hi", { recipients: [CHEN.id, 13] })];
    h.sockets[0].emit({ type: "MESSAGE_RECEIVED", message: msg(301, 3, PATEL, "hi", { recipients: [CHEN.id, 13] }) });
    await until(() => !!h.convo(3));
    await sleep(400);
    const paths = gets(h, /^\/api\/messaging\//).map((r) => r.path);
    expect(paths).toEqual(["/api/messaging/conversations"]); // the list carries the new message
    expect(h.convo(3)).toMatchObject({ name: "Night huddle", group: true, unread: 1 });
    expect(h.convo(3).messages.map((x: any) => x.text)).toEqual(["hi"]);
  });

  it("SHO-65: sign-in reads the conversation LIST only; a thread is read (one page) when opened", async () => {
    const threads: Record<number, any[]> = {
      1: [msg(101, 1, PATEL, "older", { read: true }), msg(102, 1, PATEL, "newest, unread")],
      2: [msg(201, 2, CHEN.id, "mine, read", { read: true })],
      3: [msg(301, 3, PATEL, "group hello", { read: true, recipients: [CHEN.id, 13] })],
    };
    const convos = [
      { id: 1, type: "direct", name: null, participantIds: [CHEN.id, PATEL], patientId: null },
      { id: 2, type: "direct", name: null, participantIds: [CHEN.id, 13], patientId: null },
      { id: 3, type: "group", name: "Huddle", participantIds: [CHEN.id, PATEL, 13], patientId: null },
    ];
    const h = await boot({ threads, convos });
    const msgsGets = gets(h, /^\/api\/messaging\//).map((r) => r.path);
    expect(msgsGets.filter((p) => p === "/api/messaging/conversations")).toHaveLength(1);
    expect(msgsGets.filter((p) => /\/messages/.test(p))).toEqual([]); // no thread read at sign-in
    // The list's newest message is the preview; unread comes from the server.
    expect(h.convo(1).messages.map((x: any) => x.text)).toEqual(["newest, unread"]);
    expect(h.convo(1).unread).toBe(1);
    expect(h.convo(1).loaded).toBe(false);
    expect(h.convo(3).unread).toBe(0);
    expect(h.w.document.title).toBe("(1) DocTurn");

    h.reqs.length = 0;
    h.w.DT.actions.openConversation(1);
    await until(() => !!h.convo(1).loaded);
    await sleep(50);
    expect(gets(h, /\/messages/).map((r) => r.path)).toEqual(["/api/messaging/conversations/1/messages?limit=50"]);
    expect(h.convo(1).messages.map((x: any) => x.id)).toEqual([101, 102]);
    expect(h.convo(1).hasEarlier).toBe(false);
    // On screen → read: the unread one is posted once and the badge clears.
    await until(() => h.reqs.some((r) => r.method === "POST" && r.path === "/api/messaging/messages/mark-read"));
    expect(h.reqs.find((r) => r.path === "/api/messaging/messages/mark-read")!.body).toEqual({ messageIds: [102] });
    expect(h.convo(1).unread).toBe(0);
    // Opening it again reads nothing more.
    h.reqs.length = 0;
    h.w.DT.actions.openConversation(1);
    await sleep(100);
    expect(gets(h, /\/messages/)).toEqual([]);
  });

  it("SHO-65: a long thread loads its newest page (enough to cover every unread) and pages back with Load earlier", async () => {
    const long = [] as any[];
    for (let i = 1; i <= 130; i++) long.push(msg(1000 + i, 1, PATEL, "m" + i, { read: i <= 70 }));
    const h = await boot({ threads: { 1: long, 2: [] } });
    expect(h.convo(1).unread).toBe(60);
    h.reqs.length = 0;
    h.w.DT.actions.openConversation(1);
    await until(() => !!h.convo(1).loaded);
    const first = gets(h, /\/messages/).map((r) => r.path);
    // The preview (newest) was on screen first and is already posted read:
    // 59 unread left + 10 of context.
    expect(first).toEqual(["/api/messaging/conversations/1/messages?limit=69"]);
    expect(h.convo(1).messages).toHaveLength(69);
    expect(h.convo(1).hasEarlier).toBe(true);
    // The thread view calls again when the page lands (its messages changed):
    // every unread one is now on screen and is posted read.
    h.w.DT.actions.openConversation(1);
    await until(() => h.convo(1).unread === 0);
    const posted = h.reqs.filter((r) => r.path === "/api/messaging/messages/mark-read").flatMap((r) => r.body.messageIds);
    expect(posted).toHaveLength(60); // the preview first, then the other 59 — each once
    expect(new Set(posted).size).toBe(60);

    h.reqs.length = 0;
    await h.w.DT.actions.loadEarlier(1);
    expect(gets(h, /\/messages/).map((r) => r.path)).toEqual(["/api/messaging/conversations/1/messages?limit=50&before=1062"]);
    expect(h.convo(1).messages).toHaveLength(119);
    expect(h.convo(1).hasEarlier).toBe(true);
    await h.w.DT.actions.loadEarlier(1);
    expect(h.convo(1).messages).toHaveLength(130);
    expect(h.convo(1).messages[0].id).toBe(1001);
    expect(h.convo(1).hasEarlier).toBe(false);
    const ids = h.convo(1).messages.map((x: any) => x.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("SHO-65: a socket that comes back with nothing changed costs ONE sync request — no list, no thread read (groups included)", async () => {
    const threads: Record<number, any[]> = {
      1: [msg(101, 1, PATEL, "older", { read: true })],
      3: [msg(301, 3, PATEL, "group", { read: true, recipients: [CHEN.id, 13] }), msg(302, 3, CHEN.id, "mine", { read: false, recipients: [PATEL, 13] })],
    };
    const convos = [
      { id: 1, type: "direct", name: null, participantIds: [CHEN.id, PATEL], patientId: null },
      { id: 3, type: "group", name: "Huddle", participantIds: [CHEN.id, PATEL, 13], patientId: null },
    ];
    const h = await boot({ threads, convos });
    h.w.DT.actions.openConversation(3);
    await until(() => !!h.convo(3).loaded);
    const before = JSON.stringify(h.state().conversations);
    h.sockets[0].serverClose(1006); // network drop
    await until(() => h.sockets.length === 2, 2500);
    h.reqs.length = 0;
    h.sockets[1].emit({ type: "CONNECTION_ESTABLISHED", userId: CHEN.id });
    await sleep(400);
    const paths = gets(h, /^\/api\/messaging\//).map((r) => r.path);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/^\/api\/messaging\/sync\?after=302&since=cursor-\d+$/);
    expect(JSON.stringify(h.state().conversations)).toBe(before);
  });

  it("SHO-65: what changed while the socket was down — a new message, a receipt, a recall — is applied from the sync answer", async () => {
    const threads: Record<number, any[]> = {
      1: [msg(101, 1, PATEL, "will be recalled"), msg(102, 1, CHEN.id, "please call back")],
      2: [msg(201, 2, 13, "old", { read: true, recipients: [CHEN.id] })],
    };
    const h = await boot({ threads });
    h.w.DT.actions.openConversation(1);
    await until(() => !!h.convo(1).loaded);
    expect(h.convo(1).messages.find((x: any) => x.id === 102).receipt).toBe("delivered");
    h.sockets[0].serverClose(1006);
    // Server state moves on: patel recalls 101, reads 102, and posts 250
    // (ids are issued in creation order: newer than anything held here).
    h.threads[1] = [h.threads[1]![1], msg(250, 1, PATEL, "sent while you were offline")];
    h.threads[1]![0].deliveries = [delivery(PATEL, true)];
    h.sync.receipts = [{ messageId: 102, conversationId: 1, userId: PATEL, displayName: "U12", deliveredAt: iso(T0), readAt: iso(Date.now()), acknowledgedAt: null, status: "read", realertedAt: null, escalatedAt: null }];
    h.sync.recalled = [{ messageId: 101, conversationId: 1 }];
    await until(() => h.sockets.length === 2, 2500);
    h.reqs.length = 0;
    h.sockets[1].emit({ type: "CONNECTION_ESTABLISHED", userId: CHEN.id });
    await until(() => (h.convo(1)?.messages || []).some((x: any) => x.id === 250));
    await sleep(300);
    const c = h.convo(1);
    expect(c.messages.map((x: any) => x.id)).toEqual([102, 250]);
    expect(c.messages.find((x: any) => x.id === 102).receipt).toBe("read");
    expect(gets(h, /^\/api\/messaging\//).map((r) => r.path.split("?")[0])).toEqual(["/api/messaging/sync"]);
    // 250 arrived while the thread is not on screen (no Messaging view here) → unread.
    expect(c.unread).toBe(1);
  });

  it("MIN-18: STAT_REALERT marks that recipient's row re-alerted (the sender's countdown moves on) without a request", async () => {
    const h = await boot({ threads: { 1: [msg(110, 1, CHEN.id, "STAT: call me", { priority: "stat" })], 2: [] } });
    h.reqs.length = 0;
    h.sockets[0].emit({ type: "STAT_REALERT", messageId: 110, conversationId: 1, userId: PATEL });
    const row = h.convo(1).messages.find((x: any) => x.id === 110).deliveries.find((d: any) => d.userId === PATEL);
    expect(typeof row.realertedAt).toBe("string");
    await sleep(400);
    expect(h.reqs.filter((r) => r.path.startsWith("/api/messaging"))).toEqual([]);
  });

  // A.CON-MIN-18 end states: the sweep's STAT_ESCALATED frame (sent to the
  // sender and the unresponsive recipient whether or not a covering provider
  // exists) moves the countdown to "Escalated" live, and is never an ack.
  it("MIN-18: STAT_ESCALATED stamps that recipient's row escalated (the stored time) — no ack, no request", async () => {
    const h = await boot({ threads: { 1: [msg(110, 1, CHEN.id, "STAT: call me", { priority: "stat" })], 2: [] } });
    h.reqs.length = 0;
    const at = iso(Date.now() - 1500);
    h.sockets[0].emit({ type: "STAT_REALERT", messageId: 110, conversationId: 1, userId: PATEL, at: iso(Date.now() - 9000) });
    h.sockets[0].emit({ type: "STAT_ESCALATED", messageId: 110, conversationId: 1, userId: PATEL, escalatedAt: at, coveringUserId: null, coveringRowAdded: false });
    const m = h.convo(1).messages.find((x: any) => x.id === 110);
    const row = m.deliveries.find((d: any) => d.userId === PATEL);
    expect(row.escalatedAt).toBe(at);
    expect(row.acknowledgedAt).toBeNull();
    expect(m.ackCount).toBe(0);
    expect(m.receipt).toBe("delivered");
    await sleep(400);
    expect(h.reqs.filter((r) => r.path.startsWith("/api/messaging"))).toEqual([]);
  });

  it("MIN-18: in a group whose covering provider is a member, escalation acks nobody — on the sender's device or the covering provider's", async () => {
    const LOPEZ = 13;
    const convos = [
      { id: 1, type: "direct", name: null, participantIds: [CHEN.id, PATEL], patientId: null },
      { id: 3, type: "group", name: "Night team", participantIds: [CHEN.id, PATEL, LOPEZ], patientId: null },
    ];
    // Sender's device (chen sent the STAT; patel is unresponsive, lopez covers).
    const h = await boot({ convos, threads: { 1: [], 3: [msg(120, 3, CHEN.id, "STAT group", { priority: "stat", recipients: [PATEL, LOPEZ] })] } });
    h.w.DT.actions.openConversation(3);
    await until(() => !!h.convo(3).loaded);
    h.reqs.length = 0;
    const at = iso(Date.now());
    h.sockets[0].emit({ type: "STAT_ESCALATED", messageId: 120, conversationId: 3, userId: PATEL, escalatedAt: at, coveringUserId: LOPEZ, coveringRowAdded: false });
    let m = h.convo(3).messages.find((x: any) => x.id === 120);
    expect(m.deliveries.find((d: any) => d.userId === PATEL).escalatedAt).toBe(at);
    const cover = m.deliveries.find((d: any) => d.userId === LOPEZ);
    expect(cover.acknowledgedAt).toBeNull();
    expect(cover.escalatedAt ?? null).toBeNull(); // lopez's own row did not escalate here
    expect(m.ackCount).toBe(0);
    await sleep(400);
    expect(gets(h, /^\/api\/messaging\//)).toEqual([]);
    // When the sweep had to ADD the covering provider's row, the open thread is
    // re-read once so the sender sees that row.
    h.sockets[0].emit({ type: "STAT_ESCALATED", messageId: 120, conversationId: 3, userId: LOPEZ, escalatedAt: at, coveringUserId: 14, coveringRowAdded: true });
    await sleep(400);
    const reread = gets(h, /^\/api\/messaging\//).map((r) => r.path);
    expect(reread).toHaveLength(1);
    expect(reread[0]).toMatch(/^\/api\/messaging\/conversations\/3\/messages\?limit=\d+$/);
    m = h.convo(3).messages.find((x: any) => x.id === 120);
    expect(m.ackCount).toBe(0);

    // The covering provider's device: the pointer frame names the unresponsive
    // recipient (forUserId) — the covering provider's own row is not touched.
    const h2 = await boot({ user: CHEN, convos, threads: { 1: [], 3: [msg(130, 3, PATEL, "STAT to the team", { priority: "stat", recipients: [CHEN.id, LOPEZ] })] } });
    h2.sockets[0].emit({ type: "STAT_ESCALATED", messageId: 130, conversationId: 3, originalMessageId: 130, originalConversationId: 3, forUserId: LOPEZ, escalatedAt: at });
    const m2 = h2.convo(3).messages.find((x: any) => x.id === 130);
    expect(m2.deliveries.find((d: any) => d.userId === LOPEZ).escalatedAt).toBe(at);
    const mine = m2.deliveries.find((d: any) => d.userId === CHEN.id);
    expect(mine.acknowledgedAt).toBeNull();
    expect(mine.escalatedAt ?? null).toBeNull();
    expect(m2.ackedByMe).toBe(false);
  });

  it("SHO-65: a sync naming a conversation this device does not know costs one list request; one it no longer holds is dropped", async () => {
    const h = await boot();
    h.sockets[0].serverClose(1006);
    h.convos.splice(1, 1); // left conversation 2
    h.convos.push({ id: 4, type: "direct", name: null, participantIds: [CHEN.id, 13], patientId: null }); // new while away
    h.threads[4] = [msg(400, 4, 13, "new thread while away")];
    await until(() => h.sockets.length === 2, 2500);
    h.reqs.length = 0;
    h.sockets[1].emit({ type: "CONNECTION_ESTABLISHED", userId: CHEN.id });
    await until(() => !!h.convo(4));
    await sleep(400);
    const paths = gets(h, /^\/api\/messaging\//).map((r) => r.path.split("?")[0] ?? "");
    expect(paths.filter((p) => p === "/api/messaging/conversations")).toHaveLength(1);
    expect(paths.filter((p) => /\/messages$/.test(p))).toEqual([]);
    expect(h.convo(2)).toBeUndefined();
    expect(h.convo(4)).toMatchObject({ unread: 1, loaded: false });
    expect(h.convo(4).messages.map((x: any) => x.text)).toEqual(["new thread while away"]);
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

  // A message window is mapped FOR one identity ("me", "unread by me" and the
  // receipt come from the signed-in user's id), and the conversation list keeps
  // a known thread's window. A different person taking over the page without a
  // sign-out — the demo role switch signs straight in as another account, a
  // developer opens an impersonated portal — must get every thread mapped from
  // THEIR side, at every moment, even for a conversation both are in.
  const PATEL_USER = { id: PATEL, username: "patel", displayName: "Dr. Priya Patel", role: "hospitalist", credential: "MD" };
  const shared = (sender: number, recipient: number) => ({
    threads: { 1: [msg(101, 1, recipient, "older", { read: true, recipients: [sender] }), msg(102, 1, sender, "X-user ping", { recipients: [recipient] })] },
    convos: [{ id: 1, type: "direct", name: null, participantIds: [sender, recipient], patientId: null }],
  });
  function watchPerspective(h: Harness, who: string, senderId: number) {
    const seen = { wrong: 0 };
    h.w.DT.subscribe(() => {
      const s = h.state();
      if (!s.session || s.session.user !== who) return;
      (s.conversations || []).forEach((c: any) => (c.messages || []).forEach((m: any) => { if (m.senderId === senderId && m.me) seen.wrong++; }));
    });
    return seen;
  }

  it("identity switch: signing in as another account on the same page (demo role switch) maps a shared thread from the NEW user's side", async () => {
    const h = await boot(shared(CHEN.id, PATEL));
    expect(h.convo(1).messages.find((m: any) => m.id === 102)).toMatchObject({ me: true });
    h.w.DT.actions.openConversation(1); // chen has the thread open (loaded window)
    await until(() => h.convo(1).loaded);
    const seen = watchPerspective(h, "patel", CHEN.id);
    h.setUser(PATEL_USER);
    await h.w.DT.actions.login("hospitalist", "ISPN", "patel", "docturn");
    await until(() => h.state().session?.user === "patel" && !!h.convo(1));
    await sleep(100);
    const c = h.convo(1);
    expect(c.messages.find((m: any) => m.id === 102)).toMatchObject({ me: false, unreadByMe: true });
    expect(c.unread).toBe(1);
    expect(c.loaded).toBe(false); // patel's own thread read happens when HE opens it
    expect(h.state().__activeConvo ?? null).toBeNull();
    expect(seen.wrong).toBe(0); // never shown as patel's own, not even before his list arrived
  });

  it("identity switch: a developer opening an impersonated portal sees the shared thread from the impersonated user's side", async () => {
    const DEV = { id: 1, username: "dev", displayName: "Platform Dev", role: "developer" };
    const h = await boot({ user: DEV, ...shared(DEV.id, CHEN.id) });
    expect(h.convo(1).messages.find((m: any) => m.id === 102)).toMatchObject({ me: true });
    const seen = watchPerspective(h, "chen", DEV.id);
    h.setUser(CHEN);
    await h.w.DT.actions.impersonate({ id: CHEN.id, role: "hospitalist", org: "ISPN" });
    await until(() => h.state().session?.user === "chen" && !!h.convo(1));
    await sleep(100);
    expect(h.convo(1).messages.find((m: any) => m.id === 102)).toMatchObject({ me: false, unreadByMe: true });
    expect(h.convo(1).unread).toBe(1);
    expect(seen.wrong).toBe(0);
  });
});
