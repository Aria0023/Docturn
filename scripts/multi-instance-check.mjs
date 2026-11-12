#!/usr/bin/env node
/**
 * E1 multi-instance safety — two REAL server processes on one Postgres
 * (docs/ENTERPRISE_READINESS.md), probed from outside:
 *
 *   realtime bus   a message sent through instance A arrives on a WebSocket
 *                  held by instance B (Postgres LISTEN/NOTIFY), a 10 KB one
 *                  arrives in full (published by reference, re-read on B), and
 *                  a password change on A closes that person's socket on B
 *                  with 1008 session_revoked;
 *   job leases     every background job has exactly one holder in job_leases
 *                  and both instances hold some (the table is shared);
 *   rate limits    rate_limit_hits is the store (RATE_LIMIT stays on here);
 *   request id     X-Request-Id on every response, echoed when valid, in the
 *                  error body of a refused request;
 *   SIGTERM        A keeps serving an in-flight request to completion, closes
 *                  its socket with 1012 server_restart, refuses new
 *                  connections, releases its leases, exits 0 — and B is
 *                  untouched.
 *
 * Usage:
 *   DATABASE_URL=postgresql://… node scripts/multi-instance-check.mjs
 * The probe rotates a demo account's password, so point it at a throwaway
 * database — or set PROBE_CREATE_DB=1 and it creates `docturn_probe_<ts>` on
 * the same server (CREATE DATABASE through DATABASE_URL), runs there and
 * drops it afterwards; the database DATABASE_URL names is never written.
 * Without DATABASE_URL it runs ONE instance on a scratch PGlite store and
 * checks the single-instance legs only (request id, SIGTERM) — the Render
 * demo's configuration.
 * Ports: PORT_A / PORT_B (default 9002 / 9003). Never touches ./.pglite.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import pg from "pg";

let DATABASE_URL = process.env.DATABASE_URL || "";
const ADMIN_URL = DATABASE_URL;
const CREATE_DB = process.env.PROBE_CREATE_DB === "1" && !!DATABASE_URL;
const PORT_A = Number(process.env.PORT_A || 9002);
const PORT_B = Number(process.env.PORT_B || 9003);
const PASSWORD = "docturn";
const results = [];
let failed = 0;
function rec(ok, label, detail = "") {
  results.push({ ok, label, detail });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  ↳ " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Instances behind one load balancer MUST share SESSION_SECRET (a cookie
// signed by A is verified by B); each instance otherwise mints its own at boot.
const SESSION_SECRET = process.env.SESSION_SECRET || "multi-instance-probe-secret-" + "x".repeat(24);

function startInstance(name, port, extraEnv = {}) {
  const log = [];
  // node directly (tsx as a loader), so a SIGTERM reaches the server process
  // itself — through the `npx tsx` wrapper the signal ends the wrapper first.
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      INSTANCE_ID: name,
      SESSION_SECRET,
      SHUTDOWN_TIMEOUT_MS: "8000",
      ...(DATABASE_URL ? { DATABASE_URL } : {}),
      ...extraEnv,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  for (const s of [child.stdout, child.stderr]) s.on("data", (d) => log.push(String(d)));
  return { name, port, child, log, exit, base: `http://127.0.0.1:${port}` };
}

async function waitHealthy(inst, ms = 90_000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      const r = await fetch(inst.base + "/api/health");
      if (r.status === 200) return await r.json();
    } catch {}
    await sleep(500);
  }
  throw new Error(`${inst.name} did not become healthy:\n${inst.log.join("")}`);
}

async function login(inst, username, orgCode = "ISPN") {
  const r = await fetch(inst.base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgCode, username, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error(`login ${username} on ${inst.name}: ${r.status} ${await r.text()}`);
  const cookie = String(r.headers.get("set-cookie") || "").split(";")[0];
  const user = await r.json();
  return { cookie, user };
}

function api(inst, cookie, method, path, body) {
  return fetch(inst.base + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function connectWs(inst, cookie) {
  const ws = new WebSocket(`ws://127.0.0.1:${inst.port}/ws`, { headers: { Cookie: cookie } });
  const frames = [];
  const waiters = [];
  const closed = new Promise((resolve) => ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  ws.on("message", (d) => {
    let m;
    try {
      m = JSON.parse(d.toString());
    } catch {
      return;
    }
    frames.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(m)) waiters.splice(i, 1)[0].resolve(m);
  });
  const waitFor = (pred, ms = 5000) => {
    const hit = frames.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for frame")), ms);
      waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  };
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, frames, waitFor, closed }));
    ws.once("error", reject);
  });
}

/** A raw HTTP request whose body is sent in two halves around a signal. */
function halfSentRequest(port, cookie, bodyObj) {
  const body = Buffer.from(JSON.stringify(bodyObj));
  const head =
    `POST /api/messaging/send HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n` +
    `Cookie: ${cookie}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
  const half = Math.floor(body.length / 2);
  const sock = createConnection({ host: "127.0.0.1", port });
  let raw = "";
  const done = new Promise((resolve) => {
    sock.on("data", (d) => (raw += d.toString()));
    sock.on("close", () => resolve(raw));
    sock.on("error", (e) => resolve("ERROR " + e.code));
  });
  const started = new Promise((resolve) => sock.once("connect", resolve));
  sock.write(head + body.subarray(0, half).toString());
  return {
    started,
    finish: () => sock.write(body.subarray(half)),
    done,
  };
}

async function withProbeDatabase(fn) {
  if (!CREATE_DB) return fn();
  const name = "docturn_probe_" + Date.now().toString(36);
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(ADMIN_URL);
  u.pathname = "/" + name;
  DATABASE_URL = u.toString();
  console.log(`probe database ${name} created (dropped at the end)`);
  try {
    return await fn();
  } finally {
    try {
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    } catch (e) {
      console.log("could not drop the probe database: " + (e?.message || e));
    }
    await admin.end();
  }
}

async function main() {
  await withProbeDatabase(run);
}

async function run() {
  const scratch = mkdtempSync(join(tmpdir(), "docturn-mi-"));
  const pgliteEnv = DATABASE_URL ? {} : { PGLITE_DIR: join(scratch, "pglite") };
  const A = startInstance("probe-A", PORT_A, pgliteEnv);
  const B = DATABASE_URL ? startInstance("probe-B", PORT_B) : null;
  const instances = [A, B].filter(Boolean);
  const stop = async () => {
    for (const i of instances) {
      try {
        process.kill(-i.child.pid, "SIGKILL");
      } catch {}
    }
    rmSync(scratch, { recursive: true, force: true });
  };
  process.on("SIGINT", () => stop().then(() => process.exit(1)));
  try {
    const healthA = await waitHealthy(A);
    rec(healthA.ok === true, `instance A healthy on :${PORT_A}`, `storage ${healthA.storage}`);
    if (B) {
      const healthB = await waitHealthy(B);
      rec(healthB.ok === true && healthB.storage === "postgres", `instance B healthy on :${PORT_B} (same Postgres)`);
      rec(A.log.join("").includes("realtime bus Postgres LISTEN/NOTIFY"), "A's boot line names the Postgres realtime bus");
      rec(A.log.join("").includes("rate limits counted in Postgres"), "A's boot line names the shared rate-limit store");
    } else {
      rec(A.log.join("").includes("realtime bus in-process"), "boot line names the in-process bus (single instance, no DATABASE_URL)");
    }

    // ── request id ────────────────────────────────────────────────────────
    const h1 = await fetch(A.base + "/api/health");
    const id1 = h1.headers.get("x-request-id") || "";
    rec(/^[0-9a-f-]{36}$/.test(id1), "every response carries X-Request-Id (UUID when none was sent)", id1);
    const h2 = await fetch(A.base + "/api/health", { headers: { "X-Request-Id": "probe-req-0001" } });
    rec(h2.headers.get("x-request-id") === "probe-req-0001", "a valid caller id is echoed");
    const bad = await fetch(A.base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "probe-req-0002" },
      body: "{not json",
    });
    const badBody = await bad.json().catch(() => ({}));
    rec(bad.status === 400 && badBody.error === "invalid_json" && badBody.requestId === "probe-req-0002", "an error body carries the request id", JSON.stringify(badBody));

    let onA = null;
    let chen = null;
    if (B) {
      // ── realtime bus across two processes ─────────────────────────────
      chen = await login(A, "chen");
      const er = await login(A, "er.doc");
      const onB = await connectWs(B, chen.cookie);
      await onB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
      rec(true, "chen's cookie minted by A opens a socket on B (sessions shared in Postgres)");
      const convo = await (await api(A, er.cookie, "POST", "/api/messaging/conversations", { type: "direct", participantIds: [chen.user.id] })).json();
      await api(A, er.cookie, "POST", "/api/messaging/send", { conversationId: convo.id, content: "hello from A", priority: "routine" });
      const f1 = await onB.waitFor((m) => m.type === "MESSAGE_RECEIVED" && m.message?.content === "hello from A").catch(() => null);
      rec(!!f1, "a message sent through A reaches chen's socket on B (LISTEN/NOTIFY)");
      const long = "handoff detail ".repeat(700);
      const sent = await (await api(A, er.cookie, "POST", "/api/messaging/send", { conversationId: convo.id, content: long, priority: "urgent" })).json();
      const f2 = await onB.waitFor((m) => m.type === "MESSAGE_RECEIVED" && m.message?.id === sent.id).catch(() => null);
      rec(!!f2 && f2.message.content === long && Array.isArray(f2.message.deliveries), "a 10 KB message crosses by reference and is rebuilt in full on B", `${Buffer.byteLength(long)} bytes`);
      // Typing relay from a socket on A to the socket on B.
      onA = await connectWs(A, er.cookie);
      await onA.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
      onA.ws.send(JSON.stringify({ type: "typing_start", conversationId: convo.id }));
      const typing = await onB.waitFor((m) => m.type === "user_typing" && m.typing === true).catch(() => null);
      rec(!!typing, "typing_start on A's socket is relayed to B's socket");
      // Revocation across processes.
      const lopez = await login(A, "lopez");
      const lopezOnB = await connectWs(B, lopez.cookie);
      await lopezOnB.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
      const lopez2 = await login(A, "lopez");
      const pw = await api(A, lopez2.cookie, "PATCH", "/api/account/password", { currentPassword: PASSWORD, newPassword: "Probe-Rotated-2026!" });
      const closedB = await Promise.race([lopezOnB.closed, sleep(5000).then(() => null)]);
      rec(pw.status === 200 && closedB && closedB.code === 1008 && closedB.reason === "session_revoked", "a password change on A closes lopez's socket on B with 1008 session_revoked", JSON.stringify(closedB));
      onB.ws.close();

      // ── job leases: one holder per job, both instances present ─────────
      await sleep(16_000); // past the 15 s expiry / escalation ticks and the 5 s / 8 s boot syncs
      const client = new pg.Client({ connectionString: DATABASE_URL });
      await client.connect();
      const leases = (await client.query("SELECT name, holder, lease_until > NOW() AS held FROM job_leases ORDER BY name")).rows;
      const holders = new Set(leases.map((l) => l.holder));
      rec(leases.length >= 4, "job_leases holds a row per job that has ticked", leases.map((l) => `${l.name}=${l.holder}`).join(", "));
      rec([...holders].every((h) => h === "probe-A" || h === "probe-B"), "every lease holder is one of the two instances", [...holders].join(","));
      const hits = (await client.query("SELECT count(*)::int AS n FROM rate_limit_hits")).rows[0].n;
      rec(hits >= 1, "rate_limit_hits is the limiter store (rows written by the probes above)", `${hits} row(s)`);
      // ── SIGTERM A while B keeps serving ───────────────────────────────
      const inflight = halfSentRequest(PORT_A, er.cookie, { conversationId: convo.id, content: "sent during shutdown", priority: "routine" });
      await inflight.started;
      await sleep(100);
      process.kill(A.child.pid, "SIGTERM");
      await sleep(300);
      const closedA = await Promise.race([onA.closed, sleep(5000).then(() => null)]);
      rec(closedA && closedA.code === 1012 && closedA.reason === "server_restart", "A's socket closes with 1012 server_restart on SIGTERM", JSON.stringify(closedA));
      const refused = await fetch(A.base + "/api/health").then((r) => "status " + r.status, (e) => e.cause?.code || e.code || "refused");
      rec(/ECONNREFUSED|refused|status 503/.test(String(refused)), "A refuses new connections while draining", String(refused));
      inflight.finish();
      const raw = await Promise.race([inflight.done, sleep(8000).then(() => "TIMEOUT")]);
      const status = /^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1];
      rec(status === "201", "the request in flight on A during SIGTERM completed (201), not reset", status ? `HTTP ${status}` : String(raw).slice(0, 80));
      const exitA = await Promise.race([A.exit, sleep(15_000).then(() => null)]);
      rec(exitA && exitA.code === 0, "A exited 0 after draining", JSON.stringify(exitA));
      const after = (await client.query("SELECT name FROM job_leases WHERE holder = 'probe-A' AND lease_until > NOW()")).rows;
      rec(after.length === 0, "A released every lease it held (B can take them over at once)");
      const bHealth = await fetch(B.base + "/api/health").then((r) => r.status);
      rec(bHealth === 200, "B is untouched and still healthy", `status ${bHealth}`);
      // The message sent during shutdown is in the thread (served by B).
      const thread = await (await api(B, chen.cookie, "GET", `/api/messaging/conversations/${convo.id}/messages`)).json();
      rec(Array.isArray(thread) && thread.some((m) => m.content === "sent during shutdown"), "the in-flight message was stored and B serves it");
      await client.end();
      process.kill(B.child.pid, "SIGTERM");
      const exitB = await Promise.race([B.exit, sleep(15_000).then(() => null)]);
      rec(exitB && exitB.code === 0, "B exits 0 on SIGTERM", JSON.stringify(exitB));
      rec(A.log.some((l) => l.includes("[shutdown] done (exit 0)")), "A's log shows the drain sequence", A.log.filter((l) => l.includes("[shutdown]")).join("").trim().split("\n").length + " lines");
    } else {
      // ── single instance: SIGTERM leg only ─────────────────────────────
      chen = await login(A, "chen");
      const er = await login(A, "er.doc");
      onA = await connectWs(A, chen.cookie);
      await onA.waitFor((m) => m.type === "CONNECTION_ESTABLISHED");
      const convo = await (await api(A, er.cookie, "POST", "/api/messaging/conversations", { type: "direct", participantIds: [chen.user.id] })).json();
      const inflight = halfSentRequest(PORT_A, er.cookie, { conversationId: convo.id, content: "sent during shutdown", priority: "routine" });
      await inflight.started;
      await sleep(100);
      process.kill(A.child.pid, "SIGTERM");
      await sleep(300);
      const closedA = await Promise.race([onA.closed, sleep(5000).then(() => null)]);
      rec(closedA && closedA.code === 1012 && closedA.reason === "server_restart", "socket closes with 1012 server_restart on SIGTERM", JSON.stringify(closedA));
      const refused = await fetch(A.base + "/api/health").then((r) => "status " + r.status, (e) => e.cause?.code || e.code || "refused");
      rec(/ECONNREFUSED|refused|status 503/.test(String(refused)), "new connections are refused while draining", String(refused));
      inflight.finish();
      const raw = await Promise.race([inflight.done, sleep(8000).then(() => "TIMEOUT")]);
      const status = /^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1];
      rec(status === "201", "the request in flight during SIGTERM completed (201), not reset", status ? `HTTP ${status}` : String(raw).slice(0, 80));
      const exitA = await Promise.race([A.exit, sleep(15_000).then(() => null)]);
      rec(exitA && exitA.code === 0, "exited 0 after draining", JSON.stringify(exitA));
      rec(A.log.some((l) => l.includes("[shutdown] done (exit 0)")), "log shows the drain sequence");
    }
  } catch (err) {
    rec(false, "probe aborted", String(err?.stack || err));
    console.log("--- instance A log ---\n" + A.log.join(""));
    if (B) console.log("--- instance B log ---\n" + B.log.join(""));
  } finally {
    await stop();
  }
  const passed = results.length - failed;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total${DATABASE_URL ? " (two instances on Postgres)" : " (one instance on PGlite)"}`);
  process.exit(failed ? 1 : 0);
}

main();
