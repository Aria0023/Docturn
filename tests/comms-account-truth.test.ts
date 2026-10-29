import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { hashPassword } from "../server/auth.js";
import { attachWebSocket, type WsHub } from "../server/ws/index.js";
import { createTestApp, login, DEV_PASSWORD, type TestContext } from "./helpers.js";

/**
 * The comms / account screens (A.CON comms-account #1-#15), server side.
 *
 *   #1      "On shift" in Settings is the hospitalist's own rotation profile
 *           (PATCH /api/hospitalists/:id/working-status, isSelf) — and every
 *           change of it is now an audit row, whoever makes it.
 *   #7      The Compliance tiles are the trails' TRUE sizes (auditCount,
 *           phiAccessCount), and each row names its actor and role (the
 *           client used to show "User 2" with an empty role).
 *   #8      Export is the server's: GET /api/audit/export — every row (not the
 *           newest 100/50 on screen), full UTC timestamps, actor, username,
 *           role, operator, IP for PHI reads; spreadsheet-formula safe; and
 *           itself an audit row.
 *   #9      A clinician's own trail: GET /api/audit/mine (+ export
 *           scope=mine) — only that user's rows, in their own org.
 *   #10     Broadcast audience: { audience: [...] } is stored with the
 *           recipient set frozen at send time; only those people get it, see
 *           it and can acknowledge it; the tally counts only them.
 *   #13     Presence: GET /api/presence is who holds a live socket
 *           right now in my org (an impersonated socket is not the user).
 */

let ctx: TestContext;
let server: Server;
let hub: WsHub;
let port: number;

beforeAll(async () => {
  ctx = await createTestApp();
  server = createServer(ctx.app);
  hub = attachWebSocket(server, ctx.app.locals.sessionMiddleware as RequestHandler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  hub.close();
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.handle.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Agent = ReturnType<typeof supertest.agent>;

/** Record what the hub fans out (the hub replaces the Noop fan-out in this file). */
function recordFrames() {
  const delivered: Array<{ userIds: number[]; message: any }> = [];
  const broadcasts: Array<{ orgId: number; message: any }> = [];
  const send = hub.sendToUsers.bind(hub);
  const bc = hub.broadcast.bind(hub);
  hub.sendToUsers = (userIds: number[], message: unknown) => { delivered.push({ userIds: [...userIds], message }); send(userIds, message); };
  hub.broadcast = (orgId: number, message: unknown) => { broadcasts.push({ orgId, message }); bc(orgId, message); };
  return { delivered, broadcasts, restore: () => { hub.sendToUsers = send; hub.broadcast = bc; } };
}

async function auditRows(action: string) {
  const rows = await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 5000);
  return rows.filter((r) => r.action === action);
}

function cookieOf(agent: Agent): string {
  const jar = (agent as unknown as { jar: { getCookies: (o: unknown) => Array<{ name: string; value: string }> } }).jar;
  const sid = jar.getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false }).find((c) => c.name === "docturn.sid");
  expect(sid, "session cookie").toBeTruthy();
  return `${sid!.name}=${sid!.value}`;
}

interface Sock { ws: WebSocket; frames: any[]; close(): Promise<void> }
function connect(cookie: string): Promise<Sock> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
  const frames: any[] = [];
  ws.on("message", (d) => { try { frames.push(JSON.parse(d.toString())); } catch { /* ignore */ } });
  ws.on("error", () => {});
  return new Promise((resolve, reject) => {
    ws.once("open", async () => {
      // Wait for the server's handshake so the socket is registered.
      const t = Date.now();
      while (!frames.some((f) => f.type === "CONNECTION_ESTABLISHED")) {
        if (Date.now() - t > 3000) return reject(new Error("no handshake"));
        await sleep(10);
      }
      resolve({ ws, frames, close: () => new Promise<void>((r) => { ws.once("close", () => r()); ws.close(); }) });
    });
    ws.once("unexpected-response", (_q, res) => reject(new Error("unexpected " + res.statusCode)));
  });
}

// ── #1 On shift ───────────────────────────────────────────────────────────────
describe("#1 a hospitalist's own On shift is the rotation profile, and audited", () => {
  it("self PATCH flips working on the server (seen by the director) and writes hospitalist.working_status", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: director } = await login(ctx.app, { username: "director" });
    const hid = ctx.seedResult.hospitalistIds.chen!;
    const before = (await auditRows("hospitalist.working_status")).length;

    const off = await chen.patch(`/api/hospitalists/${hid}/working-status`).send({ working: false });
    expect(off.status).toBe(200);
    expect(off.body.working).toBe(false);
    const seen = (await director.get("/api/hospitalists").expect(200)).body as Array<{ id: number; working: boolean }>;
    expect(seen.find((h) => h.id === hid)!.working).toBe(false);

    const rows = await auditRows("hospitalist.working_status");
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ userId: ctx.seedResult.userIds.chen, resourceType: "hospitalist", resourceId: hid });
    expect(rows[0]!.details).toMatchObject({ working: false, self: true });

    // The director's change of chen is audited as the director's.
    await director.patch(`/api/hospitalists/${hid}/working-status`).send({ working: true }).expect(200);
    const rows2 = await auditRows("hospitalist.working_status");
    expect(rows2.length).toBe(before + 2);
    expect(rows2[0]).toMatchObject({ userId: ctx.seedResult.userIds.director });
    expect(rows2[0]!.details).toMatchObject({ working: true, self: false });

    // Repeating the current value changes nothing and writes nothing.
    await director.patch(`/api/hospitalists/${hid}/working-status`).send({ working: true }).expect(200);
    expect((await auditRows("hospitalist.working_status")).length).toBe(before + 2);
  });

  it("another hospitalist cannot flip chen", async () => {
    const { agent: patel } = await login(ctx.app, { username: "patel" });
    const res = await patel.patch(`/api/hospitalists/${ctx.seedResult.hospitalistIds.chen}/working-status`).send({ working: false });
    expect(res.status).toBe(403);
  });
});

// ── #7 / #8 / #9 audit trail ─────────────────────────────────────────────────
describe("#7 the Compliance trail: true sizes, named actors and roles", () => {
  it("GET /api/audit carries auditCount + phiAccessCount and each row's actor name and role", async () => {
    // Enough sign-ins that the trail is longer than the page.
    for (let i = 0; i < 4; i++) await login(ctx.app, { username: "er.director" });
    const { agent: director } = await login(ctx.app, { username: "director" });
    const body = (await director.get("/api/audit").expect(200)).body;
    expect(body.scope).toBe("org");
    expect(typeof body.auditCount).toBe("number");
    expect(typeof body.phiAccessCount).toBe("number");
    expect(body.auditCount).toBeGreaterThanOrEqual(body.audit.length);
    const loginRow = body.audit.find((r: any) => r.action === "auth.login" && r.userId === ctx.seedResult.userIds["er.director"]);
    expect(loginRow).toMatchObject({ actorName: "Dr. Evan Marsh", actorRole: "er_director", actorUsername: "er.director" });
  });

  it("the PHI rows name the accessor too; a clinician is refused the org trail", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/patients").expect(200); // a PHI read
    const { agent: director } = await login(ctx.app, { username: "director" });
    const body = (await director.get("/api/audit").expect(200)).body;
    const phi = body.phiAccess.find((r: any) => r.userId === ctx.seedResult.userIds.chen);
    expect(phi).toMatchObject({ actorName: "Dr. Nathan Alyesh", actorRole: "hospitalist" });
    expect(phi).not.toHaveProperty("ok");
    expect(phi).not.toHaveProperty("purpose");
    await chen.get("/api/audit").expect(403);
  });
});

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

describe("#8 Export is the server's CSV of the whole trail", () => {
  it("audit export: every row (beyond the 100 on screen), ISO UTC times, actor/username/role, and it is audited", async () => {
    // Push the trail past the screen's page size.
    const orgId = ctx.seedResult.orgId;
    const directorId = ctx.seedResult.userIds.director!;
    for (let i = 0; i < 120; i++) {
      await ctx.storage.appendAudit({ organizationId: orgId, userId: directorId, action: "test.fill", resourceType: "test", resourceId: i, details: { i }, riskLevel: "low" });
    }
    const { agent: director } = await login(ctx.app, { username: "director" });
    const total = (await director.get("/api/audit").expect(200)).body.auditCount as number;
    expect(total).toBeGreaterThan(120);
    const before = (await auditRows("audit.export")).length;

    const res = await director.get("/api/audit/export?trail=audit").buffer(true).parse((r, cb) => { let d = ""; r.setEncoding("utf8"); r.on("data", (c: string) => (d += c)); r.on("end", () => cb(null, d)); });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="docturn-audit-ISPN-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    const rows = parseCsv(res.body as string);
    expect(rows[0]).toEqual(["occurred_at_utc", "actor", "actor_username", "actor_role", "operator", "action", "resource_type", "resource_id", "risk", "details"]);
    expect(rows.length - 1).toBe(total);
    expect(Number(res.headers["x-export-rows"])).toBe(total);
    expect(Number(res.headers["x-export-total"])).toBe(total);
    expect(res.headers["x-export-truncated"]).toBe("0");
    const fill = rows.find((r) => r[5] === "test.fill")!;
    expect(fill[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(fill.slice(1, 4)).toEqual(["Dr. Dana Director", "director", "director"]);
    expect(fill[8]).toBe("low");
    // Chronological (oldest first).
    const times = rows.slice(1).map((r) => r[0]!);
    expect([...times].sort()).toEqual(times);

    const exp = await auditRows("audit.export");
    expect(exp.length).toBe(before + 1);
    expect(exp[0]).toMatchObject({ userId: directorId, riskLevel: "medium" });
    expect(exp[0]!.details).toMatchObject({ trail: "audit", scope: "org", rows: total, truncated: false });
  });

  it("PHI export: method, resource ids, patient id and IP — no invented allowed/purpose columns", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/patients").expect(200);
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.get("/api/audit/export?trail=phi").buffer(true).parse((r, cb) => { let d = ""; r.setEncoding("utf8"); r.on("data", (c: string) => (d += c)); r.on("end", () => cb(null, d)); });
    expect(res.status).toBe(200);
    const rows = parseCsv(res.body as string);
    expect(rows[0]).toEqual(["occurred_at_utc", "actor", "actor_username", "actor_role", "operator", "method", "resource", "resource_id", "patient_id", "ip", "user_agent"]);
    const header = rows[0]!.join(",");
    expect(header).not.toMatch(/purpose|result|allowed|fields/);
    const chenRow = rows.find((r) => r[2] === "chen")!;
    expect(chenRow).toBeTruthy();
    expect(chenRow[3]).toBe("hospitalist");
    expect(chenRow[0]).toMatch(/Z$/);
    expect(Number(res.headers["x-export-rows"])).toBe(rows.length - 1);
  });

  it("cells a spreadsheet would run as a formula are neutralised", async () => {
    const orgId = ctx.seedResult.orgId;
    const evil = await ctx.storage.createUser({ organizationId: orgId, username: "evil.name", passwordHash: "x", role: "hospitalist" as never, displayName: "=HYPERLINK(\"http://x\")", credential: null as never, phone: null, twoFactorEnabled: false });
    await ctx.storage.appendAudit({ organizationId: orgId, userId: evil.id, action: "test.evil", resourceType: null, resourceId: null, details: null, riskLevel: "low" });
    const { agent: director } = await login(ctx.app, { username: "director" });
    const res = await director.get("/api/audit/export?trail=audit").buffer(true).parse((r, cb) => { let d = ""; r.setEncoding("utf8"); r.on("data", (c: string) => (d += c)); r.on("end", () => cb(null, d)); });
    const row = parseCsv(res.body as string).find((r) => r[5] === "test.evil")!;
    expect(row[1]).toBe("'=HYPERLINK(\"http://x\")");
  });

  it("refuses: an unknown trail (400), the org trail to a clinician (403), no session (401)", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    expect((await director.get("/api/audit/export?trail=system")).status).toBe(400);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    expect((await chen.get("/api/audit/export?trail=audit")).status).toBe(403);
    expect((await chen.get("/api/audit/export?trail=audit&scope=org")).status).toBe(403);
    expect((await supertest(ctx.app).get("/api/audit/export?trail=audit")).status).toBe(401);
  });
});

describe("#9 a clinician's own trail", () => {
  it("GET /api/audit/mine: only my rows, with true counts; another user's rows never appear", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    await chen.get("/api/patients").expect(200);
    await login(ctx.app, { username: "patel" });
    const body = (await chen.get("/api/audit/mine").expect(200)).body;
    const chenId = ctx.seedResult.userIds.chen;
    expect(body.scope).toBe("mine");
    expect(body.audit.length).toBeGreaterThan(0);
    expect(body.phiAccess.length).toBeGreaterThan(0);
    expect(body.audit.every((r: any) => r.userId === chenId)).toBe(true);
    expect(body.phiAccess.every((r: any) => r.userId === chenId)).toBe(true);
    const chenAudit = (await ctx.storage.listAuditLogs(ctx.seedResult.orgId, 100000)).filter((r) => r.userId === chenId).length;
    const chenPhi = (await ctx.storage.listPhiAccess(ctx.seedResult.orgId, 100000)).filter((r) => r.userId === chenId).length;
    expect(body.auditCount).toBe(chenAudit);
    expect(body.phiAccessCount).toBe(chenPhi);
    // An ER physician gets theirs (and only theirs) too.
    const { agent: er } = await login(ctx.app, { username: "er.doc" });
    const erBody = (await er.get("/api/audit/mine").expect(200)).body;
    expect(erBody.audit.every((r: any) => r.userId === ctx.seedResult.userIds["er.doc"])).toBe(true);
    expect((await supertest(ctx.app).get("/api/audit/mine")).status).toBe(401);
  });

  it("export scope=mine: only my rows, audited as a low-risk self export", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const res = await chen.get("/api/audit/export?trail=phi&scope=mine").buffer(true).parse((r, cb) => { let d = ""; r.setEncoding("utf8"); r.on("data", (c: string) => (d += c)); r.on("end", () => cb(null, d)); });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/docturn-phi-ISPN-mine-/);
    const rows = parseCsv(res.body as string).slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r[2] === "chen")).toBe(true);
    const exp = await auditRows("audit.export");
    expect(exp[0]).toMatchObject({ userId: ctx.seedResult.userIds.chen, riskLevel: "low" });
    expect(exp[0]!.details).toMatchObject({ trail: "phi", scope: "mine" });
  });

  it("a user of another org sees none of ISPN's rows in /mine", async () => {
    const other = await ctx.storage.createOrganization({ name: "Other", code: "OTHA", city: null, state: null, timezone: "America/New_York", assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0 });
    await ctx.storage.createUser({ organizationId: other.id, username: "o.doc", passwordHash: await hashPassword(DEV_PASSWORD), role: "hospitalist" as never, displayName: "Other Doc", credential: "MD" as never, phone: null, twoFactorEnabled: false });
    const { agent } = await login(ctx.app, { orgCode: "OTHA", username: "o.doc" });
    const body = (await agent.get("/api/audit/mine").expect(200)).body;
    expect(body.audit.every((r: any) => r.organizationId === other.id)).toBe(true);
    expect(body.phiAccessCount).toBe(0);
  });
});

// ── #10 / #11 broadcasts ─────────────────────────────────────────────────────
describe("#10 a broadcast's audience is the server's", () => {
  it("directors-only: only directors receive it, see it, count in the tally and can ack it", async () => {
    const orgId = ctx.seedResult.orgId;
    const ids = ctx.seedResult.userIds;
    const { agent: erDirector } = await login(ctx.app, { username: "er.director" });
    const rec = recordFrames();
    const created = await erDirector.post("/api/broadcasts").send({ message: "Directors only — huddle 3pm", severity: "urgent", audience: ["director"] });
    rec.restore();
    expect(created.status).toBe(201);
    // The only director other than the sender (an ER director) is "director".
    const directors = (await ctx.storage.listUsers(orgId)).filter((u) => u.role === "director" && !u.disabledAt);
    expect(created.body.total).toBe(directors.length);
    expect(created.body.audience).toEqual(["director"]);

    // No org-wide frame: the created frame went to the recipients (recipient:true)
    // and to the sender (recipient:false) only.
    expect(rec.broadcasts.some((b) => b.message.type === "BROADCAST_CREATED")).toBe(false);
    const frames = rec.delivered.filter((d) => d.message.type === "BROADCAST_CREATED");
    const toRecipients = frames.find((f) => f.message.broadcast.recipient === true)!;
    expect([...toRecipients.userIds].sort()).toEqual(directors.map((d) => d.id).sort());
    const reached = new Set(frames.flatMap((f) => f.userIds));
    expect(reached.has(ids.chen!)).toBe(false);
    expect(reached.has(ids["er.doc"]!)).toBe(false);
    expect(frames.find((f) => f.message.broadcast.recipient === false)!.userIds).toContain(ids["er.director"]);

    // chen does not see it and cannot ack it.
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const chenList = (await chen.get("/api/broadcasts").expect(200)).body as Array<{ id: number }>;
    expect(chenList.some((b) => b.id === created.body.id)).toBe(false);
    expect((await chen.post(`/api/broadcasts/${created.body.id}/ack`)).status).toBe(404);

    // The director sees it as a recipient and acks it; the tally is 1/1.
    const { agent: director } = await login(ctx.app, { username: "director" });
    const dRow = ((await director.get("/api/broadcasts").expect(200)).body as any[]).find((b) => b.id === created.body.id);
    expect(dRow).toMatchObject({ recipient: true, audience: ["director"], ackRequired: true, total: directors.length, ackCount: 0 });
    await director.post(`/api/broadcasts/${created.body.id}/ack`).expect(204);
    const sRow = ((await erDirector.get("/api/broadcasts").expect(200)).body as any[]).find((b) => b.id === created.body.id);
    expect(sRow).toMatchObject({ recipient: false, ackCount: 1, total: directors.length });
    // The sender is not a recipient of their own broadcast.
    expect((await erDirector.post(`/api/broadcasts/${created.body.id}/ack`)).status).toBe(403);

    const audit = (await auditRows("broadcast.create")).find((r) => r.resourceId === created.body.id)!;
    expect(audit.details).toMatchObject({ audience: ["director"], recipients: directors.length });
  });

  it("hospitalists + ER physicians: every one of them and nobody else; the stored set is frozen at send time", async () => {
    const orgId = ctx.seedResult.orgId;
    const { agent: director } = await login(ctx.app, { username: "director" });
    const created = await director.post("/api/broadcasts").send({ message: "Clinicians", severity: "critical", audience: ["hospitalist", "er_doctor"] });
    expect(created.status).toBe(201);
    const users = (await ctx.storage.listUsers(orgId)).filter((u) => !u.disabledAt);
    const want = users.filter((u) => u.role === "hospitalist" || u.role === "er_doctor");
    expect(created.body.total).toBe(want.length);
    const { agent: erDirector } = await login(ctx.app, { username: "er.director" });
    // An ER director is not in this audience but, as a director role, sees it (observer) without an ack button.
    const row = ((await erDirector.get("/api/broadcasts").expect(200)).body as any[]).find((b) => b.id === created.body.id);
    expect(row).toMatchObject({ recipient: false });
    expect((await erDirector.post(`/api/broadcasts/${created.body.id}/ack`)).status).toBe(403);
    const { agent: erDoc } = await login(ctx.app, { username: "er.doc" });
    await erDoc.post(`/api/broadcasts/${created.body.id}/ack`).expect(204);
    // A hospitalist provisioned after the send reads it and may ack, but never moves the denominator.
    const late = await ctx.storage.createUser({ organizationId: orgId, username: "late.hosp", passwordHash: await hashPassword(DEV_PASSWORD), role: "hospitalist" as never, displayName: "Dr. Late", credential: "MD" as never, phone: null, twoFactorEnabled: false });
    const { agent: lateAgent } = await login(ctx.app, { username: "late.hosp" });
    await lateAgent.post(`/api/broadcasts/${created.body.id}/ack`).expect(204);
    const after = ((await director.get("/api/broadcasts").expect(200)).body as any[]).find((b) => b.id === created.body.id);
    expect(after.total).toBe(want.length);
    expect(after.ackCount).toBe(1);
    expect(late.id).toBeGreaterThan(0);
  });

  it("validation: unknown roles, an empty list and an audience nobody is in are refused", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    expect((await director.post("/api/broadcasts").send({ message: "x", severity: "urgent", audience: ["patients"] })).status).toBe(400);
    expect((await director.post("/api/broadcasts").send({ message: "x", severity: "urgent", audience: [] })).status).toBe(400);
    expect((await director.post("/api/broadcasts").send({ message: "x", severity: "emergency" })).status).toBe(400);
    // The only director IS the sender: nobody would receive it.
    const res = await director.post("/api/broadcasts").send({ message: "x", severity: "urgent", audience: ["director"] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("no_recipients");
  });

  it("no audience (or \"all\") is still everyone, as before; ack follows severity", async () => {
    const { agent: director } = await login(ctx.app, { username: "director" });
    const users = (await ctx.storage.listUsers(ctx.seedResult.orgId)).filter((u) => !u.disabledAt);
    const a = await director.post("/api/broadcasts").send({ message: "All hands", severity: "info" });
    expect(a.status).toBe(201);
    expect(a.body.total).toBe(users.length - 1);
    expect(a.body.audience).toBeNull();
    const b = await director.post("/api/broadcasts").send({ message: "All hands 2", severity: "urgent", audience: "all" });
    expect(b.status).toBe(201);
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const list = (await chen.get("/api/broadcasts").expect(200)).body as any[];
    expect(list.find((x) => x.id === a.body.id)).toMatchObject({ recipient: true, ackRequired: false, audience: null });
    expect(list.find((x) => x.id === b.body.id)).toMatchObject({ recipient: true, ackRequired: true });
  });
});

// ── #13 presence ─────────────────────────────────────────────────────────────
describe("#13 presence is who holds a live socket, per org", () => {
  it("lists exactly the users connected now; goes away on close; an impersonated socket is not the user", async () => {
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const { agent: director } = await login(ctx.app, { username: "director" });
    const ids = ctx.seedResult.userIds;
    const online = async () => ((await chen.get("/api/presence").expect(200)).body as { live: boolean; online: number[] });

    let p = await online();
    expect(p.live).toBe(true);
    expect(p.online).not.toContain(ids.director);
    expect(p.online).not.toContain(ids.patel);

    const dSock = await connect(cookieOf(director));
    p = await online();
    expect(p.online).toContain(ids.director);
    expect(p.online).not.toContain(ids.patel); // on shift, never signed in: not online

    // The org is told (frame) when someone comes and goes.
    const cSock = await connect(cookieOf(chen));
    await dSock.close();
    const t = Date.now();
    while (!cSock.frames.some((f) => f.type === "USER_PRESENCE_CHANGED" && f.userId === ids.director && f.online === false)) {
      if (Date.now() - t > 3000) throw new Error("no offline frame");
      await sleep(10);
    }
    p = await online();
    expect(p.online).not.toContain(ids.director);

    // A developer impersonating patel holds a socket AS patel: patel is not online.
    const { agent: dev } = await login(ctx.app, { orgCode: "DOCTURN", username: "dev" });
    await dev.post("/api/dev/impersonate").send({ userId: ids.patel }).expect(200);
    const before = cSock.frames.length;
    const iSock = await connect(cookieOf(dev));
    await sleep(100);
    p = await online();
    expect(p.online).not.toContain(ids.patel);
    expect(cSock.frames.slice(before).some((f) => f.type === "USER_PRESENCE_CHANGED" && f.userId === ids.patel)).toBe(false);
    await iSock.close();
    await cSock.close();
  });

  it("another org's connected users are never listed", async () => {
    const other = await ctx.storage.createOrganization({ name: "Other P", code: "OTHP", city: null, state: null, timezone: "America/New_York", assignmentTimeoutMin: 10, roundRobinShiftTypes: ["day"], rotationMode: "lowest_census", rotationIndex: 0 });
    const o = await ctx.storage.createUser({ organizationId: other.id, username: "p.doc", passwordHash: await hashPassword(DEV_PASSWORD), role: "hospitalist" as never, displayName: "P Doc", credential: "MD" as never, phone: null, twoFactorEnabled: false });
    const { agent: oAgent } = await login(ctx.app, { orgCode: "OTHP", username: "p.doc" });
    const oSock = await connect(cookieOf(oAgent));
    const { agent: chen } = await login(ctx.app, { username: "chen" });
    const p = (await chen.get("/api/presence").expect(200)).body as { online: number[] };
    expect(p.online).not.toContain(o.id);
    const mine = (await oAgent.get("/api/presence").expect(200)).body as { online: number[] };
    expect(mine.online).toEqual([o.id]);
    await oSock.close();
    expect((await supertest(ctx.app).get("/api/presence")).status).toBe(401);
  });
});
