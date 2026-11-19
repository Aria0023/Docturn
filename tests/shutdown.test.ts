import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import { afterEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { WebSocket } from "ws";
import { createTestApp, DEV_PASSWORD, type TestContext } from "./helpers.js";
import { attachWebSocket } from "../server/ws/index.js";
import { _resetShutdownState, installGracefulShutdown, isShuttingDown } from "../server/shutdown.js";

/**
 * E1 — graceful shutdown (docs/ENTERPRISE_READINESS.md). The sequence is run
 * directly (no real signal — the process under test is the test runner);
 * scripts/shutdown-check.mjs sends a real SIGTERM to a real server.
 */

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  _resetShutdownState();
});

function listen(server: Server): Promise<number> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("graceful shutdown", () => {
  it("stops timers, refuses new connections, lets in-flight requests finish, releases leases, exits 0 — in that order", async () => {
    const order: string[] = [];
    const server = createServer((req, res) => {
      if (req.url === "/slow") {
        setTimeout(() => {
          order.push("slow-finished");
          res.end("done");
        }, 300);
      } else res.end("fast");
    });
    const port = await listen(server);
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    let exitCode: number | null = null;
    const handle = installGracefulShutdown({
      server,
      stopTimers: () => order.push("timers-stopped"),
      closeSockets: () => {
        order.push("sockets-closed");
        return 0;
      },
      releaseLeases: async () => {
        order.push("leases-released");
        return 3;
      },
      closeBus: async () => {
        order.push("bus-closed");
      },
      closeDb: async () => {
        order.push("db-closed");
      },
      timeoutMs: 5000,
      exit: (code) => {
        exitCode = code;
      },
      log: () => {},
    });
    cleanups.push(() => handle.uninstall());

    const slow = get(port, "/slow");
    await new Promise((r) => setTimeout(r, 50)); // the slow request is in flight
    const done = handle.shutdown("SIGTERM");
    expect(isShuttingDown()).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    // No new connections while draining.
    await expect(get(port, "/fast")).rejects.toMatchObject({ code: "ECONNREFUSED" });
    // The in-flight one still completes normally.
    expect(await slow).toEqual({ status: 200, body: "done" });
    expect(await done).toBe(0);
    expect(exitCode).toBe(0);
    expect(order).toEqual([
      "timers-stopped",
      "sockets-closed",
      "slow-finished",
      "leases-released",
      "bus-closed",
      "db-closed",
    ]);
    // Idempotent: a second call is the same run.
    expect(await handle.shutdown("SIGTERM")).toBe(0);
  });

  it("a request that outlives the deadline is cut and the exit code says so (1)", async () => {
    const server = createServer((_req, res) => {
      setTimeout(() => res.end("late"), 5000);
    });
    const port = await listen(server);
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    let exitCode: number | null = null;
    const handle = installGracefulShutdown({ server, timeoutMs: 200, exit: (c) => (exitCode = c), log: () => {} });
    cleanups.push(() => handle.uninstall());
    const hung = get(port, "/").catch((e: NodeJS.ErrnoException) => ({ status: -1, body: String(e.code) }));
    await new Promise((r) => setTimeout(r, 30));
    expect(await handle.shutdown("SIGTERM")).toBe(1);
    expect(exitCode).toBe(1);
    const r = await hung;
    expect(r.status).toBe(-1); // cut, not answered
  });

  it("WebSockets close with 1012 (service restart — the client reconnects, nobody is signed out) and health answers 503 while draining", async () => {
    const ctx: TestContext = await createTestApp();
    cleanups.push(() => ctx.handle.close());
    const server = createServer(ctx.app);
    const hub = attachWebSocket(server, ctx.app.locals.sessionMiddleware as RequestHandler);
    cleanups.push(() => hub.close());
    const port = await listen(server);
    const login = await supertest(ctx.app).post("/api/login").send({ orgCode: "ISPN", username: "chen", password: DEV_PASSWORD });
    const setCookie = login.headers["set-cookie"] as string[] | string | undefined;
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0]!;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    await new Promise<void>((r) => ws.once("message", () => r())); // CONNECTION_ESTABLISHED
    expect(hub.stats().connections).toBe(1);

    expect((await supertest(ctx.app).get("/api/health")).status).toBe(200);
    let exitCode: number | null = null;
    const handle = installGracefulShutdown({
      server,
      closeSockets: () => hub.closeForRestart(),
      timeoutMs: 2000,
      exit: (c) => (exitCode = c),
      log: () => {},
    });
    cleanups.push(() => handle.uninstall());
    const done = handle.shutdown("SIGTERM");
    expect(await closed).toEqual({ code: 1012, reason: "server_restart" });
    // In-flight / keep-alive callers see a draining instance, so a load
    // balancer stops routing to it.
    const draining = await supertest(ctx.app).get("/api/health");
    expect(draining.status).toBe(503);
    expect(draining.body).toMatchObject({ ok: false, shuttingDown: true });
    expect(await done).toBe(0);
    expect(exitCode).toBe(0);
    expect(hub.stats().connections).toBe(0);
  });
});
